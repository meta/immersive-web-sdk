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
} from '../runtime/index.js';
import { DomeGradient } from './dome-gradient.js';
import { DomeTexture } from './dome-texture.js';
import {
  GradientEnvironment,
  createGradientMaterial,
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

interface EnvState {
  backgroundTexture?: Texture;
  environmentTarget?: WebGLRenderTarget;
  backgroundSource?: string;
  environmentSource?: string;
  gradientDome?: Mesh;
  gradientEnvironmentScene?: GradientEnvironment;
  gradientEnvironmentMesh?: Mesh;
}

/**
 * Unified background and image‑based lighting system.
 *
 * @remarks
 * - {@link DomeTexture} writes an HDR/LDR equirectangular texture to `scene.background`; {@link DomeGradient} renders a procedural, clipping-proof sky mesh.
 * - IBL is driven by {@link IBLTexture} ("room" or HDR/LDR equirect via PMREM) or {@link IBLGradient} (PMREM of a gradient scene) and writes to `scene.environment`.
 * - Rotation and intensity hooks forward to `scene.backgroundRotation`, `scene.backgroundIntensity`, and `scene.environmentRotation`, `scene.environmentIntensity`.
 * - AR sessions always hide authored backgrounds for passthrough while retaining IBL.
 * - PMREM targets are regenerated only when sources change; the dome mesh and geometry are reused.
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
}) {
  private state: EnvState = {};
  private pmrem!: PMREMGenerator;
  private gradientGeometry?: SphereGeometry;
  private tmpColor: Color = new Color();
  private recenterYawOffset: number = 0;
  private resetListenerCleanup: (() => void) | null = null;
  private needsResetListener: boolean = false;
  private arEnvironment!: SceneAREnvironmentController;

  init(): void {
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
      this.clearGradientDome();
      this.clearGradientEnvironment();
      this.gradientGeometry?.dispose();
      this.gradientGeometry = undefined;
    });

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

    this.updateSceneARMode();
  }

  // Background handling
  private async processBackground(entity: Entity): Promise<void> {
    try {
      if (entity.hasComponent(DomeTexture)) {
        const needs = entity.getValue(DomeTexture, '_needsUpdate');
        if (needs) {
          const changed = this.hasDomeTextureBackgroundChanged(entity);
          if (changed) {
            await this.updateDomeTextureBackground(entity);
          }
          this.updateBackgroundProps(entity);
          entity.setValue(DomeTexture, '_needsUpdate', false);
        }
      } else if (entity.hasComponent(DomeGradient)) {
        const needs = entity.getValue(DomeGradient, '_needsUpdate');
        if (needs) {
          await this.updateDomeGradient(entity, /*forIBL*/ false);
          entity.setValue(DomeGradient, '_needsUpdate', false);
        }
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

  private async updateDomeTextureBackground(entity: Entity): Promise<void> {
    const src = entity.getValue(DomeTexture, 'src') || '';
    if (!src) {
      this.scene.background = null;
      return;
    }
    const lower = src.toLowerCase();
    const isHDR = lower.endsWith('.hdr') || lower.endsWith('.exr');
    const url = CacheManager.resolveUrl(src);
    const texture = isHDR
      ? await AssetManager.loadHDRTexture(url)
      : await AssetManager.loadTexture(url);
    this.state.backgroundTexture = texture;
    // For LDR equirect backgrounds, ensure world-locked mapping; HDR/EXR already mapped by loader
    if (!isHDR) {
      texture.mapping = EquirectangularReflectionMapping;
    }
    this.scene.background = texture;
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
  }

  private async updateDomeGradient(
    entity: Entity,
    forIBL: boolean,
  ): Promise<void> {
    const skyV = entity.getVectorView(DomeGradient, 'sky');
    const equatorV = entity.getVectorView(DomeGradient, 'equator');
    const groundV = entity.getVectorView(DomeGradient, 'ground');
    const intensity = entity.getValue(DomeGradient, 'intensity') || 1.0;

    const skyHex = this.tmpColor.setRGB(skyV[0], skyV[1], skyV[2]).getHex();
    const equatorHex = this.tmpColor
      .setRGB(equatorV[0], equatorV[1], equatorV[2])
      .getHex();
    const groundHex = this.tmpColor
      .setRGB(groundV[0], groundV[1], groundV[2])
      .getHex();

    if (!forIBL) {
      // Background gradient dome mesh
      this.ensureGradientDome(skyHex, equatorHex, groundHex, intensity);
      if (this.state.gradientDome) {
        this.state.gradientDome.userData.iwsdkSceneDomeGradient = {
          equator: Array.from(equatorV),
          ground: Array.from(groundV),
          intensity,
          sky: Array.from(skyV),
        };
      }
    }
  }

  // IBL handling
  private async processIBL(entity: Entity): Promise<void> {
    try {
      if (entity.hasComponent(IBLTexture)) {
        const needs = entity.getValue(IBLTexture, '_needsUpdate');
        if (needs) {
          const changed = this.hasIBLTextureChanged(entity);
          if (changed) {
            await this.updateIBLTexture(entity);
          }
          this.updateIBLProps(entity);
          entity.setValue(IBLTexture, '_needsUpdate', false);
        }
      } else if (entity.hasComponent(IBLGradient)) {
        const needs = entity.getValue(IBLGradient, '_needsUpdate');
        if (needs) {
          await this.updateIBLGradient(entity);
          entity.setValue(IBLGradient, '_needsUpdate', false);
        }
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

  private async updateIBLTexture(entity: Entity): Promise<void> {
    const src = (entity.getValue(IBLTexture, 'src') || '').trim();
    if (!src) {
      this.setEnvironment(null);
      return;
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
      return;
    }
    const lower2 = src.toLowerCase();
    const isHDR = lower2.endsWith('.hdr') || lower2.endsWith('.exr');
    const url = CacheManager.resolveUrl(src);
    const tex = isHDR
      ? await AssetManager.loadHDRTexture(url)
      : await AssetManager.loadTexture(url);
    const target = this.pmrem.fromEquirectangular(tex);
    this.setEnvironment(target);
  }

  private updateIBLProps(entity: Entity): void {
    const intensity = entity.getValue(IBLTexture, 'intensity') ?? 1;
    const rot = entity.getVectorView(IBLTexture, 'rotation');
    this.scene.environmentIntensity = intensity;
    if (rot) {
      this.scene.environmentRotation?.set(
        rot[0] || 0,
        (rot[1] || 0) + this.recenterYawOffset,
        rot[2] || 0,
      );
    }
  }

  private async updateIBLGradient(entity: Entity): Promise<void> {
    const skyV = entity.getVectorView(IBLGradient, 'sky');
    const equatorV = entity.getVectorView(IBLGradient, 'equator');
    const groundV = entity.getVectorView(IBLGradient, 'ground');
    const intensity = entity.getValue(IBLGradient, 'intensity') || 1.0;
    // Reuse the shared scratch Color instead of allocating three new Color
    // objects every frame (updateDomeGradient already uses this.tmpColor).
    const { skyHex, equatorHex, groundHex } = computeGradientHexes(
      this.tmpColor,
      skyV,
      equatorV,
      groundV,
    );

    let gradientScene = this.state.gradientEnvironmentScene;
    if (!gradientScene) {
      gradientScene = new GradientEnvironment(
        skyHex,
        equatorHex,
        groundHex,
        intensity,
      );
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
        mat.uniforms.skyColor.value.setHex(skyHex).multiplyScalar(intensity);
        mat.uniforms.equatorColor.value
          .setHex(equatorHex)
          .multiplyScalar(intensity);
        mat.uniforms.groundColor.value
          .setHex(groundHex)
          .multiplyScalar(intensity);
      }
    }

    const target = this.pmrem.fromScene(gradientScene);
    target.texture.userData.iwsdkSceneIBLGradient = {
      equator: Array.from(equatorV),
      ground: Array.from(groundV),
      intensity,
      sky: Array.from(skyV),
    };
    this.setEnvironment(target);
    // Apply IBL intensity for gradient as well
    this.scene.environmentIntensity = intensity;
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
    this.arEnvironment.update({
      session,
      authoredBackgrounds:
        this.state.gradientDome == null ? [] : [this.state.gradientDome],
    });
  }

  // Gradient dome mesh utilities (background)
  private ensureGradientDome(
    skyHex: number,
    equatorHex: number,
    groundHex: number,
    intensity: number,
  ): void {
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
      );
      const dome = new Mesh(this.gradientGeometry, material);
      dome.renderOrder = -1e9;
      dome.frustumCulled = false;
      this.scene.add(dome);
      this.state.gradientDome = dome;
    } else {
      const mat = this.state.gradientDome.material as ShaderMaterial;
      mat.uniforms.skyColor.value.setHex(skyHex).multiplyScalar(intensity);
      mat.uniforms.equatorColor.value
        .setHex(equatorHex)
        .multiplyScalar(intensity);
      mat.uniforms.groundColor.value
        .setHex(groundHex)
        .multiplyScalar(intensity);
    }
  }

  private clearGradientDome(): void {
    if (this.state.gradientDome) {
      this.state.gradientDome.removeFromParent();
      (this.state.gradientDome.material as ShaderMaterial).dispose();
      this.state.gradientDome = undefined;
    }
  }

  private clearGradientEnvironment(): void {
    if (this.state.gradientEnvironmentScene) {
      this.state.gradientEnvironmentScene.dispose();
      this.state.gradientEnvironmentScene = undefined;
    }
    this.state.gradientEnvironmentMesh = undefined;
  }

  private clearBackgroundSource(): void {
    this.clearGradientDome();
    if (
      this.state.backgroundTexture != null &&
      this.scene.background === this.state.backgroundTexture
    ) {
      this.scene.background = null;
    }
    this.state.backgroundTexture = undefined;
    this.state.backgroundSource = undefined;
  }

  private clearIBLSource(): void {
    const target = this.state.environmentTarget;
    if (target != null && this.scene.environment === target.texture) {
      this.scene.environment = null;
    }
    target?.dispose();
    this.state.environmentTarget = undefined;
    this.state.environmentSource = undefined;
    this.clearGradientEnvironment();
  }
}
