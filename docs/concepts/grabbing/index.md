---
title: Grabbing Overview
---

# Object Grabbing & Manipulation

Interactive object manipulation is foundational to immersive experiences. IWSDK provides a comprehensive grabbing system that enables natural, performant object interaction through three distinct manipulation patterns—each optimized for different use cases and comfort requirements.

- **One-Hand Grabbing** — Direct single input manipulation for basic interactions
- **Two-Hand Grabbing** — Dual-hand manipulation with scaling capabilities for precise control
- **Distance Grabbing** — Ray-based remote manipulation with telekinetic-style interactions

Under the hood, the system bridges IWSDK's ECS architecture with the `@pmndrs/handle` library, providing automatic handle lifecycle management, performance optimizations, and seamless integration with the input system.

## Why Grabbing Is Complex (and Critical)

Object manipulation in XR presents unique challenges that don't exist in traditional interfaces. Small implementation details can make the difference between natural, satisfying interactions and frustrating experiences that break immersion.

- **Multi-modal input complexity**
  - Controllers and hands require different activation patterns but should produce consistent manipulation semantics. The system must handle thumbstick precision, trigger pressure sensitivity, and hand tracking micro-gestures uniformly.

- **Spatial relationship preservation**
  - Objects exist in complex parent-child hierarchies and world transforms. Grabbing must preserve these relationships while allowing natural manipulation without breaking scene graph integrity.

- **Interaction mode coordination**
  - Different grab types need different pointer event configurations and collision behaviors. Ray-based and direct manipulation must coexist without interference.

Because manipulation underpins most interactive experiences, the system prioritizes predictable behavior and performance while providing flexibility for specialized use cases.

## System Architecture

The grabbing system operates through a unified `GrabSystem` that automatically creates and manages interaction handles:

### ECS Integration Pattern

```
Entity with Grabbable Component
  ↓
GrabSystem detects via queries
  ↓
Creates HandleStore instance
  ↓
Configures pointer events & constraints
  ↓
Updates transform each frame
  ↓
Cleans up on component removal
```

### Handle Lifecycle Management

The system uses reactive ECS queries to manage handle creation and cleanup:

- **Automatic Detection** — Query subscriptions (`qualify`/`disqualify`) detect when entities gain or lose grabbable components
- **Handle Creation** — Different grabbable types get specialized handles with appropriate constraints and multitouch settings
- **Unified Updates** — All handles update through a single system loop for consistent timing
- **Graceful Cleanup** — Handles are properly cancelled and pointer events restored when components are removed

## Core Design Principles

### Automatic Integration

- The system discovers grabbable entities through ECS queries rather than manual registration
- Handle creation, updates, and cleanup happen automatically based on component presence
- Multi-pointer coordination (left/right hand sub-pointers) is enabled automatically when the system is active

### Constraint-Based Control

- All transformation types (rotate, translate, scale) support per-axis min/max constraints
- Specialized movement modes provide different manipulation semantics
- Pointer event filtering prevents interaction conflicts

### Seamless Library Integration

- Acts as a bridge between IWSDK's ECS and `@pmndrs/handle`'s imperative API
- Translates component data into handle configurations automatically
- Maintains separation of concerns between interaction logic and ECS lifecycle

## Quick Start

```ts
import { World, SessionMode } from '@iwsdk/core';
import { RayInteractable, OneHandGrabbable } from '@iwsdk/core';

// Enable grabbing system
World.create(document.getElementById('scene-container'), {
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
  },
  features: {
    enableGrabbing: true, // This enables the grab system
  },
}).then((world) => {
  // Create grabbable object
  const entity = world.createTransformEntity(mesh);
  entity.addComponent(RayInteractable);
  entity.addComponent(OneHandGrabbable, {
    rotate: true,
    translate: true,
    rotateMin: [-Math.PI / 4, -Math.PI, -Math.PI / 4],
    rotateMax: [Math.PI / 4, Math.PI, Math.PI / 4],
  });
});
```

## When to Use Which Pattern

### One-Hand Grabbing

- Direct manipulation with immediate response
- Best for: tools, simple objects, quick interactions

### Two-Hand Grabbing

- Advanced manipulation including scaling operations
- Best for: resizable objects, precise positioning, complex manipulation

### Distance Grabbing

- Remote manipulation with specialized movement algorithms
- Best for: out-of-reach objects, magical interactions, telekinetic experiences

Most applications use a combination—direct grabbing for nearby objects and distance grabbing for remote items, with two-hand grabbing reserved for objects requiring scaling or precision.

## Grabs and Pokes

A grab starts with a squeeze on a controller, a pinch with a tracked hand (unless `useHandPinchForGrab` is off) or, for `DistanceGrabbable`, a select along the ray (the trigger, or a pinch). A poke, where the controller tip or index fingertip touches an object, never grabs. On a grabbable that is also `PokeInteractable`, a poke presses it (`Pressed`, `click`) and leaves it where it is.

- **A fingertip can't push a grabbable along**, not even a `OneHandGrabbable` limited to one axis such as a slider knob, a lever or a drawer. It moves only while a squeeze or pinch holds it. In earlier releases a poke grabbed a pokeable grabbable, so such an object followed the fingertip until the fingertip lifted off; it no longer does. For a control the fingertip should drag, make it `PokeInteractable` rather than grabbable and set its value from its pointer events, for example from `event.point` while it is pressed. In its `pointerdown` listener, call `setPointerCapture(event.pointerId)` on its `object3D` so the press survives the fingertip sliding off the knob: the press then lasts until the fingertip pulls back from the knob's surface, wherever along it the fingertip has slid.
- **A grab interrupts a poke.** When a squeeze or pinch grabs something while the tip presses a pokeable, the pokeable gets `pointercancel` and `pointerleave` instead of `pointerup` and `click`, so the poke neither keeps it `Pressed` nor clicks it. The tip has to lift off before it hovers or presses again, which means moving more than 2 cm away from every pokeable.

## Integration Points

The grabbing system integrates with multiple IWSDK systems:

- **Input System** — Automatic sub-pointer management and event routing
- **Physics System** — Grabbable objects maintain physics properties during manipulation
- **Native Scene Editor** — Visual placement and component assignment through the IWSDK editor
- **Interaction System** — Works with `RayInteractable`, `Hovered`, and `Pressed` components

## Next Steps

- [Interaction Types](/concepts/grabbing/interaction-types) — Understanding the three grabbing patterns
- [Distance Grabbing](/concepts/grabbing/distance-grabbing) — Deep dive into movement modes and algorithms
