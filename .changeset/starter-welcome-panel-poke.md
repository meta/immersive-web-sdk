---
'@iwsdk/create': patch
---

The VR and AR starters' welcome panel is now `PokeInteractable` as well as `RayInteractable`, so a fingertip press on its buttons (Exit to browser) works with hand tracking. Before, only a controller ray or a pinch ray could press them, although the generated guidance tells agents to give every panel both components.
