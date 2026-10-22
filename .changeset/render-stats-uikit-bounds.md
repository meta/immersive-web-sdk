---
'@iwsdk/core': patch
---

`scene_get_render_stats` (`iwsdk scene render-stats`) no longer fails with "Cannot read properties of undefined (reading 'x')" when the level holds UIKit content components, such as the Lucide icons of a welcome panel. That happened in every XR session of a project with a `ScreenSpace` panel, which moves into the level during the session, and whenever such a panel was placed in the world. `worldBounds` still covers every object, hidden ones included, and now reads each mesh's own geometry bounds (or an instanced, batched or skinned mesh's own `boundingBox`) instead of any object's `boundingBox`.
