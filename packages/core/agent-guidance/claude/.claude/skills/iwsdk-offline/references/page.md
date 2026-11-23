# Page Side

`src/offline.ts` (copied from `assets/offline.ts.template`) decides two moments:
when the copy is made, and when a new release may take over. It exports two
functions, both taking the app's idle test:

- **`startOffline(isIdle)`** — call first thing at startup. If a release
  finished installing on an earlier visit, it takes over before anything
  starts; otherwise it watches for one.
- **`keepOfflineCopy(isIdle)`** — call once the first screen is up. It registers
  `./sw.js` and reports what the page fetched before the worker existed.

In a JavaScript project, save it as `src/offline.js` and delete the type
annotations. In a TypeScript project it must be `.ts`: the scaffold's
`tsconfig.json` has no `allowJs`, so importing a `.js` module fails
`npm run typecheck`.

## Wiring in `src/index.ts`

```ts
import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { keepOfflineCopy, startOffline } from './offline.js';

let world: World | undefined;
const isIdle = () =>
  world?.visibilityState.peek() === VisibilityState.NonImmersive;
startOffline(isIdle);

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((created) => {
  world = created;
  // ... register your systems ...
  keepOfflineCopy(isIdle);
});
```

## Why each part is there

- **Register after the first screen, not at startup.** Registered at startup,
  the worker downloads the release while the page is still downloading it, so
  every file comes down twice. Registered later, the worker takes each file from
  the HTTP cache instead.
- **Report what came before the worker.** Files the page fetched before the
  worker existed never passed through it. The buffered `PerformanceObserver`
  reports them, and the worker keeps the optional and pinned ones among them.
  The browser buffers 250 resource entries by default; if the first load fetches
  more, raise the limit early with `performance.setResourceTimingBufferSize()`.
- **Define idle for the app.** `isIdle()` must be `false` whenever a reload
  could lose work or interrupt a session. No XR session is the IWSDK baseline;
  add the app's own state, such as an unsaved edit or a game in progress. When
  it is `true` and a new release has installed, the page sends `'take-over'`,
  listens once for `controllerchange`, and reloads into the new release.
- **Catch an install already under way.** The browser checks `sw.js` as the page
  navigates, so an update can be installing before the page's script runs, its
  `updatefound` already gone. `watch()` follows `registration.waiting`,
  `registration.installing`, and the next `updatefound`, so none is missed.
- **Mirror the connection.** `navigator.onLine` and the `online` and `offline`
  events say whether the device has a network, not whether the server answers.
  Use them to disable or explain features that need a connection, and still
  handle failed requests.
