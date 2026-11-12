#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Copies the corpus built by @iwsdk/reference-assets into dist/. `--require`
// (prepack) fails instead of skipping, so a published package always has it.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const source =
  process.env.IWSDK_REFERENCE_CORPUS_SOURCE ??
  path.resolve(packageRoot, '../reference-assets/dist/corpus.json.gz');
const target = path.join(packageRoot, 'dist', 'corpus.json.gz');

if (existsSync(source)) {
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  process.stdout.write(`Copied reference corpus from ${source}\n`);
} else if (process.argv.includes('--require') && !existsSync(target)) {
  process.stderr.write(
    `Missing reference corpus: ${source}. Run "pnpm --filter @iwsdk/reference-assets run build" first.\n`,
  );
  process.exit(1);
} else {
  process.stdout.write(`Skipping corpus copy; ${source} does not exist yet.\n`);
}
