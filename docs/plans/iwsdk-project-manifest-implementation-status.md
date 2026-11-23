# IWSDK Project Manifest Migration — Implementation Status

Source plan:
`docs/plans/iwsdk-project-manifest-and-starter-simplification-plan.md`

This file is the resumable implementation ledger for the cross-package SDK
migration. It replaces a game-specific `design/PIPELINE.md`; the repository's
established architecture artifacts live under `docs/plans/`.

## Phase State

| Phase                            | Status      | Evidence / gate                                                    |
| -------------------------------- | ----------- | ------------------------------------------------------------------ |
| 0. Contract, inventory, baseline | Complete    | `docs/test-evidence/project-manifest-baseline/`; inventories below |
| 1. Immutable asset distribution  | Complete    | First-party MIT package and exact-version CDN checks pass          |
| 2. Manifest, validation, assets  | Complete    | Core, scene-composition, Vite contract and packed-type tests       |
| 3. Common starter                | Complete    | Shared source proven across the packed six-output matrix           |
| 4. Self-contained Create         | Complete    | Packed six-output clean install/build/runtime/editor matrix        |
| 5A. Harness/evidence rewrite     | Complete    | Packed CDN route covers 10 examples and the 6 starter combinations |
| 5B. Examples/docs/guidance       | Complete    | Consumers pin the verified CDN and support a local-mirror override |
| 6. Old-pipeline removal          | Complete    | Starter/Chef and live example-assets copy-plugin use are removed   |
| 7. Release verification          | In progress | Automated packed/CDN evidence passes; headset signoff remains      |

## Acceptance-Criteria Audit

| AC    | State                  | Authoritative evidence or missing proof                                                                |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 1–7   | Proven                 | Common Create source, manifest/schema/parser, virtual module, explicit system registration, direct API |
| 8–10  | Proven                 | Public 0.4.2 package, exact CDN URLs, and no installed/local-copy bridge in generated or example apps  |
| 11–12 | Proven                 | Recipe/Chef code and `@iwsdk/starter-assets` are deleted; strict repository audits pass                |
| 13    | Proven                 | Packed Create matrix clean-installs, builds, renders, edits, saves, and reloads all six combinations   |
| 14    | Automated proof passes | Browser, emulated VR, and emulated AR are clean; physical-headset release evidence is not yet recorded |
| 15    | Proven                 | 0.5 guide and packaged migration skill document manifest-first and explicit `WorldOptions` paths       |
| 16    | Proven                 | Structured ID/URL/timeout and priority behavior plus real-CDN asset loading pass                       |
| 17    | Proven                 | `npm pack` contract verifies common TS/JS templates, declarations, dotfile aliases, scenes, and skills |

The combined implementation is complete except for the physical-headset
release-signoff evidence required by criterion 14.

## Preserved Baseline

- Source commit: `9ef13268`.
- Implementation branch: `stack/iwsdk-project-manifest`.
- Pre-implementation plan backup: `stash@{0}`, message `backup before project
manifest implementation 2026-07-30`.
- Six materialized starter variants: 93 files with SHA-256 records in
  `docs/test-evidence/project-manifest-baseline/starter-variants.sha256`.
- Native scene migration check: PASS (12 source scenes, 3 generated starter
  scenes, 9 shared asset configs).
- Packed Create E2E: PASS (12/12), with VR, AR, and Browser runtime/editor
  screenshots and proof JSON in the baseline evidence directory.

## Resolved Contracts

- Public virtual module: `virtual:iwsdk-project`.
- Public ambient types: `@iwsdk/vite-plugin-dev/client`.
- Normalizer owner: browser-safe pure API in `@iwsdk/core`.
- Manifest XR value: `false | ProjectXRConfig`.
- Asset and component module paths: optional, extensionless, local, and
  project-root-confined.
- Spatial UI: serializable options are manifest data; executable
  `componentSets` remain a code-only merge in `index.ts`.
- Project locomotion uses readable `turningMethod: "snap" | "smooth"` and the
  core normalizer maps it to the existing numeric runtime enum.
- Desktop: shared immersive scene plus the common browser camera/mouselook
  system. It runs only for `xr:false` worlds so preview input cannot mutate an
  XR project's authored spawn.
- Stock asset override: `VITE_IWSDK_EXAMPLE_ASSET_BASE_URL`, which is visible
  to browser asset modules without a second Vite configuration bridge.
- Project emulator settings retain device, IWER, environment, activation,
  build injection, and JSON-safe regex source/flags exceptions. HTTPS and
  verbose logging remain Vite/plugin concerns.
- Manifest-first dev servers always expose the managed editor and command
  session. There is no persisted `workspace.enabled` switch; AI, open,
  headed/headless, and screenshot settings are session-owned.
- Generated targets all retain the default `dev.emulator.iwer = true`; Desktop
  does not lose the runtime command bridge merely because `world.xr = false`.
- Deterministic CI: packed-file route/local server. Real jsDelivr proof:
  network-enabled `cdn-release` lane.
- Compatibility: IWSDK 0.5 hard-errors on retired Vite metadata options; no
  shipped dual authority.

## World.create Inventory

There are exactly ten examples.

| Example             | Target  | Serializable world surface                                                                                        | Modules / code-only surface                                 |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| audio               | VR      | VR + required hand tracking; locomotion; spatial UI; audio scene                                                  | assets, Spinner components; Settings/Spin systems           |
| browser-first       | Desktop | `xr:false`; near/far/camera; canvas pointer; browser locomotion; grabbing; physics; spatial UI                    | procedural assets; feedback and mouselook systems           |
| depth-occlusion     | AR      | AR/unbounded; structured required depth sensing; hit-test/anchors; render camera; grabbing/spatial UI             | procedural assets; configured DepthSensing and demo systems |
| environment-raycast | AR      | AR; optional hand/layers; required hit-test; environment raycast; disabled locomotion/physics/scene understanding | assets; raycast plant system                                |
| grab                | VR      | VR + required hand tracking; pinch grabbing; locomotion/spatial UI                                                | assets                                                      |
| layers              | VR      | VR layers; spatial UI                                                                                             | procedural assets and executable XR layer render callbacks  |
| locomotion          | VR      | VR + required hand tracking; near/far; grabbing/locomotion/spatial UI                                             | assets, Elevator/Settings components; two systems           |
| physics             | VR      | VR + optional hand tracking; grabbing/locomotion/physics/spatial UI                                               | procedural assets                                           |
| poke                | VR      | VR + optional hand/layers; worker locomotion; grabbing/spatial UI                                                 | assets, Robot component; Robot system                       |
| scene-understanding | AR      | AR/unbounded; required hit-test/plane/mesh/anchors; grabbing/scene understanding/spatial UI                       | procedural anchor; SceneShow system                         |

The schema must therefore cover `xr:false`, reference spaces, structured XR
feature values, render camera pose, canvas pointer events, browser locomotion,
initial player position, pinch grabbing, and serializable spatial UI options.
System constructors/configuration, procedural `Object3D` values, XR layer
callbacks, and spatial UI component sets remain executable module/code values.

Only audio, locomotion, and poke currently declare custom component manifests.
The other seven prove that both module pointers must be optional.

## Current Pipeline Consumers

### Starter/Create chain

`starter-template` → `generate-starters.mjs` → `variants-src` →
`build-assets.mjs` → Chef recipes/CAS → Create recipe source → Chef scaffold.

Live replacement points:

- `packages/create/src/{cli,recipes,source,scaffold,catalog,types}.ts`
- `packages/create/package.json` and Create tests
- `packages/starter-assets/starter-template/**`
- `packages/starter-assets/scripts/**`
- guidance under `packages/starter-assets/{PROJECT_*,claude-injections}`

The live template distinctions are `@template:*`, `@session-mode`, and the
`@chef:xr-config`/`@chef:app` feature anchors. The last two cannot disappear
until generated manifest data carries their values.

### Example asset chain

Eight examples plus the starter now pin
`https://cdn.jsdelivr.net/npm/@iwsdk/example-assets@0.4.2/assets` and retain
`VITE_IWSDK_EXAMPLE_ASSET_BASE_URL` for local mirrors and deterministic test
fixtures. They neither install `@iwsdk/example-assets` nor call
`iwsdkExampleAssets()`.

### Hard repository consumers

In addition to the source packages, removal must update root scripts,
`pnpm-lock.yaml`, pending changesets, bundle/release scripts, canonical MCP and
native-scene checks, CLI/reference fixtures, both native-scene and docs CI,
Sandcastle, root/package READMEs, guidance copies, and generated evidence.

## Pre-existing Defects To Fix During Migration

1. Browser starter runtime is a uniform blank background even though the
   hierarchy/editor loads. `mouselook.ts` exists but is not registered.
2. `DepthSensingSystem` does not replay already-loaded `DepthOccludable`
   entities after post-level registration.
3. Fixed during the second pass: the CLI starter-shape test now resolves the
   canonical common template from the active checkout instead of embedding an
   absolute path to another worktree.
4. Starter evidence validation covers VR and AR but omits the Browser proof
   that Create already records.
5. Root and starter copies of planner/guidance content have drifted; relocation
   needs one canonical source or a synchronization test.
6. Fixed during the second pass: generated starters now use a data favicon and
   the proof harness no longer carries a generic 404/request-abort allowlist.

## Published Asset Distribution

The IWSDK maintainer confirmed on 2026-07-31 that `environment-desk`, `robot`,
and `plant-sansevieria` are first-party assets owned by Meta Platforms, Inc. and
affiliates and distributed under MIT. `packages/example-assets/PROVENANCE.md`
records that confirmation, the historical source paths, the copyright notice,
and the exact catalog hashes. The npm artifact includes the MIT `LICENSE`.

Only `@iwsdk/example-assets@0.4.2` was published. Its npm tarball has SHA-1
`fabea4085ea5a35c08cb62231ade9e011d4b5502` and registry integrity
`sha512-lwMKUyPLuScFWrCvWRt+6wlpTH2UjPSzDkMGNBjuWHVXEuLYzgxD9ei8LmZ+MTQI5N3tFjTn2C9cVIMyPjMZiw==`.
The post-publication jsDelivr check passed all 14 files, their CORS and MIME
contracts, relative glTF resources, byte sizes and SHA-256 values, and three
cold Chromium model loads.

## Feedback Second Pass

The external review was treated as evidence, not as an API specification. The
second pass made these dispositions explicit:

- rejected project-level `assets.enabled` and `assets.include`; one complete
  catalog is always available, while entry priority controls loading;
- rejected persisted `dev.workspace.enabled`; manifest-first dev servers always
  expose the managed editor/command session, while launch and AI choices are
  session-owned;
- retained explicit IWER/emulator project data, independent of `world.xr`, and
  documented its defaults;
- kept Track B local until first-party ownership and MIT terms were confirmed,
  then published and verified `0.4.2` before enabling its exact CDN URL;
- separated asset integrity validation from redistribution publishability and
  recorded repository history as custody rather than provenance;
- corrected the browser override to
  `VITE_IWSDK_EXAMPLE_ASSET_BASE_URL` so Vite actually exposes it;
- wired that override into the common asset catalog, with the verified
  exact-version CDN as the default and a local-mirror override for tests and
  offline deployments;
- prevented the dev-only workspace bridge from entering production builds;
- made config restart detection robust to macOS `/var` versus `/private/var`
  realpath aliases;
- preserved low-level scene importer compatibility when no asset catalog is
  available, while enforcing catalog references in real runtime/editor worlds.
- made Create's migration, scene-composer, and UIKit guidance canonical for
  generated apps; Create derives byte-identical Codex skill packages, and a
  source-level test keeps the repository and starter planner copies aligned.
- corrected the generated starter's player/camera ownership after re-reading
  the review against the runtime: shared scenes no longer encode a browser
  preview offset as `player.transform`; VR/AR preview poses live in
  `world.render.camera`, Desktop uses `initialPlayerPosition` plus a local
  head-height camera, locomotion applies that starting position before native
  scene baseline capture, and the common mouse-look system is inert whenever
  XR is enabled.
- kept production IWER injection independent from the development workspace:
  manifest-first `vite serve` always exposes the managed editor, while
  `vite build` includes only explicitly requested IWER emulation and never the
  workspace bridge;
- rewrote stale planner/reviewer/depth guidance to use the manifest asset,
  project-mode, and public-URL contracts, then rebuilt the derived Codex
  guidance from the canonical Claude source;
- moved ignored legacy `packages/starter-assets` build output out of the
  checkout before running deletion gates so stale recipes could not mask a
  missing-package failure.
- omitted asset/component bindings entirely when their optional manifest
  modules are absent, rather than passing unbranded placeholder values into
  `World.create()`;
- decoupled `@iwsdk/example-assets` from the fixed SDK version group and
  published exact version 0.4.2 independently. Generated projects consume its
  immutable files through jsDelivr without installing the package;
- extended runtime smoke coverage from three representative examples to all
  ten and kept managed authorization headers confined to the local app origin;
- added Browser to the durable starter-evidence validator, made its expected
  scene mutation target-aware, and removed the generic 404/external-abort
  allowlist;
- made packed Desktop proof wait for a genuinely rendered frame, verify the XR
  action is hidden, and exercise the shipped mouse-look handlers. The initial
  player/camera pose now renders an elevated oblique scene overview rather than
  a close-up of the environment wall.
- replaced the legacy `@meta-quest/hzdb` compatibility shim with a direct
  `@meta-quest/metavr` starter dependency so adapter and telemetry discovery
  use the current package and command name;
- moved the static WebXR logo banner out of `index.ts` into a local unlit glTF
  asset referenced by both scene seeds, leaving the entry point responsible
  only for runtime creation and explicit system registration;
- split the plan's Definition of Done by workstream and downgraded the mixed
  example/removal phases to `Track A done`, so local bridge success cannot be
  mistaken for the final public-CDN state.
- added the named network-only `Example Assets CDN Release` workflow and its
  exact-version verifier. The same verifier passes locally against all 14
  package files and cold-loads all three models in Chromium, while the public
  mode refuses to run before origin/license metadata is verified.
- added one shared packed-package route fixture. It runs `npm pack`, extracts
  the archive, verifies every served byte against the catalog, and fulfills a
  fake exact-version CDN origin through Playwright. All ten examples pass with
  their asset base overridden to that route. The packed Create matrix also
  passes all six target/language combinations with runtime restricted to
  scene-used assets while editor previews can load the complete catalog.
- fixed an inspector autosave race exposed by the full editor rerun. Completed
  numeric/vector field edits now commit on their normal change boundary, and
  the scene-file watcher waits for queued mutations and compares saved hashes
  before treating a write as external. This prevents the editor's own autosave
  from rerendering a component row and discarding a neighboring field edit.
- removed the no-op `world.features.locomotion.browserControls.pointerLock`
  manifest key. Pointer-lock camera ownership is application code in v1, so a
  setting whose only valid value was `false` did not belong in the schema.
- removed retired asset/component metadata from the public Vite plugin type and
  made runtime configuration reject it even when no project manifest exists;
  this now matches the documented 0.5 hard-error boundary.
- made Create clean `dist/guidance` before rebuilding it, preventing deleted
  skills or instructions from surviving into a later npm tarball.
- extended the rendered installed-flow editor/save/reload proof from the three
  TypeScript targets to all six target/language combinations. Automation opts
  into headless mode explicitly; the product default remains headed.
- added both package-level and repository-level release preflights. Create
  refuses publication if generated output installs `@iwsdk/example-assets` or
  uses the copy plugin, preventing regressions to the retired bridge.

## Verification Discipline

Every phase records commands and durable evidence here or in
`docs/test-evidence/project-manifest-*`. A package build alone is insufficient:
packed-package type resolution, clean external scaffolds, managed editor,
runtime, browser/XR interaction, console cleanliness, and exact asset request
behavior are required before the corresponding gate changes to complete.

## Packed Create Evidence

The Create E2E file passes all 12 tests. Its install-enabled matrix scaffolds all
six target/language combinations from packed SDK tarballs, clean-installs them,
typechecks TypeScript variants, builds every variant, starts HTTPS Vite servers,
loads the manifest-selected scene without a query override, verifies managed
browser command readiness, renders the runtime and editor for every variant,
performs a scene edit/save, and observes the saved result after runtime reload.

The gate exposed and fixed two issues that source-workspace tests missed:

- generated projects used unconstrained `@types/three`, creating incompatible
  nested Three type universes beside core's 0.181 contract;
- installed-flow assertions still referenced retired per-target scene filenames
  and target-specific AI modes.

`build:tgz:skip-reference-assets` also now suppresses the reference-assets
workspace `prepare` hook, rather than rebuilding the corpus indirectly during
the temporary dependency reinstall.

The feedback second-pass rerun used fresh packed tarballs and fresh external
installs. All ten examples typecheck and build, their production summaries omit
the managed workspace bridge, the 12-scenario packed Create matrix passes, and
the frozen-lockfile install, changeset graph, legacy-integration removal audit,
and SDK dependency bundle all pass with `packages/starter-assets` absent.

The final packed Create rerun also enforces Browser-specific behavior: the
shared scene renders above the nonblank threshold before and after reload, the
Desktop panel has no live XR action, and the mouse-look system changes the
camera orientation and releases pointer lock. After the scene-owned banner and
starter dependency corrections, the final fresh packed rerun passed all 12
scenarios in 179.65 seconds across all six target/language combinations. VR, AR, and
Browser proof passes the three-target starter-evidence validator. The full
Create source suite now passes 71 tests with one intentional install test
skipped. The tracked reference corpus remains intentionally deferred to the
final corpus-generation step.

The repository-example render gate now covers every migrated example, rather
than only the previous audio/grab/physics representatives. Audio,
browser-first, depth-occlusion, environment-raycast, grab, layers, locomotion,
physics, poke, and scene-understanding each pass both the runtime and real IWSDK
WebGL editor paths with their expected hierarchy and active components,
nonblank screenshots, clean network/console diagnostics, and stock assets
served from a byte-verified packed `@iwsdk/example-assets` fixture. All ten
examples also pass the manifest/scene contract audit, TypeScript checking, a
separate runtime smoke, and fresh npm install plus production build with zero
reported vulnerabilities. Stale timeout artifacts from earlier failed
grab/physics proof attempts were removed so durable evidence contains only the
current successful run.

The feedback implementation's second adversarial editor pass initially found
one reproducible `DistanceGrabbable` inspector race. After the autosave/watcher
fix, the focused schema matrix passed five consecutive runs, the save/reload and
external-conflict scenarios passed together, and the full Vite/editor suite
passed 263 tests with one intentional skip. Core (368), scene-composition (71),
CLI (89), example-assets (14), and Create (71 pass / 1 intentional skip) also
remain green. Full lint, formatting, frozen-lockfile installation, legacy
integration removal, SDK bundle construction, and diff whitespace checks pass.

The release-artifact pass builds API docs, VitePress, and all ten documented
examples, then scans nine packed public-package tarballs and 1,784 textual files
across 2,066 built-docs artifacts. Its first run exposed an overbroad
retired-surface rule that rejected the packaged 0.5 migration skill for naming
the legacy surfaces it removes. The scanner now permits those names only in the
exact packaged migration resources, has a focused allowlist-contract test, and
passes without exempting live code or ordinary guidance.

That pass now emits the deterministic Track A artifact manifest under
`docs/test-evidence/project-manifest-release/current/`. The first package-file
inventory exposed `@iwsdk/xr-input` publishing two pnpm-specific
`dist/node_modules/.pnpm/.../MathUtils` files because live source imported a
private Three.js module path and its build did not clear stale output. Core and
XR input now use the public `MathUtils` export, XR input cleans only its own
`dist` before building, and the release scanner rejects nested `node_modules`
in every package. Fresh tarballs contain no such paths.

The packaged 0.5 migration skill also has a compile-backed contract test. A
fresh external-style fixture uses the documented bare `iwsdkDev()` config,
`defineAssets()`, `defineComponents()`, `virtual:iwsdk-project`, `World.create`,
and typed `UIKitMLAsset` scene lookup against the final public declarations.

Clean npm installation also exposed an upstream advisory in the optional
development reference tool: released Transformers versions still declare Sharp
`^0.34.x`, while the fixed line starts at 0.35. Generated starters already
override Sharp to 0.35.5. The sole repository example that installs
`@iwsdk/reference` now carries the same tested override, and the native-scene
verifier prevents future reference-enabled examples from omitting it. Its full
npm audit, reference tests, and production build pass with zero findings.
`@iwsdk/reference` now ships the previously missing package README with warmup,
offline-hosting, query, and manual-install override guidance; the release scan
requires a README in every public package tarball.

The example-assets publication and Create consumer gates are now green. The
remaining release boundary is physical-headset smoke evidence; automated
browser, emulated XR, packed-package, and real-CDN verification do not replace
that final device signoff.
