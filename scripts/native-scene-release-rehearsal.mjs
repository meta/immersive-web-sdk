#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const COREPACK_PNPM_SPEC = process.env.COREPACK_PNPM_VERSION || 'pnpm@10.18.3';
const PNPM = resolvePnpmCommand();
const DEFAULT_EDITOR_EVIDENCE_DIR =
  'docs/test-evidence/native-scene-editor/current';
const DEFAULT_CREATE_E2E_EVIDENCE_DIR =
  'docs/test-evidence/native-scene-starters/current';
const DEFAULT_MANUAL_SMOKE_EVIDENCE =
  'docs/test-evidence/native-scene-manual-smoke.json';

const STEPS = [
  {
    name: 'Check repository formatting',
    args: ['format:check'],
  },
  {
    name: 'Lint repository sources',
    args: ['lint'],
  },
  {
    name: 'Run workspace package tests',
    args: ['test'],
  },
  {
    name: 'Build local package tarballs',
    args: ['build:tgz'],
  },
  {
    name: 'Build create CLI',
    args: ['--filter', '@iwsdk/create', 'build'],
  },
  {
    name: 'Run create-flow install/build/dev-server E2E',
    args: [
      '--filter',
      '@iwsdk/create',
      'exec',
      'vitest',
      'run',
      'tests/create-flow-e2e.test.ts',
    ],
    env: {
      IWSDK_CREATE_E2E_EVIDENCE_DIR: path.join(
        REPO_ROOT,
        DEFAULT_CREATE_E2E_EVIDENCE_DIR,
      ),
      IWSDK_CREATE_INSTALL_E2E: '1',
    },
  },
  {
    name: 'Verify generated starter evidence bundle',
    args: ['test:native-scene-starter-evidence'],
  },
  {
    name: 'Run native editor/browser tests',
    args: ['--filter', '@iwsdk/vite-plugin-dev', 'test'],
    env: {
      IWSDK_EDITOR_E2E_EVIDENCE_DIR: path.join(
        REPO_ROOT,
        DEFAULT_EDITOR_EVIDENCE_DIR,
      ),
    },
  },
  {
    name: 'Check migrated native scene examples',
    args: ['test:native-scene-examples'],
  },
  {
    name: 'Build API docs',
    args: ['docs:api'],
  },
  {
    name: 'Build VitePress docs',
    args: ['exec', 'vitepress', 'build', 'docs'],
  },
  {
    name: 'Build documented examples',
    args: ['docs:examples'],
  },
  {
    name: 'Runtime smoke migrated native scene examples',
    args: ['test:native-scene-example-runtime'],
  },
  {
    name: 'Collect native scene app and editor render proof',
    args: ['test:native-scene-render-proof'],
  },
  {
    name: 'Verify native scene editor evidence bundle',
    args: ['test:native-scene-editor-evidence'],
  },
  {
    name: 'Verify manual smoke evidence validator',
    args: ['test:native-scene-manual-smoke-validator'],
  },
  {
    manualSmoke: true,
    name: 'Verify manual Quest/browser smoke evidence',
    args: [
      'test:native-scene-manual-smoke',
      '--',
      '--evidence',
      DEFAULT_MANUAL_SMOKE_EVIDENCE,
    ],
  },
  {
    name: 'Verify MCP and native scene docs contracts',
    args: ['test:canonical-mcp-surface'],
  },
  {
    name: 'Audit Meta Spatial removal',
    args: ['audit:metaspatial'],
  },
  {
    name: 'Check release tarballs and built docs for removed surfaces',
    args: ['test:native-scene-release-artifacts'],
  },
];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    from: null,
    manualSmokeEvidence: DEFAULT_MANUAL_SMOKE_EVIDENCE,
    requireManualSmoke: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--require-manual-smoke') {
      options.requireManualSmoke = true;
    } else if (arg === '--manual-smoke-evidence') {
      const next = argv[index + 1];
      if (next == null || next.startsWith('--')) {
        throw new Error('--manual-smoke-evidence requires a file path');
      }
      options.manualSmokeEvidence = next;
      index += 1;
    } else if (arg === '--from') {
      const next = argv[index + 1];
      if (next == null || next.startsWith('--')) {
        throw new Error('--from requires a step name substring');
      }
      options.from = next.toLowerCase();
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/native-scene-release-rehearsal.mjs [options]

Runs the IWSDK native scene editor replacement release rehearsal:
tarballs, starters, create-flow install/build/dev-server E2E, editor tests that
regenerate native editor evidence, example checks, app/editor render proof,
editor evidence checks, docs builds, MCP contract checks, Meta Spatial audit,
and release artifact scan. Pass --require-manual-smoke for the physical
Quest/browser evidence gate.

Options:
  --dry-run                       Print the ordered steps without running them.
  --from <text>                   Start from the first step whose name contains <text>.
  --require-manual-smoke          Require validated manual Quest/browser smoke evidence.
  --manual-smoke-evidence <path>  Evidence JSON path for --require-manual-smoke.
                                   Default: ${DEFAULT_MANUAL_SMOKE_EVIDENCE}
  -h, --help                      Show this help.
`);
}

function getRunnableSteps(options) {
  const allSteps = getAllSteps(options);
  if (options.from == null) {
    return allSteps;
  }

  const startIndex = allSteps.findIndex((step) =>
    step.name.toLowerCase().includes(options.from),
  );
  if (startIndex === -1) {
    throw new Error(`No release rehearsal step matches --from ${options.from}`);
  }

  return allSteps.slice(startIndex);
}

function getAllSteps(options) {
  return STEPS.filter(
    (step) => options.requireManualSmoke || !step.manualSmoke,
  ).map((step) => {
    if (!step.manualSmoke) {
      return step;
    }
    return {
      ...step,
      args: [
        'test:native-scene-manual-smoke',
        '--',
        '--evidence',
        options.manualSmokeEvidence,
      ],
    };
  });
}

function printStep(index, count, step) {
  console.log(`\n[${index + 1}/${count}] ${step.name}`);
  console.log(`$ ${PNPM.label} ${step.args.join(' ')}`);
}

function runStep(step) {
  const result = spawnSync(PNPM.command, [...PNPM.args, ...step.args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CI: process.env.CI ?? 'true',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      META_SPATIAL_EDITOR_CLI_PATH: '',
      npm_config_confirm_modules_purge: 'false',
      npm_config_confirmModulesPurge: 'false',
      ...step.env,
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const suffix =
      result.signal != null
        ? `signal ${result.signal}`
        : `exit ${result.status}`;
    throw new Error(`${step.name} failed with ${suffix}`);
  }
}

function resolvePnpmCommand() {
  const directPnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  if (commandWorks(directPnpm, ['--version'])) {
    return {
      args: ['--config.confirmModulesPurge=false'],
      command: directPnpm,
      label: directPnpm,
    };
  }

  const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
  if (commandWorks(corepack, [COREPACK_PNPM_SPEC, '--version'])) {
    return {
      args: [COREPACK_PNPM_SPEC, '--config.confirmModulesPurge=false'],
      command: corepack,
      label: `${corepack} ${COREPACK_PNPM_SPEC}`,
    };
  }

  return {
    args: [],
    command: directPnpm,
    label: directPnpm,
  };
}

function commandWorks(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    },
    stdio: 'ignore',
  });
  return result.status === 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const steps = getRunnableSteps(options);

  console.log(
    `Native scene release rehearsal: ${steps.length} step(s)${
      options.dryRun ? ' (dry run)' : ''
    }`,
  );
  steps.forEach((step, index) => {
    printStep(index, steps.length, step);
    if (!options.dryRun) {
      runStep(step);
    }
  });

  if (!options.dryRun) {
    console.log('\nNative scene release rehearsal passed.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
