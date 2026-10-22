/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { sha256Bytes } from '@iwsdk/scene-composition';
import type {
  JsonObject,
  SceneEnvironment,
  SceneNodeFramingRole,
  SceneNodeContent,
  SceneResources,
  SceneMaterialTextures,
  Sha256,
} from '@iwsdk/scene-composition';
import type { World } from '../ecs/world.js';
import {
  ACESFilmicToneMapping,
  BasicShadowMap,
  BackSide,
  Box3,
  CineonToneMapping,
  DoubleSide,
  FrontSide,
  LinearToneMapping,
  NoToneMapping,
  Object3D,
  PCFShadowMap,
  PCFSoftShadowMap,
  Quaternion,
  ReinhardToneMapping,
  Vector3,
} from '../runtime/index.js';

/**
 * Hierarchy node returned by get_scene_hierarchy
 */
export interface HierarchyNode {
  name: string;
  uuid: string;
  objectType?: string;
  sceneNodeId?: string;
  sourceNodeId?: string;
  runtimeHash?: Sha256;
  contentType?: SceneNodeContent['type'];
  content?: SceneNodeContent;
  framingRole?: SceneNodeFramingRole;
  metadata?: JsonObject;
  assetId?: string;
  resourceRefs?: HierarchyResourceRefs;
  instanceIds?: string[];
  truncatedInstances?: number;
  resources?: SceneResources;
  environment?: SceneEnvironment;
  documentMetadata?: JsonObject;
  entityIndex?: number;
  children?: HierarchyNode[];
  /** Present when children were truncated due to breadth limit. */
  truncatedChildren?: number;
}

export interface HierarchyResourceRefs {
  assetId?: string;
  prefabId?: string;
}

/**
 * Transform data returned by get_object_transform
 */
export interface ObjectTransform {
  localPosition: [number, number, number];
  localQuaternion: [number, number, number, number];
  localScale: [number, number, number];
  globalPosition: [number, number, number];
  globalQuaternion: [number, number, number, number];
  globalScale: [number, number, number];
  positionRelativeToXROrigin: [number, number, number] | null;
}

export interface RuntimeRenderStats {
  available: true;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  meshCount: number;
  materialCount: number;
  shadowCasters: number;
  worldBounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  } | null;
  /** Bounds of framing-role content geometry; support geometry is excluded. */
  framingBounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  } | null;
  environment: {
    canvas: { width: number; height: number };
    pixelRatio: number;
    renderer: string;
    shadows: boolean;
    toneMapping: number;
  };
  sceneAssets: RuntimeSceneAssetState[];
  sceneEnvironment: RuntimeSceneEnvironmentState;
  sceneLights: RuntimeSceneLightState[];
  sceneMaterials: RuntimeSceneMaterialState[];
}

export interface RuntimeSceneAssetState {
  id: string;
  meshCount: number;
}

export interface RuntimeSceneEnvironmentState {
  background:
    | { color: string; type: 'color' }
    | {
        bottomColor: string;
        exponent: number;
        topColor: string;
        type: 'gradient';
      }
    | {
        type: 'dome-gradient';
        sky: number[];
        equator: number[];
        ground: number[];
        intensity: number;
        elevationDeg: number;
        azimuthDeg: number;
        dither: boolean;
      }
    | {
        type: 'dome-texture';
        src: string;
        intensity: number;
        blurriness: number;
        rotation: number[];
      }
    | { type: 'transparent' }
    | null;
  clearAlpha: number;
  exposure: number;
  fog:
    | { color: string; far: number; near: number; type: 'linear' }
    | { color: string; density: number; type: 'exponential' }
    | null;
  shadows: boolean;
  shadowMapType: NonNullable<SceneEnvironment['shadowMapType']> | 'unknown';
  imageBasedLighting:
    | {
        intensity: number;
        sigma: number;
        texture: boolean;
        type: 'room';
      }
    | {
        type: 'ibl-gradient';
        sky: number[];
        equator: number[];
        ground: number[];
        intensity: number;
      }
    | {
        type: 'ibl-texture';
        src: string;
        intensity: number;
        rotation: number[];
      }
    | null;
  toneMapping: NonNullable<SceneEnvironment['toneMapping']> | 'unknown';
}

export interface RuntimeSceneLightState {
  angleDeg?: number;
  castShadow: boolean;
  color?: string;
  decay?: number;
  distance?: number;
  groundColor?: string;
  intensity: number;
  nodeId: string;
  penumbra?: number;
  skyColor?: string;
  sourceNodeId?: string;
  type: string;
  width?: number;
  height?: number;
  shadow?: Record<string, unknown>;
}

export interface RuntimeSceneProceduralTextureState {
  algorithm: string;
  channel: string;
  dataHash: string;
  height: number;
  recipeHash: string;
  width: number;
}

export interface RuntimeSceneMaterialState {
  baseColor: string;
  emissive?: string;
  emissiveIntensity?: number;
  flatShading?: boolean;
  id: string;
  metalness?: number;
  model: 'basic' | 'standard' | 'physical' | 'unknown';
  opacity: number;
  roughness?: number;
  side: 'front' | 'back' | 'double' | 'unknown';
  textures?: Partial<
    Record<keyof SceneMaterialTextures, RuntimeSceneProceduralTextureState>
  >;
  clearcoat?: number;
  clearcoatRoughness?: number;
  ior?: number;
  envMapIntensity?: number;
  sheen?: number;
  sheenColor?: string;
  sheenRoughness?: number;
  transmission?: number;
  thickness?: number;
  attenuationColor?: string;
  attenuationDistance?: number | 'infinity';
  specularIntensity?: number;
  specularColor?: string;
  anisotropy?: number;
  anisotropyRotationDeg?: number;
}

interface GetSceneHierarchyParams {
  parentId?: string;
  maxDepth?: number;
  maxChildren?: number;
}

interface GetObjectTransformParams {
  nodeId?: string;
  uuid?: string;
}

/** Default maximum number of children per node before truncation. */
const DEFAULT_MAX_CHILDREN = 50;

/** Read raw renderer counters and scene resource counts without applying a profile. */
export function getRenderStats(world: World): RuntimeRenderStats {
  const geometries = new Set<unknown>();
  const materials = new Set<unknown>();
  const sceneAssets: RuntimeSceneAssetState[] = [];
  const sceneLights: RuntimeSceneLightState[] = [];
  const sceneMaterials: RuntimeSceneMaterialState[] = [];
  let meshCount = 0;
  let shadowCasters = 0;
  world.scene.traverse((object) => {
    const assetId = object.userData?.iwsdkSceneAssetId;
    if (typeof assetId === 'string') {
      let assetMeshCount = 0;
      object.traverse((descendant) => {
        if ((descendant as Object3D & { isMesh?: boolean }).isMesh === true) {
          assetMeshCount += 1;
        }
      });
      sceneAssets.push({
        id: assetId,
        meshCount: assetMeshCount,
      });
    }
    const lightState = inspectSceneLight(object);
    if (lightState != null) {
      sceneLights.push(lightState);
    }
    const renderable = object as Object3D & {
      castShadow?: boolean;
      geometry?: unknown;
      isMesh?: boolean;
      material?: unknown | unknown[];
    };
    if (renderable.isMesh !== true) {
      return;
    }
    meshCount += 1;
    if (renderable.castShadow === true) {
      shadowCasters += 1;
    }
    if (renderable.geometry != null) {
      geometries.add(renderable.geometry);
    }
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    objectMaterials.forEach((material) => {
      if (material != null) {
        const firstUse = !materials.has(material);
        materials.add(material);
        if (firstUse) {
          const materialState = inspectSceneMaterial(material);
          if (materialState != null) {
            sceneMaterials.push(materialState);
          }
        }
      }
    });
  });

  world.scene.updateMatrixWorld(true);
  const activeRoot = world.getActiveRoot();
  const worldBounds = serializeRuntimeBounds(measureWorldBounds(activeRoot));
  const framingBounds = serializeRuntimeBounds(
    measureFramingBounds(activeRoot),
  );
  const info = world.renderer.info;
  return {
    available: true,
    calls: info.render.calls,
    triangles: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
    meshCount,
    materialCount: materials.size,
    shadowCasters,
    framingBounds,
    worldBounds,
    environment: {
      canvas: {
        width: world.renderer.domElement.width,
        height: world.renderer.domElement.height,
      },
      pixelRatio: world.renderer.getPixelRatio(),
      renderer: world.renderer.constructor.name,
      shadows: world.renderer.shadowMap.enabled,
      toneMapping: world.renderer.toneMapping,
    },
    sceneAssets: sceneAssets.sort(compareRuntimeState),
    sceneEnvironment: inspectSceneEnvironment(world),
    sceneLights: sceneLights.sort(compareRuntimeState),
    sceneMaterials: sceneMaterials.sort(compareRuntimeState),
  };
}

interface RuntimeBoundsGeometry {
  boundingBox: Box3 | null;
  computeBoundingBox?: () => void;
}

interface RuntimeBoundsObject extends Object3D {
  boundingBox?: Box3 | null;
  computeBoundingBox?: () => void;
  geometry?: RuntimeBoundsGeometry;
  isBatchedMesh?: boolean;
  isInstancedMesh?: boolean;
  isSkinnedMesh?: boolean;
}

/**
 * Raw bounds of every object under `root`, hidden ones included. Not
 * Box3.setFromObject: it copies any object-level `boundingBox`, and on UIKit
 * content components (Lucide icons) that is a signal, not a Box3.
 */
function measureWorldBounds(root: Object3D): Box3 {
  const bounds = new Box3().makeEmpty();
  root.traverse((object) => {
    expandByOwnGeometry(bounds, object as RuntimeBoundsObject);
  });
  return bounds;
}

function measureFramingBounds(root: Object3D): Box3 {
  const bounds = new Box3().makeEmpty();
  root.traverseVisible((object) => {
    if (object.userData?.iwsdkSceneFramingRole === 'support') {
      return;
    }
    expandByOwnGeometry(bounds, object as RuntimeBoundsObject);
  });
  return bounds;
}

function expandByOwnGeometry(bounds: Box3, object: RuntimeBoundsObject): void {
  const geometry = object.geometry;
  if (geometry == null) {
    return;
  }
  let localBounds: Box3 | null | undefined;
  // Instanced, batched and skinned meshes carry bounds covering what they
  // draw. (UIKit icons have a `boundingBox` too, but it is a signal.)
  if (
    object.isInstancedMesh === true ||
    object.isBatchedMesh === true ||
    object.isSkinnedMesh === true
  ) {
    object.computeBoundingBox?.();
    localBounds = object.boundingBox;
  } else {
    geometry.computeBoundingBox?.();
    localBounds = geometry.boundingBox;
  }
  if (localBounds == null || localBounds.isEmpty()) {
    return;
  }
  bounds.union(localBounds.clone().applyMatrix4(object.matrixWorld));
}

function serializeRuntimeBounds(
  bounds: Box3,
): RuntimeRenderStats['worldBounds'] {
  if (bounds.isEmpty()) {
    return null;
  }
  return {
    min: bounds.min.toArray() as [number, number, number],
    max: bounds.max.toArray() as [number, number, number],
    size: bounds.getSize(new Vector3()).toArray() as [number, number, number],
  };
}

interface RuntimeColorLike {
  getHexString?: () => string;
}

interface RuntimeMaterialLike {
  alphaMap?: RuntimeTextureLike;
  anisotropy?: number;
  anisotropyRotation?: number;
  aoMap?: RuntimeTextureLike;
  attenuationColor?: RuntimeColorLike;
  attenuationDistance?: number;
  bumpMap?: RuntimeTextureLike;
  clearcoat?: number;
  clearcoatRoughness?: number;
  color?: RuntimeColorLike;
  emissive?: RuntimeColorLike;
  emissiveMap?: RuntimeTextureLike;
  emissiveIntensity?: number;
  envMapIntensity?: number;
  flatShading?: boolean;
  isMeshBasicMaterial?: boolean;
  isMeshPhysicalMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
  ior?: number;
  map?: RuntimeTextureLike;
  metalness?: number;
  metalnessMap?: RuntimeTextureLike;
  normalMap?: RuntimeTextureLike;
  opacity?: number;
  roughness?: number;
  roughnessMap?: RuntimeTextureLike;
  sheen?: number;
  sheenColor?: RuntimeColorLike;
  sheenRoughness?: number;
  side?: number;
  specularColor?: RuntimeColorLike;
  specularIntensity?: number;
  thickness?: number;
  transmission?: number;
  userData?: Record<string, unknown>;
}

interface RuntimeTextureLike {
  image?: { data?: Uint8Array; height?: number; width?: number };
  userData?: Record<string, unknown>;
}

function inspectSceneMaterial(
  value: unknown,
): RuntimeSceneMaterialState | null {
  const material = value as RuntimeMaterialLike;
  const id = material.userData?.iwsdkSceneMaterialId;
  if (typeof id !== 'string') {
    return null;
  }
  const model = material.isMeshPhysicalMaterial
    ? 'physical'
    : material.isMeshStandardMaterial
      ? 'standard'
      : material.isMeshBasicMaterial
        ? 'basic'
        : 'unknown';
  const textures = inspectMaterialTextures(material);
  return {
    baseColor: colorToHex(material.color) ?? '#000000',
    ...(model === 'standard' || model === 'physical'
      ? {
          emissive: colorToHex(material.emissive) ?? '#000000',
          emissiveIntensity: finiteNumber(material.emissiveIntensity, 1),
          flatShading: material.flatShading === true,
          metalness: finiteNumber(material.metalness, 0),
          roughness: finiteNumber(material.roughness, 0),
        }
      : {}),
    ...(model === 'physical'
      ? {
          anisotropy: finiteNumber(material.anisotropy, 0),
          anisotropyRotationDeg:
            (finiteNumber(material.anisotropyRotation, 0) * 180) / Math.PI,
          attenuationColor: colorToHex(material.attenuationColor) ?? '#ffffff',
          attenuationDistance:
            material.attenuationDistance === Infinity
              ? ('infinity' as const)
              : finiteNumber(material.attenuationDistance, 0),
          clearcoat: finiteNumber(material.clearcoat, 0),
          clearcoatRoughness: finiteNumber(material.clearcoatRoughness, 0),
          envMapIntensity: finiteNumber(material.envMapIntensity, 1),
          ior: finiteNumber(material.ior, 1.5),
          sheen: finiteNumber(material.sheen, 0),
          sheenColor: colorToHex(material.sheenColor) ?? '#000000',
          sheenRoughness: finiteNumber(material.sheenRoughness, 1),
          specularColor: colorToHex(material.specularColor) ?? '#ffffff',
          specularIntensity: finiteNumber(material.specularIntensity, 1),
          thickness: finiteNumber(material.thickness, 0),
          transmission: finiteNumber(material.transmission, 0),
        }
      : {}),
    id,
    model,
    opacity: finiteNumber(material.opacity, 1),
    side: materialSideName(material.side),
    ...(Object.keys(textures).length === 0 ? {} : { textures }),
  };
}

function inspectMaterialTextures(
  material: RuntimeMaterialLike,
): Partial<
  Record<keyof SceneMaterialTextures, RuntimeSceneProceduralTextureState>
> {
  const result: Partial<
    Record<keyof SceneMaterialTextures, RuntimeSceneProceduralTextureState>
  > = {};
  const mappings: [
    keyof SceneMaterialTextures,
    RuntimeTextureLike | undefined,
  ][] = [
    ['albedo', material.map],
    ['emissive', material.emissiveMap],
    ['roughness', material.roughnessMap],
    ['metalness', material.metalnessMap],
    ['ambientOcclusion', material.aoMap],
    ['alpha', material.alphaMap],
    ['normal', material.normalMap],
    ['bump', material.bumpMap],
  ];
  for (const [channel, texture] of mappings) {
    const metadata = texture?.userData?.iwsdkSceneProceduralTexture;
    const data = texture?.image?.data;
    if (
      metadata == null ||
      typeof metadata !== 'object' ||
      data == null ||
      !(data instanceof Uint8Array)
    ) {
      continue;
    }
    const values = metadata as Record<string, unknown>;
    result[channel] = {
      algorithm: String(values.algorithm ?? ''),
      channel,
      dataHash: sha256Bytes(data),
      height: finiteNumber(texture?.image?.height, 0),
      recipeHash: String(values.recipeHash ?? ''),
      width: finiteNumber(texture?.image?.width, 0),
    };
  }
  return result;
}

function inspectSceneLight(object: Object3D): RuntimeSceneLightState | null {
  const light = object as Object3D & {
    angle?: number;
    castShadow?: boolean;
    color?: RuntimeColorLike;
    decay?: number;
    distance?: number;
    groundColor?: RuntimeColorLike;
    intensity?: number;
    isLight?: boolean;
    penumbra?: number;
    target?: { position?: { toArray?: () => number[] } };
    width?: number;
    height?: number;
    shadow?: {
      bias?: number;
      blurSamples?: number;
      camera?: Record<string, unknown>;
      mapSize?: { toArray?: () => number[] };
      normalBias?: number;
      radius?: number;
    };
  };
  const nodeId = light.userData?.iwsdkSceneNodeId;
  if (light.isLight !== true || typeof nodeId !== 'string') {
    return null;
  }
  const type = lightTypeName(light.type);
  const sourceNodeId = light.userData?.iwsdkSceneSourceNodeId;
  const color = colorToHex(light.color);
  const groundColor = colorToHex(light.groundColor);
  return {
    ...(type === 'spot' && typeof light.angle === 'number'
      ? { angleDeg: (light.angle * 180) / Math.PI }
      : {}),
    castShadow: light.castShadow === true,
    ...(color != null
      ? type === 'hemisphere'
        ? { skyColor: color }
        : { color }
      : {}),
    ...((type === 'point' || type === 'spot') && typeof light.decay === 'number'
      ? { decay: light.decay }
      : {}),
    ...((type === 'point' || type === 'spot') &&
    typeof light.distance === 'number'
      ? { distance: light.distance }
      : {}),
    ...(type === 'hemisphere' && groundColor != null ? { groundColor } : {}),
    ...(type === 'rect-area' && typeof light.width === 'number'
      ? { width: light.width }
      : {}),
    ...(type === 'rect-area' && typeof light.height === 'number'
      ? { height: light.height }
      : {}),
    intensity: finiteNumber(light.intensity, 1),
    nodeId,
    ...(type === 'spot' && typeof light.penumbra === 'number'
      ? { penumbra: light.penumbra }
      : {}),
    ...(typeof sourceNodeId === 'string' ? { sourceNodeId } : {}),
    ...(light.castShadow === true && light.shadow != null
      ? { shadow: inspectSceneShadow(light.shadow, type) }
      : {}),
    type,
  };
}

function inspectSceneShadow(
  shadow: NonNullable<
    (Object3D & { shadow?: Record<string, unknown> })['shadow']
  >,
  lightType: string,
): Record<string, unknown> {
  const value = shadow as {
    bias?: number;
    blurSamples?: number;
    camera?: {
      bottom?: number;
      far?: number;
      left?: number;
      near?: number;
      right?: number;
      top?: number;
    };
    mapSize?: { toArray?: () => number[] };
    normalBias?: number;
    radius?: number;
  };
  const mapSize = value.mapSize?.toArray?.();
  return {
    bias: finiteNumber(value.bias, 0),
    ...(value.camera != null
      ? {
          camera: {
            far: finiteNumber(value.camera.far, 0),
            near: finiteNumber(value.camera.near, 0),
            ...(lightType === 'directional'
              ? {
                  bottom: finiteNumber(value.camera.bottom, 0),
                  left: finiteNumber(value.camera.left, 0),
                  right: finiteNumber(value.camera.right, 0),
                  top: finiteNumber(value.camera.top, 0),
                }
              : {}),
          },
        }
      : {}),
    mapSize:
      Array.isArray(mapSize) && mapSize.length >= 2
        ? mapSize.slice(0, 2)
        : [512, 512],
    normalBias: finiteNumber(value.normalBias, 0),
    radius: finiteNumber(value.radius, 1),
  };
}

function inspectSceneEnvironment(world: World): RuntimeSceneEnvironmentState {
  const background = world.scene.background as
    | (RuntimeColorLike & {
        isColor?: boolean;
        isTexture?: boolean;
        userData?: Record<string, unknown>;
      })
    | null;
  const environmentTexture = world.scene.environment as {
    isTexture?: boolean;
    userData?: Record<string, unknown>;
  } | null;
  const gradient = background?.userData?.iwsdkSceneGradientBackground as
    | {
        bottomColor?: unknown;
        exponent?: unknown;
        topColor?: unknown;
        type?: unknown;
      }
    | undefined;
  const domeTexture = background?.userData?.iwsdkSceneDomeTexture as
    | Record<string, unknown>
    | undefined;
  const imageBasedLighting = environmentTexture?.userData
    ?.iwsdkSceneImageBasedLighting as
    | { intensity?: unknown; sigma?: unknown; type?: unknown }
    | undefined;
  const iblGradient = environmentTexture?.userData?.iwsdkSceneIBLGradient as
    | Record<string, unknown>
    | undefined;
  const iblTexture = environmentTexture?.userData?.iwsdkSceneIBLTexture as
    | Record<string, unknown>
    | undefined;
  // EnvironmentSystem adds the gradient dome directly to world.scene.
  const domeGradient = world.scene.children.find(
    (child) => child.visible && child.userData?.iwsdkSceneDomeGradient != null,
  )?.userData.iwsdkSceneDomeGradient as Record<string, unknown> | undefined;
  const fog = world.scene.fog as {
    color?: RuntimeColorLike;
    density?: number;
    far?: number;
    isFog?: boolean;
    isFogExp2?: boolean;
    near?: number;
  } | null;
  return {
    background:
      background?.isColor === true
        ? { color: colorToHex(background) ?? '#000000', type: 'color' }
        : background?.isTexture === true && domeTexture != null
          ? {
              blurriness: finiteNumber(domeTexture.blurriness, 0),
              intensity: finiteNumber(domeTexture.intensity, 1),
              rotation: numberArray(domeTexture.rotation),
              src: String(domeTexture.src ?? ''),
              type: 'dome-texture',
            }
          : background?.isTexture === true && gradient?.type === 'gradient'
            ? {
                bottomColor: normalizeHexColor(gradient.bottomColor),
                exponent: finiteNumber(gradient.exponent, 1),
                topColor: normalizeHexColor(gradient.topColor),
                type: 'gradient',
              }
            : domeGradient != null
              ? {
                  azimuthDeg: finiteNumber(domeGradient.azimuthDeg, 0),
                  dither: domeGradient.dither === true,
                  elevationDeg: finiteNumber(domeGradient.elevationDeg, 90),
                  equator: numberArray(domeGradient.equator),
                  ground: numberArray(domeGradient.ground),
                  intensity: finiteNumber(domeGradient.intensity, 1),
                  sky: numberArray(domeGradient.sky),
                  type: 'dome-gradient',
                }
              : background == null && world.renderer.getClearAlpha() === 0
                ? { type: 'transparent' }
                : null,
    clearAlpha: world.renderer.getClearAlpha(),
    exposure: world.renderer.toneMappingExposure,
    imageBasedLighting:
      imageBasedLighting?.type === 'room'
        ? {
            intensity: world.scene.environmentIntensity,
            sigma: finiteNumber(imageBasedLighting.sigma, 0.04),
            texture: environmentTexture?.isTexture === true,
            type: 'room',
          }
        : iblGradient != null
          ? {
              equator: numberArray(iblGradient.equator),
              ground: numberArray(iblGradient.ground),
              intensity: finiteNumber(iblGradient.intensity, 1),
              sky: numberArray(iblGradient.sky),
              type: 'ibl-gradient',
            }
          : iblTexture != null
            ? {
                intensity: finiteNumber(iblTexture.intensity, 1),
                rotation: numberArray(iblTexture.rotation),
                src: String(iblTexture.src ?? ''),
                type: 'ibl-texture',
              }
            : null,
    fog:
      fog?.isFog === true
        ? {
            color: colorToHex(fog.color) ?? '#000000',
            far: finiteNumber(fog.far, 0),
            near: finiteNumber(fog.near, 0),
            type: 'linear',
          }
        : fog?.isFogExp2 === true
          ? {
              color: colorToHex(fog.color) ?? '#000000',
              density: finiteNumber(fog.density, 0),
              type: 'exponential',
            }
          : null,
    shadows: world.renderer.shadowMap.enabled,
    shadowMapType: shadowMapTypeName(world.renderer.shadowMap.type),
    toneMapping: toneMappingName(world.renderer.toneMapping),
  };
}

function shadowMapTypeName(
  value: number,
): RuntimeSceneEnvironmentState['shadowMapType'] {
  switch (value) {
    case BasicShadowMap:
      return 'basic';
    case PCFShadowMap:
      return 'pcf';
    case PCFSoftShadowMap:
      return 'pcf-soft';
    default:
      return 'unknown';
  }
}

function colorToHex(value: RuntimeColorLike | undefined): string | null {
  const hex = value?.getHexString?.();
  return typeof hex === 'string' && /^[0-9a-f]{6}$/i.test(hex)
    ? `#${hex.toLowerCase()}`
    : null;
}

function normalizeHexColor(value: unknown): string {
  const color = String(value);
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : color;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((entry) => finiteNumber(entry, 0))
    : [];
}

function lightTypeName(type: string): string {
  if (type === 'RectAreaLight') {
    return 'rect-area';
  }
  return type.endsWith('Light')
    ? type.slice(0, -'Light'.length).toLowerCase()
    : type.toLowerCase();
}

function materialSideName(
  side: number | undefined,
): RuntimeSceneMaterialState['side'] {
  switch (side) {
    case FrontSide:
      return 'front';
    case BackSide:
      return 'back';
    case DoubleSide:
      return 'double';
    default:
      return 'unknown';
  }
}

function toneMappingName(
  value: number,
): RuntimeSceneEnvironmentState['toneMapping'] {
  switch (value) {
    case NoToneMapping:
      return 'none';
    case LinearToneMapping:
      return 'linear';
    case ReinhardToneMapping:
      return 'reinhard';
    case CineonToneMapping:
      return 'cineon';
    case ACESFilmicToneMapping:
      return 'aces';
    default:
      return 'unknown';
  }
}

function compareRuntimeState(
  left:
    | RuntimeSceneAssetState
    | RuntimeSceneLightState
    | RuntimeSceneMaterialState,
  right:
    | RuntimeSceneAssetState
    | RuntimeSceneLightState
    | RuntimeSceneMaterialState,
): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

/**
 * Get the Three.js scene hierarchy as a JSON tree.
 * Returns object identity, native scene render metadata, and entity indices.
 */
export function getSceneHierarchy(
  world: World,
  params: Record<string, unknown>,
): HierarchyNode {
  const {
    parentId,
    maxDepth = 5,
    maxChildren = DEFAULT_MAX_CHILDREN,
  } = params as unknown as GetSceneHierarchyParams;

  let root: Object3D | undefined;

  if (parentId) {
    root = world.scene.getObjectByProperty('uuid', parentId);
    if (!root) {
      throw new Error(
        `Object not found with UUID '${parentId}'. Use get_scene_hierarchy without parentId to see all available objects.`,
      );
    }
  } else {
    root = world.scene;
  }

  return buildHierarchy(root, 0, maxDepth, maxChildren);
}

function buildHierarchy(
  obj: Object3D,
  depth: number,
  maxDepth: number,
  maxChildren: number,
): HierarchyNode {
  const node: HierarchyNode = {
    name: obj.name || '(unnamed)',
    uuid: obj.uuid,
  };
  if (typeof obj.type === 'string' && obj.type.length > 0) {
    node.objectType = obj.type;
  }
  if (typeof obj.userData?.iwsdkSceneNodeId === 'string') {
    node.sceneNodeId = obj.userData.iwsdkSceneNodeId;
  }
  if (typeof obj.userData?.iwsdkSceneSourceNodeId === 'string') {
    node.sourceNodeId = obj.userData.iwsdkSceneSourceNodeId;
  }
  const runtimeHash = cloneRuntimeHash(obj.userData?.iwsdkSceneRuntimeHash);
  if (runtimeHash != null) {
    node.runtimeHash = runtimeHash;
  }
  const content = cloneSceneContent(obj.userData?.iwsdkSceneContent);
  if (content != null) {
    node.contentType = content.type;
    node.content = content;
  }
  const framingRole = obj.userData?.iwsdkSceneFramingRole;
  if (framingRole === 'content' || framingRole === 'support') {
    node.framingRole = framingRole;
  }
  const metadata = cloneJsonObject(obj.userData?.iwsdkSceneMetadata);
  if (metadata != null) {
    node.metadata = metadata;
  }
  const resourceRefs = getResourceRefs(content);
  const userDataAssetId = obj.userData?.iwsdkSceneAssetId;
  if (typeof userDataAssetId === 'string') {
    resourceRefs.assetId = userDataAssetId;
  }
  if (Object.keys(resourceRefs).length > 0) {
    node.resourceRefs = resourceRefs;
    node.assetId = resourceRefs.assetId;
  }
  const instanceIds = cloneStringArray(obj.userData?.iwsdkSceneInstanceIds);
  if (instanceIds != null) {
    const limit = Math.max(1, maxChildren);
    node.instanceIds = instanceIds.slice(0, limit);
    if (instanceIds.length > limit) {
      node.truncatedInstances = instanceIds.length - limit;
    }
  }
  const resources = cloneJsonObjectAs<SceneResources>(
    obj.userData?.iwsdkSceneResources,
  );
  if (resources != null) {
    node.resources = resources;
  }
  const environment = cloneJsonObjectAs<SceneEnvironment>(
    obj.userData?.iwsdkSceneEnvironment,
  );
  if (environment != null) {
    node.environment = environment;
  }
  const documentMetadata = cloneJsonObject(
    obj.userData?.iwsdkSceneDocumentMetadata,
  );
  if (documentMetadata != null) {
    node.documentMetadata = documentMetadata;
  }

  // Check if Object3D has associated entity (entityIdx is set by Transform component)
  if ('entityIdx' in obj && typeof (obj as any).entityIdx === 'number') {
    node.entityIndex = (obj as any).entityIdx;
  }

  if (depth < maxDepth && obj.children.length > 0) {
    const total = obj.children.length;
    const limit = Math.max(1, maxChildren);
    const childrenToInclude = obj.children.slice(0, limit);
    node.children = childrenToInclude.map((child) =>
      buildHierarchy(child, depth + 1, maxDepth, maxChildren),
    );
    if (total > limit) {
      node.truncatedChildren = total - limit;
    }
  }

  return node;
}

function cloneSceneContent(value: unknown): SceneNodeContent | undefined {
  if (!isRecord(value) || !isSceneContentType(value.type)) {
    return undefined;
  }
  return cloneJson(value) as unknown as SceneNodeContent;
}

function isSceneContentType(value: unknown): value is SceneNodeContent['type'] {
  return (
    value === 'group' ||
    value === 'asset' ||
    value === 'instance' ||
    value === 'pattern'
  );
}

function getResourceRefs(
  content: SceneNodeContent | undefined,
): HierarchyResourceRefs {
  switch (content?.type) {
    case 'asset':
      return { assetId: content.asset };
    case 'instance':
    case 'pattern':
      return { prefabId: content.prefab };
    default:
      return {};
  }
}

function cloneRuntimeHash(value: unknown): Sha256 | undefined {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value)
    ? (value as Sha256)
    : undefined;
}

function cloneStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
    ? [...value]
    : undefined;
}

function cloneJsonObject(value: unknown): JsonObject | undefined {
  return cloneJsonObjectAs<JsonObject>(value);
}

function cloneJsonObjectAs<T>(value: unknown): T | undefined {
  return isRecord(value) ? (cloneJson(value) as T) : undefined;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Get local and global transforms of an Object3D.
 * Includes positionRelativeToXROrigin which can be used directly with IWER look_at tool.
 */
export function getObjectTransform(
  world: World,
  params: Record<string, unknown>,
): ObjectTransform {
  const { nodeId, uuid } = params as unknown as GetObjectTransformParams;

  if (!uuid && !nodeId) {
    throw new Error(
      'uuid or nodeId parameter is required. Use get_scene_hierarchy for Object3D UUIDs or scene_get_hierarchy for native scene node ids.',
    );
  }

  const obj =
    uuid != null
      ? world.scene.getObjectByProperty('uuid', uuid)
      : findObjectBySceneNodeId(world.scene, nodeId!);
  if (!obj) {
    throw new Error(
      uuid != null
        ? `Object not found with UUID '${uuid}'. Use get_scene_hierarchy to discover available objects.`
        : `Object not found with scene node id '${nodeId}'. Use scene_get_hierarchy to discover native scene node ids.`,
    );
  }

  // Ensure world matrix is up to date
  obj.updateWorldMatrix(true, false);

  // Local transform (direct properties)
  const localPosition = obj.position.toArray() as [number, number, number];
  const localQuaternion = obj.quaternion.toArray() as [
    number,
    number,
    number,
    number,
  ];
  const localScale = obj.scale.toArray() as [number, number, number];

  // Global transform (decompose from world matrix)
  const globalPosition = new Vector3();
  const globalQuaternion = new Quaternion();
  const globalScale = new Vector3();
  obj.matrixWorld.decompose(globalPosition, globalQuaternion, globalScale);

  // Position relative to XR origin
  let positionRelativeToXROrigin: [number, number, number] | null = null;

  if (world.player) {
    // Clone the global position and convert to XR origin local space
    const relativePos = globalPosition.clone();
    world.player.updateWorldMatrix(true, false);
    world.player.worldToLocal(relativePos);
    positionRelativeToXROrigin = relativePos.toArray() as [
      number,
      number,
      number,
    ];
  }

  return {
    localPosition,
    localQuaternion,
    localScale,
    globalPosition: globalPosition.toArray() as [number, number, number],
    globalQuaternion: globalQuaternion.toArray() as [
      number,
      number,
      number,
      number,
    ],
    globalScale: globalScale.toArray() as [number, number, number],
    positionRelativeToXROrigin,
  };
}

function findObjectBySceneNodeId(
  object: Object3D,
  nodeId: string,
): Object3D | undefined {
  if (object.userData?.iwsdkSceneNodeId === nodeId) {
    return object;
  }

  for (const child of object.children) {
    const found = findObjectBySceneNodeId(child, nodeId);
    if (found != null) {
      return found;
    }
  }

  return undefined;
}
