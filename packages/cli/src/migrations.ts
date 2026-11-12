/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import semver from 'semver';

/**
 * Migration skills for releases that need more than a version bump. They ship
 * with the CLI rather than as project skills: `npx @iwsdk/cli@latest upgrade`
 * carries every guide the newest release knows about, even for a project whose
 * installed IWSDK predates the guide. The CLI build copies each guide from
 * docs/public/skills/<id>/SKILL.md, which iwsdk.dev also serves.
 */
export interface MigrationGuide {
  id: string;
  /** First release that needs the migration. */
  introducedIn: string;
  summary: string;
}

export const MIGRATION_GUIDES: MigrationGuide[] = [
  {
    id: 'iwsdk-migrate-0-5',
    introducedIn: '0.5.0',
    summary:
      'native scene JSON replaces GLXF, the managed editor replaces the external scene editor, retired Vite plugins removed, UIKitML loads at runtime',
  },
];

export interface MaterializedMigration extends MigrationGuide {
  /** Project-relative path of the written guide. */
  path: string;
}

const MIGRATIONS_DIRECTORY = '.iwsdk/migrations';

/** Guides for every release boundary in (from, to], oldest first. */
export function migrationsBetween(
  from: string | null,
  to: string,
): MigrationGuide[] {
  const fromVersion = from
    ? semver.coerce(from, { includePrerelease: true })
    : null;
  const toVersion = semver.coerce(to, { includePrerelease: true });
  if (fromVersion == null || toVersion == null) {
    return [];
  }
  return MIGRATION_GUIDES.filter(
    (guide) =>
      semver.lt(fromVersion, guide.introducedIn) &&
      semver.gte(toVersion, guide.introducedIn),
  ).sort((left, right) =>
    semver.compare(left.introducedIn, right.introducedIn),
  );
}

function bundledMigrationPath(id: string): string {
  // dist/cli.js reads dist/migrations; source runs (tests) read the build.
  const candidates = [
    new URL(`./migrations/${id}/SKILL.md`, import.meta.url),
    new URL(`../dist/migrations/${id}/SKILL.md`, import.meta.url),
  ].map((url) => fileURLToPath(url));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/**
 * Write the guides into the project's ignored .iwsdk/ directory, where an
 * agent can read them during the upgrade without them becoming project skills
 * that trigger long after it.
 */
export async function materializeMigrations(
  projectRoot: string,
  guides: MigrationGuide[],
): Promise<MaterializedMigration[]> {
  const written: MaterializedMigration[] = [];
  for (const guide of guides) {
    const relativePath = `${MIGRATIONS_DIRECTORY}/${guide.id}/SKILL.md`;
    const target = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(bundledMigrationPath(guide.id)));
    written.push({ ...guide, path: relativePath });
  }
  if (written.length > 0) {
    await ensureIwsdkDirectoryIgnored(projectRoot);
  }
  return written;
}

/** Add .iwsdk/ to the project's .gitignore unless it is already there. */
export async function ensureIwsdkDirectoryIgnored(
  projectRoot: string,
): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const current = existsSync(gitignorePath)
    ? await readFile(gitignorePath, 'utf8')
    : '';
  const lines = current.split(/\r?\n/u).map((line) => line.trim());
  if (lines.includes('.iwsdk/') || lines.includes('.iwsdk')) {
    return;
  }
  await appendFile(
    gitignorePath,
    `${current && !current.endsWith('\n') ? '\n' : ''}.iwsdk/\n`,
  );
}

export function formatMigrationNotice(
  from: string | null,
  to: string,
  migrations: MaterializedMigration[],
): string {
  if (migrations.length === 0) {
    return '';
  }
  return [
    `IWSDK ${from ?? 'an earlier release'} -> ${to} crosses ${migrations.length === 1 ? 'a release that needs' : 'releases that need'} code changes. Follow ${migrations.length === 1 ? 'this guide' : 'these guides, in order,'} before other work:`,
    ...migrations.map(
      (migration) =>
        `- ${migration.path} (${migration.introducedIn}: ${migration.summary})`,
    ),
  ].join('\n');
}
