---
'@iwsdk/core': minor
'@iwsdk/vite-plugin-dev': minor
'@iwsdk/create': minor
---

Native target for Meta Quest: `iwsdk.config.json` accepts a top-level `native` section (validated by the manifest validator, the JSON schema and the types) that `@iwer/native` reads to package the app as an APK. `@iwsdk/vite-plugin-dev` leaves the IWER emulator out of `vite build --mode metavr` (or `IWSDK_BUILD_TARGET=metavr`) whatever `dev.emulator.injectOnBuild` says, and keeps the `native` section out of the browser bundle. `npm create @iwsdk@latest -- --metavr-native` (VR starter) adds `@iwer/native`, a `native` section and a `build:metavr` script (`vite build --mode metavr && iwer-native pack`).
