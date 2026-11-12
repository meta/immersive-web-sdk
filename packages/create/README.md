<h1 align="center">create-iwsdk</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@iwsdk/create"><img src="https://badgen.net/npm/v/@iwsdk/create/?icon=npm&color=orange" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@iwsdk/create"><img src="https://badgen.net/npm/dt/@iwsdk/create" alt="npm download" /></a>
    <a href="https://raw.githubusercontent.com/facebook/immersive-web-sdk/main/LICENSE"><img src="https://badgen.net/github/license/facebook/immersive-web-sdk/" alt="license" /></a>
</p>

<p align="center"><strong>Scaffold a new Immersive Web SDK project in seconds.</strong></p>

## Quick Start

```bash
npm create @iwsdk@latest

# Add IWSDK to an existing project, or a repository that is already checked out
npm create @iwsdk@latest . -- --yes --target vr
```

`.` selects the current directory.

**Existing projects.** When the target already has a `package.json`, Create adds
IWSDK to that project and never overwrites an existing file, even with
`--force`:

- everything is checked before the first write: an invalid `package.json`, or a
  Vite major the IWSDK plugin does not support yet (Vite 8), stops Create with
  nothing changed, and `--canary` is refused;
- a minimal IWSDK skeleton goes into its own `src/iwsdk/` folder (a world entry,
  empty asset and component manifests, and type references), so it never shadows
  the project's modules. `iwsdk.config.json` and an empty scene are added where
  missing, and `index.html`, a Vite config and `tsconfig.json` only when the
  project has none. The starter demo is not added;
- `package.json` is merged in its own indentation: IWSDK packages, the `three`
  alias and `@types/three` are set, versions are only raised, and specs that are
  not registry versions (`workspace:`, `file:`, `catalog:`) are left alone and
  reported. Other dependencies and your scripts are kept; `iwsdk:dev` is added
  when `dev` is taken;
- overrides go where the package manager reads them: `overrides` (npm, bun),
  `resolutions` (yarn), or `pnpm-workspace.yaml` (pnpm), merged without touching
  its other settings;
- `iwsdkDev()` is added to an existing Vite config when the config's own
  top-level `plugins` array is unambiguous, and listed as a step otherwise;
- `.gitignore` gains IWSDK's runtime and MCP entries, dependencies install with
  the package manager found from the nearest lockfile (a monorepo's included),
  and no Git repository is created;
- coding-agent guidance is installed as by `npx @iwsdk/cli agents sync`, keeping
  the text of an existing `AGENTS.md` or `CLAUDE.md`.

Create then prints what it created and kept and the steps left to finish, such
as importing `./iwsdk` from the app's entry module. The report is printed even
when the install fails, with the command to retry.

A non-empty target **without** a `package.json` requires `--force`, which
overwrites conflicting generated files but preserves unrelated files and an
existing Git repository. `--yes` never implies overwrite permission.

Or with other package managers:

```bash
# pnpm
pnpm create @iwsdk@latest

# yarn
yarn create @iwsdk

# bun
bun create @iwsdk
```

## Interactive Prompts

The default path is intentionally short and deterministic:

1. **Project name** - Asked only when it is not provided as an argument
2. **Starting point** - Virtual reality, mixed reality/passthrough, or Desktop 3D
3. **Setup** - Create with recommended settings or customize the setup

Recommended settings create a TypeScript project, initialize Git, and install
dependencies. They also apply a small target-specific baseline:

| Starting point              | Recommended baseline                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Virtual reality             | Locomotion on a worker and grabbing enabled; physics disabled                                             |
| Mixed reality / passthrough | Grabbing enabled; physics, room surfaces/anchors, and real-world placement disabled                       |
| Desktop 3D                  | Dedicated non-XR scene with browser camera, input, locomotion, and interaction behavior; physics disabled |

Choose **Customize setup...** to select JavaScript, change applicable SDK
features, or opt out of Git initialization and dependency installation. The CLI
derives low-level WebXR feature settings from those choices instead of asking
for raw `No` / `Optional` / `Required` states.

Every project includes guidance and configuration for Claude Code, Codex,
Cursor, GitHub Copilot/VS Code, and OpenCode. Delete integrations you do not use;
there is no tool-selection step during scaffolding.

Before writing files, Create prints the resolved starting point, language, SDK
features, and generated `World.create` options. These settings remain editable
in `src/index.ts`; changing them does not require scaffolding again.

## What You Get

A fully configured project with:

- ⚡ **Vite** - Fast dev server with HMR
- 🎮 **WebXR Emulator** - Develop without VR hardware
- 🖥️ **Desktop 3D starter** - Browser-native camera, movement, pointer input, and interactions
- 📦 **GLTF Optimization** - Automatic asset compression
- 🔒 **HTTPS** - Required for WebXR, auto-configured
- 🧩 **Native scene workflow** - IWSDK scene JSON and editor tooling

## Example

```bash
$ npm create @iwsdk@latest

===============================================
IWSDK Create CLI v<current version>
Node v20.19.0

? Project name › iwsdk-app
? What should this project start as? › Virtual reality - Start inside an authored virtual environment.
? Setup › Create with recommended settings
```

## Command Line Options

```bash
# Provide project name directly
npm create @iwsdk@latest my-app

# Skip all prompts and use defaults
npm create @iwsdk@latest my-app -- -y

# Create a mixed reality starter non-interactively
npm create @iwsdk@latest mr-app -- -y --target ar

# Create a desktop browser 3D starter non-interactively
npm create @iwsdk@latest desktop-app -- -y --target browser

# Add IWSDK to the project in the current directory (overwrites nothing)
npm create @iwsdk@latest . -- -y --target vr

# Use canary SDK bundle
npm create @iwsdk@latest -- --canary
```

Use `-y` / `--yes` for deterministic non-interactive scaffolding. Without it,
`--target` and its compatibility aliases can preselect the starting point, but
the interactive setup controls language, features, Git, and installation.

| Flag                                                 | Description                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `[name]`                                             | Project directory; use `.` to scaffold in the current directory                                  |
| `-y, --yes`                                          | Skip prompts; defaults to VR, TypeScript, recommended features, Git, and dependency installation |
| `--force`                                            | Overwrite conflicting generated files in a non-empty target without a `package.json`             |
| `--target <target>`                                  | Starting point: `vr`, `ar`, or `browser`                                                         |
| `--mode <mode>`                                      | Compatibility alias for XR targets: `vr` or `ar`                                                 |
| `--xr` / `--no-xr`                                   | Compatibility selectors for VR (or `--mode ar`) and Desktop 3D                                   |
| `--language <lang>`                                  | `ts` or `js`                                                                                     |
| `--locomotion` / `--no-locomotion`                   | Enable or disable VR locomotion                                                                  |
| `--grabbing` / `--no-grabbing`                       | Enable or disable VR/MR grabbing                                                                 |
| `--physics` / `--no-physics`                         | Enable or disable physics                                                                        |
| `--scene-understanding` / `--no-scene-understanding` | Enable or disable MR room surfaces and anchors                                                   |
| `--environment-raycast` / `--no-environment-raycast` | Enable or disable MR real-world placement                                                        |
| `--install` / `--no-install`                         | Install or skip dependencies                                                                     |
| `--git` / `--no-git`                                 | Initialize or skip a Git repository                                                              |
| `--canary`                                           | Use the default canary SDK bundle                                                                |
| `--canary URL`                                       | Use a custom HTTP(S) SDK bundle                                                                  |

Automation and coding agents should map the requested experience to a target
and high-level feature flags before invoking Create, then pass those choices
with `--yes`. When the harness starts inside an existing project, pass `.`;
Create adopts it without overwriting files. Do not treat `--yes` as overwrite
consent. The CLI does not infer application intent from an open-ended
description.

## Generated Templates

Based on your choices, one of these variants is generated:

| Template ID         | Description                                   |
| ------------------- | --------------------------------------------- |
| `vr-manual-ts`      | VR + TypeScript + native workflow             |
| `vr-manual-js`      | VR + JavaScript + native workflow             |
| `ar-manual-ts`      | MR/passthrough + TypeScript + native workflow |
| `ar-manual-js`      | MR/passthrough + JavaScript + native workflow |
| `browser-manual-ts` | Desktop 3D + TypeScript + native workflow     |
| `browser-manual-js` | Desktop 3D + JavaScript + native workflow     |

The scaffolded project includes native scene JSON under `public/scenes/` and is
ready for declarative scene authoring through the IWSDK managed workspace. It
also includes one canonical `AGENTS.md`; selected tool adapters add only their
native MCP, permission, skill, or import-shim files.

## Requirements

- Node.js 20.19.0 or higher

## Documentation

For guides and tutorials, visit: **[https://iwsdk.dev](https://iwsdk.dev)**

## License

MIT © Meta Platforms, Inc.

---

<details>
<summary><strong>Development (for contributors)</strong></summary>

### Local Development

```bash
# Build the CLI
pnpm --filter @iwsdk/create build

# Run locally
pnpm --filter @iwsdk/create dev
```

### Module Layout

- `src/cli.ts` — Entrypoint: parses flags, runs prompts, scaffolds project
- `src/prompts.ts` — Interactive questions and defaults
- `src/project-target.ts` — Target-directory validation and in-place resolution
- `src/project-files.ts` — Builds the common source plus target manifest/scene
- `src/project-manifest.ts` — Generates the project manifest authority
- `src/scaffold.ts` — Safely writes the generated `ProjectFile[]`
- `src/installer.ts` — Dependency installation and next steps
- `src/types.ts` — Shared types (`VariantId`, `TriState`, `PromptResult`)

### How It Works

The CLI ships one common TypeScript source tree, mechanically generated
JavaScript output, target scene seeds, and agent guidance in its own package.
It writes `iwsdk.config.json` and the selected `main.iwsdk.scene.json` locally;
scaffolding does not fetch a remote recipe.

Agent guidance comes from `@iwsdk/core` (`packages/core/agent-guidance`), so a
new app receives the same stamped files that `npx @iwsdk/cli agents sync`
installs and later refreshes. Claude guidance is the canonical Agent Skills
source; the core build derives the `.agents/skills` tree used by Codex, Cursor,
Copilot, and OpenCode and translates path-scoped rules into each harness's
native format.

</details>
