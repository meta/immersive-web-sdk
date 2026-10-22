---
paths:
  - "src/**/*.ts"
  - "src/**/*.js"
---

# ECS API reference

## Field types

```
Types.Float32 Float64 Int8 Int16 Int32 Boolean String FilePath
Types.Vec2 Vec3 Vec4 Color(RGBA) Entity Enum
Types.Object   // avoid — not optimised
```

## Component

Declare in a system-free module, then list it in `src/components.ts` via
`defineComponents()` or the editor cannot author it.

```ts
export const MyComponent = createComponent('MyComponent', {
  speed: { type: Types.Float32, default: 1 },
  tint: { type: Types.Color, default: [1, 1, 1, 1] }, // RGBA
});
```

Optional metadata per field — `label`, `step`, `min`, `max`, `enum`, `help`,
`widget` — drives the editor inspector.

## System

```ts
export class MySystem extends createSystem(
  {
    items: { required: [MyComponent] },
    active: { required: [MyComponent], excluded: [Grabbed] },
  },
  { speed: { type: Types.Float32, default: 1 } }, // optional config
) {
  private temp!: Vector3;

  init() {
    this.temp = new Vector3();
    this.queries.items.subscribe('qualify', (entity) => { /* matched */ });
    this.cleanupFuncs.push(this.config.speed.subscribe((v) => { /* … */ }));
  }

  update(delta: number, time: number) {
    for (const entity of this.queries.active.entities) { /* no allocations */ }
  }
}
```

Queries take `required`, `excluded` and `where` (value predicates via `eq`, `ne`,
`lt`, `le`, `gt`, `ge`, `isin`, `nin`). `excluded` is the clean way to skip
entities in a transient state — e.g. excluding `Grabbed` so a held object is left
alone.

Register explicitly in `src/index.ts` with `world.registerSystem(MySystem)`.

Read fields with `entity.getValue(Component, 'field')`. For vector fields use
`entity.getVectorView(Component, 'field')` — it returns a `Float32Array` view with
no allocation, and `setValue` **throws** on vector fields in elics 3.4.x.

## Interaction components

`RayInteractable` plus `Hovered`/`Pressed` covers both mouse/touch canvas input
and XR rays. Grab components: `OneHandGrabbable` and `TwoHandsGrabbable` are
proximity-based and respond to **squeeze**, while `DistanceGrabbable` is
ray-based and responds to **trigger**. `Grabbed` is a transient tag managed by
`GrabSystem` — read it, never add or remove it. `GrabSystem.useHandPinchForGrab`
defaults to **true**, so a hand pinch grabs; set it to `false` to require squeeze.

`DistanceGrabbable` fields: `movementMode` (`MoveTowardsTarget`, `MoveFromTarget`,
`MoveAtSource`, `RotateAtSource`), `returnToOrigin`, `moveSpeedFactor`,
`detachOnGrab`, `translate`, `rotate`, `scale`, `targetPositionOffset`,
`targetQuaternionOffset`. `returnToOrigin: true` gives spring-back on release with
no custom code.

For a held object use `GrabSystem`'s public methods — `forceRelease(entity)`,
`getHolderHand(entity)` — never deep-import `Handle`.

## XR input

```ts
const pad = this.input.xr.gamepads.right;
pad?.getButtonDown(InputComponent.Trigger);   // just pressed
pad?.getAxesValues(InputComponent.Thumbstick);
this.player.head; this.player.raySpaces.left; this.player.gripSpaces.right;
```

Prefer `world.input.actions` for reusable intent (`locomotion.move`) over raw
buttons. Browser controls live at `world.input.keyboard` and
`world.input.browserGamepads`.

## Lifecycle

`world.visibilityState` reports `NonImmersive`, `Visible`, `VisibleBlurred` —
pause simulation on blur. `world.camera.position` is local to `world.player`; use
`getWorldPosition()` when logic needs the true viewer position.
