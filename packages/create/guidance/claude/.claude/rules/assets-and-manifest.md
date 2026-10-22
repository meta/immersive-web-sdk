---
paths:
  - "src/assets.ts"
  - "src/assets.js"
  - "src/scene-assets/**"
---

# Asset manifest contract

`src/assets.ts` is imported **independently by the app runtime and the editor**,
in separate JS realms. It must therefore be deterministic and self-contained:

- no `World`, scene, iframe, editor object or DOM access
- no timers, no fetching ambient state
- no reliance on singleton object identity across realms
- prototypes immutable after registration, and never parented

A manifest entry is either a URL descriptor (`{ url, type, name?, priority? }`)
or a bare parentless `Object3D`. `AssetType` covers `GLTF`, `Audio`, `Texture`,
`HDRTexture`, `UIKitML`. Only glTF, UIKitML and `Object3D` entries are placeable
as scene content; audio/texture/HDR are for application systems.

Build public URLs from `import.meta.env.BASE_URL` so runtime, editor and subpath
builds resolve identically. A file in `public/` is **not** available to a scene
until it is registered here.

## Procedural assets

Export a parentless `Object3D` from `src/scene-assets/*.scene-asset.ts` and
register it under a stable ID. The registry rejects an already-parented
prototype.

Every placement is a distinct hierarchy clone, but **geometry and materials stay
shared**. Never dispose them from a placed clone; world teardown owns their
lifetime. Reassigning `mesh.material` on a clone is fine and is how you restyle
one instance — mutating the shared material in place changes every instance.

Bounds come from `Box3` over the instantiated asset and drive placement,
selection, framing and scatter collision. Put the origin where composition wants
it (usually floor contact, or the object's own pivot), keep transforms finite,
and don't let invisible helpers inflate bounds.

## Cost

Split tessellation by viewing distance rather than using one budget everywhere: a
close-range hero model and coarser display copies of the same form are two
prototypes from one factory function. Sphere/lathe segment counts dominate small
repeated detail more than people expect — check `renderStats.triangles` rather
than guessing.

Reuse material instances within a module. Prefer prefabs plus a deterministic
pattern for repetition; a pattern whose prefab resolves to a single component-free
mesh lowers to one `InstancedMesh`.

Start assets at `castShadow: false` and opt in only for grounded focal masses.
Don't build contact-shadow blob cards or `ShadowMaterial` catcher planes here: put
`ContactShadow` or `ShadowCatcher` node components on the scene nodes instead.
