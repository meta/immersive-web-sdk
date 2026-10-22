/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  createGrabPointer,
  createTouchPointer,
  getVoidObject,
  type Pointer,
} from '@pmndrs/pointer-events';
import { describe, expect, it, vi } from 'vitest';
import {
  ContactShadowBinding,
  ShadowCatcherBinding,
  createGroundShadowResources,
} from '../../src/environment/index.js';
// Installs IWSDK's sphere-intersection patch used by grab and touch pointers.
import '../../src/grab/index.js';
import {
  BoxGeometry,
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

type CreatePointer = typeof createGrabPointer | typeof createTouchPointer;

/**
 * Move a near-field pointer to `handX` beside a 0.6 m plinth that carries a
 * 1.2 m blob or a 6 m catcher, 5 cm above the floor.
 */
function nearFieldHit(
  createPointer: CreatePointer,
  shadow: 'contact-shadow' | 'shadow-catcher',
  handX: number,
) {
  const scene = new Scene();
  const plinth = new Object3D();
  const body = new Mesh(
    new BoxGeometry(0.6, 0.2, 0.6),
    new MeshBasicMaterial(),
  );
  body.position.y = 0.1;
  plinth.add(body);
  // InputSystem enables pointer events on interactable nodes like this.
  (plinth as any).pointerEvents = 'auto';
  const pointerOver = vi.fn();
  plinth.addEventListener('pointerover' as any, pointerOver);
  scene.add(plinth);
  const resources = createGroundShadowResources();
  const { mesh } =
    shadow === 'contact-shadow'
      ? new ContactShadowBinding(plinth, resources, {
          color: [0, 0, 0, 1],
          height: 0.002,
          opacity: 0.72,
          size: [1.2, 1.2],
        })
      : new ShadowCatcherBinding(plinth, resources, {
          color: [0, 0, 0, 1],
          opacity: 0.25,
          size: [6, 6],
        });
  const hand = new Object3D();
  hand.position.set(handX, 0.05, 0);
  scene.add(hand);
  scene.updateMatrixWorld(true);
  (scene as any).interactableDescendants = [plinth];

  const pointer: Pointer = createPointer(
    () => new PerspectiveCamera(),
    { current: hand },
    {},
  );
  pointer.move(scene, { timeStamp: 0 } as any);
  pointer.move(scene, { timeStamp: 16 } as any);
  const object = pointer.getIntersection()?.object;
  return {
    hit:
      object === getVoidObject(scene)
        ? 'nothing'
        : object === mesh
          ? shadow
          : object === body
            ? 'body'
            : object?.name,
    pointerOver: pointerOver.mock.calls.length,
  };
}

describe('ground shadows and near-field pointers', () => {
  for (const [label, createPointer] of [
    ['grab', createGrabPointer],
    ['touch', createTouchPointer],
  ] as const) {
    it(`never give a ${label} pointer a hit on their interactable node`, () => {
      // 0.5 m from the plinth centre: over the shadow, clear of the body.
      for (const shadow of ['contact-shadow', 'shadow-catcher'] as const) {
        expect(nearFieldHit(createPointer, shadow, 0.5)).toEqual({
          hit: 'nothing',
          pointerOver: 0,
        });
      }
      // The same pointer at the body's edge does reach the node.
      expect(nearFieldHit(createPointer, 'contact-shadow', 0.3)).toEqual({
        hit: 'body',
        pointerOver: 1,
      });
    });
  }
});
