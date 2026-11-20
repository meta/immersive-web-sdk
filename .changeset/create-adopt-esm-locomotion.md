---
'@iwsdk/create': patch
---

Adding IWSDK to an existing project now works when its `package.json` doesn't declare `"type": "module"`, which includes projects made with `npm init -y`: the new Vite config is written as `vite.config.mjs`/`.mts`. A Vite config that Vite loads as CommonJS is left alone, with renaming it to `.mjs`/`.mts` listed as a step, also when it already imports the IWSDK plugin (as the configs that 1.2.0-rc.0 wrote do). With several Vite configs, Create edits none and names the one Vite loads. Adoption also leaves locomotion off unless you ask for it (`--locomotion`, or Yes in the customize prompt, which now starts at No), because the scene it writes has no floor and the player would fall; the report says so, and lists the floor when an existing `iwsdk.config.json` turns locomotion on over a scene without `LocomotionEnvironment`. Requests for the same release no longer print "newer than this release", and a dist-tag such as `latest` is reported as one.
