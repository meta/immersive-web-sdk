# App Modes: Immersive WebXR vs 2D Panel

The first decision in the pipeline and the one most likely to be wrong. It is
made once, and it changes exactly two things:

1. Whether the app auto-enters a WebXR session on launch (immersive only).
2. The `horizonOSAppMode` value in `twa-manifest.json`.

Everything else — hosting, manifest, icons, keystore, asset links, Store upload
— is identical for both.

| | **Immersive WebXR** | **2D panel** |
| --- | --- | --- |
| Runs as | full VR/WebXR session on launch | windowed 2D panel with its own Library entry |
| Typical app | IWSDK scene, game, spatial tool | dashboard, companion app, store front, any responsive site |
| Web app requirement | must support `immersive-vr` / `immersive-ar` | any responsive PWA; IWSDK not required |
| Auto-enter `requestSession` | **yes — built into the app** | **no — must not be added** |
| `horizonOSAppMode` | `"immersive"` | `"2D"` |

## Choosing

An IWSDK app scaffolded with `--mode vr` or `--mode ar` is immersive; that is
the whole point of the scaffold. Pick 2D only when the experience is genuinely a
flat panel — a companion or admin surface next to an immersive app, or a web
property being brought to the headset unchanged.

If the same origin should be both, that is two Store apps with two `packageId`s
sharing one `<DOMAIN>`. The asset-links file lists both packages.

## The classic failure

`horizonOSAppMode` is validated against `['immersive', '2D']` and **defaults to
`immersive`** when absent or misspelled — so a 2D app whose manifest omits the
field inherits the wrong mode silently.

| Symptom on device | Cause | Fix |
| ----------------- | ----- | --- |
| 2D app stuck on a loading screen | mode is `immersive`; Horizon waits for a session that never starts | set `"2D"`, `bubblewrap update && bubblewrap build`, re-upload |
| Immersive app opens showing a browser URL bar | mode is `2D` | set `"immersive"`, rebuild, re-upload |
| Immersive app opens flat with no URL bar | mode is right, auto-enter code is missing or never fires | add/repair the auto-enter block, republish `<DOMAIN>` — no rebuild needed |

The third row is worth internalizing: a missing session call is a **web** bug,
fixed by a redeploy. A wrong mode is a **native** bug, fixed only by a new APK.
Check the mode in the built APK before blaming the app code:

```bash
"$BT/aapt" dump badging app-release-signed.apk | grep -iE 'package:|APP_MODE|OCULUS'
```

## Auto-enter, in detail (immersive only)

An installed immersive PWA has no 2D page and no button to press. Horizon
launches it straight into a headset context, so if the app waits for a click it
waits forever. The app-icon tap counts as the user activation that
`requestSession` requires — but only if the app spends it immediately on load.

```ts
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
```

Three things this code is doing deliberately:

- **`getDigitalGoodsService` as the install gate.** It is present in an
  installed PWA and absent in a browser tab, so the same build keeps its normal
  Enter-XR button on desktop and in IWER while auto-entering on device. Feature-
  detecting the headset any other way (user agent, screen size) misfires.
- **`isSessionSupported` before `launchXR`.** Calling into an unsupported mode
  throws and leaves the app on a black screen with nothing in the console.
- **`world.launchXR()`, not `navigator.xr.requestSession`.** `launchXR` is
  IWSDK's session request plus the renderer, reference-space, and input wiring
  that the world needs. A raw `requestSession` gets a session the world does not
  know about.

Match the session mode to `iwsdk.config.json` — `world.xr.mode: "ar"` means
`isSessionSupported('immersive-ar')`. Querying the wrong mode returns `false`
and the app silently stays flat.

Because `getDigitalGoodsService` is device-only, this branch never runs on a
development machine. It can only be verified by sideloading the APK and
launching from the Library.

## 2D panel notes

A 2D app runs as a single-instance standalone panel. There is no tab or
navigation bar by default; `theme_color` / `theme_color_dark` in the web
manifest color the custom tab bar when one is shown. Cookies and storage are
shared with the Quest Browser.

Out-of-scope links open inside the panel unless targeted at a new tab or window.
If the app legitimately spans origins, add `additional_trusted_origins` to the
web manifest and host `/.well-known/assetlinks.json` on **every** listed origin
— a missing one silently drops that origin out of scope mid-session.

Do not add the auto-enter block to a 2D app under any circumstances.
