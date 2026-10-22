---
outline: [2, 4]
---

# AI-Native Development

IWSDK is built from the ground up for AI-assisted immersive web development. AI agents can see, interact with, compose, and debug your WebXR experience through [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) tools for browser inspection and input, controller input, native scene composition, scene inspection, ECS (Entity-Component-System) debugging, and more.

## How It Works

When you enable AI in your Vite config and start the app through the `iwsdk` CLI, the stack sets up three things automatically:

1. **[Playwright](https://playwright.dev/) Browser** — A managed Chromium instance that loads your app and provides semantic snapshots, bounded interaction, screenshots, performance diagnostics, and browser event capture for the AI agent.
2. **Runtime-Resolved MCP Server** — `iwsdk mcp stdio` exposes the installed runtime contract for controlling the current application, emulated XR runtime, native scenes, and ECS state by resolving the active workspace runtime created by `iwsdk dev up`.
3. **MCP Config Files** — `iwsdk adapter sync` writes workspace-based config files (for example `.mcp.json` for Claude) so your AI tool discovers that server on startup.

```text
┌──────────────────────┐
│  AI Tool             │
│  (Claude, Cursor...) │
└──────────┬───────────┘
           │ MCP protocol (stdio)
┌──────────▼───────────┐
│  iwsdk mcp stdio     │◄── screenshots, console logs
└──────────┬───────────┘
           │ WebSocket
┌──────────▼───────────┐     ┌──────────────────────┐
│  Vite Dev Server     │────►│  Normal Browser      │
│                      │     │  (developer)         │
└──────────┬───────────┘     └──────────────────────┘
           │
┌──────────▼───────────┐
│  Playwright Browser  │
│  (managed)           │
└──────────────────────┘
```

The AI agent communicates with `iwsdk mcp stdio` over stdio. `iwsdk dev up` records the active workspace runtime, and `iwsdk mcp stdio` resolves that runtime before relaying commands to the Playwright browser via WebSocket, where the IWER runtime processes them (move controllers, trigger inputs, query state). Browser commands automatically resolve the current application, including the runtime frame inside the managed workspace, rather than asking the agent to select a target.

The common browser surface is deliberately small: exactly seven MCP tools provide
screenshots, semantic snapshots, bounded Playwright interaction, uncalibrated
host-browser profiling, structured browser diagnostics, current-app reload, and tab
audio muting. These tools do not provide arbitrary URL navigation. For advanced
development tasks, an operator can explicitly enable
`iwsdk dev up --allow-browser-automation` and run a trusted workspace script with
`iwsdk browser run <script>`. That escape hatch exposes the same managed session
through loopback CDP and is disabled by default.

Your normal browser runs independently with its own XR session, so you can develop and test manually while the agent works in the background.

### Additional MCP Servers

The runtime-first adapter sync can also register optional MCP servers alongside `iwsdk-runtime`:

- **`iwsdk-reference`** — If `@iwsdk/reference` is installed, a local reference server is registered that provides semantic code search and IWSDK API knowledge. Run `npx @iwsdk/cli reference warmup` once to download the pinned model plus the reference corpus into your project-local `.iwsdk/reference` state and shared cache. Set `IWSDK_REFERENCE_ASSETS_BASE_URL` too when you are hosting the corpus payload yourself instead of using the published `@iwsdk/reference-assets` package. SDK bundles intentionally exclude the corpus payload, so bundle/internal deployments must host that artifact separately before warmup will succeed. The pinned model file URLs themselves are baked into the SDK, so warmup still requires access to those public URLs unless the shared cache has already been pre-warmed.
- **`metavr`** — If `@meta-quest/metavr` is installed, the MetaVR MCP server is registered. This provides Meta Quest device management, 3D asset search from Meta's asset library, and IWSDK documentation lookup.

These appear automatically in the generated MCP config files when the corresponding packages are present in `node_modules`.

## Two Modes

IWSDK supports two usage modes built on the same managed runtime/editor workspace:

| Mode            | Description                             | Playwright               | DevUI |
| --------------- | --------------------------------------- | ------------------------ | ----- |
| **Collaborate** | You and the AI share the same workspace | Visible, resizable       | On    |
| **Agent**       | AI works autonomously in the background | Headless, fixed viewport | Off   |

Collaborate mode is the default. It opens one visible managed browser containing
the runtime preview and editor, so the dev server does not also open a separate
normal-browser window. Select agent mode explicitly for unattended headless work.

See [Modes](./modes) for the full deep dive.

## What Can the Agent Do?

The `iwsdk-runtime` MCP server exposes tools across several categories:

- **Session** — Accept, monitor, and end XR sessions
- **Transforms** — Position and orient the headset, controllers, and hands
- **Input** — Trigger selects, manipulate gamepad buttons and axes, switch input modes
- **Browser** — Snapshot and interact with the current app, take screenshots, profile host-browser behavior, read structured diagnostics, and reload the app
- **Scene** — Inspect the Three.js scene hierarchy and object transforms
- **ECS** — Pause/step the simulation, query entities, diff state snapshots

See [MCP Tools Reference](./mcp-tools) for the complete list.

## Next Steps

- [Getting Started](./getting-started) — Set up AI in 5 minutes
- [Modes](./modes) — Understand collaborate and agent modes
- [MCP Tools Reference](./mcp-tools) — The canonical runtime tool surface
- [Workflows](./workflows) — Practical agent workflow patterns
