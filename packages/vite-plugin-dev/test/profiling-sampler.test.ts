/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ManagedBrowserCommandCoordinator } from '../src/managed-browser/command-lock.js';
import { readEnvironmentDescriptor } from '../src/managed-browser/page-probes.js';

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
  vi.restoreAllMocks();
});

interface TimingEntry {
  duration: number;
  entryType: 'event' | 'longtask';
  startTime: number;
}

/**
 * A page for the profile's own instrumentation. Page functions are
 * serialized and run in a separate context, as Playwright runs them, against
 * fake timing APIs and, when given, an app `runtime`. `report` delivers a
 * performance entry the way the browser does: to current observers, and
 * later to observers that ask for buffered entries. `animationFrame` runs
 * the pending animation frame callback 16 ms later.
 */
function profilePage(runtime?: object) {
  let now = 0;
  let nextFrame: ((timestamp: number) => void) | null = null;
  const timeline: TimingEntry[] = [];
  const observers = new Set<FakePerformanceObserver>();
  class FakePerformanceObserver {
    static supportedEntryTypes = ['event', 'longtask'];
    type: string | null = null;
    constructor(
      private readonly callback: (list: {
        getEntries(): TimingEntry[];
      }) => void,
    ) {}
    observe(options: { buffered?: boolean; type: string }) {
      this.type = options.type;
      observers.add(this);
      if (options.buffered) {
        this.deliver(
          timeline.filter((entry) => entry.entryType === options.type),
        );
      }
    }
    disconnect() {
      observers.delete(this);
    }
    deliver(entries: TimingEntry[]) {
      if (entries.length > 0) {
        this.callback({ getEntries: () => entries });
      }
    }
  }
  const context = createContext({
    ...(runtime == null ? {} : { FRAMEWORK_MCP_RUNTIME: runtime }),
    PerformanceObserver: FakePerformanceObserver,
    cancelAnimationFrame: () => {
      nextFrame = null;
    },
    document: {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: 'visible',
    },
    performance: {
      clearMarks: () => {},
      getEntriesByType: () => [],
      mark: () => {},
      now: () => now,
    },
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      nextFrame = callback;
      return 1;
    },
  });
  runInContext('globalThis.window = globalThis;', context);
  const frame = {
    evaluate: vi.fn(async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
      if (fn === readEnvironmentDescriptor) {
        return {
          canvas: null,
          canvasIndex: null,
          environment: {
            devicePixelRatio: 1,
            gpuRenderer: null,
            gpuVendor: null,
            userAgent: 'test',
          },
        };
      }
      const pageFunction = runInContext(`(${String(fn)})`, context);
      return structuredClone(await pageFunction(arg));
    }),
  };
  return {
    advance(ms: number) {
      now += ms;
    },
    animationFrame() {
      now += 16;
      const callback = nextFrame;
      nextFrame = null;
      callback?.(now);
    },
    frame,
    report(entry: TimingEntry) {
      timeline.push(entry);
      for (const observer of observers) {
        if (observer.type === entry.entryType) {
          observer.deliver([entry]);
        }
      }
    },
  };
}

async function createProfiler(frame: unknown) {
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
    new ManagedBrowserCommandCoordinator(async () => {}),
    (value) => value,
  );
}

describe('BrowserProfiler page sampler', () => {
  test('counts only long tasks and events that start during the profile', async () => {
    const page = profilePage();
    const profiler = await createProfiler(page.frame);

    // The app's first draw and an input event, before the profile.
    page.report({ duration: 1_600, entryType: 'longtask', startTime: 100 });
    page.report({ duration: 200, entryType: 'event', startTime: 150 });
    page.advance(1_000);
    const started = await profiler.start({
      action: 'start',
      mode: 'interaction',
      maxDurationMs: 60_000,
    });
    // Reported after the profile started, but started before it.
    page.report({ duration: 80, entryType: 'longtask', startTime: 990 });
    page.report({ duration: 120, entryType: 'event', startTime: 995 });
    // Work during the profile.
    page.advance(500);
    page.report({ duration: 70, entryType: 'longtask', startTime: 1_200 });
    page.report({ duration: 40, entryType: 'event', startTime: 1_300 });
    const stopped = await profiler.stop(started.profileId);

    expect(stopped.summary?.longTasks).toEqual({
      count: 1,
      totalDurationMs: 70,
    });
    expect(stopped.summary?.eventTiming).toEqual({
      count: 1,
      maxDurationMs: 40,
    });
  });
});

/**
 * An app runtime that holds rendering for the profile and counts the frames
 * it draws; the test decides which frames those are. `onRelease` runs when
 * the profile releases its hold.
 */
function drawingRuntime(onRelease: () => void = () => {}) {
  return {
    acquireRenderHold: () => 'hold-1',
    drawnFrames: 0,
    releaseRenderHold: (id?: string) => {
      if (id != null) {
        onRelease();
      }
      return true;
    },
    renderMode: 'continuous',
  };
}

/**
 * Run animation frames on `page`: for each `[drawn, skipped]` pair, `drawn`
 * frames in which the app draws, then `skipped` in which it draws nothing
 * while the page goes on running animation frames.
 */
function runFrames(
  page: ReturnType<typeof profilePage>,
  runtime: { drawnFrames: number },
  runs: Array<[drawn: number, skipped: number]>,
) {
  for (const [drawn, skipped] of runs) {
    for (let i = 0; i < drawn; i++) {
      runtime.drawnFrames += 1;
      page.animationFrame();
    }
    for (let i = 0; i < skipped; i++) {
      page.animationFrame();
    }
  }
}

describe('BrowserProfiler drawn frames', () => {
  test.each<[string, Array<[number, number]>, number]>([
    // An uncaught error stops the render loop for good.
    ['stops drawing after drawing for a while', [[20, 30]], 30],
    ['stops drawing from the start', [[0, 30]], 30],
    // The longest run counts, not the one the profile ends with.
    [
      'stalls, then draws again before the profile stops',
      [
        [20, 30],
        [20, 0],
      ],
      30,
    ],
    [
      'stalls twice, the first time for longer',
      [
        [10, 45],
        [5, 31],
      ],
      45,
    ],
  ])('reports an app that %s', async (_description, runs, longest) => {
    const runtime = drawingRuntime();
    const page = profilePage(runtime);
    const profiler = await createProfiler(page.frame);

    const started = await profiler.start({
      action: 'start',
      mode: 'rendering',
      maxDurationMs: 60_000,
    });
    // Under the profile's hold a healthy app draws every frame.
    runFrames(page, runtime, runs);
    const stopped = await profiler.stop(started.profileId);

    expect(stopped.interruptions).toEqual([
      {
        at: expect.any(Number),
        kind: 'render-loop-stopped',
        value: `the app drew nothing for ${longest} animation frames in a row while the profile held rendering`,
      },
    ]);
  });

  test.each([
    // Entering or leaving XR skips a frame or two.
    ['skips two frames', 2],
    ['stalls for 29 frames', 29],
  ])(
    'does not report an app that %s, then draws until the profile releases its hold',
    async (_description, skipped) => {
      let page!: ReturnType<typeof profilePage>;
      // Released, an app that renders on demand stops drawing, while the
      // sampler runs on until the samples are read. Those frames don't count.
      const runtime = drawingRuntime(() => {
        for (let i = 0; i < 40; i++) {
          page.animationFrame();
        }
      });
      page = profilePage(runtime);
      const profiler = await createProfiler(page.frame);

      const started = await profiler.start({
        action: 'start',
        mode: 'rendering',
        maxDurationMs: 60_000,
      });
      runFrames(page, runtime, [
        [20, skipped],
        [20, 0],
      ]);
      const stopped = await profiler.stop(started.profileId);

      expect(stopped.interruptions).toEqual([]);
      // Every animation frame but the first gives a sample, including the 40
      // after the hold was released.
      expect(stopped.summary?.frameTimeMs.sampleCount).toBe(
        20 + skipped + 20 + 40 - 1,
      );
    },
  );
});
