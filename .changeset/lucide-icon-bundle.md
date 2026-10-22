---
'@iwsdk/vite-plugin-dev': patch
'@iwsdk/core': patch
---

Production builds no longer bundle every Lucide icon. Since 1.0, the UIKitML kit put all of about 1,600 Lucide icon components into every app (most of the starter's 6.7 MB main chunk). `vite build` now keeps only the icons used in static `public/**/*.uikitml`, the icons Horizon components use internally, and any listed in the new `iwsdkDev({ bundle: { icons: [...] } })` option for remote or generated UIKitML (`'all'` keeps every icon). If UIKitML in a production build names an icon that was left out, the `@iwsdk/core` parse error now points to that option. The dev server and editor still have every icon.
