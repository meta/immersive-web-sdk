# Headless rendering (no GPU)

Read this when the managed session is headless (`--ai-mode agent` or
`--headless`), the host has no GPU, or a result depends on frame rate, frame
timing, or which frame a screenshot shows.

## What headless sessions do

A headless managed session renders **on demand**. Every ECS system, input,
physics and UI update still runs on every frame, but the app draws a frame only
when a tool needs pixels. Without a GPU every draw is software-rasterized, so
this keeps the app at the browser's frame rate (60 fps) instead of a few frames
per second.

- `browser screenshot` draws a fresh frame first. Screenshots always show the
  current state, in the browser view and in XR. In emulated AR, the synthetic
  room behind the app draws with it, so the two always match.
- `scene render-stats` draws one fresh frame before it reads the stats.
  `browser profile`, runtime evidence and `browser run` scripts draw every
  frame while they run.
- Headed sessions, including collaborate mode, always draw every frame.
- To draw every frame in a headless session, start it with
  `IWSDK_DEV_RENDER_MODE=continuous`.

## Check state, then look

Prove behavior with ECS state (`ecs query`, `ecs find`, `ecs snapshot`,
`ecs diff`). These need no pixels and see every frame. Take a screenshot only
for visual claims.

## Capture an exact frame

```bash
npx @iwsdk/cli ecs pause --input-json '{}'
npx @iwsdk/cli ecs step --input-json '{"count":1}'
npx @iwsdk/cli browser screenshot --input-json '{}' --output-file artifacts/frame.png
npx @iwsdk/cli ecs resume --input-json '{}'
```

A screenshot draws without advancing the simulation, so it shows exactly the
paused frame.

To see motion, capture a filmstrip: exact simulation frames at offsets 0, K,
2K, … in one contact-sheet image.

```bash
npx @iwsdk/cli browser filmstrip --count 6 --every 5 --output-file artifacts/fall.png
```

## Switch the render mode at runtime

The `RuntimeSettings` component controls the render mode. It exists only at
runtime and is never saved into scene files.

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["RuntimeSettings"]}'
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":<index>,"componentId":"RuntimeSettings","field":"renderMode","value":"continuous"}'
```

Set it back to `"on-demand"` when done.

## Do not

- Judge performance from headless frame rates. Use `browser profile`, which
  draws every frame, or measure on a device.
- Expect a frame to change between screenshots if the scene did not change.
- Restart into headed mode to "fix" a stale view; screenshots already draw a
  fresh frame.

## Limits

- App code that reads pixels from the canvas itself (for example
  `canvas.toDataURL()`) must draw and read in the same task (call
  `renderer.render()`, then read), or create the renderer with
  `preserveDrawingBuffer: true`. `await world.requestRender()` resolves after
  the frame is presented, when the drawing buffer may already be cleared. See
  the render loop API: `world.renderMode`, `world.requestRender(frames)` and
  `world.holdRender()`.
