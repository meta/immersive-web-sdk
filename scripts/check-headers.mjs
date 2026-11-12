#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// MIT license headers for Meta open source projects
const HEADERS = {
  block: `/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`,

  line: `# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.`,
};

// Directories to check
const INCLUDE_DIRS = ['packages', 'examples', 'scripts', 'docs'];

// File extensions to check with their comment syntax
const FILE_TYPES = {
  // JavaScript/TypeScript files - block comments
  '.ts': 'block',
  '.tsx': 'block',
  '.js': 'block',
  '.jsx': 'block',
  '.mjs': 'block',
  '.mts': 'block',
  '.cts': 'block',

  // Shell scripts - line comments
  '.sh': 'line',
};

// Paths to exclude (relative to repo root)
const EXCLUDE_PATHS = [
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.vitepress/cache',
  'public',
  '.pnpm-store',
];

// Files to exclude
const EXCLUDE_FILES = [
  // Generated at build time and excluded from source control.
  'generated-profiles.ts',
  'version.ts',
  'rollup.config.js',
  'vite.config.js',
  'vitest.config.js',
  'postprocess-typedoc.cjs',
  'setup-git-hooks.cjs',
];

async function shouldSkipPath(filePath) {
  const relativePath = path.relative(REPO_ROOT, filePath);

  // Skip if path contains excluded directories
  for (const exclude of EXCLUDE_PATHS) {
    if (relativePath.includes(exclude)) return true;
  }

  // Skip generated type definitions
  if (relativePath.endsWith('.d.ts')) return true;

  // Skip specific config files
  const fileName = path.basename(filePath);
  if (EXCLUDE_FILES.includes(fileName)) return true;

  return false;
}

async function findSourceFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (await shouldSkipPath(fullPath)) continue;

      if (entry.isDirectory()) {
        const subFiles = await findSourceFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(fullPath);
        if (FILE_TYPES[ext]) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }

  return files;
}

function getFileCommentType(filePath) {
  const ext = path.extname(filePath);
  return FILE_TYPES[ext] || 'block';
}

async function hasCorrectHeader(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const commentType = getFileCommentType(filePath);
    const expectedHeader = HEADERS[commentType];

    // Skip shebang if present
    const lines = content.split('\n');
    let startIndex = 0;
    if (lines[0]?.startsWith('#!')) {
      startIndex = 1;
    }

    // Skip empty lines
    while (startIndex < lines.length && lines[startIndex].trim() === '') {
      startIndex++;
    }

    // Check if header is present
    const remainingContent = lines.slice(startIndex).join('\n');
    return remainingContent.startsWith(expectedHeader);
  } catch (error) {
    console.warn(`Warning: Could not read ${filePath}: ${error.message}`);
    return true; // Skip files we can't read
  }
}

async function addHeader(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const commentType = getFileCommentType(filePath);
    const header = HEADERS[commentType];
    const lines = content.split('\n');

    let insertIndex = 0;
    let newContent = '';

    // Preserve shebang if present
    if (lines[0]?.startsWith('#!')) {
      newContent += lines[0] + '\n';
      insertIndex = 1;
    }

    // Add header
    newContent += header + '\n\n';

    // Add rest of content (skip empty lines at the top)
    while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
      insertIndex++;
    }

    newContent += lines.slice(insertIndex).join('\n');

    await fs.writeFile(filePath, newContent, 'utf8');
    return true;
  } catch (error) {
    console.error(`Error adding header to ${filePath}: ${error.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fix = args.includes('--fix');

  console.log('🔍 Checking file headers...\n');

  // Gather all files
  const allFiles = [];
  for (const dirName of INCLUDE_DIRS) {
    const dirPath = path.join(REPO_ROOT, dirName);
    try {
      await fs.access(dirPath);
      const files = await findSourceFiles(dirPath);
      allFiles.push(...files);
    } catch {
      // Skip directories that don't exist
      console.log(`📁 Skipping ${dirName}/ (not found)`);
    }
  }

  // Remove duplicates
  const uniqueFiles = [...new Set(allFiles)];

  console.log(`📁 Found ${uniqueFiles.length} files to check\n`);

  const missingHeaders = [];

  // Check each file
  for (const filePath of uniqueFiles) {
    const hasHeader = await hasCorrectHeader(filePath);
    if (!hasHeader) {
      const relativePath = path.relative(REPO_ROOT, filePath);
      missingHeaders.push({ filePath, relativePath });
    }
  }

  if (missingHeaders.length === 0) {
    console.log('✅ All files have correct headers!');
    return;
  }

  console.log(`❌ Found ${missingHeaders.length} files missing headers:\n`);

  for (const { relativePath } of missingHeaders) {
    console.log(`  ${relativePath}`);
  }

  if (dryRun) {
    console.log('\n📋 This was a dry run. Use --fix to add missing headers.');
    process.exit(1);
  }

  if (!fix) {
    console.log('\n💡 Run with --fix to automatically add missing headers.');
    console.log(
      '💡 Run with --dry-run to see what would be changed without making changes.',
    );
    process.exit(1);
  }

  // Fix headers
  console.log('\n🔧 Adding missing headers...\n');

  let fixed = 0;
  for (const { filePath, relativePath } of missingHeaders) {
    const success = await addHeader(filePath);
    if (success) {
      console.log(`✅ ${relativePath}`);
      fixed++;
    } else {
      console.log(`❌ ${relativePath}`);
    }
  }

  console.log(`\n🎉 Added headers to ${fixed}/${missingHeaders.length} files.`);

  if (fixed < missingHeaders.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});
