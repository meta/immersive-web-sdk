---
'@iwsdk/xr-input': patch
---

Stop two misleading `[iwsdk][gaze]` diagnostics. Emulated gaze (the desktop emulator or `--native-xr-control`) no longer reports "real gaze data is flowing" or warns after 3 s that the runtime maps gaze onto the head pose; it says the gaze is synthetic and has not been aimed yet. Disconnecting a gaze source mid-session no longer also logs that no gaze source appeared within 3 s of session start.
