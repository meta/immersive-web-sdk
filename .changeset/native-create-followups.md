---
'@iwsdk/create': patch
---

`--metavr-native` also works with `--target ar` (the native runtime runs immersive-ar over passthrough), prints the native build, install and run commands with the next steps, and, when it adds IWSDK to an existing project, adds `dist-metavr/` to `.gitignore` and names the `native` section to add to an `iwsdk.config.json` it keeps.
