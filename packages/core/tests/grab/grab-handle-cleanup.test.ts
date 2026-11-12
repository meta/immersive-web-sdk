/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { signal } from '@preact/signals-core';
import { describe, expect, it, vi } from 'vitest';
import { World } from '../../src/ecs/world.js';
import { DistanceGrabbable } from '../../src/grab/distance-grabbable.js';
import { GrabSystem } from '../../src/grab/grab-system.js';
import { Handle } from '../../src/grab/handles.js';
import { OneHandGrabbable } from '../../src/grab/one-hand-grabbable.js';
import { TwoHandsGrabbable } from '../../src/grab/two-hands-grabbable.js';
import { LevelTag } from '../../src/level/level-tag.js';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Scene,
} from '../../src/runtime/three.js';
import { Transform } from '../../src/transform/transform-component.js';

// grab-system.ts -> runtime barrel -> xr-input cursor-visual.ts touches
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

function createGrabWorld(): World {
  const world = new World();
  // GrabSystem.init enables each hand's grab sub-pointer.
  const multiPointer = { toggleSubPointer: () => {} };
  (world as any).input = {
    xr: { multiPointers: { left: multiPointer, right: multiPointer } },
  };
  world
    .registerComponent(Transform)
    .registerComponent(LevelTag)
    .registerComponent(OneHandGrabbable)
    .registerComponent(TwoHandsGrabbable)
    .registerComponent(DistanceGrabbable)
    .registerSystem(GrabSystem);
  world.scene = new Scene();
  world.sceneEntity = world.createTransformEntity(world.scene);
  world.activeLevel = signal(
    world.createTransformEntity(undefined, { parent: world.sceneEntity }),
  );
  return world;
}

function createGrabbableMesh(world: World) {
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  return { mesh, entity: world.createTransformEntity(mesh) };
}

describe('GrabSystem handle cleanup (#59)', () => {
  it('removes the Handle and restores ray events when OneHandGrabbable is removed', () => {
    const world = createGrabWorld();
    const { mesh, entity } = createGrabbableMesh(world);

    entity.addComponent(OneHandGrabbable);
    expect(entity.hasComponent(Handle)).toBe(true);
    expect(mesh.pointerEventsType).toEqual({ deny: 'ray' });

    entity.removeComponent(OneHandGrabbable);
    expect(entity.hasComponent(Handle)).toBe(false);
    expect(mesh.pointerEventsType).toBe('all');

    // Adding it back makes the object grabbable again.
    entity.addComponent(OneHandGrabbable);
    expect(entity.hasComponent(Handle)).toBe(true);
    expect(mesh.pointerEventsType).toEqual({ deny: 'ray' });
  });

  it.each([
    ['TwoHandsGrabbable', TwoHandsGrabbable, { deny: 'ray' }],
    ['DistanceGrabbable', DistanceGrabbable, { deny: 'grab' }],
  ] as const)(
    'removes the Handle when %s is removed',
    (_, component, denied) => {
      const world = createGrabWorld();
      const { mesh, entity } = createGrabbableMesh(world);

      entity.addComponent(component);
      expect(mesh.pointerEventsType).toEqual(denied);

      entity.removeComponent(component);
      expect(entity.hasComponent(Handle)).toBe(false);
      expect(mesh.pointerEventsType).toBe('all');
    },
  );

  it('rebuilds the Handle from the grabbable that remains', () => {
    const world = createGrabWorld();
    const { mesh, entity } = createGrabbableMesh(world);

    entity.addComponent(OneHandGrabbable);
    entity.addComponent(DistanceGrabbable);
    const oneHandHandle = Handle.data.instance[entity.index];

    entity.removeComponent(OneHandGrabbable);
    expect(entity.hasComponent(Handle)).toBe(true);
    expect(Handle.data.instance[entity.index]).not.toBe(oneHandHandle);
    expect(mesh.pointerEventsType).toEqual({ deny: 'grab' });
  });

  it('keeps the Handle when a grabbable that did not create it is removed', () => {
    const world = createGrabWorld();
    const { entity } = createGrabbableMesh(world);

    entity.addComponent(OneHandGrabbable);
    entity.addComponent(DistanceGrabbable);
    const handle = Handle.data.instance[entity.index] as { cancel(): void };
    const cancel = vi.spyOn(handle, 'cancel');

    entity.removeComponent(DistanceGrabbable);
    expect(entity.hasComponent(Handle)).toBe(true);
    expect(Handle.data.instance[entity.index]).toBe(handle);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('destroys a grabbable entity without warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const world = createGrabWorld();
    const { entity } = createGrabbableMesh(world);
    entity.addComponent(OneHandGrabbable);

    entity.destroy();
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).includes('is destroyed'),
      ),
    ).toHaveLength(0);
    warn.mockRestore();
  });
});
