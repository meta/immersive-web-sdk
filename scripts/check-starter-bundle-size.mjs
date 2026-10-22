#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Production bundle-size budget for the scaffolded starters.
 *
 * Scaffolds each @iwsdk/create target from this build's tarballs (the same
 * canary bundle path users get), installs it, runs `vite build`, and compares
 * the output with scripts/starter-bundle-budgets.json. Run after
 * `pnpm build:tgz:dev`. Exceeding a budget exits non-zero; CI runs this as a
 * non-required step, so that shows as a warning on the diff, not a failure.
 *
 *   node scripts/check-starter-bundle-size.mjs            check budgets
 *   node scripts/check-starter-bundle-size.mjs --update   rewrite budgets
 *
 * IWSDK_STARTER_NPM_REGISTRY selects the registry (default: npmjs).
 * IWSDK_STARTER_NPM_OVERRIDES is optional JSON merged into each starter's
 * package.json overrides, for registries that lag behind fresh dependency
 * releases.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGETS_PATH = path.join(ROOT, 'scripts', 'starter-bundle-budgets.json');
const CREATE_CLI = path.join(ROOT, 'packages', 'create', 'dist', 'cli.js');
const TARGETS = ['vr', 'ar', 'browser'];
const NPM_REGISTRY =
  process.env.IWSDK_STARTER_NPM_REGISTRY ?? 'https://registry.npmjs.org/';
// Room for ordinary starter changes; a regression like bundling every Lucide
// icon (2.7x the main chunk) still fails.
const SIZE_HEADROOM = 1.1;
const LUCIDE_ICON_HEADROOM = 4;
const LUCIDE_ICON = /class="lucide lucide-([a-z0-9-]+)"/g;

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `${command} ${args.join(' ')} exited ${code} in ${cwd}\n${output.slice(-4000)}`,
            ),
          ),
    );
  });
}

/** Serve this build's tarballs as a canary SDK bundle for @iwsdk/create. */
async function startBundleServer() {
  const { version } = JSON.parse(
    await readFile(
      path.join(ROOT, 'packages', 'create', 'package.json'),
      'utf8',
    ),
  );
  const packages = {};
  for (const directory of await readdir(path.join(ROOT, 'packages'))) {
    if (directory === 'reference-assets') {
      continue;
    }
    const tarball = `iwsdk-${directory}.tgz`;
    const packageRoot = path.join(ROOT, 'packages', directory);
    try {
      await stat(path.join(packageRoot, tarball));
    } catch {
      continue;
    }
    const { name } = JSON.parse(
      await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    );
    packages[name] = `packages/${directory}/${tarball}`;
  }
  if (!packages['@iwsdk/core']) {
    throw new Error('No @iwsdk tarballs found; run pnpm build:tgz:dev first.');
  }
  const manifest = JSON.stringify({
    schemaVersion: 1,
    sdkVersion: version,
    packages,
  });
  const served = new Set(Object.values(packages));
  const server = createServer((request, response) => {
    const relative = decodeURIComponent(
      new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
    ).replace(/^\/+/, '');
    if (relative === 'bundle.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(manifest);
    } else if (served.has(relative)) {
      response.writeHead(200);
      createReadStream(path.join(ROOT, relative)).pipe(response);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, server };
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}

async function measureStarter(workspace, bundleOrigin, target) {
  const appName = `starter-${target}`;
  await run(
    process.execPath,
    [
      CREATE_CLI,
      appName,
      '-y',
      '--target',
      target,
      '--language',
      'ts',
      '--no-install',
      '--no-git',
      '--canary',
      bundleOrigin,
    ],
    workspace,
  );
  const appRoot = path.join(workspace, appName);
  if (process.env.IWSDK_STARTER_NPM_OVERRIDES) {
    const packageJsonPath = path.join(appRoot, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    packageJson.overrides = {
      ...packageJson.overrides,
      ...JSON.parse(process.env.IWSDK_STARTER_NPM_OVERRIDES),
    };
    await writeFile(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
  }
  await run(
    'npm',
    [
      'install',
      '--registry',
      NPM_REGISTRY,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    appRoot,
  );
  await run(
    process.execPath,
    [path.join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
    appRoot,
    { NODE_ENV: 'production' },
  );

  let distBytes = 0;
  let jsGzipBytes = 0;
  const icons = new Set();
  for (const file of await listFiles(path.join(appRoot, 'dist'))) {
    const contents = await readFile(file);
    distBytes += contents.length;
    if (file.endsWith('.js')) {
      jsGzipBytes += gzipSync(contents).length;
      for (const match of contents.toString('utf8').matchAll(LUCIDE_ICON)) {
        icons.add(match[1]);
      }
    }
  }
  return { distBytes, jsGzipBytes, lucideIcons: icons.size };
}

const kB = (bytes) => `${(bytes / 1000).toFixed(0)} kB`;

async function main() {
  const update = process.argv.includes('--update');
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), 'iwsdk-starter-size-'),
  );
  const { origin, server } = await startBundleServer();
  let measured;
  try {
    const results = await Promise.all(
      TARGETS.map((target) => measureStarter(workspace, origin, target)),
    );
    measured = Object.fromEntries(TARGETS.map((t, i) => [t, results[i]]));
  } finally {
    server.close();
    await rm(workspace, { recursive: true, force: true });
  }

  if (update) {
    const budgets = Object.fromEntries(
      TARGETS.map((target) => {
        const result = measured[target];
        return [
          target,
          {
            distBytes:
              Math.ceil((result.distBytes * SIZE_HEADROOM) / 1000) * 1000,
            jsGzipBytes:
              Math.ceil((result.jsGzipBytes * SIZE_HEADROOM) / 1000) * 1000,
            lucideIcons: result.lucideIcons + LUCIDE_ICON_HEADROOM,
          },
        ];
      }),
    );
    await writeFile(BUDGETS_PATH, `${JSON.stringify(budgets, null, 2)}\n`);
    console.log(`Updated ${path.relative(ROOT, BUDGETS_PATH)}.`);
  }

  const budgets = JSON.parse(await readFile(BUDGETS_PATH, 'utf8'));
  const failures = [];
  console.log(
    'target   dist (budget)          JS gzip (budget)       Lucide icons (budget)',
  );
  for (const target of TARGETS) {
    const result = measured[target];
    const budget = budgets[target];
    if (!budget) {
      failures.push(`${target}: no budget; run with --update`);
      continue;
    }
    console.log(
      `${target.padEnd(8)} ${`${kB(result.distBytes)} (${kB(budget.distBytes)})`.padEnd(22)} ` +
        `${`${kB(result.jsGzipBytes)} (${kB(budget.jsGzipBytes)})`.padEnd(22)} ` +
        `${result.lucideIcons} (${budget.lucideIcons})`,
    );
    for (const key of ['distBytes', 'jsGzipBytes', 'lucideIcons']) {
      if (result[key] > budget[key]) {
        const over = ((result[key] / budget[key] - 1) * 100).toFixed(0);
        failures.push(
          `${target}: ${key} ${result[key]} is ${over}% over budget ${budget[key]}`,
        );
      }
    }
  }
  if (failures.length > 0) {
    // CI runs this as a non-required step: the exit code turns into a yellow
    // warning on the diff instead of blocking it.
    console.error(
      `\nWARNING: starter bundles grew past their size budget:\n  ${failures.join('\n  ')}\n` +
        "Compare the starter's dist/assets with the previous build to find what grew. " +
        'If the growth is intended, run this script with --update and commit the new budgets.',
    );
    process.exit(1);
  }
  console.log('\nStarter bundle sizes are within budget.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
