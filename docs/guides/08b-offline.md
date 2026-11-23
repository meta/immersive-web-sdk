---
outline: [2, 4]
---

# Run Your Web Experience Offline

A web experience can run with no connection after one online visit: a service worker keeps one complete, hash-checked copy of the current release on the device and serves it.

This page describes a design that downloads each file once, reuses every unchanged file across updates, and swaps releases only when nothing would be interrupted. It suits any app whose files come out of a build, including an IWSDK app. Server-rendered pages, API data, and anything personal need other strategies.

## How It Works

The build fixes what a release holds, the worker keeps and serves it, and the page alone decides when the next one takes over:

1. After `vite build`, a script hashes every file in `dist/` and writes the service worker, `sw.js`, with that list.
2. Once the first screen is up, the page registers the worker. The worker copies every listed file into a cache, taking each one from the browser's HTTP cache when it can.
3. From then on, the worker answers those requests from its copy, online or offline.
4. A later deploy changes `sw.js`. The new release installs beside the old one and downloads only the files whose hash changed.
5. The page lets the new release take over when a reload would interrupt nothing, or at the next load.

Five rules hold it together:

- **One release at a time.** The build lists every file with its hash, and the copy is exactly that list, never a mix of two releases.
- **Each file crosses the wire once.** The first copy comes out of the browser's HTTP cache, and an update downloads only the files whose hash changed.
- **Nothing unchecked is kept.** Every file is hashed before it is cached.
- **Never mid-session.** A new release takes over only when a reload would interrupt nothing, or on the next load, and never while another page of the app is open.
- **Only what a user needs.** Files that only some users want are kept the first time they are fetched.

## Add It to Your Project

Projects created with `@iwsdk/create` include the `iwsdk-offline` skill. Ask your coding agent to make the app work offline, and the skill adds three files and one build step:

| File                               | What it does                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/write-service-worker.mjs` | Runs after `vite build`: hashes every file in `dist/`, sorts it into a list, names the release, and writes `dist/sw.js` from the template                     |
| `scripts/sw.js.template`           | The service worker, as plain JavaScript with three placeholders: install copies the release, activate removes older releases, and fetch answers from the copy |
| `src/offline.ts`                   | The page's side: when the copy is made, and when a new release may take over                                                                                  |

To add them by hand, copy them from the skill's `assets/` folder, in `.claude/skills/iwsdk-offline/` or `.agents/skills/iwsdk-offline/` in your project, or [on GitHub](https://github.com/facebook/immersive-web-sdk/tree/main/packages/core/agent-guidance/claude/.claude/skills/iwsdk-offline/assets). Drop the `.template` suffix from all but the worker, and in a JavaScript project save the page module as `src/offline.js` without its type annotations. Then make the script the last step of the build:

```json
{
  "scripts": {
    "build": "vite build && node scripts/write-service-worker.mjs dist scripts/sw.js.template"
  }
}
```

Running the script after `vite build`, rather than from a plugin's `closeBundle` hook, guarantees that every plugin has finished writing: a file written later is missing from the list, so it is never kept.

The implementation was tested end to end in Chromium against an IWSDK starter build: first visit, reload, offline, update, and an update during an XR session.

## Decide What to Cache

Cache what the build produces and every user needs to run the app. Keep optional files only once someone uses them, and never cache what the server decides per user or per moment.

| Asset                                                                                                                                    | Where it goes                                         | Why                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Entry HTML, JavaScript bundles, CSS, web workers, WebAssembly such as Havok                                                              | Release list, copied at install                       | Without them the app cannot start                                   |
| Media the core experience needs: glTF models, textures, audio, fonts, UIKitML panels, scene JSON                                         | Release list, copied at install                       | Needed offline from the first session                               |
| The web app manifest and its icons                                                                                                       | Release list, copied at install                       | An installed app's launcher reads them                              |
| Large or optional files only some users need: other languages' fonts or text, extra levels, high-resolution packs                        | Kept on request, the first time the page fetches them | Copying them for everyone costs every user for the benefit of a few |
| Pinned third-party files fetched at runtime, such as WebXR controller models or a font from a CDN                                        | A separate long-lived cache, kept on first fetch      | They belong to no release, and a pinned version never changes       |
| Source maps, `robots.txt`, `sitemap.xml`, `llms.txt`, link-preview images, the `AGENTS.md` files under `public/`, files nothing requests | Left out of the lists                                 | No user ever fetches them                                           |
| The service worker script                                                                                                                | Left out                                              | The browser fetches and stores it itself                            |
| API responses, sign-in, payments, analytics, WebSocket or WebRTC traffic, every non-GET request                                          | Never cached: straight to the network                 | They are personal, live, or have side effects                       |
| What the user creates: saves, settings, progress                                                                                         | IndexedDB or `localStorage`                           | The release cache is replaced on every update                       |

Three questions sort any file:

1. Does the build produce it, and does every user need it to run? List it for install.
2. Do only some users need it? Keep it on request.
3. Does the server decide its contents per user or per moment? Never cache it.

The build script's `LEFT_OUT` and `ON_REQUEST` rules and the worker's `PINNED` pattern hold these choices; rewrite them for your app. By default the script leaves out source maps, which the IWSDK starter writes unless `NODE_ENV` is `production`, and the `AGENTS.md` instructions for coding agents that the starter keeps in `public/ui/` and `public/scenes/`.

Keep a third-party file only at a pinned version, one named in its URL. Only a CORS response can be checked: a `no-cors` request returns an opaque response with status `0` and an unreadable body. Watch the total size too: `navigator.storage.estimate()` reports what the origin uses and may use.

### Third-Party Files in an IWSDK App

IWSDK and the starter fetch some files from other origins at runtime, so the service worker keeps them in its long-lived cache. Its default `PINNED` pattern covers all three:

- **Controller models.** IWSDK loads each controller's model from `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/<profile>/<handedness>.glb`. `@1.0` names a release line rather than one version, so the CDN serves the newest 1.0 release, and the worker keeps the first copy it receives. Models come as `left.glb` and `right.glb` in one profile folder, and the worker keeps the other hand's model whenever it keeps one, so a user who only ever used one controller online still has both offline.
- **Draco and KTX2 decoders.** When the app loads Draco-compressed glTF files or KTX2 textures, IWSDK fetches the decoders from `https://unpkg.com/three@0.<revision>.0/`, pinned to the app's three.js revision: `three@0.185.0` for `super-three@0.185.0`, the version new projects use.
- **Stock example assets.** The starter loads its models from `https://cdn.jsdelivr.net/npm/@iwsdk/example-assets@<version>/`, pinned to the version in its `src/assets.ts`. Mirroring them under `public/`, as described in [Remote Stock Assets And Local Mirrors](/guides/04-external-assets#remote-stock-assets-and-local-mirrors), is better: a mirrored file is part of the release and is hash-checked like any other. Then remove that path from `PINNED`.

## Identify Files by Hash

Identify every file by the SHA-256 of its bytes, never by its name, date, or version number. That one hash answers three questions: did the file change since the last release, is a copy already on the device, and is the copy just downloaded the right one.

| Signal                                  | Decide by it?              | Why                                                                                           |
| --------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| SHA-256 of the bytes, computed at build | Yes                        | The same bytes give the same hash on any machine, so it changes exactly when the content does |
| Hashed file names (`index-3f9a2c.js`)   | Only for Vite's own output | Files copied from `public/` keep their names when their content changes                       |
| Modification time                       | No                         | A fresh checkout or a CI build gives every file a new time                                    |
| `ETag` or `Last-Modified`               | No                         | Each server or CDN edge computes its own, so equal content can carry different values         |
| One version number for the whole app    | Only as a label            | A new number makes every file look changed, so every user downloads everything again          |

Where the hash is compared:

- **At build.** The release is named by a hash of its whole file list. It changes exactly when a listed file changes, and an unchanged build writes a byte-identical worker, which browsers ignore.
- **At install, file by file.** The worker looks in this release's own cache first (an interrupted install resumes), then in earlier releases' caches, then in the HTTP cache, and only then asks the server. Each cached copy carries its hash in an `x-content-sha256` header, so an unchanged file is copied across, never downloaded.
- **After every download.** The bytes are hashed before they are cached. A mismatch is asked for again with `cache: 'no-cache'`, and a second mismatch fails the install, which the browser retries on a later visit. This catches stale CDN edges and a deploy that is still spreading.
- **On a first visit.** The page downloads its files before the worker exists, and the worker takes them from the HTTP cache, so nothing crosses the wire twice.
- **For optional files.** The same check runs when one is first fetched: a stale copy is served that once and never kept.
- **For third-party files.** They have no hash in the list. The pinned URL is their identity, and each is kept once per device.

Two paths with identical bytes share a hash but are stored twice, because the Cache API keys entries by URL. One duplicate is built in: the page loads `/`, but the list names `index.html`, so a first visit fetches the entry page twice under two URLs. It is usually a few kilobytes; list the entry page under its own URL if that matters.

## How the Worker Answers

| Request                                         | Answered from                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Anything but a GET                              | The network, untouched                                                        |
| A pinned third-party URL                        | Its long-lived cache; else the network, and kept                              |
| A path in the release list                      | The release cache; the network only if the browser evicted it                 |
| A path kept on request                          | The release cache once kept; until then the network, kept if its hash matches |
| A navigation to a folder, such as the site root | That folder's `index.html` from the release cache                             |
| Anything else                                   | The network, untouched                                                        |

Answers are cache-first with no revalidation, so a page loaded from the copy is exactly its release, and a new release arrives only through `sw.js`. Query strings are ignored, so a start URL such as `/?source=pwa` gets the cached `index.html`. The worker never calls `skipWaiting()` on its own: the page decides when a release takes over.

## Connect the Page

`src/offline.ts` exports three functions. `startOffline()` runs first thing at startup, so that a release that finished installing on an earlier visit takes over before anything starts. `keepOfflineCopy()` registers the worker once the first screen is up and asks the browser to keep the copy with `navigator.storage.persist()`. Both take your app's idle test. `checkIdle()` runs whenever the app becomes idle, so a release that installed during a session takes over when it ends. An IWSDK app is idle when no XR session is running; add your own state, such as an unsaved edit or a game in progress:

```ts
import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { checkIdle, keepOfflineCopy, startOffline } from './offline.js';

let world: World | undefined;
const isIdle = () =>
  world?.visibilityState.peek() === VisibilityState.NonImmersive;
startOffline(isIdle);

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((created) => {
  world = created;
  // ... register your systems ...
  keepOfflineCopy(isIdle);
  created.visibilityState.subscribe(() => checkIdle());
});
```

Three choices are yours:

- **When the first screen is up.** Registered at startup, the worker downloads the release while the page is still downloading it, so every file comes down twice. Registered after `World.create()` resolves, it takes each file from the HTTP cache instead.
- **What idle means.** `isIdle()` must be `false` whenever a reload could lose work or interrupt a session, and the app calls `checkIdle()` when such a state ends. When it is `true` and a new release has installed, the page reloads into the new release from the local copy.
- **How much the first load fetches.** Files the page fetched before the worker existed never passed through it, so the module reports them and the worker keeps the optional and pinned ones. The browser buffers 250 resource entries by default; if the first load fetches more, raise the limit early with `performance.setResourceTimingBufferSize()`.

`navigator.onLine` and the `online` and `offline` events say whether the device has a network, not whether your server answers. Use them to disable or explain features that need a connection, and still handle failed requests.

## How Updates Work

A new release installs beside the old one and waits, because the worker never calls `skipWaiting()` on its own. The page alone decides when it takes over: at once if `isIdle()` is `true`, when `checkIdle()` next finds the app idle, or otherwise at the next load, before the app builds anything.

A take-over moves every open page of the app onto the new release and deletes the old release's cache under them, so the worker grants it only while the asking page is the app's only open page. With two tabs open, the release waits until one closes and the other is next idle or reloads, or until both close.

Installing reuses every unchanged file from the old release's cache by its hash, so an update downloads only what changed. Optional files the old release kept come across while their hash is unchanged, and the third-party cache is never touched.

After `'take-over'`, activation deletes the older release caches and claims the page. The page sees `controllerchange` and reloads, now from the new copy.

## Configure Hosting

The host must serve the worker uncached, let hashed files live forever, and allow whatever third-party files the worker keeps.

| Path                                        | Header                                                                                                         | Why it matters                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sw.js`                                    | `Cache-Control: no-cache`                                                                                      | Browsers already skip the HTTP cache when checking the worker for updates (`updateViaCache` defaults to `'imports'`), but a CDN or proxy in between may not |
| Vite's hashed output in `/assets/`          | `public, max-age=31536000, immutable`                                                                          | A new build means new names, so a name never changes its content                                                                                            |
| Unhashed files: images, models, fonts, data | A short `max-age`, optionally with `stale-while-revalidate`                                                    | They keep their names across releases; the hash check and the `no-cache` retry correct any stale copy                                                       |
| HTML pages                                  | `no-cache` or a short `max-age`                                                                                | The worker serves them from the copy, so the host's copy matters only for first visits                                                                      |
| Every path                                  | `Content-Security-Policy` with `worker-src 'self'` and a `connect-src` that names each pinned third-party path | The page and the worker may fetch what the worker keeps, and nothing else                                                                                   |

On Vercel, set the first two in `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

Serve the worker from the root of the scope it controls, `/sw.js` for a whole site: a worker cannot control pages above its own folder unless the host sends `Service-Worker-Allowed`. The web app manifest's `start_url` and `scope` must sit inside the worker's scope, or an installed app launches outside the copy.

A service worker needs a secure context: HTTPS in production, while `http://localhost` and `http://127.0.0.1` count as secure for testing. A content security policy refuses blocked fetches without telling the user, and a dev server that sends no policy shows nothing wrong, so test with the production headers.

## Installed Apps

A Progressive Web App installed on Meta Quest, or packaged for the Meta Horizon Store as a Trusted Web Activity, loads its `start_url` from your origin like any page. The same offline copy serves it with no connection:

- The manifest and its icons live in `public/`, so the build lists them for install.
- `start_url` and `scope` must sit inside the worker's scope. A worker at `/sw.js` covers the whole origin.
- The worker ignores query strings, so `"start_url": "/?source=pwa"` is served the cached `index.html`.
- The first launch needs a connection: the copy is made on that visit.
- A redeployed release installs in the background during a launch and takes over when the app is idle, or on the launch after that. Changes that need a new APK still need one.

An immersive app that enters XR on launch spends the launch tap on `world.launchXR()`. When a release is waiting, `startOffline()` reloads the page at startup to take it, so test entering XR after such a reload on the headset.

## Test the Offline Copy

Six checks prove the design. Each is about what crosses the wire, so the test watches the wire.

1. **First visit.** The release cache holds every listed file, and no file was sent in full twice. No optional file nobody asked for was downloaded, and optional and pinned files the page fetched before the worker existed are kept.
2. **Reload.** The server is asked for nothing but `sw.js`.
3. **Offline.** With the network off, a reload starts the app and kept files are served. An optional file never fetched online is missing, as it should be.
4. **Update while idle.** After one file changes, only that file is downloaded. The new release takes over, the old release cache is gone, and kept optional files came across.
5. **Update mid-session.** The page is not reloaded during the session; when it ends, the new release takes over.
6. **Two pages open.** An update takes over neither page; once only one remains, its next idle moment or load takes it.

Serve the built output from a small server that logs every request and answers revalidations with ETags and `304`, as a real host does, and count only full `200` responses per path: a path sent twice is a duplicate download. The `iwsdk-offline` skill describes a Playwright harness for all six checks, including the browser settings that keep the HTTP cache realistic.

On a headset, test a production build: `npm run dev` serves no `sw.js`, so registration fails quietly and the app runs online only. Build, serve `dist/` over plain HTTP on a local port (for example `python3 -m http.server 4173 --bind 127.0.0.1 --directory dist`), and forward that port with `adb reverse tcp:<port> tcp:<port>` so that `http://localhost:<port>` counts as a secure context in Meta Quest Browser. Avoid `npx vite preview` here: the IWSDK Vite plugin serves it over HTTPS with a self-signed certificate, and Quest Browser refuses to register a service worker from a page with a certificate error. Clear the origin's storage between runs, for example with the DevTools Protocol's `Storage.clearDataForOrigin`.

## Related Resources

- [Build & Deploy](/guides/08-build-deploy) covers production builds and GitHub Pages deployment for an IWSDK project.
- [Host Your Web Experience](/guides/08a-web-hosting) covers publishing the build at a public HTTPS URL.
- [Remote Stock Assets And Local Mirrors](/guides/04-external-assets#remote-stock-assets-and-local-mirrors) covers serving the stock example assets from your own origin.
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Progressive Web Apps](https://developers.meta.com/horizon/documentation/web/pwa-overview/) for optional Meta Horizon Store distribution
