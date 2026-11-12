---
outline: [2, 4]
---

# Modes

IWSDK's AI integration supports two modes. Both use the same managed Playwright
workspace, runtime preview, native scene editor, and MCP connection. The mode
only changes whether that workspace is visible and how screenshots are sized.

Coding agents pick the mode from what you want. If you want to watch or steer
the work as it happens, they start collaborate mode; otherwise they start agent
mode, which is headless and fast without a GPU. When your request does not say,
they ask once, and they fall back to agent mode when nobody can answer. Say
which mode you want to override that. An agent announces any later change
before restarting the workspace; it never silently replaces a visible
collaboration window with a headless session, or the reverse.

## Collaborate Mode

**Command:** `npx @iwsdk/cli dev up --ai-mode collaborate`

You and the AI share one visible Playwright-managed workspace. It opens at the
clean application URL in runtime view; use the Runtime and Editor controls to
switch views without opening another browser.

Chromium may show an "unsupported command-line flag" banner for
`--ignore-certificate-errors`. This is expected: the dedicated managed browser
uses that flag only to accept IWSDK's untrusted local development certificate.
Playwright may add separate platform flags such as `--no-sandbox` in constrained
environments. The banner does not indicate that a second browser was opened.

| Setting        | Value                              |
| -------------- | ---------------------------------- |
| Headless       | No                                 |
| Viewport       | Freely resizable                   |
| DevUI          | On                                 |
| Normal browser | Does not open                      |
| Screenshots    | Downscaled to fit `screenshotSize` |

```bash
npx @iwsdk/cli dev up --ai-mode collaborate
```

This is the normal development mode. Manual edits and agent actions operate on
the same page and scene document.

## Agent Mode

**Command:** `npx @iwsdk/cli dev up --ai-mode agent`

The AI works autonomously in the same managed workspace architecture, but the
Playwright browser is headless and has a fixed viewport. No second browser is
opened automatically. Open the reported runtime URL yourself when you need a
separate manual runtime view.

| Setting        | Value                                       |
| -------------- | ------------------------------------------- |
| Headless       | Yes                                         |
| Viewport       | Fixed to `screenshotSize` (default 800x800) |
| DevUI          | Off                                         |
| Rendering      | On demand (see below)                       |
| Normal browser | Does not open                               |
| Screenshots    | Exact viewport size                         |

```bash
npx @iwsdk/cli dev up --ai-mode agent \
  --screenshot-width 500 --screenshot-height 500
```

Use this mode for unattended automation or deterministic screenshot dimensions.

## Rendering in Headless Sessions

A headless managed session (agent mode, or `--headless`) renders **on demand**.
Every ECS system, input, physics and UI update still runs on every frame, but the
app draws a frame only when a tool needs pixels. On a machine without a GPU,
where every draw is software-rasterized, this keeps the app at the browser's
frame rate instead of a few frames per second, and keeps commands responsive.

- `browser screenshot` draws a fresh frame first, so it always shows the
  current state. In XR, the emulator keeps the drawn frame on the canvas
  (`XRDevice.frameClearEnabled`), so one frame is enough. In emulated AR, the
  synthetic room behind the app (`XRDevice.shouldDrawEnvironment`) draws only
  on frames the app draws, so the two always match.
- `ecs pause`, `ecs step`, then `browser screenshot` captures an exact
  simulation frame. `browser filmstrip` captures several in one image.
- `scene_get_render_stats` (`scene render-stats`) draws one fresh frame
  before it reads the stats. `browser profile`, runtime evidence and
  `browser run` scripts draw every frame while they run.
- The runtime-only `RuntimeSettings` component switches the mode live:
  `ecs find` it, then `ecs set-component` its `renderMode` field to
  `"continuous"` or `"on-demand"`. It is never saved into scene files.
- Start with `IWSDK_DEV_RENDER_MODE=continuous` to draw every frame from the
  start. Headed sessions, including collaborate mode, always draw every frame.

Do not judge performance from a headless session's frame rate; use
`browser profile` or a device.

## Workspace-Only Mode

Launch the managed runtime/editor without declaring an AI mode:

```bash
npx @iwsdk/cli dev up
```

This is useful for manual native scene editing, including browser-only projects
that disable IWER. Add `--no-open` to register the workspace without opening
Playwright at startup; browser commands can launch it lazily.

## Settings Matrix

|               | Collaborate              | Agent                    |
| ------------- | ------------------------ | ------------------------ |
| `headless`    | `false`                  | `true`                   |
| `viewport`    | `null` (resizable)       | Fixed (`screenshotSize`) |
| `devUI`       | `true`                   | `false`                  |
| Rendering     | Every frame              | On demand                |
| `server.open` | `false`                  | `false`                  |
| Screenshot    | Downscaled to fit bounds | Exact size               |

## Session Flag Reference

- `--ai-mode agent|collaborate`
- `--headed` / `--headless`
- `--open` / `--no-open`
- `--screenshot-width <pixels>` / `--screenshot-height <pixels>`
- `IWSDK_DEV_RENDER_MODE=continuous` (environment): draw every frame in a
  headless session

The managed workspace and MCP endpoint remain available for every
manifest-first development server even when no AI mode is selected.
