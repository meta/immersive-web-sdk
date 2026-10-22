/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AssetManager, CacheManager } from '../asset/index.js';
import { Entity } from '../ecs/entity.js';
import { createSystem } from '../ecs/system.js';
// Import directly from the subfile — not the `../level/index.js` barrel — to
// avoid a value-level import cycle: level/index.js re-exports level-system.ts,
// which imports the environment barrel, which re-exports environment-system.ts
// (currently being evaluated). The bundler resolves this cycle by emitting
// EnvironmentSystem before dome-texture/dome-gradient/ibl-* are defined,
// leaving the required[] arrays holding `undefined.bitmask` crashes.
import { LevelRoot } from '../level/level-root.js';
import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  WebGLRenderTarget,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  EquirectangularReflectionMapping,
  type Object3D,
} from '../runtime/index.js';
import {
  DomeFadeBinding,
  type DomeFadeInactiveReason,
  type DomeFadeMarker,
  type DomeFadeSpec,
} from './dome-fade-binding.js';
import { DomeFade } from './dome-fade.js';
import { DomeGradient } from './dome-gradient.js';
import { DomeTexture } from './dome-texture.js';
import {
  GradientEnvironment,
  createDomeGradientUniforms,
  createGradientMaterial,
  domeGradientAxis,
  type DomeGradientAxisWarning,
  type DomeGradientUniforms,
} from './gradient-environment.js';
import { IBLGradient } from './ibl-gradient.js';
import { IBLTexture } from './ibl-texture.js';
import { SceneAREnvironmentController } from './scene-ar-environment.js';

/**
 * Compute sky/equator/ground hex colors from RGB views, reusing a single shared
 * `Color` scratch object (`out`) instead of allocating one `Color` per channel
 * per frame. Each `getHex()` is read before the next `setRGB()` overwrites
 * `out`, so the shared instance is safe.
 */
export function computeGradientHexes(
  out: Color,
  sky: ArrayLike<number>,
  equator: ArrayLike<number>,
  ground: ArrayLike<number>,
): { skyHex: number; equatorHex: number; groundHex: number } {
  const skyHex = out.setRGB(sky[0], sky[1], sky[2]).getHex();
  const equatorHex = out.setRGB(equator[0], equator[1], equator[2]).getHex();
  const groundHex = out.setRGB(ground[0], ground[1], ground[2]).getHex();
  return { skyHex, equatorHex, groundHex };
}

/**
 * Last applied gradient values: the entity index plus every authored number,
 * so edits apply without `_needsUpdate` and unchanged frames do no work.
 */
interface GradientSnapshot {
  entityIndex: number;
  values: number[];
}

const DOME_FADE_INACTIVE_MESSAGES: Record<
  Exclude<DomeFadeInactiveReason, 'ar-session'>,
  string
> = {
  'dome-texture-active':
    'a DomeTexture is the background; DomeFade only fades into a DomeGradient.',
  'no-dome-gradient': 'the level root has no DomeGradient.',
  'no-meshes': 'the node has no meshes with a supported material.',
};

function readDomeFadeSpec(entity: Entity): DomeFadeSpec {
  return {
    end: Number(entity.getValue(DomeFade, 'end')),
    start: Number(entity.getValue(DomeFade, 'start')),
  };
}

interface EnvState {
  backgroundTexture?: Texture;
  environmentTarget?: WebGLRenderTarget;
  backgroundSource?: string;
  environmentSource?: string;
  gradientDome?: Mesh;
  gradientDomeSnapshot?: GradientSnapshot;
  gradientEnvironmentScene?: GradientEnvironment;
  gradientEnvironmentMesh?: Mesh;
  gradientEnvironmentSnapshot?: GradientSnapshot;
  /** An IBL component wrote `scene.environmentIntensity`. */
  environmentIntensityApplied?: boolean;
}

/** Write the first three channels of each stop into `out[0..8]`. */
function writeGradientColors(
  out: number[],
  sky: ArrayLike<number>,
  equator: ArrayLike<number>,
  ground: ArrayLike<number>,
): void {
  for (let channel = 0; channel < 3; channel += 1) {
    out[channel] = sky[channel];
    out[3 + channel] = equator[channel];
    out[6 + channel] = ground[channel];
  }
}

/** Whether the first `count` snapshot values (default: all) still match. */
function sameGradientSnapshot(
  snapshot: GradientSnapshot | undefined,
  entityIndex: number,
  values: readonly number[],
  count: number = values.length,
): boolean {
  if (snapshot == null || snapshot.entityIndex !== entityIndex) {
    return false;
  }
  for (let index = 0; index < count; index += 1) {
    if (!Object.is(snapshot.values[index], values[index])) {
      return false;
    }
  }
  return true;
}

/**
 * Unified background and image‑based lighting system.
 *
 * @remarks
 * - {@link DomeTexture} writes an HDR/LDR equirectangular texture to `scene.background`; {@link DomeGradient} renders a procedural, clipping-proof sky mesh. A DomeTexture wins over a DomeGradient.
 * - IBL is driven by {@link IBLTexture} ("room" or HDR/LDR equirect via PMREM) or {@link IBLGradient} (PMREM of a gradient scene) and writes to `scene.environment`. An IBLTexture wins over an IBLGradient.
 * - Rotation and intensity hooks forward to `scene.backgroundRotation`, `scene.backgroundIntensity`, and `scene.environmentRotation`, `scene.environmentIntensity`.
 * - DomeGradient and IBLGradient edits apply on the next frame; DomeTexture and IBLTexture edits apply when `_needsUpdate` is set.
 * - {@link DomeFade} fades a node's meshes into the live DomeGradient sky, sharing the dome's uniforms.
 * - AR sessions always hide authored backgrounds (the dome, and with it DomeFade meshes) for passthrough while retaining IBL.
 * - PMREM targets are regenerated only when sources or gradient colors change; the dome mesh and geometry are reused.
 *
 * @category Environment & Lighting
 * @example
 * ```ts
 * // Background: HDR skybox; IBL: Room environment
 * const root = world.activeLevel!.value;
 * root.addComponent(DomeTexture, { src: '/envs/sky.hdr', intensity: 0.9 });
 * root.addComponent(IBLTexture, { src: 'room', intensity: 1.2 });
 *
 * // Rotate background 45° around Y; rotate IBL 90°
 * root.setValue(DomeTexture, 'rotation', [0, Math.PI / 4, 0]);
 * root.setValue(IBLTexture, 'rotation', [0, Math.PI / 2, 0]);
 * root.setValue(DomeTexture, '_needsUpdate', true);
 * root.setValue(IBLTexture, '_needsUpdate', true);
 * ```
 */
export class EnvironmentSystem extends createSystem({
  domeTextures: { required: [DomeTexture, LevelRoot] },
  domeGradients: { required: [DomeGradient, LevelRoot] },
  iblTextures: { required: [IBLTexture, LevelRoot] },
  iblGradients: { required: [IBLGradient, LevelRoot] },
  domeFades: { required: [DomeFade] },
}) {
  private state: EnvState = {};
  private pmrem!: PMREMGenerator;
  private gradientGeometry?: SphereGeometry;
  private tmpColor: Color = new Color();
  private domeUniforms!: DomeGradientUniforms;
  private readonly domeAxisWarning: DomeGradientAxisWarning = { warned: false };
  private readonly domeGradientValues: number[] = [];
  private readonly iblGradientValues: number[] = [];
  private recenterYawOffset: number = 0;
  private resetListenerCleanup: (() => void) | null = null;
  private needsResetListener: boolean = false;
  private arEnvironment!: SceneAREnvironmentController;
  private arSuppressed = false;
  private readonly domeFadeBindings = new Map<Entity, DomeFadeBinding>();
  private readonly domeFadeWarned = new WeakSet<DomeFadeBinding>();
  private readonly authoredBackgrounds: Object3D[] = [];

  init(): void {
    this.domeUniforms = createDomeGradientUniforms();
    this.pmrem = new PMREMGenerator(this.renderer);
    this.arEnvironment = new SceneAREnvironmentController(
      this.scene,
      this.renderer,
    );
    this.cleanupFuncs.push(() => {
      this.arEnvironment.restore();
      this.pmrem.dispose();
      this.state.environmentTarget?.dispose();
      this.state.environmentTarget = undefined;
      for (const binding of this.domeFadeBindings.values()) {
        binding.dispose();
      }
      this.domeFadeBindings.clear();
      this.clearGradientDome();
      this.clearGradientEnvironment();
      this.gradientGeometry?.dispose();
      this.gradientGeometry = undefined;
    });

    // DomeFade bindings, replaying entities that already qualify.
    this.cleanupFuncs.push(
      this.queries.domeFades.subscribe(
        'qualify',
        (entity) => this.attachDomeFade(entity as Entity),
        true,
      ),
      this.queries.domeFades.subscribe('disqualify', (entity) =>
        this.detachDomeFade(entity as Entity),
      ),
    );

    // XR background toggle
    this.cleanupFuncs.push(
      this.visibilityState.subscribe(() => this.updateSceneARMode()),
    );

    // XR recenter compensation
    this.xrManager.addEventListener('sessionstart', this.onXRSessionStart);
    this.xrManager.addEventListener('sessionend', this.onXRSessionEnd);
    this.cleanupFuncs.push(() => {
      this.xrManager.removeEventListener('sessionstart', this.onXRSessionStart);
      this.xrManager.removeEventListener('sessionend', this.onXRSessionEnd);
      this.resetListenerCleanup?.();
      this.resetListenerCleanup = null;
    });
  }

  update(): void {
    // Deferred reset listener attachment
    if (this.needsResetListener) {
      const refSpace = this.xrManager.getReferenceSpace();
      if (refSpace) {
        this.attachResetListener(refSpace);
        this.needsResetListener = false;
      }
    }

    // Choose background source: DomeTexture > DomeGradient
    let backgroundEntity: Entity | undefined;
    for (const e of this.queries.domeTextures.entities) {
      backgroundEntity = e;
      break;
    }
    if (!backgroundEntity) {
      for (const e of this.queries.domeGradients.entities) {
        backgroundEntity = e;
        break;
      }
    }

    if (backgroundEntity) {
      this.processBackground(backgroundEntity);
    } else {
      this.clearBackgroundSource();
    }

    // Choose IBL source: IBLTexture > IBLGradient
    let iblEntity: Entity | undefined;
    for (const e of this.queries.iblTextures.entities) {
      iblEntity = e;
      break;
    }
    if (!iblEntity) {
      for (const e of this.queries.iblGradients.entities) {
        iblEntity = e;
        break;
      }
    }

    if (iblEntity) {
      this.processIBL(iblEntity);
    } else {
      this.clearIBLSource();
    }

    for (const [entity, binding] of this.domeFadeBindings) {
      binding.update(readDomeFadeSpec(entity));
      binding.refresh();
      binding.syncTransform();
    }

    this.updateSceneARMode();
    // Only after a background pass: updateSceneARMode() also runs from the
    // visibility subscription in init() and on session start.
    this.warnInactiveDomeFades();
  }

  private attachDomeFade(entity: Entity): void {
    if (this.domeFadeBindings.has(entity)) {
      return;
    }
    if (entity.object3D == null) {
      console.warn(
        `[EnvironmentSystem] DomeFade on entity ${entity.index} has no object3D; it is ignored.`,
      );
      return;
    }
    this.domeFadeBindings.set(
      entity,
      new DomeFadeBinding(
        entity.object3D,
        this.domeUniforms,
        readDomeFadeSpec(entity),
      ),
    );
  }

  private detachDomeFade(entity: Entity): void {
    this.domeFadeBindings.get(entity)?.dispose();
    this.domeFadeBindings.delete(entity);
  }

  // Background handling
  private async processBackground(entity: Entity): Promise<void> {
    try {
      if (entity.hasComponent(DomeTexture)) {
        // A DomeTexture wins: never leave a gradient dome drawn over it.
        this.clearGradientDome();
        const needs = entity.getValue(DomeTexture, '_needsUpdate');
        if (needs) {
          const changed = this.hasDomeTextureBackgroundChanged(entity);
          if (changed && !(await this.updateDomeTextureBackground(entity))) {
            return;
          }
          this.updateBackgroundProps(entity);
          entity.setValue(DomeTexture, '_needsUpdate', false);
        }
      } else if (entity.hasComponent(DomeGradient)) {
        this.clearBackgroundTexture();
        this.updateDomeGradient(entity);
      }
    } catch (e) {
      console.error('[EnvironmentSystem] Failed background update:', e);
    }
  }

  private hasDomeTextureBackgroundChanged(entity: Entity): boolean {
    const src = entity.getValue(DomeTexture, 'src') || '';
    const changed = src !== this.state.backgroundSource;
    if (changed) {
      this.state.backgroundSource = src;
    }
    return changed;
  }

  /** False when another background replaced this one while it loaded. */
  private async updateDomeTextureBackground(entity: Entity): Promise<boolean> {
    const source = this.state.backgroundSource;
    const src = entity.getValue(DomeTexture, 'src') || '';
    if (!src) {
      this.scene.background = null;
      return true;
    }
    const lower = src.toLowerCase();
    const isHDR = lower.endsWith('.hdr') || lower.endsWith('.exr');
    const url = CacheManager.resolveUrl(src);
    const texture = isHDR
      ? await AssetManager.loadHDRTexture(url)
      : await AssetManager.loadTexture(url);
    if (this.state.backgroundSource !== source) {
      return false;
    }
    this.state.backgroundTexture = texture;
    // For LDR equirect backgrounds, ensure world-locked mapping; HDR/EXR already mapped by loader
    if (!isHDR) {
      texture.mapping = EquirectangularReflectionMapping;
    }
    this.scene.background = texture;
    return true;
  }

  private updateBackgroundProps(entity: Entity): void {
    const blurriness = entity.getValue(DomeTexture, 'blurriness') ?? 0;
    const intensity = entity.getValue(DomeTexture, 'intensity') ?? 1;
    const rot = entity.getVectorView(DomeTexture, 'rotation');
    this.scene.backgroundBlurriness = blurriness;
    this.scene.backgroundIntensity = intensity;
    if (rot) {
      this.scene.backgroundRotation?.set(
        rot[0] || 0,
        (rot[1] || 0) + this.recenterYawOffset,
        rot[2] || 0,
      );
    }
    const texture = this.state.backgroundTexture;
    if (texture != null) {
      texture.userData.iwsdkSceneDomeTexture = {
        blurriness,
        intensity,
        rotation: rot ? Array.from(rot) : [0, 0, 0],
        src: entity.getValue(DomeTexture, 'src') || '',
      };
    }
  }

  private updateDomeGradient(entity: Entity): void {
    const skyV = entity.getVectorView(DomeGradient, 'sky');
    const equatorV = entity.getVectorView(DomeGradient, 'equator');
    const groundV = entity.getVectorView(DomeGradient, 'ground');
    const intensity = entity.getValue(DomeGradient, 'intensity') ?? 1;
    const elevationDeg = entity.getValue(DomeGradient, 'elevationDeg') ?? 90;
    const azimuthDeg = entity.getValue(DomeGradient, 'azimuthDeg') ?? 0;
    const dither = entity.getValue(DomeGradient, 'dither') ? 1 : 0;
    const values = this.domeGradientValues;
    writeGradientColors(values, skyV, equatorV, groundV);
    values[9] = intensity;
    values[10] = elevationDeg;
    values[11] = azimuthDeg;
    values[12] = dither;
    if (
      !entity.getValue(DomeGradient, '_needsUpdate') &&
      this.state.gradientDome != null &&
      sameGradientSnapshot(
        this.state.gradientDomeSnapshot,
        entity.index,
        values,
      )
    ) {
      return;
    }

    // Keep the hex round trip so existing scenes render the same pixels.
    const { skyHex, equatorHex, groundHex } = computeGradientHexes(
      this.tmpColor,
      skyV,
      equatorV,
      groundV,
    );
    const dome = this.ensureGradientDome(
      skyHex,
      equatorHex,
      groundHex,
      intensity,
    );
    const axis = domeGradientAxis(
      elevationDeg,
      azimuthDeg,
      this.domeUniforms.axis.value,
      this.domeAxisWarning,
    );
    this.domeUniforms.dither.value = dither;
    dome.userData.iwsdkSceneDomeGradient = {
      azimuthDeg,
      axis: axis.toArray(),
      dither: dither === 1,
      elevationDeg,
      equator: Array.from(equatorV),
      ground: Array.from(groundV),
      intensity,
      sky: Array.from(skyV),
    };
    this.state.gradientDomeSnapshot = {
      entityIndex: entity.index,
      values: values.slice(),
    };
    entity.setValue(DomeGradient, '_needsUpdate', false);
  }

  // IBL handling
  private async processIBL(entity: Entity): Promise<void> {
    try {
      if (entity.hasComponent(IBLTexture)) {
        // An IBLTexture wins: drop the gradient scene and its snapshot so a
        // later IBLGradient regenerates its PMREM target.
        this.clearGradientEnvironment();
        const needs = entity.getValue(IBLTexture, '_needsUpdate');
        if (needs) {
          const changed = this.hasIBLTextureChanged(entity);
          if (changed && !(await this.updateIBLTexture(entity))) {
            return;
          }
          this.updateIBLProps(entity);
          entity.setValue(IBLTexture, '_needsUpdate', false);
        }
      } else if (entity.hasComponent(IBLGradient)) {
        // Forget the texture source so a later IBLTexture with the same src
        // reloads instead of keeping the gradient target.
        this.state.environmentSource = undefined;
        this.updateIBLGradient(entity);
      }
    } catch (e) {
      console.error('[EnvironmentSystem] Failed IBL update:', e);
    }
  }

  private hasIBLTextureChanged(entity: Entity): boolean {
    const src = entity.getValue(IBLTexture, 'src') || '';
    const changed = src !== this.state.environmentSource;
    if (changed) {
      this.state.environmentSource = src;
    }
    return changed;
  }

  /**
   * False when another IBL source (an IBLGradient, a removal or a new `src`)
   * replaced this one while it loaded.
   */
  private async updateIBLTexture(entity: Entity): Promise<boolean> {
    const source = this.state.environmentSource;
    const src = (entity.getValue(IBLTexture, 'src') || '').trim();
    if (!src) {
      this.setEnvironment(null);
      return true;
    }
    if (src === 'room') {
      // Build RoomEnvironment scene and PMREM it
      const room = new RoomEnvironment();
      // three r183 moved the room 3.5 m down; keep the IBL IWSDK apps have
      // always had.
      room.position.y = 0;
      const target = this.pmrem.fromScene(room);
      room.dispose?.();
      this.setEnvironment(target);
      return true;
    }
    const lower2 = src.toLowerCase();
    const isHDR = lower2.endsWith('.hdr') || lower2.endsWith('.exr');
    const url = CacheManager.resolveUrl(src);
    const tex = isHDR
      ? await AssetManager.loadHDRTexture(url)
      : await AssetManager.loadTexture(url);
    if (this.state.environmentSource !== source) {
      return false;
    }
    const target = this.pmrem.fromEquirectangular(tex);
    this.setEnvironment(target);
    return true;
  }

  private updateIBLProps(entity: Entity): void {
    const intensity = entity.getValue(IBLTexture, 'intensity') ?? 1;
    const rot = entity.getVectorView(IBLTexture, 'rotation');
    this.scene.environmentIntensity = intensity;
    this.state.environmentIntensityApplied = true;
    if (rot) {
      this.scene.environmentRotation?.set(
        rot[0] || 0,
        (rot[1] || 0) + this.recenterYawOffset,
        rot[2] || 0,
      );
    }
    const target = this.state.environmentTarget;
    if (target != null) {
      target.texture.userData.iwsdkSceneIBLTexture = {
        intensity,
        rotation: rot ? Array.from(rot) : [0, 0, 0],
        src: (entity.getValue(IBLTexture, 'src') || '').trim(),
      };
    }
  }

  private updateIBLGradient(entity: Entity): void {
    const skyV = entity.getVectorView(IBLGradient, 'sky');
    const equatorV = entity.getVectorView(IBLGradient, 'equator');
    const groundV = entity.getVectorView(IBLGradient, 'ground');
    const intensity = entity.getValue(IBLGradient, 'intensity') ?? 1;
    const values = this.iblGradientValues;
    writeGradientColors(values, skyV, equatorV, groundV);
    values[9] = intensity;
    const needsUpdate = entity.getValue(IBLGradient, '_needsUpdate');
    const snapshot = this.state.gradientEnvironmentSnapshot;
    const hasTarget =
      this.state.gradientEnvironmentScene != null &&
      this.state.environmentTarget != null;
    if (
      !needsUpdate &&
      hasTarget &&
      sameGradientSnapshot(snapshot, entity.index, values)
    ) {
      return;
    }

    // Only a color change regenerates the PMREM target; an intensity-only
    // change just sets environmentIntensity.
    if (
      needsUpdate ||
      !hasTarget ||
      !sameGradientSnapshot(snapshot, entity.index, values, 9)
    ) {
      // Reuse the shared scratch Color instead of allocating three new Color
      // objects every frame (updateDomeGradient already uses this.tmpColor).
      const { skyHex, equatorHex, groundHex } = computeGradientHexes(
        this.tmpColor,
        skyV,
        equatorV,
        groundV,
      );

      // The PMREM scene stays at unit intensity: intensity is applied once,
      // through scene.environmentIntensity below.
      let gradientScene = this.state.gradientEnvironmentScene;
      if (!gradientScene) {
        gradientScene = new GradientEnvironment(skyHex, equatorHex, groundHex);
        this.state.gradientEnvironmentScene = gradientScene;
        // Cache mesh for uniform updates
        this.state.gradientEnvironmentMesh = gradientScene.children.find(
          (o): o is Mesh => o instanceof Mesh,
        );
      } else {
        const mat = this.state.gradientEnvironmentMesh?.material as
          | ShaderMaterial
          | undefined;
        if (mat) {
          mat.uniforms.skyColor.value.setHex(skyHex);
          mat.uniforms.equatorColor.value.setHex(equatorHex);
          mat.uniforms.groundColor.value.setHex(groundHex);
        }
      }

      this.setEnvironment(this.pmrem.fromScene(gradientScene));
    }
    this.state.gradientEnvironmentSnapshot = {
      entityIndex: entity.index,
      values: values.slice(),
    };

    const target = this.state.environmentTarget;
    if (target != null) {
      target.texture.userData.iwsdkSceneIBLGradient = {
        equator: Array.from(equatorV),
        ground: Array.from(groundV),
        intensity,
        sky: Array.from(skyV),
      };
    }
    this.scene.environmentIntensity = intensity;
    this.state.environmentIntensityApplied = true;
    // IBLGradient has no rotation; drop any rotation an IBLTexture left.
    this.scene.environmentRotation?.set(0, 0, 0);
    entity.setValue(IBLGradient, '_needsUpdate', false);
  }

  /** @internal Live dome uniforms shared with DomeFade materials and the editor. */
  getDomeGradientUniforms(): DomeGradientUniforms {
    return this.domeUniforms;
  }

  private setEnvironment(target: WebGLRenderTarget | null): void {
    this.state.environmentTarget?.dispose();
    this.state.environmentTarget = undefined;
    if (target) {
      this.state.environmentTarget = target;
      this.scene.environment = target.texture;
    } else {
      this.scene.environment = null;
    }
  }

  // XR recenter handling
  private onXRSessionStart = (): void => {
    this.recenterYawOffset = 0;
    const refSpace = this.xrManager.getReferenceSpace();
    if (refSpace) {
      this.attachResetListener(refSpace);
    } else {
      this.needsResetListener = true;
    }
    this.updateSceneARMode();
  };

  private attachResetListener(refSpace: XRReferenceSpace): void {
    const onReset = (event: XRReferenceSpaceEvent) => {
      this.onReferenceSpaceReset(event);
    };
    refSpace.addEventListener('reset', onReset);
    this.resetListenerCleanup = () => {
      refSpace.removeEventListener('reset', onReset);
    };
  }

  private onXRSessionEnd = (): void => {
    this.resetListenerCleanup?.();
    this.resetListenerCleanup = null;
    this.recenterYawOffset = 0;
    this.needsResetListener = false;
    this.updateSceneARMode(null);
  };

  private onReferenceSpaceReset(event: XRReferenceSpaceEvent): void {
    const transform = event.transform;
    if (!transform) {
      return;
    }

    const q = transform.orientation;
    const yaw = Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.z * q.z),
    );

    this.recenterYawOffset += yaw;
    this.applyRecenterCompensation();
  }

  private applyRecenterCompensation(): void {
    for (const entity of this.queries.iblTextures.entities) {
      const rot = entity.getVectorView(IBLTexture, 'rotation');
      if (rot) {
        this.scene.environmentRotation?.set(
          rot[0] || 0,
          (rot[1] || 0) + this.recenterYawOffset,
          rot[2] || 0,
        );
      }
      break;
    }

    for (const entity of this.queries.domeTextures.entities) {
      const rot = entity.getVectorView(DomeTexture, 'rotation');
      if (rot) {
        this.scene.backgroundRotation?.set(
          rot[0] || 0,
          (rot[1] || 0) + this.recenterYawOffset,
          rot[2] || 0,
        );
      }
      break;
    }
  }

  // Apply document AR overrides only while an actual AR session is active.
  private updateSceneARMode(sessionOverride?: XRSession | null): void {
    const managerSession = this.xrManager.getSession?.();
    const session =
      sessionOverride === undefined
        ? managerSession === undefined
          ? this.world.session
          : managerSession
        : sessionOverride;
    // Only the meshes DomeFade patched are hidden with the dome, never the
    // child nodes under a faded node. Without a dome DomeFade does nothing,
    // so its meshes stay visible.
    const authoredBackgrounds = this.authoredBackgrounds;
    authoredBackgrounds.length = 0;
    if (this.state.gradientDome != null) {
      authoredBackgrounds.push(this.state.gradientDome);
      for (const binding of this.domeFadeBindings.values()) {
        for (const mesh of binding.meshes) {
          authoredBackgrounds.push(mesh);
        }
      }
    }
    this.arSuppressed = this.arEnvironment.update({
      session,
      authoredBackgrounds,
    }).isAR;
    // After the AR controller ran: 0 with no dome, with a DomeTexture winning
    // and during AR passthrough.
    this.domeUniforms.active.value =
      this.state.gradientDome?.visible === true ? 1 : 0;
    this.updateDomeFadeMarkers();
  }

  private updateDomeFadeMarkers(): void {
    for (const binding of this.domeFadeBindings.values()) {
      const reason: DomeFadeInactiveReason | null = this.arSuppressed
        ? 'ar-session'
        : this.queries.domeTextures.entities.size > 0
          ? 'dome-texture-active'
          : this.state.gradientDome == null
            ? 'no-dome-gradient'
            : binding.meshCount === 0
              ? 'no-meshes'
              : null;
      binding.writeMarker(reason == null, reason);
    }
  }

  private warnInactiveDomeFades(): void {
    for (const binding of this.domeFadeBindings.values()) {
      const reason = (
        binding.root.userData.iwsdkDomeFade as DomeFadeMarker | undefined
      )?.inactiveReason;
      if (
        reason == null ||
        reason === 'ar-session' ||
        this.domeFadeWarned.has(binding)
      ) {
        continue;
      }
      this.domeFadeWarned.add(binding);
      const nodeId = binding.root.userData.iwsdkSceneNodeId;
      console.warn(
        `[EnvironmentSystem] DomeFade on ${typeof nodeId === 'string' ? `node "${nodeId}"` : `"${binding.root.name || binding.root.uuid}"`} does nothing: ${DOME_FADE_INACTIVE_MESSAGES[reason]}`,
      );
    }
  }

  // Gradient dome mesh utilities (background)
  private ensureGradientDome(
    skyHex: number,
    equatorHex: number,
    groundHex: number,
    intensity: number,
  ): Mesh {
    if (!this.gradientGeometry) {
      this.gradientGeometry = new SphereGeometry(1, 32, 15);
    }
    if (!this.state.gradientDome) {
      const material = createGradientMaterial(
        skyHex,
        equatorHex,
        groundHex,
        intensity,
        BackSide,
        this.domeUniforms,
      );
      const dome = new Mesh(this.gradientGeometry, material);
      dome.renderOrder = -1e9;
      dome.frustumCulled = false;
      this.scene.add(dome);
      this.state.gradientDome = dome;
    } else {
      const uniforms = this.domeUniforms;
      uniforms.sky.value.setHex(skyHex).multiplyScalar(intensity);
      uniforms.equator.value.setHex(equatorHex).multiplyScalar(intensity);
      uniforms.ground.value.setHex(groundHex).multiplyScalar(intensity);
    }
    return this.state.gradientDome;
  }

  private clearGradientDome(): void {
    if (this.state.gradientDome) {
      this.state.gradientDome.removeFromParent();
      (this.state.gradientDome.material as ShaderMaterial).dispose();
      this.state.gradientDome = undefined;
    }
    this.state.gradientDomeSnapshot = undefined;
    this.domeUniforms.active.value = 0;
  }

  private clearGradientEnvironment(): void {
    if (this.state.gradientEnvironmentScene) {
      this.state.gradientEnvironmentScene.dispose();
      this.state.gradientEnvironmentScene = undefined;
    }
    this.state.gradientEnvironmentMesh = undefined;
    this.state.gradientEnvironmentSnapshot = undefined;
  }

  private clearBackgroundTexture(): void {
    if (
      this.state.backgroundTexture != null &&
      this.scene.background === this.state.backgroundTexture
    ) {
      this.scene.background = null;
    }
    this.state.backgroundTexture = undefined;
    this.state.backgroundSource = undefined;
  }

  private clearBackgroundSource(): void {
    this.clearGradientDome();
    this.clearBackgroundTexture();
  }

  private clearIBLSource(): void {
    const target = this.state.environmentTarget;
    if (target != null && this.scene.environment === target.texture) {
      this.scene.environment = null;
    }
    target?.dispose();
    this.state.environmentTarget = undefined;
    this.state.environmentSource = undefined;
    if (this.state.environmentIntensityApplied) {
      this.scene.environmentIntensity = 1;
      this.state.environmentIntensityApplied = false;
    }
    this.clearGradientEnvironment();
  }
}
