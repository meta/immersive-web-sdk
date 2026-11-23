---
'@iwsdk/core': patch
---

The `iwsdk-offline` skill's service worker now takes over only while the asking page is the app's only open page, so a second tab in an XR session is never moved onto a new release; it keeps the other hand's controller model along with the first, and pins the starter's stock models on jsDelivr by default. The page module adds `checkIdle()`, so a release that installed during a session takes over when it ends, and asks the browser to persist the copy. The headset test steps now serve `dist/` over plain HTTP, because `vite preview` with the IWSDK plugin uses a self-signed certificate that Quest Browser rejects for service workers.
