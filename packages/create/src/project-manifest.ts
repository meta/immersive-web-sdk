/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { IwsdkProjectManifestV1 } from '@iwsdk/core/project';
import type { ScaffoldConfiguration } from './catalog.js';
import type { TriState } from './types.js';

function featureFlag(state: TriState): boolean | { required: true } {
  return state === 'required' ? { required: true } : state === 'optional';
}

/** Build the committed, JSON-safe authority for one starter target. */
export function createProjectManifest(
  configuration: ScaffoldConfiguration,
): IwsdkProjectManifestV1 {
  const { featureFlags, target, xrFeatureStates } = configuration;
  const xrFeatures = Object.fromEntries(
    Object.entries(xrFeatureStates).map(([name, state]) => [
      name,
      featureFlag(state),
    ]),
  );
  const locomotion = featureFlags.locomotionEnabled
    ? {
        useWorker: featureFlags.locomotionUseWorker !== false,
        ...(target === 'browser'
          ? { initialPlayerPosition: [-4, 0, -6] as [number, number, number] }
          : {}),
        ...(featureFlags.locomotionBrowserControls
          ? { browserControls: true }
          : {}),
      }
    : false;

  return {
    $schema:
      './node_modules/@iwsdk/core/dist/schemas/iwsdk-project.v1.schema.json',
    version: 'iwsdk.project.v1',
    scene: './public/scenes/main.iwsdk.scene.json',
    assets: { module: './src/assets' },
    components: { module: './src/components' },
    world: {
      xr:
        target === 'browser'
          ? false
          : {
              mode: target,
              offer: 'always',
              features: xrFeatures,
            },
      input: { canvasPointerEvents: true },
      render: {
        near: 0.001,
        far: 200,
        camera:
          target === 'browser'
            ? {
                position: [0, 1.5, 0],
                lookAt: [4, 1.1, 4.2],
              }
            : target === 'ar'
              ? { position: [0, 1, 0.5] }
              : {
                  position: [-4, 1.5, -6],
                  lookAt: [0, 1.1, -1.8],
                },
      },
      features: {
        locomotion,
        grabbing: featureFlags.grabbingEnabled,
        physics: featureFlags.physicsEnabled,
        sceneUnderstanding: featureFlags.sceneUnderstandingEnabled,
        environmentRaycast: featureFlags.environmentRaycastEnabled,
        spatialUI: { kit: 'horizon' },
      },
    },
    dev: {
      emulator: {
        device: 'metaQuest3',
        ...(target === 'ar' ? { environment: 'sunlit_living_room' } : {}),
      },
    },
  };
}
