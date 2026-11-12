---
paths:
  - "public/scenes/**"
---

# Scene JSON — things that fail silently

Format reference lives in
`.claude/skills/iwsdk-compose-scene/references/scene-format.md`: the document
boundary, content kinds, prefabs, patterns, light fields, authoring views. Read
it for imports, prefabs, patterns, or a schema detail not covered by active
guidance. For ordinary flat node, component, and authored-view edits, this rule,
the existing scene, and the active specialist are sufficient. This file is only
the short list of behaviours that produce no error when you get them wrong.

Only `iwsdk.scene.v1` exists, units are always meters, and structural objects are
closed — an unknown field fails validation.

## Imports stop at the authoring boundary

Authoring tools can validate and render a root with `imports`, so modular scratch
scenes remain useful for composition. The editable scene session and application
runtime deliberately reject imports. Run `scene_flatten_file` or
`npx @iwsdk/cli scene flatten` once, verify the source and output runtime hashes match,
then make the flat output the sole editable source of truth. Never re-flatten over
later human editor changes.

## The player materialises at the scene origin

`0,0,0` unless the document authors `player.transform`. Nothing warns you. A
scene can pass every authored camera view and still spawn the player inside the
geometry, because review cameras are not the viewpoint that ships. Keep that
volume clear or place the player deliberately, and author a diagnostic view at
player eye height to prove it.

## `visibleNodeIds` is the silent-failure detector

`renderStats.visibleNodeIds` lists what actually rendered. A node missing from it
did not appear — even when the image looks plausible and `valid` is `true`. Check
it against what you expect rather than trusting the picture. Single-sided
surfaces facing away from the camera are the usual cause, and they report nothing.
`ContactShadow` and `ShadowCatcher` meshes take no rays, so a node whose only
content is one of them is never listed; check the object it grounds instead.

## Component keys come in two forms

Root-level components use the namespaced form
(`com.iwsdk.components.DomeGradient`). Node-level components accept the bare name
(`RayInteractable`, `LocomotionEnvironment`). **The editor writes the namespaced
form on nodes**, so a file touched by both hands contains both. Match whatever the
node already uses instead of normalising.

`LevelRoot`, `LevelTag` and `Transform` are runtime-owned; never author them.

## Browser hero views and XR spawn framing are distinct

Outside immersive XR, the hero authoring view supersedes `world.render.camera`
from `iwsdk.config.json` once the level initialises. While XR is presenting,
the tracked player rig owns the camera and the hero view is intentionally not
applied. Use the hero view for editor/browser framing, and validate important
content from the authored `player.transform` spawn (or the default standing
view near `[0, 1.6, 0]`) before accepting XR framing.

## Validation

`scene_render_file` validates, composes, lowers and renders without touching the
open document. A result is usable only when `valid: true` **and** a PNG comes
back. Render each changed module before the root.

For composing a scene rather than editing one, use the `iwsdk-compose-scene`
skill — it owns the intake, review and stop-rule procedure this file does not.
