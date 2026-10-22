/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import {
  createDomeGradientUniforms,
  createGradientMaterial,
  DOME_GRADIENT_FUNCTIONS_GLSL,
  GRADIENT_SHADER,
  GradientEnvironment,
} from '../../src/environment/gradient-environment.js';
import { BackSide, Color, Mesh } from '../../src/runtime/index.js';

// The 1.0.x dome vertex shader. Editor e2e checks and Quest multiview
// evidence depend on it staying byte-identical.
const B9_VERTEX_SHADER = `
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
  `;

// super-three's multiview prefix #defines these; declaring one breaks XR.
const MULTIVIEW_DEFINED = [
  'viewMatrix',
  'projectionMatrix',
  'modelViewMatrix',
  'normalMatrix',
];

function declaredIdentifiers(glsl: string): string[] {
  const declarations = [
    ...glsl.matchAll(
      /\b(?:uniform|varying|attribute|in|out)\s+\w+\s+(\w+)\s*(?:\[|;)/g,
    ),
    ...glsl.matchAll(
      /\b(?:float|int|bool|vec[234]|mat[234])\s+(\w+)\s*(?:[=;,)(])/g,
    ),
  ];
  return declarations.map((match) => match[1]);
}

describe('gradient environment background', () => {
  it('renders as a translation-free sky at clip-space depth', () => {
    expect(GRADIENT_SHADER.vertexShader).toContain('mat3(viewMatrix)');
    expect(GRADIENT_SHADER.vertexShader).toContain('clipPosition.xyww');
    expect(GRADIENT_SHADER.vertexShader).not.toContain('modelViewMatrix');

    const material = createGradientMaterial(
      0x112233,
      0x445566,
      0x778899,
      1,
      BackSide,
    );
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    material.dispose();
  });

  it('keeps the vertex shader byte-identical to 1.0.x', () => {
    expect(GRADIENT_SHADER.vertexShader).toBe(B9_VERTEX_SHADER);
  });

  it('builds the fragment from the shared gradient function without includes', () => {
    expect(GRADIENT_SHADER.fragmentShader).not.toContain('#include');
    expect(GRADIENT_SHADER.fragmentShader).toContain(
      DOME_GRADIENT_FUNCTIONS_GLSL,
    );
    expect(GRADIENT_SHADER.fragmentShader).toContain(
      'iwsdkGradientColor(vWorldDirection, gradientAxis, skyColor, equatorColor, groundColor)',
    );
    expect(GRADIENT_SHADER.fragmentShader).toContain(
      'ditherAmount * iwsdkDitherNoise()',
    );
    for (const name of ['skyColor', 'equatorColor', 'groundColor']) {
      expect(GRADIENT_SHADER.fragmentShader).toContain(`uniform vec3 ${name};`);
    }
  });

  it('defaults to an upright, undithered gradient with unchanged depth flags', () => {
    const material = createGradientMaterial(
      0x112233,
      0x445566,
      0x778899,
      0.5,
      BackSide,
    );
    expect(material.uniforms.gradientAxis.value.toArray()).toEqual([0, 1, 0]);
    expect(material.uniforms.ditherAmount.value).toBe(0);
    expect(material.uniforms.skyColor.value).toEqual(
      new Color(0x112233).multiplyScalar(0.5),
    );
    expect(material.side).toBe(BackSide);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    material.dispose();

    const front = createGradientMaterial(0x112233, 0x445566, 0x778899, 1);
    expect(front.depthTest).toBe(true);
    expect(front.depthWrite).toBe(true);
    front.dispose();
  });

  it('binds shared live uniforms by reference and writes the scaled colors', () => {
    const shared = createDomeGradientUniforms();
    shared.axis.value.set(0.6, 0.8, 0);
    shared.dither.value = 1;
    const material = createGradientMaterial(
      0x112233,
      0x445566,
      0x778899,
      2,
      BackSide,
      shared,
    );
    expect(material.uniforms.skyColor).toBe(shared.sky);
    expect(material.uniforms.equatorColor).toBe(shared.equator);
    expect(material.uniforms.groundColor).toBe(shared.ground);
    expect(material.uniforms.gradientAxis).toBe(shared.axis);
    expect(material.uniforms.ditherAmount).toBe(shared.dither);
    expect(shared.sky.value).toEqual(new Color(0x112233).multiplyScalar(2));
    expect(shared.axis.value.toArray()).toEqual([0.6, 0.8, 0]);
    expect(shared.dither.value).toBe(1);
    material.dispose();
  });

  it('keeps the IBL scene upright and undithered', () => {
    const environment = new GradientEnvironment(0x112233, 0x445566, 0x778899);
    const mesh = environment.children[0] as Mesh;
    const uniforms = (mesh.material as any).uniforms;
    expect(uniforms.gradientAxis.value.toArray()).toEqual([0, 1, 0]);
    expect(uniforms.ditherAmount.value).toBe(0);
    expect(uniforms.skyColor.value).toEqual(new Color(0x112233));
    environment.dispose();
  });

  it('declares no identifier that the multiview prefix defines', () => {
    const declared = [
      ...declaredIdentifiers(DOME_GRADIENT_FUNCTIONS_GLSL),
      ...declaredIdentifiers(GRADIENT_SHADER.fragmentShader),
      ...declaredIdentifiers(GRADIENT_SHADER.vertexShader),
    ];
    expect(declared).toEqual(
      expect.arrayContaining(['h', 'skyColor', 'vWorldDirection', 'color']),
    );
    for (const name of MULTIVIEW_DEFINED) {
      expect(declared).not.toContain(name);
      expect(DOME_GRADIENT_FUNCTIONS_GLSL).not.toContain(name);
      expect(GRADIENT_SHADER.fragmentShader).not.toContain(name);
    }
  });
});
