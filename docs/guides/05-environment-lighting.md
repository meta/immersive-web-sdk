---
outline: [2, 4]
---

# Chapter 5: Environment & Lighting

Now that you can create objects and load external assets, it's time to make your WebXR experience look professional with environment and lighting. This chapter introduces **Components and Systems** - the building blocks of IWSDK's architecture - while showing you how to create beautiful, realistic lighting for your scenes.

## ECS Refresher: Components and Systems

You've been working with **entities** since Chapter 3 using `world.createTransformEntity()`. Now you'll use **components and systems** for the first time.

**Components** are data you attach to entities (like "this entity has lighting" or "this entity is grabbable"). **Systems** automatically handle entities with specific components (like "apply lighting to all lit entities").

The pattern is simple: add components to entities, let systems handle the behavior automatically.

::: tip Learn More About ECS
For a comprehensive understanding of IWSDK's Entity Component System architecture, see [ECS Concepts](/concepts/ecs/index.md).
:::

## Why Environment and Lighting Matter

Good lighting transforms your scene from looking like a technical demo to a professional, polished VR experience. Proper environment setup provides realistic reflections, ambient lighting, and atmospheric depth that makes materials look convincing.

## Setup Lighting

IWSDK uses **Image-Based Lighting (IBL)** as its primary environment-lighting
approach. This provides realistic lighting by using environment images to
illuminate your entire scene, creating natural-looking reflections and ambient
lighting that makes materials appear convincing.

Environment lighting components get attached to the **level root entity** - think of it as the main container for your scene:

```javascript
const levelRoot = world.activeLevel.value;
```

### IBL Lighting Options

**Built-in Room Environment** (easiest option):

```javascript
const levelRoot = world.activeLevel.value;

levelRoot.addComponent(IBLTexture, {
  src: 'room', // Built-in room environment
  intensity: 1.2, // Slightly brighter than default
});
```

**Custom HDR Lighting** (for specific moods):

```javascript
// Add HDR to your asset manifest
const assets = {
  sunsetHDR: {
    url: '/hdr/sunset_4k.hdr',
    type: AssetType.HDRTexture,
    priority: 'critical',
  },
};

// Use it for lighting
levelRoot.addComponent(IBLTexture, {
  src: 'sunsetHDR', // Reference your asset
  intensity: 0.9, // Lighting strength
  rotation: [0, Math.PI / 4, 0], // Rotate lighting direction
});
```

**Gradient-based Lighting** (for stylized scenes):

```javascript
levelRoot.addComponent(IBLGradient, {
  sky: [1.0, 0.9, 0.7, 1.0], // Warm sky light
  equator: [0.7, 0.7, 0.9, 1.0], // Cool horizon
  ground: [0.2, 0.2, 0.2, 1.0], // Dark ground reflection
  intensity: 1.0,
});
```

`IBLGradient` applies `intensity` once, as `scene.environmentIntensity`.
IWSDK 1.0.x applied it twice (to the gradient colors and again to the
environment intensity), so an old `intensity: 0.45` lit the scene like 0.2025.
To keep a 1.0.x look, square the old value: `0.45` becomes `0.2025`. A value of
1 looks the same in both versions, and `intensity: 0` turns the lighting off.

### How Environment Affects Materials

Environment lighting dramatically improves how materials look by providing realistic reflections and ambient lighting. The materials you created in previous chapters will automatically look much better with proper environment setup.

**Key material properties that respond to environment:**

- **Metalness**: Higher values reflect environment more (chrome, gold)
- **Roughness**: Lower values create sharper reflections (mirrors, polished surfaces)
- **Color**: Tints the reflected environment to create different metal types

The Three.js materials you're already using (`MeshStandardMaterial`) automatically work with IBL - no code changes needed!

### Traditional Light Sources

IWSDK supports authored ambient, hemisphere, directional, point, spot, and
rect-area light components. Add them to scene nodes in the editor or in native
scene JSON:

```json
{
  "id": "key-light",
  "transform": { "rotationDeg": [-35, 25, 0] },
  "components": {
    "DirectionalLight": {
      "color": [1, 0.95, 0.88, 1],
      "intensity": 3,
      "castShadow": true
    }
  }
}
```

Environment setup is fully explicit: if the level root has no
`DomeGradient`/`DomeTexture`, IWSDK renders no authored background; if it has
no `IBLGradient`/`IBLTexture`, IWSDK supplies no image-based lighting. Starter
scenes include both gradient components, and you can remove either one
independently.

## Setup Background

In real life, our background environment determines the lighting. However, in 3D graphics, these are two completely separate concepts:

- **Lighting** determines how materials render in the scene, providing reflections and illumination, but has no actual visual representation itself
- **Background** functions purely as a backdrop that you see behind objects, and does not affect how objects are rendered at all

While it's good practice to match your background to your environment lighting for visual coherence, you have complete flexibility to use them independently. You might use a sunset HDR for lighting while having a plain gradient background, or vice versa.

Background components attach to the level root entity, just like lighting components.

### Gradient Backgrounds

For clean, stylized scenes:

```javascript
const levelRoot = world.activeLevel.value;

levelRoot.addComponent(DomeGradient, {
  sky: [0.53, 0.81, 0.92, 1.0], // Light blue sky
  equator: [0.91, 0.76, 0.65, 1.0], // Warm horizon
  ground: [0.32, 0.32, 0.32, 1.0], // Dark ground
  intensity: 1.0,
});
```

The dome blends three colors along a **sky pole**: `sky` at the pole,
`equator` on the circle 90° away from it, and `ground` directly opposite.
`intensity` multiplies all three; `0` renders black and values above 1 clip.

**Tilting the sky.** By default the pole points straight up, which is a classic
horizon sky. `elevationDeg` (-90 to 90) lowers the pole toward the horizon and
`azimuthDeg` (-180 to 180) turns it, using the same convention as a scene
node's Y rotation: `0` faces forward (-Z), `90` faces left (-X) and `-90` faces
right (+X). Azimuth has no effect at elevation ±90. For example, a soft studio
backdrop whose bright end sits up and ahead to the right:

```json
"DomeGradient": {
  "sky": [0.843, 0.796, 0.882, 1],
  "equator": [0.808, 0.855, 0.91, 1],
  "ground": [0.902, 0.855, 0.82, 1],
  "elevationDeg": 24,
  "azimuthDeg": -31,
  "dither": true
}
```

Here the pole is 24° above the horizon and 31° to the right of forward, so the
lavender `sky` color is brightest up and ahead right, and the warm `ground`
color fills the view behind and below.

**Dither.** Pale, low-contrast gradients can show 8-bit bands. `dither: true`
adds ±0.5/255 of screen noise that hides them. It is off by default, so
existing scenes render the same pixels.

**Color meanings.** `DomeGradient` colors are display colors: they appear on
screen exactly as authored and are never tone-mapped. `IBLGradient` colors are
not display colors; they describe the light the environment casts, so the same
numbers do not look the same in both components. Light component colors
(`DirectionalLight`, `PointLight` and the rest) are sRGB.

**Live edits.** `DomeGradient` and `IBLGradient` apply edits on the next frame,
so `entity.setValue(DomeGradient, 'elevationDeg', 30)` or `ecs_set_component`
works without `_needsUpdate`. Setting `_needsUpdate` still forces a refresh.
`DomeTexture` and `IBLTexture` still need `_needsUpdate: true` after an edit.

**AR.** In an AR session (`alpha-blend` or `additive`) IWSDK hides the dome so
passthrough shows behind your content, and restores it when the session ends.
`IBLGradient` lighting stays on in AR.

`DomeGradient`'s new fields need `@iwsdk/core` 1.1.0. Scene validation rejects
fields it does not know, so a scene that uses them fails to load on 1.0.x.

### Fade a Floor into the Sky

A floor that ends at a hard edge in front of the sky breaks the illusion of an
endless stage. Add `DomeFade` to the floor node, not the level root, and its
meshes blend into the `DomeGradient` sky behind them with horizontal distance
from the node's origin:

```json
{
  "id": "floor",
  "content": { "type": "asset", "asset": "floor" },
  "components": {
    "DomeFade": { "start": 4, "end": 10 }
  }
}
```

Up to `start` meters from the node's origin the floor looks as authored; at
`end` meters and beyond it shows only the sky (`start` must be less than
`end`). Each faded pixel samples the live sky in the direction from the camera,
so the floor and the sky agree from every position, follow edits to the
`DomeGradient` (including its tilt), and share its `dither`.

- **Needs a DomeGradient.** Without a visible `DomeGradient` on the level root,
  or while a `DomeTexture` is the background, the floor renders as authored and
  keeps its edge. Render stats (`iwsdk scene render-stats`) report each fade's
  `inactiveReason` in `sceneEnvironment.domeFades`.
- **AR.** The faded meshes hide with the sky during AR passthrough. Child nodes
  of the floor, and anything else on it, stay visible. Without a
  `DomeGradient`, DomeFade leaves the meshes visible in AR too.
- **Materials.** `MeshBasicMaterial`, `MeshLambertMaterial`,
  `MeshPhongMaterial`, `MeshStandardMaterial`, `MeshPhysicalMaterial` and
  `MeshToonMaterial` fade. Other materials (shader, shadow, points and line
  materials) are left as they are and counted as `skippedMaterials`. IWSDK
  fades a per-node copy of each material, so other objects that share it are
  not affected.
- **Cost.** DomeFade checks the node's own meshes once per frame and fades
  only that node's content, not child nodes. Use it on floors and terrain
  rather than on large subtrees; render stats report its `meshCount`.

### HDR Image Backgrounds

For photorealistic environments:

```javascript
// Add HDR to your asset manifest
const assets = {
  studioHDR: {
    url: '/hdr/studio.hdr',
    type: AssetType.HDRTexture,
    priority: 'critical',
  },
};

// Use the loaded HDR for background
const levelRoot = world.activeLevel.value;

levelRoot.addComponent(DomeTexture, {
  src: 'studioHDR', // Reference the asset key
  intensity: 0.8,
  blurriness: 0.1, // Slight blur for softer look
});
```

::: tip Background vs Lighting

- **Background**: What you see as the skybox (`DomeTexture` or `DomeGradient`)
- **Lighting**: How objects are lit (`IBLTexture` or `IBLGradient`)
- These are independent - mix and match as needed!
  :::

## What's Next

Excellent work! Your WebXR scene now has professional environment and lighting, and you've had your first taste of IWSDK's Component System. In Chapter 6, we'll continue using components to make your scene interactive with object grabbing and manipulation.

You'll learn how to:

- Add RayInteractable and Grabbable components to objects
- Use the grab system for natural VR interactions
- Understand how systems automatically handle interaction behaviors
- Make your GLTF models and primitive objects grabbable and interactive
