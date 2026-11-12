# Web App Manifest and Icons

Both modes need a valid, installable web app manifest and PNG icons, live on
`<DOMAIN>` **before** `bubblewrap update` runs — it fetches them over the
network and fails or silently falls back if they are missing.

The scaffolded app ships neither: `public/` has no manifest, and `index.html`
has a placeholder `<link rel="icon" href="data:," />`. Both are added here.

## The manifest

`public/manifest.webmanifest` — Vite copies `public/` verbatim into `dist/`, so
it is served at `/manifest.webmanifest` with no further wiring.

```json
{
  "name": "Full App Name",
  "short_name": "App",
  "description": "One sentence shown at install time.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "landscape",
  "background_color": "#06010f",
  "theme_color": "#0a0418",
  "icons": [
    { "src": "/icons/icon-192.png", "type": "image/png", "sizes": "192x192", "purpose": "any" },
    { "src": "/icons/icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "type": "image/png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```

| Field | Why it matters here |
| ----- | ------------------- |
| `name` / `short_name` | `short_name` is the launcher label; keep it under ~12 characters or it truncates |
| `start_url` / `scope` | must match the hosting path — `/` at an origin root, `/<path>/` on a subpath deployment |
| `display` | `standalone` for both modes; `browser` forces a URL bar |
| `background_color` | painted before first frame — match the app's clear color or launch flashes white |
| `theme_color` | colors the custom tab bar on a 2D panel; add `theme_color_dark` if the app is dark-first |
| `icons` | at minimum 192 and 512 `any`, plus one 512 `maskable` |

`bubblewrap` seeds `twa-manifest.json` from these values, so getting them right
now avoids hand-correcting them in two places later.

## Link it in `index.html`

Replace the placeholder icon line in the scaffolded `<head>`:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0a0418" />
<link rel="icon" href="/icons/icon-192.png" />
```

Use absolute `/`-rooted paths here even though `vite.config.*` sets
`base: './'`. The relative base is for hashed bundle assets; the manifest and
icons are referenced by the platform from a known URL, and a relative path
resolves differently depending on the entry route.

## Generating icons

There is no ImageMagick or PIL to rely on. Use `sharp` — the scaffold already
pins a working version via `overrides`:

```bash
npm i -D sharp
```

Write an SVG and rasterize each size:

```js
// scripts/icons.mjs — run with `node scripts/icons.mjs`
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#7c4dff"/>
      <stop offset="100%" stop-color="#06010f"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <!-- glyph goes here -->
</svg>`;

await mkdir('public/icons', { recursive: true });
const png = (size, out) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);

await png(512, 'public/icons/icon-512.png');
await png(192, 'public/icons/icon-192.png');
await png(512, 'public/icons/icon-512-maskable.png');
```

Two constraints that produce visible defects when ignored:

- **Prefer radial/linear gradients over blur filters.** `sharp`'s SVG rasterizer
  renders Gaussian blur poorly; glows come out banded or clipped.
- **The maskable icon must be full-bleed and opaque** — no transparency, no
  rounded corners, and keep the glyph inside the middle ~80% safe zone. The
  platform applies its own mask, so transparent or pre-rounded edges show as
  chipped corners on the launcher.

The `any` and `maskable` icons can be the same artwork only if that artwork is
already full-bleed. If the `any` icon has transparent padding, generate two.

## Subpath hosting

Serving from `https://<DOMAIN>/<path>/` changes two manifest fields:

```json
"start_url": "/<path>/",
"scope": "/<path>/"
```

Icon `src` values can stay `/`-rooted if the icons are at the origin root, but
it is less error-prone to make them relative to the scope (`icons/icon-512.png`)
and let the manifest URL resolve them.

`assetlinks.json` is unaffected by this and must still be at the **origin
root** — see `iwsdk-hosting` §5.

## Multi-origin 2D apps

If a 2D panel app legitimately navigates across origins, list them so they stay
in scope instead of bouncing to the browser:

```json
"additional_trusted_origins": ["https://other.example"]
```

Every listed origin must also serve `/.well-known/assetlinks.json` with the same
package name and certificate fingerprint. A missing one does not error — the
origin just falls out of scope at runtime.

## Verify before packaging

```bash
npm run build
for u in /manifest.webmanifest /icons/icon-192.png /icons/icon-512.png /icons/icon-512-maskable.png; do
  printf '%s ' "$u"; curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "https://<DOMAIN>$u"
done
```

All 200. The manifest must be `application/manifest+json` — `text/plain` means
the host has no mapping for `.webmanifest`; fix it per
`iwsdk-hosting/references/existing-hosts.md`.
