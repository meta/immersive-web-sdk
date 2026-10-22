---
name: iwsdk-ray
description: Verify ray clicks, UIKit selections, and DistanceGrabbable interactions with emulated XR controllers. Use for pointing, selecting, pressing spatial UI, or moving an object through a distance grab.
argument-hint: '(use the current request)'
---

# IWSDK Ray Interaction

Choose one interaction branch from measured target components. Ray clicks and
distance grabs share aiming but not input duration or movement behavior.

## Locate and aim once

1. Check XR session state and enter only when inactive.
2. Find the named entity or runtime-named UIKit control, then query its
   components and transform. For UIKit, prefer the live name assigned through
   `requireElementById`; use a project test hook only when no addressable runtime
   target exists.
3. Aim the requested controller with `xr look-at`. Do not translate the
   controller toward a ray target. The transform of an open shape (a ring, a
   knot) can sit in empty space: aim at its surface, such as the rim at
   transform + (0, radius, 0), and confirm `Hovered` before pressing.

## Select exactly one branch

### Click or UIKit button

For `RayInteractable`, `Pressed`, or a UIKit control, use one normal select:

```bash
npx @iwsdk/cli xr select --input-json '{"device":"controller-right","duration":0.2}'
```

Use an explicit select-value press/release only when the task needs to inspect
the held interval. Query the named application state or control effect after the
click; a screenshot alone is not interaction proof.

### Distance grab

For `DistanceGrabbable`, hold trigger button index `0`, optionally move the
controller, then release index `0`:

```json
{"device":"controller-right","buttons":[{"index":0,"value":1}]}
```

Check `movementMode` before deciding whether the object should remain remote or
move toward the hand. Query `Grabbed` or transform state while held and after
release. Do not substitute squeeze index `1`; that is the proximity-grab path.

For `MoveFromTarget`, do not inspect implementation source. Before pressing,
record controller position `P` and object position `S`, and compute the grab
distance `d = |S - P|`. While trigger is held, call `xr look-at` with the
requested object destination as `target` and `moveToDistance: d`; this preserves
the ray distance while moving its endpoint to the destination. Query the object
before release to confirm the move, then release and query again.

## Evidence and stopping

For a task with both a click and a distance grab, locate/aim/click/query the first
target, then locate/aim/hold-move-release/query the second. Do not rediscover the
CLI family, inspect pointer internals, or guess panel offsets from screenshots.

Capture one runtime image only when visual placement is part of the request.
When the request names an artifact path, save it directly with
`npx @iwsdk/cli browser screenshot --output-file <path>`; do not capture into model
context and then add a copy step.
Stop when the real input and resulting named state are proven, leaving all
buttons released.
