/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent } from '../ecs/component.js';

/** Motion type for {@link PhysicsBody}. @category Physics */
export const PhysicsState = {
  /** Static bodies are bodies which never move. Use this motion type for your immovable objects like walls and floors.
   *  It would still affect other bodies in the engine. */
  Static: 'STATIC',
  /** Bodies which can move and respond to forces, collisions, and gravity.  */
  Dynamic: 'DYNAMIC',
  /** Kinematic bodies follow their Object3D: move or rotate it and the body sweeps there over the next physics steps.
   *  They push dynamic bodies out of the way but aren't affected by collisions, gravity, forces or `PhysicsManipulation`.  */
  Kinematic: 'KINEMATIC',
} as const;

export const DEFAULT_LINEAR_DAMPING = 0.0;
export const DEFAULT_ANGULAR_DAMPING = 0.0;
export const DEFAULT_GRAVITY_FACTOR = 1.0;

/**
 * Component for physics bodies. A physics body is a virtual object that represents a physical
 * object in a simulation.
 *
 * @remarks
 * - Static bodies are used for immovable objects like walls and floors.
 * - Dynamic bodies respond to forces, collisions, and gravity.
 * - Kinematic bodies follow their Object3D and don't respond to physics forces.
 * - Internal properties like `_engineBody` are managed automatically by {@link PhysicsSystem}.
 *
 * @example Add a dynamic physics body to an entity
 * ```ts
 * entity.addComponent(PhysicsBody, {
 *   state: PhysicsState.Dynamic
 * })
 * ```
 *
 * @category Physics
 * @see {@link PhysicsSystem}
 * @see {@link PhysicsShape}
 */
export const PhysicsBody = createComponent(
  'PhysicsBody',
  {
    /** The body's motion type in Physics Engine. {@link PhysicsState}  */
    state: {
      type: Types.Enum,
      enum: PhysicsState,
      default: PhysicsState.Dynamic,
    },
    /**
     * Linear velocity damping. Reactive: mutating it via
     * `setValue(PhysicsBody, 'linearDamping', ...)` after the body is created is
     * applied to the running simulation on the next frame.
     */
    linearDamping: { type: Types.Float32, default: 0.0 },
    /**
     * Angular velocity damping. Reactive: mutating it via
     * `setValue(PhysicsBody, 'angularDamping', ...)` after the body is created is
     * applied to the running simulation on the next frame.
     */
    angularDamping: { type: Types.Float32, default: 0.0 },
    /**
     * Per-body gravity multiplier (`0` floats, `1` is normal gravity). Reactive:
     * mutating it via `setValue(PhysicsBody, 'gravityFactor', ...)` after the body
     * is created is applied to the running simulation on the next frame.
     */
    gravityFactor: { type: Types.Float32, default: 1.0 },
    centerOfMass: { type: Types.Vec3, default: [Infinity, Infinity, Infinity] },
    _linearVelocity: { type: Types.Vec3, default: [0.0, 0.0, 0.0] },
    _angularVelocity: { type: Types.Vec3, default: [0.0, 0.0, 0.0] },
    _engineBody: { type: Types.Float64, default: 0 },
    _engineOffset: { type: Types.Float64, default: 0 },
    /**
     * Last `gravityFactor` value pushed to the engine. Internal shadow used by
     * the reactive sync to detect changes without reading back from Havok.
     */
    _engineGravityFactor: {
      type: Types.Float32,
      default: 1.0,
    },
    /**
     * Last `linearDamping` value pushed to the engine. Internal shadow used by
     * the reactive sync to detect changes without reading back from Havok.
     */
    _engineLinearDamping: {
      type: Types.Float32,
      default: 0.0,
    },
    /**
     * Last `angularDamping` value pushed to the engine. Internal shadow used by
     * the reactive sync to detect changes without reading back from Havok.
     */
    _engineAngularDamping: {
      type: Types.Float32,
      default: 0.0,
    },
  },
  'Component to define physics behavior of an entity.',
);
