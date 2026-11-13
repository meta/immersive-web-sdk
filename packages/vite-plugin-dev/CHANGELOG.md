# @iwsdk/vite-plugin-dev

## 1.1.0

### Minor Changes

- 3c6c2f3: The emulator now uses IWER 2.6.0's built-in GLTS rooms as its environments: `dev.emulator.environment` accepts `sunlit_living_room` (the new default for AR projects), `home_office`, `conference_room`, `open_office`, `kitchen`, `bedroom`, `music_studio` and `open_studio`, and the DevUI environment menu lists only these rooms. The legacy capture rooms are no longer offered; configurations that still name one get a deprecation warning and load its replacement (`living_room` → `sunlit_living_room`, `meeting_room` → `conference_room`, `music_room` → `music_studio`, `office_large` → `open_office`, `office_small` → `home_office`). The emulator runtime is now code-split: the room you pick and the GLTS runtime load on demand, and the capture data is no longer shipped.
- a1ab306: Agents and scripts can now drive the emulator's hands the way a person moves them, so an app's real poke, pinch and grab code reacts. The emulator moves to IWER 2.7.0, and its hand tools are new MCP tools and `iwsdk xr` commands: `xr_run_sequence` (`xr run-sequence`) runs a whole interaction in one call (press a button with the index fingertip, pinch-grab an object, carry it, set it down, gesture), with `xr_cancel_sequence` and `xr_list_targets`; `xr_set_hand_pose`, `xr_get_hand_state` and `xr_microgesture` shape, read and gesture a hand. `xr_set_transform` and `xr_animate_to` also place a hand by a point on it (`anchor`) and orient it by direction or `"auto"`, `xr_set_select_value` ramps over `duration`, and `xr_set_device_state` takes each hand's `poseId` and `pinchValue`. The schemas mirror IWER's, and a misspelt key inside a union now names that key instead of reporting "a supported shape". Hand sequences get a 40 s command timeout, and the default timeout of a pose fade, select ramp or animation grows by its `duration`.

  Sequence steps name their targets: IWSDK registers a target resolver with the emulator that finds interactable entities by name (`Map Pin 1`), the UIKitML element IDs inside them (`counter-button`), scene node IDs and UUIDs, and reports surface points, normals and boxes relative to the XR origin (`MCPRuntime.targetResolver`, `SceneTargetResolver`). The generated agent skills include hand recipes for pressing UI and pinch-grabbing.

- 035efa5: Add a tab mute control to the managed browser. Chromium's app-mode window hides its own tab mute button, so the workspace's Runtime/Editor bar now has a speaker button, and agents get the matching `browser_set_muted` MCP tool (`iwsdk browser set-muted --muted <true|false>`). Muting silences Web Audio and media elements in every frame without pausing the app, persists across reloads and managed-browser relaunches for the dev session, and is reported as `browser.audioMuted` by `runtime_get_status`.
- fcf7825: Move to Three.js r185 (`super-three@0.185.0`, `@types/three` 0.185). Apps pin the same version: update `three` and its override to `npm:super-three@0.185.0` (new projects from `@iwsdk/create` get it). The r185 changes are handled so apps see no warnings or visual changes: scene `shadowMapType: 'pcf-soft'` uses `PCFShadowMap` (soft since r182, which deprecated `PCFSoftShadowMap`), the render loop uses `Timer` instead of the deprecated `Clock`, the `room` IBL keeps its lighting, controller and hand visuals compile with r183+'s vec4 vertex colors (and still with older Three.js for `@iwsdk/xr-input`), and production builds no longer bundle the unused Draco and Basis decoders that r185's loaders reference.

### Patch Changes

- 7a92e16: New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
- 0251c03: Add `ContactShadow` and `ShadowCatcher`, node components that ground content without hand-built shadow meshes. `ContactShadow` draws a soft round blob under its node (`size`, `opacity`, `color`, `height`); `ShadowCatcher` is an invisible floor that shows only the shadows it receives, for AR passthrough (`size`, `opacity`, `color`; it needs `environment.shadows` and a light with `castShadow`). The new `GroundShadowSystem` builds their meshes, which move and scale with the node, never cast shadows or take ray, grab or touch pointer hits, and stay visible in AR. Meshes marked runtime-only, as both are, are left out of auto-detected physics shapes, locomotion collision, gaze target bounds and `entity.dispose()`. The editor viewport renders both, and its selection and framing bounds, geometry lens and preview ghosting leave them out, as do the framing bounds and asset mesh counts in `scene_get_render_stats`, the emulator's hand targets and the grab setup warning. Render stats count them in `sceneEnvironment.groundShadows`, and scene validation rejects a `size` that is not positive. Scenes that use the components need @iwsdk/core 1.1.0. The generated agent guidance points to them instead of canvas blob cards and `ShadowMaterial` planes.
- a57296b: Production builds no longer bundle every Lucide icon. Since 1.0, the UIKitML kit put all of about 1,600 Lucide icon components into every app (most of the starter's 6.7 MB main chunk). `vite build` now keeps only the icons used in static `public/**/*.uikitml`, the icons Horizon components use internally, and any listed in the new `iwsdkDev({ bundle: { icons: [...] } })` option for remote or generated UIKitML (`'all'` keeps every icon). If UIKitML in a production build names an icon that was left out, the `@iwsdk/core` parse error now points to that option. The dev server and editor still have every icon.
- c59bf0b: The dev server's runtime WebSocket (`/__iwer_mcp`) now requires a per-session command credential on every command. Before, any script running in the app page (an app dependency, for example) and any other local user could connect and run runtime, editor and managed-browser commands. The dev server writes a random secret to `.iwsdk/runtime/command-credential.json` and deletes it when it stops. The file is never served over HTTP, and on macOS and Linux it is readable only by your user (mode 0600); on Windows it takes the project folder's permissions. The `iwsdk` CLI and `iwsdk mcp stdio` read it and send it with each command, and the server removes it before relaying a command to a page. A command without it fails with `runtime_unauthorized` and is not executed. Browser bridges keep their own rules (the managed browser's session identity, a headset's pairing token), and a CLI holding a stale session still gets `stale_runtime_owner`. Use the CLI and the dev plugin from the same IWSDK release: an older CLI sends no credential.

  Scene routes now resolve symbolic links before they read or write. The managed editor can no longer open, save, flatten, import or list a scene through a link that leads outside `public/scenes` (or a `public/scenes` that leads outside the project), and its file picker refuses a `public/` subfolder linked outside `public/`. Links that stay inside `public/scenes` keep working.

- Updated dependencies [a57296b]
- Updated dependencies [08250e6]
- Updated dependencies [08250e6]
- Updated dependencies [7a92e16]
- Updated dependencies [96b451a]
- Updated dependencies [08250e6]
- Updated dependencies [0251c03]
- Updated dependencies [3c6c2f3]
- Updated dependencies [a1ab306]
- Updated dependencies [a57296b]
- Updated dependencies [5db9b65]
- Updated dependencies [fcf7825]
- Updated dependencies [e551c3d]
- Updated dependencies [ee50d96]
- Updated dependencies [a57296b]
  - @iwsdk/core@1.1.0
  - @iwsdk/scene-composition@1.1.0

## 1.1.0-rc.2

### Minor Changes

- a1ab306: Agents and scripts can now drive the emulator's hands the way a person moves them, so an app's real poke, pinch and grab code reacts. The emulator moves to IWER 2.7.0, and its hand tools are new MCP tools and `iwsdk xr` commands: `xr_run_sequence` (`xr run-sequence`) runs a whole interaction in one call (press a button with the index fingertip, pinch-grab an object, carry it, set it down, gesture), with `xr_cancel_sequence` and `xr_list_targets`; `xr_set_hand_pose`, `xr_get_hand_state` and `xr_microgesture` shape, read and gesture a hand. `xr_set_transform` and `xr_animate_to` also place a hand by a point on it (`anchor`) and orient it by direction or `"auto"`, `xr_set_select_value` ramps over `duration`, and `xr_set_device_state` takes each hand's `poseId` and `pinchValue`. The schemas mirror IWER's, and a misspelt key inside a union now names that key instead of reporting "a supported shape". Hand sequences get a 40 s command timeout, and the default timeout of a pose fade, select ramp or animation grows by its `duration`.

  Sequence steps name their targets: IWSDK registers a target resolver with the emulator that finds interactable entities by name (`Map Pin 1`), the UIKitML element IDs inside them (`counter-button`), scene node IDs and UUIDs, and reports surface points, normals and boxes relative to the XR origin (`MCPRuntime.targetResolver`, `SceneTargetResolver`). The generated agent skills include hand recipes for pressing UI and pinch-grabbing.

- 035efa5: Add a tab mute control to the managed browser. Chromium's app-mode window hides its own tab mute button, so the workspace's Runtime/Editor bar now has a speaker button, and agents get the matching `browser_set_muted` MCP tool (`iwsdk browser set-muted --muted <true|false>`). Muting silences Web Audio and media elements in every frame without pausing the app, persists across reloads and managed-browser relaunches for the dev session, and is reported as `browser.audioMuted` by `runtime_get_status`.

### Patch Changes

- 7a92e16: New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
- 0251c03: Add `ContactShadow` and `ShadowCatcher`, node components that ground content without hand-built shadow meshes. `ContactShadow` draws a soft round blob under its node (`size`, `opacity`, `color`, `height`); `ShadowCatcher` is an invisible floor that shows only the shadows it receives, for AR passthrough (`size`, `opacity`, `color`; it needs `environment.shadows` and a light with `castShadow`). The new `GroundShadowSystem` builds their meshes, which move and scale with the node, never cast shadows or take ray, grab or touch pointer hits, and stay visible in AR. Meshes marked runtime-only, as both are, are left out of auto-detected physics shapes, locomotion collision, gaze target bounds and `entity.dispose()`. The editor viewport renders both, and its selection and framing bounds, geometry lens and preview ghosting leave them out, as do the framing bounds and asset mesh counts in `scene_get_render_stats`, the emulator's hand targets and the grab setup warning. Render stats count them in `sceneEnvironment.groundShadows`, and scene validation rejects a `size` that is not positive. Scenes that use the components need @iwsdk/core 1.1.0. The generated agent guidance points to them instead of canvas blob cards and `ShadowMaterial` planes.
- a57296b: Production builds no longer bundle every Lucide icon. Since 1.0, the UIKitML kit put all of about 1,600 Lucide icon components into every app (most of the starter's 6.7 MB main chunk). `vite build` now keeps only the icons used in static `public/**/*.uikitml`, the icons Horizon components use internally, and any listed in the new `iwsdkDev({ bundle: { icons: [...] } })` option for remote or generated UIKitML (`'all'` keeps every icon). If UIKitML in a production build names an icon that was left out, the `@iwsdk/core` parse error now points to that option. The dev server and editor still have every icon.
- c59bf0b: The dev server's runtime WebSocket (`/__iwer_mcp`) now requires a per-session command credential on every command. Before, any script running in the app page (an app dependency, for example) and any other local user could connect and run runtime, editor and managed-browser commands. The dev server writes a random secret to `.iwsdk/runtime/command-credential.json` and deletes it when it stops. The file is never served over HTTP, and on macOS and Linux it is readable only by your user (mode 0600); on Windows it takes the project folder's permissions. The `iwsdk` CLI and `iwsdk mcp stdio` read it and send it with each command, and the server removes it before relaying a command to a page. A command without it fails with `runtime_unauthorized` and is not executed. Browser bridges keep their own rules (the managed browser's session identity, a headset's pairing token), and a CLI holding a stale session still gets `stale_runtime_owner`. Use the CLI and the dev plugin from the same IWSDK release: an older CLI sends no credential.

  Scene routes now resolve symbolic links before they read or write. The managed editor can no longer open, save, flatten, import or list a scene through a link that leads outside `public/scenes` (or a `public/scenes` that leads outside the project), and its file picker refuses a `public/` subfolder linked outside `public/`. Links that stay inside `public/scenes` keep working.

- Updated dependencies [a57296b]
- Updated dependencies [08250e6]
- Updated dependencies [08250e6]
- Updated dependencies [7a92e16]
- Updated dependencies [96b451a]
- Updated dependencies [08250e6]
- Updated dependencies [0251c03]
- Updated dependencies [a1ab306]
- Updated dependencies [a57296b]
- Updated dependencies [5db9b65]
- Updated dependencies [e551c3d]
- Updated dependencies [a57296b]
  - @iwsdk/core@1.1.0-rc.2
  - @iwsdk/scene-composition@1.1.0-rc.2

## 1.1.0-rc.1

### Patch Changes

- Updated dependencies [abbd7d0]
  - @iwsdk/core@1.1.0-rc.1
  - @iwsdk/scene-composition@1.1.0-rc.1

## 1.1.0-rc.0

### Minor Changes

- 6026060: The emulator now uses IWER 2.6.0's built-in GLTS rooms as its environments: `dev.emulator.environment` accepts `sunlit_living_room` (the new default for AR projects), `home_office`, `conference_room`, `open_office`, `kitchen`, `bedroom`, `music_studio` and `open_studio`, and the DevUI environment menu lists only these rooms. The legacy capture rooms are no longer offered; configurations that still name one get a deprecation warning and load its replacement (`living_room` → `sunlit_living_room`, `meeting_room` → `conference_room`, `music_room` → `music_studio`, `office_large` → `open_office`, `office_small` → `home_office`). The emulator runtime is now code-split: the room you pick and the GLTS runtime load on demand, and the capture data is no longer shipped.
- 0f10007: Move to Three.js r185 (`super-three@0.185.0`, `@types/three` 0.185). Apps pin the same version: update `three` and its override to `npm:super-three@0.185.0` (new projects from `@iwsdk/create` get it). The r185 changes are handled so apps see no warnings or visual changes: scene `shadowMapType: 'pcf-soft'` uses `PCFShadowMap` (soft since r182, which deprecated `PCFSoftShadowMap`), the render loop uses `Timer` instead of the deprecated `Clock`, the `room` IBL keeps its lighting, controller and hand visuals compile with r183+'s vec4 vertex colors (and still with older Three.js for `@iwsdk/xr-input`), and production builds no longer bundle the unused Draco and Basis decoders that r185's loaders reference.

### Patch Changes

- Updated dependencies [6026060]
- Updated dependencies [0f10007]
  - @iwsdk/core@1.1.0-rc.0
  - @iwsdk/scene-composition@1.1.0-rc.0

## 1.0.1

### Patch Changes

- @iwsdk/core@1.0.1
- @iwsdk/scene-composition@1.0.1

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
- 51a5b99: Add batch-scoped keyDown and keyUp browser interactions with optional focused
  targets, bounded duration waits, automatic held-key cleanup even for malformed
  runtime requests, and complete nested step fields in CLI command help.
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

- b853e70: Pre-optimize the application-owned Three.js entry in generated projects and
  development servers so the runtime and UIKit dependencies share one Three.js
  module instance.
- bee3c50: Preserve managed editor state when imported project modules change during development.
- ce9cdad: Embed TypeScript sources in the published source maps for the runtime packages,
  and pre-bundle the elics dependency of `@iwsdk/core` in development. The Vite
  development server no longer warns that source maps point to missing source
  files, and browser devtools can show SDK source when stepping into it.
- f80787e: Generate npm- and pnpm-installable projects with deterministic local tarball
  overrides and pnpm 10/11 lifecycle policy, including deferred bundle installs.

  Pin the compatible Sharp 0.35.4 release, refresh dependency security overrides,
  use project-local TypeScript commands, and migrate Quest tooling guidance from
  the legacy HzDB package to the owned `@meta-quest/metavr` package.

- 647bd59: Allow an explicitly configured local example-asset directory through Vite's
  file-system boundary while preserving the default workspace root and denying
  unrelated external paths.
- 438f10c: Existing `physics: true` projects now run Havok in a Web Worker at a fixed 60
  Hz by default, using transferable ArrayBuffer exchanges and render
  interpolation. Add a shared main-thread mode for debugging and compatibility,
  plus debugger pause/step synchronization across both execution modes.
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

- e945946: Capture framed and referenced application screenshots through stable page
  clips, preserve bounded full-document captures across display scale factors,
  restore document scroll state, hide workspace controls from captures, reject
  oversized element refs without retry loops, and bound managed-workspace render
  settling.
- Updated dependencies [15688e2]
- Updated dependencies [ed2a6b1]
- Updated dependencies [aee9970]
- Updated dependencies [ce9cdad]
- Updated dependencies [4d4efa0]
- Updated dependencies [d0b24a1]
- Updated dependencies [faf9709]
- Updated dependencies [13a5cbe]
- Updated dependencies [438f10c]
- Updated dependencies [52c7378]
- Updated dependencies [3306963]
- Updated dependencies [e18c42a]
- Updated dependencies [a79f1ff]
- Updated dependencies [2c7b66c]
- Updated dependencies [3306963]
- Updated dependencies [3306963]
  - @iwsdk/core@1.0.0
  - @iwsdk/scene-composition@1.0.0

## 1.0.0-rc.2

### Minor Changes

- d3640c2: Add configurable gaze input, gaze-driven pointer selection, native-session
  `gaze-tracking` and `eye-tracking` feature requests, a `metaVRGlasses` desktop
  emulator device with gaze input, and a development-only Meta VR Glasses gaze
  preview for physical Quest headsets.

### Patch Changes

- Updated dependencies [d3640c2]
  - @iwsdk/core@1.0.0-rc.2
  - @iwsdk/scene-composition@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- 5384bc0: Embed TypeScript sources in the published source maps for the runtime packages,
  and pre-bundle the elics dependency of `@iwsdk/core` in development. The Vite
  development server no longer warns that source maps point to missing source
  files, and browser devtools can show SDK source when stepping into it.
- Updated dependencies [5384bc0]
  - @iwsdk/core@1.0.0-rc.1
  - @iwsdk/scene-composition@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Minor Changes

- 51a5b99: Add batch-scoped keyDown and keyUp browser interactions with optional focused
  targets, bounded duration waits, automatic held-key cleanup even for malformed
  runtime requests, and complete nested step fields in CLI command help.
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

- b853e70: Pre-optimize the application-owned Three.js entry in generated projects and
  development servers so the runtime and UIKit dependencies share one Three.js
  module instance.
- bee3c50: Preserve managed editor state when imported project modules change during development.
- f80787e: Generate npm- and pnpm-installable projects with deterministic local tarball
  overrides and pnpm 10/11 lifecycle policy, including deferred bundle installs.

  Pin the compatible Sharp 0.35.4 release, refresh dependency security overrides,
  use project-local TypeScript commands, and migrate Quest tooling guidance from
  the legacy HzDB package to the owned `@meta-quest/metavr` package.

- 647bd59: Allow an explicitly configured local example-asset directory through Vite's
  file-system boundary while preserving the default workspace root and denying
  unrelated external paths.
- 438f10c: Existing `physics: true` projects now run Havok in a Web Worker at a fixed 60
  Hz by default, using transferable ArrayBuffer exchanges and render
  interpolation. Add a shared main-thread mode for debugging and compatibility,
  plus debugger pause/step synchronization across both execution modes.
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

- e945946: Capture framed and referenced application screenshots through stable page
  clips, preserve bounded full-document captures across display scale factors,
  restore document scroll state, hide workspace controls from captures, reject
  oversized element refs without retry loops, and bound managed-workspace render
  settling.
- Updated dependencies [ed2a6b1]
- Updated dependencies [aee9970]
- Updated dependencies [4d4efa0]
- Updated dependencies [d0b24a1]
- Updated dependencies [faf9709]
- Updated dependencies [13a5cbe]
- Updated dependencies [438f10c]
- Updated dependencies [52c7378]
- Updated dependencies [3306963]
- Updated dependencies [e18c42a]
- Updated dependencies
- Updated dependencies [2c7b66c]
- Updated dependencies [3306963]
- Updated dependencies [3306963]
  - @iwsdk/core@1.0.0-rc.0
  - @iwsdk/scene-composition@1.0.0-rc.0

## 0.5.3

### Patch Changes

- c9bf4ae: Light scaffolded AR scenes by default, restore the workspace button that opens
  the runtime in the default browser, and return an actionable error when an
  editor command requires a scene to be open.
  - @iwsdk/core@0.5.3
  - @iwsdk/scene-composition@0.5.3

## 0.5.2

### Patch Changes

- 0b3ddc3: Improve managed editor and local launch reliability. Add an editor action to open
  the runtime in the default browser, serve generated-app test assets from the app
  origin, persist local HTTPS certificates, bootstrap fresh tarball builds, improve
  controller UI clicks, clarify XR player framing, and tolerate slower isolated
  render previews.
  - @iwsdk/core@0.5.2
  - @iwsdk/scene-composition@0.5.2

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
- Updated dependencies [c463f17]
- Updated dependencies [91047c5]
  - @iwsdk/core@0.5.0
  - @iwsdk/scene-composition@0.5.0

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

- Use `waitUntil: 'commit'` for managed-browser navigation, reducing startup flake before the browser runtime bridge becomes ready.
- Tighten managed-browser session state updates for relaunch/readiness handling.

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
