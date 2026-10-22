---
'@iwsdk/core': patch
---

A rejected XR session offer is now logged as `[XR] Failed to start offered XR session` instead of surfacing as an uncaught promise rejection. IWER, for example, rejects a session that requires a feature its emulated device lacks, such as `layers`.
