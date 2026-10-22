---
'@iwsdk/core': patch
---

Fix XR quad and cylinder layers on Quest Browser:

- Entering XR no longer hangs. The layer render targets resolved depth by default, so three.js turned off multisampled render-to-texture when the session supplied their textures and then bound a framebuffer that was never created: the first XR frame threw `Invalid value used as weak map key` and the app stayed on the loading dots. Layer targets no longer resolve depth, which the compositor never reads.
- Quad layers are their authored size again. `XRQuadLayer` `width` and `height` are half-extents in Quest Browser and the IWER layers polyfill, so a 1 m quad was drawn 2 m wide.
- Transparent parts of a layer no longer show black boxes. The mesh behind a native layer used to cut a hole in the projection layer; since content layers are composited over it, the mesh is now just not drawn.
- The 2D fallback no longer shows layer content upside down (quads) or mirrored (cylinders).
