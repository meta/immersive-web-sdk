---
'@iwsdk/core': patch
---

Directional and spot light targets now hang from their light, 1 m down its -Z, so three.js aims the light, its shadow camera and its helpers along the light's node in the same frame even when a system moves the node after `LightSystem` has synced it. Before, the target stayed where the light had been for that frame: shadows and shading leaned toward the old spot, and a step of about a metre along the light put the target on or behind it, so the shadow map looked away and the light went out for that frame.
