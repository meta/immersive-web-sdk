/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createComponent } from '../ecs/component.js';
/**
 * Transient state tag indicating an entity is currently being grabbed.
 *
 * @remarks
 * - Managed by {@link GrabSystem}; do not add/remove this component manually.
 * - Added when a grab handle captures one or more pointers.
 * - Removed by the next {@link GrabSystem} update after the grab ends: when
 *   every pointer lets go, after {@link GrabSystem.forceRelease}, or when the
 *   grabbable component that created the entity's grab handle is removed.
 * - Often used to gate grab-state-specific logic (e.g. physics kinematic override).
 * - Works with {@link OneHandGrabbable}, {@link TwoHandsGrabbable}, and {@link DistanceGrabbable} entities.
 *
 * @category Grab
 * @hideineditor
 */
export const Grabbed = createComponent(
  'Grabbed',
  {},
  'A tag added by GrabSystem while the entity is actively grabbed.',
);
