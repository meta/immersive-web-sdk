/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Material } from '../runtime/three.js';

type OnBeforeCompile = Material['onBeforeCompile'];

/**
 * Run `inject` after a material's existing `onBeforeCompile`.
 *
 * Most materials keep a plain `onBeforeCompile` property, so the existing
 * callback is wrapped. Some own the property and chain an assigned callback
 * themselves: troika-three-text's derived materials always return their own
 * handler from the getter and call the assigned function from it. Wrapping
 * that handler would make it call itself forever, so for those materials
 * `inject` is assigned on its own.
 *
 * @internal
 */
export function addOnBeforeCompile(
  material: Material,
  inject: OnBeforeCompile,
): void {
  const existing = material.onBeforeCompile;
  const chained: OnBeforeCompile = function (this: Material, shader, renderer) {
    existing?.call(this, shader, renderer);
    inject.call(this, shader, renderer);
  };
  material.onBeforeCompile = chained;
  if (material.onBeforeCompile !== chained) {
    material.onBeforeCompile = inject;
  }
}
