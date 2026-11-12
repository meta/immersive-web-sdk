#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { format as formatWithPrettier } from 'prettier';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const RELEASE_EVIDENCE_PATH = path.join(
  REPO_ROOT,
  'docs',
  'test-evidence',
  'project-manifest-release',
  'current',
  'artifact-manifest.json',
);

const TEXT_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.css',
  '.d.ts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.md',
  '.map',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.yaml',
  '.yml',
]);

const FORBIDDEN_PATTERNS = [
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

const FORBIDDEN_DOCS_PATH_PATTERNS = [
  {
    id: 'internal-plan-docs',
    regex: /(^|\/)plans\//,
  },
];

function relativePath(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).replaceAll('\\', '/');
}

function listPackageTarballs() {
  const packagesRoot = path.join(REPO_ROOT, 'packages');
  const tarballs = [];

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = path.join(packagesRoot, entry.name);
    for (const packageEntry of readdirSync(packageDir, {
      withFileTypes: true,
    })) {
      if (
        packageEntry.isFile() &&
        packageEntry.name.startsWith('iwsdk-') &&
        packageEntry.name.endsWith('.tgz')
      ) {
        tarballs.push(path.join(packageDir, packageEntry.name));
      }
    }
  }

  return tarballs.sort();
}

function shouldScanTextFile(filePath) {
  const basename = path.basename(filePath);
  if (basename === 'LICENSE') {
    return true;
  }

  const extension = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

function isAllowedContentPath(container, filePath) {
  if (container === 'tarball') {
    return /^package\/CHANGELOG\.md$/.test(filePath);
  }

  return (
    filePath.includes('/guides/09-native-scene-migration.html') ||
    filePath.includes('/assets/guides_09-native-scene-migration.md.') ||
    /\/(?:public\/)?skills\/iwsdk-migrate-0-5\/SKILL\.(?:html|md)$/.test(
      filePath,
    ) ||
    /\/assets\/public_skills_iwsdk-migrate-0-5_SKILL\.md\.[^/]+\.js$/.test(
      filePath,
    )
  );
}

function isIntentionalMigrationReference(container, filePath, line) {
  if (container !== 'tarball') {
    return false;
  }

  // The CLI ships the release group's changelogs, which keep the history of
  // the 0.5 removal, as release notes for `iwsdk upgrade`.
  if (filePath === 'package/dist/release-notes.json') {
    return true;
  }

  if (
    /^package\/dist\/(?:(?:guidance|agent-guidance)\/files\/\.(?:claude|agents)\/skills|migrations)\/iwsdk-migrate-0-5\/SKILL\.md$/.test(
      filePath,
    )
  ) {
    return true;
  }

  return (
    /^package\/dist\/(?:guidance|agent-guidance)\/files\/CLAUDE\.md$/.test(
      filePath,
    ) &&
    line.trim() ===
      '- Replacing GLXF or Meta Spatial Editor with native IWSDK scenes'
  );
}

function scanText(text, context, failures) {
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (
      isIntentionalMigrationReference(context.container, context.file, line)
    ) {
      continue;
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        failures.push({
          ...context,
          line: lineIndex + 1,
          pattern: pattern.id,
          text: line.trim().slice(0, 220),
        });
      }
    }
  }
}

function scanPathName(name, context, failures) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(name)) {
      failures.push({
        ...context,
        line: 0,
        pattern: pattern.id,
        text: name,
      });
    }
  }
}

function scanBuiltDocsPathName(name, context, failures) {
  for (const pattern of FORBIDDEN_DOCS_PATH_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(name)) {
      failures.push({
        ...context,
        line: 0,
        pattern: pattern.id,
        text: name,
      });
    }
  }

  scanPathName(name, context, failures);
}

function listTarEntries(tarballPath) {
  return execFileSync('tar', ['-tzf', tarballPath], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter(Boolean);
}

function readTarEntry(tarballPath, entry) {
  return execFileSync('tar', ['-xOzf', tarballPath, entry], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
}

function scanTarballs(failures) {
  const tarballs = listPackageTarballs();
  if (tarballs.length === 0) {
    failures.push({
      artifact: 'packages',
      file: '<none>',
      line: 0,
      pattern: 'missing-tarballs',
      text: 'No package tarballs found. Run pnpm build:tgz before this check.',
    });
    return 0;
  }

  for (const tarballPath of tarballs) {
    const artifact = relativePath(tarballPath);
    const entries = listTarEntries(tarballPath);
    assertRequiredTarballEntries(artifact, entries, failures);

    for (const entry of entries) {
      if (!isAllowedContentPath('tarball', entry)) {
        scanPathName(entry, { artifact, file: entry }, failures);
      }

      if (
        !shouldScanTextFile(entry) ||
        isAllowedContentPath('tarball', entry)
      ) {
        continue;
      }

      scanText(
        readTarEntry(tarballPath, entry),
        { artifact, container: 'tarball', file: entry },
        failures,
      );
    }
  }

  return tarballs.length;
}

function assertRequiredTarballEntries(artifact, entries, failures) {
  const basename = path.basename(artifact);
  const packageSpecificEntries =
    basename === 'iwsdk-scene-composition.tgz'
      ? [
          'package/dist/schema.js',
          'package/dist/schema.d.ts',
          'package/dist/schema.js.map',
        ]
      : [];
  const requiredEntries = ['package/README.md', ...packageSpecificEntries];

  for (const requiredEntry of requiredEntries) {
    if (!entries.includes(requiredEntry)) {
      failures.push({
        artifact,
        file: requiredEntry,
        line: 0,
        pattern: 'missing-required-entry',
        text: `${basename} is missing ${requiredEntry}`,
      });
    }
  }

  for (const entry of entries) {
    if (entry.includes('/node_modules/')) {
      failures.push({
        artifact,
        file: entry,
        line: 0,
        pattern: 'nested-node-modules',
        text: 'Published tarballs must not contain package-manager-specific node_modules trees',
      });
    }
  }
}

function listFiles(root, dir = root) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function scanBuiltDocs(failures) {
  const docsDist = path.join(REPO_ROOT, 'docs/.vitepress/dist');
  if (!existsSync(docsDist)) {
    failures.push({
      artifact: 'docs/.vitepress/dist',
      file: '<missing>',
      line: 0,
      pattern: 'missing-docs-dist',
      text: 'Built docs are missing. Run pnpm exec vitepress build docs before this check.',
    });
    return 0;
  }

  let scanned = 0;
  for (const absolutePath of listFiles(docsDist)) {
    if (
      !shouldScanTextFile(absolutePath) ||
      statSync(absolutePath).size > 5_000_000
    ) {
      continue;
    }

    const file = relativePath(absolutePath);
    if (isAllowedContentPath('docs', file)) {
      continue;
    }

    scanned += 1;
    scanBuiltDocsPathName(
      file,
      { artifact: 'docs/.vitepress/dist', file },
      failures,
    );
    scanText(
      readFileSync(absolutePath, 'utf8'),
      {
        artifact: 'docs/.vitepress/dist',
        container: 'docs',
        file,
      },
      failures,
    );
  }

  return scanned;
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function describeEvidenceFile(relativeFile) {
  const absoluteFile = path.join(REPO_ROOT, relativeFile);
  if (!existsSync(absoluteFile)) {
    return { path: relativeFile, status: 'missing' };
  }
  const contents = readFileSync(absoluteFile);
  return {
    bytes: contents.byteLength,
    path: relativeFile,
    sha256: sha256(contents),
    status: 'present',
  };
}

function describeBuiltDocs() {
  const docsRoot = path.join(REPO_ROOT, 'docs', '.vitepress', 'dist');
  const files = listFiles(docsRoot).sort();
  const tree = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const contents = readFileSync(file);
    const relativeFile = path.relative(docsRoot, file).replaceAll('\\', '/');
    bytes += contents.byteLength;
    tree.update(relativeFile);
    tree.update('\0');
    tree.update(String(contents.byteLength));
    tree.update('\0');
    tree.update(sha256(contents));
    tree.update('\n');
  }
  return {
    bytes,
    fileCount: files.length,
    path: 'docs/.vitepress/dist',
    treeSha256: tree.digest('hex'),
  };
}

function describeTarball(tarballPath) {
  const entries = listTarEntries(tarballPath)
    .filter((entry) => !entry.endsWith('/'))
    .sort();
  const packageJson = JSON.parse(
    readTarEntry(tarballPath, 'package/package.json'),
  );
  const contents = readFileSync(tarballPath);
  return {
    bytes: contents.byteLength,
    files: entries,
    name: packageJson.name,
    path: relativePath(tarballPath),
    sha256: sha256(contents),
    version: packageJson.version,
  };
}

async function writeReleaseEvidenceManifest() {
  const manifest = {
    blockedGates: [
      {
        id: 'physical-headset-smoke',
        reason:
          'Release signoff requires validated Quest/browser evidence from a physical headset.',
      },
    ],
    builtDocs: describeBuiltDocs(),
    consoleMessageAllowlist: [
      {
        condition: 'no correlated failed request or HTTP response exists',
        harnesses: ['runtime-smoke', 'render-proof'],
        match: 'Failed to load resource',
        rationale:
          'Chromium may emit the generic resource message after an otherwise clean internal cancellation; correlated network failures remain fatal.',
      },
      {
        condition: 'message is empty after trimming',
        harnesses: ['packed-create'],
        match: '<empty pageerror>',
        rationale:
          'Chromium can emit a pageerror without an Error payload for a rejected optional browser API.',
      },
      {
        harnesses: ['packed-create'],
        match: 'Outdated Optimize Dep',
        rationale:
          'Vite may invalidate an optimized dependency during the managed runtime-to-editor navigation.',
      },
      {
        harnesses: ['packed-create'],
        match:
          'Error loading environment living_room from CDN TypeError: Failed to fetch',
        rationale:
          'The optional IWER simulated environment is externally hosted and is not part of application asset correctness.',
      },
    ],
    evidence: [
      describeEvidenceFile(
        'docs/test-evidence/project-manifest-baseline/packages.sha256',
      ),
      describeEvidenceFile(
        'docs/test-evidence/project-manifest-baseline/starter-variants.sha256',
      ),
      describeEvidenceFile(
        'docs/test-evidence/native-scene-editor/current/evidence-manifest.json',
      ),
      describeEvidenceFile(
        'docs/test-evidence/native-scene-examples/current/manifest.json',
      ),
      describeEvidenceFile(
        'docs/test-evidence/native-scene-starters/current/evidence-manifest.json',
      ),
      describeEvidenceFile(
        'docs/test-evidence/project-manifest-release/current/example-assets-cdn-report.json',
      ),
      describeEvidenceFile('docs/test-evidence/native-scene-manual-smoke.json'),
    ],
    packages: listPackageTarballs().map(describeTarball),
    schemaVersion: 1,
    scope: 'project-manifest-combined-release-evidence',
  };

  mkdirSync(path.dirname(RELEASE_EVIDENCE_PATH), { recursive: true });
  writeFileSync(
    RELEASE_EVIDENCE_PATH,
    await formatWithPrettier(JSON.stringify(manifest), { parser: 'json' }),
    'utf8',
  );
  return relativePath(RELEASE_EVIDENCE_PATH);
}

async function main() {
  const failures = [];
  const tarballCount = scanTarballs(failures);
  const docsFileCount = scanBuiltDocs(failures);

  if (failures.length > 0) {
    console.error('Native scene release artifact check failed:');
    for (const failure of failures) {
      const line = failure.line > 0 ? `:${failure.line}` : '';
      console.error(
        `- ${failure.artifact}:${failure.file}${line} [${failure.pattern}] ${failure.text}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const evidencePath = await writeReleaseEvidenceManifest();

  console.log(
    `Native scene release artifact check passed: scanned ${tarballCount} package tarballs and ${docsFileCount} built docs files; wrote ${evidencePath}.`,
  );
}

if (
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}

export { isAllowedContentPath, isIntentionalMigrationReference };
