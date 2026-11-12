/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'yaml';

const execFileAsync = promisify(execFile);

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'iwsdk-create-release-contract-'),
);
const appName = 'release-contract-app';
const appRoot = path.join(temporaryRoot, appName);
const blockers = [];
try {
  await execFileAsync(
    process.execPath,
    [
      path.join(packageRoot, 'dist', 'cli.js'),
      appName,
      '-y',
      '--target',
      'browser',
      '--language',
      'ts',
      '--no-install',
      '--no-git',
    ],
    { cwd: temporaryRoot, maxBuffer: 10 * 1024 * 1024 },
  );

  const packageJson = JSON.parse(
    await readFile(path.join(appRoot, 'package.json'), 'utf8'),
  );
  const pnpmWorkspace = parse(
    await readFile(path.join(appRoot, 'pnpm-workspace.yaml'), 'utf8'),
  );
  if (
    packageJson.overrides?.sharp !== '0.35.4' ||
    packageJson.overrides?.three !== 'npm:super-three@0.185.0'
  ) {
    blockers.push(
      'generated package.json is missing the npm Sharp/Three overrides',
    );
  }
  if (
    pnpmWorkspace.packages?.length !== 1 ||
    pnpmWorkspace.packages[0] !== '.' ||
    pnpmWorkspace.overrides?.sharp !== '0.35.4' ||
    pnpmWorkspace.overrides?.three !== 'npm:super-three@0.185.0' ||
    pnpmWorkspace.allowBuilds?.sharp !== true ||
    pnpmWorkspace.allowBuilds?.['@meta-quest/metavr'] !== false
  ) {
    blockers.push(
      'generated pnpm-workspace.yaml is missing the pnpm 10/11 override and build policy',
    );
  }
  if (
    packageJson.dependencies?.['@iwsdk/example-assets'] != null ||
    packageJson.devDependencies?.['@iwsdk/example-assets'] != null
  ) {
    blockers.push(
      'generated package.json still installs example-assets instead of using its immutable CDN files',
    );
  }

  const viteConfig = await readFile(
    path.join(appRoot, 'vite.config.ts'),
    'utf8',
  );
  if (viteConfig.includes('iwsdkExampleAssets')) {
    blockers.push('generated Vite config still uses the temporary copy plugin');
  }
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

if (blockers.length > 0) {
  throw new Error(
    'Refusing to publish @iwsdk/create before the immutable asset distribution contract passes:\n' +
      blockers.map((blocker) => `- ${blocker}`).join('\n') +
      '\nPublish and verify the independently licensed asset package, switch the starter to exact-version CDN URLs, and remove the local bridge first.',
  );
}

console.log('@iwsdk/create release contract passed.');
