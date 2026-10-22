/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { domeGradientAxis } from '../../src/environment/gradient-environment.js';
import { Vector3 } from '../../src/runtime/index.js';

function expectVector(actual: Vector3, expected: [number, number, number]) {
  expect(actual.x).toBeCloseTo(expected[0], 12);
  expect(actual.y).toBeCloseTo(expected[1], 12);
  expect(actual.z).toBeCloseTo(expected[2], 12);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('domeGradientAxis', () => {
  it('is exactly vertical at elevation ±90 for any azimuth', () => {
    for (const azimuth of [0, 37, -180, 180, 1e6]) {
      expect(domeGradientAxis(90, azimuth, new Vector3()).toArray()).toEqual([
        0, 1, 0,
      ]);
      expect(domeGradientAxis(-90, azimuth, new Vector3()).toArray()).toEqual([
        0, -1, 0,
      ]);
    }
  });

  it('clamps elevation to ±90', () => {
    expect(domeGradientAxis(135, 20, new Vector3()).toArray()).toEqual([
      0, 1, 0,
    ]);
    expect(domeGradientAxis(-400, 20, new Vector3()).toArray()).toEqual([
      0, -1, 0,
    ]);
  });

  it('uses the scene rotationDeg yaw handedness', () => {
    // Elevation 0, azimuth 0 faces forward (-Z); +90 turns -Z toward -X.
    expectVector(domeGradientAxis(0, 0, new Vector3()), [0, 0, -1]);
    expectVector(domeGradientAxis(0, 90, new Vector3()), [-1, 0, 0]);
    expectVector(domeGradientAxis(0, -90, new Vector3()), [1, 0, 0]);
    expectVector(domeGradientAxis(0, 180, new Vector3()), [0, 0, 1]);
    const axis = domeGradientAxis(30, 45, new Vector3());
    expect(axis.length()).toBeCloseTo(1, 12);
    expect(axis.y).toBeCloseTo(0.5, 12);
  });

  it('matches the starter axis at 24 / -31 within 0.18°', () => {
    const starter = new Vector3(0.49, 0.42, -0.81).normalize();
    const axis = domeGradientAxis(24, -31, new Vector3());
    const degrees = (axis.angleTo(starter) * 180) / Math.PI;
    expect(degrees).toBeLessThan(0.18);
  });

  it('falls back to 90 / 0 for non-finite input and warns once per state', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const warning = { warned: false };
    expect(
      domeGradientAxis(Number.NaN, 30, new Vector3(), warning).toArray(),
    ).toEqual([0, 1, 0]);
    expectVector(
      domeGradientAxis(0, Number.POSITIVE_INFINITY, new Vector3(), warning),
      [0, 0, -1],
    );
    expect(
      domeGradientAxis(
        Number.NaN,
        Number.NaN,
        new Vector3(),
        warning,
      ).toArray(),
    ).toEqual([0, 1, 0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warning.warned).toBe(true);

    domeGradientAxis(Number.NaN, 0, new Vector3(), { warned: false });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
