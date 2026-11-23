/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ExperienceTarget, FeatureFlags, TriState, XRMode } from './types.js';

export type ExperienceDefinition = {
  label: string;
  description: string;
  xrEnabled: boolean;
  mode?: XRMode;
};

export const EXPERIENCE_TARGETS = {
  vr: {
    label: 'Virtual reality',
    description: 'Start inside an authored virtual environment.',
    xrEnabled: true,
    mode: 'vr',
  },
  ar: {
    label: 'Mixed reality / passthrough',
    description: 'Start with virtual content in the physical environment.',
    xrEnabled: true,
    mode: 'ar',
  },
  browser: {
    label: 'Desktop 3D',
    description: 'Start in a desktop browser without an immersive session.',
    xrEnabled: false,
  },
} as const satisfies Record<ExperienceTarget, ExperienceDefinition>;

export type FeatureKey = keyof FeatureFlags;

type FeatureDefinition = {
  label: string;
  description: string;
  targets: readonly ExperienceTarget[];
  defaults: Partial<Record<ExperienceTarget, boolean>>;
  xrFeatures: readonly string[];
  selection: 'boolean';
  configPath: string;
  documentation: string;
  reversible: string;
};

export const FEATURE_CATALOG = {
  locomotionEnabled: {
    label: 'Locomotion',
    description: 'Let people move through a larger virtual environment.',
    targets: ['vr', 'browser'],
    defaults: { vr: true, browser: true },
    xrFeatures: [],
    selection: 'boolean',
    configPath: 'features.locomotion',
    documentation: 'docs/concepts/locomotion/index.md',
    reversible: 'Change features.locomotion in src/index.ts.',
  },
  locomotionUseWorker: {
    label: 'Locomotion worker',
    description: 'Run locomotion collision work off the main thread.',
    targets: ['vr', 'browser'],
    defaults: { vr: true, browser: true },
    xrFeatures: [],
    selection: 'boolean',
    configPath: 'features.locomotion.useWorker',
    documentation: 'docs/concepts/locomotion/performance.md',
    reversible: 'Change features.locomotion.useWorker in src/index.ts.',
  },
  locomotionBrowserControls: {
    label: 'Browser locomotion controls',
    description: 'Bind keyboard and browser gamepad movement actions.',
    targets: ['browser'],
    defaults: { browser: true },
    xrFeatures: [],
    selection: 'boolean',
    configPath: 'features.locomotion.browserControls',
    documentation: 'docs/guides/16-browser-first-systems.md',
    reversible: 'Change features.locomotion.browserControls in src/index.ts.',
  },
  grabbingEnabled: {
    label: 'Grabbing',
    description: 'Enable hand and controller object manipulation.',
    targets: ['vr', 'ar', 'browser'],
    defaults: { vr: true, ar: true, browser: true },
    xrFeatures: [],
    selection: 'boolean',
    configPath: 'features.grabbing',
    documentation: 'docs/concepts/grabbing/index.md',
    reversible: 'Change features.grabbing in src/index.ts.',
  },
  physicsEnabled: {
    label: 'Physics',
    description:
      'Load Havok for gravity, collisions, and dynamic rigid bodies.',
    targets: ['vr', 'ar', 'browser'],
    defaults: { vr: false, ar: false, browser: false },
    xrFeatures: [],
    selection: 'boolean',
    configPath: 'features.physics',
    documentation: 'docs/guides/12-physics.md',
    reversible: 'Change features.physics in src/index.ts.',
  },
  sceneUnderstandingEnabled: {
    label: 'Room surfaces and anchors',
    description: 'Use scanned planes, meshes, and anchors in mixed reality.',
    targets: ['ar'],
    defaults: { ar: false },
    xrFeatures: ['anchors', 'planeDetection', 'meshDetection'],
    selection: 'boolean',
    configPath: 'features.sceneUnderstanding',
    documentation: 'docs/guides/11-scene-understanding.md',
    reversible: 'Change features.sceneUnderstanding in src/index.ts.',
  },
  environmentRaycastEnabled: {
    label: 'Real-world placement',
    description: 'Use WebXR hit testing to place content on physical surfaces.',
    targets: ['ar'],
    defaults: { ar: false },
    xrFeatures: ['hitTest'],
    selection: 'boolean',
    configPath: 'features.environmentRaycast',
    documentation: 'docs/guides/14-environment-raycast.md',
    reversible: 'Change features.environmentRaycast in src/index.ts.',
  },
} as const satisfies Record<FeatureKey, FeatureDefinition>;

export type ScaffoldConfiguration = {
  target: ExperienceTarget;
  xrEnabled: boolean;
  mode?: XRMode;
  featureFlags: FeatureFlags;
  xrFeatureStates: Record<string, TriState>;
  /** Alpha: add the native Quest build (`npm run build:metavr`, @iwer/native). VR only. */
  nativeAlpha?: boolean;
};

export function deriveXRFeatureStates(
  target: ExperienceTarget,
  features: FeatureFlags,
): Record<string, TriState> {
  if (target === 'browser') {
    return {};
  }

  const states: Record<string, TriState> = { handTracking: 'optional' };
  for (const key of Object.keys(FEATURE_CATALOG) as FeatureKey[]) {
    const definition = FEATURE_CATALOG[key];
    if (
      !features[key] ||
      !(definition.targets as readonly ExperienceTarget[]).includes(target)
    ) {
      continue;
    }
    for (const xrFeature of definition.xrFeatures) {
      states[xrFeature] = 'optional';
    }
  }
  return states;
}

export function getRecommendedConfiguration(
  target: ExperienceTarget,
  overrides: Partial<FeatureFlags> = {},
): ScaffoldConfiguration {
  const definition = EXPERIENCE_TARGETS[target];
  const features = {} as FeatureFlags;
  const mutableFeatures = features as Record<FeatureKey, boolean | undefined>;
  for (const key of Object.keys(FEATURE_CATALOG) as FeatureKey[]) {
    mutableFeatures[key] =
      (
        FEATURE_CATALOG[key].defaults as Partial<
          Record<ExperienceTarget, boolean>
        >
      )[target] ?? false;
  }
  Object.assign(features, overrides);

  if (target !== 'vr') {
    if (target === 'ar') {
      features.locomotionEnabled = false;
      features.locomotionUseWorker = undefined;
      features.locomotionBrowserControls = false;
    }
  } else if (features.locomotionEnabled) {
    features.locomotionUseWorker ??= true;
    features.locomotionBrowserControls = false;
  } else {
    features.locomotionUseWorker = undefined;
    features.locomotionBrowserControls = false;
  }
  if (target === 'browser') {
    features.sceneUnderstandingEnabled = false;
    features.environmentRaycastEnabled = false;
    if (features.locomotionEnabled) {
      features.locomotionUseWorker ??= true;
      features.locomotionBrowserControls ??= true;
    } else {
      features.locomotionUseWorker = undefined;
      features.locomotionBrowserControls = false;
    }
  } else if (target === 'vr') {
    features.sceneUnderstandingEnabled = false;
    features.environmentRaycastEnabled = false;
  }

  return {
    target,
    xrEnabled: definition.xrEnabled,
    mode: target === 'browser' ? undefined : target,
    featureFlags: features,
    xrFeatureStates: deriveXRFeatureStates(target, features),
  };
}
