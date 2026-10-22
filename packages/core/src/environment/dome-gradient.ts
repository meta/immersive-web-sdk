/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent } from '../ecs/component.js';
/**
 * Procedural gradient background dome.
 *
 * @remarks
 * - Renders an inward-facing, translation-free sky sphere behind the scene.
 * - Clip-space depth keeps it independent of camera near/far planes.
 * - Colors are Unity‑style sky/equator/ground display colors; intensity
 *   multiplies all three, and `intensity: 0` renders black.
 * - `elevationDeg` and `azimuthDeg` tilt the sky pole away from straight up;
 *   azimuth uses a scene node's Y rotation convention (90 faces -X).
 * - `dither` adds ±0.5/255 screen noise against banding.
 * - Edits apply on the next frame. `_needsUpdate` is optional since 1.1.0;
 *   setting it forces a refresh.
 *
 * @category Environment & Lighting
 */
export const DomeGradient = createComponent(
  'DomeGradient',
  {
    sky: {
      type: Types.Color,
      default: [0.2423, 0.6172, 0.8308, 1.0],
      help: 'Color at the sky pole (straight up unless tilted). A display color: shown exactly as authored, never tone-mapped.',
      label: 'Sky color',
      widget: 'color',
    },
    equator: {
      type: Types.Color,
      default: [0.6584, 0.7084, 0.7913, 1.0],
      help: 'Color on the circle 90° from the sky pole (the horizon when not tilted).',
      label: 'Equator color',
      widget: 'color',
    },
    ground: {
      type: Types.Color,
      default: [0.807, 0.7758, 0.7454, 1.0],
      help: 'Color directly opposite the sky pole.',
      label: 'Ground color',
      widget: 'color',
    },
    intensity: {
      type: Types.Float32,
      default: 1.0,
      help: 'Multiplies all three colors. 0 is black; above 1 clips.',
      label: 'Intensity',
      min: 0,
      step: 0.05,
    },
    elevationDeg: {
      type: Types.Float32,
      default: 90,
      help: 'Height of the sky pole above the horizon. 90 is straight up (a classic sky); lower values tilt the bright end toward the azimuth.',
      label: 'Sky pole elevation (°)',
      max: 90,
      min: -90,
      step: 1,
      widget: 'slider',
    },
    azimuthDeg: {
      type: Types.Float32,
      default: 0,
      help: "Heading of the sky pole, using a node's Y rotation convention: 0 faces forward (-Z), 90 faces left (-X), -90 faces right (+X). No effect at elevation ±90.",
      label: 'Sky pole azimuth (°)',
      max: 180,
      min: -180,
      step: 1,
      widget: 'slider',
    },
    dither: {
      type: Types.Boolean,
      default: false,
      help: 'Adds ±0.5/255 screen noise so pale, low-contrast gradients do not band.',
      label: 'Dither',
    },
    /** Optional since 1.1.0: edits apply automatically. Setting it forces a refresh. */
    _needsUpdate: { type: Types.Boolean, default: true },
  },
  'Gradient sky behind the scene. Level root only; hidden during AR passthrough.',
);
