---
'@iwsdk/cli': minor
'@iwsdk/vite-plugin-dev': minor
'@iwsdk/core': minor
'@iwsdk/create': minor
---

Agents and scripts can now drive the emulator's hands the way a person moves them, so an app's real poke, pinch and grab code reacts. The emulator moves to IWER 2.7.0, and its hand tools are new MCP tools and `iwsdk xr` commands: `xr_run_sequence` (`xr run-sequence`) runs a whole interaction in one call (press a button with the index fingertip, pinch-grab an object, carry it, set it down, gesture), with `xr_cancel_sequence` and `xr_list_targets`; `xr_set_hand_pose`, `xr_get_hand_state` and `xr_microgesture` shape, read and gesture a hand. `xr_set_transform` and `xr_animate_to` also place a hand by a point on it (`anchor`) and orient it by direction or `"auto"`, `xr_set_select_value` ramps over `duration`, and `xr_set_device_state` takes each hand's `poseId` and `pinchValue`. The schemas mirror IWER's, and a misspelt key inside a union now names that key instead of reporting "a supported shape". Hand sequences get a 40 s command timeout, and the default timeout of a pose fade, select ramp or animation grows by its `duration`.

Sequence steps name their targets: IWSDK registers a target resolver with the emulator that finds interactable entities by name (`Map Pin 1`), the UIKitML element IDs inside them (`counter-button`), scene node IDs and UUIDs, and reports surface points, normals and boxes relative to the XR origin (`MCPRuntime.targetResolver`, `SceneTargetResolver`). The generated agent skills include hand recipes for pressing UI and pinch-grabbing.
