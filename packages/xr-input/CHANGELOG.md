# @iwsdk/xr-input

## 1.1.0

### Minor Changes

- 08250e6: `GrabSystem`'s `useHandPinchForGrab` option now takes effect. Hand pinch grabs `OneHandGrabbable` and `TwoHandsGrabbable` objects by default, as it already did on Quest and in IWER while the option was ignored, and `grabbing: { useHandPinchForGrab: false }` now turns it off. Pinch-to-grab also works on hand input sources that expose no Gamepad. The new `XRInputManager.getSelectState(handedness)` returns this frame's select edges for either kind of source. The generated agent guidance now describes the actual default.
- fcf7825: Move to Three.js r185 (`super-three@0.185.0`, `@types/three` 0.185). Apps pin the same version: update `three` and its override to `npm:super-three@0.185.0` (new projects from `@iwsdk/create` get it). The r185 changes are handled so apps see no warnings or visual changes: scene `shadowMapType: 'pcf-soft'` uses `PCFShadowMap` (soft since r182, which deprecated `PCFSoftShadowMap`), the render loop uses `Timer` instead of the deprecated `Clock`, the `room` IBL keeps its lighting, controller and hand visuals compile with r183+'s vec4 vertex colors (and still with older Three.js for `@iwsdk/xr-input`), and production builds no longer bundle the unused Draco and Basis decoders that r185's loaders reference.

### Patch Changes

- 08250e6: Controller visuals no longer throw on every frame, which froze rendering, when a controller reports fewer buttons or axes than its input profile maps (for example Samsung Galaxy XR, whose profile maps thumbrest and menu to buttons the device doesn't report). Parts the gamepad doesn't report stay at rest.
- a57296b: Stop two misleading `[iwsdk][gaze]` diagnostics. Emulated gaze (the desktop emulator or `--native-xr-control`) no longer reports "real gaze data is flowing" or warns after 3 s that the runtime maps gaze onto the head pose; it says the gaze is synthetic and has not been aimed yet. Disconnecting a gaze source mid-session no longer also logs that no gaze source appeared within 3 s of session start.
- 0251c03: Add `ContactShadow` and `ShadowCatcher`, node components that ground content without hand-built shadow meshes. `ContactShadow` draws a soft round blob under its node (`size`, `opacity`, `color`, `height`); `ShadowCatcher` is an invisible floor that shows only the shadows it receives, for AR passthrough (`size`, `opacity`, `color`; it needs `environment.shadows` and a light with `castShadow`). The new `GroundShadowSystem` builds their meshes, which move and scale with the node, never cast shadows or take ray, grab or touch pointer hits, and stay visible in AR. Meshes marked runtime-only, as both are, are left out of auto-detected physics shapes, locomotion collision, gaze target bounds and `entity.dispose()`. The editor viewport renders both, and its selection and framing bounds, geometry lens and preview ghosting leave them out, as do the framing bounds and asset mesh counts in `scene_get_render_stats`, the emulator's hand targets and the grab setup warning. Render stats count them in `sceneEnvironment.groundShadows`, and scene validation rejects a `size` that is not positive. Scenes that use the components need @iwsdk/core 1.1.0. The generated agent guidance points to them instead of canvas blob cards and `ShadowMaterial` planes.
- a0ad31c: Input sources without a pose no longer cost a frame. A hand whose wrist joint has no pose this frame, or a controller without a target ray pose, now keeps its ray, grab and touch pointers disconnected (no raycasts against the scene or UI) and its hand or controller model hidden and not updated, until tracking returns. A hand counts as untracked by its wrist even when the runtime still reports a target ray for it, as Horizon OS does for hands it does not see when no controllers are connected; such hands used to cost about 9 ms of JavaScript per frame in a UI-heavy scene. Pointer state behaves as when the source disconnects: a hover or grab in progress ends when tracking is lost.

## 1.1.0-rc.2

### Minor Changes

- 08250e6: `GrabSystem`'s `useHandPinchForGrab` option now takes effect. Hand pinch grabs `OneHandGrabbable` and `TwoHandsGrabbable` objects by default, as it already did on Quest and in IWER while the option was ignored, and `grabbing: { useHandPinchForGrab: false }` now turns it off. Pinch-to-grab also works on hand input sources that expose no Gamepad. The new `XRInputManager.getSelectState(handedness)` returns this frame's select edges for either kind of source. The generated agent guidance now describes the actual default.

### Patch Changes

- 08250e6: Controller visuals no longer throw on every frame, which froze rendering, when a controller reports fewer buttons or axes than its input profile maps (for example Samsung Galaxy XR, whose profile maps thumbrest and menu to buttons the device doesn't report). Parts the gamepad doesn't report stay at rest.
- a57296b: Stop two misleading `[iwsdk][gaze]` diagnostics. Emulated gaze (the desktop emulator or `--native-xr-control`) no longer reports "real gaze data is flowing" or warns after 3 s that the runtime maps gaze onto the head pose; it says the gaze is synthetic and has not been aimed yet. Disconnecting a gaze source mid-session no longer also logs that no gaze source appeared within 3 s of session start.
- 0251c03: Add `ContactShadow` and `ShadowCatcher`, node components that ground content without hand-built shadow meshes. `ContactShadow` draws a soft round blob under its node (`size`, `opacity`, `color`, `height`); `ShadowCatcher` is an invisible floor that shows only the shadows it receives, for AR passthrough (`size`, `opacity`, `color`; it needs `environment.shadows` and a light with `castShadow`). The new `GroundShadowSystem` builds their meshes, which move and scale with the node, never cast shadows or take ray, grab or touch pointer hits, and stay visible in AR. Meshes marked runtime-only, as both are, are left out of auto-detected physics shapes, locomotion collision, gaze target bounds and `entity.dispose()`. The editor viewport renders both, and its selection and framing bounds, geometry lens and preview ghosting leave them out, as do the framing bounds and asset mesh counts in `scene_get_render_stats`, the emulator's hand targets and the grab setup warning. Render stats count them in `sceneEnvironment.groundShadows`, and scene validation rejects a `size` that is not positive. Scenes that use the components need @iwsdk/core 1.1.0. The generated agent guidance points to them instead of canvas blob cards and `ShadowMaterial` planes.
- a0ad31c: Input sources without a pose no longer cost a frame. A hand whose wrist joint has no pose this frame, or a controller without a target ray pose, now keeps its ray, grab and touch pointers disconnected (no raycasts against the scene or UI) and its hand or controller model hidden and not updated, until tracking returns. A hand counts as untracked by its wrist even when the runtime still reports a target ray for it, as Horizon OS does for hands it does not see when no controllers are connected; such hands used to cost about 9 ms of JavaScript per frame in a UI-heavy scene. Pointer state behaves as when the source disconnects: a hover or grab in progress ends when tracking is lost.

## 1.1.0-rc.1

## 1.1.0-rc.0

### Minor Changes

- 0f10007: Move to Three.js r185 (`super-three@0.185.0`, `@types/three` 0.185). Apps pin the same version: update `three` and its override to `npm:super-three@0.185.0` (new projects from `@iwsdk/create` get it). The r185 changes are handled so apps see no warnings or visual changes: scene `shadowMapType: 'pcf-soft'` uses `PCFShadowMap` (soft since r182, which deprecated `PCFSoftShadowMap`), the render loop uses `Timer` instead of the deprecated `Clock`, the `room` IBL keeps its lighting, controller and hand visuals compile with r183+'s vec4 vertex colors (and still with older Three.js for `@iwsdk/xr-input`), and production builds no longer bundle the unused Draco and Basis decoders that r185's loaders reference.

## 1.0.1

## 1.0.0

### Major Changes

- a79f1ff: Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Minor Changes

- 15688e2: Add configurable gaze input, gaze-driven pointer selection, native-session
  `gaze-tracking` and `eye-tracking` feature requests, a `metaVRGlasses` desktop
  emulator device with gaze input, and a development-only Meta VR Glasses gaze
  preview for physical Quest headsets.

### Patch Changes

- 3306963: Keep ray cursors above and aligned with hit surfaces after the XR origin rotates.
- ce9cdad: Embed TypeScript sources in the published source maps for the runtime packages,
  and pre-bundle the elics dependency of `@iwsdk/core` in development. The Vite
  development server no longer warns that source maps point to missing source
  files, and browser devtools can show SDK source when stepping into it.
- 3306963: Ignore invisible objects and descendants of invisible objects during pointer hit testing.

## 1.0.0-rc.2

### Minor Changes

- d3640c2: Add configurable gaze input, gaze-driven pointer selection, native-session
  `gaze-tracking` and `eye-tracking` feature requests, a `metaVRGlasses` desktop
  emulator device with gaze input, and a development-only Meta VR Glasses gaze
  preview for physical Quest headsets.

## 1.0.0-rc.1

### Patch Changes

- 5384bc0: Embed TypeScript sources in the published source maps for the runtime packages,
  and pre-bundle the elics dependency of `@iwsdk/core` in development. The Vite
  development server no longer warns that source maps point to missing source
  files, and browser devtools can show SDK source when stepping into it.

## 1.0.0-rc.0

### Major Changes

- Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Patch Changes

- 3306963: Keep ray cursors above and aligned with hit surfaces after the XR origin rotates.
- 3306963: Ignore invisible objects and descendants of invisible objects during pointer hit testing.

## 0.5.3

## 0.5.2

### Patch Changes

- 0b3ddc3: Improve managed editor and local launch reliability. Add an editor action to open
  the runtime in the default browser, serve generated-app test assets from the app
  origin, persist local HTTPS certificates, bootstrap fresh tarball builds, improve
  controller UI clicks, clarify XR player framing, and tolerate slower isolated
  render previews.

## 0.5.0

### Patch Changes

- 91047c5: Replace the Meta Spatial Editor integration path with the native IWSDK 3D scene
  editor and native scene JSON workflow.

  Meta Spatial Editor integration is deprecated from this release onward. New and
  migrated projects should use `public/scenes/*.iwsdk.scene.json`, the clean managed
  origin workspace, and direct file authoring with the compact `scene_*` observation
  tools. Code remains supported for procedural behavior, systems,
  animation, and advanced app logic.

  The replacement includes WebGL/IWSDK editor rendering, real scene asset loading,
  camera and orientation controls, transform gizmos, scene hierarchy editing,
  schema-driven component editing, agent screenshots from the editor viewport,
  migrated examples/starters, Meta Spatial removal audits, and automated app plus
  editor render-proof evidence. Authored transforms support zero scale and mirrored
  negative scale; world-preserving reparent operations retain reflections and report
  an operation-specific error only when a singular transform cannot be decomposed.

  The legacy `@iwsdk/glxf` package and fallback level importer are removed.
  `World.loadLevel()` now accepts native `.iwsdk.scene.json` and `.scene.json`
  documents only.

  Projects now declare their scene, asset/component modules, serializable world
  options, and emulator settings in `iwsdk.config.json`. Vite exposes those
  options through `virtual:iwsdk-project`; application code keeps ordinary
  `World.create()` and explicit system registration. Create embeds one common
  starter source instead of fetching Chef recipes, and the retired
  `@iwsdk/starter-assets` workspace package is removed.

  Native scene documents use one manifest-backed `asset` content kind plus groups,
  lights, prefabs, deterministic patterns, components, and constraints. glTF assets,
  procedural Three.js geometry, PBR materials, and custom shaders live in a dedicated
  application asset manifest imported independently by the runtime and editor. The
  editor exposes one unified asset catalog with manifest-derived bounds while keeping
  geometry and material authoring in code.

  The editor and runtime share lowering and expose scene metadata for parity checks.
  Generated Claude and Codex projects include the `iwsdk-scene-composer` skill for
  text, image, and hybrid static scene composition through direct files and the native
  editor. Scene roots can recursively import standalone modules with deterministic
  namespaces, and the managed editor watches root and module changes while preserving
  the last valid render on invalid edits.

  Release artifact verification now records package and documentation hashes and
  rejects package-manager-specific nested `node_modules`. Core and XR input use
  Three.js's public `MathUtils` export so packed modules remain portable.
  The reference-enabled starter and example paths pin patched Sharp 0.35.3 while
  upstream Transformers retains its older dependency range, and the reference
  package now ships complete warmup and offline-hosting guidance.

## 0.4.2

### Patch Changes

- Changelog-formatted bullets (one per user-facing change). Copy into your changeset
  summary / changeset `.md`. `@iwsdk/*` is a fixed group, so all packages bump to 0.4.2.
  - Fix cylinder physics collider configuration when calling the Havok API so cylinder colliders collide correctly.
  - Keep the Havok physics engine and its ~2 MB WASM out of bundles when `features.physics` is disabled; physics is now code-split so `physics: false` apps no longer download it on first load.
  - Break a value-level import cycle (`ecs/world` ↔ `init/world-initializer`) that could leave a component reference `undefined` at class-body evaluation and crash `QueryManager.registerQuery` with `Cannot read properties of undefined (reading 'bitmask')` in bundled apps.
  - Guard `PhysicsSystem` against an unregistered `Grabbed` component, avoiding unnecessary coupling with the grab system (and a crash) when physics is used without grab.
  - Skip XR input visual initialization when the controller/hand GLTF asset fails to load (e.g. offline or firewalled CDN); input is still tracked without a visual instead of throwing `TypeError: Cannot set properties of undefined (setting 'frustumCulled')`.
  - Spawn the dev runtime with `shell: true` on Windows so the `npm`/`pnpm`/`yarn` `.cmd` shims resolve — fixes `iwsdk dev up` failing with "Failed to start the dev process". Also fixes silent hzdb telemetry on Windows.

## 0.4.1

### Patch Changes

- Version-only release to keep the `@iwsdk/*` package set aligned for 0.4.1.

## 0.4.0

### Minor Changes

- Browser-first runtime, action-backed locomotion, ECS-native player rig,
  reference/RAG tooling, runtime-first MCP, quad/cylinder layers, and
  cloud-friendly headless browser.

  ### Browser-First Runtime

  First-class non-XR support: `World.create({ xr: false })` keeps a
  persistent `world.player` origin with `world.camera` parented under it,
  so the same scene runs in a desktop browser and on-device.
  - New `world.input` facade with `input.xr`, stateful keyboard,
    browser gamepad, and deprecated XR compatibility aliases.
  - `input.canvasPointerEvents` config + `CanvasPointerSystem` lifts
    canvas DOM pointer forwarding out of spatial UI into a first-class
    input source.
  - `CameraSystem` now runs while the world is visible (browser
    non-immersive included), only stopping on hidden page/session.
  - `examples/browser-first/`: `xr: false` scene with WASD locomotion,
    RMB-hold pointer-lock mouselook (gimbaled yaw on player + pitch on
    camera), 1st/3rd-person toggle, ray + audio + grab + physics.

  ### Action-Backed Locomotion

  New `world.input.actions` (`InputActionManager`) and
  `ActionLocomotionInputProvider` so locomotion reads intent
  (`locomotion.move`, `.jump`, `.turn`, `.teleport`) instead of polling
  raw devices.
  - Slide, Turn, and Teleport refactored onto the shared provider; XR
    thumbsticks and opt-in browser bindings (WASD, arrow keys, Space,
    standard gamepad) feed the same code paths.
  - New `features.locomotion.browserControls` for first-person browser
    apps.
  - Slide vignette parents to `world.camera` so it tracks the active
    viewport in both XR and browser modes.

  ### ECS-Native Player Rig

  XROrigin and its 7 child spaces (head, raySpaces, gripSpaces,
  indexTipSpaces) are now persistent ECS entities, so apps can parent
  entities under the player rig.
  - New `world.playerEntity`, `world.playerHeadEntity`, and
    `world.playerSpaceEntities` accessors, mirrored on `System`.

  ### Reference & RAG Tooling
  - New `@iwsdk/reference` workspace package with warmup/cache flow and
    a dedicated CLI/MCP parity harness.
  - New `@iwsdk/reference-assets` producer-side ingestion pipeline for
    reference corpus generation, model archive packaging, and versioned
    payload metadata.
  - Reference search wired into the CLI/runtime surface with adapter
    and browser error-handling guardrails.

  ### Runtime-First MCP / CLI Consolidation

  Session resolution, MCP stdio, and adapter management moved into
  `@iwsdk/cli` so generated apps and examples share one entrypoint.
  - MCP adapter configs (Claude Code, Cursor, Codex, Copilot) are
    written at project creation by `create-iwsdk` — or on demand via
    `iwsdk adapter sync` — instead of by `dev up` at runtime.
  - `ai.tools` removed from the vite plugin config and dev-up auto-sync
    flow; configs are now a project-level concern.
  - New `iwsdk adapter sync` is the single adapter-write entry point.

  ### Quad & Cylinder Layers

  WebXR composition layers support for quad and cylinder layers, with
  `examples/layers/` demonstrating correct depth occlusion against a
  spinning ball.

  ### Cloud-Friendly Headless Browser

  `@iwsdk/vite-plugin-dev` auto-detects GPUs and falls back to
  SwiftShader (Playwright Chromium's bundled software renderer) on
  GPU-less Linux cloud VMs.
  - Linux `/dev/dri` probe via `hasGpuDevice()`.
  - `IWSDK_GPU=auto|gpu|swiftshader` env override.
  - Selected backend logged on every launch.
  - Auto-installs Chromium and simplifies MCP config lifecycle.

  ### Scaffolding
  - `--canary [url]` replaces `--from <url>`; bare `--canary` uses a
    baked-in CloudFront CDN URL, custom URLs still accepted.
  - `--xr / --no-xr` for browser-only projects.
  - MSE AI Scene Creation knowledge bundled into the project template
    so AI agents can discover/install/launch Meta Spatial Editor and
    drive `mse-agent`.
  - iwer bumped 2.2.0 → 2.2.1 (RemoteControlInterface duration-action
    error handling and upfront device validation in
    `executeSelectSequence`).

  ### Bug Fixes
  - XR pointers, rays, and cursors now hide until controllers connect,
    fixing the origin-flash on session entry. New
    `XRInputManager.disablePointers()` is invoked on no-session,
    no-frame/reference-space, and session-ended paths.
  - Depth occlusion: `isGPUDepth` is now derived from
    `session.depthUsage === 'gpu-optimized'` so the preprocessing and
    material shaders agree, and MinMax-occluded entities persist across
    XR session re-entry.
  - `InputSystem` no longer drops all descendants on the first frame
    (the `dirty`-bit + `isDescendantOf` filter raced with
    `TransformSystem` parenting); descendant arrays now rebuild every
    frame.
  - UI scroll containers: `localClippingEnabled` set so images no
    longer overflow.
  - `vite-plugin-dev`: avoid pointer ID collision between the
    injection bundle and the host app.
  - `Grabbed` component added and used for physics kinematic override.

## 0.3.1

### Patch Changes

- Truncate CAS asset filenames to stay under jsDelivr's 100-character path component limit, fixing 404 errors during project scaffolding.

## 0.3.0
