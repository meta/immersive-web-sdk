# @iwsdk/locomotor

## 1.1.0-rc.0

## 1.0.1

## 1.0.0

### Major Changes

- a79f1ff: Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Patch Changes

- ed2a6b1: Normalize non-indexed and mixed-index locomotion environment meshes before
  building collision geometry, report unusable environments clearly, and
  document that grab components are mutually exclusive per entity.
- ce9cdad: Embed TypeScript sources in the published source maps for the runtime packages,
  and pre-bundle the elics dependency of `@iwsdk/core` in development. The Vite
  development server no longer warns that source maps point to missing source
  files, and browser devtools can show SDK source when stepping into it.
- 2c7b66c: Clamp distance-grab interpolation after stalled frames so position and rotation
  cannot extrapolate into invalid transforms.

  Wake locomotion after environment changes, teleports, and successful jumps,
  allow the first jump immediately, and restart the idle timeout on static-ground
  landings so the float spring settles before sleep.

  Keep native XR composition layers aligned with player space, preserve their
  configured full dimensions and scale, synchronize visibility and geometry, fall
  back safely for unsupported transforms, and release resources during teardown.

  Clear session-owned depth uniforms during XR exit, component removal, and system
  teardown, and require fresh per-session depth data before re-enabling occlusion.

  Refresh retained plane and mesh geometry when WebXR reports updates, compute
  correct axis-aligned mesh bounds, and skip BVH acceleration for compatible
  foreign Three.js geometries that do not expose the extension.

## 1.0.0-rc.2

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

- ed2a6b1: Normalize non-indexed and mixed-index locomotion environment meshes before
  building collision geometry, report unusable environments clearly, and
  document that grab components are mutually exclusive per entity.
- 2c7b66c: Clamp distance-grab interpolation after stalled frames so position and rotation
  cannot extrapolate into invalid transforms.

  Wake locomotion after environment changes, teleports, and successful jumps,
  allow the first jump immediately, and restart the idle timeout on static-ground
  landings so the float spring settles before sleep.

  Keep native XR composition layers aligned with player space, preserve their
  configured full dimensions and scale, synchronize visibility and geometry, fall
  back safely for unsupported transforms, and release resources during teardown.

  Clear session-owned depth uniforms during XR exit, component removal, and system
  teardown, and require fresh per-session depth data before re-enabling occlusion.

  Refresh retained plane and mesh geometry when WebXR reports updates, compute
  correct axis-aligned mesh bounds, and skip BVH acceleration for compatible
  foreign Three.js geometries that do not expose the extension.

## 0.5.3

## 0.5.2

## 0.5.0

### Patch Changes

- c259681: Add a target-first Create flow and dedicated Desktop 3D starter recipes alongside
  the VR and mixed reality starters. Harden managed-workspace readiness and retain
  configured initial player positions when locomotion runs in a worker. Support
  agent-first in-place scaffolding with `.` and explicit `--force` confirmation
  for non-empty repositories. Keep the common starter source target-agnostic and
  leave browser camera interaction to the application instead of scaffolding an
  assumed mouse-look control scheme. Standardize generated coding-agent guidance
  on `AGENTS.md`, add native OpenCode support and narrow per-harness MCP approval
  settings, and provide `iwsdk adapter prompt` as a catch-all setup path.
  Seed the starter panel with explicit Horizon-kit components, bundled Lucide icons,
  and remotely loaded DM Sans font weights.
  Replace the legacy `@meta-quest/hzdb` compatibility shim with
  `@meta-quest/metavr` 1.3.2, migrate its MCP server name, and launch MetaVR
  telemetry and MCP through Node rather than platform shell shims so Windows uses
  the same safe process path as macOS and Linux.

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

### Minor Changes

- AI-native development with MCP tooling, depth occlusion, poke interactions, environment raycast, and grab system improvements

  ### AI-Native Development

  Integrated AI agent tooling that turns the dev server into an autonomous development environment for Claude Code, Cursor, GitHub Copilot, and OpenAI Codex.
  - **MCP server (`iwsdk-dev-mcp`)** with 34 tools for XR session management, device control, browser observation (screenshots, console logs), and scene/ECS introspection (hierarchy, pause/step/snapshot/diff).
  - **RAG code intelligence (`iwsdk-rag-local`)** for semantic code search, API reference lookup, and ECS component/system discovery.
  - **Three AI modes**: `agent` (headless Playwright), `oversight` (visible browser), `collaborate` (shared browser with DevUI).
  - **Headless browser with auto-recovery** via Playwright-managed Chromium with auto-install, crash recovery, and server-side screenshots.
  - **Per-tool scaffolding** via `--ai-tools` flag generating config files and project context docs for each assistant.
  - **Six Claude Code skills**: planner, grab, ray, UI, debug, physics.

  ### Depth Sensing & Occlusion
  - `DepthSensingSystem` with `DepthOccludable` component supporting `SoftOcclusion`, `HardOcclusion`, and `MinMaxSoftOcclusion` modes, plus stereo support.

  ### Poke / Touch Interaction
  - `TouchPointer` with priority-based pointer selection (Touch > Grab > Ray) and hysteresis thresholds for hand tracking.

  ### Environment Raycast
  - `EnvironmentRaycastSystem` wrapping WebXR Hit Test API for tap-to-place and controller-driven hit testing.

  ### Locomotion
  - Expanded `WorldOptions.features.locomotion` with `enableJumping`, `initialPlayerPosition`, `comfortAssistLevel`, and `turningMethod`.

  ### Grab System
  - `detachOnGrab`, `targetPositionOffset`/`targetQuaternionOffset` on `DistanceGrabbable`, and `useHandPinchForGrab` for hand tracking.

  ### CLI & Scaffolding
  - `--from <url>` for bundle-based project creation, full CLI flags with `-y`, and integrated Meta Spatial Editor installer.

  ### Other
  - `entity.dispose()` for GPU resource cleanup.
  - Migrated to `super-three@0.181.0`.
  - Renamed `@iwsdk/vite-plugin-iwer` to `@iwsdk/vite-plugin-dev`.
  - Physics: center of mass, angular/linear damping, gravity factor.
  - Scene understanding: persistent anchors, shared materials, recentering fix.
