/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCENE_VERSION,
  createSceneComponentCatalog,
  validateSceneDocument,
  type SceneDocument,
} from '../src/index.js';

function makeAssetScene(): SceneDocument {
  return {
    version: CURRENT_SCENE_VERSION,
    units: 'meters',
    resources: {
      prefabs: [
        {
          id: 'asset-prefab',
          root: {
            id: 'prefab-root',
            content: { type: 'asset', asset: 'prefab-asset' },
          },
        },
      ],
    },
    nodes: [
      {
        id: 'ordinary-asset',
        content: { type: 'asset', asset: 'ordinary-asset' },
      },
      {
        id: 'group',
        content: { type: 'group' },
        children: [
          {
            id: 'nested-asset',
            content: { type: 'asset', asset: 'nested-asset' },
          },
        ],
      },
    ],
  };
}

describe('ground shadow component validation', () => {
  const componentCatalog = createSceneComponentCatalog([
    {
      id: 'ContactShadow',
      source: 'iwsdk',
      fields: {
        color: { type: 'Color', default: [0.3765, 0.3922, 0.4549, 1] },
        height: { type: 'Float32', default: 0.002, min: 0 },
        opacity: { type: 'Float32', default: 0.72, max: 1, min: 0 },
        size: { type: 'Vec2', default: [1, 1] },
      },
    },
    {
      id: 'ShadowCatcher',
      source: 'iwsdk',
      fields: {
        color: { type: 'Color', default: [0, 0, 0, 1] },
        opacity: { type: 'Float32', default: 0.25, max: 1, min: 0 },
        size: { type: 'Vec2', default: [6, 6] },
      },
    },
  ]);

  function sceneWith(components: Record<string, unknown>): SceneDocument {
    return {
      version: CURRENT_SCENE_VERSION,
      units: 'meters',
      resources: {},
      nodes: [{ id: 'plinth', content: { type: 'group' }, components }],
    };
  }

  it('accepts positive and default sizes', () => {
    expect(
      validateSceneDocument(
        sceneWith({
          'com.iwsdk.components.ContactShadow': { size: [1.2, 0.8] },
          'com.iwsdk.components.ShadowCatcher': {},
        }),
        { componentCatalog },
      ),
    ).toEqual({ valid: true, issues: [] });
  });

  it('rejects a zero or negative size entry as a range issue', () => {
    for (const [component, size] of [
      ['ContactShadow', [0, 1]],
      ['ContactShadow', [1, -0.5]],
      ['ShadowCatcher', [-6, 6]],
    ] as const) {
      const name = `com.iwsdk.components.${component}`;
      expect(
        validateSceneDocument(sceneWith({ [name]: { size } }), {
          componentCatalog,
        }),
      ).toEqual({
        valid: false,
        issues: [
          {
            path: `$.nodes[0].components[${JSON.stringify(name)}].size`,
            message: 'size must be positive',
            code: 'range',
          },
        ],
      });
    }
  });
});

describe('scene asset catalog validation', () => {
  it('is disabled when no asset catalog is supplied', () => {
    expect(validateSceneDocument(makeAssetScene())).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('accepts array and set catalogs containing every referenced asset', () => {
    const assetIds = ['ordinary-asset', 'nested-asset', 'prefab-asset'];

    expect(
      validateSceneDocument(makeAssetScene(), { knownAssetIds: assetIds }),
    ).toEqual({ valid: true, issues: [] });
    expect(
      validateSceneDocument(makeAssetScene(), {
        knownAssetIds: new Set(assetIds),
      }),
    ).toEqual({ valid: true, issues: [] });
  });

  it('reports every asset against an empty catalog with precise fixes', () => {
    expect(
      validateSceneDocument(makeAssetScene(), { knownAssetIds: [] }).issues,
    ).toEqual([
      {
        path: '$.resources.prefabs[0].root.content.asset',
        message:
          'asset "prefab-asset" is not declared in the project asset catalog; add "prefab-asset" to the asset manifest or replace this reference with a declared asset id',
        code: 'reference',
      },
      {
        path: '$.nodes[0].content.asset',
        message:
          'asset "ordinary-asset" is not declared in the project asset catalog; add "ordinary-asset" to the asset manifest or replace this reference with a declared asset id',
        code: 'reference',
      },
      {
        path: '$.nodes[1].children[0].content.asset',
        message:
          'asset "nested-asset" is not declared in the project asset catalog; add "nested-asset" to the asset manifest or replace this reference with a declared asset id',
        code: 'reference',
      },
    ]);
  });

  it('preserves component-catalog validation when assets are known', () => {
    const scene = makeAssetScene();
    scene.nodes[0].components = { Marker: { enabled: 'yes' } };
    const componentCatalog = createSceneComponentCatalog([
      {
        id: 'Marker',
        source: 'app',
        fields: { enabled: { type: 'Boolean' } },
      },
    ]);
    const baseline = validateSceneDocument(scene, { componentCatalog });

    expect(
      validateSceneDocument(scene, {
        componentCatalog,
        knownAssetIds: ['ordinary-asset', 'nested-asset', 'prefab-asset'],
      }),
    ).toEqual(baseline);
    expect(baseline.issues).toContainEqual(
      expect.objectContaining({
        code: 'type',
        path: '$.nodes[0].components.Marker.enabled',
      }),
    );
  });
});

describe('DomeFade range validation', () => {
  const componentCatalog = createSceneComponentCatalog([
    {
      id: 'DomeFade',
      source: 'iwsdk',
      fields: {
        start: { type: 'Float32', default: 4, min: 0 },
        end: { type: 'Float32', default: 10, min: 0 },
      },
    },
  ]);

  function validateFade(value: Record<string, unknown>) {
    const scene: SceneDocument = {
      version: CURRENT_SCENE_VERSION,
      units: 'meters',
      resources: {},
      nodes: [
        {
          id: 'floor',
          content: { type: 'group' },
          components: { 'com.iwsdk.components.DomeFade': value },
        },
      ],
    };
    return validateSceneDocument(scene, { componentCatalog });
  }

  it('accepts a fade that ends after it starts', () => {
    expect(validateFade({ start: 2, end: 8 }).issues).toEqual([]);
    expect(validateFade({}).issues).toEqual([]);
  });

  it('rejects a fade whose start is not before its end', () => {
    for (const value of [
      { start: 10, end: 5 },
      { start: 6, end: 6 },
      { start: 12 },
      { end: 3 },
    ]) {
      expect(validateFade(value).issues).toEqual([
        expect.objectContaining({
          code: 'range',
          message: 'fade start must be less than fade end',
          path: '$.nodes[0].components["com.iwsdk.components.DomeFade"]',
        }),
      ]);
    }
  });

  it('rejects a negative start through the schema minimum', () => {
    expect(validateFade({ start: -1, end: 8 }).issues).toEqual([
      expect.objectContaining({
        code: 'type',
        path: '$.nodes[0].components["com.iwsdk.components.DomeFade"].start',
      }),
    ]);
  });
});
