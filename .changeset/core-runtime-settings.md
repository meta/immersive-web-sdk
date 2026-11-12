---
'@iwsdk/core': minor
---

Add the runtime-only `RuntimeSettings` component, created on its own entity by `RuntimeSettingsSystem`, so development tools can read and change runtime switches with the generic ECS commands (`ecs find`, `ecs query`, `ecs set-component`) instead of a command per switch. Its `renderMode` field (`'continuous'` or `'on-demand'`) mirrors `world.renderMode` in both directions and applies on the next frame, even while ECS updates are paused for debugging. The component is not part of the scene component catalog, so scenes cannot author it and it is never saved.
