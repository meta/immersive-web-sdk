---
name: iwsdk-dev
description: Single entry point for IWSDK development. Invoke first for every IWSDK implementation request. Routes fresh builds to an internal planning playbook and bounded changes to an established app to an internal iteration playbook.
argument-hint: '[IWSDK development request]'
---

# IWSDK Dev

Route the current request before inspecting files, planning, invoking a
specialist, or editing code. This file is only the entry point; after choosing,
load exactly one internal playbook and follow it for the rest of the task.

## Route

Choose the **iterate path** only when the workspace already contains an established
experience and the request asks to preserve that product while changing,
extending, fixing, tuning, or polishing a bounded part of it.

Choose the **planner path** for a fresh scaffold, a new experience, a replacement of
the current product loop, or a request whose implementation requires defining
the product rather than preserving it. A detailed acceptance contract does not
turn a greenfield build into an iteration.

Observable workspace state wins over wording:

- starter/demo files in a fresh generated scaffold are not an established user
  product when the request asks to build a new named experience;
- an existing coherent scene/source/UI implementation that the request calls a
  baseline, approved experience, or current app is an iteration;
- when the request replaces most of the loop, route to the planner even if files
  already exist;
- explicit user selection of a child route overrides automatic routing.

## Internal handoff

1. State the selected route in one sentence.
2. Read exactly one internal playbook immediately:
   - planner path: references/planner.md
   - iterate path: references/iterate.md
3. Do not read project files, call Bash, create a plan, or invoke a specialist
   between this router and the selected playbook.
4. Never load the other playbook later, including after context compaction.

iwsdk-dev does not add another implementation phase. The selected playbook owns
the work, evidence budget, specialist routing, verification, and stopping rule.
