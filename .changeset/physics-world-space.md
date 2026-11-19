---
'@iwsdk/core': patch
---

Physics bodies under a transformed parent, such as a moved level root or another entity, now simulate in the right place. `PhysicsSystem` used to hand an entity's parent-relative pose to Havok as if it were a world pose, so a child of a parent 5 m up came to rest 5 m above the floor. Bodies are now created, driven, grabbed and rendered in world space and converted through the parent's transform. `setBodyTransform` accepts `{ space: 'world' }`; the default stays parent-relative (`'local'`).
