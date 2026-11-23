# Build Step

`scripts/write-service-worker.mjs` (copied from
`assets/write-service-worker.mjs.template`) runs after `vite build`, once every
output file — `public/` included — is in `dist/`. It hashes each file, sorts it
into a list, names the release, and writes `dist/sw.js` from
`scripts/sw.js.template`.

```json
{
  "scripts": {
    "build": "vite build && node scripts/write-service-worker.mjs dist scripts/sw.js.template"
  }
}
```

It prints `sw.js: release <name>, <n> files, <m> on request`. Read that line
after every change to the rules.

## Rewrite the rules for the app

- **`LEFT_OUT`** — never listed. Keep the worker itself, source maps, crawler
  and link-preview files, and `AGENTS.md`; add anything nothing requests.
- **`ON_REQUEST`** — listed with its hash, but copied only once the page fetches
  it. Use it for files only some users need: copying them for everyone costs
  every user for the benefit of a few. The kit's two rules
  (`fonts/(ja|ko|zh)-`, `levels/extra-`) are examples; replace them.

## Three details that matter

- The paths are sorted before hashing, so the same output always gives the same
  release name, and an unchanged build writes a byte-identical `sw.js`, which
  browsers ignore.
- The placeholders are replaced through functions, because a replacement string
  would read `$&` in a file name as a pattern.
- The script must run after every file exists: a file written later is missing
  from the list, so it is never kept. That is why it runs after `vite build`
  rather than from a plugin's `closeBundle` hook.

## Identify files by hash

Decide everything by the SHA-256 of a file's bytes, never by its name, date, or
version number. The one hash answers three questions: did the file change since
the last release, is a copy already on the device, and is the copy just
downloaded the right one.

| Signal | Decide by it? | Why |
| --- | --- | --- |
| SHA-256 of the bytes, computed at build | yes | the same bytes give the same hash on any machine |
| Hashed file names (`index-3f9a2c.js`) | only for Vite's own output | files copied from `public/` keep their names when their content changes |
| Modification time | no | a fresh checkout or a CI build gives every file a new time |
| `ETag` or `Last-Modified` | no | each server or CDN edge computes its own |
| One version number for the whole app | only as a label | a new number makes every file look changed, so every user downloads everything again |

## Duplicate files

Two paths with identical bytes share a hash but are stored twice, because the
Cache API keys entries by URL. To find them, group the list by hash inside
`writeServiceWorker()` (`Object.groupBy` needs Node.js 21 or later):

```js
const byHash = Object.groupBy(Object.entries(files), ([, hash]) => hash);
for (const group of Object.values(byHash)) {
  if (group.length > 1)
    console.warn('same bytes:', group.map(([path]) => path).join(', '));
}
```

One duplicate is built in: the page loads `/`, but the list names `index.html`,
so a first visit fetches the entry page twice under two URLs. It is usually a
few kilobytes; list the entry page under its own URL if that matters.
