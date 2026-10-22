---
'@iwsdk/core': minor
'@iwsdk/scene-composition': patch
'@iwsdk/vite-plugin-dev': patch
'@iwsdk/create': patch
'@iwsdk/cli': patch
---

New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
