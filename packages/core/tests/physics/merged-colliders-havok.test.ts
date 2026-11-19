/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { PhysicsBody, PhysicsState } from '../../src/physics/physicsBody.js';
import { PhysicsShapeType } from '../../src/physics/physicsShape.js';
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Object3D,
} from '../../src/runtime/three.js';
import { createRealHavokWorld } from './real-havok.js';

vi.mock('@babylonjs/havok', async (importOriginal) =>
  (await import('./real-havok.js')).withLocalHavokWasm(await importOriginal()),
);

const FLOOR = { shape: PhysicsShapeType.Box, dimensions: [10, 0.2, 10] };

/** A glTF-like model: two meshes whose attribute sets differ. */
function mixedAttributeModel(): Group {
  const model = new Group();
  model.add(new Mesh(new BoxGeometry(0.4, 0.4, 0.4)));
  const colored = new BoxGeometry(0.4, 0.4, 0.4).translate(0.4, 0, 0);
  colored.deleteAttribute('uv');
  colored.setAttribute(
    'color',
    new Float32BufferAttribute(
      new Float32Array(colored.attributes.position.count * 3),
      3,
    ),
  );
  model.add(new Mesh(colored));
  return model;
}

describe('merged colliders (real Havok)', () => {
  it('builds a body for a model whose meshes have different attributes', async () => {
    const physics = await createRealHavokWorld();
    physics.addBody(new Object3D(), FLOOR, { state: PhysicsState.Static });
    const model = mixedAttributeModel();
    model.position.set(0, 2, 0);
    const entity = physics.addBody(
      model,
      { shape: PhysicsShapeType.Auto },
      { state: PhysicsState.Dynamic },
    );

    await physics.run(120, 1 / 60);

    expect(entity.getValue(PhysicsBody, '_engineBody')).not.toBe(0);
    // Floor top at 0.1, box half-height 0.2.
    expect(model.position.y).toBeCloseTo(0.3, 1);
  });

  it('keeps simulating other bodies when one collider cannot be built', async () => {
    const physics = await createRealHavokWorld();
    physics.addBody(new Object3D(), FLOOR, { state: PhysicsState.Static });
    const broken = new Mesh(new BufferGeometry());
    const brokenEntity = physics.addBody(
      broken,
      { shape: PhysicsShapeType.ConvexHull },
      { state: PhysicsState.Dynamic },
    );
    vi.spyOn(broken.geometry, 'attributes', 'get').mockImplementation(() => {
      throw new Error('corrupt geometry');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const healthy = new Object3D();
    healthy.position.set(0, 1, 0);
    physics.addBody(
      healthy,
      { shape: PhysicsShapeType.Box, dimensions: [0.2, 0.2, 0.2] },
      { state: PhysicsState.Dynamic },
    );

    await physics.run(90, 1 / 60);

    expect(brokenEntity.getValue(PhysicsBody, '_engineBody')).toBe(0);
    expect(healthy.position.y).toBeCloseTo(0.2, 1);
    // Reported once, not every frame.
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
