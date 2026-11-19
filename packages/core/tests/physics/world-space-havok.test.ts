/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { Grabbed } from '../../src/grab/grabbed.js';
import { PhysicsState } from '../../src/physics/physicsBody.js';
import { PhysicsShapeType } from '../../src/physics/physicsShape.js';
import { Group, Object3D, Vector3 } from '../../src/runtime/three.js';
import { createRealHavokWorld } from './real-havok.js';

vi.mock('@babylonjs/havok', async (importOriginal) =>
  (await import('./real-havok.js')).withLocalHavokWasm(await importOriginal()),
);

const FLOOR = { shape: PhysicsShapeType.Box, dimensions: [10, 0.2, 10] };
const BOX = { shape: PhysicsShapeType.Box, dimensions: [0.2, 0.2, 0.2] };

function worldPosition(object3D: Object3D): Vector3 {
  object3D.updateWorldMatrix(true, false);
  return object3D.getWorldPosition(new Vector3());
}

/** A level root moved 5 m up, 3 m along x and turned 90° about y. */
function movedParent(): Group {
  const parent = new Group();
  parent.position.set(3, 5, 0);
  parent.rotation.y = Math.PI / 2;
  return parent;
}

describe('bodies under a transformed parent (real Havok)', () => {
  it('fall onto a world-space floor instead of floating at the parent offset', async () => {
    const physics = await createRealHavokWorld();
    physics.addBody(new Object3D(), FLOOR, { state: PhysicsState.Static });
    const parent = movedParent();
    const child = new Object3D();
    child.position.set(1, -4, 0); // world (3, 1, -1)
    parent.add(child);
    physics.addBody(child, BOX, { state: PhysicsState.Dynamic });

    await physics.run(120, 1 / 60);

    // Before the fix the child came to rest at world y = 5.2.
    const rest = worldPosition(child);
    expect(rest.y).toBeCloseTo(0.2, 1);
    expect(rest.x).toBeCloseTo(3, 2);
    expect(rest.z).toBeCloseTo(-1, 2);
  });

  it('teleports in either space with setBodyTransform', async () => {
    const physics = await createRealHavokWorld();
    const parent = movedParent();
    const child = new Object3D();
    parent.add(child);
    const entity = physics.addBody(child, BOX, {
      state: PhysicsState.Dynamic,
      gravityFactor: 0,
    });
    await physics.run(2, 1 / 60);

    physics.system.setBodyTransform(
      entity,
      { position: [0, 1, 2], quaternion: [0, 0, 0, 1] },
      { space: 'world' },
    );
    await physics.run(3, 1 / 60);
    expect(worldPosition(child).toArray()).toEqual([
      expect.closeTo(0, 3),
      expect.closeTo(1, 3),
      expect.closeTo(2, 3),
    ]);

    // Local is the default: (1, 0, 0) under the parent is world (3, 5, -1).
    physics.system.setBodyTransform(entity, {
      position: [1, 0, 0],
      quaternion: [0, 0, 0, 1],
    });
    await physics.run(3, 1 / 60);
    expect(worldPosition(child).toArray()).toEqual([
      expect.closeTo(3, 3),
      expect.closeTo(5, 3),
      expect.closeTo(-1, 3),
    ]);
  });

  it('follows a grabbing hand in world space and releases where it was held', async () => {
    const physics = await createRealHavokWorld();
    const parent = movedParent();
    const child = new Object3D();
    parent.add(child);
    const entity = physics.addBody(child, BOX, {
      state: PhysicsState.Dynamic,
      gravityFactor: 0,
    });
    await physics.run(2, 1 / 60);

    entity.addComponent(Grabbed);
    await physics.run(30, 1 / 60, (frame) => {
      child.position.set(0, 0, frame * 0.01); // local +z is world +x under the parent
    });
    const held = worldPosition(child);
    entity.removeComponent(Grabbed);
    await physics.run(2, 1 / 60);

    // Released from the hand's pose, still moving the hand's way (world +x).
    const released = worldPosition(child);
    expect(released.distanceTo(held)).toBeLessThan(0.05);
    expect(released.x).toBeGreaterThan(held.x);
  });
});
