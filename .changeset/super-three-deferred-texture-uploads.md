---
'@iwsdk/core': patch
---

Fix missing textures in XR on Meta Quest with `super-three@0.185.0` (#55). In multiview mode, super-three deferred every texture upload that started during the session and never flushed them, so UIKit text and images, hand and controller models, and the ray cursor rendered empty. Uploads also stayed stalled after the session ended. IWSDK's renderer now flushes deferred uploads after each multiview render and then turns deferral off.
