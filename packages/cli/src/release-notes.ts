/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync, readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import semver from 'semver';
import { ensureIwsdkDirectoryIgnored } from './migrations.js';

/**
 * Changelog entries of the release group, built into dist/release-notes.json
 * by scripts/build-release-notes.mjs. `iwsdk upgrade` writes the entries
 * between two versions where the agent doing the upgrade can read them.
 */
export interface ReleaseNote {
  version: string;
  kind: 'major' | 'minor' | 'patch';
  packages: string[];
  text: string;
}

export interface WrittenReleaseNotes {
  path: string;
  count: number;
  /** Major and minor entries: the ones that can need app changes. */
  notable: number;
}

const RELEASE_NOTES_PATH = '.iwsdk/migrations/release-notes.md';

function loadReleaseNotes(): ReleaseNote[] {
  // dist/cli.js reads dist/release-notes.json; source runs (tests) read the build.
  for (const candidate of [
    new URL('./release-notes.json', import.meta.url),
    new URL('../dist/release-notes.json', import.meta.url),
  ].map((url) => fileURLToPath(url))) {
    if (existsSync(candidate)) {
      return (
        JSON.parse(readFileSync(candidate, 'utf8')) as {
          entries: ReleaseNote[];
        }
      ).entries;
    }
  }
  return [];
}

/** Entries for every release in (from, to], oldest first. */
export function releaseNotesBetween(
  from: string | null,
  to: string,
  notes: ReleaseNote[] = loadReleaseNotes(),
): ReleaseNote[] {
  if (from == null || semver.valid(from) == null || semver.valid(to) == null) {
    return [];
  }
  const seen = new Set<string>();
  return (
    notes
      .filter(
        (note) =>
          semver.valid(note.version) != null &&
          semver.gt(note.version, from) &&
          semver.lte(note.version, to),
      )
      .sort((left, right) => semver.compare(left.version, right.version))
      // A stable release repeats its prereleases' entries; keep the first.
      .filter((note) => !seen.has(note.text) && Boolean(seen.add(note.text)))
  );
}

function formatReleaseNotes(
  from: string,
  to: string,
  notes: ReleaseNote[],
): string {
  const lines = [
    `# IWSDK release notes: ${from} -> ${to}`,
    '',
    'Every change released after the version this project used, oldest first. Major and minor changes are the ones most likely to need app changes; migration guides in this folder take precedence.',
  ];
  let version: string | null = null;
  for (const note of notes) {
    if (note.version !== version) {
      version = note.version;
      lines.push('', `## ${version}`, '');
    }
    const text = note.text.replace(/\n/gu, '\n  ');
    lines.push(
      `- **${note.kind}** (${note.packages.map((name) => name.replace('@iwsdk/', '')).join(', ')}): ${text}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function writeReleaseNotes(
  projectRoot: string,
  from: string | null,
  to: string,
): Promise<WrittenReleaseNotes | null> {
  const notes = releaseNotesBetween(from, to);
  if (from == null || notes.length === 0) {
    return null;
  }
  const target = path.join(projectRoot, RELEASE_NOTES_PATH);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, formatReleaseNotes(from, to, notes));
  await ensureIwsdkDirectoryIgnored(projectRoot);
  return {
    path: RELEASE_NOTES_PATH,
    count: notes.length,
    notable: notes.filter((note) => note.kind !== 'patch').length,
  };
}

export function formatReleaseNotesNotice(
  from: string | null,
  to: string,
  written: WrittenReleaseNotes | null,
): string {
  return written
    ? `What changed from ${from} to ${to}: ${written.path} (${written.count} entries, ${written.notable} major or minor).`
    : '';
}
