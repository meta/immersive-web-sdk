---
'@iwsdk/vite-plugin-dev': patch
---

`browser_reload_page` on the managed browser now replies once the reloaded app's runtime bridge is command-ready again, waiting up to the bridge-ready timeout (5 seconds by default). It used to reply as soon as the page navigated, so the next runtime command often failed with `connection_lost` or `browser_not_ready` while the new page was still starting. The result reports `commandReady: false` if the bridge did not return in time; apps without a runtime bridge are not delayed.
