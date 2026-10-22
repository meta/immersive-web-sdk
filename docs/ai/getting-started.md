---
outline: [2, 4]
---

# Getting Started with AI

This guide gets you from zero to a working AI-assisted dev session in about 5 minutes.

If you prefer a no-code, lightweight workflow, you can start from the [Immersive Web SDK Starter App template on V0](https://v0.app/templates/immersive-web-sdk-starter-app-1o9ZJQxDtU4).

## Prerequisites

- An IWSDK project (see [Chapter 1: Project Setup](/guides/01-project-setup) if you don't have one)
- An AI tool that supports MCP: [Claude Code](https://claude.ai), [Cursor](https://cursor.sh), [GitHub Copilot](https://github.com/features/copilot), [Codex](https://openai.com/codex), or [OpenCode](https://opencode.ai)

## Enable the Managed Workspace

Manifest-first projects use a bare development plugin:

```typescript
import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

export default defineConfig({
  plugins: [iwsdkDev()],
});
```

The managed runtime/editor is always available in development. Browser launch
and AI mode are per-session CLI choices rather than committed project settings.
Starter projects already ship the `iwsdk` CLI through `@iwsdk/cli`.

## Start the Dev Server

```bash
npm run dev
```

Use `npx @iwsdk/cli dev up --ai-mode agent` for a headless agent session, or
`--ai-mode collaborate` to select the visible collaboration behavior
explicitly.

::: tip
Starter `npm run dev` routes through `iwsdk dev restart --open --foreground`, which stops any runtime already running for the workspace and lets the CLI manage the dev-server lifecycle and browser opening. A configured `server.port` (8081 in starters) fails startup when it is occupied instead of moving to another port; treat the reported runtime URL as the source of truth. The internal runtime script is `dev:runtime`; use the CLI path as the supported entrypoint.
:::

When the server starts, several things happen automatically:

1. A visible Playwright workspace opens at the clean application URL
2. Runtime and editor views share that one managed browser session
3. The MCP WebSocket endpoint is registered at `/__iwer_mcp`

If you need the resolved runtime URL, want to inspect adapter state explicitly, or need to confirm that the managed browser bridge is actually ready to accept commands, run `npx @iwsdk/cli dev status`. The `dev up` result also reports `browserCommandReady` and may return while a lifecycle-managed browser is still launching. The `state.browserCommandReady` field and `state.session.browser.commandReady` value are the source of truth for browser readiness.

::: tip Optional reference warmup
If your project installs `@iwsdk/reference`, run `npx @iwsdk/cli reference warmup` once after install. That step prepares the pinned reference corpus under your project's `.iwsdk/reference` state, populates the shared corpus store, and eagerly downloads the pinned model into the shared model cache. Set `IWSDK_REFERENCE_ASSETS_BASE_URL` too when you are hosting the corpus payload yourself instead of relying on the published `@iwsdk/reference-assets` package. SDK bundles intentionally exclude the corpus payload, so bundle/internal deployments must host it separately before warmup. The pinned model file URLs themselves are baked into the SDK, so warmup still requires access to those public URLs unless the shared cache has already been pre-warmed.
:::

## Connect Your AI Tool

Every starter contains one canonical `AGENTS.md`. Codex, Cursor, Copilot, and
OpenCode read it natively. Claude Code uses a small `CLAUDE.md` shim that imports
`AGENTS.md`, avoiding divergent copies of the same project instructions.

After dependencies are installed, configure the selected harness:

```bash
npx @iwsdk/cli adapter sync --tools claude
```

Create runs this command automatically for tools selected during an installed
scaffold. The command merges project-local MCP and permission settings without
removing unrelated user configuration. Run `npx @iwsdk/cli adapter status` to inspect
the instruction, MCP, and permission layers separately.

### Claude Code

Claude Code reads `CLAUDE.md`, `.mcp.json`, and `.claude/settings.json`. Adapter
sync explicitly enables the IWSDK project servers and narrowly preapproves only
their `mcp__<server>__*` tool namespaces.

In environments that lazily load MCP tool schemas, discovery is not the same as runtime readiness:

1. Load the `mcp__iwsdk-runtime__*` tool schemas with your editor's tool-search/discovery step if needed.
2. Call `xr_get_session_status` as the first runtime check once the tool is available.
3. If MCP tools are still deferred, fall back to the CLI (`npx @iwsdk/cli xr status`, `npx @iwsdk/cli browser screenshot`, etc.) until the schemas are hydrated.

### Cursor

Cursor reads from `.cursor/mcp.json`.

```bash
npx @iwsdk/cli adapter sync --tools cursor
```

The generated `.cursor/permissions.json` supplies the repository-level
Auto-run instruction for IWSDK-managed MCP tools. Cursor still controls the
active Run Mode in its UI.

### GitHub Copilot

Copilot reads from `.vscode/mcp.json`:

```bash
npx @iwsdk/cli adapter sync --tools copilot
```

VS Code stores MCP tool approval through its interactive **Chat: Manage Tool
Approval** flow. There is no supported repository file that IWSDK can honestly
use to force that approval, so `adapter status` reports this step as manual.

### Codex

Codex reads from `.codex/config.toml`:

```bash
npx @iwsdk/cli adapter sync --tools codex
```

Each managed Codex MCP server uses
`default_tools_approval_mode = "approve"`; unrelated tools keep the user's
normal approval policy.

### OpenCode

OpenCode reads MCP servers and narrow tool permissions from `opencode.json`:

```bash
npx @iwsdk/cli adapter sync --tools opencode
```

You can select multiple adapters if you use more than one tool:

```bash
npx @iwsdk/cli adapter sync --tools claude,cursor
```

::: tip Adapter default
`npx @iwsdk/cli adapter sync` writes every supported adapter. Use `--tools` only when you want to limit the generated configs. Managed config entries are refreshed, not deleted; `adapter prune` removes only IWSDK-managed MCP and permission entries.
:::

### Other Agent Harnesses

For a harness that IWSDK does not recognize, print a self-contained setup prompt:

```bash
npx @iwsdk/cli adapter prompt
```

Paste the output into that harness. It includes the exact local MCP commands,
asks the harness to load `AGENTS.md`, requests narrow IWSDK-only approval, and
requires a manual-approval explanation when repository-scoped permissions are
not supported.

## First Interaction

Once your AI tool is connected, try these prompts:

**Take a screenshot:**

> "Take a screenshot of the current scene."

The agent will call `browser_screenshot` and show you what the managed browser sees.

**Inspect and click the current app:**

> "Inspect the current app, click the Settings button, and verify the result."

The agent will call `browser_snapshot`, use the returned element ref with
`browser_interact`, and then capture another snapshot or screenshot. Browser tools
automatically target the current application, including its runtime frame when the
managed workspace is visible; there is no target selector or arbitrary common
navigation tool.

**Accept the XR session:**

> "Accept the XR session so we can see the immersive experience."

The agent will call `xr_accept_session`, which is equivalent to clicking the "Enter XR" button.

**Move a controller:**

> "Position the right controller at (0.3, 1.2, -0.5) and take a screenshot."

The agent will call `xr_set_transform` to move the controller, then `browser_screenshot` to verify.

**Capture a desktop-browser performance diagnostic:**

> "Profile the next interaction and report frame timing, long tasks, and event timing."

The agent will start `browser_profile`, perform the interaction, and stop the profile.
The result is an uncalibrated host-browser diagnostic, not target-headset performance.

## Customize the Screenshot Size

By default, screenshots are 800x800 pixels. You can adjust this to control token usage:

```bash
npx @iwsdk/cli dev up --ai-mode agent \
  --screenshot-width 500 --screenshot-height 500
```

## Opt In to Advanced Browser Automation

The seven browser MCP tools cover routine current-app inspection, interaction,
screenshots, profiling, diagnostics, reloads, and tab muting. If a development task
requires a Playwright API or direct CDP operation that those tools do not expose,
explicitly enable the local runner when starting a new session, or restart an existing
session:

```bash
# New session
npx @iwsdk/cli dev up --allow-browser-automation

# Existing session
npx @iwsdk/cli dev restart --allow-browser-automation
npx @iwsdk/cli browser run scripts/browser-diagnostic.mjs
```

`browser run` executes trusted local JavaScript from inside the workspace and connects
it to the same managed session through a loopback-only CDP endpoint. This opt-in grants
browser-level authority to any local process that can reach that endpoint for the
duration of the dev session, including access to page contents, storage, cookies, and
network controls. Review scripts before running them and use the opt-in only in a
trusted local environment. The runner is disabled unless the dev session was
explicitly started with `--allow-browser-automation`; see
[Advanced Playwright Runner](./workflows#advanced-playwright-runner) for its module
contract and an example.

## What's Next

- [Modes](./modes) — Learn about collaborate and agent modes
- [MCP Tools Reference](./mcp-tools) — Inspect the canonical runtime tool surface
- [Workflows](./workflows) — Common agent workflow patterns
