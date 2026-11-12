# Uploading to the Meta Horizon Store

Uploads go through Meta's `ovr-platform-util`. The same command handles
immersive and 2D builds — nothing about the upload differs by app mode.

## Before uploading

- The app exists in the [Developer Dashboard](https://developer.oculus.com/manage/)
  and you have its numeric **App ID**. `applicationId` in `twa-manifest.json`
  must be that id, not `"0"` — rebuild if it is still the placeholder.
- The APK is signed with the app's permanent key, and asset links are live.
- The build has been sideloaded and launched on a headset. Store review is slow;
  catching a wrong app mode here costs minutes instead of days.

## Get the tool

```bash
# macOS
curl -L -o ovr-platform-util \
  "https://www.oculus.com/download_app/?id=1462426033810370&access_token=OC%7C1462426033810370%7C"
chmod +x ./ovr-platform-util && ./ovr-platform-util version
```

Windows and Linux builds are linked from the Dashboard under Distribution →
Upload. On macOS, Gatekeeper may quarantine the binary on first run — the
developer clears it in System Settings → Privacy & Security, or with
`xattr -d com.apple.quarantine ./ovr-platform-util`.

Use the upload utility described here for this Store submission workflow.

## Authentication

Two options — **ask the developer for one, never invent or guess a value:**

| Credential | Where | Flag |
| ---------- | ----- | ---- |
| App Secret | Dashboard → your app → **API** tab | `--app-secret` |
| User token | Dashboard → Account → Generate token | `--token` |

Treat either as a secret: pass it on the command line or through an environment
variable, never into a file under `public/`, and never into version control. If
one is pasted into the conversation, do not echo it back in later output.

## Upload

```bash
./ovr-platform-util upload-quest-build \
  --app-id <HORIZON_APP_ID> \
  --app-secret <SECRET> \
  --apk app-release-signed.apk \
  --channel ALPHA \
  --age-group MIXED_AGES \
  --notes "Short description of this build" \
  --disable-progress-bar
```

| Flag | Required | Values |
| ---- | -------- | ------ |
| `--app-id` | yes | numeric Horizon App ID |
| `--apk` | yes | path to `app-release-signed.apk` |
| `--channel` | yes | `ALPHA` / `BETA` / `RC` for testing, `STORE` for production |
| `--age-group` | yes | `TEENS_AND_ADULTS` / `MIXED_AGES` / `CHILDREN` |
| `--app-secret` or `--token` | yes | one of the two |
| `--notes` | no | release notes |
| `--disable-progress-bar` | no | use it in agent/CI contexts; the animated bar floods the log |

Start on `ALPHA`. Promote to `STORE` from the Dashboard once the build has been
tested by real users on the channel.

A successful upload prints a **Build ID** and a `…/test-results/` URL. Report
both back to the developer — the test-results page is where automated VRC
checks land.

## The blocker you should expect first

```
must first agree to our Developer Distribution Agreement
```

Nearly every organization's first upload fails this way. An **org admin** must
sign the DDA once at:

```
https://developer.oculus.com/manage/organizations/<ORG_ID>/legal-documents/
```

This is a legal action only the developer can take. **Pause, explain, and wait**
— then retry the identical command; nothing about the build needs to change.

## Other responses worth recognizing

| Message | Meaning |
| ------- | ------- |
| Quest 1 not supported | harmless warning; Quest 1 is end-of-life |
| Signature does not match previous build | the APK was signed with a different key than the published app — reuse the original keystore |
| Version code must be higher | bump `appVersionCode` in `twa-manifest.json`, `bubblewrap update && bubblewrap build`, re-upload |
| App ID not found / unauthorized | `--app-id` and the secret belong to different apps, or the secret was regenerated |

## After the upload

Store metadata — listing copy, screenshots, store art, age rating, VRC
compliance — is handled in the Dashboard, not by this tool. Uploading a build
does not submit it for review; that is a separate Dashboard action once a build
is promoted to the `STORE` channel.
