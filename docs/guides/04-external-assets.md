---
outline: [2, 4]
---

# Chapter 4: External Assets

While primitive shapes are useful for learning, real WebXR applications use external assets like 3D models, textures, and audio files. In this chapter, you'll learn how to load and use external assets efficiently in IWSDK. By the end, you'll be able to load GLTF models and apply textures to create professional-looking scenes.

## Why External Assets Matter

External assets transform your WebXR experience from basic geometric shapes to rich, detailed environments:

- **3D Models**: Detailed objects created in tools like Blender, Maya, or downloaded from asset stores
- **Textures**: Images that provide surface detail, color, and material properties
- **Audio**: Sound effects and ambient audio for immersion
- **HDR Images**: Environment maps for realistic lighting and reflections

## IWSDK's AssetManager

IWSDK includes a powerful AssetManager that handles loading, caching, and optimization of external assets. It provides several key benefits:

- **Preloading**: Load assets during application initialization for smooth experiences
- **Caching**: Avoid reloading the same asset multiple times
- **Loading Priorities**: Control whether assets are critical (blocking) or background (non-blocking)
- **Static Access**: Simple API to retrieve loaded assets anywhere in your code

### Asset Loading Priorities

IWSDK supports three loading priorities to optimize performance:

1. **Critical**: Load before the application starts - **blocks World.create() until loaded**
2. **Background**: Load early but don't block initialization - **prevents runtime loading hiccups**
3. **Lazy**: Register the asset without fetching it; scene placement or an
   explicit by-ID load fetches it on first use

**Choose your loading strategy carefully:**

- **Critical priority**: Only for assets essential to your app's core experience (like main characters, UI elements, core environment pieces). The `World.create()` promise won't resolve until all critical assets are loaded, so use sparingly.

- **Background priority**: For assets you know you'll need but that shouldn't block startup (decorative objects, optional audio, extra textures). These start loading immediately after critical assets finish, so they're cached and ready when you need them - avoiding stutters caused by loading during runtime.

- **Lazy priority**: For the complete authoring catalog when only the active
  scene needs a subset. Concurrent first use is deduplicated.

- **Runtime loading**: For user-specific or conditional content that may never be needed. Load these on-demand using `AssetManager.loadGLTF()` or similar methods.

Every asset request has a finite 30-second load timeout. A critical failure
rejects `World.create()` with an `AssetLoadError` that identifies the asset ID,
URL, and underlying cause. A background failure logs that same structured
error without stopping world creation. Lazy and explicit loads reject their
caller, so application code can decide whether to retry or substitute a
fallback.

## Setting Up Asset Loading

Assets live in the module selected by `iwsdk.config.json`. The runtime and
editor import the exact same catalog.

### Asset Manifest Structure

A catalog in `src/assets.ts` maps each asset ID to its URL, type and loading
priority. For example:

```typescript
import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\/+/u, '')}`;

export default defineAssets({
  robot: {
    url: publicAssetUrl('gltf/robot/robot.gltf'),
    type: AssetType.GLTF,
    priority: 'lazy',
  },
  'welcome-panel': {
    url: publicAssetUrl('ui/welcome.uikitml'),
    type: AssetType.UIKitML,
    priority: 'critical',
  },
  chimeSound: {
    url: publicAssetUrl('audio/chime.mp3'),
    type: AssetType.Audio,
    priority: 'background',
  },
});
```

Select it in `iwsdk.config.json`:

```json
{
  "version": "iwsdk.project.v1",
  "scene": "./public/scenes/main.iwsdk.scene.json",
  "assets": { "module": "./src/assets" },
  "world": { "xr": { "mode": "vr" } }
}
```

Then use the virtual project options in application code:

```typescript
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

World.create(document.getElementById('scene-container'), projectOptions).then(
  (world) => {
    // Assets are now loaded and available via AssetManager
  },
);
```

### Supported Asset Types

IWSDK supports these asset types:

- **`AssetType.GLTF`**: 3D models in GLB or GLTF format
- **`AssetType.Texture`**: Images for materials (JPG, PNG, WebP)
- **`AssetType.HDRTexture`**: HDR environment maps (HDR format)
- **`AssetType.Audio`**: Audio files (MP3, WAV, OGG)
- **`AssetType.UIKitML`**: Runtime-parsed spatial UI documents

::: tip Asset Organization
Place your assets in the `public/` directory of your project. Common patterns:

- `/gltf/` for 3D models
- `/textures/` for images
- `/audio/` for sound files
- `/hdr/` for environment maps
  :::

## Loading and Using GLTF Models

GLTF (GL Transmission Format) is the standard format for 3D models in WebXR. Here's how to load and use them:

### Basic GLTF Loading

Add your GLTF to the asset manifest, then access it using `AssetManager.getGLTF()`:

```javascript
import { AssetManager } from '@iwsdk/core';

// In your asset manifest
const assets = {
  myRobot: {
    url: publicAssetUrl('gltf/robot.glb'),
    type: AssetType.GLTF,
    priority: 'critical',
  },
};

// After World.create()
World.create(/* ... */).then((world) => {
  // Get the loaded GLTF
  const { scene: robotMesh } = AssetManager.getGLTF('myRobot');

  // Position and scale the mesh
  robotMesh.position.set(0, 1, -3);
  robotMesh.scale.setScalar(0.5);

  // Create a transform entity from the mesh
  const robotEntity = world.createTransformEntity(robotMesh);
});
```

### Why GLTF?

GLTF is currently the only official 3D model format supported by IWSDK. We chose GLTF because it's specifically designed for web and real-time 3D applications:

- **Web-optimized**: Efficient loading and parsing in browsers
- **Compact**: Binary GLB format reduces file sizes significantly
- **Complete**: Supports geometry, materials, textures, animations, and lighting in one format
- **Industry standard**: Backed by Khronos Group and supported by all major 3D tools
- **WebXR ready**: Perfect format for immersive web experiences

If you're working with other 3D formats like FBX, OBJ, or 3DS Max files, convert
them with [Blender](https://www.blender.org): **File → Import** the source file,
then **File → Export → glTF 2.0** and choose GLB or GLTF. Add the converted file,
not the source FBX/OBJ, to the IWSDK asset manifest.

::: tip GLTF Optimization

- **Use GLB format** for smaller file sizes (binary is more compact than JSON)
- **Optimize geometry** in your 3D software by removing unnecessary vertices and combining meshes where possible
- **Keep polygon counts reasonable** - aim for game-ready models rather than high-poly renders
  :::

## Working with Textures

Textures add surface detail to your 3D objects. Here's how to load and apply them:

### Basic Texture Loading

```javascript
import {
  MeshBasicMaterial,
  PlaneGeometry,
  Mesh,
  SRGBColorSpace,
} from '@iwsdk/core';

// In your asset manifest, with your image saved as public/textures/webxr.png
const assets = {
  webxr: {
    url: publicAssetUrl('textures/webxr.png'),
    type: AssetType.Texture,
    priority: 'critical',
  },
};

// After World.create()
World.create(/* ... */).then((world) => {
  // Get the loaded texture
  // Because of the "critical" loading strategy, we can be sure it's available here
  const webxrTexture = AssetManager.getTexture('webxr');

  // Set proper color space for the texture
  webxrTexture.colorSpace = SRGBColorSpace;

  // Create a material using the texture
  const logoMaterial = new MeshBasicMaterial({
    map: webxrTexture,
    transparent: true, // PNG with transparency
  });

  // Create a plane to display the WebXR logo
  const logoGeometry = new PlaneGeometry(1.13, 0.32);
  const logoPlane = new Mesh(logoGeometry, logoMaterial);
  logoPlane.position.set(0, 1.8, -1.9);

  // Create transform entity
  const logoEntity = world.createTransformEntity(logoPlane);
});
```

::: tip Texture Optimization

- **Choose the right format**: Use JPG for photos/realistic textures, PNG for images with transparency
- **Use power-of-2 dimensions**: 512×512, 1024×1024, 2048×2048 - these load and render more efficiently
- **Keep file sizes reasonable**: Large textures can significantly impact loading times and performance
  :::

::: tip Asset Availability
Use `if` checks when accessing assets with 'background' priority, as they might still be loading when your code runs. Critical assets are guaranteed to be available.
:::

## Runtime Asset Loading

You can also load assets dynamically after the app starts:

```javascript
// Load an asset at runtime
AssetManager.loadGLTF(publicAssetUrl('gltf/dynamic-object.glb'), 'dynamicModel')
  .then(() => {
    const { scene: dynamicMesh } = AssetManager.getGLTF('dynamicModel');
    dynamicMesh.position.set(0, 2, -3);
    const entity = world.createTransformEntity(dynamicMesh);
  })
  .catch((error) => {
    console.error('Failed to load dynamic asset:', error);
  });
```

## Remote Stock Assets And Local Mirrors

Read-only stock models are available from the verified immutable
`@iwsdk/example-assets@0.4.2` package. Pin that exact version; do not use
`latest` or a semver range. Keep the base URL in one place so asset IDs and
scene files do not change when an application needs to localize the bytes:

```typescript
const configuredStockAssetBase =
  import.meta.env.VITE_IWSDK_EXAMPLE_ASSET_BASE_URL?.trim();
const stockAssetBase = (
  configuredStockAssetBase ||
  'https://cdn.jsdelivr.net/npm/@iwsdk/example-assets@0.4.2/assets'
).replace(/\/+$/u, '');

const stockAssetUrl = (assetId: string, fileName: string) =>
  `${stockAssetBase}/${assetId}/${fileName}`;
```

For an offline or first-party deployment, download the same exact package
version, copy its complete `assets/` directory—including every texture and
buffer referenced by each glTF—under your own public directory, then set:

```dotenv
VITE_IWSDK_EXAMPLE_ASSET_BASE_URL=/vendor/iwsdk-assets
```

The localized directory must preserve `assets/<asset-id>/<file>` layout. Run a
production build and test it with the network disabled; loading only the entry
`.gltf` file is insufficient because its relative resources are fetched
separately. Keep the mirror under the app's public directory so it is served
from the same origin. Do not point this setting at Vite's `/@fs/` escape hatch:
paths outside the workspace are rejected by its filesystem allow-list, and a
separate HTTP server also needs explicit CORS headers (and HTTPS when the app is
HTTPS). Production applications should own or mirror every critical asset
rather than depending on a sample CDN's availability.

IWSDK repository tests override the base URL with a server backed by the exact
packed bytes for deterministic offline coverage. The named CDN release check
separately validates the public package's CORS, MIME types, hashes, relative
glTF resources, and browser loading.

## What's Next

Excellent work! You now know how to work with external assets to create rich, detailed WebXR experiences. In Chapter 5, we'll focus on making your scenes look professional by adding proper environment and lighting.

You'll learn how to:

- Use Dome components for beautiful skyboxes and backgrounds
- Set up IBL (Image-Based Lighting) for realistic reflections and ambient lighting
- Configure environment maps and their effects on materials
- Create visually stunning scenes with minimal code changes
