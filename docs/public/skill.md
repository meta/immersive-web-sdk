---
name: iwsdk-dev
description: >
  MUST read this skill BEFORE developing VR/MR/desktop 3D applications
  using IWSDK (Immersive Web SDK). Covers project scaffolding, headless
  browser setup, CLI tools, reference system, ECS debugging, XR emulation,
  verification workflows, deployment, and known issues.
---

# IWSDK Development Guide

[iwsdk.dev](https://iwsdk.dev) · [GitHub](https://github.com/facebook/immersive-web-sdk)

This guide is for AI agents and developers building WebXR or desktop browser 3D
applications with IWSDK in cloud/headless Linux environments (no physical GPU,
no display server). It assumes Node.js satisfies IWSDK's package engine range:
`>=20.19.0 <21.0.0-0 || >=22.12.0 <23.0.0-0 || >=24.0.0`.
The managed dev browser uses Playwright Chromium; the dev plugin installs the
matching Chromium binary when it is missing.

Explain immersive terms in plain language when they first matter instead of
assuming the reader knows them. In particular, introduce XR (an immersive
session), IWER (IWSDK's browser-based XR emulator), ECS (entity-component
system), and controller target-ray versus grip poses with a link to the
applicable IWSDK guide or concept page.

### CLI-First Operating Model

This guide is intentionally **CLI-first** for cloud-based harnesses. Treat
`npx @iwsdk/cli ...` commands as the primary control surface for setup, runtime
inspection, screenshots, ECS debugging, XR emulation, and reference queries.
The scoped package name is a security boundary: do not shorten it to the
unscoped package name, because npx can download that unrelated package when a
local binary is missing.

Reason: MCP adapter support in cloud harnesses is often missing, stale, or
partially wired. Relying on MCP tool availability can degrade generation quality
because the agent may plan around tools that are not actually connected. Use MCP
tools only when the harness clearly exposes them and they are already working;
otherwise use the CLI commands in this guide. Do not rewrite CLI examples into
MCP-only workflows.

---

## 1. Project Scaffolding

Always use the official `@iwsdk/create` package.

The interactive CLI is a short human-facing flow: project name when absent,
starting point, then recommended settings or an advanced setup. It does not ask
users to classify every low-level WebXR capability. Recommended settings use
TypeScript, initialize Git, and install dependencies.

**Agent workflow:** infer the requested experience and features, map that intent
to the flags below, and run with `--yes`. The Create CLI deliberately does not
infer product intent for an agent. Do not replay or script the interactive
questions. When the request is ambiguous in a way that changes the starter or a
material feature, ask the user.

Cloud coding harnesses often start inside an already-created repository, and
users often switch an existing project to IWSDK partway through. In both cases,
run Create in place with `.`:

```bash
npx @iwsdk/create@latest . --yes --target vr
```

If the directory already has a `package.json`, Create adds IWSDK to that
project instead of scaffolding over it, and never overwrites an existing file:

- It checks everything first. A project on a Vite major the IWSDK plugin does not
  support yet (Vite 8) is refused with nothing changed.
- It adds a minimal IWSDK skeleton in its own `src/iwsdk/` folder (world entry,
  empty asset and component manifests), plus `iwsdk.config.json` and an empty
  scene where none exist.
- It merges `package.json` in its own formatting: IWSDK packages and the `three`
  alias are set, versions are only raised, `workspace:`/`file:`/`catalog:` specs
  are left alone, and your scripts are kept (`iwsdk:dev` is added when `dev` is
  taken).
- It adds `iwsdkDev()` to an existing Vite config when the config's shape is
  recognizable, and otherwise lists it as a step.
- It installs with the project's package manager, found from the nearest
  lockfile (a monorepo's included), and installs the coding-agent guidance.

It then prints what it kept and the steps left to finish, such as importing
`./iwsdk` from the app's entry. Do every step. Without a `package.json`, a
non-empty directory still needs `--force`, which overwrites conflicting
generated files and preserves unrelated ones. `--yes` answers setup questions;
it does not grant overwrite permission.

If IWSDK was installed by hand (for example `npm install @iwsdk/core`), install
dependencies, then the coding-agent guidance with
`npx @iwsdk/cli@latest agents sync`.

To upgrade an existing IWSDK app, run `npx @iwsdk/cli@latest upgrade`. It sets
every `@iwsdk/*` dependency to the new release, installs with the project's
package manager, refreshes the coding-agent guidance, and writes the migration
guide for each release boundary crossed to `.iwsdk/migrations/`. Follow those
guides before other work. After a manual upgrade, `npx @iwsdk/cli dev up`
refreshes guidance files nobody edited.

### Step 1: Starting Point

| Target | Flag | When to use |
|--------|------|-------------|
| **VR** | `--target vr` | Fully immersive virtual environment. |
| **Mixed reality** | `--target ar` | Passthrough experience with virtual content in the physical environment. |
| **Desktop 3D** | `--target browser` | Desktop browser 3D app without an immersive session. This dedicated starter has `xr: false`, browser locomotion, canvas pointer input, browser interaction support, and IWER disabled. Camera look is app-owned. |

The flag value remains `ar` because it maps to WebXR's `immersive-ar` session
mode; the user-facing starting point is mixed reality / passthrough.

### Step 2: Features

| Feature | Flag | Enable when… | Disable when… |
|---------|------|-------------|---------------|
| **Physics** | `--physics` / `--no-physics` | Gravity, collisions, bouncing, throwing. | UI-only, data viz, grid-snapping board games. |
| **Locomotion** | `--locomotion` / `--no-locomotion` | VR user moves through a large space (teleport/slide). The Desktop 3D starter already supplies browser controls. | Stationary VR experience. |
| **Grabbing** | `--grabbing` / `--no-grabbing` | VR/MR users pick up, move, or manipulate objects. The Desktop 3D starter has browser interaction behavior built in. | Gaze/pointer-only or observational VR/MR experience. |
| **Scene Understanding** | `--scene-understanding` / `--no-scene-understanding` | MR: interact with real-world surfaces. | MR without surface interaction. |
| **Environment Raycast** | `--environment-raycast` / `--no-environment-raycast` | MR: cast rays against real-world geometry. | No real-world hit testing needed. |

Create derives WebXR feature requirements from the target and these high-level
features. Raw tri-state WebXR settings are not interactive choices and are not
agent-facing scaffolding flags.

### Step 3: Project Setup

| Choice | Flag | Default with `--yes` |
|--------|------|----------------------|
| **Language** | `--language ts` / `--language js` | TypeScript |
| **Git** | `--git` / `--no-git` | Initialize a repository |
| **Dependencies** | `--install` / `--no-install` | Install dependencies |
| **Existing target** | `--force` | Only for a non-empty directory without a `package.json`; an existing project is adopted without it and never overwritten |

### Step 4: Source (optional)

| Flag | Effect |
|------|--------|
| *(none)* | Matching SDK packages from npm; starter source is embedded in `@iwsdk/create`. |
| `--canary` | Baked-in CloudFront CDN canary bundle. |
| `--canary <url>` | Custom bundle URL for internal builds. |

### Examples

```bash
# VR game (stationary, physics for gameplay)
npx @iwsdk/create@latest space-pong --yes --target vr --physics --no-locomotion --grabbing

# Mixed reality object placer
npx @iwsdk/create@latest mr-placer --yes --target ar --physics --scene-understanding --environment-raycast

# Desktop 3D game (no headset; locomotion and pointer input are scaffolded)
npx @iwsdk/create@latest desktop-game --yes --target browser --physics

# Existing project or cloud-harness repository (adds IWSDK, overwrites nothing)
npx @iwsdk/create@latest . --yes --target vr
```

---

## 2. Headless Browser & SwiftShader

### Auto-Detection (0.4.x)

When `@iwsdk/vite-plugin-dev` launches its managed Playwright browser, it
auto-detects GPU availability first:

1. Probes `/dev/dri` for render nodes.
2. Falls back to **SwiftShader** (Playwright Chromium's bundled software
   renderer) when no GPU is found.
3. Logs the selected backend every launch.

**No manual patching required** in 0.4.x. Use the normal generated app workflow:
`npm run dev` or `npx @iwsdk/cli dev restart --open --foreground`.

### On-Demand Rendering

IWSDK 1.1 and later: headless managed sessions render on demand (earlier
versions draw every frame): systems run every frame, and the
app draws only when a tool needs pixels (`browser screenshot` draws a fresh
frame itself). Software rendering therefore no longer limits the frame rate of
agent sessions. Set `IWSDK_DEV_RENDER_MODE=continuous` to draw every frame, and
use `browser profile` rather than headless frame rates to judge performance.

### Environment Variable Override

```bash
IWSDK_GPU=auto          # Default — auto-detect
IWSDK_GPU=gpu           # Force hardware GPU
IWSDK_GPU=swiftshader   # Force SwiftShader (software rendering)
```

### Legacy Notes

Current 0.4.x apps should not patch `node_modules` or Chromium launch args. If
an older 0.3.x harness carried a manual SwiftShader patch, treat that as
historical migration context and remove it after upgrading to 0.4.x.

### Playwright Browser Revision Recovery

The vite plugin declares `playwright: ^1.58.2`; this repo lockfile currently
resolves it to Playwright 1.58.2. If an environment has a mismatched Playwright
browser cache, launch can fail with:

```
Executable doesn't exist at …/chromium_headless_shell-1208/…
```

**Preferred fixes:**

1. **Install the matching Playwright browser revision:**
   ```bash
   npx playwright@1.58.2 install chromium
   ```

2. **Align the project Playwright version with the plugin's resolved version:**
   ```bash
   npm install playwright@1.58.2 --save-dev
   npx playwright install chromium
   ```

Copying `~/.cache/ms-playwright` revision directories is an emergency cache
workaround only; prefer reinstalling the matching browser revision.

---

## 3. Three.js Imports

Standard Three.js classes are re-exported from `@iwsdk/core`. For app code,
import standard Three classes from `@iwsdk/core` so they match IWSDK's
Three/super-three build. Keep the template's `three` dependency/override; import
`three/examples/jsm/...` only for addons that `@iwsdk/core` does not re-export.

```typescript
// ✅ CORRECT
import {
  Mesh, Group, BoxGeometry, SphereGeometry, CylinderGeometry,
  PlaneGeometry, ConeGeometry, TorusGeometry,
  MeshStandardMaterial, MeshBasicMaterial, LineBasicMaterial,
  Color, Vector3, Quaternion, Euler, Matrix4,
  Fog, AmbientLight, PointLight, DirectionalLight,
  BufferGeometry, Float32BufferAttribute,
  EdgesGeometry, LineSegments,
  AdditiveBlending,
  // ... every standard Three.js export is available
} from "@iwsdk/core";

// Avoid for standard Three classes in app code
// import { Mesh } from "three";
```

---

## 4. Key API Surface (0.4.x)

### World Creation

```typescript
// XR world (default)
const world = await World.create(container);

// XR world with options
const world = await World.create(container, {
  xr: { offer: 'once' },  // or 'always' / 'none'; omit xr for the default
  render: { near: 0.01, far: 200 },
  features: {
    grabbing: true,
    locomotion: true,
    physics: true,
    spatialUI: false,
  },
});

// Browser-first world (no XR)
const world = await World.create(container, {
  xr: false,
  render: {
    near: 0.001, far: 200,
    camera: { position: [0, 1.6, 0], lookAt: [0, 1.55, -1] },
  },
  input: { canvasPointerEvents: true },
  features: {
    grabbing: true,
    locomotion: { browserControls: true },  // WASD/arrows + Space + gamepad; app owns mouselook
    physics: true,
  },
});
```

### Dual-Runtime Pattern (XR + Browser Fallback)

For games that should work both in VR and in the browser:

```typescript
const world = await World.create(container, {
  xr: { offer: 'once' },
  input: { canvasPointerEvents: true },
  features: {
    grabbing: true,
    locomotion: { browserControls: true },
    physics: true,
  },
});
```

### Input System

```typescript
// InputManager facade (0.4.x)
world.input.xr              // XRInputManager (controllers, hands)
world.input.keyboard         // StatefulKeyboard
world.input.actions          // InputActionManager
world.input.browserGamepads  // Browser gamepad array

// Action-backed input (preferred for reusable intent-based systems)
world.input.actions.getAxis2D('locomotion.move');    // { x, y }
world.input.actions.getButtonDown('locomotion.jump');

// Built-in action names:
//   locomotion.move, locomotion.turn, locomotion.jump,
//   locomotion.teleportAim, locomotion.teleportCommit,
//   interaction.select
//
// Some names are reserved for app/user bindings and are not default-bound.

// Keyboard (browser-first)
world.input.keyboard.getKeyPressed('KeyW');   // held this frame
world.input.keyboard.getKeyDown('Space');     // pressed this frame
world.input.keyboard.getKeyUp('KeyE');        // released this frame
```

### ECS-Native Player Rig

```typescript
world.playerEntity           // Entity wrapping XROrigin Group
world.playerHeadEntity       // Entity for head space; not a default UI parent
world.playerSpaceEntities    // { head, raySpaces, gripSpaces, indexTipSpaces }
```

`ScreenSpace` is a browser-viewport HUD and returns to world space in XR. For
immersive UI, default to an authored world transform or attach contextual UI to
the object it controls. Use a thresholded `Follower` targeting
`world.player.head` only when compact global UI must remain discoverable.
Reserve direct `world.playerHeadEntity` parenting for tiny, transient,
non-interactive markers that require exact view alignment; do not head-lock
menus or persistent panels. See https://iwsdk.dev/concepts/spatial-ui/hud.html.

### Asset Management

IWSDK loads 3D models as GLTF or GLB. For FBX, OBJ, or another source format,
use Blender's **File → Import**, then **File → Export → glTF 2.0**, and register
the converted output in the asset manifest.

```typescript
// getGLTF returns a fresh scene graph clone by default
// (geometries, materials, and animations remain shared)
const { scene } = AssetManager.getGLTF('myModel')!;
world.scene.add(scene);

// Opt into shared instance (old behavior)
const { scene } = AssetManager.getGLTF('myModel', { shared: true })!;
```

---

## 5. Dev Server

```bash
npm run dev                    # Generated apps: dev restart --open --foreground
npx @iwsdk/cli dev up               # Start dev:runtime through the CLI, usually backgrounded
npx @iwsdk/cli dev up --foreground  # Stay attached to terminal
npx @iwsdk/cli dev down           # Stop
npx @iwsdk/cli dev restart        # Restart
npx @iwsdk/cli dev status         # Check running state
npx @iwsdk/cli dev logs           # View recorded background server logs
npx @iwsdk/cli dev open           # Open in browser
```

Generated apps use bare `iwsdkDev()` and the CLI launches the managed Playwright
runtime/editor workspace, registers the MCP WebSocket endpoint, and records
runtime state. AI, headed/headless, open, and screenshot behavior are
launch-time `iwsdk dev up` flags. Pass the mode explicitly (the default is
headed): `--ai-mode collaborate` when the user wants to watch or steer the work,
`--ai-mode agent` (headless, renders on demand) otherwise; ask once if the
request does not say, and use agent when nobody can answer. Announce any later
change before restarting rather than silently changing their workspace. Use `npx @iwsdk/cli dev status` for the resolved `runtimeUrls.local` and
`runtimeUrls.network` fields in the JSON result; the generated starter template
defaults to `https://localhost:8081/`, but examples or existing apps may use
another Vite port.

### Physical Headset Smoke Test

Run `npx @iwsdk/cli dev status`, then open one of the URLs in
`data.runtimeUrls.network` on a headset connected to the same Wi-Fi network as
the development computer. Accept the expected warning for IWSDK's untrusted
local certificate. For alternate connection methods and complete instructions, see
[Testing Your Experience](/guides/02-testing-experience).

### Node.js Requirement

IWSDK 0.4.x requires Node.js satisfying:
`>=20.19.0 <21.0.0-0 || >=22.12.0 <23.0.0-0 || >=24.0.0`.
If your environment ships an unsupported default (for example Node 18), install
a supported Node version with your environment's version manager or platform
package and prepend it to `PATH`.

```bash
node --version
```

---

## 6. Adapter Management

Project creation syncs MCP adapter configs after dependency installation for the
selected AI tools. Sync or manage them explicitly with:

```bash
npx @iwsdk/cli adapter sync      # Write configs for all supported or selected AI tools
npx @iwsdk/cli adapter status     # Check adapter state
npx @iwsdk/cli adapter prune      # Remove IWSDK-managed MCP entries
```

Supported adapters: Claude Code, Cursor, OpenAI Codex, GitHub Copilot.

---

## 7. Reference System

`@iwsdk/reference` is a workspace-local reference CLI/MCP server that searches
IWSDK source, examples, guides and dependency type definitions. Its corpus ships
inside the package, so queries work offline right after install.

```bash
npx @iwsdk/cli reference status    # Confirm the package is installed and its corpus loads
```

### Query Tools

```bash
# Search (identifiers and plain-language questions)
npx @iwsdk/cli reference search --input-json '{"query":"how to create a grabbable object","limit":5}'

# API reference
npx @iwsdk/cli reference api --input-json '{"name":"World.create"}'

# Relationship search
npx @iwsdk/cli reference relationship --input-json '{"type":"extends","target":"System"}'

# File content
npx @iwsdk/cli reference file --input-json '{"file_path":"packages/core/src/ecs/world.ts","source":"iwsdk"}'

# List all ECS components / systems
npx @iwsdk/cli reference components --input-json '{}'
npx @iwsdk/cli reference systems --input-json '{}'

# Dependents and examples
npx @iwsdk/cli reference dependents --input-json '{"api_name":"DistanceGrabbable"}'
npx @iwsdk/cli reference examples --input-json '{"api_name":"DistanceGrabbable"}'

# Inspect tool catalog
npx @iwsdk/cli reference inspect
npx @iwsdk/cli reference inspect --tool search
```

### Install Failure Handling

Do not use `npm install --ignore-scripts` as the default workaround for
`@iwsdk/reference`; the package bin expects built `dist` files. If installation
fails, inspect the package-manager error and fix the underlying dependency or
engine issue. The package has no native or model dependencies.

---

## 8. Runtime Debugging & ECS CLI

Runtime command groups (`xr`, `browser`, `scene`, `ecs`) require a running IWSDK
runtime. `dev up` starts one; `status`, `dev`, `adapter`, `reference`, and
`mcp inspect` commands can run without an active runtime unless noted.

### Common CLI Commands

```
iwsdk status
iwsdk dev      up | down | restart | logs | open | status
iwsdk adapter  sync | status | prune
iwsdk reference status | warmup | inspect | search | relationship |
                api | file | components | systems | dependents | examples
iwsdk mcp      stdio | inspect [--tool <mcpName>]
iwsdk xr       status | enter | exit | get-transform | set-transform |
               look-at | animate-to | set-input-mode | set-connected |
               get-select-value | set-select-value | select |
               get-gamepad-state | set-gamepad-state |
               get-device-state | set-device-state |
               run-sequence | cancel-sequence | list-targets |
               set-hand-pose | get-hand-state | microgesture
iwsdk browser  screenshot | logs | reload
iwsdk scene    open | render-file | flatten | state | capabilities | select |
               set-camera | screenshot | set-preview-visibility |
               measure-image-regions
iwsdk ui       assets | render-preview | inspect
iwsdk ecs      pause | resume | step | query | find | systems |
               components | toggle-system | set-component | snapshot | diff
```

### Native Scene Composition Tools

Scene files are now the authoring API. Create and edit import-bearing roots and
modules directly, validate them with `scene_render_file`, then use
`scene_flatten_file` once. Treat the flattened output as the canonical editable scene.
The managed editor watches that single opened import-free document; valid changes
replace the preview atomically. Invalid files keep the last valid preview and report
diagnostics. Unsaved human edits produce a conflict instead of being overwritten.

The public editor and file-authoring scene tool surface is:

`scene_open`, `scene_render_file`, `scene_flatten_file`, `scene_get_state`,
`scene_get_capabilities`, `scene_screenshot`, `scene_select`,
`scene_set_camera`, `scene_set_preview_visibility`, and
`scene_measure_image_regions`.

`scene_render_file` is the detached validate-and-render operation. It resolves module
imports, validates the composed document, and returns source/composed/runtime hashes,
resolved dependencies, camera and render metadata, `screenshotSha256`, and a local
`screenshotPath`; image bytes are not embedded in the response. If validation or
materialization fails it returns diagnostics and no screenshot.
`scene_open` opens an existing file only; create new files with normal filesystem
tools.

Use top-level `imports` to compose standalone v1 module files. Imported nodes and
prefabs receive deterministic `<import-id>/<local-id>` namespaces, the import wrapper
carries its transform, and the root retains global environment/authoring ownership.
This lets independent agents author and render distinct module files in parallel
before the root composes them. Imports are authoring-only; after validation, use
`scene_flatten_file` (CLI: `iwsdk scene flatten`) once to produce the import-free
scene loaded by the runtime and editable in the managed editor. Continue authoring
the flat output; re-flatten with overwrite only when intentionally replacing its edits.

`scene_get_state` reports the active file, selection, source/composed/runtime hashes,
validation diagnostics, dirty/conflict state, runtime readiness, and render stats.
Use `scene_set_preview_visibility` for temporary recursive hide/show, solo, ghost,
context, and lock arrangements without modifying the scene.

Keep review orchestration, evidence, comparisons, and stopping decisions in normal
task files outside the editor. The editor supplies authoritative screenshots, hashes,
camera state, diagnostics, image-region measurements, and render statistics.

For visual verification, call `scene_set_camera` or `scene_screenshot` with
named views such as `current`, `top`, `front`, `back`, `left`, `right`,
`quarter`, and `orbit`. Pass `orbitStep` or `step` with `orbit` for
deterministic 45-degree increments around the scene. Use multiple angles before
saving when checking symmetry, alignment, and whether objects are actually
resting on a surface.

Renderable scene nodes use discriminated `content`: `group`, `asset`, `instance`,
or `pattern`. Asset content references an application-global ID from the
`defineAssets()` module selected by `iwsdk.config.json`; scene JSON never declares
asset URLs, procedural geometry, or materials. `resources` contains reusable scene
prefabs only. Create procedural shapes and custom materials in TypeScript, register
the resulting parentless `Object3D` in `defineAssets()`, and reference its asset ID
from the scene. A node may set
`framingRole: "support"` so rendered infrastructure remains in raw `worldBounds`
but is excluded from content-only `framingBounds` and automatic scene framing;
omission means `content`. Before flattening, add or edit nodes and prefabs in
the owning root or module, update renderable assets in the asset module, and call
`scene_render_file`. Then flatten once, open the import-free output, and continue
authoring there.

### ECS Inspection
```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["DistanceGrabbable"]}'
npx @iwsdk/cli ecs query --input-json '{"entityIndex":3}'
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":3,"componentId":"Transform","field":"position","value":[2,1,-1.8]}'
```

### ECS Frame Stepping & Snapshot Diffs

Use these to verify game logic, physics behavior, or movement direction:

```bash
npx @iwsdk/cli ecs pause                                         # Freeze ECS (render continues)
npx @iwsdk/cli ecs step --input-json '{"count":1}'               # Advance one frame
npx @iwsdk/cli ecs resume                                         # Resume; first resumed delta is capped

npx @iwsdk/cli ecs snapshot --input-json '{"label":"before"}'     # Save state
# ... make a change or advance frames ...
npx @iwsdk/cli ecs snapshot --input-json '{"label":"after"}'
npx @iwsdk/cli ecs diff --input-json '{"from":"before","to":"after"}'  # Compare
```

Snapshots retain two distinct labels by default. Pass `capacity` from 2 through 20
to configure the rolling window for the current runtime.

### Browser Tools

```bash
npx @iwsdk/cli browser screenshot --output-file artifacts/runtime.png
npx @iwsdk/cli scene screenshot --input-json '{"view":"quarter"}' --output-file artifacts/scene.png
npx @iwsdk/cli browser logs           # App console logs
npx @iwsdk/cli browser reload         # Reload page
```

Both screenshot commands write a PNG and return `screenshotPath`. An explicit
`--output-file` takes precedence over `--raw`, avoiding a large base64 payload on
stdout. Native scene screenshots default to an overlay-free `captureMode: "render"`;
request `captureMode: "editor"` only for editor UI diagnostics.

---

## 9. XR Emulation

### Device Names (CRITICAL)

| Device Name | Description |
|-------------|-------------|
| `"headset"` | HMD / viewer |
| `"controller-right"` | Right controller |
| `"controller-left"` | Left controller |
| `"hand-right"` | Right hand |
| `"hand-left"` | Left hand |
| `"gaze"` | Continuous gaze ray |

Prefer these canonical IDs because CLI schemas and docs use them. Current IWER
also normalizes common aliases such as `"right"`, `"right-controller"`,
`"rightController"`, and `"controllers.right"`, but unrecognized IDs still fail.
Allowed devices vary by command: transforms support
headset/controllers/hands/gaze; connection changes support
controllers/hands/gaze; select supports controllers/hands; gamepad commands
support controllers only. Gaze has a headset-derived origin, so its transform
accepts orientation but not position.

Before claiming that a pose, hand/controller alignment, or immersive
interaction is correct, enter XR and confirm `npx @iwsdk/cli xr status` reports an
active session. A flat screenshot outside XR can prove that the app renders,
but not that immersive transforms or interactions are correct.

### Common Commands

```bash
npx @iwsdk/cli xr enter
npx @iwsdk/cli xr exit
npx @iwsdk/cli xr status

# Position devices
npx @iwsdk/cli xr get-transform --input-json '{"device":"headset"}'
npx @iwsdk/cli xr set-transform --input-json '{"device":"headset","position":{"x":0,"y":1.6,"z":-2}}'
npx @iwsdk/cli xr look-at --input-json '{"device":"headset","target":{"x":0,"y":0.9,"z":0}}'
npx @iwsdk/cli xr animate-to --input-json '{"device":"headset","position":{"x":0,"y":1.5,"z":0},"duration":0.5}'
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"controller"}'
npx @iwsdk/cli xr set-connected --input-json '{"device":"controller-right","connected":true}'

# Continuous gaze (selection still comes from a controller or hand)
npx @iwsdk/cli xr look-at --input-json '{"device":"gaze","target":{"x":0,"y":1.2,"z":-2}}'
npx @iwsdk/cli xr set-connected --input-json '{"device":"gaze","connected":false}'

# Controller input
npx @iwsdk/cli xr select --input-json '{"device":"controller-right"}'
npx @iwsdk/cli xr get-select-value --input-json '{"device":"controller-right"}'
npx @iwsdk/cli xr set-select-value --input-json '{"device":"controller-right","value":1}'
npx @iwsdk/cli xr get-gamepad-state --input-json '{"device":"controller-right"}'
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-right","buttons":[{"index":0,"value":1}]}'

# Hand input: press, grab, and gesture by target name
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli xr list-targets
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"target":"counter-button","press":{}}]}'
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"target":"Map Pin 1","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},{"position":{"x":0.3,"y":1.0,"z":-1.3},"depart":{"distance":0.08}},{"pinch":0,"duration":0.15}]}'
npx @iwsdk/cli xr get-hand-state --input-json '{"device":"hand-right"}'
npx @iwsdk/cli xr set-hand-pose --input-json '{"device":"hand-right","poseId":"thumbs-up","duration":0.3}'
```

`xr run-sequence` moves the hand like a person: one reach per step, the head turning
to the target and the body stepping closer when needed. Press buttons with `press`;
pick things up with `pinch: {"value":1,"at":"arrival"}` on the target and let go with
`pinch: 0`. `xr list-targets` names the interactable entities (by Object3D name) and
the UIKitML element ids inside them; scene node ids also work as targets. Add
`"dryRun":true` to check a plan first. Near grabs by hand need
`grabbing.useHandPinchForGrab`, which is on by default.

### `set-device-state` (Different Naming Convention)

This command takes a top-level `state` object, not the flat `"device"` string
used by transform/input commands. Omitting `state` resets device defaults.

```bash
npx @iwsdk/cli xr set-device-state --input-json '{
  "state": {
    "controllers": {
      "right": {
        "position": {"x":0.2, "y":1.1, "z":0.3},
        "orientation": {"x":0, "y":0, "z":0, "w":1}
      }
    },
    "gaze": {
      "connected": true,
      "orientation": {"x":0, "y":0, "z":0, "w":1}
    }
  }
}'
```

`xr status` reports `runtimeKind` as `"emulated"` or `"native"`. Native mode
cannot enter a session on the application's behalf; the application must start
its browser-owned immersive session before mutating XR state.

### Recovery: Unresponsive Runtime

If runtime commands time out, check browser/runtime readiness, active XR session
state, console logs, and whether the render loop is running:

**To recover:**

1. `npx @iwsdk/cli xr status`
2. `npx @iwsdk/cli browser logs`
3. `npx @iwsdk/cli browser reload`
4. If transport/server state is bad: `npx @iwsdk/cli dev restart`
5. Re-enter XR if needed: `npx @iwsdk/cli xr enter`

Read-only XR methods are immediate and cannot create a queued action loop, but
runtime validation is uneven. Still pass explicit `"device"` values.

---

## 10. Verification Workflow (IMPORTANT)

For IWSDK app/example workspaces, verify behavior with the live runtime tools.
Do not assume a code change is correct just because it compiles.

### Verification checklist:

1. **Start the dev server** — from an app/example workspace that defines
   `dev:runtime`, run `npx @iwsdk/cli dev up`
2. **Take a screenshot** — `npx @iwsdk/cli browser screenshot` — to confirm the
   scene renders correctly.
3. **Use ECS pause/step/snapshot** to inspect state frame-by-frame when
   debugging movement, physics, or timing logic. ECS tools require IWSDK's
   runtime debug bridge.
4. **Check the generated app build matches the source** — after building,
   verify the compiled JS contains the expected changes when the pattern
   survives bundling/minification:
   ```bash
   npm run build
   grep -R -- 'YOUR_PATTERN' dist/assets/*.js
   ```
5. **After deploying**, verify the live HTML references the newly built hashed
   assets.

### Common pitfall: deploying stale artifacts

If you change source code, commit, then deploy `dist/` to `gh-pages` without
rebuilding, the deployed JS can still contain the old code. Build immediately
before publishing `dist/`, then verify the live site references the new hashed
assets.

---

## 11. Bundled AI Skills

Generated coding-tool configurations copy their skills from the canonical
sources packaged under `@iwsdk/create`. Portable skills are emitted for both Claude
and Codex:

| Skill | Purpose |
|-------|---------|
| `iwsdk-dev` | Route greenfield development and established-app iteration |
| `iwsdk-build-model` | Build and inspect one reusable glTF or procedural model |
| `iwsdk-compose-scene` | Arrange, light, and review editable native scenes |
| `iwsdk-grab` | Grab interaction implementation |
| `iwsdk-ray` | Ray interaction implementation |
| `iwsdk-ui` | Spatial UI implementation |
| `iwsdk-debug` | Debugging workflows |
| `iwsdk-physics` | Physics system implementation |
| `iwsdk-depth-occlusion` | Depth sensing and occlusion for AR |

---

## 12. Production Build & Deployment

### Build

```bash
npm run build
```

In generated apps, this runs a Vite build. The `dist/` folder is deployable as
static files. It is not guaranteed to be fully offline/self-contained: some
runtime assets, such as XR controller profile visuals, may still be fetched
externally unless the app bundles them or provides a custom asset loader.

### GitHub Pages Deployment (no Actions required)

If your GitHub token lacks the `workflow` scope and you cannot push
`.github/workflows/`, prefer the documented static deploy path:

```bash
npm run build
npx gh-pages -d dist
```

If you need to avoid the `gh-pages` helper, push `dist/` directly to the
`gh-pages` branch. Use an environment variable for the project path so the
commands are copy-safe:

```bash
# From project root, after a successful build:
PROJECT="$PWD"
cd /tmp && rm -rf gh-pages-deploy && mkdir gh-pages-deploy && cd gh-pages-deploy
git init && cp -R "$PROJECT/dist/." .
git add -A && git commit -m "Deploy"
git push --force "https://github.com/<owner>/<repo>.git" HEAD:gh-pages
```

Then enable GitHub Pages source `gh-pages` branch in repo settings. The starter
template uses `base: './'`, which works for project pages; existing apps should
verify their Vite `base` setting before deploying under a subpath.

### Zip Delivery (alternative)

```bash
PROJECT_NAME=my-app
(cd dist && zip -r "/tmp/${PROJECT_NAME}-dist.zip" .)
```

---

## 13. Coordinate System & Conventions

Standard Three.js / WebXR conventions apply:

- **Right-handed** coordinate system.
- **-Z is camera forward.** Cameras look along local -Z.
- **+Y is up.**
- The player origin starts at identity; with an unrotated camera, forward is -Z.
- In browser-first mode, the camera starts at the configured position
  (default: `[0, 1.7, 0]` looking toward -Z unless `render.camera` overrides it).

For games with approach lanes (e.g. rhythm games):
- For a lane aligned with camera forward (-Z), spawn far objects at more
  negative Z values.
- Move those objects toward +Z as they approach the player.
- Put the hit zone near the player at a small negative Z (e.g. `z = -2`).

---

## 14. XR Controller Input (VR Games)

For headset-targeted VR apps, XR controller or hand input should be first-class.
Keyboard/mouse should be a browser fallback, not the only supported input path.

Prefer the stateful XR input API over raw `Gamepad` array indexing:

```typescript
import { InputComponent } from '@iwsdk/core';

const rightGamepad = world.input.xr.gamepads.right;
const triggerDown = rightGamepad?.getButtonDown(InputComponent.Trigger);
const squeezeHeld = rightGamepad?.getButtonPressed(InputComponent.Squeeze);
const thumbstick = rightGamepad?.getAxesValues(InputComponent.Thumbstick);
const aPressed = rightGamepad?.getButtonDown(InputComponent.A_Button);
```

Raw WebXR gamepad indices are profile-specific fallback knowledge; prefer
`InputComponent` APIs in app code. Do not transfer raw profile indices directly
to the runtime CLI: `iwsdk xr set-gamepad-state` uses its documented synthetic
schema (`0=trigger`, `1=squeeze`, `2=thumbstick`, `3=A/X`, `4=B/Y`,
`5=thumbrest`).

### Dual-input pattern

For games that should work in both browser and VR:

```typescript
// In your update loop, direct browser fallback:
if (world.input.keyboard.getKeyDown('Space')) {
  fire();
}

// For shared fire/select intent, register explicit keyboard and XR action
// bindings, or use the built-in locomotion actions where applicable.
```

---

## 15. Migration: 0.3.x → 0.4.x

### Breaking Changes

1. **`world.input` is now `InputManager`**, not `XRInputManager`.
   Access XR input via `world.input.xr`.
2. **`AssetManager.getGLTF()` returns clones by default.**
   Scene graphs are cloned; geometries, materials, and animations remain shared.
   Pass `{ shared: true }` for the old shared-instance behavior.
3. **`--from <url>` is now `--canary [url]`** in `@iwsdk/create`.
4. **`ai.tools` removed from vite plugin config.**
   MCP adapter configs are project-level, managed via `iwsdk adapter sync`.

### Deprecated (still working)

```
world.input.gamepads         → world.input.xr.gamepads
world.input.multiPointers    → world.input.xr.multiPointers
world.input.visualAdapters   → world.input.xr.visualAdapters
world.input.isPrimary()      → world.input.xr.isPrimary()
```

### No Longer Needed

- Manual SwiftShader patching — the managed Playwright browser auto-detects GPU
  availability and supports `IWSDK_GPU=auto|gpu|swiftshader`.
- Manual MCP config at runtime — project creation syncs adapters when
  dependencies are installed and AI tools are selected; otherwise run
  `iwsdk adapter sync`.
