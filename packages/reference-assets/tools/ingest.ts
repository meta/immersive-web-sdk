/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Reference corpus ingestion pipeline.
 *
 * Parses IWSDK source, examples and selected dependency type definitions with
 * ts-morph, splits the user guides into sections, and writes everything,
 * together with the source files, to `dist/corpus.json.gz`, which
 * `@iwsdk/reference` ships in its package. By default it indexes the
 * checked-out IWSDK workspace resolved from INIT_CWD or process.cwd(). Cloning
 * remains an explicit override.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';
import { glob } from 'glob';
import { ASTChunker } from './ingestion/chunker.js';
import { chunkMarkdown } from './ingestion/markdown.js';
import { TypeScriptParser } from './ingestion/parser.js';
import { TypeScriptChunk } from './ingestion/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function findPackageRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  return resolve(__dirname, '..');
}

const PACKAGE_ROOT = findPackageRoot();
const IWSDK_REPO = 'https://github.com/facebook/immersive-web-sdk.git';
const INCLUDED_DEPENDENCIES = [
  '@types/three',
  '@types/webxr',
  '@pmndrs/pointer-events',
  '@pmndrs/uikit',
  '@drawcall/uikitml',
  '@preact/signals-core',
  'elics',
  '@babylonjs/havok',
] as const;
const MAX_CHUNK_LINES = 500;
const MAX_CHUNK_BYTES = 20_000;
// User-facing guides; docs/plans and docs/test-evidence are internal.
const DOC_GLOBS = [
  'docs/guides/**/*.md',
  'docs/concepts/**/*.md',
  'docs/examples/**/*.md',
  'docs/troubleshooting/**/*.md',
  // The scaffold's agent guidance states the app-level recipes (custom
  // components, scene JSON, UIKitML) next to the API names. Process documents
  // such as planning decks are left out.
  'packages/create/guidance/claude/CLAUDE.md',
  'packages/create/guidance/claude/.claude/rules/*.md',
  'packages/create/guidance/claude/.claude/skills/*/SKILL.md',
  'packages/create/guidance/claude/.claude/skills/*/references/{api-reference,scene-format,component-reference,workflows,composition-patterns,asset-authoring}.md',
];
export const CORPUS_SCHEMA_VERSION = 1;

export interface DependencyManifestEntry {
  packageName: string;
  sourceRoot: string;
  outputRoot: string;
  files: string[];
}

export interface CorpusManifest {
  schemaVersion: number;
  generatedAt: string;
  iwsdkFiles: string[];
  deps: Array<{
    packageName: string;
    outputRoot: string;
    files: string[];
  }>;
}

interface IngestOptions {
  clone?: boolean;
  keepRepo?: boolean;
  repoPath?: string;
  skipBuild?: boolean;
}

export interface CorpusPayload {
  schemaVersion: number;
  referenceVersion: string;
  generatedAt: string;
  chunks: Array<TypeScriptChunk & { source: string }>;
  files: Record<string, string>;
}

export function createCorpusPayload(
  referenceVersion: string,
  chunks: Array<TypeScriptChunk & { source: string }>,
  files: Record<string, string>,
  generatedAt = new Date().toISOString(),
): CorpusPayload {
  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    referenceVersion,
    generatedAt,
    chunks,
    files,
  };
}

export function getProducerPaths() {
  return {
    packageRoot: PACKAGE_ROOT,
    tempDir: resolve(PACKAGE_ROOT, 'tools', '.temp'),
    legacyTempDir: resolve(PACKAGE_ROOT, '..', 'tools', '.temp'),
    distDir: resolve(PACKAGE_ROOT, 'dist'),
  };
}

function toPosixPath(value: string): string {
  return value.split('\\').join('/');
}

export function detectMonorepoRoot(
  startDir = resolve(process.env.INIT_CWD ?? process.cwd()),
): string | null {
  let current = startDir;
  while (true) {
    if (
      existsSync(join(current, 'pnpm-workspace.yaml')) &&
      existsSync(join(current, 'packages', 'reference-assets', 'package.json'))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function resolveDependencyRoot(
  nodeModules: string,
  packageName: string,
): string | null {
  const directPath = join(nodeModules, packageName);
  if (existsSync(directPath)) {
    return directPath;
  }

  const pnpmToken = packageName.startsWith('@')
    ? packageName.slice(1).replace('/', '+')
    : packageName;
  const matches = glob.sync(
    `.pnpm/${pnpmToken}@*/node_modules/${packageName}`,
    {
      cwd: nodeModules,
      absolute: true,
      follow: true,
    },
  );
  return matches[0] ?? null;
}

export async function collectIwsdkSourceFiles(
  iwsdkDir: string,
): Promise<string[]> {
  return glob('**/*.{ts,tsx}', {
    cwd: iwsdkDir,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      // The reference tooling and the project scaffolder are not SDK API.
      'packages/reference/**',
      'packages/reference-assets/**',
      'packages/create/**',
      'packages/*/vitest.config.ts',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/test/**',
      '**/tests/**',
    ],
    absolute: true,
  });
}

export async function resolveIncludedDependencyRoots(
  iwsdkDir: string,
): Promise<DependencyManifestEntry[]> {
  const nodeModules = resolve(iwsdkDir, 'node_modules');
  if (!existsSync(nodeModules)) {
    return [];
  }

  const manifests: DependencyManifestEntry[] = [];
  for (const packageName of INCLUDED_DEPENDENCIES) {
    const sourceRoot = resolveDependencyRoot(nodeModules, packageName);
    if (!sourceRoot) {
      continue;
    }

    const files = await glob('**/*.d.ts', {
      cwd: sourceRoot,
      ignore: ['**/@types/node/**'],
      absolute: true,
      follow: true,
    });

    manifests.push({
      packageName,
      sourceRoot,
      outputRoot: packageName,
      files,
    });
  }

  return manifests;
}

export async function collectDocFiles(iwsdkDir: string): Promise<string[]> {
  return glob(DOC_GLOBS, { cwd: iwsdkDir, absolute: true, dot: true });
}

function isOversized(chunk: TypeScriptChunk): boolean {
  const lineCount = chunk.content.split('\n').length;
  return (
    lineCount > MAX_CHUNK_LINES ||
    Buffer.byteLength(chunk.content, 'utf-8') > MAX_CHUNK_BYTES
  );
}

/**
 * The declaration line of an oversized class or interface followed by the
 * first line of each member the parser chunked separately, so the type itself
 * stays findable (`World` is over the size limit).
 */
export function outlineChunk(
  chunk: TypeScriptChunk,
  members: TypeScriptChunk[],
): TypeScriptChunk {
  const header =
    chunk.content
      .split('\n')
      .find((line) => /\b(class|interface)\b/.test(line))
      ?.trim() ?? chunk.name;
  const memberLines = members
    .map((member) => {
      const signature = member.content
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !/^(\/\*\*?|\*|\/\/|@)/.test(line));
      return `  ${signature ?? member.name}`;
    })
    .filter((line, index, all) => all.indexOf(line) === index);
  return {
    ...chunk,
    content: [
      `// Outline: ${chunk.name} is ${chunk.end_line - chunk.start_line + 1} lines; members are indexed as ${chunk.name}.<member>.`,
      header.endsWith('{') ? header : `${header} {`,
      ...memberLines,
      '}',
    ].join('\n'),
    semantic_labels: [...chunk.semantic_labels, 'outline'],
  };
}

export function filterLargeChunks(chunks: TypeScriptChunk[]): {
  filtered: TypeScriptChunk[];
  skipped: number;
  outlined: number;
} {
  const filtered: TypeScriptChunk[] = [];
  let skipped = 0;
  let outlined = 0;

  for (const chunk of chunks) {
    if (!isOversized(chunk)) {
      filtered.push(chunk);
      continue;
    }
    if (chunk.chunk_type === 'class' || chunk.chunk_type === 'interface') {
      const members = chunks.filter(
        (candidate) =>
          candidate !== chunk &&
          candidate.class_name === chunk.name &&
          candidate.file_path === chunk.file_path,
      );
      const outline = outlineChunk(chunk, members);
      if (!isOversized(outline)) {
        filtered.push(outline);
        outlined++;
        continue;
      }
    }
    skipped++;
  }

  return { filtered, skipped, outlined };
}

class IngestionPipeline {
  private packageRoot = getProducerPaths().packageRoot;
  private tempDir = getProducerPaths().tempDir;
  private distDir = getProducerPaths().distDir;

  async run(options: IngestOptions = {}) {
    console.error('='.repeat(80));
    console.error('🚀 IWSDK REFERENCE CORPUS INGESTION PIPELINE');
    console.error('='.repeat(80));
    console.error('');

    try {
      const iwsdkDir = await this.resolveIwsdkDir(options);
      const iwsdkFiles = await collectIwsdkSourceFiles(iwsdkDir);
      const docFiles = await collectDocFiles(iwsdkDir);
      const dependencyManifest = await resolveIncludedDependencyRoots(iwsdkDir);

      const iwsdkChunks = (await this.ingestIWSDK(iwsdkFiles)).map((chunk) => ({
        ...chunk,
        source: 'iwsdk' as const,
        file_path: toPosixPath(relative(iwsdkDir, chunk.file_path)),
      }));
      const docChunks = this.ingestDocs(iwsdkDir, docFiles);
      const depsChunks = (
        await this.ingestDependencies(dependencyManifest)
      ).map((chunk) => ({ ...chunk, source: 'deps' as const }));

      const files: Record<string, string> = {};
      for (const file of [...iwsdkFiles, ...docFiles]) {
        files[`iwsdk/${toPosixPath(relative(iwsdkDir, file))}`] = readFileSync(
          file,
          'utf-8',
        );
      }
      for (const entry of dependencyManifest) {
        for (const file of entry.files) {
          const relativePath = toPosixPath(relative(entry.sourceRoot, file));
          files[`deps/${entry.outputRoot}/${relativePath}`] = readFileSync(
            file,
            'utf-8',
          );
        }
      }

      this.writeCorpus(
        createCorpusPayload(
          this.readPackageVersion(),
          [...iwsdkChunks, ...docChunks, ...depsChunks],
          files,
        ),
      );

      if (!options.keepRepo) {
        this.cleanup();
      }

      console.error('');
      console.error('='.repeat(80));
      console.error('✅ INGESTION PIPELINE COMPLETED SUCCESSFULLY');
      console.error('='.repeat(80));
      console.error(
        'Next: pnpm --filter @iwsdk/reference run build copies the corpus into the package.',
      );
      console.error('');
    } catch (error) {
      console.error('');
      console.error('❌ INGESTION PIPELINE FAILED');
      console.error(error);
      process.exit(1);
    }
  }

  private async resolveIwsdkDir(options: IngestOptions): Promise<string> {
    console.error('='.repeat(80));
    console.error('📦 RESOLVING IWSDK SOURCE');
    console.error('='.repeat(80));
    console.error('');

    if (options.repoPath) {
      console.error(`📂 Using explicit repo path: ${options.repoPath}`);
      return resolve(options.repoPath);
    }

    const monorepoRoot = detectMonorepoRoot();
    if (monorepoRoot) {
      console.error(`📂 Detected monorepo root: ${monorepoRoot}`);
      console.error(
        '   Using local workspace (pass --clone to clone from GitHub instead)',
      );
      console.error('');
      return monorepoRoot;
    }

    if (!options.clone) {
      throw new Error(
        'No IWSDK repo root found from the current working directory. Run this command inside the checked-out monorepo, pass --repo-path=<path>, or opt into cloning with --clone.',
      );
    }

    const iwsdkDir = resolve(this.tempDir, 'immersive-web-sdk');
    mkdirSync(this.tempDir, { recursive: true });

    if (existsSync(iwsdkDir)) {
      console.error('🗑️  Removing existing repo...');
      rmSync(iwsdkDir, { recursive: true, force: true });
    }

    console.error(`🔽 Cloning ${IWSDK_REPO}...`);
    execSync(`git clone --depth 1 ${IWSDK_REPO} ${iwsdkDir}`, {
      stdio: 'inherit',
    });
    console.error('✅ Repository cloned');
    console.error('');

    if (!options.skipBuild) {
      console.error('📥 Installing dependencies...');
      execSync('pnpm install', {
        cwd: iwsdkDir,
        stdio: 'inherit',
      });
      console.error('✅ Dependencies installed');
      console.error('');
    }

    return iwsdkDir;
  }

  private async ingestIWSDK(iwsdkFiles: string[]): Promise<TypeScriptChunk[]> {
    console.error('='.repeat(80));
    console.error('📝 INGESTING IWSDK SOURCE CODE');
    console.error('='.repeat(80));
    console.error(`✅ Found ${iwsdkFiles.length} TypeScript files`);
    console.error('');

    const parser = new TypeScriptParser();
    const chunker = new ASTChunker();
    const allChunks: TypeScriptChunk[] = [];
    let successful = 0;
    let failed = 0;
    let totalSkipped = 0;
    let totalOutlined = 0;

    for (let i = 0; i < iwsdkFiles.length; i++) {
      const file = iwsdkFiles[i];
      try {
        const chunks = parser.parseFile(file);
        if (chunks.length > 0) {
          const optimized = chunker.optimizeChunks(chunks);
          const { filtered, skipped, outlined } = filterLargeChunks(optimized);
          totalSkipped += skipped;
          totalOutlined += outlined;
          for (const chunk of filtered) {
            chunk.source = 'iwsdk';
          }
          allChunks.push(...filtered);
          successful++;
        }

        if ((i + 1) % 25 === 0 || i + 1 === iwsdkFiles.length) {
          const progress = Math.round(((i + 1) / iwsdkFiles.length) * 100);
          console.error(
            `   Progress: ${i + 1}/${iwsdkFiles.length} files (${progress}%) - ${allChunks.length} chunks so far`,
          );
        }
      } catch (error) {
        failed++;
        if (failed <= 5) {
          console.error(`  ⚠️  Error processing ${file}: ${error}`);
        }
      }
    }

    console.error('');
    console.error(`✅ Processed ${successful} files successfully`);
    if (failed > 0) {
      console.error(`⚠️  Failed to process ${failed} files`);
    }
    if (totalSkipped > 0) {
      console.error(`📊 Filtered out ${totalSkipped} oversized chunks`);
    }
    if (totalOutlined > 0) {
      console.error(
        `📊 Outlined ${totalOutlined} oversized classes/interfaces`,
      );
    }
    console.error(`📊 Generated ${allChunks.length} code chunks`);
    console.error('');
    return allChunks;
  }

  private async ingestDependencies(
    dependencyManifest: DependencyManifestEntry[],
  ): Promise<TypeScriptChunk[]> {
    console.error('='.repeat(80));
    console.error('📦 INGESTING DEPENDENCIES');
    console.error('='.repeat(80));
    console.error('');

    const dtsFiles = dependencyManifest.flatMap((entry) => entry.files);
    console.error(
      `✅ Found ${dtsFiles.length} type definition files from dependencies`,
    );
    console.error('');

    if (dtsFiles.length === 0) {
      return [];
    }

    const parser = new TypeScriptParser();
    const chunker = new ASTChunker();
    const allChunks: TypeScriptChunk[] = [];
    let totalSkipped = 0;
    let totalOutlined = 0;

    for (let i = 0; i < dtsFiles.length; i++) {
      const file = dtsFiles[i];
      const entry = dependencyManifest.find((manifest) =>
        manifest.files.includes(file),
      );
      if (!entry) {
        continue;
      }

      try {
        const chunks = parser.parseFile(file);
        if (chunks.length > 0) {
          const optimized = chunker.optimizeChunks(chunks);
          const { filtered, skipped, outlined } = filterLargeChunks(optimized);
          totalSkipped += skipped;
          totalOutlined += outlined;

          for (const chunk of filtered) {
            chunk.source = 'deps';
            chunk.file_path = toPosixPath(
              join(
                entry.outputRoot,
                relative(entry.sourceRoot, chunk.file_path),
              ),
            );
          }

          allChunks.push(...filtered);
        }

        if ((i + 1) % 50 === 0 || i + 1 === dtsFiles.length) {
          const progress = Math.round(((i + 1) / dtsFiles.length) * 100);
          console.error(
            `   Progress: ${i + 1}/${dtsFiles.length} files (${progress}%) - ${allChunks.length} chunks so far`,
          );
        }
      } catch {
        // Skip dependency parse failures to keep ingest moving.
      }
    }

    console.error('');
    if (totalSkipped > 0) {
      console.error(`📊 Filtered out ${totalSkipped} oversized chunks`);
    }
    if (totalOutlined > 0) {
      console.error(
        `📊 Outlined ${totalOutlined} oversized classes/interfaces`,
      );
    }
    console.error(`📊 Generated ${allChunks.length} dependency chunks`);
    console.error('');
    return allChunks;
  }

  private ingestDocs(
    iwsdkDir: string,
    docFiles: string[],
  ): Array<TypeScriptChunk & { source: 'iwsdk' }> {
    const chunks = docFiles.flatMap((file) =>
      chunkMarkdown(
        readFileSync(file, 'utf-8'),
        toPosixPath(relative(iwsdkDir, file)),
      ).map((chunk) => ({ ...chunk, source: 'iwsdk' as const })),
    );
    console.error(
      `📚 Split ${docFiles.length} guides into ${chunks.length} sections`,
    );
    console.error('');
    return chunks;
  }

  private readPackageVersion(): string {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(this.packageRoot, 'package.json'), 'utf-8'),
      ) as { version?: string };
      return pkg.version ?? 'unknown';
    } catch (error) {
      console.error(`⚠️  Could not extract package version: ${error}`);
      return 'unknown';
    }
  }

  private writeCorpus(payload: CorpusPayload): void {
    mkdirSync(this.distDir, { recursive: true });
    const corpusPath = resolve(this.distDir, 'corpus.json.gz');
    const compressed = gzipSync(JSON.stringify(payload), { level: 9 });
    writeFileSync(corpusPath, compressed);
    console.error(
      `✅ Wrote ${payload.chunks.length} chunks and ${Object.keys(payload.files).length} files to ${corpusPath} (${(compressed.length / 1024 / 1024).toFixed(1)} MB)`,
    );
  }

  private cleanup(): void {
    console.error('🗑️  Cleaning up temporary files...');
    if (existsSync(this.tempDir)) {
      rmSync(this.tempDir, { recursive: true, force: true });
    }
    console.error('✅ Cleanup complete');
    console.error('');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: IngestOptions = {};

  for (const arg of args) {
    if (arg === '--keep-repo') {
      options.keepRepo = true;
    } else if (arg === '--clone') {
      options.clone = true;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg.startsWith('--repo-path=')) {
      options.repoPath = arg.split('=')[1];
    }
  }

  await new IngestionPipeline().run(options);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
