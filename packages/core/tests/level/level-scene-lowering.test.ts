/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  CURRENT_SCENE_VERSION,
  hashRuntimeSceneDocument,
  type SceneDocument,
} from '@iwsdk/scene-composition';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../../src/ecs/entity.js';
import type { World } from '../../src/ecs/world.js';
import {
  applySceneEnvironment,
  captureSceneEnvironment,
  restoreSceneEnvironment,
} from '../../src/level/level-scene-environment.js';
import { SceneJSONImporter } from '../../src/level/level-scene-json-importer.js';
import {
  applySceneTransform,
  deriveScenePatternNodeId,
  disposeLoweredSceneNodes,
  generateScenePatternTransforms,
  lowerSceneDocumentObjects as lowerSceneDocumentObjectsRuntime,
  MAX_SCENE_PATTERN_INSTANCES,
} from '../../src/level/level-scene-object.js';
import { createSceneGeometry } from '../../src/level/level-scene-primitive.js';
import {
  ACESFilmicToneMapping,
  BasicShadowMap,
  Color,
  Fog,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  PCFShadowMap,
  Scene,
} from '../../src/runtime/index.js';

function baseDocument(): SceneDocument {
  return {
    nodes: [],
    resources: {},
    units: 'meters',
    version: CURRENT_SCENE_VERSION,
  };
}

const TEST_ASSET_BOUNDS: Record<
  string,
  { min: [number, number, number]; max: [number, number, number] }
> = {
  unit: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
  base: { min: [-1, -0.5, -1], max: [1, 0.5, 1] },
  top: { min: [-0.25, -0.25, -0.25], max: [0.25, 0.25, 0.25] },
  floor: { min: [-10, -0.05, -10], max: [10, 0.05, 10] },
  backdrop: { min: [-2, -2, -0.05], max: [2, 2, 0.05] },
};

function testAsset(assetId: string): Object3D {
  const bounds = TEST_ASSET_BOUNDS[assetId] ?? TEST_ASSET_BOUNDS.unit;
  const size = bounds.max.map((value, index) => value - bounds.min[index]) as [
    number,
    number,
    number,
  ];
  const mesh = new Mesh(
    createSceneGeometry({ size, type: 'box' }),
    new MeshStandardMaterial({
      color: assetId.includes('blue') ? '#0000ff' : '#ff0000',
    }),
  );
  const center = bounds.min.map(
    (value, index) => (value + bounds.max[index]) / 2,
  ) as [number, number, number];
  mesh.position.set(...center);
  return mesh;
}

function lowerSceneDocumentObjects(
  document: SceneDocument,
  options: Parameters<typeof lowerSceneDocumentObjectsRuntime>[1] = {},
) {
  return lowerSceneDocumentObjectsRuntime(document, {
    loadAsset: async (assetId) => testAsset(assetId),
    resolveAssetBounds: (assetId) =>
      TEST_ASSET_BOUNDS[assetId] ?? TEST_ASSET_BOUNDS.unit,
    ...options,
  });
}

describe('scene geometry lowering', () => {
  it('applies zero and mirrored authored scale without clamping', () => {
    const object = new Object3D();

    applySceneTransform(object, { scale: [0, -2, 3] });

    expect(object.scale.toArray()).toEqual([0, -2, 3]);
  });

  it('creates extrude holes, capsule, tube, lathe, torus, and rounded box geometry', () => {
    const recipes = [
      { length: 2, radius: 0.5, type: 'capsule' },
      {
        bevel: { enabled: true, segments: 2, size: 0.05, thickness: 0.05 },
        depth: 0.4,
        holes: [
          [
            [0.25, 0.25],
            [0.75, 0.25],
            [0.75, 0.75],
            [0.25, 0.75],
          ],
        ],
        points: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        type: 'extrude',
      },
      {
        points: [
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
        ],
        radius: 0.1,
        type: 'tube',
      },
      {
        profile: [
          [0.2, -0.5],
          [0.5, 0],
          [0.2, 0.5],
        ],
        type: 'lathe',
      },
      { radius: 1, tube: 0.2, type: 'torus' },
      { radius: 0.1, size: [1, 2, 3], type: 'roundedBox' },
    ] as const;

    const geometries = recipes.map((recipe) =>
      createSceneGeometry(recipe as never),
    );

    expect(geometries.map((geometry) => geometry.type)).toEqual([
      'CapsuleGeometry',
      'ExtrudeGeometry',
      'TubeGeometry',
      'LatheGeometry',
      'TorusGeometry',
      'RoundedBoxGeometry',
    ]);
    expect((geometries[1] as any).parameters.shapes.holes).toHaveLength(1);
    geometries[1].computeBoundingBox();
    expect(geometries[1].boundingBox?.min.z).toBeLessThan(0);
    expect(geometries[1].boundingBox?.max.z).toBeGreaterThan(0);
  });

  it('averages full-revolution lathe normals across the UV seam', () => {
    const profile = [
      [0.3, 0],
      [0.6, 0.5],
      [0.4, 1],
    ] as [number, number][];
    const segments = 24;
    const geometry = createSceneGeometry({ profile, segments, type: 'lathe' });
    const normal = geometry.getAttribute('normal');
    for (let point = 0; point < profile.length; point += 1) {
      const last = segments * profile.length + point;
      expect(normal.getX(point)).toBeCloseTo(normal.getX(last), 6);
      expect(normal.getY(point)).toBeCloseTo(normal.getY(last), 6);
      expect(normal.getZ(point)).toBeCloseTo(normal.getZ(last), 6);
    }
  });
});

describe('prefab and pattern lowering', () => {
  it('is deterministic, bounded, and derives stable pattern ids', async () => {
    const distribution = {
      algorithm: 'pcg32-box-rejection-v1',
      collision: 'allow',
      count: 4,
      region: { size: [2, 1, 2], type: 'box' },
      seed: 42,
      type: 'scatter',
      variation: { yawDeg: [0, 360] },
    } as const;
    expect(generateScenePatternTransforms(distribution)).toEqual(
      generateScenePatternTransforms(distribution),
    );
    expect(deriveScenePatternNodeId('flowers', 2, 'root')).toBe(
      'flowers/0002/root',
    );
    expect(() =>
      generateScenePatternTransforms({
        count: [MAX_SCENE_PATTERN_INSTANCES, 2, 1],
        spacing: [1, 1, 1],
        type: 'grid',
      }),
    ).toThrow('exceeds the limit');

    const document = baseDocument();
    document.resources.prefabs = [
      {
        id: 'tile',
        root: {
          content: { asset: 'unit', type: 'asset' },
          id: 'root',
        },
      },
    ];
    document.nodes = [
      {
        content: {
          distribution: { count: 3, step: [2, 0, 0], type: 'linear' },
          overrides: { root: { visible: false } },
          prefab: 'tile',
          type: 'pattern',
        },
        framingRole: 'support',
        id: 'tiles',
      },
    ];

    const [lowered] = await lowerSceneDocumentObjects(document);
    const instances = lowered.object.children[0] as InstancedMesh;
    expect(instances).toBeInstanceOf(InstancedMesh);
    expect(instances.visible).toBe(false);
    expect(instances.userData.iwsdkSceneFramingRole).toBe('support');
    expect(lowered.virtualNodes.map((node) => node.id)).toEqual([
      'tiles/0000/root',
      'tiles/0001/root',
      'tiles/0002/root',
    ]);
    const matrix = new (await import('../../src/runtime/index.js')).Matrix4();
    instances.getMatrixAt(2, matrix);
    expect(matrix.elements[12]).toBe(4);
  });

  it.each([
    {
      expected: 'content',
      patternRole: 'support',
      prefabRole: 'content',
    },
    {
      expected: 'support',
      patternRole: 'content',
      prefabRole: 'support',
    },
  ] as const)(
    'keeps explicit prefab framing role precedence with and without instancing ($expected)',
    async ({ expected, patternRole, prefabRole }) => {
      const document = baseDocument();
      document.resources.prefabs = [
        {
          id: 'tile',
          root: {
            content: { asset: 'unit', type: 'asset' },
            framingRole: prefabRole,
            id: 'root',
          },
        },
      ];
      document.nodes = [
        {
          content: {
            distribution: { count: 2, step: [2, 0, 0], type: 'linear' },
            prefab: 'tile',
            type: 'pattern',
          },
          framingRole: patternRole,
          id: 'tiles',
        },
      ];

      const [instanced] = await lowerSceneDocumentObjects(document);
      const [expanded] = await lowerSceneDocumentObjects(document, {
        useInstancing: false,
      });

      expect(instanced.object.children[0].userData.iwsdkSceneFramingRole).toBe(
        expected,
      );
      expect(expanded.children[0].object.userData.iwsdkSceneFramingRole).toBe(
        expected,
      );
    },
  );

  it('explodes a prefab carrying components instead of instancing it', async () => {
    const document = baseDocument();
    document.resources.prefabs = [
      {
        id: 'interactive',
        root: {
          components: { Behavior: {} },
          content: { asset: 'unit', type: 'asset' },
          id: 'root',
        },
      },
    ];
    document.nodes = [
      {
        content: {
          distribution: { count: 2, step: [1, 0, 0], type: 'linear' },
          prefab: 'interactive',
          type: 'pattern',
        },
        id: 'items',
      },
    ];

    const [lowered] = await lowerSceneDocumentObjects(document);
    expect(lowered.virtualNodes).toHaveLength(0);
    expect(lowered.children.map((child) => child.id)).toEqual([
      'items/0000/root',
      'items/0001/root',
    ]);
    expect(lowered.children[0].object).toBeInstanceOf(Mesh);
  });

  it('lowers groups and explicit prefab instances with local overrides', async () => {
    const document = baseDocument();
    document.resources.prefabs = [
      {
        id: 'assembly',
        root: {
          children: [
            {
              content: { asset: 'blue-unit', type: 'asset' },
              id: 'part',
            },
          ],
          content: { type: 'group' },
          id: 'root',
        },
      },
    ];
    document.nodes = [
      {
        content: {
          overrides: {
            part: { transform: { position: [2, 0, 0] } },
          },
          prefab: 'assembly',
          type: 'instance',
        },
        framingRole: 'support',
        id: 'placed',
      },
    ];

    const [lowered] = await lowerSceneDocumentObjects(document);
    expect(lowered.children[0].id).toBe('placed/root');
    expect(lowered.children[0].children[0].id).toBe('placed/part');
    const part = lowered.children[0].children[0].object as Mesh;
    expect(part.userData.iwsdkSceneFramingRole).toBe('support');
    expect(part.position.x).toBe(2);
    expect((part.material as MeshStandardMaterial).color.getHexString()).toBe(
      '0000ff',
    );
  });

  it('rejects derived runtime id collisions before app import', async () => {
    const document = baseDocument();
    document.resources.prefabs = [
      {
        id: 'chair-parts',
        root: { id: 'root', content: { type: 'group' } },
      },
    ];
    document.nodes = [
      {
        id: 'chair',
        content: { type: 'instance', prefab: 'chair-parts' },
      },
      { id: 'chair/root', content: { type: 'group' } },
    ];

    await expect(
      SceneJSONImporter.loadDocument({} as World, document, {
        index: 1,
        object3D: new Object3D(),
      } as Entity),
    ).rejects.toThrow('derived runtime node id "chair/root"');
  });

  it('resolves document and overridden prefab orientation through shared lowering', async () => {
    const document = baseDocument();
    document.resources.prefabs = [
      {
        id: 'stack',
        root: {
          children: [
            {
              content: { asset: 'base', type: 'asset' },
              id: 'base',
            },
            {
              constraints: {
                lookAt: { mode: 'yaw-v1', target: [6, 1.85, 0] },
              },
              content: { asset: 'top', type: 'asset' },
              id: 'top',
            },
          ],
          content: { type: 'group' },
          id: 'root',
        },
      },
    ];
    document.nodes = [
      {
        content: { asset: 'base', type: 'asset' },
        id: 'document-base',
        transform: { position: [0, 1, 0] },
      },
      {
        constraints: {
          lookAt: { mode: 'yaw-v1', target: [5, 1.85, 0] },
        },
        content: { asset: 'top', type: 'asset' },
        id: 'document-top',
        transform: { position: [0, 1.85, 0] },
      },
      {
        content: {
          overrides: {
            base: { transform: { position: [1, 1, 0] } },
            top: { transform: { position: [1, 1.85, 0] } },
          },
          prefab: 'stack',
          type: 'instance',
        },
        id: 'placed',
        transform: { position: [3, 0, -3] },
      },
      {
        content: {
          distribution: { count: 2, step: [3, 0, 0], type: 'linear' },
          overrides: {
            base: { transform: { position: [1, 1, 0] } },
            top: { transform: { position: [1, 1.85, 0] } },
          },
          prefab: 'stack',
          type: 'pattern',
        },
        id: 'stacks',
      },
    ];

    const roots = await lowerSceneDocumentObjects(document);

    expect(roots[1].object.position.toArray()).toEqual([0, 1.85, 0]);
    expect(Math.round((roots[1].object.rotation.y * 180) / Math.PI)).toBe(90);

    const placedRoot = roots[2].children[0];
    const placedBase = placedRoot.children[0];
    const placedTop = placedRoot.children[1];
    expect(placedBase.object.position.toArray()).toEqual([1, 1, 0]);
    expect(placedTop.object.position.toArray()).toEqual([1, 1.85, 0]);
    expect(Math.round((placedTop.object.rotation.y * 180) / Math.PI)).toBe(90);

    expect(roots[3].children.map((child) => child.id)).toEqual([
      'stacks/0000/root',
      'stacks/0001/root',
    ]);
    expect(
      roots[3].children.map((child) =>
        child.children[1].object.position.toArray(),
      ),
    ).toEqual([
      [1, 1.85, 0],
      [1, 1.85, 0],
    ]);
    expect(document.nodes[1].transform).toEqual({ position: [0, 1.85, 0] });
    expect(
      document.resources.prefabs[0].root.children?.[1].transform,
    ).toBeUndefined();
  });
});

describe('manifest assets and cleanup', () => {
  it('disables asset shadows by default while preserving explicit opt-ins', async () => {
    const source = new Object3D();
    const sourceMesh = new Mesh(
      createSceneGeometry({ size: [1, 1, 1], type: 'box' }),
      new MeshStandardMaterial(),
    );
    sourceMesh.castShadow = true;
    sourceMesh.receiveShadow = true;
    source.add(sourceMesh);
    const document = baseDocument();
    document.nodes = [
      { content: { asset: 'chair', type: 'asset' }, id: 'default' },
      {
        content: {
          asset: 'chair',
          castShadow: true,
          receiveShadow: true,
          type: 'asset',
        },
        id: 'shadowed',
      },
    ];

    const roots = await lowerSceneDocumentObjects(document, {
      loadAsset: async () => source.clone(true),
    });
    const defaultMesh = roots[0].object.children[0] as Mesh;
    const shadowedMesh = roots[1].object.children[0] as Mesh;

    expect(defaultMesh.castShadow).toBe(false);
    expect(defaultMesh.receiveShadow).toBe(false);
    expect(shadowedMesh.castShadow).toBe(true);
    expect(shadowedMesh.receiveShadow).toBe(true);
  });

  it('lowers explicit and default framing roles into runtime object data', async () => {
    const document = baseDocument();
    document.nodes = [
      {
        content: { asset: 'floor', type: 'asset' },
        framingRole: 'support',
        id: 'floor',
      },
      {
        content: { asset: 'blue-unit', type: 'asset' },
        id: 'subject',
      },
      {
        children: [
          {
            content: { asset: 'backdrop', type: 'asset' },
            id: 'backdrop-surface',
          },
        ],
        content: { type: 'group' },
        framingRole: 'support',
        id: 'backdrop',
      },
    ];

    const roots = await lowerSceneDocumentObjects(document);
    expect(roots[0].object.userData.iwsdkSceneFramingRole).toBe('support');
    expect(roots[1].object.userData.iwsdkSceneFramingRole).toBe('content');
    expect(roots[2].children[0].object.userData.iwsdkSceneFramingRole).toBe(
      'support',
    );
  });

  it('keeps shared asset resources alive when lowering trees are disposed', async () => {
    const sourceMaterial = new MeshStandardMaterial({ color: '#00ff00' });
    sourceMaterial.name = 'Body';
    const source = new Object3D();
    source.add(
      new Mesh(
        createSceneGeometry({ size: [1, 1, 1], type: 'box' }),
        sourceMaterial,
      ),
    );
    const document = baseDocument();
    document.nodes = [
      { content: { asset: 'chair', type: 'asset' }, id: 'a' },
      { content: { asset: 'chair', type: 'asset' }, id: 'b' },
    ];

    const roots = await lowerSceneDocumentObjects(document, {
      loadAsset: async () => source.clone(true),
    });
    const materialA = (roots[0].object.children[0] as Mesh)
      .material as MeshStandardMaterial;
    const materialB = (roots[1].object.children[0] as Mesh)
      .material as MeshStandardMaterial;
    expect(sourceMaterial.color.getHexString()).toBe('00ff00');
    expect(materialA).toBe(sourceMaterial);
    expect(materialB).toBe(sourceMaterial);
    expect(roots[0].object.userData.iwsdkSceneAssetId).toBe('chair');

    const disposeA = vi.spyOn(materialA, 'dispose');
    disposeLoweredSceneNodes(...roots);
    expect(disposeA).not.toHaveBeenCalled();
  });
});

describe('importer metadata and environment', () => {
  it('propagates the runtime hash to the result, root, and imported objects', async () => {
    const document = baseDocument();
    document.metadata = { 'test.owner': 'core' };
    document.nodes = [
      {
        content: { asset: 'unit', type: 'asset' },
        framingRole: 'support',
        id: 'sphere',
        metadata: { 'test.role': 'hero' },
      },
    ];
    const rootObject = new Object3D();
    const root = { index: 1, object3D: rootObject } as Entity;
    let index = 2;
    const world = {
      createTransformEntity: vi.fn((object: Object3D) => ({
        index: index++,
        object3D: object,
      })),
      getActiveRoot: () => rootObject,
      assets: {
        bounds: (assetId: string) =>
          TEST_ASSET_BOUNDS[assetId] ?? TEST_ASSET_BOUNDS.unit,
        instantiate: async (assetId: string) => testAsset(assetId),
      },
    } as unknown as World;

    const result = await SceneJSONImporter.loadDocument(world, document, root);
    const expected = hashRuntimeSceneDocument(document);
    expect(result.runtimeHash).toBe(expected);
    expect(rootObject.userData.iwsdkSceneRuntimeHash).toBe(expected);
    expect(result.nodes.get('sphere')?.object.userData).toMatchObject({
      iwsdkSceneFramingRole: 'support',
      iwsdkSceneMetadata: { 'test.role': 'hero' },
      iwsdkSceneRuntimeHash: expected,
    });
    expect(result.nodes.get('sphere')?.framingRole).toBe('support');
  });

  it('applies renderer settings without touching component-owned backgrounds', () => {
    const scene = new Scene();
    const originalBackground = new Color('#112233');
    const originalFog = new Fog('#334455', 1, 10);
    scene.background = originalBackground;
    scene.fog = originalFog;
    let clearAlpha = 0.25;
    const renderer = {
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (value: number) => {
        clearAlpha = value;
      },
      shadowMap: { enabled: false, type: BasicShadowMap },
      toneMapping: NoToneMapping,
      toneMappingExposure: 1,
    } as never;

    const previous = applySceneEnvironment(scene, renderer, {
      exposure: 1.5,
      fog: { color: '#abcdef', density: 0.2, type: 'exponential' },
      shadowMapType: 'pcf-soft',
      shadows: true,
      toneMapping: 'aces',
    });
    expect(scene.background).toBe(originalBackground);
    expect(clearAlpha).toBe(0.25);
    expect((renderer as any).toneMapping).toBe(ACESFilmicToneMapping);
    expect((renderer as any).shadowMap.enabled).toBe(true);
    // 'pcf-soft' uses PCFShadowMap, which is soft since three r182.
    expect((renderer as any).shadowMap.type).toBe(PCFShadowMap);

    restoreSceneEnvironment(scene, renderer, previous);
    expect(scene.background).toBe(originalBackground);
    expect(scene.fog).toBe(originalFog);
    expect(clearAlpha).toBe(0.25);
    expect((renderer as any).toneMapping).toBe(NoToneMapping);
    expect((renderer as any).shadowMap.enabled).toBe(false);
    expect((renderer as any).shadowMap.type).toBe(BasicShadowMap);
  });

  it('replaces omitted settings from a stable level baseline', () => {
    const scene = new Scene();
    const originalFog = new Fog('#334455', 1, 10);
    scene.fog = originalFog;
    let clearAlpha = 1;
    const renderer = {
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (value: number) => {
        clearAlpha = value;
      },
      shadowMap: { enabled: false, type: BasicShadowMap },
      toneMapping: NoToneMapping,
      toneMappingExposure: 1,
    } as never;
    const base = captureSceneEnvironment(scene, renderer);
    applySceneEnvironment(scene, renderer, {
      exposure: 2,
      fog: { color: '#abcdef', density: 0.2, type: 'exponential' },
      toneMapping: 'aces',
    });
    applySceneEnvironment(scene, renderer, { shadows: true }, base);

    expect(scene.fog).toBe(originalFog);
    expect((renderer as any).shadowMap.enabled).toBe(true);
    expect((renderer as any).toneMapping).toBe(NoToneMapping);
    expect((renderer as any).toneMappingExposure).toBe(1);
  });
});
