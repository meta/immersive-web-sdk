# Troubleshooting

Failure modes across the whole pipeline. Most present on device as one of four
symptoms, so start there.

| Symptom on the headset | Most likely cause | Section |
| ---------------------- | ----------------- | ------- |
| "will not launch" | asset links | [Launch](#launch-failures) |
| Stuck on a loading screen | `horizonOSAppMode: "immersive"` on a 2D app | [App mode](#app-mode-failures) |
| Opens with a browser URL bar | `horizonOSAppMode: "2D"` on an immersive app | [App mode](#app-mode-failures) |
| Opens flat, no URL bar, never enters VR | auto-enter code missing or not firing | [App mode](#app-mode-failures) |
| Blank / white / error page | the origin is unreachable from the device | [Origin](#origin-failures) |

Before diagnosing, establish which layer is wrong. A **web** bug is fixed by
republishing `<DOMAIN>`; a **native** bug needs a new APK and a new upload.
Read the built APK rather than guessing:

```bash
"$BT/aapt" dump badging app-release-signed.apk | grep -iE '^package:|APP_MODE|OCULUS'
```

## App mode failures

### 2D app stuck on a loading screen

`horizonOSAppMode` is `"immersive"`, so Horizon waits for a WebXR session that
never starts. Note the field **defaults to `immersive`** when absent or
misspelled, so an omitted field looks identical.

Set `"horizonOSAppMode": "2D"`, then `bubblewrap update && bubblewrap build` and
re-upload. Asset links do not change.

### Immersive app shows a URL bar

`horizonOSAppMode` is `"2D"`. Set `"immersive"`, rebuild, re-upload.

### Immersive app opens flat with no URL bar

The mode is right; the session is never requested. Check, in order:

1. The auto-enter block is present in `src/index.ts` **inside** the
   `World.create(...).then(...)` callback — placed before the world resolves,
   `world` is undefined and the `.catch` swallows it.
2. The queried mode matches `iwsdk.config.json`. An AR app must query
   `isSessionSupported('immersive-ar')`; querying `immersive-vr` returns `false`
   and the app stays flat with no error.
3. The deployed bundle actually contains it —
   `curl -s https://<DOMAIN>/assets/index-*.js | grep -c getDigitalGoodsService`.
   A forgotten republish is the most common answer.

This is a web bug: republish `<DOMAIN>`, relaunch the app. No rebuild.

### Auto-enter works on device but breaks the browser

The `getDigitalGoodsService` gate was removed or inverted. In a tab, the app
should keep its normal Enter-XR button; auto-requesting a session without a user
gesture there fails with a security error.

## Launch failures

### "will not launch"

Asset-link verification failed. Check all four in order:

```bash
curl -s https://<DOMAIN>/.well-known/assetlinks.json
"$BT/apksigner" verify --print-certs app-release-signed.apk | grep -i SHA-256
```

1. **The file is reachable** — a 404 means the host stripped the dotfolder. See
   `iwsdk-hosting/references/existing-hosts.md`; do not relocate the file, the
   path is fixed.
2. **`package_name` matches `packageId`** in `twa-manifest.json`, exactly.
3. **`sha256_cert_fingerprints` matches the APK signer**, comparing hex bytes —
   the two tools differ in case and colon placement, and that difference is not
   the problem.
4. **It is served as JSON, not HTML.** A SPA catch-all route that returns
   `index.html` for unknown paths will answer 200 with the wrong body. Check the
   body, not the status code.

On a multi-origin 2D app, every `additional_trusted_origins` host needs the
file too.

### Signature mismatch on update

The build was signed with a different keystore than the published app. Reuse the
original keystore, alias, and passwords — there is no way to re-sign a published
app with a new key. A lost keystore means a new `packageId` and a new Store
entry.

## Origin failures

### Blank, white, or error page after launch

The device cannot load `<DOMAIN>`. Usually one of:

- **The hashed Vercel per-deploy URL was used** instead of the canonical alias —
  it returns 401 under deployment protection. Fix `host`/`webManifestUrl` in
  `twa-manifest.json`, rebuild, re-upload.
- **Deployment protection is on** for the whole project. A TWA cannot
  authenticate through it; it must be disabled.
- **The origin is internal-only** and unreachable from the headset's network.
- **Certificate problems** — a self-signed or expired cert fails silently in the
  web view.

Confirm from a machine on the same network as the headset:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/
```

### App loads but assets 404

Usually a subpath deployment with `start_url`/`scope` still set to `/`. Set them
to `/<path>/` and republish. The scaffolded `base: './'` handles the bundle
paths already, so if bundles load and only `public/` assets 404, look for a
publish that missed those files.

## Packaging failures

### bubblewrap hangs or exits without doing anything

It is waiting on an `inquirer` prompt with no TTY — either `init`, or the
first-run JDK/Android SDK install. Have the developer run `bubblewrap doctor`
once in a real terminal, then use the scripted path (`update` + `build`) rather
than `init`.

### Build fails with a keystore or password error

Passwords come only from `BUBBLEWRAP_KEYSTORE_PASSWORD` and
`BUBBLEWRAP_KEY_PASSWORD`; there are no CLI flags. Confirm both are exported in
the same shell as the build, that `signingKey.path` is absolute, and that
`signingKey.alias` matches the keystore's actual alias:

```bash
"$KT" -list -keystore <keystore> -storepass <PW>
```

### bubblewrap update fails fetching the manifest

`update` reads `webManifestUrl` over the network. The manifest must be live and
200 at that exact URL — not merely present in a local `dist/`.

### Wrong icon in the launcher

`iconUrl` and `maskableIconUrl` are fetched at `update` time and baked into the
APK. Changing the icon on the host later does nothing; rebuild and re-upload.

## Upload failures

### "must first agree to our Developer Distribution Agreement"

The most common first-time blocker. An org admin signs it once at
`https://developer.oculus.com/manage/organizations/<ORG_ID>/legal-documents/`.
Pause, ask, then retry the identical command.

### Version code must be higher

Bump `appVersionCode` in `twa-manifest.json`, then `bubblewrap update &&
bubblewrap build`. `update` also bumps it on its own, so this usually means an
earlier build was uploaded from a different working directory.

## Security incidents

### The keystore is reachable on the public host

It was generated inside the web tree and published. Move it out, republish,
confirm the URL 404s, and treat the key as compromised — generate a new one
under a new `packageId`, since the key/package pairing is permanent.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/android.keystore   # want 404
```

### An app secret was committed or published

Regenerate it in the Dashboard (API tab) immediately; the old value stays valid
until you do.
