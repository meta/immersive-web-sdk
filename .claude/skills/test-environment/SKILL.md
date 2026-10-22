---
name: test-environment
description: 'Test environment system (authored DomeGradient and IBLGradient, component schemas) against the poke example using the iwsdk CLI.'
argument-hint: '[--suite gradient|ibl|defaults|all]'
---

# Environment System Test

Run 6 test suites covering authored environment verification, system registration, component registration, scene hierarchy, ECS data modification, and stability.

**Configuration:**

- EXAMPLE_DIR: `$IWSDK_REPO_ROOT/examples/poke`

**Tool calls**: every tool call is `npx @iwsdk/cli <subcommand> [--input-json '<JSON>'] [--timeout <ms>]`, run from inside the example workspace (cwd `$EXAMPLE_DIR`). The CLI auto-discovers the IWSDK app root from cwd, so no path tricks are required. Run `npx @iwsdk/cli mcp inspect` from the example to discover available tools and their CLI subcommands.

- `<JSON>` is a JSON object string. Omit `--input-json` if no arguments are needed.
- Output is JSON on stdout: `{ok, workspaceRoot, operation, result}`. Parse it to check assertions.
- Use `--timeout 20000` for operations that may take longer (reload, xr enter, screenshot).

**IMPORTANT**: Run each Bash command one at a time. Parse the JSON output and verify assertions before moving to the next command. Do NOT chain multiple CLI commands together.

**IMPORTANT**: When the instructions say "wait N seconds", use `sleep N` as a separate Bash command.

**IMPORTANT**: Boolean values in `ecs set-component` must be actual JSON booleans (`value: true`), NOT strings (`value: "true"`). Strings silently fail to coerce.

---

## Step 1: Install Dependencies

```bash
cd $IWSDK_REPO_ROOT/examples/poke && npm run fresh:install
```

Wait for this to complete before proceeding.

---

## Step 2: Start Dev Server

Start the dev server as a background task using the Bash tool's `run_in_background: true` parameter:

```bash
cd $IWSDK_REPO_ROOT/examples/poke && npm run dev
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

1. Record the test start time immediately before reloading:

   ```bash
   node -p 'Date.now()'
   ```

   Save the output as `<test-start-ms>`.

2. `npx @iwsdk/cli browser reload --timeout 20000 2>/dev/null`
   Then: `sleep 3`

3. `npx @iwsdk/cli xr enter --timeout 20000 2>/dev/null`
   Then: `sleep 2`

4. `npx @iwsdk/cli browser logs --input-json '{"since":<test-start-ms>,"count":20,"level":["error","warn"]}' 2>/dev/null`
   Assert: No error-level logs.

---

### Suite 1: Authored Environment Verification

**Test 1.1: Find LevelRoot Dynamically**

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["LevelRoot"]}' 2>/dev/null
```

Assert: Exactly 1 entity. Save its `entityIndex` as `<root>`.

**Test 1.2: LevelRoot Has Environment Components**

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<root>,"components":["DomeGradient","IBLGradient"]}' 2>/dev/null
```

Assert: Both components are present with the values explicitly authored in
`public/scenes/poke.iwsdk.scene.json`:

**DomeGradient defaults:**
| Field | Expected Value |
|-------|---------------|
| `sky` | `[0.2423, 0.6172, 0.8308, 1.0]` (soft blue) |
| `equator` | `[0.6584, 0.7084, 0.7913, 1.0]` (gray-blue) |
| `ground` | `[0.807, 0.7758, 0.7454, 1.0]` (warm beige) |
| `intensity` | `1.0` |
| `elevationDeg` | `90` (default: sky pole straight up) |
| `azimuthDeg` | `0` (default) |
| `dither` | `false` (default) |
| `_needsUpdate` | `false` (already processed) |

**IBLGradient defaults:**
| Field | Expected Value |
|-------|---------------|
| `sky` | `[0.6902, 0.749, 0.7843, 1.0]` (soft blue-gray — different from DomeGradient!) |
| `equator` | `[0.6584, 0.7084, 0.7913, 1.0]` (same as DomeGradient) |
| `ground` | `[0.807, 0.7758, 0.7454, 1.0]` (same as DomeGradient) |
| `intensity` | `1.0` |
| `_needsUpdate` | `false` |

**Key detail**: DomeGradient and IBLGradient have **different** `sky` defaults.

---

### Suite 2: System Registration

**Test 2.1: EnvironmentSystem Present**

```bash
npx @iwsdk/cli ecs systems 2>/dev/null
```

Assert:

- EnvironmentSystem at priority 0
- Query entity counts: `domeGradients: 1`, `iblGradients: 1`, `domeTextures: 0`, `iblTextures: 0`

---

### Suite 3: Component Registration

**Test 3.1: All Environment Components Registered**

```bash
npx @iwsdk/cli ecs components 2>/dev/null
```

Assert these components exist with correct schemas. `ecs components` reports
each field's `type` and `default` only:

| Component      | Key Fields                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DomeGradient` | `sky` (Color), `equator` (Color), `ground` (Color), `intensity` (Float32), `elevationDeg` (Float32, default 90), `azimuthDeg` (Float32, default 0), `dither` (Boolean, default false), `_needsUpdate` (Boolean) |
| `DomeTexture`  | `src` (FilePath), `blurriness` (Float32), `intensity` (Float32), `rotation` (Vec3), `_needsUpdate` (Boolean)                                                                                                    |
| `IBLGradient`  | `sky` (Color), `equator` (Color), `ground` (Color), `intensity` (Float32), `_needsUpdate` (Boolean)                                                                                                             |
| `IBLTexture`   | `src` (FilePath, default: "room"), `intensity` (Float32), `rotation` (Vec3), `_needsUpdate` (Boolean)                                                                                                           |

**Test 3.2: Field Limits in the Scene Capabilities**

```bash
npx @iwsdk/cli scene capabilities --input-json '{"full":true}' 2>/dev/null
```

Find each component in `result.componentSchemas` by `id` and read its
`fields`. Assert:

- `DomeGradient.intensity.min` is `0`
- `DomeGradient.elevationDeg` has `min: -90`, `max: 90`
- `DomeGradient.azimuthDeg` has `min: -180`, `max: 180`
- `IBLGradient.intensity.min` is `0`

---

### Suite 4: Scene Hierarchy

**Test 4.1: Dome Mesh in Scene**

```bash
npx @iwsdk/cli scene runtime-hierarchy --input-json '{"maxDepth":2}' 2>/dev/null
```

The gradient dome mesh is added directly to the scene (not under LevelRoot). Look for an unnamed mesh node at the scene root level.

---

### Suite 5: ECS Data Modification

**Test 5.1: Modify DomeGradient Sky Color**

```bash
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":<root>,"componentId":"DomeGradient","field":"sky","value":"[1.0, 0.0, 0.0, 1.0]"}' 2>/dev/null
```

Then verify:

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<root>,"components":["DomeGradient"]}' 2>/dev/null
```

Assert: `sky` = `[1.0, 0.0, 0.0, 1.0]`

**Test 5.2: Tilt the DomeGradient Without `_needsUpdate`**

```bash
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":<root>,"componentId":"DomeGradient","field":"elevationDeg","value":"30"}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli scene render-stats 2>/dev/null
```

Assert: `result.sceneEnvironment.background` is
`{ type: "dome-gradient", elevationDeg: 30, azimuthDeg: 0, dither: false, ... }`
and its `sky` is `[1, 0, 0, 1]` from Test 5.1. Neither edit set
`_needsUpdate`; DomeGradient and IBLGradient apply edits on the next frame.

**Test 5.3: Modify IBLGradient Intensity**

```bash
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":<root>,"componentId":"IBLGradient","field":"intensity","value":"2.0"}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli scene render-stats 2>/dev/null
```

Assert: `result.sceneEnvironment.imageBasedLighting` is
`{ type: "ibl-gradient", intensity: 2, ... }`.

---

### Suite 6: Stability

```bash
npx @iwsdk/cli browser logs --input-json '{"since":<test-start-ms>,"count":30,"level":["error","warn"]}' 2>/dev/null
```

Assert: No application-level errors or warnings. Pre-existing 404 resource errors from page load are acceptable.

---

## Step 5: Cleanup & Results

Kill the dev server:

```bash
cd $IWSDK_REPO_ROOT/examples/poke && npx @iwsdk/cli dev down
```

Output a summary table:

```
| Suite                    | Result    |
|--------------------------|-----------|
| 1. Authored Environment  | PASS/FAIL |
| 2. System Registration   | PASS/FAIL |
| 3. Component Registration| PASS/FAIL |
| 4. Scene Hierarchy       | PASS/FAIL |
| 5. ECS Data Modification | PASS/FAIL |
| 6. Stability             | PASS/FAIL |
```

If any suite fails, include which assertion failed and actual vs expected values.

---

## Recovery

If at any point a transient error occurs (server crash, WebSocket timeout, connection refused, etc.) that is NOT caused by a source code bug:

1. Stop the dev server: `cd $IWSDK_REPO_ROOT/examples/poke && npx @iwsdk/cli dev down`
2. Restart: re-run Step 2 to start a fresh dev server
3. Re-run the Pre-test Setup (reload, accept session)
4. Retry the failed suite

Only give up after one retry attempt per suite. If the same suite fails twice, mark it FAIL and continue to the next suite.

---

## Known Issues & Workarounds

### Texture components still need `_needsUpdate`

DomeGradient and IBLGradient apply `ecs set-component` edits on the next frame.
DomeTexture and IBLTexture apply an edit only after `_needsUpdate` is set to
`true`.

### \_needsUpdate consumed immediately

The `_needsUpdate` flag is consumed by the EnvironmentSystem and reset to `false`. The response may already show `newValue: false`.

### Environment components are explicit

`LevelSystem` does not synthesize dome or IBL components. Their absence is
meaningful, and each scene must author the background and image-based lighting
it wants on the level root. The poke fixture scene includes both gradient
components explicitly.

### Entity indices change on reload

Never cache entity indices across page reloads. Always re-discover via `npx @iwsdk/cli ecs find`.

### Boolean values must be JSON booleans

When setting boolean fields (like `_needsUpdate`) via `npx @iwsdk/cli ecs set-component`, the `value` must be a JSON boolean (`true`), not a string (`"true"`). Strings silently fail.
