# IWSDK Agent Quickstart

Read the full IWSDK development skill before building an application:

- https://iwsdk.dev/skill.md

Use this file as a compact start-here index. The full skill is authoritative when a detail differs.

## Default Operating Model

- Prefer `npx @iwsdk/cli ...` CLI commands in cloud-based harnesses.
  The scoped package name ensures that an absent local binary can resolve only
  to the official IWSDK CLI package, rather than an unrelated unscoped npm
  package.
- Use MCP tools only when the harness exposes them and they are already working.
- Build from the official scaffold instead of hand-rolling project setup.
- Verify visually with managed-browser screenshots and runtime inspection.

## Scaffold

```bash
# VR game
npx @iwsdk/create@latest my-iwsdk-app --yes --target vr --physics --grabbing

# Mixed reality app
npx @iwsdk/create@latest my-mr-app --yes --target ar --physics --scene-understanding

# Desktop 3D app
npx @iwsdk/create@latest my-desktop-app --yes --target browser --physics

# Existing project, or harness already opened inside a repository
npx @iwsdk/create@latest . --yes --target vr

# IWSDK installed by hand: after installing dependencies, add matching guidance
npx @iwsdk/cli@latest agents sync
```

Choose flags based on the requested experience. The Desktop 3D starter includes
browser locomotion and canvas pointer input; camera look is app-owned so each app
can choose first-person, orbit, editor, or follow behavior. `.` works in place.
In a directory that already has a `package.json`, Create adds IWSDK to the
existing project and never overwrites a file: it adds its skeleton in
`src/iwsdk/`, merges `package.json`, adds `iwsdkDev()` to the Vite config when it
can do so safely, installs with the project's package manager and adds the agent
guidance, then prints the steps left to finish. Do every step. A non-empty directory without a `package.json` needs
`--force`, which overwrites conflicting generated files. `--yes` alone never
permits overwrites.

## Run

```bash
cd my-iwsdk-app
npm install
npm run dev
```

The starter `npm run dev` uses the IWSDK CLI-managed runtime. Treat the reported runtime URL and `npx @iwsdk/cli dev status` as the source of truth.

```bash
npx @iwsdk/cli dev status
npx @iwsdk/cli browser screenshot
npx @iwsdk/cli xr status
```

## Inspect And Debug

```bash
npx @iwsdk/cli scene state --raw
npx @iwsdk/cli scene render-file --input-json '{"path":"public/scenes/main.iwsdk.scene.json","view":"quarter"}' --output-file artifacts/main.png
npx @iwsdk/cli ecs components
npx @iwsdk/cli ecs systems
npx @iwsdk/cli ecs snapshot --label before
npx @iwsdk/cli ecs step --count 1
npx @iwsdk/cli ecs snapshot --label after
npx @iwsdk/cli ecs diff --from before --to after
```

For declarative scene composition, create and edit scene JSON files directly. Use
`scene_render_file` to validate, compose imports, and render them. When a composition
uses imports, create its import-free runtime file with `scene_flatten_file` before
opening that file with `scene_open`. Inspect consolidated live state with
`scene_get_state`, and use `scene_select`, `scene_set_camera`, `scene_screenshot`,
`scene_set_preview_visibility`, and `scene_measure_image_regions` for live editor
observation. Use current/top/front/side or quarter screenshots when alignment or
on-surface placement matters; use `scene_screenshot` with
`{"view":"orbit","orbitStep":N}` for deterministic orbit angles.

For XR interactions:

```bash
npx @iwsdk/cli xr enter
npx @iwsdk/cli xr get-transform --device controller-right
npx @iwsdk/cli xr set-transform --device controller-right --position '{"x":0.3,"y":1.2,"z":-0.5}'
npx @iwsdk/cli xr select --device controller-right
```

## Key Docs

- AI overview: https://iwsdk.dev/ai/
- Runtime-first workflows: https://iwsdk.dev/ai/workflows.html
- MCP tools reference: https://iwsdk.dev/ai/mcp-tools.html
- Project setup: https://iwsdk.dev/guides/01-project-setup.html
- Minimal commented scene: https://iwsdk.dev/guides/01b-minimal-scene.html
- Browser-first systems: https://iwsdk.dev/guides/16-browser-first-systems.html
- Examples: https://iwsdk.dev/examples/
- API reference: https://iwsdk.dev/api/
- LLM discovery index: https://iwsdk.dev/llms.txt
