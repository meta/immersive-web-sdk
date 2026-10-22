---
title: Meshes, Geometry & Materials
---

# Meshes, Geometry & Materials

Understanding how to create and work with 3D objects is fundamental to any Three.js application. This guide covers the building blocks: geometries (shapes), materials (appearance), and meshes (the combination).

## The Core Equation

Every visible 3D object follows this pattern:

```text
Mesh = Geometry + Material

Geometry: The shape (vertices, faces, UVs)
Material: The appearance (color, texture, shading)
Mesh: The renderable object that combines them
```

In IWSDK, you create these using Three.js classes and attach them to entities.

## Geometries: The Shape of Things

Geometry defines the **shape** of 3D objects using vertices, faces, and texture coordinates.

### Built-in Geometries

Three.js provides many primitive shapes:

```ts
import {
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  PlaneGeometry,
  TorusGeometry,
} from '@iwsdk/core';

// Basic shapes with parameters
const box = new BoxGeometry(1, 1, 1); // width, height, depth
const sphere = new SphereGeometry(0.5, 32, 16); // radius, widthSeg, heightSeg
const cylinder = new CylinderGeometry(0.5, 0.5, 2, 32); // radiusTop, radiusBottom, height, segments
const plane = new PlaneGeometry(2, 2); // width, height
const torus = new TorusGeometry(1, 0.3, 16, 100); // radius, tube, radialSeg, tubularSeg
```

### Custom Geometry

For complex shapes, create custom BufferGeometry:

```ts
import { BufferGeometry, BufferAttribute } from '@iwsdk/core';

// Create triangle
const geometry = new BufferGeometry();

// Define vertices (3 points in 3D space)
const vertices = new Float32Array([
  -1,
  -1,
  0, // vertex 1
  1,
  -1,
  0, // vertex 2
  0,
  1,
  0, // vertex 3
]);

// Define normals (for lighting)
const normals = new Float32Array([
  0,
  0,
  1, // normal for vertex 1
  0,
  0,
  1, // normal for vertex 2
  0,
  0,
  1, // normal for vertex 3
]);

// Define UV coordinates (for texturing)
const uvs = new Float32Array([
  0,
  0, // UV for vertex 1
  1,
  0, // UV for vertex 2
  0.5,
  1, // UV for vertex 3
]);

geometry.setAttribute('position', new BufferAttribute(vertices, 3));
geometry.setAttribute('normal', new BufferAttribute(normals, 3));
geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
```

### Reusing Geometry

```ts
// Create geometry once, reuse for multiple entities
const sharedGeometry = new BoxGeometry(1, 1, 1);

// Create multiple entities with same shape
for (let i = 0; i < 10; i++) {
  const material = new MeshStandardMaterial({
    color: Math.random() * 0xffffff,
  });
  const mesh = new Mesh(sharedGeometry, material);
  const entity = world.createTransformEntity(mesh);

  // Position each entity differently
  entity.object3D.position.set(i * 2, 0, 0);
}
```

## Materials: The Look of Things

Materials define how surfaces **look** - their color, shininess, transparency, and how they react to light.

### Material Types

**For WebXR, use physically-based materials:**

```ts
import {
  MeshStandardMaterial, // Good balance of quality and performance
  MeshPhysicalMaterial, // Advanced PBR features (clearcoat, transmission)
  MeshBasicMaterial, // Unlit (use sparingly)
} from '@iwsdk/core';

// Standard PBR material (recommended)
const pbr = new MeshStandardMaterial({
  color: 0x00ff00, // Base color (green)
  metalness: 0.1, // 0 = dielectric, 1 = metallic
  roughness: 0.7, // 0 = mirror, 1 = completely rough
});

// Advanced PBR material
const advanced = new MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.1,
  clearcoat: 1.0, // Clear coating effect
  clearcoatRoughness: 0.1,
  transmission: 0.9, // Glass-like transparency
  thickness: 1.0,
});

// Unlit material (for UI elements)
const unlit = new MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.8,
});
```

### Working with Textures

Textures add detail and realism:

```ts
import { TextureLoader } from '@iwsdk/core';

const loader = new TextureLoader();

// Load textures
const diffuseTexture = loader.load('/textures/brick_diffuse.jpg');
const normalTexture = loader.load('/textures/brick_normal.jpg');
const roughnessTexture = loader.load('/textures/brick_roughness.jpg');

// Apply to material
const material = new MeshStandardMaterial({
  map: diffuseTexture, // Base color texture
  normalMap: normalTexture, // Surface detail
  roughnessMap: roughnessTexture, // Roughness variation
});

// Configure texture settings
diffuseTexture.wrapS = RepeatWrapping;
diffuseTexture.wrapT = RepeatWrapping;
diffuseTexture.repeat.set(2, 2); // Tile 2x2
```

### Color Space Management

**Critical for correct colors in VR:**

```ts
// Set color space for albedo textures
diffuseTexture.colorSpace = SRGBColorSpace;

// Linear textures (normals, roughness, etc.) use LinearSRGBColorSpace
normalTexture.colorSpace = LinearSRGBColorSpace;
roughnessTexture.colorSpace = LinearSRGBColorSpace;
```

## Meshes: Putting It Together

Meshes combine geometry and materials into renderable objects:

```ts
import { Mesh } from '@iwsdk/core';

// Create mesh
const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshStandardMaterial({ color: 0x00ff00 });
const mesh = new Mesh(geometry, material);

// Add to IWSDK entity
const entity = world.createTransformEntity(mesh);

// Set additional Three.js properties
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.name = 'GreenBox';
```

### Multiple Materials

Objects can have different materials on different faces:

```ts
// Array of materials for different faces
const materials = [
  new MeshStandardMaterial({ color: 0xff0000 }), // +X
  new MeshStandardMaterial({ color: 0x00ff00 }), // -X
  new MeshStandardMaterial({ color: 0x0000ff }), // +Y
  new MeshStandardMaterial({ color: 0xffff00 }), // -Y
  new MeshStandardMaterial({ color: 0xff00ff }), // +Z
  new MeshStandardMaterial({ color: 0x00ffff }), // -Z
];

const mesh = new Mesh(new BoxGeometry(1, 1, 1), materials);
```

## Lighting and Environment

### Authored Lighting

IWSDK does not inject lighting implicitly. Scenes declare a gradient dome and
gradient IBL explicitly on the level root, as the generated VR and Desktop 3D
starter does (the AR starter declares only the IBL, so no sky covers
passthrough):

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

Because background and IBL are independent, removing one component does not
cause IWSDK to recreate it.

### Custom Environment Maps

For realistic reflections and lighting, author `IBLTexture` and optionally
`DomeTexture` on the level root. Their `src` values may reference an HDR asset
from the manifest:

```ts
import { DomeTexture, IBLTexture } from '@iwsdk/core';

const levelRoot = world.activeLevel.value;
levelRoot.addComponent(IBLTexture, {
  src: 'sunset-hdr',
  intensity: 1,
});
levelRoot.addComponent(DomeTexture, {
  src: 'sunset-hdr',
});
```

### Lighting Best Practices for WebXR

**Environment vs Direct Lights:**

```ts
// ✅ Prefer environment lighting for VR (matches real-world lighting)
world.scene.environment = envMap;

// ✅ Add directional light only if needed
const sun = new DirectionalLight(0xffffff, 0.5);
sun.position.set(10, 10, 5);
world.scene.add(sun);

// ❌ Avoid too many dynamic lights (performance impact)
```

## Performance Optimization

### Geometry Sharing

```ts
// ✅ Reuse geometry for identical shapes
const boxGeometry = new BoxGeometry(1, 1, 1);

for (let i = 0; i < 100; i++) {
  const material = new MeshStandardMaterial({
    color: new Color().setHSL(i / 100, 1, 0.5),
  });
  const mesh = new Mesh(boxGeometry, material); // Same geometry
  // ... create entities
}
```

### Material Sharing and Uniforms

```ts
// ✅ Share materials when possible
const sharedMaterial = new MeshStandardMaterial({ color: 0x00ff00 });

// ✅ Use uniforms for animated properties
const uniformMaterial = new MeshStandardMaterial({
  color: 0xffffff,
});

// In system update:
uniformMaterial.color.setHSL(time * 0.001, 1, 0.5); // Animate color
```

### Texture Optimization

```ts
// Optimize textures for VR
const texture = loader.load('/textures/diffuse.jpg');

// ✅ Use appropriate sizes (power of 2)
// 512x512, 1024x1024, 2048x2048

// ✅ Enable mipmaps for distant objects
texture.generateMipmaps = true;

// ✅ Use compressed formats when possible
// .ktx2, .basis for better performance
```

### LOD (Level of Detail)

```ts
import { LOD } from '@iwsdk/core';

const lod = new LOD();

// High detail (close)
const highMesh = new Mesh(
  new SphereGeometry(1, 32, 16),
  new MeshStandardMaterial({ color: 0x00ff00 }),
);

// Medium detail
const medMesh = new Mesh(
  new SphereGeometry(1, 16, 8),
  new MeshStandardMaterial({ color: 0x00ff00 }),
);

// Low detail (far)
const lowMesh = new Mesh(
  new SphereGeometry(1, 8, 4),
  new MeshStandardMaterial({ color: 0x00ff00 }),
);

lod.addLevel(highMesh, 0); // 0-10 meters
lod.addLevel(medMesh, 10); // 10-50 meters
lod.addLevel(lowMesh, 50); // 50+ meters

const entity = world.createTransformEntity(lod);
```

## Common Patterns for WebXR

### Real-World Sized Objects

```ts
// Create objects with appropriate VR/AR scale
const geometry = new BoxGeometry(0.1, 0.1, 0.1); // 10cm cube
const material = new MeshStandardMaterial({
  color: 0x4caf50,
  roughness: 0.3,
  metalness: 0.1,
});

const mesh = new Mesh(geometry, material);
const entity = world.createTransformEntity(mesh);

// Position at comfortable interaction height
entity.object3D.position.set(0, 1.2, -0.5);
```

### UI Panels

```ts
// Use unlit materials for UI elements
const panelMaterial = new MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.9,
});

const panelGeometry = new PlaneGeometry(0.3, 0.2); // 30cm x 20cm
const panel = new Mesh(panelGeometry, panelMaterial);

const panelEntity = world.createTransformEntity(panel, { persistent: true });
```

### Particle Effects

```ts
// Use instanced meshes for particles
import { InstancedMesh } from '@iwsdk/core';

const particleGeometry = new SphereGeometry(0.01, 8, 4); // Small spheres
const particleMaterial = new MeshBasicMaterial({ color: 0xffff00 });

const particles = new InstancedMesh(particleGeometry, particleMaterial, 1000);

// Update instances in systems
const matrix = new Matrix4();
for (let i = 0; i < 1000; i++) {
  matrix.setPosition(
    Math.random() * 10 - 5,
    Math.random() * 10,
    Math.random() * 10 - 5,
  );
  particles.setMatrixAt(i, matrix);
}
particles.instanceMatrix.needsUpdate = true;
```

## Troubleshooting Common Issues

### Objects Appear Black

```ts
// ❌ Missing or incorrect normals
geometry.computeVertexNormals(); // Fix

// ❌ No environment lighting
world.scene.environment = envMap; // Fix
```

### Textures Look Wrong

```ts
// ❌ Wrong color space
texture.colorSpace = SRGBColorSpace; // For albedo textures
texture.colorSpace = LinearSRGBColorSpace; // For data textures

// ❌ Incorrect UV coordinates
geometry.attributes.uv.needsUpdate = true;
```

### Performance Issues

```ts
// ❌ Too many draw calls
// Fix: Use InstancedMesh or merge geometries

// ❌ High-resolution textures
// Fix: Resize to appropriate sizes (512, 1024, 2048)

// ❌ Too many materials
// Fix: Share materials between objects
```

## Summary

**Key Concepts:**

1. **Mesh = Geometry + Material** - The fundamental building block
2. **Use PBR materials** - MeshStandardMaterial for realistic lighting
3. **Manage color spaces** - sRGB for colors, LinearSRGB for data
4. **Optimize for VR** - Share resources, use appropriate resolutions
5. **IWSDK provides lighting** - Environment maps work out of the box
6. **Real-world scale** - Size objects appropriately for VR interaction

Understanding these concepts enables you to create visually appealing, performant 3D objects that look natural in WebXR environments.
