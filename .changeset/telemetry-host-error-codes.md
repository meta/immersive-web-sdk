---
'@iwsdk/cli': patch
---

Report why a runtime tool failed when the dev server, its relay, or the managed browser's command lock says so. Their error codes (for example `command_timeout`, `browser_command_timeout`, `target_not_ready`, `browser_relaunched`) were dropped from usage telemetry and every such failure was reported as `runtime_error`. These codes are constants defined by IWSDK, so error messages are still never reported.
