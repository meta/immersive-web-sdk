---
'@iwsdk/create': patch
'@iwsdk/vite-plugin-dev': patch
---

New projects pin sharp 0.35.5 (in the `package.json` and `pnpm-workspace.yaml` overrides) instead of 0.35.4, which has a high-severity advisory (GHSA-wq5f-xc86-pv6w, fixed in 0.35.5). `@iwsdk/vite-plugin-dev` requires sharp ^0.35.5. Existing projects keep their own override; change it to 0.35.5 to get the fix.
