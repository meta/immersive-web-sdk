# Immersive Web SDK

The **Immersive Web SDK (IWSDK)** is a framework for building WebXR and
browser-first 3D applications with **Three.js rendering** and an **Entity
Component System (ECS)**. It provides the runtime systems, project scaffolding,
browser emulation, and debugging tools needed to build VR, mixed-reality, and
desktop 3D experiences without assembling that infrastructure yourself.

IWSDK builds on WebXR and Three.js rather than replacing them. You can use
standard Three.js meshes, materials, transforms, and math while IWSDK manages
application structure, XR input, lifecycle, and optional systems such as
grabbing, locomotion, physics, and spatial UI.

## What You Need to Know

- No prior JavaScript or TypeScript experience required; basic familiarity
  helps. The guides use JavaScript modules, classes, and npm commands. If these
  are new to you, the MDN
  [JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)
  covers the basics
- Prefer to build with an AI assistant? [Getting Started with AI](../ai/getting-started.md)
  connects tools such as Claude Code, Cursor, or GitHub Copilot to your project,
  and the
  [Immersive Web SDK Starter App template on V0](https://v0.app/templates/immersive-web-sdk-starter-app-1o9ZJQxDtU4)
  offers a no-code starting point
- No prior ECS or 3D-math experience; the guides introduce both as you need them
- No headset for initial development; the included IWER emulator runs in a
  desktop browser

## The Shape of an IWSDK App

A generated app creates a `World`, loads the declarative project settings from
`iwsdk.config.json`, and registers the systems containing its runtime behavior:

```ts
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { PanelSystem } from './panel.js';
import { RobotSystem } from './robot.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(RobotSystem);
  world.registerSystem(PanelSystem);
});
```

Start with the [minimal scene walkthrough](/guides/01b-minimal-scene) to add a
visible object to this complete file, or continue through project setup first.

## Built on Three Core Pillars

### Modern Architecture

Three.js supplies the scene graph and rendering foundation. IWSDK's ECS keeps
data, behavior, and scene objects organized as an application grows.

### Developer-First Workflow

The Create CLI scaffolds a project with a managed development browser. Native scene JSON editing and visual editors are part of the same workflow, alongside UIKitML spatial UI, automated asset handling, and browser-based XR emulation.

### Production Systems

IWSDK includes systems for XR input, grabbing, locomotion, spatial audio,
physics, scene understanding, and spatial UI. Enable only the systems your
experience needs.

## What You Get

- **ECS runtime** — entities, components, systems, queries, and lifecycle tools
- **XR input** — controller and hand input with managed visuals
- **Locomotion and grabbing** — configurable interaction systems
- **Spatial audio and physics** — integrated runtime features
- **Scene understanding** — real-world plane and mesh support for MR
- **Spatial UI** — UIKit and HTML-like UIKitML authoring
- **Developer tools** — managed browser, emulation, scene editor, CLI, and
  runtime inspection

## Same Project, Multiple Test Paths

You can develop with desktop IWER emulation and then open the same HTTPS
development URL on a headset. Browser-first projects can disable XR entirely
while using the same ECS and Three.js foundations.

## Get Started

- [Project setup](/guides/01-project-setup)
- [Minimal scene walkthrough](/guides/01b-minimal-scene)
- [Testing with IWER or a headset](/guides/02-testing-experience)
- [Core concepts](/concepts/)
- [API reference](/api/)
