/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BackSide,
  Color,
  FrontSide,
  MathUtils,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '../runtime/index.js';

/**
 * @internal Three-stop sky gradient and screen dither shared by the dome, the
 * IBL scene and DomeFade. It declares no identifier that super-three's
 * multiview prefix `#define`s, and needs no `#include`.
 */
export const DOME_GRADIENT_FUNCTIONS_GLSL = /* glsl */ `
vec3 iwsdkGradientColor(vec3 direction, vec3 axis, vec3 sky, vec3 equator, vec3 ground) {
  float h = dot(normalize(direction), axis);
  return h > 0.0 ? mix(equator, sky, h) : mix(equator, ground, -h);
}
float iwsdkDitherNoise() {
  return (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}
`;

/**
 * Gradient shader uniforms and code used for background domes and environments.
 * @category Environment & Lighting
 */
export const GRADIENT_SHADER = {
  vertexShader: /* glsl */ `
    varying vec3 vWorldDirection;
    void main() {
      // A sky is directional, not positional. Strip camera translation so the
      // dome follows every browser/XR camera without depending on its parent
      // transform, then pin it to clip-space depth to avoid near/far clipping.
      vec3 worldDirection = mat3(modelMatrix) * position;
      vWorldDirection = worldDirection;
      vec4 clipPosition = projectionMatrix
        * mat4(mat3(viewMatrix))
        * vec4(worldDirection, 1.0);
      gl_Position = clipPosition.xyww;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 skyColor;
    uniform vec3 equatorColor;
    uniform vec3 groundColor;
    uniform vec3 gradientAxis;   // (0,1,0) unless tilted
    uniform float ditherAmount;  // 0.0 or 1.0
    varying vec3 vWorldDirection;
    ${DOME_GRADIENT_FUNCTIONS_GLSL}
    void main() {
      vec3 color = iwsdkGradientColor(vWorldDirection, gradientAxis, skyColor, equatorColor, groundColor);
      color += ditherAmount * iwsdkDitherNoise();
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

/** @internal Live dome uniforms owned by one EnvironmentSystem (one per World). */
export interface DomeGradientUniforms {
  /** Final colors, already multiplied by intensity. */
  sky: { value: Color };
  equator: { value: Color };
  ground: { value: Color };
  axis: { value: Vector3 };
  /** 0 or 1. */
  dither: { value: number };
  /** 1 while a DomeGradient dome exists and is visible. */
  active: { value: number };
}

/** @internal */
export function createDomeGradientUniforms(): DomeGradientUniforms {
  return {
    sky: { value: new Color() },
    equator: { value: new Color() },
    ground: { value: new Color() },
    axis: { value: new Vector3(0, 1, 0) },
    dither: { value: 0 },
    active: { value: 0 },
  };
}

/** @internal Warn-once state for {@link domeGradientAxis}, one per system. */
export interface DomeGradientAxisWarning {
  warned: boolean;
}

/**
 * @internal Unit sky-pole direction. Same yaw handedness as scene rotationDeg[1].
 *
 * Non-finite angles fall back to 90 / 0 and warn once per `warning` state. At
 * an elevation of exactly ±90 the result is (0, ±1, 0) with no trigonometry,
 * so the default axis is bit-exact.
 */
export function domeGradientAxis(
  elevationDeg: number,
  azimuthDeg: number,
  out: Vector3,
  warning: DomeGradientAxisWarning = { warned: false },
): Vector3 {
  if (!Number.isFinite(elevationDeg) || !Number.isFinite(azimuthDeg)) {
    if (!warning.warned) {
      warning.warned = true;
      console.warn(
        `[EnvironmentSystem] DomeGradient elevationDeg/azimuthDeg must be finite (got ${elevationDeg}, ${azimuthDeg}); using 90 / 0.`,
      );
    }
    elevationDeg = Number.isFinite(elevationDeg) ? elevationDeg : 90;
    azimuthDeg = Number.isFinite(azimuthDeg) ? azimuthDeg : 0;
  }
  const elevation = MathUtils.clamp(elevationDeg, -90, 90);
  if (elevation === 90 || elevation === -90) {
    return out.set(0, elevation > 0 ? 1 : -1, 0);
  }
  const el = MathUtils.degToRad(elevation);
  const az = MathUtils.degToRad(azimuthDeg);
  return out.set(
    -Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  );
}

/**
 * Create a gradient material with Unity‑style sky/equator/ground colors.
 * @param skyHex Sky color as hex.
 * @param equatorHex Equator color as hex.
 * @param groundHex Ground color as hex.
 * @param intensity Intensity multiplier applied to all colors.
 * @param side Material side (BackSide for background dome; FrontSide for env scene).
 * @param shared Live uniforms to bind instead of fresh ones. The colors are
 *   written into them; the axis and dither are left as they are.
 * @category Environment & Lighting
 */
export function createGradientMaterial(
  skyHex: number,
  equatorHex: number,
  groundHex: number,
  intensity: number,
  side: typeof BackSide | typeof FrontSide = FrontSide,
  shared?: DomeGradientUniforms,
): ShaderMaterial {
  const uniforms = shared ?? createDomeGradientUniforms();
  uniforms.sky.value.setHex(skyHex).multiplyScalar(intensity);
  uniforms.equator.value.setHex(equatorHex).multiplyScalar(intensity);
  uniforms.ground.value.setHex(groundHex).multiplyScalar(intensity);
  return new ShaderMaterial({
    uniforms: {
      skyColor: uniforms.sky,
      equatorColor: uniforms.equator,
      groundColor: uniforms.ground,
      gradientAxis: uniforms.axis,
      ditherAmount: uniforms.dither,
    },
    vertexShader: GRADIENT_SHADER.vertexShader,
    fragmentShader: GRADIENT_SHADER.fragmentShader,
    side,
    depthWrite: side === BackSide ? false : true,
    depthTest: side === BackSide ? false : true,
  });
}

/**
 * A Scene containing a gradient sphere for PMREM processing.
 *
 * @remarks
 * Uses the same shader as the background dome to ensure coherent lighting.
 * @category Environment & Lighting
 */
export class GradientEnvironment extends Scene {
  constructor(
    skyHex: number = 0x87ceeb,
    equatorHex: number = 0xffa500,
    groundHex: number = 0x228b22,
    intensity: number = 1.0,
  ) {
    super();

    // Create gradient sphere using shared gradient material
    const geometry = new SphereGeometry(100, 32, 15);
    const material = createGradientMaterial(
      skyHex,
      equatorHex,
      groundHex,
      intensity,
      BackSide,
    );

    const gradientSphere = new Mesh(geometry, material);
    this.add(gradientSphere);
  }

  dispose(): void {
    const resources = new Set<any>();

    this.traverse((object: any) => {
      if (object.isMesh) {
        resources.add(object.geometry);
        resources.add(object.material);
      }
    });

    for (const resource of resources) {
      resource.dispose();
    }
  }
}
