/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Object3D } from './three.js';

export type ScenePointerDescendants = {
  interactableDescendants?: Object3D[];
  rayDescendants?: Object3D[];
  touchDescendants?: Object3D[];
  /** Touch descendants each hand may poke (PokeInteractable.hand). */
  touchDescendantsByHand?: { left: Object3D[]; right: Object3D[] };
  grabDescendants?: Object3D[];
  screenSpaceDescendants?: Object3D[];
};
