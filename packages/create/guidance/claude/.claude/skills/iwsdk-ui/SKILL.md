---
name: iwsdk-ui
description: Build or modify manifest-backed IWSDK UIKitML with bounded preview, placement, and runtime verification. Use for spatial panels, browser HUDs, UIKitML layout, fonts, editor previews, and runtime element behavior.
argument-hint: '(use the current request)'
---

# IWSDK UI

Deliver the requested UI as one verified vertical slice. Use the current request
from conversation context; do not ask the user to repeat it or create a separate
design document.

## Choose the required surface

Before editing, classify the request:

- **UIKitML only**: document layout, styling, fonts, or reusable controls;
- **spatial panel**: UIKitML plus manifest registration and a scene instance;
- **runtime UI**: either of the above plus element lookup, events, and state;
- **ScreenSpace HUD**: browser-camera UI that intentionally returns to its
  authored world transform in immersive XR.

Do not add placement, ScreenSpace, runtime state, or camera changes when the
request does not require them.

## Fast path

Inspect the relevant UI, asset manifest, active scene, and direct runtime caller
with one shell command that prints those files; do not issue a separate Read
tool call for every file. Then make the first coherent edit before broad
reference or dependency discovery. Use focused IWSDK reference queries only for
a concrete unsupported element, property, or runtime API question. Do not open,
grep, or list `node_modules` at any point in this workflow.

Strict image budget: during implementation, do not open any PNG, JPEG, or WebP
with the Read tool. Finish the runtime checks first. At the final visual gate,
create and open exactly one compact `artifacts/ui-runtime-review.jpg` contact
sheet as described below.

Keep the three stable identities explicit:

1. manifest asset ID;
2. scene node ID for a placed instance;
3. UIKitML element IDs used by application code.

Register each file under `public/ui/` as `AssetType.UIKitML` in the configured
asset manifest. UIKitML is the source of truth; do not generate an intermediate
JSON representation.

## Author the complete first pass

- UIKit numeric dimensions are centimeters (`100` is one meter).
- Use stable `id` attributes for every element code must address.
- Prefer supported explicit properties over CSS shorthand.
- Reuse the configured Horizon kit and bundled Lucide icons instead of
  registering replacements in application code.
- Production builds keep only the Lucide icons named in static
  `public/**/*.uikitml` files. UIKitML built or fetched at runtime (a string in
  `src/`, a file outside `public/`, a remote URL) works in `npm run dev` but
  fails after `npm run build` with `Unknown component <Settings>` and a hint.
  List those icons by component name in `vite.config.ts`:
  `iwsdkDev({ bundle: { icons: ['Settings'] } })` (`'all'` keeps all ~1,600,
  about 4 MB more). Check dynamic UIKitML in a production build.
- In the stock Horizon kit, `<Panel>` renders an opaque surface that follows
  the color scheme: dark at runtime when `spatialUI.preferredColorScheme` is
  `dark` (the scaffold default), white in editor previews. Give text a dark
  color plus a light `:dark` variant, as `public/ui/welcome.uikitml` does.
- Remote fonts can reflow layout. Use a local font when offline availability is
  a product requirement.
- Use plain ASCII punctuation in runtime status copy. Do not use em dashes,
  smart quotes, or other typographic punctuation unless the chosen local font
  has already rendered that exact glyph successfully.

For a scene-authored instance, use asset content and an explicit transform. In
the stock starter composition, a front-facing UIKitML panel at negative Z faces
the default player with identity rotation. Do not add `rotationDeg: [0, 180, 0]`
unless the existing app establishes that convention or a measured render proves
it necessary.

The default XR player and an authored non-XR `hero` camera can be on opposite
sides of a single-sided panel. Preserve the transform required by the requested
player viewpoint; if an authored evidence camera sees the back face, move or aim
that camera instead of rotating the product UI away from the player.

When adding UI to an established composition, preserve existing primary UI and
objects. Start from the app's scale and spacing. In the stock scaffold, use
roughly `0.25`-`0.32` scale for a secondary panel and keep a same-band panel at
least `0.75` world meters above the existing central panel, at the same or
greater depth. Prefer a centered safe region over fragile frame edges.

## Connect runtime behavior

Resolve a scene-authored panel by scene node ID:

```ts
const panel = world.requireSceneObject<UIKitMLAsset>('PanelNode');
const status = panel.requireElementById<UIKit.Text>('StatusText');
const action = panel.requireElementById('Btn_Action');
status.name = 'StatusText';
action.name = 'Btn_Action';
action.addEventListener('click', onAction);
cleanupFuncs.push(() => action.removeEventListener('click', onAction));
```

Assign exact runtime names when the request requires controls to be addressable.
Register listener cleanup. Do not locate panels by transient ECS index, manifest
URL, or internal document implementation details.

For a small scene-authored state machine, use the public ECS surface directly;
do not inspect `node_modules` to rediscover these contracts:

```ts
export const PanelState = createComponent('PanelState', {
  step: { type: Types.Int8, default: 0 },
  complete: { type: Types.Boolean, default: false },
});
export default defineComponents([PanelState]);

class PanelSystem extends createSystem({
  panel: { required: [PanelState] },
  activated: { required: [ActionMarker, Pressed] },
}) {
  init(): void {
    this.queries.activated.subscribe('qualify', () => this.advance());
  }

  private advance(): void {
    const panel = this.queries.panel.entities.values().next().value;
    if (panel == null) return;
    // Read and write scalar fields with getValue/setValue, then update UIKit.
  }
}
```

Query result `entities` is a `Set`; use iteration or
`entities.values().next().value`, never array indexing. `@iwsdk/core` re-exports
the Three.js types needed for visual feedback, and scene-authored systems may use
`Pressed` qualification plus the existing app's marker component. Clone shared
asset materials before per-instance color or emissive changes.

Imported models can use material arrays or emissive-capable material subclasses
that do not satisfy a narrow `instanceof MeshStandardMaterial` check. For an
explicit whole-body state tint, traverse every `Mesh`, normalize its material to
an array, clone each material with `emissive` and `emissiveIntensity`, assign the
clones back, and update all of them. If an existing `emissiveMap` masks the
requested solid diagnostic color, clear that map on the clones and set
`needsUpdate`; do not alter shared source materials.

```ts
object3D.traverse((child) => {
  if (!(child instanceof Mesh)) return;
  const source = Array.isArray(child.material) ? child.material : [child.material];
  const clones = source.map((material) => material.clone());
  child.material = Array.isArray(child.material) ? clones : clones[0];
  for (const material of clones) {
    if ('emissive' in material && 'emissiveIntensity' in material) {
      const stateMaterial = material as MeshStandardMaterial;
      stateMaterial.emissiveMap = null;
      stateMaterial.needsUpdate = true;
      stateMaterials.push(stateMaterial);
    }
  }
});
```

These are known public top-level exports: `createComponent`, `createSystem`,
`defineComponents`, `Types`, `Entity`, `Pressed`, `UIKitMLAsset`, `UIKit`,
`Color`, `Mesh`, `MeshStandardMaterial`, and `Object3D`. Import them directly
from `@iwsdk/core`. Typecheck the implementation; if an import fails, use the
compiler error or one focused IWSDK reference query. Do not inspect package
source, declarations, exports, or directories to reconfirm the export chain.

For immersive XR, default to a world-space panel or attach contextual UI to the
object it controls. Use a thresholded `Follower` targeting `world.player.head`
only when compact global UI must remain discoverable. Do not head-lock menus,
reading surfaces, or persistent panels; reserve direct `world.playerHeadEntity`
parenting for tiny, transient, non-interactive markers that require exact view
alignment. Do not use `ScreenSpace` expecting it to remain camera-attached in
XR. See https://iwsdk.dev/concepts/spatial-ui/hud.html for the placement
guidance.

Use `ScreenSpace` only for a real HUD requirement. Its dimensions and offsets are
CSS strings. Preserve the authored immersive transform and verify browser and XR
views independently when both modes matter.

## Verify with a bounded loop

Typecheck after the complete first slice, then start or reuse one managed
session. If no command-ready session exists, run `npx @iwsdk/cli dev up --open`
once. Do not call `dev --help`, separately call `dev open`, restart a healthy
session, start a second browser, or build a custom UIKit renderer.

1. Run `npx @iwsdk/cli ui assets --raw` once to confirm registration.
2. Render one isolated preview after the first complete layout:

   ```bash
   npx @iwsdk/cli ui render-preview \
     --input-json '{"assetId":"panel-id","width":800,"height":600}' \
     --output-file artifacts/panel-preview.png
   ```

   Always provide `--output-file`; do not accept a temporary screenshot path
   and add a separate copy step.

3. If spatial placement matters, render the authored hero view once; use
   `view` only for built-in presets:

   ```bash
   npx @iwsdk/cli scene render-file \
     --input-json '{"path":"public/scenes/main.iwsdk.scene.json","viewId":"hero"}' \
     --output-file artifacts/scene-hero.png
   ```

   Keep the full render result from this call so `visibleNodeIds`, validity,
   framing, and the PNG are checked together. Do not pipe it through
   `head`/`tail`/`grep` and rerun only to recover discarded metadata.

4. Find the panel entity, then inspect its live UIKitML state before and after
   exercising each required control through real pointer or XR input:

   ```bash
   npx @iwsdk/cli ecs find --input-json '{"namePattern":"^Welcome Panel$"}'
   npx @iwsdk/cli ui inspect --input-json '{"entityIndex":12,"selector":"#Btn_Action"}'
   ```

   Replace the example pattern with the panel's authored scene/entity name, and
   reuse the returned entity index rather than hard-coding the example value.

5. Capture one final runtime preview from the intended viewpoint. Reuse a
   required completion-state capture when it already provides that evidence.

For common CLI verification, use these forms directly rather than discovery:

```bash
npx @iwsdk/cli xr status
npx @iwsdk/cli xr enter --input-json '{}'
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":0,"y":1.5,"z":-2}}'
npx @iwsdk/cli xr select --input-json '{"device":"controller-right","duration":0.2}'
npx @iwsdk/cli ecs find --input-json '{"withComponents":["ComponentName"]}'
npx @iwsdk/cli ecs query --input-json '{"entityIndex":12}'
npx @iwsdk/cli ui inspect --input-json '{"entityIndex":12,"selector":"#Btn_Action"}'
npx @iwsdk/cli browser logs --input-json '{"count":30}'
npx @iwsdk/cli browser reload --input-json '{}'
```

For a file capture, use `npx @iwsdk/cli browser screenshot --output-file <path>`;
`browser_screenshot` does not accept an `outputPath` input field.

When a UI change requires a regression smoke for an existing
`DistanceGrabbable`, do not substitute a long `xr select` click. Aim at the
object, hold select with
`npx @iwsdk/cli xr set-select-value --input-json '{"device":"controller-right","value":1}'`,
query the entity while held to observe `Grabbed`, then release with the same
command and `"value":0`. Movement is unnecessary unless the request asks for
it.

When the request asks for a poke (near touch) on a control, press it with the
emulated hand's index fingertip by its element ID. The panel entity needs
`PokeInteractable`:

```bash
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"target":"Btn_Action","press":{}}]}' --timeout 45000
```

The press clicked when `presses[0].contactMs` is below 800; at 800 or more a
slow headless frame held the touch too long, so run the press once more. Confirm
the state change with `ui inspect`. `xr list-targets` lists the element IDs that
can be pressed.

The commands in this section are the supported path. Do not call broad
`iwsdk`, `ui`, `browser`, `ecs`, or `xr` help. If a shown command fails, use its
error output and the exact forms above to correct it instead of invoking
`--help`.

Batch layout fixes before rerendering. By default allow one isolated preview,
one authored-scene render, and one final runtime capture; add one replacement
preview only to verify a focused correction. Do not rerender after every small
edit, repeatedly restart the runtime, or use screenshots to debug input state.
Keep the whole task under roughly 80 tool calls by batching independent reads
and related state queries. Check console logs once after final behavior unless a
new edit creates a concrete reason to check again. Do not capture extra
diagnostic screenshots for states already proven by named queries.
For the final visual comparison, create one compact JPEG contact sheet with the
supplied baseline above the final live-runtime capture, then load only that one
image into model context. Do not load the full-size PNGs separately. On Windows,
substitute the two paths in this known command:

```powershell
powershell.exe -NoProfile -Command 'Add-Type -AssemblyName System.Drawing; $a=[Drawing.Image]::FromFile((Resolve-Path "BASELINE.png")); $b=[Drawing.Image]::FromFile((Resolve-Path "FINAL.png")); $w=600; $ha=[int]($a.Height*$w/$a.Width); $hb=[int]($b.Height*$w/$b.Width); $o=[Drawing.Bitmap]::new($w,$ha+$hb); $g=[Drawing.Graphics]::FromImage($o); $g.DrawImage($a,0,0,$w,$ha); $g.DrawImage($b,0,$ha,$w,$hb); $o.Save((Join-Path (Get-Location) "artifacts/ui-runtime-review.jpg"),[Drawing.Imaging.ImageFormat]::Jpeg); $g.Dispose(); $o.Dispose(); $a.Dispose(); $b.Dispose()'
```

`artifacts/ui-runtime-review.jpg` is the only image file to open with the Read
tool. Do not open isolated previews, hero renders, progress captures, completion
captures, the baseline PNG, or the final PNG separately.

Treat that contact sheet as a bounded layout sanity check, not a request to
visually prove every state detail. If it shows no blocking overlap, clipping,
unreadable primary UI, or accidental scene replacement, stop visual inspection.
Do not create follow-up zooms, crops, or object close-ups. Use the named ECS
state queries to prove interaction feedback; the evaluator will inspect the
saved progress and completion artifacts.

Render isolated, hero, progress, completion, and invalid-action files when the
task requires them, but do not open those files in model context; use render
metadata, named state queries, and file existence for those checks. After a
context compaction, continue from the measured state instead of rediscovering
package exports, CLI command families, or already accepted visual framing.

The final visual check must confirm:

- the complete panel is inside the expected frame;
- important text and controls remain readable at a compact preview size;
- primary text has clear contrast against the actual rendered surface;
- new UI does not touch or obscure existing primary UI or objects;
- required states differ through a coarse visible treatment, not only fine text.
  When the task explicitly asks for visually distinct progress/completion or
  success/error states, change at least a quarter of the panel surface (for
  example a substantial header block or whole-surface tint) and/or a major
  scene object's whole-body emissive treatment. A thin accent bar, small chips,
  icons, and copy changes alone are not sufficient evidence.

Finish with a passing typecheck and production build, no UIKit parser/resource
errors, and concise runtime evidence. Remove temporary preview files or camera
workarounds that are not deliverables.
