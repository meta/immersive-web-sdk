/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { InputSystem } from '../../src/input/input-system.js';
import {
  Hovered,
  PokeHand,
  PokeInteractable,
  Pressed,
} from '../../src/input/state-tags.js';
import { Object3D } from '../../src/runtime/three.js';

function createHarness() {
  const object3D = new Object3D();
  const components = new Set<unknown>();
  const entity = {
    active: true,
    object3D,
    hasComponent: (component: unknown) => components.has(component),
    addComponent(component: unknown) {
      components.add(component);
      return this;
    },
    removeComponent(component: unknown) {
      components.delete(component);
      return this;
    },
  };
  const system = Object.create(InputSystem.prototype) as any;
  system.listeners = new WeakMap();
  system.listenerEntities = new Set();
  system.lastBVHUpdate = new WeakMap();
  system.setupEventListeners(entity);
  const emit = (type: string, pointerId: number) =>
    object3D.dispatchEvent({
      type,
      pointerId,
      stopPropagation: vi.fn(),
    } as any);
  return { components, emit, entity, object3D, system };
}

describe('InputSystem cleanup', () => {
  it('skips foreign meshes that do not expose the BVH extension', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const foreignMesh = {
      geometry: {},
      isMesh: true,
      name: 'UIKit mesh',
    };
    const object3D = {
      traverse: (visit: (child: typeof foreignMesh) => void) =>
        visit(foreignMesh),
    };
    const system = Object.create(InputSystem.prototype) as InputSystem & {
      computeBoundsTreeForEntity(entity: typeof object3D): void;
    };

    expect(() => system.computeBoundsTreeForEntity(object3D)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it('publishes the same deduplicated ray targets to hand and gaze pointers', () => {
    const explicitRay = new Object3D();
    const distanceOnly = new Object3D();
    const snapshots: Object3D[][] = [];
    const scene: Record<string, unknown> = {};
    const xr = { gazeCandidates: [] as ReadonlyArray<Object3D> };
    const system = Object.create(InputSystem.prototype) as any;
    system.shouldSetIntersectables = true;
    system.rayDescendants = [];
    system.touchDescendants = [];
    system.touchDescendantsByHand = { left: [], right: [] };
    system.grabDescendants = [];
    system.scene = scene;
    system.input = {
      xr,
      update: vi.fn(() => snapshots.push([...xr.gazeCandidates])),
    };
    system.world = { renderer: { xr: {} } };
    system.queries = {
      rayInteractables: {
        entities: new Set([{ object3D: explicitRay }]),
      },
      distanceGrabbables: {
        entities: new Set([
          { object3D: explicitRay },
          { object3D: distanceOnly },
        ]),
      },
      pokeInteractables: { entities: new Set() },
      oneHandGrabbables: { entities: new Set() },
      twoHandsGrabbables: { entities: new Set() },
    };

    system.update(0, 0);
    system.update(0, 1);

    expect(snapshots).toEqual([[], [explicitRay, distanceOnly]]);
    expect(xr.gazeCandidates).toBe(system.rayDescendants);
    expect(scene.rayDescendants).toBe(system.rayDescendants);
  });

  it('lists each poke target only for the hands that may poke it (#62)', () => {
    const both = new Object3D();
    const leftOnly = new Object3D();
    const rightOnly = new Object3D();
    const poke = (object3D: Object3D, hand: string) => ({
      object3D,
      getValue: (component: unknown, key: string) =>
        component === PokeInteractable && key === 'hand' ? hand : undefined,
    });
    const scene: Record<string, any> = {};
    const system = Object.create(InputSystem.prototype) as any;
    system.shouldSetIntersectables = true;
    system.rayDescendants = [];
    system.touchDescendants = [];
    system.touchDescendantsByHand = { left: [], right: [] };
    system.grabDescendants = [];
    system.scene = scene;
    system.input = { xr: {}, update: vi.fn() };
    system.world = { renderer: { xr: {} } };
    system.queries = {
      rayInteractables: { entities: new Set() },
      distanceGrabbables: { entities: new Set() },
      pokeInteractables: {
        entities: new Set([
          poke(both, PokeHand.Both),
          poke(leftOnly, PokeHand.Left),
          poke(rightOnly, PokeHand.Right),
        ]),
      },
      oneHandGrabbables: { entities: new Set() },
      twoHandsGrabbables: { entities: new Set() },
    };

    system.update(0, 0);

    expect(scene.touchDescendants).toEqual([both, leftOnly, rightOnly]);
    expect(scene.touchDescendantsByHand.left).toEqual([both, leftOnly]);
    expect(scene.touchDescendantsByHand.right).toEqual([both, rightOnly]);

    // Lists are rebuilt each frame, not appended to.
    system.update(0, 1);
    expect(scene.touchDescendantsByHand.left).toEqual([both, leftOnly]);
  });

  it('detaches pointer listeners without mutating a destroyed entity', () => {
    const removeEventListener = vi.fn();
    const object3D = { removeEventListener };
    const listeners = {
      enter: vi.fn(),
      leave: vi.fn(),
      down: vi.fn(),
      up: vi.fn(),
      cancel: vi.fn(),
      hovered: new Set<number>([1]),
      pressed: new Set<number>([1]),
    };
    const removeComponent = vi.fn();
    const entity = {
      active: false,
      object3D,
      removeComponent,
    };
    const system = Object.create(InputSystem.prototype) as InputSystem & {
      listeners: WeakMap<object, typeof listeners>;
      listenerEntities: Set<typeof entity>;
      cleanupEventListeners(entity: typeof entity): void;
    };
    system.listeners = new WeakMap([[object3D, listeners]]);
    system.listenerEntities = new Set([entity]);

    system.cleanupEventListeners(entity);

    expect(removeEventListener).toHaveBeenCalledTimes(5);
    expect(listeners.hovered.size).toBe(0);
    expect(listeners.pressed.size).toBe(0);
    expect(system.listeners.has(object3D)).toBe(false);
    expect(removeComponent).not.toHaveBeenCalled();
  });

  it('clears stale pointer state on session boundaries and system teardown', () => {
    const { components, emit, entity, object3D, system } = createHarness();
    const xrManager = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const query = (entities = new Set()) => ({
      entities,
      subscribe: vi.fn(() => vi.fn()),
    });
    system.world = { renderer: { xr: xrManager } };
    system.visibilityState = {
      value: 'visible',
      subscribe: vi.fn(() => vi.fn()),
    };
    system.config = { maintainScenePointers: { value: false } };
    system.input = {
      xr: {
        multiPointers: {
          left: { toggleSubPointer: vi.fn() },
          right: { toggleSubPointer: vi.fn() },
        },
      },
    };
    system.cleanupFuncs = [];
    system.queries = {
      rayInteractables: query(new Set([entity])),
      pokeInteractables: query(),
      oneHandGrabbables: query(),
      twoHandsGrabbables: query(),
      distanceGrabbables: query(),
    };
    system.init();
    const sessionStart = xrManager.addEventListener.mock.calls.find(
      ([type]) => type === 'sessionstart',
    )?.[1] as () => void;
    const sessionEnd = xrManager.addEventListener.mock.calls.find(
      ([type]) => type === 'sessionend',
    )?.[1] as () => void;

    emit('pointerdown', 1);
    emit('pointerdown', 2);
    expect(components.has(Hovered)).toBe(true);
    expect(components.has(Pressed)).toBe(true);

    sessionStart();
    expect(components.has(Hovered)).toBe(false);
    expect(components.has(Pressed)).toBe(false);
    expect(system.listeners.get(object3D).hovered.size).toBe(0);
    expect(system.listeners.get(object3D).pressed.size).toBe(0);

    emit('pointerdown', 3);
    sessionEnd();
    expect(components.has(Hovered)).toBe(false);
    expect(components.has(Pressed)).toBe(false);
    expect(system.listeners.get(object3D).hovered.size).toBe(0);
    expect(system.listeners.get(object3D).pressed.size).toBe(0);

    emit('pointerdown', 4);
    expect(components.has(Hovered)).toBe(true);
    expect(components.has(Pressed)).toBe(true);

    system.destroy();

    expect(components.has(Hovered)).toBe(false);
    expect(components.has(Pressed)).toBe(false);
    expect(system.listenerEntities.size).toBe(0);
    expect(system.listeners.has(object3D)).toBe(false);
    expect(xrManager.removeEventListener).toHaveBeenCalledWith(
      'sessionstart',
      sessionStart,
    );
    expect(xrManager.removeEventListener).toHaveBeenCalledWith(
      'sessionend',
      sessionEnd,
    );

    emit('pointerdown', 5);
    expect(components.has(Hovered)).toBe(false);
    expect(components.has(Pressed)).toBe(false);
  });

  it('keeps Hovered until every pointer has left', () => {
    const { components, emit } = createHarness();
    emit('pointerenter', 1);
    emit('pointerenter', 2);
    emit('pointerleave', 1);
    expect(components.has(Hovered)).toBe(true);

    emit('pointerleave', 2);
    expect(components.has(Hovered)).toBe(false);
  });

  it('keeps Pressed until every pointer has released', () => {
    const { components, emit } = createHarness();
    emit('pointerdown', 1);
    emit('pointerdown', 2);
    emit('pointerup', 1);
    expect(components.has(Pressed)).toBe(true);

    emit('pointerup', 2);
    expect(components.has(Pressed)).toBe(false);
  });

  it('clears only the cancelled pointer state', () => {
    const { components, emit } = createHarness();
    emit('pointerdown', 1);
    emit('pointerdown', 2);
    emit('pointercancel', 1);
    expect(components.has(Hovered)).toBe(true);
    expect(components.has(Pressed)).toBe(true);

    emit('pointercancel', 2);
    expect(components.has(Hovered)).toBe(false);
    expect(components.has(Pressed)).toBe(false);
  });
});
