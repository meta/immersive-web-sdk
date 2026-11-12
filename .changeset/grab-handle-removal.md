---
'@iwsdk/core': patch
---

Removing `OneHandGrabbable`, `TwoHandsGrabbable` or `DistanceGrabbable` from an entity now removes its grab handle too (#59). Before, the handle stayed, the object kept ignoring controller rays in XR, and it could still be grabbed. If another grabbable component remains on the entity, it gets its own handle.
