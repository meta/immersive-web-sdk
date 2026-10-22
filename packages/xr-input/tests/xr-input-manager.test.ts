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
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebXRManager,
} from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InputLayout } from '../src/gamepad/input-profiles.js';
import type { XRAssetLoader } from '../src/xr-input-manager.js';

type XRInputManagerConstructor =
  typeof import('../src/xr-input-manager.js').XRInputManager;
type XRInputManagerInstance = InstanceType<XRInputManagerConstructor>;
type XRHandVisualAdapterConstructor =
  typeof import('../src/visual/adapter/hand-visual-adapter.js').XRHandVisualAdapter;

let XRInputManager: XRInputManagerConstructor;
let XRHandVisualAdapter: XRHandVisualAdapterConstructor;
let InteractorState: typeof import('../src/pointer/multi-pointer.js').InteractorState;

beforeAll(async () => {
  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== 'canvas') {
        throw new Error(`Unexpected element created in test: ${tagName}`);
      }
      return createMockCanvas();
    }),
  });

  ({ XRInputManager } = await import('../src/xr-input-manager.js'));
  ({ XRHandVisualAdapter } = await import(
    '../src/visual/adapter/hand-visual-adapter.js'
  ));
  ({ InteractorState } = await import('../src/pointer/multi-pointer.js'));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('XRInputManager pointer visuals', () => {
  it('hides ray and cursor visuals immediately after construction', () => {
    const manager = createManager();
    const rays = getRayMeshes(manager);
    const cursors = getCursorMeshes(manager);

    expect(rays).toHaveLength(2);
    expect(cursors).toHaveLength(2);
    for (const ray of rays) {
      expect(ray.visible).toBe(false);
      expect((ray.material as ShaderMaterial).uniforms.opacity.value).toBe(0);
    }
    for (const cursor of cursors) {
      expect(cursor.visible).toBe(false);
    }
  });

  it('keeps pointer visuals hidden when there is no XR session', () => {
    const manager = createManager();
    const rays = getRayMeshes(manager);
    const cursors = getCursorMeshes(manager);

    for (const visual of [...rays, ...cursors]) {
      visual.visible = true;
    }

    manager.update(createNoSessionXRManager(), 1 / 60, 1);

    for (const visual of [...rays, ...cursors]) {
      expect(visual.visible).toBe(false);
    }
  });

  it('reports pointer disable failures once per failure run and continues cleanup', () => {
    const manager = createManager();
    const internal = manager as any;
    const leftFailure = new Error('left pointer failed');
    const gazeFailure = new Error('gaze pointer failed');
    const leftUpdate = vi
      .spyOn(manager.multiPointers.left, 'update')
      .mockImplementation(() => {
        throw leftFailure;
      });
    const rightUpdate = vi
      .spyOn(manager.multiPointers.right, 'update')
      .mockImplementation(() => {});
    const gazeUpdate = vi
      .spyOn(manager.gazePointer, 'update')
      .mockImplementation(() => {
        throw gazeFailure;
      });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    internal.disablePointers(7);
    internal.disablePointers(8);

    expect(leftUpdate).toHaveBeenCalledWith(false, 0, 7);
    expect(rightUpdate).toHaveBeenCalledWith(false, 0, 7);
    expect(gazeUpdate).toHaveBeenCalledWith(false, 0, 7, expect.any(Object));
    expect(consoleWarn).toHaveBeenCalledWith(
      '[IWSDK] Failed to disable left pointer:',
      leftFailure,
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      '[IWSDK] Failed to disable gaze pointer:',
      gazeFailure,
    );
    expect(consoleWarn).toHaveBeenCalledTimes(2);

    leftUpdate.mockImplementation(() => {});
    gazeUpdate.mockImplementation(() => {});
    internal.disablePointers(9);
    leftUpdate.mockImplementation(() => {
      throw leftFailure;
    });
    gazeUpdate.mockImplementation(() => {
      throw gazeFailure;
    });
    internal.disablePointers(10);

    expect(consoleWarn).toHaveBeenCalledTimes(4);
    expect(consoleWarn).toHaveBeenNthCalledWith(
      3,
      '[IWSDK] Failed to disable left pointer:',
      leftFailure,
    );
    expect(consoleWarn).toHaveBeenNthCalledWith(
      4,
      '[IWSDK] Failed to disable gaze pointer:',
      gazeFailure,
    );
    expect(rightUpdate).toHaveBeenCalledTimes(4);
    consoleWarn.mockRestore();
  });
});

describe('XRInputManager gaze arbitration', () => {
  it('disables far rays while gaze is active and restores them with gaze off', () => {
    const manager = createManager();
    const internal = manager as any;
    const hand = {
      handedness: 'left',
      hand: new Map(),
      gamepad: null,
    } as unknown as XRInputSource;
    internal.primaryInputSources.left = hand;

    manager.xrOrigin.gazeOrigin = 'tracked';
    internal.gazePointer.gazeSourcePresent = true;
    manager.gazeEnabled = true;
    internal.updatePointers(1 / 60, 1);

    expect((manager.multiPointers.left as any).pointerStates.get('ray')).toBe(
      InteractorState.DISABLED,
    );
    expect(manager.multiPointers.left.getPointer('ray').getEnabled()).toBe(
      false,
    );
    expect(
      (manager.multiPointers.left as any).pointerStates.get('touch'),
    ).not.toBe(InteractorState.DISABLED);
    expect(getRayMeshes(manager)[0].visible).toBe(false);
    expect(getCursorMeshes(manager).every((cursor) => !cursor.visible)).toBe(
      true,
    );
    expect(manager.multiPointers.left.getPolicyForRay()).toEqual({
      forceHideRay: true,
    });

    manager.gazeEnabled = false;
    expect(manager.xrOrigin.gazeOrigin).toBe('none');
    internal.updatePointers(1 / 60, 2);

    expect(
      (manager.multiPointers.left as any).pointerStates.get('ray'),
    ).not.toBe(InteractorState.DISABLED);
    expect(manager.multiPointers.left.getPointer('ray').getEnabled()).toBe(
      true,
    );
  });

  it('keeps far rays available when tracked gaze never becomes usable', () => {
    const manager = createManager();
    const internal = manager as any;
    internal.primaryInputSources.left = {
      handedness: 'left',
      hand: new Map(),
      gamepad: null,
    } as unknown as XRInputSource;

    manager.gazeEnabled = true;
    internal.updatePointers(1 / 60, 1);

    expect(
      (manager.multiPointers.left as any).pointerStates.get('ray'),
    ).not.toBe(InteractorState.DISABLED);
    expect(manager.multiPointers.left.getPointer('ray').getEnabled()).toBe(
      true,
    );
  });

  it('cancels an in-flight far-ray selection when gaze takes over', () => {
    const scene = new Scene() as Scene & {
      rayDescendants?: Object3D[];
    };
    const manager = createManager(scene);
    const pointer = manager.multiPointers.left;
    const target = new Mesh(
      new BoxGeometry(1, 1, 0.1),
      new MeshBasicMaterial(),
    );
    target.position.z = -2;
    target.pointerEvents = 'auto';
    scene.add(target);
    scene.rayDescendants = [target];
    scene.updateMatrixWorld(true);
    const cancel = vi.fn();
    target.addEventListener('pointercancel', cancel);

    pointer.update(true, 1 / 60, 0);
    pointer.update(true, 1 / 60, 0.1, { selectStart: true });
    expect(pointer.getActiveKind()).toBe('ray');
    expect(pointer.getPointer('ray').getButtonsDown()).toContain(0);

    pointer.update(true, 1 / 60, 0.2, { suppressRay: true });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pointer.getActiveKind()).toBeNull();
    expect(pointer.getPointer('ray').getButtonsDown().size).toBe(0);
    expect(pointer.getPointer('ray').getEnabled()).toBe(false);
  });

  it('reports only near touch or grab activity to gaze', () => {
    const manager = createManager();
    const internal = manager as any;
    const gazeUpdate = vi
      .spyOn(manager.gazePointer, 'update')
      .mockImplementation(() => {});

    manager.gazeEnabled = true;
    vi.spyOn(manager.multiPointers.left, 'getActiveKind').mockReturnValue(
      'ray',
    );
    vi.spyOn(manager.multiPointers.right, 'getActiveKind').mockReturnValue(
      'grab',
    );

    internal.updateGazePointer(1 / 60, 1);

    expect(gazeUpdate).toHaveBeenCalledWith(
      false,
      1 / 60,
      1,
      expect.objectContaining({
        directPointerActive: { left: false, right: true },
      }),
    );
  });

  it('clears stale gaze input when frame data disappears', () => {
    const manager = createManager();
    const internal = manager as any;
    const gazeUpdate = vi
      .spyOn(manager.gazePointer, 'update')
      .mockImplementation(() => {});
    internal.gazeInput.candidates = [new Object3D()];
    internal.gazeInput.pinchStart.left = true;
    internal.gazeInput.pinchEnd.right = true;
    internal.gazeInput.pinchActive.left = true;
    internal.gazeInput.directPointerActive.right = true;

    internal.disablePointers(2);

    expect(gazeUpdate).toHaveBeenCalledWith(false, 0, 2, {
      candidates: [],
      pinchStart: { left: false, right: false },
      pinchEnd: { left: false, right: false },
      pinchActive: { left: false, right: false },
      directPointerActive: { left: false, right: false },
    });
  });
});

describe('XRInputManager native hand selection', () => {
  it('shares gamepad-less hand edges with hand and gaze pointers', () => {
    const manager = createManager();
    const internal = manager as any;
    const session = new EventTarget() as unknown as XRSession;
    const hand = {
      handedness: 'right',
      hand: new Map(),
      gamepad: null,
    } as unknown as XRInputSource;
    const updates: Array<{
      start: boolean;
      end: boolean;
      active: boolean;
    }> = [];
    const pointerUpdates: Array<{
      connected: boolean;
      start: boolean;
      end: boolean;
    }> = [];
    manager.gazeEnabled = true;
    vi.spyOn(manager.gazePointer, 'update').mockImplementation(
      (_connected, _delta, _time, input) => {
        updates.push({
          start: input.pinchStart.right,
          end: input.pinchEnd.right,
          active: input.pinchActive.right,
        });
      },
    );
    vi.spyOn(manager.multiPointers.right, 'update').mockImplementation(
      (connected, _delta, _time, input) => {
        pointerUpdates.push({
          connected,
          start: !!input?.selectStart,
          end: !!input?.selectEnd,
        });
      },
    );
    internal.primaryInputSources.right = hand;
    internal.syncSelectEventSession(session);
    const selectStates: Array<{
      start: boolean;
      end: boolean;
      active: boolean;
    }> = [];
    const updateFrame = (time: number) => {
      internal.updateHandSelectFrameState();
      internal.updatePointers(1 / 60, time);
      internal.updateGazePointer(1 / 60, time);
      selectStates.push({ ...manager.getSelectState('right') });
    };

    // Give gaze an idle baseline before the first gesture.
    updateFrame(0);
    updates.length = 0;
    pointerUpdates.length = 0;
    selectStates.length = 0;

    session.dispatchEvent(
      Object.assign(new Event('selectstart'), { inputSource: hand }),
    );
    session.dispatchEvent(
      Object.assign(new Event('selectend'), { inputSource: hand }),
    );
    updateFrame(1);
    updateFrame(2);
    updateFrame(3);

    expect(updates).toEqual([
      { start: true, end: false, active: true },
      { start: false, end: true, active: false },
      { start: false, end: false, active: false },
    ]);
    expect(pointerUpdates).toEqual([
      { connected: true, start: true, end: false },
      { connected: true, start: false, end: true },
      { connected: true, start: false, end: false },
    ]);
    // GrabSystem reads the same edges to forward hand pinch to grabbing.
    expect(selectStates).toEqual(updates);
  });

  it('ignores stale hand events after the XR session changes', () => {
    const manager = createManager();
    const internal = manager as any;
    const oldSession = new EventTarget() as unknown as XRSession;
    const nextSession = new EventTarget() as unknown as XRSession;
    const hand = {
      handedness: 'right',
      hand: new Map(),
      gamepad: null,
    } as unknown as XRInputSource;
    const updates: Array<{
      start: boolean;
      end: boolean;
      active: boolean;
    }> = [];
    manager.gazeEnabled = true;
    vi.spyOn(manager.gazePointer, 'update').mockImplementation(
      (_connected, _delta, _time, input) => {
        updates.push({
          start: input.pinchStart.right,
          end: input.pinchEnd.right,
          active: input.pinchActive.right,
        });
      },
    );
    internal.primaryInputSources.right = hand;
    internal.syncSelectEventSession(oldSession);
    internal.updateHandSelectFrameState();
    internal.updateGazePointer(1 / 60, 0);
    oldSession.dispatchEvent(
      Object.assign(new Event('selectstart'), { inputSource: hand }),
    );
    internal.syncSelectEventSession(nextSession);
    internal.updateHandSelectFrameState();
    internal.updateGazePointer(1 / 60, 1);
    updates.length = 0;
    oldSession.dispatchEvent(
      Object.assign(new Event('selectstart'), { inputSource: hand }),
    );
    internal.updateHandSelectFrameState();
    internal.updateGazePointer(1 / 60, 2);

    expect(updates).toEqual([{ start: false, end: false, active: false }]);
  });

  it('bounds queued edges and does not replay them when gaze is enabled', () => {
    const manager = createManager();
    const internal = manager as any;
    const session = new EventTarget() as unknown as XRSession;
    const hand = {
      handedness: 'right',
      hand: new Map(),
      gamepad: null,
    } as unknown as XRInputSource;
    const updates: Array<{
      start: boolean;
      end: boolean;
      active: boolean;
    }> = [];
    vi.spyOn(manager.gazePointer, 'update').mockImplementation(
      (_connected, _delta, _time, input) => {
        updates.push({
          start: input.pinchStart.right,
          end: input.pinchEnd.right,
          active: input.pinchActive.right,
        });
      },
    );
    internal.primaryInputSources.right = hand;
    internal.syncSelectEventSession(session);

    for (let i = 0; i < 500; i += 1) {
      session.dispatchEvent(
        Object.assign(new Event('selectstart'), { inputSource: hand }),
      );
      session.dispatchEvent(
        Object.assign(new Event('selectend'), { inputSource: hand }),
      );
    }
    expect(internal.handSelectEvents.right.transitions).toHaveLength(4);

    manager.gazeEnabled = true;
    for (let frame = 0; frame < 5; frame += 1) {
      internal.updateHandSelectFrameState();
      internal.updateGazePointer(1 / 60, frame);
    }
    expect(updates).toEqual(
      Array.from({ length: 5 }, () => ({
        start: false,
        end: false,
        active: false,
      })),
    );

    session.dispatchEvent(
      Object.assign(new Event('selectstart'), { inputSource: hand }),
    );
    internal.updateHandSelectFrameState();
    internal.updateGazePointer(1 / 60, 6);
    expect(updates.at(-1)).toEqual({ start: true, end: false, active: true });
  });
});

describe('XRInputManager touch hand visual offset', () => {
  it('only reports a touch surface visual offset while touch is selecting', () => {
    const manager = createManager();
    const multiPointer = manager.multiPointers.left as any;
    const target = new Vector3();
    const intersection = {
      details: { type: 'sphere' },
      object: new Object3D(),
      pointOnFace: new Vector3(1, 2, 3),
      pointerPosition: new Vector3(0.5, 2.25, 2),
    };

    multiPointer.activeKind = 'touch';
    multiPointer.touch.pointer.getIntersection = vi.fn(() => intersection);
    multiPointer.pointerStates.set('touch', InteractorState.HOVER);

    expect(manager.multiPointers.left.getTouchSurfaceVisualOffset(target)).toBe(
      null,
    );

    multiPointer.pointerStates.set('touch', InteractorState.SELECT);

    expect(manager.multiPointers.left.getTouchSurfaceVisualOffset(target)).toBe(
      target,
    );
    expect(target.x).toBeCloseTo(0.5);
    expect(target.y).toBeCloseTo(-0.25);
    expect(target.z).toBeCloseTo(1);
  });

  it('applies hand visual offsets in world space', () => {
    const parent = new Group();
    const model = new Group();
    parent.position.set(2, 0, 0);
    parent.rotation.y = Math.PI / 2;
    parent.scale.setScalar(2);
    model.position.set(0.25, 0, 0);
    parent.add(model);
    parent.updateMatrixWorld(true);

    const adapter = createHandVisualAdapter(parent);
    (adapter as any).visual = {
      model,
    };

    const before = model.getWorldPosition(new Vector3());
    const offset = new Vector3(0, 0, -0.5);
    adapter.applyVisualOffsetWorld(offset);
    parent.updateMatrixWorld(true);
    const after = model.getWorldPosition(new Vector3());

    expect(after.x - before.x).toBeCloseTo(offset.x);
    expect(after.y - before.y).toBeCloseTo(offset.y);
    expect(after.z - before.z).toBeCloseTo(offset.z);
  });
});

describe('XRHandVisualAdapter pinch strength', () => {
  it('reports continuous progress without changing the strict pinch edge', () => {
    const adapter = createHandVisualAdapter(new Group());
    const internal = adapter as any;
    internal.indexTip = {} as XRSpace;
    internal.thumbTip = {} as XRSpace;

    const frame = {
      getPose: () => ({
        transform: {
          position: { x: 0.029, y: 0, z: 0 },
        },
      }),
    } as unknown as XRFrame;

    internal.updatePinch(frame, 0);

    expect(adapter.getPinchStrength()).toBeCloseTo(0.5);
    expect(internal.pinchData.curr).toBe(false);
  });

  it.each([
    [0.05, 0.04, 1, true],
    [0.05, 0.05, 0, false],
    [0.06, 0.055, 1, true],
    [0.06, 0.065, 0, false],
  ])(
    'keeps strength finite when threshold %s meets or exceeds the open distance',
    (threshold, distance, expectedStrength, expectedPinching) => {
      const adapter = createHandVisualAdapter(new Group());
      const internal = adapter as any;
      internal.pinchThreshold = threshold;
      internal.indexTip = {} as XRSpace;
      internal.thumbTip = {} as XRSpace;
      const frame = {
        getPose: () => ({
          transform: {
            position: { x: distance, y: 0, z: 0 },
          },
        }),
      } as unknown as XRFrame;

      internal.updatePinch(frame, 0);

      expect(Number.isFinite(adapter.getPinchStrength())).toBe(true);
      expect(adapter.getPinchStrength()).toBe(expectedStrength);
      expect(internal.pinchData.curr).toBe(expectedPinching);
    },
  );

  it('clears gesture state and rejects pending capture on disconnect', async () => {
    const adapter = createHandVisualAdapter(new Group());
    const internal = adapter as any;
    internal.pinchStrength = 0.75;
    internal.pinchCooldown = 0.1;
    internal.pinchData = { prev: true, curr: true };
    internal.gripXRSpace = {} as XRSpace;
    const rejected = expect(
      adapter.capturePose({} as XRSpace),
    ).rejects.toBeUndefined();

    adapter.disconnect();

    await rejected;
    expect(adapter.getPinchStrength()).toBe(0);
    expect(internal.pinchCooldown).toBe(0);
    expect(internal.pinchData).toEqual({ prev: false, curr: false });
    expect(internal.gripXRSpace).toBeUndefined();
  });
});

function createManager(scene = new Scene()): XRInputManagerInstance {
  return new XRInputManager({
    camera: new PerspectiveCamera(),
    scene,
  });
}

function getRayMeshes(manager: XRInputManagerInstance): Mesh[] {
  return [
    getOnlyMesh(manager.xrOrigin.raySpaces.left.children),
    getOnlyMesh(manager.xrOrigin.raySpaces.right.children),
  ];
}

function getCursorMeshes(manager: XRInputManagerInstance): Mesh[] {
  return manager.xrOrigin.children.filter((child): child is Mesh => {
    return child instanceof Mesh;
  });
}

function getOnlyMesh(children: Array<unknown>): Mesh {
  const meshes = children.filter(
    (child): child is Mesh => child instanceof Mesh,
  );
  expect(meshes).toHaveLength(1);
  return meshes[0];
}

function createNoSessionXRManager(): WebXRManager {
  return {
    getSession: () => null,
    getReferenceSpace: () => null,
    getFrame: () => null,
  } as unknown as WebXRManager;
}

function createHandVisualAdapter(parent: Group) {
  return new XRHandVisualAdapter(
    parent,
    'left',
    true,
    TestHandVisual,
    new Scene(),
    new PerspectiveCamera(),
    createTestAssetLoader(),
  );
}

class TestHandVisual {
  static assetKeyPrefix = 'test-hand';
  model: Group;

  constructor(
    _scene: Scene,
    _camera: PerspectiveCamera,
    gltfScene: Group,
    _layout: InputLayout,
  ) {
    this.model = gltfScene;
  }

  init() {}
  connect(_inputSource: XRInputSource, _enabled: boolean) {}
  disconnect() {}
  toggle(_enabled: boolean) {}
  update(_delta: number) {}
}

function createTestAssetLoader(): XRAssetLoader {
  return {
    async loadGLTF() {
      return { scene: new Group() } as Awaited<
        ReturnType<XRAssetLoader['loadGLTF']>
      >;
    },
  };
}

function createMockCanvas() {
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };

  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  };
}
