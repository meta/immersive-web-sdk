---
'@iwsdk/core': patch
'@iwsdk/xr-input': minor
'@iwsdk/create': patch
---

`GrabSystem`'s `useHandPinchForGrab` option now takes effect. Hand pinch grabs `OneHandGrabbable` and `TwoHandsGrabbable` objects by default, as it already did on Quest and in IWER while the option was ignored, and `grabbing: { useHandPinchForGrab: false }` now turns it off. Pinch-to-grab also works on hand input sources that expose no Gamepad. The new `XRInputManager.getSelectState(handedness)` returns this frame's select edges for either kind of source. The generated agent guidance now describes the actual default.
