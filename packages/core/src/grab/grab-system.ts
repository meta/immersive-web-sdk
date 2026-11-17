/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HandleStore } from '@pmndrs/handle';
import { PointerEventsMap } from '@pmndrs/pointer-events';
import { Types } from '../ecs/component.js';
import { Entity } from '../ecs/entity.js';
import { createSystem } from '../ecs/system.js';
import { LevelTag } from '../level/index.js';
import {
  Object3D,
  Object3DEventMap,
  Vector3,
  Quaternion,
} from '../runtime/index.js';
import { DistanceGrabbable } from './distance-grabbable.js';
import { cancelGrabHandle, findHolderHand } from './grab-helpers.js';
import { warnIfNoRaycastableMesh } from './grab-warnings.js';
import { Grabbed } from './grabbed.js';
import { DistanceGrabHandle, MovementMode, Handle } from './handles.js';
import { OneHandGrabbable } from './one-hand-grabbable.js';
import { TwoHandsGrabbable } from './two-hands-grabbable.js';

/**
 * Manages interactive object grabbing and manipulation for VR/AR experiences.
 *
 * @remarks
 * - Uses the `@pmndrs/handle` library for precise multitouch manipulation.
 * - Automatically creates handle instances for entities with grabbable components.
 * - Supports three types of grab interactions: one‑hand, two‑hand, and distance grabbing.
 * - Automatically cleans up handle instances when grabbable components are removed.
 *
 * @example Basic grab system setup
 * ```ts
 * // Add to your world to enable grab interactions
 * world.addSystem(GrabSystem)
 *
 * // Create a grabbable box
 * const box = world.createEntity()
 * box.addComponent(OneHandGrabbable, {})
 * ```
 *
 * @example Two‑handed manipulation
 * ```ts
 * // Create an object that can be scaled with two hands
 * const sculpture = world.createEntity()
 * sculpture.addComponent(TwoHandsGrabbable, {
 *   scaleMin: [0.5, 0.5, 0.5],
 *   scaleMax: [3, 3, 3]
 * })
 * ```
 *
 * @category Grab
 * @see {@link OneHandGrabbable}
 * @see {@link TwoHandsGrabbable}
 * @see {@link DistanceGrabbable}
 */
export class GrabSystem extends createSystem(
  {
    oneHandGrabbables: {
      required: [OneHandGrabbable],
    },
    twoHandsGrabbables: {
      required: [TwoHandsGrabbable],
    },
    distanceGrabbables: {
      required: [DistanceGrabbable],
    },
    handles: {
      required: [Handle],
    },
  },
  {
    /**
     * Controls whether hand pinch gestures are forwarded as squeeze events for grab interactions.
     * Set to `false` to disable pinch-to-grab and require the physical squeeze button instead.
     * @default true
     */
    useHandPinchForGrab: { type: Types.Boolean, default: true },
  },
) {
  /** Which grabbable component created each entity's Handle, by entity index. */
  private handleSources = new Map<number, GrabbableComponent>();

  private handleBindings = new WeakMap<Entity, () => void>();

  init() {
    // Ensure Handle component is registered in the world before queries rely on it
    if (!Handle.bitmask) {
      this.world.registerComponent(Handle);
    }
    if (!Grabbed.bitmask) {
      this.world.registerComponent(Grabbed);
    }

    // Reactive handle creation per grabbable type
    this.queries.oneHandGrabbables.subscribe('qualify', (entity) => {
      this.initializeOneHandHandle(entity);
    });
    this.queries.twoHandsGrabbables.subscribe('qualify', (entity) => {
      this.initializeTwoHandsHandle(entity);
    });
    this.queries.distanceGrabbables.subscribe('qualify', (entity) => {
      this.initializeDistanceHandle(entity);
    });

    // Removing the grabbable that created the Handle removes the Handle too,
    // which restores the object's pointer events (its ray was denied while
    // grabbable). Another grabbable left on the entity gets its own Handle.
    this.queries.oneHandGrabbables.subscribe('disqualify', (entity) =>
      this.releaseHandle(entity, OneHandGrabbable),
    );
    this.queries.twoHandsGrabbables.subscribe('disqualify', (entity) =>
      this.releaseHandle(entity, TwoHandsGrabbable),
    );
    this.queries.distanceGrabbables.subscribe('disqualify', (entity) =>
      this.releaseHandle(entity, DistanceGrabbable),
    );

    // Unified cleanup for any handle
    this.queries.handles.subscribe('disqualify', (entity) => {
      this.handleSources.delete(entity.index);
      const h = Handle.data.instance[entity.index] as
        | HandleStore<unknown>
        | undefined;
      if (h) {
        try {
          this.handleBindings.get(entity)?.();
          h.cancel();
        } catch {}
      }
      this.handleBindings.delete(entity);
      if (entity.object3D) {
        entity.object3D.pointerEventsType = 'all';
      }
    });

    // Initial pass for already-eligible entities (qualify doesn't fire retroactively)
    this.queries.oneHandGrabbables.entities.forEach((e) =>
      this.initializeOneHandHandle(e),
    );
    this.queries.twoHandsGrabbables.entities.forEach((e) =>
      this.initializeTwoHandsHandle(e),
    );
    this.queries.distanceGrabbables.entities.forEach((e) =>
      this.initializeDistanceHandle(e),
    );

    // Enable grab sub-pointer per hand when GrabSystem is active
    this.input.xr.multiPointers.left.toggleSubPointer('grab', true);
    this.input.xr.multiPointers.right.toggleSubPointer('grab', true);
  }

  update(delta: number, time: number): void {
    // Forward hand pinch events to squeeze for grab interactions
    // Only forward if the system-level useHandPinchForGrab flag is enabled
    if (this.config.useHandPinchForGrab.value) {
      (['left', 'right'] as const).forEach((handedness) => {
        if (this.input.xr.isPrimary('hand', handedness)) {
          const timeStamp = time * 1000;
          // Hand sources without a Gamepad report pinch through session
          // select events, which the input manager folds into this state.
          const select = this.input.xr.getSelectState(handedness);
          if (select.start) {
            this.input.xr.multiPointers[handedness].routeDown(
              'squeeze',
              'grab',
              {
                timeStamp,
              },
            );
          }
          if (select.end) {
            this.input.xr.multiPointers[handedness].routeUp('squeeze', 'grab', {
              timeStamp,
            });
          }
        }
      });
    }

    // Unified handle updates
    this.queries.handles.entities.forEach((entity) => {
      const h = Handle.data.instance[entity.index] as
        | HandleStore<unknown>
        | undefined;
      if (h) {
        h.update(delta);
        // Manage Grabbed tag based on active grab state
        if (h.inputState.size > 0) {
          if (!entity.hasComponent(Grabbed)) {
            entity.addComponent(Grabbed);
          }
        } else if (entity.hasComponent(Grabbed)) {
          entity.removeComponent(Grabbed);
        }
      }
    });
  }

  /**
   * Force-release `entity` if it is currently being held.
   *
   * @remarks
   * Cancels every active pointer on the entity's grab handle, which causes
   * `update()` on the next frame to remove the {@link Grabbed} tag. Safe to
   * call when the entity is not held or has never been grabbable — a no-op
   * in those cases.
   *
   * Useful for game-state changes that need to drop held items: level resets,
   * weapon swaps, death/respawn, cinematics, etc.
   *
   * @example
   * ```ts
   * const grab = world.getSystem(GrabSystem);
   * grab.forceRelease(weaponEntity);
   * ```
   */
  forceRelease(entity: Entity): void {
    cancelGrabHandle(
      Handle.data.instance[entity.index] as HandleStore<unknown> | undefined,
    );
  }

  /**
   * Identify which controller is currently holding `entity`.
   *
   * @returns `'left'` or `'right'` when a single hand holds the entity,
   * `null` when the entity is not held (or has no grab handle).
   *
   * @remarks
   * For two-handed grabs (both controllers active on the same entity), the
   * left hand is reported. Callers needing per-hand state for two-handed
   * interactions should track grab/release events themselves rather than
   * polling this method.
   *
   * Useful for hand-aware behaviors: recoil/animation that should react to
   * the holding controller, hand-specific UI prompts, etc.
   *
   * @example
   * ```ts
   * const grab = world.getSystem(GrabSystem);
   * const hand = grab.getHolderHand(gunEntity);
   * if (hand) {
   *   playRecoilOn(hand);
   * }
   * ```
   */
  getHolderHand(entity: Entity): 'left' | 'right' | null {
    const left = this.input.xr.multiPointers.left;
    const right = this.input.xr.multiPointers.right;
    const gaze = this.input.xr.gazePointer;
    return findHolderHand(
      Handle.data.instance[entity.index] as HandleStore<unknown> | undefined,
      // Near grabs capture via the `grab` sub-pointer; distance grabs capture
      // via `ray` (see `initializeDistanceHandle` setting
      // `pointerEventsType = { deny: 'grab' }`). Check both per hand so
      // distance-held entities don't silently report `null`.
      [left.getPointer('grab').id, left.getPointer('ray').id],
      [right.getPointer('grab').id, right.getPointer('ray').id],
      gaze.pointer.id,
      gaze.getHeldByHand(),
    );
  }

  private initializeOneHandHandle(entity: Entity) {
    if (entity.hasComponent(Handle)) {
      return;
    }
    const object = entity.object3D;
    if (!(object instanceof Object3D)) {
      return;
    }
    warnIfNoRaycastableMesh(entity, 'OneHandGrabbable');
    const obj = object as Object3D<PointerEventsMap & Object3DEventMap>;
    const rotateMax = entity.getVectorView(OneHandGrabbable, 'rotateMax');
    const rotateMin = entity.getVectorView(OneHandGrabbable, 'rotateMin');
    const translateMax = entity.getVectorView(OneHandGrabbable, 'translateMax');
    const translateMin = entity.getVectorView(OneHandGrabbable, 'translateMin');
    const handle = new HandleStore(obj, () => ({
      rotate: entity.getValue(OneHandGrabbable, 'rotate')
        ? {
            x: [rotateMin[0], rotateMax[0]] as [number, number],
            y: [rotateMin[1], rotateMax[1]] as [number, number],
            z: [rotateMin[2], rotateMax[2]] as [number, number],
          }
        : false,
      translate: entity.getValue(OneHandGrabbable, 'translate')
        ? {
            x: [translateMin[0], translateMax[0]] as [number, number],
            y: [translateMin[1], translateMax[1]] as [number, number],
            z: [translateMin[2], translateMax[2]] as [number, number],
          }
        : false,
      projectRays: false,
      multitouch: false,
    }));
    this.handleBindings.set(entity, handle.bind(obj));
    obj.pointerEventsType = { deny: 'ray' };
    entity.addComponent(Handle, { instance: handle });
    this.handleSources.set(entity.index, OneHandGrabbable);
  }

  private initializeTwoHandsHandle(entity: Entity) {
    if (entity.hasComponent(Handle)) {
      return;
    }
    const object = entity.object3D;
    if (!(object instanceof Object3D)) {
      return;
    }
    warnIfNoRaycastableMesh(entity, 'TwoHandsGrabbable');
    const obj = object as Object3D<PointerEventsMap & Object3DEventMap>;
    const rotateMax = entity.getVectorView(TwoHandsGrabbable, 'rotateMax');
    const rotateMin = entity.getVectorView(TwoHandsGrabbable, 'rotateMin');
    const translateMax = entity.getVectorView(
      TwoHandsGrabbable,
      'translateMax',
    );
    const translateMin = entity.getVectorView(
      TwoHandsGrabbable,
      'translateMin',
    );
    const scaleMax = entity.getVectorView(TwoHandsGrabbable, 'scaleMax');
    const scaleMin = entity.getVectorView(TwoHandsGrabbable, 'scaleMin');
    const handle = new HandleStore(obj, () => ({
      rotate: entity.getValue(TwoHandsGrabbable, 'rotate')
        ? {
            x: [rotateMin[0], rotateMax[0]] as [number, number],
            y: [rotateMin[1], rotateMax[1]] as [number, number],
            z: [rotateMin[2], rotateMax[2]] as [number, number],
          }
        : false,
      translate: entity.getValue(TwoHandsGrabbable, 'translate')
        ? {
            x: [translateMin[0], translateMax[0]] as [number, number],
            y: [translateMin[1], translateMax[1]] as [number, number],
            z: [translateMin[2], translateMax[2]] as [number, number],
          }
        : false,
      scale: entity.getValue(TwoHandsGrabbable, 'scale')
        ? {
            x: [scaleMin[0], scaleMax[0]] as [number, number],
            y: [scaleMin[1], scaleMax[1]] as [number, number],
            z: [scaleMin[2], scaleMax[2]] as [number, number],
          }
        : false,
      projectRays: false,
      multitouch: true,
    }));
    this.handleBindings.set(entity, handle.bind(obj));
    obj.pointerEventsType = { deny: 'ray' };
    entity.addComponent(Handle, { instance: handle });
    this.handleSources.set(entity.index, TwoHandsGrabbable);
  }

  private initializeDistanceHandle(entity: Entity) {
    if (entity.hasComponent(Handle)) {
      return;
    }
    const object = entity.object3D;
    if (!(object instanceof Object3D)) {
      return;
    }
    warnIfNoRaycastableMesh(entity, 'DistanceGrabbable');
    const obj = object as Object3D<PointerEventsMap & Object3DEventMap>;
    const rootEntity = entity.hasComponent(LevelTag)
      ? this.world.activeLevel.value
      : this.world.sceneEntity;
    const rotateMax = entity.getVectorView(DistanceGrabbable, 'rotateMax');
    const rotateMin = entity.getVectorView(DistanceGrabbable, 'rotateMin');
    const translateMax = entity.getVectorView(
      DistanceGrabbable,
      'translateMax',
    );
    const translateMin = entity.getVectorView(
      DistanceGrabbable,
      'translateMin',
    );
    const scaleMax = entity.getVectorView(DistanceGrabbable, 'scaleMax');
    const scaleMin = entity.getVectorView(DistanceGrabbable, 'scaleMin');
    const movementMode = entity.getValue(DistanceGrabbable, 'movementMode');
    const returnToOrigin = Boolean(
      entity.getValue(DistanceGrabbable, 'returnToOrigin'),
    );
    const detachOnGrab = Boolean(
      entity.getValue(DistanceGrabbable, 'detachOnGrab'),
    );
    const targetPosOffset = entity.getVectorView(
      DistanceGrabbable,
      'targetPositionOffset',
    );
    const targetQuatOffset = entity.getVectorView(
      DistanceGrabbable,
      'targetQuaternionOffset',
    );
    const opts = () => ({
      rotate: entity.getValue(DistanceGrabbable, 'rotate')
        ? {
            x: [rotateMin[0], rotateMax[0]] as [number, number],
            y: [rotateMin[1], rotateMax[1]] as [number, number],
            z: [rotateMin[2], rotateMax[2]] as [number, number],
          }
        : false,
      translate:
        movementMode === MovementMode.RotateAtSource
          ? ('as-rotate' as const)
          : entity.getValue(DistanceGrabbable, 'translate')
            ? {
                x: [translateMin[0], translateMax[0]] as [number, number],
                y: [translateMin[1], translateMax[1]] as [number, number],
                z: [translateMin[2], translateMax[2]] as [number, number],
              }
            : false,
      scale:
        movementMode === MovementMode.RotateAtSource
          ? false
          : entity.getValue(DistanceGrabbable, 'scale')
            ? {
                x: [scaleMin[0], scaleMax[0]] as [number, number],
                y: [scaleMin[1], scaleMax[1]] as [number, number],
                z: [scaleMin[2], scaleMax[2]] as [number, number],
              }
            : false,
      projectRays: false,
    });
    const handle = new DistanceGrabHandle(
      obj,
      rootEntity.object3D!,
      opts,
      movementMode!,
      returnToOrigin,
      entity.getValue(DistanceGrabbable, 'moveSpeedFactor') ?? 0.1,
      new Vector3(targetPosOffset[0], targetPosOffset[1], targetPosOffset[2]),
      new Quaternion(
        targetQuatOffset[0],
        targetQuatOffset[1],
        targetQuatOffset[2],
        targetQuatOffset[3],
      ),
      detachOnGrab,
    );
    this.handleBindings.set(entity, handle.bind(obj));
    obj.pointerEventsType = { deny: 'grab' };
    entity.addComponent(Handle, { instance: handle });
    this.handleSources.set(entity.index, DistanceGrabbable);
  }

  private releaseHandle(entity: Entity, removed: GrabbableComponent) {
    // A destroyed entity has no components left; its Handle cleanup has run.
    if (!entity.active || !entity.hasComponent(Handle)) {
      return;
    }
    if (this.handleSources.get(entity.index) !== removed) {
      return;
    }
    entity.removeComponent(Handle);
    if (entity.hasComponent(OneHandGrabbable)) {
      this.initializeOneHandHandle(entity);
    } else if (entity.hasComponent(TwoHandsGrabbable)) {
      this.initializeTwoHandsHandle(entity);
    } else if (entity.hasComponent(DistanceGrabbable)) {
      this.initializeDistanceHandle(entity);
    }
  }
}

type GrabbableComponent =
  | typeof OneHandGrabbable
  | typeof TwoHandsGrabbable
  | typeof DistanceGrabbable;
