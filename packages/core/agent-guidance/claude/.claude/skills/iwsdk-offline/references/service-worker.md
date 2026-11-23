# Service Worker

`scripts/sw.js.template` (copied from `assets/sw.js.template`) has three
placeholders — `RELEASE`, `FILES`, and `ON_REQUEST` — that the build step fills
in. It is plain JavaScript with no imports, so it is copied, not bundled. Install
copies the release, activate removes older releases, and fetch answers from the
copy.

## Request routing

| Request | Answered from |
| --- | --- |
| Anything but a GET | the network, untouched |
| A pinned third-party URL | its long-lived cache; else the network, and kept |
| A path in `FILES` | the release cache; the network only if the browser evicted it |
| A path in `ON_REQUEST` | the release cache once kept; until then the network, kept if its hash matches |
| A navigation to a folder, such as the site root | that folder's `index.html` from the release cache |
| Anything else | the network, untouched |

## What to change

- **`PREFIX`, `KEPT`, `HASH`** — rename for the app. `KEPT` must not start with
  `PREFIX`, or the next activation deletes it.
- **`PINNED`** — covers IWSDK's controller models, the three.js decoders, and
  the starter's stock models on jsDelivr. Match `three@` to the project's
  three.js revision and `example-assets@` to `src/assets.ts`, and delete the
  stock-model path if the app mirrors those files or never loads them. If the
  app fetches nothing from other origins, delete `PINNED`, `PAIRED`,
  `thirdParty()`, `keepPinned()`, and `keepPair()`.

Third-party files often come in families. IWSDK's controller models come as
`left.glb` and `right.glb` in the same profile folder, so `PAIRED` keeps the
other hand's model whenever one is kept: a user who only ever used one
controller online still has both offline. Add a rule like it for any other
family the app fetches piece by piece.

## Behaviour to keep

- **Cache-first, with no revalidation.** A page loaded from the copy is exactly
  its release, and a new release arrives only through `sw.js`.
- **Query strings are ignored**, so a start URL such as `/?source=pwa` gets the
  cached `index.html`.
- **No `skipWaiting()` of its own.** The worker calls it only on the page's
  `'take-over'` message; the page decides when a release takes over.
- **A take-over needs the asking page to be alone.** `skipWaiting()` moves every
  open page of the scope onto the new release, and activation deletes the old
  release's cache under them: a second tab in the middle of an XR session would
  load the new release's files, or none offline. So the worker grants
  `'take-over'` only when one window of the scope is open; otherwise the release
  waits until every page has closed, and the browser activates it then.
- **Only CORS responses are kept.** A `no-cors` request returns an opaque
  response with status `0` and an unreadable body, which cannot be checked.

## Where the hash is compared

- **At build.** The release is named by a hash of its whole file list, so it
  changes exactly when a listed file changes.
- **At install, file by file.** The worker looks in this release's own cache
  first (an interrupted install resumes), then in earlier releases' caches, then
  in the HTTP cache, and only then asks the server. Each cached copy carries its
  hash in an `x-content-sha256` header, so an unchanged file is copied across,
  never downloaded.
- **After every download.** The bytes are hashed before they are cached. A
  mismatch is asked for again with `cache: 'no-cache'`, and a second mismatch
  fails the install, which the browser retries on a later visit. This catches
  stale CDN edges and a deploy that is still spreading.
- **On a first visit.** The page downloads its files before the worker exists,
  and the worker takes them from the HTTP cache, so nothing crosses the wire
  twice.
- **For optional files.** The same check runs when one is first fetched: a
  stale copy is served that once and never kept.
- **For third-party files.** They have no hash in the list. The pinned URL is
  their identity, and each is kept once per device.

## Updates

A new release installs beside the old one and waits. The page decides when it
takes over: at once if `isIdle()` is `true`, when the app next calls
`checkIdle()` while idle, or otherwise at the next load, before the app builds
anything — each time only if no other page of the app is open. Installing reuses every unchanged file from the old
release's cache by its hash, so an update downloads only what changed. Optional
files the old release kept come across while their hash is unchanged, and the
third-party cache is never touched. After `'take-over'`, activation deletes the
older release caches and claims the page, which sees `controllerchange` and
reloads from the new copy.

## Vercel headers

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
