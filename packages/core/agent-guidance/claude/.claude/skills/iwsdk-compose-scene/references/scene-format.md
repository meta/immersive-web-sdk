# IWSDK Scene Format

## Contents

1. Capability First
2. Document Boundary
3. Asset Boundary
4. Nodes And Content
5. Prefabs And Patterns
6. Imports
7. Components And Constraints
8. Authoring And Review
9. Validation Traps

## Capability First

Call `scene_get_capabilities` before authoring. The active schema version, content
kinds, component hashes, pattern algorithms, and limits are authoritative.

The only format is `iwsdk.scene.v1`, in meters. Scene JSON is composition data. The
runtime projection strips `authoring` and hashes canonical JSON for runtime identity.

## Document Boundary

```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "components": {
    "com.iwsdk.components.DomeGradient": {
      "sky": [0.2423, 0.6172, 0.8308, 1],
      "equator": [0.6584, 0.7084, 0.7913, 1],
      "ground": [0.807, 0.7758, 0.7454, 1],
      "intensity": 1
    },
    "com.iwsdk.components.IBLGradient": {
      "sky": [0.6902, 0.749, 0.7843, 1],
      "equator": [0.6584, 0.7084, 0.7913, 1],
      "ground": [0.807, 0.7758, 0.7454, 1],
      "intensity": 1
    }
  },
  "metadata": {},
  "authoring": {},
  "resources": { "prefabs": [] },
  "environment": {},
  "nodes": []
}
```

- `components` apply to the actual IWSDK level-root entity. `DomeGradient` and
  `IBLGradient` are normal removable components, not editor-only environment fields.
- `DomeFade` is a node component, not a root one: put
  `"com.iwsdk.components.DomeFade": { "start": 4, "end": 10 }` on a floor or
  terrain node to fade that node's own meshes into the root `DomeGradient` sky.
- `LevelRoot`, `LevelTag`, and `Transform` are runtime-owned and must not appear in
  `components`.
- `ContactShadow` (a soft blob under a node) and `ShadowCatcher` (an invisible AR
  floor that shows received shadows) are node components: put them on the grounded
  node or a floor node, not in root `components`.
- `resources` contains only reusable scene prefabs.
- Use namespaced keys in opaque `metadata`. Do not hide structural fields there.
- Structural objects are closed. Unknown fields fail validation.

## Asset Boundary

Scene JSON never declares assets, URLs, geometry, or materials. Those live in the
`defineAssets()` module selected by `iwsdk.config.json` at `assets.module`.

Valid renderable content references a manifest ID:

```json
{
  "id": "hero-chair",
  "name": "Hero reading chair",
  "content": {
    "type": "asset",
    "asset": "reading-chair",
    "castShadow": true,
    "receiveShadow": true
  },
  "transform": {
    "position": [0.6, 0, -0.8],
    "rotationDeg": [0, -18, 0],
    "scale": 1
  }
}
```

The `asset` string is application-global. It is not namespaced when a scene module is
imported. The editor validates it against the live manifest and derives bounds from
the registered object.

The following old branches are invalid and must never be emitted:

- `content.type: "model"`;
- `content.type: "primitive"`;
- `resources.assets`;
- `resources.materials`;
- node or prefab material overrides.

Create procedural shapes and custom PBR/shader materials in TypeScript, register the
resulting parentless `Object3D`, then reference its asset ID. See
`iwsdk-build-model`.

## Nodes And Content

Every node has a stable `id` and may contain `name`, `content`, `transform`,
`constraints`, `components`, `metadata`, `framingRole`, and `children`.

Supported content kinds are:

### Group

```json
{ "id": "furniture", "content": { "type": "group" }, "children": [] }
```

A group has no visible surface. It cannot prove presence, silhouette, support, or
framing by itself.

### Asset

```json
{
  "id": "table",
  "content": {
    "type": "asset",
    "asset": "round-side-table",
    "castShadow": true,
    "receiveShadow": false
  }
}
```

Shadow flags default to false. Opt in only where the shadow contributes to the scene.

### Prefab Instance

```json
{
  "id": "left-chair",
  "content": {
    "type": "instance",
    "prefab": "chair-with-cushion",
    "overrides": {
      "cushion": {
        "transform": { "position": [0, 0.03, 0] },
        "visible": true
      }
    }
  }
}
```

Overrides may adjust transforms, visibility, and component payloads. They cannot
change geometry or materials.

### Pattern

```json
{
  "id": "books",
  "content": {
    "type": "pattern",
    "prefab": "book",
    "distribution": {
      "type": "linear",
      "count": 12,
      "step": [0.065, 0, 0]
    }
  }
}
```

Supported distributions are capability-defined and normally include `linear`,
`grid`, `radial`, `along-path`, `scatter`, and `explicit`. Scatter uses an explicit
seed and algorithm. Use `collision: "allow"` or `"skip"` deliberately.

### Light

Lights are ECS components on otherwise ordinary scene nodes. The node transform
positions the light; directional, spot, and rectangular area lights emit along
the node's local `-Z` axis.

```json
{
  "id": "key-light",
  "transform": {
    "position": [2, 4, 3],
    "rotationDeg": [55, -45, 0]
  },
  "components": {
    "com.iwsdk.components.DirectionalLight": {
      "color": [1, 0.897, 0.738, 1],
      "intensity": 2.2,
      "castShadow": true,
      "shadowMapSize": "1024"
    }
  }
}
```

The built-in component IDs are `AmbientLight`, `HemisphereLight`,
`DirectionalLight`, `PointLight`, `SpotLight`, and `RectAreaLight`, each under
the `com.iwsdk.components` namespace. Component colors are linear RGBA arrays.
Use root IBL for general PBR response and authored lights for composition.

Structural objects are closed, so an unknown field fails validation. The exact
fields are:

| Component | Fields |
| --- | --- |
| `AmbientLight` | `color`, `intensity` |
| `HemisphereLight` | `skyColor`, `groundColor`, `intensity` |
| `DirectionalLight` | `color`, `intensity`, `shadowCameraSize`, + shadow set |
| `PointLight` | `color`, `intensity` (candela), `distance`, `decay`, + shadow set |
| `SpotLight` | `color`, `intensity` (candela), `distance`, `decay`, `angleDeg`, `penumbra`, + shadow set |
| `RectAreaLight` | `color`, `intensity` (nit), `width`, `height` — no shadows |

The shadow set is `castShadow`, `shadowMapSize` (enum string `"256"`, `"512"`,
`"1024"`, `"2048"`), `shadowBias`, `shadowNormalBias`, `shadowRadius`,
`shadowCameraNear`, `shadowCameraFar`. `AmbientLight` and `HemisphereLight`
ignore the node transform.

## Prefabs And Patterns

Prefabs are the only scene-local resource:

```json
{
  "resources": {
    "prefabs": [
      {
        "id": "book",
        "root": {
          "id": "book-root",
          "content": { "type": "asset", "asset": "hardcover-book" }
        }
      },
      {
        "id": "chair-with-cushion",
        "root": {
          "id": "chair-root",
          "content": { "type": "asset", "asset": "reading-chair" },
          "children": [
            {
              "id": "cushion",
              "content": { "type": "asset", "asset": "chair-cushion" }
            }
          ]
        }
      }
    ]
  }
}
```

Prefab node IDs are local until instantiated. Runtime IDs are derived
deterministically. Do not author IDs that collide with derived paths such as
`chairs/0000/book-root`.

A pattern may become one `InstancedMesh` when its prefab resolves to one eligible
mesh. Component-bearing or compound prefabs expand to distinct cloned hierarchies.

## Authoring-Only Imports

```json
{
  "imports": [
    {
      "id": "nook",
      "src": "./modules/nook.iwsdk.scene.json",
      "transform": { "position": [2, 0, -1] }
    }
  ]
}
```

Each imported file must be a valid standalone v1 scene. Imports are permitted only in
scratch composition documents rendered by authoring tools; the editable final scene
and application runtime reject them. Imports resolve recursively in declaration order.
Node and prefab IDs are namespaced as
`<import-id>/<local-id>`. Asset and component IDs remain unchanged and
application-global.

The import entry becomes a group wrapper carrying the import transform. The root owns
top-level components, environment, metadata, and authoring globals; module globals do
not override them. Once the composition passes, flatten and make the generated
import-free document the sole source of truth. Never re-flatten over later editor
changes.

Use `scene_flatten_file` or `npx @iwsdk/cli scene flatten` to materialize the final
document. The command resolves the import graph, preserves wrapper transforms,
validates the flat output, writes atomically, and refuses the write if flattening
changes runtime semantics.

Verify the flatten preserved semantics by comparing `runtimeHash` before and
after — they must be identical. Note that only `authoring` and `imports` are
stripped from the runtime projection, so writing provenance into `metadata`
changes the hash and defeats this check.

## Components And Constraints

Component keys use their registered IWSDK IDs. Values are the component's raw props:

```json
{
  "components": {
    "com.iwsdk.components.Visibility": {
      "isVisible": true
    }
  }
}
```

Scene files never embed component schemas. Declare application components in a
system-free module, export a manifest with `defineComponents`, and give that same
manifest to the runtime and Vite plugin:

```ts
// src/components.ts
import { defineComponents } from '@iwsdk/core';
import { ReadingState } from './components/reading-state.js';

export default defineComponents([ReadingState]);
```

```ts
// iwsdk.config.json points components.module at ./src/components
// runtime and editor both consume virtual:iwsdk-project
import projectOptions from 'virtual:iwsdk-project';
World.create(container, projectOptions);
```

The editor and runtime independently import the same manifest and derive validation
and inspector metadata from the executable component declarations. Component IDs must
be unique across IWSDK and the application. Keep declaration modules free of system,
DOM, renderer, and world side effects; systems may import those declarations.

Transforms use `[x, y, z]` tuples, degrees, and positive scalar or vector scale.
The optional `lookAt` constraint resolves yaw deterministically during lowering:

```json
{
  "constraints": {
    "lookAt": { "mode": "yaw-v1", "target": [0, 1.2, 0] }
  }
}
```

Author spatial relationships directly through node transforms. The schema does not
infer support, floor contact, or other physical-placement semantics.

## Authoring And Review

Use `authoring.composition` as a fixed brief, not a process transcript:

```json
{
  "authoring": {
    "composition": {
      "mode": "static",
      "input": {
        "kind": "hybrid",
        "prompt": "A courtyard reading nook",
        "references": []
      },
      "target": {
        "surfaces": ["browser", "vr"],
        "style": "stylized-pbr",
        "assetPolicy": "manifest-assets"
      },
      "feasibility": { "status": "supported" },
      "provenance": {
        "adapter": { "id": "hybrid-intake", "version": "1.0.0" },
        "skill": { "id": "iwsdk-compose-scene", "version": "1.0.0" },
        "capabilityHash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "inputHashes": []
      },
      "representationPolicy": {
        "fidelityCeiling": "stylized-static",
        "allowed": ["asset", "prefab", "pattern"]
      },
      "features": [],
      "assumptions": [],
      "review": {
        "heroView": "hero",
        "requiredViews": ["hero", "top", "quarter"],
        "lenses": ["layout", "geometry", "final"],
        "maxCorrectionRounds": 2
      }
    },
    "views": []
  }
}
```

`inputHashes` is the exact unique set of the prompt SHA-256, when present, plus every
declared reference digest with a `sha256:` prefix. Changing prompt whitespace changes
identity.

Every required feature needs implementation node bindings and immutable acceptance
criteria. Supported kinds normally include presence, count, projected-region,
spatial-relation, and visual-judgment.

Use `capture-node-mask-bounds-v1` for projected region evidence of manifest assets.
Their arbitrary external geometry cannot be proven from a JSON world-AABB assumption.

Authoring views contain exact projection parameters. Perspective views use position,
target, and FOV. Orthographic views use position, target, and height. Pass a saved
`viewId` to camera or screenshot tools rather than approximating it with a preset.
The separate `view` field accepts only built-in preset names. Outside immersive XR,
the runtime applies the scene's hero view after level initialization, so adjust that
authored view when editor and browser framing need to stay in parity; an initial
`World.create` camera is not an override for a scene-owned camera. In XR the tracked
player rig owns the camera, so separately inspect framing from the authored player
spawn.

```json
{
  "authoring": {
    "views": [
      {
        "id": "hero",
        "role": "hero",
        "projection": "perspective",
        "position": [0, 1.6, 4.5],
        "target": [0, 1.4, 0],
        "fov": 42
      },
      {
        "id": "top",
        "role": "diagnostic",
        "projection": "orthographic",
        "position": [0, 8, 0],
        "target": [0, 0, 0],
        "height": 8
      }
    ]
  }
}
```

`nodeAnnotations` bind actual nodes to layout, geometry, or final review layers.
Unannotated renderables default to layout; descendants inherit the nearest annotation.

Every node may set `framingRole` to `content` or `support`. Use support only for
rendered infrastructure such as an oversized floor or backdrop. Requested subjects
must remain content.

## Validation Traps

- Do not put `assets` or `materials` under `resources`.
- Do not emit model, primitive, geometry, material, or material override fields.
- Do not assume that a file in `public/` is registered; check `src/assets.ts`.
- Do not use a group as the only binding for a required visible feature.
- Do not namespace manifest asset IDs inside imported modules.
- Do not open or load an import-bearing composition as the editable/runtime scene;
  flatten it first.
- Do not author duplicate or derived runtime IDs.
- Do not use non-finite transforms, unsafe paths, or unknown
  component fields.
- Do not claim projected AABB silhouette evidence for arbitrary manifest assets; use
  trusted capture node masks.
- Do not save over unsaved human editor changes. Resolve the reported conflict first.
