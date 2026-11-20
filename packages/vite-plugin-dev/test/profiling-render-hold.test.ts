/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { ManagedBrowserCommandCoordinator } from '../src/managed-browser/command-lock.js';

const mocks = vi.hoisted(() => ({
  getApplicationMetadata: vi.fn().mockResolvedValue({
    generation: 1,
    id: 'app',
    outerUrl: 'http://localhost:5173/',
    url: 'http://localhost:5173/',
    workspaceFramed: false,
  }),
  resolveApplicationFrame: vi.fn(),
  restoreWorkspaceView: vi.fn().mockResolvedValue(undefined),
  showWorkspaceRuntime: vi
    .fn()
    .mockResolvedValue({ isWorkspace: false, previousView: null }),
}));

vi.mock('../src/managed-browser/application-surface.js', async () => ({
  ...(await vi.importActual('../src/managed-browser/application-surface.js')),
  getApplicationMetadata: mocks.getApplicationMetadata,
  resolveApplicationFrame: mocks.resolveApplicationFrame,
  restoreWorkspaceView: mocks.restoreWorkspaceView,
  showWorkspaceRuntime: mocks.showWorkspaceRuntime,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * A frame whose render-hold page functions run against a fake runtime that
 * renders on demand unless `renderMode` says otherwise. `requestRender`
 * decides when (or whether) requested frames finish drawing; by default they
 * finish at once. The profile's own page instrumentation needs a real
 * browser, so it is stubbed: it resolves, or rejects when `failInstall` is
 * set.
 */
function holdFrame(
  options: {
    failInstall?: boolean;
    renderMode?: string;
    requestRender?: (frames: number) => Promise<void> | void;
    staleHold?: string;
  } = {},
) {
  const holds = new Set<string>(options.staleHold ? [options.staleHold] : []);
  const calls: string[] = [];
  let next = 0;
  const runtime = {
    acquireRenderHold: vi.fn(() => {
      const id = `hold-${++next}`;
      holds.add(id);
      return id;
    }),
    releaseRenderHold: vi.fn((id: string) => holds.delete(id)),
    renderMode: 'renderMode' in options ? options.renderMode : 'on-demand',
    requestRender: vi.fn(async (frames: number) => {
      calls.push(`render:${frames}:held=${holds.size > 0}`);
      await options.requestRender?.(frames);
    }),
  };
  const pageWindow: Record<string, unknown> = {
    FRAMEWORK_MCP_RUNTIME: runtime,
    ...(options.staleHold
      ? { __IWSDK_PROFILE_RENDER_HOLD: options.staleHold }
      : {}),
  };
  const frame = {
    evaluate: vi.fn(async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
      const source = String(fn);
      if (source.includes('__IWSDK_BROWSER_PROFILE')) {
        if (source.includes('__IWSDK_BROWSER_PROFILE = state')) {
          calls.push('sampling');
        }
        if (options.failInstall) {
          throw new Error('profile instrumentation failed');
        }
        return undefined;
      }
      if (
        source.includes('acquireRenderHold') ||
        source.includes('renderMode') ||
        source.includes('requestRender') ||
        source.includes('__IWSDK_PROFILE_RENDER_HOLD')
      ) {
        const previous = (globalThis as any).window;
        (globalThis as any).window = pageWindow;
        try {
          return await fn(arg);
        } finally {
          (globalThis as any).window = previous;
        }
      }
      return undefined;
    }),
  };
  return { calls, frame, holds, pageWindow, runtime };
}

async function createProfiler(
  frame: unknown,
  coordinator = new ManagedBrowserCommandCoordinator(async () => {}),
) {
  mocks.resolveApplicationFrame.mockResolvedValue(frame);
  const cdp = {
    detach: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ metrics: [] }),
  };
  const context = {
    newCDPSession: vi.fn().mockResolvedValue(cdp),
    tracing: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    },
  };
  const { BrowserProfiler } = await import(
    '../src/managed-browser/profiling.js'
  );
  return new BrowserProfiler(
    { mainFrame: () => frame, url: () => 'http://localhost:5173/' } as never,
    context as never,
    process.cwd(),
    coordinator,
    (value) => value,
  );
}

/** The warm-up's render request, as the page received it. */
function warmupRequest(frame: { evaluate: { mock: { calls: unknown[][] } } }) {
  return frame.evaluate.mock.calls
    .map((call) => call[1])
    .find(
      (arg) => typeof arg === 'object' && arg != null && 'timeoutMs' in arg,
    );
}

describe('BrowserProfiler render hold', () => {
  test('draws warm-up frames under the hold before sampling starts', async () => {
    const { calls, frame } = holdFrame();
    const profiler = await createProfiler(frame);

    const started = await profiler.start({
      action: 'start',
      mode: 'rendering',
      maxDurationMs: 60_000,
    });
    expect(calls).toEqual(['render:3:held=true', 'sampling']);
    expect(started.interruptions).toEqual([]);

    await profiler.stop(started.profileId);
  });

  test.each([
    ['draws continuously', 'continuous'],
    ['reports no render mode', undefined],
  ])('skips the warm-up when the app %s', async (_description, renderMode) => {
    const { calls, frame, holds, runtime } = holdFrame({ renderMode });
    const profiler = await createProfiler(frame);

    const started = await profiler.start({
      action: 'start',
      mode: 'rendering',
      maxDurationMs: 60_000,
    });
    expect(calls).toEqual(['sampling']);
    expect(runtime.requestRender).not.toHaveBeenCalled();
    expect([...holds]).toEqual(['hold-1']);

    await profiler.stop(started.profileId);
  });

  test('stops waiting for warm-up frames after 5 s and records it on the profile', async () => {
    vi.useFakeTimers();
    // The app's render loop has stopped, so requested frames are never drawn.
    const { frame, holds } = holdFrame({
      requestRender: () => new Promise<void>(() => {}),
    });
    const profiler = await createProfiler(frame);

    let returned = false;
    const start = profiler
      .start({ action: 'start', mode: 'rendering', maxDurationMs: 60_000 })
      .finally(() => {
        returned = true;
      });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const started = await start;

    expect(warmupRequest(frame)).toEqual({ frames: 3, timeoutMs: 5_000 });
    expect(started.interruptions).toEqual([
      {
        at: expect.any(Number),
        kind: 'render-warmup-timeout',
        value: '3 warm-up frames not drawn within 5000ms',
      },
    ]);
    expect([...holds]).toEqual(['hold-1']);

    const stopped = await profiler.stop(started.profileId);
    expect(stopped.interruptions[0]?.kind).toBe('render-warmup-timeout');
    expect(holds.size).toBe(0);
  });

  test('keeps the warm-up inside the command budget', async () => {
    vi.useFakeTimers();
    const abortActiveOperation = vi.fn(async () => {});
    const coordinator = new ManagedBrowserCommandCoordinator(
      abortActiveOperation,
    );
    const { frame } = holdFrame({
      requestRender: () => new Promise<void>(() => {}),
    });
    const profiler = await createProfiler(frame, coordinator);

    // 7 s of active time, less the 5 s kept for the rest of the start,
    // leaves 2 s for the warm-up, and the command finishes in time.
    const start = coordinator.runExclusive(
      () =>
        profiler.start({
          action: 'start',
          mode: 'rendering',
          maxDurationMs: 60_000,
        }),
      7_000,
    );
    await vi.advanceTimersByTimeAsync(7_000);
    const started = await start;

    expect(warmupRequest(frame)).toEqual({ frames: 3, timeoutMs: 2_000 });
    expect(started.interruptions).toEqual([
      expect.objectContaining({ kind: 'render-warmup-timeout' }),
    ]);
    expect(abortActiveOperation).not.toHaveBeenCalled();

    await coordinator.runExclusive(() => profiler.stop(started.profileId));
  });

  test('skips the warm-up, and says why, when too little command time is left for it', async () => {
    vi.useFakeTimers();
    const abortActiveOperation = vi.fn(async () => {});
    const coordinator = new ManagedBrowserCommandCoordinator(
      abortActiveOperation,
    );
    const { calls, frame, holds, runtime } = holdFrame();
    const profiler = await createProfiler(frame, coordinator);
    const start = (activeTimeMs: number) =>
      coordinator.runExclusive(
        () =>
          profiler.start({
            action: 'start',
            mode: 'rendering',
            maxDurationMs: 60_000,
          }),
        activeTimeMs,
      );

    // 5.999 s of active time, less the 5 s kept for the rest of the start,
    // leaves 999 ms, under the 1 s a warm-up gets at least: on SwiftShader
    // the three frames and the one that presents the last take about 0.5 s.
    // It is skipped, though this app would draw the frames at once.
    const skipped = await start(5_999);
    expect(runtime.requestRender).not.toHaveBeenCalled();
    expect(calls).toEqual(['sampling']);
    expect(skipped.interruptions).toEqual([
      {
        at: expect.any(Number),
        kind: 'render-warmup-skipped-budget',
        value:
          "3 warm-up frames skipped: 999ms of the command's time was left for them",
      },
    ]);
    expect([...holds]).toEqual(['hold-1']);
    await coordinator.runExclusive(() => profiler.stop(skipped.profileId));

    // With 1 s left, the warm-up runs.
    const warmed = await start(6_000);
    expect(warmupRequest(frame)).toEqual({ frames: 3, timeoutMs: 1_000 });
    expect(calls).toEqual(['sampling', 'render:3:held=true', 'sampling']);
    expect(warmed.interruptions).toEqual([]);
    expect(abortActiveOperation).not.toHaveBeenCalled();
    await coordinator.runExclusive(() => profiler.stop(warmed.profileId));
  });

  test('reports a render mode it cannot read instead of skipping the warm-up silently', async () => {
    const { calls, frame, holds, runtime } = holdFrame();
    Object.defineProperty(runtime, 'renderMode', {
      get() {
        throw new Error('the world was destroyed');
      },
    });
    const profiler = await createProfiler(frame);

    const started = await profiler.start({
      action: 'start',
      mode: 'rendering',
      maxDurationMs: 60_000,
    });
    expect(calls).toEqual(['sampling']);
    expect(started.interruptions).toEqual([
      {
        at: expect.any(Number),
        kind: 'render-mode-unavailable',
        value:
          "3 warm-up frames skipped: could not read the app's render mode: the world was destroyed",
      },
    ]);
    expect([...holds]).toEqual(['hold-1']);

    const stopped = await profiler.stop(started.profileId);
    expect(stopped.interruptions[0]?.kind).toBe('render-mode-unavailable');
    expect(holds.size).toBe(0);
  });

  test('releases the hold and fails the start when the warm-up request fails', async () => {
    const { frame, holds, pageWindow } = holdFrame({
      requestRender: vi
        .fn()
        .mockRejectedValueOnce(new Error('render loop failed')),
    });
    const profiler = await createProfiler(frame);
    const request = {
      action: 'start',
      mode: 'rendering',
      maxDurationMs: 60_000,
    } as const;

    await expect(profiler.start(request)).rejects.toThrow('render loop failed');
    expect(holds.size).toBe(0);
    expect(pageWindow.__IWSDK_PROFILE_RENDER_HOLD).toBeUndefined();
    expect(profiler.activeDeadline).toBeNull();

    // Nothing was left active, so the next start works.
    const started = await profiler.start(request);
    expect([...holds]).toEqual(['hold-2']);
    await profiler.stop(started.profileId);
    expect(holds.size).toBe(0);
  });

  test('starts the profile clock once the warm-up frames are drawn', async () => {
    vi.useFakeTimers();
    // The first frames take 2 s to draw.
    const { frame } = holdFrame({
      requestRender: () =>
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    });
    const profiler = await createProfiler(frame);

    const start = profiler.start({
      action: 'start',
      mode: 'rendering',
      maxDurationMs: 4_000,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const started = await start;
    expect(started.interruptions).toEqual([]);
    expect(profiler.activeDeadline).toBe(Date.now() + 4_000);

    // Just under 4 s after sampling started (6 s after the request), the
    // profile is still running, and its duration leaves out the warm-up.
    await vi.advanceTimersByTimeAsync(3_999);
    expect(profiler.status().status).toBe('active');
    const stopped = await profiler.stop(started.profileId);
    expect(stopped.durationMs).toBe(3_999);
  });

  test('holds rendering while a profile runs and releases it on stop', async () => {
    const { frame, holds, pageWindow } = holdFrame();
    const profiler = await createProfiler(frame);

    const started = await profiler.start({
      action: 'start',
      maxDurationMs: 60_000,
    });
    expect([...holds]).toEqual(['hold-1']);
    expect(pageWindow.__IWSDK_PROFILE_RENDER_HOLD).toBe('hold-1');

    await profiler.stop(started.profileId);
    expect(holds.size).toBe(0);
    expect(pageWindow.__IWSDK_PROFILE_RENDER_HOLD).toBeUndefined();
  });

  test('replaces a hold left behind by an earlier profile', async () => {
    const { frame, holds, runtime } = holdFrame({ staleHold: 'hold-stale' });
    const profiler = await createProfiler(frame);

    const started = await profiler.start({
      action: 'start',
      maxDurationMs: 60_000,
    });
    expect(runtime.releaseRenderHold).toHaveBeenCalledWith('hold-stale');
    expect([...holds]).toEqual(['hold-1']);

    await profiler.stop(started.profileId);
    expect(holds.size).toBe(0);
  });

  test('releases the hold when starting the profile fails', async () => {
    const { frame, holds } = holdFrame({ failInstall: true });
    const profiler = await createProfiler(frame);

    await expect(
      profiler.start({ action: 'start', maxDurationMs: 60_000 }),
    ).rejects.toThrow('profile instrumentation failed');
    expect(holds.size).toBe(0);
  });
});
