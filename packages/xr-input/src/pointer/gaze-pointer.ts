/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Pointer,
  createRayPointer,
  type Intersection,
} from '@pmndrs/pointer-events';
import {
  CircleGeometry,
  Color,
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
import type { GazeOrigin, XROrigin } from '../rig/xr-origin.js';
import {
  FilteredEyeGaze,
  FilteredEyeGazeOptions,
} from './filtered-eye-gaze.js';
import type {
  GazeCandidateContext,
  GazeCandidateProvider,
  GazeHit,
} from './gaze-candidate-provider.js';
import { GazeConecaster } from './gaze-conecaster.js';
import { isObjectTreeVisible } from './visibility.js';

export type GazeHand = 'left' | 'right';

/** Metadata exposed as `PointerEvent.pointerState` for the gaze ray. */
export interface GazePointerState {
  source: 'gaze';
  handedness: GazeHand | null;
}

/**
 * Per-frame input context passed into {@link GazePointer.update}.
 */
export interface GazePointerInput {
  /** Candidate Object3D roots (gaze-eligible interactables). */
  candidates: ReadonlyArray<Object3D>;
  /** Whether each hand's pinch went down this frame. */
  pinchStart: { left: boolean; right: boolean };
  /** Whether each hand's pinch was released this frame. */
  pinchEnd: { left: boolean; right: boolean };
  /** Whether each hand is currently pinching. */
  pinchActive: { left: boolean; right: boolean };
  /** Whether either hand has an active near touch/grab pointer. */
  directPointerActive: { left: boolean; right: boolean };
}

/**
 * The live WebXR state {@link GazePointer.sampleGazePose} needs to read the
 * gaze target ray itself, rather than trusting another system to have
 * refreshed the rig first.
 */
export interface GazeFrameContext {
  /** The frame currently being rendered. */
  frame: XRFrame;
  /**
   * Reference space the pose is resolved against. Must be the same space
   * {@link XROrigin.updateHead} used, since the result is written into
   * {@link XROrigin.eyeSpace}, which lives in that space.
   */
  referenceSpace: XRReferenceSpace;
  /** Session to scan for the gaze input source. */
  session: XRSession;
}

export interface GazePointerOptions {
  /** Suppress hover/select while a near touch/grab pointer is active. @default true */
  suppressWhenDirectPointerActive?: boolean;
  /**
   * On select commit, move the effective pointer origin to the pinching
   * hand's ray space so captured drags track the hand, not the eyes.
   * @default true
   */
  pointerTransformFollowsHand?: boolean;
  /** Reticle color while gaze is genuinely tracked. @default 0xffffff */
  reticleColor?: Color | number;
  /** Reticle radius in meters. @default 0.012 */
  reticleRadius?: number;
  /** Show the developer-only gaze hit reticle. @default false */
  showDebugReticle?: boolean;
  /** Keep gaze mode active briefly after tracking becomes invalid. @default 5 */
  trackingLossGraceSeconds?: number;
  /** OneEuro filter parameters applied to the gaze pose. */
  filter?: FilteredEyeGazeOptions;
  /**
   * Emit `[iwsdk][gaze]` console diagnostics explaining why gaze is (or isn't)
   * tracked, and whether the runtime's gaze ray actually separates from the
   * head ray. Eye tracking has several silent failure modes that are otherwise
   * indistinguishable from a missing source.
   * @default true
   */
  diagnostics?: boolean;
}

/**
 * Locate the eye-tracking input source.
 *
 * The primary scan is the one the standalone WebXR eye-gaze diagnostic page
 * uses verbatim — the gaze source is whichever entry of `session.inputSources`
 * reports `targetRayMode === 'gaze'`. `trackedSources` is checked afterwards
 * because some runtimes surface non-primary sources only there; the
 * diagnostics log says which list produced the hit.
 */
function findGazeSource(session: XRSession): {
  source: XRInputSource | undefined;
  fromTrackedSources: boolean;
} {
  for (const source of session.inputSources) {
    if (source.targetRayMode === 'gaze') {
      return { source, fromTrackedSources: false };
    }
  }
  if (session.trackedSources) {
    for (const source of session.trackedSources) {
      if (source.targetRayMode === 'gaze') {
        return { source, fromTrackedSources: true };
      }
    }
  }
  return { source: undefined, fromTrackedSources: false };
}

/**
 * Thresholds lifted from the standalone WebXR eye-gaze diagnostic page, so a
 * verdict logged here means the same thing as a verdict shown there.
 */
const GAZE_VERDICT = {
  /** Gaze/head separation that proves the eye ray is genuinely independent. */
  passAngleDeg: 1.5,
  /** Below this, one frame's gaze and head rays count as "the same ray". */
  identicalAngleDeg: 0.05,
  /** Below this (millimetres), one frame's gaze and head origins coincide. */
  identicalPositionMm: 0.5,
  /** Ratio of identical frames that indicates a head-pose mapping bug. */
  headLockedRatio: 0.95,
  /** Max separation still counted as head-locked. */
  headLockedAngleDeg: 0.1,
  /** Minimum evidence before any negative verdict is logged. */
  minSeconds: 3,
  minFrames: 90,
} as const;

const RAD_TO_DEG = 180 / Math.PI;
const diagForward = new Vector3();
const diagHeadForward = new Vector3();

const RETICLE_FORWARD = new Vector3(0, 0, 1);

function isIntentionalHeadDirectedPreview(): boolean {
  const preview = (
    globalThis as typeof globalThis & {
      __IWSDK_TARGET_DEVICE_PREVIEW__?: {
        active?: boolean;
        gazeSimulation?: 'head' | false;
      };
    }
  ).__IWSDK_TARGET_DEVICE_PREVIEW__;
  return preview?.active === true && preview.gazeSimulation === 'head';
}

/**
 * The development emulator (desktop IWER or a native override) supplies gaze
 * that only moves when aimed, so it starts out matching the head and must not
 * be reported as real eye data or as a head-locked runtime.
 */
function isEmulatedGaze(): boolean {
  const profile = (
    globalThis as typeof globalThis & {
      __IWSDK_EMULATION_PROFILE?: { active?: boolean };
    }
  ).__IWSDK_EMULATION_PROFILE;
  return profile?.active === true;
}

/**
 * One-shot console diagnostics for the gaze pipeline.
 *
 * Eye tracking fails silently in several distinct ways — feature not granted,
 * no gaze input source, source present but posed null, or a runtime that maps
 * the gaze target ray onto the head pose. These can otherwise look like either
 * missing or head-locked gaze, so each gets its own message with the
 * remediation that actually applies. Every message fires at most once per
 * state transition, so this is safe to leave on in a per-frame path.
 */
class GazeDiagnostics {
  private sessionStart = -1;
  private loggedFeature = false;
  private loggedMissingSource = false;
  private loggedTrackedSourcesFallback = false;
  private loggedPoseThrow = false;
  private loggedNoTargets = false;
  private loggedVerdict = false;
  private loggedInconclusive = false;
  private sourcePresent = false;
  /** Tri-state so the very first sample always logs its pose validity. */
  private poseValid: boolean | null = null;

  // Head-versus-gaze separation stats, accumulated over valid poses only.
  private firstValidPoseAt = -1;
  private comparisonFrames = 0;
  private identicalFrames = 0;
  private maxAngleDeg = 0;
  private maxPositionMm = 0;

  reset(): void {
    this.sessionStart = -1;
    this.loggedFeature = false;
    this.loggedMissingSource = false;
    this.loggedTrackedSourcesFallback = false;
    this.loggedPoseThrow = false;
    this.loggedNoTargets = false;
    this.loggedVerdict = false;
    this.loggedInconclusive = false;
    this.sourcePresent = false;
    this.poseValid = null;
    this.firstValidPoseAt = -1;
    this.comparisonFrames = 0;
    this.identicalFrames = 0;
    this.maxAngleDeg = 0;
    this.maxPositionMm = 0;
  }

  /**
   * @param time Monotonic seconds, matching {@link GazePointer.update}.
   * @param xrOrigin Rig whose `eyeSpace`/`head` hold this frame's poses.
   */
  frame(
    time: number,
    xrOrigin: XROrigin,
    session: XRSession,
    gazeSource: XRInputSource | undefined,
    fromTrackedSources: boolean,
    posed: boolean,
  ): void {
    if (this.sessionStart < 0) {
      this.sessionStart = time;
    }
    this.logFeature(session);
    this.logSource(time, gazeSource, fromTrackedSources);
    this.logPose(gazeSource, posed);
    if (posed) {
      this.compareWithHead(time, xrOrigin);
    }
  }

  /** Nothing is gaze-eligible, so gaze can never hit anything. */
  targets(count: number): void {
    if (count > 0) {
      this.loggedNoTargets = false;
      return;
    }
    if (this.loggedNoTargets) {
      return;
    }
    this.loggedNoTargets = true;
    console.info(
      '[iwsdk][gaze] no ray-interactable targets are available, so the gaze ' +
        'cone has nothing to hit.',
    );
  }

  poseThrew(error: unknown): void {
    if (this.loggedPoseThrow) {
      return;
    }
    this.loggedPoseThrow = true;
    console.warn(
      '[iwsdk][gaze] frame.getPose(gazeSource.targetRaySpace) threw; tracked ' +
        'gaze is unavailable for this frame.',
      error,
    );
  }

  /** Report whether the runtime actually granted `gaze-tracking`. */
  private logFeature(session: XRSession): void {
    if (this.loggedFeature) {
      return;
    }
    this.loggedFeature = true;
    // `enabledFeatures` is not in every UA's lib.dom typing yet.
    const enabled = (session as XRSession & { enabledFeatures?: string[] })
      .enabledFeatures;
    if (!enabled) {
      console.info(
        "[iwsdk][gaze] this browser doesn't expose session.enabledFeatures, " +
          "so whether 'gaze-tracking' was granted can't be confirmed here. " +
          'Watch for the gaze XRInputSource message below instead.',
      );
      return;
    }
    const enabledFeatures = Array.from(enabled);
    if (
      enabledFeatures.includes('gaze-tracking') ||
      enabledFeatures.includes('eye-tracking')
    ) {
      console.info("[iwsdk][gaze] 'gaze-tracking' granted for this session.", {
        enabledFeatures,
      });
      return;
    }
    console.warn(
      "[iwsdk][gaze] 'gaze-tracking' was NOT granted for this session, so " +
        'tracked gaze is unavailable. Check that the project requests ' +
        'xr.features.gazeTracking, that this browser build exposes eye ' +
        "tracking, and that the page's permissions policy allows " +
        'xr-spatial-tracking.',
      { enabledFeatures },
    );
  }

  private logSource(
    time: number,
    gazeSource: XRInputSource | undefined,
    fromTrackedSources: boolean,
  ): void {
    const present = !!gazeSource;

    if (present && fromTrackedSources && !this.loggedTrackedSourcesFallback) {
      this.loggedTrackedSourcesFallback = true;
      console.info(
        '[iwsdk][gaze] gaze source found in session.trackedSources rather ' +
          'than session.inputSources.',
      );
    }

    if (present !== this.sourcePresent) {
      this.sourcePresent = present;
      this.poseValid = null;
      if (present) {
        // A later disconnect is "showed up then left", never "never appeared".
        this.loggedMissingSource = true;
        console.info('[iwsdk][gaze] gaze XRInputSource appeared.', {
          profiles: Array.from(gazeSource!.profiles),
          handedness: gazeSource!.handedness,
        });
      } else {
        console.warn(
          '[iwsdk][gaze] the gaze XRInputSource disappeared; ' +
            'ordinary hand/controller far targeting is now active.',
        );
      }
      return;
    }

    // Never showed up at all — distinct failure from "showed up then left".
    if (
      !present &&
      !this.loggedMissingSource &&
      time - this.sessionStart >= GAZE_VERDICT.minSeconds
    ) {
      this.loggedMissingSource = true;
      console.warn(
        '[iwsdk][gaze] no XRInputSource with targetRayMode === "gaze" ' +
          `appeared within ${GAZE_VERDICT.minSeconds}s of session start. ` +
          'Ordinary hand/controller far targeting remains active. Common causes: the ' +
          'feature was not granted, eye tracking is disabled in system ' +
          'settings, the headset has not been calibrated for this user, or ' +
          'the hardware has no eye tracking.',
      );
    }
  }

  private logPose(gazeSource: XRInputSource | undefined, posed: boolean): void {
    if (!gazeSource || posed === this.poseValid) {
      return;
    }
    this.poseValid = posed;
    if (posed) {
      console.info(
        isEmulatedGaze()
          ? '[iwsdk][gaze] emulated gaze pose is valid (synthetic, not eye tracking).'
          : '[iwsdk][gaze] eye pose is valid — real gaze data is flowing.',
      );
    } else {
      console.warn(
        '[iwsdk][gaze] the gaze input source is present but ' +
          'frame.getPose(targetRaySpace) returned null, so tracked gaze is ' +
          'temporarily unavailable. Common causes: OS eye-tracking permission ' +
          'not granted, headset not calibrated, or hardware without eye tracking.',
      );
    }
  }

  /**
   * Compare the tracked gaze ray against the head ray. A runtime can hand back
   * a perfectly valid gaze pose that is just a copy of the viewer pose; that
   * is indistinguishable from the fallback unless the two are measured.
   */
  private compareWithHead(time: number, xrOrigin: XROrigin): void {
    if (this.loggedVerdict) {
      return;
    }
    const eye = xrOrigin.eyeSpace;
    const head = xrOrigin.head;
    diagForward.set(0, 0, -1).applyQuaternion(eye.quaternion);
    diagHeadForward.set(0, 0, -1).applyQuaternion(head.quaternion);
    const dot = Math.min(1, Math.max(-1, diagForward.dot(diagHeadForward)));
    const angleDeg = Math.acos(dot) * RAD_TO_DEG;
    const positionMm = eye.position.distanceTo(head.position) * 1000;

    if (this.firstValidPoseAt < 0) {
      this.firstValidPoseAt = time;
    }
    this.comparisonFrames++;
    this.maxAngleDeg = Math.max(this.maxAngleDeg, angleDeg);
    this.maxPositionMm = Math.max(this.maxPositionMm, positionMm);
    if (
      angleDeg < GAZE_VERDICT.identicalAngleDeg &&
      positionMm < GAZE_VERDICT.identicalPositionMm
    ) {
      this.identicalFrames++;
    }

    if (this.maxAngleDeg >= GAZE_VERDICT.passAngleDeg) {
      this.loggedVerdict = true;
      console.info(
        '[iwsdk][gaze] real eye movement observed — the gaze ray separates ' +
          `from the head ray by up to ${this.maxAngleDeg.toFixed(2)}°.`,
      );
      return;
    }

    if (
      time - this.firstValidPoseAt < GAZE_VERDICT.minSeconds ||
      this.comparisonFrames < GAZE_VERDICT.minFrames
    ) {
      return;
    }

    const identicalRatio = this.identicalFrames / this.comparisonFrames;
    if (
      identicalRatio >= GAZE_VERDICT.headLockedRatio &&
      this.maxAngleDeg < GAZE_VERDICT.headLockedAngleDeg &&
      this.maxPositionMm < GAZE_VERDICT.identicalPositionMm
    ) {
      this.loggedVerdict = true;
      if (isIntentionalHeadDirectedPreview()) {
        console.info(
          '[iwsdk][gaze] target-device preview is intentionally ' +
            'providing head-directed synthetic gaze.',
        );
        return;
      }
      if (isEmulatedGaze()) {
        console.info(
          '[iwsdk][gaze] emulated gaze still points where the head does; ' +
            'aim it (for example with xr look-at on "gaze") to test targeting.',
        );
        return;
      }
      console.warn(
        '[iwsdk][gaze] the gaze target-ray pose matched the head pose on ' +
          `${(identicalRatio * 100).toFixed(0)}% of ${this.comparisonFrames} ` +
          `frames (max separation ${this.maxAngleDeg.toFixed(3)}°). Eye ` +
          'tracking is reporting poses, but the runtime is mapping ' +
          'XRTargetRaySpace onto the head pose, so gaze behaves as ' +
          'head-pointing. This is a runtime/build issue, not an app one.',
      );
      return;
    }

    if (!this.loggedInconclusive) {
      this.loggedInconclusive = true;
      console.info(
        `[iwsdk][gaze] inconclusive: only ${this.maxAngleDeg.toFixed(2)}° of ` +
          `gaze/head separation over ${this.comparisonFrames} frames. Hold ` +
          'your head still and look far left and right to confirm real gaze.',
      );
    }
  }
}

/**
 * Singleton gaze pointer. Peer of {@link MultiPointer} in
 * {@link XRInputManager}.
 *
 * @remarks
 * - One global instance — gaze has no handedness.
 * - Samples the WebXR gaze target ray itself via
 *   {@link GazePointer.sampleGazePose}, publishing the result to
 *   {@link XROrigin.eyeSpace}. The hand/controller ray owns far targeting when
 *   a gaze source is unavailable. {@link GazePointerOptions.diagnostics}
 *   explains the silent failure modes.
 * - Candidate selection is delegated to a {@link GazeCandidateProvider};
 *   the default {@link GazeConecaster} does OBB cone membership and
 *   time-weighted dwell consensus while this pointer resolves surfaces with
 *   the same pmndrs ray intersector used for event delivery.
 * - Selector composes either hand's pinch; once selecting, the other hand
 *   is ignored until release (per-hand mutual exclusion, matching Meta
 *   Interaction SDK's `HandGazeInteractor` semantics).
 * - Drives a real `@pmndrs/pointer-events` pointer so UIKit panels click
 *   naturally on gaze-pinch.
 * - Keeps its optional debug reticle hidden by default. Production feedback
 *   belongs on the hovered target, matching Meta Interaction SDK.
 *
 * @category Pointer
 */
export class GazePointer {
  public readonly reticle: Mesh<CircleGeometry, MeshBasicMaterial>;

  public provider: GazeCandidateProvider;
  public suppressWhenDirectPointerActive: boolean;
  public pointerTransformFollowsHand: boolean;
  public showDebugReticle: boolean;

  private _trackingLossGraceSeconds = 5;

  public get trackingLossGraceSeconds(): number {
    return this._trackingLossGraceSeconds;
  }

  public set trackingLossGraceSeconds(value: number) {
    this._trackingLossGraceSeconds = Number.isFinite(value)
      ? Math.max(0, value)
      : 0;
  }

  /** See {@link GazePointerOptions.diagnostics}. */
  public diagnosticsEnabled: boolean;

  /**
   * OneEuro smoother applied to the raw gaze pose. Public so hosts can retune
   * `minCutoff`/`beta` from config without rebuilding the pointer.
   */
  public readonly filter: FilteredEyeGaze;

  /**
   * Real `@pmndrs/pointer-events` Pointer driven by the filtered gaze ray.
   * Each frame: pose-update + `pointer.move(scene)` raycasts from the gaze
   * origin so UIKit and any other pointer-events listeners see enter/leave/
   * move events from the gaze just like they do from the hand ray. On pinch
   * we forward `down`/`up` with `button: 0` so `click` fires naturally.
   */
  public readonly pointer: Pointer;
  public readonly pointerState: GazePointerState = {
    source: 'gaze',
    handedness: null,
  };

  private readonly filteredOrigin = new Vector3();
  private readonly filteredQuaternion = new Quaternion();
  private readonly rawOrigin = new Vector3();
  private readonly rawQuaternion = new Quaternion();
  private readonly direction = new Vector3();
  private readonly aimDirection = new Vector3();
  private readonly reticleOffset = new Vector3();
  private readonly rayTarget = new Vector3();
  private readonly rayUp = new Vector3();
  private readonly handOrigin = new Vector3();
  private readonly handQuaternion = new Quaternion();
  private readonly worldRayQuaternion = new Quaternion();
  private readonly handRelativeRayQuaternion = new Quaternion();
  private readonly tmpQuat = new Quaternion();
  private readonly lookMatrix = new Matrix4();
  private readonly normalMatrix = new Matrix3();

  /** Reticle tint while gaze is genuinely tracked. */
  private readonly reticleTrackedColor: Color;

  /**
   * Synthetic `Object3D` whose world transform mirrors the *filtered* gaze
   * pose. Lives under `xrOrigin` so it inherits rig motion; the @pmndrs ray
   * intersector reads its position/quaternion to cast from.
   */
  private readonly gazeRaySpace: Object3D;

  private readonly conecasterCtx: GazeCandidateContext = {
    origin: this.filteredOrigin,
    direction: this.direction,
    candidates: [] as ReadonlyArray<Object3D>,
    intersectCandidate: (candidate, direction) =>
      this.intersectCandidate(candidate, direction),
  };

  private readonly nativeEvent = { timeStamp: 0 };
  private readonly buttonEvent = { timeStamp: 0, button: 0 };

  private currentHit: GazeHit | null = null;
  private heldHit: GazeHit | null = null;
  private heldByHand: GazeHand | null = null;
  private wasSelecting = false;
  private buttonDown = false;
  private heldFollowsHand = false;
  private hasAcquiredTrackedGaze = false;
  private gazeSource: XRInputSource | null = null;
  private gazeSourcePresent = false;
  private lastTrackedPoseTime = Number.NEGATIVE_INFINITY;

  private readonly diagnostics = new GazeDiagnostics();

  constructor(
    private readonly xrOrigin: XROrigin,
    private readonly scene: Scene,
    camera: PerspectiveCamera,
    options: GazePointerOptions = {},
  ) {
    this.provider = new GazeConecaster();
    this.suppressWhenDirectPointerActive =
      options.suppressWhenDirectPointerActive ?? true;
    this.pointerTransformFollowsHand =
      options.pointerTransformFollowsHand ?? true;
    this.showDebugReticle = options.showDebugReticle ?? false;
    this.trackingLossGraceSeconds = options.trackingLossGraceSeconds ?? 5;
    this.diagnosticsEnabled = options.diagnostics ?? true;
    this.filter = new FilteredEyeGaze(options.filter);

    this.reticleTrackedColor =
      options.reticleColor instanceof Color
        ? options.reticleColor.clone()
        : new Color(options.reticleColor ?? 0xffffff);
    const radius = options.reticleRadius ?? 0.012;
    this.reticle = new Mesh(
      new CircleGeometry(radius, 32),
      new MeshBasicMaterial({
        color: this.reticleTrackedColor.clone(),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.reticle.renderOrder = Infinity;
    this.reticle.visible = false;
    this.reticle.name = 'gaze-reticle';

    // Synthetic ray source for the @pmndrs Pointer. We can't use eyeSpace
    // directly because we want the *filtered* pose, not the raw per-frame
    // gaze. Manual matrix updates: we drive position/quaternion explicitly
    // each frame from the filter output.
    this.gazeRaySpace = new Object3D();
    this.gazeRaySpace.name = 'gaze-ray-space';
    this.gazeRaySpace.matrixAutoUpdate = false;

    this.pointer = createRayPointer(
      () => camera,
      { current: this.gazeRaySpace },
      this.pointerState,
      // contextMenu lives on button 2; gaze never produces it. Disable to
      // avoid spurious contextmenu events.
      {
        contextMenuButton: -1,
        filter: isObjectTreeVisible,
      },
    );
    // BVH-accelerated firstHitOnly raycast (matches hand RayPointer).
    const raycaster = (
      this.pointer.intersector as unknown as {
        raycaster?: { firstHitOnly?: boolean };
      }
    ).raycaster;
    if (raycaster) {
      raycaster.firstHitOnly = true;
    }
  }

  /**
   * Add or remove the pointer's rig nodes (debug reticle and ray space).
   *
   * The pointer is constructed eagerly by {@link XRInputManager} so systems can
   * hold a stable reference, but an app that never uses gaze shouldn't pay for
   * gaze geometry in every rig matrix walk — so nothing is parented until gaze
   * is actually switched on.
   */
  setAttached(attached: boolean): void {
    if (attached) {
      this.xrOrigin.add(this.reticle, this.gazeRaySpace);
    } else {
      this.reticle.removeFromParent();
      this.gazeRaySpace.removeFromParent();
    }
  }

  /**
   * Read the gaze target ray off the live frame and write it into
   * {@link XROrigin.eyeSpace}.
   *
   * This mirrors the standalone WebXR eye-gaze diagnostic page's probe: find
   * the input source whose `targetRayMode` is `'gaze'`, then pose its
   * `targetRaySpace` against the frame's reference space, tolerating a throw.
   * The source can exist while `getPose` returns null (uncalibrated headset,
   * withheld permission), so source presence and pose validity are tracked
   * separately. A missing or invalid pose clears the current gaze pose so stale
   * tracking can never be used for targeting.
   *
   * Call once per frame before {@link GazePointer.update}.
   */
  sampleGazePose(time: number, context: GazeFrameContext): void {
    const { frame, referenceSpace, session } = context;
    const { source, fromTrackedSources } = findGazeSource(session);
    const nextGazeSource = source ?? null;
    if (nextGazeSource !== this.gazeSource) {
      // Grace belongs to one uninterrupted source lifetime. A source that is
      // removed or replaced must earn ownership again with a valid pose.
      this.hasAcquiredTrackedGaze = false;
      this.lastTrackedPoseTime = Number.NEGATIVE_INFINITY;
      this.gazeSource = nextGazeSource;
    }
    this.gazeSourcePresent = source != null;
    this.xrOrigin.clearGaze();
    let pose: XRPose | null = null;
    if (source) {
      try {
        pose = frame.getPose(source.targetRaySpace, referenceSpace) ?? null;
      } catch (error) {
        if (this.diagnosticsEnabled) {
          this.diagnostics.poseThrew(error);
        }
      }
    }

    if (pose) {
      this.xrOrigin.applyTrackedEyePose(pose.transform);
      this.hasAcquiredTrackedGaze = true;
      this.lastTrackedPoseTime = time;
    }

    if (this.diagnosticsEnabled) {
      this.diagnostics.frame(
        time,
        this.xrOrigin,
        session,
        source,
        fromTrackedSources,
        !!pose,
      );
    }
  }

  /**
   * Whether gaze mode should own far targeting this frame.
   *
   * This mirrors ISDK's mode/source distinction: a valid pose activates gaze;
   * then a short grace period keeps the mode active when a frame's pose is
   * invalid (for example, a blink), while targeting itself clears. WebXR does
   * not expose a separate pose-validity signal, so source enumeration defines
   * the lifetime of that grace period. Removing the source hands far targeting
   * back to hands/controllers immediately; the grace period applies only to
   * temporary pose invalidity (for example, a blink).
   */
  ownsFarTargeting(time: number): boolean {
    if (!this.gazeSourcePresent) {
      return false;
    }
    if (this.xrOrigin.gazeOrigin === 'tracked') {
      return true;
    }
    return (
      this.hasAcquiredTrackedGaze &&
      time - this.lastTrackedPoseTime <= this.trackingLossGraceSeconds
    );
  }

  /** Whether this frame has a pose that is safe to use for fresh targeting. */
  canTarget(): boolean {
    return this.xrOrigin.gazeOrigin === 'tracked';
  }

  /**
   * Swap the candidate provider at runtime (e.g. a multi-cone or dwell-only
   * provider). The previous provider is reset and detached.
   */
  setCandidateProvider(provider: GazeCandidateProvider): void {
    this.provider.reset();
    this.provider = provider;
  }

  update(
    targetingAvailable: boolean,
    dt: number,
    time: number,
    input: GazePointerInput,
  ): void {
    this.nativeEvent.timeStamp = time * 1000;

    // Source removal is a mode transition, not transient tracking loss. End a
    // gaze-started gesture before hand/controller far targeting resumes.
    if (!this.gazeSourcePresent && !targetingAvailable && this.heldByHand) {
      this.releaseSelect(true);
    }

    if (!targetingAvailable && !this.heldByHand) {
      this.provider.reset();
      this.filter.reset();
      this.currentHit = null;
      this.reticle.visible = false;
      this.releaseAndDisable();
      return;
    }

    let releasedSelect = false;
    if (this.heldByHand) {
      const hand = this.heldByHand;
      const pinchEnded = input.pinchEnd[hand];
      const targetAvailable = this.isHeldTargetAvailable(input.candidates);
      if (pinchEnded || !input.pinchActive[hand] || !targetAvailable) {
        // A real pinch-end is an up/click. Tracking loss, reset, removal, or
        // semantic invisibility interrupts the gesture and must cancel it.
        this.releaseSelect(!pinchEnded || !targetAvailable);
        releasedSelect = true;
      } else {
        this.driveHeldPointer();
        this.updateReticle();
        return;
      }
    }

    // A transient invalid eye pose clears hover immediately, matching ISDK,
    // but does not interrupt a selection that was already handed off to the
    // pinching hand. Once that gesture ends there is no stale pose from which
    // to start a new selection.
    if (!targetingAvailable) {
      this.provider.reset();
      this.filter.reset();
      this.currentHit = null;
      this.reticle.visible = false;
      this.releaseAndDisable();
      return;
    }

    if (this.diagnosticsEnabled) {
      this.diagnostics.targets(input.candidates.length);
    }

    // World-space pose of the (raw) gaze, then smoothed in-place. This runs
    // only with a current targeting pose, so a transient invalid frame cannot
    // contaminate the eye filter with the previous valid gaze pose.
    this.xrOrigin.eyeSpace.getWorldPosition(this.rawOrigin);
    this.xrOrigin.eyeSpace.getWorldQuaternion(this.rawQuaternion);
    this.filter.filter(
      this.rawOrigin,
      this.rawQuaternion,
      Math.max(dt, 1 / 240),
      this.filteredOrigin,
      this.filteredQuaternion,
    );
    this.direction.set(0, 0, -1).applyQuaternion(this.filteredQuaternion);

    const externallySuppressed =
      this.suppressWhenDirectPointerActive &&
      (input.directPointerActive.left || input.directPointerActive.right);

    if (externallySuppressed) {
      this.currentHit = null;
      this.reticle.visible = false;
      this.commitNoTarget();
    } else {
      this.conecasterCtx.candidates = input.candidates;
      this.currentHit = this.provider.update(time, dt, this.conecasterCtx);
      if (this.currentHit) {
        this.commitHit(this.currentHit);
      } else {
        this.commitNoTarget();
      }
    }

    if (!releasedSelect) {
      this.processSelector(input);
    }
    this.updateReticle();
  }

  /** Resolve one candidate through the same intersector used for dispatch. */
  private intersectCandidate(
    candidate: Object3D,
    direction: Vector3,
  ): Intersection | null {
    this.setRayFromDirection(
      this.filteredOrigin,
      direction,
      this.filteredQuaternion,
    );
    const intersection = this.computeScopedIntersection([candidate]);
    return intersection.object.isVoidObject ? null : intersection;
  }

  /** Install the provider's authoritative intersection and emit one move. */
  private commitHit(hit: GazeHit): void {
    this.ensurePointerEnabled();
    this.setRayWorldPose(
      hit.intersection.pointerPosition,
      hit.intersection.pointerQuaternion,
    );
    this.pointer.setIntersection(hit.intersection);
    this.pointer.commit(this.nativeEvent, true);
  }

  /** Commit a void hit so the previous target receives out/leave events. */
  private commitNoTarget(): void {
    this.currentHit = null;
    this.ensurePointerEnabled();
    this.setRayFromDirection(
      this.filteredOrigin,
      this.direction,
      this.filteredQuaternion,
    );
    const intersection = this.computeScopedIntersection([]);
    this.pointer.setIntersection(intersection);
    this.pointer.commit(this.nativeEvent, true);
  }

  private computeScopedIntersection(descendants: Object3D[]): Intersection {
    const scene = this.scene as Scene & {
      interactableDescendants?: Object3D[];
    };
    const previous = scene.interactableDescendants;
    scene.interactableDescendants = descendants;
    try {
      return this.pointer.computeIntersection(
        'pointer',
        this.scene,
        this.nativeEvent,
      );
    } finally {
      scene.interactableDescendants = previous;
    }
  }

  private ensurePointerEnabled(): void {
    if (!this.pointer.getEnabled()) {
      this.pointer.setEnabled(true, this.nativeEvent, false);
    }
  }

  /** Pose the synthetic ray in world space while it remains parented to the rig. */
  private setRayWorldPose(origin: Vector3, quaternion: Quaternion): void {
    this.xrOrigin.updateWorldMatrix(true, false);
    this.gazeRaySpace.position.copy(origin);
    this.xrOrigin.worldToLocal(this.gazeRaySpace.position);
    this.xrOrigin.getWorldQuaternion(this.tmpQuat).invert();
    this.gazeRaySpace.quaternion.copy(this.tmpQuat).multiply(quaternion);
    this.gazeRaySpace.updateMatrix();
    this.gazeRaySpace.updateMatrixWorld(true);
  }

  /** Build a ray pose whose -Z axis follows `direction`. */
  private setRayFromDirection(
    origin: Vector3,
    direction: Vector3,
    upQuaternion: Quaternion,
  ): void {
    this.rayTarget.copy(origin).add(direction);
    this.rayUp.set(0, 1, 0).applyQuaternion(upQuaternion);
    this.lookMatrix.lookAt(origin, this.rayTarget, this.rayUp);
    this.worldRayQuaternion.setFromRotationMatrix(this.lookMatrix);
    this.setRayWorldPose(origin, this.worldRayQuaternion);
  }

  /** Release event state before disabling or detaching the pointer. */
  private releaseAndDisable(): void {
    this.releaseSelect(true);
    if (!this.pointer.getEnabled()) {
      return;
    }
    this.pointer.exit(this.nativeEvent);
    this.pointer.setEnabled(false, this.nativeEvent, false);
  }

  private updateReticle(): void {
    if (!this.showDebugReticle) {
      this.reticle.visible = false;
      return;
    }
    const intersection = this.pointer.getIntersection();
    if (!intersection || intersection.object.isVoidObject) {
      this.reticle.visible = false;
      return;
    }
    if (
      this.reticle.material.color.getHex() !== this.reticleTrackedColor.getHex()
    ) {
      this.reticle.material.color.copy(this.reticleTrackedColor);
    }
    this.reticleOffset.copy(intersection.point);
    this.xrOrigin.worldToLocal(this.reticleOffset);
    this.reticle.position.copy(this.reticleOffset);

    const normal = intersection.normal ?? intersection.face?.normal;
    if (normal) {
      this.normalMatrix.getNormalMatrix(intersection.object.matrixWorld);
      this.rayUp.copy(normal).applyNormalMatrix(this.normalMatrix).normalize();
      this.reticle.quaternion.setFromUnitVectors(RETICLE_FORWARD, this.rayUp);
      this.xrOrigin.getWorldQuaternion(this.tmpQuat).invert();
      this.reticle.quaternion.premultiply(this.tmpQuat);
    }
    // Scale reticle gently with distance for legibility.
    const s = Math.max(0.6, Math.min(2, intersection.distance));
    this.reticle.scale.setScalar(s);
    this.reticle.visible = true;
  }

  private processSelector(input: GazePointerInput): void {
    const hand: GazeHand | null = input.pinchStart.left
      ? 'left'
      : input.pinchStart.right
        ? 'right'
        : null;
    if (!hand || !this.currentHit) {
      return;
    }

    const gazeHit = this.currentHit;
    this.heldByHand = hand;
    this.pointerState.handedness = hand;
    this.heldFollowsHand = false;

    let selectIntersection = gazeHit.intersection;
    if (this.pointerTransformFollowsHand) {
      const handSpace = this.xrOrigin.raySpaces[hand];
      handSpace.updateWorldMatrix(true, false);
      handSpace.getWorldPosition(this.handOrigin);
      handSpace.getWorldQuaternion(this.handQuaternion);
      this.aimDirection.copy(gazeHit.intersection.point).sub(this.handOrigin);
      if (this.aimDirection.lengthSq() > 1e-12) {
        this.aimDirection.normalize();
        this.setRayFromDirection(
          this.handOrigin,
          this.aimDirection,
          this.handQuaternion,
        );
        const handIntersection = this.computeScopedIntersection([
          gazeHit.object,
        ]);
        if (
          !handIntersection.object.isVoidObject &&
          handIntersection.object === gazeHit.intersection.object
        ) {
          selectIntersection = handIntersection;
          this.handRelativeRayQuaternion
            .copy(this.handQuaternion)
            .invert()
            .multiply(handIntersection.pointerQuaternion);
          this.heldFollowsHand = true;
        } else {
          this.setRayWorldPose(
            gazeHit.intersection.pointerPosition,
            gazeHit.intersection.pointerQuaternion,
          );
        }
      }
    }

    this.heldHit = {
      object: gazeHit.object,
      intersection: selectIntersection,
      angularDistance: gazeHit.angularDistance,
    };
    this.wasSelecting = true;
    this.pointer.setIntersection(selectIntersection);
    // The hover path already emitted this frame's move. This commit only needs
    // to install the hand-origin intersection before a synchronous capture in
    // `down()`; enter/leave bookkeeping still runs if the leaf changed.
    this.pointer.commit(this.nativeEvent, false);
    this.buttonEvent.timeStamp = this.nativeEvent.timeStamp;
    this.buttonEvent.button = 0;
    this.buttonDown = true;
    try {
      this.pointer.down(this.buttonEvent);
    } catch {
      this.releaseSelect(true);
    }
  }

  private driveHeldPointer(): void {
    if (!this.heldHit || !this.heldByHand) {
      return;
    }

    if (this.pointer.getPointerCapture()) {
      if (this.heldFollowsHand) {
        const handSpace = this.xrOrigin.raySpaces[this.heldByHand];
        handSpace.updateWorldMatrix(true, false);
        handSpace.getWorldPosition(this.handOrigin);
        handSpace.getWorldQuaternion(this.handQuaternion);
        this.worldRayQuaternion
          .copy(this.handQuaternion)
          .multiply(this.handRelativeRayQuaternion);
        this.setRayWorldPose(this.handOrigin, this.worldRayQuaternion);
      } else {
        this.setRayWorldPose(
          this.heldHit.intersection.pointerPosition,
          this.heldHit.intersection.pointerQuaternion,
        );
      }
      this.pointer.move(this.scene, this.nativeEvent);
      return;
    }

    // Plain clickable targets generally do not capture. Keep their select-time
    // intersection stable so small hand motion during the pinch cannot turn a
    // valid down into an up on the void object.
    this.setRayWorldPose(
      this.heldHit.intersection.pointerPosition,
      this.heldHit.intersection.pointerQuaternion,
    );
    this.pointer.setIntersection(this.heldHit.intersection);
    this.pointer.commit(this.nativeEvent, true);
  }

  private isHeldTargetAvailable(candidates: ReadonlyArray<Object3D>): boolean {
    const object = this.heldHit?.object;
    return (
      !!object && isObjectTreeVisible(object) && candidates.includes(object)
    );
  }

  private releaseSelect(cancelled = false): void {
    if (this.buttonDown) {
      this.buttonEvent.timeStamp = this.nativeEvent.timeStamp;
      this.buttonEvent.button = 0;
      if (cancelled) {
        try {
          this.pointer.cancel(this.nativeEvent);
        } catch {}
        // Pointer.cancel emits the correct event but the upstream pointer
        // keeps its button/capture bookkeeping. Clear it while disabled so no
        // pointerup or click is dispatched for an interrupted gesture.
        const wasEnabled = this.pointer.getEnabled();
        if (wasEnabled) {
          this.pointer.setEnabled(false, this.nativeEvent, true);
        }
        try {
          this.pointer.up(this.buttonEvent);
        } catch {}
        if (wasEnabled) {
          this.pointer.setEnabled(true, this.nativeEvent, false);
        }
      } else {
        try {
          this.pointer.up(this.buttonEvent);
        } catch {}
      }
      this.buttonDown = false;
    }
    this.heldHit = null;
    this.heldByHand = null;
    this.pointerState.handedness = null;
    this.heldFollowsHand = false;
    this.wasSelecting = false;
  }

  /** Current dwell winner's root Object3D (null if none/suppressed). */
  getCurrentTarget(): Object3D | null {
    return this.currentHit?.object ?? null;
  }

  /** Which hand initiated the active gaze-pinch select. */
  getHeldByHand(): GazeHand | null {
    return this.heldByHand;
  }

  /** True while a gaze-pinch select is held. */
  isSelecting(): boolean {
    return this.wasSelecting;
  }

  /** World-space gaze origin (post-filter). */
  getOrigin(): Vector3 {
    return this.filteredOrigin;
  }

  /** World-space gaze direction (post-filter, unit length). */
  getDirection(): Vector3 {
    return this.direction;
  }

  /**
   * Whether a valid gaze pose is available this frame.
   */
  getGazeOrigin(): GazeOrigin {
    return this.xrOrigin.gazeOrigin;
  }

  /**
   * Reset filter, provider, selector and diagnostic state. Call when gaze
   * becomes invalid (session ended, eye tracking lost) so we don't carry stale
   * samples, and so the next session re-reports its gaze verdict.
   */
  reset(): void {
    this.diagnostics.reset();
    this.provider.reset();
    this.filter.reset();
    this.currentHit = null;
    this.hasAcquiredTrackedGaze = false;
    this.gazeSource = null;
    this.gazeSourcePresent = false;
    this.lastTrackedPoseTime = Number.NEGATIVE_INFINITY;
    this.reticle.visible = false;
    this.releaseAndDisable();
  }

  dispose(): void {
    this.releaseAndDisable();
    this.reticle.geometry.dispose();
    this.reticle.material.dispose();
    this.reticle.removeFromParent();
    this.gazeRaySpace.removeFromParent();
  }
}
