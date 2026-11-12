---
'@iwsdk/core': patch
---

A failed audio load is no longer retried every frame. `AudioSystem` refetched and logged an error for an `AudioSource` whose file failed to load on every frame (about 70k errors in 10 s with a missing file). It now logs once and tries again when the entity's `src` changes.
