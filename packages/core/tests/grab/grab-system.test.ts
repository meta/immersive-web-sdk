/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { GazeConecaster, GazePointer, XROrigin } from '@iwsdk/xr-input';
import type { HandleStore } from '@pmndrs/handle';
import { signal } from '@preact/signals-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelGrabHandle,
  findHolderHand,
} from '../../src/grab/grab-helpers.js';
import { GrabSystem } from '../../src/grab/grab-system.js';
import {
  hasRaycastableMesh,
  resetGrabWarningStateForTests,
  warnIfNoRaycastableMesh,
} from '../../src/grab/grab-warnings.js';
import { DistanceGrabHandle, MovementMode } from '../../src/grab/handles.js';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} from '../../src/runtime/three.js';

interface FakeHandle {
  inputState: Map<number, unknown>;
  cancelled: boolean;
  cancel(): void;
}

function makeFakeHandle(activePointerIds: number[] = []): FakeHandle {
  const inputState = new Map<number, unknown>();
  for (const id of activePointerIds) {
    inputState.set(id, {});
  }
  return {
    inputState,
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
  };
}

function makeFakeEntity(index: number, object3D: Object3D) {
  return { index, object3D };
}

describe('cancelGrabHandle (backs GrabSystem.forceRelease)', () => {
  it('cancels the handle when present', () => {
    const handle = makeFakeHandle([10]);
    cancelGrabHandle(handle as unknown as HandleStore<unknown>);
    expect(handle.cancelled).toBe(true);
  });

  it('is a no-op when handle is undefined', () => {
    expect(() => cancelGrabHandle(undefined)).not.toThrow();
  });

  it('swallows errors thrown by the underlying cancel()', () => {
    const handle = {
      inputState: new Map<number, unknown>([[10, {}]]),
      cancel() {
        throw new Error('boom');
      },
    };
    expect(() =>
      cancelGrabHandle(handle as unknown as HandleStore<unknown>),
    ).not.toThrow();
  });
});

describe('findHolderHand (backs GrabSystem.getHolderHand)', () => {
  // Hand ↔ pointer-ID map mirrors the wiring in GrabSystem.getHolderHand:
  // each hand contributes both its `grab` and `ray` sub-pointer IDs so that
  // near grabs (grab pointer) and distance grabs (ray pointer) both report.
  const LEFT_GRAB = 10;
  const LEFT_RAY = 11;
  const RIGHT_GRAB = 20;
  const RIGHT_RAY = 21;
  const GAZE_RAY = 30;
  const left = [LEFT_GRAB, LEFT_RAY];
  const right = [RIGHT_GRAB, RIGHT_RAY];

  it('returns null when handle is undefined', () => {
    expect(findHolderHand(undefined, left, right)).toBeNull();
  });

  it('returns null when the handle has no active grabs', () => {
    const handle = makeFakeHandle([]);
    expect(
      findHolderHand(handle as unknown as HandleStore<unknown>, left, right),
    ).toBeNull();
  });

  it("returns 'left' when a left grab pointer ID is in inputState", () => {
    const handle = makeFakeHandle([LEFT_GRAB]);
    expect(
      findHolderHand(handle as unknown as HandleStore<unknown>, left, right),
    ).toBe('left');
  });

  it("returns 'right' when a right grab pointer ID is in inputState", () => {
    const handle = makeFakeHandle([RIGHT_GRAB]);
    expect(
      findHolderHand(handle as unknown as HandleStore<unknown>, left, right),
    ).toBe('right');
  });

  it("returns 'left' for a left-hand distance grab (ray pointer)", () => {
    const handle = makeFakeHandle([LEFT_RAY]);
    expect(
      findHolderHand(handle as unknown as HandleStore<unknown>, left, right),
    ).toBe('left');
  });

  it("returns 'right' for a right-hand distance grab (ray pointer)", () => {
    const handle = makeFakeHandle([RIGHT_RAY]);
    expect(
      findHolderHand(handle as unknown as HandleStore<unknown>, left, right),
    ).toBe('right');
  });

  it("prefers 'left' when both hands are active (two-hand grab)", () => {
    const handle = makeFakeHandle([LEFT_GRAB, RIGHT_GRAB]);
    expect(
      findHolderHand(handle as unknown as HandleStore<unknown>, left, right),
    ).toBe('left');
  });

  it('returns null when only an unrelated pointer ID is in inputState', () => {
    const handle = makeFakeHandle([99]);
    expect(
      findHolderHand(handle as unknown as HandleStore<unknown>, left, right),
    ).toBeNull();
  });

  it('maps a gaze ray capture back to the selecting hand', () => {
    const handle = makeFakeHandle([GAZE_RAY]);
    expect(
      findHolderHand(
        handle as unknown as HandleStore<unknown>,
        left,
        right,
        GAZE_RAY,
        'right',
      ),
    ).toBe('right');
  });
});

type Handedness = 'left' | 'right';

// Runs GrabSystem.update() against a fake input manager whose left input
// source reports one select edge this frame.
function runPinchForwarding(options: {
  deviceType: 'controller' | 'hand';
  edge: 'start' | 'end';
  hasGamepad: boolean;
  useHandPinchForGrab?: boolean;
}) {
  const routed: string[] = [];
  const select = {
    start: options.edge === 'start',
    end: options.edge === 'end',
    active: options.edge === 'start',
  };
  const idle = { start: false, end: false, active: false };
  const createMultiPointer = (handedness: Handedness) => ({
    routeDown: (kind: string, target: string, event: { timeStamp: number }) =>
      routed.push(`${handedness}:down:${kind}->${target}@${event.timeStamp}`),
    routeUp: (kind: string, target: string, event: { timeStamp: number }) =>
      routed.push(`${handedness}:up:${kind}->${target}@${event.timeStamp}`),
  });
  const system = {
    config: {
      useHandPinchForGrab: signal(
        options.useHandPinchForGrab ??
          GrabSystem.schema.useHandPinchForGrab.default,
      ),
    },
    input: {
      xr: {
        // Hand sources that follow WebXR Hand Input expose no Gamepad; their
        // select edges come from session select events.
        gamepads: {
          left: options.hasGamepad
            ? {
                getSelectStart: () => select.start,
                getSelectEnd: () => select.end,
              }
            : undefined,
          right: undefined,
        },
        getSelectState: (handedness: Handedness) =>
          handedness === 'left' ? select : idle,
        isPrimary: (deviceType: string, handedness: Handedness) =>
          deviceType === options.deviceType && handedness === 'left',
        multiPointers: {
          left: createMultiPointer('left'),
          right: createMultiPointer('right'),
        },
      },
    },
    queries: { handles: { entities: [] } },
  };
  GrabSystem.prototype.update.call(system as any, 1 / 60, 2);
  return routed;
}

describe('GrabSystem hand pinch forwarding', () => {
  it.each([true, false])(
    'routes hand pinch to the grab pointer by default (hand has Gamepad: %s)',
    (hasGamepad) => {
      expect(
        runPinchForwarding({ deviceType: 'hand', edge: 'start', hasGamepad }),
      ).toEqual(['left:down:squeeze->grab@2000']);
      expect(
        runPinchForwarding({ deviceType: 'hand', edge: 'end', hasGamepad }),
      ).toEqual(['left:up:squeeze->grab@2000']);
    },
  );

  it('does not route hand pinch when useHandPinchForGrab is false', () => {
    for (const hasGamepad of [true, false]) {
      for (const edge of ['start', 'end'] as const) {
        expect(
          runPinchForwarding({
            deviceType: 'hand',
            edge,
            hasGamepad,
            useHandPinchForGrab: false,
          }),
        ).toEqual([]);
      }
    }
  });

  it('does not route controller trigger presses to the grab pointer', () => {
    expect(
      runPinchForwarding({
        deviceType: 'controller',
        edge: 'start',
        hasGamepad: true,
        useHandPinchForGrab: true,
      }),
    ).toEqual([]);
  });
});

function createGazeDistanceGrabFixture() {
  const scene = new Scene();
  const xrOrigin = new XROrigin();
  scene.add(xrOrigin);
  xrOrigin.head.position.set(0, 1.6, 0);
  xrOrigin.raySpaces.left.position.set(-0.2, 1.2, 0);
  xrOrigin.eyeSpace.position.copy(xrOrigin.head.position);
  xrOrigin.gazeOrigin = 'tracked';

  const target = new Mesh(
    new BoxGeometry(0.4, 0.4, 0.4),
    new MeshBasicMaterial(),
  );
  target.position.set(0, 1.6, -3);
  target.pointerEventsType = { deny: 'grab' };
  scene.add(target);
  scene.updateMatrixWorld(true);

  const handle = new DistanceGrabHandle(
    target,
    scene,
    () => ({
      rotate: false,
      translate: true,
      scale: false,
      projectRays: false,
    }),
    MovementMode.MoveFromTarget,
    false,
    0.1,
    new Vector3(),
    new Quaternion(),
    false,
  );
  const unbind = handle.bind(target);
  const gaze = new GazePointer(xrOrigin, scene, new PerspectiveCamera(), {
    diagnostics: false,
    filter: { minCutoff: 10000 },
  });
  gaze.setAttached(true);
  (gaze.provider as GazeConecaster).dwellWindowSeconds = 0;
  const input = {
    candidates: [target],
    pinchStart: { left: false, right: false },
    pinchEnd: { left: false, right: false },
    pinchActive: { left: false, right: false },
    directPointerActive: { left: false, right: false },
  };

  return { gaze, handle, input, scene, target, unbind, xrOrigin };
}

describe('gaze ray distance-grab integration', () => {
  it('captures the gaze pointer directly and releases it normally', () => {
    const { gaze, handle, input, target, unbind } =
      createGazeDistanceGrabFixture();

    gaze.update(true, 1 / 60, 0, input);
    input.pinchStart.left = true;
    input.pinchActive.left = true;
    gaze.update(true, 1 / 60, 0.05, input);

    const selectedPoint = gaze.pointer.getIntersection()!.point.clone();
    expect(handle.inputState.has(gaze.pointer.id)).toBe(true);
    expect(gaze.pointer.getPointerCapture()?.object).toBe(target);
    expect(
      findHolderHand(handle, [], [], gaze.pointer.id, gaze.getHeldByHand()),
    ).toBe('left');

    input.pinchStart.left = false;
    gaze.update(true, 1 / 60, 0.1, input);
    expect(
      gaze.pointer.getIntersection()!.point.distanceTo(selectedPoint),
    ).toBeLessThan(1e-5);

    input.pinchEnd.left = true;
    input.pinchActive.left = false;
    gaze.update(true, 1 / 60, 0.15, input);
    expect(handle.inputState.size).toBe(0);

    unbind();
    gaze.dispose();
  });

  it('releases a captured distance grab when the pointer is cancelled', () => {
    const { gaze, handle, input, unbind } = createGazeDistanceGrabFixture();

    gaze.update(true, 1 / 60, 0, input);
    input.pinchStart.left = true;
    input.pinchActive.left = true;
    gaze.update(true, 1 / 60, 0.05, input);
    expect(handle.inputState.has(gaze.pointer.id)).toBe(true);

    gaze.pointer.cancel({ timeStamp: 100 });

    expect(handle.inputState.size).toBe(0);
    expect(gaze.pointer.getPointerCapture()).toBeUndefined();

    unbind();
    gaze.dispose();
  });

  it('keeps the other pointer captured when one distance-grab pointer is cancelled', () => {
    const { gaze, handle, input, scene, unbind, xrOrigin } =
      createGazeDistanceGrabFixture();
    const otherGaze = new GazePointer(
      xrOrigin,
      scene,
      new PerspectiveCamera(),
      {
        diagnostics: false,
        filter: { minCutoff: 10000 },
      },
    );
    otherGaze.setAttached(true);
    (otherGaze.provider as GazeConecaster).dwellWindowSeconds = 0;
    const otherInput = {
      ...input,
      pinchStart: { left: false, right: false },
      pinchEnd: { left: false, right: false },
      pinchActive: { left: false, right: false },
    };

    gaze.update(true, 1 / 60, 0, input);
    input.pinchStart.left = true;
    input.pinchActive.left = true;
    gaze.update(true, 1 / 60, 0.05, input);
    otherGaze.update(true, 1 / 60, 0, otherInput);
    otherInput.pinchStart.right = true;
    otherInput.pinchActive.right = true;
    otherGaze.update(true, 1 / 60, 0.05, otherInput);
    expect(handle.inputState.size).toBe(2);

    gaze.pointer.cancel({ timeStamp: 100 });

    expect(handle.inputState.has(gaze.pointer.id)).toBe(false);
    expect(handle.inputState.has(otherGaze.pointer.id)).toBe(true);

    unbind();
    gaze.dispose();
    otherGaze.dispose();
  });
});

describe('grab warnings', () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetGrabWarningStateForTests();
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    resetGrabWarningStateForTests();
  });

  it('detects a raycastable mesh in an Object3D subtree', () => {
    const root = new Object3D();
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));

    expect(hasRaycastableMesh(root)).toBe(true);
  });

  it('detects when an Object3D subtree has no raycastable mesh', () => {
    const root = new Object3D();
    root.add(new Object3D());

    expect(hasRaycastableMesh(root)).toBe(false);
  });

  it('does not count runtime-only meshes such as ground shadows', () => {
    const root = new Object3D();
    const blob = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    blob.userData.iwsdkRuntimeOnly = true;
    root.add(blob);

    expect(hasRaycastableMesh(root)).toBe(false);
  });

  it('warns once when a grabbable entity has no raycastable mesh', () => {
    const root = new Object3D();

    warnIfNoRaycastableMesh(makeFakeEntity(7, root), 'OneHandGrabbable');
    warnIfNoRaycastableMesh(makeFakeEntity(7, root), 'OneHandGrabbable');

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "[IWSDK] Entity #7 has OneHandGrabbable but no raycastable mesh in its Object3D subtree. Grab will not work. Attach a Mesh as a child or to the entity's root Object3D.",
    );
  });

  it('includes the Object3D name when available', () => {
    const root = new Object3D();
    root.name = 'Grab Anchor';

    warnIfNoRaycastableMesh(makeFakeEntity(12, root), 'DistanceGrabbable');

    expect(consoleWarn).toHaveBeenCalledWith(
      '[IWSDK] Entity "Grab Anchor" (index 12) has DistanceGrabbable but no raycastable mesh in its Object3D subtree. Grab will not work. Attach a Mesh as a child or to the entity\'s root Object3D.',
    );
  });

  it('does not warn when a grabbable entity has a raycastable mesh', () => {
    const root = new Object3D();
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));

    warnIfNoRaycastableMesh(makeFakeEntity(7, root), 'TwoHandsGrabbable');

    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
