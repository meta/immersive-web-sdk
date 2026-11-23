---
name: iwsdk-offline
description: Make an IWSDK app run with no connection after one online visit — a service worker that keeps one hash-checked copy of the current release, downloads each file once, and swaps releases only when nothing would be interrupted. Use when the app must work offline or survive a dropped connection, when an installed PWA/TWA must launch without a network, or when an offline copy serves a stale release, misses files, or downloads everything twice.
argument-hint: '[offline goal, e.g. "work offline" or "launch offline from the Store"]'
---

# Offline Copy

A built IWSDK app is a static `dist/`, so it can run with no connection once a
service worker holds a complete copy of it. This design keeps exactly one
release on the device: the build lists every file with its SHA-256, the worker
copies that list and answers from it cache-first, and the page alone decides
when the next release takes over. Each file crosses the wire once, nothing
unchecked is kept, and a release never swaps mid-session.

User request is in `$ARGUMENTS`.

```
1. Sort the files   → release list, kept on request, or never cached
2. Copy the kit     → build script, worker template, page module + build step
3. Adapt the worker → cache names and PINNED third-party paths
4. Wire the page    → startOffline() and keepOfflineCopy() in src/index.ts
5. Hosting          → sw.js uncached, hashed files immutable   [iwsdk-hosting]
6. Verify           → first visit, reload, offline, update, mid-session, two pages
```

The kit in `assets/` was tested end to end in Chromium against an IWSDK starter
build — first visit, reload, offline, update, and an update during an XR
session. Copy it verbatim and change only what steps 2–4 name; a rewrite loses
that.

## Step 1 — Sort the files

Ask of every file the build emits or the app fetches:

| Question | If yes |
| --- | --- |
| Does the build produce it, and does every user need it to run? | release list — copied at install |
| Do only some users need it (extra levels, other languages' fonts, HD packs)? | `ON_REQUEST` — kept the first time it is fetched |
| Is it a third-party file at a version named in its URL? | `PINNED` — kept in a long-lived cache on first fetch |
| Does the server decide it per user or per moment (APIs, sign-in, analytics, any non-GET)? | never cached |

What the user creates — saves, settings, progress — belongs in IndexedDB or
`localStorage`, never in the release cache, which is replaced on every update.

IWSDK and the starter fetch from other origins at runtime, and the kit's
`PINNED` already matches all three:

- **Controller models** —
  `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/<profile>/<handedness>.glb`.
  The path is hard-coded, so the worker's cache is the only way to keep them
  offline. `@1.0` is a release line, not one version; the worker keeps the
  first copy it receives, and keeps the other hand's model with it.
- **Draco and KTX2 decoders** — `https://unpkg.com/three@0.<revision>.0/…`,
  fetched only when the app loads compressed glTF files or KTX2 textures. Apps
  cannot point IWSDK at self-hosted decoders.

- **Stock models** — the starter's `src/assets.ts` loads them from
  `https://cdn.jsdelivr.net/npm/@iwsdk/example-assets@0.4.2/assets/…`. Mirroring
  them under `public/` with `VITE_IWSDK_EXAMPLE_ASSET_BASE_URL` is better:
  mirrored files become release files and are hash-checked like any other.
  Then delete that path from `PINNED`.

## Step 2 — Copy the kit

```bash
kit="$(dirname "$(find .claude/skills .agents/skills -path '*/iwsdk-offline/assets/sw.js.template' -print -quit)")"
mkdir -p scripts
cp "$kit/write-service-worker.mjs.template" scripts/write-service-worker.mjs
cp "$kit/sw.js.template" scripts/sw.js.template
cp "$kit/offline.ts.template" src/offline.ts
```

In a JavaScript project, save the page module as `src/offline.js` and delete
its type annotations; nothing else changes. A TypeScript project needs the `.ts`
file: the scaffold's `tsconfig.json` has no `allowJs`. The worker keeps its
`.template` extension so Vite, `tsc`, and linters never touch its placeholders.

Make the build script the last step of `build` in `package.json`:

```json
"build": "vite build && node scripts/write-service-worker.mjs dist scripts/sw.js.template"
```

Run it after `vite build`, never from a plugin's `closeBundle` hook: every
plugin must have finished writing, or a late file is missing from the list and
never kept. Its `LEFT_OUT` rules skip source maps (the starter emits them unless
`NODE_ENV=production`) and `AGENTS.md` (the scaffold keeps agent instructions in
`public/ui/` and `public/scenes/`, so Vite publishes them); add the app's own
`LEFT_OUT` and `ON_REQUEST` rules from step 1. Rules, hash signals, and a
duplicate finder: [`references/build-step.md`](references/build-step.md).

## Step 3 — Adapt the worker

In `scripts/sw.js.template`, change only:

- **`PREFIX`, `KEPT`, `HASH`** — rename for the app. `KEPT` must not start with
  `PREFIX`, or the next activation deletes the third-party cache.
- **`PINNED`** — the kit pins `three@0.185.0` and `example-assets@0.4.2`, the
  versions new projects get. Match `three@` to the project's `three` in
  `package.json` (`super-three@0.181.0` → `three@0.181.0`) and
  `example-assets@` to `src/assets.ts`, delete paths the app never loads, and
  add any other third-party paths from step 1. If the app fetches nothing from
  other origins, delete `PINNED`, `PAIRED`, `thirdParty()`, `keepPinned()`, and
  `keepPair()`.

Never add `skipWaiting()` to `install` or `activate`, and never revalidate in
`fetch`: the page alone decides when a release takes over, and answers are
cache-first so that a page is exactly its release. The worker grants a
take-over only while the asking page is the app's only open page, because it
moves every open page onto the new release. Request routing, hash checks,
and updates: [`references/service-worker.md`](references/service-worker.md).

## Step 4 — Wire the page

In `src/index.ts`:

```ts
import { VisibilityState, World } from '@iwsdk/core';
import { checkIdle, keepOfflineCopy, startOffline } from './offline.js';

let world: World | undefined;
const isIdle = () =>
  world?.visibilityState.peek() === VisibilityState.NonImmersive;
startOffline(isIdle); // before World.create()

World.create(container, projectOptions).then((created) => {
  world = created;
  // …system registration…
  keepOfflineCopy(isIdle); // after the first screen, not at startup
  created.visibilityState.subscribe(() => checkIdle()); // a session just ended
});
```

`isIdle()` must be `false` whenever a reload would interrupt anything: an XR
session (covered above), an unsaved edit, a game in progress. Call
`checkIdle()` whenever one of those ends, so a release that installed
meanwhile takes over then rather than at the next load. Registering only
once `World.create()` has resolved lets the worker take every file from the
HTTP cache instead of downloading it a second time. The reason for each line:
[`references/page.md`](references/page.md).

## Step 5 — Hosting

| Path | Header |
| --- | --- |
| `/sw.js` | `Cache-Control: no-cache` |
| `/assets/*` (Vite's hashed output) | `public, max-age=31536000, immutable` |
| Unhashed files: images, models, fonts, data | a short `max-age`, optionally `stale-while-revalidate` |
| HTML | `no-cache` or a short `max-age` |
| Every path, if a CSP is sent | `worker-src 'self'`, and a `connect-src` naming each `PINNED` path |

Serve `sw.js` from the root of the scope it controls; a worker cannot control
pages above its own folder. It needs a secure context — HTTPS, or
`http://localhost` for testing. On a host the developer owns, these headers are
part of the upload handoff, so take them through `iwsdk-hosting`. Then verify:

```bash
curl -sI https://<DOMAIN>/sw.js | grep -i '^cache-control'   # want no-cache
```

The `vercel.json` headers for Vercel are in
[`references/service-worker.md`](references/service-worker.md).

## Step 6 — Verify

`npm run dev` serves no `sw.js`, so registration fails quietly there and proves
nothing — verify a production build. Six checks, each about what crosses the
wire:

1. **First visit** — the release cache holds every listed file, and no file was
   sent in full twice.
2. **Reload** — the server is asked for nothing but `sw.js`.
3. **Offline** — with the network off, a reload starts the app and kept files
   are served.
4. **Update while idle** — only the changed file downloads, the new release
   takes over, and the old release cache is gone.
5. **Update mid-session** — the page is not reloaded during the session; when
   it ends, the new release takes over.
6. **Two pages open** — an update takes over neither page; once one remains,
   its next idle moment or load takes it.

The harness rules (logging server, no Playwright routes, persistent profile,
polling loops) and headset testing over `adb reverse`:
[`references/testing.md`](references/testing.md).

## Installed apps (PWA/TWA)

A packaged Quest app loads `<DOMAIN>` like any page, so the same copy serves it
offline — after **one online launch**, which is when the copy is made.

- `start_url` and `scope` in the manifest must sit inside the worker's scope;
  `/sw.js` covers the whole origin. The worker ignores query strings, so
  `"start_url": "/?source=pwa"` is served the cached `index.html`.
- The manifest and its icons live in `public/`, so they are in the release list.
- A web redeploy installs in the background during a launch and takes over when
  the app is idle (no XR session), or on the launch after that — one launch later than without
  the copy. Native changes still need a new APK.
- An immersive app that auto-enters XR (`iwsdk-pwa-packaging` step 1) spends the
  launch tap on `world.launchXR()`. When a release is waiting, `startOffline()`
  reloads the page at startup to take it, so verify on the headset that the
  reloaded page still enters XR before shipping.

## Reference Files

| File | Load when |
| ---- | --------- |
| [`assets/`](assets/) | Step 2 — `write-service-worker.mjs.template`, `sw.js.template`, `offline.ts.template`; copy, never retype |
| [`references/build-step.md`](references/build-step.md) | Step 2 — `LEFT_OUT` and `ON_REQUEST`, hash signals, duplicate files |
| [`references/service-worker.md`](references/service-worker.md) | Step 3 — request routing, what to keep, hash checks, updates, Vercel headers |
| [`references/page.md`](references/page.md) | Step 4 — what each part of the page module does, and the wiring |
| [`references/testing.md`](references/testing.md) | Step 6 — the five checks, the harness, headset testing |

Publishing the build and its headers is the `iwsdk-hosting` skill, and packaging
it into a Quest APK is `iwsdk-pwa-packaging`. This skill only makes it work
offline.
