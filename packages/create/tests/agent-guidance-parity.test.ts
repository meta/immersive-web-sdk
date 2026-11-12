/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import {
  loadGuidanceSource,
  syncAgentGuidance,
} from '../../cli/src/agent-guidance.js';
import { getRecommendedConfiguration } from '../src/catalog.js';
import { buildStarterProjectFiles } from '../src/project-files.js';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it('writes the guidance that `iwsdk agents sync` considers current', async () => {
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), 'iwsdk-create-guidance-'),
  );
  tempDirs.push(projectRoot);
  const files = await buildStarterProjectFiles({
    appName: 'parity-app',
    configuration: getRecommendedConfiguration('vr'),
    language: 'ts',
    packageSource: { getPackageInstallSpec: () => undefined },
    templateRoot: path.join(PACKAGE_ROOT, 'dist', 'template'),
  });
  for (const file of files) {
    const filePath = path.join(projectRoot, file.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.contents);
  }

  const result = await syncAgentGuidance({
    projectRoot,
    source: await loadGuidanceSource(
      path.join(PACKAGE_ROOT, 'dist', 'guidance'),
    ),
    dryRun: true,
  });

  expect(result.changed).toBe(false);
  expect(
    result.results.filter((entry) => entry.action !== 'unchanged'),
  ).toEqual([]);
});
