<h1 align="center">@iwsdk/core</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@iwsdk/core"><img src="https://badgen.net/npm/v/@iwsdk/core/?icon=npm&color=orange" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@iwsdk/core"><img src="https://badgen.net/npm/dt/@iwsdk/core" alt="npm download" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://badgen.net/badge/icon/typescript/?icon=typescript&label=lang" alt="language" /></a>
    <a href="https://raw.githubusercontent.com/facebook/immersive-web-sdk/main/LICENSE"><img src="https://badgen.net/github/license/facebook/immersive-web-sdk/" alt="license" /></a>
</p>

<p align="center"><strong>Build immersive web experiences as easily as traditional web development.</strong></p>

The **Immersive Web SDK** is a complete framework for building WebXR applications. Built on **Three.js** with a high-performance **Entity Component System**, it provides production-ready systems for grab interactions, locomotion, spatial audio, physics, and scene understanding.

**Same code, two experiences**: Run immersively in VR/AR headsets and automatically provide mouse-and-keyboard emulation on desktop browsers—no VR hardware required to develop.

## Quick Start

The fastest way to get started is with the project scaffolding CLI:

```bash
npm create @iwsdk@latest
```

This will guide you through creating a new project with all the recommended tooling pre-configured.

To add IWSDK to an existing project, run the same command in it with `.`:

```bash
npm create @iwsdk@latest . -- --yes --target vr
```

When the directory has a `package.json`, Create keeps every existing file, adds
its skeleton in `src/iwsdk/`, merges `package.json`, adds the IWSDK Vite plugin
when it can do so safely, installs coding-agent guidance, and lists the steps
left to finish.

> **Coding agents:** IWSDK changes faster than model training data. GLXF scenes,
> the external 0.4 scene editor and its Vite plugin, and the UIKitML-compile and
> glTF-optimizer Vite plugins were removed in 0.5. After installing IWSDK by any
> route, install dependencies, run `npx @iwsdk/cli@latest agents sync`, and read the `iwsdk-agent-guidance`
> block it adds to `AGENTS.md` and the skills it lists. Upgrade with
> `npx @iwsdk/cli@latest upgrade`, which also writes migration guides.

## Manual Installation

```bash
npm install @iwsdk/core three@npm:super-three@0.185.0
```

Keep `three` pinned to the same alias in your application manifest. The
override prevents another dependency from installing a second Three.js module
instance:

```json
{
  "dependencies": {
    "@iwsdk/core": "^1.0.0",
    "three": "npm:super-three@0.185.0"
  },
  "overrides": {
    "three": "npm:super-three@0.185.0"
  },
  "pnpm": {
    "overrides": {
      "three": "npm:super-three@0.185.0"
    }
  }
}
```

### Basic Example

```typescript
import { World, OneHandGrabbable } from '@iwsdk/core';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

// Create an immersive world
const world = await World.create(document.getElementById('app'), {
  features: {
    grabbing: true,
    locomotion: true,
  },
});

// Create a grabbable cube
const geometry = new BoxGeometry(0.5, 0.5, 0.5);
const material = new MeshStandardMaterial({ color: 0x00ff00 });
const mesh = new Mesh(geometry, material);

const cube = world.createTransformEntity(mesh);
cube.addComponent(OneHandGrabbable, { rotate: true, translate: true });
```

## Features

- 🎮 **Entity Component System** - High-performance ECS architecture built on [elics](https://github.com/pmndrs/elics)
- 🖐️ **Grab Interactions** - One-hand, two-hand, and distance grabbing out of the box
- 🚶 **Locomotion** - Teleportation, smooth locomotion, and snap turning
- 🎨 **Spatial UI** - Build 3D interfaces with HTML-like syntax via [uikit](https://github.com/pmndrs/uikit)
- 🔊 **Spatial Audio** - Positional audio with automatic listener management
- ⚡ **Physics Integration** - Havok physics engine support
- 🏠 **Scene Understanding** - AR plane detection, mesh detection, and hit testing
- 🖥️ **Desktop Emulation** - Develop without VR hardware using built-in keyboard/mouse controls

## Vite Plugins

For the best development experience, use our Vite plugins:

```bash
npm install -D @iwsdk/vite-plugin-dev
```

| Plugin                   | Description                                     |
| ------------------------ | ----------------------------------------------- |
| `@iwsdk/vite-plugin-dev` | XR emulation, AI agent tooling, and dev browser |

## Documentation

For guides, concepts, and API reference, visit:

**[https://iwsdk.dev](https://iwsdk.dev)**

## Requirements

- Node.js 20.19.0 or higher
- A modern browser with WebXR support (for immersive mode)

## License

MIT © Meta Platforms, Inc.
