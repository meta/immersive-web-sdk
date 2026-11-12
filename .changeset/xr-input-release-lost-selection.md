---
'@iwsdk/xr-input': patch
---

Controllers no longer get stuck after a held object disappears. If the app disposed the object a ray or grab pointer was selecting, and the trigger or squeeze was then released away from any target, the pointer stayed in its selected state and ignored every later grab and select until reload. Releasing now ends the selection, as it already did for poke.
