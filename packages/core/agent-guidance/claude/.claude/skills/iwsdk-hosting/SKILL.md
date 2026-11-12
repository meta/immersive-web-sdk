---
name: iwsdk-hosting
description: Publish an IWSDK app to a public HTTPS origin so it can be installed as a PWA and packaged for the Meta Horizon Store. Use when deploying, hosting, or publishing the app, choosing a host, or when a file (web manifest, icons, .well-known/assetlinks.json) must reach an already-hosted site. Always asks first whether hosting already exists — recommends Vercel if not, and pauses with concrete upload steps if it does.
argument-hint: '[domain, host name, or deploy request]'
---

# PWA Hosting

Packaging a Quest APK reads the app over the network, not off disk:
`bubblewrap` fetches the web manifest and icons from the live origin, and the
Trusted Web Activity refuses to launch until Digital Asset Links are reachable
there too. So the origin — call it `<DOMAIN>` — comes first, and every later
step depends on files actually being served from it.

User request is in `$ARGUMENTS`.

## 1. Ask about hosting before doing anything else

**Never assume.** Ask the developer, up front, whether the app is already
deployed — with a structured question tool (AskUserQuestion) if the harness has
one, otherwise as a plain question. Do not deploy anything, do not pick a host,
and do not run a deploy CLI until this is answered.

> Is this app already deployed to a public HTTPS URL?
>
> - **Not deployed yet — recommend a host** → Route A
> - **Already hosted / host already chosen** (Netlify, Cloudflare Pages, GitHub
>   Pages, S3+CloudFront, Firebase, own nginx/Apache server, internal CDN…) →
>   Route B
> - **Deployed, but open to moving it** → describe both, then let them pick

If they answer with a URL, treat it as Route B and use that URL as `<DOMAIN>`.
If they are unreachable and you must proceed autonomously, take Route A, and
mark the choice `[ASSUMED]` in whatever plan or report you are writing.

## 2. Route A — no host yet: recommend Vercel

Recommend Vercel, and say why in one line: it detects Vite with no config,
serves `dist/` over HTTPS with a stable public alias, keeps `public/` dotfolders
like `.well-known/` intact, and redeploys with one command — which matters
because asset links force a second publish later.

```bash
npm run build                                   # → dist/
npx -y vercel@latest whoami                     # auth check
npx -y vercel@latest teams ls                   # find <team-slug>
npx -y vercel@latest deploy --prod --yes --scope <team-slug>
```

Use the **canonical alias** (`https://<project>.vercel.app`) as `<DOMAIN>`, not
the hashed per-deploy URL — under team deployment protection the hashed URL
returns 401 and every downstream fetch fails. Full walkthrough, first-run login,
and the redeploy rule: [`references/vercel.md`](references/vercel.md).

Then run the [contract check](#4-the-contract-what-must-be-reachable).

## 3. Route B — host already chosen: pause and hand off

The developer owns the host, so **you do not publish — you prepare files and
stop.** Every time something new has to reach `<DOMAIN>`, run the handoff below
rather than guessing at their pipeline.

Publishing to an existing host happens at least **twice**, and the second one is
easy to forget:

| # | When | What must reach `<DOMAIN>` |
| - | ---- | -------------------------- |
| 1 | after the manifest + icons exist | the whole built `dist/` |
| 2 | after the signing keystore exists | `dist/.well-known/assetlinks.json` (rebuild first) |

A third happens for any later web-only fix — those need only a republish, never
a new APK.

### Upload handoff protocol

Run this at each row above. Keep it short and literal; the developer should be
able to act without asking a follow-up question.

1. **Build first.** `npm run build`. Vite copies `public/` — including
   dotfolders like `.well-known/` — verbatim into `dist/`.
2. **List the exact files and their exact destination URLs.** Local path →
   public URL, one per line. Never say "upload the assets".
3. **Give the concrete steps for their host**, not generic advice — the command
   for their CLI, or the click path for their dashboard. Per-host recipes and
   gotchas (dotfolder stripping, MIME types, subpath hosting, cache TTLs) are in
   [`references/existing-hosts.md`](references/existing-hosts.md). If the host is
   one you do not recognize, ask how they normally publish and adapt.
4. **Offer to run it — do not assume you can.** Only run their deploy command
   yourself if they confirm the CLI is installed and authenticated in this
   environment. Otherwise they run it; suggest they can paste it into this
   session prefixed with `!`.
5. **Stop and wait.** Do not continue to the next pipeline step on the
   assumption the upload happened.
6. **Verify yourself once they say it is live**, with the checks in §4. If a
   check fails, report the failing URL and status code and hand back — a wrong
   guess here surfaces much later as "the TWA will not launch".

Handoff message template:

```
Ready to publish. Please upload these to <DOMAIN>:

  dist/manifest.webmanifest      → https://<DOMAIN>/manifest.webmanifest
  dist/icons/icon-192.png        → https://<DOMAIN>/icons/icon-192.png
  dist/icons/icon-512.png        → https://<DOMAIN>/icons/icon-512.png
  dist/icons/icon-512-maskable.png → https://<DOMAIN>/icons/icon-512-maskable.png
  (or simply publish all of dist/ — these are already inside it)

On <host>, that is:
  <the one command, or the exact dashboard click path>

Tell me when it is live and I will verify, then continue with packaging.
```

## 4. The contract: what must be reachable

Whichever route was taken, `<DOMAIN>` must satisfy all of this before
`bubblewrap update` runs. Check it yourself — do not take "it is deployed" as
proof.

| URL | Expected |
| --- | -------- |
| `https://<DOMAIN>/` | 200, HTTPS, valid cert |
| `https://<DOMAIN>/manifest.webmanifest` | 200, `Content-Type: application/manifest+json` |
| `https://<DOMAIN>/icons/icon-512.png` | 200, `image/png` |
| `https://<DOMAIN>/.well-known/assetlinks.json` | 200, `application/json` (after the keystore step) |
| `https://<DOMAIN>/android.keystore` | **404** — the keystore must never be published |

```bash
for u in / /manifest.webmanifest /icons/icon-512.png /.well-known/assetlinks.json; do
  printf '%s ' "$u"; curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "https://<DOMAIN>$u"
done
curl -s -o /dev/null -w 'keystore %{http_code} (want 404)\n' "https://<DOMAIN>/android.keystore"
```

Two failures are worth calling out because they look like host bugs and are not:

- **`.well-known/` 404s** while everything else works — the host is stripping
  dotfolders. Fix per [`references/existing-hosts.md`](references/existing-hosts.md);
  do not work around it by moving the file, the path is fixed by the TWA spec.
- **The manifest serves as `text/plain`** — some hosts have no mapping for
  `.webmanifest`. Add the MIME type, or serve it as `manifest.json` and update
  the `<link rel="manifest">` and `webManifestUrl` to match.

## 5. Hosting at a subpath

If the app is served from `https://<DOMAIN>/<path>/` rather than the origin
root, two things change and both break silently:

- `start_url` and `scope` in the web manifest must be `/<path>/`, not `/`.
- `assetlinks.json` still has to sit at the **origin root**
  (`https://<DOMAIN>/.well-known/assetlinks.json`) — a subpath copy is ignored.
  If the developer does not control the origin root, they cannot ship a TWA from
  that origin. Say so plainly and offer Route A as the alternative.

`base: './'` is already set in the scaffolded `vite.config.*`, so the JS/CSS
bundles themselves are fine at any path — it is only these two that need care.

## 6. Redeploy vs rebuild

Once the APK exists, keep this distinction straight — it saves a Store round
trip:

- **Web-only change** (app logic, styling, manifest text, icons, asset links) →
  republish `<DOMAIN>`. The installed TWA picks it up on next launch.
- **Native change** (package id, app name, launcher icon, version, app mode,
  signing) → rebuild the APK and re-upload to the Store.

## Reference Files

| File | Load when |
| ---- | --------- |
| [`references/vercel.md`](references/vercel.md) | Route A — full Vercel deploy, auth, aliases, redeploys |
| [`references/existing-hosts.md`](references/existing-hosts.md) | Route B — per-host publish recipes and their gotchas |

Packaging the hosted app into a signed Quest APK is the `iwsdk-pwa-packaging`
skill; this skill only gets it online.
