---
'@iwsdk/create': patch
---

The generated `iwsdk-dev` skill gains a headless-rendering reference: headless managed sessions render on demand, screenshots draw a fresh frame themselves, `ecs pause` / `ecs step` / `browser screenshot` and `browser filmstrip` capture exact simulation frames, the runtime-only `RuntimeSettings` component switches the render mode live, and `browser profile` (not headless frame rates) is the way to judge performance.
