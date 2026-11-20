/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs';
import path from 'path';

export type ProjectTarget = {
  appName: string;
  displayPath: string;
  inPlace: boolean;
  outDir: string;
};

export function isValidProjectTarget(value: string): boolean {
  const name = value.trim();
  return (
    name === '.' ||
    (name !== '..' && /^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(name))
  );
}

export function resolveProjectTarget(
  requestedName: string,
  cwd: string,
): ProjectTarget {
  const targetName = requestedName.trim();
  const inPlace = targetName === '.';
  return {
    appName: inPlace ? toPackageName(path.basename(cwd)) : targetName,
    displayPath: inPlace ? '.' : targetName,
    inPlace,
    outDir: inPlace ? cwd : path.join(cwd, targetName),
  };
}

export function targetHasContent(target: ProjectTarget): boolean {
  if (!fs.existsSync(target.outDir)) {
    return false;
  }
  if (!fs.statSync(target.outDir).isDirectory()) {
    throw new Error(`Target "${target.displayPath}" is not a directory.`);
  }
  return fs.readdirSync(target.outDir).length > 0;
}

/** A target with a package.json: Create adds IWSDK to it, never over it. */
export function isExistingProject(target: ProjectTarget): boolean {
  return (
    targetHasContent(target) &&
    fs.existsSync(path.join(target.outDir, 'package.json'))
  );
}

function toPackageName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]+/, '')
    .replace(/[^a-z0-9~.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'iwsdk-app';
}
