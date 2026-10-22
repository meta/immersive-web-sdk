# MCP Tools

IWSDK exposes browser, WebXR, scene-observation, and ECS tools through the managed
runtime. Tool schemas are canonical; inspect the installed contract rather than
guessing arguments:

```bash
npx @iwsdk/cli mcp inspect --tool scene_render_file
npx @iwsdk/cli scene render-file --help
```

## Scene Authoring Model

Scene JSON files are the authoring API. Agents create and edit
`public/scenes/*.iwsdk.scene.json` with normal filesystem tools. Use
`scene_render_file` to validate imported roots and `scene_flatten_file` to
materialize them. The managed editor watches the single opened import-free
document, validates changes, and swaps valid documents atomically. Invalid files
keep the previous valid render and expose diagnostics. Unsaved human changes
cause an explicit conflict instead of being overwritten.

The public authoring surface keeps scene observation separate from isolated asset
inspection. `scene_flatten_file` is the single bounded composition write; arbitrary
document mutation, creation, validation-only, review, proof, and publish tools are
intentionally not part of MCP.

### `scene_open`

Open an existing scene file in the managed editor. The file must already exist under
`public/scenes/` and end in `.iwsdk.scene.json`. Symbolic links are resolved first:
a link may point to another file under `public/scenes/`, but not outside it, and
`public/scenes/` itself must resolve inside the project.

| Parameter | Type     | Required | Description                        |
| --------- | -------- | -------- | ---------------------------------- |
| `path`    | `string` | Yes      | Workspace-relative scene file path |

Opening changes the active document and reconnects the editor session. It never
creates a file.

### `scene_render_file`

Validate, recursively compose, materialize, and render a scene file without changing
the active editor document. This is the detached validation operation and renderer in
one call.

| Parameter | Type     | Required | Description                                      |
| --------- | -------- | -------- | ------------------------------------------------ |
| `path`    | `string` | Yes      | Existing root or module scene file               |
| `view`    | `string` | No       | Canonical view such as `front`, `top`, `quarter` |
| `viewId`  | `string` | No       | Exact saved authoring view                       |
| `width`   | `number` | No       | Output width in pixels                           |
| `height`  | `number` | No       | Output height in pixels                          |

A valid result includes source/composed/runtime hashes, resolved dependencies,
camera and render metadata, `screenshotSha256`, and a local `screenshotPath`. Image
bytes are not embedded in the response. An invalid result includes structured
diagnostics and no screenshot.

### `scene_flatten_file`

Validate and recursively compose an import-bearing authoring scene into one
import-free runtime document. The operation refuses sources, imports and output
outside `public/scenes/` (after resolving symbolic links), semantic drift, and
replacement of an existing destination unless `overwrite` is true.

| Parameter    | Type      | Required | Description                                                       |
| ------------ | --------- | -------- | ----------------------------------------------------------------- |
| `path`       | `string`  | Yes      | Import-bearing source scene under `public/scenes/`                |
| `outputPath` | `string`  | No       | Destination; defaults to `<source>.flat.iwsdk.scene.json`         |
| `overwrite`  | `boolean` | No       | Permit replacing an existing destination, including in-place mode |

Use the flattened output with `scene_open` and as the runtime scene configured by
`iwsdk.config.json`.

### `scene_get_state`

Get the current editor observation in one response:

- active import-free scene path;
- selection;
- source, composed, and runtime hashes;
- validation status and file-reload diagnostics;
- dirty and external-file conflict state;
- runtime readiness and errors;
- renderer statistics and visible node IDs.

Hierarchy and resource data already live in the authored files and are not duplicated
through MCP.

### `scene_get_capabilities`

Get the active scene schema, supported node-content, prefab, pattern, and shadow-map
kinds, component schemas, safety limits, and canonical capability hash. The default
response is compact; pass `full: true` only when the complete schema payload is
required.

### `scene_select`

Set live editor selection so an agent can inspect or act on the same context as a
human. Selection does not modify the scene document.

| Parameter | Type       | Required | Description                      |
| --------- | ---------- | -------- | -------------------------------- |
| `nodeIds` | `string[]` | Yes      | Existing composed scene node IDs |
| `mode`    | `string`   | No       | Replace, add, or remove mode     |

### `scene_set_camera`

Set the editor camera to a canonical or saved view. Canonical views include `top`,
`front`, `back`, `left`, `right`, `quarter`, and deterministic `orbit` steps. Exact
orthographic views use `projection: "orthographic"` and `orthographicHeight`.

### `scene_screenshot`

Capture the active scene. `captureMode: "render"` omits editor grid, selection,
transform, helper, and orientation overlays; `captureMode: "editor"` includes the UI
diagnostic state. The PNG is written to a local temporary file and the result returns
`screenshotPath` plus active file, hashes, camera, renderer environment, visible node
IDs, validation diagnostics, and render statistics. Image bytes are not embedded in
the MCP response.

### `scene_set_preview_visibility`

Apply temporary recursive `show`, `hide`, `solo`, `context`, `ghost`, or `lock`
arrangements. Preview visibility never changes document or runtime hashes and is not
persisted to the scene file.

### `scene_measure_image_regions`

Measure explicitly aligned image regions for semantic color, luma, highlight, or
shadow comparison. Use only when the source/render alignment and requested statistic
are meaningful. The hierarchy and authored geometry remain in the file.

## Model Inspection

### `asset_render_preview`

Render one glTF or procedural manifest asset in isolation without modifying the open
scene. The result persists one labelled contact sheet to `screenshotPath` and returns
deterministic geometry diagnostics without embedding image bytes. UIKitML assets use
`ui_render_preview` instead.

| Parameter    | Type       | Required | Default  | Minimum | Maximum | Description                              |
| ------------ | ---------- | -------- | -------- | ------- | ------- | ---------------------------------------- |
| `assetId`    | `string`   | Yes      | —        | —       | —       | Manifest id of the model                 |
| `views`      | `string[]` | No       | 5 views  | 1       | 6       | Ordered canonical views                  |
| `mode`       | `string`   | No       | material | —       | —       | `material` or neutral `clay`             |
| `focus`      | `string`   | No       | —        | —       | 512     | Exact named part or named hierarchy path |
| `width`      | `number`   | No       | 640      | 320     | 2048    | Composite width in pixels                |
| `height`     | `number`   | No       | 480      | 240     | 2048    | Composite height in pixels               |
| `background` | `string`   | No       | #202226  | —       | —       | Three.js-compatible background color     |

Diagnostics include raw and framing bounds, object/mesh/geometry/material counts,
rendered triangles, and warnings for malformed geometry or weak inspection identity.
To keep model context bounded, MCP responses include at most 40 named part paths
without their bounds plus the total named-part count. CLI JSON retains the complete
named-part bounds.

Transparent/additive effects remain visible but do not control automatic camera
framing. Use `focus` after the contact sheet exposes a suspicious part; the full
asset remains rendered so attachment context is preserved.

## Runtime UIKitML Inspection

Use `ui_list_assets` and `ui_render_preview` for manifest discovery and isolated
authoring previews. Use `ui_inspect` for the current state of a panel in the running
application.

### `ui_inspect`

Inspect the live UIKitML document owned by one ECS entity. Find the panel first with
`ecs_find_entities` or `iwsdk scene runtime-hierarchy`, then pass its entity index.
For manifest-backed panels, search by the authored panel `namePattern`; the
`PanelDocument` component identifies legacy `PanelUI` entities only.
Omit `selector` to list every element with a stable ID in document order, or narrow
the result with an existing UIKit selector: `#id`, `.class`, or descendant
combinations of those selectors, up to 16 selector parts.

| Parameter     | Type       | Required | Default           | Maximum             | Description                              |
| ------------- | ---------- | -------- | ----------------- | ------------------- | ---------------------------------------- |
| `entityIndex` | `integer`  | Yes      | -                 | -                   | ECS entity that owns the live panel      |
| `selector`    | `string`   | No       | all stable IDs    | 512 chars, 16 parts | UIKit ID, class, or descendant selector  |
| `properties`  | `string[]` | No       | common live state | 20                  | Computed UIKit property names to include |
| `limit`       | `integer`  | No       | 50                | 50                  | Maximum matching elements                |

The result includes panel identity and bounded element summaries containing IDs,
classes, current text, visibility/interaction state, layout size and center, and the
requested computed properties. This is observation only; it does not click or mutate
the UI. UIKit descendants remain UIKit components rather than synthetic ECS entities.
Inspection traverses at most 10,000 objects; oversized documents fail explicitly.

```bash
npx @iwsdk/cli ui inspect --input-json \
  '{"entityIndex":14,"selector":"#counter-button"}'
```

## Modular Scenes

Scene roots may declare top-level imports:

```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "imports": [
    {
      "id": "nook",
      "src": "./modules/nook.iwsdk.scene.json",
      "transform": { "position": [1.5, 0, 0] }
    }
  ],
  "resources": {},
  "nodes": []
}
```

Modules are valid standalone v1 documents. Resolution is recursive and deterministic.
Node and prefab IDs are namespaced as `<import-id>/<local-id>`, while manifest asset
and component IDs remain application-global. Import transforms live on wrapper groups,
and the root owns global metadata, environment, and authoring fields. Cycles and
invalid modules fail before rendering.

## Browser

The browser surface contains exactly seven MCP tools. They automatically resolve the
current application, whether it is the top-level page or the runtime frame inside the
managed workspace. There is no target selector, and the common tools do not navigate
to arbitrary URLs. Use `browser_reload_page` to reload the current application; use
the opt-in [advanced Playwright runner](./workflows#advanced-playwright-runner) only
when the bounded tools cannot express a development task.

### `browser_screenshot`

Capture the current application, automatically resolving the runtime frame when the
managed workspace is visible. The image is written to a local temporary file and
returned as `screenshotPath`, without inline base64 data. Optional parameters select
`png` or `jpeg`, set JPEG
quality from 20 to 100, capture the full document, or capture one element by a ref
returned from `browser_snapshot`. Results include application identity and URL,
whether the application is workspace-framed, image dimensions and MIME type, and
whether an oversized browser capture was downscaled to the configured screenshot
bounds.

### `browser_snapshot`

Inspect the current application as a bounded, accessibility-first list of interactive
elements, useful text, and canvas regions. Each element includes a ref, role, name,
text, visibility and state, and visible bounds. The result also includes a snapshot ID,
application identity, and a `truncated` flag.

| Parameter       | Type      | Required | Description                                      |
| --------------- | --------- | -------- | ------------------------------------------------ |
| `maxNodes`      | `integer` | No       | 1–1000 elements; defaults to 200                 |
| `maxTextLength` | `integer` | No       | 16–1000 characters per name or text field        |
| `rootRef`       | `string`  | No       | Restrict the snapshot to an existing element ref |

Refs are tied to the current application identity and generation. Capture a fresh
snapshot after a reload or when an interaction reports a stale ref.

### `browser_interact`

Run a bounded batch of one to ten Playwright actions against the current application.
Prefer snapshot refs. Semantic locators can identify an element by `testId`, `role`
and optional `name`, or exact `text`. Page coordinates are available for 2D input;
add `canvasRef` to make coordinates relative to a canvas.

Supported actions are `click`, `doubleClick`, `hover`, `pointerMove`, `pointerDown`,
`pointerUp`, `wheel`, `fill`, `type`, `clear`, `press`, `check`, `uncheck`, `select`,
`scroll`, `drag`, `keyDown`, `keyUp`, and `wait`. Keyboard actions target the
current application, including its runtime frame in the managed workspace. `press`
is atomic. To hold a key for frame-sampled controls, keep `keyDown`, a duration-only
`wait`, and `keyUp` in the same batch:

```json
{
  "steps": [
    { "action": "keyDown", "key": "KeyW" },
    { "action": "wait", "durationMs": 500 },
    { "action": "keyUp", "key": "KeyW" }
  ]
}
```

Held keys cannot span batches. IWSDK releases any unmatched keys when the batch
succeeds or fails. A duration wait accepts `durationMs` from 0 through 12,000, must
fit the remaining batch budget, and cannot be combined with `state`, `text`, `path`,
or `loadState`.

Batch and per-step timeouts are capped at 12,000 milliseconds (the batch defaults to
10,000), leaving time inside the host command budget to restore the previous
workspace view. A condition-based `wait` step can wait for element state, load state,
or an expected application path; it does not initiate navigation.

The result lists completed steps and their durations. On failure, it identifies the
failed step, reports whether retrying is appropriate, suggests recovery, and attempts
to return a fresh snapshot and PNG screenshot. MCP returns that screenshot as an image
content block; the equivalent CLI command writes it to a temporary file and returns
the path instead of printing nested base64.

Browser host operations have a 60-second transport budget. They may spend up to 15
seconds waiting behind another browser command, then receive a fresh 27-second active
budget. Coordinator failures are retryable:

- `browser_command_busy`: the bounded queue is full;
- `browser_command_queue_timeout`: this request expired while waiting and the browser
  was left running;
- `browser_command_timeout`: the active operation exceeded its budget, so IWSDK closed
  the managed browser and will relaunch it lazily;
- `browser_command_aborted`: queued work was cleared after another active operation
  timed out and should be retried against the relaunched browser.

### `browser_profile`

Start, inspect, or stop a bounded desktop-browser performance profile for the current
application:

| Parameter       | Type      | Required | Description                                            |
| --------------- | --------- | -------- | ------------------------------------------------------ |
| `action`        | `string`  | Yes      | `start`, `status`, or `stop`                           |
| `mode`          | `string`  | No       | `interaction`, `rendering`, or `trace` when starting   |
| `maxDurationMs` | `integer` | No       | 1,000–60,000; defaults to 30,000 and auto-stops safely |
| `profileId`     | `string`  | No       | Require this active profile when stopping              |

Stopped profiles summarize browser metrics, event timing, requestAnimationFrame
intervals, long tasks, and interaction marks. Trace mode can return a bounded trace
artifact under `.iwsdk/artifacts/browser/`. These are uncalibrated host-browser
diagnostics, not measurements for a target headset: results report
`classification: "host-browser-diagnostic"`, `calibrated: false`, and
`targetDevice: null`.

`interaction` mode includes event-timing observations alongside frame timing;
`rendering` mode omits event timing and concentrates on frame/long-task behavior;
`trace` mode adds a bounded Playwright trace artifact to the interaction-oriented
measurements. The result's `summary.collection` fields state which collectors ran.

### `browser_get_console_logs`

Read browser console logs with optional `count`, `level`, `pattern`, and `since`
filters. Returned diagnostics can include console calls, uncaught page errors, failed
requests, dialogs, downloads, popups, and frame navigation. Entries carry structured
context where available, including serialized arguments, source and frame URLs,
line/column, HTTP method, resource type, failure text, and a repeat count for compacted
duplicates. Results default to the 100 most recent matching entries, cap `count` at
200, and enforce a bounded serialized response size.

### `browser_reload_page`

Reload only the current application surface when applying code changes or recovering
from an unrecoverable state. The result identifies the reloaded application URL, page
ID, and tab generation.

### `browser_set_muted`

Mute or unmute all audio in the managed browser tab. Its app-mode window hides
Chromium's own tab mute control, so this tool and the speaker button in the
workspace's Runtime/Editor bar share one dev-session state:

| Parameter | Type      | Required | Description                              |
| --------- | --------- | -------- | ---------------------------------------- |
| `muted`   | `boolean` | Yes      | `true` mutes the tab; `false` unmutes it |

Muting covers Web Audio output and media elements in every frame, including the
runtime frame and the editor. Applications keep running: audio contexts keep their
state and clock, and an element's `muted` property still reports the value page code
set. The state persists across reloads and managed-browser relaunches for the dev
session, and `runtime_get_status` reports it as `browser.audioMuted`. Two rare cases
are not covered: autoplaying media inside a declarative shadow root, and a detached
media element that autoplays a `srcObject` stream. The result is
`{ "muted": <boolean> }`. The equivalent CLI command is
`iwsdk browser set-muted --muted <true|false>`.

These seven host-browser tools operate through IWSDK's Playwright owner and remain
available for browser-first applications without an IWER runtime bridge. XR, ECS, and
other runtime-dispatched tools still require their corresponding in-page bridge.

## WebXR Session

- `xr_get_session_status`
- `xr_accept_session`
- `xr_end_session`
- `xr_get_transform`
- `xr_set_transform`
- `xr_look_at`
- `xr_animate_to`
- `xr_set_input_mode`
- `xr_set_connected`
- `xr_get_select_value`
- `xr_set_select_value`
- `xr_select`
- `xr_get_gamepad_state`
- `xr_set_gamepad_state`
- `xr_get_device_state`
- `xr_set_device_state`

These tools operate on the emulated WebXR device, input sources, session, and poses.
Inspect each installed schema for device names, axes, timing, and optional fields.
Positions and orientations are relative to the XR origin (`world.player`); `-Z` is
forward and `+Y` is up.

## Hands

- `xr_run_sequence`, `xr_cancel_sequence`
- `xr_list_targets`
- `xr_set_hand_pose`
- `xr_get_hand_state`
- `xr_microgesture`

Set `xr_set_input_mode` to `hand` first. These tools come from IWER and drive the
emulated hands the way a person moves them, so the application's real poke, pinch,
and grab code reacts.

### `xr_run_sequence`

Runs a whole hand interaction in one call: press a button with the index fingertip,
pinch-grab an object, carry it, set it down, make a gesture. Each move is one smooth
reach; the head turns toward the target, and the body leans or steps closer when it
is out of reach. The result lists the select events the application saw, step times,
press contact times, warnings, and the final hand state. Pass `dryRun: true` to check
a plan without moving anything. A sequence gives up 28 seconds after it is sent, with
a partial result; `xr_cancel_sequence` stops it sooner. A UIKit click needs the
fingertip to leave within 800 ms; slow headless frames can stretch a press past that,
so press again when `presses[0].contactMs` is 800 or more.

```bash
npx @iwsdk/cli xr run-sequence --input-json \
  '{"device":"hand-right","steps":[{"target":"counter-button","press":{}}]}'
```

### `xr_list_targets`

Lists the names that `xr_run_sequence` steps accept as `target`, with each target's
box centre and size. IWSDK resolves them in the live scene:

- entities with `PokeInteractable`, `RayInteractable`, `OneHandGrabbable`,
  `TwoHandsGrabbable`, or `DistanceGrabbable`, by Object3D name (`Map Pin 1`)
- UIKitML elements with an `id` inside those entities (`counter-button`); hidden
  elements are left out

A step's `target` also accepts a scene node id, any Object3D name, or a UUID. Targets
that share a name are listed under their scene node id. A press goes to the face
toward the body (or `{ "name": ..., "face": "top" }`), a grab to the middle of the
object, and setting a held object down to the top of the target.

### `xr_set_hand_pose`, `xr_get_hand_state`, `xr_microgesture`

`xr_set_hand_pose` shapes a hand with one of IWER's built-in poses (`point`, `fist`,
`thumbs-up`, and others), optionally per finger and faded over `duration`. Poses
never select; pinch with `xr_set_select_value` or a sequence's `pinch`.
`xr_get_hand_state` reads the pose, pinch, and the XR-origin positions of the wrist,
grip, grasp point, and fingertips. `xr_microgesture` swipes or taps the thumb along
the index finger; the application sees the hand gamepad's microgesture buttons.

`xr_set_transform` and `xr_animate_to` also place a hand by a point on it (`anchor`:
`index-tip`, `grasp`, `wrist`) and orient it by direction (`{"fingers":"forward",
"thumb":"up"}`) or `"auto"`.

`xr_set_hand_pose`, `xr_set_select_value`, `xr_animate_to`, and `xr_select` reply
once their `duration` has passed, so their default timeout grows by that duration.

On a physical headset target, IWER places the hands relative to the native session,
while IWSDK reports targets relative to `world.player`. The two agree in the
emulator, but targeted sequences have not been verified on a headset; check one
`press` there before relying on target names.

## Runtime Render Stats

`iwsdk scene render-stats` measures the live application runtime: renderer
counters, bounds, scene assets, lights, materials and `sceneEnvironment`.
`sceneEnvironment.background` reports what is behind the scene, or `null` when
none of these applies:

| `type`          | Fields                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `dome-gradient` | `sky`, `equator`, `ground` (authored arrays), `intensity`, `elevationDeg`, `azimuthDeg`, `dither` |
| `dome-texture`  | `src`, `intensity`, `blurriness`, `rotation`                                                      |
| `gradient`      | `topColor`, `bottomColor`, `exponent`: a background texture with the older scene gradient marker  |
| `color`         | `color`                                                                                           |
| `transparent`   | none: no background and clear alpha 0, as in an AR session                                        |

`sceneEnvironment.imageBasedLighting` is `{ type: 'ibl-gradient', sky, equator,
ground, intensity }`, `{ type: 'ibl-texture', src, intensity, rotation }`,
`{ type: 'room', intensity, sigma, texture }` for an environment texture with
the older room IBL marker, or `null`. An `IBLTexture` with `src: 'room'`
reports `ibl-texture`. A DomeGradient is hidden during AR passthrough, so an AR
session reports `transparent` even when the level root has one.

`sceneEnvironment.domeFades` lists every node with a `DomeFade`, sorted by
`nodeId`: `start`, `end`, `meshCount`, `skippedMaterials`, `active` and
`inactiveReason` (`no-dome-gradient`, `dome-texture-active`, `ar-session`,
`no-meshes` or `null` while it fades).

## ECS Debugging

- `ecs_pause`, `ecs_resume`, `ecs_step`
- `ecs_query_entity`, `ecs_find_entities`
- `ecs_list_systems`, `ecs_list_components`
- `ecs_toggle_system`, `ecs_set_component`
- `ecs_snapshot`, `ecs_diff`

ECS tools observe or control the live application runtime. Scene hierarchy and prefab
resources remain authored in JSON files; ECS tools are for runtime behavior and state,
not scene composition.

`ecs_set_component` edits to `DomeGradient` and `IBLGradient` apply on the next
frame. `DomeTexture` and `IBLTexture` apply an edit only once `_needsUpdate` is
set to `true`, so include it in the same call.

`ecs_snapshot` retains two labels by default. Pass `capacity` from 2 through 20
to configure a larger rolling window for the current runtime. Its result lists
the active capacity, stored labels, and any label evicted by that capture.

## Review Evidence

Review orchestration is performed outside the editor. Save screenshots, hashes,
camera states, measurements, comparisons, defect lists, and stopping decisions as
normal task artifacts. The editor provides authoritative raw observations but does
not own review lineage or publishing.
