# IWSDK Scene Review

Review the actual managed-editor output, not source code alone. Keep evidence and the
defect list in the task or benchmark artifacts; do not create a process-document
pipeline unless the user requests one.

## Inputs

Use:

- the request and explicit acceptance criteria;
- the active scene document and its hashes;
- editor screenshots from exact built-in or saved views;
- render statistics and recent unfiltered logs;
- isolated asset evidence from `iwsdk-build-model` for any new model.

## Passes

### Layout

Check hierarchy, scale, clear player volume, navigation space, repeated placement,
support relationships, and obvious overlap. Use top/front views first.

### Asset Fit

Check whether each model reads correctly at its placed scale, whether contacts and
occlusion make spatial sense, and whether scene transforms are compensating for a
model-local defect. A defect that persists in an isolated clay preview routes to
`iwsdk-build-model`.

### Final

Check material readability, lighting hierarchy, environment contrast, hero framing,
and player-spawn framing. The editor render proves static authored state; use the app
runtime for anything driven by systems.

## Defect Record

For each material defect, record:

- view and affected scene node;
- observed evidence;
- expected result;
- owner: model or composition;
- proposed correction;
- regression risk.

Fix only the highest-impact coherent batch before rerendering. Do not compensate for
bad geometry with camera tricks, hide penetrations behind lighting, or silently lower
the requested fidelity.

## Stop Rules

Default to at most two focused correction rounds after the first complete review.
Stop earlier when:

- the same defect repeats;
- two changes oscillate;
- applicable diagnostics plateau or regress;
- required input or assets are missing;
- the representation ceiling cannot satisfy a required feature;
- a user decision is required.

Completion requires passing scene/module renders, an import-free flat scene, a clean
editor state, nonblank required views, correct player-spawn framing, resolved manifest
ids, and a successful application build/runtime load.
