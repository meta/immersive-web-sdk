# @iwsdk/core

## 1.2.0-rc.1

### Patch Changes

- 2a7cd96: `iwsdk dev up` and `dev restart` no longer re-create coding-agent guidance you removed. In 1.2.0-rc.0 every start put back deleted skills and `Skill(iwsdk-*)` permissions, a deleted `AGENTS.md`, and the managed block and `@AGENTS.md` import in a replaced `AGENTS.md` or `CLAUDE.md`. They now update only the guidance a project already has and nobody edited, and replace retired guidance whole: an unedited skill or file that a release renamed or retired is removed only together with writing its successors, and each successor gets the retired skill's permission if it had one. A 0.4 or 0.5 app gets `iwsdk-dev` for `iwsdk-planner`, Cursor and Copilot guidance for the single files 0.4 wrote, and an `AGENTS.md` block for the guidance its `CLAUDE.md` held. Apart from that they never add a skill, file, block, import or permission the project lacks, whether you removed it or it is new in the installed release; when they refresh, the notice lists the skills and files left out. The guidance manifest in `@iwsdk/core` now names what replaces each retired unit. `iwsdk agents sync` and `iwsdk upgrade` still install the full set, and `iwsdk agents check` still reports what is missing.
- c6f0c4b: Removing the grabbable component that created a held entity's grab handle (`OneHandGrabbable`, `TwoHandsGrabbable` or `DistanceGrabbable`) now ends the grab. The object stops following the hand right away, and `GrabSystem` removes `Grabbed` on its next update, as it does when the hand lets go or `GrabSystem.forceRelease()` is called, so `Grabbed` release handlers run and queries that exclude `Grabbed` match the entity again. Only that component ends the grab: an entity with several grabbable components has one handle, and removing a component that didn't create it leaves the grab alone. In 1.2.0-rc.0, `Grabbed` stayed on the entity until a grabbable component was added back, even after the hand let go or `GrabSystem.forceRelease()` was called.

  Removing a grabbable component also detaches its handle from the object's pointer events now. In 1.2.0-rc.0 the old handle kept capturing presses on the object and stopping them from propagating after the object was no longer grabbable, and once a grabbable was added back, letting go of a distance grab could snap the object back to where the grab started.

- 930331d: Controller squeeze grabs now work next to and on pokeable objects. A squeeze used to do nothing while a `PokeInteractable` was within touch range of the controller tip (about 15 cm), for example a keycard inside a pokeable drawer or a climbing hold under a HUD panel. On an entity with both `OneHandGrabbable` and `PokeInteractable`, the controller tip's poke grabbed the object as it arrived, and that grab never let go. Now a squeeze grabs whatever the grab sphere touches and keeps it until the squeeze ends, and a poke presses an entity (`Pressed`, `click`) without grabbing it. A hand pinch also grabs a pokeable grabbable while the fingertip presses it, and an object held by a pinch keeps following the hand while the fingertip presses something.

  A squeeze or a hand pinch that grabs something interrupts a poke press in progress, as a browser cancels a touch: the poked object gets `pointercancel` and `pointerleave` instead of `pointerup` and `click`, so the poke no longer keeps it `Pressed` (or UIKit-active) and doesn't click it, and the tip has to move more than 2 cm away from every pokeable before it hovers or presses again. While a squeeze holds a grab, the tip doesn't poke or hover, so a pokeable it was hovering gets `pointerleave` and loses `Hovered` as the grab starts. A squeeze grab also ends when the input source stops reporting the squeeze, for example when the controller is put down mid-squeeze and a tracked hand takes over, instead of keeping that hand locked on the grab.

  Behavior change: a poke no longer moves a grabbable. A fingertip or controller tip used to grab a grabbable that is `PokeInteractable` (or part of one) and push it along until the tip lifted off, so a `OneHandGrabbable` limited to one axis worked as a fingertip slider, lever or drawer. Now such an object moves only while a squeeze or pinch holds it. For a control the fingertip should drag, make it `PokeInteractable` rather than grabbable and set its value from its pointer events, for example from `event.point` while it is pressed, and call `setPointerCapture(event.pointerId)` on its `object3D` in its `pointerdown` listener so the press survives the fingertip sliding off it.

  Because a poke no longer grabs, a poke on a grabbable that isn't pokeable itself reaches its pokeable ancestor: poking a keycard parented under a pokeable drawer presses the drawer, as poking any other part of the drawer does. Add `PokeInteractable` to the keycard if it should take the poke itself.

  `@iwsdk/core` now needs `@pmndrs/handle` 6.6.28 or later, the first release with the handle `filter` option this relies on.

- 4e37890: Grabbing a dynamic physics body no longer flings its neighbours or launches it on release. A held body is now kinematic and moves evenly across every physics substep; before, a frame that ran several substeps (as slow emulator frames do) overshot the hand each time and could diverge to positions kilometres away. A hand pose jump faster than a hand can move, such as an emulator controller teleport, now moves the held body without sweeping it through its neighbours. On release, the body becomes dynamic again with the hand's smoothed velocity, capped at 10 m/s. The generated physics guidance describes the new behavior.
- 9dd21ff: The `iwsdk-offline` skill's service worker now takes over only while the asking page is the app's only open page, so a second tab in an XR session is never moved onto a new release; it keeps the other hand's controller model along with the first, and pins the starter's stock models on jsDelivr by default. The page module adds `checkIdle()`, so a release that installed during a session takes over when it ends, and asks the browser to persist the copy. The headset test steps now serve `dist/` over plain HTTP, because `vite preview` with the IWSDK plugin uses a self-signed certificate that Quest Browser rejects for service workers.
- 67d5a48: Generated projects gain an `iwsdk-offline` skill that makes an app run with no connection after one online visit. It ships the build script, the service worker template, and the page module as files the agent copies rather than retypes. The build script hashes every file in `dist/` and writes `sw.js`, the service worker keeps one hash-checked copy of the release and answers from it, and the page moves to a new release only when no XR session is running, or at the next load. Each file is downloaded once, an update downloads only the files whose hash changed, and the controller models and three.js decoders IWSDK fetches from CDNs are kept as well. The hosting and PWA packaging skills point to it for apps that must launch offline from the Horizon Store, and the PWA troubleshooting reference covers an installed app that shows an error page offline or an old release after a redeploy.
- a239c76: Kinematic physics bodies now follow their Object3D, so the documented moving-platform pattern works. Before, moving a kinematic body's Object3D did nothing: the engine pose was written back every frame and the body snapped back. Now a changed Object3D pose is swept across the next physics substeps, so the body pushes dynamic bodies and carries anything resting on it. When the Object3D stops, the body is settled on its last pose instead of drifting on. Engine poses are no longer written back to kinematic bodies. `PhysicsManipulation` on a kinematic body is ignored with a one-time warning; move its Object3D instead. `setBodyTransform` still teleports a kinematic body without sweeping it.
- 925c442: A model whose meshes have different vertex attributes (for example one mesh with vertex colours and one without, common in glTF) now gets a physics collider. Before, building its merged collider failed and `PhysicsSystem` threw on every frame. Merged colliders now use positions only, building one no longer changes the model's `matrixWorld`, and an entity whose collider can't be built logs one error and stays without a body instead of stopping the physics system.
- 75ffab4: Physics colliders now follow an object's world scale. `Auto` shapes and mesh-derived `ConvexHull`/`TriMesh` shapes always use it: a box mesh scaled 2× used to get a 1 m collider and sink halfway into the floor. Spheres take the largest axis, and cylinders and capsules the larger horizontal axis for their radius. Mesh hulls also read interleaved position attributes correctly. Shapes with explicit `dimensions` keep their authored size by default, because those were often sized by hand to match a scaled visual. A scaled object with explicit dimensions logs a one-time warning, and the new `features.physics.applyScale: true` option applies scale to them too. That will become the default in a future release.
- 32ee415: Physics bodies under a transformed parent, such as a moved level root or another entity, now simulate in the right place. `PhysicsSystem` used to hand an entity's parent-relative pose to Havok as if it were a world pose, so a child of a parent 5 m up came to rest 5 m above the floor. Bodies are now created, driven, grabbed and rendered in world space and converted through the parent's transform. `setBodyTransform` accepts `{ space: 'world' }`; the default stays parent-relative (`'local'`).
- d6da276: Emulated hand presses (`xr run-sequence` `press` steps) click small UIKit buttons again, and land on turned targets. The target resolver measured UIKit panels with component matrices UIKit had not computed yet, so a panel such as the starter's welcome panel was listed as a box reaching the XR origin (about 1.9 × 3.3 × 5.2 m). IWER routed every reach over that box, the fingertip came down onto the button from above, and pointerdown and pointerup landed on different elements, so no click fired even though the press reported contact. A panel's box also leaves out UIKit content that is hidden or scrolled out of view, and an element partly scrolled out of view is pressed on the part that shows; with less than 1 cm of it in view, such as a row that only touches the edge of its list, it counts as scrolled out of view and is neither listed nor pressed. A step that names such an element, or hidden content, by its UUID gets no target either, instead of the middle of where the element is laid out. Faces of turned objects come from the tighter of the object's own box and its axis-aligned box, and always lie on the axis-aligned box: on a row of keys turned 25°, the face of the axis-aligned box lay in front of the neighbouring key, which got the press. `place` sets a held object straight down onto the middle of a tilted top face instead of above it. A button on a UIKit panel that is itself turned (25° in testing) still misses, because IWER routes the reach over the button's own panel; that needs an IWER change. The `iwsdk-ui` skill and the `iwsdk-dev` skill's iteration reference now have agents confirm a press by the state it changes (`ui inspect` or app state): a `contactMs` of 800 or less means the fingertip touched something, not that the control clicked. They also have agents walk to a control out of reach (`body.stepTo`) as a step of its own before pressing it: a press that walks the body holds the touch past the 800 ms click window.
- f3f5996: `iwsdk browser profile` draws three warm-up frames before it starts sampling an app that renders on demand (headless sessions). The first profile of such a session used to include one-time first-draw costs (shader programs, texture uploads) and reported a frame-time p95 far above the app's real cost. The warm-up waits at most 5 seconds, within the command's time budget. If the frames are not drawn in time, for example because an uncaught error stopped the app's render loop, the profile reports a `render-warmup-timeout` interruption. A profile also reports `render-loop-stopped` when the app drew nothing for 30 or more animation frames in a row while the profile held rendering, because its render loop stopped (before or during the profile) or stalled; such profiles used to look like a healthy 60 fps. It reports `render-warmup-skipped-budget` (less than a second of the command's time left) or `render-mode-unavailable` when it has to sample without warm-up frames. Long tasks and event timings now count only work that starts during the profile. The `iwsdk-dev` skill's headless-rendering reference covers the warm-up and these interruptions.
- Updated dependencies [930331d]
  - @iwsdk/xr-input@1.2.0-rc.1
  - @iwsdk/locomotor@1.2.0-rc.1
  - @iwsdk/scene-composition@1.2.0-rc.1

## 1.2.0-rc.0

### Minor Changes

- ee00260: Ship coding-agent guidance with `@iwsdk/core` and add `iwsdk agents sync`. The AGENTS.md block, skills, rules, and code-review subagent that new apps receive now come from `@iwsdk/core`, stamped with the release and a content hash. `npx @iwsdk/cli@latest agents sync` installs or refreshes them from the installed `@iwsdk/core`, so upgrading IWSDK can also upgrade the guidance: unedited files are replaced, retired IWSDK skills are removed, and edited files are reported and left alone (`--force` replaces them). An existing `AGENTS.md` keeps its text and gains a managed block. Guidance from earlier releases is recognized and upgraded. `iwsdk agents check` reports drift for CI, and `iwsdk adapter sync` now runs the guidance sync too.
- de1eaa9: Keep coding-agent guidance current across IWSDK upgrades. `iwsdk dev up` and `dev restart` notice when the installed `@iwsdk/core` ships different guidance than the project has. They refresh the files nobody edited for the coding tools the project already uses, and print what changed, including the migration guide and release notes when the upgrade crosses releases. They only report when `CI` is set, when `node_modules` disagrees with the lockfile (a monorepo's included), or when `iwsdk.config.json` sets `dev.agentGuidance` to `"warn"`; `"off"` disables the check. New `npx @iwsdk/cli@latest upgrade` sets every `@iwsdk/*` dependency in the release group to the new release, keeping ranges and leaving `workspace:`, `file:` and `catalog:` specs alone. It installs with the package manager found from the nearest lockfile, aligns the `three` alias and `@types/three` with core's, refreshes existing guidance, and checks `iwsdk.config.json` against the new release. It writes migration guides and the release notes between the two versions to `.iwsdk/migrations/`; both now ship with the CLI. New project skill `iwsdk-upgrade` walks coding agents through an upgrade, and a new guide, Upgrading IWSDK, covers it for people.
- d14fe70: Add an on-demand render mode. `world.renderMode` is `'continuous'` by default (every tick draws, as before); in `'on-demand'` mode every system still runs each tick, but a tick draws only when something asks: `world.requestRender(frames)` draws the next frames and resolves once the last one has been presented, and `world.holdRender()` draws every frame until released (holds are counted). `world.drawnFrames` counts the frames drawn so far. Ticks that do not draw still update world matrices, skinned-mesh bones and the XR camera pose, so raycasts, grabbing, physics and UI behave the same. Development harnesses can select the mode before boot with `window.__IWSDK_RENDER_MODE`. The MCP runtime gains `requestRender`, `renderMode`, `drawnFrames` and id-addressed render holds, and `scene_get_render_stats` (`scene render-stats`) draws a fresh frame first in on-demand mode.
- 836135b: Add the runtime-only `RuntimeSettings` component, created on its own entity by `RuntimeSettingsSystem`, so development tools can read and change runtime switches with the generic ECS commands (`ecs find`, `ecs query`, `ecs set-component`) instead of a command per switch. Its `renderMode` field (`'continuous'` or `'on-demand'`) mirrors `world.renderMode` in both directions and applies on the next frame, even while ECS updates are paused for debugging. The component is not part of the scene component catalog, so scenes cannot author it and it is never saved.
- 13f1046: `@iwsdk/create` now adds IWSDK to an existing project instead of scaffolding over it. When the target already has a `package.json`, Create checks everything before writing and never overwrites a file, even with `--force`. A project on a Vite major the plugin does not support yet, or with an invalid `package.json`, is refused with nothing changed, and `--canary` is refused. Otherwise Create adds a minimal skeleton in its own `src/iwsdk/` folder (world entry, empty asset and component manifests) plus `iwsdk.config.json` and an empty scene. It merges `package.json` in its own formatting: versions are only raised, `workspace:`/`file:`/`catalog:` specs are kept, and scripts are kept, with `iwsdk:dev` added when `dev` is taken. Overrides go where the package manager reads them (npm and bun `overrides`, yarn `resolutions`, `pnpm-workspace.yaml`). `iwsdkDev()` is added to the Vite config when its top-level `plugins` array is unambiguous. Dependencies install with the package manager found from the nearest lockfile, and coding-agent guidance is installed while an existing `AGENTS.md` keeps its text. Create prints what it kept and the steps left to finish, even when the install fails. Previously `create . --force` replaced the project's `package.json`, `index.html`, Vite config, and entry file. `@iwsdk/cli` exports the guidance sync as `@iwsdk/cli/agent-guidance`.
- 10252ff: `PokeInteractable` has a `hand` field (`PokeHand.Both`, the default, `Left` or `Right`) that limits which hand or controller can poke the entity (#62). Use it for a wrist menu that only the other hand should press, so the hand wearing the menu no longer triggers it. Existing scenes keep poking with both hands.

### Patch Changes

- a7e5b27: Coding-agent guidance now tells agents to keep an Enter XR control on the flat page of every XR app. An agent that removes the starter's welcome panel must replace its button, because `xr.offer` alone only adds a small "Enter VR" pill to the Quest Browser toolbar, which people miss.
- d0db4ab: Coding-agent guidance now gives a user who wants to try the app in a headset a plain dev session and URL, never a `--native-xr-control` session or pairing URL, which would take over their head pose and controllers. It also tells agents to keep app and game state (score, lives, phase, debug switches) in ECS components so `ecs set-component` can jump it to any state, and to treat browser automation as a last resort.
- 282d6f8: Coding-agent guidance now tells agents to give UI panels and buttons both `RayInteractable` and `PokeInteractable`, because fingertip touches only reach entities with `PokeInteractable`.
- fa0ff9d: Coding-agent guidance now tells agents which dev session to start. They pass `--ai-mode collaborate` when the user wants to watch or steer the work, and `--ai-mode agent` (headless, renders on demand) otherwise. They ask once when the request doesn't say, and use agent mode when nobody can answer. The guidance also explains how to look up IWSDK APIs with `iwsdk reference` (keyword search over the bundled corpus, no warmup), how to profile instead of reading headless frame rates, and the `world.renderMode` render-loop API. The `search_code` query description now asks for keywords led by identifiers.
- cddc720: A failed audio load is no longer retried every frame. `AudioSystem` refetched and logged an error for an `AudioSource` whose file failed to load on every frame (about 70k errors in 10 s with a missing file). It now logs once and tries again when the entity's `src` changes.
- 5de9d12: Add `browser filmstrip` (MCP `browser_filmstrip`): pause the app, capture exact simulation frames at fixed step offsets, and return them as one labeled contact sheet. Steps and captures run against the command budget, the previous ECS pause state is restored, and `MCPRuntime.ecsPaused` reports the pause state the tool relies on.
- b6b96ad: `DepthOccludable` no longer crashes on troika-three-text meshes (#60). Their materials chain an assigned `onBeforeCompile` themselves, so wrapping it recursed until the stack overflowed on first compile. For such materials the occlusion code now passes its injection to them directly.
- 455f82b: Depth occlusion with GPU depth sensing on Quest no longer samples empty depth on some frames. Quest Browser reuses one `WebGLTexture` for the per-frame depth image, and three.js skipped re-binding it, so the soft-occlusion preprocessing pass read a stale, dropped texture on about a quarter of frames ("RENDER WARNING: there is no texture bound to the unit 0" floods in the console). IWSDK now re-binds the depth texture on the units that hold it every frame.
- cc2c31c: ECS debug tools count simulated frames. `ecs step`'s `totalFrame`, a snapshot's frame, `ecs diff`'s `frameDelta` and `ecs resume`'s `framesWhilePaused` counted every render-loop tick, including ticks skipped while paused. Stepping 50 frames could report a `frameDelta` of about 300. They now count only frames the ECS actually ran: normal updates and debugger steps.
- ebf314e: Removing `OneHandGrabbable`, `TwoHandsGrabbable` or `DistanceGrabbable` from an entity now removes its grab handle too (#59). Before, the handle stayed, the object kept ignoring controller rays in XR, and it could still be grabbed. If another grabbable component remains on the entity, it gets its own handle.
- 5ecfd0d: Editors complete every component key in `entity.setValue` again (#61). The overload that adds hex number, `#RRGGBB` string, `Color` and RGB inputs for Color fields only listed Color keys, so completions hid all the others. It now covers every key and widens the value type for Color fields only. What type-checks is unchanged.
- 51368a4: Grab and touch pointers do less work per frame. Their sphere intersection brought each tested object's world matrix up to date by recomposing its whole ancestor chain, once per object, and did so even for groups it doesn't test. Each ancestor is now recomposed at most once per pointer move, and non-mesh nodes are skipped. Hits are unchanged, including for objects moved since the last render.
- Updated dependencies [10252ff]
- Updated dependencies [89a9295]
- Updated dependencies [7c4970b]
  - @iwsdk/xr-input@1.2.0-rc.0
  - @iwsdk/locomotor@1.2.0-rc.0
  - @iwsdk/scene-composition@1.2.0-rc.0

## 1.1.0

### Minor Changes

- 7a92e16: New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
- 96b451a: `DomeGradient` gains `elevationDeg` and `azimuthDeg`, which tilt the sky pole away from straight up (azimuth uses a scene node's Y rotation convention, so 90 faces -X), and `dither`, which adds ±0.5/255 screen noise against banding. The defaults render exactly as before. `DomeGradient` and `IBLGradient` now apply edits on the next frame without `_needsUpdate` (setting it still forces a refresh; `DomeTexture` and `IBLTexture` still need it), their fields carry labels, help and limits, and `intensity: 0` now means off instead of 1 (negative values fail validation). `IBLGradient` applies `intensity` once, as `scene.environmentIntensity`; 1.0.x applied it twice, so square any 1.0.x value other than 1 to keep its look (`0.45` becomes `0.2025`). Switching between `DomeTexture` and `DomeGradient`, or between `IBLTexture` and `IBLGradient`, no longer leaves a stale dome, background, IBL rotation or intensity behind, and removing the IBL source resets `environmentIntensity`. `scene_get_render_stats` now reports gradient and texture skies (`dome-gradient`, `dome-texture`) and image-based lighting (`ibl-gradient`, `ibl-texture`) instead of `null`. Scenes that use the new fields need `@iwsdk/core` 1.1.0. The generated agent guidance and the CLI's `AGENTS.md` now ask for `_needsUpdate` only on `DomeTexture` and `IBLTexture`.
- 0251c03: Add `ContactShadow` and `ShadowCatcher`, node components that ground content without hand-built shadow meshes. `ContactShadow` draws a soft round blob under its node (`size`, `opacity`, `color`, `height`); `ShadowCatcher` is an invisible floor that shows only the shadows it receives, for AR passthrough (`size`, `opacity`, `color`; it needs `environment.shadows` and a light with `castShadow`). The new `GroundShadowSystem` builds their meshes, which move and scale with the node, never cast shadows or take ray, grab or touch pointer hits, and stay visible in AR. Meshes marked runtime-only, as both are, are left out of auto-detected physics shapes, locomotion collision, gaze target bounds and `entity.dispose()`. The editor viewport renders both, and its selection and framing bounds, geometry lens and preview ghosting leave them out, as do the framing bounds and asset mesh counts in `scene_get_render_stats`, the emulator's hand targets and the grab setup warning. Render stats count them in `sceneEnvironment.groundShadows`, and scene validation rejects a `size` that is not positive. Scenes that use the components need @iwsdk/core 1.1.0. The generated agent guidance points to them instead of canvas blob cards and `ShadowMaterial` planes.
- 3c6c2f3: The emulator now uses IWER 2.6.0's built-in GLTS rooms as its environments: `dev.emulator.environment` accepts `sunlit_living_room` (the new default for AR projects), `home_office`, `conference_room`, `open_office`, `kitchen`, `bedroom`, `music_studio` and `open_studio`, and the DevUI environment menu lists only these rooms. The legacy capture rooms are no longer offered; configurations that still name one get a deprecation warning and load its replacement (`living_room` → `sunlit_living_room`, `meeting_room` → `conference_room`, `music_room` → `music_studio`, `office_large` → `open_office`, `office_small` → `home_office`). The emulator runtime is now code-split: the room you pick and the GLTS runtime load on demand, and the capture data is no longer shipped.
- a1ab306: Agents and scripts can now drive the emulator's hands the way a person moves them, so an app's real poke, pinch and grab code reacts. The emulator moves to IWER 2.7.0, and its hand tools are new MCP tools and `iwsdk xr` commands: `xr_run_sequence` (`xr run-sequence`) runs a whole interaction in one call (press a button with the index fingertip, pinch-grab an object, carry it, set it down, gesture), with `xr_cancel_sequence` and `xr_list_targets`; `xr_set_hand_pose`, `xr_get_hand_state` and `xr_microgesture` shape, read and gesture a hand. `xr_set_transform` and `xr_animate_to` also place a hand by a point on it (`anchor`) and orient it by direction or `"auto"`, `xr_set_select_value` ramps over `duration`, and `xr_set_device_state` takes each hand's `poseId` and `pinchValue`. The schemas mirror IWER's, and a misspelt key inside a union now names that key instead of reporting "a supported shape". Hand sequences get a 40 s command timeout, and the default timeout of a pose fade, select ramp or animation grows by its `duration`.

  Sequence steps name their targets: IWSDK registers a target resolver with the emulator that finds interactable entities by name (`Map Pin 1`), the UIKitML element IDs inside them (`counter-button`), scene node IDs and UUIDs, and reports surface points, normals and boxes relative to the XR origin (`MCPRuntime.targetResolver`, `SceneTargetResolver`). The generated agent skills include hand recipes for pressing UI and pinch-grabbing.

- fcf7825: Move to Three.js r185 (`super-three@0.185.0`, `@types/three` 0.185). Apps pin the same version: update `three` and its override to `npm:super-three@0.185.0` (new projects from `@iwsdk/create` get it). The r185 changes are handled so apps see no warnings or visual changes: scene `shadowMapType: 'pcf-soft'` uses `PCFShadowMap` (soft since r182, which deprecated `PCFSoftShadowMap`), the render loop uses `Timer` instead of the deprecated `Clock`, the `room` IBL keeps its lighting, controller and hand visuals compile with r183+'s vec4 vertex colors (and still with older Three.js for `@iwsdk/xr-input`), and production builds no longer bundle the unused Draco and Basis decoders that r185's loaders reference.

### Patch Changes

- a57296b: Fix sound after leaving XR. Ending an XR session suspended the shared audio context, and only the next session start resumed it, so every sound requested in 2D after exiting XR stayed silent. The context now keeps running; sounds that were playing when the session ended still pause and resume with the next session, and a resumed sound now reports when it finishes instead of staying marked as playing.
- 08250e6: Controller visuals no longer throw on every frame, which froze rendering, when a controller reports fewer buttons or axes than its input profile maps (for example Samsung Galaxy XR, whose profile maps thumbrest and menu to buttons the device doesn't report). Parts the gamepad doesn't report stay at rest.
- 08250e6: A rejected XR session offer is now logged as `[XR] Failed to start offered XR session` instead of surfacing as an uncaught promise rejection. IWER, for example, rejects a session that requires a feature its emulated device lacks, such as `layers`.
- 08250e6: `GrabSystem`'s `useHandPinchForGrab` option now takes effect. Hand pinch grabs `OneHandGrabbable` and `TwoHandsGrabbable` objects by default, as it already did on Quest and in IWER while the option was ignored, and `grabbing: { useHandPinchForGrab: false }` now turns it off. Pinch-to-grab also works on hand input sources that expose no Gamepad. The new `XRInputManager.getSelectState(handedness)` returns this frame's select edges for either kind of source. The generated agent guidance now describes the actual default.
- a57296b: Production builds no longer bundle every Lucide icon. Since 1.0, the UIKitML kit put all of about 1,600 Lucide icon components into every app (most of the starter's 6.7 MB main chunk). `vite build` now keeps only the icons used in static `public/**/*.uikitml`, the icons Horizon components use internally, and any listed in the new `iwsdkDev({ bundle: { icons: [...] } })` option for remote or generated UIKitML (`'all'` keeps every icon). If UIKitML in a production build names an icon that was left out, the `@iwsdk/core` parse error now points to that option. The dev server and editor still have every icon.
- 5db9b65: `scene_get_render_stats` (`iwsdk scene render-stats`) no longer fails with "Cannot read properties of undefined (reading 'x')" when the level holds UIKit content components, such as the Lucide icons of a welcome panel. That happened in every XR session of a project with a `ScreenSpace` panel, which moves into the level during the session, and whenever such a panel was placed in the world. `worldBounds` still covers every object, hidden ones included, and now reads each mesh's own geometry bounds (or an instanced, batched or skinned mesh's own `boundingBox`) instead of any object's `boundingBox`.
- e551c3d: Fix missing textures in XR on Meta Quest with `super-three@0.185.0` (#55). In multiview mode, super-three deferred every texture upload that started during the session and never flushed them, so UIKit text and images, hand and controller models, and the ray cursor rendered empty. Uploads also stayed stalled after the session ended. IWSDK's renderer now flushes deferred uploads after each multiview render and then turns deferral off.
- ee50d96: Fix rendering in XR on Meta Quest with `super-three@0.185.0`: in multiview mode every shader failed to compile ("array size must be a constant integer expression"), so nothing rendered. r185's `transformNormalByInverseViewMatrix` / `transformDirectionByInverseViewMatrix` shader helpers take a parameter named `viewMatrix`, which super-three's multiview mode `#define`s to an array element; IWSDK now renames that parameter in `ShaderChunk.common`.
- a57296b: Fix XR quad and cylinder layers on Quest Browser:
  - Entering XR no longer hangs. The layer render targets resolved depth by default, so three.js turned off multisampled render-to-texture when the session supplied their textures and then bound a framebuffer that was never created: the first XR frame threw `Invalid value used as weak map key` and the app stayed on the loading dots. Layer targets no longer resolve depth, which the compositor never reads.
  - Quad layers are their authored size again. `XRQuadLayer` `width` and `height` are half-extents in Quest Browser and the IWER layers polyfill, so a 1 m quad was drawn 2 m wide.
  - Transparent parts of a layer no longer show black boxes. The mesh behind a native layer used to cut a hole in the projection layer; since content layers are composited over it, the mesh is now just not drawn.
  - The 2D fallback no longer shows layer content upside down (quads) or mirrored (cylinders).

- Updated dependencies [08250e6]
- Updated dependencies [7a92e16]
- Updated dependencies [a57296b]
- Updated dependencies [08250e6]
- Updated dependencies [0251c03]
- Updated dependencies [fcf7825]
- Updated dependencies [a0ad31c]
  - @iwsdk/xr-input@1.1.0
  - @iwsdk/scene-composition@1.1.0
  - @iwsdk/locomotor@1.1.0

## 1.1.0-rc.2

### Minor Changes

- 7a92e16: New `DomeFade` node component (`{ start, end }`, meters) fades a node's meshes into the level's `DomeGradient` sky with horizontal distance from the node's origin, so a floor has no visible edge. Each faded pixel samples the live sky from the camera, so dome edits (colors, tilt, dither) reach it without a recompile. It patches per-node copies of MeshBasic, Lambert, Phong, Standard, Physical and Toon materials (sources are never changed or disposed), skips and counts other materials, does nothing without a visible `DomeGradient`, and hides the faded meshes, not child nodes, with the sky during AR passthrough. `scene_get_render_stats` reports each fade in `sceneEnvironment.domeFades` with its `inactiveReason`. Scene validation rejects a `DomeFade` whose `start` is not less than its `end`, and the editor viewport renders `DomeFade` the same way the runtime does. The generated agent guidance, the reviewer agent and the CLI's `AGENTS.md` point hand-built sky fades at `DomeFade`.
- 96b451a: `DomeGradient` gains `elevationDeg` and `azimuthDeg`, which tilt the sky pole away from straight up (azimuth uses a scene node's Y rotation convention, so 90 faces -X), and `dither`, which adds ±0.5/255 screen noise against banding. The defaults render exactly as before. `DomeGradient` and `IBLGradient` now apply edits on the next frame without `_needsUpdate` (setting it still forces a refresh; `DomeTexture` and `IBLTexture` still need it), their fields carry labels, help and limits, and `intensity: 0` now means off instead of 1 (negative values fail validation). `IBLGradient` applies `intensity` once, as `scene.environmentIntensity`; 1.0.x applied it twice, so square any 1.0.x value other than 1 to keep its look (`0.45` becomes `0.2025`). Switching between `DomeTexture` and `DomeGradient`, or between `IBLTexture` and `IBLGradient`, no longer leaves a stale dome, background, IBL rotation or intensity behind, and removing the IBL source resets `environmentIntensity`. `scene_get_render_stats` now reports gradient and texture skies (`dome-gradient`, `dome-texture`) and image-based lighting (`ibl-gradient`, `ibl-texture`) instead of `null`. Scenes that use the new fields need `@iwsdk/core` 1.1.0. The generated agent guidance and the CLI's `AGENTS.md` now ask for `_needsUpdate` only on `DomeTexture` and `IBLTexture`.
- 0251c03: Add `ContactShadow` and `ShadowCatcher`, node components that ground content without hand-built shadow meshes. `ContactShadow` draws a soft round blob under its node (`size`, `opacity`, `color`, `height`); `ShadowCatcher` is an invisible floor that shows only the shadows it receives, for AR passthrough (`size`, `opacity`, `color`; it needs `environment.shadows` and a light with `castShadow`). The new `GroundShadowSystem` builds their meshes, which move and scale with the node, never cast shadows or take ray, grab or touch pointer hits, and stay visible in AR. Meshes marked runtime-only, as both are, are left out of auto-detected physics shapes, locomotion collision, gaze target bounds and `entity.dispose()`. The editor viewport renders both, and its selection and framing bounds, geometry lens and preview ghosting leave them out, as do the framing bounds and asset mesh counts in `scene_get_render_stats`, the emulator's hand targets and the grab setup warning. Render stats count them in `sceneEnvironment.groundShadows`, and scene validation rejects a `size` that is not positive. Scenes that use the components need @iwsdk/core 1.1.0. The generated agent guidance points to them instead of canvas blob cards and `ShadowMaterial` planes.
- a1ab306: Agents and scripts can now drive the emulator's hands the way a person moves them, so an app's real poke, pinch and grab code reacts. The emulator moves to IWER 2.7.0, and its hand tools are new MCP tools and `iwsdk xr` commands: `xr_run_sequence` (`xr run-sequence`) runs a whole interaction in one call (press a button with the index fingertip, pinch-grab an object, carry it, set it down, gesture), with `xr_cancel_sequence` and `xr_list_targets`; `xr_set_hand_pose`, `xr_get_hand_state` and `xr_microgesture` shape, read and gesture a hand. `xr_set_transform` and `xr_animate_to` also place a hand by a point on it (`anchor`) and orient it by direction or `"auto"`, `xr_set_select_value` ramps over `duration`, and `xr_set_device_state` takes each hand's `poseId` and `pinchValue`. The schemas mirror IWER's, and a misspelt key inside a union now names that key instead of reporting "a supported shape". Hand sequences get a 40 s command timeout, and the default timeout of a pose fade, select ramp or animation grows by its `duration`.

  Sequence steps name their targets: IWSDK registers a target resolver with the emulator that finds interactable entities by name (`Map Pin 1`), the UIKitML element IDs inside them (`counter-button`), scene node IDs and UUIDs, and reports surface points, normals and boxes relative to the XR origin (`MCPRuntime.targetResolver`, `SceneTargetResolver`). The generated agent skills include hand recipes for pressing UI and pinch-grabbing.

### Patch Changes

- a57296b: Fix sound after leaving XR. Ending an XR session suspended the shared audio context, and only the next session start resumed it, so every sound requested in 2D after exiting XR stayed silent. The context now keeps running; sounds that were playing when the session ended still pause and resume with the next session, and a resumed sound now reports when it finishes instead of staying marked as playing.
- 08250e6: Controller visuals no longer throw on every frame, which froze rendering, when a controller reports fewer buttons or axes than its input profile maps (for example Samsung Galaxy XR, whose profile maps thumbrest and menu to buttons the device doesn't report). Parts the gamepad doesn't report stay at rest.
- 08250e6: A rejected XR session offer is now logged as `[XR] Failed to start offered XR session` instead of surfacing as an uncaught promise rejection. IWER, for example, rejects a session that requires a feature its emulated device lacks, such as `layers`.
- 08250e6: `GrabSystem`'s `useHandPinchForGrab` option now takes effect. Hand pinch grabs `OneHandGrabbable` and `TwoHandsGrabbable` objects by default, as it already did on Quest and in IWER while the option was ignored, and `grabbing: { useHandPinchForGrab: false }` now turns it off. Pinch-to-grab also works on hand input sources that expose no Gamepad. The new `XRInputManager.getSelectState(handedness)` returns this frame's select edges for either kind of source. The generated agent guidance now describes the actual default.
- a57296b: Production builds no longer bundle every Lucide icon. Since 1.0, the UIKitML kit put all of about 1,600 Lucide icon components into every app (most of the starter's 6.7 MB main chunk). `vite build` now keeps only the icons used in static `public/**/*.uikitml`, the icons Horizon components use internally, and any listed in the new `iwsdkDev({ bundle: { icons: [...] } })` option for remote or generated UIKitML (`'all'` keeps every icon). If UIKitML in a production build names an icon that was left out, the `@iwsdk/core` parse error now points to that option. The dev server and editor still have every icon.
- 5db9b65: `scene_get_render_stats` (`iwsdk scene render-stats`) no longer fails with "Cannot read properties of undefined (reading 'x')" when the level holds UIKit content components, such as the Lucide icons of a welcome panel. That happened in every XR session of a project with a `ScreenSpace` panel, which moves into the level during the session, and whenever such a panel was placed in the world. `worldBounds` still covers every object, hidden ones included, and now reads each mesh's own geometry bounds (or an instanced, batched or skinned mesh's own `boundingBox`) instead of any object's `boundingBox`.
- e551c3d: Fix missing textures in XR on Meta Quest with `super-three@0.185.0` (#55). In multiview mode, super-three deferred every texture upload that started during the session and never flushed them, so UIKit text and images, hand and controller models, and the ray cursor rendered empty. Uploads also stayed stalled after the session ended. IWSDK's renderer now flushes deferred uploads after each multiview render and then turns deferral off.
- a57296b: Fix XR quad and cylinder layers on Quest Browser:
  - Entering XR no longer hangs. The layer render targets resolved depth by default, so three.js turned off multisampled render-to-texture when the session supplied their textures and then bound a framebuffer that was never created: the first XR frame threw `Invalid value used as weak map key` and the app stayed on the loading dots. Layer targets no longer resolve depth, which the compositor never reads.
  - Quad layers are their authored size again. `XRQuadLayer` `width` and `height` are half-extents in Quest Browser and the IWER layers polyfill, so a 1 m quad was drawn 2 m wide.
  - Transparent parts of a layer no longer show black boxes. The mesh behind a native layer used to cut a hole in the projection layer; since content layers are composited over it, the mesh is now just not drawn.
  - The 2D fallback no longer shows layer content upside down (quads) or mirrored (cylinders).

- Updated dependencies [08250e6]
- Updated dependencies [7a92e16]
- Updated dependencies [a57296b]
- Updated dependencies [08250e6]
- Updated dependencies [0251c03]
- Updated dependencies [a0ad31c]
  - @iwsdk/xr-input@1.1.0-rc.2
  - @iwsdk/scene-composition@1.1.0-rc.2
  - @iwsdk/locomotor@1.1.0-rc.2

## 1.1.0-rc.1

### Patch Changes

- abbd7d0: Fix rendering in XR on Meta Quest with `super-three@0.185.0`: in multiview mode every shader failed to compile ("array size must be a constant integer expression"), so nothing rendered. r185's `transformNormalByInverseViewMatrix` / `transformDirectionByInverseViewMatrix` shader helpers take a parameter named `viewMatrix`, which super-three's multiview mode `#define`s to an array element; IWSDK now renames that parameter in `ShaderChunk.common`.
  - @iwsdk/locomotor@1.1.0-rc.1
  - @iwsdk/scene-composition@1.1.0-rc.1
  - @iwsdk/xr-input@1.1.0-rc.1

## 1.1.0-rc.0

### Minor Changes

- 6026060: The emulator now uses IWER 2.6.0's built-in GLTS rooms as its environments: `dev.emulator.environment` accepts `sunlit_living_room` (the new default for AR projects), `home_office`, `conference_room`, `open_office`, `kitchen`, `bedroom`, `music_studio` and `open_studio`, and the DevUI environment menu lists only these rooms. The legacy capture rooms are no longer offered; configurations that still name one get a deprecation warning and load its replacement (`living_room` → `sunlit_living_room`, `meeting_room` → `conference_room`, `music_room` → `music_studio`, `office_large` → `open_office`, `office_small` → `home_office`). The emulator runtime is now code-split: the room you pick and the GLTS runtime load on demand, and the capture data is no longer shipped.
- 0f10007: Move to Three.js r185 (`super-three@0.185.0`, `@types/three` 0.185). Apps pin the same version: update `three` and its override to `npm:super-three@0.185.0` (new projects from `@iwsdk/create` get it). The r185 changes are handled so apps see no warnings or visual changes: scene `shadowMapType: 'pcf-soft'` uses `PCFShadowMap` (soft since r182, which deprecated `PCFSoftShadowMap`), the render loop uses `Timer` instead of the deprecated `Clock`, the `room` IBL keeps its lighting, controller and hand visuals compile with r183+'s vec4 vertex colors (and still with older Three.js for `@iwsdk/xr-input`), and production builds no longer bundle the unused Draco and Basis decoders that r185's loaders reference.

### Patch Changes

- Updated dependencies [0f10007]
  - @iwsdk/xr-input@1.1.0-rc.0
  - @iwsdk/locomotor@1.1.0-rc.0
  - @iwsdk/scene-composition@1.1.0-rc.0

## 1.0.1

### Patch Changes

- @iwsdk/locomotor@1.0.1
- @iwsdk/scene-composition@1.0.1
- @iwsdk/xr-input@1.0.1

## 1.0.0

### Major Changes

- a79f1ff: Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Minor Changes

- 15688e2: Add configurable gaze input, gaze-driven pointer selection, native-session
  `gaze-tracking` and `eye-tracking` feature requests, a `metaVRGlasses` desktop
  emulator device with gaze input, and a development-only Meta VR Glasses gaze
  preview for physical Quest headsets.
- d0b24a1: Add bounded live UIKitML element inspection to the CLI and MCP runtime, including
  current ID, class, text, layout, interaction, property, and effective visibility
  state. Teach generated UI-agent guidance to use the inspection command for
  runtime verification.
- 13a5cbe: Add opt-in native Quest WebXR control sessions, session-grant launch support,
  deterministic physical-browser routing, and generated-project guidance for
  running IWSDK tests through an ADB-reversed localhost connection.
- 438f10c: Existing `physics: true` projects now run Havok in a Web Worker at a fixed 60
  Hz by default, using transferable ArrayBuffer exchanges and render
  interpolation. Add a shared main-thread mode for debugging and compatibility,
  plus debugger pause/step synchronization across both execution modes.
- e18c42a: Harden the CLI-managed development runtime with one fail-closed workspace
  owner, an explicit managed-browser lifecycle, exact managed and physical target
  routing, bounded command execution, and runtime status/recovery tools. Dev
  startup uses Vite's resolved application port and may return before the browser
  command path is ready; inspect `browserCommandReady` or use `runtime wait` before
  issuing browser-backed commands. A configured `server.port` is the runtime's
  address, so an occupied port now fails startup instead of moving to the next
  free port; an explicit `server.strictPort` still wins. Recovery reports `browser_relaunched` without
  replaying the command, while failures after dispatch report `outcome_unknown`.

  Managed Chromium uses a private profile in OS temporary storage that survives
  automatic browser recovery while retained. Stop active dev processes before
  upgrading the CLI and Vite plugin together. Native pose overrides are enabled
  only for explicitly configured Quest sessions; other browsers continue using
  IWER emulation.

### Patch Changes

- ed2a6b1: Normalize non-indexed and mixed-index locomotion environment meshes before
  building collision geometry, report unusable environments clearly, and
  document that grab components are mutually exclusive per entity.
- aee9970: Stop camera tracks when sources are restarted, removed, hidden, or destroyed, and require explicit retry after camera errors.
- ce9cdad: Embed TypeScript sources in the published source maps for the runtime packages,
  and pre-bundle the elics dependency of `@iwsdk/core` in development. The Vite
  development server no longer warns that source maps point to missing source
  files, and browser devtools can show SDK source when stepping into it.
- 4d4efa0: Apply one-shot physics impulses independently of render cadence and preserve
  vertical offsets for `PivotY` followers.
- 52c7378: Pin standalone core installs to the supported super-three runtime instead of resolving an untested latest Three.js release.

  Existing applications must use `"three": "npm:super-three@0.181.0"` and the
  matching npm or pnpm override so IWSDK and application code share one Three.js
  module instance.

- 3306963: Ignore invisible objects and descendants of invisible objects during pointer hit testing.
- 2c7b66c: Clamp distance-grab interpolation after stalled frames so position and rotation
  cannot extrapolate into invalid transforms.

  Wake locomotion after environment changes, teleports, and successful jumps,
  allow the first jump immediately, and restart the idle timeout on static-ground
  landings so the float spring settles before sleep.

  Keep native XR composition layers aligned with player space, preserve their
  configured full dimensions and scale, synchronize visibility and geometry, fall
  back safely for unsupported transforms, and release resources during teardown.

  Clear session-owned depth uniforms during XR exit, component removal, and system
  teardown, and require fresh per-session depth data before re-enabling occlusion.

  Refresh retained plane and mesh geometry when WebXR reports updates, compute
  correct axis-aligned mesh bounds, and skip BVH acceleration for compatible
  foreign Three.js geometries that do not expose the extension.

- 3306963: Preserve the original DistanceGrabbable transform across two-hand grab handoffs.
- 3306963: Forward canvas pointer events synchronously so Spatial UI actions retain browser user activation.
- Updated dependencies [15688e2]
- Updated dependencies [3306963]
- Updated dependencies [ed2a6b1]
- Updated dependencies [ce9cdad]
- Updated dependencies [faf9709]
- Updated dependencies [3306963]
- Updated dependencies [a79f1ff]
- Updated dependencies [2c7b66c]
  - @iwsdk/xr-input@1.0.0
  - @iwsdk/locomotor@1.0.0
  - @iwsdk/scene-composition@1.0.0

## 1.0.0-rc.2

### Minor Changes

- d3640c2: Add configurable gaze input, gaze-driven pointer selection, native-session
  `gaze-tracking` and `eye-tracking` feature requests, a `metaVRGlasses` desktop
  emulator device with gaze input, and a development-only Meta VR Glasses gaze
  preview for physical Quest headsets.

### Patch Changes

- Updated dependencies [d3640c2]
  - @iwsdk/xr-input@1.0.0-rc.2
  - @iwsdk/locomotor@1.0.0-rc.2
  - @iwsdk/scene-composition@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- 5384bc0: Embed TypeScript sources in the published source maps for the runtime packages,
  and pre-bundle the elics dependency of `@iwsdk/core` in development. The Vite
  development server no longer warns that source maps point to missing source
  files, and browser devtools can show SDK source when stepping into it.
- Updated dependencies [5384bc0]
  - @iwsdk/locomotor@1.0.0-rc.1
  - @iwsdk/xr-input@1.0.0-rc.1
  - @iwsdk/scene-composition@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- Release IWSDK 1.0, the first stable release of the Immersive Web SDK runtime
  and tooling packages. The SDK packages continue to share one fixed version, and
  breaking API changes now require a new major version.

### Minor Changes

- d0b24a1: Add bounded live UIKitML element inspection to the CLI and MCP runtime, including
  current ID, class, text, layout, interaction, property, and effective visibility
  state. Teach generated UI-agent guidance to use the inspection command for
  runtime verification.
- 13a5cbe: Add opt-in native Quest WebXR control sessions, session-grant launch support,
  deterministic physical-browser routing, and generated-project guidance for
  running IWSDK tests through an ADB-reversed localhost connection.
- 438f10c: Existing `physics: true` projects now run Havok in a Web Worker at a fixed 60
  Hz by default, using transferable ArrayBuffer exchanges and render
  interpolation. Add a shared main-thread mode for debugging and compatibility,
  plus debugger pause/step synchronization across both execution modes.
- e18c42a: Harden the CLI-managed development runtime with one fail-closed workspace
  owner, an explicit managed-browser lifecycle, exact managed and physical target
  routing, bounded command execution, and runtime status/recovery tools. Dev
  startup uses Vite's resolved application port and may return before the browser
  command path is ready; inspect `browserCommandReady` or use `runtime wait` before
  issuing browser-backed commands. A configured `server.port` is the runtime's
  address, so an occupied port now fails startup instead of moving to the next
  free port; an explicit `server.strictPort` still wins. Recovery reports `browser_relaunched` without
  replaying the command, while failures after dispatch report `outcome_unknown`.

  Managed Chromium uses a private profile in OS temporary storage that survives
  automatic browser recovery while retained. Stop active dev processes before
  upgrading the CLI and Vite plugin together. Native pose overrides are enabled
  only for explicitly configured Quest sessions; other browsers continue using
  IWER emulation.

### Patch Changes

- ed2a6b1: Normalize non-indexed and mixed-index locomotion environment meshes before
  building collision geometry, report unusable environments clearly, and
  document that grab components are mutually exclusive per entity.
- aee9970: Stop camera tracks when sources are restarted, removed, hidden, or destroyed, and require explicit retry after camera errors.
- 4d4efa0: Apply one-shot physics impulses independently of render cadence and preserve
  vertical offsets for `PivotY` followers.
- 52c7378: Pin standalone core installs to the supported super-three runtime instead of resolving an untested latest Three.js release.

  Existing applications must use `"three": "npm:super-three@0.181.0"` and the
  matching npm or pnpm override so IWSDK and application code share one Three.js
  module instance.

- 3306963: Ignore invisible objects and descendants of invisible objects during pointer hit testing.
- 2c7b66c: Clamp distance-grab interpolation after stalled frames so position and rotation
  cannot extrapolate into invalid transforms.

  Wake locomotion after environment changes, teleports, and successful jumps,
  allow the first jump immediately, and restart the idle timeout on static-ground
  landings so the float spring settles before sleep.

  Keep native XR composition layers aligned with player space, preserve their
  configured full dimensions and scale, synchronize visibility and geometry, fall
  back safely for unsupported transforms, and release resources during teardown.

  Clear session-owned depth uniforms during XR exit, component removal, and system
  teardown, and require fresh per-session depth data before re-enabling occlusion.

  Refresh retained plane and mesh geometry when WebXR reports updates, compute
  correct axis-aligned mesh bounds, and skip BVH acceleration for compatible
  foreign Three.js geometries that do not expose the extension.

- 3306963: Preserve the original DistanceGrabbable transform across two-hand grab handoffs.
- 3306963: Forward canvas pointer events synchronously so Spatial UI actions retain browser user activation.
- Updated dependencies [3306963]
- Updated dependencies [ed2a6b1]
- Updated dependencies [faf9709]
- Updated dependencies [3306963]
- Updated dependencies
- Updated dependencies [2c7b66c]
  - @iwsdk/xr-input@1.0.0-rc.0
  - @iwsdk/locomotor@1.0.0-rc.0
  - @iwsdk/scene-composition@1.0.0-rc.0

## 0.5.3

### Patch Changes

- @iwsdk/locomotor@0.5.3
- @iwsdk/scene-composition@0.5.3
- @iwsdk/xr-input@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [0b3ddc3]
  - @iwsdk/xr-input@0.5.2
  - @iwsdk/locomotor@0.5.2
  - @iwsdk/scene-composition@0.5.2

## 0.5.0

### Minor Changes

- c463f17: Load `.uikitml` source files directly at runtime with
  `@drawcall/uikitml@0.1.8` and UIKit 1.0.74. Panel UI now parses styles and TTF
  font declarations without generated JSON, and supports typed custom component
  sets through `features.spatialUI`.

  The `@iwsdk/vite-plugin-uikitml` package is removed. Starters and examples now
  ship their UIKitML sources from `public/ui` as ordinary static assets.

- 91047c5: Replace the Meta Spatial Editor integration path with the native IWSDK 3D scene
  editor and native scene JSON workflow.

  Meta Spatial Editor integration is deprecated from this release onward. New and
  migrated projects should use `public/scenes/*.iwsdk.scene.json`, the clean managed
  origin workspace, and direct file authoring with the compact `scene_*` observation
  tools. Code remains supported for procedural behavior, systems,
  animation, and advanced app logic.

  The replacement includes WebGL/IWSDK editor rendering, real scene asset loading,
  camera and orientation controls, transform gizmos, scene hierarchy editing,
  schema-driven component editing, agent screenshots from the editor viewport,
  migrated examples/starters, Meta Spatial removal audits, and automated app plus
  editor render-proof evidence. Authored transforms support zero scale and mirrored
  negative scale; world-preserving reparent operations retain reflections and report
  an operation-specific error only when a singular transform cannot be decomposed.

  The legacy `@iwsdk/glxf` package and fallback level importer are removed.
  `World.loadLevel()` now accepts native `.iwsdk.scene.json` and `.scene.json`
  documents only.

  Projects now declare their scene, asset/component modules, serializable world
  options, and emulator settings in `iwsdk.config.json`. Vite exposes those
  options through `virtual:iwsdk-project`; application code keeps ordinary
  `World.create()` and explicit system registration. Create embeds one common
  starter source instead of fetching Chef recipes, and the retired
  `@iwsdk/starter-assets` workspace package is removed.

  Native scene documents use one manifest-backed `asset` content kind plus groups,
  lights, prefabs, deterministic patterns, components, and constraints. glTF assets,
  procedural Three.js geometry, PBR materials, and custom shaders live in a dedicated
  application asset manifest imported independently by the runtime and editor. The
  editor exposes one unified asset catalog with manifest-derived bounds while keeping
  geometry and material authoring in code.

  The editor and runtime share lowering and expose scene metadata for parity checks.
  Generated Claude and Codex projects include the `iwsdk-scene-composer` skill for
  text, image, and hybrid static scene composition through direct files and the native
  editor. Scene roots can recursively import standalone modules with deterministic
  namespaces, and the managed editor watches root and module changes while preserving
  the last valid render on invalid edits.

  Release artifact verification now records package and documentation hashes and
  rejects package-manager-specific nested `node_modules`. Core and XR input use
  Three.js's public `MathUtils` export so packed modules remain portable.
  The reference-enabled starter and example paths pin patched Sharp 0.35.3 while
  upstream Transformers retains its older dependency range, and the reference
  package now ships complete warmup and offline-hosting guidance.

### Patch Changes

- Updated dependencies [c259681]
- Updated dependencies [91047c5]
  - @iwsdk/locomotor@0.5.0
  - @iwsdk/scene-composition@0.5.0
  - @iwsdk/xr-input@0.5.0

## 0.4.2

### Minor Changes

- `GrabSystem` now exposes two public methods so apps no longer need to
  deep-import the private `Handle` class to interrogate or unwind a grab
  (T270858800):
  - `forceRelease(entity: Entity): void` — drop a held entity (game reset,
    weapon swap, death/respawn, etc.). No-op if the entity is not held.
  - `getHolderHand(entity: Entity): 'left' | 'right' | null` — identify
    which controller is holding `entity`. Returns `null` when not held;
    for two-handed grabs, reports `'left'` deterministically.

### Patch Changes

- Changelog-formatted bullets (one per user-facing change). Copy into your changeset
  summary / changeset `.md`. `@iwsdk/*` is a fixed group, so all packages bump to 0.4.2.
  - Fix cylinder physics collider configuration when calling the Havok API so cylinder colliders collide correctly.
  - Keep the Havok physics engine and its ~2 MB WASM out of bundles when `features.physics` is disabled; physics is now code-split so `physics: false` apps no longer download it on first load.
  - Break a value-level import cycle (`ecs/world` ↔ `init/world-initializer`) that could leave a component reference `undefined` at class-body evaluation and crash `QueryManager.registerQuery` with `Cannot read properties of undefined (reading 'bitmask')` in bundled apps.
  - Guard `PhysicsSystem` against an unregistered `Grabbed` component, avoiding unnecessary coupling with the grab system (and a crash) when physics is used without grab.
  - Skip XR input visual initialization when the controller/hand GLTF asset fails to load (e.g. offline or firewalled CDN); input is still tracked without a visual instead of throwing `TypeError: Cannot set properties of undefined (setting 'frustumCulled')`.
  - Spawn the dev runtime with `shell: true` on Windows so the `npm`/`pnpm`/`yarn` `.cmd` shims resolve — fixes `iwsdk dev up` failing with "Failed to start the dev process". Also fixes silent hzdb telemetry on Windows.

- Updated dependencies
  - @iwsdk/glxf@0.4.2
  - @iwsdk/locomotor@0.4.2
  - @iwsdk/xr-input@0.4.2

## 0.4.1

### Patch Changes

- `AssetManager.getGLTF(key)` and `GLTFAssetLoader.getGLTF(key)` now return a fresh clone of the cached GLTF by default, preventing silent re-parenting when spawning multiple entities from the same asset. Pass `{ shared: true }` to opt back into the previous shared-instance behavior.
- Restore `world.camera` to its pre-XR local transform and projection after XR session exit, avoiding a broken browser fallback view after leaving immersive mode. Opt out with `xr: { restoreCameraOnExit: false }`.
- Route canvas pointer events correctly to screen-space `PanelUI`, including descendant hit handling.
- Add regression tests for GLTF cloning, browser camera restore, canvas pointer routing, and screen-space UI descendants.

- Updated dependencies
  - @iwsdk/glxf@0.4.1
  - @iwsdk/locomotor@0.4.1
  - @iwsdk/xr-input@0.4.1

## 0.4.0

### Minor Changes

- Browser-first runtime, action-backed locomotion, ECS-native player rig,
  reference/RAG tooling, runtime-first MCP, quad/cylinder layers, and
  cloud-friendly headless browser.

  ### Browser-First Runtime

  First-class non-XR support: `World.create({ xr: false })` keeps a
  persistent `world.player` origin with `world.camera` parented under it,
  so the same scene runs in a desktop browser and on-device.
  - New `world.input` facade with `input.xr`, stateful keyboard,
    browser gamepad, and deprecated XR compatibility aliases.
  - `input.canvasPointerEvents` config + `CanvasPointerSystem` lifts
    canvas DOM pointer forwarding out of spatial UI into a first-class
    input source.
  - `CameraSystem` now runs while the world is visible (browser
    non-immersive included), only stopping on hidden page/session.
  - `examples/browser-first/`: `xr: false` scene with WASD locomotion,
    RMB-hold pointer-lock mouselook (gimbaled yaw on player + pitch on
    camera), 1st/3rd-person toggle, ray + audio + grab + physics.

  ### Action-Backed Locomotion

  New `world.input.actions` (`InputActionManager`) and
  `ActionLocomotionInputProvider` so locomotion reads intent
  (`locomotion.move`, `.jump`, `.turn`, `.teleport`) instead of polling
  raw devices.
  - Slide, Turn, and Teleport refactored onto the shared provider; XR
    thumbsticks and opt-in browser bindings (WASD, arrow keys, Space,
    standard gamepad) feed the same code paths.
  - New `features.locomotion.browserControls` for first-person browser
    apps.
  - Slide vignette parents to `world.camera` so it tracks the active
    viewport in both XR and browser modes.

  ### ECS-Native Player Rig

  XROrigin and its 7 child spaces (head, raySpaces, gripSpaces,
  indexTipSpaces) are now persistent ECS entities, so apps can parent
  entities under the player rig.
  - New `world.playerEntity`, `world.playerHeadEntity`, and
    `world.playerSpaceEntities` accessors, mirrored on `System`.

  ### Reference & RAG Tooling
  - New `@iwsdk/reference` workspace package with warmup/cache flow and
    a dedicated CLI/MCP parity harness.
  - New `@iwsdk/reference-assets` producer-side ingestion pipeline for
    reference corpus generation, model archive packaging, and versioned
    payload metadata.
  - Reference search wired into the CLI/runtime surface with adapter
    and browser error-handling guardrails.

  ### Runtime-First MCP / CLI Consolidation

  Session resolution, MCP stdio, and adapter management moved into
  `@iwsdk/cli` so generated apps and examples share one entrypoint.
  - MCP adapter configs (Claude Code, Cursor, Codex, Copilot) are
    written at project creation by `create-iwsdk` — or on demand via
    `iwsdk adapter sync` — instead of by `dev up` at runtime.
  - `ai.tools` removed from the vite plugin config and dev-up auto-sync
    flow; configs are now a project-level concern.
  - New `iwsdk adapter sync` is the single adapter-write entry point.

  ### Quad & Cylinder Layers

  WebXR composition layers support for quad and cylinder layers, with
  `examples/layers/` demonstrating correct depth occlusion against a
  spinning ball.

  ### Cloud-Friendly Headless Browser

  `@iwsdk/vite-plugin-dev` auto-detects GPUs and falls back to
  SwiftShader (Playwright Chromium's bundled software renderer) on
  GPU-less Linux cloud VMs.
  - Linux `/dev/dri` probe via `hasGpuDevice()`.
  - `IWSDK_GPU=auto|gpu|swiftshader` env override.
  - Selected backend logged on every launch.
  - Auto-installs Chromium and simplifies MCP config lifecycle.

  ### Scaffolding
  - `--canary [url]` replaces `--from <url>`; bare `--canary` uses a
    baked-in CloudFront CDN URL, custom URLs still accepted.
  - `--xr / --no-xr` for browser-only projects.
  - MSE AI Scene Creation knowledge bundled into the project template
    so AI agents can discover/install/launch Meta Spatial Editor and
    drive `mse-agent`.
  - iwer bumped 2.2.0 → 2.2.1 (RemoteControlInterface duration-action
    error handling and upfront device validation in
    `executeSelectSequence`).

  ### Bug Fixes
  - XR pointers, rays, and cursors now hide until controllers connect,
    fixing the origin-flash on session entry. New
    `XRInputManager.disablePointers()` is invoked on no-session,
    no-frame/reference-space, and session-ended paths.
  - Depth occlusion: `isGPUDepth` is now derived from
    `session.depthUsage === 'gpu-optimized'` so the preprocessing and
    material shaders agree, and MinMax-occluded entities persist across
    XR session re-entry.
  - `InputSystem` no longer drops all descendants on the first frame
    (the `dirty`-bit + `isDescendantOf` filter raced with
    `TransformSystem` parenting); descendant arrays now rebuild every
    frame.
  - UI scroll containers: `localClippingEnabled` set so images no
    longer overflow.
  - `vite-plugin-dev`: avoid pointer ID collision between the
    injection bundle and the host app.
  - `Grabbed` component added and used for physics kinematic override.

### Patch Changes

- Updated dependencies
  - @iwsdk/glxf@0.4.0
  - @iwsdk/locomotor@0.4.0
  - @iwsdk/xr-input@0.4.0

## 0.3.1

### Patch Changes

- Truncate CAS asset filenames to stay under jsDelivr's 100-character path component limit, fixing 404 errors during project scaffolding.
- Updated dependencies
  - @iwsdk/glxf@0.3.1
  - @iwsdk/locomotor@0.3.1
  - @iwsdk/xr-input@0.3.1

## 0.3.0

### Minor Changes

- AI-native development with MCP tooling, depth occlusion, poke interactions, environment raycast, and grab system improvements

  ### AI-Native Development

  Integrated AI agent tooling that turns the dev server into an autonomous development environment for Claude Code, Cursor, GitHub Copilot, and OpenAI Codex.
  - **MCP server (`iwsdk-dev-mcp`)** with 34 tools for XR session management, device control, browser observation (screenshots, console logs), and scene/ECS introspection (hierarchy, pause/step/snapshot/diff).
  - **RAG code intelligence (`iwsdk-rag-local`)** for semantic code search, API reference lookup, and ECS component/system discovery.
  - **Three AI modes**: `agent` (headless Playwright), `oversight` (visible browser), `collaborate` (shared browser with DevUI).
  - **Headless browser with auto-recovery** via Playwright-managed Chromium with auto-install, crash recovery, and server-side screenshots.
  - **Per-tool scaffolding** via `--ai-tools` flag generating config files and project context docs for each assistant.
  - **Six Claude Code skills**: planner, grab, ray, UI, debug, physics.

  ### Depth Sensing & Occlusion
  - `DepthSensingSystem` with `DepthOccludable` component supporting `SoftOcclusion`, `HardOcclusion`, and `MinMaxSoftOcclusion` modes, plus stereo support.

  ### Poke / Touch Interaction
  - `TouchPointer` with priority-based pointer selection (Touch > Grab > Ray) and hysteresis thresholds for hand tracking.

  ### Environment Raycast
  - `EnvironmentRaycastSystem` wrapping WebXR Hit Test API for tap-to-place and controller-driven hit testing.

  ### Locomotion
  - Expanded `WorldOptions.features.locomotion` with `enableJumping`, `initialPlayerPosition`, `comfortAssistLevel`, and `turningMethod`.

  ### Grab System
  - `detachOnGrab`, `targetPositionOffset`/`targetQuaternionOffset` on `DistanceGrabbable`, and `useHandPinchForGrab` for hand tracking.

  ### CLI & Scaffolding
  - `--from <url>` for bundle-based project creation, full CLI flags with `-y`, and integrated Meta Spatial Editor installer.

  ### Other
  - `entity.dispose()` for GPU resource cleanup.
  - Migrated to `super-three@0.181.0`.
  - Renamed `@iwsdk/vite-plugin-iwer` to `@iwsdk/vite-plugin-dev`.
  - Physics: center of mass, angular/linear damping, gravity factor.
  - Scene understanding: persistent anchors, shared materials, recentering fix.

### Patch Changes

- Updated dependencies
  - @iwsdk/glxf@0.3.0
  - @iwsdk/locomotor@0.3.0
  - @iwsdk/xr-input@0.3.0
