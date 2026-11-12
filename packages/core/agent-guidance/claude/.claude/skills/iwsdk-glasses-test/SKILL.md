---
name: iwsdk-glasses-test
description: Test an IWSDK app for Meta VR Glasses — gaze-and-pinch input, the glasses' narrower field of view, and gaze preview on a Quest without eye tracking. Use when the user targets Meta VR Glasses, asks for gaze or eye-tracking input, or wants to check that content fits the glasses' view.
argument-hint: '[test scenario]'
---

# Test for Meta VR Glasses

Meta VR Glasses run the same WebXR app as Quest, with two differences that
break untested apps: a much narrower field of view, and gaze-and-pinch input
(look at a target, pinch either hand to select it). Prove both with the
desktop emulator first; use a Quest only for what the emulator cannot show.

The requested scenario is in `$ARGUMENTS`.

## What differs from Quest

| Property      | Meta VR Glasses                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Field of view | 37° left and right, 25° up, 43° down from the view direction (74° × 68°), the same for both eyes |
| Primary input | One gaze ray (`targetRayMode: "gaze"`) picks the target; a pinch from either hand selects        |
| Other input   | Hands; hand and controller far rays take over whenever gaze is disconnected                      |
| Frame rates   | 72, 90, 96, 100, 120 Hz                                                                          |
| Session modes | `immersive-vr` and `immersive-ar`, with the same features as Quest 3 plus `gaze-tracking`        |
| Gaze cursor   | None in production: each target must show its own hover and pressed feedback                     |

Because the view is short above eye level (25°) and tall below it (43°), put
UI and key targets level with or slightly below the eyes and near the middle.
Content that Quest shows comfortably at 40° to the side or 30° up is out of
view on the glasses.

## 1. Configure the project

In `iwsdk.config.json`, request gaze and hands, and select the glasses
emulator profile:

```json
{
  "world": {
    "xr": {
      "features": {
        "handTracking": true,
        "gazeTracking": true
      }
    }
  },
  "dev": {
    "emulator": { "device": "metaVRGlasses" }
  }
}
```

- Keep `gazeTracking` optional (`true`). `{ "required": true }` makes a
  runtime without gaze reject the whole session. The same holds for
  `handTracking`: keep it `true` unless the app cannot work without hands.
- `gazeTracking` is what registers `GazeSystem`. `world.features.gaze` only
  tunes it; it does not enable gaze on its own.
- Targets need no gaze-specific code: `RayInteractable`, `DistanceGrabbable`,
  UIKit controls and the `Hovered` and `Pressed` tags work for gaze as they do
  for hand rays.
- While testing, `world.features.gaze.showDebugReticle: true` draws a white
  hit reticle. Remove it before shipping.

Editing `iwsdk.config.json` restarts Vite in place and reloads the page, which
ends any XR session: enter XR again afterwards. Run
`npm run --if-present typecheck`, then `npx @iwsdk/cli dev up` (or wait for
`npx @iwsdk/cli dev status` to report `browserCommandReady: true` if it is
already running).

## 2. Confirm the glasses profile

```bash
npx @iwsdk/cli xr status
npx @iwsdk/cli xr enter          # only when no session is active
npx @iwsdk/cli xr status         # sessionActive must now be true
npx @iwsdk/cli xr get-device-state
```

Continue only when `xr status` reports `deviceName: "Meta VR Glasses"` and,
with the session active, `enabledFeatures` contains `"gaze-tracking"`, and
`xr get-device-state` has a `gaze` entry with `connected: true`. With the
Quest 3 profile, `deviceName` is `Meta Quest 3` and there is no `gaze` entry:
fix `dev.emulator.device` and re-check. `xr enter` can return
`success: true` even when the session request fails (for example, a required
feature the profile lacks), so always confirm `sessionActive`.

Neither command reports the glasses' field of view. The `fov` value in
`xr get-device-state` (90) is the emulator preview's vertical angle and is the
same for every profile. The glasses' view shows up as a black mask around the
runtime screenshot in step 3.

## 3. Check the field of view

List every element the user must see or reach (panels, buttons, targets,
instructions). `npx @iwsdk/cli xr list-targets` lists the interactables with
box centres and sizes; `npx @iwsdk/cli scene runtime-hierarchy` lists every
named object with its `uuid`, including labels and panels. Read each
element's position with
`npx @iwsdk/cli scene transform --input-json '{"uuid":"<uuid>"}'` and use
`positionRelativeToXROrigin`, which is in the same frame as the headset pose
in `xr get-device-state`. (`ecs query` returns the `Transform` relative to the
parent entity, not a world position.)

With the headset looking straight ahead (identity orientation, down −Z) and
the element at offset `(dx, dy, dz)` from the headset (`dz` negative, in
front):

- horizontal angle `atan2(dx, -dz)` must be within ±37°;
- vertical angle `atan2(dy, -dz)` must be between −43° and +25°.

Both angles are measured against the view axis, as the glasses' projection
and the emulator's mask are. Do not use the elevation
`atan2(dy, hypot(dx, dz))`: it under-reports the vertical angle of anything
off to the side. A point 35° to the side and 46° below the view axis is out
of view, but its elevation is only −40°.

Check corners, not just centres, and leave a few degrees of margin. For
objects, use the box corners from `xr list-targets`. For a UIKitML panel,
`npx @iwsdk/cli ui inspect --input-json '{"entityIndex":<n>}'` reports
`panel.computedSize` in centimetres; multiply by the panel's `globalScale`
from `scene transform` (or use `targetSize`, in metres, when it is not 0×0),
then place the rectangle at the panel's position with its rotation.
`xr list-targets` boxes for UIKit panels can be inflated, so do not use them
for panel corners.

Then capture one runtime image as visual evidence:

```bash
npx @iwsdk/cli browser screenshot --output-file /tmp/glasses-fov.png
```

Everything outside the glasses' view is masked black in the image. In the
default managed session, IWER's control panels cover the left and right of
the image and can hide content near the edges of the view. For an
unobstructed image, restart with `npx @iwsdk/cli dev restart --ai-mode agent`
(headless, no control panels). Tell the developer before switching modes.

Use the runtime screenshot, not `scene_screenshot`: the editor camera does not
use the glasses' view. Content clipped in the image or outside the angles
above must move closer to the view centre (or lower, rather than higher).

## 4. Test gaze and pinch

Gaze picks the target; hands only pinch. Switch to hands, and record what is
hovered before aiming so the check shows a change:

```bash
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli ecs find --input-json '{"withComponents":["Hovered"]}'
npx @iwsdk/cli xr look-at --input-json '{"device":"gaze","target":{"x":0,"y":1.2,"z":-2}}'
npx @iwsdk/cli ecs find --input-json '{"withComponents":["Hovered"]}'
```

Aim at a point on the target's visible surface. A box centre from
`xr list-targets` works for solid objects, but the centre of a ring or frame
is empty and the gaze ray passes through it. After aiming, `ecs find` must
list the target entity with `Hovered` (or the app must show its own hover
state). The default gaze looks straight ahead, so whatever is in front may
already be hovered: aim at another target first and show `Hovered` move.

- **Click or UIKit button:** `xr select` with `{"device":"hand-right"}`,
  keeping the default `duration`. A click needs press and release within
  300 ms: `xr select` with a long `duration` (for example 1 s), or
  `xr set-select-value` 1 then 0, shows `Pressed` (and the button's `active`
  state in `ui inspect`) but never clicks. Query the resulting app state
  afterwards. A select that ends the session, such as an Exit button, returns
  `runtime_command_failed` ("The XR session ended.") even though it worked:
  confirm with `xr status`. For a target that reacts to `Pressed` rather than
  a click, the tag only lasts for the press: run
  `xr select` with `"duration":2` in the background and `ecs find` `Pressed`
  during the hold.
- **Hold, grab or drag:** `xr set-select-value` with
  `{"device":"hand-right","value":1}`, move the hand with `xr set-transform`
  or `xr animate-to`, query while held (`Pressed`, `Grabbed`, the transform),
  then release with `value: 0` and query again. With the default
  `pointerTransformFollowsHand`, a gaze-started grab follows the pinching
  hand's movement, not the gaze.
- **Either hand:** repeat one selection with `hand-left`; both hands commit.

Gaze reports `pointerType === "ray"` with `source: "gaze"` in its pointer
state, so the app's ordinary ray handlers receive it.

## 5. Test fallback and priority

```bash
npx @iwsdk/cli xr set-connected --input-json '{"device":"gaze","connected":false}'
```

With gaze disconnected, hand far rays must target and select again (aim a hand
with `xr look-at` and select). Reconnect gaze with `"connected":true` and
confirm it owns targeting again: the hand ray's hover is dropped and the gaze
target is hovered. A near touch or grab with either hand suppresses gaze while
it lasts; test that when the app mixes near and far interaction.

Read the console with `npx @iwsdk/cli browser logs` (no level filter) and keep
the `[iwsdk][gaze]` lines. `browser logs` works on the managed browser only: a
physical headset target returns `unsupported_on_target`, so on a Quest read the
console through Chrome remote debugging
(`adb -s <serial> forward tcp:9222 localabstract:chrome_devtools_remote`, then
`chrome://inspect`).

| Message                                                | Meaning                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `'gaze-tracking' granted for this session`             | The runtime granted the feature                                                               |
| `'gaze-tracking' was NOT granted`                      | The runtime refused the feature                                                               |
| `gaze XRInputSource appeared`                          | A gaze source is present (also after a reconnect)                                             |
| `eye pose is valid — real gaze data is flowing`        | Real eye tracking is delivering poses                                                         |
| `emulated gaze pose is valid`                          | The emulator or a Quest mode supplies synthetic gaze: expected in testing                     |
| `the gaze XRInputSource disappeared`                   | Gaze disconnected; hand and controller far rays target                                        |
| `no XRInputSource with targetRayMode === "gaze"`       | No gaze source appeared within 3 s of session start                                           |
| `getPose(targetRaySpace) returned null`                | The source has no valid pose                                                                  |
| `mapping XRTargetRaySpace onto the head pose`          | On real glasses, the runtime returned head-directed gaze: a runtime problem, not an app one   |
| `emulated gaze still points where the head does`       | Emulated gaze has not been aimed yet: aim it with `xr look-at`                                |
| `target-device preview is intentionally providing ...` | The hands-on Quest preview (step 6) is running: expected                                      |
| `renderer has no XRFrame or reference space yet`       | Printed once at session start on Quest; a problem only if it repeats                          |

## 6. On a Quest headset (optional)

Quest 3 and 3S have no eye tracking, so a Quest checks real rendering, frame rate
and native hands, not gaze accuracy. In both modes below the headset renders
its own, wider field of view (about 45° to 49° to each side, 48° up and 50°
down on a Quest 3S), and `xr get-device-state` reports the emulator's
synthetic `fov: 90`. Keep using step 3 for framing.

- **Hands-on preview:** add `"targetDevicePreview": { "gazeSimulation": "head" }`
  under `dev` (the app must request `gazeTracking`) and run
  `npx @iwsdk/cli dev up` without `--native-xr-control`. On Quest Browser,
  the dev server keeps the browser's own viewer, hands and controllers and
  adds a gaze source that follows the head; while it is connected, hand and
  controller far rays are off. The user looks at a target and pinches with a
  real hand. It is dev-server only and left out of production builds.
  - Opening the app: the dev server uses HTTPS with a self-signed
    certificate. On the same Wi-Fi, open a `data.runtimeUrls.network` URL and
    accept the certificate warning. Over USB, run
    `adb -s <serial> reverse tcp:<port> tcp:<port>` and open
    `https://localhost:<port>/` (`http://` does not connect) and accept the
    warning, or set `iwsdkDev({ https: false })` in `vite.config.ts` to serve
    HTTP: `http://localhost` through `adb reverse` is a secure context, so
    there is no warning.
  - Enter XR with the app's Enter XR button or the browser's Enter VR
    button; this mode does not enter on its own. The first entry for each
    origin (`http://` and `https://` are separate) shows Quest Browser's
    hand-tracking permission prompt: ask the user to choose Allow.
  - To read state from the CLI, pair the page first: open the URL from
    `runtime pair-headset` and use its physical `runtimeTarget` as in
    `iwsdk-native-xr-test`. `ecs find`, `ecs query`, `xr status` and
    `xr look-at` with `"device":"gaze"` work (look-at sets the gaze direction
    relative to the head). Hand, controller and headset commands such as
    `xr select` and `xr set-transform` report success but do nothing in this
    mode, and `xr get-device-state` lists hands and controllers the session
    does not have: only a real pinch selects.
- **Scripted run:** follow the `iwsdk-native-xr-test` skill with
  `dev.emulator.device` set to `metaVRGlasses`. `dev up --native-xr-control`
  replaces the headset's inputs with the glasses profile (synthetic
  controllers or hands, plus a gaze source), so steps 4 and 5 run on the
  device with each command's `runtimeTarget`; only `browser logs` is
  unavailable there (see step 5). `targetDevicePreview` is ignored in that
  mode.

## Rules

- Do not treat head-directed gaze (the preview, or the emulator's **Head**
  gaze mode) as proof of eye-tracking accuracy. It proves the interaction
  plumbing only.
- Do not add a head-pose fallback for missing gaze in production code: when
  gaze is unavailable, IWSDK hands targeting back to hand and controller rays.
- Do not move gaze with `set-transform` position: gaze takes orientation only
  and its origin follows the headset.
- Do not claim a fit from a Quest screenshot or the editor view; only the
  glasses profile in the desktop emulator has the narrower field of view.

## Report

- emulator device and enabled XR features (gaze granted or not);
- each checked element with its horizontal and vertical angles, and any that
  fall outside the glasses' view;
- each gaze target: hover evidence, the pinch used, and the state change;
- fallback result with gaze disconnected;
- `[iwsdk][gaze]` console lines and other errors;
- for a headset run, its serial, which Quest mode was used, and whether the
  page was paired.
