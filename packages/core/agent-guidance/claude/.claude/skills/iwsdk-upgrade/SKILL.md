---
name: iwsdk-upgrade
description: Upgrade an IWSDK app to a newer IWSDK release and prove it still works. Use when the user asks to upgrade, update or bump IWSDK or any @iwsdk/* package, when iwsdk dev up reports guidance updated from an older release, or when errors appear right after an IWSDK version change.
argument-hint: '[target version, default latest]'
---

# Upgrade IWSDK

An upgrade has three parts: move the packages, apply what changed between the
two releases, and show that the app behaves as it did before. Do them in that
order.

## 1. Record the baseline first

Before changing any version, check `git status`, make sure the user's work is
saved or committed (do not commit unless the user allowed it), and record how
the app behaves now: run its typecheck and build scripts with the project's
package manager (for example `npm run typecheck` and `npm run build`).

Write down every error, then start the dev server and save the browser log and
a runtime screenshot. Older apps often have errors that predate the upgrade;
without a baseline you cannot tell them from new ones, and proving it later
costs a full reinstall.

## 2. Move the packages

```bash
npx @iwsdk/cli@latest upgrade --dry-run
npx @iwsdk/cli@latest upgrade
```

Always run it with `@latest`, even if the project has an older `@iwsdk/cli`:
the newest CLI carries every migration guide. For a specific release, add
`--to <version>` (`npx @iwsdk/cli@<version> upgrade` works only for releases
that include the `upgrade` command). It sets every `@iwsdk/*` package to the release, installs
with the project's package manager, aligns the `three` alias and an existing
`@types/three` with `@iwsdk/core`, refreshes this guidance, and writes to `.iwsdk/migrations/`:

- one `iwsdk-migrate-*/SKILL.md` for each release boundary that needs code
  changes;
- `release-notes.md` with every change between the two versions.

It also checks `iwsdk.config.json` against the new release and lists settings
that no longer validate. Packages it reports as "not part of the IWSDK release"
were left as declared; remove one only if a migration guide says it was
retired. In a monorepo it installs with the workspace's package manager; if a
workspace-level override pins `three`, it tells you to change it.

If the user asked for a plain package-manager bump instead, do that, then run
`npx @iwsdk/cli@latest agents sync`; `iwsdk dev up` also refreshes unedited
guidance.

## 3. Apply what changed

1. Follow each migration guide in `.iwsdk/migrations/`, oldest first, before
   other work.
2. Read the major and minor entries in `release-notes.md` and check whether
   the app uses what they change (renamed settings, new required versions,
   changed defaults).
3. Fix each `iwsdk.config.json` issue the upgrade listed.
4. Re-read the `iwsdk-agent-guidance` block in `AGENTS.md`: it now describes
   the new release. Do not hand-edit guidance files; an edited file stops
   receiving updates.

## 4. Prove it

Run the same checks as the baseline and compare. Report new errors and fix
them; report baseline errors separately as existing. A clean typecheck and
build do not show that the app renders: confirm the runtime screenshot and an
error-free browser log, and enter XR when the app is an XR app.

The upgrade is done when every migration guide is applied, the comparison
shows no new errors, and the user knows which existing errors remain.
