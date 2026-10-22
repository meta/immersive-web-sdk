---
name: test-all
description: 'Parallel test orchestrator. Runs all 9 test suites concurrently via Task sub-agents and the iwsdk CLI. Handles build, example setup, dev servers, agent launch, polling, retries, and result aggregation.'
argument-hint: '[--skip <test-name>] [--only <test-name>]'
---

# Test All — Parallel Orchestrator

Runs all 9 IWSDK test suites simultaneously. The orchestrator handles the full lifecycle: build, example prep, dev servers, sub-agent launch, polling, retries, cleanup, and aggregate reporting.

Each test gets its own example directory and dev server. Sub-agents read the skill files and execute tests through the direct `npx @iwsdk/cli` flow described in each skill.

---

## Test Map

| Agent             | Example Dir               | Suites | Skill File                 |
| ----------------- | ------------------------- | ------ | -------------------------- |
| test-interactions | examples/poke             | 13     | test-interactions/SKILL.md |
| test-ecs-core     | examples/poke-ecs         | 8      | test-ecs-core/SKILL.md     |
| test-environment  | examples/poke-environment | 6      | test-environment/SKILL.md  |
| test-level        | examples/poke-level       | 5      | test-level/SKILL.md        |
| test-ui           | examples/poke-ui          | 5      | test-ui/SKILL.md           |
| test-audio        | examples/audio            | 6      | test-audio/SKILL.md        |
| test-grab         | examples/grab             | 6      | test-grab/SKILL.md         |
| test-locomotion   | examples/locomotion       | 6      | test-locomotion/SKILL.md   |
| test-physics      | examples/physics          | 5      | test-physics/SKILL.md      |

Ports are **not** pre-assigned. Each dev server picks its own port dynamically. The orchestrator can discover each active URL from the server logs or `npx @iwsdk/cli dev status`, but the sub-agent skills no longer need the port explicitly.

---

## Phase 1: Prerequisites & Build

```bash
node -v
```

```bash
pnpm -v
```

Verify node >= 20.19.0 and pnpm is available. Stop on failure.

```bash
pnpm install
```

```bash
cd packages/vite-plugin-dev && npx playwright install chromium && cd ../..
```

```bash
pnpm build:tgz
```

All must succeed. **Stop on failure.** Note: `npx playwright` must run from `packages/vite-plugin-dev` where playwright is a dependency.

---

## Phase 2: Prepare Examples

### Clone poke for tests that share it

5 tests use the poke example. Clone it into separate directories so each gets its own dev server:

```bash
node scripts/test-prep.mjs clone
```

### Fresh install all 9 examples in parallel

```bash
node scripts/test-prep.mjs install
```

---

## Phase 3: Start 9 Dev Servers

Start all dev servers, wait for them to be ready, and discover their active URLs. This single command handles everything — starting servers, polling for readiness, and outputting the current port map:

```bash
node scripts/test-servers.mjs start
```

The output is JSON with the current port map: `{"poke": 8084, "poke-ecs": 8082, ...}`. Keep it for diagnostics, but the sub-agents should rely on the direct CLI flow inside each example directory rather than passing ports around.

If any server fails to start within 60 seconds, the script reports which ones are missing and exits with code 1. Check `/tmp/iwsdk-dev-<name>.log` for errors.

To re-check ports later without restarting:

```bash
node scripts/test-servers.mjs ports
```

---

## Phase 4: Launch 9 Sub-Agents

For each test, launch a Task sub-agent with `subagent_type: "Bash"`, `mode: "bypassPermissions"`, and `run_in_background: true`.

### Sub-agent prompt template

Each sub-agent gets this prompt (with `<SKILL_FILE>`, `<EXAMPLE_DIR>`, and `<ROOT>` substituted):

```
Read the file at <ROOT>/.claude/skills/<SKILL_FILE> and execute the test instructions
starting from Step 3 (Verify Connectivity). Steps 1 and 2 have already been completed —
the dev server for <EXAMPLE_DIR> is already running.

Execute all test suites (Steps 3-4), then do Step 5 (cleanup and results summary).
Do NOT kill the dev server in cleanup — the parent agent will handle that.
```

### Launch all 9 agents

Launch all 9 Task agents in a **single message** with multiple Task tool calls. This starts them concurrently.

Save each agent's `task_id` and `output_file` from the tool result. Track them:

```
agents = {
  "test-interactions": { task_id: "...", output_file: "...", example_dir: "examples/poke", status: "running" },
  "test-ecs-core":     { task_id: "...", output_file: "...", example_dir: "examples/poke-ecs", status: "running" },
  ...
}
```

---

## Phase 5: Wait for Agents to Complete

After launching all 9 agents, simply wait. The system automatically delivers a completion notification when each agent finishes. **Do NOT poll, do NOT run bash commands to check output files.** Just wait for the notifications.

As each agent completes, note its result (PASS/FAIL and suite counts) from the notification. When all 9 have reported, proceed to Phase 7.

**Hard timeout: 20 minutes total** from Phase 4 start. If any agent hasn't completed by then, use `Read` on its `output_file` to check what happened, then mark it as TIMEOUT and proceed to Phase 7.

---

## Phase 6: Retry Failed Agents

If any agent fails due to a transient error (not a test assertion failure):

1. Use `Task(resume: <task_id>)` to continue the agent with its full context
2. Wait for its completion notification
3. If it fails again, mark it FAIL and move on

### Retry limits

- Max 1 retry per agent
- Only retry transient failures (connection refused, timeout) — not test assertion failures

**IMPORTANT**: Do NOT use improvised bash commands (kill, lsof, etc.) for retries. Use `node scripts/test-servers.mjs stop` and `node scripts/test-servers.mjs start` if a server needs restarting. All bash commands in this skill must be one of the pre-approved `node scripts/...` commands or the Phase 1 build commands.

---

## Phase 7: Results & Cleanup

### Kill all dev servers

```bash
node scripts/test-servers.mjs stop
```

### Delete poke clones

```bash
node scripts/test-prep.mjs cleanup
```

### Aggregate Results

Collect each agent's summary table from its output file. Print a grand summary:

```
========================================
  IWSDK Test Suite — Full Results
========================================

| Test              | Suites | Result  |
|-------------------|--------|---------|
| test-interactions | 13/13  | PASS    |
| test-ecs-core     |  8/8   | PASS    |
| test-environment  |  6/6   | PASS    |
| test-level        |  5/5   | PASS    |
| test-ui           |  5/6   | PASS    |
| test-audio        |  6/6   | PASS    |
| test-grab         |  6/6   | PASS    |
| test-locomotion   |  6/6   | PASS    |
| test-physics      |  5/5   | PASS    |
|-------------------|--------|---------|
| TOTAL             | 60/61  | 9/9 PASS|

========================================
```

If any test failed, include the failure details from that agent's output.

---

## Key Design Decisions

### Orchestrator manages dev servers, sub-agents run tests

Sub-agents (Task tool) cannot run background processes. The orchestrator starts all 9 dev servers, records their dynamically-assigned ports for diagnostics, then launches sub-agents that only execute the test steps. Each sub-agent reads its skill file and starts from Step 3 (Verify Connectivity).

### Runtime-first server discovery for diagnostics

Ports are NOT pre-assigned. Each dev server is started with `npm run dev` and Vite picks an available port automatically. The orchestrator may still collect the resulting port map for diagnostics, but that data is only for the parent agent's visibility. Sub-agents should treat the running example directory as the source of truth and use the direct `npx @iwsdk/cli` flow from inside that directory.

### Sub-agents read skill files directly

Each sub-agent reads its SKILL.md at runtime. No extraction or text munging needed — the sub-agent is told to skip Steps 1-2 (already done) and start from Step 3. Do NOT pass ports in the prompt.

### TaskOutput vs file-based polling

Background Task agents write output to a file. Use `Read` tool on the output_file to check progress. This is more reliable than parsing process stdout.

### Boolean values must be JSON booleans

When setting boolean fields via `ecs_set_component`, the `value` must be a JSON boolean (`true`), not a string (`"true"`). Strings silently fail to coerce.

---

## Troubleshooting

### Agent finishes but no summary table

The sub-agent may have hit its turn limit. Check the end of its output for truncation. Relaunch with the same prompt.

### Port already in use

Run `node scripts/test-servers.mjs stop` to clear the managed dev servers before relaunching.

### fresh:install fails

Check that `pnpm build:tgz` succeeded and the tarballs exist in the package directories.

### All agents stuck at "Verify Connectivity"

The dev servers may not have started. Check `/tmp/iwsdk-dev-*.log` for errors.

### Clone directory already exists

The rsync command will overwrite existing files. If you need a clean slate, delete the clone directories first.

### Sub-agent can't start dev server

This is expected — sub-agents cannot run background processes. The orchestrator must start all dev servers before launching sub-agents.
