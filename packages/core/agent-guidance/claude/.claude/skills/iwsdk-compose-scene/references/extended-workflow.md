# IWSDK Compose Scene: Extended Workflow

Read this reference only after the top-level skill has ruled out the Fast Path.

Use the focused references as needed:

- [scene-format.md](scene-format.md) when the existing scene does not demonstrate a
  required construct, or when schema diagnostics need investigation;
- [text-intake.md](text-intake.md) for scene-layout evidence from text;
- [image-intake.md](image-intake.md) for scene-layout and camera evidence from image
  or hybrid requests; route model-local reconstruction separately;
- [scene-composition.md](scene-composition.md) for modules, scene-level repetition,
  lighting, cameras, and cost control;
- [scene-review.md](scene-review.md) before final review.


Enter this workflow only when the routing criteria above exclude the Fast Path.

### 1. Specify

Turn the request into a compact implementation brief:

- required and optional features;
- source evidence regions for image input;
- silhouette, proportions, parts, negative space, contacts, and material response;
- hero and diagnostic views;
- measurable acceptance criteria;
- assumptions, uncertainty, and fidelity ceiling.

A single image proves visible composition, not hidden geometry. Do not silently invent
occluded detail or lower requested fidelity.

### 2. Inventory Assets And Modules

Inspect the existing scene, `src/assets.ts`, and relevant asset modules first. Call
`scene_get_capabilities` only when the task introduces a component, content kind,
pattern, import, or schema feature that the existing project and focused reference
search do not already demonstrate. Do not load the full schema for routine placement.

Classify each requested visible element as an existing manifest asset, a new model,
a UIKitML panel, or a scene-level assembly. Invoke `iwsdk-build-model` for each new
or materially changed 3D model—including support, architecture, and set dressing—and
`iwsdk-ui` for UIKitML. Continue here only once every visible asset has a stable
manifest id, object-local envelope, and relevant attachment anchors. From this point
until a model-local defect is discovered, do not create or edit asset TypeScript.

For initial construction, plan independent semantic groups as standalone scratch
scene modules. Give each module a local origin, size envelope, attachment points,
required views, and asset IDs. Asset and component IDs are application-global;
imported node and prefab IDs are namespaced. Imports are an authoring-only assembly
mechanism, never a runtime or editable-project format.

### 3. Compose

Author scene JSON in dependency order:

1. support/stage and representative lighting;
2. large placed assets and cross-asset scale;
3. identity-critical spatial relationships and support contacts;
4. repeated placed assets through prefabs or patterns;
5. hero camera and final environment.

Use meters, stable descriptive IDs, deterministic ordering, and explicit transforms.
Groups supply hierarchy, never visible mass. Use `castShadow` and `receiveShadow`
only when needed. Do not rebuild missing model detail from scene primitives or JSON.

### 4. Validate And Materialize

With the managed editor command-ready, call `scene_render_file` on every changed
scratch module, then the composition root. It resolves imports for authoring preview,
validates schema and manifest references, lowers the scene, and returns a PNG plus
diagnostics without changing the active document. Fix failures in the owning asset or
scratch file.

Keep agent-loop renders at 640×640 or smaller and prefer the MCP call, which persists
the image and returns `screenshotPath`. Read that file only when visual inspection is
needed. Generate a larger delivery image only after the final camera is chosen, and
do not feed that duplicate image back into the model context.

After the composition root passes, run `scene_flatten_file` / `iwsdk scene flatten`
once to materialize an import-free final scene. The command preserves import wrapper
groups, validates the output, and refuses to write if its runtime hash differs from
the composed source. This is a one-way publication boundary: the flat file becomes
the sole source of truth, and later scratch-module changes must not be re-flattened
over human edits.

Call `scene_open` only on the flattened file for live collaboration. Import-bearing
files remain renderable composition previews but are never opened as editable scenes
and never load in the application runtime.

Use `scene_get_state` for selection, hashes, diagnostics, dirty/conflict state, runtime
readiness, and render statistics. Use camera, screenshot, selection, and preview
visibility tools only when their live-editor context is useful.

### 5. Review And Refine

Review in three passes:

1. **Layout**: hierarchy, scale, support contacts, and arrangement.
2. **Asset fit**: silhouette and proportions in context, occlusion, and cross-asset
   contacts. If the defect remains when the asset is viewed by itself, route it to
   `iwsdk-build-model` instead of compensating with scene transforms.
3. **Final**: material response, color, lighting, environment, and hero framing.

Keep review orchestration and evidence outside the editor. The editor supplies
authoritative screenshots, hashes, camera state, diagnostics, and render measurements.
Derive comparisons, defect lists, lineage, and stop decisions in ordinary task files.

Fix the highest-impact scene defect in its owning scene module. Route model-local
geometry or material defects to `iwsdk-build-model`, then rerender that asset and the
scene. Default to two focused correction rounds. Stop earlier on a
repeated defect, oscillation, plateau, missing input/asset, or representation ceiling.

### 6. Finish

Finish only when:

- every scratch module and the composition root validates and renders;
- the final editable scene is flattened and contains no `imports`;
- the active editor state is clean and conflict-free;
- every new or changed model has passed `iwsdk-build-model` isolated review;
- required views are nonblank and correctly framed;
- required features pass measurable and visual checks;
- manifest asset IDs resolve in both editor and application runtime;
- the application build and selected scene load without blocking errors.

If a required gate is unavailable, finish with an explicit blocked or
accepted-with-gaps result. Passing a local schema check, production build, or custom
diagnostic image does not substitute for authoritative editor renders and state.

## Modular Composition

```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "imports": [
    {
      "id": "reading-nook",
      "src": "./modules/reading-nook.iwsdk.scene.json",
      "transform": { "position": [1.8, 0, -0.6] }
    }
  ],
  "resources": {},
  "nodes": []
}
```

Each scratch module must be valid by itself. Imports resolve recursively in
declaration order. The import entry becomes a transform group. The composition root
owns global components, environment, metadata, and authoring settings. Cycles, unsafe
IDs, missing files, duplicate namespaced IDs, and invalid modules fail composition.

For parallel initial construction, assign one scratch module file per worker. Never
let two workers edit one file. Render modules independently, import only passing
modules, correct cross-module scale, contact, occlusion, lighting, and framing at the
composition root, then flatten exactly once. Parallel module iteration ends at that
boundary; continue all later edits in the flat file.

## Regeneration And Provenance

Preserve stable IDs when revising the flat file. Never overwrite unrelated
human-authored files or re-flatten over editor changes. Record the skill/runtime
versions, input hashes, composition/final/module paths, capability hash,
source/composed/runtime hashes, assumptions, and fidelity ceiling in authoring
metadata or adjacent task evidence.
