# @iwsdk/scene-composition

## 1.1.0

### Patch Changes

- 7a92e16: New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
- 0251c03: Add `ContactShadow` and `ShadowCatcher`, node components that ground content without hand-built shadow meshes. `ContactShadow` draws a soft round blob under its node (`size`, `opacity`, `color`, `height`); `ShadowCatcher` is an invisible floor that shows only the shadows it receives, for AR passthrough (`size`, `opacity`, `color`; it needs `environment.shadows` and a light with `castShadow`). The new `GroundShadowSystem` builds their meshes, which move and scale with the node, never cast shadows or take ray, grab or touch pointer hits, and stay visible in AR. Meshes marked runtime-only, as both are, are left out of auto-detected physics shapes, locomotion collision, gaze target bounds and `entity.dispose()`. The editor viewport renders both, and its selection and framing bounds, geometry lens and preview ghosting leave them out, as do the framing bounds and asset mesh counts in `scene_get_render_stats`, the emulator's hand targets and the grab setup warning. Render stats count them in `sceneEnvironment.groundShadows`, and scene validation rejects a `size` that is not positive. Scenes that use the components need @iwsdk/core 1.1.0. The generated agent guidance points to them instead of canvas blob cards and `ShadowMaterial` planes.

## 1.1.0-rc.2

### Patch Changes

- 7a92e16: New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
- 0251c03: Add `ContactShadow` and `ShadowCatcher`, node components that ground content without hand-built shadow meshes. `ContactShadow` draws a soft round blob under its node (`size`, `opacity`, `color`, `height`); `ShadowCatcher` is an invisible floor that shows only the shadows it receives, for AR passthrough (`size`, `opacity`, `color`; it needs `environment.shadows` and a light with `castShadow`). The new `GroundShadowSystem` builds their meshes, which move and scale with the node, never cast shadows or take ray, grab or touch pointer hits, and stay visible in AR. Meshes marked runtime-only, as both are, are left out of auto-detected physics shapes, locomotion collision, gaze target bounds and `entity.dispose()`. The editor viewport renders both, and its selection and framing bounds, geometry lens and preview ghosting leave them out, as do the framing bounds and asset mesh counts in `scene_get_render_stats`, the emulator's hand targets and the grab setup warning. Render stats count them in `sceneEnvironment.groundShadows`, and scene validation rejects a `size` that is not positive. Scenes that use the components need @iwsdk/core 1.1.0. The generated agent guidance points to them instead of canvas blob cards and `ShadowMaterial` planes.

## 1.1.0-rc.1

## 1.1.0-rc.0

## 1.0.1

## 1.0.0

### Major Changes

- a79f1ff: Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Minor Changes

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

## 1.0.0-rc.2

## 1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Minor Changes

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

## 0.5.3

## 0.5.2

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
