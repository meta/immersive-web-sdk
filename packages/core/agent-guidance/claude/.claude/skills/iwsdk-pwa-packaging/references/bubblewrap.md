# Packaging a Quest APK with bubblewrap

`@meta-quest/bubblewrap-cli` wraps a live PWA into a signed Android APK — a
Trusted Web Activity that loads `<DOMAIN>` in a full-screen web view. It is a
wrapper: your files are not inside the APK, which is why the origin must already
be live and why web fixes never need a rebuild.

```bash
npm i -g @meta-quest/bubblewrap-cli   # bin: bubblewrap, requires Node >= 18
```

## Prerequisites — one interactive step, then scriptable

On first run bubblewrap has no JDK or Android SDK and offers to install its own
into `~/.bubblewrap`, behind `inquirer` prompts that include an Android SDK
licence confirmation. **An agent cannot answer these.** Have the developer run
this once in a real terminal:

```bash
bubblewrap doctor
```

Accept the JDK and SDK installs. It writes `~/.bubblewrap/config.json` with
`jdkPath` and `androidSdkPath`; every later command is non-interactive. If they
already have a JDK 17 and an Android SDK, `bubblewrap updateConfig --jdkPath …
--androidSdkPath …` points at those instead.

Locate the tools dynamically rather than hard-coding versions:

```bash
KT=$(find ~/.bubblewrap/jdk -path '*/bin/keytool' | head -1)
BT=$(ls -d ~/.bubblewrap/android_sdk/build-tools/* | sort -V | tail -1)
```

## init is interactive — use the scripted path

`bubblewrap init` generates `twa-manifest.json` and the Gradle project through a
wizard (host, name, packageId, version, display, colors, icon, **App Mode**,
signing key). It needs a real TTY and has no value flags to bypass the prompts.

- **Developer at a terminal:** `bubblewrap init --manifest=https://<DOMAIN>/manifest.webmanifest --metaquest`
  and answer the prompts. `--metaquest` is what surfaces the Quest-specific
  questions, including App Mode.
- **Agent, or any non-TTY caller:** skip `init`. Hand-write
  `twa-manifest.json` as below, then run `update` and `build`, which are both
  non-interactive.

Work in a directory **outside** the web tree — `twa/` next to the app, never
inside `public/` or anywhere that gets published.

## Step 1 — The signing key: pause and ask

**Stop and ask the developer which key to use before building anything.** This
is not a detail to default. The key is permanent: every future update must be
signed with the same keystore, alias, and `packageId`, and a published Store
listing is already bound to one. There is no recovery from a lost key — only a
new Store entry under a new package name.

**(A) Existing keystore.** Ask for the file path, the alias, and the store and
key passwords, and use them as-is. Required when updating an app that is already
published. Reusing one keystore across several apps is normal and fine.

**(B) Generate a new one** — only when there is nothing to reuse. Create it
outside the deployable web tree, and tell the developer to back it up:

```bash
"$KT" -genkeypair -v -keystore twa/android.keystore \
  -alias android -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <PW> -keypass <PW> -dname "CN=<App>, O=<Org>, C=US"
```

Either way, read the certificate SHA-256 now — step 4 needs it:

```bash
"$KT" -list -v -keystore <keystore> -alias <alias> \
  -storepass <PW> -keypass <PW> | grep -i SHA256
```

## Step 2 — twa-manifest.json

Field names and types come from the `TwaManifest` class in
`@meta-quest/bubblewrap-core`; treat that as authoritative if something here
looks stale.

```json
{
  "packageId": "com.<org>.<app>",
  "applicationId": "<HORIZON_APP_ID or 0>",
  "host": "<DOMAIN>",
  "name": "Full App Name",
  "launcherName": "App",
  "display": "standalone",
  "orientation": "landscape",
  "themeColor": "#0a0418",
  "backgroundColor": "#06010f",
  "startUrl": "/",
  "iconUrl": "https://<DOMAIN>/icons/icon-512.png",
  "maskableIconUrl": "https://<DOMAIN>/icons/icon-512-maskable.png",
  "webManifestUrl": "https://<DOMAIN>/manifest.webmanifest",
  "signingKey": { "path": "<abs>/twa/android.keystore", "alias": "android" },
  "appVersion": "1",
  "appVersionName": "1",
  "appVersionCode": 1,
  "fallbackType": "customtabs",
  "features": {},
  "isMetaQuest": true,
  "horizonOSAppMode": "immersive",
  "fingerprints": [],
  "minSdkVersion": 23
}
```

The four fields that actually decide whether this works:

- **`isMetaQuest`** — defaults to `false`. Left unset, you get a plain Android
  TWA with no Quest behavior at all.
- **`horizonOSAppMode`** — `"immersive"` or `"2D"`, validated against exactly
  those two strings, **defaulting to `"immersive"`** when absent or misspelled.
  A 2D app that omits it inherits the wrong mode silently.
- **`packageId`** — permanent, paired with the signing key. Choose it once.
- **`applicationId`** — the numeric Horizon App ID. `"0"` builds and sideloads
  fine (no in-app purchases); set the real id before any Store upload.

`signingKey.path` should be absolute — a relative path resolves against the
Gradle project directory, not your shell's.

## Step 3 — Build

`update` regenerates the Gradle project from the manifest and bumps the version;
`build` compiles and signs. Passwords are read from the environment — there are
no password CLI flags.

```bash
cd twa
export BUBBLEWRAP_KEYSTORE_PASSWORD=<PW> BUBBLEWRAP_KEY_PASSWORD=<PW>
bubblewrap update && bubblewrap build
# → app-release-signed.apk  +  app-release-bundle.aab
```

Verify what you actually built before shipping it:

```bash
"$BT/aapt" dump badging app-release-signed.apk | grep -iE '^package:|APP_MODE|OCULUS'
"$BT/apksigner" verify --print-certs app-release-signed.apk | grep -i SHA-256
```

The package name, app mode, and app id must be what you intended, and the
signer's SHA-256 must equal the keystore's from step 1. If they differ, the
build picked up a different key — asset links will fail and the app will not
launch.

Upload `app-release-signed.apk` to the Store; the `.aab` is not used by the
Horizon pipeline.

## Step 4 — Digital Asset Links

The TWA verifies at launch that the origin vouches for this exact package and
certificate. If verification fails, Horizon shows *"will not launch"* — there is
no partial or degraded mode.

`public/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.<org>.<app>",
      "sha256_cert_fingerprints": ["3B:06:…:8B"]
    }
  }
]
```

The fingerprint is the colon-separated uppercase hex from step 1. List one
object per package if several apps share the origin, and publish the same file
on every `additional_trusted_origins` host.

This is the **second hosting handoff**. Rebuild and publish through the
`iwsdk-hosting` skill, then verify the content, not just the status code:

```bash
npm run build
# …publish…
curl -s https://<DOMAIN>/.well-known/assetlinks.json
```

Changing `applicationId` or `horizonOSAppMode` does not change this file — the
package name and certificate are unchanged, so no republish is needed for a
mode fix.

## Sideload and test

Test on device before uploading. This is the only place the immersive auto-enter
path can be verified, since `getDigitalGoodsService` does not exist off-device.

```bash
adb install -r app-release-signed.apk
```

Scaffolded IWSDK projects also register the `metavr` MCP server, which can
manage the connected Quest. Launch from the Library, not from `adb shell am
start` — launching from the Library is what exercises the real install path.

What to look for: the immersive app should enter VR with no visible 2D page and
no URL bar; a 2D app should open as a windowed panel. Anything else, go to
[`troubleshooting.md`](troubleshooting.md).

## Security

- The keystore and its passwords never enter `public/`, `dist/`, or version
  control. Confirm after each publish:
  `curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/android.keystore`
  → 404.
- If a keystore was ever published, treat it as compromised: generate a new key
  under a new `packageId`, since the old pairing is permanent.
- Back up the keystore, alias, and passwords together. They are only useful as a
  set.
