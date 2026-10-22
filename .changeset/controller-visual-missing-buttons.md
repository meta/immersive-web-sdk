---
'@iwsdk/xr-input': patch
'@iwsdk/core': patch
---

Controller visuals no longer throw on every frame, which froze rendering, when a controller reports fewer buttons or axes than its input profile maps (for example Samsung Galaxy XR, whose profile maps thumbrest and menu to buttons the device doesn't report). Parts the gamepad doesn't report stay at rest.
