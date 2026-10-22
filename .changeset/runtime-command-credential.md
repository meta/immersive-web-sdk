---
'@iwsdk/vite-plugin-dev': patch
'@iwsdk/cli': patch
---

The dev server's runtime WebSocket (`/__iwer_mcp`) now requires a per-session command credential on every command. Before, any script running in the app page (an app dependency, for example) and any other local user could connect and run runtime, editor and managed-browser commands. The dev server writes a random secret to `.iwsdk/runtime/command-credential.json` and deletes it when it stops. The file is never served over HTTP, and on macOS and Linux it is readable only by your user (mode 0600); on Windows it takes the project folder's permissions. The `iwsdk` CLI and `iwsdk mcp stdio` read it and send it with each command, and the server removes it before relaying a command to a page. A command without it fails with `runtime_unauthorized` and is not executed. Browser bridges keep their own rules (the managed browser's session identity, a headset's pairing token), and a CLI holding a stale session still gets `stale_runtime_owner`. Use the CLI and the dev plugin from the same IWSDK release: an older CLI sends no credential.

Scene routes now resolve symbolic links before they read or write. The managed editor can no longer open, save, flatten, import or list a scene through a link that leads outside `public/scenes` (or a `public/scenes` that leads outside the project), and its file picker refuses a `public/` subfolder linked outside `public/`. Links that stay inside `public/scenes` keep working.
