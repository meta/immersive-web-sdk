/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { World } from '../../src/ecs/world.js';

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

/** Run `count` render-loop ticks and return which ones drew. */
function ticks(world: World, count: number): boolean[] {
  return Array.from({ length: count }, () => world.beginRenderTick());
}

describe('World render mode', () => {
  it('draws every tick in continuous mode', () => {
    const world = new World();
    expect(world.renderMode).toBe('continuous');
    expect(ticks(world, 3)).toEqual([true, true, true]);
  });

  it('draws nothing in on-demand mode until a render is requested', () => {
    const world = new World();
    world.renderMode = 'on-demand';
    expect(ticks(world, 3)).toEqual([false, false, false]);
  });

  it('draws exactly the requested frames, then resolves on the next tick', async () => {
    const world = new World();
    world.renderMode = 'on-demand';
    let resolved = false;
    const done = world.requestRender(2).then(() => {
      resolved = true;
    });

    expect(world.beginRenderTick()).toBe(true);
    expect(world.beginRenderTick()).toBe(true);
    await Promise.resolve();
    expect(resolved).toBe(false);

    // The tick after the last draw releases the waiter without drawing.
    expect(world.beginRenderTick()).toBe(false);
    await done;
    expect(resolved).toBe(true);
    expect(ticks(world, 2)).toEqual([false, false]);
  });

  it('coalesces overlapping requests and resolves all of them', async () => {
    const world = new World();
    world.renderMode = 'on-demand';
    const first = world.requestRender(1);
    const second = world.requestRender(3);

    expect(ticks(world, 4)).toEqual([true, true, true, false]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it('resolves requests in continuous mode after the frames are drawn', async () => {
    const world = new World();
    const done = world.requestRender();
    expect(ticks(world, 2)).toEqual([true, true]);
    await expect(done).resolves.toBeUndefined();
  });

  it('draws every tick while a hold is open, then returns to on-demand', () => {
    const world = new World();
    world.renderMode = 'on-demand';
    const release = world.holdRender();
    expect(ticks(world, 2)).toEqual([true, true]);
    release();
    expect(ticks(world, 2)).toEqual([false, false]);
  });

  it('counts overlapping holds so one release cannot end another', () => {
    const world = new World();
    world.renderMode = 'on-demand';
    const releaseCapture = world.holdRender();
    const releaseProfile = world.holdRender();
    releaseCapture();
    releaseCapture(); // idempotent
    expect(ticks(world, 1)).toEqual([true]);
    releaseProfile();
    expect(ticks(world, 1)).toEqual([false]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -3, 0, 0.4])(
    'draws one frame for a frame count of %s and keeps working',
    async (frames) => {
      const world = new World();
      world.renderMode = 'on-demand';
      const done = world.requestRender(frames);
      expect(ticks(world, 3)).toEqual([true, false, false]);
      await expect(done).resolves.toBeUndefined();
      // A later request still draws: the bad value left no residue.
      void world.requestRender(2);
      expect(ticks(world, 3)).toEqual([true, true, false]);
    },
  );

  it('floors fractional frame counts', () => {
    const world = new World();
    world.renderMode = 'on-demand';
    void world.requestRender(2.9);
    expect(ticks(world, 3)).toEqual([true, true, false]);
  });

  it('counts the ticks that draw, whatever made them draw', () => {
    const world = new World();
    expect(world.drawnFrames).toBe(0);
    ticks(world, 2); // continuous
    expect(world.drawnFrames).toBe(2);

    world.renderMode = 'on-demand';
    ticks(world, 3);
    expect(world.drawnFrames).toBe(2);

    void world.requestRender(2);
    ticks(world, 3); // two requested draws, then the presenting tick
    expect(world.drawnFrames).toBe(4);

    const release = world.holdRender();
    ticks(world, 1);
    release();
    ticks(world, 1);
    expect(world.drawnFrames).toBe(5);
  });

  it('draws when renderMode holds an unknown value', () => {
    const world = new World();
    (world as { renderMode: string }).renderMode = 'sometimes';
    expect(ticks(world, 2)).toEqual([true, true]);
  });
});
