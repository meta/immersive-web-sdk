# Text Intake

Use this adapter when the user supplies no visual reference. Text defines design
intent; do not invent a source-fidelity target or camera-confidence score.

## Extract The Brief

Record:

- required objects and recognizable systems;
- spatial relations: beside, behind, centered, crossing, enclosing, supporting;
- counts, approximate scale, and one scale anchor;
- target surface: browser, VR, AR, or shared;
- style, palette, and material intent;
- desired hero view or application view when stated;
- existing glTF/procedural assets versus new asset-authoring needs;
- exclusions and non-goals;
- performance constraints stated by the user or calibrated target profile.

Performance constraints are not a first-class authoring branch in the scene format. Put user
constraints in `metadata["iwsdk.composer.performanceLimits"]` as JSON, or retain them
in the external cost report. Never present an uncalibrated desktop threshold as a
device profile.

Convert ambiguous but nonblocking choices into explicit assumptions with
`high | medium | low` certainty. Ask only when different interpretations would change
a required feature or make the request unsupported.

## Define Features

Create 3-8 required or important features that make the request recognizably correct.
Prefer observable results:

- `crossroads`: two roads intersect at right angles with four pedestrian crossings;
- `relative-height`: apartment building is at least twice the house height;
- `reading-cluster`: chair, lamp, and side table form one reachable cluster;
- `arch-opening`: path passes visibly through the stone arch;
- `vehicle-heading`: car points along the east-west road.

Bind each feature to planned node IDs and typed acceptance criteria. Avoid vague
criteria such as "looks good" or "high quality."

## Select A Representation

Call `scene_get_capabilities`, inspect the configured asset manifest, then choose in
this order:

1. reuse a registered glTF or procedural asset when it satisfies the required form;
2. invoke `iwsdk-build-model` when identity, geometry, or material response is missing;
3. assemble registered assets in a scene prefab for a reusable semantic object;
4. use a deterministic pattern for repeated compatible prefabs;
5. accept an approximation with a named fidelity ceiling;
6. block when a required feature has no supportable representation.

Do not fabricate catalog IDs or build model-local geometry from scene nodes. Continue
composition only after a new asset has a registered manifest id.

## Establish Scale And Coordinates

Use `+Y` up. Choose a semantic origin such as scene center, floor center, or crossing
center. Put group origins where later editing is natural. Use conventional dimensions
only when the prompt supplies no evidence; record those values as assumptions.

The persistent player origin materializes at `[0, 0, 0]` unless the top-level
`player.transform` deliberately moves it. A semantic scene center is therefore not
automatically a safe object center: keep a standing capsule around the authored
player origin clear, or move the player to a deliberate spawn. Include an exact
spawn review view at player eye height (about 1.6 m above the origin) looking into
the composition; hero cameras do not substitute for this check.

Text-only scenes need at least one hero view plus diagnostic top, quarter, and player
spawn views.
The hero view is a design choice, not a match to an imaginary source image.

## Review Text-Only Output

Use deterministic hierarchy, count, support, relation, bounds, and runtime checks.
Agent visual judgment evaluates composition and legibility against the written
criteria, not similarity to an absent reference. Do not use IoU, SSIM, pHash, or
camera-fit metrics.
