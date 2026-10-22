/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// New split components and system
export { DomeTexture } from './dome-texture.js';
export { DomeGradient } from './dome-gradient.js';
export { DomeFade } from './dome-fade.js';
export { IBLTexture } from './ibl-texture.js';
export { IBLGradient } from './ibl-gradient.js';
export { EnvironmentSystem } from './environment-system.js';
/** @internal */
export type { DomeGradientUniforms } from './gradient-environment.js';
/** @internal */
export {
  DomeFadeBinding,
  domeFadeSpecFromComponentValue,
  type DomeFadeInactiveReason,
  type DomeFadeMarker,
  type DomeFadeSpec,
} from './dome-fade-binding.js';
