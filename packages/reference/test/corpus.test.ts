/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getReferenceStatus } from '../src/corpus.js';
import { FileService } from '../src/files.js';
import {
  getApiReferenceQuery,
  searchCodeQuery,
} from '../src/query-handlers.js';
import { SearchService } from '../src/search.js';
import type { RawChunk, ReferenceCorpus } from '../src/types.js';

function raw(
  name: string,
  content: string,
  overrides: Partial<RawChunk> = {},
): RawChunk {
  return {
    content,
    chunk_type: 'class',
    name,
    start_line: 1,
    end_line: content.split('\n').length,
    file_path: 'packages/core/src/ecs/world.ts',
    language: 'typescript',
    source: 'iwsdk',
    ...overrides,
  };
}

const corpus: ReferenceCorpus = {
  schemaVersion: 1,
  referenceVersion: '9.9.9',
  generatedAt: '2026-11-03T00:00:00.000Z',
  chunks: [
    raw('World', 'export class World {\n  createTransformEntity() {}\n}'),
    raw('World.createTransformEntity', 'createTransformEntity() {}', {
      chunk_type: 'method',
      class_name: 'World',
      start_line: 2,
      end_line: 2,
    }),
    raw('WorldOptions', 'export interface WorldOptions {}', {
      chunk_type: 'interface',
      file_path: 'packages/core/src/init/world-initializer.ts',
    }),
    raw('Worlds guide > Creating a World', 'Call World.create() to start.', {
      chunk_type: 'doc',
      file_path: 'docs/guides/01-project-setup.md',
      language: 'markdown',
    }),
    raw('World', 'export declare class World {}', {
      source: 'deps',
      file_path: 'elics/lib/world.d.ts',
    }),
  ],
  files: {
    'iwsdk/packages/core/src/ecs/world.ts':
      'export class World {\n  createTransformEntity() {}\n}',
    'deps/elics/lib/world.d.ts': 'export declare class World {}',
  },
};

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-reference-'));
  const corpusPath = path.join(tempDir, 'corpus.json.gz');
  await writeFile(corpusPath, gzipSync(JSON.stringify(corpus)));
  process.env.IWSDK_REFERENCE_CORPUS = corpusPath;
});

afterAll(async () => {
  delete process.env.IWSDK_REFERENCE_CORPUS;
  await rm(tempDir, { recursive: true, force: true });
});

describe('bundled corpus', () => {
  it('reports ready without any warmup', () => {
    const status = getReferenceStatus();
    expect(status.initState).toBe('ready');
    expect(status.warmupRequired).toBe(false);
    expect(status.corpusVersion).toBe('9.9.9');
  });

  it('reports a missing corpus as failed', () => {
    const previous = process.env.IWSDK_REFERENCE_CORPUS;
    process.env.IWSDK_REFERENCE_CORPUS = path.join(tempDir, 'missing.json.gz');
    try {
      const status = getReferenceStatus();
      expect(status.initState).toBe('failed');
      expect(status.error?.message).toContain('missing.json.gz');
    } finally {
      process.env.IWSDK_REFERENCE_CORPUS = previous;
    }
  });

  it('searches chunks, guides included', async () => {
    const service = new SearchService();
    await service.initialize();
    const result = await searchCodeQuery(service, {
      query: 'create a world',
      limit: 5,
    });
    expect(result.results.map((entry) => entry.chunkType)).toContain('doc');
  });

  it('ranks API lookups exact-first, without guides, up to the limit', async () => {
    const service = new SearchService();
    await service.initialize();
    const result = await getApiReferenceQuery(service, {
      name: 'World',
      limit: 2,
    });
    // World.createTransformEntity sits inside the World chunk, so it dedupes.
    expect(result.totalMatches).toBe(3);
    expect(
      result.results.map((entry) => `${entry.name}:${entry.source}`),
    ).toEqual(['World:iwsdk', 'World:deps']);
  });

  it('reads source files from the corpus', async () => {
    const files = new FileService();
    expect(
      await files.readFile('packages/core/src/ecs/world.ts', 'iwsdk', {
        startLine: 2,
        endLine: 2,
      }),
    ).toBe('  createTransformEntity() {}');
    expect(
      await files.readFile('node_modules/elics/lib/world.d.ts', 'deps'),
    ).toBe('export declare class World {}');
    expect(await files.readFile('constructor', 'iwsdk')).toBeNull();
  });
});
