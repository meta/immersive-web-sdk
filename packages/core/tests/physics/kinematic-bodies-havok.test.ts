/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { PhysicsState } from '../../src/physics/physicsBody.js';
import { PhysicsManipulation } from '../../src/physics/physicsManipulation.js';
import { PhysicsShapeType } from '../../src/physics/physicsShape.js';
import { Object3D } from '../../src/runtime/three.js';
import { createRealHavokWorld } from './real-havok.js';

vi.mock('@babylonjs/havok', async (importOriginal) =>
  (await import('./real-havok.js')).withLocalHavokWasm(await importOriginal()),
);

const PLATFORM = { shape: PhysicsShapeType.Box, dimensions: [3, 0.2, 3] };
const BOX = { shape: PhysicsShapeType.Box, dimensions: [0.2, 0.2, 0.2] };

/** The moving-platform recipe from docs/guides/12-physics.md. */
async function platformWithBox() {
  const physics = await createRealHavokWorld();
  const platform = new Object3D();
  const platformEntity = physics.addBody(platform, PLATFORM, {
    state: PhysicsState.Kinematic,
  });
  const box = new Object3D();
  box.position.set(0, 0.3, 0);
  physics.addBody(box, BOX, { state: PhysicsState.Dynamic });
  await physics.run(30, 1 / 60);
  return { physics, platform, platformEntity, box };
}

describe('kinematic bodies (real Havok)', () => {
  // 90 Hz renders frames that run no physics step at all; 15 Hz renders
  // frames that run four.
  it.each([
    ['60 Hz', 1 / 60],
    ['90 Hz', 1 / 90],
    ['15 Hz', 1 / 15],
  ])(
    'carry a resting body when moved through the Object3D (%s)',
    async (_, delta) => {
      const { physics, platform, box } = await platformWithBox();
      const frames = Math.round(2 / (delta * 60)) * 60;

      // Raise the platform 1.2 m over 2 s.
      await physics.run(frames, delta, (frame) => {
        platform.position.y = (1.2 * (frame + 1)) / frames;
      });

      // Before the fix the platform snapped back to 0 and the box stayed put.
      expect(platform.position.y).toBeCloseTo(1.2, 5);
      expect(box.position.y).toBeCloseTo(1.2 + 0.2, 1);
    },
  );

  it('stays under its mesh after it stops moving', async () => {
    const { physics, platform, box } = await platformWithBox();
    await physics.run(60, 1 / 60, (frame) => {
      platform.position.y = (frame + 1) * 0.02;
    });
    // Stopped. Without settling, the target velocity would carry the
    // collider on upwards, invisibly, and the box with it.
    await physics.run(120, 1 / 60);

    expect(platform.position.y).toBeCloseTo(1.2, 5);
    expect(box.position.y).toBeCloseTo(1.2 + 0.2, 1);
  });

  it('pushes dynamic bodies out of its way', async () => {
    const physics = await createRealHavokWorld();
    physics.addBody(
      new Object3D(),
      { shape: PhysicsShapeType.Box, dimensions: [10, 0.2, 10] },
      { state: PhysicsState.Static },
    );
    const paddle = new Object3D();
    paddle.position.set(-1, 0.3, 0);
    physics.addBody(
      paddle,
      { shape: PhysicsShapeType.Box, dimensions: [0.1, 0.4, 1] },
      { state: PhysicsState.Kinematic },
    );
    const box = new Object3D();
    box.position.set(0, 0.2, 0);
    physics.addBody(box, BOX, { state: PhysicsState.Dynamic });
    await physics.run(20, 1 / 60);

    await physics.run(60, 1 / 60, (frame) => {
      paddle.position.x = -1 + (frame + 1) * 0.03; // ends at x = 0.8
    });

    expect(box.position.x).toBeGreaterThan(0.8);
  });

  it('teleports with setBodyTransform without sweeping', async () => {
    const { physics, platform, platformEntity } = await platformWithBox();
    physics.system.setBodyTransform(platformEntity, {
      position: [5, 0, 0],
      quaternion: [0, 0, 0, 1],
    });
    const dropped = new Object3D();
    dropped.position.set(5, 0.5, 0);
    physics.addBody(dropped, BOX, { state: PhysicsState.Dynamic });
    await physics.run(90, 1 / 60);

    expect(platform.position.x).toBe(5);
    expect(dropped.position.y).toBeCloseTo(0.2, 1);
  });

  it('ignores PhysicsManipulation with one warning', async () => {
    const { physics, platform, platformEntity } = await platformWithBox();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      platformEntity.addComponent(PhysicsManipulation, {
        linearVelocity: [0, 5, 0],
      });
      await physics.run(10, 1 / 60);
    }

    expect(platformEntity.hasComponent(PhysicsManipulation)).toBe(false);
    expect(platform.position.y).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
