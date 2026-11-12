/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { DepthTextures } from '../../src/depth/depth-textures.js';

// depth-textures.ts -> runtime barrel -> xr-input cursor-visual.ts touches
// `document` at module load; provide a minimal canvas stub before importing.
vi.hoisted(() => {
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => ({
        arc: () => {},
        beginPath: () => {},
        clearRect: () => {},
        fill: () => {},
        fillStyle: '',
        lineWidth: 0,
        stroke: () => {},
        strokeStyle: '',
      }),
      height: 0,
      width: 0,
    }),
  };
});

const TEXTURE0 = 0x84c0;
const ACTIVE_TEXTURE = 0x84e0;
const TEXTURE_2D_ARRAY = 0x8c1a;
const TEXTURE_BINDING_2D_ARRAY = 0x8c1d;

/** A WebGL2 context that only tracks texture units and their array bindings. */
function fakeRenderer(maxTextures: number) {
  const units: unknown[] = new Array(maxTextures).fill(null);
  let active = 0;
  const gl = {
    TEXTURE0,
    ACTIVE_TEXTURE,
    TEXTURE_2D_ARRAY,
    TEXTURE_BINDING_2D_ARRAY,
    activeTexture: vi.fn((unit: number) => {
      active = unit - TEXTURE0;
    }),
    bindTexture: vi.fn((target: number, texture: unknown) => {
      if (target === TEXTURE_2D_ARRAY) {
        units[active] = texture;
      }
    }),
    getParameter: vi.fn((name: number) => {
      if (name === ACTIVE_TEXTURE) {
        return TEXTURE0 + active;
      }
      if (name === TEXTURE_BINDING_2D_ARRAY) {
        return units[active];
      }
      return null;
    }),
  };
  const properties = new Map<unknown, Record<string, unknown>>();
  const renderer = {
    getContext: () => gl,
    capabilities: { maxTextures },
    properties: {
      get: (object: unknown) => {
        if (!properties.has(object)) {
          properties.set(object, {});
        }
        return properties.get(object)!;
      },
    },
  };
  return {
    gl,
    units,
    renderer: renderer as any,
    setActive: (unit: number) => (active = unit),
    getActive: () => active,
  };
}

describe('DepthTextures GPU depth binding', () => {
  it('re-binds the depth texture on every unit that holds it, and restores the active unit', () => {
    const { gl, units, renderer, setActive, getActive } = fakeRenderer(8);
    const depth = { name: 'xr-depth' } as unknown as WebGLTexture;
    const other = { name: 'other' };
    // three.js bound the depth texture on units 0 and 3 in earlier frames.
    units[0] = depth;
    units[3] = depth;
    units[5] = other;
    setActive(5);

    new DepthTextures(false).updateNativeTexture(
      { texture: depth } as unknown as XRWebGLDepthInformation,
      renderer,
    );

    const rebinds = gl.bindTexture.mock.calls.filter(
      ([target, texture]) => target === TEXTURE_2D_ARRAY && texture === depth,
    );
    expect(rebinds).toHaveLength(2);
    expect(units).toEqual([depth, null, null, depth, null, other, null, null]);
    expect(getActive()).toBe(5);
    expect(gl.bindTexture).not.toHaveBeenCalledWith(TEXTURE_2D_ARRAY, other);
  });

  it('binds nothing when no unit holds the depth texture yet', () => {
    const { gl, renderer, getActive } = fakeRenderer(4);
    new DepthTextures(false).updateNativeTexture(
      { texture: {} } as unknown as XRWebGLDepthInformation,
      renderer,
    );
    expect(gl.bindTexture).not.toHaveBeenCalled();
    expect(getActive()).toBe(0);
  });
});
