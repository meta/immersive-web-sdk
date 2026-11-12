---
name: iwsdk-depth-occlusion
description: Add or repair IWSDK WebXR depth sensing and real-world occlusion in AR. Use for DepthSensingSystem, DepthOccludable, occlusion modes, or passthrough depth troubleshooting.
argument-hint: '(use the current request)'
---

# IWSDK Depth Occlusion

Depth occlusion has three independent requirements: the AR session requests
depth, one depth system is registered, and only intended virtual entities carry
`DepthOccludable`.

## Implement

1. Inspect `iwsdk.config.json`, `src/index.ts`, and the active scene in one
   bounded pass, then make the complete config/system/scene edit before starting
   the dev server. The contracts below are sufficient for the normal path: do
   not call scene capabilities, CLI `--help`, inspect `node_modules`, or read
   generated declarations unless a concrete build/runtime error remains.
2. Keep `world.xr.mode` as `"ar"`. Under `world.xr.features`, request:

   ```json
   "depthSensing": {
     "required": true,
     "usage": "gpu-optimized",
     "format": "float32"
   }
   ```

   Preserve other required AR features. Use the living-room emulator (or the
   environment requested by the task) so runtime depth exists.
3. Import and register `DepthSensingSystem` exactly once after `World.create`:

   ```ts
   world.registerSystem(DepthSensingSystem, {
     configData: {
       enableDepthTexture: true,
       enableOcclusion: true,
       useFloat32: true,
       blurRadius: 20,
     },
   });
   ```

   `DepthOccludable` is built in. Do not call `registerComponent` for it.
4. Add `DepthOccludable` only to the requested scene nodes. These scene payloads
   are exact: `{}` means soft occlusion and `{ "mode": "HardOcclusion" }` means
   sharp low-cost occlusion. Use `"MinMaxSoftOcclusion"` only when the task needs
   the higher-quality path. Write the literal scene value directly; do not load
   the scene-composer format reference, import `OcclusionShadersMode`, or inspect
   its declaration to reconfirm it.
5. Leave a deliberate non-occludable reference object when comparison is part
   of the request. Do not mark UI or guidance surfaces occludable by default.

## Verify

Run the production build once, start the AR app once, enter XR, and query the
named entities and registered systems. Check the console for missing
depth-sensing warnings. Capture one runtime screenshot in the configured room;
source inspection or an authored scene render alone cannot prove passthrough
occlusion. Make one focused correction if the measured runtime disagrees, then
stop. Do not repeatedly restart the emulator or tune blur from screenshots when
the session never exposed depth data.

Use one XR entry, one bounded entity/system query set, and one console check.
Save the final live screenshot but do not read it back when those runtime checks
already prove that depth was requested, the system is live, and the intended
entities carry the correct occlusion modes.

Use the CLI action names below; do not substitute MCP method names or probe
`--help` first:

```bash
npx @iwsdk/cli xr enter
npx @iwsdk/cli xr status
npx @iwsdk/cli ecs find --input-json '{"namePattern":"<requested node regex>"}'
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<index from find>}'
npx @iwsdk/cli ecs systems
npx @iwsdk/cli browser logs --count 80
npx @iwsdk/cli browser screenshot --output-file artifacts/<name>.png
```

Use `npx @iwsdk/cli browser screenshot --output-file <path>` for file evidence. Do
not alter the project camera or render extra authored angles to manufacture an
occlusion view; stage the requested nodes once, then judge the live AR capture.
Do not inspect framework source when the build, registered-system query, entity
components, and console warnings already establish the failing layer.
