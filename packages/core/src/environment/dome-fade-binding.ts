/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Material,
  Vector3,
  Vector4,
  type Mesh,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from '../runtime/index.js';
import { DomeFade } from './dome-fade.js';
import {
  DOME_GRADIENT_FUNCTIONS_GLSL,
  type DomeGradientUniforms,
} from './gradient-environment.js';

/** @internal */
export interface DomeFadeSpec {
  start: number;
  end: number;
}

/** @internal */
export type DomeFadeInactiveReason =
  | 'no-dome-gradient'
  | 'dome-texture-active'
  | 'ar-session'
  | 'no-meshes';

/** @internal State written to the faded node's `userData.iwsdkDomeFade`. */
export interface DomeFadeMarker {
  start: number;
  end: number;
  meshCount: number;
  skippedMaterials: number;
  active: boolean;
  inactiveReason: DomeFadeInactiveReason | null;
}

const DEFAULT_START = 4;
const DEFAULT_END = 10;
const MIN_FADE_WIDTH = 0.001;
const PROGRAM_CACHE_KEY_SUFFIX = '|iwsdk-dome-fade-v1';

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vIwsdkDomeFadeWorld;`;

// Mirrors project_vertex: batching and instancing apply before modelMatrix.
const VERTEX_WORLD_POSITION = /* glsl */ `
{
  vec4 iwsdkFadeWorld = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    iwsdkFadeWorld = batchingMatrix * iwsdkFadeWorld;
  #endif
  #ifdef USE_INSTANCING
    iwsdkFadeWorld = instanceMatrix * iwsdkFadeWorld;
  #endif
  vIwsdkDomeFadeWorld = (modelMatrix * iwsdkFadeWorld).xyz;
}`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec3 iwsdkDomeSky;
uniform vec3 iwsdkDomeEquator;
uniform vec3 iwsdkDomeGround;
uniform vec3 iwsdkDomeAxis;
uniform float iwsdkDomeDither;
uniform float iwsdkDomeActive;
uniform vec4 iwsdkDomeFadeParams;  // start, end, centerX, centerZ
varying vec3 vIwsdkDomeFadeWorld;
${DOME_GRADIENT_FUNCTIONS_GLSL}`;

// Display space, after fog and before premultiplied alpha and dithering. The
// sky is sampled camera-relative, like the translation-free dome.
const FRAGMENT_FADE = /* glsl */ `
{
  float iwsdkFadeT = iwsdkDomeActive * smoothstep(iwsdkDomeFadeParams.x, iwsdkDomeFadeParams.y,
      length(vIwsdkDomeFadeWorld.xz - iwsdkDomeFadeParams.zw));
  gl_FragColor.rgb = mix(gl_FragColor.rgb,
      iwsdkGradientColor(vIwsdkDomeFadeWorld - cameraPosition, iwsdkDomeAxis,
                         iwsdkDomeSky, iwsdkDomeEquator, iwsdkDomeGround),
      iwsdkFadeT);
  gl_FragColor.rgb += iwsdkDomeActive * iwsdkDomeDither * iwsdkDitherNoise();
}`;

/** @internal The injected GLSL, exposed for shader-identifier tests. */
export const DOME_FADE_GLSL = {
  fragmentDeclarations: FRAGMENT_DECLARATIONS,
  fragmentFade: FRAGMENT_FADE,
  vertexDeclarations: VERTEX_DECLARATIONS,
  vertexWorldPosition: VERTEX_WORLD_POSITION,
} as const;

const FADE_PARAMS_UNIFORM = 'uniform vec4 iwsdkDomeFadeParams;';
const VERTEX_COMMON = '#include <common>';
const VERTEX_PROJECT = '#include <project_vertex>';
const FRAGMENT_COMMON = '#include <common>';
const FRAGMENT_FOG = '#include <fog_fragment>';

const warnedMissingAnchors = new Set<string>();
const warnedCloneFailures = new Set<string>();

// Clones are tracked by identity: `Material.copy()` keeps userData, so a copy
// of a clone carries `iwsdkDomeFadeClone` without the fade hook and is a new
// source.
const domeFadeClones = new WeakSet<Material>();
const uncloneableSources = new WeakSet<Material>();

type DomeFadeMaterial = Material & {
  isMeshBasicMaterial?: boolean;
  isMeshLambertMaterial?: boolean;
  isMeshPhongMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
  isMeshToonMaterial?: boolean;
};

/**
 * Every supported material ends its fragment shader with tonemapping,
 * colorspace, fog, premultiplied alpha and dithering, so the fade lands in
 * display space. MeshPhysicalMaterial is a MeshStandardMaterial.
 */
function isSupportedMaterial(material: Material): boolean {
  const candidate = material as DomeFadeMaterial;
  return (
    candidate.isMeshBasicMaterial === true ||
    candidate.isMeshLambertMaterial === true ||
    candidate.isMeshPhongMaterial === true ||
    candidate.isMeshStandardMaterial === true ||
    candidate.isMeshToonMaterial === true
  );
}

/**
 * @internal Inject the fade into a material shader. All four anchors must be
 * present; when a chained hook rewrote one away, the shader is left unpatched
 * and a warning is logged once per material type. A shader a chained hook
 * already faded is left as it is.
 */
export function injectDomeFade(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: DomeGradientUniforms,
  params: { value: Vector4 },
  materialType: string = 'material',
): boolean {
  if (shader.fragmentShader.includes(FADE_PARAMS_UNIFORM)) {
    return false;
  }
  if (
    !shader.vertexShader.includes(VERTEX_COMMON) ||
    !shader.vertexShader.includes(VERTEX_PROJECT) ||
    !shader.fragmentShader.includes(FRAGMENT_COMMON) ||
    !shader.fragmentShader.includes(FRAGMENT_FOG)
  ) {
    if (!warnedMissingAnchors.has(materialType)) {
      warnedMissingAnchors.add(materialType);
      console.warn(
        `[DomeFade] ${materialType} shader is missing a chunk DomeFade patches (another onBeforeCompile rewrote it); it renders without the fade.`,
      );
    }
    return false;
  }
  shader.vertexShader = shader.vertexShader
    .replace(VERTEX_COMMON, `${VERTEX_COMMON}${VERTEX_DECLARATIONS}`)
    .replace(VERTEX_PROJECT, `${VERTEX_PROJECT}${VERTEX_WORLD_POSITION}`);
  shader.fragmentShader = shader.fragmentShader
    .replace(FRAGMENT_COMMON, `${FRAGMENT_COMMON}${FRAGMENT_DECLARATIONS}`)
    .replace(FRAGMENT_FOG, `${FRAGMENT_FOG}${FRAGMENT_FADE}`);
  shader.uniforms.iwsdkDomeSky = uniforms.sky;
  shader.uniforms.iwsdkDomeEquator = uniforms.equator;
  shader.uniforms.iwsdkDomeGround = uniforms.ground;
  shader.uniforms.iwsdkDomeAxis = uniforms.axis;
  shader.uniforms.iwsdkDomeDither = uniforms.dither;
  shader.uniforms.iwsdkDomeActive = uniforms.active;
  shader.uniforms.iwsdkDomeFadeParams = params;
  return true;
}

/**
 * @internal Clone `source` with the fade injected. The source is never
 * mutated; textures stay shared. A hook already on the source runs first, and
 * the program cache key extends the source's own key, so distinct originals
 * keep distinct programs. A hook installed over the fade later adds its own
 * text to the key, as three's default key does.
 */
export function createDomeFadeMaterial(
  source: Material,
  uniforms: DomeGradientUniforms,
  params: { value: Vector4 },
): Material {
  const clone = source.clone();
  clone.name = source.name;
  clone.userData.iwsdkDomeFadeClone = true;
  const sourceHook = source.onBeforeCompile;
  const hasHook = sourceHook !== Material.prototype.onBeforeCompile;
  const fadeHook = function (
    this: Material,
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) {
    if (hasHook) {
      sourceHook.call(this, shader, renderer);
    }
    injectDomeFade(shader, uniforms, params, source.type);
  };
  clone.onBeforeCompile = fadeHook;
  clone.customProgramCacheKey = function (this: Material) {
    const key =
      source.customProgramCacheKey.call(source) + PROGRAM_CACHE_KEY_SUFFIX;
    return this.onBeforeCompile === fadeHook
      ? key
      : key + this.onBeforeCompile.toString();
  };
  domeFadeClones.add(clone);
  return clone;
}

/**
 * @internal Fades one node's meshes into the live DomeGradient sky. Shared by
 * EnvironmentSystem and the editor viewport, like LightBinding.
 *
 * Meshes are found by an identity scan of the node's own content, so content
 * that arrives later, material swaps and re-lowered nodes are picked up on the
 * next {@link DomeFadeBinding.refresh}. Supported materials are swapped for
 * per-binding clones; sources are never mutated or disposed. When a source's
 * owner disposes it (the editor's ghost and review-lens materials), its clone
 * is disposed once no patched mesh shows it.
 */
export class DomeFadeBinding {
  /** start, end, centerX, centerZ. */
  readonly params = { value: new Vector4(DEFAULT_START, DEFAULT_END, 0, 0) };

  private readonly cloneBySource = new Map<Material, Material>();
  private readonly sourceByClone = new Map<Material, Material>();
  private readonly disposedSources = new Set<Material>();
  private readonly everPatched = new Set<Mesh>();
  private currentMeshes = new Set<Mesh>();
  private nextMeshes = new Set<Mesh>();
  private readonly skipped = new Set<Material>();
  private readonly worldPosition = new Vector3();
  private rootNodeId: unknown;
  private warnedEnd = false;
  private disposed = false;
  private readonly onSourceDispose = (event: { target: Material }) => {
    this.disposedSources.add(event.target);
  };

  constructor(
    readonly root: Object3D,
    readonly uniforms: DomeGradientUniforms,
    spec: DomeFadeSpec,
  ) {
    this.update(spec);
    this.refresh();
    this.syncTransform();
  }

  /** Meshes patched in the last refresh. */
  get meshes(): ReadonlySet<Mesh> {
    return this.currentMeshes;
  }

  get meshCount(): number {
    return this.currentMeshes.size;
  }

  /** Distinct unsupported materials seen in the last refresh. */
  get skippedMaterials(): number {
    return this.skipped.size;
  }

  /** Write the fade distances. Never recompiles. */
  update(spec: DomeFadeSpec): void {
    this.assertActive();
    const start = Math.max(
      0,
      Number.isFinite(spec.start) ? spec.start : DEFAULT_START,
    );
    let end = Number.isFinite(spec.end) ? spec.end : DEFAULT_END;
    if (end < start + MIN_FADE_WIDTH) {
      if (!this.warnedEnd) {
        this.warnedEnd = true;
        console.warn(
          `[DomeFade] ${this.describeRoot()}: fade end (${spec.end}) must be greater than fade start (${spec.start}); using ${start + MIN_FADE_WIDTH}.`,
        );
      }
      end = start + MIN_FADE_WIDTH;
    }
    this.params.value.x = start;
    this.params.value.y = end;
  }

  /** Scan the node's own meshes and swap supported materials for clones. */
  refresh(): void {
    this.assertActive();
    this.rootNodeId = this.root.userData.iwsdkSceneNodeId;
    this.nextMeshes.clear();
    this.skipped.clear();
    this.visit(this.root);
    const previous = this.currentMeshes;
    this.currentMeshes = this.nextMeshes;
    this.nextMeshes = previous;
    if (this.disposedSources.size > 0) {
      this.releaseDisposedSources();
    }
  }

  /** Track the node's world X/Z as the fade center. */
  syncTransform(): void {
    this.assertActive();
    this.root.getWorldPosition(this.worldPosition);
    this.params.value.z = this.worldPosition.x;
    this.params.value.w = this.worldPosition.z;
  }

  /** Replace `root.userData.iwsdkDomeFade` when a reported value changed. */
  writeMarker(active: boolean, reason: DomeFadeInactiveReason | null): void {
    this.assertActive();
    const previous = this.root.userData.iwsdkDomeFade as
      | DomeFadeMarker
      | undefined;
    const start = this.params.value.x;
    const end = this.params.value.y;
    const meshCount = this.meshCount;
    const skippedMaterials = this.skippedMaterials;
    if (
      previous != null &&
      previous.start === start &&
      previous.end === end &&
      previous.meshCount === meshCount &&
      previous.skippedMaterials === skippedMaterials &&
      previous.active === active &&
      previous.inactiveReason === reason
    ) {
      return;
    }
    this.root.userData.iwsdkDomeFade = {
      active,
      end,
      inactiveReason: reason,
      meshCount,
      skippedMaterials,
      start,
    } satisfies DomeFadeMarker;
  }

  /** Restore every source material, then dispose the clones. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const mesh of this.everPatched) {
      const material = mesh.material;
      if (Array.isArray(material)) {
        if (material.some((entry) => this.sourceByClone.has(entry))) {
          mesh.material = material.map(
            (entry) => this.sourceByClone.get(entry) ?? entry,
          );
        }
      } else {
        const source = this.sourceByClone.get(material);
        if (source != null) {
          mesh.material = source;
        }
      }
    }
    for (const [clone, source] of this.sourceByClone) {
      source.removeEventListener('dispose', this.onSourceDispose);
      clone.dispose();
    }
    this.cloneBySource.clear();
    this.sourceByClone.clear();
    this.disposedSources.clear();
    this.everPatched.clear();
    this.currentMeshes.clear();
    this.nextMeshes.clear();
    this.skipped.clear();
    delete this.root.userData.iwsdkDomeFade;
  }

  private visit(object: Object3D): void {
    if (object !== this.root) {
      // Another entity, or another scene node's content, owns this subtree.
      if (
        (object as Object3D & { entityIdx?: number }).entityIdx !== undefined
      ) {
        return;
      }
      const nodeId = object.userData.iwsdkSceneNodeId;
      if (typeof nodeId === 'string' && nodeId !== this.rootNodeId) {
        return;
      }
    }
    if (
      object.userData.iwsdkRuntimeOnly === true ||
      object.userData.iwsdkEditorHelper === true
    ) {
      return;
    }
    if ((object as Mesh).isMesh === true) {
      this.patchMesh(object as Mesh);
    }
    for (const child of object.children) {
      this.visit(child);
    }
  }

  private patchMesh(mesh: Mesh): void {
    const material = mesh.material;
    let patched = false;
    if (Array.isArray(material)) {
      let next: Material[] | undefined;
      for (let index = 0; index < material.length; index += 1) {
        const entry = this.patchedMaterial(material[index]);
        if (entry == null) {
          continue;
        }
        patched = true;
        if (entry !== material[index]) {
          next ??= material.slice();
          next[index] = entry;
        }
      }
      if (next != null) {
        mesh.material = next;
      }
    } else if (material != null) {
      const entry = this.patchedMaterial(material);
      if (entry != null) {
        patched = true;
        if (entry !== material) {
          mesh.material = entry;
        }
      }
    }
    if (patched) {
      this.nextMeshes.add(mesh);
      this.everPatched.add(mesh);
    }
  }

  /** This binding's clone for `material`, or undefined when unsupported. */
  private patchedMaterial(material: Material): Material | undefined {
    if (this.sourceByClone.has(material)) {
      return material;
    }
    // Another binding's clone would be patched twice.
    if (
      !isSupportedMaterial(material) ||
      domeFadeClones.has(material) ||
      uncloneableSources.has(material)
    ) {
      this.skipped.add(material);
      return undefined;
    }
    let clone = this.cloneBySource.get(material);
    if (clone == null) {
      try {
        clone = createDomeFadeMaterial(material, this.uniforms, this.params);
      } catch (error) {
        // A subclass whose constructor needs arguments, or userData that
        // cannot be copied, must not stop the frame.
        uncloneableSources.add(material);
        if (!warnedCloneFailures.has(material.type)) {
          warnedCloneFailures.add(material.type);
          console.warn(
            `[DomeFade] Cannot copy a ${material.type} on ${this.describeRoot()}; it renders without the fade.`,
            error,
          );
        }
        this.skipped.add(material);
        return undefined;
      }
      this.cloneBySource.set(material, clone);
      this.sourceByClone.set(clone, material);
      material.addEventListener('dispose', this.onSourceDispose);
    }
    return clone;
  }

  /** Dispose the clones of disposed sources that no patched mesh shows. */
  private releaseDisposedSources(): void {
    for (const source of this.disposedSources) {
      const clone = this.cloneBySource.get(source);
      if (clone != null && this.isShown(clone)) {
        continue;
      }
      this.disposedSources.delete(source);
      source.removeEventListener('dispose', this.onSourceDispose);
      if (clone != null) {
        this.cloneBySource.delete(source);
        this.sourceByClone.delete(clone);
        clone.dispose();
      }
    }
  }

  private isShown(clone: Material): boolean {
    for (const mesh of this.currentMeshes) {
      const material = mesh.material;
      if (
        material === clone ||
        (Array.isArray(material) && material.includes(clone))
      ) {
        return true;
      }
    }
    return false;
  }

  private describeRoot(): string {
    const nodeId = this.root.userData.iwsdkSceneNodeId;
    return typeof nodeId === 'string'
      ? `node "${nodeId}"`
      : `object "${this.root.name || this.root.uuid}"`;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Cannot use a disposed DomeFadeBinding');
    }
  }
}

/** @internal Convert one serialized component payload to a fade spec. */
export function domeFadeSpecFromComponentValue(
  componentName: string,
  value: unknown,
): DomeFadeSpec | undefined {
  const componentId = componentName.startsWith('com.iwsdk.components.')
    ? componentName.slice('com.iwsdk.components.'.length)
    : componentName;
  if (componentId !== DomeFade.id) {
    return undefined;
  }
  const payload =
    value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const field = (name: 'start' | 'end') =>
    Number(payload[name] ?? DomeFade.schema[name].default);
  return { end: field('end'), start: field('start') };
}
