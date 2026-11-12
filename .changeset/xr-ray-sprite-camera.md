---
'@iwsdk/xr-input': patch
---

Rays and gaze can hit sprites in XR (#57). The XR ray intersector's raycaster had no camera, so raycasting a `Sprite` threw "Raycaster.camera needs to be set". It now uses the viewing camera, as the desktop intersector already did.
