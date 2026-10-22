---
'@iwsdk/vite-plugin-dev': minor
'@iwsdk/cli': minor
---

Add a tab mute control to the managed browser. Chromium's app-mode window hides its own tab mute button, so the workspace's Runtime/Editor bar now has a speaker button, and agents get the matching `browser_set_muted` MCP tool (`iwsdk browser set-muted --muted <true|false>`). Muting silences Web Audio and media elements in every frame without pausing the app, persists across reloads and managed-browser relaunches for the dev session, and is reported as `browser.audioMuted` by `runtime_get_status`.
