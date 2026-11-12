#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';

const REPO_ROOT = process.cwd();
const MCP_SURFACE_MARKERS_PATH = path.join(
  REPO_ROOT,
  'packages',
  'cli',
  'src',
  'mcp-surface-markers.json',
);
const INCLUDE_TARGETS = [
  'docs/ai',
  'packages/core/agent-guidance',
  'packages/create/template',
  'packages/create/src/installer.ts',
  'packages/cli/src/help.ts',
];
const INCLUDE_EXTENSIONS = new Set([
  '.json',
  '.js',
  '.md',
  '.mdc',
  '.mjs',
  '.toml',
  '.ts',
]);
const IGNORE_DIRS = new Set(['dist', 'node_modules']);
const IGNORE_BASENAMES = new Set(['CHANGELOG.md', 'package-lock.json']);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBannedPatterns(surfaceMarkers) {
  const patterns = [];

  for (const name of surfaceMarkers.legacyServerNames) {
    if (name === 'iwsdk') {
      patterns.push({
        label: `legacy server name (${name})`,
        regex: /"iwsdk"\s*:|\[mcp_servers\.iwsdk\]/g,
      });
    } else {
      patterns.push({
        label: `legacy server name (${name})`,
        regex: new RegExp(escapeRegex(name), 'g'),
      });
    }

    patterns.push({
      label: `legacy tool prefix (${name})`,
      regex: new RegExp(escapeRegex(`mcp__${name}__`), 'g'),
    });
  }

  for (const argToken of surfaceMarkers.legacyArgTokens) {
    if (argToken === '--workspace') {
      patterns.push({
        label: 'workspace-bound MCP entry',
        regex: /mcp stdio --workspace|"--workspace"/g,
      });
      continue;
    }

    if (argToken === '--port') {
      patterns.push({
        label: 'port-embedded managed entry',
        regex: /--port/g,
      });
      continue;
    }
  }

  patterns.push(
    {
      label: 'target selection command',
      regex: /target (list|use|current|clear)/g,
    },
    {
      label: 'broker-era wording',
      regex:
        /\bbroker-backed\b|\bbroker-managed\b|\bbroker-era\b|\bdev-broker\b|\bbroker resolves\b/g,
    },
  );

  return patterns;
}

async function walk(root, relativeDir = '') {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...(await walk(root, relativePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (IGNORE_BASENAMES.has(entry.name)) {
      continue;
    }
    if (!INCLUDE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(relativePath);
  }

  return files;
}

async function collectFiles(includeTarget) {
  const absoluteTarget = path.join(REPO_ROOT, includeTarget);
  const targetStat = await stat(absoluteTarget);
  if (targetStat.isDirectory()) {
    const files = await walk(absoluteTarget);
    return files.map((relativeFile) => path.join(includeTarget, relativeFile));
  }
  if (targetStat.isFile()) {
    return [includeTarget];
  }
  return [];
}

async function main() {
  const surfaceMarkers = JSON.parse(
    await readFile(MCP_SURFACE_MARKERS_PATH, 'utf8'),
  );
  const bannedPatterns = buildBannedPatterns(surfaceMarkers);
  const violations = [];

  for (const includeTarget of INCLUDE_TARGETS) {
    const files = await collectFiles(includeTarget);

    for (const relativeFile of files) {
      const absoluteFile = path.join(REPO_ROOT, relativeFile);
      const content = await readFile(absoluteFile, 'utf8');

      for (const pattern of bannedPatterns) {
        if (pattern.regex.test(content)) {
          violations.push({
            file: path.relative(REPO_ROOT, absoluteFile),
            label: pattern.label,
          });
        }
        pattern.regex.lastIndex = 0;
      }
    }
  }

  if (violations.length > 0) {
    console.error('Found legacy MCP references in canonical surfaces:');
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.label}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Canonical MCP surface check passed.');
}

main().catch((error) => {
  console.error('[check-canonical-mcp-surface] Failed:', error);
  process.exit(1);
});
