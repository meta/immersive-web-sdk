---
name: iwsdk-pwa-packaging
description: Ship an IWSDK app to Meta Quest and the Horizon Store as a PWA/TWA — both immersive WebXR and 2D windowed panel modes. Use for PWA packaging, web app manifest and icons, auto-enter-XR on launch, bubblewrap APK builds, signing keystores, Digital Asset Links, sideloading, and Horizon Store upload. Also use when a packaged app is stuck loading, shows a URL bar, or will not launch.
argument-hint: '[packaging goal, e.g. "ship to the store" or "build an APK"]'
---

# PWA Packaging for Meta Horizon

Turn a built IWSDK app into a signed Quest APK and get it on the Store. The app
runs from a live URL inside a Trusted Web Activity — the APK is a thin native
wrapper, not a bundle of your files. That single fact explains most of the
pipeline: the origin must be live before packaging, and web fixes ship by
redeploying rather than rebuilding.

User request is in `$ARGUMENTS`.

```
0. Pick app mode      → immersive WebXR vs 2D panel (decides steps 1 and 4)
1. Prepare the app    → auto-enter XR (immersive only) + manifest link
2. Get it hosted      → public HTTPS origin = <DOMAIN>   [iwsdk-hosting]
3. Manifest + icons   → installable PWA, live on <DOMAIN>
4. Package the APK    → keystore, twa-manifest.json, build, asset links
5. Upload to Store    → ovr-platform-util
```

Do not reorder these. Step 4 fetches from `<DOMAIN>`, and asset links in step 4
need a second publish through step 2 — so hosting is a dependency, not a
finishing touch.

## Step 0 — Pick the app mode first

One decision, made once, that changes exactly two things downstream. Ask the
developer if it is not obvious from the project.

| | **Immersive WebXR** | **2D panel** |
| --- | --- | --- |
| Runs as | full VR/WebXR session | windowed 2D panel with a Library entry |
| Auto-enter session (step 1) | **yes** | **no — must not be added** |
| `horizonOSAppMode` (step 4) | `"immersive"` | `"2D"` |

An IWSDK app scaffolded with `--mode vr` or `--mode ar` is immersive. A wrong
value here is the classic failure: a 2D app marked `immersive` hangs on a
loading screen, and an immersive app marked `2D` opens with a browser URL bar.
Details and the AR/VR nuance: [`references/app-modes.md`](references/app-modes.md).

## Step 1 — Prepare the app

**Immersive only: auto-enter the XR session on launch.** An installed immersive
PWA has no 2D page to click, so nothing would ever call `requestSession` — the
app-icon tap is the user activation and the app must spend it itself. Gate on
`getDigitalGoodsService` so this fires only in the installed PWA and never in a
browser tab, which keeps its normal Enter-XR button.

In `src/index.ts`, inside the `World.create(...)` callback:

```ts
World.create(container, projectOptions).then((world) => {
  // …system registration…

  const nav = navigator as Navigator & {
    xr?: { isSessionSupported?: (m: string) => Promise<boolean> };
  };
  if ('getDigitalGoodsService' in window && nav.xr?.isSessionSupported) {
    nav.xr
      .isSessionSupported('immersive-vr') // 'immersive-ar' for an AR app
      .then((supported) => {
        if (supported) world.launchXR();
      })
      .catch(() => {});
  }
});
```

`world.launchXR()` is IWSDK's `requestSession` plus session setup — do not call
`navigator.xr.requestSession` directly. `getDigitalGoodsService` exists only on
device, so this path cannot be validated in a desktop browser or in IWER; verify
it on the headset after sideloading (step 4).

**Both modes:** link the manifest and icons in `index.html`. The scaffolded
`index.html` ships `<link rel="icon" href="data:," />` and no manifest link, so
the app is not installable until step 3 adds them.

Then confirm the app itself is sound before wrapping it — `npm run --if-present typecheck`,
and `npm run build` producing a `dist/` you have actually loaded. Packaging a
broken build wastes a full round trip through hosting, signing, and upload.

## Step 2 — Get it hosted

**Invoke the `iwsdk-hosting` skill.** It asks whether hosting already exists,
recommends and runs Vercel if not, and — if the developer already has a host —
pauses with concrete upload steps instead of guessing at their pipeline.

Come back with a `<DOMAIN>` that passes the hosting contract: root, manifest,
and icons all 200, manifest served as `application/manifest+json`. Asset links
are still expected to 404 at this point; they arrive in step 4.

Do not substitute a localhost tunnel or a preview URL. `bubblewrap` bakes the
host into the APK, and a URL that later 401s or disappears produces an app that
installs and then shows nothing.

## Step 3 — Manifest and icons

Both modes need a valid installable manifest plus PNG icons, live on `<DOMAIN>`
before `bubblewrap update` runs — it fetches them over the network.

`public/manifest.webmanifest`:

```json
{
  "name": "…", "short_name": "…", "description": "…",
  "start_url": "/", "scope": "/",
  "display": "standalone", "orientation": "landscape",
  "background_color": "#06010f", "theme_color": "#0a0418",
  "icons": [
    { "src": "/icons/icon-192.png", "type": "image/png", "sizes": "192x192", "purpose": "any" },
    { "src": "/icons/icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "type": "image/png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```

Generate icons with `sharp` (`npm i -D sharp`; the scaffold already pins a
working version). The maskable icon must be full-bleed and opaque. Full manifest
reference, the icon script, and subpath/multi-origin cases:
[`references/manifest-and-icons.md`](references/manifest-and-icons.md).

Rebuild and publish — via `iwsdk-hosting` again if the developer owns the host —
then verify the manifest and both icon URLs return 200 before continuing.

## Step 4 — Package the APK with bubblewrap

```bash
npm i -g @meta-quest/bubblewrap-cli   # bin: bubblewrap, needs Node >= 18
```

First run downloads a JDK 17 and the Android SDK into `~/.bubblewrap` behind
**interactive prompts** (including an SDK licence confirmation). An agent cannot
answer those — have the developer run `bubblewrap doctor` once in a real
terminal, then continue. Everything after that is scriptable.

`bubblewrap init` is also an interactive wizard with no value flags to bypass
it, so **use the scripted path**: hand-write `twa-manifest.json`, then `update`
and `build`.

Four things happen here, in order:

1. **Choose the signing key — pause and ask.** The key is permanent: every
   future update must reuse the same keystore, alias, and `packageId`, and a
   published listing is already bound to one. Reuse an existing keystore, or
   generate a new one outside the deployable web tree so it never ships.
2. **Write `twa-manifest.json`**, with `isMetaQuest: true` and the
   `horizonOSAppMode` chosen in step 0.
3. **Build** — `bubblewrap update && bubblewrap build`, passwords passed through
   `BUBBLEWRAP_KEYSTORE_PASSWORD` / `BUBBLEWRAP_KEY_PASSWORD` (there are no
   password CLI flags).
4. **Publish `public/.well-known/assetlinks.json`** with the package name and
   the certificate SHA-256. Until it is live on `<DOMAIN>`, the TWA will not
   launch. This is the second hosting handoff — go back through `iwsdk-hosting`
   and verify the URL yourself.

Commands, the full manifest template, keystore handling, and build verification:
[`references/bubblewrap.md`](references/bubblewrap.md).

Sideload and test on device before uploading — `adb install -r
app-release-signed.apk`, or the `metavr` MCP server that scaffolded projects
register. This is the only place the immersive auto-enter path can be verified.

## Step 5 — Upload to the Horizon Store

```bash
./ovr-platform-util upload-quest-build \
  --app-id <HORIZON_APP_ID> --app-secret <SECRET> \
  --apk app-release-signed.apk \
  --channel ALPHA --age-group MIXED_AGES \
  --notes "…" --disable-progress-bar
```

Same command for both modes. Channels: `ALPHA`/`BETA`/`RC` for testing, `STORE`
for production. Auth is the app's App Secret or a user token — ask the
developer, never invent one, and never write it into a file under `public/`.

Expect the first upload to fail with *"must first agree to our Developer
Distribution Agreement"*. Only an org admin can sign it, so pause, ask, and
retry the identical command. Tool download, auth, and flag reference:
[`references/store-upload.md`](references/store-upload.md).

## Redeploy vs rebuild

| Change | Action |
| ------ | ------ |
| App logic, assets, styling, manifest text, icons, asset links | republish `<DOMAIN>`; installed TWA picks it up next launch |
| Package id, app name, launcher icon, version, **app mode**, signing | rebuild the APK and re-upload |

## Security

The keystore and the app secret never go near `public/` or `dist/`. After every
publish, confirm the keystore is not being served:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/android.keystore   # want 404
```

Back up the keystore somewhere durable. Losing it means the app can never be
updated — only replaced by a new Store entry.

## Reference Files

| File | Load when |
| ---- | --------- |
| [`references/app-modes.md`](references/app-modes.md) | Step 0 — choosing immersive vs 2D, and what each implies |
| [`references/manifest-and-icons.md`](references/manifest-and-icons.md) | Step 3 — manifest fields, icon generation, subpath and multi-origin |
| [`references/bubblewrap.md`](references/bubblewrap.md) | Step 4 — prereqs, keystore, `twa-manifest.json`, build, asset links |
| [`references/store-upload.md`](references/store-upload.md) | Step 5 — `ovr-platform-util`, auth, channels, the DDA blocker |
| [`references/troubleshooting.md`](references/troubleshooting.md) | Anything installed but misbehaving — stuck loading, URL bar, will-not-launch |

Getting the app online is the `iwsdk-hosting` skill. Building the app itself is
`iwsdk-planner` and the other `iwsdk-*` skills — do not re-derive IWSDK
patterns here.
