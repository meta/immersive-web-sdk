---
name: test-physics
description: 'Test Havok physics system (gravity, rigid bodies, static vs dynamic) against the physics example using the iwsdk CLI.'
argument-hint: '[--suite gravity|static|force|all]'
---

# Physics System Test

Run 5 test suites covering gravity, static body verification, PhysicsBody state, system/component registration, and stability.

**Configuration:**

- EXAMPLE_DIR: `$IWSDK_REPO_ROOT/examples/physics`

**Tool calls**: every tool call is `npx @iwsdk/cli <subcommand> [--input-json '<JSON>'] [--timeout <ms>]`, run from inside the example workspace (cwd `$EXAMPLE_DIR`). The CLI auto-discovers the IWSDK app root from cwd, so no path tricks are required. Run `npx @iwsdk/cli mcp inspect` from the example to discover available tools and their CLI subcommands.

- `<JSON>` is a JSON object string. Omit `--input-json` if no arguments are needed.
- Output is JSON on stdout: `{ok, workspaceRoot, operation, result}`. Parse it to check assertions.
- Use `--timeout 20000` for operations that may take longer (reload, xr enter, screenshot).

**IMPORTANT**: Run each Bash command one at a time. Parse the JSON output and verify assertions before moving to the next command. Do NOT chain multiple CLI commands together.

**IMPORTANT**: When the instructions say "wait N seconds", use `sleep N` as a separate Bash command.

---

## Step 1: Install Dependencies

```bash
cd $IWSDK_REPO_ROOT/examples/physics && npm run fresh:install
```

Wait for this to complete before proceeding.

---

## Step 2: Start Dev Server

Start the dev server as a background task using the Bash tool's `run_in_background: true` parameter:

```bash
cd $IWSDK_REPO_ROOT/examples/physics && npm run dev
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

### Verify Physics Setup

Find all physics bodies:

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["PhysicsBody"]}' 2>/dev/null
```

Assert: At least 1 entity.

For each entity found, query to identify dynamic vs static:

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<N>,"components":["PhysicsBody"]}' 2>/dev/null
```

Check `state` field: `"DYNAMIC"` or `"STATIC"`.

Save the entity named `Dynamic Sphere` as `<sphere>` and any static entity as
`<floor>`. The example contains multiple dynamic bodies with intentionally
different damping and gravity settings, so do not select an arbitrary one.

Verify PhysicsSystem:

```bash
npx @iwsdk/cli ecs systems 2>/dev/null
```

Assert: PhysicsSystem at priority -2, `physicsEntities` count >= 1.

---

### Suite 1: Gravity — Dynamic Body Falls

**Test 1.1: Verify Dynamic Entity Exists**

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<sphere>,"components":["PhysicsBody","Transform"]}' 2>/dev/null
```

Assert:

- `state`: `"DYNAMIC"`
- `_engineBody`: > 0 (Havok body created)
- `gravityFactor`: 1

**Note**: By the time you query, the sphere may have already fallen and come to rest.

**Test 1.2: Deterministic Gravity Test**

Reset the sphere position, then use pause/step to observe fall:

```bash
npx @iwsdk/cli ecs pause 2>/dev/null
```

```bash
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":<sphere>,"componentId":"Transform","field":"position","value":"[0, 3, -1.5]"}' 2>/dev/null
```

```bash
npx @iwsdk/cli ecs snapshot --input-json '{"label":"before-fall"}' 2>/dev/null
```

```bash
npx @iwsdk/cli ecs step --input-json '{"count":50}' 2>/dev/null
```

If that command times out as a whole, run it as 10 calls with `{"count":5}` (or
pass a larger `--timeout`); the result is the same. A per-step timeout instead
means the app's loop is not running; check `browser logs`.

```bash
npx @iwsdk/cli ecs snapshot --input-json '{"label":"after-fall"}' 2>/dev/null
```

```bash
npx @iwsdk/cli ecs diff --input-json '{"from":"before-fall","to":"after-fall"}' 2>/dev/null
```

Assert:

- Sphere's `Transform.position[1]` (Y) decreased from `3.0`
- Only the dynamic sphere entity changed significantly

```bash
npx @iwsdk/cli ecs resume 2>/dev/null
```

---

### Suite 2: Static Body Doesn't Move

**Test 2.1: Static Floor Stays Put**

If a static entity was found during setup:

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<floor>,"components":["PhysicsBody","Transform"]}' 2>/dev/null
```

Assert:

- `state`: `"STATIC"`
- `_linearVelocity`: `[0, 0, 0]`
- `_angularVelocity`: `[0, 0, 0]`

**Note**: If no separate static PhysicsBody entity exists (environment geometry may not use PhysicsBody), skip this suite and report SKIP.

---

### Suite 3: PhysicsBody State Values

**Test 3.1: Inspect Dynamic Body Fields**

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<sphere>,"components":["PhysicsBody"]}' 2>/dev/null
```

Assert:

- `state`: `"DYNAMIC"`
- `linearDamping`: 2
- `angularDamping`: 2
- `gravityFactor`: 1
- `_engineBody`: > 0 (non-zero Havok handle)

---

### Suite 4: System & Component Registration

**Test 4.1: PhysicsSystem at Correct Priority**

```bash
npx @iwsdk/cli ecs systems 2>/dev/null
```

Assert:

- PhysicsSystem at priority -2
- Config keys: `gravity`, `useWorker`, `updateFrequency`, `interpolation`

**Test 4.2: Physics Components Registered**

```bash
npx @iwsdk/cli ecs components 2>/dev/null
```

Assert:

- `PhysicsBody`: state (Enum), linearDamping (Float32), angularDamping (Float32), gravityFactor (Float32), \_linearVelocity (Vec3), \_angularVelocity (Vec3), \_engineBody (Float64)
- `PhysicsShape`: shape (Enum), dimensions (Vec3), density (Float32), restitution (Float32), friction (Float32), \_engineShape (Float64)
- `PhysicsManipulation`: force (Vec3), linearVelocity (Vec3), angularVelocity (Vec3)

---

### Suite 5: Stability

```bash
npx @iwsdk/cli browser logs --input-json '{"count":30,"level":["error","warn"]}' 2>/dev/null
```

Assert: No application-level errors or warnings. Pre-existing 404 resource errors from page load are acceptable.

---

## Step 5: Cleanup & Results

Kill the dev server:

```bash
cd $IWSDK_REPO_ROOT/examples/physics && npx @iwsdk/cli dev down
```

Output a summary table:

```
| Suite                     | Result         |
|---------------------------|----------------|
| 1. Gravity                | PASS/FAIL      |
| 2. Static Body            | PASS/FAIL/SKIP |
| 3. PhysicsBody State      | PASS/FAIL      |
| 4. System/Component Reg.  | PASS/FAIL      |
| 5. Stability              | PASS/FAIL      |
```

If any suite fails, include which assertion failed and actual vs expected values.

---

## Recovery

If at any point a transient error occurs (server crash, WebSocket timeout, connection refused, etc.) that is NOT caused by a source code bug:

1. Stop the dev server: `cd $IWSDK_REPO_ROOT/examples/physics && npx @iwsdk/cli dev down`
2. Restart: re-run Step 2 to start a fresh dev server
3. Re-run the Pre-test Setup (reload, accept session)
4. Retry the failed suite

Only give up after one retry attempt per suite. If the same suite fails twice, mark it FAIL and continue to the next suite.

---

## Known Issues & Workarounds

### Sphere falls immediately

The dynamic sphere starts falling as soon as the Havok body is created. Use `npx @iwsdk/cli ecs pause` immediately after reload to catch it, or use the deterministic reset approach.

### PhysicsManipulation is one-shot

`PhysicsManipulation` is automatically removed after forces are applied in a single frame. You cannot query it after processing.

### Setting Transform doesn't always override physics

While PhysicsSystem is running, it may overwrite your position on the next frame. Use `npx @iwsdk/cli ecs pause` before modifying positions.

### Havok WASM initialization is async

Bodies may not be created on the first frame. The `_engineBody` field transitions from 0 to non-zero once Havok processes the entity.

### Entity indices change on reload

Never cache entity indices across page reloads. Always re-discover via `npx @iwsdk/cli ecs find`.
