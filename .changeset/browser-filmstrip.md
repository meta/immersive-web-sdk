---
'@iwsdk/cli': minor
'@iwsdk/vite-plugin-dev': minor
'@iwsdk/core': patch
---

Add `browser filmstrip` (MCP `browser_filmstrip`): pause the app, capture exact simulation frames at fixed step offsets, and return them as one labeled contact sheet. Steps and captures run against the command budget, the previous ECS pause state is restored, and `MCPRuntime.ecsPaused` reports the pause state the tool relies on.
