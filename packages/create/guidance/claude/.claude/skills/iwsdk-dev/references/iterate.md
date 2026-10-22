# Iterate path

Make the requested delta to the established app without reopening its product
definition. The existing working experience is the baseline and the requested
change is the scope boundary.

## Fast opening

To keep a bounded edit from turning into rediscovery, begin in this order:

1. Run the bounded source/scene/UI Bash command below.
2. Make a Write/Edit under `src/` or `public/` based only on that bundle. A
   small safe skeleton such as the requested component or UI asset is enough;
   finish it after typecheck if an API detail remains uncertain.

When the request names a state or component, prefer writing that exact
createComponent skeleton as the opening edit. Scene and UI schema details need
not block a safe scalar-state skeleton; let the first typecheck surface a real
API question. Do not reread root guidance or enumerate rule, skill, dependency,
or node_modules trees before the edit. If the harness did not automatically
load an applicable path-scoped instruction, include only that one instruction
in the bounded opening bundle. Preserve any authored view already present.

Do not insert unrelated discovery, CLI help, another skill, or broad reference
lookup between the bounded inspection and the first edit.

## Operating contract

- Do not create an experience brief, product plan, architecture document,
  retrospective, or review artifact unless the user explicitly requests it.
- Preserve existing scene anchors, interactions, state, UI, visual language,
  and behavior outside the requested delta. Do not replace the app with a new
  concept or rebuild working systems for stylistic consistency.
- Inspect the smallest source/scene/UI bundle that establishes the affected
  path and its immediate dependencies in one bounded shell call, then make the
  mandatory opening edit before any additional discovery.
- Record the acceptance contract mentally or in the active response: requested
  behavior, preserved behavior, observable state, and visual consequence. Do
  not write a process document.
- Reuse the app's existing component, system, asset, naming, and UI patterns.
  Introduce a new abstraction only when the requested change cannot fit the
  current structure cleanly.
- Treat preserved ScreenSpace UI as occupying its authored transform in
  immersive mode even when its browser presentation differs. Reuse established
  panel scale and spacing. For the stock scaffold layout, a new front-facing
  panel in the same horizontal band should start at 0.25-0.32 scale, at least
  0.75 world meters above the preserved panel center, and at the same or greater
  depth. Keep that separation during corrections; move laterally into clear
  space rather than lowering it into the object interaction band.
- Invoke `iwsdk-build-model` before materially changing a model and
  `iwsdk-compose-scene` before changing scene placement, lighting, environment,
  or cameras. Invoke other matching specialists only after a concrete uncertainty
  or the first failed required interaction. After that first failure, do not sweep
  coordinates, read screenshots for interaction debugging, or inspect pointer,
  input, grab, ray, or UIKit internals in `node_modules`; use the specialist and
  measured ECS/UI state.
- Before the first typecheck, do not read specialist references or inspect
  `node_modules`. Import IWSDK ECS, UIKit, interaction, material, and Three.js
  re-exports from `@iwsdk/core`; use
  `createComponent('Name', {field: {type: Types.Int8, default: 0}})` directly.
  Let `npm run --if-present typecheck` produce the exact remaining API question.

Use this opening command shape directly, tolerating missing paths and keeping
the output bounded. The existing scaffold rules are already in context:

```bash
{
  for f in iwsdk.config.json package.json \
    $(find src -maxdepth 2 -type f \
      \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort) \
    $(find public/ui -maxdepth 2 -type f \
      \( -name '*.uikitml' -o -name '*.json' \) 2>/dev/null | sort) \
    $(find public/scenes -maxdepth 2 -type f \
      -name '*.json' 2>/dev/null | sort); do
    if [ -f "$f" ]; then
      echo "=== $f ==="
      sed -n '1,220p' "$f"
    fi
  done
} | head -c 32000
```

## Implementation loop

1. Inspect the affected files plus the active scene and UI in one bounded call.
2. Identify the current behavior that must remain unchanged.
3. Implement the smallest complete vertical delta, including state/UI feedback
   and recovery when the request needs them.
4. Run one batched typecheck and fix errors together.
5. Start the managed runtime directly with
   `npx @iwsdk/cli dev up --headless --timeout 45000`.
6. Exercise the changed path with real user input and query only the named state
   needed to prove it. Direct ECS mutation may prepare/reset a scenario but is
   not interaction proof.
7. Run one focused regression smoke for the preserved behavior most likely to
   have been affected.
8. Run the production build and stop.

Use the known CLI surface without help discovery: `xr status|enter|look-at|select`,
`ecs find|query`, `browser screenshot`, and `scene render-file`. These call
shapes are authoritative; substitute the requested target, entity index, and
artifact name instead of running family-level or subcommand `--help`:

```bash
npx @iwsdk/cli xr enter --input-json '{}'
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":0,"y":1.5,"z":-2}}'
npx @iwsdk/cli xr select --input-json '{"device":"controller-right","duration":0.2}'
npx @iwsdk/cli ecs find --input-json '{"namePattern":"Requested Name","limit":10}'
npx @iwsdk/cli ecs query --input-json '{"entityIndex":1,"components":["RequestedState"]}'
npx @iwsdk/cli browser screenshot --input-json '{}' --output-file artifacts/final.png
npx @iwsdk/cli scene render-file --input-json '{"path":"public/scenes/main.iwsdk.scene.json","viewId":"hero","width":800,"height":800}' --output-file artifacts/hero.png
```

After `dev up`, target at most 32 Bash calls for all interaction and visual
verification. Batch each look-at, input, and state query into one shell call.
Run the full end-to-end sequence once; after a measured failure, patch the
cause and rerun only the affected path.

## Efficiency budget

Treat 90 total tool calls, 36 shell calls after dev startup, two image
previews, two runtime restarts, and two authored-scene renders as default upper
bounds for a bounded edit. Avoid CLI help calls when the known command shapes
below apply. These guardrails prevent verification from becoming open-ended;
they do not justify omitting required acceptance evidence.

At roughly 70 tool calls, drop optional diagnostics and finish only missing
evidence. At 80, freeze optional polish, save required artifacts once, run the
production build, and close the task.

For
`DistanceGrabbable`, hold/release gamepad button index `0`; for proximity
`OneHandGrabbable`/`TwoHandsGrabbable`, use squeeze button index `1`.
The focused distance-grab smoke is not another `xr select`: aim at the preserved
object, run
`npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-right","buttons":[{"index":0,"value":1}]}'`,
observe `Grabbed` or movement, then repeat with `value:0` to release.

For hand input (poke, pinch-grab, gestures), switch with
`xr set-input-mode` `{"mode":"hand"}` and drive the hand by target name with one
`xr run-sequence` per interaction (`--timeout 45000`). `xr list-targets` names
the interactable entities and their UIKitML element IDs. Press a button with
`press`, never a pinch; a near grab needs `grabbing.useHandPinchForGrab` (on by
default):

```bash
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"target":"Btn_Action","press":{}}]}' --timeout 45000
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"target":"Requested Name","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},{"position":{"x":0,"y":1,"z":-0.5},"depart":{"distance":0.08}}]}' --timeout 45000
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"pinch":0,"duration":0.15}]}'
```

Query `Grabbed` between the grab and the release. A press result whose
`presses[0].contactMs` is 800 or more did not click. Slow headless frames can
stretch a press that far, so run that press once more before changing code.

If a scene/source/UI edit happens after the managed runtime started and live
state becomes stale, do not call `scene open`, repeatedly poll `dev status`, or
loop on browser reload. Run one
`npx @iwsdk/cli dev restart --headless --timeout 60000`, then resume the named-state
check. One failed restart may be diagnosed once; do not enter a recovery loop.

Do not perform a full product replay when the edit affects one bounded path.
Expand verification only when a measured failure shows broader impact.

## Visual comparison

Use the supplied pre-edit baseline when present. Pixel reads have a hard ceiling
of two: one bounded baseline or final comparison and one replacement after a
focused correction. Never read aim, hover, panel, coordinate, or duplicate debug
screenshots. Debug interactions with state, not pixels.

Never load a full-resolution PNG into model context. Preserve deliverable
images unchanged, but create a temporary JPEG preview no wider than 600 pixels
at about 70% quality with an image tool already available in the environment.
Do not install a dependency only to resize evidence, and delete the temporary
preview after the visual decision.

Do not use repeated `scene render-file` calls to discover framing. When an
authored hero view must be checked, run it once and read
`data.result.renderStats.visibleNodeIds`; make at most one focused camera or
composition correction from that result. The second render is the final hero
attempt even if it fails; do not issue a third `scene render-file` call.

Do not reconcile hero and default-player framing with trigonometry, coordinate
sweeps, repeated screenshots, or browser logs. Keep the panel identity-rotated
for the player. If the one hero check misses it, move only the existing hero
camera to the same side of the panel as the default player, check once more,
and freeze. Inspect browser logs at most once and only after a command returns
an explicit runtime error; never create a log-debugging loop.

Preserve the existing composition and visual language unless the request asks
to change them. When it does, compare the same viewpoint before and after and
make one focused correction for clipping, legibility, contrast, or hierarchy.
When adding a new primary spatial panel, it must be readable at the default
runtime viewpoint rather than a tiny accessory: keep its visible bounds at
least roughly 12% of frame width and 8% of frame height, but normally below 70%
of frame width and 40% of frame height, while staying fully inside the frame.
It must not cover the preserved product primary object, existing primary UI,
or focused regression object. Readability alone is insufficient: visible
bounds must not touch or overlap. Leave roughly 3% of the frame as clear
separation. If the first preview shows contact, move the new panel into the
largest empty region above or beside the preserved composition.

Use an opaque or strongly contrasting panel surface. Primary copy must be dark
on light or light on dark; white or pale text on translucent white, sky, or
another bright background fails even when the glyphs are technically present.
For the scaffold's Horizon `<Panel>`, assume the kit's opaque surface wins
over a custom root `background-color`. That surface follows the color scheme:
the runtime renders it dark because `iwsdk.config.json` prefers `dark`, while
editor previews render it white. Give every text class a dark color plus a light
`:dark` variant, as `public/ui/welcome.uikitml` does, so copy reads on both.
Do not spend a restart discovering dark-on-dark or white-on-white text that the
stock kit behavior already predicts.

Reuse the established app panel scale and spacing when available. In the stock
starter-scale composition, a new front-facing UIKitML panel should begin at
0.25-0.32 scale. If it shares the central horizontal band, place its center at
least 0.75 world meters above the preserved panel and at the same or greater
depth; side-by-side placement needs a clear gap beyond both half-widths. Keep
that separation through the one allowed correction.

On the first final preview, inspect the whole change together: new UI is fully
inside the frame; a visible gap separates it from existing primary UI and
objects; important copy and controls remain readable at preview size; and text
has strong contrast against its actual rendered surface. Batch one correction
for all failures, then take the second and final preview.

Keep primary added UI away from fragile frame edges unless the established
composition reserves a stable edge region. XR captures may use a square or
otherwise narrower aspect ratio than the browser. Prefer an above-central
placement over pushing a panel to the side, and retain a generous lateral
margin before accepting the final preview.

Progress and completion evidence must remain distinguishable at the compact
600-pixel preview scale. Do not rely on changing only one short status sentence.
Use one coarse, deliberate milestone change such as a large status chip or bar,
clearly marked step indicators, or a strong color/state change on both the
panel and the affected object. The changed treatment should occupy a visible
region of the panel and make completion obvious without reading fine print.

For a front-facing UIKitML panel in the stock starter layout, keep rotationDeg
absent unless the existing app establishes another convention. Do not calculate
a look-at yaw solely to face the default player: the stock panel front is
face-on at identity. Judge the final result from a fresh default runtime
viewpoint, without custom headset repositioning before capture.

For XR work, keep the immersive session active through the final browser
screenshot. Immediately before capture, check XR status and enter once if the
session is inactive. A non-immersive browser camera is not placement evidence
for world-space UI; return to the default immersive viewpoint instead of moving
correctly placed content to satisfy the unrelated browser view.

## Stop rule

Stop when the requested delta works through real input, the named state/UI
evidence passes, the focused preserved-path smoke passes, the production build
passes, and required evidence files exist. Do not reopen unrelated polish or
review after those gates pass.
