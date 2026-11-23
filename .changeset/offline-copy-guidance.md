---
'@iwsdk/core': patch
---

Generated projects gain an `iwsdk-offline` skill that makes an app run with no connection after one online visit. It ships the build script, the service worker template, and the page module as files the agent copies rather than retypes. The build script hashes every file in `dist/` and writes `sw.js`, the service worker keeps one hash-checked copy of the release and answers from it, and the page moves to a new release only when no XR session is running, or at the next load. Each file is downloaded once, an update downloads only the files whose hash changed, and the controller models and three.js decoders IWSDK fetches from CDNs are kept as well. The hosting and PWA packaging skills point to it for apps that must launch offline from the Horizon Store, and the PWA troubleshooting reference covers an installed app that shows an error page offline or an old release after a redeploy.
