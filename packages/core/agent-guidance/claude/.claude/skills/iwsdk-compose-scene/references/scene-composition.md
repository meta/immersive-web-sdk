# IWSDK Scene Composition Patterns

This reference covers world-relative composition only. Geometry, materials, and
repetition inside one model belong to `iwsdk-build-model`.

## Modules And Ownership

Use standalone scratch scene modules when a scene has independent spatial groups.
Each module should declare:

- a local origin and size envelope;
- asset ids and stable node ids;
- attachment/contact expectations with neighboring modules;
- the diagnostic and hero views that prove its layout.

Render every module before importing it. The composition root owns global components,
environment, lights, metadata, and authoring views. Flatten once after all modules
pass; later edits happen only in the flat scene.

## Scene-Level Repetition

Use a prefab when a repeated placed object needs children or components. Use a
pattern when placement follows a deterministic grid, ring, line, or scatter rule.
Keep the model itself in the manifest; scene repetition must not duplicate geometry
or material declarations.

Repetition boundary:

- repeated bolts, vents, panels, or subparts inside one manifest asset →
  `iwsdk-build-model`;
- repeated chairs, trees, props, modules, or buildings placed in the world → this
  skill through prefabs and patterns.

## Environment And Lighting

Put `DomeGradient` or `IBLGradient` on the level root only. Light direction follows
local `-Z`. Use a small deliberate rig: broad environment/fill, one readable key, and
only the shadows that communicate contact or depth.

If a material looks wrong, compare the asset's isolated material and clay previews.
If the defect survives clay, route it to `iwsdk-build-model`. If it appears only in
the scene, inspect light direction, intensity, exposure, tone mapping, and background
contrast here before changing the material.

## Camera And Scale

Treat camera intent as data. Author exact named `authoring.views` for requested hero
or diagnostic shots. `view` selects built-in editor views; `viewId` selects an exact
saved camera. Outside immersive XR, a loaded level's saved hero view supersedes the
initial `World.create({render:{camera}})` pose. In XR, player spawn is a separate
required framing check.

Keep the standing volume around the origin clear unless the scene explicitly authors
a different player transform. Check scale with known human references and verify
support contacts from more than one angle.

## Review Isolation

Use `scene_select` plus `scene_set_preview_visibility` to solo one scene node or keep
ghosted context. This isolates a placed asset, not named children inside its model.
For a model-internal part, use `asset_render_preview` through `iwsdk-build-model`.

Review the scene in this order:

1. top/front layout and scale;
2. quarter and side views for contacts, occlusion, and depth;
3. hero framing and material response;
4. player-spawn framing when immersive.

## Cost Control

Use measured render statistics instead of intuition. Watch draw calls, expanded
instance counts, triangle count, unique materials/geometries, textures, shader
programs, and shadow casters. Prefer shared manifest resources and patterns where
they preserve editability. Do not trade away requested silhouette or interaction
readability merely to lower counts.

Run one complete scene review, fix the highest-impact composition defect, and repeat
at most once unless the second pass reveals a new blocking issue. Stop on repeated
defects, oscillation, or a clear plateau.
