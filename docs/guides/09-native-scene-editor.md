---
outline: [2, 4]
---

# Chapter 9: Native Scene Editor

IWSDK loads authored scene JSON directly. Scene files are the authoring source; the
managed editor is the live visual surface for selection, transforms, hierarchy,
components, screenshots, and human fine adjustment.

## Runtime Loading

Keep scene files under `public/scenes/` and select the root in
`iwsdk.config.json`. The managed editor reads and writes only files whose real path,
after resolving symbolic links, stays under `public/scenes/` inside the project:

```json
{
  "version": "iwsdk.project.v1",
  "scene": "./public/scenes/main.iwsdk.scene.json",
  "assets": { "module": "./src/assets" },
  "world": {
    "xr": { "mode": "vr" },
    "features": { "grabbing": true, "locomotion": true }
  }
}
```

Application code consumes the same authority:

```ts
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

const world = await World.create(
  document.getElementById('scene')!,
  projectOptions,
);
```

Runtime code still owns systems, interaction, networking, procedural geometry, and
materials. Use scene JSON for prefab resources, asset-backed hierarchy, transforms,
lights, environment, and typed components.

## Scene Format

Use `iwsdk.scene.v1` only:

```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "resources": {},
  "nodes": [
    {
      "id": "table",
      "content": {
        "type": "asset",
        "asset": "table",
        "castShadow": true,
        "receiveShadow": true
      },
      "transform": { "position": [0, 0.76, 0] }
    }
  ]
}
```

Here `table` is an application-global ID registered by the `defineAssets()` module
selected in `iwsdk.config.json`. Scene JSON does not declare asset URLs, procedural
geometry, or materials; create those in the asset module and reference their IDs with
`content.type: "asset"`. The v1 `resources` object contains only reusable scene
prefabs. Renderable infrastructure may set `framingRole: "support"`; it remains
visible but does not expand content-only automatic framing.

## Modular Composition

Roots can compose standalone module files:

```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "imports": [
    {
      "id": "reading-nook",
      "src": "./modules/reading-nook.iwsdk.scene.json",
      "transform": { "position": [2, 0, -1] }
    }
  ],
  "resources": {},
  "nodes": []
}
```

Each module is a valid standalone v1 document. Resolution is recursive and ordered.
Imported node and prefab IDs receive `<import-id>/<local-id>` namespaces. Asset IDs
remain application-global and resolve through the project's asset manifest. The
import entry becomes a transform wrapper, and the root owns environment, metadata,
and authoring globals.

This layout lets independent agents author distinct module files in parallel. Render
each module before importing it, then validate and render the root to catch scale,
contact, lighting, and camera issues across modules.

## Managed Editor

The managed Playwright browser opens at the clean origin root and defaults to Runtime.
Switch between Runtime and Editor with the two visible controls. External browsers
receive the application only; the managed browser owns the editor wrapper.

The editor watches the active import-free document:

- valid file changes replace the preview atomically;
- invalid changes keep the previous valid render and show diagnostics;
- unsaved human changes produce a conflict instead of being overwritten;
- runtime reload is deferred while Editor is visible and applied when Runtime is
  selected.

Validate import-bearing roots and modules with `scene_render_file`, then use
`scene_flatten_file` once and continue editing the flat output. Re-flatten only when
intentionally regenerating it because overwrite replaces later flat-file edits.
`scene_open` never invents or creates a missing document.

## Agent Tools

The public editor and file-authoring scene MCP surface is:

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

`scene_render_file` validates, resolves imports, materializes, and renders a file
without changing the active editor. Valid input returns dependency information,
source/composed/runtime hashes, camera and render metadata, `screenshotSha256`, and
a local `screenshotPath`; image bytes are not embedded in the response. Invalid input
returns diagnostics and no screenshot.

Imports are an authoring-only scratch mechanism. The application runtime rejects
them, and the editable editor requires an import-free document. After an imported
composition renders correctly, call `scene_flatten_file` once. It writes the resolved
document only after proving that its runtime hash matches the composed source; the
flat output then becomes the sole source of truth.

`scene_get_state` consolidates the active file, selection, hashes, validation,
dirty/conflict status, runtime readiness, runtime errors, and render statistics.
Hierarchy and resources are already present in the files and are not duplicated in a
separate observation API.

Document mutation tools are not exposed. Agents edit files directly; humans use the
editor controls.

Equivalent CLI examples:

```bash
npx @iwsdk/cli scene render-file \
  --input-json '{"path":"public/scenes/main.iwsdk.scene.json","view":"quarter"}' \
  --output-file artifacts/main.png
npx @iwsdk/cli scene flatten \
  --input-json '{"path":"public/scenes/main.composition.iwsdk.scene.json","outputPath":"public/scenes/main.iwsdk.scene.json"}' --raw
npx @iwsdk/cli scene open \
  --input-json '{"path":"public/scenes/main.iwsdk.scene.json"}' --raw
npx @iwsdk/cli scene state --raw
```

## Visual Review

Use exact saved or canonical camera views. `captureMode: "render"` removes editor
overlays; `captureMode: "editor"` is for UI diagnostics. Preview visibility can solo,
ghost, hide, show, or lock objects without changing document hashes.
Canonical review views include `top`, `front`, `back`, `left`, `right`, `quarter`,
and deterministic `orbit` steps.

Keep review orchestration and evidence in ordinary task files. The editor supplies
authoritative screenshots, hashes, camera state, diagnostics, region measurements,
and render statistics. Verify the live application runtime separately before
shipping; there is no editor review or publish gate.
