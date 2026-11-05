/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Signal, signal } from '@preact/signals-core';
import {
  Group,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebXRManager,
} from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadInputProfile } from './gamepad/input-profiles.js';
import { StatefulGamepad } from './gamepad/stateful-gamepad.js';
import { GazePointer, GazePointerInput } from './pointer/gaze-pointer.js';
import { MultiPointer } from './pointer/multi-pointer.js';
import { XROrigin } from './rig/xr-origin.js';
import { XRInputVisualAdapter } from './visual/adapter/base-visual-adapter.js';
import { XRControllerVisualAdapter } from './visual/adapter/controller-visual-adapter.js';
import { XRHandVisualAdapter } from './visual/adapter/hand-visual-adapter.js';
import { AnimatedController } from './visual/impl/animated-controller.js';
import { AnimatedHand } from './visual/impl/animated-hand.js';
import {
  VisualConstructor,
  VisualImplementation,
} from './visual/impl/base-impl.js';

interface InputSourceData {
  inputSource: XRInputSource;
  isPrimary: boolean;
}

interface HandSelectEventState {
  inputSource: XRInputSource | undefined;
  actualActive: boolean;
  reportedActive: boolean;
  transitions: Array<'start' | 'end'>;
}

interface HandSelectState {
  start: boolean;
  end: boolean;
  active: boolean;
}

const MAX_HAND_SELECT_TRANSITIONS = 4;
export enum XRInputDeviceType {
  Controller = 'controller',
  Hand = 'hand',
}

export interface XRAssetLoader {
  loadGLTF(assetPath: string): Promise<GLTF>;
}

export const DefaultXRAssetLoader = {
  gltfLoader: new GLTFLoader(),
  async loadGLTF(assetPath: string): Promise<GLTF> {
    return await DefaultXRAssetLoader.gltfLoader.loadAsync(assetPath);
  },
};

export interface XRInputDeviceConfig {
  handedness: XRHandedness;
  type: XRInputDeviceType;
  enabled?: boolean;
  visualClass?: VisualConstructor<VisualImplementation>;
}

export interface XRPointerSettings {
  enabled?: boolean;
}

export interface XRInputOptions {
  camera: PerspectiveCamera;
  scene: Scene;
  assetLoader?: XRAssetLoader;
  inputDevices?: XRInputDeviceConfig[];
  pointerSettings?: XRPointerSettings;
}

export class XRInputManager {
  public readonly xrOrigin: XROrigin;

  public readonly multiPointers: Record<'left' | 'right', MultiPointer>;

  /**
   * Single global gaze pointer — gaze has no handedness, so it sits beside
   * {@link XRInputManager.multiPointers} rather than inside them.
   *
   * Constructed unconditionally so systems (`GrabSystem`, `GazeSystem`) can
   * hold a stable reference, but idle until {@link XRInputManager.gazeEnabled}
   * is set. Nothing here costs a frame while gaze is off.
   */
  public readonly gazePointer: GazePointer;

  /**
   * Master switch for the gaze pipeline, flipped on by `GazeSystem` when the
   * project opts into the gaze XR feature. While `false`, the gaze pose is
   * never sampled, no cone cast runs, no pointer events are dispatched, and
   * the pointer's reticle and ray space stay out of the rig entirely.
   */
  public get gazeEnabled(): boolean {
    return this.gazeEnabledFlag;
  }

  public set gazeEnabled(enabled: boolean) {
    if (enabled === this.gazeEnabledFlag) {
      return;
    }
    this.gazeEnabledFlag = enabled;
    this.resetGazeHandSelectionArming();
    if (!enabled) {
      this.gazePointer.reset();
      this.xrOrigin.clearGaze();
    }
    this.gazePointer.setAttached(enabled);
  }

  private gazeEnabledFlag = false;

  /**
   * Gaze-eligible Object3D roots, republished by the host every frame before
   * {@link XRInputManager.update}. Gaze deliberately uses an explicit
   * candidate list rather than raycasting the scene: the cone cast is
   * O(candidates), and gaze should only consider objects that opted in.
   */
  public gazeCandidates: ReadonlyArray<Object3D> = [];

  private readonly gazeInput: GazePointerInput = {
    candidates: [],
    pinchStart: { left: false, right: false },
    pinchEnd: { left: false, right: false },
    pinchActive: { left: false, right: false },
    directPointerActive: { left: false, right: false },
  };

  public readonly gamepads = {
    left: undefined,
    right: undefined,
  } as Record<'left' | 'right', StatefulGamepad | undefined>;

  public readonly visualAdapters: {
    controller: {
      left: XRControllerVisualAdapter;
      right: XRControllerVisualAdapter;
    };
    hand: {
      left: XRHandVisualAdapter;
      right: XRHandVisualAdapter;
    };
    left: Signal<XRInputVisualAdapter | undefined>;
    right: Signal<XRInputVisualAdapter | undefined>;
  };

  private activeInputSources = {
    hand: { left: undefined, right: undefined },
    controller: { left: undefined, right: undefined },
  } as Record<
    'hand' | 'controller',
    Record<'left' | 'right', InputSourceData | undefined>
  >;

  private primaryInputSources = {
    left: undefined,
    right: undefined,
  } as Record<'left' | 'right', XRInputSource | undefined>;

  /**
   * Sides whose primary source has no pose this frame: a hand whose wrist is
   * not tracked, or a controller without a target ray pose. Their pointers
   * stay disconnected (no raycasts) and their visuals hidden until tracking
   * returns. Cleared every frame with the active sources.
   */
  private readonly untrackedPrimary = { left: false, right: false };

  private scene: Scene;
  private hadSession = false;
  private readonly touchSurfaceVisualOffsets = {
    left: new Vector3(),
    right: new Vector3(),
  };

  private processedInputSourceKeys = new Set<string>();

  private selectEventSession: XRSession | undefined;
  private readonly handSelectEvents: Record<
    'left' | 'right',
    HandSelectEventState
  > = {
    left: {
      inputSource: undefined,
      actualActive: false,
      reportedActive: false,
      transitions: [],
    },
    right: {
      inputSource: undefined,
      actualActive: false,
      reportedActive: false,
      transitions: [],
    },
  };
  private readonly handSelectFrameState: Record<
    'left' | 'right',
    HandSelectState
  > = {
    left: { start: false, end: false, active: false },
    right: { start: false, end: false, active: false },
  };
  private readonly gazeHandSelectionArmed = {
    left: false,
    right: false,
  };
  private readonly pointerDisableWarnings = new Set<
    'left' | 'right' | 'gaze'
  >();
  private readonly selectStartHandler = (event: XRInputSourceEvent) => {
    this.updateHandSelectEvent(event, true);
  };
  private readonly selectEndHandler = (event: XRInputSourceEvent) => {
    this.updateHandSelectEvent(event, false);
  };

  constructor(options: XRInputOptions) {
    const { scene, camera, assetLoader } = options;
    this.xrOrigin = new XROrigin();
    this.scene = scene; // used implicitly by MultiPointer via constructor
    this.visualAdapters = {
      controller: {
        left: new XRControllerVisualAdapter(
          this.xrOrigin,
          'left',
          true, // visuals enabled
          AnimatedController,
          scene,
          camera,
          assetLoader || DefaultXRAssetLoader,
        ),
        right: new XRControllerVisualAdapter(
          this.xrOrigin,
          'right',
          true, // visuals enabled
          AnimatedController,
          scene,
          camera,
          assetLoader || DefaultXRAssetLoader,
        ),
      },
      hand: {
        left: new XRHandVisualAdapter(
          this.xrOrigin,
          'left',
          true, // visuals enabled
          AnimatedHand,
          scene,
          camera,
          assetLoader || DefaultXRAssetLoader,
        ),
        right: new XRHandVisualAdapter(
          this.xrOrigin,
          'right',
          true, // visuals enabled
          AnimatedHand,
          scene,
          camera,
          assetLoader || DefaultXRAssetLoader,
        ),
      },
      left: signal(undefined),
      right: signal(undefined),
    };

    this.multiPointers = {
      left: new MultiPointer('left', this.scene, camera, this.xrOrigin),
      right: new MultiPointer('right', this.scene, camera, this.xrOrigin),
    };

    this.gazePointer = new GazePointer(this.xrOrigin, this.scene, camera);
  }

  update(xrManager: WebXRManager, delta: number, time: number): void {
    const session = xrManager.getSession();
    if (!session) {
      this.syncSelectEventSession(undefined);
      if (this.hadSession) {
        this.onSessionEnded();
      } else {
        this.disablePointers(time);
      }
      this.hadSession = false;
      return;
    }
    this.hadSession = true;
    this.syncSelectEventSession(session);

    const refSpace = xrManager.getReferenceSpace();
    const frame = xrManager.getFrame();
    if (!refSpace || !frame) {
      this.disablePointers(time);
      return;
    }

    // Reset active input sources
    this.resetActiveInputSources();

    // Update active input sources
    this.updateActiveInputSources(session);

    // Update controllers and hands (poses + visuals + gamepads)
    this.updateControllersAndHands(frame, refSpace, delta);
    this.updateHandSelectFrameState();

    // Update head tracking
    this.xrOrigin.updateHead(frame, refSpace);

    // Probe the real gaze target ray while frame/refSpace are in hand, and
    // before the matrix flush below, so eyeSpace's world matrix is current by
    // the time the pointer reads it.
    if (this.gazeEnabled) {
      this.gazePointer.sampleGazePose(time, {
        frame,
        referenceSpace: refSpace,
        session,
      });
    }

    // Force matrix update for xrOrigin, and then update pointers
    this.xrOrigin.updateMatrixWorld(true);
    this.updatePointers(delta, time);

    // Gaze runs after the hand pointers so it can read their active state for
    // suppression — direct manipulation always wins over gaze.
    this.updateGazePointer(delta, time);
  }

  private onSessionEnded(): void {
    // Clear active sources and visuals
    this.resetActiveInputSources();

    // Disconnect controller/hand visuals and clear primary adapters
    (['left', 'right'] as const).forEach((handedness) => {
      const ctrl = this.visualAdapters.controller[handedness];
      const hand = this.visualAdapters.hand[handedness];
      if (ctrl.connected) {
        ctrl.disconnect();
      }
      if (hand.connected) {
        hand.disconnect();
      }
    });
    this.visualAdapters.left.value = undefined;
    this.visualAdapters.right.value = undefined;

    // Gaze has no per-frame source outside a session; drop it back to 'none'
    // so consumers don't read a stale tracked origin.
    this.xrOrigin.clearGaze();

    // Full reset (not just disable) so the next session re-runs the gaze
    // diagnostics from scratch instead of reporting the previous one's verdict.
    this.gazePointer.reset();

    // Hide pointer visuals and disable combined pointers
    this.disablePointers();
  }

  private disablePointers(time = 0): void {
    this.resetHandSelectEvents();
    this.resetHandSelectFrameState();
    this.resetGazeHandSelectionArming();
    for (const handedness of ['left', 'right'] as const) {
      try {
        this.multiPointers[handedness].update(false, 0, time);
        this.pointerDisableWarnings.delete(handedness);
      } catch (error) {
        this.warnPointerDisableFailure(handedness, error);
      }
    }
    try {
      this.gazeInput.candidates = [];
      for (const handedness of ['left', 'right'] as const) {
        this.gazeInput.pinchStart[handedness] = false;
        this.gazeInput.pinchEnd[handedness] = false;
        this.gazeInput.pinchActive[handedness] = false;
        this.gazeInput.directPointerActive[handedness] = false;
      }
      this.gazePointer.update(false, 0, time, this.gazeInput);
      this.pointerDisableWarnings.delete('gaze');
    } catch (error) {
      this.warnPointerDisableFailure('gaze', error);
    }
  }

  private warnPointerDisableFailure(
    pointer: 'left' | 'right' | 'gaze',
    error: unknown,
  ): void {
    if (!this.pointerDisableWarnings.has(pointer)) {
      this.pointerDisableWarnings.add(pointer);
      console.warn(`[IWSDK] Failed to disable ${pointer} pointer:`, error);
    }
  }

  isPrimary(deviceType: 'controller' | 'hand', handedness: 'left' | 'right') {
    return !!this.activeInputSources[deviceType][handedness]?.isPrimary;
  }

  /**
   * Get the primary input source for a given handedness.
   * Returns the XRInputSource that is currently active for left or right hand.
   */
  getPrimaryInputSource(
    handedness: 'left' | 'right',
  ): XRInputSource | undefined {
    return this.primaryInputSources[handedness];
  }

  /**
   * Get this frame's select state for the primary input source of a given
   * handedness, as the hand and gaze pointers see it. Unlike
   * `gamepads[handedness]`, this also covers hand sources that expose no
   * Gamepad, whose pinch edges come from the session's select events.
   */
  getSelectState(handedness: 'left' | 'right'): Readonly<HandSelectState> {
    return this.handSelectFrameState[handedness];
  }

  private resetActiveInputSources(): void {
    this.activeInputSources.controller.left = undefined;
    this.activeInputSources.controller.right = undefined;
    this.activeInputSources.hand.left = undefined;
    this.activeInputSources.hand.right = undefined;
    this.primaryInputSources.left = undefined;
    this.primaryInputSources.right = undefined;
    this.untrackedPrimary.left = false;
    this.untrackedPrimary.right = false;
  }

  private syncSelectEventSession(session: XRSession | undefined): void {
    if (this.selectEventSession === session) {
      return;
    }
    if (this.selectEventSession) {
      this.selectEventSession.removeEventListener(
        'selectstart',
        this.selectStartHandler,
      );
      this.selectEventSession.removeEventListener(
        'selectend',
        this.selectEndHandler,
      );
    }
    this.resetHandSelectEvents();
    this.resetHandSelectFrameState();
    this.resetGazeHandSelectionArming();
    this.selectEventSession = session;
    if (session) {
      session.addEventListener('selectstart', this.selectStartHandler);
      session.addEventListener('selectend', this.selectEndHandler);
    }
  }

  private updateHandSelectEvent(
    event: XRInputSourceEvent,
    active: boolean,
  ): void {
    const inputSource = event.inputSource;
    const handedness = inputSource.handedness;
    if (
      !inputSource.hand ||
      (handedness !== 'left' && handedness !== 'right')
    ) {
      return;
    }
    const state = this.handSelectEvents[handedness];
    if (state.inputSource !== inputSource) {
      state.inputSource = inputSource;
      state.actualActive = false;
      state.reportedActive = false;
      state.transitions.length = 0;
    }
    if (state.actualActive === active) {
      return;
    }
    state.actualActive = active;
    // Keep the newest complete gesture cycles if a suspended renderer lets
    // events outrun frames. Removing two alternating edges preserves both the
    // current reported state and the final physical state.
    if (state.transitions.length >= MAX_HAND_SELECT_TRANSITIONS) {
      state.transitions.splice(0, 2);
    }
    state.transitions.push(active ? 'start' : 'end');
  }

  private resetHandSelectEvents(handedness?: 'left' | 'right'): void {
    const hands = handedness ? [handedness] : (['left', 'right'] as const);
    for (const hand of hands) {
      const state = this.handSelectEvents[hand];
      state.inputSource = undefined;
      state.actualActive = false;
      state.reportedActive = false;
      state.transitions.length = 0;
    }
  }

  private resetHandSelectFrameState(): void {
    for (const handedness of ['left', 'right'] as const) {
      const state = this.handSelectFrameState[handedness];
      state.start = false;
      state.end = false;
      state.active = false;
    }
  }

  private resetGazeHandSelectionArming(): void {
    this.gazeHandSelectionArmed.left = false;
    this.gazeHandSelectionArmed.right = false;
  }

  /**
   * Snapshot each hand's selection once per render frame. Native hand sources
   * expose WebXR select events but no Gamepad, and both the hand pointer and
   * gaze pointer must observe the same edge without consuming it twice.
   */
  private updateHandSelectFrameState(): void {
    for (const handedness of ['left', 'right'] as const) {
      const next = this.readHandSelectState(handedness);
      const state = this.handSelectFrameState[handedness];
      state.start = next.start;
      state.end = next.end;
      state.active = next.active;
    }
  }

  private readHandSelectState(handedness: 'left' | 'right'): HandSelectState {
    const gamepad = this.gamepads[handedness];
    if (gamepad) {
      this.resetHandSelectEvents(handedness);
      return {
        start: gamepad.getSelectStart(),
        end: gamepad.getSelectEnd(),
        active: gamepad.getSelecting(),
      };
    }

    const inputSource = this.primaryInputSources[handedness];
    const state = this.handSelectEvents[handedness];
    const matches = Boolean(
      inputSource?.hand && state.inputSource === inputSource,
    );
    if (!matches) {
      this.resetHandSelectEvents(handedness);
      return { start: false, end: false, active: false };
    }

    // Deliver at most one edge per render frame. A short native pinch can
    // produce selectstart and selectend between two app frames; preserving
    // their order guarantees a down frame followed by an up/click frame.
    const transition = state.transitions.shift();
    if (transition === 'start') {
      state.reportedActive = true;
    } else if (transition === 'end') {
      state.reportedActive = false;
    }
    const result = {
      start: transition === 'start',
      end: transition === 'end',
      active: state.reportedActive,
    };
    return result;
  }

  /**
   * Updates the active input sources from the XR session.
   *
   * IMPORTANT: This method handles a platform quirk where some runtimes
   * include the same hands in BOTH session.inputSources AND session.trackedSources.
   * The duplicate entries represent the same physical hands but as different XRInputSource objects
   * with different properties (e.g., different gamepad.buttons lengths).
   *
   * To prevent the trackedSources from overwriting the isPrimary status set by inputSources,
   * we track which handedness+type combinations have already been processed and skip
   * re-processing duplicates from trackedSources.
   *
   * Without this deduplication:
   * - Hands from inputSources would be marked as isPrimary=true
   * - Then the same hands from trackedSources would overwrite with isPrimary=false
   * - This causes hand visuals to not be displayed (since visibility is tied to isPrimary)
   */
  private updateActiveInputSources(session: XRSession): void {
    this.processedInputSourceKeys.clear();

    // Process inputSources (these are primary)
    for (const inputSource of session.inputSources) {
      this.assignInputSource(inputSource, true);
      const key = `${inputSource.handedness}-${inputSource.hand ? 'hand' : 'controller'}`;
      this.processedInputSourceKeys.add(key);
    }

    // Process trackedSources (these are non-primary)
    // Skip any that were already in inputSources to avoid overwriting isPrimary
    if (session.trackedSources) {
      for (const inputSource of session.trackedSources) {
        const key = `${inputSource.handedness}-${inputSource.hand ? 'hand' : 'controller'}`;
        if (!this.processedInputSourceKeys.has(key)) {
          this.assignInputSource(inputSource, false);
        }
      }
    }
  }

  private assignInputSource(
    inputSource: XRInputSource,
    isPrimary: boolean,
  ): void {
    const handedness = inputSource.handedness;
    if (handedness === 'left' || handedness === 'right') {
      const target = inputSource.hand
        ? this.activeInputSources.hand
        : this.activeInputSources.controller;
      target[handedness] = { inputSource, isPrimary };
      if (isPrimary) {
        this.primaryInputSources[handedness] = inputSource;
      }
    }
  }

  private updateControllersAndHands(
    frame: XRFrame,
    refSpace: XRReferenceSpace,
    delta: number,
  ): void {
    (['left', 'right'] as const).forEach((handedness) => {
      (['controller', 'hand'] as const).forEach((key) => {
        const inputSourceData = this.activeInputSources[key][handedness];
        const visualAdapter = this.visualAdapters[key][handedness];
        if (inputSourceData) {
          const { inputSource, isPrimary } = inputSourceData;
          const raySpace = isPrimary
            ? this.xrOrigin.raySpaces[handedness]
            : this.xrOrigin.secondaryRaySpaces[handedness];
          const gripSpace = isPrimary
            ? this.xrOrigin.gripSpaces[handedness]
            : this.xrOrigin.secondaryGripSpaces[handedness];
          visualAdapter.raySpace = raySpace;
          visualAdapter.gripSpace = gripSpace;
          const rayTracked = updatePose(
            frame,
            inputSource.targetRaySpace,
            refSpace,
            raySpace,
          );
          // WebXR Hand Input: a hand whose wrist has no pose is not tracked,
          // whatever its target ray says. A runtime can keep listing a hand,
          // with an aim pose, while it sees no hand at all.
          const tracked = inputSource.hand
            ? hasWristPose(frame, inputSource.hand, refSpace)
            : rayTracked;
          if (isPrimary && !tracked) {
            this.untrackedPrimary[handedness] = true;
          }
          if (inputSource.gripSpace) {
            updatePose(frame, inputSource.gripSpace, refSpace, gripSpace);
          } else {
            gripSpace.position.copy(raySpace.position);
            gripSpace.quaternion.copy(raySpace.quaternion);
            gripSpace.scale.copy(raySpace.scale);
          }

          if (visualAdapter.inputSource !== inputSourceData.inputSource) {
            visualAdapter.connect(inputSourceData.inputSource);
          }
          if (tracked) {
            visualAdapter.update(frame, delta);
          }
          visualAdapter.isPrimary = inputSourceData.isPrimary;
          if (visualAdapter.isPrimary) {
            this.visualAdapters[handedness].value = visualAdapter;
          }
          if (visualAdapter.visual) {
            visualAdapter.visual.model.visible =
              inputSourceData.isPrimary && tracked;
          }

          // Update index tip space for hands (used by TouchPointer)
          if (key === 'hand' && isPrimary && tracked) {
            const handAdapter = this.visualAdapters.hand[handedness];
            const indexTipXRSpace = handAdapter.getIndexTipSpace();
            if (indexTipXRSpace) {
              updatePose(
                frame,
                indexTipXRSpace,
                refSpace,
                this.xrOrigin.indexTipSpaces[handedness],
              );
            }
          }
        } else if (visualAdapter.connected) {
          visualAdapter.disconnect();
        }
      });

      // For controllers, fallback indexTipSpace to raySpace (no finger tracking)
      const hasHandActive = !!this.activeInputSources.hand[handedness];
      if (!hasHandActive && this.activeInputSources.controller[handedness]) {
        const raySpace = this.xrOrigin.raySpaces[handedness];
        const indexTipSpace = this.xrOrigin.indexTipSpaces[handedness];
        indexTipSpace.position.copy(raySpace.position);
        indexTipSpace.quaternion.copy(raySpace.quaternion);
        indexTipSpace.scale.copy(raySpace.scale);
      }
    });
    (['left', 'right'] as const).forEach((handedness) => {
      const inputSource = this.primaryInputSources[handedness];

      // If the input source changed, clear the cached StatefulGamepad.
      if (this.gamepads[handedness]?.inputSource !== inputSource) {
        this.gamepads[handedness] = undefined;
      }

      const hasGamepad = !!(inputSource && inputSource.gamepad);

      // Lazily create a StatefulGamepad only when a gamepad is available.
      if (!this.gamepads[handedness] && hasGamepad) {
        const inputConfig = loadInputProfile(inputSource!);
        this.gamepads[handedness] = new StatefulGamepad(inputConfig);
      }

      // Update if present and source still has a gamepad.
      if (hasGamepad) {
        this.gamepads[handedness]?.update();
      }
    });
  }

  private updatePointers(delta: number, time: number) {
    // Gaze and hand/controller rays are alternative far-targeting modes in
    // ISDK. Once gaze mode has acquired a valid source, disable far rays rather than
    // letting their incidental hits compete with gaze. An invalid frame clears
    // gaze hover but does not flash the ray mode; near touch/grab stays enabled.
    const suppressFarRay =
      this.gazeEnabled && this.gazePointer.ownsFarTargeting(time);
    (['left', 'right'] as const).forEach((handedness) => {
      const inputSource = this.primaryInputSources[handedness];
      const gp = this.gamepads[handedness];
      // WebXR Hand Input requires hand sources to expose no Gamepad. Their
      // select edges come from the session-level event snapshot above. A
      // source without a pose this frame has nothing to aim with: its pointers
      // stay disconnected, so no ray, grab or touch pointer raycasts the scene.
      const connected =
        !!(inputSource && (gp || inputSource.hand)) &&
        !this.untrackedPrimary[handedness];
      const select = this.handSelectFrameState[handedness];
      const selectStart = connected ? select.start : false;
      const selectEnd = connected ? select.end : false;

      // First: move all registered pointers (ray + grab) via the combined pointer
      const squeezeStart = connected
        ? !!gp?.getButtonDown('xr-standard-squeeze')
        : false;
      const squeezeEnd = connected
        ? !!gp?.getButtonUp('xr-standard-squeeze')
        : false;
      this.multiPointers[handedness].update(connected, delta, time, {
        selectStart,
        selectEnd,
        squeezeStart,
        squeezeEnd,
        suppressRay: suppressFarRay,
      });

      const touchSurfaceVisualOffset = this.multiPointers[
        handedness
      ].getTouchSurfaceVisualOffset(this.touchSurfaceVisualOffsets[handedness]);
      const handAdapter = this.visualAdapters.hand[handedness];
      if (touchSurfaceVisualOffset && handAdapter.isPrimary) {
        handAdapter.applyVisualOffsetWorld(touchSurfaceVisualOffset);
      }
    });
  }

  /**
   * Drive the global gaze pointer from this frame's candidates and pinch state.
   *
   * Either hand's pinch can commit a gaze selection, so both are sampled and
   * the pointer applies its own hand mutual-exclusion. Direct touch/grab state
   * feeds the pointer's suppression rule; it's read after
   * {@link XRInputManager.updatePointers} so it reflects this frame, not last.
   */
  private updateGazePointer(delta: number, time: number): void {
    if (!this.gazeEnabled) {
      return;
    }
    const input = this.gazeInput;
    input.candidates = this.gazeCandidates;
    (['left', 'right'] as const).forEach((handedness) => {
      const select = this.handSelectFrameState[handedness];
      if (!this.gazeHandSelectionArmed[handedness]) {
        // Enabling gaze while a pinch is held or queued must not turn input
        // that occurred while gaze was off into a synthetic gaze click. Arm
        // only after the event bridge reaches a fully released baseline.
        const events = this.handSelectEvents[handedness];
        if (!select.active && events.transitions.length === 0) {
          this.gazeHandSelectionArmed[handedness] = true;
        }
        input.pinchStart[handedness] = false;
        input.pinchEnd[handedness] = false;
        input.pinchActive[handedness] = false;
      } else {
        input.pinchStart[handedness] = select.start;
        input.pinchEnd[handedness] = select.end;
        input.pinchActive[handedness] = select.active;
      }
      const activeKind = this.multiPointers[handedness].getActiveKind();
      input.directPointerActive[handedness] =
        activeKind === 'touch' || activeKind === 'grab';
    });
    this.gazePointer.update(this.gazePointer.canTarget(), delta, time, input);
  }
}

/** Copies the space's pose into the group; false (group untouched) without one. */
function updatePose(
  frame: XRFrame,
  xrSpace: XRSpace,
  refSpace: XRReferenceSpace,
  group: Group,
): boolean {
  const xrPose = frame.getPose(xrSpace, refSpace);
  if (xrPose) {
    group.matrix.fromArray(xrPose.transform.matrix);
    group.matrix.decompose(group.position, group.quaternion, group.scale);
    return true;
  }
  return false;
}

/**
 * Whether the hand's wrist has a pose this frame. A frame without
 * getJointPose, or a hand without a wrist joint, counts as tracked: this
 * check only withholds work when the runtime says the hand is not tracked.
 */
function hasWristPose(
  frame: XRFrame,
  hand: XRHand,
  refSpace: XRReferenceSpace,
): boolean {
  const wrist = hand.get('wrist');
  if (!wrist || typeof frame.getJointPose !== 'function') {
    return true;
  }
  return frame.getJointPose(wrist, refSpace) !== null;
}
