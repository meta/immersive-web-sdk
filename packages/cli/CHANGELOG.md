# @iwsdk/cli

## 1.2.0-rc.2

## 1.2.0-rc.1

### Patch Changes

- 2a7cd96: `iwsdk dev up` and `dev restart` no longer re-create coding-agent guidance you removed. In 1.2.0-rc.0 every start put back deleted skills and `Skill(iwsdk-*)` permissions, a deleted `AGENTS.md`, and the managed block and `@AGENTS.md` import in a replaced `AGENTS.md` or `CLAUDE.md`. They now update only the guidance a project already has and nobody edited, and replace retired guidance whole: an unedited skill or file that a release renamed or retired is removed only together with writing its successors, and each successor gets the retired skill's permission if it had one. A 0.4 or 0.5 app gets `iwsdk-dev` for `iwsdk-planner`, Cursor and Copilot guidance for the single files 0.4 wrote, and an `AGENTS.md` block for the guidance its `CLAUDE.md` held. Apart from that they never add a skill, file, block, import or permission the project lacks, whether you removed it or it is new in the installed release; when they refresh, the notice lists the skills and files left out. The guidance manifest in `@iwsdk/core` now names what replaces each retired unit. `iwsdk agents sync` and `iwsdk upgrade` still install the full set, and `iwsdk agents check` still reports what is missing.
- cc17a68: MetaVR telemetry no longer starts one process per command with nothing waiting for it. At most four MetaVR processes run at once and further events wait their turn, so a caller that issues commands quickly (a check script calling `runCli` in a loop, an agent driving the dev server) cannot pile up hundreds of Node processes; 600 rapid commands used to leave about 600 running, now at most four. Events beyond 1000 waiting are dropped, session and error events from the dev server go ahead of waiting tool calls, and on exit a few waiting events are started and the rest dropped. A single command reports exactly as before.
- b5c60a4: `iwsdk upgrade` aligns `three` before installing and checks the registry before changing anything. With `--no-install`, or when the install failed, it left the `three` alias, its override and `@types/three` at the old release, so the suggested `npm install` left two Three.js type trees and `tsc` failed. When the registry did not have the release yet, as with a lagging mirror, it changed `package.json` and then failed with ETARGET. Before it writes anything, it now asks the registry the install will use, with the npm or Yarn settings the install reads, for every `@iwsdk/*` package it upgrades, and aligns `three` with the Three.js version that the new `@iwsdk/core` there depends on. When a package is missing it stops with nothing changed (error code `release_not_on_registry`); when the registry cannot be asked, as offline (unless npm's cache has the release) or without npm, it says why, upgrades anyway and aligns `three` after the install, as before. `--dry-run` lists the Three.js changes.

## 1.2.0-rc.0

### Minor Changes

- ee00260: Ship coding-agent guidance with `@iwsdk/core` and add `iwsdk agents sync`. The AGENTS.md block, skills, rules, and code-review subagent that new apps receive now come from `@iwsdk/core`, stamped with the release and a content hash. `npx @iwsdk/cli@latest agents sync` installs or refreshes them from the installed `@iwsdk/core`, so upgrading IWSDK can also upgrade the guidance: unedited files are replaced, retired IWSDK skills are removed, and edited files are reported and left alone (`--force` replaces them). An existing `AGENTS.md` keeps its text and gains a managed block. Guidance from earlier releases is recognized and upgraded. `iwsdk agents check` reports drift for CI, and `iwsdk adapter sync` now runs the guidance sync too.
- de1eaa9: Keep coding-agent guidance current across IWSDK upgrades. `iwsdk dev up` and `dev restart` notice when the installed `@iwsdk/core` ships different guidance than the project has. They refresh the files nobody edited for the coding tools the project already uses, and print what changed, including the migration guide and release notes when the upgrade crosses releases. They only report when `CI` is set, when `node_modules` disagrees with the lockfile (a monorepo's included), or when `iwsdk.config.json` sets `dev.agentGuidance` to `"warn"`; `"off"` disables the check. New `npx @iwsdk/cli@latest upgrade` sets every `@iwsdk/*` dependency in the release group to the new release, keeping ranges and leaving `workspace:`, `file:` and `catalog:` specs alone. It installs with the package manager found from the nearest lockfile, aligns the `three` alias and `@types/three` with core's, refreshes existing guidance, and checks `iwsdk.config.json` against the new release. It writes migration guides and the release notes between the two versions to `.iwsdk/migrations/`; both now ship with the CLI. New project skill `iwsdk-upgrade` walks coding agents through an upgrade, and a new guide, Upgrading IWSDK, covers it for people.
- 5de9d12: Add `browser filmstrip` (MCP `browser_filmstrip`): pause the app, capture exact simulation frames at fixed step offsets, and return them as one labeled contact sheet. Steps and captures run against the command budget, the previous ECS pause state is restored, and `MCPRuntime.ecsPaused` reports the pause state the tool relies on.
- 13f1046: `@iwsdk/create` now adds IWSDK to an existing project instead of scaffolding over it. When the target already has a `package.json`, Create checks everything before writing and never overwrites a file, even with `--force`. A project on a Vite major the plugin does not support yet, or with an invalid `package.json`, is refused with nothing changed, and `--canary` is refused. Otherwise Create adds a minimal skeleton in its own `src/iwsdk/` folder (world entry, empty asset and component manifests) plus `iwsdk.config.json` and an empty scene. It merges `package.json` in its own formatting: versions are only raised, `workspace:`/`file:`/`catalog:` specs are kept, and scripts are kept, with `iwsdk:dev` added when `dev` is taken. Overrides go where the package manager reads them (npm and bun `overrides`, yarn `resolutions`, `pnpm-workspace.yaml`). `iwsdkDev()` is added to the Vite config when its top-level `plugins` array is unambiguous. Dependencies install with the package manager found from the nearest lockfile, and coding-agent guidance is installed while an existing `AGENTS.md` keeps its text. Create prints what it kept and the steps left to finish, even when the install fails. Previously `create . --force` replaced the project's `package.json`, `index.html`, Vite config, and entry file. `@iwsdk/cli` exports the guidance sync as `@iwsdk/cli/agent-guidance`.
- 4f9f9b2: Headless managed sessions (`--ai-mode agent`, `--headless`) now start the app in on-demand render mode: systems, input, physics and UI run every frame, but the app draws only when a tool needs pixels, so a machine without a GPU no longer software-rasterizes every frame. `browser screenshot` draws a fresh frame itself; browser profiles, runtime preflight and publish evidence, and `browser run` scripts draw every frame while they run. `dev status` reports the mode the session starts the app in as `session.browser.renderMode`. `IWSDK_DEV_RENDER_MODE=continuous` opts out; headed and collaborate sessions always draw every frame. Every managed session turns off the emulator's per-frame clear (`XRDevice.frameClearEnabled`), so one drawn frame persists for XR captures, and draws the emulated AR room only on frames the app draws (`XRDevice.shouldDrawEnvironment`), so an idle on-demand AR session draws nothing. The emulator dependencies (`iwer`, `@iwer/sem`, `@iwer/devui`) move to ^2.8.0, which adds both settings.

### Patch Changes

- ae420a2: `iwsdk reference search`, `api`, `file`, `dependents` and `examples` now take their main input as positional text, so `iwsdk reference search PokeInteractable hand` works instead of failing with "Query cannot be empty". Fields in `--input-json` still win, and `file` defaults `source` to `iwsdk`. Subcommands without one main field reject positional text and point to `--input-json`.
- c8c0a20: Report why a runtime tool failed when the dev server, its relay, or the managed browser's command lock says so. Their error codes (for example `command_timeout`, `browser_command_timeout`, `target_not_ready`, `browser_relaunched`) were dropped from usage telemetry and every such failure was reported as `runtime_error`. These codes are constants defined by IWSDK, so error messages are still never reported.

## 1.1.0

### Minor Changes

- a1ab306: Agents and scripts can now drive the emulator's hands the way a person moves them, so an app's real poke, pinch and grab code reacts. The emulator moves to IWER 2.7.0, and its hand tools are new MCP tools and `iwsdk xr` commands: `xr_run_sequence` (`xr run-sequence`) runs a whole interaction in one call (press a button with the index fingertip, pinch-grab an object, carry it, set it down, gesture), with `xr_cancel_sequence` and `xr_list_targets`; `xr_set_hand_pose`, `xr_get_hand_state` and `xr_microgesture` shape, read and gesture a hand. `xr_set_transform` and `xr_animate_to` also place a hand by a point on it (`anchor`) and orient it by direction or `"auto"`, `xr_set_select_value` ramps over `duration`, and `xr_set_device_state` takes each hand's `poseId` and `pinchValue`. The schemas mirror IWER's, and a misspelt key inside a union now names that key instead of reporting "a supported shape". Hand sequences get a 40 s command timeout, and the default timeout of a pose fade, select ramp or animation grows by its `duration`.

  Sequence steps name their targets: IWSDK registers a target resolver with the emulator that finds interactable entities by name (`Map Pin 1`), the UIKitML element IDs inside them (`counter-button`), scene node IDs and UUIDs, and reports surface points, normals and boxes relative to the XR origin (`MCPRuntime.targetResolver`, `SceneTargetResolver`). The generated agent skills include hand recipes for pressing UI and pinch-grabbing.

- 035efa5: Add a tab mute control to the managed browser. Chromium's app-mode window hides its own tab mute button, so the workspace's Runtime/Editor bar now has a speaker button, and agents get the matching `browser_set_muted` MCP tool (`iwsdk browser set-muted --muted <true|false>`). Muting silences Web Audio and media elements in every frame without pausing the app, persists across reloads and managed-browser relaunches for the dev session, and is reported as `browser.audioMuted` by `runtime_get_status`.

### Patch Changes

- 7a92e16: New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
- 96b451a: `DomeGradient` gains `elevationDeg` and `azimuthDeg`, which tilt the sky pole away from straight up (azimuth uses a scene node's Y rotation convention, so 90 faces -X), and `dither`, which adds ±0.5/255 screen noise against banding. The defaults render exactly as before. `DomeGradient` and `IBLGradient` now apply edits on the next frame without `_needsUpdate` (setting it still forces a refresh; `DomeTexture` and `IBLTexture` still need it), their fields carry labels, help and limits, and `intensity: 0` now means off instead of 1 (negative values fail validation). `IBLGradient` applies `intensity` once, as `scene.environmentIntensity`; 1.0.x applied it twice, so square any 1.0.x value other than 1 to keep its look (`0.45` becomes `0.2025`). Switching between `DomeTexture` and `DomeGradient`, or between `IBLTexture` and `IBLGradient`, no longer leaves a stale dome, background, IBL rotation or intensity behind, and removing the IBL source resets `environmentIntensity`. `scene_get_render_stats` now reports gradient and texture skies (`dome-gradient`, `dome-texture`) and image-based lighting (`ibl-gradient`, `ibl-texture`) instead of `null`. Scenes that use the new fields need `@iwsdk/core` 1.1.0. The generated agent guidance and the CLI's `AGENTS.md` now ask for `_needsUpdate` only on `DomeTexture` and `IBLTexture`.
- c59bf0b: The dev server's runtime WebSocket (`/__iwer_mcp`) now requires a per-session command credential on every command. Before, any script running in the app page (an app dependency, for example) and any other local user could connect and run runtime, editor and managed-browser commands. The dev server writes a random secret to `.iwsdk/runtime/command-credential.json` and deletes it when it stops. The file is never served over HTTP, and on macOS and Linux it is readable only by your user (mode 0600); on Windows it takes the project folder's permissions. The `iwsdk` CLI and `iwsdk mcp stdio` read it and send it with each command, and the server removes it before relaying a command to a page. A command without it fails with `runtime_unauthorized` and is not executed. Browser bridges keep their own rules (the managed browser's session identity, a headset's pairing token), and a CLI holding a stale session still gets `stale_runtime_owner`. Use the CLI and the dev plugin from the same IWSDK release: an older CLI sends no credential.

  Scene routes now resolve symbolic links before they read or write. The managed editor can no longer open, save, flatten, import or list a scene through a link that leads outside `public/scenes` (or a `public/scenes` that leads outside the project), and its file picker refuses a `public/` subfolder linked outside `public/`. Links that stay inside `public/scenes` keep working.

## 1.1.0-rc.2

### Minor Changes

- a1ab306: Agents and scripts can now drive the emulator's hands the way a person moves them, so an app's real poke, pinch and grab code reacts. The emulator moves to IWER 2.7.0, and its hand tools are new MCP tools and `iwsdk xr` commands: `xr_run_sequence` (`xr run-sequence`) runs a whole interaction in one call (press a button with the index fingertip, pinch-grab an object, carry it, set it down, gesture), with `xr_cancel_sequence` and `xr_list_targets`; `xr_set_hand_pose`, `xr_get_hand_state` and `xr_microgesture` shape, read and gesture a hand. `xr_set_transform` and `xr_animate_to` also place a hand by a point on it (`anchor`) and orient it by direction or `"auto"`, `xr_set_select_value` ramps over `duration`, and `xr_set_device_state` takes each hand's `poseId` and `pinchValue`. The schemas mirror IWER's, and a misspelt key inside a union now names that key instead of reporting "a supported shape". Hand sequences get a 40 s command timeout, and the default timeout of a pose fade, select ramp or animation grows by its `duration`.

  Sequence steps name their targets: IWSDK registers a target resolver with the emulator that finds interactable entities by name (`Map Pin 1`), the UIKitML element IDs inside them (`counter-button`), scene node IDs and UUIDs, and reports surface points, normals and boxes relative to the XR origin (`MCPRuntime.targetResolver`, `SceneTargetResolver`). The generated agent skills include hand recipes for pressing UI and pinch-grabbing.

- 035efa5: Add a tab mute control to the managed browser. Chromium's app-mode window hides its own tab mute button, so the workspace's Runtime/Editor bar now has a speaker button, and agents get the matching `browser_set_muted` MCP tool (`iwsdk browser set-muted --muted <true|false>`). Muting silences Web Audio and media elements in every frame without pausing the app, persists across reloads and managed-browser relaunches for the dev session, and is reported as `browser.audioMuted` by `runtime_get_status`.

### Patch Changes

- 7a92e16: New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
- 96b451a: `DomeGradient` gains `elevationDeg` and `azimuthDeg`, which tilt the sky pole away from straight up (azimuth uses a scene node's Y rotation convention, so 90 faces -X), and `dither`, which adds ±0.5/255 screen noise against banding. The defaults render exactly as before. `DomeGradient` and `IBLGradient` now apply edits on the next frame without `_needsUpdate` (setting it still forces a refresh; `DomeTexture` and `IBLTexture` still need it), their fields carry labels, help and limits, and `intensity: 0` now means off instead of 1 (negative values fail validation). `IBLGradient` applies `intensity` once, as `scene.environmentIntensity`; 1.0.x applied it twice, so square any 1.0.x value other than 1 to keep its look (`0.45` becomes `0.2025`). Switching between `DomeTexture` and `DomeGradient`, or between `IBLTexture` and `IBLGradient`, no longer leaves a stale dome, background, IBL rotation or intensity behind, and removing the IBL source resets `environmentIntensity`. `scene_get_render_stats` now reports gradient and texture skies (`dome-gradient`, `dome-texture`) and image-based lighting (`ibl-gradient`, `ibl-texture`) instead of `null`. Scenes that use the new fields need `@iwsdk/core` 1.1.0. The generated agent guidance and the CLI's `AGENTS.md` now ask for `_needsUpdate` only on `DomeTexture` and `IBLTexture`.
- c59bf0b: The dev server's runtime WebSocket (`/__iwer_mcp`) now requires a per-session command credential on every command. Before, any script running in the app page (an app dependency, for example) and any other local user could connect and run runtime, editor and managed-browser commands. The dev server writes a random secret to `.iwsdk/runtime/command-credential.json` and deletes it when it stops. The file is never served over HTTP, and on macOS and Linux it is readable only by your user (mode 0600); on Windows it takes the project folder's permissions. The `iwsdk` CLI and `iwsdk mcp stdio` read it and send it with each command, and the server removes it before relaying a command to a page. A command without it fails with `runtime_unauthorized` and is not executed. Browser bridges keep their own rules (the managed browser's session identity, a headset's pairing token), and a CLI holding a stale session still gets `stale_runtime_owner`. Use the CLI and the dev plugin from the same IWSDK release: an older CLI sends no credential.

  Scene routes now resolve symbolic links before they read or write. The managed editor can no longer open, save, flatten, import or list a scene through a link that leads outside `public/scenes` (or a `public/scenes` that leads outside the project), and its file picker refuses a `public/` subfolder linked outside `public/`. Links that stay inside `public/scenes` keep working.

## 1.1.0-rc.1

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
