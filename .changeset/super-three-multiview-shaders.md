---
'@iwsdk/core': patch
---

Fix rendering in XR on Meta Quest with `super-three@0.185.0`: in multiview mode every shader failed to compile ("array size must be a constant integer expression"), so nothing rendered. r185's `transformNormalByInverseViewMatrix` / `transformDirectionByInverseViewMatrix` shader helpers take a parameter named `viewMatrix`, which super-three's multiview mode `#define`s to an array element; IWSDK now renames that parameter in `ShaderChunk.common`.
