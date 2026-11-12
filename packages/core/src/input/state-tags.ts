/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Import from the leaf module rather than '../ecs/index.js': the barrel pulls
// in builtin-components, which imports this file, forming a cycle.
import { Types, createComponent } from '../ecs/component.js';

/**
 * Marks an entity as eligible for ray-based pointer interaction.
 *
 * @remarks
 * - The {@link InputSystem} discovers all entities with `RayInteractable` and
 *   registers their Object3D roots as raycast targets.
 * - Used for UI elements, buttons, and clickable objects interacted via ray pointer.
 * - When a pointer enters/leaves or presses/releases on the entity, the system
 *   adds/removes the transient tags {@link Hovered} and {@link Pressed}.
 *
 * @category Input
 * @example Highlight on hover
 * ```ts
 * export class HighlightSystem extends createSystem({ items: { required: [RayInteractable] } }) {
 *   update() {
 *     this.queries.items.entities.forEach(e => {
 *       e.object3D.material.emissiveIntensity = e.hasComponent(Hovered) ? 1.0 : 0.0;
 *     });
 *   }
 * }
 * ```
 */
export const RayInteractable = createComponent(
  'RayInteractable',
  {},
  'Marks an entity as eligible for ray-based pointer interaction.',
);

/**
 * Which hands can poke a {@link PokeInteractable}.
 *
 * @category Input
 */
export const PokeHand = {
  /** Either hand or controller. */
  Both: 'both',
  /** Only the left hand or controller. */
  Left: 'left',
  /** Only the right hand or controller. */
  Right: 'right',
} as const;

/**
 * Marks an entity as eligible for poke/touch interaction.
 *
 * @remarks
 * - Used for UI elements that can be poked/touched with finger or controller.
 * - Auto-selects when finger crosses the surface (distance <= 0).
 * - Uses hysteresis (separate enter/exit thresholds) to prevent flickering.
 * - `hand` limits poking to one hand, for example a wrist menu on the left
 *   hand that only the right index finger should press.
 *
 * @category Input
 * @example Create a pokeable button
 * ```ts
 * entity.addComponent(PokeInteractable);
 * ```
 * @example Let only the right hand press a wrist-mounted menu
 * ```ts
 * entity.addComponent(PokeInteractable, { hand: PokeHand.Right });
 * ```
 */
export const PokeInteractable = createComponent(
  'PokeInteractable',
  {
    /** Hands that can poke this entity. More details in {@link PokeHand}. */
    hand: { type: Types.Enum, enum: PokeHand, default: PokeHand.Both },
  },
  'Marks an entity as eligible for poke/touch interaction.',
);

/**
 * A transient tag set while a pointer is intersecting an interactable.
 *
 * @remarks
 * - Managed by {@link InputSystem}; do not add/remove this component manually.
 * - Use as a declarative condition for hover effects, tooltips, or affordances.
 * - Works with both RayInteractable and PokeInteractable entities.
 *
 * @category Input
 * @hideineditor
 */
export const Hovered = createComponent(
  'Hovered',
  {},
  'A tag added by InputSystem while a pointer is hovering over the entity.',
);

/**
 * A transient tag set while a pointer is actively pressing an interactable.
 *
 * @remarks
 * - Managed by {@link InputSystem}; do not add/remove this component manually.
 * - Often used to gate activation logic or pressed-state visuals.
 * - Works with both RayInteractable and PokeInteractable entities.
 *
 * @category Input
 * @hideineditor
 */
export const Pressed = createComponent(
  'Pressed',
  {},
  'A tag added by InputSystem while the entity is actively pressed.',
);

/**
 * @deprecated Use `RayInteractable` instead. This will be removed in a future version.
 */
export const Interactable = RayInteractable;
