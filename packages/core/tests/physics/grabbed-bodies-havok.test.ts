/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { Grabbed } from '../../src/grab/grabbed.js';
import { PhysicsBody, PhysicsState } from '../../src/physics/physicsBody.js';
import { PhysicsShapeType } from '../../src/physics/physicsShape.js';
import { Object3D } from '../../src/runtime/three.js';
import { createRealHavokWorld } from './real-havok.js';

vi.mock('@babylonjs/havok', async (importOriginal) =>
  (await import('./real-havok.js')).withLocalHavokWasm(await importOriginal()),
);

const BOX = { shape: PhysicsShapeType.Box, dimensions: [0.2, 0.2, 0.2] };

async function grabNextToStack() {
  const physics = await createRealHavokWorld();
  physics.addBody(
    new Object3D(),
    { shape: PhysicsShapeType.Box, dimensions: [10, 0.2, 10] },
    { state: PhysicsState.Static },
  );
  const neighbours = [0, 1, 2].map((level) => {
    const object3D = new Object3D();
    object3D.position.set(0.25, 0.2 + level * 0.21, 0);
    physics.addBody(object3D, BOX, { state: PhysicsState.Dynamic });
    return object3D;
  });
  const held = new Object3D();
  held.position.set(0, 0.2, 0);
  const heldEntity = physics.addBody(held, BOX, {
    state: PhysicsState.Dynamic,
  });
  // Let the stack settle before grabbing.
  await physics.run(60, 1 / 60);
  return { physics, neighbours, held, heldEntity };
}

describe('grabbed dynamic bodies (real Havok)', () => {
  it('does not fling neighbours when frames run several substeps', async () => {
    const { physics, neighbours, held, heldEntity } = await grabNextToStack();
    heldEntity.addComponent(Grabbed);

    // 15 fps frames run four substeps each, the case that overshot the hand
    // and launched neighbours kilometres away (T296694541).
    await physics.run(45, 1 / 15, (frame) => {
      held.position.set(Math.sin(frame * 0.6) * 0.3, 0.3, 0);
    });

    for (const neighbour of neighbours) {
      expect(neighbour.position.length()).toBeLessThan(3);
      expect(neighbour.position.y).toBeGreaterThan(0);
    }
  });

  it('releases with a capped velocity after a hand teleport', async () => {
    const { physics, held, heldEntity } = await grabNextToStack();
    heldEntity.addComponent(Grabbed);
    await physics.run(10, 1 / 72, (frame) => {
      held.position.set(0, 0.5, frame * 0.02);
    });
    // An emulator-style controller jump of 5 m in one frame.
    held.position.set(0, 0.5, 5);
    await physics.run(1, 1 / 72);
    heldEntity.removeComponent(Grabbed);
    // The release frame reports the velocity handed to the engine, before
    // gravity acts on it.
    await physics.run(1, 1 / 72);

    const velocity = heldEntity.getVectorView(PhysicsBody, '_linearVelocity');
    expect(
      Math.hypot(velocity[0], velocity[1], velocity[2]),
    ).toBeLessThanOrEqual(10 + 1e-4);
  });
});
