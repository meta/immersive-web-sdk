---
'@iwsdk/core': minor
'@iwsdk/xr-input': minor
'@iwsdk/vite-plugin-dev': minor
'@iwsdk/create': minor
---

Move to Three.js r185 (`super-three@0.185.0`, `@types/three` 0.185). Apps pin the same version: update `three` and its override to `npm:super-three@0.185.0` (new projects from `@iwsdk/create` get it). The r185 changes are handled so apps see no warnings or visual changes: scene `shadowMapType: 'pcf-soft'` uses `PCFShadowMap` (soft since r182, which deprecated `PCFSoftShadowMap`), the render loop uses `Timer` instead of the deprecated `Clock`, the `room` IBL keeps its lighting, controller and hand visuals compile with r183+'s vec4 vertex colors (and still with older Three.js for `@iwsdk/xr-input`), and production builds no longer bundle the unused Draco and Basis decoders that r185's loaders reference.
