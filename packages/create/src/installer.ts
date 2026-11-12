/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs';
import path from 'path';
import { Chalk } from 'chalk';
import { spawn } from 'cross-spawn';
import ora, { Ora } from 'ora';
import { mergePnpmWorkspaceYaml } from './pnpm-workspace.js';
import type { ResolvedSource } from './source.js';
import type { ActionItem } from './types.js';
const stdoutColor = new Chalk({ level: process.stdout.isTTY ? 3 : 0 });
const stderrColor = new Chalk({ level: process.stderr.isTTY ? 3 : 0 });

export async function installDependencies(
  outDir: string,
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm',
) {
  const installSpinner: Ora = ora({
    text: 'Installing dependencies ...',
    stream: process.stderr,
    discardStdin: false,
    hideCursor: false,
    isEnabled: process.stderr.isTTY,
  }).start();

  const args = ['install'];
  const cmd = packageManager;
  try {
    const child = spawn(cmd, args, {
      cwd: outDir,
      stdio: 'inherit',
    });
    await new Promise<void>((resolve, reject) => {
      // A package manager that is not on PATH fails to spawn instead of exiting.
      child.on('error', (error) =>
        reject(
          new Error(
            `${cmd} could not start (${error.message}). Install ${cmd}${cmd === 'pnpm' || cmd === 'yarn' ? ' or enable it with Corepack' : ''}.`,
          ),
        ),
      );
      child.on('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`${cmd} install failed (exit ${code})`)),
      );
    });
    installSpinner.stopAndPersist({
      symbol: stderrColor.green('✔'),
      text: 'Dependencies installed',
    });
  } catch (e) {
    installSpinner.stopAndPersist({
      symbol: stderrColor.red('✖'),
      text: 'Install failed',
    });
    throw e;
  }
}

/** Persist bundle-backed direct dependencies and transitive overrides. */
export function configureDependenciesFromBundle(
  outDir: string,
  source: ResolvedSource,
): void {
  const pkgPath = path.join(outDir, 'package.json');
  const pnpmWorkspacePath = path.join(outDir, 'pnpm-workspace.yaml');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const directDependencyNames = new Set<string>();
  for (const depsKey of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[depsKey];
    if (!deps) {
      continue;
    }
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@iwsdk/')) {
        directDependencyNames.add(name);
        const spec = source.getPackageInstallSpec(name);
        if (spec) {
          deps[name] = spec;
        }
      }
    }
  }
  const allPackageSpecs = source.getPackageInstallSpecs();
  const bundleOverrides: Record<string, string> = {};
  for (const [name, spec] of Object.entries(allPackageSpecs)) {
    if (!directDependencyNames.has(name)) {
      bundleOverrides[name] = spec;
    }
  }
  if (Object.keys(bundleOverrides).length > 0) {
    const existingOverrides =
      pkg.overrides != null &&
      typeof pkg.overrides === 'object' &&
      !Array.isArray(pkg.overrides)
        ? pkg.overrides
        : {};
    pkg.overrides = {
      ...existingOverrides,
      ...bundleOverrides,
    };
  }
  const existingPnpmWorkspace = fs.existsSync(pnpmWorkspacePath)
    ? fs.readFileSync(pnpmWorkspacePath, 'utf-8')
    : '';
  const mergedPnpmWorkspace = mergePnpmWorkspaceYaml(
    existingPnpmWorkspace,
    allPackageSpecs,
  );
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(pnpmWorkspacePath, mergedPnpmWorkspace);
}

/**
 * Install dependencies in bundle mode.
 * Rewrites @iwsdk/* entries in both dependencies and devDependencies
 * to file: paths pointing at .sdk-packages/ before running npm install.
 * The rewritten paths are kept permanently so `npm install` remains
 * reproducible as long as the .sdk-packages/ directory is present.
 */
export async function installDependenciesFromBundle(
  outDir: string,
  source: ResolvedSource,
) {
  const installSpinner: Ora = ora({
    text: 'Installing dependencies from bundle ...',
    stream: process.stderr,
    discardStdin: false,
    hideCursor: false,
    isEnabled: process.stderr.isTTY,
  }).start();

  try {
    configureDependenciesFromBundle(outDir, source);

    // Run npm install
    const child = spawn('npm', ['install'], {
      cwd: outDir,
      stdio: 'inherit',
    });
    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`Install failed (${code})`)),
      );
    });
    installSpinner.stopAndPersist({
      symbol: stderrColor.green('✔'),
      text: 'Dependencies installed from bundle',
    });
  } catch (e) {
    installSpinner.stopAndPersist({
      symbol: stderrColor.red('✖'),
      text: 'Install failed',
    });
    throw e;
  }
}

const IWER_CONTROLS_URL =
  'https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls';
const MPT_SDK_LICENSE_URL =
  'https://developers.meta.com/horizon/licenses/oculussdk/';

function printMetavrNotice() {
  console.log('\nAbout metavr CLI:');
  console.log(
    '  Your new Immersive Web SDK starter app includes metavr CLI as a project-scoped dev dependency (@meta-quest/metavr). metavr lets you control a connected Meta Quest headset from the command line, so you can build, deploy, and test on device in one loop. It also searches the Horizon OS documentation for platform and SDK features, and offers a catalog of ready-made 3D assets.',
  );
  console.log(
    `\n  metavr collects essential usage data, as described in the Meta Platform Technologies SDK License (${MPT_SDK_LICENSE_URL}). If you don't want to use metavr, uninstall it from your project:`,
  );
  console.log(stdoutColor.gray('    npm uninstall @meta-quest/metavr'));
}

export function printNextSteps(
  appName: string,
  installed: boolean,
  actionItems: ActionItem[] = [],
  inPlace = false,
  xrEnabled = true,
) {
  const startCmd = 'npm run dev';
  printMetavrNotice();
  console.log('\nNext steps:');
  // Choose the best stream for colored action items
  const itemStream = process.stdout.isTTY
    ? process.stdout
    : process.stderr.isTTY
      ? process.stderr
      : process.stdout;
  const itemColor = process.stdout.isTTY
    ? stdoutColor
    : process.stderr.isTTY
      ? stderrColor
      : stdoutColor;
  for (const item of actionItems) {
    const prefix = item.level === 'important' ? '!!!' : '!';
    itemStream.write(`${itemColor.bold.yellow(prefix)} ${item.message}\n`);
  }
  // Commands go to stdout
  if (!inPlace) {
    console.log(stdoutColor.gray(`  cd ${appName}`));
  }
  if (!installed) {
    console.log(stdoutColor.gray('  npm install'));
  }
  console.log(stdoutColor.gray(`  ${startCmd}`));
  if (xrEnabled) {
    console.log(stdoutColor.gray(`  IWER controls: ${IWER_CONTROLS_URL}`));
  }
}

export function printPrerequisites(prereqs: ActionItem[] = []) {
  if (!prereqs.length) {
    return;
  }
  console.log('\nPrerequisites:');
  const itemStream = process.stdout.isTTY
    ? process.stdout
    : process.stderr.isTTY
      ? process.stderr
      : process.stdout;
  const itemColor = process.stdout.isTTY
    ? stdoutColor
    : process.stderr.isTTY
      ? stderrColor
      : stdoutColor;
  for (const item of prereqs) {
    const prefix = item.level === 'important' ? '!!!' : '!';
    const lines = String(item.message).split('\n');
    if (!lines.length) {
      continue;
    }
    // First line with prefix
    itemStream.write(`${itemColor.bold.yellow(prefix)} ${lines[0]}\n`);
    // Subsequent lines indented with subdued color
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) {
        itemStream.write('\n');
      } else {
        itemStream.write(`    ${itemColor.gray('- ' + line)}\n`);
      }
    }
  }
}
