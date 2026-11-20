---
'@iwsdk/core': patch
'@iwsdk/xr-input': patch
---

Controller squeeze grabs now work next to and on pokeable objects. A squeeze used to do nothing while a `PokeInteractable` was within touch range of the controller tip (about 15 cm), for example a keycard inside a pokeable drawer or a climbing hold under a HUD panel. On an entity with both `OneHandGrabbable` and `PokeInteractable`, the controller tip's poke grabbed the object as it arrived, and that grab never let go. Now a squeeze grabs whatever the grab sphere touches and keeps it until the squeeze ends, and a poke presses an entity (`Pressed`, `click`) without grabbing it. A hand pinch also grabs a pokeable grabbable while the fingertip presses it, and an object held by a pinch keeps following the hand while the fingertip presses something.

A squeeze or a hand pinch that grabs something interrupts a poke press in progress, as a browser cancels a touch: the poked object gets `pointercancel` and `pointerleave` instead of `pointerup` and `click`, so the poke no longer keeps it `Pressed` (or UIKit-active) and doesn't click it, and the tip has to move more than 2 cm away from every pokeable before it hovers or presses again. While a squeeze holds a grab, the tip doesn't poke or hover, so a pokeable it was hovering gets `pointerleave` and loses `Hovered` as the grab starts. A squeeze grab also ends when the input source stops reporting the squeeze, for example when the controller is put down mid-squeeze and a tracked hand takes over, instead of keeping that hand locked on the grab.

Behavior change: a poke no longer moves a grabbable. A fingertip or controller tip used to grab a grabbable that is `PokeInteractable` (or part of one) and push it along until the tip lifted off, so a `OneHandGrabbable` limited to one axis worked as a fingertip slider, lever or drawer. Now such an object moves only while a squeeze or pinch holds it. For a control the fingertip should drag, make it `PokeInteractable` rather than grabbable and set its value from its pointer events, for example from `event.point` while it is pressed, and call `setPointerCapture(event.pointerId)` on its `object3D` in its `pointerdown` listener so the press survives the fingertip sliding off it.

Because a poke no longer grabs, a poke on a grabbable that isn't pokeable itself reaches its pokeable ancestor: poking a keycard parented under a pokeable drawer presses the drawer, as poking any other part of the drawer does. Add `PokeInteractable` to the keycard if it should take the poke itself.

`@iwsdk/core` now needs `@pmndrs/handle` 6.6.28 or later, the first release with the handle `filter` option this relies on.
