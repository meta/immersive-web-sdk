/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Create bundles the agent-guidance sync from @iwsdk/cli's build. Build the
// CLI first when a checkout has not built it yet, so `npm run build` works on
// its own.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'cli',
);
if (!existsSync(path.join(cliRoot, 'dist', 'agent-guidance.js'))) {
  execFileSync('npm', ['--prefix', cliRoot, 'run', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
