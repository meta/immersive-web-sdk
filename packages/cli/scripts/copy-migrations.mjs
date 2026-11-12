/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Copies the migration skills that iwsdk.dev serves (docs/public/skills/
// iwsdk-migrate-*) into dist/migrations/, where `iwsdk upgrade` reads them.
// src/migrations.ts lists them; test/guidance-upgrade.test.ts keeps both in step.

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const sourceRoot = path.resolve(
  packageRoot,
  '..',
  '..',
  'docs',
  'public',
  'skills',
);
const outputRoot = path.join(packageRoot, 'dist', 'migrations');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('iwsdk-migrate-')) {
    await cp(
      path.join(sourceRoot, entry.name),
      path.join(outputRoot, entry.name),
      {
        recursive: true,
      },
    );
  }
}
