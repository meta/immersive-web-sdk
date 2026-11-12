---
'@iwsdk/core': patch
---

`DepthOccludable` no longer crashes on troika-three-text meshes (#60). Their materials chain an assigned `onBeforeCompile` themselves, so wrapping it recursed until the stack overflowed on first compile. For such materials the occlusion code now passes its injection to them directly.
