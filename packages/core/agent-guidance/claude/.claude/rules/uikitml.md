---
paths:
  - "public/ui/**"
---

# UIKitML panels

HTML/CSS-shaped, not a browser engine. Validate rather than assume support.

**Numeric sizes are UIKit units (centimetres), not pixels.** `width: 95` is a
0.95 m panel. Font sizes follow the same scale: `font-size: 3` is 3 cm tall.

**Panels are single-sided and face +Z.** To aim one at a camera, yaw by
`atan2(dx, dz)` toward it — there is no 180° term. A back-facing panel renders
nothing, reports no error, and still returns `valid: true` from
`scene_render_file`; the only signal is its absence from
`renderStats.visibleNodeIds`.

Verified working: `display: flex`, `flex-direction`, `align-items`,
`justify-content: space-between`, `gap`, `margin-*`, `padding-*`, `width`,
`height`, `background-color`, `border-color`, `border-width`, `border-radius`,
`font-size`, `font-weight`, `color`, `text-align`, `cursor`. Tags `div`, `span`,
`button` all work.

Expand shorthands (`padding: 12 18` → four properties), use unitless
line-height multipliers, and prefer uniform `border-color`/`border-width` over
directional variants. Parser errors include source locations.

**Production builds drop unused Lucide icons.** They keep only icons named in
`public/**/*.uikitml`. Icons named only by UIKitML built at runtime or loaded
from elsewhere must be listed in `iwsdkDev({ bundle: { icons: [...] } })`, or
they fail after `npm run build`.

## Runtime API

Resolve the placed panel by **scene node id**, then elements by their `id`
attribute:

```ts
const panel = world.getSceneObject<UIKitMLAsset>('config-panel');
const chip = panel?.getElementById<UIKit.Text>('finish-gold');
chip?.addEventListener('click', onClick);
chip?.setProperties({ backgroundColor: '#d8e6f5', color: '#0e1116' });
```

`setProperties` updates both text (`{ text }`) and style
(`backgroundColor`, `color`, `borderColor`, `display`) — style changes do apply,
including over class-based styles from the `<style>` block. `UIKit.Text` is the
public element type; no deep import from `@pmndrs/uikit` is needed.

Three distinct identities, don't conflate them: the **manifest ID** names the
reusable asset, the **scene node ID** names the placed instance, and the element
`id` names a field inside it. Never depend on a transient entity index.

Give the panel node `RayInteractable` so clicks land.

The editor render does not run application systems, so `scene_screenshot` can
never prove a panel *behaves* — only `browser_screenshot`, against the runtime,
can.

---

For the authoring procedure — isolated preview, placement, editing, wiring
runtime behavior, and the completion checklist — use the `iwsdk-ui` skill rather
than improvising. This file is the format reference it relies on.
