---
'@iwsdk/core': minor
---

Add an on-demand render mode. `world.renderMode` is `'continuous'` by default (every tick draws, as before); in `'on-demand'` mode every system still runs each tick, but a tick draws only when something asks: `world.requestRender(frames)` draws the next frames and resolves once the last one has been presented, and `world.holdRender()` draws every frame until released (holds are counted). `world.drawnFrames` counts the frames drawn so far. Ticks that do not draw still update world matrices, skinned-mesh bones and the XR camera pose, so raycasts, grabbing, physics and UI behave the same. Development harnesses can select the mode before boot with `window.__IWSDK_RENDER_MODE`. The MCP runtime gains `requestRender`, `renderMode`, `drawnFrames` and id-addressed render holds, and `scene_get_render_stats` (`scene render-stats`) draws a fresh frame first in on-demand mode.
