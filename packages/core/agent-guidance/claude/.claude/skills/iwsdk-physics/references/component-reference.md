## PhysicsBody Component Reference

Defines the motion behavior of a physics entity. Import from `@iwsdk/core`.

```typescript
import { PhysicsBody, PhysicsState } from '@iwsdk/core';

entity.addComponent(PhysicsBody, {
  state: PhysicsState.Dynamic,
  linearDamping: 0.0,
  angularDamping: 0.0,
  gravityFactor: 1.0,
  centerOfMass: [Infinity, Infinity, Infinity], // Infinity = auto-compute from shape
});
```
**Properties:**

| Property         | Type           | Default                          | Description                                           |
| ---------------- | -------------- | -------------------------------- | ----------------------------------------------------- |
| `state`          | `PhysicsState` | `Dynamic`                        | Motion type (see below)                               |
| `linearDamping`  | `Float32`      | `0.0`                            | Air resistance for translation (0 = none, 1 = heavy)  |
| `angularDamping` | `Float32`      | `0.0`                            | Air resistance for rotation                           |
| `gravityFactor`  | `Float32`      | `1.0`                            | Gravity multiplier (0 = floating, 2 = double gravity) |
| `centerOfMass`   | `Vec3`         | `[Infinity, Infinity, Infinity]` | Override center of mass; `Infinity` = auto-compute    |

**Read-only properties** (updated each frame by `PhysicsSystem`):

| Property           | Type   | Description              |
| ------------------ | ------ | ------------------------ |
| `_linearVelocity`  | `Vec3` | Current linear velocity  |
| `_angularVelocity` | `Vec3` | Current angular velocity |

### PhysicsState Enum

```typescript
PhysicsState.Static; // Immovable (walls, floors). Zero simulation cost.
PhysicsState.Dynamic; // Fully simulated. Responds to forces, gravity, collisions.
PhysicsState.Kinematic; // Programmatically moved. Pushes dynamic bodies but is not affected by them.
```

**When to use each:**

- **Static** -- Environment geometry (walls, floors, tables). Objects that never move but block dynamic bodies.
- **Dynamic** -- Objects that respond to physics (balls, crates, interactive props). Default for most gameplay objects.
- **Kinematic** -- Moving platforms that won't be pushed by other physics bodies.

## PhysicsShape Component Reference

Defines the collision geometry and material properties. Both `PhysicsShape` and `PhysicsBody` are required for physics simulation.

```typescript
import { PhysicsShape, PhysicsShapeType } from '@iwsdk/core';

entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Auto,
  dimensions: [0, 0, 0],
  density: 1.0,
  restitution: 0.0,
  friction: 0.5,
});
```

**Properties:**

| Property      | Type               | Default     | Description                                                                           |
| ------------- | ------------------ | ----------- | ------------------------------------------------------------------------------------- |
| `shape`       | `PhysicsShapeType` | `Auto`      | Collision shape type                                                                  |
| `dimensions`  | `Vec3`             | `[0, 0, 0]` | Shape-specific dimensions array. Not applicable when `PhysicsShapeType.Auto` is used. |
| `density`     | `Float32`          | `1.0`       | Mass density (kg/m^3). Higher = heavier.                                              |
| `restitution` | `Float32`          | `0.0`       | Bounciness (0 = no bounce, 1 = perfect bounce)                                        |
| `friction`    | `Float32`          | `0.5`       | Surface friction (0 = ice, 1 = rubber)                                                |

### PhysicsShapeType Enum

```typescript
PhysicsShapeType.Sphere; // dimensions[0] = radius
PhysicsShapeType.Box; // dimensions = [width, height, depth]
PhysicsShapeType.Cylinder; // dimensions[0] = radius, dimensions[1] = height
PhysicsShapeType.Capsules; // dimensions[0] = radius, dimensions[1] = total height (>= 2 * radius)
PhysicsShapeType.ConvexHull; // Convex wrapper around mesh vertices (dimensions ignored)
PhysicsShapeType.TriMesh; // Exact mesh triangles (dimensions ignored). Expensive; use for static only.
PhysicsShapeType.Auto; // Auto-detect from Three.js geometry type
```

### Dimensions by Shape Type

The `dimensions` property is a `Vec3` (`[x, y, z]`) whose meaning changes depending on the selected shape:

| Shape Type   | `dimensions[0]` | `dimensions[1]` | `dimensions[2]` | Example                         |
| ------------ | --------------- | --------------- | --------------- | ------------------------------- |
| `Sphere`     | radius          | _(unused)_      | _(unused)_      | `[0.5, 0, 0]` -- sphere r=0.5   |
| `Box`        | width           | height          | depth           | `[1, 2, 0.5]` -- 1×2×0.5 box    |
| `Cylinder`   | radius          | height          | _(unused)_      | `[0.3, 1.5, 0]` -- r=0.3, h=1.5 |
| `Capsules`   | radius          | total height    | _(unused)_      | `[0.3, 1.5, 0]` -- r=0.3, h=1.5 |
| `ConvexHull` | _(ignored)_     | _(ignored)_     | _(ignored)_     | Computed from mesh vertices     |

Capsule total height is measured end to end and must be at least twice its
radius. A total height equal to the diameter produces a sphere-length capsule.
| `TriMesh` | _(ignored)_ | _(ignored)_ | _(ignored)_ | Computed from mesh triangles |
| `Auto` | _(ignored)_ | _(ignored)_ | _(ignored)_ | Auto-detected from geometry |

For `ConvexHull`, `TriMesh`, and `Auto`, the dimensions array is not used -- the shape is derived directly from the entity's Three.js geometry.

**Auto-detection mapping:**

| Three.js Geometry               | Detected Shape | Dimensions Source                               |
| ------------------------------- | -------------- | ----------------------------------------------- |
| `SphereGeometry`                | Sphere         | `radius` from geometry parameters               |
| `BoxGeometry`                   | Box            | `width, height, depth` from parameters          |
| `PlaneGeometry`                 | Box            | `width, height, 0.01` (thin box)                |
| `CylinderGeometry`              | Cylinder       | Average of `radiusTop`/`radiusBottom`, `height` |
| `BufferGeometry` (generic/GLTF) | ConvexHull     | From mesh vertices                              |
| Unknown                         | Box (fallback) | From bounding box                               |

**Performance guidance:**

- Sphere/Box/Cylinder: Fastest collision detection. Prefer these when possible.
- ConvexHull: Good balance for complex meshes. Default for GLTF models via Auto.
- TriMesh: Exact geometry collision. Use only for static objects (walls, floors, terrain).

## PhysicsManipulation Component Reference

A **one-shot** component for applying forces and velocities. Automatically removed after one frame.

```typescript
import { PhysicsManipulation } from '@iwsdk/core';

// Apply an impulse (removed automatically after 1 frame)
entity.addComponent(PhysicsManipulation, {
  force: [0, 10, 0], // Impulse force vector
  linearVelocity: [0, 0, 0], // Override linear velocity (0 = no change)
  angularVelocity: [0, 0, 0], // Override angular velocity (0 = no change)
});
```

**Properties:**

| Property          | Type   | Default     | Description                             |
| ----------------- | ------ | ----------- | --------------------------------------- |
| `force`           | `Vec3` | `[0, 0, 0]` | Impulse force applied at center of mass |
| `linearVelocity`  | `Vec3` | `[0, 0, 0]` | Sets absolute linear velocity           |
| `angularVelocity` | `Vec3` | `[0, 0, 0]` | Sets absolute angular velocity          |

**The component is auto-removed** by `PhysicsSystem` after applying values. For sustained forces, re-add each frame:

```typescript
update() {
  if (!entity.hasComponent(PhysicsManipulation)) {
    entity.addComponent(PhysicsManipulation, { force: [0, 5, 0] });
  }
}
```
