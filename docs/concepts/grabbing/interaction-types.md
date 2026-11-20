---
title: Interaction Types
---

# Grabbing Interaction Types

IWSDK's grabbing system provides three distinct interaction patterns, each implemented with different handle configurations and pointer management strategies. Understanding their architectural differences helps choose the right pattern for specific use cases.

## One-Hand Grabbing

Single-input direct manipulation optimized for immediate, responsive interactions.

### Architecture Characteristics

- **Handle Configuration**: `multitouch: false`, `projectRays: false`
- **Pointer Events**: `pointerEventsType: { deny: 'ray' }` — prevents ray interference
- **Transform Support**: Translation and rotation only (no scaling)

### Implementation Details

The system creates a standard `HandleStore` with constraints derived directly from component properties:

```ts
// Simplified handle creation from GrabSystem
const handle = new HandleStore(object, () => ({
  rotate: entity.getValue(OneHandGrabbable, 'rotate')
    ? {
        x: [rotateMin[0], rotateMax[0]],
        y: [rotateMin[1], rotateMax[1]],
        z: [rotateMin[2], rotateMax[2]],
      }
    : false,
  translate: entity.getValue(OneHandGrabbable, 'translate')
    ? {
        x: [translateMin[0], translateMax[0]],
        y: [translateMin[1], translateMax[1]],
        z: [translateMin[2], translateMax[2]],
      }
    : false,
  multitouch: false, // Single pointer only
}));
```

### Design Trade-offs

- **Immediacy vs Complexity** — Instant response but limited to basic transformations
- **Simplicity vs Capability** — Easy to predict behavior but no scaling operations
- **Performance vs Features** — Minimal overhead but fewer manipulation options

### Best Use Cases

- Interactive tools and instruments (valves, levers, handles)
- Simple object repositioning
- Quick grab-and-move interactions
- Objects that should maintain their scale

A constrained one-hand grabbable, like a lever or slider limited to one axis, moves only while a squeeze or pinch holds it. A poke never moves it, and presses it only if the entity is also `PokeInteractable`; see [Grabs and Pokes](/concepts/grabbing/#grabs-and-pokes).

## Two-Hand Grabbing

Dual-input manipulation enabling advanced operations including scaling through multi-pointer coordination.

### Architecture Characteristics

- **Handle Configuration**: `multitouch: true`, enables dual-pointer calculations
- **Pointer Events**: `pointerEventsType: { deny: 'ray' }` — same ray denial as one-hand
- **Transform Support**: Translation, rotation, and scaling

### Multi-Pointer Mathematics

Two-hand grabbing uses the relationship between controllers to derive transformations:

- **Translation**: Controlled by primary hand position
- **Rotation**: Derived from the orientation relationship between hands
- **Scaling**: Based on the distance between controllers — closer hands reduce scale, farther hands increase scale

### Implementation Details

The handle configuration enables multitouch and adds scaling constraints:

```ts
const handle = new HandleStore(object, () => ({
  rotate: /* rotation constraints */,
  translate: /* translation constraints */,
  scale: entity.getValue(TwoHandsGrabbable, 'scale') ? {
    x: [scaleMin[0], scaleMax[0]],
    y: [scaleMin[1], scaleMax[1]],
    z: [scaleMin[2], scaleMax[2]]
  } : false,
  multitouch: true  // Enables dual-pointer processing
}));
```

### Design Trade-offs

- **Capability vs Complexity** — Supports scaling but requires coordination between hands
- **Precision vs Effort** — Enables precise manipulation but demands two-hand engagement
- **Features vs Performance** — Rich interaction set but higher computational cost

### Best Use Cases

- Resizable objects (artwork, models, UI panels)
- Precise positioning tasks requiring stability
- Objects where scale adjustment is important
- Complex manipulation requiring both hands' dexterity

## Distance Grabbing

Ray-based remote manipulation with specialized movement algorithms for telekinetic-style interactions.

### Architecture Characteristics

- **Handle Configuration**: Custom `DistanceGrabHandle` class with movement mode algorithms
- **Pointer Events**: `pointerEventsType: { deny: 'grab' }` — opposite configuration from direct grabbing
- **Transform Support**: Translation, rotation, and scaling with mode-specific behaviors

### Movement Mode Algorithms

Distance grabbing implements four distinct movement algorithms:

#### MoveTowardsTarget Algorithm

```ts
// From DistanceGrabHandle.update()
const pointerOrigin = p1.pointerWorldOrigin;
const distance = pointerOrigin.distanceTo(position);

if (distance > this.moveSpeed) {
  const step = pointerOrigin
    .sub(position)
    .normalize()
    .multiplyScalar(this.moveSpeed);
  position.add(step);
} else {
  // Snap to target when close enough
  position.copy(pointerOrigin);
  quaternion.copy(p1.pointerWorldQuaternion);
}
```

#### MoveAtSource Algorithm

```ts
// Delta-based movement tracking
const current = p1.pointerWorldOrigin;
if (this.previousPointerOrigin != undefined) {
  const delta = current.sub(this.previousPointerOrigin);
  position.add(delta);
}
this.previousPointerOrigin.copy(current);
```

#### MoveFromTarget & RotateAtSource

- **MoveFromTarget**: Direct 1:1 mapping with ray endpoint (delegates to standard handle)
- **RotateAtSource**: Rotation-only mode with automatic translation/scale disabling

### Pointer Event Strategy

Distance grabbing uses a reverse pointer event configuration to prevent conflicts:

```ts
// Distance grabbable objects deny grab pointers, accept rays
obj.pointerEventsType = { deny: 'grab' };

// Versus direct grabbing which denies rays
obj.pointerEventsType = { deny: 'ray' };
```

### Return-to-Origin Mechanics

The `returnToOrigin` feature overrides the standard handle application:

```ts
// From DistanceGrabHandle.apply()
if (this.returnToOrigin && this.outputState?.last) {
  target.position.copy(this.initialTargetPosition);
  target.quaternion.copy(this.initialTargetQuaternion);
  target.scale.copy(this.initialTargetScale);
  return; // Skip standard handle application
}
```

### Design Trade-offs

- **Reach vs Directness** — Can interact with any visible object but lacks direct tactile feedback
- **Flexibility vs Predictability** — Multiple movement modes provide options but require mode selection
- **Magic vs Realism** — Enables impossible interactions but may feel less grounded

### Best Use Cases

- Out-of-reach objects in large environments
- Magical or supernatural interaction themes
- Accessibility — reaching objects without physical movement
- Telekinetic gameplay mechanics

## Selection Guidelines

### Interaction Context

- **Immediate objects**: Use direct grabbing (one/two-hand)
- **Remote objects**: Use distance grabbing
- **Resizable content**: Requires two-hand grabbing
- **Tool-like objects**: Usually one-hand grabbing

### User Experience Patterns

Most applications combine multiple grabbing types:

- **Gallery Setup**: Paintings (one-hand rotation-only), Sculptures (two-hand with scaling), Floating artifacts (distance with return-to-origin)
- **Workshop Environment**: Tools (one-hand), Workpieces (two-hand), Stored materials (distance)
- **Gaming Context**: Weapons (one-hand), Interactive objects (two-hand), Magic items (distance)

The system's automatic handle management makes it seamless to use different grabbing types on different objects within the same scene.
