# IWSDK API Reference & Best Practices

Ground-truth API patterns for IWSDK app development. This file is the shared
API reference behind `iwsdk-dev`; load it when grounding implementation details,
writing IWSDK code, or reviewing it. It contains no process guidance. The router
lives in `SKILL.md`, and the internal planner and iterate playbooks are siblings
in this directory.

**Version sensitivity:** this reference tracks the SDK at the time the skill
shipped. For any API your plan depends on, verify the signature against the
_installed_ package (`node_modules/@iwsdk/core/dist/**/*.d.ts`) — newer
methods (e.g. `GrabSystem.forceRelease`) may not exist in the version your
app has installed, and vice versa.

## Core Architecture

IWSDK is built on three pillars:

1. **ECS (Entity Component System)** via `elics` library
2. **Reactive Signals** via `@preact/signals-core`
3. **Three.js Integration** with zero-copy transform binding (super-three v0.185.0)

IWSDK is a 3D web framework with first-class XR support. `World.create()` always creates a persistent `world.player` origin and keeps `world.camera` under it, even when `xr: false` is used for browser-only apps. For first-person browser movement, move `world.player`; for orbit, editor, product, cinematic, or third-person cameras, it is fine to keep `world.player` at the origin and drive `world.camera`. Remember that `world.camera.position` is local to `world.player`, so use `camera.getWorldPosition(...)` when world-space viewer position matters.

### Project manifest authority

Generated 0.5 projects keep JSON-safe scene, module, XR, render, input, feature,
and emulator settings in `iwsdk.config.json`. `src/index.ts` imports
`virtual:iwsdk-project`, passes it to `World.create()`, and retains explicit
system registration. The direct `World.create(container, WorldOptions)` shapes
below remain the low-level API reference; when editing a generated project,
translate their serializable fields into the manifest instead of creating a
second configuration authority in code.

Asset/component modules are selected by extensionless manifest paths and are
shared by runtime and editor. Build local public URLs from
`import.meta.env.BASE_URL`; literal `./...` URLs resolve against the managed
editor route during editor use and are not a safe project-wide convention.

Use `input.canvasPointerEvents` for browser mouse/touch canvas events. Browser canvas pointers and XR rays both feed Three/Object3D pointer events and ECS `Hovered`/`Pressed` tags on `RayInteractable` entities. XR-specific input is available at `world.input.xr`; keyboard and standard browser gamepads live at `world.input.keyboard` and `world.input.browserGamepads`. Reusable systems should prefer `world.input.actions` for intent such as `locomotion.move` or `locomotion.jump`; opt into browser locomotion bindings with `features.locomotion.browserControls`.

## Critical Best Practices

`createSystem()` accepts query descriptors as its first argument and optional
configuration schema as its second. Lifecycle methods never go inside either
object: define `init()`, `update()`, and `destroy()` in the subclass body. A
function inside the query map is a lifecycle-placement mistake, not a query.

### 1. Keep Systems Stateless

Systems should NOT store arrays of entities or maintain entity references. Use queries instead.

```typescript
// ❌ BAD - Storing entity references
export class BadSystem extends createSystem({
  items: { required: [MyComponent] },
}) {
  private myEntities: Entity[] = []; // DON'T DO THIS

  init() {
    this.queries.items.subscribe('qualify', (entity) => {
      this.myEntities.push(entity); // BAD: manually tracking entities
    });
  }
}

// ✅ GOOD - Use queries for entity access
export class GoodSystem extends createSystem({
  items: { required: [MyComponent] },
}) {
  update() {
    // Query always gives current matching entities
    for (const entity of this.queries.items.entities) {
      // Process entity
    }
  }
}
```

**Exception:** Scratch variables for temporary per-frame calculations are OK.

### 2. Use Query Subscribe/Unsubscribe for Reactive Programming

Instead of polling or storing state, react to entity lifecycle events:

```typescript
export class ReactiveSystem extends createSystem({
  interactables: { required: [RayInteractable, Transform] },
}) {
  init() {
    // React when entities enter the query
    this.queries.interactables.subscribe('qualify', (entity) => {
      this.setupEventListeners(entity);
    });

    // React when entities leave the query
    this.queries.interactables.subscribe('disqualify', (entity) => {
      this.cleanupEventListeners(entity);
    });
  }
}
```

### 3. Use Signals for Reactive State

IWSDK uses `@preact/signals-core`. Prefer signals over manual state tracking:

```typescript
// System config properties are automatically signals
export class MySystem extends createSystem(
  {},
  {
    speed: { type: Types.Float32, default: 5.0 },
    jumpHeight: { type: Types.Float32, default: 2.0 },
  },
) {
  init() {
    // Subscribe to config changes reactively
    this.cleanupFuncs.push(
      this.config.speed.subscribe((newSpeed) => {
        console.log('Speed changed:', newSpeed);
      }),
    );
  }

  update(delta) {
    // Read signal value with .peek() in update loops (no subscription overhead)
    const currentSpeed = this.config.speed.peek();
  }
}
```

### World Globals Signals for Cross-System Communication

Store signals in `world.globals` for state that multiple systems need to read/write:

```typescript
// In index.ts (initialization)
import { signal } from '@preact/signals-core';

(world.globals as Record<string, unknown>).gamePaused = signal(true);
(world.globals as Record<string, unknown>).audioMasterVolume = signal(1.0);

// In any system (reading with peek() in hot paths)
const gamePaused = (this.globals.gamePaused as Signal<boolean>).peek();

// In any system (writing)
const gamePausedSignal = this.globals.gamePaused as Signal<boolean>;
gamePausedSignal.value = !gamePausedSignal.value;
```

### 4. Component Types (Complete List)

```typescript
import { Types } from '@iwsdk/core';

Types.Float32; // 32-bit float
Types.Float64; // 64-bit float (for physics engine refs)
Types.Int8; // 8-bit signed integer
Types.Int16; // 16-bit signed integer
Types.Int32; // 32-bit signed integer
Types.Boolean; // true/false
Types.String; // text
Types.FilePath; // file path string (asset-referencing fields like AudioSource.src)
Types.Vec2; // [x, y] - 2 floats
Types.Vec3; // [x, y, z] - 3 floats
Types.Vec4; // [x, y, z, w] - 4 floats (quaternions)
Types.Color; // [r, g, b, a] - 4 floats (RGBA)
Types.Entity; // Reference to another entity
Types.Enum; // Enumerated value
Types.Object; // Any JS object (avoid if possible - not optimized)
```

### 5. Component Design Patterns

```typescript
import { createComponent, Types } from '@iwsdk/core';

// Tag component (no data, just marks entities)
export const Targetable = createComponent('Targetable', {}, '');

// Data component with proper types
export const Health = createComponent('Health', {
  current: { type: Types.Float32, default: 100 },
  max: { type: Types.Float32, default: 100 },
});

// With enums
export const State = createComponent('State', {
  mode: {
    type: Types.Enum,
    enum: { Idle: 'idle', Moving: 'moving', Attacking: 'attacking' },
    default: 'idle',
  },
});

// With vectors (stored as TypedArrays for performance)
export const Velocity = createComponent('Velocity', {
  linear: { type: Types.Vec3, default: [0, 0, 0] },
  angular: { type: Types.Vec3, default: [0, 0, 0] },
});

// With colors (RGBA, 4 components)
export const Tint = createComponent('Tint', {
  color: { type: Types.Color, default: [1, 1, 1, 1] },
});
```

### 6. Query Patterns with Filters

```typescript
export class DamageSystem extends createSystem({
  // Basic query
  enemies: { required: [Enemy] },

  // With exclusions
  vulnerableEnemies: {
    required: [Enemy, Health],
    excluded: [Invulnerable, Shield],
  },

  // With value filters
  lowHealth: {
    required: [Health],
    where: [lt(Health, 'current', 20)],
  },

  // Complex filters
  activeBosses: {
    required: [Boss, Health],
    where: [gt(Health, 'current', 0), eq(State, 'mode', 'attacking')],
  },
}) {}

// Available filter operators: eq, ne, lt, le, gt, ge, isin, nin
```

### 7. System Interface (Full)

```typescript
interface System {
  // World access
  world: World;

  // Query results
  queries: Record<string, Query>;

  // Reactive config (auto-created from schema)
  config: { [key]: Signal };

  // Cleanup registration
  cleanupFuncs: Array<() => void>;

  // XR/Player access
  player: XROrigin;
  input: InputManager; // XR devices at input.xr, keyboard at input.keyboard, browser gamepads at input.browserGamepads, actions at input.actions

  // Three.js access
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;

  // XR state
  visibilityState: Signal<VisibilityState>;
  xrManager: WebXRManager;
  xrFrame: XRFrame;

  // Shared state
  globals: Record<string, any>;

  // Entity creation helpers
  createEntity(): Entity;
  createTransformEntity(object?: Object3D, parent?: Entity): Entity;

  // Lifecycle
  init(): void;
  update(delta: number, time: number): void;
  play(): void;
  stop(): void;
}
```

### 8. XR Input System (Critical)

```typescript
update() {
  const leftGamepad = this.input.xr.gamepads.left;
  const rightGamepad = this.input.xr.gamepads.right;

  // Button states
  leftGamepad?.getButtonPressed(InputComponent.Trigger); // Currently pressed
  leftGamepad?.getButtonDown(InputComponent.Trigger);    // Just pressed this frame
  leftGamepad?.getButtonUp(InputComponent.Trigger);      // Just released this frame
  leftGamepad?.getButtonValue(InputComponent.Trigger);   // Analog value 0-1
  leftGamepad?.getButtonTouched(InputComponent.Trigger); // Finger touching

  // Special select button (primary action)
  leftGamepad?.getSelectStart(); // Primary button just pressed
  leftGamepad?.getSelectEnd();   // Primary button just released
  leftGamepad?.getSelecting();   // Primary button held

  // Thumbstick/touchpad axes
  const axes = leftGamepad?.getAxesValues(InputComponent.Thumbstick);
  console.log(axes?.x, axes?.y); // -1 to 1 range

  // Directional axes state
  leftGamepad?.getAxesEnteringUp(InputComponent.Thumbstick);
  leftGamepad?.getAxesEnteringDown(InputComponent.Thumbstick);
  leftGamepad?.getAxesEnteringLeft(InputComponent.Thumbstick);
  leftGamepad?.getAxesEnteringRight(InputComponent.Thumbstick);
}
```

**InputComponent Enum:**

```typescript
import { InputComponent } from '@iwsdk/core';

InputComponent.Trigger; // 'xr-standard-trigger'
InputComponent.Squeeze; // 'xr-standard-squeeze'
InputComponent.Touchpad; // 'xr-standard-touchpad'
InputComponent.Thumbstick; // 'xr-standard-thumbstick'
InputComponent.A_Button; // 'a-button'
InputComponent.B_Button; // 'b-button'
InputComponent.X_Button; // 'x-button'
InputComponent.Y_Button; // 'y-button'
InputComponent.Thumbrest; // 'thumbrest'
InputComponent.Menu; // 'menu'
```

### 9. Player/XROrigin Access (Critical)

```typescript
// Accessing player spatial hierarchy in a system
this.player; // XROrigin (Group) - VR rig root
this.player.head; // Head tracking (viewer pose)
this.player.raySpaces.left; // Left controller ray origin
this.player.raySpaces.right; // Right controller ray origin
this.player.gripSpaces.left; // Left controller grip pose
this.player.gripSpaces.right; // Right controller grip pose
this.player.secondaryRaySpaces.left; // Secondary left ray
this.player.secondaryRaySpaces.right; // Secondary right ray
this.player.secondaryGripSpaces.left; // Secondary left grip
this.player.secondaryGripSpaces.right; // Secondary right grip

// Getting world positions
const headPos = new Vector3();
this.player.head.getWorldPosition(headPos);

const rightHandPos = new Vector3();
this.player.gripSpaces.right.getWorldPosition(rightHandPos);

// Attach a held model so it inherits both grip position and orientation.
heldModel.position.set(0, -0.02, 0.05); // Model-local alignment offset.
this.player.gripSpaces.right.add(heldModel);
```

### 10. Audio System

```typescript
import {
  AudioSource,
  PlaybackMode,
  AudioUtils,
  InstanceStealPolicy,
  DistanceModel,
} from '@iwsdk/core';

// Adding audio to an entity
entity.addComponent(AudioSource, {
  src: 'audio/click.mp3',
  positional: true, // 3D spatial audio
  loop: false,
  autoplay: false,
  volume: 0.5,
  refDistance: 1,
  rolloffFactor: 1,
  maxDistance: 10000,
  maxInstances: 1,
  playbackMode: PlaybackMode.Restart,
});

// Playing audio
AudioUtils.play(entity);
```

**PlaybackMode:**

```typescript
PlaybackMode.Restart; // Stop current and restart
PlaybackMode.Overlap; // Always start new instance
PlaybackMode.Ignore; // Ignore if already playing
PlaybackMode.FadeRestart; // Fade out current, start new
```

**InstanceStealPolicy:**

```typescript
InstanceStealPolicy.Oldest; // Steal oldest instance
InstanceStealPolicy.Quietest; // Steal quietest instance
InstanceStealPolicy.Furthest; // Steal furthest instance
```

**DistanceModel:**

```typescript
DistanceModel.Linear; // Linear falloff
DistanceModel.Inverse; // Inverse falloff
DistanceModel.Exponential; // Exponential falloff
```

### 11. Physics System

**PhysicsBody - motion properties:**

```typescript
import { PhysicsBody, PhysicsState, PhysicsSystem } from '@iwsdk/core';

entity.addComponent(PhysicsBody, {
  state: PhysicsState.Dynamic, // Static, Dynamic, Kinematic
  linearDamping: 0.0,
  angularDamping: 0.0,
  gravityFactor: 1.0,
  centerOfMass: [Infinity, Infinity, Infinity], // Infinity = auto-compute
});
```

**PhysicsState:**

```typescript
PhysicsState.Static; // Immovable (walls, floors)
PhysicsState.Dynamic; // Affected by physics
PhysicsState.Kinematic; // Moved by code, affects others
```

**PhysicsShape - collision shape AND material properties:**

```typescript
import { PhysicsShape, PhysicsShapeType } from '@iwsdk/core';

entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Auto, // Auto-detect from geometry
  dimensions: [0, 0, 0], // Shape-specific dimensions
  density: 1.0, // Affects mass
  restitution: 0.0, // Bounciness (0-1)
  friction: 0.5, // Sliding behavior
});
```

**PhysicsShapeType:**

```typescript
PhysicsShapeType.Sphere; // dimensions[0] = radius
PhysicsShapeType.Box; // dimensions = [width, height, depth]
PhysicsShapeType.Cylinder; // dimensions[0] = radius, dimensions[1] = height
PhysicsShapeType.Capsules; // dimensions[0] = radius, dimensions[1] = total height (>= 2 * radius)
PhysicsShapeType.ConvexHull; // Convex wrapper around mesh
PhysicsShapeType.TriMesh; // Exact mesh geometry (expensive)
PhysicsShapeType.Auto; // Auto-detect from Three.js geometry
```

**Teleporting / re-posing an existing body:** use the live physics system rather than
removing and re-adding components. It updates Havok and the Object3D immediately and
clears velocity by default:

```typescript
const physics = world.getSystem(PhysicsSystem);
physics.setBodyTransform(entity, {
  position: homePosition,
  quaternion: homeQuaternion,
});
```

Writing only the Transform of a dynamic body is clobbered by the next physics frame.
`gravityFactor`, `linearDamping`, and `angularDamping` are reactive; motion `state` and
shape construction still require deliberate body lifecycle handling.

### 12. Grabbable Components

```typescript
import {
  OneHandGrabbable,
  TwoHandsGrabbable,
  DistanceGrabbable,
  MovementMode,
} from '@iwsdk/core';

// Basic single-hand grab
entity.addComponent(OneHandGrabbable, {});

// Constrained manipulation
entity.addComponent(OneHandGrabbable, {
  rotate: true,
  rotateMin: [0, -Math.PI, 0],
  rotateMax: [0, Math.PI, 0],
  translate: true,
  translateMin: [-2, 0, -2],
  translateMax: [2, 3, 2],
});

// Two-hand manipulation (with scaling)
entity.addComponent(TwoHandsGrabbable, {
  rotate: true,
  translate: true,
  scale: true,
  scaleMin: [0.5, 0.5, 0.5],
  scaleMax: [2, 2, 2],
});

// ⚠️ One handle per entity: OneHandGrabbable, TwoHandsGrabbable, and
// DistanceGrabbable are MUTUALLY EXCLUSIVE on the same entity (GrabSystem
// creates a single Handle; near-grab denies ray pointers, distance-grab
// denies grab pointers). Pick one per entity — DistanceGrabbable with
// MoveTowardsTarget covers both near and far pickup via trigger.

// Distance grab
entity.addComponent(DistanceGrabbable, {
  rotate: true,
  translate: true,
  scale: true,
  movementMode: MovementMode.MoveTowardsTarget, // MoveTowardsTarget | MoveAtSource | RotateAtSource | MoveFromTarget
  returnToOrigin: false, // Snap back when released
  moveSpeedFactor: 0.1, // MoveTowardsTarget pull lerp: alpha = factor * delta * 100, NOT clamped — keep <= 0.03 if frames can hitch (background tabs/CI) or the pull overshoots and diverges
});

// Force-release / hand lookup (game reset, weapon swap, recoil, etc.)
import { GrabSystem } from '@iwsdk/core';
const grab = world.getSystem(GrabSystem);
grab.forceRelease(entity); // drop a held entity safely (no-op if not held)
const hand = grab.getHolderHand(entity); // 'left' | 'right' | null ('left' for two-hand grabs)
```

### 13. Environment/Lighting

```typescript
import {
  DomeGradient,
  DomeTexture,
  IBLGradient,
  IBLTexture,
} from '@iwsdk/core';

// Gradient sky dome (RGBA display colors - 4 components)
entity.addComponent(DomeGradient, {
  sky: [0.2423, 0.6172, 0.8308, 1.0], // RGBA
  equator: [0.6584, 0.7084, 0.7913, 1.0], // RGBA
  ground: [0.807, 0.7758, 0.7454, 1.0], // RGBA
  intensity: 1.0, // 0 = black
  elevationDeg: 90, // sky pole height: 90 = straight up, lower tilts it
  azimuthDeg: 0, // sky pole heading, node Y-rotation convention (90 = -X)
  dither: false, // true adds ±0.5/255 noise against banding
});

// HDR texture sky
entity.addComponent(DomeTexture, {
  src: './textures/sky.hdr',
});

// Image-based lighting from gradient
entity.addComponent(IBLGradient, {
  sky: [0.6902, 0.749, 0.7843, 1.0], // RGBA
  equator: [0.6584, 0.7084, 0.7913, 1.0], // RGBA
  ground: [0.807, 0.7758, 0.7454, 1.0], // RGBA
  intensity: 1.0, // applied once since 1.1.0 (square a 1.0.x value)
});

// IBL from texture
entity.addComponent(IBLTexture, {
  src: 'room', // or URL to HDR
  intensity: 1.0,
  rotation: [0, 0, 0],
});
```

**Critical Environment Usage Notes:**

1. **Environment components MUST be added to the level root entity**, not arbitrary entities. The `EnvironmentSystem` queries require `LevelRoot`:

   ```typescript
   // ❌ BAD - Added to a random entity (silently ignored)
   someEntity.addComponent(DomeGradient, { ... });

   // ✅ GOOD - Added to the level root
   const root = world.activeLevel.value;
   root.addComponent(DomeGradient, { sky: [0.24, 0.62, 0.83, 1.0], ... });
   ```

2. **After changing `DomeTexture` or `IBLTexture`, MUST set `_needsUpdate: true`** — their changes are silently ignored without it. `DomeGradient` and `IBLGradient` apply edits on the next frame; `_needsUpdate` is optional for them:

   ```typescript
   root.setValue(DomeTexture, 'intensity', 0.6);
   root.setValue(DomeTexture, '_needsUpdate', true); // Required for textures!

   root.getVectorView(DomeGradient, 'sky').set([0.1, 0.2, 0.8, 1.0]); // applies next frame
   root.setValue(DomeGradient, 'elevationDeg', 30); // applies next frame
   ```

3. **Background vs IBL are separate**: `DomeTexture`/`DomeGradient` controls the visible sky. `IBLTexture`/`IBLGradient` controls scene lighting (reflections, ambient). You can mix them:

   ```typescript
   root.addComponent(DomeTexture, { src: './envs/sky.hdr', intensity: 0.9 });
   root.addComponent(IBLTexture, { src: 'room', intensity: 1.2 }); // Lighting only
   ```

4. **In AR sessions**, backgrounds (dome) are automatically hidden but IBL remains active for realistic lighting on virtual objects.

5. **`DomeFade` is a node component** that fades that node's own meshes into the root `DomeGradient` with horizontal distance from the node origin, so a floor has no visible edge. It does nothing without a `DomeGradient`, and its meshes hide with the dome in AR:

   ```json
   {
     "id": "floor",
     "content": { "type": "asset", "asset": "floor" },
     "components": {
       "com.iwsdk.components.DomeFade": { "start": 4, "end": 10 }
     }
   }
   ```

### 14. Asset Loading

```typescript
import { AssetManager, AssetType } from '@iwsdk/core';

const publicAssetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\/+/u, '')}`;

const world = await World.create(container, {
  assets: {
    myModel: {
      url: publicAssetUrl('models/scene.glb'),
      type: AssetType.GLTF,
      priority: 'critical',
    },
    mySound: {
      url: publicAssetUrl('audio/click.mp3'),
      type: AssetType.Audio,
      priority: 'background',
    },
    myTexture: {
      url: publicAssetUrl('textures/wood.jpg'),
      type: AssetType.Texture,
    },
    myHDR: {
      url: publicAssetUrl('textures/env.hdr'),
      type: AssetType.HDRTexture,
    },
  },
});

// Access preloaded assets
const model = AssetManager.getGLTF('myModel');
// `getGLTF` returns a fresh clone of `scene`/`scenes` per call, so the
// same key safely backs multiple entities. Use `{ shared: true }` for
// the cached instance.
const texture = AssetManager.getTexture('myTexture');
const audio = AssetManager.getAudio('mySound');
```

**AssetType Enum:**

```typescript
AssetType.GLTF; // 3D models
AssetType.Audio; // Sound files
AssetType.Texture; // Images
AssetType.HDRTexture; // HDR environment maps
```

### 15. VisibilityState

```typescript
import { VisibilityState } from '@iwsdk/core';

VisibilityState.NonImmersive; // Browser mode (no XR)
VisibilityState.Hidden; // XR but not rendering
VisibilityState.Visible; // Full XR experience
VisibilityState.VisibleBlurred; // XR but focus lost

this.world.visibilityState.subscribe((state) => {
  switch (state) {
    case VisibilityState.NonImmersive:
      // Show 2D fallback UI
      break;
    case VisibilityState.Visible:
      // Full XR experience
      break;
    case VisibilityState.VisibleBlurred:
      // Pause game, show overlay
      break;
  }
});
```

### XR Session Optimization

Configure frame rate and foveation when the XR session becomes visible:

```typescript
this.world.visibilityState.subscribe((state) => {
  if (state === VisibilityState.Visible) {
    this.world.session?.updateTargetFrameRate(72); // Request 72 FPS
    this.world.renderer.xr.setFoveation(1); // Max foveation for performance
  }
});
```

### 16. Locomotion Configuration

```typescript
import { LocomotionSystem, TurningMethod } from '@iwsdk/core';

const locomotion = world.getSystem(LocomotionSystem);

// All config properties are signals
locomotion.config.slidingSpeed.value = 3.0;
locomotion.config.turningMethod.value = TurningMethod.SmoothTurn; // SnapTurn = 1, SmoothTurn = 2 — always use the enum, not raw numbers
locomotion.config.turningAngle.value = 45;
locomotion.config.turningSpeed.value = 180;
locomotion.config.comfortAssist.value = 0.5;
locomotion.config.rayGravity.value = -0.4;
locomotion.config.jumpHeight.value = 1.5;
locomotion.config.jumpCooldown.value = 0.1;
locomotion.config.maxDropDistance.value = 5.0;
locomotion.config.useWorker.value = true;
locomotion.config.enableJumping.value = true; // Enable/disable jumping entirely
locomotion.config.initialPlayerPosition.value = [0, 0, 0]; // Starting position
```

**EnvironmentType** (used with `LocomotionEnvironment` component):

```typescript
import { EnvironmentType } from '@iwsdk/core';

EnvironmentType.STATIC; // Fixed geometry (walls, floors) — default
EnvironmentType.KINEMATIC; // Moving platforms (elevators, conveyors)
```

### 17. Scene Understanding (AR)

```typescript
import { XRPlane, XRMesh, XRAnchor } from '@iwsdk/core';

// Enable in World.create
World.create(container, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    features: { planeDetection: true, meshDetection: true },
  },
  features: {
    sceneUnderstanding: true,
  },
});

// Query detected planes/meshes
export class MyARSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
  anchors: { required: [XRAnchor] },
}) {
  init() {
    this.queries.planes.subscribe('qualify', (entity) => {
      // New plane detected
      const plane = entity.object3D;
    });
  }
}
```

### 18. Feature Configuration (Critical!)

**Only enable features that your experience actually uses.** Features have prerequisites - enabling them without proper setup causes problems.

#### Feature Decision Matrix

| Feature              | Enable When                           | Prerequisites                              | If Missing                     |
| -------------------- | ------------------------------------- | ------------------------------------------ | ------------------------------ |
| `locomotion`         | Player needs to move (teleport/slide) | Collision geometry in scene (floor, walls) | **Player falls through world** |
| `physics`            | Objects need dynamic simulation       | PhysicsShape + PhysicsBody components      | Wasted overhead                |
| `grabbing`           | Objects are grabbable                 | Grabbable components on entities           | Wasted overhead                |
| `sceneUnderstanding` | AR with real-world surfaces           | AR session mode                            | Feature won't work             |
| `environmentRaycast` | AR object placement                   | AR session + hit-test support              | Feature won't work             |
| `spatialUI`          | Rendering UIKitML assets              | Manifest `AssetType.UIKitML` entries       | No UI renders                  |

#### Locomotion Requires Environment Setup

```typescript
// ❌ BAD - Locomotion enabled but no collision geometry
const world = await World.create(container, {
  features: {
    locomotion: true, // Player will fall through the floor!
  },
});

// ✅ GOOD - Locomotion with proper environment
const world = await World.create(container, {
  level: './scenes/vr.iwsdk.scene.json', // Scene has collision meshes
  features: {
    locomotion: true,
    physics: true, // Physics provides collision detection
  },
});

// ✅ GOOD - Static experience, no locomotion needed
const world = await World.create(container, {
  features: {
    locomotion: false, // Player stays at origin
    grabbing: true, // Can still interact with objects
  },
});
```

#### VR vs AR Feature Sets

```typescript
// VR Experience - typically needs locomotion
const vrWorld = await World.create(container, {
  xr: { sessionMode: SessionMode.ImmersiveVR },
  features: {
    locomotion: true, // Move around virtual space
    grabbing: true,
    physics: true,
  },
});

// AR Experience - player moves physically, no virtual locomotion
const arWorld = await World.create(container, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    features: { planeDetection: true, hitTest: true },
  },
  features: {
    locomotion: false, // Player walks in real world
    sceneUnderstanding: true, // Detect real surfaces
    environmentRaycast: true, // Place objects on surfaces
    grabbing: true,
  },
});
```

### 19. World Initialization Pattern

```typescript
import { World, SessionMode } from '@iwsdk/core';

const publicAssetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\/+/u, '')}`;

const world = await World.create(container, {
  render: {
    fov: 50,
    near: 0.1,
    far: 200,
    stencil: false, // Enable stencil buffer if needed
  },

  assets: {
    myModel: {
      url: publicAssetUrl('models/scene.glb'),
      type: AssetType.GLTF,
    },
  },

  level: './scenes/main.iwsdk.scene.json',

  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    referenceSpace: { type: 'local-floor' },
    // Structured feature flags — NOT raw string arrays. Each accepts a
    // boolean or { required: true }.
    features: { handTracking: true, planeDetection: true },
    offer: 'once', // 'none' | 'once' | 'always' (default: 'always')
  },

  // Enable feature systems - ONLY what you need!
  features: {
    locomotion: true, // Only if scene has collision geometry
    // OR object form:
    // locomotion: {
    //   useWorker: true,
    //   initialPlayerPosition: [0, 0, 0],
    //   comfortAssistLevel: 0.5, // option key; maps to the LocomotionSystem 'comfortAssist' config signal
    //   turningMethod: TurningMethod.SnapTurn,
    //   enableJumping: true,
    // },
    grabbing: true, // Only if objects are grabbable
    // OR object form: grabbing: { useHandPinchForGrab: false }, // pinch grabs by default
    physics: true, // Only if using dynamic physics
    sceneUnderstanding: true, // OR: { showWireFrame: true }
    environmentRaycast: true, // AR hit-test against real-world surfaces
    camera: true, // Camera video access (requires XR session)
    spatialUI: {
      forwardHtmlEvents: true,
      preferredColorScheme: 'dark',
    },
  },
});

// Register custom systems
world.registerSystem(MySystem);

// Launch/exit XR
world.launchXR();
world.exitXR();
```

Background and image-based lighting are authored explicitly with dome and IBL
components on the level root. IWSDK does not synthesize missing environment
components; the VR and Desktop 3D starter scene authors `DomeGradient` and
`IBLGradient`, and the AR starter authors only `IBLGradient` so no sky covers
passthrough.

### Post-Creation Initialization Sequence

After `World.create()`, follow this order for proper initialization:

```typescript
// 1. Create subsystems (physics engine, networking, etc.)
const simulator = await RaceSimulator.create({ useWorker: true });

// 2. Store shared state in world.globals
world.globals.raceSimulator = simulator;
(world.globals as Record<string, unknown>).carProxies = new Map();
(world.globals as Record<string, unknown>).gamePaused = signal(true);

// 3. Register components
world
  .registerComponent(VehiclePhysicsLink)
  .registerComponent(VehiclePhysicsState);

// 4. Setup scene (creates entities)
await setupScene(world, simulator, { aiCount: 5 });

// 5. Register systems with priorities
world
  .registerSystem(PlayerInputSystem, { priority: 0 })
  .registerSystem(PhysicsStepSystem, { priority: 10 });
```

### 20. Transform Entity Creation

```typescript
// Create entity with Object3D binding
const entity = world.createTransformEntity(mesh, {
  parent: parentEntity, // Optional parent
  persistent: false, // false = destroyed with level
});

// Transform component automatically syncs with Object3D (zero-copy)
entity.object3D.position.set(0, 1, 0);

// Component API for vector fields: getVectorView ONLY — in elics 3.4.x
// setValue/getValue THROW for Vec2/Vec3/Vec4/Color fields. setValue is
// fine for scalars, booleans, strings, and enums.
const posView = entity.getVectorView(Transform, 'position');
posView.set([0, 1, 0]); // write
posView[0] += delta; // direct array element write
```

### 21. Panel UI Pattern

```typescript
import { UIKit, UIKitMLAsset, VisibilityState } from '@iwsdk/core';

// "settings-panel" is the stable scene node id. Its content.asset points to
// an AssetType.UIKitML manifest entry.
const panel = world.requireSceneObject<UIKitMLAsset>('settings-panel');
const saveButton = panel.requireElementById<UIKit.Text>('save-button');
const xrButton = panel.requireElementById<UIKit.Text>('xr-button');

saveButton.addEventListener('click', () => {
  // Apply settings and play feedback here.
});

const unsubscribe = world.visibilityState.subscribe((state) => {
  const is2D = state === VisibilityState.NonImmersive;
  xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
});

// Retain unsubscribe and call it when the owning feature/system is destroyed.
```

The manifest ID identifies the reusable UIKitML definition; the scene node ID
identifies a placed instance; element IDs identify controls inside it. For code-owned
instances, retain the object returned by the asset manager:

```typescript
const panel = await world.assets.instantiate<UIKitMLAsset>('settings-panel');
const entity = world.createTransformEntity(panel);
panel.requireElementById('save-button').addEventListener('click', save);
```

Do not discover application panels through internal `PanelDocument` storage or
transient ECS indices.

### 22. Environment Raycasting (AR Hit-Test)

`EnvironmentRaycastTarget` makes an entity automatically follow XR hit-test results (raycast against real-world surfaces). The entity is positioned at the hit point and oriented to match the surface normal.

```typescript
import { EnvironmentRaycastTarget, RaycastSpace } from '@iwsdk/core';

// Reticle that follows right controller ray
const reticle = world.createTransformEntity(reticleMesh);
reticle.addComponent(EnvironmentRaycastTarget, {
  space: RaycastSpace.Right, // Ray source
  maxDistance: 100, // Max raycast distance in meters
});

// For phone AR: tap-to-place (uses screen touch)
const marker = world.createTransformEntity(markerMesh);
marker.addComponent(EnvironmentRaycastTarget, {
  space: RaycastSpace.Screen, // Tracks screen touch
});

// Read hit-test result (e.g., to spawn an object on trigger press)
const xrResult = entity.getValue(EnvironmentRaycastTarget, 'xrHitTestResult');
if (xrResult && gamepad?.getSelectStart()) {
  spawnObject(entity.object3D.position.clone());
}
```

**RaycastSpace:**

```typescript
RaycastSpace.Left; // Left controller's target ray
RaycastSpace.Right; // Right controller's target ray (default)
RaycastSpace.Viewer; // Head/gaze direction
RaycastSpace.Screen; // Phone AR screen touch (tap-to-place)
```

**Prerequisites:** `features: { environmentRaycast: true }` and `xr.features: { hitTest: true }` in AR session mode.

### 23. Follower Component

Makes an entity follow another Object3D with thresholded, smoothed motion. It
can keep compact global UI discoverable without rigidly head-locking it.

```typescript
import { Follower, FollowBehavior } from '@iwsdk/core';

entity.addComponent(Follower, {
  target: world.player.head, // Must be an Object3D
  offsetPosition: [0, -0.2, -0.8], // Offset in target's local space
  behavior: FollowBehavior.PivotY, // Rotation behavior
  maxAngle: 30, // Degrees before snapping forward
  tolerance: 0.4, // Meters of positional slack
  speed: 1, // Lerp speed
});
```

**FollowBehavior:**

```typescript
FollowBehavior.FaceTarget; // Fully face the target
FollowBehavior.PivotY; // Only rotate around Y axis (default)
FollowBehavior.NoRotation; // Follow position only, no rotation
```

**Note:** `target` must be an `Object3D` instance (e.g., `world.player.head`), not an entity.

### 24. CameraSource Component

Access device camera video as a texture. Useful for mixed reality effects or photo capture.

```typescript
import {
  CameraSource,
  CameraFacing,
  CameraState,
  CameraUtils,
} from '@iwsdk/core';

// Add camera to an entity
entity.addComponent(CameraSource, {
  // Input fields (user-configurable)
  deviceId: '', // Empty = auto-select based on facing
  facing: CameraFacing.Back, // Preferred camera direction
  width: 1920, // Requested resolution
  height: 1080,
  frameRate: 30,
});

// Read-only output fields (managed by CameraSystem):
// state: CameraState.Inactive | .Starting | .Active | .Error
// texture: VideoTexture (apply to materials)
// videoElement: HTMLVideoElement (advanced use)
```

**CameraFacing:**

```typescript
CameraFacing.Back; // Rear-facing camera
CameraFacing.Front; // Front-facing (selfie) camera
CameraFacing.Unknown; // Any available camera (default)
```

**CameraState:**

```typescript
CameraState.Inactive; // Not started
CameraState.Starting; // Async initialization in progress
CameraState.Active; // Stream running
CameraState.Error; // Failed to start; terminal until explicitly restarted
```

**CameraUtils** static class:

```typescript
// List available cameras (requests permission on first call)
const devices = await CameraUtils.getDevices();
const backCam = CameraUtils.findByFacing(devices, CameraFacing.Back);

// Retry after correcting a startup error or changing camera configuration
CameraUtils.restart(cameraEntity);

// Capture current frame as canvas (for snapshot/processing)
const canvas = CameraUtils.captureFrame(cameraEntity);
if (canvas) {
  const texture = new CanvasTexture(canvas);
}
```

**Requires:** `features: { camera: true }`, a secure context, camera permission, and a camera exposed through browser `MediaDevices`. Streams can run while the world is visible in browser-only or immersive XR mode. `CameraSource` does not expose Quest passthrough or raw headset-camera frames.

### 25. PhysicsManipulation Component

Applies forces or velocity changes to physics bodies. **One-shot component** — `PhysicsSystem` applies the values and auto-removes it each frame.

```typescript
import { PhysicsManipulation } from '@iwsdk/core';

// Apply an impulse force
entity.addComponent(PhysicsManipulation, {
  force: [0, 10, 0],            // Force vector (one-shot impulse)
  linearVelocity: [0, 0, 0],    // Set linear velocity directly
  angularVelocity: [0, 0, 0],   // Set angular velocity directly
});
// PhysicsSystem applies these values and auto-removes PhysicsManipulation

// For sustained forces, re-add the component each frame:
update() {
  if (!entity.hasComponent(PhysicsManipulation)) {
    entity.addComponent(PhysicsManipulation, { force: [0, 5, 0] });
  }
}
```

### 26. ScreenSpace Usage Notes

`ScreenSpace` positions the UIKit document under a manifest-backed UIKitML entity
relative to the screen in non-XR (browser) mode. It is intentional application
behavior, not a temporary preview technique; use the editor's isolated preview for
development.

**All position/size values are CSS strings**, not numbers:

```typescript
import { ScreenSpace } from '@iwsdk/core';

entity.addComponent(ScreenSpace, {
  width: '400px', // Explicit CSS size: '400px', '50vw', calc(...)
  height: '300px', // Explicit CSS size: '300px', '40vh', calc(...)
  top: '20px', // CSS position or 'auto'
  left: '20px', // CSS position or 'auto'
  bottom: 'auto',
  right: 'auto',
  zOffset: 0.2, // Distance in meters from camera near plane (NOT CSS)
});
```

**How it works:** The system creates hidden DOM elements and uses `getComputedStyle()` to convert CSS values → pixels → meters. Use explicit dimensions (`calc()`, `vw`, `vh`, `%`, etc.); unconstrained `auto` dimensions fall back to a small viewport-relative size and warn.

**XR behavior:** When entering XR, `ScreenSpaceUISystem` automatically moves the panel back to world space. When exiting XR, it re-positions to screen space.

### 27. Entity API

```typescript
// Destroy entity only (components removed, Object3D detached)
entity.destroy();

// Destroy entity AND dispose GPU resources (geometry, materials, textures)
// Use for entities with meshes/materials that need proper GPU cleanup
entity.dispose();

// Get all component classes attached to this entity
entity.getComponents();
```

**`dispose()` vs `destroy()`:** Use `dispose()` when the entity has meshes, materials, or textures that should be freed from GPU memory. Use `destroy()` when GPU resources are shared or managed elsewhere. Use `dispose()` with caution when resources may be shared across multiple entities.

### 28. Utility Functions

```typescript
import { setWorldPosition, setWorldQuaternion } from '@iwsdk/core';

// Set world-space position (correctly handles parent transform chain)
setWorldPosition(object3D, worldPosition);

// Set world-space quaternion (correctly handles parent transforms including non-uniform scale)
setWorldQuaternion(object3D, worldQuaternion);
```

These are useful when you need to position an object in world space but it's nested under transformed parents. They compute the correct local transform to achieve the desired world transform.

```typescript
// Level root helpers on World:
world.getActiveRoot(); // Returns active level's Object3D (or scene)
world.getPersistentRoot(); // Returns the scene Object3D
```

## Core Components Reference (30 Total)

| Component                | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| Transform                | Position, rotation, scale                       |
| Visibility               | Show/hide objects                               |
| LevelTag                 | Marks level membership                          |
| LevelRoot                | Level root marker                               |
| RayInteractable          | Marks objects for ray and pointer interaction   |
| Hovered                  | Currently hovered                               |
| Pressed                  | Currently pressed/grabbed                       |
| OneHandGrabbable         | Single-hand manipulation                        |
| TwoHandsGrabbable        | Two-hand manipulation                           |
| DistanceGrabbable        | Grab from distance                              |
| Handle                   | Manipulation handle                             |
| PhysicsBody              | Physics motion properties                       |
| PhysicsShape             | Collision shape + material                      |
| PhysicsManipulation      | Force/velocity application                      |
| DomeGradient             | Gradient sky                                    |
| DomeTexture              | Textured sky                                    |
| IBLGradient              | Gradient IBL lighting                           |
| IBLTexture               | Texture IBL lighting                            |
| PanelUI                  | Legacy component-backed UI loader compatibility |
| PanelDocument            | Internal loaded UI document state               |
| ScreenSpace              | Screen-attached UI                              |
| Follower                 | Object following                                |
| XRPlane                  | Detected AR planes                              |
| XRMesh                   | Detected AR meshes                              |
| XRAnchor                 | Spatial anchors                                 |
| AudioSource              | Audio configuration                             |
| CameraSource             | Camera device                                   |
| DepthOccludable          | Depth-based occlusion for AR                    |
| LocomotionEnvironment    | Locomotion settings                             |
| EnvironmentRaycastTarget | AR environment hit-test target                  |

## Core Systems Reference (20 Total)

| System                   | Priority | Purpose                                                                                             |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------- |
| LocomotionSystem         | -5       | Movement (teleport/slide/turn)                                                                      |
| InputSystem              | -4       | Pointer interaction state management                                                                |
| GrabSystem               | -3       | Grab handling                                                                                       |
| PhysicsSystem            | -2       | Physics simulation                                                                                  |
| SceneUnderstandingSystem | -1       | AR plane/mesh detection                                                                             |
| EnvironmentRaycastSystem | -1       | AR environment raycasting                                                                           |
| PanelUISystem            | -3.8     | UI panels                                                                                           |
| ScreenSpaceUISystem      | -3.75    | Screen UI                                                                                           |
| CanvasPointerSystem      | -3.5     | DOM pointer → scene forwarding (registered when input.canvasPointerEvents is enabled — the default) |
| CameraSystem             | default  | Camera access                                                                                       |
| LevelSystem              | default  | Level loading                                                                                       |
| EnvironmentSystem        | default  | Lighting/sky                                                                                        |
| AudioSystem              | default  | Spatial audio                                                                                       |
| TransformSystem          | default  | Transform sync                                                                                      |
| VisibilitySystem         | default  | Visibility sync                                                                                     |
| FollowSystem             | default  | Object following                                                                                    |
| TurnSystem               | default  | Rotation                                                                                            |
| TeleportSystem           | default  | Teleportation                                                                                       |
| SlideSystem              | default  | Smooth movement                                                                                     |
| DepthSensingSystem       | default  | Depth occlusion for AR                                                                              |

### Custom System Priority Guidelines

Register custom systems with priorities following input→simulation→rendering pipeline:

```
Priority 0-9:    Input capture (player input, AI decisions)
Priority 10-19:  Simulation (physics step, game logic)
Priority 20-29:  Visual sync (sync Three.js objects to physics)
Priority 30+:    Low-priority updates (UI, HUD, ambient effects)
```

Example:

```typescript
world
  .registerSystem(PlayerInputSystem, { priority: 0 })
  .registerSystem(AIDriverSystem, { priority: 1 })
  .registerSystem(PhysicsStepSystem, { priority: 10 })
  .registerSystem(VehicleSyncSystem, { priority: 20 })
  .registerSystem(DashboardSystem, { priority: 35 });
```

## Project Structure

```
my-iwsdk-project/
├── iwsdk.config.json       # Declarative project/world authority
├── src/
│   ├── index.ts              # World.create() plus system registration
│   ├── assets.ts             # defineAssets() project catalog
│   ├── components.ts         # defineComponents() declarations
│   ├── systems/
│   │   ├── ui-system.ts      # Panel/UI management
│   │   └── game-system.ts    # Game logic
│   └── components/
│       └── custom.ts         # Custom component definitions
├── public/
│   ├── scenes/               # Native IWSDK scene JSON files
│   ├── audio/                # Audio files
│   └── ui/                   # Runtime-loaded .uikitml files and fonts
├── vite.config.ts
└── package.json
```

## What IWSDK Provides (Don't Rebuild These)

Before writing custom code, check if IWSDK already provides the functionality. Rebuilding built-in features wastes time and produces inferior results (missing BVH acceleration, XR compatibility, comfort features, etc.).

### Reinvention Risk Table

| What you might build from scratch                                  | What IWSDK already provides                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| GLTF loading with GLTFLoader                                       | `AssetManager.loadGLTF()` or a `defineAssets()` project catalog              |
| Ray/line mesh for controller pointing                              | `RayPointer` — cylinder + gradient shader + cursor circle (auto)             |
| Hover/click interaction with Raycaster                             | `RayInteractable` + `Hovered` + `Pressed` components                         |
| Custom skybox sphere                                               | `DomeGradient` or `DomeTexture` component                                    |
| Floor fading into the sky (`onBeforeCompile` with copied sky GLSL) | `DomeFade` on the floor node                                                 |
| PBR environment lighting                                           | `IBLGradient` or `IBLTexture` component                                      |
| Canvas or radial blob shadow card                                  | `ContactShadow` node component                                               |
| ShadowMaterial plane for AR                                        | `ShadowCatcher` node component                                               |
| Teleport arc + landing marker                                      | `LocomotionSystem` — full visuals included                                   |
| Comfort vignette for motion                                        | `LocomotionSystem` — `comfortAssist` config                                  |
| Controller 3D models                                               | Auto-loaded from WebXR Input Profiles                                        |
| Hand tracking meshes                                               | `AnimatedHand` with skeletal mesh + outline                                  |
| Object grab + manipulation                                         | `OneHandGrabbable` / `TwoHandsGrabbable` / `DistanceGrabbable`               |
| Hit-test against real world                                        | `EnvironmentRaycastTarget` component                                         |
| Spatial audio                                                      | `AudioSource` component with pooling                                         |
| Camera feed texture                                                | `CameraSource` component                                                     |
| Depth occlusion shader                                             | `DepthOccludable` component                                                  |
| HUD / screen-space UI                                              | `ScreenSpace` component with CSS units                                       |
| Follow-head billboard                                              | `Follower` component                                                         |
| Scene cleanup on level change                                      | `LevelSystem` + `LevelTag` (automatic)                                       |
| Gamepad button debouncing                                          | `StatefulGamepad` — `getButtonDown()` / `getButtonUp()`                      |
| Manual GPU cleanup with traverse                                   | `entity.dispose()` — destroys entity + cleans up geometry/materials/textures |
| Manual world-space positioning                                     | `setWorldPosition()` / `setWorldQuaternion()` utilities                      |
| Manual XR hit-test setup                                           | `EnvironmentRaycastTarget` component + `EnvironmentRaycastSystem`            |
| Manual camera video feed                                           | `CameraSource` component + `CameraUtils` static class                        |

### Asset Loading (AssetManager)

**Always use AssetManager** — never use raw `GLTFLoader`, `TextureLoader`, etc. AssetManager handles DRACO/KTX2 decoder setup, caching, and de-duplication automatically.

**Manifest pattern (preload at startup):**

```typescript
const publicAssetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\/+/u, '')}`;

const world = await World.create(container, {
  assets: {
    myModel: {
      url: publicAssetUrl('models/scene.glb'),
      type: AssetType.GLTF,
      priority: 'critical',
    },
    mySound: {
      url: publicAssetUrl('audio/click.mp3'),
      type: AssetType.Audio,
      priority: 'background',
    },
    myTexture: {
      url: publicAssetUrl('textures/wood.jpg'),
      type: AssetType.Texture,
    },
    myHDR: {
      url: publicAssetUrl('textures/env.hdr'),
      type: AssetType.HDRTexture,
    },
  },
});

// Retrieve preloaded assets (synchronous — already loaded)
const gltf = AssetManager.getGLTF('myModel');
// `getGLTF` returns a fresh clone of `scene`/`scenes` per call, so the
// same key safely backs multiple entities. Pass `{ shared: true }` to
// get the cached instance.
const texture = AssetManager.getTexture('myTexture');
const audio = AssetManager.getAudio('mySound');
```

**Runtime loading (on-demand):**

```typescript
// Load at runtime when not known at startup
const gltf = await AssetManager.loadGLTF(
  './models/dynamic.glb',
  'dynamicModel',
);
const texture = await AssetManager.loadTexture(
  './textures/new.jpg',
  'newTexture',
);
```

**Supported AssetTypes:** `GLTF`, `Audio`, `Texture`, `HDRTexture`

### Entity Parenting & Level Lifecycle

**Always use `createTransformEntity`** — never `scene.add()`. Entities created with `createTransformEntity` get a `Transform` component, participate in ECS queries, and are automatically managed by the level system.

```typescript
// Basic entity with parent
const entity = world.createTransformEntity(mesh, parentEntity);

// With options object
const entity = world.createTransformEntity(mesh, {
  parent: parentEntity,
  persistent: false, // false (default) = destroyed when level changes
});

// Persistent entity — survives level changes
const hud = world.createTransformEntity(hudMesh, {
  parent: world.sceneEntity,
  persistent: true,
});
```

**Level lifecycle:**

- Entities with `LevelTag` are automatically destroyed when `world.loadLevel()` is called
- Non-persistent entities created via `createTransformEntity` automatically get `LevelTag`
- Use `persistent: true` for entities that should survive level transitions (HUDs, audio managers, etc.)
- `world.loadLevel(url)` destroys all level-tagged entities, then loads the new native scene document

**Warning:** Parenting an Object3D under another Object3D that is NOT an entity's `object3D` will silently reparent it to the scene root and log a warning.

### Input & Interaction

**RayInteractable → Hovered/Pressed flow:**

1. Add `RayInteractable` component to any entity that should respond to pointer input
2. `InputSystem` automatically performs BVH-accelerated raycasting each frame
3. When a ray hits a RayInteractable entity, `Hovered` tag is added
4. When the user presses the select button while hovering, `Pressed` tag is added
5. Query for `Hovered`/`Pressed` in your system to react to interactions

```typescript
// Setup
entity.addComponent(RayInteractable);

// In your system — react to interactions
export class MyInteractionSystem extends createSystem({
  hovered: { required: [MyComponent, Hovered] },
  pressed: { required: [MyComponent, Pressed] },
}) {
  init() {
    this.queries.pressed.subscribe('qualify', (entity) => {
      // Entity was just clicked/selected
    });
  }
}
```

**StatefulGamepad API** (accessed via `this.input.xr.gamepads.left` / `.right`):

- `getButtonDown(InputComponent.Trigger)` — true on the frame the button was pressed
- `getButtonUp(InputComponent.Trigger)` — true on the frame the button was released
- `getButtonPressed(InputComponent.Trigger)` — true while held
- `getButtonValue(InputComponent.Trigger)` — analog 0-1
- `getAxesValues(InputComponent.Thumbstick)` — `{ x, y }` in -1 to 1 range
- `getAxesEnteringUp/Down/Left/Right(InputComponent.Thumbstick)` — directional flick detection

### Built-in Visuals (Don't Recreate)

These visuals are automatically created and managed by IWSDK systems:

- **RayPointer** — Cylinder mesh with gradient shader + circular cursor at hit point. Created automatically by `InputSystem` for each connected controller.
- **AnimatedController** — GLTF controller models auto-loaded from the WebXR Input Profiles registry. Matches the user's actual hardware.
- **AnimatedHand** — Skeletal hand mesh with outline shader for hand tracking mode. Auto-managed by the input system.
- **Teleport visuals** — Parabolic arc + landing circle indicator. Rendered by `LocomotionSystem` when teleport mode is active.
- **Comfort vignette** — Screen-edge darkening during smooth locomotion. Controlled by `locomotion.config.comfortAssist` (0 = off, 1 = maximum).
- **DomeGradient / DomeTexture** — Sky dome rendering. Add the component to an entity; `EnvironmentSystem` handles the rest.

## Anti-Patterns to Avoid

1. **DON'T** store entity arrays in systems - use queries
2. **DON'T** poll for state changes - use signal subscriptions
3. **DON'T** manually track component additions/removals - use query subscribe
4. **DON'T** create entities in update() without proper lifecycle management
5. **DON'T** use `Types.Object` for data that could be typed (use Vec3, Float32, etc.)
6. **DON'T** forget cleanup functions for subscriptions and resources
7. **DON'T** mutate live query Sets while iterating: if your loop body removes AND re-adds required components, the re-qualified entity is revisited by the same iteration — an infinite loop. Iterate `Array.from(query.entities)` instead
8. **DON'T** enable locomotion without collision geometry - player falls through world
9. **DON'T** enable features you don't use - adds overhead and can cause bugs
10. **DON'T** confuse PhysicsBody (motion) with PhysicsShape (collision + material)
11. **DON'T** use raw `GLTFLoader`/`TextureLoader` — use `AssetManager` for caching, DRACO/KTX2 setup
12. **DON'T** use `scene.add()` — use `createTransformEntity()` for proper ECS integration
13. **DON'T** replace IWSDK pointer interaction with `new Raycaster()` — use `RayInteractable`; raw raycasters are valid for custom geometric queries, but the caller owns ECS entity mapping, target filtering, and pointer lifecycle
14. **DON'T** add environment components (`DomeGradient`/`IBLTexture`/etc.) to arbitrary entities — must go on the level root (`world.activeLevel.value`)
15. **DON'T** forget `_needsUpdate` after changing `DomeTexture` or `IBLTexture` properties — their changes are silently ignored without `entity.setValue(DomeTexture, '_needsUpdate', true)`. `DomeGradient` and `IBLGradient` apply edits without it
16. **DON'T** use `entity.destroy()` for objects with GPU resources — use `entity.dispose()` which also cleans up geometry/materials/textures
17. **DON'T** pass numbers to `ScreenSpace` — all position/size values are CSS strings like `'400px'` or `'50vw'`

## Performance Tips

1. Use `getVectorView()` for direct TypedArray access (zero-copy)
2. Batch query enumeration (don't create intermediate arrays)
3. Use tag components for cheap boolean queries
4. Leverage query filters (`where`) to reduce iteration scope
5. System config signals auto-deduplicate (no callback if value unchanged)
6. Physics and locomotion can run in Web Workers for heavy scenes
7. Use `PhysicsShapeType.Auto` to let IWSDK pick optimal collision shape

## When Planning a New Feature

1. **Determine feature flags** - What built-in features does this need? (locomotion, physics, grabbing, etc.)
2. **Check prerequisites** - If using locomotion, is collision geometry set up?
3. **Identify components needed** - What data does this feature require?
4. **Design queries** - How will systems find relevant entities?
5. **Plan reactivity** - What changes should trigger updates?
6. **Consider lifecycle** - When are entities created/destroyed?
7. **Map to existing systems** - Can built-in systems (grab, physics, etc.) help?
8. **VR vs AR** - Does this work differently in each mode?
9. **Input handling** - What controller/hand inputs are needed?
10. **Audio feedback** - What sounds should play on interactions?
11. **Select 3D assets** - What models are needed, and what are their licensing, provenance, and performance constraints?
