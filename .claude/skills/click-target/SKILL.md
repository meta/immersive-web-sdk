---
name: click-target
description: Find and click a target object in XR. Use when testing UI interactions, clicking buttons, or verifying interactable elements work correctly.
disable-model-invocation: true
---

# Click Target in XR

Find a target object in the scene and click it using a controller, then verify the click registered.

## Arguments

`$ARGUMENTS` should be a description of the target to find (e.g., "the RESTART button", "the scoreboard", "the settings panel").

## Workflow

### 1. Get Scene Hierarchy

Use `mcp__iwsdk-runtime__scene_get_runtime_hierarchy` to find the target object's UUID.

- Look for objects with entityIndex (these are ECS entities)
- PanelUI elements typically have nested children for their content

### 2. Get Target Transform

Use `mcp__iwsdk-runtime__scene_get_object_transform` with the target UUID.

- Use `positionRelativeToXROrigin` for all positioning operations
- Note the position for the next steps

### 3. Position Headset to Look at Target

Use `mcp__iwsdk-runtime__xr_look_at` with device `headset` and the target position.

- This orients the headset to face the target

### 4. Screenshot to Verify Target Visible

Use `mcp__iwsdk-runtime__browser_screenshot` to verify:

- Target is visible in the view
- Target is not occluded by other objects
- If not visible, use `mcp__iwsdk-runtime__xr_look_at` with `moveToDistance` to get closer

### 5. Position Controller

Use `mcp__iwsdk-runtime__xr_get_transform` to check controller position.

- If controller is visible in screenshot and not occluding target, proceed
- If controller is far away or not visible:
  1. Get headset position with `mcp__iwsdk-runtime__xr_get_transform`
  2. Set controller to headset position with `mcp__iwsdk-runtime__xr_set_transform`
  3. Micro-adjust: offset x by +0.25 (right) or -0.25 (left), y by -0.1, z by -0.3

### 6. Point Controller at Target

Use `mcp__iwsdk-runtime__xr_look_at` with the controller device and target position.

- For UI elements on panels, you may need to target a specific child element
- If the target is a button on a panel, the button may be offset from the panel center

### 7. Click

Use `mcp__iwsdk-runtime__xr_select` with the controller device.

### 8. Verify Click

Use `mcp__iwsdk-runtime__browser_get_console_logs` with a pattern to check for expected log messages.

- If no logs match, the click may have missed - adjust target position and retry
- Common adjustments: change x or z by 0.05-0.1 to hit child elements

## Tips

- For PanelUI buttons, the button position is often offset from the panel center
- Use `mcp__iwsdk-runtime__scene_get_object_transform` on child elements to find exact button positions
- Always verify with console logs rather than assuming from visuals
- The ray visual in screenshots can be misleading - test with actual clicks
- Either controller (left or right) can be used

## Example

To click the RESTART button on the pong scoreboard:

1. Find scoreboard entity (entityIndex 6 in the pong game)
2. Scoreboard is at (0, -0.798, -1.25)
3. Button is at approximately (0.05, -0.798, -1.109) - offset toward player
4. Point controller at button position and click
5. Verify "[BUTTON CLICKED]" appears in console logs
