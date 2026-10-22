---
'@iwsdk/vite-plugin-dev': minor
'@iwsdk/core': minor
'@iwsdk/create': minor
---

The emulator now uses IWER 2.6.0's built-in GLTS rooms as its environments: `dev.emulator.environment` accepts `sunlit_living_room` (the new default for AR projects), `home_office`, `conference_room`, `open_office`, `kitchen`, `bedroom`, `music_studio` and `open_studio`, and the DevUI environment menu lists only these rooms. The legacy capture rooms are no longer offered; configurations that still name one get a deprecation warning and load its replacement (`living_room` → `sunlit_living_room`, `meeting_room` → `conference_room`, `music_room` → `music_studio`, `office_large` → `open_office`, `office_small` → `home_office`). The emulator runtime is now code-split: the room you pick and the GLTS runtime load on demand, and the capture data is no longer shipped.
