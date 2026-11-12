---
'@iwsdk/core': patch
---

Grab and touch pointers do less work per frame. Their sphere intersection brought each tested object's world matrix up to date by recomposing its whole ancestor chain, once per object, and did so even for groups it doesn't test. Each ancestor is now recomposed at most once per pointer move, and non-mesh nodes are skipped. Hits are unchanged, including for objects moved since the last render.
