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
  Vector3,
} from 'three';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** A Quest controller's grip sits about 5 cm behind and 1.6 cm below its tip. */
const CONTROLLER_GRIP = new Vector3(0, -0.016, 0.05);
/** A tracked hand's grip (palm) sits farther from its index fingertip. */
const HAND_GRIP = new Vector3(0, 0.05, 0.1);

/**
 * How a grab starts: a controller's squeeze, or a hand's pinch, which
 * GrabSystem routes to the grab pointer.
 */
type Gesture = 'squeeze' | 'pinch';
const GRIP: Record<Gesture, Vector3> = {
  squeeze: CONTROLLER_GRIP,
  pinch: HAND_GRIP,
};

/**
 * A box (10 cm by default) that records which pointer types press, release,
 * cancel, enter, leave and click it. With `capture`, it captures the grab
 * pointer that presses it, as a grab handle does.
 */
function target(
  position: Vector3,
  size = new Vector3(0.1, 0.1, 0.1),
  { capture = false } = {},
) {
  const root = new Group();
  (root as any).pointerEvents = 'auto';
  root.position.copy(position);
  root.add(
    new Mesh(new BoxGeometry(size.x, size.y, size.z), new MeshBasicMaterial()),
  );
  const record = (type: string) => {
    const types: string[] = [];
    root.addEventListener(type as any, (e: any) => types.push(e.pointerType));
    return types;
  };
  if (capture) {
    root.addEventListener('pointerdown' as any, (e: any) => {
      if (e.pointerType === 'grab') {
        (root as any).setPointerCapture(e.pointerId);
      }
    });
  }
  return {
    root,
    downs: record('pointerdown'),
    ups: record('pointerup'),
    cancels: record('pointercancel'),
    enters: record('pointerenter'),
    leaves: record('pointerleave'),
    clicks: record('click'),
  };
}

/**
 * A right-hand MultiPointer with the grab sub-pointer on, as GrabSystem sets
 * it up, for a controller (`'squeeze'`) or a tracked hand (`'pinch'`). The
 * touch pointer sits at the tip (a controller's ray space or a hand's index
 * fingertip), the grab sphere at the grip from it.
 *
 * Every frame reports `squeezing` as XRInputManager does: whether a
 * controller's squeeze is held, and always false for a hand, which has no
 * squeeze button. With `edgesOnly`, frames carry only the edges, as from a
 * caller that leaves `squeezing` undefined.
 */
function setup(
  lists: { grab?: Group[]; touch?: Group[]; ray?: Group[] },
  gesture: Gesture = 'squeeze',
  { edgesOnly = false } = {},
) {
  const grip = GRIP[gesture];
  const scene = new Scene() as Scene & Record<string, unknown>;
  for (const root of new Set([
    ...(lists.grab ?? []),
    ...(lists.touch ?? []),
    ...(lists.ray ?? []),
  ])) {
    scene.add(root);
  }
  scene.grabDescendants = lists.grab ?? [];
  scene.touchDescendants = lists.touch ?? [];
  scene.rayDescendants = lists.ray ?? [];
  const origin = new XROrigin();
  scene.add(origin);
  const pointer = new MultiPointer(
    'right',
    scene,
    new PerspectiveCamera(),
    origin,
  );
  pointer.toggleSubPointer('grab', true);
  const moveTipTo = (tip: Vector3) => {
    origin.raySpaces.right.position.copy(tip);
    origin.indexTipSpaces.right.position.copy(tip);
    origin.gripSpaces.right.position.copy(tip).add(grip);
  };
  let time = 0;
  // The touch pointer stamps its presses with performance.now(). Keep it on
  // the frame clock so the 800 ms click window doesn't depend on test speed.
  vi.spyOn(performance, 'now').mockImplementation(() => time * 1000);
  let squeezeHeld = false;
  const frame = (input: MultiPointerInput = {}) => {
    if (input.squeezeStart) {
      squeezeHeld = true;
    }
    if (input.squeezeEnd) {
      squeezeHeld = false;
    }
    time += 1 / 72;
    scene.updateMatrixWorld(true);
    pointer.update(
      true,
      1 / 72,
      time,
      edgesOnly ? input : { squeezing: squeezeHeld, ...input },
    );
  };
  /** Moves the tip to `tip` from 20 cm in front of it, a frame per 2 cm. */
  const approach = (tip: Vector3) => {
    for (let i = 10; i >= 0; i--) {
      moveTipTo(tip.clone().add(new Vector3(0, 0, 0.02 * i)));
      frame();
    }
  };
  /**
   * Runs a frame that starts or ends a grab. A squeeze reaches the pointer
   * in the frame's input. GrabSystem routes a pinch to the grab pointer after
   * the frame's update, as here.
   */
  const grabFrame = (gesture: Gesture, phase: 'start' | 'end') => {
    if (gesture === 'squeeze') {
      frame(phase === 'start' ? { squeezeStart: true } : { squeezeEnd: true });
      return;
    }
    frame();
    const event = { timeStamp: time * 1000 };
    if (phase === 'start') {
      pointer.routeDown('squeeze', 'grab', event);
    } else {
      pointer.routeUp('squeeze', 'grab', event);
    }
  };
  const state = (kind: 'ray' | 'grab' | 'touch') =>
    (pointer as any).pointerStates.get(kind);
  return {
    pointer,
    scene,
    moveTipTo,
    frame,
    approach,
    grabFrame,
    state,
    now: () => time,
  };
}

describe('MultiPointer squeeze near pokeables', () => {
  it.each([
    {
      // A pokeable plate just under the grabbable; the tip hovers it.
      scene: 'next to a pokeable the tip hovers',
      grabbable: target(new Vector3(0, 1, -0.5)),
      pokeable: target(new Vector3(0, 0.94, -0.5), new Vector3(0.3, 0.02, 0.3)),
      tip: new Vector3(0, 1.02, -0.48),
      pokes: [],
    },
    {
      // A keycard inside a pokeable drawer; the tip reaching in presses it.
      scene: 'inside a pokeable the tip presses',
      grabbable: target(
        new Vector3(0, 0.95, -0.5),
        new Vector3(0.08, 0.01, 0.05),
      ),
      pokeable: target(new Vector3(0, 1, -0.5), new Vector3(0.4, 0.2, 0.4)),
      tip: new Vector3(0, 0.97, -0.47),
      pokes: ['touch'],
    },
  ])('grabs a grabbable $scene with the squeeze', (c) => {
    const { pointer, frame, approach, state } = setup({
      grab: [c.grabbable.root],
      touch: [c.pokeable.root],
    });

    approach(c.tip);
    // Touch outranks grab, so the pokeable makes touch the active pointer.
    expect(pointer.getActiveKind()).toBe('touch');

    frame({ squeezeStart: true });
    expect(c.grabbable.downs).toEqual(['grab']);
    expect(pointer.getActiveKind()).toBe('grab');
    expect(state('grab')).toBe(InteractorState.SELECT);

    frame();
    frame({ squeezeEnd: true });
    expect(c.grabbable.ups).toEqual(['grab']);
    expect(state('grab')).toBe(InteractorState.HOVER);
    expect(pointer.getPointer('grab').getButtonsDown().size).toBe(0);
    expect(c.pokeable.downs).toEqual(c.pokes);
    pointer.dispose();
  });

  it.each([
    // As XRInputManager sends the squeeze.
    ['with `squeezing` on every frame', false],
    // As a caller that leaves `squeezing` undefined sends it.
    ['from the squeeze edges alone', true],
  ] as const)(
    'grabs a pokeable grabbable the controller tip presses, keeps the grab while touch is in range, and releases it on squeeze end, %s',
    (_, edgesOnly) => {
      const grabbable = target(new Vector3(0, 1, -0.5));
      const { pointer, moveTipTo, frame, approach, state } = setup(
        { grab: [grabbable.root], touch: [grabbable.root] },
        'squeeze',
        { edgesOnly },
      );

      approach(new Vector3(0, 1.02, -0.48));
      expect(grabbable.downs).toEqual(['touch']);
      expect(state('touch')).toBe(InteractorState.SELECT);

      frame({ squeezeStart: true });
      expect(grabbable.downs).toEqual(['touch', 'grab']);
      expect(pointer.getActiveKind()).toBe('grab');
      expect(state('grab')).toBe(InteractorState.SELECT);

      // Carry it while the tip stays in touch range: touch can't take over.
      for (let i = 1; i <= 5; i++) {
        moveTipTo(new Vector3(0.01 * i, 1.02, -0.48));
        frame();
        expect(pointer.getActiveKind()).toBe('grab');
      }

      frame({ squeezeEnd: true });
      expect(grabbable.ups).toEqual(['grab']);
      expect(state('grab')).not.toBe(InteractorState.SELECT);
      expect(pointer.getPointer('grab').getButtonsDown().size).toBe(0);
      pointer.dispose();
    },
  );

  /**
   * The tip presses a pokeable drawer, then a squeeze or a pinch grabs a
   * keycard in the grab sphere: inside the drawer just in front of a
   * controller's grip, or under a hand's palm.
   */
  function grabKeycardFromPressedDrawer(gesture: Gesture) {
    const keycard = target(
      gesture === 'squeeze'
        ? new Vector3(0, 0.95, -0.5)
        : new Vector3(0, 1, -0.38),
      new Vector3(0.08, 0.01, 0.05),
    );
    const drawer = target(new Vector3(0, 1, -0.5), new Vector3(0.4, 0.2, 0.4));
    const harness = setup(
      { grab: [keycard.root], touch: [drawer.root] },
      gesture,
    );
    harness.approach(new Vector3(0, 0.97, -0.47));
    expect(drawer.downs).toEqual(['touch']);
    harness.grabFrame(gesture, 'start');
    expect(keycard.downs).toEqual(['grab']);
    return { ...harness, drawer };
  }

  it.each(['squeeze', 'pinch'] as const)(
    'cancels the poke press a %s grab takes over, so the poked object lets go of it at once',
    (gesture) => {
      const { pointer, drawer, state } = grabKeycardFromPressedDrawer(gesture);

      // As for a touch the browser cancels: pointercancel, then pointerleave
      // (which also ends UIKit's active state), and no pointerup.
      expect(drawer.cancels).toEqual(['touch']);
      expect(drawer.leaves).toEqual(['touch']);
      expect(drawer.ups).toEqual([]);
      expect(state('touch')).toBe(InteractorState.NORMAL);
      expect(pointer.getPointer('touch').getButtonsDown().size).toBe(0);
      pointer.dispose();
    },
  );

  it.each(['squeeze', 'pinch'] as const)(
    'does not click the poked object when the tip lifts off after a short %s grab',
    (gesture) => {
      const { pointer, drawer, moveTipTo, frame, grabFrame, now } =
        grabKeycardFromPressedDrawer(gesture);

      // Lift the keycard 30 cm out of the drawer and let go, all inside the
      // touch pointer's 800 ms click window. The tip ends 17 cm above the
      // drawer, within touch hover range.
      for (let i = 1; i <= 10; i++) {
        moveTipTo(new Vector3(0, 0.97 + 0.03 * i, -0.47));
        frame();
      }
      grabFrame(gesture, 'end');
      frame();
      expect(now()).toBeLessThan(0.8);
      expect(drawer.ups).toEqual([]);
      expect(drawer.clicks).toEqual([]);

      // The next poke presses and clicks the drawer as usual.
      moveTipTo(new Vector3(0, 1.09, -0.47));
      frame();
      moveTipTo(new Vector3(0, 1.2, -0.47));
      frame();
      expect(drawer.downs).toEqual(['touch', 'touch']);
      expect(drawer.ups).toEqual(['touch']);
      expect(drawer.clicks).toEqual(['touch']);
      pointer.dispose();
    },
  );

  it.each([
    // The controller tip comes to rest 2 cm into the object.
    ['squeeze', new Vector3(0, 1.02, -0.48)],
    // The fingertip presses the front face before the palm is in grab range,
    // then pushes on to the middle of the object.
    ['pinch', new Vector3(0, 1, -0.5)],
  ] as const)(
    'does not press a pokeable grabbable again when the %s lets go with the tip still in it',
    (gesture, tip) => {
      const grabbable = target(new Vector3(0, 1, -0.5));
      const { pointer, moveTipTo, frame, approach, grabFrame, now } = setup(
        { grab: [grabbable.root], touch: [grabbable.root] },
        gesture,
      );

      approach(tip);
      expect(grabbable.downs).toEqual(['touch']);
      grabFrame(gesture, 'start');
      expect(grabbable.cancels).toEqual(['touch']);
      frame();
      grabFrame(gesture, 'end');
      frame();
      frame();
      // The tip is still inside the object; its cancelled press stays ended.
      expect(grabbable.downs).toEqual(['touch', 'grab']);

      // Pulling away inside the click window neither releases nor clicks it.
      moveTipTo(new Vector3(0, tip.y, -0.3));
      frame();
      expect(now()).toBeLessThan(0.8);
      expect(grabbable.ups).toEqual(['grab']);
      expect(grabbable.clicks).toEqual([]);

      // Once the tip has lifted off, it pokes the object as usual.
      moveTipTo(new Vector3(0, tip.y, -0.48));
      frame();
      moveTipTo(new Vector3(0, tip.y, -0.42));
      frame();
      expect(grabbable.downs).toEqual(['touch', 'grab', 'touch']);
      expect(grabbable.clicks).toEqual(['touch']);
      pointer.dispose();
    },
  );

  it.each(['squeeze', 'pinch'] as const)(
    'leaves a poke press alone when the %s has nothing to grab',
    (gesture) => {
      const panel = target(new Vector3(0, 1, -0.5));
      const { pointer, approach, grabFrame, state } = setup(
        { grab: [], touch: [panel.root] },
        gesture,
      );

      approach(new Vector3(0, 1.02, -0.48));
      expect(panel.downs).toEqual(['touch']);

      grabFrame(gesture, 'start');
      expect(pointer.getActiveKind()).toBe('touch');
      expect(state('touch')).toBe(InteractorState.SELECT);
      expect(panel.cancels).toEqual([]);
      pointer.dispose();
    },
  );

  it.each([
    // The grab sphere at the grabbable's front face.
    ['squeeze', new Vector3(0, 1.02, -0.48)],
    // The palm in the grabbable, the fingertip just past its far side.
    ['pinch', new Vector3(0, 0.95, -0.6)],
  ] as const)(
    'leaves the touch pointer alone when a %s grab starts while the tip touches nothing',
    (gesture, tip) => {
      const grabbable = target(new Vector3(0, 1, -0.5), undefined, {
        capture: true,
      });
      // The only pokeable, out of the touch sphere's 20 cm reach.
      const panel = target(new Vector3(0.5, 1, -0.5));
      const { pointer, scene, moveTipTo, frame, approach, grabFrame } = setup(
        { grab: [grabbable.root], touch: [panel.root] },
        gesture,
      );
      const touchEvents: string[] = [];
      for (const type of [
        'pointerover',
        'pointerenter',
        'pointerdown',
        'pointerup',
        'pointercancel',
        'pointerout',
        'pointerleave',
      ]) {
        scene.addEventListener(type as any, (e: any) => {
          if (e.pointerType === 'touch') {
            touchEvents.push(type);
          }
        });
      }

      approach(tip);
      // With nothing in reach, the touch pointer hits the scene's void
      // object, at distance 0, so its button is down.
      const touch = pointer.getPointer('touch');
      expect(touch.getIntersection()?.object.isVoidObject).toBe(true);
      expect(touch.getButtonsDown().size).toBe(1);
      touchEvents.length = 0;

      grabFrame(gesture, 'start');
      expect(grabbable.downs).toEqual(['grab']);
      for (let i = 1; i <= 5; i++) {
        moveTipTo(tip.clone().add(new Vector3(0, 0.02 * i, 0)));
        frame();
      }
      grabFrame(gesture, 'end');
      frame();
      frame();
      expect(grabbable.ups).toEqual(['grab']);
      // There is no press or hover to end, so the void object, and the scene
      // its events bubble to, get nothing: no pointercancel, pointerout or
      // pointerleave as the grab starts, and no pointerover, pointerenter or
      // pointerdown when the touch pointer moves again.
      expect(touchEvents).toEqual([]);
      pointer.dispose();
    },
  );

  it('lets the tip hover a pokeable at once after a squeeze grab that started while the tip touched nothing', () => {
    const grabbable = target(new Vector3(0, 1, -0.5), undefined, {
      capture: true,
    });
    // A pokeable button out of the touch sphere's reach when the squeeze
    // starts.
    const button = target(
      new Vector3(0.5, 1.02, -0.48),
      new Vector3(0.02, 0.1, 0.1),
    );
    const { pointer, moveTipTo, frame, approach } = setup({
      grab: [grabbable.root],
      touch: [button.root],
    });

    const tip = new Vector3(0, 1.02, -0.48);
    approach(tip);
    frame({ squeezeStart: true });
    expect(grabbable.downs).toEqual(['grab']);

    // Carry the grabbable over until the tip is 1 cm from the button, and
    // let go.
    for (let i = 1; i <= 8; i++) {
      moveTipTo(tip.clone().add(new Vector3(0.06 * i, 0, 0)));
      frame();
    }
    frame({ squeezeEnd: true });
    expect(grabbable.ups).toEqual(['grab']);

    // The squeeze cancelled no press, so the tip has no lift-off to wait
    // for: it hovers the button on the next frame.
    frame();
    expect(button.enters).toEqual(['touch']);
    pointer.dispose();
  });

  it.each([
    // 7 cm under the tip, so touch is the active pointer.
    ['touch', 0.94],
    // 17 cm under the tip: inside the touch sphere's 20 cm reach, so the
    // touch pointer hovers it, but past the 15 cm at which touch becomes the
    // active pointer, so grab already is.
    ['grab', 0.84],
  ] as const)(
    'ends the tip hover on a pokeable when a squeeze grab starts while %s is active, and hovers it again after the grab',
    (active, plateY) => {
      const grabbable = target(new Vector3(0, 1, -0.5), undefined, {
        capture: true,
      });
      const plate = target(
        new Vector3(0, plateY, -0.5),
        new Vector3(0.3, 0.02, 0.3),
      );
      const { pointer, moveTipTo, frame, approach } = setup({
        grab: [grabbable.root],
        touch: [plate.root],
      });

      const tip = new Vector3(0, 1.02, -0.48);
      approach(tip);
      expect(pointer.getActiveKind()).toBe(active);
      expect(plate.enters).toEqual(['touch']);

      frame({ squeezeStart: true });
      expect(grabbable.downs).toEqual(['grab']);
      expect(plate.leaves).toEqual(['touch']);

      // The grab's lock stops moving the touch pointer, so carrying the
      // grabbable 50 cm up sends the plate nothing more.
      for (let i = 1; i <= 10; i++) {
        moveTipTo(tip.clone().add(new Vector3(0, 0.05 * i, 0)));
        frame();
      }
      frame({ squeezeEnd: true });
      expect(grabbable.ups).toEqual(['grab']);
      expect(plate.enters).toEqual(['touch']);
      expect(plate.leaves).toEqual(['touch']);

      // Back over the plate, the tip hovers it again without lifting off
      // first, and it never pressed it.
      moveTipTo(tip);
      frame();
      expect(plate.enters).toEqual(['touch', 'touch']);
      expect(plate.downs).toEqual([]);
      pointer.dispose();
    },
  );

  it('keeps an object held by a pinch on the hand while the fingertip presses something else', () => {
    // The object lies in the palm. A pokeable button stands 30 cm to the
    // right, out of the fingertip's reach.
    const held = target(new Vector3(0, 1.05, -0.4), undefined, {
      capture: true,
    });
    const button = target(
      new Vector3(0.3, 1, -0.55),
      new Vector3(0.1, 0.1, 0.02),
    );
    const { pointer, moveTipTo, frame, grabFrame, state } = setup(
      { grab: [held.root], touch: [button.root] },
      'pinch',
    );

    moveTipTo(new Vector3(0, 1, -0.5));
    grabFrame('pinch', 'start');
    expect(held.downs).toEqual(['grab']);

    // Carry the object over to the button, and press it with the fingertip.
    for (let i = 1; i <= 15; i++) {
      moveTipTo(new Vector3(0.02 * i, 1, -0.5));
      frame();
    }
    moveTipTo(new Vector3(0.3, 1, -0.53));
    frame();
    expect(button.downs).toEqual(['touch']);
    expect(state('touch')).toBe(InteractorState.SELECT);

    // The press holds the hand's selection lock, and the grab sphere still
    // follows the hand.
    moveTipTo(new Vector3(0.3, 1.02, -0.53));
    frame();
    const grab = pointer.getPointer('grab').getIntersection()!;
    expect(grab.pointerPosition.y).toBeCloseTo(1.07);

    grabFrame('pinch', 'end');
    expect(held.ups).toEqual(['grab']);
    expect(button.cancels).toEqual([]);
    pointer.dispose();
  });

  it('keeps a ray selection when the squeeze starts next to a grabbable', () => {
    const far = target(new Vector3(0, 1, -3));
    const grabbable = target(new Vector3(0, 1, -0.5));
    const { pointer, moveTipTo, frame, state } = setup({
      grab: [grabbable.root],
      ray: [far.root],
    });

    moveTipTo(new Vector3(0, 1, 0.5));
    frame();
    frame();
    expect(pointer.getActiveKind()).toBe('ray');
    frame({ selectStart: true });
    expect(far.downs).toEqual(['ray']);

    // Walk up to the grabbable, still selecting along the ray, and squeeze.
    moveTipTo(new Vector3(0, 1.02, -0.48));
    frame();
    frame({ squeezeStart: true });
    expect(pointer.getActiveKind()).toBe('ray');
    expect(state('ray')).toBe(InteractorState.SELECT);
    expect(grabbable.downs).toEqual([]);

    frame({ selectEnd: true });
    expect(far.ups).toEqual(['ray']);
    expect(state('ray')).not.toBe(InteractorState.SELECT);
    pointer.dispose();
  });
});
