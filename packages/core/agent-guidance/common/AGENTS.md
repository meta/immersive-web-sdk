# IWSDK project

IWSDK changes faster than model training data. GLXF scenes, the external 0.4
scene editor and its Vite plugin, and the UIKitML-compile and glTF-optimizer Vite
plugins were removed in 0.5: scenes are native `*.iwsdk.scene.json` files edited
in IWSDK's built-in editor, and `@iwsdk/vite-plugin-dev` is the only IWSDK Vite
plugin. Trust this file and the project skills over what you remember about
IWSDK. To upgrade IWSDK, run `npx @iwsdk/cli@latest upgrade` and follow the
migration guides it writes to `.iwsdk/migrations/`.

A Vite + TypeScript or JavaScript app, but several things do **not** work the way
a normal Vite project works. Read this section before assuming anything.

Deeper material is installed in each selected harness's native path-scoped rule
format. Harnesses that use `AGENTS.md` also receive equivalent nested files near
the code they govern. Read the applicable scoped instructions before working in
that area.

Explain immersive terms in plain language when they first matter instead of
assuming the reader knows them. In particular, introduce XR (an immersive
session), IWER (IWSDK's browser-based XR emulator), ECS (entity-component
system), and controller target-ray versus grip poses with a link to the
applicable IWSDK guide or concept page.

## What is not standard Vite

**No `iwsdk.config.json` in this project?** IWSDK was added by hand. Run
`npx @iwsdk/create@latest . --yes --target vr` (`ar` for mixed reality,
`browser` for desktop 3D) to add the project manifest, an empty scene, and a
`virtual:iwsdk-project` entry in `src/iwsdk/` without overwriting any file; the
rest of this file assumes them.

**`iwsdk.config.json` is the project authority, not `vite.config.ts`.** It selects
the active scene, the asset module, the component module, and all XR/world
features. `vite.config.ts` only wires the plugin. Editing `iwsdk.config.json`
restarts Vite in place; the managed window remains open and its command bridges
reconnect automatically. Wait for `npx @iwsdk/cli dev status` to report
`browserCommandReady: true` before issuing browser-backed commands.

**`virtual:iwsdk-project` is a virtual module**, not a file. `src/index.ts` or
`src/index.js` imports it and passes it whole to `World.create()`. Do not
hand-build that options object.

**The dev server is CLI-managed.** Use `npx @iwsdk/cli dev up` (or `npm run dev`), not
`vite`. It launches a managed browser that hosts the MCP command bridge.
`--no-open` starts the server with managed-browser launch disabled. Server status
and explicitly paired physical targets remain available. A targetless managed
browser command then fails with `browser_not_launched`; it never falls through
to a physical page. Commands default to the managed browser. One managed
window hosts the editor and application roles. Browser failure leaves Vite and
HMR running. `runtime status`, `runtime targets`, and `runtime wait` do not recover
or launch a browser; `runtime recover` explicitly retries after a failure.

Pair a headset using `runtime pair-headset --input-json '{"headsetId":"ADB_SERIAL"}'`,
open the returned URL on that exact device through ADB reverse, then copy its
`runtimeTarget` from `runtime targets`. Include deviceClass, headsetId, pageId, and
tabGeneration on every physical command. Reload is supported through the page
bridge; screenshot, snapshot, interaction, profiling, console capture, and the
managed editor are host-only. Rediscover after reload to get the new generation.

**Choose the session mode before the first `dev up`, and pass it explicitly**
(the CLI default is headed):

- `--ai-mode collaborate` (headed, draws every frame, Runtime/Editor toggle)
  when the user wants to watch or steer the work as it happens: they ask to see
  it, are pairing live, or will judge visuals or motion by eye.
- `--ai-mode agent` (headless, draws only when a tool needs pixels, fast without
  a GPU) for everything else: autonomous or background work, CI, a remote host
  or no display.

If the request does not say and the user is there, ask once whether they want to
watch in a browser window or let you work headless; if nobody can answer, use
agent. That one question is allowed even where a playbook avoids pausing; put it
in your first reply, and start agent mode if no answer has come by the time you
need the session. Reuse a healthy session in whatever mode it runs, and announce
any mode change before restarting. Headless screenshots always show a fresh
frame, but frame rate there means nothing; the iwsdk-dev skill's
`references/headless-rendering.md` covers exact frames, filmstrips and
`RuntimeSettings`. In a visible collaboration session, use the Runtime/Editor
toggle in the single managed Chromium window. Its expected unsupported-flag
banner comes from `--ignore-certificate-errors` for the local development
certificate. Playwright may add separate sandbox-related flags in constrained
environments.

**`src/assets.ts`/`src/assets.js` is evaluated twice, in two different JS
realms** — once by the app runtime, once by the editor. It must be deterministic
and side-effect free: no `World`, no DOM, no timers, no reliance on shared object
identity.

**Static geometry lives in TypeScript, composition lives in JSON.** Scene JSON
never declares URLs, geometry or materials — only manifest IDs.

**Components must be declared in a system-free module** and exported from
`src/components.ts`/`src/components.js` via `defineComponents()`. The editor
imports that same manifest to build its inspector, so a component that is not in
it cannot be authored in scenes.

**Import Three.js from `@iwsdk/core`, never from `three`.** `@iwsdk/core`
re-exports all of Three; importing `three` directly creates a duplicate instance
and subtle breakage. Exception: `import type { GLTF } from 'three/addons/...'`.

## Traps that produce silent failures

| Trap                                                           | Symptom                                                                  | Fix                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `locomotion: true` with no `LocomotionEnvironment` on a floor  | player falls through the world                                           | add the component to a walkable surface                                               |
| Scene origin left occupied                                     | player spawns inside your geometry                                       | the player origin is `0,0,0` unless the scene authors `player.transform`              |
| Scene JSON with `imports`                                      | authoring preview works, but editable open and runtime load are rejected | run `npx @iwsdk/cli scene flatten` once, then edit the flat output                    |
| `entity.destroy()`                                             | GPU memory leaked                                                        | use `entity.dispose()`                                                                |
| `setValue` on a Vec2/Vec3/Vec4 field                           | throws in elics 3.4.x                                                    | use `entity.getVectorView(...)` (Color fields take `setValue` with hex or `Color`)    |
| Environment component on a non-root entity                     | silently ignored                                                         | `DomeGradient`/`IBLGradient` go on the level root only                                |
| `DomeFade` with no `DomeGradient` on the level root            | no fade; the floor keeps its hard edge                                   | add a `DomeGradient` (render stats report the DomeFade `inactiveReason`)              |
| `DomeTexture`/`IBLTexture` prop changed without `_needsUpdate` | change ignored                                                           | set `_needsUpdate` after writing; `DomeGradient`/`IBLGradient` apply edits without it |
| `ScreenSpace` given numbers                                    | clamped with a console warning                                           | it takes CSS strings: `'400px'`, `'25vw'`                                             |

## Verify before you claim it works

**Always `npm run --if-present typecheck` before testing.** Type errors stop systems
initialising without necessarily logging anything in the browser.

For a new multi-file procedural model, finish the initial asset module and manifest
registration before `npx @iwsdk/cli dev up`; do not keep the browser live while its import
graph is half-written. Typecheck first, then launch the managed editor for inspection.

Then check the right status for the task — these are not interchangeable:

- scene/editor work → `scene_get_state`
- XR device or session actions → `xr_get_session_status`
- server readiness → `npx @iwsdk/cli dev status` (XR availability is not a server signal)

When something is missing but the console is clean: call
`browser_get_console_logs` with only `count` (a `level` filter hides errors), then
`ecs_find_entities` to confirm the entity exists and carries the components you
expect.

The non-obvious part is which observation proves what: the **editor** render does
not run application systems, so anything driven by a system must be verified with
`browser_screenshot` (runtime), not `scene_screenshot` (editor).

Pose, controller/hand alignment, and immersive interaction claims require an
active XR session (`npx @iwsdk/cli xr status`). A flat runtime screenshot taken
outside XR can prove that the app renders, but it cannot prove immersive pose or
interaction correctness.

**When the user wants to try the app in a headset themselves**, give them a
plain session, never a native-control one. A session started with
`--native-xr-control` hands the head pose and controllers of every Quest Browser
page it serves to the CLI, with or without a pairing token in the URL, so the
user's own movement does nothing. If this session was started with
`--native-xr-control`, or you cannot tell, first run
`npx @iwsdk/cli dev restart` with the session's own `--ai-mode` and without that
flag; say so before restarting. Then run `npx @iwsdk/cli dev status` and give the
user a plain URL, never a `runtime pair-headset` URL: on the same Wi-Fi network,
one from `data.runtimeUrls.network` (they accept the expected local certificate
warning); on a Quest connected over USB, run
`adb -s <serial> reverse tcp:<port> tcp:<port>` and give
`data.runtimeUrls.local`. Invoke `iwsdk-native-xr-test` only when you drive the
headset yourself: automating, scripting, or debugging the app on a USB Quest.
See [Testing Your Experience](https://iwsdk.dev/guides/02-testing-experience.html)
for the complete workflow.

**Meta VR Glasses are not a Quest.** Their view is much narrower (37° left and
right, 25° up, 43° down) and their main input is gaze plus a pinch. Before
claiming an app works on the glasses, or when it uses gaze or eye tracking,
invoke `iwsdk-glasses-test`: it sets the `metaVRGlasses` emulator device, checks
that content fits that view, and drives gaze and pinch from the CLI. A Quest
screenshot or the editor view cannot show that fit.

## MCP and CLI are one surface, not two

Nearly every capability exists both ways — `scene_render_file` and
`npx @iwsdk/cli scene render-file`, `ecs_find_entities` and `npx @iwsdk/cli ecs find`,
or `ui_inspect` and `npx @iwsdk/cli ui inspect`.
Discover CLI actions with the bare domain or domain help (`npx @iwsdk/cli scene` or
`npx @iwsdk/cli scene --help`); both list that domain's actions.

**CLI and MCP share the same target resolver and recovery policy.** A managed
command can recover a missing managed browser; it then returns
`browser_relaunched` with `outcome: "not_executed"`. Inspect the new state and issue
a fresh command. `outcome_unknown` means a dispatched mutation may have executed;
inspect state before retrying. Requests are never broadcast or replayed on
reconnect. Host browser tools can remain usable while a runtime bridge is loading.

Choose by the shape of the call, not by availability:

- **MCP** for one-off calls. Screenshot tools persist the PNG locally and return
  `screenshotPath`; read that file only when visual inspection is needed.
- **CLI** when you need to loop or script — rendering six views, or sampling a
  value twice to measure a rate — or when the response is big enough to be worth
  filtering before it reaches context. A render of a scene containing an
  instanced pattern returns an id for every expanded instance.

For screenshot-producing CLI commands, the default response writes the image to a
temporary file and returns a normal envelope with metadata under `data.result` and
the path at `data.screenshotPath`. `--output-file <path>` selects the destination and
keeps that same metadata, including hashes and render statistics. `--raw` instead
prints the raw runtime result, including base64 `imageData`; when both flags are
present, `--output-file` takes precedence and image bytes are omitted.

## Skills

Invoke `iwsdk-dev` first for any request that builds, extends, fixes, tunes,
or polishes the app. It privately selects the greenfield planner path or the
bounded established-app iteration path; do not look for those paths as separate
public skills.

The selected playbook routes work to the narrowest owning specialist:

- creating or materially changing one glTF or procedural 3D asset →
  `iwsdk-build-model`;
- arranging existing assets, scene JSON, cross-asset contacts, lighting,
  environment, or cameras → `iwsdk-compose-scene`;
- a mixed build → finish every new or changed model, including support and set assets,
  with `iwsdk-build-model`, then compose the scene with `iwsdk-compose-scene`;
- a model-local defect found during composition routes back to `iwsdk-build-model`;
  a placement or lighting defect stays in `iwsdk-compose-scene`.

UI authoring, physics, depth occlusion, grab and ray interaction testing, and
debugging (including ECS frame-stepping, in `iwsdk-debug`) have their own
project skills. Use them only when the selected `iwsdk-dev` playbook calls for
the matching specialty.
Invoke `iwsdk-upgrade` whenever the user asks to upgrade or bump IWSDK.
Two device-testing skills are invoked directly: `iwsdk-native-xr-test` whenever
you will drive the app on a connected Quest yourself (automate, script-test, or
debug it), never when the user wants to put the headset on and try it, and
`iwsdk-glasses-test` whenever the user targets Meta VR Glasses or asks for gaze
input.

Distribution skills are invoked directly too, without `iwsdk-dev`, when the
request ships an app rather than changes it: `iwsdk-hosting` to put it on a
public HTTPS origin, `iwsdk-pwa-packaging` for a PWA/TWA APK of the hosted
site, `iwsdk-offline` to keep it working without a connection, and
`iwsdk-metavr-native` for a standalone APK built with `@iwer/native`
(`npm run build:metavr`, a `native` section in `iwsdk.config.json`) and for
installing, running and debugging that APK. "Make an APK" alone is ambiguous:
ask which of the last two the user wants.

The failure worth guarding against is improvising a domain that already has a
skill because the naive approach looks tractable. Before hand-authoring scene
JSON, a 3D model, a UIKitML panel, or a physics body, invoke the owning skill.

## Layout

```
iwsdk.config.json      project authority: scene, assets, components, world, dev
src/index.ts|js        World.create() + explicit system registration
src/assets.ts|js       defineAssets() — shared runtime/editor catalog
src/components.ts|js   defineComponents() — shared runtime/editor catalog
src/scene-assets/      *.scene-asset.ts|js — parentless Object3D prototypes
public/scenes/         *.iwsdk.scene.json — composition only
public/ui/             *.uikitml — runtime-loaded panels
```

An app that added IWSDK to an existing project keeps these modules in
`src/iwsdk/` instead. `iwsdk.config.json` names the modules either way; the
`src/...` paths in this guidance mean the modules it names.

No barrel `index.ts` files. Keep component declarations free of system, DOM and
renderer imports; systems import the declarations, never the reverse.

## Conventions

- Systems use queries, never manually tracked entity arrays.
- Never allocate in `update()`. Allocate in `init()` as class properties.
- Prefer `queries.x.subscribe('qualify', ...)` over polling state each frame.
- Register every subscription teardown in `this.cleanupFuncs`.
- Use `signal.peek()` in `update()`; `.value` adds per-frame subscription overhead.
- Load assets through `AssetManager` / the manifest, never a raw `GLTFLoader`.
- Create entities with `world.createTransformEntity(...)`, never `scene.add()`.
- Use the `RayInteractable` component, never a manual `Raycaster`.
- Give a UI panel or button both `RayInteractable` and `PokeInteractable`.
  Fingertip touches only reach entities with `PokeInteractable`, so a
  ray-only panel ignores hand presses.
- VR targets 72–90 fps: 11–14 ms per frame. Treat per-frame allocation as a bug.
- Keep an Enter XR control on the flat page of every XR app: the starter's
  welcome-panel button, or your own UIKit or DOM button that calls
  `world.launchXR()`. If you remove the welcome panel, replace its button.
  `xr.offer` alone only adds a small "Enter VR" pill to the Quest Browser
  toolbar (labelled VR even for AR), which people miss, so the page looks like
  it has no way into XR.
- Keep app and game state that a person or agent will want to read or change
  (score, lives, gold, wave, phase, timers, debug switches) in ECS components,
  not module-level objects. `ecs query` and `ecs set-component` then read it and
  jump it to any state from the CLI or MCP, in the emulator and on a paired
  headset, without editing code or scripting the page.

**Browser automation is a last resort.** `dev up --allow-browser-automation`
enables `browser run`, which runs your own Playwright script inside the managed
browser. Before you reach for it, or for a temporary source edit such as
lowering a start value, to reach a hard-to-reach state, check whether that state
belongs in ECS. If it does, move it into a component as part of the work and
drive it with `ecs set-component`. Use browser automation only for what ECS and
the built-in tools cannot express, and say why.

## Deep reference

Look up IWSDK APIs with `npx @iwsdk/cli reference <op> --input-json '{...}'`
(the same tools are on MCP) instead of reading `node_modules`: `api`
`{"name":"World"}` for a known name, `search` `{"query":"PokeInteractable hand"}`,
`components` and `systems` to list every ECS type, `examples`
`{"api_name":"createSystem"}` for usage. `search` is a keyword search: give
identifiers plus a few words, not questions. The corpus ships inside
`@iwsdk/reference`, matches the installed version and needs no network or
warmup.

Harness-native scoped rules cover `public/scenes/**`, `public/ui/**`,
`src/assets.ts`, `src/scene-assets/**`, and `src/**/*.ts`. `AGENTS.md`-based
harnesses receive nested instruction files; Cursor and Copilot receive their
native rule formats. Skill procedures live in the selected harness's project
skill directory and state when they apply.
