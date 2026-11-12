---
'@iwsdk/core': patch
---

Depth occlusion with GPU depth sensing on Quest no longer samples empty depth on some frames. Quest Browser reuses one `WebGLTexture` for the per-frame depth image, and three.js skipped re-binding it, so the soft-occlusion preprocessing pass read a stale, dropped texture on about a quarter of frames ("RENDER WARNING: there is no texture bound to the unit 0" floods in the console). IWSDK now re-binds the depth texture on the units that hold it every frame.
