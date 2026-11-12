/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  createTouchPointer,
  getVoidObject,
  type Pointer,
} from '@pmndrs/pointer-events';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Installs IWSDK's sphere-intersection patch used by grab and touch pointers.
import '../../src/grab/index.js';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
} from '../../src/runtime/index.js';

// grab/index.ts -> runtime barrel -> xr-input cursor-visual.ts touches
// `document` at module load; provide a minimal canvas stub before importing.
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

const geometry = new BoxGeometry(0.1, 0.1, 0.1);
const material = new MeshBasicMaterial();

function touchPointerAt(scene: Scene, x: number, y: number, z: number) {
  const hand = new Object3D();
  hand.position.set(x, y, z);
  scene.add(hand);
  hand.updateMatrixWorld(true);
  const pointer: Pointer = createTouchPointer(
    () => new PerspectiveCamera(),
    { current: hand },
    {},
  );
  return pointer;
}

function hitAfterMove(pointer: Pointer, scene: Scene) {
  pointer.move(scene, { timeStamp: 0 } as any);
  pointer.move(scene, { timeStamp: 16 } as any);
  const object = pointer.getIntersection()?.object;
  return object === getVoidObject(scene) ? null : object;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sphere pointer world matrices', () => {
  it('hits a mesh moved after the last matrix update', () => {
    const scene = new Scene();
    const root = new Group();
    (root as any).pointerEvents = 'auto';
    const box = new Mesh(geometry, material);
    root.add(box);
    scene.add(root);
    scene.updateMatrixWorld(true);
    (scene as any).interactableDescendants = [root];

    // Moved this frame; its matrixWorld still says the origin.
    box.position.set(2, 0, 0);
    const pointer = touchPointerAt(scene, 2, 0, 0);
    expect(hitAfterMove(pointer, scene)).toBe(box);
  });

  it('hits a mesh whose ancestor moved after the last matrix update', () => {
    const scene = new Scene();
    const outer = new Group();
    const inner = new Group();
    (outer as any).pointerEvents = 'auto';
    const box = new Mesh(geometry, material);
    inner.add(box);
    outer.add(inner);
    scene.add(outer);
    scene.updateMatrixWorld(true);
    (scene as any).interactableDescendants = [outer];

    outer.position.set(0, 3, 0);
    inner.position.set(0, 0, -1);
    const pointer = touchPointerAt(scene, 0, 3, -1);
    expect(hitAfterMove(pointer, scene)).toBe(box);
  });

  it('recomposes each ancestor once per pass, not once per descendant', () => {
    const scene = new Scene();
    const root = new Group();
    (root as any).pointerEvents = 'auto';
    scene.add(root);
    // A chain 8 deep with 20 far-away meshes under its deepest node.
    let parent: Object3D = root;
    const chain: Object3D[] = [];
    for (let i = 0; i < 8; i++) {
      const node = new Group();
      parent.add(node);
      chain.push(node);
      parent = node;
    }
    for (let i = 0; i < 20; i++) {
      const box = new Mesh(geometry, material);
      box.position.set(10 + i, 0, 0);
      parent.add(box);
    }
    scene.updateMatrixWorld(true);
    (scene as any).interactableDescendants = [root];
    const pointer = touchPointerAt(scene, 0, 0, 0);
    pointer.move(scene, { timeStamp: 0 } as any);

    const updateMatrix = vi.spyOn(Object3D.prototype, 'updateMatrix');
    pointer.move(scene, { timeStamp: 16 } as any);
    const recomposed = new Map<Object3D, number>();
    for (const call of updateMatrix.mock.instances) {
      recomposed.set(call as Object3D, (recomposed.get(call) ?? 0) + 1);
    }
    // Before: each of the 20 meshes recomposed all 8 chain nodes, the root
    // and the scene (200+ recompositions of shared ancestors).
    for (const node of chain) {
      expect(recomposed.get(node) ?? 0).toBeLessThanOrEqual(1);
    }
    expect(recomposed.get(root) ?? 0).toBeLessThanOrEqual(1);
  });

  it('brings matrices up to date again on the next pass', () => {
    const scene = new Scene();
    const root = new Group();
    (root as any).pointerEvents = 'auto';
    const box = new Mesh(geometry, material);
    root.add(box);
    scene.add(root);
    scene.updateMatrixWorld(true);
    (scene as any).interactableDescendants = [root];
    const pointer = touchPointerAt(scene, 0, 0, 0);
    expect(hitAfterMove(pointer, scene)).toBe(box);

    // Moved between passes: the memo from the last pass must not hide it.
    root.position.set(5, 0, 0);
    expect(hitAfterMove(pointer, scene)).toBeNull();
  });
});
