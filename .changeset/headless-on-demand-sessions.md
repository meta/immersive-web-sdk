---
'@iwsdk/vite-plugin-dev': minor
'@iwsdk/cli': minor
---

Headless managed sessions (`--ai-mode agent`, `--headless`) now start the app in on-demand render mode: systems, input, physics and UI run every frame, but the app draws only when a tool needs pixels, so a machine without a GPU no longer software-rasterizes every frame. `browser screenshot` draws a fresh frame itself; browser profiles, runtime preflight and publish evidence, and `browser run` scripts draw every frame while they run. `dev status` reports the mode the session starts the app in as `session.browser.renderMode`. `IWSDK_DEV_RENDER_MODE=continuous` opts out; headed and collaborate sessions always draw every frame. Every managed session turns off the emulator's per-frame clear (`XRDevice.frameClearEnabled`), so one drawn frame persists for XR captures, and draws the emulated AR room only on frames the app draws (`XRDevice.shouldDrawEnvironment`), so an idle on-demand AR session draws nothing. The emulator dependencies (`iwer`, `@iwer/sem`, `@iwer/devui`) move to ^2.8.0, which adds both settings.
