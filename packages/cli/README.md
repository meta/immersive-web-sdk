# `@iwsdk/cli`

Runtime-first CLI for Immersive Web SDK starter apps.

This package is the public `iwsdk` executable used by starters and AI tooling.
It owns:

- dev server lifecycle commands
- adapter sync and status
- reference status and recovery warmup commands (fresh installed scaffolds warm
  the shared cache automatically)
- runtime-resolved MCP stdio access
- direct runtime control commands

## Running without a local install

Starter apps install this package and should run `npx @iwsdk/cli ...` from the app
directory. Elsewhere, use the scoped package explicitly so npm does not resolve
the unrelated `iwsdk` placeholder package:

```bash
npm exec --package @iwsdk/cli -- iwsdk --help
```

## Coding-agent adapters

`iwsdk adapter sync` preserves unrelated settings while configuring the native
repository surfaces for Claude Code, Cursor, GitHub Copilot, Codex, and
OpenCode. Use `--tools claude,codex` to limit the selection.

Generated starters give Claude Code its native `CLAUDE.md`, scoped rules, and
skill tree. Codex, Cursor, Copilot, and OpenCode share byte-identical Agent
Skills under `.agents/skills`; Cursor and Copilot receive native scoped rules,
while Codex and OpenCode receive nested `AGENTS.md` files. Where a harness
supports repository-scoped permissions, sync preapproves only IWSDK-managed MCP
namespaces and skill loading. Copilot tool approval remains an explicit VS Code
action because it has no supported repository config for that choice.

`adapter sync` also installs the project's agent guidance (below).

## Agent guidance

`@iwsdk/core` ships the coding-agent guidance for its release: a managed block in
`AGENTS.md`, the IWSDK skills, path-scoped rules, and the project code-review
subagent. `iwsdk agents sync` installs it from the installed `@iwsdk/core`, so the
guidance always matches the IWSDK version in `node_modules`. Run it after
upgrading IWSDK, or in a project that added IWSDK by hand.

- Files IWSDK wrote and nobody edited are replaced; each carries a stamp with the
  release and a content hash. Retired IWSDK skills and rules are removed.
- Files a developer edited, and same-named files IWSDK did not write, are reported
  and left alone. `--force` replaces them.
- An existing `AGENTS.md` keeps its own text; IWSDK guidance lives between
  `<!-- BEGIN iwsdk-agent-guidance -->` and `<!-- END iwsdk-agent-guidance -->`.
  `CLAUDE.md` gets an `@AGENTS.md` import.
- Guidance written by releases before stamps is recognized by hash and upgraded.
- Each file is replaced as a whole, through a temporary copy, so an interrupted
  sync never leaves a half-updated skill. Files written by a newer IWSDK release
  are never rolled back, and an `AGENTS.md` whose markers are broken is left for
  you to fix.
- A project that lists `@iwsdk/core` must have it installed; otherwise the
  command asks you to install dependencies first. A project that does not list
  it yet gets the copy bundled with the CLI.
- Without `--tools`, a project keeps the coding tools it already has guidance
  for (a project with none gets all five). `--tools claude,codex` picks them.
- `iwsdk agents check` writes nothing and exits 1 when sync would change files,
  for CI. Edited files are reported but are not drift.
- Run it as `npx @iwsdk/cli@latest agents sync` in apps whose installed
  `@iwsdk/cli` predates the command.

The command prints a short notice on stderr naming the entry skill and every
skill path, so a coding agent can read the guidance in the same session that
installed it.

`iwsdk dev up` and `dev restart` keep the guidance current after an upgrade:
when the installed `@iwsdk/core` ships different guidance than the project has,
they refresh the files nobody edited and print what changed. They only report,
without writing, when `CI` is set, when `node_modules` holds a different
`@iwsdk/core` than the lockfile resolves (for example after switching branches
without installing), or when `iwsdk.config.json` sets
`"dev": { "agentGuidance": "warn" }`. `"off"` (or `IWSDK_AGENT_GUIDANCE=off`)
disables the check. They never install guidance into a project that has none.

For dependency bots, run the sync after the bump with dependencies installed,
for example with Renovate (self-hosted Renovate must also allow the commands):

```json
{
  "postUpgradeTasks": {
    "commands": ["npm ci", "npx @iwsdk/cli@latest agents sync"],
    "fileFilters": ["**/*"]
  }
}
```

Use your package manager's install in place of `npm ci`
(`pnpm install --frozen-lockfile`, `yarn install --immutable`).

## Upgrading IWSDK

```bash
npx @iwsdk/cli@latest upgrade [--to <version>] [--dry-run] [--no-install]
```

`upgrade` sets every `@iwsdk/*` dependency in the release group to the CLI's
release (or `--to`), keeping `^` and `~` ranges and leaving `workspace:`,
`file:` and `catalog:` specs alone. It installs with the package manager found
from the nearest lockfile, aligns the `three` alias (in `package.json` or
`pnpm-workspace.yaml`) with the one `@iwsdk/core` uses, refreshes the agent
guidance the project already has, and checks `iwsdk.config.json` against the
new release. It writes to `.iwsdk/migrations/` (gitignored) the migration guide
for each release boundary crossed and `release-notes.md` with every change in
between, and names them in its output. Use `@latest`: migration guides and
release notes ship with the CLI, so the newest CLI covers every release,
whatever version the project starts from.

- `iwsdk adapter status` reports MCP, instruction, and permission state.
- `iwsdk adapter prune` removes managed MCP/permission entries and preserves
  editable instruction files.
- `iwsdk adapter prompt` prints exact setup instructions for another harness.

## Runtime ownership and targets

One canonical app workspace has one dev runtime and at most one managed browser.
This guarantee is within one OS/process namespace. Stop running dev processes
before upgrading the CLI and plugin together; concurrent old/new lock protocols
and shared workspaces across hosts, containers, or WSL are not supported.
`dev up` attaches to an existing runtime; `dev restart` explicitly stops it first.
A configured `server.port` (8081 in starters) is the runtime's address: if it is
occupied, startup fails instead of moving to another port. Without a configured
port, Vite may select the next available one. Browser failure does not stop HTTP serving
or HMR, including in foreground mode. `--no-open` disables managed-browser
launches for that session.
Managed browser profiles live in a private OS temporary directory outside the
served workspace. While that directory is retained, localStorage, IndexedDB, and
service workers survive browser recovery; normal OS temporary-file cleanup may
eventually remove them. A browser whose cleanup cannot be confirmed blocks
replacement and reports that condition.

The runtime's command WebSocket (`/__iwer_mcp`) accepts connections only from a
loopback address with a local `Host` header, and a browser only from the dev
server's own origin. Every command must also carry the dev-server session's
command credential: a random secret the dev server writes to
`.iwsdk/runtime/command-credential.json` (never served over HTTP) and deletes
when it stops. On macOS and Linux the file has mode 0600; on Windows it takes
the permissions of the project folder. The CLI and `iwsdk mcp stdio` read it for
the session they resolved and send it with each command; the server drops it
before relaying a command to a page. Commands without it fail with
`runtime_unauthorized` and `outcome: "not_executed"`, so scripts running in a
page (an app dependency, for example) and, on macOS and Linux, other local users
cannot drive the runtime, editor or managed browser. Any process running as your
own OS user can read the file, so the credential is no boundary against those.
Browser bridges never hold the credential: the managed browser identifies itself
with its injected session identity, and a headset with its pairing token. Use
the CLI and dev server from the same IWSDK release; an older CLI sends no
credential.

Use `iwsdk runtime status` for the live lifecycle, `runtime targets` for connected
pages and their supported methods, and `runtime wait --input-json
'{"afterRevision":7,"timeoutMs":25000}'` to wait without causing recovery.
`runtime recover` explicitly retries a failed launch. The MCP equivalents are
`runtime_get_status`, `runtime_list_targets`, `runtime_wait`, and `runtime_recover`.
`dev status` remains a read of the persisted discovery snapshot. `dev up`
reports `browserCommandReady` and can return while a lifecycle-managed browser
is still launching; follow its `browserNextAction` or wait until readiness is
true before issuing browser-backed commands.

Commands default to the managed browser. Recovery returns `browser_relaunched`
and `outcome: "not_executed"`; inspect the new state and issue a fresh command.
A disconnection after dispatch returns `outcome_unknown`: a mutation might have
executed, so inspect state before retrying. No command is automatically replayed.

To control a Quest, run `runtime pair-headset --input-json
'{"headsetId":"ADB_SERIAL"}'`, set up `adb -s ADB_SERIAL reverse tcp:PORT tcp:PORT`,
and open the returned URL on that exact device. Pairings last for the dev session.
`runtime targets` returns an exact `runtimeTarget` to copy into tool arguments:

```json
{
  "runtimeTarget": {
    "deviceClass": "physical",
    "headsetId": "ADB_SERIAL",
    "pageId": "page-from-discovery",
    "tabGeneration": 2
  }
}
```

Physical pages are never selected implicitly. Reload runs through the app bridge;
screenshot, snapshot, interaction, profiling, console capture, and the managed
editor remain host-only and return `unsupported_on_target` for physical pages.
Runtime/ECS methods require that page's framework to be ready. Native pose control
still requires the explicit native-XR option. No console listeners are added to
the headset app. A page reload advances its generation; rediscover before another
command. `runtimeTarget` is distinct from existing tools' position-vector `target`.

`browser run` holds the managed command lease for its complete CDP session. Do not
call another managed-browser tool from inside a leased script. A lost runner lease
retires the browser, preventing unfinished CDP work from overlapping later commands.
