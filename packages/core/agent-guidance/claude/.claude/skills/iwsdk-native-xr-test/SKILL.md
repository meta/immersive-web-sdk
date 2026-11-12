---
name: iwsdk-native-xr-test
description: Test an IWSDK app in a real Quest immersive session while controlling headset and controller poses through the IWSDK CLI. Use when the user asks to run, automate, or debug an app on a connected Quest rather than in desktop IWER emulation.
argument-hint: '[test scenario]'
---

# Test on a physical Quest

Run the app through an ADB-reversed localhost connection, enter the browser's
real immersive session, and use the ordinary IWSDK XR, ECS, scene, and browser
commands to observe and control it. The native browser continues to own
`XRSession`, frame scheduling, rendering, and tracking; IWSDK/IWER selectively
override poses and input for the test.

The requested scenario is in `$ARGUMENTS`.

## Safety and scope

- Use only public Android platform tools and IWSDK commands. Do not depend on a
  device-rental service, XRPilot, or internal Meta tooling.
- Always work with an explicit device serial. With exactly one authorized
  device in `adb devices`, use its serial. With several connected devices,
  require the user to name the serial to test; never choose one yourself. Pass
  `-s <serial>` to every ADB command and use the same serial as the IWSDK
  `headsetId`.
- Support Quest Browser only. Do not broaden the browser user-agent check.
- Keep the command bridge on loopback. Use `adb reverse`; never expose or
  forward the bridge over a LAN.
- Native control replaces the headset's native controller input sources with
  synthetic controllers for the duration of the test. Physical controller and
  hand-action playback are unavailable while the override is installed.
- `xr set-transform` applies absolute test poses, not offsets from live
  tracking.
- A first run may show an immersive-WebXR permission prompt in the headset.
  Ask the user to approve it physically, then relaunch. Do not automate that
  permission dialog.
- Always remove the ADB reverse and stop the dev session during cleanup,
  including after a failed test.

## Target the headset explicitly

A command without `runtimeTarget` always routes to the managed host browser,
never to a headset, even when a paired headset page is the only connected page.
This workflow starts with `--no-open`, so such a command fails with
`browser_not_launched`. Do not restart with `--open` to fix a headset command;
the managed browser never forwards commands to the Quest.

- Discover connected targets with `npx @iwsdk/cli runtime targets --raw`. Each
  entry in `targets` carries a nested `runtimeTarget` object and the `methods`
  that page supports.
- A headset page qualifies only when its entry has `deviceClass: "physical"`,
  `role: "app"`, `commandReady: true`, and a `headsetId` equal to the explicit
  serial.
- Copy the qualifying entry's complete `runtimeTarget` unchanged: `deviceClass`,
  `headsetId`, `pageId`, `tabGeneration`, and any returned `sessionId` or
  `browserEpoch`. Never rebuild it from separate fields, drop or edit a field,
  or pass the surrounding entry instead.
- Put it under the top-level `runtimeTarget` key of every headset command's
  `--input-json`, next to that command's own parameters. It is unrelated to the
  position-vector `target` parameter of commands such as `xr look-at`.
- Never select a headset page with `expectedTab` alone. It carries no
  `deviceClass` or `headsetId`, so the command stays on the managed browser.
- Never guess between candidates. If these rules do not identify exactly one
  page, or a command returns `ambiguous_target`, ask the user to close the extra
  app tabs in the headset, then rediscover. Do not fall back to list order, the
  newest entry, another headset, or an untargeted command.
- A reload or relaunch advances the page generation. After one, or after a
  `stale_browser_tab` or `target_unavailable` error, run `runtime targets` again
  and reselect with these rules. An old `runtimeTarget` stays fenced to its
  generation.
- `outcome_unknown` means the command may have executed. Never replay it.
  Rediscover the target, inspect state with read-only commands such as
  `xr status`, `ecs query`, or `scene transform`, and only then decide whether a
  new command is needed.
- Headset pages accept runtime commands only. Host-only browser tools, such as
  screenshots, snapshots, interaction, profiling, and console capture, return
  `unsupported_on_target`; check the entry's `methods` first.

To test several headsets in one dev session, set up each serial separately: one
`adb -s <serial> reverse` route and one `runtime pair-headset` call per device,
discovery by each device's own `headsetId`, and one recorded `runtimeTarget` per
headset. Send each command with the `runtimeTarget` of the headset it is meant
for; never reuse one headset's `runtimeTarget` for another.

## 1. Verify the app and device

Run `npm run --if-present typecheck` and fix type errors before device testing.

Run `adb devices` and settle the explicit serial as described above. Continue
only when that serial is in the `device` state. A `pending`, `offline`, or
`unauthorized` device is not ready.

This workflow expects a manifest-first app that imports
`virtual:iwsdk-project` and passes it to `World.create()`. For a hand-built
`WorldOptions` object, opt in explicitly with:

```ts
xr: {
  // existing XR options
  launchOnSessionGranted: true,
}
```

## 2. Start the native-control dev session

From the application root, run:

```bash
npx @iwsdk/cli dev up --native-xr-control --no-open
```

Inspect `npx @iwsdk/cli dev status` and record the numeric port from the
active runtime. Native-control sessions default to HTTP when the application
does not explicitly configure Vite HTTPS. The app is loaded from
headset-localhost through ADB reverse, so the default remains a trustworthy
WebXR origin. `--no-open` leaves the managed host browser unlaunched, so only
commands that carry the headset's `runtimeTarget` can run.

## 3. Install the ADB route and pair the headset

Replace `<serial>` and `<port>` with the values verified above:

```bash
adb -s <serial> reverse tcp:<port> tcp:<port>
npx @iwsdk/cli runtime pair-headset --input-json '{"headsetId":"<serial>"}' --raw
```

Record the returned `url`. It carries this headset's pairing token for the
current dev session; an unpaired headset page is refused and never becomes a
target. Continue only if the URL points at `localhost` or `127.0.0.1` on
`<port>`. Pair again after any dev-session restart.

## 4. Enter the real immersive session

Before each launch, run `npx @iwsdk/cli runtime targets --raw` and record the
`pageId` and `tabGeneration` of every physical target whose `headsetId` is
`<serial>`.

URL-encode the returned pairing URL without changing its host or dropping its
query, then launch:

```bash
adb -s <serial> shell am broadcast \
  -n com.oculus.vrshell/.ShellControlBroadcastReceiver \
  -a com.oculus.vrshell.intent.action.LAUNCH \
  -d apk://com.oculus.browser \
  -e uri "ovrweb://vr?uri=<encoded-pairing-url>"
```

Keep the nested URL encoded so `?`, `&`, and fragment characters cannot be
interpreted as parameters of the outer deep link.

Poll `npx @iwsdk/cli runtime targets --raw`. Select the qualifying target that
this launch created: its `pageId` was not recorded, or its `tabGeneration` is
higher than recorded. If exactly one target matches, record its complete
`runtimeTarget`. A physical target has this shape:

```json
{
  "deviceClass": "physical",
  "headsetId": "<serial>",
  "pageId": "<pageId>",
  "tabGeneration": 1,
  "sessionId": "<sessionId>"
}
```

If no target appears, check in the headset that the page loaded from the
pairing URL and did not redirect to a network hostname. If more than one
matches, ask the user to close the extra tabs and relaunch.

Replace `<runtimeTarget>` below with the recorded object, verbatim:

```bash
npx @iwsdk/cli xr status --input-json '{"runtimeTarget":<runtimeTarget>}' --raw
```

XR status must show an active `immersive-vr` or `immersive-ar` session. Its
`browserConnected` and `browserCommandReady` fields describe the managed host
browser, not the headset. If the session stays inactive, ask the user to accept
the one-time browser permission in the headset, then repeat this step from the
pre-launch record.

Do not use `iwsdk xr enter` for this step: that command accepts an emulated
offer, while this workflow must preserve the browser's native session.

## 5. Run the scenario

Discover the available command shapes before improvising:

```bash
npx @iwsdk/cli xr --help
npx @iwsdk/cli ecs --help
npx @iwsdk/cli scene --help
```

Add the recorded `runtimeTarget` to each command's `--input-json`, next to the
command's own parameters. Here `target` is the world position to aim at:

```bash
npx @iwsdk/cli xr look-at --input-json \
  '{"device":"controller-right","target":{"x":0,"y":1.2,"z":-1},"runtimeTarget":<runtimeTarget>}' --raw
```

The exact `runtimeTarget` both selects the intended headset page and rejects
stale commands after a page reload.

Use the same commands as desktop automation. Typical controls are:

- `xr set-transform` for headset or controller position/orientation.
- `xr look-at` to aim a controller ray at a world position.
- `xr set-select-value` or `xr select` for trigger/pinch interaction.
- `xr set-gamepad-state` for squeeze and controller buttons.
- `ecs query`, `ecs snapshot`, and `ecs diff` for authoritative state.
- `scene runtime-hierarchy` and `scene transform` to locate and measure
  rendered objects.

Prove behavior with state, not only screenshots. For an interaction test,
record the target transform or component state before the action, perform the
pose/input sequence, and show the corresponding state change afterward.

## 6. Exit and clean up

Run these cleanup actions individually even if an earlier assertion failed:

```bash
npx @iwsdk/cli xr exit --input-json '{"runtimeTarget":<runtimeTarget>}' --raw
adb -s <serial> reverse --remove tcp:<port>
npx @iwsdk/cli dev down
```

Use the most recently discovered `runtimeTarget` for `xr exit`. If it returns
`stale_browser_tab` or `target_unavailable`, rediscover and exit with the fresh
object; if it returns `outcome_unknown`, check `xr status` instead of repeating
the exit. Remove the reverse route from every device you configured.

Report:

- device serial (`headsetId`) and app URL used;
- the exact `runtimeTarget` of the final command;
- native session mode and enabled features;
- the selected target's command-ready state;
- pose/input actions performed;
- before/after evidence for the requested behavior;
- console errors or capability notes;
- confirmation that the reverse route and dev session were removed.
