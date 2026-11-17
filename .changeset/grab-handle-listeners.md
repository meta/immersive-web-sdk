---
'@iwsdk/core': patch
---

Remove grab event listeners when their handle is removed so switching to `RayInteractable` does not leave the old grab handler capturing controller clicks.
