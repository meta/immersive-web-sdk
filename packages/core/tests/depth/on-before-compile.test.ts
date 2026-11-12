/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { addOnBeforeCompile } from '../../src/depth/on-before-compile.js';
import { Material, MeshBasicMaterial } from '../../src/runtime/three.js';

// runtime barrel -> xr-input cursor-visual.ts touches `document` at module
// load; provide a minimal canvas stub before importing.
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

const shader = { uniforms: {} } as any;
const renderer = {} as any;

/**
 * A material that owns `onBeforeCompile` the way troika-three-utils'
 * createDerivedMaterial does: the getter always returns its own handler,
 * the setter stores the assigned callback, and the handler calls it last.
 */
function createDerivedLikeMaterial(calls: string[]): Material {
  const material = new MeshBasicMaterial();
  let assigned: Material['onBeforeCompile'] | undefined;
  const own: Material['onBeforeCompile'] = function (this: Material, s, r) {
    calls.push('derived');
    assigned?.call(this, s, r);
  };
  Object.defineProperty(material, 'onBeforeCompile', {
    get: () => own,
    set: (fn) => {
      assigned = fn;
    },
  });
  return material;
}

describe('addOnBeforeCompile', () => {
  it('runs an existing callback first, then the injection, on the material', () => {
    const calls: string[] = [];
    const material = new MeshBasicMaterial();
    material.onBeforeCompile = function (this: Material) {
      calls.push(this === material ? 'existing' : 'wrong this');
    };

    addOnBeforeCompile(material, function (this: Material, s) {
      calls.push(this === material && s === shader ? 'inject' : 'wrong args');
    });
    material.onBeforeCompile(shader, renderer);

    expect(calls).toEqual(['existing', 'inject']);
  });

  it('injects into a material with the default onBeforeCompile', () => {
    const inject = vi.fn();
    const material = new MeshBasicMaterial();

    addOnBeforeCompile(material, inject);
    material.onBeforeCompile(shader, renderer);

    expect(inject).toHaveBeenCalledOnce();
    expect(inject).toHaveBeenCalledWith(shader, renderer);
  });

  it('does not recurse on materials that chain the assigned callback (#60)', () => {
    const calls: string[] = [];
    const material = createDerivedLikeMaterial(calls);

    addOnBeforeCompile(material, () => {
      calls.push('inject');
    });
    // Before the fix this overflowed the stack.
    material.onBeforeCompile(shader, renderer);

    expect(calls).toEqual(['derived', 'inject']);
  });
});
