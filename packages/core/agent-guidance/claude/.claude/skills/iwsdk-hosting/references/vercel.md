# Vercel Deployment

The recommended host when the developer has not already chosen one. Vercel
auto-detects Vite, serves `dist/` over HTTPS on a stable public alias, preserves
`public/` dotfolders (`.well-known/`), serves `.webmanifest` with the right MIME
type, and redeploys in one command — which matters because Digital Asset Links
force a second publish after the APK is signed.

## Prerequisites

The scaffolded `vite.config.*` is already correct — `base: './'`,
`publicDir: 'public'`, `build.outDir: 'dist'`. Nothing to change.

```bash
npm run build     # → dist/
ls dist           # sanity: index.html, assets/, icons/, manifest.webmanifest
```

## First run: authentication

```bash
npx -y vercel@latest whoami
```

If this errors, the developer is not logged in. `vercel login` is interactive
(it prompts for an email/SSO choice and waits on a browser round trip), so an
agent cannot complete it — **hand it off**: ask them to run `npx vercel login`
in their terminal, or to paste `! npx vercel login` into this session, then
re-run `whoami`.

For CI or an unattended run, a token works instead and skips the prompt:

```bash
npx -y vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"
```

## Find the scope

Personal accounts need no `--scope`. Team accounts do — omitting it deploys to
the wrong place or fails outright:

```bash
npx -y vercel@latest teams ls
```

## Deploy

```bash
npx -y vercel@latest deploy --prod --yes --scope <team-slug>
```

`--yes` accepts the project-creation and link prompts, so the command is
non-interactive. Vite is auto-detected: Vercel runs `vite build` and serves
`dist/`.

## Two URLs come back — only one is usable

| URL | Behavior | Use as `<DOMAIN>`? |
| --- | -------- | ------------------ |
| Canonical alias `https://<project>.vercel.app` | public, 200 | **yes** |
| Hashed per-deploy `https://<project>-<hash>-<team>.vercel.app` | 401 under team deployment protection | no |

The hashed URL is what the CLI prints most prominently, which is exactly how it
ends up baked into a `twa-manifest.json` by mistake. The resulting APK fetches a
401 and the app shows a blank or error screen on the headset. Always confirm the
alias returns 200 before using it anywhere downstream:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<project>.vercel.app/
```

If the canonical alias is also 401, deployment protection is enabled for the
whole project. It must be turned off (Project → Settings → Deployment
Protection) — a TWA cannot authenticate through it. This is the developer's
call: pause and ask.

## Custom domain

If they want a real domain instead of `*.vercel.app`, add it before packaging —
the domain is baked into `twa-manifest.json` and the asset links, so changing it
later means a new APK and a new Store build:

```bash
npx -y vercel@latest domains add <domain> --scope <team-slug>
```

## Verify

```bash
for u in / /manifest.webmanifest /icons/icon-512.png; do
  printf '%s ' "$u"
  curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "https://<DOMAIN>$u"
done
```

The manifest should be `application/manifest+json`. Vercel infers this from the
`.webmanifest` extension with no configuration.

## Redeploying

Re-run the same deploy command. The alias moves to the new deployment; the
installed TWA picks up the change on its next launch, with no rebuild and no
Store upload.

The second deploy in this pipeline is the asset-links one: after the keystore
exists, write `public/.well-known/assetlinks.json`, then `npm run build` and
deploy again. Vite copies dotfolders out of `public/`, and Vercel serves them —
no `vercel.json` needed.

## When not to use Vercel

If the app needs a backend, private networking, or an existing corporate CDN,
this is the wrong recommendation. Ask, and fall back to Route B (existing host)
in `SKILL.md`.
