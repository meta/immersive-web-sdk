---
name: iwsdk-build-model
description: Build or materially repair one reusable IWSDK 3D model as a glTF or deterministic parentless Three.js Object3D, including geometry, surface-relative detail, materials, semantic hierarchy, isolated inspection, and focused refinement. Does not arrange scenes, lighting, environment, or cameras; use iwsdk-compose-scene for those.
---

# IWSDK Build Model

Create one reusable model, prove that it works from multiple viewpoints, and hand a
stable manifest asset to `iwsdk-compose-scene`. This skill owns object-local geometry,
materials, hierarchy, proportions, and detail. It does not own scene JSON or the
placement of one asset relative to another. When a scene needs several new models,
finish each one under this skill before beginning composition; support assets such as
display stands, architecture, and set dressing are still models.

UIKitML panels belong to `iwsdk-ui`, not this skill.

## Fixed Boundaries

- Geometry and materials live in glTF or `src/scene-assets/*.scene-asset.ts`, never in
  scene JSON.
- Register the result in the configured `src/assets.ts` default manifest export.
- A procedural export is a deterministic, parentless `Object3D` prototype. The editor
  and application evaluate the manifest in separate realms, so do not use a `World`,
  DOM state, timers, or shared object identity while defining it.
- Import Three.js classes from `@iwsdk/core`, never directly from `three`.
- For a new multi-file model, do not start `iwsdk dev up` until the first complete
  asset module and manifest registration pass `npm run --if-present typecheck`. A live browser
  evaluating half-written imports can leave HMR connected but not command-ready.
- Repetition inside one model belongs here. Repetition of placed manifest assets
  belongs to `iwsdk-compose-scene` through prefabs or patterns.
- Use meters and keep the asset origin, forward axis, floor/contact plane, size
  envelope, and attachment anchors explicit.

## 1. Define The Model Contract

Turn the request into a short checklist before editing:

- silhouette and overall proportions;
- primary masses, secondary forms, and tertiary surface detail;
- required articulated or independently readable parts;
- negative spaces, support contacts, and plausible attachment points;
- material families and their visual separation;
- canonical front, back, side, top, and quarter views;
- exact named parts that merit focused inspection.

A single reference image proves only what is visible. Mark hidden geometry as an
assumption instead of pretending it is specified.

## 2. Choose The Representation

Prefer, in order:

1. an existing suitable manifest asset;
2. a project-owned glTF with an inspectable hierarchy;
3. an installable reusable asset or template;
4. a deterministic procedural `Object3D` when controllable dimensions, semantic
   subparts, articulation, or repeatable code-driven variation matter.

MetaVR and Drawcall Market can supply starting assets, but do not assume downloaded
models contain useful semantic parts. Inspect finalists before adopting them and copy
selected files into project-owned storage rather than persisting a transient CDN URL.

For substantial procedural work, keep a small construction library beside the model:
lofts/extrusions, bevelled primitives, mirrored duplication, surface frames, repeated
detail, and material factories. Build semantic named groups such as `Hull`, `Wing`,
`Nacelle`, `VentRow`, and `LandingGear`; unnamed meshes cannot be focused reliably.

## 3. Build From Large To Small

Build in this order:

1. silhouette and primary masses;
2. proportion-defining secondary forms and negative spaces;
3. joints, seams, supports, and functional connections;
4. repeated tertiary detail;
5. material separation and restrained finish.

Do not use tertiary detail to hide unresolved primary geometry. Reuse geometries and
materials where practical, but preserve names on inspection-critical groups.

### Pass the clay-form gate before detailing

- Build continuous designed forms with lofted sections, tapered plates, or bevelled
  transitions. Do not approximate a vehicle hull, nacelle, limb, or other dominant
  form as an exposed pile of stock boxes and cylinders.
- A primitive is appropriate for an intentionally manufactured subpart such as a
  bearing, fastener, pipe, hub, or recessed mechanism. Where a large secondary mass
  meets the primary form, add a collar, root, socket, fillet-like fairing, overlap, or
  other visible load path instead of letting the pieces merely intersect or hover.
- In the clay rows of the first complete preview, judge the primary and secondary forms
  before accepting tertiary detail as finish. From front, side, top, and quarter views,
  the silhouette, thickness changes, and transitions must remain intentional without
  color, emission, or tiny greebles.
- Treat obvious primitive profiles, floating slabs, paper-thin structural plates,
  unexplained gaps, and abrupt tangencies as correction-worthy model defects even
  when the material preview looks polished.
- Detail quality is not object count. For one hero-scale asset, treat roughly 700
  meshes or 100,000 rendered triangles as a review trigger rather than a target. Before
  exceeding it, remove repeated micro-plates, bolts, or seams that do not improve the
  silhouette, material boundary, or construction story. Spend geometry on continuous
  profiles, root fairings, joints, and thickness changes that remain legible in clay.
- In the single correction round, fix the weakest primary transition, attachment, or
  support first. Do not answer a merely sparse-looking render by multiplying tertiary
  greebles; fewer well-integrated details beat dense primitive noise.

### Keep iteration bounded

- Reuse the bundled construction library instead of emitting another geometry-helper
  file into the conversation.
- Prefer two to six authored modules for a substantial model: shared materials/detail,
  primary form, secondary assemblies, and a small root module. Split only at a real
  ownership boundary or before a file grows past roughly 500 lines; do not create one
  file and one tool round-trip per visible part.
- Once module boundaries are chosen, emit independent files together rather than
  narrating and waiting between assemblies. Run one initial `npm run --if-present typecheck` after
  all model modules and manifest registration exist; rerun it only after correcting
  an actual error or before final delivery.
- In Claude Code, `Write` echoes the complete source back into the transcript. Use it
  only for short files (roughly 80 lines or 8 KB). For longer new modules, use Bash
  commands with single-quoted heredocs (`<<'EOF'`) so template literals, `$`, and
  backticks remain literal and the success result stays short. Treat 100 source lines
  or 10 KB as a hard transport limit for one tool call: create the file with `>` and
  append later sections with `>>` in separate calls. End each call at the heredoc
  delimiter; do not append command substitutions or validation to that same command.
  A single logical correction may use several sequential tool calls—never combine
  large replacements across multiple modules into one oversized patch script. Do not
  put TypeScript template literals inside `node -e` or another shell-quoted one-liner.
  Duplicated source payloads and quoting recovery waste context.
- After a write or edit succeeds, do not read the whole file back. Apply narrow edits;
  avoid whole-file rewrites after initial creation.
- Claude Code's `Edit` result can retain the complete original file in the transcript.
  Do not use `Edit` on a source file above roughly 120 lines. Use a narrowly scoped
  scripted replacement that asserts exactly one match, writes the file once, and
  prints only a short confirmation. This keeps a one-line correction from reloading
  hundreds of source lines into context and every later cache read.
- Keep every agent-loop model preview at 640×480 or smaller. If a defect needs closer
  inspection, use `focus` at the same pixel budget instead of raising the resolution.
  Prefer the MCP preview, which persists the image and returns `screenshotPath`. Read
  that file only when visual inspection is needed. Use one contact sheet rather than
  several redundant views; use smaller sheets for support assets. Delivery and
  benchmark captures may be larger, but do not feed duplicate high-resolution images
  back into the model context.

### Surface-relative detail is mandatory

For vents, plates, grilles, bolts, fins, decals, struts, or greebles attached to a
sloped or curved surface, establish one local frame:

For substantial procedural work, copy this skill's bundled starter library into the
project without reading or rewriting it:

```bash
model_kit="$(find .claude/skills .agents/skills -path '*/iwsdk-build-model/assets/hardsurface.ts.template' -print -quit)"
mkdir -p src/scene-assets/lib
cp "$model_kit" src/scene-assets/lib/hardsurface.ts
```

Do not `Read`, print, page through, or search the copied implementation. This public
surface is complete:

```ts
surfaceFrame(origin: Vector3, normal: Vector3, tangentHint: Vector3): SurfaceFrame
placeOnSurface(object: Object3D, frame: SurfaceFrame, normalOffset?: number): void
mirrorSurfaceFrameX(frame: SurfaceFrame): SurfaceFrame
orientBasis(object: Object3D, xDir: Vector3, yDir: Vector3): void
alignSpan(object: Object3D, a: Vector3, b: Vector3, upHint?: Vector3): number
ensureOutwardWinding(geometry: BufferGeometry): BufferGeometry
mirrorGeometryX(geometry: BufferGeometry): BufferGeometry
bevelBox(width, height, depth, bevel?, cornerRadius?, curveSegments?): BufferGeometry
taperPlate(lengthX, widthYFront, widthYBack, thickness, bevel?): BufferGeometry
LoftSurface.tube(sections: TubeSection[]): LoftSurface
LoftSurface.blade(stations: BladeStation[]): LoftSurface
surface.point(along: number, theta: number): Vector3
surface.frame(along: number, theta: number): SurfaceFrame
surface.frameToward(along: number, outwardDirection: Vector3, samples?: number): SurfaceFrame
surface.build(
  alongs: number[],
  segments?: number,
  caps?: boolean | {start?: boolean; end?: boolean},
): BufferGeometry
sampleRange(from: number, to: number, count: number): number[]
makeRandom(seed: number): () => number
```

The exact section shapes are
`{z, halfW, hUp, hDown?, cx?, cy?, power?}` for `TubeSection` and
`{x, leadZ, trailZ, thickUp, thickDown?, y?, power?}` for `BladeStation`.
`point`, `frame`, `frameToward`, and `build` take the same absolute `z` or `x`
coordinates supplied in those sections; do not normalize the sweep range. Passing
`true` as `caps` closes both ends and `false` leaves both open. `alignSpan()` assumes
a Y-up primitive, places it midway between `a` and `b`, aligns local +Y to that span,
and returns the span length; it does not resize the geometry.

It exports deterministic lofted tube/blade surfaces, matching surface frames,
bevelled blocks and plates, span/basis placement, mirrored winding repair, and seeded
randomness. Import the needed helpers instead of reimplementing that geometry layer.

`SurfaceFrame` has a fixed object-space mapping: `tangent` becomes local +X,
`bitangent` becomes local +Y, and `normal` becomes local +Z. For lofts, `frame()`
keeps the tangent along the sweep and `frameToward()` only chooses the sample whose
normal most closely faces the requested direction. `placeOnSurface()` sets both the
object position and quaternion. To rotate a mounted detail within the tangent plane,
place a wrapper on the frame and rotate the detail child around local Z; do not apply
an Euler rotation to the frame-aligned wrapper itself. These conventions are the
complete orientation contract; do not inspect the bundled implementation to infer
them.

Author the detail so local X/Y lie in the surface plane and local +Z is thickness.
Offset by `thickness / 2 - embedDepth` so the detail visibly contacts the surface.
Once a local parent frame is established, vary rows and columns in tangent/bitangent
coordinates.

Free `rotation.set(...)`, `rotation.x = ...`, or guessed Euler angles on an individual
surface detail are a defect unless the detail already lives under a correctly aligned
surface-frame parent. This rule prevents the common failure where a vent intended to
lie against a hull becomes a standing fin.

Mirror with complete matrices or mirrored local frames, not position-only copies.
Recalculate or validate winding and normals after custom indexed/non-indexed geometry.

## 4. Validate The Asset

After the initial model and manifest pass typecheck, start the managed editor and use
the isolated model preview when it is command-ready. If valid source has
`browserConnected: true` but
`browserCommandReady: false` after an HMR error, call `browser_reload_page` once and
recheck before deeper diagnosis.

```text
asset_render_preview
```

```bash
npx @iwsdk/cli asset render-preview \
  --input-json '{"assetId":"ship","mode":"material"}' \
  --output-file artifacts/ship-material.png
npx @iwsdk/cli asset render-preview \
  --input-json '{"assetId":"ship","mode":"clay"}' \
  --output-file artifacts/ship-clay.png
```

The command renders one bounded contact sheet. Its default views are front, back,
right, top, and quarter. It also returns prototype-local bounds, framing bounds,
object/mesh/geometry/material counts, rendered triangles, named-part bounds, and
deterministic warnings for missing geometry or normals, invalid indices, non-finite
data, degenerate triangles, unnamed meshes, and unusual material sides.

The MCP response caps named-part paths and warning examples, reports full counts per
warning code, and omits part bounds to avoid flooding model context. Use CLI JSON when
complete named-part bounds or warning paths are required.

Visible transparent/additive effects are rendered but excluded from automatic framing.
Set `object.userData.iwsdkPreviewBounds = 'exclude'` for another visible effect that
must not determine the camera fit.

Always inspect the primary model. For simple support assets whose bounds and contact
plane are explicit, defer a separate preview when the first composed-scene render
will show them clearly; do not spend one model-render round-trip per trivial stand,
wall, or floor piece.

If any part looks implausible, frame it directly:

```bash
npx @iwsdk/cli asset render-preview \
  --input-json '{"assetId":"ship","mode":"clay","focus":"Ship/Hull/VentRow"}' \
  --output-file artifacts/ship-vent-row.png
```

Use the clay pass to separate geometry/attachment defects from lighting or authored
material response. A defect visible in clay belongs here. A defect that appears only
after scene lighting is applied routes to `iwsdk-compose-scene` for exposure/light
diagnosis first; return here only if the material assignment itself is wrong.

## 5. Review And Refine

Review both material and clay rows for every substantial new or repaired model. Clay
is optional only for a simple support asset whose form and contact are already obvious
in the composed-scene render. Check:

1. silhouette;
2. proportions;
3. continuous primary and secondary form transitions in clay;
4. required parts;
5. negative space;
6. contacts, thickness, and surface attachment;
7. material response and separation.

Inspect suspicious named subtrees with `focus`. Fix the highest-impact defect in the
owning asset module and rerun the preview. Default to at most two focused correction
rounds after the first complete model. Stop earlier on repeated defects, oscillation,
diagnostic plateau, missing source evidence, or a representation ceiling.

## 6. Hand Off To Scene Composition

Before switching skills, inventory every visible element required by the requested
scene. Existing manifest assets may pass through unchanged; every missing or materially
changed model, including support and environment geometry, must complete this workflow
and have a stable manifest id. Do not leave asset-module authoring for the composition
phase.

Hand `iwsdk-compose-scene`:

- the stable manifest asset id;
- local origin, forward/up axes, and size envelope;
- floor/contact plane and named attachment anchors;
- intentional transparent/additive bounds exclusions;
- passing material and clay preview evidence;
- remaining assumptions or accepted gaps.

Do not compensate for a model-local defect with a scene transform. Do not start scene
lighting or camera iteration until the model passes isolated review.
