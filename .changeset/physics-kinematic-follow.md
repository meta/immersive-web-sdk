---
'@iwsdk/core': patch
---

Kinematic physics bodies now follow their Object3D, so the documented moving-platform pattern works. Before, moving a kinematic body's Object3D did nothing: the engine pose was written back every frame and the body snapped back. Now a changed Object3D pose is swept across the next physics substeps, so the body pushes dynamic bodies and carries anything resting on it. When the Object3D stops, the body is settled on its last pose instead of drifting on. Engine poses are no longer written back to kinematic bodies. `PhysicsManipulation` on a kinematic body is ignored with a one-time warning; move its Object3D instead. `setBodyTransform` still teleports a kinematic body without sweeping it.
