/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectDocFiles,
  collectIwsdkSourceFiles,
  createCorpusPayload,
  detectMonorepoRoot,
  filterLargeChunks,
  getProducerPaths,
  resolveIncludedDependencyRoots,
} from '../tools/ingest.js';
import { chunkMarkdown } from '../tools/ingestion/markdown.js';
import { TypeScriptParser } from '../tools/ingestion/parser.js';
import { TypeScriptParser } from '../tools/ingestion/parser.js';
import type { TypeScriptChunk } from '../tools/ingestion/types.js';

let tempDir: string;
let repoRoot: string;

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-reference-assets-ingest-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );
  repoRoot = path.join(tempDir, 'immersive-web-sdk');
  await mkdir(path.join(repoRoot, 'packages', 'reference-assets'), {
    recursive: true,
  });
  await writeFile(
    path.join(repoRoot, 'pnpm-workspace.yaml'),
    "packages:\n  - 'packages/*'\n",
  );
  await writeFile(
    path.join(repoRoot, 'packages', 'reference-assets', 'package.json'),
    '{}\n',
    'utf8',
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('ingest helpers', () => {
  it('detects the monorepo root from a nested cwd', async () => {
    const nestedDir = path.join(repoRoot, 'packages', 'core', 'src');
    await mkdir(nestedDir, { recursive: true });
    expect(detectMonorepoRoot(nestedDir)).toBe(repoRoot);
  });

  it('resolves dependency roots from the installed node_modules tree', async () => {
    const webxrRoot = path.join(repoRoot, 'node_modules', '@types', 'webxr');
    await mkdir(webxrRoot, { recursive: true });
    await writeFile(
      path.join(webxrRoot, 'index.d.ts'),
      'export interface XR {}\n',
    );

    const manifests = await resolveIncludedDependencyRoots(repoRoot);
    const webxr = manifests.find(
      (entry) => entry.packageName === '@types/webxr',
    );
    expect(webxr?.outputRoot).toBe('@types/webxr');
    expect(webxr?.files).toHaveLength(1);
    expect(webxr?.files[0]).toContain(
      path.join('@types', 'webxr', 'index.d.ts'),
    );
  });

  it('collects SDK source but not tests, reference tooling or the scaffolder', async () => {
    const write = async (relativePath: string) => {
      const file = path.join(repoRoot, relativePath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'export const value = true;\n', 'utf8');
      return file;
    };
    const kept = await write('packages/core/src/app.ts');
    const example = await write('examples/grab/src/index.ts');
    const dropped = await Promise.all([
      write('packages/core/src/app.test.ts'),
      write('packages/core/tests/app.ts'),
      write('packages/core/vitest.config.ts'),
      write('packages/reference/src/cli.ts'),
      write('packages/reference-assets/tools/ingest.ts'),
      write('packages/create/src/cli.ts'),
    ]);

    const files = await collectIwsdkSourceFiles(repoRoot);
    expect(files).toEqual(expect.arrayContaining([kept, example]));
    for (const file of dropped) {
      expect(files).not.toContain(file);
    }
  });

  it('collects user guides and agent guidance but not internal plans', async () => {
    const guide = path.join(repoRoot, 'docs', 'guides', '01-setup.md');
    const plan = path.join(repoRoot, 'docs', 'plans', 'roadmap.md');
    const guidance = path.join(
      repoRoot,
      'packages/create/guidance/claude/.claude/skills/iwsdk-ui/SKILL.md',
    );
    const deck = path.join(
      repoRoot,
      'packages/create/guidance/claude/.claude/skills/iwsdk-planner/references/design-deck.md',
    );
    for (const file of [guide, plan, guidance, deck]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '# Title\n', 'utf8');
    }

    const files = await collectDocFiles(repoRoot);
    expect(files).toContain(guide);
    expect(files).toContain(guidance);
    expect(files).not.toContain(plan);
    expect(files).not.toContain(deck);
  });

  it('keeps temp output scoped to the producer package', () => {
    const paths = getProducerPaths();
    expect(paths.tempDir).toContain(
      path.join('packages', 'reference-assets', 'tools', '.temp'),
    );
    expect(paths.legacyTempDir).toContain(
      path.join('packages', 'tools', '.temp'),
    );
    expect(paths.tempDir).not.toBe(paths.legacyTempDir);
  });

  it('builds a versioned corpus payload without embeddings', () => {
    const payload = createCorpusPayload(
      '1.2.3',
      [],
      { 'iwsdk/a.ts': 'x' },
      '2026-11-03T00:00:00.000Z',
    );
    expect(payload).toEqual({
      schemaVersion: 1,
      referenceVersion: '1.2.3',
      generatedAt: '2026-11-03T00:00:00.000Z',
      chunks: [],
      files: { 'iwsdk/a.ts': 'x' },
    });
  });
});

function tsChunk(overrides: Partial<TypeScriptChunk>): TypeScriptChunk {
  return {
    content: '',
    chunk_type: 'method',
    name: 'chunk',
    start_line: 1,
    end_line: 1,
    file_path: 'packages/core/src/ecs/world.ts',
    language: 'typescript',
    imports: [],
    exports: [],
    type_parameters: [],
    decorators: [],
    calls: [],
    extends: [],
    implements: [],
    uses_types: [],
    ecs_component: false,
    ecs_system: false,
    webxr_api_usage: [],
    three_js_usage: [],
    semantic_labels: [],
    ...overrides,
  };
}

describe('oversized declarations', () => {
  it('replaces an oversized class with an outline of its members', () => {
    const body = Array.from({ length: 600 }, (_, i) => `  // line ${i}`);
    const world = tsChunk({
      chunk_type: 'class',
      name: 'World',
      content: ['export class World extends ElicsWorld {', ...body, '}'].join(
        '\n',
      ),
      end_line: 602,
    });
    const member = tsChunk({
      name: 'World.createTransformEntity',
      class_name: 'World',
      content:
        '/**\n * Creates an entity.\n */\ncreateTransformEntity(object?: Object3D): Entity {\n  return e;\n}',
    });

    const { filtered, skipped, outlined } = filterLargeChunks([world, member]);
    expect({ skipped, outlined }).toEqual({ skipped: 0, outlined: 1 });
    const outline = filtered.find((chunk) => chunk.name === 'World');
    expect(outline?.content).toContain(
      'export class World extends ElicsWorld {',
    );
    expect(outline?.content).toContain(
      '  createTransformEntity(object?: Object3D): Entity {',
    );
    expect(outline?.start_line).toBe(1);
    expect(outline?.semantic_labels).toContain('outline');
  });

  it('still drops oversized functions', () => {
    const big = tsChunk({
      chunk_type: 'function',
      content: 'x\n'.repeat(600),
      end_line: 600,
    });
    expect(filterLargeChunks([big])).toMatchObject({ skipped: 1, outlined: 0 });
  });
});

describe('ECS factory declarations', () => {
  it('indexes components and systems, also when a helper wraps the factory', async () => {
    const file = path.join(tempDir, 'components.ts');
    await writeFile(
      file,
      [
        "export const Plain = createComponent('Plain', {});",
        'export const Wrapped = setComponentEditorMetadata(',
        "  createComponent('Wrapped', { mode: { type: Types.Enum, enum: {}, default: 'a' } }),",
        '  { hidden: true },',
        ');',
        'export const Spinner = createSystem({});',
        "export const NotEcs = makeThing(other('x'));",
      ].join('\n'),
    );
    const chunks = new TypeScriptParser().parseFile(file);
    const ecs = chunks
      .filter(
        (chunk) =>
          chunk.chunk_type === 'component' || chunk.chunk_type === 'system',
      )
      .map((chunk) => [chunk.name, chunk.chunk_type, chunk.calls[0]]);
    expect(ecs).toEqual([
      ['Plain', 'component', 'createComponent'],
      ['Wrapped', 'component', 'createComponent'],
      ['Spinner', 'system', 'createSystem'],
    ]);
  });
});

describe('chunkMarkdown', () => {
  it('splits a guide into sections named by their heading trail', () => {
    const chunks = chunkMarkdown(
      [
        '---',
        'title: Grabbing',
        '---',
        '',
        'Intro text.',
        '',
        '## One hand',
        'Use OneHandGrabbable.',
        '```ts',
        '# not a heading',
        '```',
        '### Release',
        'Listen for Grabbed removal.',
      ].join('\n'),
      'docs/guides/06-built-in-interactions.md',
    );

    expect(chunks.map((chunk) => chunk.name)).toEqual([
      'Grabbing',
      'Grabbing > One hand',
      'Grabbing > One hand > Release',
    ]);
    expect(chunks[1].content).toContain('# not a heading');
    expect(chunks[1].start_line).toBe(7);
    expect(chunks.every((chunk) => chunk.chunk_type === 'doc')).toBe(true);
  });
});

describe('TypeScriptParser', () => {
  it('keeps doc comments on declarations and starts the chunk at them', async () => {
    const file = path.join(tempDir, 'manifest.ts');
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      file,
      [
        "import { thing } from './thing.js';",
        '',
        '/**',
        ' * Declare the complete set of application components.',
        ' */',
        'export function defineComponents(components: unknown[]): unknown[] {',
        '  return components;',
        '}',
      ].join('\n'),
    );
    const chunk = new TypeScriptParser()
      .parseFile(file)
      .find((candidate) => candidate.name === 'defineComponents');
    expect(chunk?.content).toContain(
      'Declare the complete set of application components.',
    );
    expect(chunk?.start_line).toBe(3);
  });
});
