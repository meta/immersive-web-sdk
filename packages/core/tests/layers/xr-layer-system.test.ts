/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { signal } from '@preact/signals-core';
import { World } from 'elics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '../../src/ecs/entity.js';
import { XRCylinderLayer } from '../../src/layers/xr-cylinder-layer.js';
import { XRLayerState } from '../../src/layers/xr-layer-state.js';
import { XRLayerSystem } from '../../src/layers/xr-layer-system.js';
import { XRQuadLayer } from '../../src/layers/xr-quad-layer.js';
import {
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from '../../src/runtime/three.js';

vi.hoisted(() => {
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => ({
        arc: () => {},
        beginPath: () => {},
        clearRect: () => {},
        fill: () => {},
        fillStyle: '',
        lineWidth: 0,
        stroke: () => {},
        strokeStyle: '',
      }),
      height: 0,
      width: 0,
    }),
  };
  (globalThis as any).XRRigidTransform = class {
    constructor(
      public position: DOMPointInit,
      public orientation: DOMPointInit,
    ) {}
  };
});

const entities: Entity[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const entity of entities.splice(0)) {
    entity.destroy();
  }
});

function createHarness(type: 'quad' | 'cylinder' = 'quad') {
  const entityWorld = new World();
  entityWorld.registerComponent(XRQuadLayer);
  entityWorld.registerComponent(XRCylinderLayer);
  entityWorld.registerComponent(XRLayerState);

  const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  const fallbackMaterial = mesh.material as MeshBasicMaterial;
  const renderTarget = { dispose: vi.fn(), texture: {} };
  const entity = entityWorld.createEntity() as Entity;
  entities.push(entity);
  entity.object3D = new Object3D();
  const renderCallback = vi.fn();
  if (type === 'quad') {
    entity.addComponent(XRQuadLayer, {
      height: 1,
      renderCallback,
      width: 1,
    });
  } else {
    entity.addComponent(XRCylinderLayer, {
      aspectRatio: 1,
      centralAngle: Math.PI,
      radius: 1,
      renderCallback,
    });
  }
  entity.addComponent(XRLayerState, {
    fallbackMaterial,
    isQuad: type === 'quad',
    mesh,
    renderTarget,
  });

  const nativeLayer = {
    aspectRatio: 1,
    centralAngle: Math.PI,
    destroy: vi.fn(),
    height: 1,
    radius: 1,
    transform: null,
    width: 1,
  };
  const projectionLayer = {};
  let pendingLayers: unknown[] | null = null;
  const session = {
    renderState: { layers: [projectionLayer] as unknown[] },
    updateRenderState: vi.fn((state: { layers: unknown[] }) => {
      pendingLayers = state.layers;
    }),
  };
  const applyPendingLayers = () => {
    if (pendingLayers === null) {
      return;
    }
    session.renderState.layers = pendingLayers;
    pendingLayers = null;
  };
  const binding = {
    createCylinderLayer: vi.fn(() => nativeLayer),
    createQuadLayer: vi.fn(() => nativeLayer),
    getSubImage: vi.fn((layer: unknown) => {
      if (!session.renderState.layers.includes(layer)) {
        throw new Error('layer is not active in the current render state');
      }
      return { colorTexture: {} };
    }),
  };
  const xr = {
    addEventListener: vi.fn(),
    getBinding: vi.fn(() => binding),
    getFrame: vi.fn(() => ({})),
    getReferenceSpace: vi.fn(() => ({})),
    getSession: vi.fn(() => session),
    removeEventListener: vi.fn(),
    enabled: true,
  };
  const renderer = {
    clear: vi.fn(),
    getClearAlpha: vi.fn(() => 1),
    getClearColor: vi.fn(),
    getRenderTarget: vi.fn(() => null),
    setClearColor: vi.fn(),
    setRenderTarget: vi.fn(),
    setRenderTargetTextures: vi.fn(),
    xr,
  };
  const player = new Object3D();
  const world = {
    camera: new PerspectiveCamera(),
    globals: {},
    input: {},
    player,
    playerEntity: {},
    playerHeadEntity: {},
    renderer,
    scene: new Scene(),
    session: undefined,
    visibilityState: signal('non-immersive'),
  };
  const system = new XRLayerSystem(world as any, {} as any, 0);

  return {
    applyPendingLayers,
    binding,
    entity,
    fallbackMaterial,
    mesh,
    nativeLayer,
    player,
    projectionLayer,
    renderer,
    renderCallback,
    session,
    system,
  };
}

describe('XRLayerSystem native transform synchronization', () => {
  it('retries layer setup after the queued projection layer becomes active', () => {
    const {
      applyPendingLayers,
      binding,
      entity,
      fallbackMaterial,
      mesh,
      nativeLayer,
      projectionLayer,
      renderCallback,
      session,
      system,
    } = createHarness();
    (system as any).queries = {
      activeLayers: { entities: new Set([entity]) },
    };
    session.renderState.layers = [];

    (system as any).handleSessionStart();

    expect((system as any).sessionUsesLayers).toBe(false);
    expect((system as any).sessionLayerInitializationPending).toBe(true);
    expect(binding.createQuadLayer).not.toHaveBeenCalled();

    (system as any).renderLayers();
    expect(mesh.material).toBe(fallbackMaterial);
    expect(renderCallback).toHaveBeenCalledTimes(1);
    expect(session.updateRenderState).not.toHaveBeenCalled();

    session.renderState.layers = [projectionLayer];
    (system as any).renderLayers();

    expect((system as any).sessionUsesLayers).toBe(true);
    expect((system as any).sessionLayerInitializationPending).toBe(false);
    expect(binding.createQuadLayer).toHaveBeenCalledTimes(1);
    // XRQuadLayer width/height are half-extents: the 1 m quad is 0.5 x 0.5.
    const quadInit = binding.createQuadLayer.mock.calls[0][0] as {
      height: number;
      width: number;
    };
    expect(quadInit.width).toBe(0.5);
    expect(quadInit.height).toBe(0.5);
    expect(session.updateRenderState).toHaveBeenLastCalledWith({
      layers: [projectionLayer, nativeLayer],
    });
    expect(mesh.material).toBe(fallbackMaterial);
    expect(binding.getSubImage).not.toHaveBeenCalled();
    expect(renderCallback).toHaveBeenCalledTimes(2);

    applyPendingLayers();
    (system as any).renderLayers();

    expect(mesh.material).not.toBe(fallbackMaterial);
    // The layer is composited over the projection layer, so the mesh must not
    // punch a hole there: it would show through transparent layer texels.
    expect((mesh.material as MeshBasicMaterial).visible).toBe(false);
    expect((nativeLayer as any).blendTextureSourceAlpha).toBe(true);
    expect(binding.getSubImage).toHaveBeenCalledTimes(1);
    expect(renderCallback).toHaveBeenCalledTimes(3);
  });

  it('creates a native cylinder with scaled dimensions and a player-relative pose', () => {
    const { binding, entity, mesh, nativeLayer, player, system } =
      createHarness('cylinder');
    entity.setValue(XRCylinderLayer, 'radius', 1.5);
    entity.setValue(XRCylinderLayer, 'aspectRatio', 2);
    entity.setValue(XRLayerState, 'pixelWidth', 2048);
    entity.setValue(XRLayerState, 'pixelHeight', 1024);
    player.position.set(1, 2, 3);
    mesh.position.set(4, 6, 8);
    mesh.scale.set(2, 0.5, 2);

    expect((system as any).activateNativeLayer(entity)).toBe(true);
    expect(binding.createCylinderLayer).toHaveBeenCalledTimes(1);
    expect(binding.createQuadLayer).not.toHaveBeenCalled();

    const init = binding.createCylinderLayer.mock.calls[0][0] as {
      aspectRatio: number;
      centralAngle: number;
      clearOnAccess: boolean;
      radius: number;
      transform: {
        orientation: DOMPointInit;
        position: DOMPointInit;
      };
      viewPixelHeight: number;
      viewPixelWidth: number;
    };
    expect(init.radius).toBe(3);
    expect(init.aspectRatio).toBe(8);
    expect(init.centralAngle).toBeCloseTo(Math.PI);
    expect(init.viewPixelWidth).toBe(2048);
    expect(init.viewPixelHeight).toBe(1024);
    expect(init.clearOnAccess).toBe(false);
    expect(init.transform.position).toMatchObject({ x: 3, y: 4, z: 5 });
    expect(init.transform.orientation).toMatchObject({
      w: 1,
      x: 0,
      y: 0,
      z: 0,
    });
    expect(XRLayerState.data.xrLayer[entity.index]).toBe(nativeLayer);
  });

  it('synchronizes live cylinder dimensions and pose without recreating the layer', () => {
    const { binding, entity, mesh, nativeLayer, player, system } =
      createHarness('cylinder');
    expect((system as any).activateNativeLayer(entity)).toBe(true);
    const initialTransform = nativeLayer.transform;

    entity.setValue(XRCylinderLayer, 'radius', 2);
    entity.setValue(XRCylinderLayer, 'aspectRatio', 3);
    entity.setValue(XRCylinderLayer, 'centralAngle', Math.PI / 2);
    player.position.set(1, 1, 1);
    mesh.position.set(3, 4, 5);
    mesh.scale.set(1.5, 0.75, 1.5);

    expect((system as any).syncLayerTransform(nativeLayer, mesh, entity)).toBe(
      true,
    );
    expect(binding.createCylinderLayer).toHaveBeenCalledTimes(1);
    expect(nativeLayer.radius).toBe(3);
    expect(nativeLayer.aspectRatio).toBe(6);
    expect(nativeLayer.centralAngle).toBeCloseTo(Math.PI / 2);
    expect(nativeLayer.transform).not.toBe(initialTransform);
    expect((nativeLayer.transform as any).position).toMatchObject({
      x: 2,
      y: 3,
      z: 4,
    });
    expect((nativeLayer.transform as any).orientation).toMatchObject({
      w: 1,
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it('updates component-only dimensions without churning a static transform', () => {
    const { entity, mesh, nativeLayer, system } = createHarness();
    const oldGeometry = mesh.geometry;
    const geometryDispose = vi.spyOn(oldGeometry, 'dispose');
    (system as any).layerConfigurations.set(entity.index, new Vector3(1, 1, 0));
    entity.setValue(XRQuadLayer, 'width', 2);
    entity.setValue(XRQuadLayer, 'height', 3);
    entity.setValue(XRLayerState, 'cachedTransform', {
      configuration: new Vector3(1, 1, 0),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(1, 1, 1),
    });
    (system as any).syncLayerGeometry(entity, mesh, true);

    expect((system as any).syncLayerTransform(nativeLayer, mesh, entity)).toBe(
      true,
    );
    expect(nativeLayer.width).toBe(1);
    expect(nativeLayer.height).toBe(1.5);
    expect(mesh.geometry).not.toBe(oldGeometry);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox?.getSize(new Vector3()).toArray()).toEqual(
      [2, 3, 0],
    );
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    const transformAfterUpdate = nativeLayer.transform;

    expect((system as any).syncLayerTransform(nativeLayer, mesh, entity)).toBe(
      true,
    );
    expect(nativeLayer.transform).toBe(transformAfterUpdate);
  });

  it('holds stable fallback state and retries after an unsupported scale recovers', () => {
    const {
      applyPendingLayers,
      binding,
      entity,
      fallbackMaterial,
      mesh,
      nativeLayer,
      projectionLayer,
      renderCallback,
      session,
      system,
    } = createHarness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mesh.scale.set(0, 1, 1);

    expect((system as any).activateNativeLayer(entity)).toBe(false);
    expect(binding.createQuadLayer).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect((system as any).shouldRetryNativeLayer(entity, mesh, true)).toBe(
      false,
    );

    mesh.position.set(1, 2, 3);
    expect((system as any).shouldRetryNativeLayer(entity, mesh, true)).toBe(
      false,
    );

    mesh.scale.set(0.000001, 1, 1);
    expect((system as any).shouldRetryNativeLayer(entity, mesh, true)).toBe(
      true,
    );
    (system as any).sessionUsesLayers = true;
    (system as any).queries = {
      activeLayers: { entities: new Set([entity]) },
    };
    (system as any).renderLayers();
    expect(binding.createQuadLayer).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(session.updateRenderState).toHaveBeenLastCalledWith({
      layers: [projectionLayer, nativeLayer],
    });
    expect(mesh.material).toBe(fallbackMaterial);
    expect(binding.getSubImage).not.toHaveBeenCalled();
    expect(renderCallback).toHaveBeenCalledTimes(1);

    applyPendingLayers();
    (system as any).renderLayers();
    expect(mesh.material).not.toBe(fallbackMaterial);
    expect(binding.getSubImage).toHaveBeenCalledTimes(1);
    expect(renderCallback).toHaveBeenCalledTimes(2);
  });

  it('does not churn stable non-finite fallback state and retries on recovery', () => {
    const { entity, mesh, system } = createHarness();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const oldGeometry = mesh.geometry;
    entity.setValue(XRQuadLayer, 'width', Number.NaN);

    (system as any).syncLayerGeometry(entity, mesh, true);
    const fallbackGeometry = mesh.geometry;
    expect(fallbackGeometry).not.toBe(oldGeometry);
    fallbackGeometry.computeBoundingBox();
    expect(
      fallbackGeometry.boundingBox?.getSize(new Vector3()).toArray(),
    ).toEqual([0, 1, 0]);
    expect(
      Array.from(fallbackGeometry.getAttribute('position').array).every(
        Number.isFinite,
      ),
    ).toBe(true);
    const cachedConfiguration = (system as any).layerConfigurations.get(
      entity.index,
    );
    (system as any).syncLayerGeometry(entity, mesh, true);
    expect(mesh.geometry).toBe(fallbackGeometry);
    expect((system as any).layerConfigurations.get(entity.index)).toBe(
      cachedConfiguration,
    );

    expect((system as any).activateNativeLayer(entity)).toBe(false);
    expect((system as any).shouldRetryNativeLayer(entity, mesh, true)).toBe(
      false,
    );

    entity.setValue(XRQuadLayer, 'width', 1);
    expect((system as any).shouldRetryNativeLayer(entity, mesh, true)).toBe(
      true,
    );
  });

  it('keeps native content valid until an invalid-dimension removal is active', () => {
    const {
      applyPendingLayers,
      entity,
      fallbackMaterial,
      mesh,
      nativeLayer,
      projectionLayer,
      renderCallback,
      session,
      system,
    } = createHarness();
    entity.setValue(XRLayerState, 'xrLayer', nativeLayer);
    entity.setValue(XRLayerState, 'cachedTransform', {
      configuration: new Vector3(1, 1, 0),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(1, 1, 1),
    });
    (system as any).sessionUsesLayers = true;
    (system as any).queries = {
      activeLayers: { entities: new Set([entity]) },
    };
    (system as any).updateSessionLayers();
    applyPendingLayers();
    (system as any).renderLayers();
    expect(mesh.material).not.toBe(fallbackMaterial);
    expect(renderCallback).toHaveBeenCalledTimes(1);

    const oldGeometry = mesh.geometry;
    entity.setValue(XRQuadLayer, 'width', 0);
    (system as any).renderLayers();

    expect(mesh.geometry).not.toBe(oldGeometry);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox?.getSize(new Vector3()).toArray()).toEqual(
      [0, 1, 0],
    );
    expect((system as any).pendingNativeLayerRemovals.has(entity.index)).toBe(
      true,
    );
    expect(session.updateRenderState).toHaveBeenLastCalledWith({
      layers: [projectionLayer],
    });
    expect(nativeLayer.destroy).not.toHaveBeenCalled();
    expect(mesh.material).not.toBe(fallbackMaterial);
    expect(renderCallback).toHaveBeenCalledTimes(2);

    applyPendingLayers();
    (system as any).renderLayers();

    expect(nativeLayer.destroy).toHaveBeenCalledTimes(1);
    expect(XRLayerState.data.xrLayer[entity.index]).toBeNull();
    expect(mesh.material).toBe(fallbackMaterial);
    expect(renderCallback).toHaveBeenCalledTimes(3);
  });

  it('recognizes stable non-finite transforms and retries once finite', () => {
    const { entity, mesh, system } = createHarness();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mesh.position.x = Number.NaN;

    expect((system as any).activateNativeLayer(entity)).toBe(false);
    expect((system as any).shouldRetryNativeLayer(entity, mesh, true)).toBe(
      false,
    );

    mesh.position.x = 0;
    expect((system as any).shouldRetryNativeLayer(entity, mesh, true)).toBe(
      true,
    );
  });

  it('retries when a cylinder crosses the radial-scale support boundary', () => {
    const { entity, mesh, system } = createHarness('cylinder');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mesh.scale.set(1, 1, 1 / 0.9999 + 1e-12);

    expect((system as any).activateNativeLayer(entity)).toBe(false);
    expect((system as any).shouldRetryNativeLayer(entity, mesh, false)).toBe(
      false,
    );

    mesh.scale.z = 1 / 0.9999 - 1e-12;
    expect((system as any).shouldRetryNativeLayer(entity, mesh, false)).toBe(
      true,
    );
  });

  it('keeps a callback-free native layer aligned during locomotion', () => {
    const { entity, nativeLayer, player, system } = createHarness();
    entity.setValue(XRQuadLayer, 'renderCallback', null);
    entity.setValue(XRLayerState, 'xrLayer', nativeLayer);
    entity.setValue(XRLayerState, 'cachedTransform', {
      configuration: new Vector3(1, 1, 0),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(1, 1, 1),
    });
    (system as any).sessionUsesLayers = true;
    (system as any).queries = {
      activeLayers: { entities: new Set([entity]) },
    };

    player.position.set(1, 0, 0);
    (system as any).renderLayers();

    expect((nativeLayer.transform as any).position.x).toBeCloseTo(-1);
    expect((nativeLayer.transform as any).position.y).toBeCloseTo(0);
    expect((nativeLayer.transform as any).position.z).toBeCloseTo(0);
  });

  it('removes hidden native layers and waits for restored state before rendering', () => {
    const {
      applyPendingLayers,
      binding,
      entity,
      fallbackMaterial,
      mesh,
      nativeLayer,
      projectionLayer,
      renderCallback,
      renderer,
      session,
      system,
    } = createHarness();
    const parent = new Object3D();
    parent.add(mesh);
    entity.setValue(XRLayerState, 'xrLayer', nativeLayer);
    entity.setValue(XRLayerState, 'cachedTransform', {
      configuration: new Vector3(1, 1, 0),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(1, 1, 1),
    });
    (system as any).sessionUsesLayers = true;
    (system as any).queries = {
      activeLayers: { entities: new Set([entity]) },
    };
    (system as any).updateSessionLayers();
    applyPendingLayers();

    parent.visible = false;
    (system as any).renderLayers();
    expect(session.updateRenderState).toHaveBeenLastCalledWith({
      layers: [projectionLayer],
    });
    expect(mesh.material).not.toBe(fallbackMaterial);
    expect(binding.getSubImage).toHaveBeenCalledTimes(1);
    expect(renderer.clear).toHaveBeenCalledWith(true, true, true);
    expect(renderCallback).not.toHaveBeenCalled();
    applyPendingLayers();

    // Once removal is active, switch back to a fresh internal fallback target.
    (system as any).renderLayers();
    expect(mesh.material).toBe(fallbackMaterial);
    expect(binding.getSubImage).toHaveBeenCalledTimes(1);
    expect(renderer.clear).toHaveBeenCalledTimes(1);

    parent.visible = true;
    (system as any).renderLayers();
    expect(session.updateRenderState).toHaveBeenLastCalledWith({
      layers: [projectionLayer, nativeLayer],
    });
    expect(mesh.material).toBe(fallbackMaterial);
    expect(binding.getSubImage).toHaveBeenCalledTimes(1);
    expect(renderCallback).toHaveBeenCalledTimes(1);

    applyPendingLayers();
    (system as any).renderLayers();
    expect(mesh.material).not.toBe(fallbackMaterial);
    expect(binding.getSubImage).toHaveBeenCalledTimes(2);
    expect(renderCallback).toHaveBeenCalledTimes(2);
  });

  it('defers active-layer destruction and clears stale removal state before requalification', () => {
    const {
      applyPendingLayers,
      binding,
      entity,
      fallbackMaterial,
      mesh,
      nativeLayer,
      projectionLayer,
      renderer,
      session,
      system,
    } = createHarness();
    const activeEntities = new Set([entity]);
    entity.setValue(XRLayerState, 'xrLayer', nativeLayer);
    entity.setValue(XRLayerState, 'cachedTransform', {
      configuration: new Vector3(1, 1, 0),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(1, 1, 1),
    });
    (system as any).sessionUsesLayers = true;
    (system as any).queries = {
      activeLayers: { entities: activeEntities },
    };
    (system as any).updateSessionLayers();
    applyPendingLayers();
    (system as any).renderLayers();

    const punchMaterial = mesh.material as MeshBasicMaterial;
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
    const fallbackDispose = vi.spyOn(fallbackMaterial, 'dispose');
    const punchDispose = vi.spyOn(punchMaterial, 'dispose');
    const renderTarget = XRLayerState.data.renderTarget[entity.index] as {
      dispose: ReturnType<typeof vi.fn>;
    };
    (system as any).pendingNativeLayerRemovals.add(entity.index);

    (system as any).teardownLayer(entity);
    activeEntities.delete(entity);

    expect(session.updateRenderState).toHaveBeenLastCalledWith({
      layers: [projectionLayer],
    });
    expect((system as any).pendingNativeLayerRemovals.has(entity.index)).toBe(
      false,
    );
    expect((system as any).retiredLayers).toHaveLength(1);
    expect(nativeLayer.destroy).not.toHaveBeenCalled();
    expect(renderTarget.dispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(fallbackDispose).not.toHaveBeenCalled();
    expect(punchDispose).not.toHaveBeenCalled();

    (system as any).renderLayers();
    expect(renderer.clear).toHaveBeenCalledWith(true, true, true);
    expect(nativeLayer.destroy).not.toHaveBeenCalled();

    applyPendingLayers();
    (system as any).renderLayers();
    expect((system as any).retiredLayers).toHaveLength(0);
    expect(nativeLayer.destroy).toHaveBeenCalledTimes(1);
    expect(renderTarget.dispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(fallbackDispose).toHaveBeenCalledTimes(1);
    expect(punchDispose).toHaveBeenCalledTimes(1);

    binding.createQuadLayer.mockClear();
    session.updateRenderState.mockClear();
    activeEntities.add(entity);
    (system as any).setupLayer(entity, 'quad');
    expect(binding.createQuadLayer).toHaveBeenCalledTimes(1);
    expect(session.updateRenderState).toHaveBeenLastCalledWith({
      layers: [projectionLayer, nativeLayer],
    });

    activeEntities.delete(entity);
    (system as any).teardownLayer(entity);
  });

  it('commits retired-layer classification before sub-image acquisition can throw', () => {
    const { binding, projectionLayer, renderer, session, system } =
      createHarness();
    const createRetiredResources = () => {
      const xrLayer = { destroy: vi.fn() };
      const fallbackMaterial = new MeshBasicMaterial();
      const mesh = new Mesh(new PlaneGeometry(1, 1), fallbackMaterial);
      const renderTarget = { dispose: vi.fn(), texture: {} };
      return {
        resources: {
          fallbackMaterial,
          mesh,
          renderTarget,
          xrLayer,
        },
        renderTarget,
        xrLayer,
      };
    };
    const inactive = createRetiredResources();
    const activeFirst = createRetiredResources();
    const activeSecond = createRetiredResources();
    session.renderState.layers = [
      projectionLayer,
      activeFirst.xrLayer,
      activeSecond.xrLayer,
    ];
    (system as any).retiredLayers = [
      inactive.resources,
      activeFirst.resources,
      activeSecond.resources,
    ];
    binding.getSubImage.mockImplementation((layer: unknown) => {
      if (layer === activeSecond.xrLayer) {
        throw new Error('sub-image failed');
      }
      return { colorTexture: {} };
    });

    expect(() => (system as any).renderRetiredLayers(renderer)).toThrowError(
      'sub-image failed',
    );

    expect(inactive.xrLayer.destroy).toHaveBeenCalledTimes(1);
    expect(inactive.renderTarget.dispose).toHaveBeenCalledTimes(1);
    expect((system as any).retiredLayers).toEqual([
      activeFirst.resources,
      activeSecond.resources,
    ]);
    expect(activeFirst.xrLayer.destroy).not.toHaveBeenCalled();
    expect(activeSecond.xrLayer.destroy).not.toHaveBeenCalled();
    expect(renderer.clear).toHaveBeenCalledTimes(1);

    binding.getSubImage.mockReturnValue({ colorTexture: {} });
    (system as any).renderRetiredLayers(renderer);
    expect(inactive.xrLayer.destroy).toHaveBeenCalledTimes(1);
    expect(renderer.clear).toHaveBeenCalledTimes(3);

    session.renderState.layers = [projectionLayer];
    (system as any).renderRetiredLayers(renderer);
    expect((system as any).retiredLayers).toHaveLength(0);
    expect(inactive.xrLayer.destroy).toHaveBeenCalledTimes(1);
    expect(activeFirst.xrLayer.destroy).toHaveBeenCalledTimes(1);
    expect(activeSecond.xrLayer.destroy).toHaveBeenCalledTimes(1);
  });

  it('restores renderer state when a fallback render callback throws', () => {
    const { entity, renderCallback, renderer, system } = createHarness();
    const savedRenderTarget = { name: 'application-target' };
    (renderer.getRenderTarget as any).mockReturnValue(savedRenderTarget);
    (renderer.getClearAlpha as any).mockReturnValue(0.25);
    (renderer.getClearColor as any).mockImplementation((color: any) =>
      color.set(0x123456),
    );
    renderCallback.mockImplementation(() => {
      throw new Error('render callback failed');
    });
    (system as any).queries = {
      activeLayers: { entities: new Set([entity]) },
    };

    expect(() => (system as any).renderLayers()).toThrow(
      'render callback failed',
    );

    const restoredColor = renderer.setClearColor.mock.calls.at(-1)?.[0] as any;
    expect(restoredColor.getHex()).toBe(0x123456);
    expect(renderer.setClearColor).toHaveBeenLastCalledWith(
      restoredColor,
      0.25,
    );
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(
      savedRenderTarget,
    );
  });

  it('restores renderer state when native sub-image acquisition throws', () => {
    const {
      binding,
      entity,
      nativeLayer,
      projectionLayer,
      renderer,
      session,
      system,
    } = createHarness();
    const savedRenderTarget = { name: 'application-target' };
    (renderer.getRenderTarget as any).mockReturnValue(savedRenderTarget);
    (renderer.getClearAlpha as any).mockReturnValue(0.75);
    (renderer.getClearColor as any).mockImplementation((color: any) =>
      color.set(0xabcdef),
    );
    entity.setValue(XRLayerState, 'xrLayer', nativeLayer);
    session.renderState.layers = [projectionLayer, nativeLayer];
    binding.getSubImage.mockImplementation(() => {
      throw new Error('sub-image failed');
    });
    (system as any).sessionUsesLayers = true;
    (system as any).queries = {
      activeLayers: { entities: new Set([entity]) },
    };

    expect(() => (system as any).renderLayers()).toThrow('sub-image failed');

    const restoredColor = renderer.setClearColor.mock.calls.at(-1)?.[0] as any;
    expect(restoredColor.getHex()).toBe(0xabcdef);
    expect(renderer.setClearColor).toHaveBeenLastCalledWith(
      restoredColor,
      0.75,
    );
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(
      savedRenderTarget,
    );
  });

  it('keeps multisampled layer targets valid when XR supplies their textures', () => {
    const { system } = createHarness();

    for (const stencil of [false, true]) {
      const renderTarget = (system as any).createRenderTarget(64, 32, stencil);
      expect(renderTarget.samples).toBe(4);
      expect(renderTarget.resolveDepthBuffer).toBe(false);
      renderTarget.dispose();
    }
  });

  it('destroys active native and fallback resources with the system', () => {
    const { entity, fallbackMaterial, mesh, nativeLayer, system } =
      createHarness();
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
    const materialDispose = vi.spyOn(fallbackMaterial, 'dispose');
    const renderTarget = XRLayerState.data.renderTarget[entity.index] as {
      dispose: ReturnType<typeof vi.fn>;
    };
    entity.setValue(XRLayerState, 'xrLayer', nativeLayer);
    (system as any).sessionUsesLayers = true;
    const unsubscribe = vi.fn();
    (system as any).queries = {
      activeLayers: { entities: new Set([entity]) },
      cylinderLayers: { subscribe: vi.fn(() => unsubscribe) },
      quadLayers: { subscribe: vi.fn(() => unsubscribe) },
    };
    system.init();

    system.destroy();

    expect(nativeLayer.destroy).toHaveBeenCalledTimes(1);
    expect(renderTarget.dispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(entity.hasComponent(XRLayerState)).toBe(false);
  });

  it('releases resources without mutating an entity during destroy disqualification', () => {
    const entityWorld = new World();
    entityWorld.registerComponent(XRQuadLayer);
    entityWorld.registerComponent(XRCylinderLayer);
    entityWorld.registerComponent(XRLayerState);

    const nativeLayer = { destroy: vi.fn() };
    const projectionLayer = {};
    const session = {
      renderState: { layers: [projectionLayer] as unknown[] },
      updateRenderState: vi.fn(),
    };
    const binding = {
      createQuadLayer: vi.fn(() => nativeLayer),
    };
    const xr = {
      addEventListener: vi.fn(),
      getBinding: vi.fn(() => binding),
      getFrame: vi.fn(() => ({})),
      getReferenceSpace: vi.fn(() => ({})),
      getSession: vi.fn(() => session),
      removeEventListener: vi.fn(),
      enabled: true,
    };
    Object.assign(entityWorld, {
      camera: new PerspectiveCamera(),
      input: {},
      player: new Object3D(),
      playerEntity: {},
      playerHeadEntity: {},
      renderer: { xr },
      scene: new Scene(),
      session: undefined,
      visibilityState: signal('non-immersive'),
    });
    (entityWorld as any).registerSystem(XRLayerSystem);
    const system = (entityWorld as any).getSystem(
      XRLayerSystem,
    ) as XRLayerSystem;
    (system as any).sessionUsesLayers = true;

    const entity = entityWorld.createEntity() as Entity;
    entity.object3D = new Object3D();
    entity.addComponent(XRQuadLayer, {
      height: 1,
      renderCallback: vi.fn(),
      width: 1,
    });

    const mesh = XRLayerState.data.mesh[entity.index] as Mesh;
    const fallbackMaterial = XRLayerState.data.fallbackMaterial[
      entity.index
    ] as MeshBasicMaterial;
    const renderTarget = XRLayerState.data.renderTarget[entity.index] as {
      dispose: () => void;
    };
    const punchMaterial = mesh.material as MeshBasicMaterial;
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
    const fallbackDispose = vi.spyOn(fallbackMaterial, 'dispose');
    const punchDispose = vi.spyOn(punchMaterial, 'dispose');
    const renderTargetDispose = vi.spyOn(renderTarget, 'dispose');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    entity.destroy();
    system.destroy();

    expect(warn).not.toHaveBeenCalled();
    expect(nativeLayer.destroy).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(fallbackDispose).toHaveBeenCalledTimes(1);
    expect(punchDispose).toHaveBeenCalledTimes(1);
    expect(renderTargetDispose).toHaveBeenCalledTimes(1);
    expect(entity.hasComponent(XRLayerState)).toBe(false);
  });

  it('orients fallback content the way the compositor presents it', () => {
    const entityWorld = new World();
    entityWorld.registerComponent(XRQuadLayer);
    entityWorld.registerComponent(XRCylinderLayer);
    entityWorld.registerComponent(XRLayerState);
    const xr = {
      addEventListener: vi.fn(),
      getBinding: vi.fn(() => null),
      getFrame: vi.fn(() => null),
      getReferenceSpace: vi.fn(() => null),
      getSession: vi.fn(() => null),
      removeEventListener: vi.fn(),
      enabled: false,
    };
    Object.assign(entityWorld, {
      camera: new PerspectiveCamera(),
      input: {},
      player: new Object3D(),
      playerEntity: {},
      playerHeadEntity: {},
      renderer: { xr },
      scene: new Scene(),
      session: undefined,
      visibilityState: signal('non-immersive'),
    });
    (entityWorld as any).registerSystem(XRLayerSystem);
    const system = (entityWorld as any).getSystem(
      XRLayerSystem,
    ) as XRLayerSystem;

    const quad = entityWorld.createEntity() as Entity;
    quad.object3D = new Object3D();
    quad.addComponent(XRQuadLayer, { renderCallback: vi.fn() });
    const cylinder = entityWorld.createEntity() as Entity;
    cylinder.object3D = new Object3D();
    cylinder.addComponent(XRCylinderLayer, { renderCallback: vi.fn() });
    const fallbackMap = (entity: Entity) =>
      (XRLayerState.data.fallbackMaterial[entity.index] as MeshBasicMaterial)
        .map!;

    // Layer content uses WebGL's bottom-left origin, as the compositor does.
    expect(fallbackMap(quad).offset.toArray()).toEqual([0, 0]);
    expect(fallbackMap(quad).repeat.toArray()).toEqual([1, 1]);
    // Seen from inside, CylinderGeometry's u runs right to left.
    expect(fallbackMap(cylinder).offset.toArray()).toEqual([1, 0]);
    expect(fallbackMap(cylinder).repeat.toArray()).toEqual([-1, 1]);

    quad.destroy();
    cylinder.destroy();
    system.destroy();
  });
});
