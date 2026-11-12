/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { World } from '../../src/ecs/world.js';
import { DEBUG_SYNC_TIMEOUT_MS } from '../../src/mcp/ecs-debug-tools.js';
import { MCPRuntime } from '../../src/mcp/mcp-runtime.js';

const order: string[] = [];
vi.mock('../../src/mcp/scene-tools.js', async () => ({
  ...(await vi.importActual('../../src/mcp/scene-tools.js')),
  getRenderStats: vi.fn(() => {
    order.push('stats');
    return { calls: 1 };
  }),
}));

// world.ts -> @iwsdk/xr-input -> cursor-visual.ts touches `document` at module
// load; provide a minimal canvas stub before importing.
vi.hoisted(() => {
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => ({
        arc: () => {},
        beginPath: () => {},
        clearRect: () => {},
        fill: () => {},
        fillStyle: '',
        lineWidth: 0,
        stroke: () => {},
        strokeStyle: '',
      }),
      height: 0,
      width: 0,
    }),
  };
});

afterEach(() => {
  order.length = 0;
  vi.useRealTimers();
});

describe('get_render_stats', () => {
  test('waits for a drawn frame before reading stats in on-demand mode', async () => {
    const world = new World();
    world.renderMode = 'on-demand';
    const runtime = new MCPRuntime(world);
    const pending = runtime.dispatch('get_render_stats', {}).then((r) => {
      order.push('resolved');
      return r;
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    // Tick 1 draws the requested frame; tick 2 releases the waiter.
    expect(world.beginRenderTick()).toBe(true);
    order.push('drawn');
    world.beginRenderTick();
    await expect(pending).resolves.toEqual({ calls: 1 });
    expect(order).toEqual(['drawn', 'stats', 'resolved']);
  });

  test('reads stats immediately in continuous mode', async () => {
    const runtime = new MCPRuntime(new World());
    await expect(runtime.dispatch('get_render_stats', {})).resolves.toEqual({
      calls: 1,
    });
  });

  test('fails with a clear error when the render loop is not running', async () => {
    vi.useFakeTimers();
    const world = new World();
    world.renderMode = 'on-demand';
    const runtime = new MCPRuntime(world);
    const pending = expect(
      runtime.dispatch('get_render_stats', {}),
    ).rejects.toThrow('the render loop may not be running');
    await vi.advanceTimersByTimeAsync(DEBUG_SYNC_TIMEOUT_MS);
    await pending;
    expect(order).toEqual([]);
  });
});

describe('render holds on a real world', () => {
  test('id-addressed holds use the world counting', () => {
    const world = new World();
    world.renderMode = 'on-demand';
    const runtime = new MCPRuntime(world);
    const a = runtime.acquireRenderHold();
    const b = runtime.acquireRenderHold();
    expect(world.beginRenderTick()).toBe(true);
    runtime.releaseRenderHold(a);
    runtime.releaseRenderHold(a);
    expect(world.beginRenderTick()).toBe(true);
    runtime.releaseRenderHold(b);
    expect(world.beginRenderTick()).toBe(false);
  });
});
