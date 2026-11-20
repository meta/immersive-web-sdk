---
'@iwsdk/vite-plugin-dev': patch
---

Pin Playwright to exactly 1.65.1, so the managed browser (Chrome for Testing and its headless shell, build 1255) only changes when an IWSDK release bumps it. With the old `^1.58.2` range, each Playwright release brought a new browser build on the next install. Machines that approve programs one by one asked again for every helper process, and screenshots and frame stats came from whatever build was newest.
