/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface PackageManagerInfo {
  name: PackageManagerName;
  /** Where the lockfile or workspace lives; the project itself when alone. */
  root: string;
  /** The lockfile found at `root`, if any. */
  lockfile: string | null;
}

const LOCKFILES: Array<[string, PackageManagerName]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

function declaredPackageManager(directory: string): PackageManagerName | null {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(directory, 'package.json'), 'utf8'),
    ) as { packageManager?: unknown };
    const name =
      typeof manifest.packageManager === 'string'
        ? manifest.packageManager.split('@')[0]
        : '';
    return name === 'npm' ||
      name === 'pnpm' ||
      name === 'yarn' ||
      name === 'bun'
      ? name
      : null;
  } catch {
    return null;
  }
}

/**
 * True for a pnpm-workspace.yaml that lists packages besides the directory
 * itself. Generated apps carry one with `packages: ['.']` whatever their
 * package manager, so that one says nothing.
 */
function isPnpmWorkspace(directory: string): boolean {
  let text: string;
  try {
    text = readFileSync(path.join(directory, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return false;
  }
  // `packages: [a, b]` or a block list under `packages:`.
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^packages\s*:/u.test(line));
  if (start === -1) {
    return false;
  }
  const inline = lines[start].replace(/^packages\s*:/u, '').trim();
  const entries = inline.startsWith('[')
    ? inline.replace(/^\[|\].*$/gu, '').split(',')
    : lines
        .slice(start + 1)
        .filter((line) => !/^\s*(?:#.*)?$/u.test(line))
        .filter((_, index, rest) =>
          rest.slice(0, index + 1).every((line) => /^\s+-/u.test(line)),
        )
        .map((line) => line.replace(/^\s+-/u, ''));
  return entries
    .map((entry) =>
      entry
        .replace(/#.*$/u, '')
        .trim()
        .replace(/^['"]|['"]$/gu, ''),
    )
    .some((entry) => entry !== '' && entry !== '.' && entry !== './');
}

/** A directory whose package.json declares workspaces, or a pnpm workspace. */
function isWorkspaceRoot(directory: string): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(directory, 'package.json'), 'utf8'),
    ) as { workspaces?: unknown };
    if (manifest.workspaces != null) {
      return true;
    }
  } catch {
    // No readable package.json; pnpm keeps its workspace list elsewhere.
  }
  return isPnpmWorkspace(directory);
}

/**
 * The package manager a project uses: the nearest lockfile at or above it, so
 * an app inside a monorepo uses the monorepo's tool and lockfile, with the
 * nearest `packageManager` field taking precedence. Without a lockfile, the
 * field or a pnpm workspace decides. Stops at the repository root.
 */
export function findPackageManager(projectRoot: string): PackageManagerInfo {
  const start = path.resolve(projectRoot);
  let declared: PackageManagerName | null = null;
  let workspace: string | null = null;
  let current = start;
  while (true) {
    if (current === start || isWorkspaceRoot(current)) {
      declared ??= declaredPackageManager(current);
    }
    if (workspace == null && isPnpmWorkspace(current)) {
      workspace = current;
    }
    const lockfile = LOCKFILES.find(([name]) =>
      existsSync(path.join(current, name)),
    );
    // Above the project, a lockfile counts only at a workspace root; a stray
    // ~/package-lock.json does not make the home folder a monorepo.
    if (lockfile && (current === start || isWorkspaceRoot(current))) {
      return {
        name: declared ?? lockfile[1],
        root: current,
        lockfile: path.join(current, lockfile[0]),
      };
    }
    const parent = path.dirname(current);
    if (existsSync(path.join(current, '.git')) || parent === current) {
      if (declared == null && workspace != null) {
        return { name: 'pnpm', root: workspace, lockfile: null };
      }
      return { name: declared ?? 'npm', root: start, lockfile: null };
    }
    current = parent;
  }
}

/**
 * The @iwsdk/core version the lockfile resolves for this project, or null
 * when there is no lockfile this can read. Handles workspace lockfiles, where
 * the project is one importer among several.
 */
export function readLockedCoreVersion(projectRoot: string): string | null {
  const { lockfile, root } = findPackageManager(projectRoot);
  if (lockfile == null || !existsSync(lockfile)) {
    return null;
  }
  const text = readFileSync(lockfile, 'utf8');
  const relative = path
    .relative(root, path.resolve(projectRoot))
    .split(path.sep)
    .join('/');
  if (
    lockfile.endsWith('package-lock.json') ||
    lockfile.endsWith('npm-shrinkwrap.json')
  ) {
    try {
      const packages =
        (
          JSON.parse(text) as {
            packages?: Record<string, { version?: string }>;
          }
        ).packages ?? {};
      return (
        (relative &&
          packages[`${relative}/node_modules/@iwsdk/core`]?.version) ||
        packages['node_modules/@iwsdk/core']?.version ||
        null
      );
    } catch {
      return null;
    }
  }
  if (lockfile.endsWith('pnpm-lock.yaml')) {
    // importers:\n  <project>:\n    dependencies:\n      '@iwsdk/core':\n        specifier: …\n        version: …
    const importer = relative || '.';
    const lines = text.split(/\r?\n/u);
    const start = lines.findIndex(
      (line) =>
        line === `  ${importer}:` ||
        line === `  '${importer}':` ||
        line === `  "${importer}":`,
    );
    if (start === -1) {
      return null;
    }
    for (let index = start + 1; index < lines.length; index++) {
      if (/^ {2}\S/u.test(lines[index])) {
        break;
      }
      if (/^ {6}'@iwsdk\/core':$/u.test(lines[index])) {
        for (
          let next = index + 1;
          next < index + 4 && next < lines.length;
          next++
        ) {
          const version = lines[next].match(/^ {8}version: ([^\s(]+)/u)?.[1];
          if (version) {
            return version;
          }
        }
      }
    }
    return null;
  }
  if (lockfile.endsWith('yarn.lock')) {
    return (
      text.match(
        /^"?@iwsdk\/core@[^\n]*:\r?\n {2}version:? "?([^"\s]+)"?/mu,
      )?.[1] ?? null
    );
  }
  return null;
}
