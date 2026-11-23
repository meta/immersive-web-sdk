# Testing the Offline Copy

Six checks prove the design. Each is about what crosses the wire, so the test
watches the wire.

| # | Check | Pass when |
| - | ----- | --------- |
| 1 | First visit | the release cache holds every listed file; no file was sent in full twice; no optional file nobody asked for was downloaded; optional and pinned files fetched before the worker existed are kept |
| 2 | Reload | the server is asked for nothing but `sw.js` |
| 3 | Offline | with the network off, a reload starts the app and kept files are served; an optional file never fetched online is missing, as it should be |
| 4 | Update while idle | after one file changes, only that file is downloaded; the new release takes over; the old release cache is gone; kept optional files came across |
| 5 | Update mid-session | the page is not reloaded during the session; when it ends, the new release takes over |
| 6 | Two pages open | an update while a second page of the app is open takes over neither page; once only one remains, the next idle moment or load takes it |

## Harness

- **A logging server.** Serve the built `dist/` from a small server that logs
  every request and answers revalidations with ETags and `304`, as a real host
  does. Count only full `200` responses per path: a path sent twice is a
  duplicate download.
- **No request interception.** Playwright turns the HTTP cache off whenever a
  route is registered, and the first copy is made from that cache.
- **A persistent browser profile** (`launchPersistentContext`). It keeps the
  HTTP cache on disk, as on a real device; an in-memory cache may refuse a large
  file.
- **Polling loops.** Wait by calling `page.evaluate()` in a loop.
  `page.waitForFunction()` does not wait for an async predicate, because a
  promise counts as truthy.
- **An offline switch.** `context.setOffline(true)` takes the context offline
  for check 3.
- **An XR session for check 5.** In desktop Chromium the injected IWER emulator
  provides one: call `world.launchXR()` and wait until `world.visibilityState`
  leaves `'non-immersive'`, so `isIdle()` is `false`.

Playwright attaches to every service worker, and that can stall activation after
`skipWaiting()` for over a minute, in some runs and not in others. If checks 4
or 5 hang on the take-over, drive them over the Chrome DevTools Protocol with
only the page attached, or by hand.

## On the headset

Test a production build: `npm run dev` serves no `sw.js`. Build, serve `dist/`
over plain HTTP on a local port, and forward it so that
`http://localhost:<port>` counts as a secure context in Meta Quest Browser:

```bash
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
adb reverse tcp:4173 tcp:4173   # then open http://localhost:4173 on the headset
```

Not `npx vite preview`: the IWSDK Vite plugin serves it over HTTPS with a
self-signed certificate, and Quest Browser refuses to register a service worker
from a page with a certificate error.

Clear the origin's storage between runs, for example with the DevTools
Protocol's `Storage.clearDataForOrigin`, or the site settings in the browser.
