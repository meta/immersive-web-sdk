---
'@iwsdk/vite-plugin-dev': patch
---

A page served by a `--native-xr-control` dev session now says so. Quest Browser pages whose headset and controllers the IWSDK CLI drives show a fixed "Agent-controlled page" banner, which ignores clicks, and log a console warning. Both say how to get control back: restart the dev server without `--native-xr-control` and open the URL it prints. Before this, the page looked like a normal app whose headset and controllers had stopped responding, and removing the pairing token from the URL did not help. The gaze-only target-device preview, desktop emulation and normal sessions are unchanged.
