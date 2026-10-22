# @iwsdk/cli

## 1.1.0-rc.0

## 1.0.1

### Patch Changes

- a640d35: Report CLI runtime commands such as `iwsdk xr status` and `iwsdk browser screenshot` through the same MetaVR usage telemetry as the equivalent MCP tools. Each invocation is recorded once, under the installed CLI version rather than a fixed `1.0.0`. MCP tools now check their parameters before looking for a running dev server, as the CLI does, so invalid parameters report the parameter error instead of a missing runtime. Failed operations now report a fixed reason, such as `invalid_input`, `no_runtime`, or `connection_lost`, instead of the start of the error message, so telemetry no longer carries text from your project.

## 1.0.0

### Major Changes

- a79f1ff: Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Minor Changes

- 51a5b99: Add batch-scoped keyDown and keyUp browser interactions with optional focused
  targets, bounded duration waits, automatic held-key cleanup even for malformed
  runtime requests, and complete nested step fields in CLI command help.
- d0b24a1: Add bounded live UIKitML element inspection to the CLI and MCP runtime, including
  current ID, class, text, layout, interaction, property, and effective visibility
  state. Teach generated UI-agent guidance to use the inspection command for
  runtime verification.
- faf9709: Add isolated multi-view model previews with authored-material and clay modes,
  named-part focus, and deterministic geometry diagnostics. Split generated scene
  guidance into `iwsdk-build-model` for object-local asset authoring and
  `iwsdk-compose-scene` for world-relative composition and review, with a bundled
  hard-surface starter library for efficient procedural authoring. Agent-facing
  model previews default to a context-efficient 640 by 480 contact sheet while still
  allowing explicit higher-resolution focused inspection. Scene-composition guidance
  uses a smaller correction-verification render so delivery-quality captures do not
  inflate the agent loop. Screenshot-producing MCP tools now persist PNGs locally and
  return `screenshotPath` instead of embedding base64 image data in tool responses.
- 13a5cbe: Add opt-in native Quest WebXR control sessions, session-grant launch support,
  deterministic physical-browser routing, and generated-project guidance for
  running IWSDK tests through an ADB-reversed localhost connection.
- e18c42a: Harden the CLI-managed development runtime with one fail-closed workspace
  owner, an explicit managed-browser lifecycle, exact managed and physical target
  routing, bounded command execution, and runtime status/recovery tools. Dev
  startup uses Vite's resolved application port and may return before the browser
  command path is ready; inspect `browserCommandReady` or use `runtime wait` before
  issuing browser-backed commands. A configured `server.port` is the runtime's
  address, so an occupied port now fails startup instead of moving to the next
  free port; an explicit `server.strictPort` still wins. Recovery reports `browser_relaunched` without
  replaying the command, while failures after dispatch report `outcome_unknown`.

  Managed Chromium uses a private profile in OS temporary storage that survives
  automatic browser recovery while retained. Stop active dev processes before
  upgrading the CLI and Vite plugin together. Native pose overrides are enabled
  only for explicitly configured Quest sessions; other browsers continue using
  IWER emulation.

### Patch Changes

- f80787e: Generate npm- and pnpm-installable projects with deterministic local tarball
  overrides and pnpm 10/11 lifecycle policy, including deferred bundle installs.

  Pin the compatible Sharp 0.35.4 release, refresh dependency security overrides,
  use project-local TypeScript commands, and migrate Quest tooling guidance from
  the legacy HzDB package to the owned `@meta-quest/metavr` package.

- 9348db4: Use the owned scoped CLI package for documented and automated IWSDK commands.
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

### Minor Changes

- 51a5b99: Add batch-scoped keyDown and keyUp browser interactions with optional focused
  targets, bounded duration waits, automatic held-key cleanup even for malformed
  runtime requests, and complete nested step fields in CLI command help.
- d0b24a1: Add bounded live UIKitML element inspection to the CLI and MCP runtime, including
  current ID, class, text, layout, interaction, property, and effective visibility
  state. Teach generated UI-agent guidance to use the inspection command for
  runtime verification.
- faf9709: Add isolated multi-view model previews with authored-material and clay modes,
  named-part focus, and deterministic geometry diagnostics. Split generated scene
  guidance into `iwsdk-build-model` for object-local asset authoring and
  `iwsdk-compose-scene` for world-relative composition and review, with a bundled
  hard-surface starter library for efficient procedural authoring. Agent-facing
  model previews default to a context-efficient 640 by 480 contact sheet while still
  allowing explicit higher-resolution focused inspection. Scene-composition guidance
  uses a smaller correction-verification render so delivery-quality captures do not
  inflate the agent loop. Screenshot-producing MCP tools now persist PNGs locally and
  return `screenshotPath` instead of embedding base64 image data in tool responses.
- 13a5cbe: Add opt-in native Quest WebXR control sessions, session-grant launch support,
  deterministic physical-browser routing, and generated-project guidance for
  running IWSDK tests through an ADB-reversed localhost connection.
- e18c42a: Harden the CLI-managed development runtime with one fail-closed workspace
  owner, an explicit managed-browser lifecycle, exact managed and physical target
  routing, bounded command execution, and runtime status/recovery tools. Dev
  startup uses Vite's resolved application port and may return before the browser
  command path is ready; inspect `browserCommandReady` or use `runtime wait` before
  issuing browser-backed commands. A configured `server.port` is the runtime's
  address, so an occupied port now fails startup instead of moving to the next
  free port; an explicit `server.strictPort` still wins. Recovery reports `browser_relaunched` without
  replaying the command, while failures after dispatch report `outcome_unknown`.

  Managed Chromium uses a private profile in OS temporary storage that survives
  automatic browser recovery while retained. Stop active dev processes before
  upgrading the CLI and Vite plugin together. Native pose overrides are enabled
  only for explicitly configured Quest sessions; other browsers continue using
  IWER emulation.

### Patch Changes

- f80787e: Generate npm- and pnpm-installable projects with deterministic local tarball
  overrides and pnpm 10/11 lifecycle policy, including deferred bundle installs.

  Pin the compatible Sharp 0.35.4 release, refresh dependency security overrides,
  use project-local TypeScript commands, and migrate Quest tooling guidance from
  the legacy HzDB package to the owned `@meta-quest/metavr` package.

- 9348db4: Use the owned scoped CLI package for documented and automated IWSDK commands.
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

### Patch Changes

- 0b3ddc3: Improve managed editor and local launch reliability. Add an editor action to open
  the runtime in the default browser, serve generated-app test assets from the app
  origin, persist local HTTPS certificates, bootstrap fresh tarball builds, improve
  controller UI clicks, clarify XR player framing, and tolerate slower isolated
  render previews.

## 0.5.0

### Minor Changes

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

- Connect runtime WebSocket traffic to `127.0.0.1` instead of `localhost`, avoiding local DNS/IPv6 resolution issues when talking to the dev server.
- Tighten dev-server browser readiness/status handling used by CLI and MCP probes.

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
