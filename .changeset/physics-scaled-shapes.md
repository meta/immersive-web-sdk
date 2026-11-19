---
'@iwsdk/core': patch
---

Physics colliders now follow an object's world scale. `Auto` shapes and mesh-derived `ConvexHull`/`TriMesh` shapes always use it: a box mesh scaled 2× used to get a 1 m collider and sink halfway into the floor. Spheres take the largest axis, and cylinders and capsules the larger horizontal axis for their radius. Mesh hulls also read interleaved position attributes correctly. Shapes with explicit `dimensions` keep their authored size by default, because those were often sized by hand to match a scaled visual. A scaled object with explicit dimensions logs a one-time warning, and the new `features.physics.applyScale: true` option applies scale to them too. That will become the default in a future release.
