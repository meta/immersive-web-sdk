---
name: iwsdk-compose-scene
description: Compose and review IWSDK scenes from existing manifest assets using scene JSON, placement, scale, contacts, prefabs, patterns, lighting, environment, cameras, and final framing. Does not author geometry or materials; create or repair an individual 3D asset with iwsdk-build-model.
---

# IWSDK Compose Scene

Arrange existing IWSDK assets into a coherent scene. Scene JSON owns composition;
asset modules own geometry and materials; the managed editor provides visual
feedback and human transform/component adjustment.

If the request creates or materially changes one model, invoke `iwsdk-build-model`
for that asset first. If scene review reveals a defect inside one asset, route the
repair back to `iwsdk-build-model`. Keep placement, cross-asset contact, lighting,
environment, and cameras here.

## Route Before Loading References

Choose exactly one route before opening any reference:

- Use the **Fast Path** when the model handoff already supplies manifest ids, bounds,
  and contact planes and the task needs only asset placement, built-in lighting or
  environment, player spawn, and named views. Follow only that section and stop when
  its finish gates pass.
- Use the **Extended Workflow** for imports, prefabs, patterns, unfamiliar components,
  schema errors, image reconstruction, missing asset contracts, or genuinely ambiguous
  composition evidence.

After selecting the Extended Workflow, read
[extended-workflow.md](references/extended-workflow.md). Do not load it on the Fast
Path; it routes the additional format, intake, composition, and review references.

## Bounded Opening

Read the applicable scoped scene/assets instructions and inspect
`iwsdk.config.json`, the configured asset manifest, relevant model handoffs, and the
active scene in one bounded pass. Reach the first scene edit within roughly eight
tool calls. Do not begin with dependency-tree searches, generated declarations,
repeated capability queries, or marketplace browsing.

For the routine Fast Path, the scoped rules plus the model handoff are sufficient.
Load the long scene-format material only for imports, prefabs, patterns, or after a
concrete schema rejection.

## Fixed Boundaries

- Do not author geometry or materials in this skill. An asset-internal defect belongs
  to `iwsdk-build-model`; scene-relative placement and lighting defects stay here.
- A display stand, architectural shell, terrain piece, or set-dressing object is still
  a model. If one is missing or must materially change, pause composition and finish it
  with `iwsdk-build-model`; do not create or edit its asset module here.
- Repetition inside one manifest asset belongs to `iwsdk-build-model`; repetition of
  placed assets belongs here through scene prefabs and patterns.
- UIKitML panels belong to `iwsdk-ui`, not either 3D skill.
- Use only `iwsdk.scene.v1`. There is no compatibility schema.
- Scene files are the composition source of truth. Create and edit them with normal
  filesystem tools under `public/scenes/`.
- Scene JSON has one renderable content kind: `asset`. It does not define models,
  primitive geometry, material resources, or material overrides.
- The default export of the configured application asset manifest is the asset source
  of truth. It may contain URL-backed glTF and UIKitML entries plus parentless
  `Object3D` prototypes with arbitrary Three.js geometry and materials.
- The application runtime and editor import the same manifest module independently.
  Never depend on shared object identity, iframe messaging, DOM state, or a live
  runtime world when defining assets.
- Humans use the editor for selection, hierarchy, transforms, components, root
  lighting, and preview visibility. They do not edit geometry or materials there.
- Agents may edit asset TypeScript and scene JSON, then use the editor to validate and
  render the result.

## Small Stateful Interactions

When a composed scene needs a small stateful interaction, keep it in one project
system with project components. Use `createComponent` plus `defineComponents`, then
`createSystem` queries whose `entities` values are Sets. React to ray activation with
a query qualified by `Pressed`; read or move scene-authored entities through each
entity's `object3D`.

Use `"OneHandGrabbable": {}` for proximity grab and `"RayInteractable": {}` for ray
activation. `Grabbed` is a transient tag managed by `GrabSystem`; use query
qualify/disqualify transitions for lifecycle work and `GrabSystem.forceRelease()` for
reset. Import these APIs and Three.js runtime classes from `@iwsdk/core`; do not inspect
package source or generated declarations to rediscover established contracts.

Route substantial UI behavior to `iwsdk-ui`, unfamiliar grab or ray behavior to the
matching interaction skill, and runtime failures to `iwsdk-debug`.

The public scene MCP surface is intentionally small:

```text
scene_open
scene_render_file
scene_flatten_file
scene_get_state
scene_get_capabilities
scene_screenshot
scene_select
scene_set_camera
scene_set_preview_visibility
scene_measure_image_regions
```

Document creation and mutation happen through direct file edits. Do not look for MCP
create/add/update/remove/patch/save/compose/review/publish tools.

When MCP is unavailable, use the CLI equivalents:

```bash
npx @iwsdk/cli dev status
npx @iwsdk/cli dev up
npx @iwsdk/cli scene capabilities --raw
npx @iwsdk/cli scene render-file \
  --input-json '{"path":"public/scenes/room.iwsdk.scene.json","viewId":"hero"}' \
  --output-file artifacts/room.png
npx @iwsdk/cli scene flatten \
  --input-json '{"path":"public/scenes/room.composition.iwsdk.scene.json","outputPath":"public/scenes/room.iwsdk.scene.json"}' --raw
npx @iwsdk/cli scene open \
  --input-json '{"path":"public/scenes/room.iwsdk.scene.json"}' --raw
npx @iwsdk/cli scene state --raw
```

`iwsdk dev up` starts the server in the background and launches the configured
managed editor browser. It can return while that browser is still starting; use
`iwsdk runtime wait` or inspect `iwsdk runtime status` before browser-backed
commands. Do not edit `vite.config.ts` to change browser mode as an ad hoc
startup workaround.

`scene_render_file` renders a file without replacing the editor's active document,
but it still uses the managed editor browser for manifest evaluation and WebGL.
MCP screenshot tools persist their PNG and return `screenshotPath`; read the file only
when the requested visual check requires it.
If readiness does not arrive, inspect `iwsdk runtime status` and `iwsdk dev logs
--tail 100`. Use `iwsdk runtime recover` only when the diagnostics indicate a
recoverable launch failure. Do not invent a custom CPU or Playwright renderer
and present it as authoritative editor evidence. Preserve the structured
failure, continue type/schema/build checks that remain meaningful, and report
the visual-verification gate as blocked.

Camera parameters are intentionally distinct: `view` accepts only the built-in
presets (`current`, `top`, `front`, `back`, `left`, `right`, `quarter`, `orbit`),
while `viewId` selects an exact camera declared in `authoring.views`. Outside
immersive XR, a loaded level's saved hero view owns runtime framing and
supersedes the initial `World.create({ render: { camera } })` pose. In XR, the
tracked player rig owns the camera, so the player-spawn view is a separate
required framing check.

## Fast Path

Use this path when the handoff already provides manifest ids, envelopes, and contact
planes and the scene needs only placed assets, built-in lights/environment, player
spawn, and named authoring views:

1. inspect the existing scene once;
2. write one import-free scene JSON with all placements, lighting, and only the
   requested authoring views;
3. render the first hero at 512×512 or smaller;
4. make at most one coherent visual correction;
5. verify that correction at 384×384 or smaller; do not raise the resolution;
6. open the file, confirm clean state, and run the application build;
7. stop. Do not continue into the Extended Workflow after these gates pass.

Keep the ordinary starting player pose unless the request explicitly requires a
different spawn. In the stock scaffold the viewer is near `[0, 1.6, 0]` and looks
down negative Z, so primary no-locomotion content normally belongs around
`z = -0.5` to `-2.5`; positive Z is behind the player. After any diagnostic camera
or headset movement, restore that starting pose and verify one live frame there.

The default Fast Path budget is at most three scene renders, two compact image reads,
and one correction round. Expand it only to diagnose a specific failed criterion.

Agent-loop images are inspection evidence, not delivery renders. The evaluator or
delivery workflow can capture the unchanged scene at higher resolution after the
agent stops; do not feed that larger duplicate image back into the model context.

In Claude Code, `Write` echoes the complete document into the transcript. Use it only
when the new scene is roughly 80 lines or 8 KB or smaller. For a longer initial scene,
use single-quoted Bash heredocs (`<<'EOF'`) capped at roughly 120 lines or 12 KB per
tool call: create with `>` and append in later calls with `>>`. End each call at its
heredoc delimiter rather than adding command substitutions or validation. For
corrections above roughly 120 lines, do not use `Edit`; use one narrowly scoped
scripted replacement that asserts exactly one match, writes once, and prints only a
short confirmation. Do not put JSON or TypeScript template literals in `node -e`.

A player transform is not an authoring view. Do not add an extra player-spawn or
inspection view unless the task requests it. Every authored view must declare a valid
`role`; the common Fast Path normally needs only the `hero` view shown below.

Use this complete minimal shape instead of looking up the common schema. Duplicate
asset and light nodes as needed, then choose positions from the handed-off bounds:

```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "components": {
    "com.iwsdk.components.DomeGradient": {
      "sky": [0.02, 0.03, 0.05, 1],
      "equator": [0.05, 0.06, 0.08, 1],
      "ground": [0.01, 0.01, 0.015, 1],
      "intensity": 1
    },
    "com.iwsdk.components.IBLGradient": {
      "sky": [0.25, 0.3, 0.4, 1],
      "equator": [0.12, 0.14, 0.18, 1],
      "ground": [0.03, 0.035, 0.04, 1],
      "intensity": 1
    }
  },
  "resources": {},
  "authoring": {
    "views": [{
      "id": "hero", "role": "hero", "projection": "perspective",
      "position": [4, 3, 4], "target": [0, 1, -1.5], "fov": 42
    }]
  },
  "nodes": [
    {
      "id": "Hero", "content": {
        "type": "asset", "asset": "HeroModel",
        "castShadow": true, "receiveShadow": true
      },
      "transform": {"position": [0, 0, -1.5]}
    },
    {
      "id": "KeyLight", "transform": {
        "position": [-4, 6, 2], "rotationDeg": [-45, -35, 0]
      },
      "components": {"com.iwsdk.components.DirectionalLight": {
        "color": [1, 0.92, 0.8, 1], "intensity": 3, "castShadow": true
      }}
    },
    {
      "id": "Fill", "components": {"com.iwsdk.components.AmbientLight": {
        "color": [0.45, 0.55, 0.8, 1], "intensity": 0.45
      }}
    }
  ]
}
```

Directional lights emit along local `-Z`. Start from the shown transform or another
simple intentional angle and refine it from the render; do not write a look-at solver.
The common light payloads are `AmbientLight: {color, intensity}`,
`HemisphereLight: {skyColor, groundColor, intensity}` (there is no `color` field),
and `PointLight: {color, intensity, distance, decay, castShadow}`. A floor that should
have no visible edge gets `"com.iwsdk.components.DomeFade": {"start": 4, "end": 10}`
on the floor node itself: it fades that node's meshes into the root `DomeGradient`
between those horizontal distances from the node origin, and does nothing without a
`DomeGradient`. Do not paste sky GLSL into an `onBeforeCompile`. A clean state after
the correction is the finish gate; do not query capabilities again merely to confirm
these established fields.

Ground props with node components, not blob or catcher assets. Add
`"com.iwsdk.components.ContactShadow": {"size": [0.9, 0.9]}` to each node that stands
on the floor (origin at floor contact, size a little wider than the footprint). For
AR, add one component-only node with `ShadowCatcher: {size, opacity}` at floor height;
it shows the shadows of `castShadow` content only when `environment.shadows` is true
and a light has `castShadow`. `ContactShadow` and `ShadowCatcher` are established
schema too. For a complete look to copy (the starter's tilted clay-studio sky
with a fading floor, a default sky, or AR passthrough grounding), use
[environment-recipes.md](references/environment-recipes.md).

For this common path, do not read the references or call
`scene_get_capabilities`: `DomeGradient`, `IBLGradient`, `DomeFade`, `AmbientLight`,
`HemisphereLight`, `DirectionalLight`, `PointLight`, asset nodes,
`player.transform`, and perspective/orthographic `authoring.views` are established
schema. Do not write a separate projection or light-aim solver. Choose the initial
camera from the handed-off envelopes and refine it from the authoritative render.
Use the longer workflow and references only for imports, prefabs, patterns, unfamiliar
components, schema errors, image reconstruction, or ambiguous composition evidence.

## Extended Workflow

When the Fast Path does not apply, read and follow
[extended-workflow.md](references/extended-workflow.md). Do not load that reference
for a routine scene assembled from known manifest assets.
