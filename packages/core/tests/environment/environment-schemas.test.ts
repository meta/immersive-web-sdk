/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  CURRENT_SCENE_VERSION,
  validateSceneDocument,
  type SceneDocument,
} from '@iwsdk/scene-composition';
import { describe, expect, it } from 'vitest';
import { IWSDK_BUILTIN_COMPONENTS } from '../../src/ecs/builtin-components.js';
import { componentCatalogFromComponents } from '../../src/ecs/component-manifest.js';

// The live catalog is what the editor inspector, scene_list_component_schemas
// and scene validation read.
const catalog = componentCatalogFromComponents(IWSDK_BUILTIN_COMPONENTS, {
  source: 'iwsdk',
});

function validateRoot(components: Record<string, unknown>) {
  const scene: SceneDocument = {
    components,
    nodes: [],
    resources: {},
    units: 'meters',
    version: CURRENT_SCENE_VERSION,
  };
  return validateSceneDocument(scene, { componentCatalog: catalog }).issues;
}

describe('environment component schemas', () => {
  it('exposes the DomeGradient orientation and dither fields with limits', () => {
    const fields = catalog.DomeGradient.fields;
    expect(Object.keys(fields)).toEqual([
      'sky',
      'equator',
      'ground',
      'intensity',
      'elevationDeg',
      'azimuthDeg',
      'dither',
      '_needsUpdate',
    ]);
    expect(fields.sky).toMatchObject({
      default: [0.2423, 0.6172, 0.8308, 1],
      label: 'Sky color',
      widget: 'color',
    });
    expect(fields.intensity).toMatchObject({ default: 1, min: 0, step: 0.05 });
    expect(fields.elevationDeg).toMatchObject({
      default: 90,
      label: 'Sky pole elevation (°)',
      max: 90,
      min: -90,
      step: 1,
      type: 'Float32',
      widget: 'slider',
    });
    expect(fields.azimuthDeg).toMatchObject({
      default: 0,
      label: 'Sky pole azimuth (°)',
      max: 180,
      min: -180,
      widget: 'slider',
    });
    expect(fields.dither).toMatchObject({
      default: false,
      label: 'Dither',
      type: 'Boolean',
    });
    for (const field of Object.values(fields)) {
      if (!field.hidden) {
        expect(field.help).toEqual(expect.any(String));
      }
    }
    expect(fields._needsUpdate.hidden).toBe(true);
    expect(catalog.DomeGradient.description).toBe(
      'Gradient sky behind the scene. Level root only; hidden during AR passthrough.',
    );
  });

  it('labels IBLGradient and limits its intensity', () => {
    const fields = catalog.IBLGradient.fields;
    expect(fields.sky).toMatchObject({
      default: [0.6902, 0.749, 0.7843, 1],
      label: 'Sky light',
      widget: 'color',
    });
    expect(fields.equator.label).toBe('Equator light');
    expect(fields.ground.label).toBe('Ground light');
    expect(fields.intensity).toMatchObject({ default: 1, min: 0, step: 0.05 });
    expect(fields.intensity.help).toContain('applied once');
    expect(catalog.IBLGradient.description).toBe(
      'Image-based lighting from a three-color gradient. Level root only; kept in AR.',
    );
  });

  it('validates gradient limits in scene JSON', () => {
    expect(
      validateRoot({
        'com.iwsdk.components.DomeGradient': {
          azimuthDeg: -31,
          dither: true,
          elevationDeg: 24,
        },
        'com.iwsdk.components.IBLGradient': { intensity: 0 },
      }),
    ).toEqual([]);
    expect(
      validateRoot({
        'com.iwsdk.components.DomeGradient': {
          azimuthDeg: 200,
          elevationDeg: 120,
          intensity: -0.5,
        },
        'com.iwsdk.components.IBLGradient': { intensity: -1 },
      }).map((issue) => [issue.path, issue.code]),
    ).toEqual([
      ['$.components["com.iwsdk.components.DomeGradient"].azimuthDeg', 'type'],
      [
        '$.components["com.iwsdk.components.DomeGradient"].elevationDeg',
        'type',
      ],
      ['$.components["com.iwsdk.components.DomeGradient"].intensity', 'type'],
      ['$.components["com.iwsdk.components.IBLGradient"].intensity', 'type'],
    ]);
  });
});
