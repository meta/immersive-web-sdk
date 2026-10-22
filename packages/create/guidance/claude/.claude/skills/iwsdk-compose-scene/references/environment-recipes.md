# Environment Recipes

Copy-paste environment setups built only from built-in components. Merge the
root `components`, the `environment` block and the node `components` into the
scene; keep your own asset nodes. Every field, with its default and limits, is
in the `componentSchemas` of `scene_get_capabilities` with `full: true` (CLI:
`npx @iwsdk/cli scene capabilities --input-json '{"full":true}' --raw`), and the
editor shows each one with a label and limits.

## Clay Studio

The VR and Desktop 3D starter's look: a pale lavender-to-bone sky tilted toward
the front left, a floor that fades into it with no visible edge, soft image-based
light and a warm key light with soft shadows.

```json
{
  "components": {
    "com.iwsdk.components.DomeGradient": {
      "sky": [0.843, 0.796, 0.882, 1],
      "equator": [0.808, 0.855, 0.91, 1],
      "ground": [0.902, 0.855, 0.82, 1],
      "elevationDeg": 24,
      "azimuthDeg": -31,
      "dither": true
    },
    "com.iwsdk.components.IBLGradient": {
      "sky": [0.72, 0.7, 0.8, 1],
      "equator": [0.78, 0.78, 0.84, 1],
      "ground": [0.5, 0.52, 0.58, 1],
      "intensity": 0.2025
    }
  },
  "environment": {
    "toneMapping": "aces",
    "exposure": 1.2,
    "shadows": true,
    "shadowMapType": "pcf"
  },
  "nodes": [
    {
      "id": "studio-floor",
      "content": {
        "type": "asset",
        "asset": "studio-floor",
        "receiveShadow": true
      },
      "components": {
        "LocomotionEnvironment": {},
        "DomeFade": { "start": 4, "end": 10 }
      }
    },
    {
      "id": "key-light",
      "transform": {
        "position": [-2.3541, 11.2763, 1.762],
        "rotationDeg": [-73.3982, -11.3134, 0]
      },
      "components": {
        "DirectionalLight": {
          "color": [1, 0.945, 0.87, 1],
          "intensity": 2.3,
          "castShadow": true,
          "shadowMapSize": "2048",
          "shadowCameraSize": 8,
          "shadowCameraNear": 2,
          "shadowCameraFar": 24,
          "shadowRadius": 7,
          "shadowBias": -0.0004,
          "shadowNormalBias": 0.02
        }
      }
    },
    {
      "id": "fill-light",
      "components": {
        "HemisphereLight": {
          "skyColor": [0.78, 0.83, 0.96, 1],
          "groundColor": [0.592, 0.608, 0.651, 1],
          "intensity": 1.15
        }
      }
    }
  ]
}
```

- `elevationDeg` and `azimuthDeg` tilt the sky pole; `dither` removes banding in
  the pale gradient, and the faded floor dithers with it.
- `DomeFade` goes on the floor node itself. Its meshes blend into the live sky
  between 4 m and 10 m from the node origin; it does nothing without the
  `DomeGradient`.
- Put a `ContactShadow` on each object that stands on the floor, or on a
  component-only child node at its foot, sized a little wider than the
  footprint.
- `IBLGradient` applies `intensity` once: 0.2025 here is 0.45 in a 1.0.x scene.

The starter grounds its pieces with these component-only child nodes, each
with just `transform.position` and `components.ContactShadow`: `size`, and
`height` where the blob sits lower than the 2 mm default. A round blob's
`height` is 2 mm times its width, so small blobs sit close to the surface and an
object's foot meets its blob without a gap.

| Node                    | Parent          | `position`              | `ContactShadow.size` | `ContactShadow.height` |
| ----------------------- | --------------- | ----------------------- | -------------------- | ---------------------- |
| `grab-plinth-contact`   | `grab-plinth`   | `[0, 0.002, 0]`         | `[0.8, 0.8]`         | `0.0016`               |
| `select-plinth-contact` | `select-plinth` | `[0, 0.002, 0]`         | `[0.8, 0.8]`         | `0.0016`               |
| `spin-plinth-contact`   | `spin-plinth`   | `[0, 0.002, 0]`         | `[0.8, 0.8]`         | `0.0016`               |
| `graphite-cube-contact` | `grab-plinth`   | `[-0.25, 0.921, -0.03]` | `[0.26, 0.26]`       | `0.00052`              |
| `graphite-gem-contact`  | `grab-plinth`   | `[0, 0.921, -0.03]`     | `[0.24, 0.24]`       | `0.00048`              |
| `graphite-knot-contact` | `grab-plinth`   | `[0.25, 0.921, -0.03]`  | `[0.26, 0.26]`       | `0.00052`              |
| `robot-contact`         | `select-plinth` | `[0, 0.921, -0.02]`     | `[0.37, 0.37]`       | `0.00074`              |
| `graphite-ring-contact` | `spin-plinth`   | `[0, 0.921, -0.02]`     | `[0.4, 0.4]`         | `0.0008`               |
| `gallery-set-contact`   | `gallery-set`   | `[0, 0.002, 0]`         | `[1.9, 1]`           | default                |
| `gallery-vase-contact`  | `gallery-set`   | `[-0.95, 0.002, -0.15]` | `[0.55, 0.55]`       | `0.0011`               |
| `sideboard-set-contact` | `sideboard-set` | `[0, 0.002, 0]`         | `[2.3, 0.9]`         | default                |
| `floor-lamp-contact`    | `sideboard-set` | `[1.1, 0.002, -0.08]`   | `[0.45, 0.45]`       | `0.0009`               |

## Default Sky

A neutral daylight sky and matching image-based light, as the components'
defaults. Add a `DomeFade` to the floor node so the floor has no visible edge.

```json
{
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
  }
}
```

## AR Passthrough

No sky, so passthrough stays visible; image-based light for the content, and a
shadow-only floor plus blobs to ground it. This is the AR starter's setup.

```json
{
  "components": {
    "com.iwsdk.components.IBLGradient": {
      "sky": [0.96, 0.94, 0.9, 1],
      "equator": [0.8, 0.76, 0.7, 1],
      "ground": [0.46, 0.42, 0.38, 1],
      "intensity": 0.25
    }
  },
  "environment": {
    "toneMapping": "aces",
    "exposure": 1,
    "shadows": true,
    "shadowMapType": "pcf"
  },
  "nodes": [
    {
      "id": "shadow-catcher",
      "framingRole": "support",
      "transform": { "position": [0, 0.001, -1.35] },
      "components": { "ShadowCatcher": { "size": [6, 6], "opacity": 0.25 } }
    },
    {
      "id": "plinth",
      "content": { "type": "asset", "asset": "plinth", "castShadow": true },
      "transform": { "position": [0, 0, -1.5] },
      "components": {
        "ContactShadow": {
          "size": [0.8, 0.8],
          "opacity": 0.4,
          "color": [0, 0, 0, 1]
        }
      }
    },
    {
      "id": "key-light",
      "transform": {
        "position": [-2.3541, 11.2763, 1.762],
        "rotationDeg": [-73.3982, -11.3134, 0]
      },
      "components": {
        "DirectionalLight": {
          "color": [1, 0.945, 0.87, 1],
          "intensity": 2,
          "castShadow": true,
          "shadowMapSize": "1024",
          "shadowCameraSize": 6,
          "shadowCameraNear": 2,
          "shadowCameraFar": 24,
          "shadowRadius": 5,
          "shadowBias": -0.0004,
          "shadowNormalBias": 0.02
        }
      }
    },
    {
      "id": "fill-light",
      "components": {
        "HemisphereLight": {
          "skyColor": [0.96, 0.94, 0.9, 1],
          "groundColor": [0.55, 0.52, 0.48, 1],
          "intensity": 1
        }
      }
    }
  ]
}
```

The AR starter grounds its stations with the first eight contact nodes of the
Clay Studio table (the plinths and the pieces on them, with the same parents,
positions, sizes and heights), each tinted like the plinth above.

- Leave out `DomeGradient` and `DomeTexture` for AR. The runtime hides them in
  an AR session anyway, so they only change the editor and desktop preview,
  which then show a sky the headset never does.
- `ShadowCatcher` shows shadows only with `environment.shadows`, a light with
  `castShadow` and `castShadow` content above it. A `ContactShadow` needs none
  of that.
- Tint `ContactShadow` black for AR, at a lower opacity than the 0.72 default:
  `"opacity": 0.4, "color": [0, 0, 0, 1]`. The default blue-grey lightens
  anything darker than itself, so over a dark room, or the near-black page the
  editor and the managed browser show behind the desktop preview, the blob
  glows. Black only darkens, so it reads as a shadow on light floors, dark
  floors and passthrough alike; at 0.4 it is about as dark on a light floor as
  the default blob.
