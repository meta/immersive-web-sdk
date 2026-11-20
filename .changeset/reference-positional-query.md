---
'@iwsdk/cli': patch
---

`iwsdk reference search`, `api`, `file`, `dependents` and `examples` now take their main input as positional text, so `iwsdk reference search PokeInteractable hand` works instead of failing with "Query cannot be empty". Fields in `--input-json` still win, and `file` defaults `source` to `iwsdk`. Subcommands without one main field reject positional text and point to `--input-json`.
