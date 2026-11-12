/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { expect, test, vi } from 'vitest';
import { MCPRuntime } from '../../src/mcp/mcp-runtime.js';

function fakeWorld() {
  let holds = 0;
  return {
    update() {},
    renderMode: 'on-demand',
    drawnFrames: 0,
    requestRender: vi.fn(async () => {}),
    holdRender: vi.fn(() => {
      holds++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          holds--;
        }
      };
    }),
    get holds() {
      return holds;
    },
  };
}

test('render holds are addressed by id and released once', () => {
  const world = fakeWorld();
  const runtime = new MCPRuntime(world as any);
  const capture = runtime.acquireRenderHold();
  const profile = runtime.acquireRenderHold();
  expect(capture).not.toBe(profile);
  expect(world.holds).toBe(2);

  expect(runtime.releaseRenderHold(capture)).toBe(true);
  expect(runtime.releaseRenderHold(capture)).toBe(false);
  expect(runtime.releaseRenderHold('render-hold-unknown')).toBe(false);
  expect(world.holds).toBe(1);

  expect(runtime.releaseRenderHold(profile)).toBe(true);
  expect(world.holds).toBe(0);
});

test('reports the world render mode and drawn frames, and forwards render requests', async () => {
  const world = fakeWorld();
  const runtime = new MCPRuntime(world as any);
  expect(runtime.renderMode).toBe('on-demand');
  expect(runtime.drawnFrames).toBe(0);
  world.drawnFrames = 3;
  expect(runtime.drawnFrames).toBe(3);
  await runtime.requestRender(2);
  expect(world.requestRender).toHaveBeenCalledWith(2);
});

test('reports whether ecs_pause is in effect', async () => {
  const world = { ...fakeWorld(), getSystems: () => [] };
  const runtime = new MCPRuntime(world as any);
  expect(runtime.ecsPaused).toBe(false);
  await runtime.dispatch('ecs_pause', {});
  expect(runtime.ecsPaused).toBe(true);
  await runtime.dispatch('ecs_resume', {});
  expect(runtime.ecsPaused).toBe(false);
});
