/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import {
  DOME_GRADIENT_FUNCTIONS_GLSL,
  domeGradientAxis,
} from '../../src/environment/gradient-environment.js';
import { Vector3 } from '../../src/runtime/index.js';

type Vec3 = [number, number, number];

// CPU ports of the GLSL. mix() is GLSL's x * (1 - a) + y * a.
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] * (1 - t) + b[0] * t,
  a[1] * (1 - t) + b[1] * t,
  a[2] * (1 - t) + b[2] * t,
];
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const normalize = (v: Vec3): Vec3 => {
  const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Port of DOME_GRADIENT_FUNCTIONS_GLSL's iwsdkGradientColor. */
function iwsdkGradientColor(
  direction: Vec3,
  axis: Vec3,
  sky: Vec3,
  equator: Vec3,
  ground: Vec3,
): Vec3 {
  const h = dot(normalize(direction), axis);
  return h > 0 ? mix(equator, sky, h) : mix(equator, ground, -h);
}

/** The 1.0.x dome fragment: `h = normalize(dir).y` with an if/else. */
function legacyDomeColor(
  direction: Vec3,
  sky: Vec3,
  equator: Vec3,
  ground: Vec3,
): Vec3 {
  const h = normalize(direction)[1];
  if (h > 0) {
    return mix(equator, sky, h);
  }
  return mix(equator, ground, -h);
}

// The Clay Studio starter's hand-built sky (D123034692, studio.ts studioSky):
// a clamped two-mix over t = dot * 0.5 + 0.5 along a tilted axis.
const STARTER_AXIS: Vec3 = [0.49, 0.42, -0.81];
const STARTER_GROUND: Vec3 = [0.902, 0.855, 0.82];
const STARTER_EQUATOR: Vec3 = [0.808, 0.855, 0.91];
const STARTER_SKY: Vec3 = [0.843, 0.796, 0.882];

function studioSky(direction: Vec3): Vec3 {
  const t = dot(normalize(direction), normalize(STARTER_AXIS)) * 0.5 + 0.5;
  const low = mix(STARTER_GROUND, STARTER_EQUATOR, clamp(t * 2, 0, 1));
  return mix(low, STARTER_SKY, clamp(t * 2 - 1, 0, 1));
}

/** Deterministic directions, uniform on the sphere (mulberry32). */
function* randomDirections(count: number, seed: number): Generator<Vec3> {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = 0; index < count; index += 1) {
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(1 - z * z);
    yield [radius * Math.cos(angle), radius * Math.sin(angle), z];
  }
}

function maxChannelError(a: Vec3, b: Vec3): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  );
}

describe('DomeGradient parity', () => {
  it('ports the shader function this test checks', () => {
    expect(DOME_GRADIENT_FUNCTIONS_GLSL).toContain(
      'float h = dot(normalize(direction), axis);',
    );
    expect(DOME_GRADIENT_FUNCTIONS_GLSL).toContain(
      'return h > 0.0 ? mix(equator, sky, h) : mix(equator, ground, -h);',
    );
  });

  it("equals the starter's studioSky on the exact starter axis", () => {
    const axis = normalize(STARTER_AXIS);
    let maxError = 0;
    for (const direction of randomDirections(100_000, 1)) {
      maxError = Math.max(
        maxError,
        maxChannelError(
          iwsdkGradientColor(
            direction,
            axis,
            STARTER_SKY,
            STARTER_EQUATOR,
            STARTER_GROUND,
          ),
          studioSky(direction),
        ),
      );
    }
    expect(maxError).toBeLessThan(1e-12);
  });

  it('stays within 0.1/255 of studioSky with the authored 24 / -31 axis', () => {
    const axis = domeGradientAxis(24, -31, new Vector3()).toArray() as Vec3;
    let maxError = 0;
    for (const direction of randomDirections(100_000, 2)) {
      maxError = Math.max(
        maxError,
        maxChannelError(
          iwsdkGradientColor(
            direction,
            axis,
            STARTER_SKY,
            STARTER_EQUATOR,
            STARTER_GROUND,
          ),
          studioSky(direction),
        ),
      );
    }
    expect(maxError).toBeLessThanOrEqual(0.1 / 255);
  });

  it('reproduces the 1.0.x .y formula exactly on the default axis', () => {
    const axis = domeGradientAxis(90, 0, new Vector3()).toArray() as Vec3;
    const sky: Vec3 = [0.2423, 0.6172, 0.8308];
    const equator: Vec3 = [0.6584, 0.7084, 0.7913];
    const ground: Vec3 = [0.807, 0.7758, 0.7454];
    const directions = [
      ...randomDirections(100_000, 3),
      [1, 0, 0] as Vec3,
      [0, 0, -1] as Vec3,
      [0, 1, 0] as Vec3,
      [0, -1, 0] as Vec3,
    ];
    let mismatches = 0;
    for (const direction of directions) {
      const actual = iwsdkGradientColor(direction, axis, sky, equator, ground);
      const expected = legacyDomeColor(direction, sky, equator, ground);
      if (
        actual[0] !== expected[0] ||
        actual[1] !== expected[1] ||
        actual[2] !== expected[2]
      ) {
        mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });
});
