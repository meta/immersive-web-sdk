/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash } from 'crypto';
import type { Frame, Page } from 'playwright';
import sharp from 'sharp';
import type {
  RuntimeCameraSnapshot,
  RuntimeFramingSnapshot,
} from '../runtime-proof-parity.js';
import { MANAGED_WORKSPACE_QUERY } from './access-protocol.js';
import {
  resolveApplicationFrame,
  withRuntimeView,
} from './application-surface.js';
import { PLAYWRIGHT_TYPE_MAP, type CapturedLog } from './console-capture.js';
import { errorMessage } from './internals.js';
import {
  assertBrowserEnvironmentDescriptor,
  flattenRuntimeHierarchy,
  readCameraFramingSnapshot,
  readEnvironmentDescriptor,
  readRuntimeHierarchy,
  readRuntimeNodes,
  readRuntimeRenderStats,
  sampleRuntimeFrameTimes,
  summarizeFrameTimes,
} from './page-probes.js';
import {
  createRenderHoldTracker,
  requestApplicationRender,
} from './render-mode.js';

export interface ManagedRuntimePublishRequest {
  expectedDocumentHash: string;
  expectedRuntimeHash: string;
  heroView?: string;
  nodeIds: string[];
}

export interface ManagedRuntimePreflightRequest {
  sampleFrames: number;
  warmupFrames: number;
}

export interface ManagedHostPerformanceMeasurement {
  calibrated: false;
  classification: 'host-browser-diagnostic';
  droppedFrameCount: number;
  droppedFrameThresholdMs: number;
  frameTimeMs: {
    max: number | null;
    p50: number | null;
    p95: number | null;
  };
  sampleFrames: number;
  targetDevice: null;
  warmupFrames: number;
}

export interface ManagedRuntimePreflightEvidence {
  camera: RuntimeCameraSnapshot | null;
  collectedAt: number;
  editor: {
    dirty: boolean;
    documentHash: string | null;
    renderStats: Record<string, unknown>;
    runtimeHash: string | null;
  };
  environment: Record<string, unknown>;
  framing: RuntimeFramingSnapshot | null;
  hierarchyObjectCount: number;
  performance: ManagedHostPerformanceMeasurement;
  renderStats: Record<string, unknown>;
  runtimeHashes: string[];
}

export interface ManagedRuntimeNodeEvidence {
  components: unknown;
  hierarchy: Record<string, unknown> | null;
  nodeId: string;
  transform: unknown;
}

export interface ManagedRuntimePublishEvidence {
  camera: RuntimeCameraSnapshot | null;
  capture: ManagedPngCapture;
  editor: {
    beforeReload: {
      dirty: boolean;
      documentHash: string | null;
      runtimeHash: string | null;
    };
    capture: ManagedPngCapture;
    dirty: boolean;
    documentHash: string | null;
    logs: CapturedLog[];
    renderStats: Record<string, unknown>;
    runtimeHash: string | null;
  };
  renderStats: Record<string, unknown>;
  runtimeReloadStartedAt: number;
  collectedAt: number;
  environment: Record<string, unknown>;
  framing: RuntimeFramingSnapshot | null;
  hierarchy: Record<string, unknown>;
  hierarchyObjectCount: number;
  nodes: ManagedRuntimeNodeEvidence[];
  performance: ManagedHostPerformanceMeasurement;
  reloadStartedAt: number;
  runtimeHashes: string[];
}

interface ManagedPngCapture {
  bytes: Buffer;
  height: number;
  nonblank: boolean;
  sha256: string;
  width: number;
}

async function collectPresentationSnapshot(
  frame: Frame,
  options: {
    frameTimes: number[];
    hierarchyObjectCount: number;
    renderStats: unknown;
    warmupFrames: number;
  },
): Promise<
  Pick<
    ManagedRuntimePreflightEvidence,
    'camera' | 'framing' | 'hierarchyObjectCount' | 'performance'
  >
> {
  const { camera, framing } = await frame.evaluate(
    readCameraFramingSnapshot,
    options.renderStats,
  );
  const summary = summarizeFrameTimes(options.frameTimes);
  return {
    camera,
    framing,
    hierarchyObjectCount: options.hierarchyObjectCount,
    performance: {
      calibrated: false,
      classification: 'host-browser-diagnostic',
      droppedFrameCount: summary.droppedFrameCount,
      droppedFrameThresholdMs: summary.droppedFrameThresholdMs,
      frameTimeMs: { max: summary.max, p50: summary.p50, p95: summary.p95 },
      sampleFrames: summary.sampleCount,
      targetDevice: null,
      warmupFrames: options.warmupFrames,
    },
  };
}

export async function collectRuntimePreflightEvidence(
  page: Page,
  request: ManagedRuntimePreflightRequest,
): Promise<ManagedRuntimePreflightEvidence> {
  return withRuntimeView(page, async () => {
    const editor = await page.evaluate(async () => {
      const sceneEditor = (window as any).IWSDK_SCENE_EDITOR;
      if (!sceneEditor?.session) {
        throw new Error('Managed browser is not on an open IWSDK scene editor');
      }
      const [documentResult, renderStats] = await Promise.all([
        sceneEditor.session.dispatch('scene_get_document', {}),
        sceneEditor.session.dispatch('scene_get_render_stats', {}),
      ]);
      return {
        dirty: sceneEditor.session.isDirty === true,
        documentHash:
          typeof documentResult?.documentHash === 'string'
            ? documentResult.documentHash
            : null,
        renderStats:
          renderStats && typeof renderStats === 'object'
            ? renderStats
            : { available: false },
        runtimeHash:
          typeof documentResult?.runtimeHash === 'string'
            ? documentResult.runtimeHash
            : null,
      };
    });
    const frame = await resolveApplicationFrame(page);
    // Evidence reads real draw calls and frame cost, so the app draws every
    // frame while it is collected. The runtime may not exist yet, so the hold
    // is retried inside the readiness loop below.
    const renderHold = createRenderHoldTracker();
    try {
      const runtimeDeadline = Date.now() + 20_000;
      let hierarchy: any = null;
      let hierarchyEntries: any[] = [];
      let runtimeHashes: string[] = [];
      let renderStats: Record<string, unknown> = { available: false };
      let lastRuntimeError: unknown = null;
      while (Date.now() < runtimeDeadline) {
        try {
          await renderHold.ensure(frame);
          await requestApplicationRender(frame, 1, 5_000);
          hierarchy = await frame.evaluate(readRuntimeHierarchy);
          ({ entries: hierarchyEntries, runtimeHashes } =
            flattenRuntimeHierarchy(hierarchy));
          renderStats = await frame.evaluate(readRuntimeRenderStats);
          if (runtimeHashes.length > 0) {
            break;
          }
        } catch (error) {
          lastRuntimeError = error;
        }
        await page.waitForTimeout(50);
      }
      if (hierarchy == null) {
        throw new Error(
          `IWSDK app runtime bridge is unavailable: ${errorMessage(
            lastRuntimeError ?? 'timed out',
          )}`,
        );
      }
      const frameTimes = await frame.evaluate(sampleRuntimeFrameTimes, {
        sampleFrames: request.sampleFrames,
        warmupFrames: request.warmupFrames,
      });
      const environmentRead = await frame.evaluate(
        readEnvironmentDescriptor,
        'renderer' as const,
      );
      assertBrowserEnvironmentDescriptor(environmentRead.environment);
      const presentation = await collectPresentationSnapshot(frame, {
        frameTimes,
        hierarchyObjectCount: hierarchyEntries.length,
        renderStats,
        warmupFrames: request.warmupFrames,
      });
      return {
        ...presentation,
        collectedAt: Date.now(),
        editor,
        environment: {
          ...environmentRead.environment,
          canvas:
            environmentRead.canvas == null
              ? null
              : {
                  height: environmentRead.canvas.backingHeight,
                  width: environmentRead.canvas.backingWidth,
                },
        },
        renderStats,
        runtimeHashes,
      };
    } finally {
      await renderHold.release();
    }
  });
}

export async function collectRuntimePublishEvidence(
  page: Page,
  request: ManagedRuntimePublishRequest,
  managedWorkspaceToken: string | null = null,
): Promise<ManagedRuntimePublishEvidence> {
  const editorBeforeReload = await page.evaluate(async () => {
    const sceneEditor = (window as any).IWSDK_SCENE_EDITOR;
    if (!sceneEditor?.session || !sceneEditor?.runtime) {
      throw new Error('Managed browser is not on an open IWSDK scene editor');
    }
    const result = await sceneEditor.session.dispatch('scene_get_document', {});
    return {
      dirty: sceneEditor.session.isDirty === true,
      documentHash:
        typeof result?.documentHash === 'string' ? result.documentHash : null,
      runtimeHash:
        typeof result?.runtimeHash === 'string' ? result.runtimeHash : null,
    };
  });
  if (editorBeforeReload.dirty) {
    throw Object.assign(
      new Error('Scene has unsaved editor changes; save before publishing'),
      { publishEditorState: editorBeforeReload },
    );
  }
  if (
    editorBeforeReload.documentHash !== request.expectedDocumentHash ||
    editorBeforeReload.runtimeHash !== request.expectedRuntimeHash
  ) {
    throw Object.assign(
      new Error('Managed editor hashes do not match the current scene file'),
      { publishEditorState: editorBeforeReload },
    );
  }

  const reloadStartedAt = Date.now();
  const editorLogs: CapturedLog[] = [];
  const editorProofPage = await page.context().newPage();
  const editorProofUrl = new URL(page.url());
  if (managedWorkspaceToken != null) {
    editorProofUrl.searchParams.set(
      MANAGED_WORKSPACE_QUERY,
      managedWorkspaceToken,
    );
    await editorProofPage.addInitScript((queryName) => {
      const url = new URL(window.location.href);
      if (url.searchParams.has(queryName)) {
        url.searchParams.delete(queryName);
        history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }, MANAGED_WORKSPACE_QUERY);
    await editorProofPage.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === editorProofUrl.origin) {
        await route.fallback();
        return;
      }
      const headers = Object.fromEntries(
        Object.entries(await route.request().allHeaders()).map(
          ([name, value]) => [
            name,
            value
              .split(managedWorkspaceToken)
              .join('[redacted-managed-workspace-token]'),
          ],
        ),
      );
      await route.fallback({ headers });
    });
  }
  const sanitizeEditorLogText = (value: string) =>
    managedWorkspaceToken == null
      ? value
      : value
          .split(managedWorkspaceToken)
          .join('[redacted-managed-workspace-token]');
  editorProofPage.on('console', (message) => {
    const level = PLAYWRIGHT_TYPE_MAP[message.type()];
    if (level != null) {
      const text = sanitizeEditorLogText(message.text());
      editorLogs.push({
        args: [text],
        kind: 'console',
        level,
        message: text,
        timestamp: Date.now(),
      });
    }
  });
  editorProofPage.on('pageerror', (error) => {
    const message = sanitizeEditorLogText(
      error.stack || `${error.name}: ${error.message}`,
    );
    editorLogs.push({
      args: [message],
      kind: 'pageerror',
      level: 'error',
      message: `[uncaught] ${message}`,
      timestamp: Date.now(),
    });
  });
  const reloadedEditor = await (async () => {
    try {
      await editorProofPage.goto(editorProofUrl.href, {
        waitUntil: 'domcontentloaded',
      });
      await editorProofPage.waitForFunction(
        () =>
          (window as any).__IWSDK_SCENE_EDITOR_READY === true &&
          (window as any).IWSDK_SCENE_EDITOR?.session != null,
        undefined,
        { timeout: 20000 },
      );
      return await editorProofPage.evaluate(async (heroView) => {
        const sceneEditor = (window as any).IWSDK_SCENE_EDITOR;
        if (!sceneEditor?.session) {
          throw new Error('Managed editor session is unavailable after reload');
        }
        const documentResult = await sceneEditor.session.dispatch(
          'scene_get_document',
          {},
        );
        const capture = await sceneEditor.session.dispatch(
          'scene_capture_review',
          {
            height: 800,
            includeImageData: true,
            ...(heroView ? { viewId: heroView } : {}),
            width: 800,
          },
        );
        return {
          capture,
          dirty: sceneEditor.session.isDirty === true,
          documentHash:
            typeof documentResult?.documentHash === 'string'
              ? documentResult.documentHash
              : null,
          renderStats:
            capture?.renderStats && typeof capture.renderStats === 'object'
              ? capture.renderStats
              : {
                  available: false,
                  reason: 'editor capture returned no render stats',
                },
          runtimeHash:
            typeof documentResult?.runtimeHash === 'string'
              ? documentResult.runtimeHash
              : null,
        };
      }, request.heroView ?? null);
    } finally {
      await editorProofPage.close().catch(() => {});
    }
  })();
  if (
    reloadedEditor.dirty ||
    reloadedEditor.documentHash !== request.expectedDocumentHash ||
    reloadedEditor.runtimeHash !== request.expectedRuntimeHash
  ) {
    throw Object.assign(
      new Error('Reloaded editor does not match the saved scene revision'),
      {
        publishEditorState: {
          dirty: reloadedEditor.dirty,
          documentHash: reloadedEditor.documentHash,
          runtimeHash: reloadedEditor.runtimeHash,
        },
      },
    );
  }
  const editorCaptureBytes = Buffer.from(
    String(reloadedEditor.capture?.imageData ?? ''),
    'base64',
  );
  const editorCapture = await inspectPngCapture(editorCaptureBytes);
  if (reloadedEditor.capture?.screenshotSha256 !== editorCapture.sha256) {
    throw Object.assign(
      new Error('Reloaded editor capture hash does not match its PNG bytes'),
      {
        publishEditorState: {
          documentHash: reloadedEditor.documentHash,
          expectedScreenshotSha256:
            reloadedEditor.capture?.screenshotSha256 ?? null,
          screenshotSha256: editorCapture.sha256,
        },
      },
    );
  }
  const editor = {
    beforeReload: editorBeforeReload,
    capture: editorCapture,
    dirty: reloadedEditor.dirty,
    documentHash: reloadedEditor.documentHash,
    logs: editorLogs,
    renderStats: reloadedEditor.renderStats as Record<string, unknown>,
    runtimeHash: reloadedEditor.runtimeHash,
  };

  const reloadToken = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return withRuntimeView(page, async () => {
    const runtimeSource = await page.evaluate(async () => {
      const sceneEditor = (window as any).IWSDK_SCENE_EDITOR;
      const frame = document.getElementById('workspace-runtime-frame');
      if (!(frame instanceof HTMLIFrameElement) || !sceneEditor?.runtime) {
        throw new Error('IWSDK workspace runtime iframe is unavailable');
      }
      const source =
        frame.dataset.workspaceRuntimeSrc || frame.getAttribute('src') || '/';
      frame.src = 'about:blank';
      return source;
    });
    await page.waitForFunction(
      () => {
        const frame = document.getElementById('workspace-runtime-frame');
        return (
          frame instanceof HTMLIFrameElement &&
          frame.contentDocument?.URL === 'about:blank'
        );
      },
      undefined,
      { timeout: 10000 },
    );
    // Let abort/error events from the superseded generation drain before the
    // proof generation's log window begins.
    await page.waitForTimeout(500);
    const runtimeReloadStartedAt = Date.now();
    await page.evaluate(
      ({ source, token }) => {
        const frame = document.getElementById('workspace-runtime-frame');
        if (!(frame instanceof HTMLIFrameElement)) {
          throw new Error('IWSDK workspace runtime iframe is unavailable');
        }
        const url = new URL(source, window.location.href);
        url.searchParams.set('__iwsdk_publish_reload', token);
        frame.src = url.pathname + url.search + url.hash;
      },
      { source: runtimeSource, token: reloadToken },
    );
    await page.waitForTimeout(250);

    // Evidence reads real draw calls and frame cost, so the app draws every
    // frame while it is collected. The reload drops a hold with its page, and
    // the reloaded runtime may not exist on the first attempts, so the hold
    // is re-taken on each candidate frame until it sticks.
    const renderHold = createRenderHoldTracker();
    try {
      let live: {
        hierarchy: any;
        hierarchyObjectCount: number;
        nodes: Awaited<ReturnType<typeof readRuntimeNodes>>;
        renderStats: Record<string, unknown> & { frameTimeSamplesMs: number[] };
        runtimeHashes: string[];
      } | null = null;
      let runtimeFrame: Frame | null = null;
      let lastLiveError: unknown = null;
      let runtimeObservedAt: number | null = null;
      const liveDeadline = Date.now() + 20_000;
      while (Date.now() < liveDeadline) {
        try {
          const candidateFrame = await resolveApplicationFrame(page);
          if (
            new URL(candidateFrame.url()).searchParams.get(
              '__iwsdk_publish_reload',
            ) !== reloadToken
          ) {
            throw new Error('App runtime reload is still in progress');
          }
          await renderHold.ensure(candidateFrame);
          await requestApplicationRender(candidateFrame, 1, 5_000);
          const hierarchy = await candidateFrame.evaluate(readRuntimeHierarchy);
          const { entries, runtimeHashes } = flattenRuntimeHierarchy(hierarchy);
          const nodes = await candidateFrame.evaluate(
            readRuntimeNodes,
            request.nodeIds.map((nodeId) => ({
              entry:
                entries.find((candidate) => candidate.sceneNodeId === nodeId) ??
                null,
              nodeId,
            })),
          );
          const renderStats = await candidateFrame.evaluate(
            readRuntimeRenderStats,
          );
          if (runtimeHashes.length > 0) {
            runtimeObservedAt ??= Date.now();
            const allNodesPresent = nodes.every(
              (entry) => entry.hierarchy != null,
            );
            if (allNodesPresent || Date.now() - runtimeObservedAt >= 3_000) {
              const frameTimeSamplesMs = await candidateFrame.evaluate(
                sampleRuntimeFrameTimes,
                { sampleFrames: 8, warmupFrames: 2 },
              );
              live = {
                hierarchy,
                hierarchyObjectCount: entries.length,
                nodes,
                renderStats: { ...renderStats, frameTimeSamplesMs },
                runtimeHashes,
              };
              runtimeFrame = candidateFrame;
              break;
            }
          }
        } catch (error) {
          lastLiveError = error;
        }
        await page.waitForTimeout(100);
      }
      if (live == null || runtimeFrame == null) {
        throw new Error(
          `App runtime did not become publish-ready: ${errorMessage(
            lastLiveError ?? 'timed out',
          )}`,
        );
      }
      const environmentRead = await runtimeFrame.evaluate(
        readEnvironmentDescriptor,
        'largest' as const,
      );
      assertBrowserEnvironmentDescriptor(environmentRead.environment);
      if (
        environmentRead.canvas == null ||
        environmentRead.canvasIndex == null ||
        environmentRead.canvasIndex < 0
      ) {
        throw new Error('App runtime did not render a canvas');
      }
      const canvases = runtimeFrame.locator('canvas');
      const canvasCount = await canvases.count();
      if (environmentRead.canvasIndex >= canvasCount) {
        throw new Error('App runtime frame has no canvas to capture');
      }
      const captureBytes = Buffer.from(
        await canvases
          .nth(environmentRead.canvasIndex)
          .screenshot({ type: 'png' }),
      );
      const capture = await inspectPngCapture(captureBytes);
      const presentation = await collectPresentationSnapshot(runtimeFrame, {
        frameTimes: live.renderStats.frameTimeSamplesMs,
        hierarchyObjectCount: live.hierarchyObjectCount,
        renderStats: live.renderStats,
        warmupFrames: 2,
      });
      return {
        camera: presentation.camera,
        capture,
        collectedAt: Date.now(),
        editor,
        environment: {
          ...environmentRead.environment,
          canvas: environmentRead.canvas,
        },
        framing: presentation.framing,
        hierarchy: live.hierarchy,
        hierarchyObjectCount: presentation.hierarchyObjectCount,
        nodes: live.nodes,
        performance: presentation.performance,
        renderStats: live.renderStats as Record<string, unknown>,
        reloadStartedAt,
        runtimeReloadStartedAt,
        runtimeHashes: live.runtimeHashes,
      };
    } finally {
      await renderHold.release();
    }
  });
}

async function inspectPngCapture(bytes: Buffer): Promise<ManagedPngCapture> {
  if (bytes.length === 0) {
    return {
      bytes,
      height: 0,
      nonblank: false,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      width: 0,
    };
  }
  const image = sharp(bytes);
  const [metadata, statistics] = await Promise.all([
    image.metadata(),
    image.stats(),
  ]);
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const colorChannels = statistics.channels.slice(0, 3);
  return {
    bytes,
    height,
    nonblank:
      width > 1 &&
      height > 1 &&
      colorChannels.some(
        (channel) => channel.max - channel.min > 2 && channel.stdev > 0.25,
      ),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    width,
  };
}
