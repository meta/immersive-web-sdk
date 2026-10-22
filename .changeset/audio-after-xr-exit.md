---
'@iwsdk/core': patch
---

Fix sound after leaving XR. Ending an XR session suspended the shared audio context, and only the next session start resumed it, so every sound requested in 2D after exiting XR stayed silent. The context now keeps running; sounds that were playing when the session ended still pause and resume with the next session, and a resumed sound now reports when it finishes instead of staying marked as playing.
