#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const DEFAULT_EVIDENCE_DIR = path.join(
  REPO_ROOT,
  'docs/test-evidence/native-scene-starters/current',
);
const TARGETS = ['generated-vr', 'generated-ar', 'generated-browser'];
const MUTATION_IDS = {
  'generated-ar': 'scaffold-added-robot',
  'generated-browser': 'scaffold-added-group',
  'generated-vr': 'scaffold-added-robot',
};
const REQUIRED_FILES = [
  'app.png',
  'editor.png',
  'app-after-reload.png',
  'proof.json',
];
const MIN_PNG_BYTES = 1000;
const MIN_UNIQUE_COLORS = 8;
const PNG_SIGNATURE = '89504e470d0a1a0a';

function parseArgs(argv) {
  const options = {
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    writeManifest: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--evidence-dir') {
      const next = argv[index + 1];
      if (next == null || next.startsWith('--')) {
        throw new Error('--evidence-dir requires a path');
      }
      options.evidenceDir = path.resolve(next);
      index += 1;
    } else if (arg === '--no-write-manifest') {
      options.writeManifest = false;
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
  console.log(`Usage: node scripts/check-native-scene-starter-evidence.mjs [options]

Options:
  --evidence-dir <path>   Generated starter evidence directory.
                          Defaults to docs/test-evidence/native-scene-starters/current.
  --no-write-manifest     Do not write evidence-manifest.json after validation.
  -h, --help              Show this help.
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const failures = [];
  const checkedFiles = [];

  assert(
    failures,
    existsSync(options.evidenceDir),
    `Evidence directory does not exist: ${options.evidenceDir}`,
  );
  if (!existsSync(options.evidenceDir)) {
    printFailures(failures);
    process.exitCode = 1;
    return;
  }

  for (const target of TARGETS) {
    validateTarget({
      checkedFiles,
      evidenceDir: options.evidenceDir,
      failures,
      target,
    });
  }

  if (failures.length > 0) {
    printFailures(failures);
    process.exitCode = 1;
    return;
  }

  if (options.writeManifest) {
    writeManifest(options.evidenceDir, checkedFiles);
  }

  console.log(
    `Native scene starter evidence passed: ${TARGETS.length} targets, ${checkedFiles.length} files.`,
  );
}

function validateTarget({ checkedFiles, evidenceDir, failures, target }) {
  const targetDir = path.join(evidenceDir, target);
  assert(failures, existsSync(targetDir), `Missing target evidence: ${target}`);
  if (!existsSync(targetDir)) {
    return;
  }

  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(targetDir, file);
    assert(
      failures,
      existsSync(fullPath),
      `${target} missing required evidence file: ${file}`,
    );
    if (!existsSync(fullPath)) {
      continue;
    }
    checkedFiles.push(fullPath);
    if (file.endsWith('.png')) {
      validatePng(failures, target, file, fullPath);
    }
  }

  const proofPath = path.join(targetDir, 'proof.json');
  if (!existsSync(proofPath)) {
    return;
  }

  let proof;
  try {
    proof = JSON.parse(readFileSync(proofPath, 'utf8'));
  } catch (error) {
    failures.push(
      `${target} proof.json is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  validateScreenshotStats(
    failures,
    target,
    'app.png',
    proof.app?.initialScreenshot,
  );
  validateScreenshotStats(
    failures,
    target,
    'app-after-reload.png',
    proof.app?.afterReloadScreenshot,
  );
  validateScreenshotStats(
    failures,
    target,
    'editor.png',
    proof.editor?.screenshot,
  );
  validateEditorProof(failures, target, proof.editor?.proofBefore);
  validateSceneMutation(failures, target, proof.scene);
  validateRuntimeComponents(failures, target, proof.app?.runtimeComponents);
  validateAssetResponses(failures, target, 'app', proof.network?.app);
  validateAssetResponses(failures, target, 'editor', proof.network?.editor);
  validateBrowserSignals(
    failures,
    target,
    'app',
    proof.network?.app,
    proof.browser?.baseUrl,
  );
  validateBrowserSignals(
    failures,
    target,
    'editor',
    proof.network?.editor,
    proof.browser?.baseUrl,
  );
}

function validatePng(failures, target, file, fullPath) {
  const buffer = readFileSync(fullPath);
  assert(
    failures,
    buffer.length > MIN_PNG_BYTES,
    `${target}/${file} is too small to be useful evidence (${buffer.length} bytes)`,
  );
  assert(
    failures,
    buffer.subarray(0, 8).toString('hex') === PNG_SIGNATURE,
    `${target}/${file} is not a PNG file`,
  );
}

function validateScreenshotStats(failures, target, file, evidence) {
  assert(
    failures,
    evidence?.stats?.uniqueColors >= MIN_UNIQUE_COLORS,
    `${target}/${file} has too few unique colors: ${evidence?.stats?.uniqueColors}`,
  );
}

function validateEditorProof(failures, target, proof) {
  assert(
    failures,
    proof?.renderer === 'iwsdk-webgl',
    `${target} editor renderer is not iwsdk-webgl`,
  );
  assert(
    failures,
    proof?.webgl === true,
    `${target} editor WebGL proof failed`,
  );
  assert(
    failures,
    proof?.uses2DRenderer === false,
    `${target} editor proof reports a 2D renderer`,
  );
  assert(
    failures,
    proof?.worldReady === true,
    `${target} editor world was not ready`,
  );
}

function validateSceneMutation(failures, target, scene) {
  const beforeCount = scene?.before?.nodes?.length;
  const afterNodes = scene?.after?.nodes;
  const mutationId = MUTATION_IDS[target];
  assert(
    failures,
    Number.isFinite(beforeCount) && Array.isArray(afterNodes),
    `${target} proof is missing scene before/after nodes`,
  );
  if (!Number.isFinite(beforeCount) || !Array.isArray(afterNodes)) {
    return;
  }
  assert(
    failures,
    afterNodes.length === beforeCount + 1,
    `${target} saved scene did not add exactly one node`,
  );
  assert(
    failures,
    afterNodes.some((node) => node?.id === mutationId),
    `${target} saved scene is missing ${mutationId}`,
  );
}

function validateRuntimeComponents(failures, target, components) {
  assert(
    failures,
    components != null && typeof components === 'object',
    `${target} proof is missing runtime component summary`,
  );
  if (components == null || typeof components !== 'object') {
    return;
  }
  for (const [componentId, summary] of Object.entries(components)) {
    assert(
      failures,
      summary?.total > 0,
      `${target} runtime component ${componentId} has no active entities`,
    );
  }
}

function validateAssetResponses(failures, target, label, network) {
  const assetResponses = network?.assetResponses;
  assert(
    failures,
    assetResponses != null && typeof assetResponses === 'object',
    `${target} ${label} proof is missing asset response data`,
  );
  if (assetResponses == null || typeof assetResponses !== 'object') {
    return;
  }
  for (const [assetId, statuses] of Object.entries(assetResponses)) {
    assert(
      failures,
      Array.isArray(statuses) && statuses.length > 0,
      `${target} ${label} has no asset responses for ${assetId}`,
    );
    if (!Array.isArray(statuses)) {
      continue;
    }
    assert(
      failures,
      statuses.every((status) => status >= 200 && status < 300),
      `${target} ${label} asset ${assetId} had non-2xx responses: ${statuses.join(
        ', ',
      )}`,
    );
  }
}

function validateBrowserSignals(failures, target, label, network, baseUrl) {
  for (const error of network?.consoleErrors ?? []) {
    assert(
      failures,
      isAllowedBrowserSignal(error, baseUrl),
      `${target} ${label} console error: ${error}`,
    );
  }
  for (const failure of network?.failedRequests ?? []) {
    assert(
      failures,
      isAllowedBrowserSignal(failure, baseUrl),
      `${target} ${label} failed request: ${failure}`,
    );
  }
  for (const response of network?.badResponses ?? []) {
    assert(
      failures,
      isAllowedBrowserSignal(response, baseUrl),
      `${target} ${label} bad response: ${response}`,
    );
  }
}

function isAllowedBrowserSignal(value, baseUrl) {
  return (
    value.includes('/favicon.ico') ||
    value.includes('/.well-known/') ||
    value.includes('Error loading environment living_room from CDN') ||
    value.includes('Outdated Optimize Dep') ||
    value.includes('@iwer/sem@0.2.4/captures/living_room.json') ||
    isAllowedLocalNavigationAbort(value, baseUrl) ||
    (value.includes('/node_modules/.vite/deps/') &&
      (value.includes('net::ERR_ABORTED') || value.startsWith('504 ')))
  );
}

function isAllowedLocalNavigationAbort(value, baseUrl) {
  const match = /^GET (\S+) net::ERR_ABORTED$/u.exec(value);
  if (match == null || typeof baseUrl !== 'string') {
    return false;
  }
  try {
    return new URL(match[1]).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function assert(failures, condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function writeManifest(evidenceDir, checkedFiles) {
  const manifest = {
    checkedAt: new Date().toISOString(),
    command: 'pnpm test:native-scene-starter-evidence',
    files: checkedFiles.map((file) => ({
      path: path.relative(REPO_ROOT, file).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    })),
    targets: TARGETS,
  };
  writeFileSync(
    path.join(evidenceDir, 'evidence-manifest.json'),
    `${formatManifestJson(manifest)}\n`,
  );
}

function formatManifestJson(manifest) {
  return JSON.stringify(manifest, null, 2).replace(
    /  "targets": \[\n(?:    "[^"]+",?\n)+  \]/,
    `  "targets": [${TARGETS.map((target) => JSON.stringify(target)).join(', ')}]`,
  );
}

function printFailures(failures) {
  console.error('Native scene starter evidence check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
