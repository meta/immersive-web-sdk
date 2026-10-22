---
name: xr-mode-test
description: Test XR session lifecycle and mode transitions. Use when verifying XR enter/exit behavior, testing mode-dependent features, or debugging session state issues.
disable-model-invocation: true
---

# XR Mode Toggle Test

Test the XR session lifecycle by entering and exiting XR mode, verifying state transitions at each step.

## Test Flow

### 1. Check Initial State

Use `mcp__iwsdk-runtime__xr_get_session_status` to confirm starting state:

- In 2D mode: no active session
- Already in XR: note current state before proceeding

### 2. Enter XR Mode

Use `mcp__iwsdk-runtime__xr_accept_session` to enter XR.

### 3. Verify XR Session Active

Use `mcp__iwsdk-runtime__xr_get_session_status` to confirm:

- Session is active
- `visibilityState` is `"visible"`

### 4. Optional: Verify Input Devices

Use `mcp__iwsdk-runtime__xr_get_device_state` to check:

- Controllers are connected
- Headset position is valid

### 5. Exit XR Mode

Use `mcp__iwsdk-runtime__xr_end_session` to leave XR.

### 6. Verify Session Ended

Use `mcp__iwsdk-runtime__xr_get_session_status` to confirm:

- No active session
- Back to 2D mode

### 7. Check Application State

Use `mcp__iwsdk-runtime__browser_get_console_logs` to verify:

- Any mode-switch logs fired correctly
- Application state reset as expected (if applicable)

## Arguments

If `$ARGUMENTS` is provided, use it as a log pattern filter for step 7.

Example: `/xr-mode-test "MODE|RESET"` will filter logs for "MODE" or "RESET" patterns.

## Expected Results

Report:

- Whether each step passed or failed
- Any unexpected state or errors
- Time taken for session transitions
- Relevant log messages from the application
