#!/usr/bin/env node --no-warnings
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Static lint that scans the test-* SKILL.md files for `npx @iwsdk/cli <subcommand>`
 * invocations and asserts each cliPath is exposed by `iwsdk mcp inspect`.
 * Catches typos in SKILL docs without needing a full /test-all run.
 *
 * Usage: node scripts/verify-skill-cli-paths.mjs
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
const INSPECT_CWD = path.join(ROOT, 'examples', 'poke');
const CLI_ENTRYPOINT = path.join(ROOT, 'packages', 'cli', 'bin', 'iwsdk.js');

const RUNTIME_DOMAINS = new Set(['xr', 'browser', 'scene', 'ecs', 'ui']);
const NON_TOOL_SUBCOMMANDS = new Set([
  'mcp inspect',
  'mcp stdio',
  'dev up',
  'dev down',
  'dev status',
  'dev restart',
  'dev logs',
  'dev open',
  'status',
  'adapter sync',
  'adapter status',
  'adapter prune',
  'reference status',
  'reference warmup',
  'reference inspect',
  'reference search',
  'reference relationship',
  'reference api',
  'reference file',
  'reference components',
  'reference systems',
  'reference dependents',
  'reference examples',
]);

function loadCliPaths() {
  const result = spawnSync(
    process.execPath,
    [CLI_ENTRYPOINT, 'mcp', 'inspect'],
    {
      cwd: INSPECT_CWD,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`\`iwsdk mcp inspect\` failed (exit ${result.status})`);
  }
  const parsed = JSON.parse(result.stdout);
  const map = new Map();
  for (const tool of parsed.data.tools) {
    map.set(tool.cliPath, tool.mcpName);
  }
  return map;
}

function listSkillFiles() {
  return [
    ...readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('test-'))
      .map((entry) => path.join(SKILLS_DIR, entry.name, 'SKILL.md')),
    // Agent guidance that teaches runtime CLI invocations.
    path.join(SKILLS_DIR, 'iwsdk-dev', 'references', 'headless-rendering.md'),
  ];
}

function extractInvocations(text) {
  const invocations = [];
  const pattern = /npx\s+@iwsdk\/cli\s+([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/g;
  for (const match of text.matchAll(pattern)) {
    invocations.push({
      raw: match[0],
      subcommand: match[1].trim(),
      offset: match.index ?? 0,
    });
  }
  return invocations;
}

function lineNumberFor(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function main() {
  const cliPaths = loadCliPaths();
  const skillFiles = listSkillFiles();
  const failures = [];
  let totalChecked = 0;

  for (const file of skillFiles) {
    const text = readFileSync(file, 'utf8');
    const seen = new Set();
    for (const { subcommand, offset } of extractInvocations(text)) {
      if (seen.has(`${subcommand}:${offset}`)) continue;
      seen.add(`${subcommand}:${offset}`);
      totalChecked++;

      // Skip non-runtime CLI commands (dev, mcp, status, etc.) — only validate
      // runtime tool paths against the mcp inspect surface.
      const domain = subcommand.split(/\s+/, 1)[0];
      if (!RUNTIME_DOMAINS.has(domain)) {
        if (!NON_TOOL_SUBCOMMANDS.has(subcommand)) {
          // Unknown non-runtime command — flag it.
          failures.push({
            file: path.relative(ROOT, file),
            line: lineNumberFor(text, offset),
            subcommand,
            reason: 'unknown non-runtime CLI subcommand',
          });
        }
        continue;
      }

      if (!cliPaths.has(subcommand)) {
        failures.push({
          file: path.relative(ROOT, file),
          line: lineNumberFor(text, offset),
          subcommand,
          reason: 'cliPath not in `iwsdk mcp inspect`',
        });
      }
    }
  }

  console.log(
    `Scanned ${skillFiles.length} skill files, ${totalChecked} invocations.`,
  );

  if (failures.length === 0) {
    console.log(
      'OK: every `npx @iwsdk/cli` invocation resolves to a known CLI path.',
    );
    process.exit(0);
  }

  console.error(
    `\nFAIL: ${failures.length} invocation(s) reference unknown CLI paths:`,
  );
  for (const failure of failures) {
    console.error(
      `  ${failure.file}:${failure.line}  \`npx @iwsdk/cli ${failure.subcommand}\`  (${failure.reason})`,
    );
  }
  process.exit(1);
}

main();
