/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types } from '../ecs/component.js';
import { Entity } from '../ecs/entity.js';
import { createSystem } from '../ecs/system.js';
import { type IUniform, Mesh, Texture, Vector2 } from '../runtime/three.js';
import { DepthOccludable, OcclusionShadersMode } from './depth-occludable.js';
import { DepthTextures } from './depth-textures.js';
import { DepthPreprocessingPass } from './occlusion/preprocessing-pass.js';
import { addOnBeforeCompile } from './on-before-compile.js';

type ShaderUniforms = { [uniform: string]: IUniform };

interface Shader {
  uniforms: ShaderUniforms;
  defines?: { [key: string]: unknown };
  vertexShader: string;
  fragmentShader: string;
}

/**
 * DepthSensingSystem - Manages WebXR depth sensing and occlusion.
 *
 * @remarks
 * - Automatically retrieves and processes depth data from WebXR sessions.
 * - Supports both CPU-optimized and GPU-optimized depth sensing.
 * - Enables occlusion of virtual objects behind real-world surfaces.
 * - Requires WebXR session feature: 'depth-sensing'.
 * NOTE: The depth occlusion feature may not be compatible with custom shaders.
 *
 * @example Basic depth sensing setup
 * ```ts
 * // Configure world with depth sensing
 * World.create(document.getElementById('scene-container'), {
 *   xr: {
 *     sessionMode: SessionMode.ImmersiveAR,
 *     features: {
 *       depthSensing: { usage: 'gpu-optimized', format: 'float32' }
 *     },
 *   }
 * })
 *
 * // Add the depth sensing system
 * world.registerSystem(DepthSensingSystem)
 * ```
 *
 * @example Enable occlusion for an object
 * ```ts
 * const cube = world.createTransformEntity(cubeObject)
 * cube.addComponent(DepthOccludable) // Will be occluded by real-world geometry
 * ```
 *
 * @category Depth Sensing
 * @see {@link DepthOccludable}
 */
export class DepthSensingSystem extends createSystem(
  {
    occludables: { required: [DepthOccludable] },
  },
  {
    enableOcclusion: { type: Types.Boolean, default: true },
    enableDepthTexture: { type: Types.Boolean, default: true },
    useFloat32: { type: Types.Boolean, default: true },
    blurRadius: { type: Types.Float32, default: 20.0 },
  },
) {
  private depthFeatureEnabled: boolean | undefined;

  // Depth data storage
  cpuDepthData: XRCPUDepthInformation[] = [];
  gpuDepthData: XRWebGLDepthInformation[] = [];
  private hasCurrentFrameDepthData = false;
  private depthTextures?: DepthTextures;

  // Occlusion
  private entityShaderMap = new Map<Entity, Set<ShaderUniforms>>();
  private readonly viewportSize = new Vector2();
  private preprocessingPass?: DepthPreprocessingPass;
  private minMaxEntityCount = 0;

  /**
   * Get the raw value to meters conversion factor.
   */
  get rawValueToMeters(): number {
    if (this.cpuDepthData.length) {
      return this.cpuDepthData[0].rawValueToMeters;
    } else if (this.gpuDepthData.length) {
      return this.gpuDepthData[0].rawValueToMeters;
    }
    return 0;
  }

  init(): void {
    const onSessionStart = () => {
      this.cleanup();
      this.updateEnabledFeatures(this.xrManager.getSession());
    };
    const onSessionEnd = () => {
      this.cleanup();
    };
    this.xrManager.addEventListener('sessionstart', onSessionStart);
    this.xrManager.addEventListener('sessionend', onSessionEnd);
    this.cleanupFuncs.push(() => {
      this.xrManager.removeEventListener('sessionstart', onSessionStart);
      this.xrManager.removeEventListener('sessionend', onSessionEnd);
    });

    // React to config changes. subscribe() returns an unsubscribe function;
    // register it for teardown so the callback (and its closure over `this`)
    // does not outlive the system.
    this.cleanupFuncs.push(
      this.config.enableDepthTexture.subscribe((enabled) => {
        if (enabled && !this.depthTextures) {
          this.initializeDepthTextures();
        }
      }),
    );

    this.cleanupFuncs.push(
      this.queries.occludables.subscribe(
        'qualify',
        (entity: Entity) => {
          this.attachOcclusionToEntity(entity);
          if (
            DepthOccludable.data.mode[entity.index] ===
            OcclusionShadersMode.MinMaxSoftOcclusion
          ) {
            this.minMaxEntityCount++;
          }
        },
        true,
      ),
      this.queries.occludables.subscribe('disqualify', (entity: Entity) => {
        if (
          DepthOccludable.data.mode[entity.index] ===
          OcclusionShadersMode.MinMaxSoftOcclusion
        ) {
          this.minMaxEntityCount--;
        }
        this.detachOcclusionFromEntity(entity);
      }),
    );

    // Release GPU-backed resources on system teardown. `depthTextures` is
    // created once (the enableDepthTexture subscription fires immediately) and
    // reused across XR sessions, so it must be disposed on destroy() rather
    // than in cleanup() (sessionend) — disposing it per session would leave a
    // subsequent session with no depth textures. preprocessingPass is normally
    // released in cleanup() on sessionend; dispose it here too in case the
    // system is torn down mid-session.
    this.cleanupFuncs.push(() => {
      this.clearAllOcclusionUniforms();
      this.depthTextures?.dispose();
      this.depthTextures = undefined;
      this.preprocessingPass?.dispose();
      this.preprocessingPass = undefined;
    });
  }

  private initializeDepthTextures(): void {
    this.depthTextures = new DepthTextures(this.config.useFloat32.value);
  }

  /**
   * Injects inline depth occlusion shader code into all materials of an entity.
   */
  private attachOcclusionToEntity(entity: Entity): void {
    const object3D = entity.object3D;
    if (!object3D) {
      return;
    }

    const entityUniforms = new Set<ShaderUniforms>();
    this.entityShaderMap.set(entity, entityUniforms);

    object3D.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      for (const material of materials) {
        if (!material) {
          continue;
        }
        material.transparent = true;
        addOnBeforeCompile(material, (shader: any) => {
          // Only inject occlusion if not already present
          if (!shader.uniforms.occlusionEnabled) {
            DepthSensingSystem.addOcclusionToShader(shader);
          }
          material.userData.shader = shader;
          entityUniforms.add(shader.uniforms);
        });
        material.needsUpdate = true;
      }
    });
  }

  private detachOcclusionFromEntity(entity: Entity): void {
    const entityUniforms = this.entityShaderMap.get(entity);

    if (entityUniforms) {
      this.clearOcclusionUniforms(entityUniforms);
    }

    this.entityShaderMap.delete(entity);
  }

  private clearOcclusionUniforms(
    entityUniforms: Iterable<ShaderUniforms>,
  ): void {
    for (const uniforms of entityUniforms) {
      uniforms.occlusionEnabled.value = false;
      uniforms.uXRDepthTextureArray.value = null;
      uniforms.uMinMaxTexture0.value = null;
      uniforms.uMinMaxTexture1.value = null;
    }
  }

  private clearAllOcclusionUniforms(): void {
    for (const entityUniforms of this.entityShaderMap.values()) {
      this.clearOcclusionUniforms(entityUniforms);
    }
  }

  /**
   * Modifies a material's shader in-place to incorporate inline depth-based
   * occlusion. Compares the virtual fragment's view-space depth against the
   * real-world depth from the XR depth texture array.
   * Both GPU-optimized (ExternalTexture) and CPU-optimized (DataArrayTexture)
   * paths use sampler2DArray with VIEW_ID for correct stereo depth sampling.
   * @param shader - The shader object provided by onBeforeCompile.
   */
  private static addOcclusionToShader(shader: Shader): void {
    shader.uniforms.occlusionEnabled = { value: false };
    shader.uniforms.uXRDepthTextureArray = { value: null };
    shader.uniforms.uRawValueToMeters = { value: 0.001 };
    shader.uniforms.uIsGPUDepth = { value: false };
    shader.uniforms.uDepthNear = { value: 0 };
    shader.uniforms.uViewportSize = { value: new Vector2() };
    shader.uniforms.uOcclusionBlurRadius = { value: 20.0 };
    shader.uniforms.uOcclusionHardMode = { value: false };
    shader.uniforms.uOcclusionMinMaxMode = { value: false };
    shader.uniforms.uMinMaxTexture0 = { value: null };
    shader.uniforms.uMinMaxTexture1 = { value: null };

    shader.defines = {
      ...(shader.defines ?? {}),
      USE_UV: true,
    };

    // Vertex shader: compute view-space depth for occlusion comparison
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        ['varying float vOcclusionViewDepth;', '#include <common>'].join('\n'),
      )
      .replace(
        '#include <fog_vertex>',
        [
          '#include <fog_vertex>',
          'vec4 occlusion_view_pos = modelViewMatrix * vec4(position, 1.0);',
          'vOcclusionViewDepth = -occlusion_view_pos.z;',
        ].join('\n'),
      );

    // Fragment shader: sample XR depth array and compare against virtual depth
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'uniform vec3 diffuse;',
        [
          'uniform vec3 diffuse;',
          'uniform bool occlusionEnabled;',
          'uniform float uRawValueToMeters;',
          'uniform bool uIsGPUDepth;',
          'uniform float uDepthNear;',
          'uniform vec2 uViewportSize;',
          'uniform float uOcclusionBlurRadius;',
          'uniform bool uOcclusionHardMode;',
          'uniform bool uOcclusionMinMaxMode;',
          'uniform sampler2D uMinMaxTexture0;',
          'uniform sampler2D uMinMaxTexture1;',
          'varying float vOcclusionViewDepth;',
          '',
          'uniform sampler2DArray uXRDepthTextureArray;',
          '',
          '// Fallback for non-multiview sessions',
          '#ifndef VIEW_ID',
          '#define VIEW_ID 0',
          '#endif',
          '',
          'float OcclusionDepthGetMeters(in vec2 uv) {',
          '  float textureValue = texture(uXRDepthTextureArray, vec3(uv.x, uv.y, float(VIEW_ID))).r;',
          '  if (uIsGPUDepth) {',
          '    return uRawValueToMeters * uDepthNear / (1.0 - textureValue);',
          '  }',
          '  return textureValue * uRawValueToMeters;',
          '}',
          '',
          'float OcclusionGetSample(in vec2 depthUV, in vec2 offset) {',
          '  float sampleDepth = OcclusionDepthGetMeters(depthUV + offset);',
          '  return smoothstep(0.0, 0.05, sampleDepth - vOcclusionViewDepth);',
          '}',
        ].join('\n'),
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        [
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          'if (occlusionEnabled) {',
          '  vec2 screenUV = gl_FragCoord.xy / uViewportSize;',
          '  vec2 depthUV = uIsGPUDepth ? screenUV : vec2(screenUV.x, 1.0 - screenUV.y);',
          '  float occlusion_value;',
          '  if (uOcclusionMinMaxMode) {',
          '    // MinMax soft occlusion — two-cluster edge-aware blending',
          '    vec4 mmData;',
          '    if (uint(VIEW_ID) == 0u) {',
          '      mmData = texture2D(uMinMaxTexture0, depthUV);',
          '    } else {',
          '      mmData = texture2D(uMinMaxTexture1, depthUV);',
          '    }',
          '    float minAvgDepth = mmData.r;',
          '    float maxAvgDepth = mmData.g;',
          '    float midAvgDepth = mmData.r + mmData.b;',
          '    float fadeRange = vOcclusionViewDepth * 0.04;',
          '    float fadeRangeInv = 1.0 / max(fadeRange, 0.001);',
          '    vec3 envDepths = vec3(minAvgDepth, maxAvgDepth, midAvgDepth);',
          '    vec3 occAlphas = clamp((envDepths - vOcclusionViewDepth) * fadeRangeInv, 0.0, 1.0);',
          '    occlusion_value = occAlphas.z;',
          '    float alphaDiff = occAlphas.y - occAlphas.x;',
          '    if (alphaDiff > 0.03) {',
          '      float denom = mmData.a;',
          '      float interp = denom > 0.001 ? mmData.b / denom : 0.5;',
          '      occlusion_value = mix(occAlphas.x, occAlphas.y, smoothstep(0.2, 0.8, interp));',
          '    }',
          '  } else if (uOcclusionHardMode) {',
          '    occlusion_value = OcclusionGetSample(depthUV, vec2(0.0));',
          '  } else {',
          '   vec2 texelSize = uOcclusionBlurRadius / uViewportSize;',
          '   // 13-tap two-ring sampling pattern for smooth occlusion edges',
          '   // Center sample',
          '   occlusion_value = OcclusionGetSample(depthUV, vec2(0.0));',
          '   // Inner ring: 6 samples at 40% radius, 60 degree intervals',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2( 0.4,  0.0));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2( 0.2,  0.346));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2(-0.2,  0.346));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2(-0.4,  0.0));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2(-0.2, -0.346));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2( 0.2, -0.346));',
          '   // Outer ring: 6 samples at full radius, offset 30 degrees',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2( 0.866,  0.5));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2( 0.0,    1.0));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2(-0.866,  0.5));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2(-0.866, -0.5));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2( 0.0,   -1.0));',
          '   occlusion_value += OcclusionGetSample(depthUV, texelSize * vec2( 0.866, -0.5));',
          '   occlusion_value /= 13.0;',
          '  }',
          '  if (occlusion_value < 0.01) {',
          '      discard;',
          '  }',
          '  diffuseColor.a *= occlusion_value;',
          '}',
        ].join('\n'),
      );
  }

  private cleanup(): void {
    this.depthFeatureEnabled = undefined;
    this.cpuDepthData = [];
    this.gpuDepthData = [];
    this.hasCurrentFrameDepthData = false;

    // The occlusion materials continue rendering after an immersive session
    // ends. Clear every session-owned texture before disposing the min/max
    // render targets, otherwise WebGL attempts to bind those deleted textures
    // in the non-immersive frame (and again when the next session starts).
    this.clearAllOcclusionUniforms();

    this.preprocessingPass?.dispose();
    this.preprocessingPass = undefined;
  }

  private updateEnabledFeatures(xrSession: XRSession | null): void {
    if (!xrSession) {
      return;
    }

    const enabledFeatures = xrSession.enabledFeatures;
    this.depthFeatureEnabled = enabledFeatures?.includes('depth-sensing');

    if (!this.depthFeatureEnabled) {
      console.log(
        'Warning: depth-sensing feature not enabled for WebXR session. Depth sensing features are disabled.',
      );
    }
  }

  update(): void {
    if (!this.depthFeatureEnabled) {
      return;
    }

    // XR depth information is frame-scoped. A runtime may temporarily return
    // no depth data while the session remains active, so never carry readiness
    // (or the public depth information objects) across animation frames.
    this.hasCurrentFrameDepthData = false;
    this.cpuDepthData.length = 0;
    this.gpuDepthData.length = 0;

    const frame = this.xrFrame;
    if (frame) {
      this.updateLocalDepth(frame);
    }

    if (!this.hasCurrentFrameDepthData) {
      this.clearAllOcclusionUniforms();
      return;
    }

    if (this.config.enableOcclusion.value) {
      this.runMinMaxPreprocessing();
      this.updateOcclusionUniforms();
    } else {
      this.clearAllOcclusionUniforms();
    }
  }

  /**
   * Runs the MinMax depth preprocessing pass if any entity uses MinMaxSoftOcclusion.
   * Renders a fullscreen pass per eye that computes min/max/avg depth in a 4×4
   * neighborhood, outputting to per-view 2D render targets.
   */
  private get isGPUDepth(): boolean {
    const session = this.xrManager.getSession();
    return session?.depthUsage === 'gpu-optimized';
  }

  private getDepthTextureArray(): Texture | undefined {
    if (!this.hasCurrentFrameDepthData) {
      return undefined;
    }

    return this.isGPUDepth
      ? this.depthTextures?.getNativeTexture()
      : this.depthTextures?.getDataArrayTexture();
  }

  private runMinMaxPreprocessing(): void {
    if (this.minMaxEntityCount === 0) {
      return;
    }

    const depthTextureArray = this.getDepthTextureArray();
    if (!depthTextureArray) {
      return;
    }

    const isGPUDepth = this.isGPUDepth;
    const depthNear =
      (this.gpuDepthData[0] as unknown as { depthNear: number } | undefined)
        ?.depthNear ?? 0;

    if (!this.preprocessingPass) {
      this.preprocessingPass = new DepthPreprocessingPass();
    }

    this.preprocessingPass.setDepthTexture(
      depthTextureArray,
      this.rawValueToMeters,
      isGPUDepth,
      depthNear,
    );

    // Determine depth texture dimensions
    let depthWidth: number;
    let depthHeight: number;
    if (this.cpuDepthData[0]) {
      depthWidth = this.cpuDepthData[0].width;
      depthHeight = this.cpuDepthData[0].height;
    } else if (this.gpuDepthData[0]) {
      // GPU depth textures have their own resolution (typically ~256×192),
      // which is much smaller than the drawing buffer.
      depthWidth = this.gpuDepthData[0].width;
      depthHeight = this.gpuDepthData[0].height;
    } else {
      return; // No depth data available
    }

    // Render preprocessing for both eyes
    this.preprocessingPass.render(this.renderer, depthWidth, depthHeight, 0);
    this.preprocessingPass.render(this.renderer, depthWidth, depthHeight, 1);
  }

  /**
   * Updates depth data from the XR frame.
   */
  private updateLocalDepth(frame: XRFrame): void {
    const session = frame.session;
    const binding = this.renderer.xr.getBinding();

    const xrRefSpace = this.renderer.xr.getReferenceSpace();
    if (xrRefSpace) {
      const pose = frame.getViewerPose(xrRefSpace);
      if (pose) {
        if (session.depthUsage === 'gpu-optimized') {
          // GPU path: the native texture is a texture array containing all
          // views. We only need to update the ExternalTexture once using the
          // first view's depth data.
          const view = pose.views[0];
          if (!view) {
            return;
          }
          const depthData = binding.getDepthInformation(view);
          if (depthData) {
            this.updateGPUDepthData(depthData);
            this.hasCurrentFrameDepthData = true;
          }
        } else {
          // CPU path: each view has its own DataTexture.
          const frameDepthData: XRCPUDepthInformation[] = [];
          for (let viewId = 0; viewId < pose.views.length; ++viewId) {
            const view = pose.views[viewId];
            const depthData = frame.getDepthInformation(view);
            if (!depthData) {
              return;
            }
            frameDepthData.push(depthData);
          }

          // Commit the stereo sample atomically. Updating one eye before the
          // other reports missing would create a mixed-frame depth texture.
          for (let viewId = 0; viewId < frameDepthData.length; ++viewId) {
            this.updateCPUDepthData(frameDepthData[viewId], viewId);
          }
          this.hasCurrentFrameDepthData = frameDepthData.length > 0;
        }
      }
    }
  }

  /**
   * Update with CPU-optimized depth data.
   */
  private updateCPUDepthData(
    depthData: XRCPUDepthInformation,
    viewId = 0,
  ): void {
    this.cpuDepthData[viewId] = depthData;

    if (this.config.enableDepthTexture.value && this.depthTextures) {
      this.depthTextures.updateData(depthData, viewId);
    }
  }

  /**
   * Update with GPU-optimized depth data.
   */
  private updateGPUDepthData(depthData: XRWebGLDepthInformation): void {
    this.gpuDepthData[0] = depthData;

    if (this.config.enableDepthTexture.value && this.depthTextures) {
      this.depthTextures.updateNativeTexture(depthData, this.renderer);
    }
  }

  /**
   * Updates depth texture uniforms on all occludable materials each frame.
   * Both GPU and CPU paths set the texture array uniform; the shader uses
   * VIEW_ID to select the correct stereo layer.
   */
  private updateOcclusionUniforms(): void {
    const depthTextureArray = this.getDepthTextureArray();
    if (!depthTextureArray) {
      this.clearAllOcclusionUniforms();
      return;
    }

    const isGPUDepth = this.isGPUDepth;
    const depthNear =
      (this.gpuDepthData[0] as unknown as { depthNear: number } | undefined)
        ?.depthNear ?? 0;

    this.renderer.getDrawingBufferSize(this.viewportSize);

    for (const [entity, entityUniforms] of this.entityShaderMap) {
      const isHardMode =
        DepthOccludable.data.mode[entity.index] ===
        OcclusionShadersMode.HardOcclusion;
      const isMinMaxMode =
        DepthOccludable.data.mode[entity.index] ===
        OcclusionShadersMode.MinMaxSoftOcclusion;

      for (const uniforms of entityUniforms) {
        uniforms.uXRDepthTextureArray.value = depthTextureArray;
        uniforms.uRawValueToMeters.value = this.rawValueToMeters;
        uniforms.uIsGPUDepth.value = isGPUDepth;
        uniforms.uDepthNear.value = depthNear;
        (uniforms.uViewportSize.value as Vector2).copy(this.viewportSize);
        uniforms.uOcclusionBlurRadius.value = this.config.blurRadius.value;
        uniforms.uOcclusionHardMode.value = isHardMode;
        uniforms.uOcclusionMinMaxMode.value = isMinMaxMode;
        uniforms.occlusionEnabled.value = this.config.enableOcclusion.value;

        if (isMinMaxMode && this.preprocessingPass) {
          uniforms.uMinMaxTexture0.value = this.preprocessingPass.getTexture(0);
          uniforms.uMinMaxTexture1.value = this.preprocessingPass.getTexture(1);
        }
      }
    }
  }
}
