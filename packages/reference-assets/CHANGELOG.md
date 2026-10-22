# @iwsdk/reference-assets

## 1.1.0-rc.1

## 1.1.0-rc.0

## 1.0.1

## 1.0.0

### Major Changes

- a79f1ff: Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Patch Changes

- 0ebd993: Canonicalize aliased workspace paths for browser scripts and HMR, retain the
  UIKitML default Inter font, and make hidden-editor runtime reloads deterministic.

  Install missing managed Chromium builds through the plugin-owned Playwright CLI,
  stabilize managed test-server readiness, and compare CLI/MCP screenshots by valid
  PNG metadata instead of timing-sensitive compressed size.

  Keep generated Claude guidance aligned with the canonical AGENTS.md source
  instead of shipping a second, drifting copy.

  Keep package lifecycle scripts portable when pnpm is installed without a global
  Corepack command.

## 1.0.0-rc.2

## 1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Patch Changes

- 0ebd993: Canonicalize aliased workspace paths for browser scripts and HMR, retain the
  UIKitML default Inter font, and make hidden-editor runtime reloads deterministic.

  Install missing managed Chromium builds through the plugin-owned Playwright CLI,
  stabilize managed test-server readiness, and compare CLI/MCP screenshots by valid
  PNG metadata instead of timing-sensitive compressed size.

  Keep generated Claude guidance aligned with the canonical AGENTS.md source
  instead of shipping a second, drifting copy.

  Keep package lifecycle scripts portable when pnpm is installed without a global
  Corepack command.

## 0.5.3

## 0.5.2

## 0.5.0

### Patch Changes

- c463f17: Load `.uikitml` source files directly at runtime with
  `@drawcall/uikitml@0.1.8` and UIKit 1.0.74. Panel UI now parses styles and TTF
  font declarations without generated JSON, and supports typed custom component
  sets through `features.spatialUI`.

  The `@iwsdk/vite-plugin-uikitml` package is removed. Starters and examples now
  ship their UIKitML sources from `public/ui` as ordinary static assets.

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

- Add pinned per-file hashes to reference model metadata so warmup/cache validation no longer depends on recompressing model archives.
- Rebuild the reference payload/model artifacts for the 0.4.1 release.

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
