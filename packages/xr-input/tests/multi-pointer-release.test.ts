/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MultiPointerInput } from '../src/pointer/multi-pointer.js';
import { XROrigin } from '../src/rig/xr-origin.js';

let MultiPointer: typeof import('../src/pointer/multi-pointer.js').MultiPointer;
let InteractorState: typeof import('../src/pointer/multi-pointer.js').InteractorState;

beforeAll(async () => {
  // The shared cursor visual draws into a canvas.
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect() {},
        beginPath() {},
        arc() {},
        fill() {},
        stroke() {},
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
      }),
    }),
  });
  ({ MultiPointer, InteractorState } = await import(
    '../src/pointer/multi-pointer.js'
  ));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

type Kind = 'ray' | 'grab';

/**
 * A left-hand MultiPointer over a scene with one interactable root. The ray
 * points down -Z from the origin; the grab sphere sits at the origin.
 */
function setup(kind: Kind) {
  const scene = new Scene() as Scene & Record<string, unknown>;
  const root = new Group();
  (root as any).pointerEvents = 'auto';
  scene.add(root);
  scene.rayDescendants = [root];
  scene.grabDescendants = [root];
  scene.touchDescendants = [];
  const origin = new XROrigin();
  scene.add(origin);
  const pointer = new MultiPointer(
    'left',
    scene,
    new PerspectiveCamera(),
    origin,
  );
  if (kind === 'grab') {
    pointer.toggleSubPointer('grab', true);
  }
  let time = 0;
  const frame = (input: MultiPointerInput = {}) => {
    time += 1 / 72;
    scene.updateMatrixWorld(true);
    pointer.update(true, 1 / 72, time, input);
  };
  const state = () => (pointer as any).pointerStates.get(kind);
  return { scene, root, pointer, frame, state };
}

/** A box the ray (at z = -2) or the grab sphere (at the origin) hits. */
function target(kind: Kind) {
  const mesh = new Mesh(
    new BoxGeometry(0.2, 0.2, 0.2),
    new MeshBasicMaterial(),
  );
  mesh.position.z = kind === 'ray' ? -2 : 0;
  const downs = vi.fn();
  mesh.addEventListener('pointerdown' as any, downs);
  return { mesh, downs };
}

const press: Record<Kind, MultiPointerInput> = {
  ray: { selectStart: true },
  grab: { squeezeStart: true },
};
const release: Record<Kind, MultiPointerInput> = {
  ray: { selectEnd: true },
  grab: { squeezeEnd: true },
};

describe('MultiPointer release after the selected object disappears', () => {
  it.each(['ray', 'grab'] as const)(
    '%s: releasing with no target leaves SELECT, and the next press selects a new object',
    (kind) => {
      const { root, pointer, frame, state } = setup(kind);
      const first = target(kind);
      root.add(first.mesh);

      frame();
      frame();
      expect(pointer.getActiveKind()).toBe(kind);
      expect(state()).toBe(InteractorState.HOVER);
      frame(press[kind]);
      expect(state()).toBe(InteractorState.SELECT);
      expect(first.downs).toHaveBeenCalledOnce();

      // The app disposes the held object (e.g. a scene reset).
      root.remove(first.mesh);
      first.mesh.geometry.dispose();
      frame();
      frame(release[kind]);

      expect(state()).not.toBe(InteractorState.SELECT);
      expect(pointer.getPointer(kind).getButtonsDown().size).toBe(0);
      // No capture is left pointing at the disposed object.
      expect(pointer.getPointer(kind).getPointerCapture()).toBeUndefined();

      // A fresh object can be selected again.
      const second = target(kind);
      root.add(second.mesh);
      frame();
      frame();
      expect(state()).toBe(InteractorState.HOVER);
      frame(press[kind]);
      expect(state()).toBe(InteractorState.SELECT);
      expect(second.downs).toHaveBeenCalledOnce();
      frame(release[kind]);
      expect(state()).toBe(InteractorState.HOVER);
      pointer.dispose();
    },
  );
});
