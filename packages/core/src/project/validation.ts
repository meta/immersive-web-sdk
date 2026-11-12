/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  LEGACY_EMULATOR_ENVIRONMENT_ROOMS,
  PROJECT_EMULATOR_ROOMS,
} from './environments.js';
import { normalizeProjectSourcePath } from './paths.js';
import {
  IWSDK_PROJECT_MANIFEST_VERSION,
  type IwsdkProjectManifestV1,
  type ProjectManifestValidationIssue,
  type ProjectManifestValidationIssueCode,
  type ProjectManifestValidationResult,
} from './types.js';

type JsonObject = Record<string, unknown>;

const REFERENCE_SPACE_TYPES = [
  'bounded-floor',
  'local',
  'local-floor',
  'unbounded',
  'viewer',
] as const;
const OFFER_VALUES = ['none', 'once', 'always'] as const;
const AGENT_GUIDANCE_MODES = ['auto', 'warn', 'off'] as const;
const DEVICES = [
  'metaQuest2',
  'metaQuest3',
  'metaQuestPro',
  'metaVRGlasses',
  'oculusQuest1',
] as const;
const ENVIRONMENTS = [
  ...PROJECT_EMULATOR_ROOMS,
  ...Object.keys(LEGACY_EMULATOR_ENVIRONMENT_ROOMS),
];

/** Error containing every issue found in a project manifest. */
export class ProjectManifestValidationError extends Error {
  constructor(readonly issues: readonly ProjectManifestValidationIssue[]) {
    super(
      `Invalid IWSDK project manifest:\n${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'ProjectManifestValidationError';
  }
}

/** Validate the closed `iwsdk.project.v1` JSON contract. */
export function validateIwsdkProjectManifest(
  value: unknown,
): ProjectManifestValidationResult {
  const issues: ProjectManifestValidationIssue[] = [];
  const root = objectValue(
    value,
    '$',
    ['$schema', 'version', 'scene', 'assets', 'components', 'world', 'dev'],
    ['version', 'scene', 'world'],
    issues,
  );
  if (root == null) {
    return { valid: false, issues };
  }

  if ('$schema' in root) {
    stringValue(root.$schema, '$.$schema', issues);
  }
  enumValue(
    root.version,
    '$.version',
    [IWSDK_PROJECT_MANIFEST_VERSION],
    issues,
    `unsupported project manifest version; expected "${IWSDK_PROJECT_MANIFEST_VERSION}"`,
  );
  validateSourcePath(root.scene, '$.scene', 'scene', issues);
  if ('assets' in root) {
    validateModuleDeclaration(root.assets, '$.assets', issues);
  }
  if ('components' in root) {
    validateModuleDeclaration(root.components, '$.components', issues);
  }
  validateWorld(root.world, '$.world', issues);
  if ('dev' in root) {
    validateDev(root.dev, '$.dev', issues);
  }

  return { valid: issues.length === 0, issues };
}

export function isIwsdkProjectManifest(
  value: unknown,
): value is IwsdkProjectManifestV1 {
  return validateIwsdkProjectManifest(value).valid;
}

export function assertValidIwsdkProjectManifest(
  value: unknown,
): asserts value is IwsdkProjectManifestV1 {
  const result = validateIwsdkProjectManifest(value);
  if (!result.valid) {
    throw new ProjectManifestValidationError(result.issues);
  }
}

function validateModuleDeclaration(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const declaration = objectValue(value, path, ['module'], ['module'], issues);
  if (declaration != null) {
    validateSourcePath(declaration.module, `${path}.module`, 'module', issues);
  }
}

function validateWorld(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const world = objectValue(
    value,
    path,
    ['xr', 'input', 'render', 'features'],
    ['xr'],
    issues,
  );
  if (world == null) {
    return;
  }
  validateXR(world.xr, `${path}.xr`, issues);
  if ('input' in world) {
    validateInput(world.input, `${path}.input`, issues);
  }
  if ('render' in world) {
    validateRender(world.render, `${path}.render`, issues);
  }
  if ('features' in world) {
    validateFeatures(world.features, `${path}.features`, issues);
  }
}

function validateXR(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  if (value === false) {
    return;
  }
  const xr = objectValue(
    value,
    path,
    [
      'mode',
      'offer',
      'referenceSpace',
      'restoreCameraOnExit',
      'launchOnSessionGranted',
      'features',
    ],
    ['mode'],
    issues,
  );
  if (xr == null) {
    return;
  }
  enumValue(xr.mode, `${path}.mode`, ['vr', 'ar'], issues);
  if ('offer' in xr) {
    enumValue(xr.offer, `${path}.offer`, OFFER_VALUES, issues);
  }
  if ('referenceSpace' in xr) {
    validateReferenceSpace(xr.referenceSpace, `${path}.referenceSpace`, issues);
  }
  if ('restoreCameraOnExit' in xr) {
    booleanValue(xr.restoreCameraOnExit, `${path}.restoreCameraOnExit`, issues);
  }
  if ('launchOnSessionGranted' in xr) {
    booleanValue(
      xr.launchOnSessionGranted,
      `${path}.launchOnSessionGranted`,
      issues,
    );
  }
  if ('features' in xr) {
    validateXRFeatures(xr.features, `${path}.features`, issues);
  }
}

function validateReferenceSpace(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  if (typeof value === 'string') {
    enumValue(value, path, REFERENCE_SPACE_TYPES, issues);
    return;
  }
  const reference = objectValue(
    value,
    path,
    ['type', 'required', 'fallbackOrder'],
    [],
    issues,
  );
  if (reference == null) {
    return;
  }
  if ('type' in reference) {
    enumValue(reference.type, `${path}.type`, REFERENCE_SPACE_TYPES, issues);
  }
  if ('required' in reference) {
    booleanValue(reference.required, `${path}.required`, issues);
  }
  if ('fallbackOrder' in reference) {
    if (!Array.isArray(reference.fallbackOrder)) {
      addIssue(issues, `${path}.fallbackOrder`, 'type', 'expected an array');
    } else {
      reference.fallbackOrder.forEach((entry, index) =>
        enumValue(
          entry,
          `${path}.fallbackOrder[${index}]`,
          REFERENCE_SPACE_TYPES,
          issues,
        ),
      );
    }
  }
}

function validateXRFeatures(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const featureNames = [
    'handTracking',
    'anchors',
    'hitTest',
    'planeDetection',
    'meshDetection',
    'depthSensing',
    'layers',
    'unbounded',
    'gazeTracking',
    'eyeTracking',
  ] as const;
  const features = objectValue(value, path, featureNames, [], issues);
  if (features == null) {
    return;
  }
  for (const name of featureNames) {
    if (!(name in features)) {
      continue;
    }
    if (name === 'depthSensing') {
      validateDepthSensing(features[name], `${path}.${name}`, issues);
    } else {
      validateFeatureFlag(features[name], `${path}.${name}`, issues);
    }
  }
}

function validateFeatureFlag(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  if (typeof value === 'boolean') {
    return;
  }
  const flag = objectValue(value, path, ['required'], [], issues);
  if (flag != null && 'required' in flag) {
    booleanValue(flag.required, `${path}.required`, issues);
  }
}

function validateDepthSensing(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  if (typeof value === 'boolean') {
    return;
  }
  const depth = objectValue(
    value,
    path,
    ['required', 'usage', 'format'],
    [],
    issues,
  );
  if (depth == null) {
    return;
  }
  if ('required' in depth) {
    booleanValue(depth.required, `${path}.required`, issues);
  }
  if ('usage' in depth) {
    enumValue(
      depth.usage,
      `${path}.usage`,
      ['cpu-optimized', 'gpu-optimized'],
      issues,
    );
  }
  if ('format' in depth) {
    enumValue(
      depth.format,
      `${path}.format`,
      ['luminance-alpha', 'float32'],
      issues,
    );
  }
}

function validateInput(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const input = objectValue(value, path, ['canvasPointerEvents'], [], issues);
  if (input == null || !('canvasPointerEvents' in input)) {
    return;
  }
  const pointer = input.canvasPointerEvents;
  if (typeof pointer === 'boolean') {
    return;
  }
  const pointerOptions = objectValue(
    pointer,
    `${path}.canvasPointerEvents`,
    ['enabled', 'activeDuringXR'],
    [],
    issues,
  );
  if (pointerOptions == null) {
    return;
  }
  if ('enabled' in pointerOptions) {
    booleanValue(
      pointerOptions.enabled,
      `${path}.canvasPointerEvents.enabled`,
      issues,
    );
  }
  if ('activeDuringXR' in pointerOptions) {
    booleanValue(
      pointerOptions.activeDuringXR,
      `${path}.canvasPointerEvents.activeDuringXR`,
      issues,
    );
  }
}

function validateRender(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const render = objectValue(
    value,
    path,
    ['fov', 'near', 'far', 'stencil', 'camera'],
    [],
    issues,
  );
  if (render == null) {
    return;
  }
  for (const key of ['fov', 'near', 'far'] as const) {
    if (key in render) {
      numberValue(render[key], `${path}.${key}`, issues);
    }
  }
  if ('stencil' in render) {
    booleanValue(render.stencil, `${path}.stencil`, issues);
  }
  if ('camera' in render) {
    const camera = objectValue(
      render.camera,
      `${path}.camera`,
      ['position', 'rotation', 'quaternion', 'lookAt'],
      [],
      issues,
    );
    if (camera != null) {
      if ('position' in camera) {
        vectorValue(camera.position, `${path}.camera.position`, 3, issues);
      }
      if ('rotation' in camera) {
        vectorValue(camera.rotation, `${path}.camera.rotation`, 3, issues);
      }
      if ('quaternion' in camera) {
        vectorValue(camera.quaternion, `${path}.camera.quaternion`, 4, issues);
      }
      if ('lookAt' in camera) {
        vectorValue(camera.lookAt, `${path}.camera.lookAt`, 3, issues);
      }
    }
  }
}

function validateFeatures(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const features = objectValue(
    value,
    path,
    [
      'locomotion',
      'grabbing',
      'gaze',
      'physics',
      'sceneUnderstanding',
      'environmentRaycast',
      'camera',
      'spatialUI',
    ],
    [],
    issues,
  );
  if (features == null) {
    return;
  }
  if ('locomotion' in features) {
    validateLocomotion(features.locomotion, `${path}.locomotion`, issues);
  }
  if ('grabbing' in features) {
    validateBooleanOrObject(
      features.grabbing,
      `${path}.grabbing`,
      ['useHandPinchForGrab'],
      issues,
    );
  }
  if ('gaze' in features) {
    validateGaze(features.gaze, `${path}.gaze`, issues);
  }
  if ('physics' in features) {
    validatePhysics(features.physics, `${path}.physics`, issues);
  }
  for (const key of ['environmentRaycast', 'camera'] as const) {
    if (key in features) {
      booleanValue(features[key], `${path}.${key}`, issues);
    }
  }
  if ('sceneUnderstanding' in features) {
    validateBooleanOrObject(
      features.sceneUnderstanding,
      `${path}.sceneUnderstanding`,
      ['showWireFrame'],
      issues,
    );
  }
  if ('spatialUI' in features) {
    validateSpatialUI(features.spatialUI, `${path}.spatialUI`, issues);
  }
}

function validatePhysics(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  if (typeof value === 'boolean') {
    return;
  }
  const physics = objectValue(
    value,
    path,
    ['useWorker', 'updateFrequency', 'interpolation'],
    [],
    issues,
  );
  if (physics == null) {
    return;
  }
  if ('useWorker' in physics) {
    booleanValue(physics.useWorker, `${path}.useWorker`, issues);
  }
  if (
    'updateFrequency' in physics &&
    numberValue(physics.updateFrequency, `${path}.updateFrequency`, issues) &&
    ((physics.updateFrequency as number) <= 0 ||
      (physics.updateFrequency as number) > 240)
  ) {
    addIssue(
      issues,
      `${path}.updateFrequency`,
      'type',
      'expected a number greater than 0 and at most 240',
    );
  }
  if ('interpolation' in physics) {
    booleanValue(physics.interpolation, `${path}.interpolation`, issues);
  }
}

function validateLocomotion(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  if (typeof value === 'boolean') {
    return;
  }
  const locomotion = objectValue(
    value,
    path,
    [
      'useWorker',
      'initialPlayerPosition',
      'comfortAssistLevel',
      'turningMethod',
      'enableJumping',
      'browserControls',
    ],
    [],
    issues,
  );
  if (locomotion == null) {
    return;
  }
  for (const key of ['useWorker', 'enableJumping'] as const) {
    if (key in locomotion) {
      booleanValue(locomotion[key], `${path}.${key}`, issues);
    }
  }
  if ('initialPlayerPosition' in locomotion) {
    vectorValue(
      locomotion.initialPlayerPosition,
      `${path}.initialPlayerPosition`,
      3,
      issues,
    );
  }
  if ('comfortAssistLevel' in locomotion) {
    numberValue(
      locomotion.comfortAssistLevel,
      `${path}.comfortAssistLevel`,
      issues,
    );
  }
  if ('turningMethod' in locomotion) {
    enumValue(
      locomotion.turningMethod,
      `${path}.turningMethod`,
      ['snap', 'smooth'],
      issues,
    );
  }
  if ('browserControls' in locomotion) {
    validateBrowserControls(
      locomotion.browserControls,
      `${path}.browserControls`,
      issues,
    );
  }
}

function validateBrowserControls(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  if (typeof value === 'boolean') {
    return;
  }
  const controls = objectValue(
    value,
    path,
    ['keyboard', 'gamepad'],
    [],
    issues,
  );
  if (controls == null) {
    return;
  }
  for (const key of ['keyboard', 'gamepad'] as const) {
    if (key in controls) {
      booleanValue(controls[key], `${path}.${key}`, issues);
    }
  }
}

const GAZE_NUMBER_KEYS = [
  'coneAngle',
  'maxRayLength',
  'dwellWindowSeconds',
  'filterMinCutoff',
  'filterBeta',
  'trackingLossGraceSeconds',
] as const;

const GAZE_BOOLEAN_KEYS = [
  'suppressWhenDirectPointerActive',
  'pointerTransformFollowsHand',
  'logDiagnostics',
  'showDebugReticle',
] as const;

function validateGaze(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const gaze = objectValue(
    value,
    path,
    [...GAZE_NUMBER_KEYS, ...GAZE_BOOLEAN_KEYS],
    [],
    issues,
  );
  if (gaze == null) {
    return;
  }
  for (const key of GAZE_NUMBER_KEYS) {
    if (key in gaze) {
      const property = `${path}.${key}`;
      if (numberValue(gaze[key], property, issues)) {
        const allowsZero =
          key === 'dwellWindowSeconds' ||
          key === 'filterBeta' ||
          key === 'trackingLossGraceSeconds';
        const number = gaze[key] as number;
        const invalidMinimum = allowsZero ? number < 0 : number <= 0;
        const invalidMaximum = key === 'coneAngle' && number >= 180;
        if (invalidMinimum || invalidMaximum) {
          addIssue(
            issues,
            property,
            'range',
            key === 'coneAngle'
              ? 'expected a number greater than 0 and less than 180'
              : `expected a ${allowsZero ? 'non-negative' : 'positive'} number`,
          );
        }
      }
    }
  }
  for (const key of GAZE_BOOLEAN_KEYS) {
    if (key in gaze) {
      booleanValue(gaze[key], `${path}.${key}`, issues);
    }
  }
}

function validateSpatialUI(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  if (typeof value === 'boolean') {
    return;
  }
  const spatialUI = objectValue(
    value,
    path,
    ['forwardHtmlEvents', 'kit', 'preferredColorScheme'],
    [],
    issues,
  );
  if (spatialUI == null) {
    return;
  }
  if ('forwardHtmlEvents' in spatialUI) {
    booleanValue(
      spatialUI.forwardHtmlEvents,
      `${path}.forwardHtmlEvents`,
      issues,
    );
  }
  if ('kit' in spatialUI) {
    enumValue(spatialUI.kit, `${path}.kit`, ['default', 'horizon'], issues);
  }
  if ('preferredColorScheme' in spatialUI) {
    enumValue(
      spatialUI.preferredColorScheme,
      `${path}.preferredColorScheme`,
      ['system', 'light', 'dark'],
      issues,
    );
  }
}

function validateBooleanOrObject(
  value: unknown,
  path: string,
  booleanKeys: readonly string[],
  issues: ProjectManifestValidationIssue[],
): void {
  if (typeof value === 'boolean') {
    return;
  }
  const object = objectValue(value, path, booleanKeys, [], issues);
  if (object == null) {
    return;
  }
  for (const key of booleanKeys) {
    if (key in object) {
      booleanValue(object[key], `${path}.${key}`, issues);
    }
  }
}

function validateTargetDevicePreview(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const preview = objectValue(value, path, ['gazeSimulation'], [], issues);
  if (preview == null) {
    return;
  }
  if ('gazeSimulation' in preview) {
    if (preview.gazeSimulation !== false) {
      enumValue(
        preview.gazeSimulation,
        `${path}.gazeSimulation`,
        ['head'],
        issues,
      );
    }
  }
}

function validateDev(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const dev = objectValue(
    value,
    path,
    ['emulator', 'targetDevicePreview', 'agentGuidance'],
    [],
    issues,
  );
  if (dev == null) {
    return;
  }
  if ('agentGuidance' in dev) {
    enumValue(
      dev.agentGuidance,
      `${path}.agentGuidance`,
      AGENT_GUIDANCE_MODES,
      issues,
    );
  }
  if ('emulator' in dev) {
    const emulator = objectValue(
      dev.emulator,
      `${path}.emulator`,
      [
        'device',
        'iwer',
        'environment',
        'activation',
        'injectOnBuild',
        'userAgentException',
      ],
      [],
      issues,
    );
    if (emulator != null) {
      if ('device' in emulator) {
        enumValue(emulator.device, `${path}.emulator.device`, DEVICES, issues);
      }
      if ('iwer' in emulator) {
        booleanValue(emulator.iwer, `${path}.emulator.iwer`, issues);
      }
      if ('environment' in emulator) {
        enumValue(
          emulator.environment,
          `${path}.emulator.environment`,
          ENVIRONMENTS,
          issues,
          `expected one of the built-in rooms: ${PROJECT_EMULATOR_ROOMS.map((room) => `"${room}"`).join(', ')}`,
        );
      }
      if ('activation' in emulator) {
        if (typeof emulator.activation === 'string') {
          enumValue(
            emulator.activation,
            `${path}.emulator.activation`,
            ['localhost', 'always'],
            issues,
          );
        } else {
          validateRegexSpec(
            emulator.activation,
            `${path}.emulator.activation`,
            issues,
          );
        }
      }
      if ('injectOnBuild' in emulator) {
        booleanValue(
          emulator.injectOnBuild,
          `${path}.emulator.injectOnBuild`,
          issues,
        );
      }
      if ('userAgentException' in emulator) {
        validateRegexSpec(
          emulator.userAgentException,
          `${path}.emulator.userAgentException`,
          issues,
        );
      }
    }
  }
  if ('targetDevicePreview' in dev) {
    validateTargetDevicePreview(
      dev.targetDevicePreview,
      `${path}.targetDevicePreview`,
      issues,
    );
  }
}

function validateRegexSpec(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): void {
  const regex = objectValue(
    value,
    path,
    ['source', 'flags'],
    ['source'],
    issues,
  );
  if (regex == null) {
    return;
  }
  const sourceValid = stringValue(regex.source, `${path}.source`, issues);
  if (sourceValid && (regex.source as string).length === 0) {
    addIssue(
      issues,
      `${path}.source`,
      'invalid-regex',
      'regular expression source must not be blank',
    );
    return;
  }
  const flagsValid =
    !('flags' in regex) || stringValue(regex.flags, `${path}.flags`, issues);
  if (!sourceValid || !flagsValid) {
    return;
  }
  try {
    new RegExp(
      regex.source as string,
      (regex.flags as string | undefined) ?? '',
    );
  } catch (error) {
    addIssue(
      issues,
      path,
      'invalid-regex',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function validateSourcePath(
  value: unknown,
  path: string,
  kind: 'module' | 'scene',
  issues: ProjectManifestValidationIssue[],
): void {
  if (!stringValue(value, path, issues)) {
    return;
  }
  try {
    normalizeProjectSourcePath(value as string, kind);
  } catch (error) {
    addIssue(
      issues,
      path,
      'invalid-path',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function objectValue(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  issues: ProjectManifestValidationIssue[],
): JsonObject | undefined {
  if (!isPlainObject(value)) {
    addIssue(issues, path, 'type', 'expected an object');
    return undefined;
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue(
        issues,
        propertyPath(path, key),
        'unknown-key',
        `unknown property "${key}"`,
      );
    }
  }
  for (const key of requiredKeys) {
    if (!(key in value)) {
      addIssue(
        issues,
        propertyPath(path, key),
        'required',
        'required property is missing',
      );
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is JsonObject {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringValue(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): boolean {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'type', 'expected a string');
    return false;
  }
  return true;
}

function booleanValue(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): boolean {
  if (typeof value !== 'boolean') {
    addIssue(issues, path, 'type', 'expected a boolean');
    return false;
  }
  return true;
}

function numberValue(
  value: unknown,
  path: string,
  issues: ProjectManifestValidationIssue[],
): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addIssue(issues, path, 'type', 'expected a finite number');
    return false;
  }
  return true;
}

function vectorValue(
  value: unknown,
  path: string,
  length: number,
  issues: ProjectManifestValidationIssue[],
): void {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
  ) {
    addIssue(issues, path, 'type', `expected a finite ${length}-number tuple`);
  }
}

function enumValue<T extends string>(
  value: unknown,
  path: string,
  allowedValues: readonly T[],
  issues: ProjectManifestValidationIssue[],
  message?: string,
): value is T {
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    addIssue(
      issues,
      path,
      'enum',
      message ??
        `expected one of ${allowedValues.map((entry) => `"${entry}"`).join(', ')}`,
    );
    return false;
  }
  return true;
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z\d_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function addIssue(
  issues: ProjectManifestValidationIssue[],
  path: string,
  code: ProjectManifestValidationIssueCode,
  message: string,
): void {
  issues.push({ path, code, message });
}
