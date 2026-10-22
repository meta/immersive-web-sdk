---
name: test-grab
description: 'Test grab system (distance grab, one-hand grab, two-hand grab, hand pinch grab) against the grab example using the iwsdk CLI.'
argument-hint: '[--suite distance|onehand|twohand|all]'
---

# Grab System Test

Run 6 test suites covering distance grab, one-hand grab, two-hand grab, system/component registration, hand pinch grab, and stability.

**Configuration:**

- EXAMPLE_DIR: `$IWSDK_REPO_ROOT/examples/grab`

**Tool calls**: every tool call is `npx @iwsdk/cli <subcommand> [--input-json '<JSON>'] [--timeout <ms>]`, run from inside the example workspace (cwd `$EXAMPLE_DIR`). The CLI auto-discovers the IWSDK app root from cwd, so no path tricks are required. Run `npx @iwsdk/cli mcp inspect` from the example to discover available tools and their CLI subcommands.

- `<JSON>` is a JSON object string. Omit `--input-json` if no arguments are needed.
- Output is JSON on stdout: `{ok, workspaceRoot, operation, result}`. Parse it to check assertions.
- Use `--timeout 20000` for operations that may take longer (reload, xr enter, xr animate-to, screenshot).

**IMPORTANT**: Run each Bash command one at a time. Parse the JSON output and verify assertions before moving to the next command. Do NOT chain multiple CLI commands together.

**IMPORTANT**: When the instructions say "wait N seconds", use `sleep N` as a separate Bash command.

---

## Step 1: Install Dependencies

```bash
cd $IWSDK_REPO_ROOT/examples/grab && npm run fresh:install
```

Wait for this to complete before proceeding.

---

## Step 2: Start Dev Server

Start the dev server as a background task using the Bash tool's `run_in_background: true` parameter:

```bash
cd $IWSDK_REPO_ROOT/examples/grab && npm run dev
```

**IMPORTANT**: This command MUST be run with `run_in_background: true` on the Bash tool — do NOT append `&` to the command itself.

Once the background task is launched, poll the output for Vite's ready message (up to 60s). You can also run `npx @iwsdk/cli dev status` from the example directory until `state.running` becomes `true`. You do not need to extract or manage the port yourself; subsequent commands resolve the active runtime through the CLI automatically.

If the server fails to start within 60 seconds, report FAIL for all suites and skip to Step 5.

---

## Step 3: Verify Connectivity

```bash
npx @iwsdk/cli ecs systems 2>/dev/null
```

This must return JSON with a list of systems. If it fails:

1. Check the dev server output for errors
2. Try killing and restarting the server (Step 2)
3. If it still fails, report FAIL for all suites and skip to Step 5

---

## Step 4: Run Test Suites

### Pre-test Setup

Run these commands in order:

1. `npx @iwsdk/cli browser reload --timeout 20000 2>/dev/null`
   Then: `sleep 3`

2. `npx @iwsdk/cli xr enter --timeout 20000 2>/dev/null`
   Then: `sleep 2`

3. `npx @iwsdk/cli browser logs --input-json '{"count":20,"level":["error","warn"]}' 2>/dev/null`
   Assert: No error-level logs.

### Entity Discovery

Discover all grab entities dynamically:

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["DistanceGrabbable"]}' 2>/dev/null
```

Assert: At least 1 entity. In the runtime hierarchy below, select the entity
whose `sceneNodeId` is `pyramid-distance-grab` (the
`Distance Grabbable Pyramid`) and save its entity index as `<distance>`. This
example's `Earth` is also distance-grabbable, but it uses `RotateAtSource` and
therefore is not valid for the positional `MoveTowardsTarget` assertion in
Test 1.3.

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["OneHandGrabbable"]}' 2>/dev/null
```

Assert: At least 1 entity. Save first as `<onehand>`.

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["TwoHandsGrabbable"]}' 2>/dev/null
```

Assert: At least 1 entity. Save first as `<twohand>`.

Get entity positions via scene hierarchy:

```bash
npx @iwsdk/cli scene runtime-hierarchy --input-json '{"maxDepth":3}' 2>/dev/null
```

Find Object3D UUIDs for each grab entity, then query their transforms:

```bash
npx @iwsdk/cli scene transform --input-json '{"uuid":"<entity-uuid>"}' 2>/dev/null
```

Save `positionRelativeToXROrigin` as `<distance-pos>`, `<onehand-pos>`, `<twohand-pos>`.

Verify GrabSystem is active:

```bash
npx @iwsdk/cli ecs systems 2>/dev/null
```

Assert: GrabSystem at priority -3.

---

### Component Reference

| Component           | Pointer Type          | Activation                                                 |
| ------------------- | --------------------- | ---------------------------------------------------------- |
| `DistanceGrabbable` | Ray (trigger)         | `npx @iwsdk/cli xr set-select-value`                       |
| `OneHandGrabbable`  | Grip sphere (squeeze) | `npx @iwsdk/cli xr set-gamepad-state` button 1             |
| `TwoHandsGrabbable` | Grip sphere (squeeze) | `npx @iwsdk/cli xr set-gamepad-state` button 1, both hands |

**Critical Distinction**: Distance grab uses **trigger** (`npx @iwsdk/cli xr set-select-value`). One-hand and two-hand grab use **squeeze** (`npx @iwsdk/cli xr set-gamepad-state` button index 1). Wrong button silently fails.

---

### Suite 1: Distance Grab (Ray + Trigger)

**Test 1.1: Ray Hover**

```bash
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":<distance-pos.x>,"y":<distance-pos.y>,"z":<distance-pos.z>},"moveToDistance":0.8}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<distance>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` present.

**Test 1.2: Trigger to Grab**

```bash
npx @iwsdk/cli ecs snapshot --input-json '{"label":"before-grab"}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr set-select-value --input-json '{"device":"controller-right","value":1}' 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<distance>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: Both `Hovered` and `Pressed` present.

**Test 1.3: Move While Grabbed**

```bash
npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":0.5,"y":1.5,"z":-1.0},"duration":1.0}' --timeout 20000 2>/dev/null
```

Then: `sleep 1.5`

```bash
npx @iwsdk/cli ecs snapshot --input-json '{"label":"after-move"}' 2>/dev/null
```

```bash
npx @iwsdk/cli ecs diff --input-json '{"from":"before-grab","to":"after-move"}' 2>/dev/null
```

Assert: Entity's Transform.position must differ from initial.

**Test 1.4: Release Trigger**

```bash
npx @iwsdk/cli xr set-select-value --input-json '{"device":"controller-right","value":0}' 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<distance>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: `Pressed` removed. `Handle` persists (it's permanent).

**Test 1.5: Point Away — Clean State**

```bash
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":0,"y":1.6,"z":-5}}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<distance>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` removed.

---

### Suite 2: One-Hand Grab (Squeeze)

**Test 2.1: Ray Isolation — Ray Cannot Interact**

```bash
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":<onehand-pos.x>,"y":<onehand-pos.y>,"z":<onehand-pos.z>},"moveToDistance":0.5}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<onehand>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: No `Hovered` or `Pressed` on entity (ray is denied by `pointerEventsType`).

**Test 2.2: Position Controller at Object + Squeeze**

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-right","position":{"x":<onehand-pos.x>,"y":<onehand-pos.y>,"z":<onehand-pos.z>},"orientation":{"pitch":0,"roll":0,"yaw":0}}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-right","buttons":[{"index":1,"value":1,"touched":true}]}' 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs snapshot --input-json '{"label":"before-onehand"}' 2>/dev/null
```

**Test 2.3: Move While Squeezing**

```bash
npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":<onehand-pos.x>,"y":<onehand-pos.y + 0.3>,"z":<onehand-pos.z + 0.3>},"duration":1.0}' --timeout 20000 2>/dev/null
```

Then: `sleep 1.5`

```bash
npx @iwsdk/cli ecs snapshot --input-json '{"label":"after-onehand-move"}' 2>/dev/null
```

```bash
npx @iwsdk/cli ecs diff --input-json '{"from":"before-onehand","to":"after-onehand-move"}' 2>/dev/null
```

Assert: Entity's Transform.position must have changed to follow the controller.

**Test 2.4: Release Squeeze**

```bash
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-right","buttons":[{"index":1,"value":0,"touched":false}]}' 2>/dev/null
```

Assert: Entity stops moving (Transform remains at released position).

---

### Suite 3: Two-Hand Grab (Both Controllers Squeeze)

**Test 3.1: Position Both Controllers Near Object**

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-left","position":{"x":<twohand-pos.x - 0.15>,"y":<twohand-pos.y>,"z":<twohand-pos.z>},"orientation":{"pitch":0,"roll":0,"yaw":0}}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-right","position":{"x":<twohand-pos.x + 0.15>,"y":<twohand-pos.y>,"z":<twohand-pos.z>},"orientation":{"pitch":0,"roll":0,"yaw":0}}' 2>/dev/null
```

**Test 3.2: Both Squeeze + Snapshot**

```bash
npx @iwsdk/cli ecs snapshot --input-json '{"label":"before-twohand"}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-left","buttons":[{"index":1,"value":1,"touched":true}]}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-right","buttons":[{"index":1,"value":1,"touched":true}]}' 2>/dev/null
```

Then: `sleep 0.5`

**Test 3.3: Spread Hands — Scale Up**

```bash
npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-left","position":{"x":<twohand-pos.x - 0.5>,"y":<twohand-pos.y>,"z":<twohand-pos.z>},"duration":1.0}' --timeout 20000 2>/dev/null
```

```bash
npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":<twohand-pos.x + 0.5>,"y":<twohand-pos.y>,"z":<twohand-pos.z>},"duration":1.0}' --timeout 20000 2>/dev/null
```

Then: `sleep 1.5`

```bash
npx @iwsdk/cli ecs snapshot --input-json '{"label":"after-twohand-scale"}' 2>/dev/null
```

```bash
npx @iwsdk/cli ecs diff --input-json '{"from":"before-twohand","to":"after-twohand-scale"}' 2>/dev/null
```

Assert: Entity Transform.scale should be larger than initial.

**Test 3.4: Release Both**

```bash
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-left","buttons":[{"index":1,"value":0,"touched":false}]}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-right","buttons":[{"index":1,"value":0,"touched":false}]}' 2>/dev/null
```

---

### Suite 4: System & Component Registration

**Test 4.1: GrabSystem at Correct Priority**

```bash
npx @iwsdk/cli ecs systems 2>/dev/null
```

Assert: GrabSystem present at priority -3.

**Test 4.2: Components Registered**

```bash
npx @iwsdk/cli ecs components 2>/dev/null
```

Assert: Must include: `OneHandGrabbable`, `TwoHandsGrabbable`, `DistanceGrabbable`, `Handle`.

---

### Suite 5: Hand Pinch Grab (run_sequence)

The grab example sets `useHandPinchForGrab`, so an emulated hand's pinch grabs
`OneHandGrabbable` entities. IWSDK resolves the target names the hand
sequences use.

**Test 5.1: Hand Input and Targets**

```bash
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr list-targets 2>/dev/null
```

Assert: `resolver` is `true` and `targets` includes `Map Pin 1`, `Map Pin 2`, and
`Map Pin 3`. Save the `Map Pin 1` entry's `position` (box centre) as `<pin-pos>`
and `size` as `<pin-size>`, and find its entity index with
`npx @iwsdk/cli ecs find --input-json '{"namePattern":"^Map Pin 1$"}'` as `<pin>`.

**Test 5.2: Pinch-Grab and Carry**

The carry position is where the pin's base goes while it is held (here 30 cm
toward the user and 10 cm up):

```bash
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"label":"grab","target":"Map Pin 1","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},{"label":"carry","position":{"x":<pin-pos.x - 0.05>,"y":<pin-pos.y - pin-size.y/2 + 0.1>,"z":<pin-pos.z + 0.3>},"depart":{"distance":0.08}}]}' --timeout 45000 2>/dev/null
```

Assert: `completed` is `true` and `events` contains `selectstart`.

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<pin>,"components":["Grabbed"]}' 2>/dev/null
```

Assert: `Grabbed` present. Query `Map Pin 2` and `Map Pin 3` the same way and
assert `Grabbed` is absent on both.

**Test 5.3: Release**

```bash
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"label":"release","pinch":0,"duration":0.15}]}' --timeout 45000 2>/dev/null
```

Assert: `events` contains `selectend`. Then `sleep 0.5`, query `<pin>` for
`["Grabbed"]` and assert it is absent. Run `npx @iwsdk/cli xr list-targets` again:
the `Map Pin 1` centre must have moved at least 0.2 m from `<pin-pos>`, and its
base (centre y minus half its height) must be within 0.02 m of the carry position.

**Test 5.4: Back to Controllers**

```bash
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"controller"}' 2>/dev/null
```

---

### Suite 6: Stability

```bash
npx @iwsdk/cli browser logs --input-json '{"count":30,"level":["error","warn"]}' 2>/dev/null
```

Assert: No application-level errors or warnings. Pre-existing 404 resource errors from page load are acceptable.

---

## Step 5: Cleanup & Results

Kill the dev server:

```bash
cd $IWSDK_REPO_ROOT/examples/grab && npx @iwsdk/cli dev down
```

Output a summary table:

```
| Suite                         | Result    |
|-------------------------------|-----------|
| 1. Distance Grab              | PASS/FAIL |
| 2. One-Hand Grab              | PASS/FAIL |
| 3. Two-Hand Grab              | PASS/FAIL |
| 4. System/Component Reg.      | PASS/FAIL |
| 5. Hand Pinch Grab            | PASS/FAIL |
| 6. Stability                  | PASS/FAIL |
```

If any suite fails, include which assertion failed and actual vs expected values.

---

## Recovery

If at any point a transient error occurs (server crash, WebSocket timeout, connection refused, etc.) that is NOT caused by a source code bug:

1. Stop the dev server: `cd $IWSDK_REPO_ROOT/examples/grab && npx @iwsdk/cli dev down`
2. Restart: re-run Step 2 to start a fresh dev server
3. Re-run the Pre-test Setup (reload, accept session)
4. Retry the failed suite

Only give up after one retry attempt per suite. If the same suite fails twice, mark it FAIL and continue to the next suite.

---

## Known Issues & Workarounds

### No Hovered/Pressed for near-field grabs

OneHandGrabbable and TwoHandsGrabbable entities do NOT get `Hovered` or `Pressed` tags. Only distance grab (via ray) gets these tags. Use `npx @iwsdk/cli ecs snapshot`/`npx @iwsdk/cli ecs diff` to verify near-field grabs.

### Handle component is permanent

`Handle` is added by `GrabSystem` at init time and never removed. Grab state is tracked inside `Handle.instance.outputState`.

### Trigger vs Squeeze confusion

Distance grab uses **trigger** (`set_select_value`), not squeeze. One-hand and two-hand grab use **squeeze** (`set_gamepad_state` button index 1). Wrong button silently fails.

### Hand sequences need a longer timeout

`xr run-sequence` resolves when the whole interaction is done, up to 28 s after
it is sent. Pass `--timeout 45000`.

### Grab sphere radius is 0.07m

The grab sphere intersector has a default radius of 7cm. Position the controller at the object's center for reliable detection.

### Entity indices change on reload

Never cache entity indices across page reloads. Always re-discover via `npx @iwsdk/cli ecs find`.
