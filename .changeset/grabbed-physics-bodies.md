---
'@iwsdk/core': patch
---

Grabbing a dynamic physics body no longer flings its neighbours or launches it on release. A held body is now kinematic and moves evenly across every physics substep; before, a frame that ran several substeps (as slow emulator frames do) overshot the hand each time and could diverge to positions kilometres away. A hand pose jump faster than a hand can move, such as an emulator controller teleport, now moves the held body without sweeping it through its neighbours. On release, the body becomes dynamic again with the hand's smoothed velocity, capped at 10 m/s. The generated physics guidance describes the new behavior.
