---
outline: [2, 3]
---

# Upgrading IWSDK

All `@iwsdk/*` packages are released together under one version. Upgrade them
together, with the CLI:

```bash
npx @iwsdk/cli@latest upgrade --dry-run   # what would change
npx @iwsdk/cli@latest upgrade             # do it
```

Run it with `@latest`, even when the app already has an older `@iwsdk/cli`
installed. Migration guides and release notes ship with the CLI, so the newest
CLI covers every release, whichever version the app starts from. For a specific
release, add `--to <version>`.

## What the command does

1. Sets every `@iwsdk/*` dependency in the release group to the new release,
   keeping `^` and `~` ranges. `workspace:`, `file:` and `catalog:` specs, and
   `@iwsdk/*` packages outside the release group, are left as declared and
   listed. It first asks the registry the install will use for the release,
   and changes nothing if the release is missing there: a registry mirror can
   lag behind a release. It reads the settings the install reads: npm's (the
   `.npmrc` at the app's workspace root, then your user settings; in a pnpm
   workspace, also the app's own `.npmrc`, whose settings win), or Yarn's
   (`.yarnrc` and `.npmrc` with Yarn 1, `.yarnrc.yml` with Yarn 2+). With npm,
   pnpm and Yarn 1, the `npm_config_registry` environment variable overrides
   the registry unless an `@iwsdk` scope registry is set. Offline, npm answers
   from its cache when that has the release. If the registry cannot be asked,
   for example offline or without npm, it says why and goes on; `three` is
   then aligned after the install.
2. Sets the `three` alias and its override (in `package.json`, or the app's own
   `pnpm-workspace.yaml`) to the version the new `@iwsdk/core` uses, and an
   existing `@types/three` to core's range. A workspace-wide override is
   reported instead of changed. With `--no-install`, it warns when a `^` or `~`
   range for `@iwsdk/core` also matches a newer release, which an install
   could pick instead.
3. Installs with the app's package manager, found from the nearest lockfile, a
   monorepo's included.
4. Refreshes the coding-agent guidance the app already has (see below); it does
   not add guidance to an app that has none.
5. Checks `iwsdk.config.json` against the new release and lists every setting
   that no longer validates, with its JSON path.
6. Writes to `.iwsdk/migrations/`, which it adds to `.gitignore`:
   - a migration guide for each release boundary that needs code changes, such
     as `iwsdk-migrate-0-5/SKILL.md` for apps older than 0.5;
   - `release-notes.md`, every change released between the two versions.

Its output names these files. Follow the migration guides first, oldest first,
then read the major and minor entries in the release notes.

## Check the app

Record the app's typecheck, build, and browser-log errors before upgrading, and
compare after: older apps often have errors that predate the upgrade. A clean
build does not show that the app renders, so also look at the running app and
enter XR when it is an XR app.

## Coding-agent guidance

The skills, rules, and `AGENTS.md` block that coding agents read ship inside
`@iwsdk/core`, stamped with their release. Upgrading the package upgrades
them:

- `iwsdk upgrade` and `npx @iwsdk/cli@latest agents sync` refresh them
  directly.
- After a plain `npm install` bump, the next `iwsdk dev up` refreshes the files
  nobody edited and says what changed. A skill or file the release renamed or
  retired is replaced by its successors in the same run, so the app never ends
  up with less guidance than it had. Apart from that it never adds guidance
  the app does not have: files you removed, and files new in the release, stay
  out, and when it refreshes, its notice lists them for `agents sync`. It only
  reports, without writing, when
  `CI` is set, when `node_modules` holds a different `@iwsdk/core` than the
  lockfile resolves, or when `iwsdk.config.json` sets
  `"dev": { "agentGuidance": "warn" }` (`"off"` disables the check).
- Files you edited are reported and left alone; `agents sync --force` replaces
  them. Files a newer release wrote are never rolled back.
- `npx @iwsdk/cli@latest agents check` exits 1 when the guidance is not
  current, for CI.

Coding agents can follow the `iwsdk-upgrade` project skill, which walks through
these steps.

## Dependency bots

Run the guidance sync after the bot bumps the packages, with dependencies
installed. With Renovate (self-hosted Renovate must also allow the commands):

```json
{
  "postUpgradeTasks": {
    "commands": ["npm ci", "npx @iwsdk/cli@latest agents sync"],
    "fileFilters": ["**/*"]
  }
}
```

Use your package manager's install in place of `npm ci`
(`pnpm install --frozen-lockfile`, `yarn install --immutable`).
