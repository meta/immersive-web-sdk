#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { relative, resolve } from 'path';

const PATTERNS = [
  {
    id: 'metaspatial-file-extension',
    regex: /\.metaspatial\b/i,
  },
  {
    id: 'metaspatial-plugin-package',
    regex: /@iwsdk\/vite-plugin-metaspatial\b/i,
  },
  {
    id: 'metaspatial-generate-glxf',
    regex: /\bgenerateGLXF\b/,
  },
  {
    id: 'metaspatial-discover-components',
    regex: /\bdiscoverComponents\b/,
  },
  {
    id: 'metaspatial-editor-cli',
    regex: /\bMetaSpatialEditorCLI\b|\bMETA_SPATIAL_EDITOR_CLI_PATH\b/,
  },
  {
    id: 'metaspatial-public-glxf',
    regex: /\bpublic\/glxf\b|\/glxf\/Composition\.glxf\b/,
  },
  {
    id: 'metaspatial-create-flag',
    regex: /--(?:no-)?metaspatial\b/,
  },
  {
    id: 'metaspatial-editor-name',
    regex: /\bMeta\s*Spatial(?:\s+Editor)?\b/,
  },
];

const SKIPPED_DIRS = new Set([
  '.git',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const SKIPPED_PATH_PREFIXES = [];

const BINARY_EXTENSIONS = new Set([
  '.avif',
  '.bin',
  '.bmp',
  '.gif',
  '.glb',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.ogg',
  '.png',
  '.tgz',
  '.webm',
  '.webp',
  '.zip',
]);

const DEFAULT_ALLOWLIST = [
  /^\.changeset\/native-scene-editor-replaces-metaspatial\.md$/,
  /^CHANGELOG\.md$/,
  /(^|\/)CHANGELOG\.md$/,
  /^docs\/guides\/09-native-scene-migration\.md$/,
  /^docs\/plans\/iwsdk-native-scene-editor-replacement-plan\.md$/,
  /^docs\/plans\/iwsdk-project-manifest-and-starter-simplification-plan\.md$/,
  /^docs\/public\/skills\/iwsdk-migrate-0-5\/SKILL\.md$/,
  /^packages\/core\/agent-guidance\/claude\/CLAUDE\.md$/,
  /^packages\/core\/agent-guidance\/claude\/\.claude\/skills\/iwsdk-migrate-0-5\/SKILL\.md$/,
  /^scripts\/check-metaspatial-removal\.mjs$/,
  /^scripts\/check-metaspatial-removal-smoke\.mjs$/,
  /^scripts\/check-native-scene-docs\.mjs$/,
  /^scripts\/check-native-scene-release-artifacts\.mjs$/,
  /^scripts\/check-native-scene-release-artifacts\.test\.mjs$/,
  /^scripts\/native-scene-release-rehearsal\.mjs$/,
];

function parseArgs(argv) {
  const options = {
    json: false,
    reportOnly: false,
    root: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--report-only') {
      options.reportOnly = true;
    } else if (arg === '--root') {
      const next = argv[index + 1];
      if (next == null || next.startsWith('--')) {
        throw new Error('--root requires a path');
      }
      options.root = next;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.root = resolve(options.root);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-metaspatial-removal.mjs [options]

Options:
  --root <path>    Workspace root to scan. Defaults to cwd.
  --report-only   Always exit 0, even when non-allowlisted matches are found.
  --json          Print the report as JSON.
  -h, --help      Show this help.
`);
}

function shouldSkipPath(relativePath) {
  return SKIPPED_PATH_PREFIXES.some((prefix) =>
    relativePath.startsWith(prefix),
  );
}

function isBinaryFile(filePath) {
  const extension = filePath.includes('.')
    ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    : '';

  return BINARY_EXTENSIONS.has(extension);
}

function listFiles(root, dir = root) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = resolve(dir, entry.name);
    const relativePath = relative(root, absolutePath).replaceAll('\\', '/');

    if (shouldSkipPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...listFiles(root, absolutePath));
    } else if (entry.isFile() && !isBinaryFile(entry.name)) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
}

function isAllowed(relativePath) {
  return DEFAULT_ALLOWLIST.some((regex) => regex.test(relativePath));
}

function scanFile(file) {
  const stat = statSync(file.absolutePath);
  if (stat.size > 5_000_000) {
    return [];
  }

  const text = readFileSync(file.absolutePath, 'utf8');
  if (text.includes('\u0000')) {
    return [];
  }

  const matches = [];
  const lines = text.split(/\r?\n/);
  const allowed = isAllowed(file.relativePath);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        matches.push({
          allowed,
          file: file.relativePath,
          line: lineIndex + 1,
          pattern: pattern.id,
          text: line.trim(),
        });
      }
    }
  }

  return matches;
}

function scanWorkspace(root) {
  const files = listFiles(root);
  const matches = files.flatMap((file) => scanFile(file));
  const nonAllowlisted = matches.filter((match) => !match.allowed);

  return {
    allowlistedCount: matches.length - nonAllowlisted.length,
    matches,
    nonAllowlistedCount: nonAllowlisted.length,
    root,
    scannedFileCount: files.length,
  };
}

function printTextReport(report) {
  console.log(`Scanned ${report.scannedFileCount} files under ${report.root}`);
  console.log(
    `Found ${report.matches.length} Meta Spatial references (${report.nonAllowlistedCount} non-allowlisted)`,
  );

  for (const match of report.matches) {
    const marker = match.allowed ? 'allowlisted' : 'remove';
    console.log(
      `${marker}: ${match.file}:${match.line} [${match.pattern}] ${match.text}`,
    );
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = scanWorkspace(options.root);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }

  if (!options.reportOnly && report.nonAllowlistedCount > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
