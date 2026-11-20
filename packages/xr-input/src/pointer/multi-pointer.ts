/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Pointer } from '@pmndrs/pointer-events';
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { XROrigin } from '../rig/xr-origin.js';
import { CursorVisual } from './cursor-visual.js';
import { GrabPointer } from './grab-pointer.js';
import { RayPointer } from './ray-pointer.js';
import { TOUCH_DEFAULTS, TouchPointer } from './touch-pointer.js';

export type PointerKind = 'ray' | 'grab' | 'touch';

export interface MultiPointerInput {
  selectStart?: boolean;
  selectEnd?: boolean;
  squeezeStart?: boolean;
  squeezeEnd?: boolean;
  /**
   * Whether the squeeze is held this frame. When `false`, a grab selection
   * ends even without a `squeezeEnd` edge, for example after the input source
   * switched from a controller to a hand mid-squeeze. Leave it undefined to
   * rely on the edges alone.
   */
  squeezing?: boolean;
  /**
   * Temporarily disable the far ray without changing its registration.
   * Gaze mode uses this to make the hand/controller ray a fallback while
   * leaving near touch and grab interaction available.
   */
  suppressRay?: boolean;
}

/**
 * Interactor state machine states
 */
export enum InteractorState {
  /** Pointer not registered or not enabled */
  DISABLED = 'disabled',
  /** Pointer enabled, no candidate */
  NORMAL = 'normal',
  /** Pointer has candidate, hovering over object */
  HOVER = 'hover',
  /** Pointer actively selecting object */
  SELECT = 'select',
}

/**
 * Priority order for pointer types (lower index = higher priority)
 */
const PRIORITY_ORDER: PointerKind[] = ['touch', 'grab', 'ray'];

/**
 * Hysteresis thresholds for touch pointer (in meters)
 */
const TOUCH_HYSTERESIS = {
  enterHoverDistance: 0.15, // 15cm - distance to start hover
  exitHoverDistance: 0.2, // 20cm - distance to end hover
};

const TOUCH_VISUAL_OFFSET_EPSILON_SQ = 0.000001;

type PointerEntry<T> = {
  pointer: Pointer;
  visual: T;
  registered: boolean;
};

/**
 * MultiPointer orchestrates multiple pointer types using priority-based selection.
 *
 * @remarks
 * - Priority order: Touch > Grab > Ray
 * - Uses state machine: DISABLED ↔ NORMAL ↔ HOVER ↔ SELECT
 * - Selection lock: Once a pointer starts selecting, it stays locked until release
 * - Hysteresis: Touch pointer uses separate enter/exit thresholds to prevent flickering
 *
 * @category Pointer
 */
export class MultiPointer {
  private ray: PointerEntry<RayPointer>;
  private grab: PointerEntry<GrabPointer>;
  private touch: PointerEntry<TouchPointer>;
  private cursorVisual: CursorVisual;

  /** Current active pointer kind (winner of priority selection) */
  private activeKind: PointerKind | null = null;

  /** State for each pointer type */
  private pointerStates: Map<PointerKind, InteractorState> = new Map();

  /** Hysteresis tracking: whether touch is currently in hover state */
  private touchHoverActive = false;

  /**
   * Set while a touch press cancelled by a grab (a squeeze, or a pinch routed
   * to the grab pointer) waits for the tip to lift off. Until then the touch
   * pointer isn't moved, so it neither hovers nor presses, as a browser makes
   * a cancelled touch lift before it can press again. A tip still on the
   * surface when the grab ends (always the case for a pokeable grabbable the
   * tip pressed) would otherwise press it again at once, and pulling away
   * would click it.
   */
  private touchLiftPending = false;

  /** Cached scene reference with type-specific descendants */
  private sceneWithDescendants: {
    interactableDescendants?: Object3D[];
    rayDescendants?: Object3D[];
    touchDescendants?: Object3D[];
    /** Touch descendants per hand; preferred over touchDescendants when set. */
    touchDescendantsByHand?: { left: Object3D[]; right: Object3D[] };
    grabDescendants?: Object3D[];
  };

  /** Reusable native event object to avoid per-frame allocations */
  private readonly nativeEvent = { timeStamp: 0 };

  /** Reusable policy object for ray rendering */
  private readonly rayPolicy = { forceHideRay: false };

  /**
   * Pointers that completed the upstream library's first ready move. Mirrors
   * its private `wasMoved` latch. Only `Pointer.exit()` resets that latch,
   * and MultiPointer calls it only in `releaseTouchForGrab()`, which removes
   * the touch pointer from this set too.
   */
  private readonly movedPointers = new Set<PointerKind>();

  /** Reusable event object for pointer down/up with button */
  private readonly buttonEvent = { timeStamp: 0, button: 0 };

  constructor(
    private readonly handedness: 'left' | 'right',
    private readonly scene: Object3D,
    private readonly camera: PerspectiveCamera,
    private readonly xrOrigin: XROrigin,
  ) {
    // Create all pointer instances
    const rayVisual = new RayPointer(
      this.camera,
      this.xrOrigin,
      this.handedness,
    );
    const grabVisual = new GrabPointer(
      this.camera,
      this.xrOrigin,
      this.handedness,
    );
    const touchVisual = new TouchPointer(
      this.camera,
      this.xrOrigin,
      this.handedness,
    );

    this.ray = {
      pointer: rayVisual.pointer,
      visual: rayVisual,
      registered: false,
    };
    this.grab = {
      pointer: grabVisual.pointer,
      visual: grabVisual,
      registered: false,
    };
    this.touch = {
      pointer: touchVisual.pointer,
      visual: touchVisual,
      registered: false,
    };

    // Cache scene reference for descendant swapping (avoids repeated casts)
    this.sceneWithDescendants = this.scene as typeof this.sceneWithDescendants;

    // Create shared cursor visual
    this.cursorVisual = new CursorVisual(
      xrOrigin,
      handedness === 'left' ? 0 : 1,
    );

    // Initialize states
    PRIORITY_ORDER.forEach((kind) => {
      this.pointerStates.set(kind, InteractorState.DISABLED);
    });

    // Enable ray and touch by default
    this.toggleSubPointer('ray', true);
    this.toggleSubPointer('touch', true);
  }

  /**
   * Main update loop - implements priority-based pointer selection
   */
  update(
    connected: boolean,
    delta: number,
    time: number,
    input?: MultiPointerInput,
  ) {
    // Reuse nativeEvent object to avoid allocation
    this.nativeEvent.timeStamp = time * 1000;

    // Phase 1: Update enabled state for all registered pointers
    const rayConnected = connected && !input?.suppressRay;
    this.updatePointerEnabled(connected, rayConnected);

    // Phase 2: Check selection lock - if active pointer is selecting, stay locked
    const activePointer = this.getActivePointer();
    const activeState = activePointer
      ? this.pointerStates.get(this.activeKind!)
      : null;
    const isSelecting = activeState === InteractorState.SELECT;

    if (!isSelecting) {
      // Phase 3: Compute intersections for all enabled pointers
      this.computeAllIntersections();

      // Phase 4: Pick winner by priority
      this.pickActiveByPriority();
    } else {
      // Selection locked - only update the active pointer's intersection
      // Still use type-specific descendants for the locked pointer
      if (activePointer && this.activeKind) {
        this.movePointerWithDescendants(this.activeKind, activePointer);
      }
      // A touch press must not freeze the grab pointer: a squeeze or pinch
      // grabs what the grab sphere touches now, and an object held by a pinch
      // keeps following the hand while its fingertip presses something.
      if (
        this.activeKind === 'touch' &&
        this.pointerStates.get('grab') !== InteractorState.DISABLED
      ) {
        this.movePointerWithDescendants('grab', this.grab.pointer);
      }
    }

    if (input?.squeezeStart) {
      this.preferGrabOnSqueeze();
    }

    // Phase 5: Process lifecycle (state transitions)
    this.processLifecycle(input);

    // Phase 6: Update shared cursor from active pointer
    const anyPointerHasCapture =
      !!this.ray.pointer.getPointerCapture?.() ||
      !!this.grab.pointer.getPointerCapture?.() ||
      !!this.touch.pointer.getPointerCapture?.();

    if (this.activeKind && !anyPointerHasCapture) {
      const activeEntry = this.getEntry(this.activeKind);
      const intersection = activeEntry.pointer.getIntersection();
      const focused =
        this.pointerStates.get(this.activeKind) === InteractorState.SELECT;
      const visible = !!intersection && !intersection.object.isVoidObject;

      this.cursorVisual.setVisible(visible);
      if (visible && intersection) {
        this.cursorVisual.updateFromIntersection(intersection, delta, focused);
      }
    } else {
      this.cursorVisual.setVisible(false);
    }

    // Phase 7: Update visuals - reuse rayPolicy object
    this.rayPolicy.forceHideRay = this.shouldHideRay();
    this.ray.visual.update(
      rayConnected && this.ray.registered,
      delta,
      time,
      !!input?.selectStart,
      !!input?.selectEnd,
      this.rayPolicy,
    );
    this.grab.visual.update(
      connected && this.grab.registered,
      delta,
      time,
      !!input?.squeezeStart,
      !!input?.squeezeEnd,
    );
    this.touch.visual.update(
      connected && this.touch.registered,
      delta,
      time,
      false,
      false,
    );
  }

  /**
   * Update enabled state for all registered pointers
   */
  private updatePointerEnabled(connected: boolean, rayConnected: boolean) {
    // Process ray pointer
    this.updateSinglePointerEnabled('ray', this.ray, rayConnected);
    // Process grab pointer
    this.updateSinglePointerEnabled('grab', this.grab, connected);
    // Process touch pointer
    this.updateSinglePointerEnabled('touch', this.touch, connected);
  }

  /**
   * Update enabled state for a single pointer (avoids array allocation)
   */
  private updateSinglePointerEnabled(
    kind: PointerKind,
    entry: PointerEntry<RayPointer | GrabPointer | TouchPointer>,
    connected: boolean,
  ) {
    const shouldBeEnabled = connected && entry.registered;
    const currentState = this.pointerStates.get(kind)!;
    const isEnabled = currentState !== InteractorState.DISABLED;

    if (shouldBeEnabled && !isEnabled) {
      entry.pointer.setEnabled(true, this.nativeEvent, false);
      this.pointerStates.set(kind, InteractorState.NORMAL);
    } else if (!shouldBeEnabled) {
      // Pointer instances start enabled upstream, so also consult the pointer
      // itself. This makes first-frame gaze suppression a real disable rather
      // than merely skipping the ray's intersection pass.
      if (entry.pointer.getEnabled()) {
        const buttonsDown = [...entry.pointer.getButtonsDown()];
        if (buttonsDown.length > 0) {
          // Mode switches terminate an in-flight far selection instead of
          // leaving a stale button/capture that could revive with ray fallback.
          if (!this.movedPointers.has(kind)) {
            // Flush an upstream down queued before the pointer's first move so
            // its matching cancel cannot be stranded in the same queue. In
            // normal updates move() has already run, avoiding callback
            // re-entry on this disable path.
            entry.pointer.commit(this.nativeEvent, false);
            this.movedPointers.add(kind);
          }
          entry.pointer.cancel(this.nativeEvent);
        }
        entry.pointer.setEnabled(false, this.nativeEvent, true);
        for (const button of buttonsDown) {
          entry.pointer.up({ button, timeStamp: this.nativeEvent.timeStamp });
        }
      }
      this.pointerStates.set(kind, InteractorState.DISABLED);
      // Clear active if this was the active pointer
      if (this.activeKind === kind) {
        this.activeKind = null;
      }
    }
  }

  /**
   * Compute intersections for all enabled pointers using type-specific descendant arrays.
   * Swaps scene.interactableDescendants per pointer type for optimized traversal.
   */
  private computeAllIntersections() {
    // Store original descendants once
    const originalDescendants =
      this.sceneWithDescendants.interactableDescendants;

    // Process each pointer with its type-specific descendants
    // Ray pointer
    if (this.pointerStates.get('ray') !== InteractorState.DISABLED) {
      this.sceneWithDescendants.interactableDescendants =
        this.sceneWithDescendants.rayDescendants;
      this.ray.pointer.move(this.scene, this.nativeEvent);
      this.markPointerMoved('ray', this.ray.pointer);
    }

    // Grab pointer
    if (this.pointerStates.get('grab') !== InteractorState.DISABLED) {
      this.sceneWithDescendants.interactableDescendants =
        this.sceneWithDescendants.grabDescendants;
      this.grab.pointer.move(this.scene, this.nativeEvent);
      this.markPointerMoved('grab', this.grab.pointer);
    }

    // Touch pointer
    if (this.pointerStates.get('touch') !== InteractorState.DISABLED) {
      this.sceneWithDescendants.interactableDescendants =
        this.touchCandidates();
      if (this.touchLiftPending) {
        this.touchLiftPending = this.isTouchTipDown();
      }
      if (!this.touchLiftPending) {
        this.touch.pointer.move(this.scene, this.nativeEvent);
        this.markPointerMoved('touch', this.touch.pointer);
      }
    }

    // Restore original descendants
    this.sceneWithDescendants.interactableDescendants = originalDescendants;
  }

  /**
   * Move a single pointer using its type-specific descendants.
   * Used when selection is locked to avoid unnecessary traversal.
   */
  private movePointerWithDescendants(kind: PointerKind, pointer: Pointer) {
    const originalDescendants =
      this.sceneWithDescendants.interactableDescendants;

    switch (kind) {
      case 'ray':
        this.sceneWithDescendants.interactableDescendants =
          this.sceneWithDescendants.rayDescendants;
        break;
      case 'grab':
        this.sceneWithDescendants.interactableDescendants =
          this.sceneWithDescendants.grabDescendants;
        break;
      case 'touch':
        this.sceneWithDescendants.interactableDescendants =
          this.touchCandidates();
        break;
    }

    pointer.move(this.scene, this.nativeEvent);
    this.markPointerMoved(kind, pointer);
    this.sceneWithDescendants.interactableDescendants = originalDescendants;
  }

  private markPointerMoved(kind: PointerKind, pointer: Pointer): void {
    if (pointer.intersector.isReady()) {
      this.movedPointers.add(kind);
    }
  }

  /**
   * Pick active pointer by priority - first with valid candidate wins
   */
  private pickActiveByPriority() {
    let newActiveKind: PointerKind | null = null;

    for (const kind of PRIORITY_ORDER) {
      const state = this.pointerStates.get(kind)!;
      if (state === InteractorState.DISABLED) {
        continue;
      }

      if (this.hasValidCandidate(kind)) {
        newActiveKind = kind;
        break;
      }
    }

    // Switch active pointer if changed
    if (newActiveKind !== this.activeKind) {
      this.switchActivePointer(newActiveKind);
    }
  }

  /**
   * Check if a pointer has a valid candidate (intersection)
   */
  private hasValidCandidate(kind: PointerKind): boolean {
    const entry = this.getEntry(kind);
    const intersection = entry.pointer.getIntersection();

    // No intersection or void object = no candidate
    if (!intersection || intersection.object.isVoidObject) {
      // For touch, update hysteresis state
      if (kind === 'touch') {
        this.touchHoverActive = false;
      }
      return false;
    }

    // For touch pointer, apply hysteresis
    if (kind === 'touch') {
      const threshold = this.touchHoverActive
        ? TOUCH_HYSTERESIS.exitHoverDistance
        : TOUCH_HYSTERESIS.enterHoverDistance;

      if (intersection.distance > threshold) {
        // Outside threshold
        if (!this.touchHoverActive) {
          return false;
        }
        // Was hovering but now outside exit threshold
        this.touchHoverActive = false;
        return false;
      }

      // Within threshold
      this.touchHoverActive = true;
      return true;
    }

    // For ray and grab, any valid intersection is a candidate
    return true;
  }

  /**
   * Touch outranks grab so a fingertip or controller tip can press a pokeable,
   * but only the active pointer's lifecycle runs and only the grab pointer
   * takes the squeeze. Without this, any pokeable within touch range (or the
   * grabbable itself, when it is also pokeable) swallows every squeeze. A
   * squeeze is a grab intent, so the grab pointer takes over whenever its
   * sphere has a target, even from a touch press, which it cancels. A ray
   * selection keeps its lock: its trigger release only reaches it while it is
   * the active pointer.
   */
  private preferGrabOnSqueeze() {
    if (
      this.pointerStates.get('ray') === InteractorState.SELECT ||
      this.pointerStates.get('grab') === InteractorState.SELECT ||
      !this.grabHasTarget()
    ) {
      return;
    }
    // The grab's selection lock stops moving the touch pointer until the
    // squeeze ends, so end its hover too, even when grab was already active
    // (the touch sphere reaches farther than the distance at which touch
    // becomes active). Otherwise a pokeable the tip passed stays `Hovered`
    // through the whole grab.
    this.releaseTouchForGrab(true);
    if (this.activeKind !== 'grab') {
      this.switchActivePointer('grab');
    }
  }

  /** Whether the grab sphere touches something a squeeze or pinch can grab. */
  private grabHasTarget(): boolean {
    return (
      this.pointerStates.get('grab') !== InteractorState.DISABLED &&
      this.hasValidCandidate('grab')
    );
  }

  /**
   * Ends what the touch pointer is doing when a grab takes the hand over.
   *
   * A press is cancelled. Left alone, it would hold the poked object pressed
   * (`Pressed`, UIKit active) through the grab, and lifting the tip after a
   * short grab would still click it. As when a browser cancels a touch, the
   * object gets pointercancel, then pointerout and pointerleave from `exit()`,
   * and no pointerup or click. The touch pointer then waits for the tip to
   * lift off (`touchLiftPending`) before it hovers or presses again.
   *
   * With `endHover`, a touch pointer that only hovers something gets the
   * leave events from `exit()` too, without the lift-off wait. A squeeze grab
   * passes it because its lock freezes the touch pointer. A routed pinch
   * doesn't: the touch pointer keeps moving through a pinch grab, so its
   * hover stays current.
   *
   * A touch pointer that touches nothing is left alone. Its button is down
   * then too: with no pokeable in reach, its hit is the scene's void object at
   * distance 0, which is within `downRadius`. Cancelling that press would send
   * pointercancel, pointerout and pointerleave to the void object, which
   * bubble to the scene, and start a lift-off wait for nothing.
   *
   * In pointer-events 6.6.32, `cancel()` clears the pressed button, its click
   * time and any capture. In 6.6.28 it only emits pointercancel and leaves
   * the button down, and `exit()` doesn't clear it either: `exit()` drops the
   * intersection and capture and commits. The touch pointer's move callback
   * (from `createTouchPointer`), which that commit runs, then sees no contact
   * and calls `up()`, which clears the button and emits nothing without an
   * intersection.
   */
  private releaseTouchForGrab(endHover: boolean) {
    if (this.pointerStates.get('touch') === InteractorState.DISABLED) {
      return;
    }
    const touch = this.touch.pointer;
    const intersection = touch.getIntersection();
    if (!intersection || intersection.object.isVoidObject) {
      return;
    }
    const pressing = touch.getButtonsDown().size > 0;
    if (pressing) {
      touch.cancel(this.nativeEvent);
    } else if (!endHover) {
      return;
    }
    touch.exit(this.nativeEvent);
    this.movedPointers.delete('touch');
    this.touchHoverActive = false;
    this.touchLiftPending = pressing;
    this.pointerStates.set('touch', InteractorState.NORMAL);
  }

  /**
   * Whether the touch tip is within press distance of a pokeable. Probes
   * without moving the touch pointer, so it emits no events.
   */
  private isTouchTipDown(): boolean {
    const intersection = this.touch.pointer.computeIntersection(
      'pointer',
      this.scene,
      this.nativeEvent,
    );
    return (
      !intersection.object.isVoidObject &&
      intersection.distance <= TOUCH_DEFAULTS.downRadius
    );
  }

  /**
   * Switch active pointer to a new kind
   */
  private switchActivePointer(newKind: PointerKind | null) {
    // Disable previous active pointer (but keep it enabled in the pointer system)
    if (this.activeKind && this.activeKind !== newKind) {
      const prevState = this.pointerStates.get(this.activeKind)!;
      if (prevState === InteractorState.HOVER) {
        this.pointerStates.set(this.activeKind, InteractorState.NORMAL);
      }
    }

    this.activeKind = newKind;

    // Update new active pointer state
    if (newKind) {
      const state = this.pointerStates.get(newKind)!;
      if (state === InteractorState.NORMAL) {
        this.pointerStates.set(newKind, InteractorState.HOVER);
      }
    }
  }

  /**
   * Process lifecycle transitions based on input
   */
  private processLifecycle(input?: MultiPointerInput) {
    if (!this.activeKind) {
      return;
    }

    const entry = this.getEntry(this.activeKind);
    const state = this.pointerStates.get(this.activeKind)!;

    switch (this.activeKind) {
      case 'touch':
        // Touch auto-selects based on distance
        this.processTouchLifecycle(entry, state);
        break;

      case 'grab':
        // Grab uses squeeze button. A squeeze no longer held also ends the
        // grab: a source that stops reporting it (a hand that replaces the
        // controller mid-squeeze) never sends squeezeEnd.
        this.processButtonLifecycle(
          entry,
          state,
          !!input?.squeezeStart,
          !!input?.squeezeEnd || input?.squeezing === false,
          2, // button 2 for squeeze
        );
        break;

      case 'ray':
        // Ray uses select button
        this.processButtonLifecycle(
          entry,
          state,
          !!input?.selectStart,
          !!input?.selectEnd,
          0, // button 0 for select
        );
        break;
    }
  }

  /**
   * Process touch pointer lifecycle - auto-selects based on distance
   */
  private processTouchLifecycle(
    entry: PointerEntry<TouchPointer>,
    state: InteractorState,
  ) {
    const intersection = entry.pointer.getIntersection();
    if (!intersection || intersection.object.isVoidObject) {
      // Lost candidate - transition to NORMAL
      if (state === InteractorState.SELECT) {
        // Force release if touch was selecting when intersection was lost
        this.buttonEvent.timeStamp = this.nativeEvent.timeStamp;
        this.buttonEvent.button = 0;
        entry.pointer.up(this.buttonEvent);
      }
      if (state === InteractorState.HOVER || state === InteractorState.SELECT) {
        this.pointerStates.set('touch', InteractorState.NORMAL);
      }
      return;
    }

    // Touch auto-selection is handled by the pointer's onMoveCommited callback
    // (createTouchPointer sets this up). We just need to track the state.

    // Check if pointer is currently selecting (has buttons down)
    const isSelecting = entry.pointer.getButtonsDown().size > 0;

    if (state === InteractorState.HOVER && isSelecting) {
      this.pointerStates.set('touch', InteractorState.SELECT);
    } else if (state === InteractorState.SELECT && !isSelecting) {
      this.pointerStates.set('touch', InteractorState.HOVER);
    } else if (state === InteractorState.NORMAL) {
      this.pointerStates.set('touch', InteractorState.HOVER);
    }
  }

  /**
   * Process button-based pointer lifecycle (ray/grab)
   */
  private processButtonLifecycle(
    entry: PointerEntry<RayPointer | GrabPointer>,
    state: InteractorState,
    buttonDown: boolean,
    buttonUp: boolean,
    button: number,
  ) {
    const intersection = entry.pointer.getIntersection();
    if (!intersection || intersection.object.isVoidObject) {
      // Lost candidate - can happen during selection (pointer capture handles this)
      if (state === InteractorState.HOVER) {
        this.pointerStates.set(this.activeKind!, InteractorState.NORMAL);
      }
      // The selected object went away (e.g. the app disposed it) and the
      // button was released off any target. Release anyway, as the touch
      // lifecycle does, or the selection lock never ends.
      if (state === InteractorState.SELECT && buttonUp) {
        this.buttonEvent.timeStamp = this.nativeEvent.timeStamp;
        this.buttonEvent.button = button;
        entry.pointer.up(this.buttonEvent);
        this.pointerStates.set(this.activeKind!, InteractorState.NORMAL);
      }
      return;
    }

    // HOVER → SELECT on button down
    if (state === InteractorState.HOVER && buttonDown) {
      this.buttonEvent.timeStamp = this.nativeEvent.timeStamp;
      this.buttonEvent.button = button;
      entry.pointer.down(this.buttonEvent);
      this.pointerStates.set(this.activeKind!, InteractorState.SELECT);
    }
    // SELECT → HOVER on button up
    else if (state === InteractorState.SELECT && buttonUp) {
      this.buttonEvent.timeStamp = this.nativeEvent.timeStamp;
      this.buttonEvent.button = button;
      entry.pointer.up(this.buttonEvent);
      this.pointerStates.set(this.activeKind!, InteractorState.HOVER);
    }
    // NORMAL → HOVER when we have a candidate
    else if (state === InteractorState.NORMAL) {
      this.pointerStates.set(this.activeKind!, InteractorState.HOVER);
    }
  }

  /**
   * Get the policy for ray visual rendering
   */
  /** Objects this hand may poke: its own list when the scene has one. */
  private touchCandidates(): Object3D[] | undefined {
    return (
      this.sceneWithDescendants.touchDescendantsByHand?.[this.handedness] ??
      this.sceneWithDescendants.touchDescendants
    );
  }

  getPolicyForRay() {
    return { forceHideRay: this.shouldHideRay() };
  }

  private shouldHideRay(): boolean {
    // Hide the visual whenever the ray is disabled or a near pointer owns the
    // hand, including gaze-mode suppression.
    return (
      this.pointerStates.get('ray') === InteractorState.DISABLED ||
      (this.activeKind !== 'ray' && this.activeKind !== null)
    );
  }

  /**
   * Check if ray is busy (has intersection)
   */
  getRayBusy(): boolean {
    return !!this.ray.visual.busy;
  }

  /**
   * Toggle a sub-pointer on/off
   */
  toggleSubPointer(kind: PointerKind, enabled: boolean): boolean {
    const entry = this.getEntry(kind);
    if (entry.registered === enabled) {
      return false;
    }
    entry.registered = enabled;
    if (!enabled) {
      this.pointerStates.set(kind, InteractorState.DISABLED);
      if (this.activeKind === kind) {
        this.activeKind = null;
      }
      if (kind === 'touch') {
        this.touchHoverActive = false;
      }
    }
    return true;
  }

  /**
   * Get the registration state of a sub-pointer
   */
  getSubPointerState(kind: PointerKind): { registered: boolean } {
    const entry = this.getEntry(kind);
    return { registered: entry.registered };
  }

  /**
   * Get the currently active pointer kind
   */
  getActiveKind(): PointerKind | null {
    return this.activeKind;
  }

  /**
   * Computes a world-space offset that keeps the hand visual's fingertip on the
   * touched surface while the touch pointer is actively selecting.
   */
  getTouchSurfaceVisualOffset(target: Vector3 = new Vector3()): Vector3 | null {
    if (this.activeKind !== 'touch') {
      return null;
    }

    if (this.pointerStates.get('touch') !== InteractorState.SELECT) {
      return null;
    }

    const intersection = this.touch.pointer.getIntersection();
    if (
      !intersection ||
      intersection.object.isVoidObject ||
      intersection.details.type !== 'sphere'
    ) {
      return null;
    }

    target.copy(intersection.pointOnFace).sub(intersection.pointerPosition);
    if (target.lengthSq() < TOUCH_VISUAL_OFFSET_EPSILON_SQ) {
      return null;
    }

    return target;
  }

  /**
   * Get the currently active pointer
   */
  getActivePointer(): Pointer | null {
    if (!this.activeKind) {
      return null;
    }
    return this.getEntry(this.activeKind).pointer;
  }

  /**
   * Get a specific pointer by kind
   */
  getPointer(kind: PointerKind): Pointer {
    return this.getEntry(kind).pointer;
  }

  /**
   * Route a down event to a specific pointer target.
   * Used by grab-system for hand pinch gestures.
   */
  routeDown(
    kind: 'select' | 'squeeze' | 'custom',
    target: 'ray' | 'grab' | 'active',
    nativeEvent: { timeStamp: number },
  ) {
    const ptr = this.pickTarget(target);
    if (!ptr) {
      return;
    }
    // A down routed to the grab pointer (a hand pinch) grabs what the grab
    // sphere touches, so it cancels a fingertip press the way a squeeze does.
    // The pinch doesn't take the selection lock, so the touch pointer keeps
    // moving and a mere hover stays.
    if (target === 'grab' && this.grabHasTarget()) {
      this.releaseTouchForGrab(false);
    }
    const button = kind === 'select' ? 0 : 2;
    ptr.down({ button, timeStamp: nativeEvent.timeStamp });
  }

  /**
   * Route an up event to a specific pointer target.
   * Used by grab-system for hand pinch gestures.
   */
  routeUp(
    kind: 'select' | 'squeeze' | 'custom',
    target: 'ray' | 'grab' | 'active',
    nativeEvent: { timeStamp: number },
  ) {
    const ptr = this.pickTarget(target);
    if (!ptr) {
      return;
    }
    const button = kind === 'select' ? 0 : 2;
    ptr.up({ button, timeStamp: nativeEvent.timeStamp });
  }

  /**
   * Pick pointer by target type.
   */
  private pickTarget(target: 'ray' | 'grab' | 'active'): Pointer | undefined {
    if (target === 'active') {
      // Prefer captured pointer if any, else fall back to active or ray
      if (this.ray.pointer.getPointerCapture?.()) {
        return this.ray.pointer;
      }
      if (this.grab.pointer.getPointerCapture?.()) {
        return this.grab.pointer;
      }
      if (this.touch.pointer.getPointerCapture?.()) {
        return this.touch.pointer;
      }
      // Fall back to active pointer or ray
      return this.activeKind
        ? this.getEntry(this.activeKind).pointer
        : this.ray.pointer;
    }
    if (target === 'ray') {
      return this.ray.pointer;
    }
    return this.grab.pointer;
  }

  /**
   * Get the entry for a pointer kind
   */
  private getEntry(
    kind: PointerKind,
  ): PointerEntry<RayPointer | GrabPointer | TouchPointer> {
    switch (kind) {
      case 'ray':
        return this.ray;
      case 'grab':
        return this.grab;
      case 'touch':
        return this.touch;
    }
  }

  /**
   * Dispose of all pointer resources.
   * Call this when the MultiPointer is no longer needed.
   */
  dispose(): void {
    // Dispose cursor visual
    this.cursorVisual.dispose();

    // Dispose ray pointer (has geometry/material)
    this.ray.visual.dispose();

    // Clear state
    this.pointerStates.clear();
    this.activeKind = null;
  }
}
