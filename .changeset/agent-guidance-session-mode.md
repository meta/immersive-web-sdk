---
'@iwsdk/core': patch
'@iwsdk/reference': patch
---

Coding-agent guidance now tells agents which dev session to start. They pass `--ai-mode collaborate` when the user wants to watch or steer the work, and `--ai-mode agent` (headless, renders on demand) otherwise. They ask once when the request doesn't say, and use agent mode when nobody can answer. The guidance also explains how to look up IWSDK APIs with `iwsdk reference` (keyword search over the bundled corpus, no warmup), how to profile instead of reading headless frame rates, and the `world.renderMode` render-loop API. The `search_code` query description now asks for keywords led by identifiers.
