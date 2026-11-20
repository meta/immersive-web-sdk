/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  MultiPointer,
  XROrigin,
  type MultiPointerInput,
} from '@iwsdk/xr-input';
import type { HandleStore } from '@pmndrs/handle';
import {
  createGrabPointer,
  createRayPointer,
  createTouchPointer,
  type Pointer,
} from '@pmndrs/pointer-events';
import { signal } from '@preact/signals-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisibilityState, World } from '../../src/ecs/world.js';
import { DistanceGrabbable } from '../../src/grab/distance-grabbable.js';
import { GrabSystem } from '../../src/grab/grab-system.js';
import { Grabbed } from '../../src/grab/grabbed.js';
import { Handle } from '../../src/grab/handles.js';
import { OneHandGrabbable } from '../../src/grab/one-hand-grabbable.js';
import { TwoHandsGrabbable } from '../../src/grab/two-hands-grabbable.js';
import { InputSystem } from '../../src/input/input-system.js';
import {
  Hovered,
  PokeInteractable,
  Pressed,
  RayInteractable,
} from '../../src/input/state-tags.js';
import { LevelTag } from '../../src/level/level-tag.js';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from '../../src/runtime/three.js';
import { Transform } from '../../src/transform/transform-component.js';
import { Visibility } from '../../src/visibility/visibility-component.js';

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

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Registers every component these worlds use, in one order, before any
 * entity exists. Elics keeps a component's type id on the component class
 * and registers a component on first use only if it has no id yet, so a
 * World that used a component before registering it would reuse the id an
 * earlier World in this file gave it, which here can be another component's
 * (the level root then counts as grabbable, and Grabbed reads as
 * PokeInteractable).
 */
function registerComponents(world: World): World {
  world
    .registerComponent(Transform)
    .registerComponent(Visibility)
    .registerComponent(LevelTag)
    .registerComponent(OneHandGrabbable)
    .registerComponent(TwoHandsGrabbable)
    .registerComponent(DistanceGrabbable)
    .registerComponent(RayInteractable)
    .registerComponent(PokeInteractable)
    .registerComponent(Hovered)
    .registerComponent(Pressed)
    .registerComponent(Handle)
    .registerComponent(Grabbed);
  return world;
}

function createGrabWorld(): World {
  const world = new World();
  // GrabSystem.init enables each hand's grab sub-pointer.
  const multiPointer = { toggleSubPointer: () => {} };
  (world as any).input = {
    xr: { multiPointers: { left: multiPointer, right: multiPointer } },
  };
  registerComponents(world).registerSystem(GrabSystem);
  world.scene = new Scene();
  world.sceneEntity = world.createTransformEntity(world.scene);
  world.activeLevel = signal(
    world.createTransformEntity(undefined, { parent: world.sceneEntity }),
  );
  return world;
}

const camera = new PerspectiveCamera();

function spaceAt(x: number, y: number, z: number) {
  const space = new Object3D();
  space.position.set(x, y, z);
  space.updateMatrixWorld();
  return { current: space };
}

describe('GrabSystem handles and pokes', () => {
  it.each([
    ['OneHandGrabbable', 'grab', OneHandGrabbable],
    ['TwoHandsGrabbable', 'grab', TwoHandsGrabbable],
    ['DistanceGrabbable', 'ray', DistanceGrabbable],
  ] as const)(
    '%s: a poke presses the object without grabbing it; the %s pointer still grabs it',
    (_, grabber, component) => {
      const world = createGrabWorld();
      const mesh = new Mesh(
        new BoxGeometry(0.1, 0.1, 0.1),
        new MeshBasicMaterial(),
      );
      const entity = world.createTransformEntity(mesh);
      entity.addComponent(component);
      world.scene.updateMatrixWorld(true);
      const handle = Handle.data.instance[entity.index] as HandleStore<unknown>;
      const presses: string[] = [];
      mesh.addEventListener('pointerdown', (e) => presses.push(e.pointerType));

      // A fingertip or controller tip inside the object presses it on the
      // touch pointer's first move.
      const touch = createTouchPointer(
        () => camera,
        spaceAt(0, 0, 0),
        {},
        { hoverRadius: 0.2, downRadius: 0.02 },
      );
      touch.move(world.scene, { timeStamp: 0 });
      expect(presses).toEqual(['touch']);
      expect(handle.inputState.size).toBe(0);

      const button = grabber === 'grab' ? 2 : 0;
      const pointer: Pointer =
        grabber === 'grab'
          ? createGrabPointer(() => camera, spaceAt(0, 0, 0), {})
          : createRayPointer(() => camera, spaceAt(0, 0, 1), {});
      pointer.move(world.scene, { timeStamp: 16 });
      pointer.down({ button, timeStamp: 16 });
      expect(presses).toEqual(['touch', grabber]);
      expect([...handle.inputState.keys()]).toEqual([pointer.id]);

      pointer.up({ button, timeStamp: 32 });
      expect(handle.inputState.size).toBe(0);
    },
  );

  it('lets a poke on a grabbable that is not pokeable reach its pokeable parent', () => {
    // A keycard lying on a drawer. The drawer stands in for a pokeable: its
    // children are part of what the touch pointer can hit.
    const world = createGrabWorld();
    const drawer = new Mesh(
      new BoxGeometry(0.4, 0.2, 0.4),
      new MeshBasicMaterial(),
    );
    const keycard = new Mesh(
      new BoxGeometry(0.08, 0.01, 0.05),
      new MeshBasicMaterial(),
    );
    keycard.position.y = 0.105;
    const drawerEntity = world.createTransformEntity(drawer);
    const keycardEntity = world.createTransformEntity(keycard, {
      parent: drawerEntity,
    });
    keycardEntity.addComponent(OneHandGrabbable);
    world.scene.updateMatrixWorld(true);
    const handle = Handle.data.instance[
      keycardEntity.index
    ] as HandleStore<unknown>;
    const drawerPresses: string[] = [];
    drawer.addEventListener('pointerdown', (e) =>
      drawerPresses.push(
        `${e.pointerType} on ${e.target === keycard ? 'keycard' : 'drawer'}`,
      ),
    );

    // The tip touches the top of the keycard, 1.5 cm above the drawer.
    const touch = createTouchPointer(
      () => camera,
      spaceAt(0, 0.115, 0),
      {},
      { hoverRadius: 0.2, downRadius: 0.02 },
    );
    touch.move(world.scene, { timeStamp: 0 });
    expect(handle.inputState.size).toBe(0);
    expect(drawerPresses).toEqual(['touch on keycard']);
  });
});

/**
 * Where the touch pointer (a controller's tip or a hand's index fingertip)
 * ends up when it presses a 10 cm box at (0, 1, -0.5), and where the grab
 * sphere sits from it.
 */
const DEVICES = {
  controller: {
    tip: new Vector3(0, 1.02, -0.48),
    grip: new Vector3(0, -0.016, 0.05),
  },
  hand: { tip: new Vector3(0, 1, -0.5), grip: new Vector3(0, 0.05, 0.1) },
};

type Device = keyof typeof DEVICES;
type Gesture = 'start' | 'hold' | 'end' | 'none';

/**
 * A world whose InputSystem and GrabSystem drive a real right-hand
 * MultiPointer as XRInputManager does each frame: InputSystem passes the
 * frame's squeeze (a controller) or pinch (a hand) to the pointer, then
 * GrabSystem routes a hand's pinch to the grab pointer and updates the
 * handles.
 */
function createXRGrabWorld(device: Device) {
  const world = new World();
  const scene = new Scene();
  const origin = new XROrigin();
  const camera = new PerspectiveCamera();
  const multiPointers = {
    left: new MultiPointer('left', scene, camera, origin),
    right: new MultiPointer('right', scene, camera, origin),
  };
  let gesture: Gesture = 'none';
  const select = { start: false, end: false, active: false };
  (world as any).input = {
    xr: {
      multiPointers,
      gazeCandidates: [],
      isPrimary: (kind: string, handedness: string) =>
        kind === device && handedness === 'right',
      getSelectState: () => select,
    },
    update: (_xrManager: unknown, delta: number, time: number) => {
      const pointerInput: MultiPointerInput =
        device === 'controller'
          ? {
              squeezeStart: gesture === 'start',
              squeezeEnd: gesture === 'end',
              squeezing: gesture === 'start' || gesture === 'hold',
            }
          : { selectStart: select.start, selectEnd: select.end };
      origin.updateMatrixWorld(true);
      multiPointers.right.update(true, delta, time, {
        squeezing: false,
        ...pointerInput,
      });
    },
  };
  (world as any).renderer = {
    xr: { addEventListener() {}, removeEventListener() {} },
  };
  world.visibilityState.value = VisibilityState.Visible;
  registerComponents(world);
  world.scene = scene;
  world.sceneEntity = world.createTransformEntity(scene);
  world.activeLevel = signal(
    world.createTransformEntity(undefined, { parent: world.sceneEntity }),
  );
  world
    .registerSystem(InputSystem, { priority: -4 })
    .registerSystem(GrabSystem, { priority: -3 });

  let time = 0;
  // The touch pointer stamps its presses with performance.now(). Keep it on
  // the frame clock so the 800 ms click window doesn't depend on test speed.
  vi.spyOn(performance, 'now').mockImplementation(() => time * 1000);

  /**
   * A box entity whose mesh records the pointer types that cancel a press on
   * it and that click it.
   */
  const box = (position: Vector3, size = new Vector3(0.1, 0.1, 0.1)) => {
    const mesh = new Mesh(
      new BoxGeometry(size.x, size.y, size.z),
      new MeshBasicMaterial(),
    );
    mesh.position.copy(position);
    const entity = world.createTransformEntity(mesh);
    const cancels: string[] = [];
    const clicks: string[] = [];
    mesh.addEventListener('pointercancel', (e) => cancels.push(e.pointerType));
    mesh.addEventListener('click', (e) => clicks.push(e.pointerType));
    return { entity, mesh, cancels, clicks };
  };
  const { grip } = DEVICES[device];
  const moveTipTo = (at: Vector3) => {
    origin.raySpaces.right.position.copy(at);
    origin.indexTipSpaces.right.position.copy(at);
    origin.gripSpaces.right.position.copy(at).add(grip);
  };
  /** Runs a frame with the squeeze or pinch in the given phase. */
  const frame = (next: Gesture = 'none') => {
    gesture = next;
    const pinching = device === 'hand';
    select.start = pinching && next === 'start';
    select.end = pinching && next === 'end';
    select.active = pinching && (next === 'start' || next === 'hold');
    time += 1 / 72;
    world.update(1 / 72, time);
  };
  /** Brings the tip to `tip` from 20 cm in front of it, 2 cm a frame. */
  const approach = (tip: Vector3, eachFrame = () => {}) => {
    for (let i = 10; i >= 0; i--) {
      moveTipTo(tip.clone().add(new Vector3(0, 0, 0.02 * i)));
      frame();
      eachFrame();
    }
  };
  return { box, moveTipTo, frame, approach, now: () => time };
}

describe('GrabSystem with a real MultiPointer and pokeables', () => {
  it.each([
    ['a controller squeeze', 'controller'],
    ['a hand pinch', 'hand'],
  ] as const)(
    '%s grabs a pokeable OneHandGrabbable the tip presses, carries it 30 cm and lets go of it, and the poke press neither outlasts the grab nor clicks',
    (_, device) => {
      const { box, moveTipTo, frame, approach, now } =
        createXRGrabWorld(device);
      const { entity, mesh, cancels, clicks } = box(new Vector3(0, 1, -0.5));
      entity.addComponent(OneHandGrabbable);
      entity.addComponent(PokeInteractable);
      const { tip } = DEVICES[device];

      // The tip comes in and presses the object. A poke presses it but never
      // grabs it.
      approach(tip, () => expect(entity.hasComponent(Grabbed)).toBe(false));
      expect(entity.hasComponent(Pressed)).toBe(true);

      // The squeeze or pinch grabs it and cancels the poke press.
      frame('start');
      expect(entity.hasComponent(Grabbed)).toBe(true);
      expect(cancels).toEqual(['touch']);

      for (let i = 1; i <= 30; i++) {
        moveTipTo(tip.clone().add(new Vector3(0.01 * i, 0, 0)));
        frame('hold');
      }
      expect(entity.hasComponent(Grabbed)).toBe(true);
      expect(mesh.position.x).toBeCloseTo(0.3, 3);
      expect(mesh.position.y).toBeCloseTo(1, 3);
      expect(mesh.position.z).toBeCloseTo(-0.5, 3);

      // With the poke press cancelled, letting go leaves the object
      // unpressed, though the tip is still in it.
      frame('end');
      expect(entity.hasComponent(Grabbed)).toBe(false);
      expect(entity.hasComponent(Pressed)).toBe(false);

      // The controller or hand pulls back 30 cm, inside the touch pointer's
      // 800 ms click window. The object stays put and isn't clicked.
      for (let i = 1; i <= 10; i++) {
        moveTipTo(tip.clone().add(new Vector3(0.3, 0, 0.03 * i)));
        frame('none');
      }
      expect(now()).toBeLessThan(0.8);
      expect(entity.hasComponent(Grabbed)).toBe(false);
      expect(entity.hasComponent(Pressed)).toBe(false);
      expect(clicks).toEqual([]);
      expect(mesh.position.x).toBeCloseTo(0.3, 3);
      expect(mesh.position.z).toBeCloseTo(-0.5, 3);
    },
  );

  it.each([
    // In the drawer, just in front of the controller's grip.
    ['a controller squeeze', 'controller', new Vector3(0, 0.95, -0.5)],
    // Under the hand's palm.
    ['a hand pinch', 'hand', new Vector3(0, 1, -0.38)],
  ] as const)(
    '%s grabs a keycard while the tip presses a pokeable drawer, which is let go of and not clicked',
    (_, device, keycardAt) => {
      const { box, moveTipTo, frame, approach, now } =
        createXRGrabWorld(device);
      const drawer = box(new Vector3(0, 1, -0.5), new Vector3(0.4, 0.2, 0.4));
      drawer.entity.addComponent(PokeInteractable);
      const keycard = box(keycardAt, new Vector3(0.08, 0.01, 0.05));
      keycard.entity.addComponent(OneHandGrabbable);

      const tip = new Vector3(0, 0.97, -0.47);
      approach(tip);
      expect(drawer.entity.hasComponent(Pressed)).toBe(true);

      frame('start');
      expect(keycard.entity.hasComponent(Grabbed)).toBe(true);
      expect(drawer.cancels).toEqual(['touch']);
      expect(drawer.entity.hasComponent(Pressed)).toBe(false);

      // Lift the keycard 30 cm out and let go, inside the touch pointer's
      // 800 ms click window.
      for (let i = 1; i <= 10; i++) {
        moveTipTo(tip.clone().add(new Vector3(0, 0.03 * i, 0)));
        frame('hold');
      }
      frame('end');
      frame();
      expect(now()).toBeLessThan(0.8);
      expect(keycard.entity.hasComponent(Grabbed)).toBe(false);
      expect(keycard.mesh.position.y).toBeCloseTo(keycardAt.y + 0.3, 3);
      expect(drawer.entity.hasComponent(Pressed)).toBe(false);
      expect(drawer.clicks).toEqual([]);
    },
  );

  it('a controller squeeze grab ends the tip hover on a pokeable next to the grabbable', () => {
    const { box, moveTipTo, frame, approach } = createXRGrabWorld('controller');
    const panel = box(new Vector3(0, 0.94, -0.5), new Vector3(0.3, 0.02, 0.3));
    panel.entity.addComponent(PokeInteractable);
    const grabbable = box(new Vector3(0, 1, -0.5));
    grabbable.entity.addComponent(OneHandGrabbable);

    const tip = new Vector3(0, 1.02, -0.48);
    approach(tip);
    expect(panel.entity.hasComponent(Hovered)).toBe(true);

    // The grab's lock stops moving the touch pointer until the squeeze ends,
    // so its hover on the panel ends as the grab starts.
    frame('start');
    expect(grabbable.entity.hasComponent(Grabbed)).toBe(true);
    expect(panel.entity.hasComponent(Hovered)).toBe(false);
    for (let i = 1; i <= 10; i++) {
      moveTipTo(tip.clone().add(new Vector3(0, 0.05 * i, 0)));
      frame('hold');
      expect(panel.entity.hasComponent(Hovered)).toBe(false);
    }
    frame('end');
    expect(grabbable.entity.hasComponent(Grabbed)).toBe(false);

    // Back over the panel, the tip hovers it again at once.
    moveTipTo(tip);
    frame();
    expect(panel.entity.hasComponent(Hovered)).toBe(true);
    expect(panel.entity.hasComponent(Pressed)).toBe(false);
  });
});
