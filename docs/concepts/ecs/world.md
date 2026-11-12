---
title: World
---

# World

World owns the ECS runtime, Three.js scene + renderer, input, player rig, and is the gateway to XR. IWSDK extends the base elics World with WebXR‑specific facilities.

## World as Coordinator (Mental Model)

The World is the bridge between:

- ECS data (entities/components)
- 3D rendering (Three.js scene/camera/renderer)
- XR interaction (WebXR session via WebGLRenderer.xr)
- Content pipeline (asset manager, native scene JSON)

```text
Components ←→ Systems ←→ World ←→ Three.js/XR
                       └→ Assets/Levels
```

## Creating a World

```ts
import { World, SessionMode } from '@iwsdk/core';

const container = document.getElementById('scene') as HTMLDivElement;
const world = await World.create(container, {
  xr: { sessionMode: SessionMode.ImmersiveVR },
  features: { enableLocomotion: true, enableGrabbing: true },
  level: '/scenes/main.iwsdk.scene.json',
});
```

## Scene and Level Roots

- `getActiveRoot()` returns the current level root or scene root if no level.
- `getPersistentRoot()` always returns the global scene root.

Use these roots when you attach Three.js nodes outside ECS.

## Creating Entities

```ts
const e = world.createEntity(); // bare entity (no object3D, no Transform)
const t = world.createTransformEntity(); // entity + object3D + Transform
```

`createTransformEntity(object?, parentOrOptions?)` accepts:

- an existing `Object3D`
- `{ parent?: Entity; persistent?: boolean }` to choose the scene vs level parent

## Systems and Components

```ts
world.registerComponent(MyComponent);
world.registerSystem(MySystem);
```

IWSDK registers core systems for you (Input, Audio, UI). Optional features like Locomotion/Grabbing are enabled via `World.create(..., { features })`.

## XR Helpers

- `launchXR(overrides?)` – explicitly request a session using defaults set at creation; pass partial overrides per-launch.
- `exitXR()` – end the active session.
- `visibilityState: Signal<'non-immersive'|'hidden'|'visible'|'visible-blurred'>`

Offering sessions (navigator.xr.offerSession) is managed by `World.create` via the `xr.offer` option:

```ts
World.create(container, {
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    // 'none' | 'once' | 'always'
    offer: 'once',
  },
});
```

IWSDK vs elics: IWSDK adds XR helpers, scene ownership, and level wiring on top of elics’ ECS core.

## Update ordering and render loop

Each frame:

```text
update visibilityState → world.update(delta,time) → renderer.render(scene,camera)
```

Within `world.update`, systems run by ascending priority. Use negative priorities for input/physics that must precede visual updates.

## Render modes

`world.renderMode` decides whether each tick draws:

- `'continuous'` (the default): every tick draws. Apps you ship use this.
- `'on-demand'`: systems still run every tick, but a tick draws only when
  something asks for a frame. Object world matrices, skinned-mesh bones and the
  XR camera pose still update every tick, so raycasts, grabbing, physics and UI
  behave the same. Headless development sessions use this mode so a machine
  without a GPU does not software-rasterize every frame.

```ts
// Draw the next frame (or the next n frames) even in on-demand mode.
await world.requestRender();

// Draw every frame until released; holds are counted.
const release = world.holdRender();
// ... capture video, read pixels over several frames ...
release();
```

`requestRender()` resolves on the tick after the frame is drawn, once the
browser has presented it. That suits page-level captures such as a browser
screenshot, but by then the WebGL drawing buffer may already be cleared. Code
that reads pixels back from the canvas itself (for example `toDataURL()` or
`readPixels`) should draw and read in the same task, by calling
`renderer.render()` and reading right after it, or create the renderer with
`preserveDrawingBuffer: true`.

Headless development sessions start in on-demand mode (opt out with
`IWSDK_DEV_RENDER_MODE=continuous`). The runtime-only `RuntimeSettings`
component switches the mode live; see
[AI modes](/ai/modes#rendering-in-headless-sessions).

## Levels

```ts
await world.loadLevel('/scenes/cave.iwsdk.scene.json');
await world.loadSceneDocument(sceneDocument);
```

The LevelSystem listens for URL or in-memory scene document requests and handles
the load; when complete the world’s `activeLevel` signal updates.
