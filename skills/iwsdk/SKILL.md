---
name: iwsdk
description: Use before writing any IWSDK (Immersive Web SDK, @iwsdk/*) code, and whenever the user asks to build, add, switch an existing project to, or upgrade IWSDK for WebXR VR, mixed-reality, or browser 3D apps on Meta Quest. Installs the guidance that matches the IWSDK version in the project.
---

# IWSDK entry point

This skill only gets the right guidance into the project. The project's own
IWSDK guidance, installed by the commands below, matches its IWSDK version and
overrides this file and anything you remember about IWSDK.

IWSDK changes faster than model training data. GLXF scenes, the external 0.4
scene editor and its Vite plugin, and the UIKitML-compile and glTF-optimizer
Vite plugins were removed in 0.5: scenes are native `*.iwsdk.scene.json` files
edited in IWSDK's built-in editor, and `@iwsdk/vite-plugin-dev` is the only
IWSDK Vite plugin.

## Pick the command

Always use `@latest` and the scoped package names.

- **New app**:
  `npx @iwsdk/create@latest my-app --yes --target vr` (or `--target ar` for
  mixed reality, `--target browser` for desktop 3D).
- **Existing project** (for example "switch this to IWSDK"): run in the project
  directory `npx @iwsdk/create@latest . --yes --target vr`. With a
  `package.json` present it adds IWSDK without overwriting any file (its own
  files go in `src/iwsdk/`), merges `package.json`, and prints a "To finish"
  list. Do every step on that list. A project on Vite 8 is refused, with nothing
  changed.
- **IWSDK already in `package.json`** (installed by hand or cloned): install
  dependencies first, then run `npx @iwsdk/cli@latest agents sync`.

## Then read the project guidance

Each command prints a notice naming the guidance it installed. Before writing
IWSDK code, read the `iwsdk-agent-guidance` block in `AGENTS.md`, then
`.claude/skills/iwsdk-dev/SKILL.md` (Claude Code) or
`.agents/skills/iwsdk-dev/SKILL.md` (other agents), and follow it. Skills added
during this session may not appear in your skill list until the next session;
read their `SKILL.md` files directly when the task matches.
