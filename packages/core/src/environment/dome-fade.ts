/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent } from '../ecs/component.js';

/**
 * Fades a scene node's meshes into the level's {@link DomeGradient} sky with
 * horizontal distance from the node's origin.
 *
 * @remarks
 * - Put it on a floor or terrain node so the surface has no visible edge.
 * - Each faded mesh samples the live sky behind it from the camera, so the
 *   floor and the sky agree from every position.
 * - Does nothing without a visible DomeGradient (also while a DomeTexture wins);
 *   the faded meshes are hidden with the sky during AR passthrough.
 * - Supports MeshBasic, Lambert, Phong, Standard, Physical and Toon materials;
 *   other materials are left as they are and counted in render stats.
 *
 * @category Environment & Lighting
 */
export const DomeFade = createComponent(
  'DomeFade',
  {
    start: {
      type: Types.Float32,
      default: 4,
      help: "Horizontal distance from this node's origin where its meshes start blending into the sky behind them.",
      label: 'Fade start (m)',
      min: 0,
      step: 0.5,
    },
    end: {
      type: Types.Float32,
      default: 10,
      help: 'Distance where they show only the sky. Must be greater than Fade start.',
      label: 'Fade end (m)',
      min: 0,
      step: 0.5,
    },
  },
  "Fades this node's meshes into the level's DomeGradient sky with distance, so a floor has no visible edge. Does nothing without a DomeGradient; hidden with the sky during AR passthrough.",
);
