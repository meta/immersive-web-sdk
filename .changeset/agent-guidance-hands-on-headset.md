---
'@iwsdk/core': patch
---

Coding-agent guidance now gives a user who wants to try the app in a headset a plain dev session and URL, never a `--native-xr-control` session or pairing URL, which would take over their head pose and controllers. It also tells agents to keep app and game state (score, lives, phase, debug switches) in ECS components so `ecs set-component` can jump it to any state, and to treat browser automation as a last resort.
