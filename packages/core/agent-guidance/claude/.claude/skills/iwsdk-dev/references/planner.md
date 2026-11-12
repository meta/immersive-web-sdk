# Planner path

Deliver the requested experience with the smallest reliable loop. Preserve the
user's exact observable contract, use IWSDK-native workflows, verify the real
runtime, and stop when the contract is proven.

## Default operating mode

- Work autonomously when the task is already specific. Do not pause for design
  approval unless a missing choice materially changes the product.
- Keep one compact plan in the conversation or task list. Do not create
  `design/`, pipeline-state, deck, concept-art, architecture, verification, or
  retrospective files unless the user explicitly requests them.
- Do not scaffold a nested app. Treat the generated project in the working
  directory as the starting point.
- Do not run an untouched-scaffold demo. Inspect the generated project briefly
  and begin the requested implementation.
- Use subagents only for genuinely independent work that saves wall time. Do
  not spawn a planner, documentation, or review subagent by default.

## 1. Extract the executable contract

Before editing, reduce the prompt to a short checklist:

1. exact files, scene node IDs, UIKit element IDs, component names, and fields;
2. explicit initial values and state transitions;
3. interaction paths that must work in the live app;
4. visible states and required framing/legibility;
5. build and runtime evidence needed before stopping.

Treat exact values as data, not implications. If a required field value equals
the component default, still serialize it explicitly in authored scene data.
For example, a required profile `A` must be written as `profileId: "A"`, not
left implicit because `A` is the schema default.

When the prompt names live runtime objects, assign those runtime `.name`
values exactly during initialization and verify them in the runtime hierarchy.
UIKit element IDs alone do not satisfy a runtime-name requirement.

## 2. Inspect once, then ground only uncertainty

Read the existing entry point, project config, asset/component registries,
scene, and relevant scoped rules. Use precise `npx @iwsdk/cli reference` queries
only for APIs or file formats that are genuinely uncertain.

Convert FBX, OBJ, and other source model formats before registering them: in
Blender use **File → Import**, then **File → Export → glTF 2.0**, and add the
resulting GLB/GLTF to the asset manifest.

For a fresh scaffold that needs native scene composition and UIKitML, use this
exact fast path before broad discovery:

1. read the applicable scoped `AGENTS.md`, then exactly these scaffold rules
   when present: `.claude/rules/scene-json.md`, `ecs-api.md`, `uikitml.md`, and
   `assets-and-manifest.md`; do not list directories first;
2. in one bounded shell call, print `package.json`, `iwsdk.config.json`, the
   small scaffold `src/*.ts` files, the authored scene JSON, and UIKitML;
3. use `iwsdk-build-model` for every new or materially changed model, then use
   `iwsdk-compose-scene` for scene placement, lighting, environment, and cameras;
   load `iwsdk-ui/SKILL.md` only when UIKitML is part of the request;
4. create or replace the first implementation files immediately, then let
   typecheck/runtime errors identify any
   additional API question.

The first edit is a checkpoint: reach it within 8 tool calls after loading this
playbook. Do not inspect generated declarations, search node_modules, or invoke
another specialist before it. If one framework boundary remains unclear, write
the straightforward typed slice, run npm run --if-present typecheck, and investigate only the
concrete compiler error. After the focused references, edit before optional
lookup.

For the bounded scaffold read, prefer one command shaped like this over a
series of individual reads (adjust globs only when the project differs):

```bash
for f in package.json iwsdk.config.json src/*.ts public/scenes/*.json public/ui/*.uikitml; do
  echo "--- $f"; sed -n '1,260p' "$f"
done
```

For a compact greenfield scene, keep the default player spawn unless the prompt
explicitly requires another spawn. Do not inspect schemas to add an optional
`player` block. Keep the standing volume around the origin clear, place the
experience in front of it (normally negative Z), and use this document shape:

```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "components": {},
  "resources": {},
  "nodes": [],
  "authoring": { "views": [] }
}
```

Use these stable high-friction recipes directly; do not rediscover them in
`node_modules`:

```ts
const Profiles = { A: 'A', B: 'B', C: 'C' } as const;
const Example = createComponent('Example', {
  profileId: { type: Types.Enum, default: Profiles.A, enum: Profiles },
  occupant: { type: Types.Entity, default: null },
  active: { type: Types.Boolean, default: false },
  elapsed: { type: Types.Float32, default: 0 },
});

const panel = world.requireSceneObject<UIKitMLAsset>('ControlPanel');
const status = panel.requireElementById<UIKit.Text>('StatusText');
const button = panel.requireElementById('Btn_Action');
status.name = 'StatusText';
button.name = 'Btn_Action';
button.addEventListener('click', onAction);
cleanupFuncs.push(() => button.removeEventListener('click', onAction));

export class ExampleSystem extends createSystem({
  examples: { required: [Example] },
  held: { required: [Example, Grabbed] },
}) {
  init(): void {
    const onGrab = (entity: Entity) => entity.setValue(Example, 'active', true);
    const onRelease = (entity: Entity) =>
      entity.setValue(Example, 'active', false);
    const offGrab = this.queries.held.subscribe('qualify', onGrab);
    const offRelease = this.queries.held.subscribe('disqualify', onRelease);
    this.cleanupFuncs.push(offGrab, offRelease);
  }

  update(delta: number): void {
    for (const entity of this.queries.examples.entities) {
      const active = entity.getValue(Example, 'active');
      const elapsed = entity.getValue(Example, 'elapsed') ?? 0;
      if (active) entity.setValue(Example, 'elapsed', elapsed + delta);
    }
  }
}
```

- Declare systems with `class X extends createSystem({ queryName: { required: [...] } })`.
  Iterate `this.queries.queryName.entities`, and use
  `entity.getValue(Component, field)` / `entity.setValue(Component, field, value)`.
  Query `subscribe` returns an unsubscribe function for `cleanupFuncs`.
- Author an empty entity reference as `null` in scene JSON.
- Put `OneHandGrabbable` on authored nodes that need proximity grabbing. Treat
  `Grabbed` as a runtime tag; use qualify/disqualify transitions for lifecycle
  handling and `GrabSystem.forceRelease(entity)` for reset.
- When a slot accepts only one entity, guard against replacement: if its current
  entity is non-null and differs from the released entity, leave both unchanged.
- Resolve authored entities and objects with `world.requireSceneEntity(nodeId)`
  and `world.requireSceneObject(nodeId)`.
- Import ECS, UIKit, grab helpers, and Three.js runtime classes from
  `@iwsdk/core`; IWSDK re-exports the supported runtime surface.
- For a live UIKit ray click, aim with `npx @iwsdk/cli xr look-at`, then use
  `npx @iwsdk/cli xr select --input-json '{"device":"controller-right","duration":0.2}'`.
  Do not rederive pointer internals or manually pulse select unless diagnosing
  a concrete helper failure.

Avoid broad repeated discovery:

- do not enumerate the same command family or dependency tree multiple times;
- do not read generated bundles or large reference files when a focused API or
  example query answers the question;
- do not repeat successful status, hierarchy, or capability probes without a
  state change that requires it.

Specialist skills are optional focused references, not mandatory phases. Use
only the skills needed by the contract, normally at most once each:

- `iwsdk-build-model` for new or materially changed model geometry, materials,
  hierarchy, or surface detail;
- `iwsdk-compose-scene` for scene JSON, placement, cross-asset contacts,
  lighting, environment, or camera views after model work is complete;
- `iwsdk-ui` for UIKitML authoring or layout debugging;
- `iwsdk-grab` / `iwsdk-ray` for unfamiliar live interaction simulation;
- `iwsdk-debug` after a concrete runtime failure.

Pass a concise problem statement to a specialist. Do not paste the full user
prompt, ask it to run another end-to-end plan, or invoke overlapping skills for
the same question.

## 3. Implement one coherent vertical slice

Build the smallest structure that covers the whole contract:

1. native scene assets and deliberate hero/panel framing;
2. component schemas and explicit authored values;
3. interaction/state systems;
4. UIKitML and runtime control wiring;
5. visible state feedback.

Prefer IWSDK built-ins and project-local patterns. Keep systems small, register
cleanup functions, avoid per-frame allocation, and preserve feature-flag
prerequisites. Do not create process documents while code is incomplete.

Run `npm run --if-present typecheck` after the coherent slice exists, then fix errors in a
batch. Do not typecheck after every small edit. Run the production build near
the end and again only after a change that can affect it.

## 4. Verify the actual contract

Match verification depth to the app and its risk. A simple single-scene app
needs direct evidence for its few success criteria; multi-system behavior,
physics, deployment, and interactions with meaningful failure modes need
broader scenarios and stronger evidence.

After the coherent vertical slice typechecks, start one managed dev session
and keep it alive while iterating. The developer owns headed versus headless
mode: announce a proposed mode change before restarting rather than silently
replacing their visible collaboration window. Do not start an untouched or
knowingly non-typechecking app. Exercise the real paths rather than inferring
behavior from code. Confirm `npx @iwsdk/cli xr status` is active before making pose,
controller/hand alignment, or immersive-interaction claims; a flat screenshot
outside XR cannot prove them.

Verify:

- initial ECS state and explicit authored values;
- every interaction required by the acceptance contract;
- empty, rejected, boundary, or exclusivity guards when applicable;
- timed transitions and visible state feedback;
- reset of affected state, transforms, flags, timers, and references;
- exact runtime hierarchy names for addressable controls.

When the contract includes an exclusive slot or station, prove that a second
object cannot silently replace the current occupant.

Use compact CLI scripts to group related assertions. Capture screenshots at
the requested key states, not after every minor change.

Once the dev session is ready, target at most 24 shell-tool calls for the
entire verification pass. Batch the contract into a few coherent scenarios,
for example: initial state and guard behavior, successful primary interaction,
rejected or boundary behavior, and reset/runtime-name closeout. Each block
should perform its input sequence, query affected state, and print a compact
PASS/FAIL summary. After a failure, diagnose once and rerun only that block.

Keep context lean while iterating:

- do not re-read a file after a successful write or edit unless a later tool
  reports a concrete mismatch; use a targeted range or search when only one
  section is uncertain;
- project large CLI responses down to the exact fields being checked and cap
  logs/search output;
- save evidence screenshots to disk, but do not load every full-resolution
  image into model context. Image reads are expensive and can force context
  compaction.

## 5. Visual quality gate

Before finishing, inspect the same hero/runtime view a reviewer will see:

- the complete experience fills the frame at a useful scale;
- primary objects and controls are visually distinguishable;
- important text and controls are readable from the intended viewpoint;
- required states differ immediately through color, text, motion, or emissive
  feedback;
- no unintended starter content, severe clipping, empty space, or back-facing UI
  remains.

If the app is correct but the panel is tiny or the scene is too distant, fix
camera/framing before adding decorative complexity.

Use at most two visual reads by default: one early hero frame when composition
is uncertain, and one final inspection. Prefer a compact contact sheet of the
required states for the final read. If no contact-sheet tool is available,
inspect the hero frame plus the visually riskiest active state and prove the
remaining state changes through exact runtime text/color/state assertions.
Exceed this budget only to diagnose a specific visible defect, and replace an
earlier read rather than accumulating near-duplicate screenshots.

Keep original screenshots at evidence resolution, but load only a bounded
inspection copy into model context. Use an image tool already present in the
environment to limit an individual frame to roughly 640 pixels on its long edge
or a contact sheet to 1024 by 1024. Do not install a dependency only for this.

## 6. Targeted closeout, then stop

Once live assertions pass:

1. check the authored scene for every exact ID, component, and explicit value;
2. check runtime names and event-listener cleanup;
3. run `npm run --if-present typecheck` and `npm run build`;
4. re-run only assertions affected by the final fixes;
5. leave the app reset to its initial state and report concise evidence.

Do not launch the project code-reviewer by default. Use it only when a live or
build failure remains unexplained, the implementation uses an unfamiliar
framework boundary, or the user explicitly requests review. Do not apply
style-only review changes after the quality gates pass.

## Budget and stopping rules

- By roughly 60% of the available session, the full vertical slice should
  exist and typecheck.
- By roughly 75%, switch from feature work to runtime verification.
- By roughly 85%, freeze optional polish and close exact contract gaps.
- Prefer one proven implementation over alternate architectures, redundant
  screenshots, repeated reviews, or speculative cleanup.
- Stop when static contract, production build, live paths, and visual gate pass.

The output is the working IWSDK app and concise final evidence—not a record of
the process used to produce it.
