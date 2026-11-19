/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhysicsState } from '../../src/physics/physicsBody.js';
import { PhysicsShapeType } from '../../src/physics/physicsShape.js';
import {
  BoxGeometry,
  BufferGeometry,
  Group,
  IcosahedronGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Object3D,
  SphereGeometry,
} from '../../src/runtime/three.js';
import { createRealHavokWorld } from './real-havok.js';

vi.mock('@babylonjs/havok', async (importOriginal) =>
  (await import('./real-havok.js')).withLocalHavokWasm(await importOriginal()),
);

const FLOOR = { shape: PhysicsShapeType.Box, dimensions: [10, 0.2, 10] };
const FLOOR_TOP = 0.1;

/** Drops `object3D` from 3 m and returns the height it comes to rest at. */
async function restingHeight(
  object3D: Object3D,
  shape: Record<string, unknown>,
  config: { applyScale?: boolean } = {},
): Promise<number> {
  const physics = await createRealHavokWorld(config);
  physics.addBody(new Object3D(), FLOOR, { state: PhysicsState.Static });
  object3D.position.set(0, 3, 0);
  physics.addBody(object3D, shape, {
    state: PhysicsState.Dynamic,
    angularDamping: 5,
  });
  await physics.run(180, 1 / 60);
  return object3D.position.y;
}

function scaledBox(scale: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1));
  mesh.scale.setScalar(scale);
  return mesh;
}

describe('scaled shapes (real Havok)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applies world scale to an Auto box', async () => {
    // Before the fix the 2 m visual got a 1 m collider and sank to 0.6.
    expect(await restingHeight(scaledBox(2), { shape: 'Auto' })).toBeCloseTo(
      FLOOR_TOP + 1,
      1,
    );
  });

  it('applies the largest axis to an Auto sphere', async () => {
    const mesh = new Mesh(new SphereGeometry(0.5));
    mesh.scale.set(0.5, 0.4, 0.3);
    expect(await restingHeight(mesh, { shape: 'Auto' })).toBeCloseTo(
      FLOOR_TOP + 0.25,
      1,
    );
  });

  it('applies world scale to a mesh convex hull', async () => {
    const mesh = new Mesh(new IcosahedronGeometry(0.5, 0));
    mesh.scale.setScalar(2);
    const height = await restingHeight(mesh, {
      shape: PhysicsShapeType.ConvexHull,
    });
    // An icosahedron of circumradius 1 rests between 0.79 and 1 above the floor.
    expect(height).toBeGreaterThan(FLOOR_TOP + 0.75);
    expect(height).toBeLessThan(FLOOR_TOP + 1.01);
  });

  it('reads interleaved positions for a mesh convex hull', async () => {
    const box = new BoxGeometry(0.4, 0.4, 0.4).toNonIndexed();
    const source = box.attributes.position;
    const data = new Float32Array(source.count * 4);
    for (let i = 0; i < source.count; i++) {
      data.set([source.getX(i), source.getY(i), source.getZ(i), 7], i * 4);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new InterleavedBufferAttribute(new InterleavedBuffer(data, 4), 3, 0),
    );
    expect(
      await restingHeight(new Mesh(geometry), {
        shape: PhysicsShapeType.ConvexHull,
      }),
    ).toBeCloseTo(FLOOR_TOP + 0.2, 1);
  });

  it('scales a merged model once', async () => {
    const model = new Group().add(new Mesh(new BoxGeometry(0.5, 0.5, 0.5)));
    model.scale.setScalar(2);
    expect(await restingHeight(model, { shape: 'Auto' })).toBeCloseTo(
      FLOOR_TOP + 0.5,
      1,
    );
  });

  it('keeps explicit dimensions unscaled by default and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const height = await restingHeight(scaledBox(2), {
      shape: PhysicsShapeType.Box,
      dimensions: [1, 1, 1],
    });
    expect(height).toBeCloseTo(FLOOR_TOP + 0.5, 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('applyScale');
  });

  it('scales explicit dimensions with applyScale', async () => {
    const height = await restingHeight(
      scaledBox(2),
      { shape: PhysicsShapeType.Box, dimensions: [1, 1, 1] },
      { applyScale: true },
    );
    expect(height).toBeCloseTo(FLOOR_TOP + 1, 1);
  });
});
