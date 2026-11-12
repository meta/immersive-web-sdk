/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import {
  LexicalIndex,
  queryTerms,
  rankByName,
  tokenize,
} from '../src/lexical.js';
import type { Chunk } from '../src/types.js';

function chunk(
  name: string,
  content: string,
  overrides: Partial<Chunk['metadata']> = {},
): Chunk {
  return {
    id: name,
    content,
    metadata: {
      source: 'iwsdk',
      file_path: `packages/core/src/${name}.ts`,
      chunk_type: 'function',
      name,
      start_line: 1,
      end_line: 10,
      ...overrides,
    },
  };
}

describe('tokenize', () => {
  it('keeps identifiers whole and splits them into words', () => {
    expect(tokenize('UIKitMLAsset')).toEqual([
      'uikitmlasset',
      'ui',
      'kit',
      'ml',
      'asset',
    ]);
    expect(tokenize('one_hand')).toEqual(['one_hand', 'one', 'hand']);
  });

  it('adds adjacent member-path pairs', () => {
    expect(tokenize('Types.Enum')).toContain('types.enum');
    const terms = tokenize('this.world.createTransformEntity()');
    expect(terms).toContain('this.world');
    expect(terms).toContain('world.createtransformentity');
  });

  it('folds simple plurals', () => {
    expect(tokenize('buttons entities boxes')).toEqual([
      'button',
      'entity',
      'box',
    ]);
  });

  it('drops stopwords from queries', () => {
    expect(queryTerms('how to use the grab system')).toEqual([
      'grab',
      'system',
    ]);
  });
});

describe('LexicalIndex', () => {
  const chunks = [
    chunk(
      'GrabSystem',
      'export class GrabSystem { update() { forceRelease(); } }',
      {
        chunk_type: 'class',
      },
    ),
    chunk(
      'OneHandGrabbable',
      'export const OneHandGrabbable = createComponent({})',
      {
        chunk_type: 'component',
      },
    ),
    chunk(
      'setupPanel',
      'document.getElementById("btn").addEventListener("click")',
      {
        file_path: 'examples/poke/src/panel.ts',
      },
    ),
    chunk(
      'Object3D',
      'export class Object3D { getObjectById(id: number): Object3D }',
      { source: 'deps', file_path: '@types/three/src/core/Object3D.d.ts' },
    ),
  ];
  const index = new LexicalIndex(chunks);

  it('ranks a chunk named by the query first', () => {
    const [first] = index.search('OneHandGrabbable component fields', {
      limit: 3,
    });
    expect(first.chunk.metadata.name).toBe('OneHandGrabbable');
    expect(first.score).toBe(1);
  });

  it('matches split identifier words in natural-language queries', () => {
    const hits = index.search('grab system release', { limit: 2 });
    expect(hits[0].chunk.metadata.name).toBe('GrabSystem');
  });

  it('honors the source filter', () => {
    const hits = index.search('Object3D getObjectById', {
      limit: 5,
      sourceFilter: ['iwsdk'],
    });
    expect(hits.every((hit) => hit.chunk.metadata.source === 'iwsdk')).toBe(
      true,
    );
  });

  it('returns nothing for a query with no indexed terms', () => {
    expect(index.search('the of and', { limit: 5 })).toEqual([]);
    expect(index.search('zzzunknownzzz', { limit: 5 })).toEqual([]);
  });
});

describe('rankByName', () => {
  it('orders exact, member, prefix, then substring matches', () => {
    const ranked = rankByName(
      [
        chunk('ResolvedWorldTransform', ''),
        chunk('WorldOptions', ''),
        chunk('World.createEntity', ''),
        chunk('World', '', { source: 'deps' }),
        chunk('World', '', { chunk_type: 'class' }),
      ],
      'World',
    ).map((c) => `${c.metadata.name}:${c.metadata.source}`);
    expect(ranked).toEqual([
      'World:iwsdk',
      'World:deps',
      'World.createEntity:iwsdk',
      'WorldOptions:iwsdk',
      'ResolvedWorldTransform:iwsdk',
    ]);
  });
});

describe('member-path and length ranking', () => {
  it('boosts the declaration that owns a member path', () => {
    const body = 'export declare enum X { Entity = "Entity", Enum = "Enum" }';
    const index = new LexicalIndex([
      chunk('Kinds', body.replace('X', 'Kinds'), { chunk_type: 'enum' }),
      chunk('Types', body.replace('X', 'Types'), { chunk_type: 'enum' }),
    ]);
    const [first, second] = index.search('Types.Entity Kinds', { limit: 2 });
    expect(first.chunk.metadata.name).toBe('Types');
    expect(second.score).toBeLessThan(first.score);
  });

  it('prefers a focused declaration over a long one with the same matches', () => {
    const filler = Array.from({ length: 200 }, (_, i) => `  step${i}();`).join(
      '\n',
    );
    const index = new LexicalIndex([
      chunk(
        'releaseLong',
        `function releaseLong() {\n  grab.release();\n${filler}\n}`,
      ),
      chunk('releaseShort', 'function releaseShort() {\n  grab.release();\n}'),
    ]);
    const [first] = index.search('grab release', { limit: 2 });
    expect(first.chunk.metadata.name).toBe('releaseShort');
  });
});
