---
'@iwsdk/core': patch
---

Agent guidance: a new `iwsdk-metavr-native` skill builds, installs, runs and debugs a standalone Quest APK made with `@iwer/native` (`npm run build:metavr`), with a client for the runtime's debug endpoint (eval, eye-buffer screenshots, stats). AGENTS.md and the `iwsdk-dev` skill now route hosting, PWA/TWA packaging, offline and native APK requests straight to their skills, and the PWA packaging skill points native APK requests to the new one.
