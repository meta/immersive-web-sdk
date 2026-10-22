/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { signal } from '@preact/signals-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../../src/asset/index.js';
import type { Entity } from '../../src/ecs/entity.js';
import { World } from '../../src/ecs/world.js';
import {
  computeGradientHexes,
  EnvironmentSystem,
} from '../../src/environment/environment-system.js';
import {
  DomeGradient,
  DomeTexture,
  IBLGradient,
  IBLTexture,
} from '../../src/environment/index.js';
import { LevelRoot } from '../../src/level/level-root.js';
import {
  Color,
  EventDispatcher,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  Texture,
  WebGLRenderTarget,
} from '../../src/runtime/three.js';
import { Transform } from '../../src/transform/transform.js';

// world.ts -> @iwsdk/xr-input -> cursor-visual.ts touches `document` at module
// load; provide a minimal canvas stub before importing.
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
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface PMREMCall {
  equator: Color;
  ground: Color;
  sky: Color;
}

function createEnvironmentWorld() {
  const world = new World();
  world.camera = new PerspectiveCamera();
  world.scene = new Scene();
  let clearAlpha = 1;
  let session: XRSession | null = null;
  const xr = Object.assign(new EventDispatcher(), {
    getFrame: () => null,
    getReferenceSpace: () => null,
    getSession: () => session,
  });
  world.renderer = {
    getClearAlpha: () => clearAlpha,
    setClearAlpha: (value: number) => {
      clearAlpha = value;
    },
    xr,
  } as any;
  world
    .registerComponent(Transform)
    .registerComponent(LevelRoot)
    .registerComponent(DomeGradient)
    .registerComponent(DomeTexture)
    .registerComponent(IBLGradient)
    .registerComponent(IBLTexture);
  world.sceneEntity = world.createTransformEntity(world.scene);
  const root = world.createTransformEntity(undefined, {
    parent: world.sceneEntity,
  });
  root.addComponent(LevelRoot);
  world.activeLevel = signal(root);

  const pmremCalls: PMREMCall[] = [];
  const fromScene = vi
    .spyOn(PMREMGenerator.prototype, 'fromScene')
    .mockImplementation((scene: Scene) => {
      const material = (scene.children[0] as Mesh).material as ShaderMaterial;
      pmremCalls.push({
        equator: material.uniforms.equatorColor.value.clone(),
        ground: material.uniforms.groundColor.value.clone(),
        sky: material.uniforms.skyColor.value.clone(),
      });
      return new WebGLRenderTarget(1, 1);
    });
  const fromEquirectangular = vi
    .spyOn(PMREMGenerator.prototype, 'fromEquirectangular')
    .mockImplementation(() => new WebGLRenderTarget(1, 1));
  const loadTexture = vi
    .spyOn(AssetManager, 'loadTexture')
    .mockImplementation(async () => new Texture());

  world.registerSystem(EnvironmentSystem);
  const system = world.getSystem(EnvironmentSystem)!;
  return {
    fromEquirectangular,
    fromScene,
    getClearAlpha: () => clearAlpha,
    loadTexture,
    pmremCalls,
    root,
    setSession: (value: XRSession | null) => {
      session = value;
    },
    system,
    update: () => world.update(1 / 60, 0),
    world,
  };
}

function findDome(world: World): Mesh | undefined {
  return world.scene.children.find(
    (child) => child.userData.iwsdkSceneDomeGradient != null,
  ) as Mesh | undefined;
}

function setColor(
  entity: Entity,
  component: typeof DomeGradient | typeof IBLGradient,
  field: 'sky' | 'equator' | 'ground',
  rgb: [number, number, number],
): void {
  const view = entity.getVectorView(component, field) as Float32Array;
  view.set(rgb);
}

/** Uniform colors exactly as the 1.0.x path computed them. */
function legacyColors(
  sky: ArrayLike<number>,
  equator: ArrayLike<number>,
  ground: ArrayLike<number>,
  intensity: number,
) {
  const hexes = computeGradientHexes(new Color(), sky, equator, ground);
  return {
    equator: new Color(hexes.equatorHex).multiplyScalar(intensity),
    ground: new Color(hexes.groundHex).multiplyScalar(intensity),
    sky: new Color(hexes.skyHex).multiplyScalar(intensity),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EnvironmentSystem DomeGradient', () => {
  it('renders the default dome exactly as 1.0.x did', () => {
    const { root, system, update, world } = createEnvironmentWorld();
    root.addComponent(DomeGradient);
    update();

    const dome = findDome(world)!;
    expect(dome).toBeDefined();
    expect(dome.renderOrder).toBe(-1e9);
    expect(dome.frustumCulled).toBe(false);
    const material = dome.material as ShaderMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    const expected = legacyColors(
      root.getVectorView(DomeGradient, 'sky'),
      root.getVectorView(DomeGradient, 'equator'),
      root.getVectorView(DomeGradient, 'ground'),
      1,
    );
    expect(material.uniforms.skyColor.value).toEqual(expected.sky);
    expect(material.uniforms.equatorColor.value).toEqual(expected.equator);
    expect(material.uniforms.groundColor.value).toEqual(expected.ground);
    expect(material.uniforms.gradientAxis.value.toArray()).toEqual([0, 1, 0]);
    expect(material.uniforms.ditherAmount.value).toBe(0);

    const uniforms = system.getDomeGradientUniforms();
    expect(material.uniforms.skyColor).toBe(uniforms.sky);
    expect(material.uniforms.gradientAxis).toBe(uniforms.axis);
    expect(uniforms.active.value).toBe(1);
    expect(root.getValue(DomeGradient, '_needsUpdate')).toBe(false);
  });

  it('applies tilt, dither and intensity to the live uniforms', () => {
    const { root, system, update } = createEnvironmentWorld();
    root.addComponent(DomeGradient, {
      azimuthDeg: -31,
      dither: true,
      elevationDeg: 24,
      intensity: 0.5,
    });
    update();

    const uniforms = system.getDomeGradientUniforms();
    const el = (24 * Math.PI) / 180;
    const az = (-31 * Math.PI) / 180;
    expect(uniforms.axis.value.x).toBeCloseTo(-Math.sin(az) * Math.cos(el), 6);
    expect(uniforms.axis.value.y).toBeCloseTo(Math.sin(el), 6);
    expect(uniforms.axis.value.z).toBeCloseTo(-Math.cos(az) * Math.cos(el), 6);
    expect(uniforms.dither.value).toBe(1);
    expect(uniforms.sky.value).toEqual(
      legacyColors(
        root.getVectorView(DomeGradient, 'sky'),
        root.getVectorView(DomeGradient, 'equator'),
        root.getVectorView(DomeGradient, 'ground'),
        0.5,
      ).sky,
    );

    root.setValue(DomeGradient, 'intensity', 0);
    update();
    for (const color of [
      uniforms.sky.value,
      uniforms.equator.value,
      uniforms.ground.value,
    ]) {
      expect(color.toArray()).toEqual([0, 0, 0]);
    }
  });

  it('applies edits without _needsUpdate and skips unchanged frames', () => {
    const { root, system, update, world } = createEnvironmentWorld();
    root.addComponent(DomeGradient);
    update();
    const uniforms = system.getDomeGradientUniforms();
    const dome = findDome(world)!;

    root.setValue(DomeGradient, 'elevationDeg', 0);
    setColor(root, DomeGradient, 'sky', [1, 0, 0]);
    expect(root.getValue(DomeGradient, '_needsUpdate')).toBe(false);
    update();
    expect(uniforms.axis.value.y).toBeCloseTo(0, 12);
    expect(uniforms.axis.value.z).toBeCloseTo(-1, 12);
    expect(uniforms.sky.value.toArray()).toEqual([1, 0, 0]);
    expect(dome.userData.iwsdkSceneDomeGradient.elevationDeg).toBe(0);
    expect(root.getValue(DomeGradient, '_needsUpdate')).toBe(false);

    const marker = dome.userData.iwsdkSceneDomeGradient;
    const setHex = vi.spyOn(uniforms.sky.value, 'setHex');
    update();
    update();
    expect(setHex).not.toHaveBeenCalled();
    expect(dome.userData.iwsdkSceneDomeGradient).toBe(marker);
    expect(findDome(world)).toBe(dome);

    // The flag is still honoured: it forces a refresh.
    root.setValue(DomeGradient, '_needsUpdate', true);
    update();
    expect(setHex).toHaveBeenCalled();
    expect(root.getValue(DomeGradient, '_needsUpdate')).toBe(false);
  });

  it('writes the marker with the new keys', () => {
    const { root, update, world } = createEnvironmentWorld();
    root.addComponent(DomeGradient, {
      azimuthDeg: 90,
      dither: true,
      elevationDeg: 0,
      intensity: 0.8,
    });
    update();
    const marker = findDome(world)!.userData.iwsdkSceneDomeGradient;
    expect(marker).toMatchObject({
      azimuthDeg: 90,
      dither: true,
      elevationDeg: 0,
      equator: Array.from(root.getVectorView(DomeGradient, 'equator')),
      ground: Array.from(root.getVectorView(DomeGradient, 'ground')),
      sky: Array.from(root.getVectorView(DomeGradient, 'sky')),
    });
    expect(marker.intensity).toBeCloseTo(0.8, 6);
    expect(marker.axis[0]).toBeCloseTo(-1, 12);
    expect(marker.axis[1]).toBeCloseTo(0, 12);
    expect(marker.axis[2]).toBeCloseTo(0, 12);
  });

  it('removes the dome when a DomeTexture wins', async () => {
    const { root, system, update, world } = createEnvironmentWorld();
    root.addComponent(DomeGradient);
    update();
    expect(findDome(world)).toBeDefined();

    const textureRoot = world.createTransformEntity(undefined, {
      parent: world.sceneEntity,
    });
    textureRoot.addComponent(LevelRoot);
    textureRoot.addComponent(DomeTexture, { src: 'sky.png' });
    update();
    await flush();
    expect(findDome(world)).toBeUndefined();
    expect(system.getDomeGradientUniforms().active.value).toBe(0);
    expect(world.scene.background).toBeInstanceOf(Texture);
    expect(
      (world.scene.background as Texture).userData.iwsdkSceneDomeTexture,
    ).toEqual({
      blurriness: 0,
      intensity: 1,
      rotation: [0, 0, 0],
      src: 'sky.png',
    });
  });

  it('clears a DomeTexture background when a DomeGradient wins, and reloads it after', async () => {
    const { loadTexture, root, update, world } = createEnvironmentWorld();
    root.addComponent(DomeTexture, { src: 'sky.png' });
    update();
    await flush();
    expect(world.scene.background).toBeInstanceOf(Texture);
    expect(loadTexture).toHaveBeenCalledTimes(1);

    root.removeComponent(DomeTexture);
    root.addComponent(DomeGradient);
    update();
    expect(world.scene.background).toBeNull();
    expect(findDome(world)).toBeDefined();

    root.removeComponent(DomeGradient);
    root.addComponent(DomeTexture, { src: 'sky.png' });
    update();
    await flush();
    expect(loadTexture).toHaveBeenCalledTimes(2);
    expect(world.scene.background).toBeInstanceOf(Texture);
    expect(findDome(world)).toBeUndefined();
  });

  it('keeps the newest DomeTexture when an older load finishes last', async () => {
    const { loadTexture, root, update, world } = createEnvironmentWorld();
    let finishOldLoad!: (texture: Texture) => void;
    loadTexture.mockImplementationOnce(
      () =>
        new Promise<Texture>((resolve) => {
          finishOldLoad = resolve;
        }),
    );
    root.addComponent(DomeTexture, { src: 'old.png' });
    update();
    root.setValue(DomeTexture, 'src', 'new.png');
    root.setValue(DomeTexture, '_needsUpdate', true);
    update();
    await flush();
    const newest = world.scene.background as Texture;
    expect(newest.userData.iwsdkSceneDomeTexture.src).toBe('new.png');

    finishOldLoad(new Texture());
    await flush();
    update();
    expect(world.scene.background).toBe(newest);
    expect(newest.userData.iwsdkSceneDomeTexture.src).toBe('new.png');
  });

  it('hides the dome during an alpha-blend session and restores it after', () => {
    const { getClearAlpha, root, setSession, system, update, world } =
      createEnvironmentWorld();
    root.addComponent(DomeGradient);
    update();
    const dome = findDome(world)!;
    const uniforms = system.getDomeGradientUniforms();
    expect(uniforms.active.value).toBe(1);

    setSession({ environmentBlendMode: 'alpha-blend' } as XRSession);
    update();
    expect(dome.visible).toBe(false);
    expect(uniforms.active.value).toBe(0);
    expect(getClearAlpha()).toBe(0);

    setSession(null);
    update();
    expect(dome.visible).toBe(true);
    expect(uniforms.active.value).toBe(1);
    expect(getClearAlpha()).toBe(1);
  });

  it('clears the uniforms and dome when the DomeGradient is removed', () => {
    const { root, system, update, world } = createEnvironmentWorld();
    root.addComponent(DomeGradient);
    update();
    root.removeComponent(DomeGradient);
    update();
    expect(findDome(world)).toBeUndefined();
    expect(system.getDomeGradientUniforms().active.value).toBe(0);
  });
});

describe('EnvironmentSystem IBLGradient', () => {
  it('applies intensity once, through environmentIntensity', () => {
    const { pmremCalls, root, update, world } = createEnvironmentWorld();
    world.scene.environmentRotation.set(0.3, 0.2, 0.1);
    root.addComponent(IBLGradient, { intensity: 0.45 });
    update();

    expect(pmremCalls).toHaveLength(1);
    const expected = legacyColors(
      root.getVectorView(IBLGradient, 'sky'),
      root.getVectorView(IBLGradient, 'equator'),
      root.getVectorView(IBLGradient, 'ground'),
      1,
    );
    expect(pmremCalls[0]).toEqual(expected);
    expect(world.scene.environmentIntensity).toBeCloseTo(0.45, 6);
    expect(world.scene.environmentRotation.toArray().slice(0, 3)).toEqual([
      0, 0, 0,
    ]);
    expect(root.getValue(IBLGradient, '_needsUpdate')).toBe(false);
    expect(
      (world.scene.environment as Texture).userData.iwsdkSceneIBLGradient,
    ).toMatchObject({
      equator: Array.from(root.getVectorView(IBLGradient, 'equator')),
      ground: Array.from(root.getVectorView(IBLGradient, 'ground')),
      sky: Array.from(root.getVectorView(IBLGradient, 'sky')),
    });
  });

  it('regenerates the PMREM target only for color changes', () => {
    const { fromScene, root, update, world } = createEnvironmentWorld();
    root.addComponent(IBLGradient);
    update();
    expect(fromScene).toHaveBeenCalledTimes(1);
    const environment = world.scene.environment as Texture;

    update();
    expect(fromScene).toHaveBeenCalledTimes(1);

    root.setValue(IBLGradient, 'intensity', 0.25);
    update();
    expect(fromScene).toHaveBeenCalledTimes(1);
    expect(world.scene.environment).toBe(environment);
    expect(world.scene.environmentIntensity).toBe(0.25);
    expect(environment.userData.iwsdkSceneIBLGradient.intensity).toBe(0.25);

    setColor(root, IBLGradient, 'ground', [0.2, 0.3, 0.4]);
    update();
    expect(fromScene).toHaveBeenCalledTimes(2);
    expect(world.scene.environment).not.toBe(environment);
  });

  it('reloads the same IBLTexture after an IBLGradient replaced it', async () => {
    const { fromScene, loadTexture, root, update, world } =
      createEnvironmentWorld();
    root.addComponent(IBLTexture, {
      intensity: 2,
      rotation: [0, 1, 0],
      src: 'studio.png',
    });
    update();
    await flush();
    expect(loadTexture).toHaveBeenCalledTimes(1);
    expect(world.scene.environmentIntensity).toBe(2);
    expect(
      (world.scene.environment as Texture).userData.iwsdkSceneIBLTexture,
    ).toEqual({ intensity: 2, rotation: [0, 1, 0], src: 'studio.png' });

    root.removeComponent(IBLTexture);
    root.addComponent(IBLGradient);
    update();
    expect(fromScene).toHaveBeenCalledTimes(1);
    expect(world.scene.environmentIntensity).toBe(1);
    expect(world.scene.environmentRotation.y).toBe(0);

    root.removeComponent(IBLGradient);
    root.addComponent(IBLTexture, { src: 'studio.png' });
    update();
    await flush();
    expect(loadTexture).toHaveBeenCalledTimes(2);
    expect(
      (world.scene.environment as Texture).userData.iwsdkSceneIBLGradient,
    ).toBeUndefined();

    // Switching back to the gradient regenerates its target.
    root.removeComponent(IBLTexture);
    root.addComponent(IBLGradient);
    update();
    expect(fromScene).toHaveBeenCalledTimes(2);
  });

  it('drops an IBLTexture load that an IBLGradient replaced while it loaded', async () => {
    const { fromEquirectangular, loadTexture, root, update, world } =
      createEnvironmentWorld();
    let finishLoad!: (texture: Texture) => void;
    loadTexture.mockImplementationOnce(
      () =>
        new Promise<Texture>((resolve) => {
          finishLoad = resolve;
        }),
    );
    root.addComponent(IBLTexture, {
      intensity: 2,
      rotation: [0, 1, 0],
      src: 'studio.png',
    });
    update();
    root.removeComponent(IBLTexture);
    root.addComponent(IBLGradient, { intensity: 0.5 });
    update();
    const gradient = world.scene.environment;
    expect(gradient).toBeInstanceOf(Texture);

    finishLoad(new Texture());
    await flush();
    update();
    expect(fromEquirectangular).not.toHaveBeenCalled();
    expect(world.scene.environment).toBe(gradient);
    expect(world.scene.environmentIntensity).toBe(0.5);
    expect(world.scene.environmentRotation.y).toBe(0);
  });

  it('resets environmentIntensity when the IBL source is removed', () => {
    const { root, update, world } = createEnvironmentWorld();
    root.addComponent(IBLGradient, { intensity: 0.3 });
    update();
    expect(world.scene.environmentIntensity).toBeCloseTo(0.3, 6);

    root.removeComponent(IBLGradient);
    update();
    expect(world.scene.environment).toBeNull();
    expect(world.scene.environmentIntensity).toBe(1);

    // An app-owned environment intensity is left alone.
    world.scene.environmentIntensity = 3;
    update();
    expect(world.scene.environmentIntensity).toBe(3);
  });
});
