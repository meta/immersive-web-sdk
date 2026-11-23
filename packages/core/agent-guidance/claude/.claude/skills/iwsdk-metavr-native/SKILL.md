---
name: iwsdk-metavr-native
description: Build, install, run and debug an IWSDK VR or AR app as a standalone Quest APK with @iwer/native (alpha), which runs the app's own JavaScript on the headset without Quest Browser. Use when the project has a `native` section in iwsdk.config.json or a `build:metavr` script, when the user asks for a native or browserless Quest build, or when a dist-metavr APK fails to pack, launch, enter XR or fetch. Not for PWA/TWA store packaging of a hosted site (iwsdk-pwa-packaging) or for driving Quest Browser over ADB (iwsdk-native-xr-test).
argument-hint: '[goal, e.g. "add a native build", "the APK shows black"]'
---

# Native Quest APK (@iwer/native, alpha)

`npm run build:metavr` runs `vite build --mode metavr && iwer-native pack`.
The Vite step is a normal production build without the IWER emulator, and with
the `native` section of `iwsdk.config.json` left out of the bundle. `pack` puts
`dist/` into a template APK that carries the @iwer/native runtime (V8, WebGL 2
over OpenGL ES, fetch, Web Audio, workers, a DOM stand-in, WebXR over OpenXR)
and signs it in Node. The result, `dist-metavr/<appName>.apk`, runs on the
headset with no browser and no server: app files load from the APK.

User request is in `$ARGUMENTS`.

```
0. Pick the route      → native APK, or PWA/TWA (iwsdk-pwa-packaging)
1. Set up              → IWSDK ≥ 1.2, @iwer/native, native section
2. Fit the app         → VR only, offers XR, no HTML UI, allow-listed origins
3. Build and launch    → doctor → build:metavr → install → run
4. Verify on device    → logcat, debug endpoint, state hook
5. Ship                → package id, signing, --release
```

The package README is the reference for every config key, API and error:
`node_modules/@iwer/native/README.md`. Read its support matrix, Known
limitations and Troubleshooting before you promise a feature works natively.
Trust it over this skill if they disagree; the alpha changes between releases.

## Step 0 — Native APK or PWA?

| | **Native APK (this skill)** | **PWA/TWA (`iwsdk-pwa-packaging`)** |
| --- | --- | --- |
| Runs in | the @iwer/native runtime | Quest Browser, from a live URL |
| Needs hosting | no, files are in the APK | yes, a public HTTPS origin |
| Web fixes ship by | a new APK | redeploying the site |
| App modes | immersive VR and AR (passthrough) | immersive VR, AR, 2D panel |
| Web platform | the subset in the README matrix | the full browser |
| APK size | about 47 MB of runtime + assets | small wrapper |

Ask when the user says only "make an APK". Choose native for an offline,
self-contained immersive app; choose the PWA for a 2D panel, HTML UI, or an
app that depends on browser APIs the matrix marks "not yet" or "out of
scope".

## Step 1 — Set up

Requirements: `@iwsdk/core`, `@iwsdk/vite-plugin-dev` and `@iwsdk/create` 1.2.0
or later (1.1.0 rejects the `native` key), Node 20.19+, `adb` on `PATH` (or
`$ADB`/`$ANDROID_HOME`), and a Quest in developer mode with USB debugging
accepted. No Android SDK, NDK or Gradle is needed.

- **New project:** `npm create @iwsdk@latest <name> -- --target vr --metavr-native`
  (or `--target ar`).
  It adds `@iwer/native` (pinned), the `build:metavr` script, a `native`
  section and `dist-metavr/` in `.gitignore`.
- **Existing IWSDK project:** run `npx @iwsdk/create@latest . --yes --target <vr|ar> --metavr-native`.
  It adds the script, the dependency and the ignore entry but keeps your
  `iwsdk.config.json`, so add the section it prints yourself:

  ```json
  "native": {
    "packageId": "com.example.myapp",
    "appName": "myapp",
    "network": { "allow": ["https://cdn.jsdelivr.net"] }
  }
  ```

  Without it, `pack` stops at `iwsdk.config.json has no "native" section`.

Then `npx iwer-native doctor`. It checks Node, adb, the connected headsets, the
native config, signing and the bundled template. Fix every `[fail]` before
building. The `com.example` warning is fine for sideloading.

## Step 2 — Fit the app to the runtime

- **Immersive only.** `world.xr.mode` `"vr"` or `"ar"`; there is no 2D page, so
  a Desktop 3D (`world.xr: false`) app cannot be packed. For `"ar"`, `pack`
  declares passthrough itself. Plane, mesh, hit-test and anchor support needs a
  room from Space Setup and is not yet device-tested in a real room (README
  Known limitations): verify scene-understanding features on the headset.
  A feature marked `required` that the headset lacks rejects the session, and
  the app never leaves the splash: a Quest 3S has no depth sensing, so
  `depthSensing: { required: true }` never starts there. Prefer optional
  features and feature-detect them, and note the headset model you tested on
  (`iwn-host.mjs info`). With several headsets attached, always pass `--serial`.
- **The app must offer XR.** Keep `world.xr.offer` at `"always"` (the default)
  or `"once"`. The runtime shows only WebXR content: with `"none"` the app stays
  black and logs `XR-LIFE-7` after 10 s.
- **No HTML UI.** There is no layout, CSS or pointer/keyboard event. Build UI in
  3D with IWSDK spatial UI (`iwsdk-ui`). DOM overlays do not draw.
- **There is no browser to exit to.** Ending the session (the starter's
  "Exit to Browser" button, `world.exitXR()`) makes `offer: "always"` start a new
  session at once, so the button only flickers. Hide such controls in native
  builds and let the system menu quit:
  `const isNative = navigator.userAgent.includes('IWERNative');`
- **Network allow-list.** Only origins in `native.network.allow` are reachable
  (`https://host[:port]`, no path). The starter needs `https://cdn.jsdelivr.net`
  for its controller models. Prefer bundling assets in `public/` so the app works
  offline. No WebSocket, IndexedDB, Cache API, service worker or HTTP cache.
- **Media.** `<video>`/`<audio>` file playback is not supported; use Web Audio
  (`AudioContext`, buffer sources, gain, panner, `decodeAudioData`).
- **Check compatibility:** `npx iwer-native compat` (static) and
  `npx iwer-native compat --trace` (a headless run into XR). `pack` runs the
  static check and fails on an injected emulator; `pack --strict` fails on any
  unsupported API. Treat the `WebAssembly.instantiateStreaming()` warning on an
  IWSDK physics or UI build as expected: Havok and the MSDF worker fall back to
  `WebAssembly.instantiate`, and physics runs. Act on every other warning: feature-detect
  the API or drop it (`compat --verbose` shows the call site).

## Step 3 — Build, install, run

```bash
npm run --if-present typecheck
npm run build:metavr                    # dist-metavr/<appName>.apk, debug build
npx iwer-native install --serial <serial>
npx iwer-native run --serial <serial>   # or: npx iwer-native pack --install --run
```

The loop is quick (build about 5 s, pack under 1 s, install about 10 s), so
rebuild instead of reasoning about stale state. Always pass `--serial` when
more than one device is connected. Debug and release builds write the same
path; the last `pack` wins.

**Before blaming the app, check what the headset shows:**

```bash
adb -s <serial> shell dumpsys activity activities | grep topResumedActivity
```

- `com.example.<app>/android.app.NativeActivity` → the app is in front.
- `GuardianDialogActivity` ("Finding position in room") or
  `LaunchCheckRequires6dofDialogActivity` ("Turn on tracking") → the headset has
  lost tracking, usually because the room is dark or the cameras are covered.
  `run` then reports `adb did not finish within 60 s`. A native APK needs 6DoF
  tracking: ask the user for light. If the dialog stays after tracking is back,
  `adb -s <serial> reboot` clears it.
- Any other system dialog (permissions, first-run notices) → ask the user to
  answer it in the headset, or read its buttons with
  `adb shell uiautomator dump` and answer it only if the user allowed you to.

## Step 4 — Verify on the device

IWSDK's CLI and MCP tools (`ecs`, `xr`, `scene`, `browser`) reach the managed
browser and paired Quest Browser pages, **not** a native APK. On the APK use:

1. **Logs:** `adb -s <serial> logcat -v tag | grep '/iwn'`. Every runtime tag
   starts with `iwn`; app `console.*` output is `iwn-js`. A healthy launch logs
   `xr: first WebXR frame`, then `xr-stats fps=72…` lines every few seconds.
   Lines from an older process of the same app (another PID) are not this run.
2. **The debug endpoint** (debug builds; `pack --release --inspector` for a
   release build). Forward it, then use the bundled client:

   ```bash
   adb -s <serial> forward tcp:9229 localabstract:<packageId>_devtools_9229
   kit="$(dirname "$(find .claude/skills .agents/skills -path '*/iwsdk-metavr-native/assets/iwn-host.mjs' -print -quit)")"
   node "$kit/iwn-host.mjs" eval 'document.title'
   node "$kit/iwn-host.mjs" shot shot.png left 0.5   # what the eye buffer shows
   node "$kit/iwn-host.mjs" stats                     # fps, GC, heap, boot timings
   ```

   `adb shell screencap` is black during an immersive session; use `shot`.
   The shot follows the live head pose: a headset lying on a desk looks
   wherever it points. It holds the app's layer only; in AR, passthrough is
   not in it, so empty areas come out blank.
3. **App state.** The APK has no IWSDK command bridge, so expose the world for
   tests yourself, only when asked for:

   ```ts
   if (new URLSearchParams(location.search).has('iwsdkDebug')) {
     (globalThis as { __world?: World }).__world = world;
   }
   ```

   Launch with `npx iwer-native run --query iwsdkDebug=1`, then read state with
   `eval` (for example `__world.player.position.toArray()`, or a value from
   one of your components). Keep state you want to check in ECS components, as
   AGENTS.md asks.
4. **A debugger:** `npx iwer-native run --inspect --forward 9229`, then open
   `chrome://inspect` and add `localhost:9229`. If the port is
   `still in use`, another debug build holds it:
   `adb shell am force-stop <its packageId>`.

**Scripted input does not exist on the APK.** You cannot press, grab or point
from the CLI. Prove interaction logic in the emulator or Quest Browser with
`iwsdk-grab`, `iwsdk-ray` and `iwsdk-native-xr-test` (the same IWSDK code runs
there), and use the APK for what only it can show: that the app starts and
enters XR, renders, holds frame rate, loads its assets, reaches its network
origins, and that physics and audio run. Say which claims were verified where.

## Step 5 — Ship

- Replace `com.example.*` with your own reverse-domain `packageId`; stores
  reject `com.example`. A changed id installs as a separate app.
- Add a `signing` section (keystore path plus the names of the environment
  variables that hold the passwords) and build with
  `npx iwer-native pack --release`. Never write passwords into
  `iwsdk.config.json` or commit a keystore. Without `signing`, `--release` signs
  with the debug key and warns.
- Raise `versionCode` for every upload. Set `icon` and `splash` (the README's
  Configuration section lists every key; `iwer-native validate` checks them).
- Installing a release over a debug build signed with another key fails with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: `adb uninstall <packageId>` first.

## Report

State the APK path, size and package id, the device serial and OS build
(`node "$kit/iwn-host.mjs" info`), the compat result, what you verified on the
APK (with logcat lines, `eval` values or shots) and what you verified only in
the emulator or Quest Browser, and any warning you left in place with its
reason. For a runtime bug, collect what the README's Reporting issues section
lists.
