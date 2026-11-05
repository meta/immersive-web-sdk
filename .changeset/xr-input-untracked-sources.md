---
'@iwsdk/xr-input': patch
---

Input sources without a pose no longer cost a frame. A hand whose wrist joint has no pose this frame, or a controller without a target ray pose, now keeps its ray, grab and touch pointers disconnected (no raycasts against the scene or UI) and its hand or controller model hidden and not updated, until tracking returns. A hand counts as untracked by its wrist even when the runtime still reports a target ray for it, as Horizon OS does for hands it does not see when no controllers are connected; such hands used to cost about 9 ms of JavaScript per frame in a UI-heavy scene. Pointer state behaves as when the source disconnects: a hover or grab in progress ends when tracking is lost.
