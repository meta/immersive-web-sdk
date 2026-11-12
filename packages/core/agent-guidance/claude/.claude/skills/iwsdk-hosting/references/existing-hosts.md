# Publishing to an Existing Host

Use this when the developer already has hosting. **You prepare files and stop**
— they publish. Your job is to make the handoff precise: the exact local files,
the exact public URLs, the exact command or click path for their host, and then
verification once they confirm.

Everything the app needs is inside `dist/` after `npm run build` (Vite copies
`public/` verbatim, dotfolders included), so in most cases the handoff is simply
"publish `dist/`". The recipes below exist for the cases where it is not.

## The two moments that need a publish

1. **Manifest + icons** — before `bubblewrap update`, which fetches them over
   the network.
2. **`.well-known/assetlinks.json`** — after the signing keystore exists. The
   TWA will not launch until this is live. This is the one that gets forgotten,
   and the one hosts most often break.

## Universal gotchas

**Dotfolders get stripped.** Several hosts and build pipelines ignore
`.`-prefixed paths, so `.well-known/` silently never ships. Symptom: everything
else is 200, `/.well-known/assetlinks.json` is 404, and the installed app opens
to "will not launch". The path is fixed by the TWA spec — fix the host, do not
relocate the file.

**`.webmanifest` has no MIME mapping.** Older servers serve it as `text/plain`
or `application/octet-stream`. Either add the mapping
(`application/manifest+json`) or rename to `manifest.json` and update both
`<link rel="manifest">` in `index.html` and `webManifestUrl` in
`twa-manifest.json`.

**Aggressive CDN caching.** After the asset-links publish, a cached 404 keeps
the TWA broken long after the file is live. Purge the cache, then verify.

**Subpath hosting.** `assetlinks.json` must be at the origin root even when the
app is at `/<path>/`. See §5 of `SKILL.md`.

## Per-host recipes

### Netlify

```bash
npm run build
npx -y netlify-cli deploy --prod --dir=dist
```

Dotfolders in the publish directory are served as-is; no config needed. If a
build plugin or a `.gitignore` rule is dropping `.well-known/`, publish `dist/`
directly as above rather than letting Netlify build from source.

MIME types are inferred correctly. To force one, add to `netlify.toml`:

```toml
[[headers]]
  for = "/manifest.webmanifest"
  [headers.values]
    Content-Type = "application/manifest+json"
```

### Cloudflare Pages

```bash
npm run build
npx -y wrangler pages deploy dist --project-name <project>
```

Pages skips dot-prefixed files on upload but makes an explicit exception for
`.well-known/`, so asset links normally work with no configuration. Verify
rather than trust it — a custom build step or an `.assetsignore` entry can still
drop the directory:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/.well-known/assetlinks.json
```

If that 404s, emit a second copy at `public/assetlinks.json` and rewrite the
dotted path to it with a `_redirects` rule (status `200` = rewrite, not
redirect — a 3xx does not satisfy asset-link verification):

```
# public/_redirects
/.well-known/assetlinks.json  /assetlinks.json  200
```

Re-verify that the dotted URL returns the JSON body itself.

### GitHub Pages

```bash
npm run build
npx -y gh-pages -d dist --dotfiles
```

`--dotfiles` is **required** — without it `.well-known/` is silently omitted.
Also add an empty `public/.nojekyll` file, or Jekyll strips underscore- and
dot-prefixed paths during the Pages build.

Project sites (`https://<user>.github.io/<repo>/`) are a subpath deployment:
`start_url`/`scope` become `/<repo>/`, and `assetlinks.json` must live in the
`<user>.github.io` **user/organization** repository so it is served from the
origin root. If the developer does not control that repo, they cannot ship a TWA
from this origin — say so and offer Vercel.

### AWS S3 + CloudFront

```bash
npm run build
aws s3 sync dist/ s3://<bucket>/ --delete
aws s3 cp dist/manifest.webmanifest s3://<bucket>/manifest.webmanifest \
  --content-type application/manifest+json
aws s3 cp dist/.well-known/assetlinks.json s3://<bucket>/.well-known/assetlinks.json \
  --content-type application/json
aws cloudfront create-invalidation --distribution-id <id> --paths '/*'
```

`aws s3 sync` guesses content types from the extension and gets `.webmanifest`
wrong, so re-upload those two files explicitly. The CloudFront invalidation is
not optional — a cached 404 on `assetlinks.json` keeps the TWA broken.

### Firebase Hosting

```bash
npm run build
npx -y firebase-tools deploy --only hosting
```

Set `"public": "dist"` in `firebase.json`. Firebase serves `.well-known/`
correctly, but an `"ignore"` entry containing `"**/.*"` — which is in the
default generated config — will drop it. Remove or narrow that pattern.

### nginx / Apache on a VPS

```bash
npm run build
rsync -av --delete dist/ <user>@<host>:/var/www/<site>/
```

nginx: add the manifest MIME type and make sure no `location ~ /\.` rule is
denying dotfolders — the common hardening snippet `location ~ /\. { deny all; }`
blocks `.well-known/`. Allow it explicitly:

```nginx
location ^~ /.well-known/ { allow all; }
types { application/manifest+json webmanifest; }
```

Apache: the equivalent trap is `<FilesMatch "^\.">` or a `RedirectMatch` rule
denying dot paths.

```apache
AddType application/manifest+json .webmanifest
<Directory "/var/www/<site>/.well-known">
  Require all granted
</Directory>
```

### Unknown or internal host

Do not guess. Ask two questions and adapt:

1. How do you normally publish a build — a CLI command, a CI pipeline, or a
   dashboard upload?
2. Can the origin serve a path beginning with a dot (`/.well-known/...`)?

Then produce the handoff in the same shape as the recipes above: exact files,
exact URLs, their command, and the verification you will run afterwards.

## Verify after every publish

```bash
for u in / /manifest.webmanifest /icons/icon-512.png /.well-known/assetlinks.json; do
  printf '%s ' "$u"; curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "https://<DOMAIN>$u"
done
curl -s -o /dev/null -w 'keystore %{http_code} (want 404)\n' "https://<DOMAIN>/android.keystore"
```

Report the actual status codes back to the developer rather than a bare "looks
good" — a 200 on the keystore URL, or a 404 on asset links, is the whole
difference between a working app and a launch failure diagnosed hours later.
