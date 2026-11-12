# Release Guide (Changesets + pnpm)

This repository uses Changesets to version and publish the IWSDK runtime and
tooling packages together at the same version. The config lives in
`.changeset/config.json`. `@iwsdk/example-assets` is intentionally outside that
fixed group: immutable asset releases advance only after their independent
origin, license, integrity, and CDN gates pass.

## 0.5 Asset Release Gate

`@iwsdk/example-assets@0.4.2` is public and independently versioned. Its exact
jsDelivr files passed CORS, MIME, relative-resource, SHA-256, and cold-browser
verification on 2026-07-31. Starters and examples pin that immutable version;
they do not install the package or use its local-copy Vite bridge.

The completed asset-release sequence was:

1. Establish original-source and redistribution-license evidence for every
   catalog model, or replace it with an approved asset.
2. Publish the independently versioned asset package and pass its npm/CDN
   CORS, MIME, relative-resource, SHA-256, and cold-browser checks using the
   `Example Assets CDN Release` workflow.
3. Switch starters and examples to the verified exact-version CDN URLs.
4. Remove their `@iwsdk/example-assets` dependency and Vite plugin.
5. Run the normal npm (not canary/tarball-substituted) six-output Create matrix.

`@iwsdk/create` enforces the resulting boundary through its `prepublishOnly`
release-contract check: generated projects must contain the exact CDN URL and
must not install `@iwsdk/example-assets` or use its copy plugin.

## Everyday Flow (Contributor)

1. Make your changes on a feature branch.
2. Add a changeset describing your change and bump type:
   - `pnpm changeset`
   - Select the relevant runtime/tooling package (you can select one; the fixed
     group will keep that SDK release line in sync at versioning time).
   - Select `@iwsdk/example-assets` only for a separately approved asset
     release.
   - Pick bump type (patch/minor/major) and write a brief summary.
   - This creates a file under `.changeset/` (do commit it).
3. Open a PR. Review as normal.

Notes

- You can create multiple changesets across PRs; they’ll be combined when we cut a release.

## Cutting a Release (Maintainer)

From the `main` branch after PRs are merged:

1. Version packages (applies all pending changesets):
   - `pnpm changeset version`
   - This updates versions across the SDK fixed group, writes changelogs, bumps
     inter‑dependencies, and commits. It does not republish
     `@iwsdk/example-assets` unless that package has its own changeset.

2. Build all packages:
   - `pnpm build:all`
   - This first runs the private `@iwsdk/reference-assets` ingest, which builds
     the corpus that `@iwsdk/reference` bundles. It needs only local files.

3. Type-check every example against fresh local package tarballs:
   - `pnpm typecheck:examples`

4. Run the release preflight before any package is published:
   - `pnpm release:preflight`
   - This tests and runs the package-manifest guard against local-path
     dependencies, validates the example-asset publication metadata, and
     confirms Create no longer contains the retired local bridge.

5. Publish to npm (public):
   - Option A (recommended): `pnpm changeset publish`
   - Option B (explicit): `pnpm -r publish --access public`

6. Push tags and changes:
   - `git push --follow-tags`

## CI (Optional)

Consider a GitHub Action that:

- Runs on `push` to `main`.
- Executes `pnpm install`, `pnpm build:all`, `pnpm typecheck:examples`, then
  `pnpm changeset publish` (with `NPM_TOKEN`).

## Local Testing Tarballs

`scripts/build-tgz.sh` builds and packs all packages and renames the tarballs to versionless aliases (e.g., `iwsdk-core.tgz`). It temporarily rewrites `@iwsdk/*` workspace deps to local `file:` tarballs for packing and restores them afterward.

## Bump Guidelines

- patch: bug fixes, docs, build only, or safe internal changes.
- minor: backward‑compatible features.
- major: breaking changes (API removal/rename, behavior changes). Coordinate across packages since versions are fixed.

## Troubleshooting

- “No releases found”: Ensure there are pending files under `.changeset/` before running `changeset version`.
- “Tarball integrity mismatch” locally: delete lockfiles in generated starters; we already prune locks in starter scaffolds.
- Publishing failures: verify `NPM_TOKEN` with publish rights and `package.json` `publishConfig.access` is `public` (default for our packages).
