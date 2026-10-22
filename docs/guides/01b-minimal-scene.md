---
outline: [2, 3]
---

# Minimal Scene Walkthrough

This walkthrough adds one visible Three.js object to the generated IWSDK
starter while preserving the starter's existing robot and welcome-panel
systems. It shows the complete `src/index.ts` or `src/index.js` file so you can
see exactly where application code belongs. The same source works in both the
TypeScript and JavaScript starters.

## Replace `src/index.ts` or `src/index.js`

```js
import { BoxGeometry, Mesh, MeshBasicMaterial, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { PanelSystem } from './panel.js';
import { RobotSystem } from './robot.js';

const sceneContainer = document.getElementById('scene-container');
if (!(sceneContainer instanceof HTMLDivElement)) {
  throw new Error('Missing #scene-container');
}

// Create the IWSDK world from iwsdk.config.json and its active scene.
World.create(sceneContainer, projectOptions).then((world) => {
  // Three.js supplies the geometry, material, mesh, and transforms.
  const cube = new Mesh(
    new BoxGeometry(0.5, 0.5, 0.5),
    new MeshBasicMaterial({ color: 0x4f8cff }),
  );

  // X is left/right, Y is down/up, and negative Z is forward from the
  // starter origin. This places the cube at eye height, two metres ahead and
  // a little to the left of the welcome panel, so both remain visible when
  // you enter XR.
  cube.position.set(-1.2, 1.6, -2);

  // Register the Three.js object with IWSDK's ECS and level lifecycle.
  world.createTransformEntity(cube);

  // Systems contain behavior that runs every frame or reacts to ECS queries.
  world.registerSystem(RobotSystem);
  world.registerSystem(PanelSystem);
});
```

Run the project:

```bash
npm run dev
```

The blue cube should appear ahead and to the left of the starting position,
above the starter's first station. The starter
robot and welcome panel are examples rather than required framework objects;
you can remove them when you replace their scene nodes and system registrations
with your own content.

## Where Different Work Belongs

- `iwsdk.config.json` selects the scene, assets, components, XR mode, and
  optional runtime features.
- `public/scenes/*.iwsdk.scene.json` holds declarative scene composition.
- `src/index.ts` creates the world, adds procedural objects, and registers
  systems.
- `src/*.ts` system files contain application behavior.

Continue with [testing the experience](/guides/02-testing-experience), then read
[Working in 3D](/guides/03-working-in-3d) for transforms, materials, and ECS
entities.
