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
  Quaternion,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Intersection,
} from 'three';
import { describe, expect, test } from 'vitest';
import { RayPointer } from '../src/pointer/ray-pointer.js';
import { isObjectTreeVisible } from '../src/pointer/visibility.js';
import type { XROrigin } from '../src/rig/xr-origin.js';

describe('RayPointer', () => {
  test('uses UIKit semantic visibility for renderless components', () => {
    const root = new Group() as Group & {
      isVisible: { value: boolean };
      needsRenderTraversal: { value: boolean };
    };
    const button = new Group() as Group & {
      isVisible: { value: boolean };
      needsRenderTraversal: { value: boolean };
    };
    root.isVisible = { value: true };
    root.needsRenderTraversal = { value: false };
    root.visible = false;
    button.isVisible = { value: true };
    button.needsRenderTraversal = { value: false };
    button.visible = false;
    root.add(button);

    expect(isObjectTreeVisible(button)).toBe(true);

    root.isVisible.value = false;
    expect(isObjectTreeVisible(button)).toBe(false);
  });

  test('allows normal XR trigger presses to synthesize click events', () => {
    const left = new Group();
    const pointer = new RayPointer(
      new PerspectiveCamera(),
      {
        raySpaces: { left, right: new Group() },
      } as unknown as XROrigin,
      'left',
    );

    expect(pointer.pointer.options.clickThresholdMs).toBe(800);
    pointer.dispose();
    expect(left.children).toHaveLength(0);
  });

  test('delivers a controller click to a child after a deliberate press', () => {
    const panel = new Group();
    const button = new Group();
    panel.add(button);
    panel.addEventListener('pointerdown', (event: any) =>
      event.stopPropagation(),
    );
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    const pointer = new RayPointer(
      new PerspectiveCamera(),
      {
        raySpaces: { left: new Group(), right: new Group() },
      } as unknown as XROrigin,
      'left',
    );
    pointer.pointer.setIntersection({
      details: { type: 'ray' },
      distance: 1,
      localPoint: new Vector3(),
      object: button,
      point: new Vector3(),
      pointerPosition: new Vector3(),
      pointerQuaternion: new Quaternion(),
    } as unknown as Intersection);
    pointer.pointer.commit({ timeStamp: 1_000 }, false);
    pointer.pointer.down({ button: 0, timeStamp: 1_000 });
    pointer.pointer.up({ button: 0, timeStamp: 1_500 });

    expect(clicks).toBe(1);
    pointer.dispose();
  });

  test('raycasts sprites in XR without a missing-camera error (#57)', () => {
    const scene = new Scene();
    const root = new Group();
    (root as any).pointerEvents = 'auto';
    const material = new SpriteMaterial();
    const sprite = new Sprite(material);
    sprite.position.z = -2;
    root.add(sprite);
    scene.add(root);
    scene.updateMatrixWorld(true);

    const camera = new PerspectiveCamera();
    camera.updateMatrixWorld(true);
    const raySpace = new Group();
    raySpace.updateMatrixWorld(true);
    const pointer = new RayPointer(
      camera,
      {
        raySpaces: { left: raySpace, right: new Group() },
      } as unknown as XROrigin,
      'left',
    );

    expect((pointer.pointer.intersector as any).raycaster.camera).toBe(camera);
    const intersection = pointer.pointer.computeIntersection('pointer', scene, {
      timeStamp: 0,
    });

    expect(intersection.object).toBe(sprite);
    pointer.dispose();
    material.dispose();
  });

  test('ignores invisible meshes when choosing the nearest ray target', () => {
    const scene = new Scene();
    const hiddenRoot = new Group();
    const visibleRoot = new Group();
    const geometry = new BoxGeometry(1, 1, 0.1);
    const material = new MeshBasicMaterial();
    const hiddenMesh = new Mesh(geometry, material);
    const visibleMesh = new Mesh(geometry, material);
    hiddenMesh.position.z = -1;
    hiddenMesh.visible = false;
    visibleMesh.position.z = -2;
    (hiddenRoot as any).pointerEvents = 'auto';
    (visibleRoot as any).pointerEvents = 'auto';
    hiddenRoot.add(hiddenMesh);
    visibleRoot.add(visibleMesh);
    scene.add(hiddenRoot, visibleRoot);
    scene.updateMatrixWorld(true);

    const raySpace = new Group();
    raySpace.updateMatrixWorld(true);
    const pointer = new RayPointer(
      new PerspectiveCamera(),
      {
        raySpaces: { left: raySpace, right: new Group() },
      } as unknown as XROrigin,
      'left',
    );

    const intersection = pointer.pointer.computeIntersection('pointer', scene, {
      timeStamp: 0,
    });

    expect(intersection.object).toBe(visibleMesh);
    pointer.dispose();
    geometry.dispose();
    material.dispose();
  });

  test('keeps meshes with hidden materials eligible for ray targeting', () => {
    const scene = new Scene();
    const root = new Group();
    const geometry = new BoxGeometry(1, 1, 0.1);
    const material = new MeshBasicMaterial({ visible: false });
    const mesh = new Mesh(geometry, material);
    mesh.position.z = -1;
    (root as any).pointerEvents = 'auto';
    root.add(mesh);
    scene.add(root);
    scene.updateMatrixWorld(true);

    const raySpace = new Group();
    raySpace.updateMatrixWorld(true);
    const pointer = new RayPointer(
      new PerspectiveCamera(),
      {
        raySpaces: { left: raySpace, right: new Group() },
      } as unknown as XROrigin,
      'left',
    );

    const intersection = pointer.pointer.computeIntersection('pointer', scene, {
      timeStamp: 0,
    });

    expect(mesh.visible).toBe(true);
    expect(material.visible).toBe(false);
    expect(intersection.object).toBe(mesh);
    pointer.dispose();
    geometry.dispose();
    material.dispose();
  });
});
