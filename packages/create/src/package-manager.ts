/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface PackageManagerInfo {
  name: PackageManager;
  /** Where the lockfile or workspace lives; the project itself when alone. */
  root: string;
}

const LOCKFILES: Array<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

function declaredPackageManager(directory: string): PackageManager | null {
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
  try {
    const parsed = parse(
      readFileSync(path.join(directory, 'pnpm-workspace.yaml'), 'utf8'),
    ) as { packages?: unknown } | null;
    const packages = Array.isArray(parsed?.packages) ? parsed.packages : [];
    return packages.some((entry) => entry !== '.' && entry !== './');
  } catch {
    return false;
  }
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
 * The package manager a project uses: the nearest lockfile at or above it,
 * so a package inside a monorepo installs with the monorepo's tool, with the
 * nearest `packageManager` field taking precedence. Without a lockfile, the
 * field or a pnpm workspace decides. Stops at the repository root.
 */
export function detectPackageManager(projectDir: string): PackageManagerInfo {
  let declared: PackageManagerInfo | null = null;
  let workspace: PackageManagerInfo | null = null;
  let current = path.resolve(projectDir);
  while (true) {
    const field = declaredPackageManager(current);
    if (
      field &&
      declared == null &&
      (current === path.resolve(projectDir) || isWorkspaceRoot(current))
    ) {
      declared = { name: field, root: current };
    }
    if (workspace == null && isPnpmWorkspace(current)) {
      workspace = { name: 'pnpm', root: current };
    }
    const lockfile = LOCKFILES.find(([name]) =>
      existsSync(path.join(current, name)),
    );
    // Above the project, a lockfile counts only at a workspace root; a stray
    // ~/package-lock.json does not make the home folder a monorepo.
    if (
      lockfile &&
      (current === path.resolve(projectDir) || isWorkspaceRoot(current))
    ) {
      return { name: declared?.name ?? lockfile[1], root: current };
    }
    const parent = path.dirname(current);
    if (existsSync(path.join(current, '.git')) || parent === current) {
      return (
        declared ?? workspace ?? { name: 'npm', root: path.resolve(projectDir) }
      );
    }
    current = parent;
  }
}

/** The command that runs a package.json script with this package manager. */
export function runScriptCommand(
  packageManager: PackageManager,
  script: string,
): string {
  return packageManager === 'npm' || packageManager === 'bun'
    ? `${packageManager} run ${script}`
    : `${packageManager} ${script}`;
}
