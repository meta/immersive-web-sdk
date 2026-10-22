---
outline: [2, 4]
---

# Workflows

Practical agent workflows for the canonical IWSDK CLI/MCP surface.

## Runtime First

```bash
npx @iwsdk/cli dev status
npx @iwsdk/cli dev up
npx @iwsdk/cli mcp inspect --tool scene_render_file
```

The workspace-local CLI is the stable front door. MCP adapters point to
`iwsdk mcp stdio`; they do not bind themselves to ephemeral dev-server ports.

Common equivalents:

```text
xr_get_session_status  <-> iwsdk xr status
xr_accept_session      <-> iwsdk xr enter
browser_screenshot     <-> iwsdk browser screenshot
browser_snapshot       <-> iwsdk browser snapshot
browser_interact       <-> iwsdk browser interact
browser_profile        <-> iwsdk browser profile
browser_get_console_logs <-> iwsdk browser logs
browser_reload_page    <-> iwsdk browser reload
browser_set_muted      <-> iwsdk browser set-muted --muted <true|false>
scene_render_file      <-> iwsdk scene render-file
scene_flatten_file     <-> iwsdk scene flatten
scene_get_state        <-> iwsdk scene state
ecs_diff               <-> iwsdk ecs diff
```

## File-First Scene Authoring

```text
1. scene_get_capabilities
2. Create or edit public/scenes/*.iwsdk.scene.json directly
3. scene_render_file on every changed module
4. scene_render_file on the composed root
5. scene_flatten_file once when the root uses imports
6. Treat the flattened output as the canonical editable scene
7. scene_open on that import-free scene for live collaboration
8. scene_get_state
9. scene_set_camera + scene_screenshot for exact review views
10. Verify the application runtime and console
```

`scene_render_file` validates, resolves imports, materializes, and renders. Invalid
files return diagnostics and no PNG. Opening is not required for validation.

The editor watches the opened import-free scene. Valid changes replace the preview
atomically; invalid changes preserve the last valid render; unsaved human changes
produce a conflict. After flattening, continue authoring that file; the import-bearing
root and modules are scratch inputs. Re-flatten only when intentionally regenerating
the output because overwrite replaces subsequent flat-file edits.

## Parallel Modules

Use one file per independently owned semantic group:

```text
public/scenes/room.iwsdk.scene.json
public/scenes/modules/architecture.iwsdk.scene.json
public/scenes/modules/reading-nook.iwsdk.scene.json
public/scenes/modules/decor.iwsdk.scene.json
```

Give each worker a local origin, size envelope, attachment points, palette, and
required views. Workers must not share files. Render each module independently, then
compose them through root `imports` and fix cross-module scale/contact/lighting in the
root or owning module.

## Screenshot-Driven Development

For application code:

```text
1. npx @iwsdk/cli dev status
2. Modify code
3. browser_reload_page
4. browser_get_console_logs
5. browser_snapshot
6. browser_interact with snapshot refs or canvas-relative coordinates
7. browser_screenshot
8. Compare the visible and semantic result against the requirement
```

The seven browser MCP tools always target the current application automatically. They
do not accept a runtime/editor/workspace selector and do not provide arbitrary common
navigation. Snapshot refs make DOM interactions compact and rerender-aware; capture a
new snapshot when a ref becomes stale after an application reload. For 2D canvas
input, use a snapshot canvas ref with coordinates relative to that canvas.

When performance is part of the requirement, bracket the interaction with
`browser_profile(action="start")` and `browser_profile(action="stop")`. Use
`interaction` or `rendering` for summarized host-browser diagnostics, and `trace` when
you need a Playwright trace artifact. These profiles are explicitly uncalibrated and
must not be presented as target-device measurements.

For authored scenes use `scene_screenshot`, which includes exact camera, active file,
hashes, validation diagnostics, and render statistics. Use `captureMode: "render"`
for scene evidence and `captureMode: "editor"` for UI diagnostics.

## Advanced Playwright Runner

Use the runner only when the bounded browser tools cannot express the task, such as a
specialized Playwright API or direct CDP query. Automation is disabled by default.
Enable it when starting a new session, or restart an existing session with explicit
permission:

```bash
# New session
npx @iwsdk/cli dev up --allow-browser-automation

# Existing session
npx @iwsdk/cli dev restart --allow-browser-automation
```

Create a module inside the IWSDK workspace, for example
`scripts/browser-diagnostic.mjs`:

```javascript
export default async function ({ frame, cdp }) {
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');

  return {
    title: await frame.title(),
    metricCount: metrics.length,
  };
}
```

Run it against the same managed application session:

```bash
npx @iwsdk/cli browser run scripts/browser-diagnostic.mjs
```

The module may export a default function or named `run` function. It receives the
connected Playwright `browser`, `context`, `page`, and resolved application `frame`,
plus a page CDP session, `workspaceRoot`, and an abort `signal`. Its return value must
be JSON-serializable and no larger than 1 MiB. `--timeout` covers module loading and
execution; scripts should observe the signal to stop their own asynchronous work after
a timeout. The runner rejects scripts outside the workspace and blocks common attempts
to close IWSDK-owned browser resources.

This is a trusted-code escape hatch, not another constrained MCP action. Enabling it
grants browser-level authority to any local process that can reach the loopback CDP
endpoint for that dev session, including page contents, storage, cookies, network
controls, and arbitrary script execution in the managed page. Review the script before
running it, enable the endpoint only in a trusted local environment, disable the opt-in
for ordinary sessions, and prefer the seven bounded browser tools for routine
inspection, interaction, screenshots, diagnostics, reloads, and profiling.

## Selected-Object Collaboration

When a user asks about the selected object:

```text
1. scene_get_state -> read selection and active file
2. Read the owning node/module from disk
3. Edit that file directly
4. scene_render_file on the owner and root
5. scene_get_state -> verify clean hashes/diagnostics
```

Use `scene_select` only to establish or synchronize live editor context. Selection is
not document mutation.

## Visual Isolation

```text
1. scene_set_preview_visibility -> solo or context mode
2. scene_set_camera -> exact required view
3. scene_screenshot
4. scene_set_preview_visibility -> restore
```

Preview visibility never changes scene hashes. Keep required context objects visible
when judging support contact, relative scale, occlusion, or material response.

## Image Reconstruction

```text
1. Record source regions and camera assumptions
2. Author coarse stage, light, and hero camera
3. Build and render identity-critical modules one at a time
4. Compose the root
5. Capture source-aligned hero and alternate views
6. scene_measure_image_regions only for meaningful aligned regions
7. Fix the largest measured or visual defect
```

Compare source and render at the same aspect ratio. Treat class recognition as
insufficient evidence: inspect silhouette, proportions, parts, negative space,
contacts, and material response.

## Runtime UIKitML Inspection

UIKitML controls are live UIKit components inside a panel entity, not separate ECS
entities or browser DOM elements:

```text
1. ecs_find_entities(namePattern="panel")
2. ui_inspect(entityIndex=<panel index>)
3. ui_inspect(entityIndex=<panel index>, selector="#save-button")
```

The unfiltered call lists stable element IDs. The focused call returns current text,
visibility, interaction state, layout, and selected computed properties. Read the
UIKitML source when authoring; use `ui_inspect` when validating code-driven runtime
changes.

## Runtime Entity Debugging

Scene hierarchy is authored in files. For live behavioral state use ECS tools:

```text
1. ecs_find_entities
2. ecs_query_entity
3. ecs_pause
4. ecs_snapshot(label="before")
5. Trigger an XR action or ecs_step
6. ecs_snapshot(label="after")
7. ecs_diff(from="before", to="after")
8. ecs_resume
```

Use `ecs_list_components` before reading or writing component fields, and
`ecs_list_systems` before toggling a system.

## XR Interaction

```text
1. xr_get_session_status
2. xr_accept_session when needed
3. xr_set_input_mode
4. xr_set_connected
5. xr_set_transform or xr_animate_to
6. xr_select or xr_set_select_value
7. browser_screenshot + ECS observation
```

Do not use XR availability as a dev-server or editor-readiness signal.

## Final Review

Keep evidence outside the editor:

```text
1. Record source/composed/runtime/capability hashes
2. Capture layout, geometry, and final views
3. Store measurements and concrete visual observations
4. Verify editor state is clean and conflict-free
5. Verify the live application loads the expected runtime hash
6. Run the application build
```

The editor supplies raw observations; review lineage, defect prioritization, stopping,
and release decisions are ordinary task artifacts rather than MCP workflow tools.
