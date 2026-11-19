---
outline: [2, 4]
---

# Chapter 12: Physics

The IWSDK provides a comprehensive physics system powered by the `@babylonjs/havok` physics engine. This chapter covers everything you need to know about implementing realistic physics in your IWSDK applications.

## What You'll Build

By the end of this chapter, you'll be able to:

- Set up the Havok physics engine with customized gravity settings
- Create falling objects with realistic collision shapes and material properties
- Build static environments with floors, walls, and other immovable objects
- Implement grabbable objects with proper physics interactions
- Apply forces and manipulate object velocities for dynamic interactions
- Optimize physics performance for complex scenes

## Overview

The physics system is built using an Entity Component System (ECS) architecture and consists of three main components:

- **`PhysicsSystem`** - The core system that manages the Havok physics world
- **`PhysicsShape`** - Defines collision shapes and physics material properties (density, restition, friction)
- **`PhysicsBody`** - Defines the motion behavior of entities (Static, Dynamic, Kinematic)
- **`PhysicsManipulation`** - Applies one-time force and velocity changes

## Quick Start

Here's a minimal example to get physics working in your scene:

```javascript
import {
  World,
  PhysicsSystem,
  PhysicsBody,
  PhysicsShape,
  PhysicsState,
  PhysicsShapeType,
  Mesh,
  SphereGeometry,
  MeshStandardMaterial,
} from '@iwsdk/core';

// 1. Register the physics system with customized gravity
world
  .registerSystem(PhysicsSystem, { configData: { gravity: [0, -10, 0] } })
  .registerComponent(PhysicsBody)
  .registerComponent(PhysicsShape);

// 2. Create a mesh
const sphere = new Mesh(
  new SphereGeometry(0.5),
  new MeshStandardMaterial({ color: 0xff0000 }),
);
sphere.position.set(0, 5, 0);
scene.add(sphere);

// 3. Create entity and add physics components
const entity = world.createTransformEntity(sphere);
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Auto, // Automatically detects sphere
});
entity.addComponent(PhysicsBody, {
  state: PhysicsState.Dynamic, // Falls due to gravity
});
```

## System Setup

### Step 1: Register the Physics System

The `PhysicsSystem` must be registered with your world to enable physics simulation:

```javascript
world
  .registerSystem(PhysicsSystem)
  .registerComponent(PhysicsBody)
  .registerComponent(PhysicsShape);
```

### Step 2: Physics World Configuration

When physics is enabled through `iwsdk.config.json`, worker execution is the
default. You can also select the simulation frequency and render smoothing:

```jsonc
"physics": {
  "useWorker": true,
  "updateFrequency": 60,
  "interpolation": true
}
```

The physics system automatically creates a Havok physics world with:

- **Gravity**: Default value `[0, -9.81, 0]` (configurable in physics system) (Earth-like gravity)
- **Execution**: A dedicated Web Worker by default; set `useWorker` to `false` to run the same runtime on the main thread
- **Step Rate**: Fixed at 60 Hz by default and configurable up to 240 Hz
- **Render Smoothing**: Interpolates object transforms between physics snapshots by default
- **Scale**: `Auto` shapes and mesh-derived `ConvexHull`/`TriMesh` shapes use the object's world scale. Explicit `dimensions` ignore it unless you set `"applyScale": true`, which is recommended for new projects and will become the default
- **Automatic Cleanup**: Physics resources are cleaned up when entities are removed

## Understanding the Components

### PhysicsShape

Defines the collision shape and material properties of an entity.

```javascript
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Box,
  dimensions: [2, 1, 1],
  density: 1.0,
  friction: 0.5,
  restitution: 0.0,
});
```

#### Required Properties

- **`shape`** - The collision shape type (see [Shape Types](#shape-types))

#### Optional Properties

- **`dimensions`** - Shape-specific dimensions array. Not applicable when `PhysicsShapeType.Auto` is used.
- **`density`** - Mass density (default: 1.0)
- **`friction`** - Surface friction coefficient (default: 0.5)
- **`restitution`** - Bounciness factor (default: 0.0)

#### Shape Types

##### Auto Detection

The most convenient option that automatically detects the best shape from your Three.js geometry. When this type is selected, the dimensions field in PhysicsShape will be overridden by the size of the Three.js geometry.

```javascript
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Auto,
});
```

**Mapping Rules:**

- `SphereGeometry` → `Sphere`
- `BoxGeometry` → `Box`
- `PlaneGeometry` → `Box` (thin)
- `CylinderGeometry` → `Cylinder`
- Other geometries → `ConvexHull`

##### Sphere

Most efficient for round objects.

```javascript
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Sphere,
  dimensions: [0.5, 0, 0], // [radius, unused, unused]
});
```

##### Box

Perfect for rectangular objects.

```javascript
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Box,
  dimensions: [2, 1, 1], // [width, height, depth]
});
```

##### Cylinder

For cylindrical objects.

```javascript
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Cylinder,
  dimensions: [0.5, 2, 0], // [radius, height, unused]
});
```

##### ConvexHull

A convex hull is the smallest convex shape containing points. It has good balance between accuracy and performance for complex shapes.

```javascript
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.ConvexHull,
  // dimensions automatically calculated from geometry
});
```

##### TriMesh

Using tri mesh to fit the geometry. Most accurate but computationally expensive. Best for static objects.

```javascript
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.TriMesh,
  // dimensions automatically calculated from geometry
});
```

#### Physics Material Properties

#### Density

Controls the mass of the object. Higher density = heavier object.

```javascript
// Light object (foam ball)
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Sphere,
  dimensions: [0.5, 0, 0],
  density: 0.1,
});

// Heavy object (metal ball)
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Sphere,
  dimensions: [0.5, 0, 0],
  density: 10.0,
});
```

### Friction

Controls sliding behavior on surfaces (0 = no friction, 1 = high friction).

```javascript
// Slippery ice surface
iceEntity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Box,
  dimensions: [10, 0.1, 10],
  friction: 0.1,
});

// Grippy rubber surface
rubberEntity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Box,
  dimensions: [10, 0.1, 10],
  friction: 0.9,
});
```

### Restitution

Controls bounciness (0 = no bounce, 1 = perfect bounce).

```javascript
// Dead ball (no bounce)
deadBallEntity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Sphere,
  dimensions: [0.5, 0, 0],
  restitution: 0.0,
});

// Super bouncy ball
bouncyBallEntity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Sphere,
  dimensions: [0.5, 0, 0],
  restitution: 0.95,
});
```

### PhysicsBody

Defines the motion behavior of an entity in the physics simulation.

```javascript
entity.addComponent(PhysicsBody, {
  state: PhysicsState.Dynamic, // Required: motion type
});
```

#### Motion Types

- **`PhysicsState.Static`** - Immovable objects like walls and floors
  - Never moves, but affects other bodies
  - Ideal for environment geometry

- **`PhysicsState.Dynamic`** - Responds to forces and gravity
  - Affected by collisions, gravity, and applied forces
  - Most common for interactive objects

- **`PhysicsState.Kinematic`** - Programmatically controlled
  - Follows its Object3D: move or rotate the Object3D and the body sweeps there over the next physics steps, pushing dynamic bodies out of the way
  - Not affected by other bodies, gravity, forces or `PhysicsManipulation` (which is ignored with a warning)
  - Useful for moving platforms, doors or player-controlled objects

```javascript
// Static floor
floorEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });

// Dynamic ball that falls and bounces
ballEntity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic });

// Kinematic elevator platform
elevatorEntity.addComponent(PhysicsBody, { state: PhysicsState.Kinematic });
```

### PhysicsManipulation

The `PhysicsManipulation` component allows you to apply one-time forces and set velocities. The component is automatically removed after application.

#### Applying Forces

Forces are applied as impulses at the entity's center of mass:

```javascript
// Make object jump
entity.addComponent(PhysicsManipulation, {
  force: [0, 10, 0], // Upward force
});

// Throw object forward
entity.addComponent(PhysicsManipulation, {
  force: [5, 2, 0], // Forward and up
});
```

### Setting Velocities

Directly set linear and angular velocities:

```javascript
// Set specific movement
entity.addComponent(PhysicsManipulation, {
  linearVelocity: [3, 0, 0], // Move right at 3 m/s
  angularVelocity: [0, 2, 0], // Spin around Y-axis
});
```

### Combined Manipulation

You can combine forces and velocities in a single manipulation:

```javascript
entity.addComponent(PhysicsManipulation, {
  force: [0, 5, 0], // Push up
  linearVelocity: [2, 0, 0], // Set rightward velocity
  angularVelocity: [0, 1, 0], // Add spin
});
```

## Common Patterns

### Creating a Falling Object

```javascript
const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
box.position.set(0, 10, 0);
scene.add(box);

const entity = world.createTransformEntity(box);
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Auto,
});
entity.addComponent(PhysicsBody, {
  state: PhysicsState.Dynamic,
});
```

### Creating a Static Environment

```javascript
const floor = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial());
floor.position.set(0, 0, 0);
scene.add(floor);

const floorEntity = world.createTransformEntity(floor);
floorEntity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Auto,
});
floorEntity.addComponent(PhysicsBody, {
  state: PhysicsState.Static,
});
```

### Interactive Grabbable Objects

```javascript
// Create a grabbable ball
const ball = new Mesh(
  new SphereGeometry(0.2),
  new MeshStandardMaterial({ color: 0x00ff00 }),
);
ball.position.set(0, 2, 0);
scene.add(ball);

const ballEntity = world.createTransformEntity(ball);
ballEntity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Sphere,
  dimensions: [0.2],
  density: 0.5,
  restitution: 0.6,
});
ballEntity.addComponent(PhysicsBody, {
  state: PhysicsState.Dynamic,
});

// Add grabbing capability (requires GrabSystem)
ballEntity.addComponent(RayInteractable);
ballEntity.addComponent(OneHandGrabbable);
```

### Kinematic Moving Platforms

```javascript
const platform = new Mesh(
  new BoxGeometry(3, 0.2, 3),
  new MeshStandardMaterial({ color: 0x0000ff }),
);
scene.add(platform);

const platformEntity = world.createTransformEntity(platform);
platformEntity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Box,
  dimensions: [3, 0.2, 3],
  friction: 0.8,
});
platformEntity.addComponent(PhysicsBody, {
  state: PhysicsState.Kinematic,
});

// Animate the platform (in your update loop)
function animatePlatform(time) {
  platform.position.y = Math.sin(time * 0.001) * 2 + 2;
}
```

## Performance Optimization

1. **Use appropriate shape types:**
   - Primitives (Sphere, Box) are fastest
   - ConvexHull for moderate complexity
   - TriMesh only for static, highly detailed objects

2. **Optimize shape complexity:**
   - Simplify meshes when possible. Use ConvexHull over TriMesh when possble.
   - Use fewer vertices for ConvexHull and TriMesh shapes

3. **Manage entity count:**
   - Remove physics components from distant objects
   - Use object pooling for frequently created/destroyed objects

## Troubleshooting

### Common Issues

**Physics objects fall through the floor:**

- Ensure your floor has a `PhysicsShape` component
- Make sure floor has a `PhysicsBody` component with `PhysicsState.Static`
- Check that floor dimensions match visual geometry, including the object's scale (see `applyScale`)

**Objects don't collide:**

- Verify both objects have `PhysicsShape` components
- Check that shapes have appropriate dimensions
- Ensure objects are not starting inside each other
- Make sure the floor has a `PhysicsBody` component with `PhysicsState.Static`

**Poor performance:**

- Use simpler shape types when possible
- Reduce the number of physics entities
- Consider using TriMesh only for static objects

**Objects behave unexpectedly:**

- Check density values (very high/low values can cause issues)
- Verify friction and restitution are in reasonable ranges (0-1)
- Ensure forces aren't too large

### Debug Tips

2. **Log component values** to verify they're set correctly
3. **Test with simple primitive shapes** before using complex geometry
4. **Check console for warnings** from the physics system

## Native Scene JSON Usage

Physics components can be authored directly in native scene JSON and loaded
through `World.create({ level })`:

```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "resources": {},
  "nodes": [
    {
      "id": "dynamic-box",
      "content": {
        "type": "asset",
        "asset": "dynamic-box"
      },
      "transform": { "position": [0, 1, -1] },
      "components": {
        "PhysicsBody": { "state": "DYNAMIC" },
        "PhysicsShape": {
          "shape": "Box",
          "dimensions": [1, 1, 1],
          "density": 1,
          "friction": 0.5,
          "restitution": 0
        },
        "PhysicsManipulation": {
          "force": [0, 10, 0],
          "linearVelocity": [0, 0, 0],
          "angularVelocity": [0, 0, 0]
        }
      }
    }
  ]
}
```

Register `dynamic-box` as a mesh in the project's `defineAssets()` module. Scene
JSON v1 references application assets; it does not declare geometry or materials
inline.

Use the native scene editor for placement and validation, especially when a
physics object needs a precise surface relationship with the floor or another
collider.

## Example Projects

Check out the `examples/physics` project in the SDK for a complete working example that demonstrates:

- Basic physics setup
- Dynamic sphere creation
- Force application
- Integration with XR interactions

The example creates a bouncing sphere with applied forces and can be run with:

```bash
cd examples/physics
pnpm install
pnpm dev
```
