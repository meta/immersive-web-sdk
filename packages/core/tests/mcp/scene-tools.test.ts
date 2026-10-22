/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  getObjectTransform,
  getRenderStats,
  getSceneHierarchy,
} from '../../src/mcp/scene-tools.js';
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Texture,
  Vector3,
} from '../../src/runtime/index.js';

// ---------------------------------------------------------------------------
// Minimal Object3D mock (only the properties scene-tools uses)
// ---------------------------------------------------------------------------

let uuidCounter = 0;

function createMockObject3D(name: string, children: any[] = []): any {
  return {
    name,
    uuid: `uuid-${++uuidCounter}`,
    children,
    getObjectByProperty: function (prop: string, value: string): any {
      if ((this as any)[prop] === value) {
        return this;
      }
      for (const child of this.children) {
        const found = child.getObjectByProperty(prop, value);
        if (found) {
          return found;
        }
      }
      return undefined;
    },
  };
}

function createMockWorld(sceneChildren: any[] = []): any {
  return {
    scene: createMockObject3D('Scene', sceneChildren),
    player: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getSceneHierarchy', () => {
  describe('breadth limit', () => {
    it('should include all children when count is within default limit', () => {
      const children = Array.from({ length: 10 }, (_, i) =>
        createMockObject3D(`child-${i}`),
      );
      const world = createMockWorld(children);

      const result = getSceneHierarchy(world, {});

      expect(result.children).toHaveLength(10);
      expect(result.truncatedChildren).toBeUndefined();
    });

    it('should truncate children when count exceeds default limit (50)', () => {
      const children = Array.from({ length: 80 }, (_, i) =>
        createMockObject3D(`child-${i}`),
      );
      const world = createMockWorld(children);

      const result = getSceneHierarchy(world, {});

      expect(result.children).toHaveLength(50);
      expect(result.truncatedChildren).toBe(30);
    });

    it('should respect custom maxChildren parameter', () => {
      const children = Array.from({ length: 20 }, (_, i) =>
        createMockObject3D(`child-${i}`),
      );
      const world = createMockWorld(children);

      const result = getSceneHierarchy(world, { maxChildren: 5 });

      expect(result.children).toHaveLength(5);
      expect(result.truncatedChildren).toBe(15);
      // Verify we got the first 5 children
      expect(result.children![0].name).toBe('child-0');
      expect(result.children![4].name).toBe('child-4');
    });

    it('should apply breadth limit recursively to nested children', () => {
      const grandchildren = Array.from({ length: 10 }, (_, i) =>
        createMockObject3D(`grandchild-${i}`),
      );
      const child = createMockObject3D('parent', grandchildren);
      const world = createMockWorld([child]);

      const result = getSceneHierarchy(world, { maxChildren: 3 });

      // Top level: 1 child (within limit)
      expect(result.children).toHaveLength(1);
      expect(result.truncatedChildren).toBeUndefined();

      // Nested level: 3 of 10 grandchildren
      const nestedNode = result.children![0];
      expect(nestedNode.children).toHaveLength(3);
      expect(nestedNode.truncatedChildren).toBe(7);
    });

    it('should not add truncatedChildren when exactly at the limit', () => {
      const children = Array.from({ length: 5 }, (_, i) =>
        createMockObject3D(`child-${i}`),
      );
      const world = createMockWorld(children);

      const result = getSceneHierarchy(world, { maxChildren: 5 });

      expect(result.children).toHaveLength(5);
      expect(result.truncatedChildren).toBeUndefined();
    });
  });

  describe('depth limit', () => {
    it('should respect maxDepth parameter', () => {
      const deep = createMockObject3D('level3');
      const mid = createMockObject3D('level2', [deep]);
      const top = createMockObject3D('level1', [mid]);
      const world = createMockWorld([top]);

      const result = getSceneHierarchy(world, { maxDepth: 2 });

      // depth 0: Scene, depth 1: level1, depth 2: level2 (at limit, no children)
      expect(result.children![0].children![0].children).toBeUndefined();
    });
  });

  describe('entityIndex', () => {
    it('should include entityIndex when entityIdx property exists', () => {
      const obj = createMockObject3D('entity-obj');
      obj.entityIdx = 42;
      const world = createMockWorld([obj]);

      const result = getSceneHierarchy(world, {});

      expect(result.children![0].entityIndex).toBe(42);
    });

    it('should not include entityIndex when entityIdx is absent', () => {
      const obj = createMockObject3D('plain-obj');
      const world = createMockWorld([obj]);

      const result = getSceneHierarchy(world, {});

      expect(result.children![0].entityIndex).toBeUndefined();
    });

    it('should include native scene node ids when present', () => {
      const obj = createMockObject3D('scene-node-obj');
      obj.userData = { iwsdkSceneNodeId: 'lamp-node' };
      const world = createMockWorld([obj]);

      const result = getSceneHierarchy(world, {});

      expect(result.children![0].sceneNodeId).toBe('lamp-node');
    });

    it('should expose content, resources, runtime hash, and stable derived ids', () => {
      const runtimeHash = `sha256:${'a'.repeat(64)}`;
      const obj = createMockObject3D('primitive-node');
      obj.type = 'Mesh';
      obj.userData = {
        iwsdkSceneAssetId: 'wall-asset',
        iwsdkSceneContent: { asset: 'wall-asset', type: 'asset' },
        iwsdkSceneMetadata: { 'test.role': 'facade' },
        iwsdkSceneFramingRole: 'support',
        iwsdkSceneNodeId: 'building/0000/wall',
        iwsdkSceneRuntimeHash: runtimeHash,
        iwsdkSceneSourceNodeId: 'wall',
      };
      const asset = createMockObject3D('asset-node');
      asset.userData = {
        iwsdkSceneContent: { asset: 'catalog-building', type: 'asset' },
        iwsdkSceneAssetId: 'catalog-building',
        iwsdkSceneNodeId: 'catalog-building-node',
        iwsdkSceneRuntimeHash: runtimeHash,
      };
      const instances = createMockObject3D('flower-instances');
      instances.userData = {
        iwsdkSceneInstanceIds: [
          'flowers/0000/flower-root',
          'flowers/0001/flower-root',
          'flowers/0002/flower-root',
        ],
        iwsdkSceneNodeId: 'flowers',
        iwsdkSceneRuntimeHash: runtimeHash,
      };
      const levelRoot = createMockObject3D('LevelRoot', [
        obj,
        asset,
        instances,
      ]);
      levelRoot.userData = {
        iwsdkSceneDocumentMetadata: { 'test.owner': 'core' },
        iwsdkSceneEnvironment: {
          exposure: 1.25,
        },
        iwsdkSceneResources: {
          prefabs: [{ id: 'building', root: { id: 'root' } }],
        },
        iwsdkSceneRuntimeHash: runtimeHash,
      };
      const world = createMockWorld([levelRoot]);

      const result = getSceneHierarchy(world, {});
      const root = result.children![0];
      const node = root.children![0];

      expect(node).toMatchObject({
        assetId: 'wall-asset',
        content: { asset: 'wall-asset', type: 'asset' },
        contentType: 'asset',
        framingRole: 'support',
        metadata: { 'test.role': 'facade' },
        objectType: 'Mesh',
        resourceRefs: { assetId: 'wall-asset' },
        runtimeHash,
        sceneNodeId: 'building/0000/wall',
        sourceNodeId: 'wall',
      });
      expect(root.children![1]).toMatchObject({
        assetId: 'catalog-building',
        content: { asset: 'catalog-building', type: 'asset' },
        resourceRefs: { assetId: 'catalog-building' },
        sceneNodeId: 'catalog-building-node',
      });
      expect(root.children![2]).toMatchObject({
        instanceIds: [
          'flowers/0000/flower-root',
          'flowers/0001/flower-root',
          'flowers/0002/flower-root',
        ],
        runtimeHash,
        sceneNodeId: 'flowers',
      });
      expect(root).toMatchObject({
        documentMetadata: { 'test.owner': 'core' },
        environment: { exposure: 1.25 },
        resources: {
          prefabs: [{ id: 'building' }],
        },
        runtimeHash,
      });
      expect(root.resources).not.toBe(levelRoot.userData.iwsdkSceneResources);
    });
  });

  describe('parentId', () => {
    it('should throw when parentId is not found', () => {
      const world = createMockWorld([]);

      expect(() =>
        getSceneHierarchy(world, { parentId: 'nonexistent' }),
      ).toThrow('Object not found');
    });

    it('should root hierarchy at the specified parentId', () => {
      const child = createMockObject3D('target-child');
      const target = createMockObject3D('target', [child]);
      const world = createMockWorld([target]);

      const result = getSceneHierarchy(world, { parentId: target.uuid });

      expect(result.name).toBe('target');
      expect(result.children).toHaveLength(1);
      expect(result.children![0].name).toBe('target-child');
    });
  });
});

describe('getRenderStats', () => {
  it('keeps raw world bounds while excluding support geometry from framing bounds', () => {
    const scene = new Scene();
    const root = new Group();
    const subject = new Mesh(
      new BoxGeometry(2, 4, 6),
      new MeshStandardMaterial(),
    );
    subject.position.set(3, 2, -1);
    const support = new Mesh(
      new BoxGeometry(100, 0.1, 100),
      new MeshStandardMaterial(),
    );
    support.position.y = -0.05;
    support.userData.iwsdkSceneFramingRole = 'support';
    root.add(subject, support);
    scene.add(root);
    const renderer = {
      constructor: { name: 'TestRenderer' },
      domElement: { height: 600, width: 800 },
      getClearAlpha: () => 1,
      getPixelRatio: () => 1,
      info: {
        memory: { geometries: 2, textures: 0 },
        programs: [],
        render: { calls: 2, lines: 0, points: 0, triangles: 24 },
      },
      shadowMap: { enabled: false },
      toneMapping: 0,
      toneMappingExposure: 1,
    };

    const stats = getRenderStats({
      getActiveRoot: () => root,
      renderer,
      scene,
    } as any);
    expect(stats.worldBounds?.max).toEqual([50, 4, 50]);
    expect(stats.worldBounds?.min[0]).toBe(-50);
    expect(stats.worldBounds?.min[1]).toBeCloseTo(-0.1);
    expect(stats.worldBounds?.min[2]).toBe(-50);
    expect(stats.worldBounds?.size[0]).toBe(100);
    expect(stats.worldBounds?.size[1]).toBeCloseTo(4.1);
    expect(stats.worldBounds?.size[2]).toBe(100);
    expect(stats.framingBounds).toEqual({
      max: [4, 4, 2],
      min: [2, 0, -4],
      size: [2, 4, 6],
    });
    expect(stats.meshCount).toBe(2);
  });

  it('excludes hidden geometry and invisible subtrees only from framing bounds', () => {
    const scene = new Scene();
    const root = new Group();
    const subject = new Mesh(
      new BoxGeometry(2, 2, 2),
      new MeshStandardMaterial(),
    );
    const hidden = new Mesh(
      new BoxGeometry(100, 100, 100),
      new MeshStandardMaterial(),
    );
    hidden.position.x = 200;
    hidden.visible = false;
    const hiddenParent = new Group();
    hiddenParent.visible = false;
    const hiddenDescendant = new Mesh(
      new BoxGeometry(50, 50, 50),
      new MeshStandardMaterial(),
    );
    hiddenDescendant.position.x = -200;
    hiddenParent.add(hiddenDescendant);
    root.add(subject, hidden, hiddenParent);
    scene.add(root);
    const renderer = {
      constructor: { name: 'TestRenderer' },
      domElement: { height: 600, width: 800 },
      getClearAlpha: () => 1,
      getPixelRatio: () => 1,
      info: {
        memory: { geometries: 3, textures: 0 },
        programs: [],
        render: { calls: 1, lines: 0, points: 0, triangles: 12 },
      },
      shadowMap: { enabled: false },
      toneMapping: 0,
      toneMappingExposure: 1,
    };

    const stats = getRenderStats({
      getActiveRoot: () => root,
      renderer,
      scene,
    } as any);

    expect(stats.worldBounds).toMatchObject({
      min: [-225, -50, -50],
      max: [250, 50, 50],
    });
    expect(stats.framingBounds).toEqual({
      min: [-1, -1, -1],
      max: [1, 1, 1],
      size: [2, 2, 2],
    });
  });

  it('measures bounds without reading a UIKit icon boundingBox signal', () => {
    const scene = new Scene();
    const root = new Group();
    const subject = new Mesh(
      new BoxGeometry(2, 2, 2),
      new MeshStandardMaterial(),
    );
    // A UIKit content component (a Lucide icon, say) is a Mesh whose
    // `boundingBox` is a signal; Box3.setFromObject would copy it and throw.
    const icon = Object.assign(
      new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()),
      {
        boundingBox: {
          value: { center: new Vector3(), size: new Vector3(1, 1.01, 1) },
        },
      },
    );
    icon.position.x = 5;
    // Instanced meshes keep their own bounds, which cover every instance.
    const instanced = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial(),
      2,
    );
    instanced.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -10));
    instanced.setMatrixAt(1, new Matrix4().makeTranslation(0, 0, 10));
    root.add(subject, icon, instanced);
    scene.add(root);
    const renderer = {
      constructor: { name: 'TestRenderer' },
      domElement: { height: 600, width: 800 },
      getClearAlpha: () => 1,
      getPixelRatio: () => 1,
      info: {
        memory: { geometries: 3, textures: 0 },
        programs: [],
        render: { calls: 3, lines: 0, points: 0, triangles: 36 },
      },
      shadowMap: { enabled: false },
      toneMapping: 0,
      toneMappingExposure: 1,
    };

    const stats = getRenderStats({
      getActiveRoot: () => root,
      renderer,
      scene,
    } as any);

    const expected = {
      min: [-1, -1, -10.5],
      max: [5.5, 1, 10.5],
      size: [6.5, 2, 21],
    };
    expect(stats.worldBounds).toEqual(expected);
    expect(stats.framingBounds).toEqual(expected);
  });

  it('reports raw renderer counters, scene resources, and world bounds', () => {
    const scene = new Scene();
    scene.background = new Color('#112233');
    scene.fog = new Fog('#334455', 2, 20);
    const root = new Group();
    const asset = new Group();
    asset.userData.iwsdkSceneAssetId = 'garden-model';
    asset.userData.iwsdkSceneAssetSourceUri = './models/garden.glb';
    asset.userData.iwsdkSceneAssetUri = '/models/garden.glb';
    const material = new MeshStandardMaterial({
      color: '#123456',
      emissive: '#010203',
      emissiveIntensity: 0.5,
      metalness: 0.2,
      opacity: 0.9,
      roughness: 0.4,
    });
    material.userData.iwsdkSceneMaterialId = 'paint';
    const mesh = new Mesh(new BoxGeometry(2, 4, 6), material);
    mesh.position.set(3, 2, -1);
    mesh.castShadow = true;
    asset.add(mesh);
    root.add(asset);
    const light = new DirectionalLight('#fedcba', 2.5);
    light.castShadow = true;
    light.target.position.set(0, -1, 0);
    light.userData.iwsdkSceneNodeId = 'sun';
    root.add(light);
    scene.add(root);
    const renderer = {
      constructor: { name: 'TestRenderer' },
      domElement: { height: 600, width: 800 },
      getClearAlpha: () => 1,
      getPixelRatio: () => 2,
      info: {
        memory: { geometries: 1, textures: 2 },
        programs: [{}, {}],
        render: { calls: 3, lines: 4, points: 5, triangles: 12 },
      },
      shadowMap: { enabled: true },
      toneMapping: ACESFilmicToneMapping,
      toneMappingExposure: 1.25,
    };

    expect(
      getRenderStats({
        getActiveRoot: () => root,
        renderer,
        scene,
      } as any),
    ).toMatchObject({
      available: true,
      calls: 3,
      geometries: 1,
      lines: 4,
      materialCount: 1,
      meshCount: 1,
      points: 5,
      programs: 2,
      shadowCasters: 1,
      sceneAssets: [
        {
          id: 'garden-model',
          meshCount: 1,
        },
      ],
      sceneEnvironment: {
        background: { color: '#112233', type: 'color' },
        clearAlpha: 1,
        exposure: 1.25,
        fog: {
          color: '#334455',
          far: 20,
          near: 2,
          type: 'linear',
        },
        shadows: true,
        toneMapping: 'aces',
      },
      sceneLights: [
        {
          castShadow: true,
          color: '#fedcba',
          intensity: 2.5,
          nodeId: 'sun',
          type: 'directional',
        },
      ],
      sceneMaterials: [
        {
          baseColor: '#123456',
          emissive: '#010203',
          emissiveIntensity: 0.5,
          flatShading: false,
          id: 'paint',
          metalness: 0.2,
          model: 'standard',
          opacity: 0.9,
          roughness: 0.4,
          side: 'front',
        },
      ],
      textures: 2,
      triangles: 12,
      worldBounds: {
        max: [4, 4, 2],
        min: [2, 0, -4],
        size: [2, 4, 6],
      },
    });
  });

  it('normalizes authored gradient metadata colors for parity', () => {
    const scene = new Scene();
    const background = new Texture();
    background.userData.iwsdkSceneGradientBackground = {
      bottomColor: '#AABBCC',
      exponent: 1.5,
      topColor: '#DDEEFF',
      type: 'gradient',
    };
    scene.background = background;
    const root = new Group();
    scene.add(root);
    const renderer = {
      constructor: { name: 'TestRenderer' },
      domElement: { height: 1, width: 1 },
      getClearAlpha: () => 1,
      getPixelRatio: () => 1,
      info: {
        memory: { geometries: 0, textures: 1 },
        programs: [],
        render: { calls: 0, lines: 0, points: 0, triangles: 0 },
      },
      shadowMap: { enabled: false, type: 1 },
      toneMapping: 0,
      toneMappingExposure: 1,
    };

    expect(
      getRenderStats({
        getActiveRoot: () => root,
        renderer,
        scene,
      } as any).sceneEnvironment.background,
    ).toEqual({
      bottomColor: '#aabbcc',
      exponent: 1.5,
      topColor: '#ddeeff',
      type: 'gradient',
    });
  });
});

describe('getRenderStats scene environment', () => {
  function environmentStats(configure: (scene: Scene) => void, clearAlpha = 1) {
    const scene = new Scene();
    const root = new Group();
    scene.add(root);
    configure(scene);
    const renderer = {
      constructor: { name: 'TestRenderer' },
      domElement: { height: 1, width: 1 },
      getClearAlpha: () => clearAlpha,
      getPixelRatio: () => 1,
      info: {
        memory: { geometries: 0, textures: 0 },
        programs: [],
        render: { calls: 0, lines: 0, points: 0, triangles: 0 },
      },
      shadowMap: { enabled: false, type: 1 },
      toneMapping: 0,
      toneMappingExposure: 1,
    };
    return getRenderStats({
      getActiveRoot: () => root,
      renderer,
      scene,
    } as any).sceneEnvironment;
  }

  const DOME_MARKER = {
    azimuthDeg: -31,
    axis: [0.47, 0.41, -0.78],
    dither: true,
    elevationDeg: 24,
    equator: [0.808, 0.855, 0.91, 1],
    ground: [0.902, 0.855, 0.82, 1],
    intensity: 1,
    sky: [0.843, 0.796, 0.882, 1],
  };

  function addDome(scene: Scene): Mesh {
    const dome = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    dome.userData.iwsdkSceneDomeGradient = DOME_MARKER;
    scene.add(dome);
    return dome;
  }

  it('reports a DomeGradient sky from the dome marker', () => {
    expect(environmentStats((scene) => addDome(scene)).background).toEqual({
      azimuthDeg: -31,
      dither: true,
      elevationDeg: 24,
      equator: [0.808, 0.855, 0.91, 1],
      ground: [0.902, 0.855, 0.82, 1],
      intensity: 1,
      sky: [0.843, 0.796, 0.882, 1],
      type: 'dome-gradient',
    });
  });

  it('reports a DomeTexture sky ahead of a leftover dome', () => {
    expect(
      environmentStats((scene) => {
        const texture = new Texture();
        texture.userData.iwsdkSceneDomeTexture = {
          blurriness: 0.2,
          intensity: 0.9,
          rotation: [0, 1.5, 0],
          src: '/envs/sky.hdr',
        };
        scene.background = texture;
        addDome(scene);
      }).background,
    ).toEqual({
      blurriness: 0.2,
      intensity: 0.9,
      rotation: [0, 1.5, 0],
      src: '/envs/sky.hdr',
      type: 'dome-texture',
    });
  });

  it('still reports transparent for a hidden dome with clear alpha 0', () => {
    expect(
      environmentStats((scene) => {
        addDome(scene).visible = false;
      }, 0).background,
    ).toEqual({ type: 'transparent' });
    expect(
      environmentStats((scene) => {
        addDome(scene).visible = false;
      }, 1).background,
    ).toBeNull();
  });

  it('reports gradient and texture image-based lighting', () => {
    expect(
      environmentStats((scene) => {
        const texture = new Texture();
        texture.userData.iwsdkSceneIBLGradient = {
          equator: [0.6584, 0.7084, 0.7913, 1],
          ground: [0.807, 0.7758, 0.7454, 1],
          intensity: 0.2025,
          sky: [0.6902, 0.749, 0.7843, 1],
        };
        scene.environment = texture;
      }).imageBasedLighting,
    ).toEqual({
      equator: [0.6584, 0.7084, 0.7913, 1],
      ground: [0.807, 0.7758, 0.7454, 1],
      intensity: 0.2025,
      sky: [0.6902, 0.749, 0.7843, 1],
      type: 'ibl-gradient',
    });
    expect(
      environmentStats((scene) => {
        const texture = new Texture();
        texture.userData.iwsdkSceneIBLTexture = {
          intensity: 1.2,
          rotation: [0, 0.5, 0],
          src: 'room',
        };
        scene.environment = texture;
      }).imageBasedLighting,
    ).toEqual({
      intensity: 1.2,
      rotation: [0, 0.5, 0],
      src: 'room',
      type: 'ibl-texture',
    });
    expect(environmentStats(() => {}).imageBasedLighting).toBeNull();
  });
});

describe('getObjectTransform', () => {
  it('finds Object3D transforms by native scene node id', () => {
    const obj = createMockObject3D('scene-node-obj');
    obj.userData = { iwsdkSceneNodeId: 'lamp-node' };
    obj.position = { toArray: () => [1, 2, 3] };
    obj.quaternion = { toArray: () => [0, 0, 0, 1] };
    obj.scale = { toArray: () => [1, 1, 1] };
    obj.updateWorldMatrix = () => {};
    obj.matrixWorld = {
      decompose: (position: any, quaternion: any, scale: any) => {
        position.set(4, 5, 6);
        quaternion.set(0, 0, 0, 1);
        scale.set(2, 2, 2);
      },
    };
    const world = createMockWorld([obj]);

    const transform = getObjectTransform(world, { nodeId: 'lamp-node' });

    expect(transform).toMatchObject({
      globalPosition: [4, 5, 6],
      globalQuaternion: [0, 0, 0, 1],
      globalScale: [2, 2, 2],
      localPosition: [1, 2, 3],
      localQuaternion: [0, 0, 0, 1],
      localScale: [1, 1, 1],
    });
  });
});
