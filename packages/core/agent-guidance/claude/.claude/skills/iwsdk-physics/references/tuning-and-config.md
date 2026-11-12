## Material Tuning Guide

Adjust `density`, `restitution`, and `friction` on `PhysicsShape` to simulate different materials:

| Material    | Density | Restitution | Friction |
| ----------- | ------- | ----------- | -------- |
| Wood        | 0.6     | 0.3         | 0.5      |
| Metal/Steel | 7.8     | 0.2         | 0.4      |
| Rubber      | 1.1     | 0.8         | 0.9      |
| Ice         | 0.9     | 0.1         | 0.05     |
| Concrete    | 2.4     | 0.1         | 0.7      |
| Foam/Light  | 0.05    | 0.1         | 0.6      |
| Bouncy ball | 1.0     | 0.95        | 0.5      |

## System Priority Order

Physics runs in a carefully orchestrated sequence:

```
Priority -5: LocomotionSystem  (Player movement)
Priority -4: InputSystem       (Controller/hand input)
Priority -3: GrabSystem        (Grab interactions)
Priority -2: PhysicsSystem     (Physics simulation)
Priority -1: SceneUnderstanding (AR plane/mesh updates)
```

Register custom physics-related systems after the built-in PhysicsSystem (priority > -2) to read updated transforms:

```typescript
world.registerSystem(MyPhysicsLogicSystem, { priority: 5 });
```

## PhysicsSystem Configuration

The project manifest accepts execution, frequency, and interpolation options:

```jsonc
"physics": {
  "useWorker": true,
  "updateFrequency": 60,
  "interpolation": true
}
```

- `useWorker` defaults to `true`. Set it to `false` to run the same runtime and message protocol on the main thread.
- `updateFrequency` defaults to 60 Hz and is capped at 240 Hz.
- `interpolation` defaults to `true` and smooths rendered transforms between fixed physics snapshots.

The system also accepts a reactive `gravity` config (defaults to Earth gravity):

```typescript
import { PhysicsSystem } from '@iwsdk/core';

const physicsSystem = world.getSystem(PhysicsSystem);
physicsSystem.config.gravity.value = [0, -9.81, 0]; // Earth gravity (default)
physicsSystem.config.gravity.value = [0, -1.62, 0]; // Moon gravity
physicsSystem.config.gravity.value = [0, 0, 0]; // Zero gravity
```

## Native Scene JSON Configuration

Physics components can be configured declaratively in native scene JSON files:

```json
{
  "id": "dynamic-box",
  "content": { "type": "asset", "asset": "box" },
  "transform": { "position": [0, 1.5, -1] },
  "components": {
    "PhysicsShape": {
      "shape": "Box",
      "dimensions": [1, 1, 1],
      "density": 1,
      "friction": 0.5,
      "restitution": 0
    },
    "PhysicsBody": {
      "state": "DYNAMIC",
      "gravityFactor": 1,
      "linearDamping": 0,
      "angularDamping": 0
    }
  }
}
```

**State enum values in scene JSON:**

- `STATIC`
- `DYNAMIC`
- `KINEMATIC`

**Shape enum values in scene JSON:**

- `Sphere`
- `Box`
- `Cylinder`
- `Capsules`
- `ConvexHull`
- `TriMesh`
- `Auto`
