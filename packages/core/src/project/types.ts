/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { WorldOptions } from '../init/world-initializer.js';

/** Version discriminator for the first IWSDK project manifest contract. */
export const IWSDK_PROJECT_MANIFEST_VERSION = 'iwsdk.project.v1' as const;

/** JSON representation of a regular expression used by development tooling. */
export interface ProjectRegexSpec {
  source: string;
  flags?: string;
}

export type ProjectXRMode = 'vr' | 'ar';
export type ProjectXROffer = 'none' | 'once' | 'always';
export type ProjectReferenceSpaceType =
  | 'bounded-floor'
  | 'local'
  | 'local-floor'
  | 'unbounded'
  | 'viewer';

export type ProjectXRFeatureFlag = boolean | { required?: boolean };

export type ProjectDepthSensingFlag =
  | boolean
  | {
      required?: boolean;
      usage?: 'cpu-optimized' | 'gpu-optimized';
      format?: 'luminance-alpha' | 'float32';
    };

export interface ProjectXRFeatureOptions {
  handTracking?: ProjectXRFeatureFlag;
  anchors?: ProjectXRFeatureFlag;
  hitTest?: ProjectXRFeatureFlag;
  planeDetection?: ProjectXRFeatureFlag;
  meshDetection?: ProjectXRFeatureFlag;
  depthSensing?: ProjectDepthSensingFlag;
  layers?: ProjectXRFeatureFlag;
  unbounded?: ProjectXRFeatureFlag;
  gazeTracking?: ProjectXRFeatureFlag;
  /** @deprecated Alias of {@link ProjectXRFeatureOptions.gazeTracking}. */
  eyeTracking?: ProjectXRFeatureFlag;
}

export type ProjectReferenceSpaceSpec =
  | ProjectReferenceSpaceType
  | {
      type?: ProjectReferenceSpaceType;
      required?: boolean;
      fallbackOrder?: ProjectReferenceSpaceType[];
    };

export interface ProjectXROptions {
  mode: ProjectXRMode;
  offer?: ProjectXROffer;
  referenceSpace?: ProjectReferenceSpaceSpec;
  restoreCameraOnExit?: boolean;
  launchOnSessionGranted?: boolean;
  features?: ProjectXRFeatureOptions;
}

export interface ProjectCameraOptions {
  position?: [number, number, number];
  rotation?: [number, number, number];
  quaternion?: [number, number, number, number];
  lookAt?: [number, number, number];
}

export interface ProjectRenderOptions {
  fov?: number;
  near?: number;
  far?: number;
  stencil?: boolean;
  camera?: ProjectCameraOptions;
}

export type ProjectCanvasPointerEventsOption =
  | boolean
  | {
      enabled?: boolean;
      activeDuringXR?: boolean;
    };

export interface ProjectInputOptions {
  canvasPointerEvents?: ProjectCanvasPointerEventsOption;
}

export type ProjectBrowserLocomotionControls =
  | boolean
  | {
      keyboard?: boolean;
      gamepad?: boolean;
    };

export type ProjectTurningMethod = 'snap' | 'smooth';

export type ProjectLocomotionOptions =
  | boolean
  | {
      useWorker?: boolean;
      initialPlayerPosition?: [number, number, number];
      comfortAssistLevel?: number;
      turningMethod?: ProjectTurningMethod;
      enableJumping?: boolean;
      browserControls?: ProjectBrowserLocomotionControls;
    };

export type ProjectGrabbingOptions =
  | boolean
  | { useHandPinchForGrab?: boolean };

export type ProjectPhysicsOptions =
  | boolean
  | {
      useWorker?: boolean;
      updateFrequency?: number;
      interpolation?: boolean;
    };

export type ProjectSceneUnderstandingOptions =
  | boolean
  | { showWireFrame?: boolean };

/**
 * Tuning for gaze + pinch. `GazeSystem` registration is driven by the
 * `xr.features.gazeTracking` session feature, not by this entry — these values
 * only override the system's defaults when gaze is already active.
 */
export interface ProjectGazeOptions {
  coneAngle?: number;
  maxRayLength?: number;
  dwellWindowSeconds?: number;
  filterMinCutoff?: number;
  filterBeta?: number;
  suppressWhenDirectPointerActive?: boolean;
  pointerTransformFollowsHand?: boolean;
  logDiagnostics?: boolean;
  showDebugReticle?: boolean;
  trackingLossGraceSeconds?: number;
}

export type ProjectSpatialUIOptions =
  | boolean
  | {
      forwardHtmlEvents?: boolean;
      kit?: 'default' | 'horizon';
      preferredColorScheme?: 'system' | 'light' | 'dark';
    };

export interface ProjectFeatureOptions {
  locomotion?: ProjectLocomotionOptions;
  grabbing?: ProjectGrabbingOptions;
  gaze?: ProjectGazeOptions;
  physics?: ProjectPhysicsOptions;
  sceneUnderstanding?: ProjectSceneUnderstandingOptions;
  environmentRaycast?: boolean;
  camera?: boolean;
  spatialUI?: ProjectSpatialUIOptions;
}

export interface ProjectWorldConfiguration {
  xr: false | ProjectXROptions;
  input?: ProjectInputOptions;
  render?: ProjectRenderOptions;
  features?: ProjectFeatureOptions;
}

export type ProjectEmulatorDevice =
  | 'metaQuest2'
  | 'metaQuest3'
  | 'metaQuestPro'
  | 'metaVRGlasses'
  | 'oculusQuest1';

/** IWER SEM's built-in GLTS rooms, the emulator's environments. */
export type ProjectEmulatorRoom =
  | 'sunlit_living_room'
  | 'home_office'
  | 'conference_room'
  | 'open_office'
  | 'kitchen'
  | 'bedroom'
  | 'music_studio'
  | 'open_studio';

/**
 * Ids of the legacy capture rooms, which IWSDK no longer offers; each loads
 * the built-in room that replaces it (see LEGACY_EMULATOR_ENVIRONMENT_ROOMS).
 * @deprecated Use a {@link ProjectEmulatorRoom} id.
 */
export type LegacyProjectEmulatorEnvironment =
  | 'living_room'
  | 'meeting_room'
  | 'music_room'
  | 'office_large'
  | 'office_small';

export type ProjectEmulatorEnvironment =
  | ProjectEmulatorRoom
  | LegacyProjectEmulatorEnvironment;

export interface ProjectEmulatorOptions {
  device?: ProjectEmulatorDevice;
  iwer?: boolean;
  environment?: ProjectEmulatorEnvironment;
  activation?: 'localhost' | 'always' | ProjectRegexSpec;
  injectOnBuild?: boolean;
  userAgentException?: ProjectRegexSpec;
}

export interface ProjectTargetDevicePreviewOptions {
  /** Add a viewer-directed gaze source when the app requests gaze. @defaultValue 'head' */
  gazeSimulation?: 'head' | false;
}

export interface ProjectDevOptions {
  emulator?: ProjectEmulatorOptions;
  /** Development-only preview layered on the browser's native XR session. */
  targetDevicePreview?: ProjectTargetDevicePreviewOptions;
  /**
   * What `iwsdk dev up` does when the project's coding-agent guidance is older
   * than the installed `@iwsdk/core`: `auto` (default) refreshes files nobody
   * edited, `warn` only reports it, `off` skips the check.
   */
  agentGuidance?: 'auto' | 'warn' | 'off';
}

export interface ProjectModuleDeclaration {
  /** Extensionless, project-root-confined browser module source path. */
  module: string;
}

/** Declarative, JSON-safe IWSDK project authority. */
export interface IwsdkProjectManifestV1 {
  $schema?: string;
  version: typeof IWSDK_PROJECT_MANIFEST_VERSION;
  /** Project source path under public/ ending in .iwsdk.scene.json. */
  scene: string;
  assets?: ProjectModuleDeclaration;
  components?: ProjectModuleDeclaration;
  world: ProjectWorldConfiguration;
  dev?: ProjectDevOptions;
}

/** World options produced before Vite injects executable asset/component manifests. */
export type NormalizedProjectWorldOptions = Omit<
  WorldOptions,
  'assets' | 'components'
> & {
  level: string;
};

export interface NormalizedProjectDevOptions {
  emulator?: {
    device?: ProjectEmulatorDevice;
    iwer?: boolean;
    environment?: ProjectEmulatorEnvironment;
    activation?: 'localhost' | 'always' | RegExp;
    injectOnBuild?: boolean;
    userAgentException?: RegExp;
  };
  targetDevicePreview?: {
    gazeSimulation: 'head' | false;
  };
}

export type ProjectManifestValidationIssueCode =
  | 'enum'
  | 'invalid-path'
  | 'invalid-regex'
  | 'range'
  | 'required'
  | 'type'
  | 'unknown-key';

export interface ProjectManifestValidationIssue {
  path: string;
  code: ProjectManifestValidationIssueCode;
  message: string;
}

export interface ProjectManifestValidationResult {
  valid: boolean;
  issues: ProjectManifestValidationIssue[];
}
