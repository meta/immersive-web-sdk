---
'@iwsdk/core': minor
'@iwsdk/cli': minor
'@iwsdk/create': minor
---

Ship coding-agent guidance with `@iwsdk/core` and add `iwsdk agents sync`. The AGENTS.md block, skills, rules, and code-review subagent that new apps receive now come from `@iwsdk/core`, stamped with the release and a content hash. `npx @iwsdk/cli@latest agents sync` installs or refreshes them from the installed `@iwsdk/core`, so upgrading IWSDK can also upgrade the guidance: unedited files are replaced, retired IWSDK skills are removed, and edited files are reported and left alone (`--force` replaces them). An existing `AGENTS.md` keeps its text and gains a managed block. Guidance from earlier releases is recognized and upgraded. `iwsdk agents check` reports drift for CI, and `iwsdk adapter sync` now runs the guidance sync too.
