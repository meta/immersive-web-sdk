/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Collects the changelog entries of every package in the release group
// (.changeset/config.json `fixed`) into dist/release-notes.json, so
// `iwsdk upgrade` can show what changed between two versions. The packages do
// not ship their CHANGELOG.md files.

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repositoryRoot = path.resolve(packageRoot, '..', '..');
const outputPath = path.join(packageRoot, 'dist', 'release-notes.json');

const config = JSON.parse(
  await readFile(
    path.join(repositoryRoot, '.changeset', 'config.json'),
    'utf8',
  ),
);
const releaseGroup = new Set(config.fixed.flat());

const changelogs = [];
for (const entry of await readdir(path.join(repositoryRoot, 'packages'), {
  withFileTypes: true,
})) {
  const directory = path.join(repositoryRoot, 'packages', entry.name);
  if (
    !entry.isDirectory() ||
    !existsSync(path.join(directory, 'package.json'))
  ) {
    continue;
  }
  const { name } = JSON.parse(
    await readFile(path.join(directory, 'package.json'), 'utf8'),
  );
  const changelogPath = path.join(directory, 'CHANGELOG.md');
  if (releaseGroup.has(name) && existsSync(changelogPath)) {
    changelogs.push({ name, text: await readFile(changelogPath, 'utf8') });
  }
}

/** One entry per change; a changeset that touched several packages is merged. */
const entries = new Map();
for (const { name, text } of changelogs.sort((left, right) =>
  left.name.localeCompare(right.name),
)) {
  for (const entry of parseChangelog(text)) {
    const key = `${entry.version}\0${entry.text}`;
    const existing = entries.get(key);
    if (existing) {
      existing.packages.push(name);
    } else {
      entries.set(key, { ...entry, packages: [name] });
    }
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ format: 1, entries: [...entries.values()] }, null, 2)}\n`,
);

function parseChangelog(text) {
  const parsed = [];
  let version = null;
  let kind = null;
  let current = null;
  const flush = () => {
    if (current && version && kind && !isDependencyNote(current)) {
      parsed.push({
        version,
        kind,
        text: current
          // Changesets list dependency bumps as nested bullets; drop them.
          .filter(
            (line) =>
              !/^\s*-\s*(?:Updated dependencies\b|@iwsdk\/[\w-]+@\S+\s*$)/u.test(
                line,
              ),
          )
          .join('\n')
          .replace(/^[0-9a-f]{7,40}: /u, '')
          .trim(),
      });
    }
    current = null;
  };
  for (const line of text.replace(/\r\n/gu, '\n').split('\n')) {
    const versionMatch = line.match(/^## (\S+)\s*$/u);
    if (versionMatch) {
      flush();
      version = versionMatch[1];
      kind = null;
      continue;
    }
    const kindMatch = line.match(/^### (Major|Minor|Patch) Changes\s*$/u);
    if (kindMatch) {
      flush();
      kind = kindMatch[1].toLowerCase();
      continue;
    }
    if (line.startsWith('- ')) {
      flush();
      current = [line.slice(2)];
    } else if (current && (line.startsWith('  ') || line.trim() === '')) {
      current.push(line.replace(/^ {2}/u, ''));
    } else {
      flush();
    }
  }
  flush();
  return parsed;
}

function isDependencyNote(lines) {
  const first = lines[0];
  return (
    first.startsWith('Updated dependencies') ||
    /^@iwsdk\/[\w-]+@\S+$/u.test(first.trim())
  );
}
