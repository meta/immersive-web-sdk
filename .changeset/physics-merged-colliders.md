---
'@iwsdk/core': patch
---

A model whose meshes have different vertex attributes (for example one mesh with vertex colours and one without, common in glTF) now gets a physics collider. Before, building its merged collider failed and `PhysicsSystem` threw on every frame. Merged colliders now use positions only, building one no longer changes the model's `matrixWorld`, and an entity whose collider can't be built logs one error and stays without a body instead of stopping the physics system.
