/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import {
  AmbientLight as ThreeAmbientLight,
  Color,
  DirectionalLight as ThreeDirectionalLight,
  HemisphereLight as ThreeHemisphereLight,
  Light,
  Matrix4,
  Object3D,
  PointLight as ThreePointLight,
  Quaternion,
  RectAreaLight as ThreeRectAreaLight,
  SRGBColorSpace,
  SpotLight as ThreeSpotLight,
  Vector3,
} from '../runtime/index.js';

export type LightColor = readonly [number, number, number, number];

export interface LightShadowSpec {
  castShadow: boolean;
  shadowBias: number;
  shadowCameraFar: number;
  shadowCameraNear: number;
  shadowMapSize: number;
  shadowNormalBias: number;
  shadowRadius: number;
}

export type LightSpec =
  | { kind: 'ambient'; color: LightColor; intensity: number }
  | {
      kind: 'hemisphere';
      groundColor: LightColor;
      intensity: number;
      skyColor: LightColor;
    }
  | ({
      kind: 'directional';
      color: LightColor;
      intensity: number;
      shadowCameraSize: number;
    } & LightShadowSpec)
  | ({
      kind: 'point';
      color: LightColor;
      decay: number;
      distance: number;
      intensity: number;
    } & LightShadowSpec)
  | ({
      kind: 'spot';
      angleDeg: number;
      color: LightColor;
      decay: number;
      distance: number;
      intensity: number;
      penumbra: number;
    } & LightShadowSpec)
  | {
      kind: 'rect-area';
      color: LightColor;
      height: number;
      intensity: number;
      width: number;
    };

const LOCAL_FORWARD = new Vector3(0, 0, -1);
const WORLD_UP = new Vector3(0, 1, 0);
const UNIT_SCALE = new Vector3(1, 1, 1);
let rectAreaUniformsInitialized = false;

function initializeRectAreaUniforms(): void {
  if (rectAreaUniformsInitialized) {
    return;
  }
  RectAreaLightUniformsLib.init();
  rectAreaUniformsInitialized = true;
}

function applyColor(target: Color, value: LightColor): void {
  target.setRGB(value[0], value[1], value[2], SRGBColorSpace);
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function createLight(spec: LightSpec): Light {
  switch (spec.kind) {
    case 'ambient':
      return new ThreeAmbientLight();
    case 'hemisphere':
      return new ThreeHemisphereLight();
    case 'directional':
      return new ThreeDirectionalLight();
    case 'point':
      return new ThreePointLight();
    case 'spot':
      return new ThreeSpotLight();
    case 'rect-area':
      initializeRectAreaUniforms();
      return new ThreeRectAreaLight();
  }
}

type ShadowLight = ThreeDirectionalLight | ThreePointLight | ThreeSpotLight;

function applyShadow(light: ShadowLight, spec: LightShadowSpec): void {
  const shadow = light.shadow;
  const mapSizeChanged =
    shadow.mapSize.width !== spec.shadowMapSize ||
    shadow.mapSize.height !== spec.shadowMapSize;
  if (mapSizeChanged && (shadow.map != null || shadow.mapPass != null)) {
    shadow.dispose();
    shadow.map = null;
    shadow.mapPass = null;
  }
  if (light.castShadow && !spec.castShadow) {
    shadow.dispose();
    shadow.map = null;
    shadow.mapPass = null;
  }
  light.castShadow = spec.castShadow;
  shadow.mapSize.set(spec.shadowMapSize, spec.shadowMapSize);
  shadow.bias = spec.shadowBias;
  shadow.normalBias = spec.shadowNormalBias;
  shadow.radius = spec.shadowRadius;
  shadow.camera.near = spec.shadowCameraNear;
  shadow.camera.far = spec.shadowCameraFar;
  shadow.camera.updateProjectionMatrix();
  shadow.needsUpdate = true;
}

/**
 * Owns one Three.js light and keeps runtime and managed-editor materialization identical.
 */
export class LightBinding {
  readonly light: Light;
  /**
   * What a directional or spot light shines at: a child of the light, 1 m down
   * its local -Z. Three.js aims the light, its shadow camera and its helpers at
   * the target's world position, which it re-derives from the light's whenever
   * it updates the scene graph (the first thing `WebGLRenderer.render()` does),
   * so the light keeps pointing along its node's -Z even when a system moves the
   * node after LightSystem has synced it.
   */
  readonly target: Object3D | undefined;

  private readonly desiredWorldMatrix = new Matrix4();
  private readonly inverseParentMatrix = new Matrix4();
  private readonly localMatrix = new Matrix4();
  private readonly worldPosition = new Vector3();
  private readonly worldQuaternion = new Quaternion();
  private disposed = false;
  private specSignature = '';

  /**
   * @param targetRoot - No longer used: the target hangs from the light (see
   *   {@link LightBinding.target}). Kept so existing callers still compile.
   */
  constructor(
    readonly parent: Object3D,
    readonly targetRoot: Object3D,
    spec: LightSpec,
  ) {
    this.light = createLight(spec);
    this.light.name = `${spec.kind}-light`;
    this.light.matrixAutoUpdate = false;
    this.light.userData.iwsdkLightComponent = spec.kind;
    copySceneIdentity(parent, this.light);
    parent.add(this.light);

    if (spec.kind === 'directional' || spec.kind === 'spot') {
      const target = new Object3D();
      target.name = `${spec.kind}-light-target`;
      target.userData.iwsdkLightTarget = true;
      target.userData.iwsdkRuntimeOnly = true;
      copySceneIdentity(parent, target);
      target.position.copy(LOCAL_FORWARD);
      this.light.add(target);
      this.target = target;
      (this.light as ThreeDirectionalLight | ThreeSpotLight).target = target;
    }

    this.update(spec);
    this.syncTransform();
  }

  update(spec: LightSpec): void {
    this.assertActive();
    if (this.light.userData.iwsdkLightComponent !== spec.kind) {
      throw new Error('A LightBinding cannot change light kind');
    }
    const signature = JSON.stringify(spec);
    if (signature === this.specSignature) {
      return;
    }
    this.specSignature = signature;
    switch (spec.kind) {
      case 'ambient': {
        const light = this.light as ThreeAmbientLight;
        applyColor(light.color, spec.color);
        light.intensity = spec.intensity;
        break;
      }
      case 'hemisphere': {
        const light = this.light as ThreeHemisphereLight;
        applyColor(light.color, spec.skyColor);
        applyColor(light.groundColor, spec.groundColor);
        light.intensity = spec.intensity;
        break;
      }
      case 'directional': {
        const light = this.light as ThreeDirectionalLight;
        applyColor(light.color, spec.color);
        light.intensity = spec.intensity;
        applyShadow(light, spec);
        const halfSize = spec.shadowCameraSize / 2;
        light.shadow.camera.left = -halfSize;
        light.shadow.camera.right = halfSize;
        light.shadow.camera.top = halfSize;
        light.shadow.camera.bottom = -halfSize;
        light.shadow.camera.updateProjectionMatrix();
        break;
      }
      case 'point': {
        const light = this.light as ThreePointLight;
        applyColor(light.color, spec.color);
        light.decay = spec.decay;
        light.distance = spec.distance;
        light.intensity = spec.intensity;
        applyShadow(light, spec);
        break;
      }
      case 'spot': {
        const light = this.light as ThreeSpotLight;
        light.angle = degreesToRadians(spec.angleDeg);
        applyColor(light.color, spec.color);
        light.decay = spec.decay;
        light.distance = spec.distance;
        light.intensity = spec.intensity;
        light.penumbra = spec.penumbra;
        applyShadow(light, spec);
        break;
      }
      case 'rect-area': {
        const light = this.light as ThreeRectAreaLight;
        applyColor(light.color, spec.color);
        light.height = spec.height;
        light.intensity = spec.intensity;
        light.width = spec.width;
        break;
      }
    }
  }

  /** Synchronize position and rotation while deliberately removing inherited scale. */
  syncTransform(): void {
    this.assertActive();
    this.parent.updateWorldMatrix(true, false);
    if (this.light.userData.iwsdkLightComponent === 'hemisphere') {
      this.worldPosition.copy(WORLD_UP);
      this.worldQuaternion.identity();
    } else {
      this.parent.getWorldPosition(this.worldPosition);
      this.parent.getWorldQuaternion(this.worldQuaternion);
    }
    this.desiredWorldMatrix.compose(
      this.worldPosition,
      this.worldQuaternion,
      UNIT_SCALE,
    );
    this.inverseParentMatrix.copy(this.parent.matrixWorld).invert();
    this.localMatrix.multiplyMatrices(
      this.inverseParentMatrix,
      this.desiredWorldMatrix,
    );
    this.light.matrix.copy(this.localMatrix);
    this.light.matrixWorld.copy(this.desiredWorldMatrix);

    if (this.target != null) {
      this.target.position.copy(LOCAL_FORWARD);
      if (this.target.parent !== this.light) {
        this.light.add(this.target);
      }
      this.target.updateMatrixWorld(true);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.light.removeFromParent();
    this.target?.removeFromParent();
    this.light.dispose();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Cannot update a disposed LightBinding');
    }
  }
}

function copySceneIdentity(source: Object3D, target: Object3D): void {
  for (const key of [
    'iwsdkSceneDocumentUrl',
    'iwsdkSceneFramingRole',
    'iwsdkSceneNodeId',
    'iwsdkSceneRuntimeHash',
    'iwsdkSceneSourceNodeId',
  ]) {
    if (source.userData[key] !== undefined) {
      target.userData[key] = source.userData[key];
    }
  }
}
