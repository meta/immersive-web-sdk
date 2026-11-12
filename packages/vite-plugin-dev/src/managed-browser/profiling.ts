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
import { acquireApplicationRenderHold } from './render-mode.js';

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
      await startProfileInFrame(frame, mode);
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

async function startProfileInFrame(
  frame: Frame,
  mode: BrowserProfileResult['mode'],
): Promise<void> {
  // A profile measures real frame cost, so draw every frame while it runs.
  // The hold id lives on the page next to the profile state it belongs to.
  const renderHold = await acquireApplicationRenderHold(frame);
  await frame.evaluate((id) => {
    const runtimeWindow = window as any;
    runtimeWindow.FRAMEWORK_MCP_RUNTIME?.releaseRenderHold?.(
      runtimeWindow.__IWSDK_PROFILE_RENDER_HOLD,
    );
    runtimeWindow.__IWSDK_PROFILE_RENDER_HOLD = id;
  }, renderHold);
  await frame.evaluate(
    ({ maxSamples, mode }) => {
      const runtimeWindow = window as any;
      runtimeWindow.__IWSDK_BROWSER_PROFILE?.observers?.forEach(
        (observer: PerformanceObserver) => observer.disconnect(),
      );
      if (runtimeWindow.__IWSDK_BROWSER_PROFILE?.rafId != null) {
        cancelAnimationFrame(runtimeWindow.__IWSDK_BROWSER_PROFILE.rafId);
      }
      const state = {
        eventDurations: [] as number[],
        frameTimes: [] as number[],
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
            callback(entry);
          }
        });
        try {
          observer.observe({ type, buffered: true });
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
}

async function stopProfileInFrame(frame: Frame): Promise<{
  environment: BrowserEnvironmentDescriptor;
  eventDurations: number[];
  frameTimes: number[];
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
