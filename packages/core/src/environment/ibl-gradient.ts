/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent } from '../ecs/component.js';

const IBL_COLOR_HELP =
  "Color of the gradient environment used for image-based lighting. Not a display color like DomeGradient's.";

/**
 * Image-based lighting from a procedural gradient (PMREM of a gradient scene).
 *
 * @remarks
 * - Only affects `scene.environment` and `scene.environmentIntensity`.
 * - `intensity` is applied once, as `scene.environmentIntensity`. 1.0.x
 *   applied it twice; square a 1.0.x value to keep its look.
 * - Edits apply on the next frame. `_needsUpdate` is optional since 1.1.0;
 *   setting it forces a refresh.
 *
 * @category Environment & Lighting
 */
export const IBLGradient = createComponent(
  'IBLGradient',
  {
    sky: {
      type: Types.Color,
      default: [0.6902, 0.749, 0.7843, 1.0],
      help: IBL_COLOR_HELP,
      label: 'Sky light',
      widget: 'color',
    },
    equator: {
      type: Types.Color,
      default: [0.6584, 0.7084, 0.7913, 1.0],
      help: IBL_COLOR_HELP,
      label: 'Equator light',
      widget: 'color',
    },
    ground: {
      type: Types.Color,
      default: [0.807, 0.7758, 0.7454, 1.0],
      help: IBL_COLOR_HELP,
      label: 'Ground light',
      widget: 'color',
    },
    intensity: {
      type: Types.Float32,
      default: 1.0,
      help: 'Strength of the environment lighting, applied once. 1.0.x applied it twice: use v² to keep a 1.0.x look.',
      label: 'Intensity',
      min: 0,
      step: 0.05,
    },
    /** Optional since 1.1.0: edits apply automatically. Setting it forces a refresh. */
    _needsUpdate: { type: Types.Boolean, default: true },
  },
  'Image-based lighting from a three-color gradient. Level root only; kept in AR.',
);
