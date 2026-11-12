/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  applicationKeepsDrawnFrames,
  captureFreshApplicationFrame,
  createRenderHoldTracker,
  readApplicationRenderMode,
  requestApplicationRender,
  resolveManagedRenderMode,
  withApplicationRenderHold,
} from '../src/managed-browser/render-mode.js';

/** A Playwright-like frame that runs page functions against `pageWindow`. */
function fakeFrame(pageWindow: Record<string, unknown>) {
  return {
    evaluate: vi.fn(async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
      const previous = (globalThis as any).window;
      (globalThis as any).window = pageWindow;
      try {
        return await fn(arg);
      } finally {
        (globalThis as any).window = previous;
      }
    }),
  } as any;
}

function fakeRuntime() {
  const holds = new Set<string>();
  let next = 0;
  return {
    holds,
    renderMode: 'on-demand',
    requestRender: vi.fn(async () => {}),
    acquireRenderHold: vi.fn(() => {
      const id = `hold-${++next}`;
      holds.add(id);
      return id;
    }),
    releaseRenderHold: vi.fn((id: string) => holds.delete(id)),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveManagedRenderMode', () => {
  test('headless sessions render on demand unless overridden', () => {
    expect(resolveManagedRenderMode(true, undefined)).toBe('on-demand');
    expect(resolveManagedRenderMode(true, 'on-demand')).toBe('on-demand');
    expect(resolveManagedRenderMode(true, 'continuous')).toBe('continuous');
  });

  test('accepts the override case-insensitively and with whitespace', () => {
    expect(resolveManagedRenderMode(true, ' Continuous ')).toBe('continuous');
    expect(resolveManagedRenderMode(true, 'ON-DEMAND')).toBe('on-demand');
    expect(resolveManagedRenderMode(true, '')).toBe('on-demand');
  });

  test('warns once about an unknown override and keeps the headless default', () => {
    const warn = vi.fn();
    expect(resolveManagedRenderMode(true, 'off', warn)).toBe('on-demand');
    expect(resolveManagedRenderMode(true, 'OFF', warn)).toBe('on-demand');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('IWSDK_DEV_RENDER_MODE');
  });

  test('headed sessions always render continuously', () => {
    expect(resolveManagedRenderMode(false, undefined)).toBe('continuous');
    expect(resolveManagedRenderMode(false, 'on-demand')).toBe('continuous');
  });
});

describe('render holds', () => {
  test('hold for the duration of the work and release afterwards', async () => {
    const runtime = fakeRuntime();
    const frame = fakeFrame({ FRAMEWORK_MCP_RUNTIME: runtime });
    const result = await withApplicationRenderHold(frame, async () => {
      expect(runtime.holds.size).toBe(1);
      return 'captured';
    });
    expect(result).toBe('captured');
    expect(runtime.holds.size).toBe(0);
  });

  test('release the hold when the work fails', async () => {
    const runtime = fakeRuntime();
    const frame = fakeFrame({ FRAMEWORK_MCP_RUNTIME: runtime });
    await expect(
      withApplicationRenderHold(frame, async () => {
        throw new Error('capture failed');
      }),
    ).rejects.toThrow('capture failed');
    expect(runtime.holds.size).toBe(0);
  });

  test('overlapping holds do not end each other', async () => {
    const runtime = fakeRuntime();
    const frame = fakeFrame({ FRAMEWORK_MCP_RUNTIME: runtime });
    await withApplicationRenderHold(frame, async () => {
      await withApplicationRenderHold(frame, async () => {
        expect(runtime.holds.size).toBe(2);
      });
      expect(runtime.holds.size).toBe(1);
    });
    expect(runtime.holds.size).toBe(0);
  });

  test('apps without render holds run the work unchanged', async () => {
    const frame = fakeFrame({});
    await expect(
      withApplicationRenderHold(frame, async () => 'ok'),
    ).resolves.toBe('ok');
  });
});

describe('page probes', () => {
  test('request fresh frames from apps that support it', async () => {
    const runtime = fakeRuntime();
    await requestApplicationRender(
      fakeFrame({ FRAMEWORK_MCP_RUNTIME: runtime }),
      2,
    );
    expect(runtime.requestRender).toHaveBeenCalledWith(2);
    await expect(
      requestApplicationRender(fakeFrame({})),
    ).resolves.toBeUndefined();
  });

  test('report the render mode and whether drawn frames persist', async () => {
    const runtime = fakeRuntime();
    expect(
      await readApplicationRenderMode(
        fakeFrame({ FRAMEWORK_MCP_RUNTIME: runtime }),
      ),
    ).toBe('on-demand');
    expect(await readApplicationRenderMode(fakeFrame({}))).toBeNull();
    expect(
      await applicationKeepsDrawnFrames(
        fakeFrame({ __IWSDK_KEEPS_DRAWN_FRAMES: true }),
      ),
    ).toBe(true);
    expect(await applicationKeepsDrawnFrames(fakeFrame({}))).toBe(false);
  });
});

describe('createRenderHoldTracker', () => {
  test('retries while the runtime is not ready, then keeps one hold', async () => {
    const pageWindow: Record<string, unknown> = {};
    const frame = fakeFrame(pageWindow);
    const tracker = createRenderHoldTracker();

    await tracker.ensure(frame); // runtime not booted yet: no hold
    const runtime = fakeRuntime();
    pageWindow.FRAMEWORK_MCP_RUNTIME = runtime;
    await tracker.ensure(frame);
    await tracker.ensure(frame);
    expect(runtime.acquireRenderHold).toHaveBeenCalledOnce();
    expect(runtime.holds.size).toBe(1);

    await tracker.release();
    expect(runtime.holds.size).toBe(0);
  });

  test('takes a new hold when the frame changes after a reload', async () => {
    const before = fakeRuntime();
    const after = fakeRuntime();
    const tracker = createRenderHoldTracker();
    await tracker.ensure(fakeFrame({ FRAMEWORK_MCP_RUNTIME: before }));
    await tracker.ensure(fakeFrame({ FRAMEWORK_MCP_RUNTIME: after }));
    expect(before.holds.size).toBe(0);
    expect(after.holds.size).toBe(1);
    await tracker.release();
    expect(after.holds.size).toBe(0);
  });

  test('treats a failing acquisition as no hold and release never throws', async () => {
    const frame = {
      evaluate: vi.fn().mockRejectedValue(new Error('gone')),
    } as any;
    const tracker = createRenderHoldTracker();
    await expect(tracker.ensure(frame)).resolves.toBeUndefined();
    await expect(tracker.release()).resolves.toBeUndefined();
    await expect(tracker.release()).resolves.toBeUndefined();
  });
});

describe('captureFreshApplicationFrame', () => {
  test('requests one frame and captures when drawn frames persist', async () => {
    const runtime = fakeRuntime();
    const frame = fakeFrame({
      FRAMEWORK_MCP_RUNTIME: runtime,
      __IWSDK_KEEPS_DRAWN_FRAMES: true,
    });
    const capture = vi.fn(async () => {
      expect(runtime.holds.size).toBe(0);
      return 'png';
    });
    await expect(
      captureFreshApplicationFrame(frame, 30_000, capture),
    ).resolves.toBe('png');
    expect(runtime.requestRender).toHaveBeenCalledWith(1);
    expect(runtime.acquireRenderHold).not.toHaveBeenCalled();
    expect(capture.mock.calls[0][0]).toBeGreaterThan(0);
  });

  test('holds rendering for the whole capture when the emulator clears frames', async () => {
    const runtime = fakeRuntime();
    const frame = fakeFrame({ FRAMEWORK_MCP_RUNTIME: runtime });
    const capture = vi.fn(async () => {
      expect(runtime.holds.size).toBe(1);
      return 'png';
    });
    await captureFreshApplicationFrame(frame, 30_000, capture);
    expect(runtime.requestRender).toHaveBeenCalledWith(1);
    expect(runtime.holds.size).toBe(0);
  });

  test('releases the hold when the capture fails', async () => {
    const runtime = fakeRuntime();
    const frame = fakeFrame({ FRAMEWORK_MCP_RUNTIME: runtime });
    await expect(
      captureFreshApplicationFrame(frame, 30_000, async () => {
        throw new Error('capture failed');
      }),
    ).rejects.toThrow('capture failed');
    expect(runtime.holds.size).toBe(0);
  });

  test('gives the render request a bounded share of the timeout', async () => {
    const frame = fakeFrame({ FRAMEWORK_MCP_RUNTIME: fakeRuntime() });
    await captureFreshApplicationFrame(frame, 60_000, async () => 'png');
    const renderRequest = frame.evaluate.mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === 'object' &&
        call[1] != null &&
        'timeoutMs' in call[1],
    );
    expect(renderRequest?.[1]).toMatchObject({ frames: 1, timeoutMs: 10_000 });
  });
});
