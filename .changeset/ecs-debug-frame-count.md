---
'@iwsdk/core': patch
---

ECS debug tools count simulated frames. `ecs step`'s `totalFrame`, a snapshot's frame, `ecs diff`'s `frameDelta` and `ecs resume`'s `framesWhilePaused` counted every render-loop tick, including ticks skipped while paused. Stepping 50 frames could report a `frameDelta` of about 300. They now count only frames the ECS actually ran: normal updates and debugger steps.
