---
'@iwsdk/vite-plugin-dev': patch
---

`xr_accept_session` now succeeds when an XR session is already active, and `xr_end_session` succeeds when none is, reporting `alreadyActive` or `alreadyEnded`. They used to fail ("No session has been offered", "No active session"), although the session was already in the requested state.
