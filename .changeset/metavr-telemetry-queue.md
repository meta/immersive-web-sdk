---
'@iwsdk/cli': patch
'@iwsdk/vite-plugin-dev': patch
---

MetaVR telemetry no longer starts one process per command with nothing waiting for it. At most four MetaVR processes run at once and further events wait their turn, so a caller that issues commands quickly (a check script calling `runCli` in a loop, an agent driving the dev server) cannot pile up hundreds of Node processes; 600 rapid commands used to leave about 600 running, now at most four. Events beyond 1000 waiting are dropped, session and error events from the dev server go ahead of waiting tool calls, and on exit a few waiting events are started and the rest dropped. A single command reports exactly as before.
