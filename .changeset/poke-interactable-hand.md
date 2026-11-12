---
'@iwsdk/core': minor
'@iwsdk/xr-input': minor
---

`PokeInteractable` has a `hand` field (`PokeHand.Both`, the default, `Left` or `Right`) that limits which hand or controller can poke the entity (#62). Use it for a wrist menu that only the other hand should press, so the hand wearing the menu no longer triggers it. Existing scenes keep poking with both hands.
