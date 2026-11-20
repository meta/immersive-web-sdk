---
'@iwsdk/core': patch
---

Removing the grabbable component that created a held entity's grab handle (`OneHandGrabbable`, `TwoHandsGrabbable` or `DistanceGrabbable`) now ends the grab. The object stops following the hand right away, and `GrabSystem` removes `Grabbed` on its next update, as it does when the hand lets go or `GrabSystem.forceRelease()` is called, so `Grabbed` release handlers run and queries that exclude `Grabbed` match the entity again. Only that component ends the grab: an entity with several grabbable components has one handle, and removing a component that didn't create it leaves the grab alone. In 1.2.0-rc.0, `Grabbed` stayed on the entity until a grabbable component was added back, even after the hand let go or `GrabSystem.forceRelease()` was called.

Removing a grabbable component also detaches its handle from the object's pointer events now. In 1.2.0-rc.0 the old handle kept capturing presses on the object and stopping them from propagating after the object was no longer grabbable, and once a grabbable was added back, letting go of a distance grab could snap the object back to where the grab started.
