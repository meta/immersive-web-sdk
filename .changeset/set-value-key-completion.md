---
'@iwsdk/core': patch
---

Editors complete every component key in `entity.setValue` again (#61). The overload that adds hex number, `#RRGGBB` string, `Color` and RGB inputs for Color fields only listed Color keys, so completions hid all the others. It now covers every key and widens the value type for Color fields only. What type-checks is unchanged.
