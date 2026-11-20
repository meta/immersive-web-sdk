/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { BrowserContext, CDPSession, Frame, Page } from 'playwright';
import {
  getApplicationMetadata,
  resolveApplicationFrame,
  restoreWorkspaceView,
  showWorkspaceRuntime,
  WORKSPACE_RESTORE_RESERVE_MS,
  type BrowserApplicationMetadata,
  type WorkspaceRuntimeVisibility,
} from './application-surface.js';
import { ManagedBrowserCommandCoordinator } from './command-lock.js';
import { MAX_LOG_MESSAGE_LENGTH, truncateText } from './console-capture.js';
import { errorMessage } from './internals.js';
import {
  assertBrowserEnvironmentDescriptor,
  maxOrNull,
  readEnvironmentDescriptor,
  summarizeFrameTimes,
  type BrowserEnvironmentDescriptor,
} from './page-probes.js';
import {
  acquireApplicationRenderHold,
  requestApplicationRender,
  type ManagedRenderMode,
} from './render-mode.js';

/**
 * Frames an app that renders on demand draws under the profile's render hold
 * before sampling starts. Such an app may not have drawn for a long time, or
 * ever in its current view (just after entering XR, say), and its first
 * frames pay one-time costs (shader programs, texture uploads) that are not
 * the frame cost being measured. The browser keeps frames in flight, so that
 * cost can surface a frame or two later. In cold headless sessions of the VR
 * starter, one warm-up frame left a 1.6 s interval in the first profile and
 * two left a 1.5 s stall before its first sample; three kept both out.
 * Runtime publish evidence skips two frames (`warmupFrames: 2`) after its
 * readiness loop has already drawn one, so it also lets three go by.
 */
const PROFILE_WARMUP_FRAMES = 3;

/**
 * Longest a profile start waits for its warm-up frames: as long as runtime
 * evidence waits for a frame. An app whose render loop has stopped never
 * draws them.
 */
const MAX_PROFILE_WARMUP_MS = 5_000;

/**
 * Shortest warm-up a profile start attempts. Drawing three frames and seeing
 * the last one presented takes four frames: 67 ms at 60 Hz for an app with
 * cheap frames, but about 0.5 s for the VR starter on SwiftShader (headless,
 * no GPU), whose frames take 117-133 ms. With less time a healthy app could
 * miss them and the timeout would blame its render loop, so the profile
 * skips the warm-up instead and says so.
 */
const MIN_PROFILE_WARMUP_MS = 1_000;

/**
 * Active command time a profile start keeps after its warm-up, to install the
 * sampler, attach CDP and start a trace, or to undo them and restore the
 * workspace view when the start fails.
 */
const PROFILE_START_RESERVE_MS = WORKSPACE_RESTORE_RESERVE_MS + 2_500;

/**
 * Animation frames in a row in which the app drew nothing while the profile
 * held rendering, from which the profile reports `render-loop-stopped`. Under
 * the hold the app draws every frame; entering or leaving XR skips a frame or
 * two. A longer run means its render loop stopped (one uncaught error in a
 * frame stops it), before the profile or during it, or stalled, and the
 * samples of that run are the requestAnimationFrame intervals of a page that
 * did not draw. The longest run counts, so a stall that ends before the
 * profile stops is reported too.
 */
const RENDER_STOPPED_FRAMES = 30;

const MAX_TRACE_ARTIFACT_BYTES = 100 * 1024 * 1024;

const MAX_PROFILE_SAMPLES = 10_000;

const MAX_PROFILE_INTERRUPTIONS = 100;

export interface BrowserProfileRequest {
  action: 'start' | 'status' | 'stop';
  maxDurationMs?: number;
  mode?: 'interaction' | 'rendering' | 'trace';
  profileId?: string;
}

export interface BrowserProfileResult {
  application: BrowserApplicationMetadata;
  artifact?: {
    bytes: number;
    path: string;
    sha256: string;
  };
  calibrated: false;
  classification: 'host-browser-diagnostic';
  durationMs: number;
  droppedInterruptionCount: number;
  environment?: BrowserEnvironmentDescriptor;
  interruptions: Array<{ at: number; kind: string; value?: string }>;
  mode: 'interaction' | 'rendering' | 'trace';
  profileId: string;
  status: 'active' | 'started' | 'stopped';
  summary?: {
    browserMetrics: Record<string, number>;
    collection: {
      eventTiming: boolean;
      frameTiming: boolean;
      trace: boolean;
    };
    eventTiming: { count: number; maxDurationMs: number | null };
    frameTimeMs: {
      droppedFrameCount: number;
      max: number | null;
      p50: number | null;
      p95: number | null;
      sampleCount: number;
      source: 'requestAnimationFrame-interval';
    };
    longTasks: { count: number; totalDurationMs: number };
    marks: Array<{ name: string; startTime: number }>;
  };
  targetDevice: null;
}

interface ActiveBrowserProfile {
  application: BrowserApplicationMetadata;
  cdp: CDPSession;
  deadline: number;
  droppedInterruptionCount: number;
  interruptions: Array<{ at: number; kind: string; value?: string }>;
  mode: BrowserProfileResult['mode'];
  profileId: string;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
  tracePath: string | null;
  visibility: WorkspaceRuntimeVisibility;
}

export class BrowserProfiler {
  private activeProfile: ActiveBrowserProfile | null = null;
  private closed = false;
  private lastResult: BrowserProfileResult | null = null;

  constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly workspaceRoot: string,
    private readonly coordinator: ManagedBrowserCommandCoordinator,
    private readonly sanitize: (value: string) => string,
  ) {}

  get activeDeadline(): number | null {
    return this.activeProfile?.deadline ?? null;
  }

  note(interruption: { at: number; kind: string; value?: string }): void {
    if (this.activeProfile != null) {
      this.record(this.activeProfile, interruption);
    }
  }

  async markInteractionStep(
    frame: Frame,
    index: number,
    action: string,
  ): Promise<void> {
    const profile = this.activeProfile;
    if (profile == null) {
      return;
    }
    await frame
      .evaluate(
        ({ action, index, profileId }) => {
          performance.mark(
            `iwsdk-browser-${profileId}-step-${index}-${action}`,
          );
        },
        { action, index, profileId: profile.profileId },
      )
      .catch(() => {});
  }

  async start(request: BrowserProfileRequest): Promise<BrowserProfileResult> {
    if (this.closed) {
      throw new Error('Managed browser closed while starting the profile');
    }
    if (this.activeProfile != null) {
      throw new Error(
        `Browser profile ${this.activeProfile.profileId} is already active`,
      );
    }
    const visibility = await showWorkspaceRuntime(this.page);
    let cdp: CDPSession | null = null;
    let traceStarted = false;
    try {
      const frame = await resolveApplicationFrame(this.page);
      const application = await getApplicationMetadata(this.page);
      const mode = request.mode ?? 'interaction';
      const profileId = randomUUID();
      const maxDurationMs = Math.min(
        60_000,
        Math.max(1_000, request.maxDurationMs ?? 30_000),
      );
      const startInterruptions = await startProfileInFrame(
        frame,
        mode,
        Math.min(
          MAX_PROFILE_WARMUP_MS,
          this.coordinator.getRemainingActiveTimeMs() -
            PROFILE_START_RESERVE_MS,
        ),
      );
      cdp = await this.context.newCDPSession(this.page);
      await cdp.send('Performance.enable').catch(() => {});
      let tracePath: string | null = null;
      if (mode === 'trace') {
        const artifactRoot = path.join(
          this.workspaceRoot,
          '.iwsdk',
          'artifacts',
          'browser',
        );
        fs.mkdirSync(artifactRoot, { recursive: true });
        tracePath = path.join(artifactRoot, `profile-${profileId}.zip`);
        await this.context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true,
        });
        traceStarted = true;
      }
      if (this.closed) {
        throw new Error('Managed browser closed while starting the profile');
      }
      const startedAt = Date.now();
      let profile!: ActiveBrowserProfile;
      const timer = setTimeout(() => {
        if (this.activeProfile !== profile) {
          return;
        }
        this.record(profile, { at: Date.now(), kind: 'timeout-requested' });
        void this.coordinator
          .runExclusive(() => this.stop(profileId, 'timeout'))
          .catch(() => {});
      }, maxDurationMs);
      timer.unref?.();
      profile = {
        application,
        cdp,
        deadline: startedAt + maxDurationMs,
        droppedInterruptionCount: 0,
        interruptions: [],
        mode,
        profileId,
        startedAt,
        timer,
        tracePath,
        visibility,
      };
      for (const interruption of startInterruptions) {
        this.record(profile, interruption);
      }
      this.activeProfile = profile;
      this.lastResult = null;
      return this.describe(profile, 'started');
    } catch (error) {
      if (traceStarted) {
        await this.context.tracing.stop().catch(() => {});
      }
      await cdp?.detach().catch(() => {});
      const frame = await resolveApplicationFrame(this.page).catch(() => null);
      if (frame != null) {
        await stopProfileInFrame(frame).catch(() => {});
      }
      await restoreWorkspaceView(this.page, visibility).catch(() => {});
      throw error;
    }
  }

  async stop(
    requestedProfileId?: string,
    interruptionKind?: string,
  ): Promise<BrowserProfileResult> {
    const profile = this.activeProfile;
    if (profile == null) {
      if (
        this.lastResult != null &&
        (requestedProfileId == null ||
          requestedProfileId === this.lastResult.profileId)
      ) {
        return this.lastResult;
      }
      throw new Error('No browser profile is active');
    }
    if (
      requestedProfileId != null &&
      requestedProfileId !== profile.profileId
    ) {
      throw new Error(`Browser profile ID mismatch: ${requestedProfileId}`);
    }
    clearTimeout(profile.timer);
    if (interruptionKind) {
      this.record(profile, { at: Date.now(), kind: interruptionKind });
    }
    this.activeProfile = null;
    const emptySamples = () => ({
      environment: undefined,
      eventDurations: [] as number[],
      frameTimes: [] as number[],
      longestUndrawnRun: null,
      longTasks: [] as number[],
      marks: [] as Array<{ name: string; startTime: number }>,
      visibilityEvents: [] as Array<{ at: number; value: string }>,
    });
    let traceStopped = false;
    try {
      const frame = await resolveApplicationFrame(this.page).catch((error) => {
        this.recordError(profile, 'application-frame-unavailable', error);
        return null;
      });
      const samples =
        frame == null
          ? emptySamples()
          : await stopProfileInFrame(frame).catch((error) => {
              this.recordError(profile, 'page-profile-unavailable', error);
              return emptySamples();
            });
      if (
        samples.longestUndrawnRun != null &&
        samples.longestUndrawnRun >= RENDER_STOPPED_FRAMES
      ) {
        this.record(profile, {
          at: Date.now(),
          kind: 'render-loop-stopped',
          value: `the app drew nothing for ${samples.longestUndrawnRun} animation frames in a row while the profile held rendering`,
        });
      }
      const browserMetricsResponse = await profile.cdp
        .send('Performance.getMetrics')
        .catch(() => ({ metrics: [] }));
      let artifact: BrowserProfileResult['artifact'];
      if (profile.tracePath != null) {
        try {
          await this.context.tracing.stop({ path: profile.tracePath });
          traceStopped = true;
        } catch (error) {
          this.recordError(profile, 'trace-stop-error', error);
        }
        try {
          if (fs.existsSync(profile.tracePath)) {
            const artifactBytes = fs.statSync(profile.tracePath).size;
            if (artifactBytes > MAX_TRACE_ARTIFACT_BYTES) {
              fs.rmSync(profile.tracePath, { force: true });
              this.record(profile, {
                at: Date.now(),
                kind: 'artifact-limit',
                value: `${artifactBytes} bytes exceeded ${MAX_TRACE_ARTIFACT_BYTES}`,
              });
            } else {
              const bytes = fs.readFileSync(profile.tracePath);
              artifact = {
                bytes: bytes.length,
                path: path
                  .relative(this.workspaceRoot, profile.tracePath)
                  .split(path.sep)
                  .join('/'),
                sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
              };
            }
          } else {
            this.record(profile, { at: Date.now(), kind: 'artifact-missing' });
          }
        } catch (error) {
          this.recordError(profile, 'artifact-error', error);
        }
      }
      const frameSummary = summarizeFrameTimes(samples.frameTimes);
      for (const event of samples.visibilityEvents) {
        this.record(profile, {
          at: event.at,
          kind: 'visibility',
          value: event.value,
        });
      }
      const application = await getApplicationMetadata(this.page).catch(
        (error) => {
          this.recordError(profile, 'application-metadata-unavailable', error);
          return profile.application;
        },
      );
      const result: BrowserProfileResult = {
        ...this.describe(profile, 'stopped', application),
        ...(artifact == null ? {} : { artifact }),
        ...(samples.environment == null
          ? {}
          : { environment: samples.environment }),
        summary: {
          browserMetrics: Object.fromEntries(
            browserMetricsResponse.metrics.map((metric) => [
              metric.name,
              metric.value,
            ]),
          ),
          collection: {
            eventTiming: profile.mode !== 'rendering',
            frameTiming: true,
            trace: profile.mode === 'trace',
          },
          eventTiming: {
            count: samples.eventDurations.length,
            maxDurationMs: maxOrNull(samples.eventDurations),
          },
          frameTimeMs: {
            droppedFrameCount: frameSummary.droppedFrameCount,
            max: frameSummary.max,
            p50: frameSummary.p50,
            p95: frameSummary.p95,
            sampleCount: frameSummary.sampleCount,
            source: 'requestAnimationFrame-interval',
          },
          longTasks: {
            count: samples.longTasks.length,
            totalDurationMs: samples.longTasks.reduce(
              (total, duration) => total + duration,
              0,
            ),
          },
          marks: samples.marks,
        },
      };
      this.lastResult = result;
      return result;
    } finally {
      await profile.cdp.detach().catch(() => {});
      if (profile.tracePath != null && !traceStopped) {
        await this.context.tracing.stop().catch(() => {});
      }
      try {
        await restoreWorkspaceView(this.page, profile.visibility);
      } catch (error) {
        this.recordError(profile, 'view-restore-error', error);
      }
    }
  }

  status(): BrowserProfileResult {
    if (this.activeProfile != null) {
      return this.describe(this.activeProfile, 'active');
    }
    if (this.lastResult != null) {
      return this.lastResult;
    }
    throw new Error('No browser profile has been started');
  }

  async stopIfActive(interruptionKind: string): Promise<void> {
    if (this.activeProfile != null) {
      await this.stop(undefined, interruptionKind);
    }
  }

  handleBrowserClose(): void {
    this.closed = true;
    const profile = this.activeProfile;
    this.activeProfile = null;
    if (profile == null) {
      return;
    }
    clearTimeout(profile.timer);
    this.record(profile, { at: Date.now(), kind: 'browser-close' });
    void profile.cdp.detach().catch(() => {});
    if (profile.tracePath != null) {
      void this.context.tracing.stop().catch(() => {});
    }
  }

  private describe(
    profile: ActiveBrowserProfile,
    status: 'active' | 'started' | 'stopped',
    application = profile.application,
  ): BrowserProfileResult {
    return {
      application,
      calibrated: false,
      classification: 'host-browser-diagnostic',
      durationMs: status === 'started' ? 0 : Date.now() - profile.startedAt,
      droppedInterruptionCount: profile.droppedInterruptionCount,
      interruptions: profile.interruptions,
      mode: profile.mode,
      profileId: profile.profileId,
      status,
      targetDevice: null,
    };
  }

  private record(
    profile: ActiveBrowserProfile,
    interruption: { at: number; kind: string; value?: string },
  ): void {
    if (profile.interruptions.length >= MAX_PROFILE_INTERRUPTIONS) {
      profile.droppedInterruptionCount += 1;
      return;
    }
    profile.interruptions.push({
      ...interruption,
      ...(interruption.value == null
        ? {}
        : {
            value: truncateText(
              this.sanitize(interruption.value),
              MAX_LOG_MESSAGE_LENGTH,
            ),
          }),
    });
  }

  private recordError(
    profile: ActiveBrowserProfile,
    kind: string,
    error: unknown,
  ): void {
    this.record(profile, {
      at: Date.now(),
      kind,
      value: errorMessage(error),
    });
  }
}

/**
 * Hold rendering, warm up an on-demand app, and install the page sampler.
 * Returns interruptions for the profile to record: warm-up frames that were
 * not drawn within `warmupBudgetMs`, or a warm-up that was skipped because
 * that budget was too short or the app's render mode could not be read.
 */
async function startProfileInFrame(
  frame: Frame,
  mode: BrowserProfileResult['mode'],
  warmupBudgetMs: number,
): Promise<BrowserProfileResult['interruptions']> {
  const interruptions: BrowserProfileResult['interruptions'] = [];
  // A profile measures real frame cost, so draw every frame while it runs.
  // The hold id lives on the page next to the profile state it belongs to.
  // The same call reads the app's render mode, so the warm-up is decided on
  // the page that holds rendering. If the page goes away, the call fails and
  // so does the start.
  const renderHold = await acquireApplicationRenderHold(frame);
  const renderMode = await frame.evaluate(
    (id): ManagedRenderMode | null | { error: string } => {
      const runtimeWindow = window as any;
      const runtime = runtimeWindow.FRAMEWORK_MCP_RUNTIME;
      runtime?.releaseRenderHold?.(runtimeWindow.__IWSDK_PROFILE_RENDER_HOLD);
      runtimeWindow.__IWSDK_PROFILE_RENDER_HOLD = id;
      try {
        const mode = runtime?.renderMode;
        return mode === 'continuous' || mode === 'on-demand' ? mode : null;
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    renderHold,
  );
  if (renderMode != null && typeof renderMode === 'object') {
    // Reading the mode threw. The app may render on demand, so the samples
    // may include first-draw costs.
    interruptions.push({
      at: Date.now(),
      kind: 'render-mode-unavailable',
      value: `${PROFILE_WARMUP_FRAMES} warm-up frames skipped: could not read the app's render mode: ${renderMode.error}`,
    });
  } else if (renderMode === 'on-demand') {
    // Only an app that renders on demand needs warming up. One that draws
    // continuously (headed sessions, IWSDK_DEV_RENDER_MODE=continuous, apps
    // without render modes) paid its first-draw costs long ago.
    if (warmupBudgetMs < MIN_PROFILE_WARMUP_MS) {
      // Too little of the command's time is left to draw the frames. The
      // samples may include first-draw costs.
      interruptions.push({
        at: Date.now(),
        kind: 'render-warmup-skipped-budget',
        value: `${PROFILE_WARMUP_FRAMES} warm-up frames skipped: ${Math.max(0, warmupBudgetMs)}ms of the command's time was left for them`,
      });
    } else {
      const warmup = await requestApplicationRender(
        frame,
        PROFILE_WARMUP_FRAMES,
        warmupBudgetMs,
      );
      if (warmup === 'timeout') {
        // The samples may include first-draw costs, or frames the app never
        // drew because its render loop has stopped.
        interruptions.push({
          at: Date.now(),
          kind: 'render-warmup-timeout',
          value: `${PROFILE_WARMUP_FRAMES} warm-up frames not drawn within ${warmupBudgetMs}ms`,
        });
      }
    }
  }
  await frame.evaluate(
    ({ maxSamples, mode }) => {
      const runtimeWindow = window as any;
      runtimeWindow.__IWSDK_BROWSER_PROFILE?.observers?.forEach(
        (observer: PerformanceObserver) => observer.disconnect(),
      );
      if (runtimeWindow.__IWSDK_BROWSER_PROFILE?.rafId != null) {
        cancelAnimationFrame(runtimeWindow.__IWSDK_BROWSER_PROFILE.rafId);
      }
      // Count only work that starts during the profile, not the first draw
      // or the warm-up frames just before it. Observing without `buffered`
      // skips earlier entries; the check drops late reports of earlier work.
      const since = performance.now();
      const readDrawnFrames = () => {
        try {
          const count = runtimeWindow.FRAMEWORK_MCP_RUNTIME?.drawnFrames;
          return typeof count === 'number' ? count : null;
        } catch {
          return null;
        }
      };
      const state = {
        drawnFrames: readDrawnFrames(),
        eventDurations: [] as number[],
        framesSinceDraw: 0,
        frameTimes: [] as number[],
        longestUndrawnRun: 0,
        longTasks: [] as number[],
        observers: [] as PerformanceObserver[],
        previousFrame: null as number | null,
        rafId: null as number | null,
        visibilityEvents: [] as Array<{ at: number; value: string }>,
        visibilityHandler: null as (() => void) | null,
      };
      const observe = (
        type: string,
        callback: (entry: PerformanceEntry) => void,
      ) => {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) {
          return;
        }
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.startTime >= since) {
              callback(entry);
            }
          }
        });
        try {
          observer.observe({ type });
          state.observers.push(observer);
        } catch {
          observer.disconnect();
        }
      };
      observe('longtask', (entry) => {
        if (state.longTasks.length < maxSamples) {
          state.longTasks.push(entry.duration);
        }
      });
      if (mode !== 'rendering') {
        observe('event', (entry) => {
          if (state.eventDurations.length < maxSamples) {
            state.eventDurations.push(entry.duration);
          }
        });
      }
      const sample = (timestamp: number) => {
        if (
          state.previousFrame != null &&
          state.frameTimes.length < maxSamples
        ) {
          state.frameTimes.push(timestamp - state.previousFrame);
        }
        state.previousFrame = timestamp;
        // While the profile holds rendering the app draws every frame, so
        // count the frames since its drawn-frame count last moved, and keep
        // the longest such run. Counting ends when stopping releases the
        // hold.
        const drawnFrames = readDrawnFrames();
        if (
          drawnFrames != null &&
          runtimeWindow.__IWSDK_PROFILE_RENDER_HOLD != null
        ) {
          if (drawnFrames === state.drawnFrames) {
            state.framesSinceDraw += 1;
            state.longestUndrawnRun = Math.max(
              state.longestUndrawnRun,
              state.framesSinceDraw,
            );
          } else {
            state.drawnFrames = drawnFrames;
            state.framesSinceDraw = 0;
          }
        }
        state.rafId = requestAnimationFrame(sample);
      };
      state.rafId = requestAnimationFrame(sample);
      state.visibilityHandler = () => {
        if (state.visibilityEvents.length < maxSamples) {
          state.visibilityEvents.push({
            at: Date.now(),
            value: document.visibilityState,
          });
        }
      };
      document.addEventListener('visibilitychange', state.visibilityHandler);
      for (const mark of performance.getEntriesByType('mark')) {
        if (mark.name.startsWith('iwsdk-browser-')) {
          performance.clearMarks(mark.name);
        }
      }
      performance.mark(`iwsdk-browser-profile-${mode}-start`);
      runtimeWindow.__IWSDK_BROWSER_PROFILE = state;
    },
    { maxSamples: MAX_PROFILE_SAMPLES, mode },
  );
  return interruptions;
}

/**
 * Release the profile's render hold and collect its page samples.
 * `longestUndrawnRun` is the longest run of animation frames in which the
 * app drew nothing while the profile held rendering; it is `null` when the
 * app does not report drawn frames.
 */
async function stopProfileInFrame(frame: Frame): Promise<{
  environment: BrowserEnvironmentDescriptor;
  eventDurations: number[];
  frameTimes: number[];
  longestUndrawnRun: number | null;
  longTasks: number[];
  marks: Array<{ name: string; startTime: number }>;
  visibilityEvents: Array<{ at: number; value: string }>;
}> {
  await frame
    .evaluate(() => {
      const runtimeWindow = window as any;
      const id = runtimeWindow.__IWSDK_PROFILE_RENDER_HOLD;
      delete runtimeWindow.__IWSDK_PROFILE_RENDER_HOLD;
      if (id != null) {
        runtimeWindow.FRAMEWORK_MCP_RUNTIME?.releaseRenderHold?.(id);
      }
    })
    .catch(() => {});
  const result = await frame.evaluate((maxSamples) => {
    const runtimeWindow = window as any;
    const state = runtimeWindow.__IWSDK_BROWSER_PROFILE;
    if (state == null) {
      throw new Error('Browser profile page state is unavailable');
    }
    state.observers.forEach((observer: PerformanceObserver) =>
      observer.disconnect(),
    );
    if (state.rafId != null) {
      cancelAnimationFrame(state.rafId);
    }
    if (state.visibilityHandler != null) {
      document.removeEventListener('visibilitychange', state.visibilityHandler);
    }
    delete runtimeWindow.__IWSDK_BROWSER_PROFILE;
    return {
      eventDurations: state.eventDurations as number[],
      frameTimes: state.frameTimes as number[],
      longestUndrawnRun:
        state.drawnFrames == null ? null : (state.longestUndrawnRun as number),
      longTasks: state.longTasks as number[],
      visibilityEvents: state.visibilityEvents as Array<{
        at: number;
        value: string;
      }>,
      marks: performance
        .getEntriesByType('mark')
        .filter((entry) => entry.name.startsWith('iwsdk-browser-'))
        .slice(0, maxSamples)
        .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
    };
  }, MAX_PROFILE_SAMPLES);
  const { environment } = await frame.evaluate(
    readEnvironmentDescriptor,
    'first' as const,
  );
  assertBrowserEnvironmentDescriptor(environment);
  return { ...result, environment };
}
