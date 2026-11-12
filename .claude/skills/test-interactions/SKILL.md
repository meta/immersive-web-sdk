---
name: test-interactions
description: 'Test XR interactions (ray, poke/touch, dual-mode, hand poke, audio, UI panel) against the poke example using the iwsdk CLI.'
argument-hint: '[--suite ray|poke|dual|hand|audio|ui|all]'
---

# XR Interaction Test

Test 13 suites covering XR interaction behaviors: entity discovery, ECS registration, ray interaction, poke/touch, dual-mode, cross-entity isolation, input mode switching, rapid poke cycles, audio, UI panel, hand poke, and stability.

**Configuration:**

- EXAMPLE_DIR: `$IWSDK_REPO_ROOT/examples/poke`

**Tool calls**: every tool call is `npx @iwsdk/cli <subcommand> [--input-json '<JSON>'] [--timeout <ms>]`, run from inside the example workspace (cwd `$EXAMPLE_DIR`). The CLI auto-discovers the IWSDK app root from cwd, so no path tricks are required. Run `npx @iwsdk/cli mcp inspect` from the example to discover available tools and their CLI subcommands.

- `<JSON>` is a JSON object string. Omit `--input-json` if no arguments are needed.
- Output is JSON on stdout: `{ok, workspaceRoot, operation, result}`. Parse it to check assertions.
- Use `--timeout 20000` for operations that may take longer (reload, xr enter, xr animate-to, screenshot), and `--timeout 45000` for `xr run-sequence`.

**IMPORTANT**: Run each Bash command one at a time. Parse the JSON output and verify assertions before moving to the next command. Do NOT chain multiple CLI commands together.

**IMPORTANT**: When the instructions say "wait N seconds", use `sleep N` as a separate Bash command.

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

1. Check `/tmp/iwsdk-dev-interactions.log` for errors
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

4. `npx @iwsdk/cli browser logs --input-json '{"since":<test-start-ms>,"count":20,"level":["error"]}' 2>/dev/null`
   Assert: No error-level logs. Warnings about audio autoplay are acceptable.

---

### Suite 1: Entity Discovery

Discover all testable entities dynamically. These entity indices are used by all subsequent suites.

**Test 1.1: Find Robot Entity**

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["Robot"]}' 2>/dev/null
```

Assert: Exactly 1 entity. Save its `entityIndex` as `<robot>`.

**Test 1.2: Find Panel Entity**

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["ScreenSpace"]}' 2>/dev/null
```

Assert: Exactly 1 entity. Save its `entityIndex` as `<panel>`.

**Test 1.3: Get Robot World Position**

```bash
npx @iwsdk/cli scene runtime-hierarchy --input-json '{"maxDepth":3}' 2>/dev/null
```

Find the robot's Object3D UUID (match `entityIndex` = `<robot>`).
Then:

```bash
npx @iwsdk/cli scene transform --input-json '{"uuid":"<robot-uuid>"}' 2>/dev/null
```

Save `positionRelativeToXROrigin` as `<robot-pos>`. Expected near `(0, 0.95, -1.5)`.

**Test 1.4: Get Panel World Position**
Same approach — find panel's UUID from hierarchy, query transform.

```bash
npx @iwsdk/cli scene transform --input-json '{"uuid":"<panel-uuid>"}' 2>/dev/null
```

Save `positionRelativeToXROrigin` as `<panel-pos>`. Expected near `(0, 1.5, -1.2057)`.

---

### Suite 2: ECS Registration

**Test 2.1: List Systems**

```bash
npx @iwsdk/cli ecs systems 2>/dev/null
```

Assert these systems are present: `RobotSystem`, `InputSystem`, `AudioSystem`, `PanelUISystem`, `ScreenSpaceUISystem`.

**Test 2.2: List Components**

```bash
npx @iwsdk/cli ecs components 2>/dev/null
```

Assert these components are registered:

- `Robot`
- `PanelUI` (legacy compatibility component with field: `config`)
- `AudioSource` (with fields: `src`, `loop`, `_loaded`, `_isPlaying`, `_playRequested`)
- `RayInteractable`
- `PokeInteractable`
- `ScreenSpace`

---

### Suite 3: Ray Interaction on Robot

**Test 3.1: Ray Hover**

```bash
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":<robot-pos.x>,"y":<robot-pos.y>,"z":<robot-pos.z>},"moveToDistance":1.0}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: `Hovered` present, `Pressed` absent.

**Test 3.2: Ray Select**

```bash
npx @iwsdk/cli xr set-select-value --input-json '{"device":"controller-right","value":1}' 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: Both `Hovered` and `Pressed` present.

**Test 3.3: Ray Release**

```bash
npx @iwsdk/cli xr set-select-value --input-json '{"device":"controller-right","value":0}' 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: `Hovered` present, `Pressed` absent.

**Test 3.4: Ray Unhover**

```bash
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":5,"y":1.5,"z":0}}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` absent.

---

### Suite 4: Poke Interaction on Robot

The touch pointer uses a `SphereIntersector` with two thresholds:

- `hoverRadius: 0.2m` (20cm) — triggers hover
- `downRadius: 0.02m` (2cm) — triggers auto-select (pointerdown)

**Test 4.1: Position Near Robot**

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-right","position":{"x":<robot-pos.x>,"y":<robot-pos.y>,"z":<z+0.3>},"orientation":{"pitch":0,"yaw":180,"roll":0}}' 2>/dev/null
```

(where `<z+0.3>` = `<robot-pos.z> + 0.3`)

**Test 4.2: Slow Animate Through Robot**

```bash
npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":<robot-pos.x>,"y":<robot-pos.y>,"z":<z-0.3>},"duration":2.5}' --timeout 20000 2>/dev/null
```

(where `<z-0.3>` = `<robot-pos.z> - 0.3`)
Then: `sleep 1.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: At least `Hovered` present. `Pressed` may also be present.

**Test 4.3: Pull Back**

```bash
npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":0.3,"y":1.5,"z":-0.3},"duration":0.3}' --timeout 20000 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: Neither `Hovered` nor `Pressed` present.

---

### Suite 5: Ray Interaction on Panel

**Setup: aim the left controller away from the panel.** The left controller's
default pose, (-0.25, 1.5, -0.4) facing -Z, points its ray at the panel, so the
panel would stay `Hovered` through Suites 5–7 whatever the right controller does.
Turn it to face -X (yaw 90), away from the panel; Suites 5–7 do not move it
again.

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-left","position":{"x":-0.25,"y":1.5,"z":-0.4},"orientation":{"pitch":0,"roll":0,"yaw":90}}' 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` absent before Test 5.1.

**Test 5.1: Ray Hover**

```bash
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":<panel-pos.x>,"y":<panel-pos.y>,"z":<panel-pos.z>},"moveToDistance":0.8}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` present.

**Test 5.2: Click**

```bash
npx @iwsdk/cli xr select --input-json '{"device":"controller-right","duration":0.2}' 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` still present.

**Test 5.3: Unhover**

```bash
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":5,"y":1.5,"z":0}}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` absent.

---

### Suite 6: Dual-Mode Interaction (Panel — Ray + Poke)

**Test 6.1: Ray Hover from Distance**

```bash
npx @iwsdk/cli xr look-at --input-json '{"device":"controller-right","target":{"x":<panel-pos.x>,"y":<panel-pos.y>,"z":<panel-pos.z>},"moveToDistance":0.8}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` present.

**Test 6.2: Poke on Panel**

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-right","position":{"x":<panel-pos.x>,"y":<panel-pos.y>,"z":<pz+0.2>},"orientation":{"pitch":0,"roll":0,"yaw":0}}' 2>/dev/null
```

(where `<pz+0.2>` = `<panel-pos.z> + 0.2`)

```bash
npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":<panel-pos.x>,"y":<panel-pos.y>,"z":<pz-0.01>},"duration":3}' --timeout 20000 2>/dev/null
```

(where `<pz-0.01>` = `<panel-pos.z> - 0.01` — stop just past the panel surface, NOT far behind it)

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: Both `Hovered` and `Pressed` present.

**Test 6.3: Poke Release**

```bash
npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":0.3,"y":1.5,"z":-0.3},"duration":0.3}' --timeout 20000 2>/dev/null
```

The rest position still faces -Z, and from there the ray reaches the panel.
Turn the controller away so only the poke release is measured:

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-right","position":{"x":0.3,"y":1.5,"z":-0.3},"orientation":{"pitch":0,"roll":0,"yaw":-90}}' 2>/dev/null
```

Then: `sleep 0.5`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: Neither present.

---

### Suite 7: Cross-Entity Isolation

**Test 7.1: Only Target Entity Gets Hovered**

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-right","position":{"x":<rx+0.1>,"y":<robot-pos.y>,"z":<rz+0.3>},"orientation":{"pitch":0,"roll":0,"yaw":180}}' 2>/dev/null
```

(where `<rx+0.1>` = `<robot-pos.x> + 0.1`, `<rz+0.3>` = `<robot-pos.z> + 0.3`)
Then: `sleep 1`

Check robot:

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` present on robot.

Check panel:

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["Hovered","Pressed"]}' 2>/dev/null
```

Assert: No interaction components on panel.

---

### Suite 8: Input Mode Switching

**Test 8.1: Hand Hover**

```bash
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"hand-right","position":{"x":<rx+0.1>,"y":<robot-pos.y>,"z":<rz+0.3>}}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` present.

**Test 8.2: Switch Back to Controllers**

```bash
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"controller"}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-right","position":{"x":0.3,"y":1.5,"z":-0.3},"orientation":{"pitch":0,"roll":0,"yaw":0}}' 2>/dev/null
```

Then: `sleep 1`

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Hovered"]}' 2>/dev/null
```

Assert: `Hovered` absent (clean transition).

---

### Suite 9: Rapid Poke Cycles (Regression)

Test that multiple poke-release cycles all clean up properly (no stuck Pressed).

For each of 3 cycles:

1. Position at `{x: <robot-pos.x>, y: <robot-pos.y>, z: <robot-pos.z> + 0.4}` with yaw 180:
   ```bash
   npx @iwsdk/cli xr set-transform --input-json '{"device":"controller-right","position":{"x":<robot-pos.x>,"y":<robot-pos.y>,"z":<rz+0.4>},"orientation":{"pitch":0,"yaw":180,"roll":0}}' 2>/dev/null
   ```
2. Animate through:
   ```bash
   npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":<robot-pos.x>,"y":<robot-pos.y>,"z":<rz-0.3>},"duration":1.5}' --timeout 20000 2>/dev/null
   ```
3. `sleep 1.5`, then query `<robot>` for `["Hovered","Pressed"]`. Assert: at least `Hovered` or `Pressed` present.
4. Animate back:
   ```bash
   npx @iwsdk/cli xr animate-to --input-json '{"device":"controller-right","position":{"x":<robot-pos.x>,"y":<robot-pos.y>,"z":<rz+0.5>},"duration":0.3}' --timeout 20000 2>/dev/null
   ```
5. `sleep 0.5`, then query `<robot>` for `["Hovered","Pressed"]`. Assert: neither present.

All 3 cycles must pass.

---

### Suite 10: Audio

**Test 10.1: Find Audio Entities**

```bash
npx @iwsdk/cli ecs find --input-json '{"withComponents":["AudioSource"]}' 2>/dev/null
```

Assert: At least 1 entity found. Use the first as `<audio>`.

**Test 10.2: Verify Audio Loaded**

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<audio>,"components":["AudioSource"]}' 2>/dev/null
```

Assert: `_loaded` = `true`, `src` contains `chime.mp3`.

**Test 10.3: Trigger Playback**

```bash
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":<audio>,"componentId":"AudioSource","field":"loop","value":true}' 2>/dev/null
```

```bash
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":<audio>,"componentId":"AudioSource","field":"_playRequested","value":true}' 2>/dev/null
```

Note: `_playRequested` is consumed within one frame.

**Test 10.4: Verify Playback State**

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<audio>,"components":["AudioSource"]}' 2>/dev/null
```

Assert: `_isPlaying` = `true` (loop is on).

**Test 10.5: Stop Playback**

```bash
npx @iwsdk/cli ecs set-component --input-json '{"entityIndex":<audio>,"componentId":"AudioSource","field":"_stopRequested","value":true}' 2>/dev/null
```

---

### Suite 11: UI Panel Verification

**Test 11.1: Panel Loading**

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<panel>,"components":["ScreenSpace","RayInteractable","PokeInteractable"]}' 2>/dev/null
```

Assert:

- `ScreenSpace` component IS present
- `RayInteractable` and `PokeInteractable` are present
- `PanelUI` and `PanelDocument` are absent because the panel is a UIKitML
  asset object

**Test 11.2: Visual Confirmation**

```bash
npx @iwsdk/cli browser screenshot --timeout 20000 2>/dev/null
```

Assert: returns a `screenshotPath` (PNG file saved to /tmp).

---

### Suite 12: Hand Poke by Target (run_sequence)

The emulated hand presses with its index fingertip, moving like a person, and
IWSDK resolves the target names the sequence uses.

**Test 12.1: Hand Input and Targets**

```bash
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}' 2>/dev/null
```

```bash
npx @iwsdk/cli xr list-targets 2>/dev/null
```

Assert: `resolver` is `true` and `targets` includes `Robot`, `Welcome Panel`, and
`counter-button`.

**Test 12.2: Press the Counter Button Once**

```bash
npx @iwsdk/cli ui inspect --input-json '{"entityIndex":<panel>,"selector":"#counter-button"}' 2>/dev/null
```

Save the element's `text` (`Click - N`) as `<count-before>`.

```bash
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"label":"press","target":"counter-button","press":{}}]}' --timeout 45000 2>/dev/null
```

Assert: `completed` is `true` and `presses[0].contactMs` is below 800 (a click
needs the fingertip to leave within 800 ms). If it is 800 or more on a loaded
machine, save the text again as `<count-before>` and rerun the press once before
failing. Then `sleep 0.5` and inspect the button again. Assert: its text is
`Click - N+1`, exactly one more than `<count-before>`.

**Test 12.3: Touch and Leave the Robot**

```bash
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"label":"touch","target":"Robot","anchor":"index-tip","poseId":"point"}]}' --timeout 45000 2>/dev/null
```

```bash
npx @iwsdk/cli ecs query --input-json '{"entityIndex":<robot>,"components":["Pressed"]}' 2>/dev/null
```

Assert: `Pressed` present (the fingertip rests on the robot's front face).

```bash
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"label":"pull back","target":"Robot","anchor":"index-tip","offset":{"normal":0.15}}]}' --timeout 45000 2>/dev/null
```

Then query `<robot>` and `<panel>` for `["Pressed"]`. Assert: absent on both.

**Test 12.4: Back to Controllers**

```bash
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"controller"}' 2>/dev/null
```

---

### Suite 13: Stability Check

```bash
npx @iwsdk/cli browser logs --input-json '{"since":<test-start-ms>,"count":50,"level":["error","warn"]}' 2>/dev/null
```

Assert: No error-level logs. Warnings about `AudioContext` autoplay policy are acceptable. Pre-existing 404 resource errors from page load are acceptable.

---

## Step 5: Cleanup & Results

Kill the dev server:

```bash
cd $IWSDK_REPO_ROOT/examples/poke && npx @iwsdk/cli dev down
```

Output a summary table:

```
| Suite                         | Result    |
|-------------------------------|-----------|
| 1. Entity Discovery           | PASS/FAIL |
| 2. ECS Registration           | PASS/FAIL |
| 3. Ray Interaction (Robot)    | PASS/FAIL |
| 4. Poke Interaction (Robot)   | PASS/FAIL |
| 5. Ray Interaction (Panel)    | PASS/FAIL |
| 6. Dual-Mode (Panel)          | PASS/FAIL |
| 7. Cross-Entity Isolation     | PASS/FAIL |
| 8. Input Mode Switching       | PASS/FAIL |
| 9. Rapid Poke Cycles          | PASS/FAIL |
| 10. Audio                     | PASS/FAIL |
| 11. UI Panel                  | PASS/FAIL |
| 12. Hand Poke                 | PASS/FAIL |
| 13. Stability                 | PASS/FAIL |
```

If any suite fails, include which assertion failed and actual vs expected values.

---

## Recovery

If at any point a transient error occurs (server crash, WebSocket timeout, connection refused, etc.) that is NOT caused by a source code bug:

1. Stop the dev server: `cd $IWSDK_REPO_ROOT/examples/poke && npx @iwsdk/cli dev down`
2. Restart: re-run Step 2 to start a fresh dev server
3. Re-run the Pre-test Setup (reload, accept session)
4. If the failed suite is 5, 6 or 7, re-run the Suite 5 setup step first: the
   reload puts the left controller back at its default pose, where its ray
   hovers the panel
5. Retry the failed suite

Only give up after one retry attempt per suite. If the same suite fails twice, mark it FAIL and continue to the next suite.

---

## Known Issues & Workarounds

### Stray controller rays hover the panel

Both controllers' default poses face -Z, and the panel sits in front of the
player, so either ray can hover it. Suites 5–7 turn the left controller away
first and turn the right controller away in Test 6.3. If the panel unexpectedly
keeps `Hovered`, check `xr get-transform` for both controllers before suspecting
the interaction system.

### Poke timing sensitivity

The slow animation in poke suites (2-2.5 seconds) is critical. The poke system uses a 2cm `downRadius` threshold — if the controller moves too fast, it can skip past the threshold between frames.

### Audio autoplay

Browsers block audio autoplay until user gesture. The `_playRequested` flag may silently fail. If `_isPlaying` is false, this is a browser policy issue, not a bug.

### One-shot flags consumed immediately

`_playRequested` and `_stopRequested` are processed and reset to `false` within a single frame.

### Entity indices change on reload

Never cache entity indices across page reloads. Always re-discover via `npx @iwsdk/cli ecs find`.

### Touch pointer not enabled

`toggleSubPointer('touch', true)` must be called when entities are created, not just at init time.

### Pressed stuck after poke pull-back

Fixed: `processTouchLifecycle` now dispatches `pointer.up()` when intersection is lost in SELECT state.
