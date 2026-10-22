/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BoxGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GazeConecaster } from '../src/pointer/gaze-conecaster.js';
import {
  GazePointer,
  type GazeFrameContext,
  type GazePointerInput,
} from '../src/pointer/gaze-pointer.js';
import { XROrigin } from '../src/rig/xr-origin.js';

const REFERENCE_SPACE = {} as XRReferenceSpace;
const GAZE_TARGET_RAY_SPACE = {} as XRSpace;
const DT = 1 / 60;

/** Yaw-only rotation, the axis eye tracking moves most obviously along. */
function yaw(degrees: number): Quaternion {
  return new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    (degrees * Math.PI) / 180,
  );
}

function rigidTransform(
  position: Vector3,
  quaternion: Quaternion,
): XRRigidTransform {
  const matrix = new Matrix4().compose(
    position,
    quaternion,
    new Vector3(1, 1, 1),
  );
  return {
    matrix: new Float32Array(matrix.elements),
  } as unknown as XRRigidTransform;
}

function gazeInputSource(): XRInputSource {
  return {
    targetRayMode: 'gaze',
    targetRaySpace: GAZE_TARGET_RAY_SPACE,
    profiles: [],
    handedness: 'none',
  } as unknown as XRInputSource;
}

function handInputSource(): XRInputSource {
  return {
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {} as XRSpace,
    profiles: ['generic-hand'],
    handedness: 'left',
  } as unknown as XRInputSource;
}

function createSession(options: {
  inputSources?: XRInputSource[];
  trackedSources?: XRInputSource[];
  enabledFeatures?: string[];
}): XRSession {
  return {
    inputSources: options.inputSources ?? [],
    trackedSources: options.trackedSources,
    enabledFeatures: options.enabledFeatures ?? ['gaze-tracking'],
  } as unknown as XRSession;
}

/** @param pose Resolved pose, `null` for an invalid one, or a thrower. */
function createFrame(pose: XRPose | null | (() => never)): XRFrame {
  return {
    getPose: () => (typeof pose === 'function' ? pose() : pose),
  } as unknown as XRFrame;
}

/**
 * Something for the cone cast to chew on so a hit actually gets published.
 * Sized and placed so a straight-ahead ray from eye height hits it.
 */
function createTargets(): Object3D[] {
  const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  box.position.set(0, 1.6, -3);
  box.pointerEvents = 'auto';
  box.updateMatrixWorld(true);
  return [box];
}

/** Neutral per-frame input: no pinches, no hand pointers. */
function gazeInput(
  candidates: Object3D[],
  overrides: Partial<GazePointerInput> = {},
): GazePointerInput {
  return {
    candidates,
    pinchStart: { left: false, right: false },
    pinchEnd: { left: false, right: false },
    pinchActive: { left: false, right: false },
    directPointerActive: { left: false, right: false },
    ...overrides,
  };
}

describe('GazePointer gaze sampling', () => {
  let xrOrigin: XROrigin;
  let scene: Scene;
  let pointer: GazePointer;
  let targets: Object3D[];

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    xrOrigin = new XROrigin();
    scene = new Scene();
    scene.add(xrOrigin);
    // Disable smoothing so a single frame publishes the exact sampled pose.
    pointer = new GazePointer(xrOrigin, scene, new PerspectiveCamera(), {
      filter: { minCutoff: 10000 },
    });
    pointer.setAttached(true);
    (pointer.provider as GazeConecaster).dwellWindowSeconds = 0;
    targets = createTargets();
    targets.forEach((t) => scene.add(t));
  });

  afterEach(() => {
    delete (
      globalThis as typeof globalThis & {
        __IWSDK_TARGET_DEVICE_PREVIEW__?: unknown;
      }
    ).__IWSDK_TARGET_DEVICE_PREVIEW__;
    vi.restoreAllMocks();
  });

  /** Pose the head for gaze-vs-head diagnostics. */
  function poseHead(position: Vector3, quaternion: Quaternion): void {
    xrOrigin.head.position.copy(position);
    xrOrigin.head.quaternion.copy(quaternion);
    // Direct pointer tests below pass targetingAvailable explicitly. Mirror
    // that supplied gaze pose without reintroducing runtime fallback policy.
    xrOrigin.eyeSpace.position.copy(position);
    xrOrigin.eyeSpace.quaternion.copy(quaternion);
    xrOrigin.updateMatrixWorld(true);
  }

  function context(
    session: XRSession,
    pose: XRPose | null | (() => never),
  ): GazeFrameContext {
    return {
      frame: createFrame(pose),
      referenceSpace: REFERENCE_SPACE,
      session,
    };
  }

  /** One full manager frame: sample the gaze pose, then run the pointer. */
  function frame(
    time: number,
    session: XRSession,
    pose: XRPose | null | (() => never),
    input: GazePointerInput = gazeInput(targets),
  ): void {
    pointer.sampleGazePose(time, context(session, pose));
    xrOrigin.updateMatrixWorld(true);
    pointer.update(pointer.canTarget(), DT, time, input);
  }

  it('keeps ordinary far rays active until tracked gaze becomes available', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(0));
    expect(pointer.ownsFarTargeting(0)).toBe(false);
    expect(pointer.canTarget()).toBe(false);
  });

  it('clears an invalid gaze pose without flashing far rays', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(30));
    const session = createSession({ inputSources: [gazeInputSource()] });
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(0)),
    } as XRPose;
    pointer.trackingLossGraceSeconds = 5;

    frame(1, session, gazePose);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);
    expect(pointer.ownsFarTargeting(1)).toBe(true);
    expect(pointer.canTarget()).toBe(true);

    poseHead(new Vector3(0, 1.6, 0), yaw(30));
    pointer.sampleGazePose(2, context(session, null));
    xrOrigin.updateMatrixWorld(true);
    pointer.update(pointer.canTarget(), DT, 2, gazeInput(targets));
    expect(pointer.getGazeOrigin()).toBe('none');
    expect(pointer.getCurrentTarget()).toBeNull();
    expect(pointer.canTarget()).toBe(false);
    expect(pointer.ownsFarTargeting(2)).toBe(true);

    // If valid poses do not recover, preserve mode ownership only for the
    // configured recovery window even if the source stays enumerated.
    pointer.sampleGazePose(5.9, context(session, null));
    expect(pointer.ownsFarTargeting(5.9)).toBe(true);
    pointer.sampleGazePose(6.01, context(session, null));
    expect(pointer.ownsFarTargeting(6.01)).toBe(false);

    pointer.reset();
    expect(pointer.ownsFarTargeting(6.01)).toBe(false);
  });

  it('drives the ray from the gaze target-ray pose, not the head pose', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(0));
    const session = createSession({ inputSources: [gazeInputSource()] });
    const gazePose = {
      transform: rigidTransform(new Vector3(0.03, 1.62, 0), yaw(30)),
    } as XRPose;

    frame(1, session, gazePose);

    expect(pointer.getGazeOrigin()).toBe('tracked');
    expect(xrOrigin.gazeOrigin).toBe('tracked');
    expect(pointer.getOrigin().x).toBeCloseTo(0.03, 5);
    expect(pointer.getOrigin().y).toBeCloseTo(1.62, 5);
    // Yawing +30° about Y swings the -Z forward axis toward -X.
    const expected = new Vector3(0, 0, -1).applyQuaternion(yaw(30));
    expect(pointer.getDirection().x).toBeCloseTo(expected.x, 4);
    expect(pointer.getDirection().z).toBeCloseTo(expected.z, 4);
    expect(pointer.getDirection().x).toBeLessThan(-0.4);
  });

  it('keeps far rays active when a gaze source has no valid pose', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(15));
    const session = createSession({ inputSources: [gazeInputSource()] });

    frame(1, session, null);

    expect(pointer.getGazeOrigin()).toBe('none');
    expect(pointer.canTarget()).toBe(false);
    expect(pointer.ownsFarTargeting(1)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('returned null'),
    );
  });

  it('restores far rays immediately when the gaze source disappears', () => {
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(0)),
    } as XRPose;
    frame(1, createSession({ inputSources: [gazeInputSource()] }), gazePose);
    expect(pointer.ownsFarTargeting(1)).toBe(true);

    frame(1.01, createSession({ inputSources: [handInputSource()] }), null);

    expect(pointer.getGazeOrigin()).toBe('none');
    expect(pointer.canTarget()).toBe(false);
    expect(pointer.ownsFarTargeting(1.01)).toBe(false);
  });

  it('does not reuse grace when gaze reappears without a valid pose', () => {
    const firstSource = gazeInputSource();
    const replacementSource = gazeInputSource();
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(0)),
    } as XRPose;
    pointer.trackingLossGraceSeconds = 5;

    frame(1, createSession({ inputSources: [firstSource] }), gazePose);
    expect(pointer.ownsFarTargeting(1)).toBe(true);

    frame(1.01, createSession({ inputSources: [handInputSource()] }), null);
    expect(pointer.ownsFarTargeting(1.01)).toBe(false);

    frame(1.02, createSession({ inputSources: [replacementSource] }), null);
    expect(pointer.getGazeOrigin()).toBe('none');
    expect(pointer.canTarget()).toBe(false);
    expect(pointer.ownsFarTargeting(1.02)).toBe(false);
  });

  it('survives a throwing getPose and reports it once', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(0));
    const session = createSession({ inputSources: [gazeInputSource()] });
    const thrower = () => {
      throw new DOMException('nope', 'InvalidStateError');
    };

    expect(() => frame(1, session, thrower)).not.toThrow();
    frame(2, session, thrower);

    expect(pointer.getGazeOrigin()).toBe('none');
    const throwLogs = vi
      .mocked(console.warn)
      .mock.calls.filter(([message]) =>
        String(message).includes('getPose(gazeSource.targetRaySpace) threw'),
      );
    expect(throwLogs).toHaveLength(1);
  });

  it('finds a gaze source that only appears in trackedSources', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(0));
    const session = createSession({
      inputSources: [handInputSource()],
      trackedSources: [gazeInputSource()],
    });
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(-25)),
    } as XRPose;

    frame(1, session, gazePose);

    expect(pointer.getGazeOrigin()).toBe('tracked');
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('session.trackedSources'),
    );
  });

  it('keeps the production gaze reticle hidden while hovering', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(0));
    const session = createSession({ inputSources: [gazeInputSource()] });
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(0)),
    } as XRPose;

    frame(1, session, gazePose);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);
    expect(pointer.reticle.visible).toBe(false);
  });

  it('can show a debug reticle for live gaze', () => {
    pointer.showDebugReticle = true;
    poseHead(new Vector3(0, 1.6, 0), yaw(0));
    const session = createSession({ inputSources: [gazeInputSource()] });
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(0)),
    } as XRPose;

    frame(1, session, gazePose);
    expect(pointer.reticle.visible).toBe(true);
    expect(pointer.reticle.material.color.getHex()).toBe(0xffffff);
  });

  it('clamps invalid tracking-loss grace values at the low-level API', () => {
    pointer.trackingLossGraceSeconds = -1;
    expect(pointer.trackingLossGraceSeconds).toBe(0);

    pointer.trackingLossGraceSeconds = Number.NaN;
    expect(pointer.trackingLossGraceSeconds).toBe(0);
  });

  it('preserves an in-flight hand-driven select through an invalid gaze frame', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(0));
    const session = createSession({ inputSources: [gazeInputSource()] });
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(0)),
    } as XRPose;

    frame(1, session, gazePose, {
      ...gazeInput(targets),
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });
    expect(pointer.isSelecting()).toBe(true);

    poseHead(new Vector3(0, 1.6, 0), yaw(20));
    frame(2, session, null, {
      ...gazeInput(targets),
      pinchActive: { left: true, right: false },
    });
    expect(pointer.canTarget()).toBe(false);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);
    expect(pointer.isSelecting()).toBe(true);

    frame(3, session, null, {
      ...gazeInput(targets),
      pinchEnd: { left: true, right: false },
    });
    expect(pointer.getCurrentTarget()).toBeNull();
    expect(pointer.isSelecting()).toBe(false);
  });

  it('cancels an in-flight select when the gaze source disappears', () => {
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(0)),
    } as XRPose;
    const trackedSession = createSession({
      inputSources: [gazeInputSource()],
    });
    frame(1, trackedSession, gazePose, {
      ...gazeInput(targets),
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });
    expect(pointer.isSelecting()).toBe(true);

    frame(1.01, createSession({ inputSources: [] }), null, {
      ...gazeInput(targets),
      pinchActive: { left: true, right: false },
    });

    expect(pointer.isSelecting()).toBe(false);
    expect(pointer.getCurrentTarget()).toBeNull();
    expect(pointer.ownsFarTargeting(1.01)).toBe(false);
  });

  it('orients the reticle from world normal under a transformed XR origin', () => {
    pointer.showDebugReticle = true;
    const surface = new Object3D();
    surface.rotation.set(0.2, 0.4, -0.1);
    surface.scale.set(2, 0.5, 1.5);
    scene.add(surface);
    xrOrigin.position.set(1, 0.25, -0.5);
    xrOrigin.rotation.set(-0.15, 0.3, 0.2);
    scene.updateMatrixWorld(true);

    const localNormal = new Vector3(1, 1, 0.5).normalize();
    const point = new Vector3(0.2, 1.1, -2);
    vi.spyOn(pointer.pointer, 'getIntersection').mockReturnValue({
      distance: 2,
      normal: localNormal,
      object: surface,
      point,
    } as any);

    (pointer as any).updateReticle();
    scene.updateMatrixWorld(true);

    const actual = new Vector3(0, 0, 1).applyQuaternion(
      pointer.reticle.getWorldQuaternion(new Quaternion()),
    );
    const expected = localNormal
      .clone()
      .applyNormalMatrix(new Matrix3().getNormalMatrix(surface.matrixWorld))
      .normalize();
    expect(actual.angleTo(expected)).toBeLessThan(1e-6);
  });

  it('drops hover and select when disconnected', () => {
    poseHead(new Vector3(0, 1.6, 0), yaw(0));
    const session = createSession({ inputSources: [gazeInputSource()] });
    const gazePose = {
      transform: rigidTransform(new Vector3(0, 1.6, 0), yaw(0)),
    } as XRPose;
    frame(1, session, gazePose);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);

    pointer.update(false, DT, 2, gazeInput(targets));

    expect(pointer.getCurrentTarget()).toBeNull();
    expect(pointer.reticle.visible).toBe(false);
  });

  it('commits the cone winner instead of an unrelated object on the raw ray', () => {
    const aimed = new Mesh(
      new BoxGeometry(0.2, 0.2, 0.2),
      new MeshBasicMaterial(),
    );
    aimed.position.set(0.25, 1.6, -3);
    aimed.pointerEvents = 'auto';
    const rawRayOccluder = new Mesh(
      new BoxGeometry(0.2, 0.2, 0.2),
      new MeshBasicMaterial(),
    );
    rawRayOccluder.position.set(0, 1.6, -1);
    rawRayOccluder.pointerEvents = 'auto';
    scene.add(aimed, rawRayOccluder);
    scene.updateMatrixWorld(true);
    poseHead(new Vector3(0, 1.6, 0), yaw(0));

    pointer.update(true, DT, 0, gazeInput([aimed]));

    expect(pointer.getCurrentTarget()).toBe(aimed);
    expect(pointer.pointer.getIntersection()?.object).toBe(aimed);
  });

  it('preserves the actionable leaf and UV from the scoped ray intersection', () => {
    const root = new Object3D();
    root.pointerEvents = 'auto';
    const leaf = new Mesh(new BoxGeometry(1, 1, 0.1), new MeshBasicMaterial());
    leaf.position.set(0, 1.6, -3);
    root.add(leaf);
    scene.add(root);
    scene.updateMatrixWorld(true);
    poseHead(new Vector3(0, 1.6, 0), yaw(0));

    pointer.update(true, DT, 0, gazeInput([root]));

    const intersection = pointer.pointer.getIntersection();
    expect(pointer.getCurrentTarget()).toBe(root);
    expect(intersection?.object).toBe(leaf);
    expect(intersection?.uv).toBeDefined();
    expect(intersection?.localPoint).toBeDefined();
  });

  it('ignores pointer-events-disabled decoration inside a candidate', () => {
    const root = new Object3D();
    root.pointerEvents = 'auto';
    const decoration = new Mesh(
      new BoxGeometry(0.8, 0.8, 0.1),
      new MeshBasicMaterial(),
    );
    decoration.position.set(0, 1.6, -2.5);
    decoration.pointerEvents = 'none';
    const actionable = new Mesh(
      new BoxGeometry(0.6, 0.6, 0.1),
      new MeshBasicMaterial(),
    );
    actionable.position.set(0, 1.6, -3);
    actionable.pointerEvents = 'auto';
    root.add(decoration, actionable);
    scene.add(root);
    scene.updateMatrixWorld(true);
    poseHead(new Vector3(0, 1.6, 0), yaw(0));

    pointer.update(true, DT, 0, gazeInput([root]));

    expect(pointer.pointer.getIntersection()?.object).toBe(actionable);
  });

  it('supports opting out of gaze through pointer state without a new pointer type', () => {
    const target = targets[0];
    target.pointerEventsType = (_pointerId, pointerType, pointerState) =>
      pointerType !== 'ray' ||
      (pointerState as { source?: string } | undefined)?.source !== 'gaze';
    poseHead(new Vector3(0, 1.6, 0), yaw(0));

    pointer.update(true, DT, 0, gazeInput([target]));

    expect(pointer.getCurrentTarget()).toBeNull();
    expect(pointer.pointer.getIntersection()?.object.isVoidObject).toBe(true);
  });
});

describe('GazePointer selector', () => {
  let xrOrigin: XROrigin;
  let scene: Scene;
  let pointer: GazePointer;
  let targets: Object3D[];

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    xrOrigin = new XROrigin();
    scene = new Scene();
    scene.add(xrOrigin);
    pointer = new GazePointer(xrOrigin, scene, new PerspectiveCamera(), {
      filter: { minCutoff: 10000 },
      diagnostics: false,
    });
    pointer.setAttached(true);
    (pointer.provider as GazeConecaster).dwellWindowSeconds = 0;
    targets = createTargets();
    targets.forEach((t) => scene.add(t));
    xrOrigin.eyeSpace.position.set(0, 1.6, 0);
    xrOrigin.gazeOrigin = 'tracked';
    xrOrigin.updateMatrixWorld(true);
  });

  afterEach(() => {
    delete (
      globalThis as typeof globalThis & {
        __IWSDK_TARGET_DEVICE_PREVIEW__?: unknown;
      }
    ).__IWSDK_TARGET_DEVICE_PREVIEW__;
    vi.restoreAllMocks();
  });

  function step(time: number, overrides: Partial<GazePointerInput> = {}): void {
    xrOrigin.updateMatrixWorld(true);
    pointer.update(true, DT, time, gazeInput(targets, overrides));
  }

  it('ignores a candidate beneath an invisible ancestor', () => {
    const parent = new Object3D();
    scene.add(parent);
    parent.add(targets[0]);
    parent.visible = false;

    step(0);

    expect(pointer.getCurrentTarget()).toBeNull();
    expect(pointer.pointer.getIntersection()?.object.isVoidObject).toBe(true);
  });

  it('commits a select on pinch start and holds it until that hand releases', () => {
    const down = vi.spyOn(pointer.pointer, 'down');
    const up = vi.spyOn(pointer.pointer, 'up');
    step(0);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);

    step(1, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });
    expect(down).toHaveBeenCalledTimes(1);
    expect(pointer.isSelecting()).toBe(true);
    expect(pointer.getHeldByHand()).toBe('left');

    // A pinch on the other hand mid-select is ignored.
    step(2, {
      pinchStart: { left: false, right: true },
      pinchActive: { left: true, right: true },
    });
    expect(pointer.getHeldByHand()).toBe('left');
    expect(down).toHaveBeenCalledTimes(1);

    step(3, {
      pinchEnd: { left: true, right: false },
      pinchActive: { left: false, right: true },
    });
    expect(up).toHaveBeenCalledTimes(1);
    expect(pointer.isSelecting()).toBe(false);
    expect(pointer.getHeldByHand()).toBeNull();
  });

  it('does not transfer selection to the other hand on the release frame', () => {
    const down = vi.spyOn(pointer.pointer, 'down');
    step(0);
    step(0.05, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });

    step(0.1, {
      pinchStart: { left: false, right: true },
      pinchEnd: { left: true, right: false },
      pinchActive: { left: false, right: true },
    });

    expect(pointer.isSelecting()).toBe(false);
    expect(pointer.getHeldByHand()).toBeNull();
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('cancels when the holding hand goes inactive without a discrete edge', () => {
    const cancel = vi.fn();
    const leave = vi.fn();
    const up = vi.fn();
    const click = vi.fn();
    targets[0].addEventListener('pointercancel', cancel);
    targets[0].addEventListener('pointerleave', leave);
    targets[0].addEventListener('pointerup', up);
    targets[0].addEventListener('click', click);
    step(0);
    step(1, {
      pinchStart: { left: false, right: true },
      pinchActive: { left: false, right: true },
    });
    expect(pointer.getHeldByHand()).toBe('right');

    // Tracking loss: no pinchEnd edge, just an inactive hand.
    step(2);
    expect(pointer.isSelecting()).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(up).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(pointer.pointer.getButtonsDown().size).toBe(0);
  });

  it('cancels a held select when its ray target is removed', () => {
    const cancel = vi.fn();
    const click = vi.fn();
    targets[0].addEventListener('pointercancel', cancel);
    targets[0].addEventListener('click', click);
    step(0);
    step(0.05, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });
    expect(pointer.isSelecting()).toBe(true);

    pointer.update(
      true,
      DT,
      0.1,
      gazeInput([], {
        pinchActive: { left: true, right: false },
      }),
    );

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(pointer.isSelecting()).toBe(false);
    expect(pointer.pointer.getIntersection()?.object.isVoidObject).toBe(true);
  });

  it('cancels a held select when an ancestor becomes hidden', () => {
    const parent = new Object3D();
    scene.add(parent);
    parent.add(targets[0]);
    const cancel = vi.fn();
    const click = vi.fn();
    targets[0].addEventListener('pointercancel', cancel);
    targets[0].addEventListener('click', click);
    step(0);
    step(0.05, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });

    parent.visible = false;
    step(0.1, {
      pinchActive: { left: true, right: false },
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(pointer.isSelecting()).toBe(false);
    expect(pointer.pointer.getIntersection()?.object.isVoidObject).toBe(true);
  });

  it('cancels before disabling during reset', () => {
    const cancel = vi.fn();
    const click = vi.fn();
    targets[0].addEventListener('pointercancel', cancel);
    targets[0].addEventListener('click', click);
    step(0);
    step(0.05, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });

    pointer.reset();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(pointer.pointer.getButtonsDown().size).toBe(0);
    expect(pointer.pointer.getEnabled()).toBe(false);
  });

  it('does not commit a select with nothing under the gaze', () => {
    pointer.update(
      true,
      DT,
      0,
      gazeInput([], {
        pinchStart: { left: true, right: false },
        pinchActive: { left: true, right: false },
      }),
    );

    expect(pointer.isSelecting()).toBe(false);
    expect(pointer.pointer.getButtonsDown().size).toBe(0);
  });

  it('suppresses hover while a direct pointer is active', () => {
    step(0);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);

    step(1, { directPointerActive: { left: true, right: false } });
    expect(pointer.getCurrentTarget()).toBeNull();
    expect(pointer.reticle.visible).toBe(false);

    step(2);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);
  });

  it('keeps an in-flight select alive when a hand pointer becomes active', () => {
    step(0);
    step(1, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });
    step(2, {
      pinchActive: { left: true, right: false },
      directPointerActive: { left: true, right: false },
    });

    expect(pointer.isSelecting()).toBe(true);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);
  });

  it('uses the selecting hand ray origin before a target captures', () => {
    const target = targets[0];
    target.addEventListener('pointerdown', (event: any) => {
      target.setPointerCapture(event.pointerId);
    });
    xrOrigin.raySpaces.right.position.set(0.25, 1.2, 0);
    step(0);
    const gazePoint = pointer.pointer.getIntersection()!.point.clone();

    step(0.05, {
      pinchStart: { left: false, right: true },
      pinchActive: { left: false, right: true },
    });

    const handOrigin = xrOrigin.raySpaces.right.getWorldPosition(new Vector3());
    const selected = pointer.pointer.getIntersection()!;
    expect(pointer.pointer.getPointerCapture()?.object).toBe(target);
    expect(selected.pointerPosition.distanceTo(handOrigin)).toBeLessThan(1e-6);
    expect(selected.point.distanceTo(gazePoint)).toBeLessThan(1e-5);
    expect(pointer.pointerState).toEqual({
      source: 'gaze',
      handedness: 'right',
    });

    xrOrigin.raySpaces.right.position.x += 0.1;
    step(0.1, {
      pinchActive: { left: false, right: true },
      directPointerActive: { left: false, right: true },
    });
    expect(pointer.isSelecting()).toBe(true);
    expect(pointer.pointer.getIntersection()!.pointerPosition.x).toBeCloseTo(
      handOrigin.x + 0.1,
    );
  });

  it('keeps non-capturing targets latched until click', () => {
    const click = vi.fn();
    targets[0].addEventListener('click', click);
    xrOrigin.raySpaces.left.position.set(-0.2, 1.2, 0);
    step(0);

    step(0.05, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });
    xrOrigin.raySpaces.left.position.x = 1;
    step(0.1, {
      pinchActive: { left: true, right: false },
    });
    step(0.2, {
      pinchEnd: { left: true, right: false },
      pinchActive: { left: false, right: false },
    });

    expect(click).toHaveBeenCalledTimes(1);
    expect(pointer.getCurrentTarget()).toBe(targets[0]);
    expect(pointer.pointer.getIntersection()?.object).toBe(targets[0]);
  });

  it('keeps an eye-origin ray when pointerTransformFollowsHand is false', () => {
    pointer.pointerTransformFollowsHand = false;
    step(0);
    const eyeOrigin = pointer.getOrigin().clone();
    step(0.05, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });

    expect(pointer.isSelecting()).toBe(true);
    expect(
      pointer.pointer.getIntersection()!.pointerPosition.distanceTo(eyeOrigin),
    ).toBeLessThan(1e-6);
  });

  it('dispatches selection through its own ray pointer', () => {
    const down = vi.spyOn(pointer.pointer, 'down');
    const move = vi.fn();
    const eventState = vi.fn();
    targets[0].addEventListener('pointermove', move);
    targets[0].addEventListener('pointerdown', (event: any) => {
      eventState(event.pointerType, event.pointerState);
    });

    step(0);
    move.mockClear();
    step(0.05, {
      pinchStart: { left: true, right: false },
      pinchActive: { left: true, right: false },
    });

    expect(pointer.isSelecting()).toBe(true);
    expect(down).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    expect(eventState).toHaveBeenCalledWith('ray', {
      source: 'gaze',
      handedness: 'left',
    });
  });
});

describe('GazePointer diagnostics', () => {
  let xrOrigin: XROrigin;
  let scene: Scene;
  let pointer: GazePointer;
  let targets: Object3D[];

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    xrOrigin = new XROrigin();
    scene = new Scene();
    scene.add(xrOrigin);
    pointer = new GazePointer(xrOrigin, scene, new PerspectiveCamera());
    pointer.setAttached(true);
    (pointer.provider as GazeConecaster).dwellWindowSeconds = 0;
    targets = createTargets();
    targets.forEach((t) => scene.add(t));
  });

  afterEach(() => {
    delete (
      globalThis as typeof globalThis & {
        __IWSDK_TARGET_DEVICE_PREVIEW__?: unknown;
      }
    ).__IWSDK_TARGET_DEVICE_PREVIEW__;
    delete (
      globalThis as typeof globalThis & {
        __IWSDK_EMULATION_PROFILE?: unknown;
      }
    ).__IWSDK_EMULATION_PROFILE;
    vi.restoreAllMocks();
  });

  function warnings(): string[] {
    return vi.mocked(console.warn).mock.calls.map(([m]) => String(m));
  }

  function infos(): string[] {
    return vi.mocked(console.info).mock.calls.map(([m]) => String(m));
  }

  /** Run `frames` frames at 60 Hz with a fixed gaze/head relationship. */
  function run(
    session: XRSession,
    frames: number,
    gazeQuaternion: (frame: number) => Quaternion | null,
    candidates: Object3D[] = targets,
  ): void {
    for (let i = 0; i < frames; i++) {
      const time = i / 60;
      xrOrigin.head.position.set(0, 1.6, 0);
      xrOrigin.head.quaternion.identity();
      const quaternion = gazeQuaternion(i);
      const pose = quaternion
        ? ({
            transform: rigidTransform(new Vector3(0, 1.6, 0), quaternion),
          } as XRPose)
        : null;
      pointer.sampleGazePose(time, {
        frame: createFrame(pose),
        referenceSpace: REFERENCE_SPACE,
        session,
      });
      xrOrigin.updateMatrixWorld(true);
      pointer.update(true, DT, time, gazeInput(candidates));
    }
  }

  it("warns once when 'gaze-tracking' was not granted", () => {
    run(createSession({ enabledFeatures: ['local-floor'] }), 5, () => null);

    const notGranted = warnings().filter((m) => m.includes('NOT granted'));
    expect(notGranted).toHaveLength(1);
    expect(notGranted[0]).toContain('xr.features.gazeTracking');
  });

  it('warns when no gaze source shows up within the grace period', () => {
    run(createSession({ inputSources: [handInputSource()] }), 240, () => null);

    expect(
      warnings().filter((m) => m.includes('targetRayMode === "gaze"')),
    ).toHaveLength(1);
  });

  it('flags a runtime that maps the gaze target ray onto the head pose', () => {
    run(
      createSession({ inputSources: [gazeInputSource()] }),
      240,
      () => new Quaternion(),
    );

    const headLocked = warnings().filter((m) =>
      m.includes('XRTargetRaySpace onto the head pose'),
    );
    expect(headLocked).toHaveLength(1);
    expect(headLocked[0]).toContain('100% of');
  });

  it('recognizes intentionally head-directed target-device preview gaze', () => {
    (
      globalThis as typeof globalThis & {
        __IWSDK_TARGET_DEVICE_PREVIEW__?: unknown;
      }
    ).__IWSDK_TARGET_DEVICE_PREVIEW__ = {
      active: true,
      gazeSimulation: 'head',
    };

    run(
      createSession({ inputSources: [gazeInputSource()] }),
      240,
      () => new Quaternion(),
    );

    expect(
      infos().filter((m) =>
        m.includes('intentionally providing head-directed'),
      ),
    ).toHaveLength(1);
    expect(
      warnings().filter((m) =>
        m.includes('XRTargetRaySpace onto the head pose'),
      ),
    ).toHaveLength(0);
  });

  it('does not report emulated gaze as eye data or a head-locked runtime', () => {
    (
      globalThis as typeof globalThis & {
        __IWSDK_EMULATION_PROFILE?: unknown;
      }
    ).__IWSDK_EMULATION_PROFILE = {
      active: true,
      device: 'metaVRGlasses',
      runtime: 'IWER',
    };

    run(
      createSession({ inputSources: [gazeInputSource()] }),
      240,
      () => new Quaternion(),
    );

    expect(
      infos().filter((m) => m.includes('emulated gaze pose is valid')),
    ).toHaveLength(1);
    expect(infos().filter((m) => m.includes('real gaze data'))).toHaveLength(0);
    expect(
      infos().filter((m) => m.includes('emulated gaze still points')),
    ).toHaveLength(1);
    expect(
      warnings().filter((m) =>
        m.includes('XRTargetRaySpace onto the head pose'),
      ),
    ).toHaveLength(0);
  });

  it('does not report a disconnected gaze source as one that never appeared', () => {
    const gaze = gazeInputSource();
    const inputSources = [gaze];
    const session = createSession({ inputSources });
    run(session, 30, () => new Quaternion());
    inputSources.length = 0;
    run(session, 240, () => null);

    expect(
      warnings().filter((m) => m.includes('XRInputSource disappeared')),
    ).toHaveLength(1);
    expect(
      warnings().filter((m) => m.includes('targetRayMode === "gaze"')),
    ).toHaveLength(0);
  });

  it('reports a pass once the gaze ray separates from the head ray', () => {
    run(createSession({ inputSources: [gazeInputSource()] }), 240, (frame) =>
      yaw(frame < 30 ? 0 : 12),
    );

    expect(
      infos().filter((m) => m.includes('real eye movement observed')),
    ).toHaveLength(1);
    expect(
      warnings().filter((m) =>
        m.includes('XRTargetRaySpace onto the head pose'),
      ),
    ).toHaveLength(0);
  });

  it('reports when no ray-interactable targets are available', () => {
    run(
      createSession({ inputSources: [gazeInputSource()] }),
      1,
      () => null,
      [],
    );

    expect(
      infos().filter((m) => m.includes('no ray-interactable targets')),
    ).toHaveLength(1);
  });

  it('re-reports the verdict for a fresh session after reset', () => {
    const session = createSession({ enabledFeatures: ['local-floor'] });
    run(session, 5, () => null);
    pointer.reset();
    run(session, 5, () => null);

    expect(warnings().filter((m) => m.includes('NOT granted'))).toHaveLength(2);
  });
});
