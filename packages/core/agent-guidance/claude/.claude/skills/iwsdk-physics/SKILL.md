---
name: iwsdk-physics
description: Add or repair IWSDK rigid-body simulation, collision shapes, forces, and physics-aware grabbing. Use for gravity, falling, collision, bouncing, kinematic motion, or physics tuning.
argument-hint: '(use the current request)'
---

# IWSDK Physics

Use the current request as the specification. Prefer the scaffold's project
manifest and native scene components over rebuilding physics in TypeScript.

## Implement the smallest complete physics path

1. Inspect `iwsdk.config.json`, the active scene, and only the source file that
   owns any requested custom behavior.
   Make the complete first config/asset/scene edit before starting the dev
   server. The contracts below are sufficient for the common path: do not call
   `scene capabilities`, CLI `--help`, search `node_modules`, or inspect
   generated declarations unless a concrete build/runtime error remains after
   that edit.
2. Set `world.features.physics` to `true`. The scaffold registers
   `PhysicsSystem`, `PhysicsBody`, `PhysicsShape`, and `PhysicsManipulation`; do
   not register them again unless the project deliberately replaced bootstrap.
3. Every colliding entity needs both `PhysicsBody` and `PhysicsShape`:

   - moving under simulation: `PhysicsBody.state: "DYNAMIC"`;
   - fixed floor or wall: `PhysicsBody.state: "STATIC"`;
   - code-driven moving platform: `PhysicsBody.state: "KINEMATIC"`.

4. Match shapes to visible geometry. Use `Sphere`, `Box`, or `Cylinder` with
   explicit dimensions for primitives. Use `ConvexHull` for a dynamic complex
   mesh and reserve `TriMesh` for static geometry.
5. Add only requested material tuning. Start with low restitution and moderate
   friction; avoid compensating for a missing collider with extreme damping.
6. For a throwable object, combine a dynamic body and shape with the requested
   grab component. `OneHandGrabbable` is proximity squeeze; a distance grab
   also requires `RayInteractable` and `DistanceGrabbable`.
7. Apply a one-shot force or velocity through `PhysicsManipulation`. For a
   reset/teleport of an existing body, use `PhysicsSystem.setBodyTransform` so
   Havok and the render transform remain synchronized.

For simple primitive assets, import `Mesh`, `SphereGeometry`, `BoxGeometry`,
and `MeshStandardMaterial` from `@iwsdk/core`, construct parentless meshes, and
add those mesh values directly to the existing `defineAssets({...})` map. Keep
the render geometry and collider dimensions identical: a sphere of radius `r`
uses `PhysicsShape: { shape: "Sphere", dimensions: [r, 0, 0] }`; a box sized
`[w, h, d]` uses `{ shape: "Box", dimensions: [w, h, d] }`.

Read one bundled reference only when needed; do not read the complete set:

- exact component fields and dimensions: `references/component-reference.md`;
- implementation patterns: `references/workflows.md`;
- material or system tuning: `references/tuning-and-config.md`.

## Verify behavior, not just source

Run the production build once. Start the app once and inspect the named live
entities. For falling, collision, force, or kinematic behavior, pause before the
interesting transition, take a `before` snapshot, step a small fixed number of
frames, take an `after` snapshot, and diff them. Query the final transform and
physics state. Capture one final runtime image when spatial layout matters.

Use the documented CLI shape directly; do not call help to rediscover it:

```bash
npx @iwsdk/cli ecs pause --input-json '{}'
npx @iwsdk/cli ecs snapshot --input-json '{"label":"before"}'
npx @iwsdk/cli ecs step --input-json '{"count":8,"delta":0.016}'
npx @iwsdk/cli ecs snapshot --input-json '{"label":"after"}'
npx @iwsdk/cli ecs diff --input-json '{"from":"before","to":"after"}'
npx @iwsdk/cli ecs resume --input-json '{}'
```

If a gravity body has already settled by the time the bridge is ready, its
resting transform plus a zero-motion stepped diff is valid collision evidence.
Do not teleport the body solely to recreate the fall.

Use an options object when you need to select the execution mode or simulation rate. Worker execution is the default; `useWorker: false` runs the same physics runtime and protocol on the main thread for compatibility and diagnostics.

```jsonc
"physics": {
  "useWorker": true,
  "updateFrequency": 60,
  "interpolation": true
}
```

**Only enable physics when needed.** If no objects require dynamic simulation, omit it to avoid overhead.

For a newly composed test fixture, run `scene render-file` on the authored hero
view once and inspect at most that one image. After a valid, readable hero,
do not call `scene open`, `scene state`, or `scene screenshot`, and do not create
alternate editor views. Save the final live browser screenshot to a file but do
not read it back when the ECS measurements already prove the requested motion.

Pure rigid-body verification does not require entering XR. The authored `hero`
view is composition evidence, while the live browser camera can differ. Do not
temporarily edit `iwsdk.config.json`, restart the runtime, or render extra camera
angles solely to make a screenshot match the hero view. Save the live capture
directly with `npx @iwsdk/cli browser screenshot --output-file <path>` and let the
authored render cover deliberate framing.

Make at most one focused correction, then replay the same observation. Stop
when the requested bodies, collisions, and final state are evidenced. Resume
ECS time and leave the app in a stable state.
