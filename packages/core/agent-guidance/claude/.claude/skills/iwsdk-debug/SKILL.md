---
name: iwsdk-debug
description: Diagnose and verify real-time IWSDK behavior with bounded ECS pause, query, snapshot, step, and diff loops. Use for physics, animation, collision, interaction, or state bugs that cannot be proven from a screenshot.
argument-hint: '(use the current request)'
---

# IWSDK Runtime Debugging

Use the current request. The goal is a reproducible observation, the smallest
supported fix, and one matching replay—not an open-ended trace session.

## 1. Establish one failing observation

Start the managed app once and enter XR only if required. Locate and query the
named entities and relevant systems. Freeze time as early as possible:

1. `ecs_pause`
2. `ecs_snapshot` with label `before`
3. trigger or prepare the failing transition
4. `ecs_step` for 1-3 frames at `0.016`
5. `ecs_snapshot` with label `after`
6. `ecs_diff` from `before` to `after`

Query the affected entity after the diff. For a startup failure that has already
occurred, record the bad live transform first, then use the next clean restart
for the frame-stepped observation. A screenshot can clarify geometry but is not
a substitute for ECS evidence.

## 2. Form and test one hypothesis

Inspect only the configuration, scene node, component, or system implicated by
the measured change. Check the invariant before editing: colliders need both
body and shape, dynamic motion needs the correct state, interactions need the
matching input/component path, and animations need the responsible system to
be running. Do not browse framework internals while an authored invariant
already explains the evidence.

Use the common authored physics forms directly instead of dumping scene
capabilities: a detailed static environment normally pairs
`PhysicsBody: { "state": "STATIC" }` with
`PhysicsShape: { "shape": "TriMesh" }`; dynamic objects use a supported convex
or primitive shape. Query live components after reload to verify registration.

Make the smallest project edit that restores that invariant. Avoid unrelated
cleanup, visual redesign, or defensive rewrites.

Do not inspect IWSDK framework source, Vite plugin internals, or CLI help when a
missing authored component already explains the measured state. Use public
component data and the project files as the debugging boundary.
For a local authored-component fix, do not request the full scene capability or
scene-state payload; the source diff, production build, and focused live entity
query provide the required evidence.

## 3. Replay the same probe

After editing, do not run an intermediate replay. Run the production build,
restart once, and repeat the same pause → snapshot → step → snapshot → diff
sequence with the same labels and timestep. Compare the same fields and query
the final entity. This gives exactly two probes: one failing observation and one
post-build replay. Capture one final runtime screenshot if position or collision
is visually relevant.

The build is the production-build proof; do not launch a second Vite preview
server. Replay with the same managed IWSDK dev runtime. Save file evidence with
`npx @iwsdk/cli browser screenshot --output-file <path>` rather than discovering the
screenshot CLI after the debug loop. When ECS evidence already proves the fix,
do not open or read the PNG back into model context; leave it for evaluator or
human review. Inspect one compact image only when the spatial result cannot be
established from the measured state.

Make at most one focused correction. Stop when the original symptom no longer
reproduces and the measured state agrees with the intended behavior. Call
`ecs_resume` before finishing and leave input buttons released.
