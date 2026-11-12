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
  vi.restoreAllMocks();
});

/**
 * A frame whose render-hold page functions run against a fake runtime. The
 * profile's own page instrumentation needs a real browser, so it is stubbed:
 * it resolves, or rejects when `failInstall` is set.
 */
function holdFrame(
  options: { failInstall?: boolean; staleHold?: string } = {},
) {
  const holds = new Set<string>(options.staleHold ? [options.staleHold] : []);
  let next = 0;
  const runtime = {
    acquireRenderHold: vi.fn(() => {
      const id = `hold-${++next}`;
      holds.add(id);
      return id;
    }),
    releaseRenderHold: vi.fn((id: string) => holds.delete(id)),
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
      if (
        source.includes('acquireRenderHold') ||
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
      if (options.failInstall && source.includes('__IWSDK_BROWSER_PROFILE')) {
        throw new Error('profile instrumentation failed');
      }
      return undefined;
    }),
  };
  return { frame, holds, pageWindow, runtime };
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

describe('BrowserProfiler render hold', () => {
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
