# Image And Hybrid Intake

Treat an image as evidence about one projection of a scene. Do not claim recovered
hidden geometry, exact physical scale, calibrated optics, or inverse-rendered
materials.

## Verify The Source

Record the original path/URI, width, height, and SHA-256. Confirm the file decodes and
is large enough to inspect. Detect exact/near duplicates when multiple references are
provided.

Do not reject a full-frame environment because its foreground mask is large,
fragmented, or touches the frame. Foreground coverage/coherence gates are appropriate
only for an intentionally isolated object crop.

## Assign Reference Roles

Assign each reference one or more roles:

- `layout`: placement, overlap, proportions, and camera framing;
- `identity`: object-specific silhouette or features;
- `palette`: broad hue/value grouping;
- `style`: rendering character, not literal geometry.

For hybrid input, text overrides image content when they conflict. Record the chosen
interpretation and do not silently discard either source.

## Decompose The Visible Scene

Inventory macro systems first:

- ground, paths, roads, water, and boundaries;
- architecture and large natural forms;
- focal object or cluster;
- repeated structures and vegetation;
- vehicles, people, props, and accents;
- dominant light direction, background, and atmosphere.

Then identify 3-8 features that control recognition. Prefer silhouette, count,
relative size, overlap, negative space, material family, and spatial rhythm. Create
normalized `[x, y, width, height]` regions or `[x, y]` anchors only for critical
features.

Map each feature to planned node/resource IDs before materialization. If a visible
feature cannot be represented, mark the brief conditional and name the approximation.

Choose and record one fidelity level before detailed authoring: composition match,
editable stylized reconstruction, close visual recreation, or calibrated
reconstruction. An unqualified request to recreate an image defaults to close visual
recreation. A lower level requires an explicit conditional limitation rather than a
self-authored fidelity ceiling that narrows the request silently.

## Infer Depth And Camera

Separate observations from inferences:

- observations: image-space positions, visible edges, counts, occlusions, colors,
  shadows, and top/side ratios;
- inferences: depth, unseen sides, true dimensions, focal length, and material values.

Use line convergence, visible top surfaces, occlusion order, cast shadows, familiar
scale anchors, and repeated spacing to propose a coherent 3D layout. Prefer shallow,
editable hidden geometry over elaborate invention.

Represent camera uncertainty as a hypothesis or fitted range. Save one exact hero
view after fitting; use the same view and resolution for every comparison. For an
orthographic/isometric-like source, use an orthographic authoring view when supported.
Otherwise declare the perspective approximation conditional.

## Establish The Inspection Context Early

Materialize the room shell or stage, support geometry, an approximate reference
camera, and representative lighting before building the focal objects. Add one
identity-critical object group at a time and inspect it in that shared context before
adding the next. Use neutral form-reading light for silhouette and proportion checks,
then restore representative final light for material response. Preserve approved
background and lighting while isolating a focal group when the editor supports it;
otherwise inspect the object before later groups are accumulated or render its module
file independently. Complete object-level inspection before composing later groups.

## Handle Materials

Classify broad families such as matte stone, painted wood, foliage, fabric, exposed
metal, painted metal, ceramic glaze, or glazing proxy. Use scalar standard PBR only
when the visible finish is materially uniform and its highlight response is not
identity-bearing. When clearcoat, sheen, transmission, IOR, anisotropy, mottling,
weave, patina, or another spatially varying finish controls recognition, put the
supported physical material and independent maps in the initial candidate. Do not
defer them until a correction round.

Map the finish to topology, not just object identity. Cylinder/cone/lathe side UVs
wrap around U and run along height/profile in V; tube U follows the path and V wraps
the cross-section; every box face restarts its own UV square. Use separate named
material variants when repeat scale or weave/grain direction must differ. On closed
or lathed surfaces, repeating procedural samplers must use rotation `0`, `90`, `180`,
or `270`, and the sampler repeat mapped to every closed UV axis must be a positive
integer. At rotations `0`/`180`, closed U maps to `repeat[0]` and closed V maps to
`repeat[1]`; at `90`/`270` the mappings swap. Thus a cylinder with rotation `0` may
use `[4, 2.5]` because only U closes, but `[4.25, 2]` will expose its U seam; a closed
tube needs integer values on both repeat axes. Arbitrary rotation is not seam-safe.
Prefer close albedo stops, high roughness, restrained sheen, and shallow bump for
fabric unless the image provides evidence for a high-contrast weave.

Do not treat pixel brightness as roughness, metalness, AO, height, or normal data.
Whole-image finish classifiers are non-authoritative. Use a verified part crop only
as optional evidence and retain uncertainty. When the active capabilities report
`periodic-fbm-v1`, author independent deterministic albedo, emissive, roughness,
metalness, AO, alpha, and normal-or-bump maps to approximate a material family. Do
not claim these maps reconstruct source pixels or physical surface measurements.

Evaluate feasibility against the full reported capability set, not the cheapest
initial representation. Never move an identity-bearing requested or observed finish
into `acceptedApproximations` when the active capabilities can represent it. Bind a
required material feature to the affected nodes and make its visual criterion name
both spatial variation and highlight behavior explicitly.

For an isolated studio product, compile a coherent first-pass recipe when supported:

- physical PBR for glaze, clearcoat, textile sheen, glass, or polished finishes;
- independent deterministic albedo, roughness, and bump/normal channels for visible
  within-object variation;
- environment IBL plus shaped area lights that reproduce the observed highlight
  footprint;
- soft, directional contact shadowing;
- one floor/support surface that extends beyond every required, alternate, and
  diagnostic camera frustum and matches the background closely enough that no
  horizon, diagonal edge, corner, or value seam appears in any saved view. Mark that
  infrastructure `framingRole: "support"`, fit from content-only `framingBounds`, and
  verify coverage with raw `worldBounds` plus exact-view captures.

Do not add procedural variation merely because it is available. Its scale, amplitude,
and channel independence must be supported by visible evidence and recorded as an
approximation rather than recovered source texture.

## Tune Color And Value

Do not leave palette matching as an informal final impression. After camera, layout,
and major occlusion are stable, compare the reference and exact hero render at the
same aspect ratio and record:

- mean luma plus dark/mid/high percentile luma;
- average color for a few broad, unoccluded semantic regions such as wall, floor,
  focal object, and background;
- highlight and shadow footprint for the focal material;
- the renderer's tone mapping, exposure, IBL intensity, light colors/intensities, and
  background color.

Use `scene_measure_image_regions` with the trusted hero `captureToken`, the declared
reference ID, and explicitly aligned normalized regions. The tool verifies reference
bytes against their declared SHA-256 and reports luma percentiles, mean OKLab color,
and highlight/shadow footprints without pretending those diagnostics are a universal
similarity score. Do not use full-frame metrics when camera or crop alignment is not
established.

Use these as revision diagnostics rather than a universal score. Tune in this order:

1. tone mapping, background, exposure, and IBL intensity;
2. key/fill/practical light color and intensity;
3. large material base colors;
4. roughness, metalness, sheen, clearcoat, and transmission response;
5. spatial albedo/roughness/bump variation.

Do not darken albedo to compensate for excessive exposure, or increase saturation to
compensate for a flat lighting ratio. Re-capture after each coherent tuning pass and
retain the measured before/after values. A color pass may not move the saved camera or
silently repair geometry, so its effect remains attributable.

## Review Against The Image

Run technical gates first. Then compare:

- projected centers/extents of bound feature groups;
- visible top-to-side ratios and negative spaces;
- relative scale and overlap order;
- counts and repeated spacing;
- support/contact gaps;
- major palette and light/dark grouping;
- masked within-object color variance and coarse spatial distribution;
- highlight position, area, shape, and intensity;
- contact-shadow area, softness, and direction;
- floor/background continuity and any visible plane edge or seam;
- alternate-view volume for non-planar features.

Use object-mask IoU, SSIM, pHash, edge overlap, or color delta only for isolated crops
or calibrated synthetic fixtures whose assumptions hold. They are not universal hard
gates for full environments, foliage, cast shadows, or inferred hidden geometry.

Agent visual judgment follows deterministic diagnostics and must report every required
feature separately. A strong global impression cannot hide a missing critical object.
