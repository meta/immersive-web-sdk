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
          ? { initialPlayerPosition: [0, 0, 1] as [number, number, number] }
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
        fov: 70,
        near: 0.001,
        far: 200,
        // Camera poses are relative to the player rig. The browser player starts
        // 1 m back, so every target frames the starter from the same spot.
        camera:
          target === 'browser'
            ? { position: [0, 1.6, 0], lookAt: [0, 0.95, -2.95] }
            : { position: [0, 1.6, 1], lookAt: [0, 0.95, -1.95] },
      },
      features: {
        locomotion,
        grabbing: featureFlags.grabbingEnabled,
        physics: featureFlags.physicsEnabled,
        sceneUnderstanding: featureFlags.sceneUnderstandingEnabled,
        environmentRaycast: featureFlags.environmentRaycastEnabled,
        spatialUI: { kit: 'horizon', preferredColorScheme: 'dark' },
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
