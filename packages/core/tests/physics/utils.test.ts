/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ContactShadowBinding,
  ShadowCatcherBinding,
  createGroundShadowResources,
} from '../../src/environment/index.js';
import { PhysicsShapeType } from '../../src/physics/physicsShape.js';
import {
  calculateObject3DBounds,
  detectShapeFromGeometry,
  generateMergedGeometry,
  sequentialIndices,
} from '../../src/physics/utils.js';
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Object3D,
  Vector3,
} from '../../src/runtime/three.js';

// physics/utils.ts -> runtime barrel -> xr-input cursor-visual.ts touches
// `document` at module load, so provide a minimal canvas stub before importing.
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

describe('sequentialIndices', () => {
  it('produces 0..n-1 as a Uint32Array', () => {
    const indices = sequentialIndices(6);
    expect(indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('returns an empty array for zero vertices', () => {
    expect(sequentialIndices(0).length).toBe(0);
  });

  it('matches the implicit triangle order of a non-indexed geometry', () => {
    // A non-indexed geometry lists its vertices in triangle order, so the
    // synthesized index buffer must be one entry per vertex.
    const vertexCount = 9; // 3 triangles
    expect(sequentialIndices(vertexCount).length).toBe(vertexCount);
  });
});

describe('generateMergedGeometry', () => {
  it('merges child mesh positions without disposing or changing the sources', () => {
    const root = new Object3D();
    const sourceA = new BoxGeometry(1, 1, 1);
    const sourceB = new BoxGeometry(2, 2, 2);
    root.add(new Mesh(sourceA));
    root.add(new Mesh(sourceB));
    const disposeA = vi.spyOn(sourceA, 'dispose');
    const disposeB = vi.spyOn(sourceB, 'dispose');

    const merged = generateMergedGeometry(root);

    expect(merged.attributes.position.count).toBe(
      sourceA.attributes.position.count + sourceB.attributes.position.count,
    );
    expect(merged.index!.count).toBe(
      sourceA.index!.count + sourceB.index!.count,
    );
    expect(disposeA).not.toHaveBeenCalled();
    expect(disposeB).not.toHaveBeenCalled();
  });

  it('merges meshes whose attribute sets differ (typical glTF)', () => {
    // three's mergeGeometries returns null here, which used to make
    // PhysicsSystem.update throw every frame.
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(1, 1, 1)));
    const bare = new BufferGeometry();
    bare.setAttribute(
      'position',
      new Float32BufferAttribute([0, 2, 0, 1, 2, 0, 0, 3, 0], 3),
    );
    root.add(new Mesh(bare));

    const merged = generateMergedGeometry(root);

    expect(Object.keys(merged.attributes)).toEqual(['position']);
    expect(merged.attributes.position.count).toBe(24 + 3);
    // The non-indexed child gets sequential indices after the box's 24 vertices.
    expect(Array.from(merged.index!.array).slice(-3)).toEqual([24, 25, 26]);
    merged.computeBoundingBox();
    expect(merged.boundingBox!.max.y).toBeCloseTo(3);
  });

  it('keeps world scale, drops the root pose, and leaves matrixWorld alone', () => {
    const root = new Group();
    root.position.set(5, 0, 0);
    root.scale.setScalar(2);
    root.add(new Mesh(new BoxGeometry(1, 1, 1)));
    root.updateMatrixWorld(true);
    const before = root.matrixWorld.clone();

    const merged = generateMergedGeometry(root);

    merged.computeBoundingBox();
    const size = merged.boundingBox!.getSize(new Vector3());
    expect(size.toArray()).toEqual([
      expect.closeTo(2, 6),
      expect.closeTo(2, 6),
      expect.closeTo(2, 6),
    ]);
    expect(merged.boundingBox!.getCenter(new Vector3()).length()).toBeCloseTo(
      0,
    );
    expect(root.matrixWorld.equals(before)).toBe(true);
  });
});

describe('detectShapeFromGeometry', () => {
  it('disposes the merged geometry it builds for a non-Mesh object', () => {
    const root = new Object3D();
    root.add(new Mesh(new BoxGeometry(1, 1, 1)));
    root.add(new Mesh(new BoxGeometry(2, 2, 2)));

    // Count clones (disposed by generateMergedGeometry) and total BufferGeometry
    // disposals. The merged geometry detectShapeFromGeometry builds must also be
    // disposed -> total disposals === clones + 1.
    let cloneCount = 0;
    const realClone = BufferGeometry.prototype.clone;
    const cloneSpy = vi
      .spyOn(BufferGeometry.prototype, 'clone')
      .mockImplementation(function (this: BufferGeometry) {
        cloneCount++;
        return realClone.call(this);
      });
    const disposeSpy = vi.spyOn(BufferGeometry.prototype, 'dispose');

    let result: ReturnType<typeof detectShapeFromGeometry>;
    try {
      result = detectShapeFromGeometry(root);
    } finally {
      cloneSpy.mockRestore();
    }

    // A merged geometry is a plain BufferGeometry -> ConvexHull.
    expect(result.shapeType).toBe(PhysicsShapeType.ConvexHull);
    // Regression: pre-fix the merged geometry was never disposed (=== cloneCount).
    expect(disposeSpy).toHaveBeenCalledTimes(cloneCount + 1);
    disposeSpy.mockRestore();
  });

  it('does not dispose a Mesh own geometry (it stays in use)', () => {
    const geometry = new BoxGeometry(1, 2, 3);
    const mesh = new Mesh(geometry);
    const disposeSpy = vi.spyOn(geometry, 'dispose');

    const result = detectShapeFromGeometry(mesh);

    expect(result.shapeType).toBe(PhysicsShapeType.Box);
    expect(result.dimensions).toEqual([1, 2, 3]);
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});

describe('runtime-only meshes', () => {
  // A 0.6 x 0.2 x 0.6 plinth with vertex colors (glTF COLOR_0), which the
  // ground-shadow plane does not have, plus a 1.2 m blob and a 6 m catcher.
  function shadowedPlinth(): Group {
    const geometry = new BoxGeometry(0.6, 0.2, 0.6).translate(0, 0.1, 0);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const root = new Group().add(new Mesh(geometry));
    root.position.set(2, 0, -1);
    const resources = createGroundShadowResources();
    new ContactShadowBinding(root, resources, {
      color: [0, 0, 0, 1],
      height: 0.002,
      opacity: 0.72,
      size: [1.2, 1.2],
    });
    new ShadowCatcherBinding(root, resources, {
      color: [0, 0, 0, 1],
      opacity: 0.25,
      size: [6, 6],
    });
    return root;
  }

  it('leaves ground-shadow meshes out of merged collider geometry', () => {
    const merged = generateMergedGeometry(shadowedPlinth());

    merged.computeBoundingBox();
    const size = merged.boundingBox!.getSize(new Vector3());
    expect(size.toArray()).toEqual([
      expect.closeTo(0.6, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.6, 6),
    ]);
  });

  it('auto-detects the shape without the ground-shadow planes', () => {
    expect(detectShapeFromGeometry(shadowedPlinth()).shapeType).toBe(
      PhysicsShapeType.ConvexHull,
    );
  });

  it('leaves ground-shadow meshes out of fallback bounds', () => {
    expect(calculateObject3DBounds(shadowedPlinth())).toEqual([
      expect.closeTo(0.6, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.6, 6),
    ]);
  });
});
