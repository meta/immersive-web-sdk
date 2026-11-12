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
import { FileService } from '../src/files.js';
import { SearchService } from '../src/search.js';
import { getApiReference, getFileContent, searchCode } from '../src/tools.js';
import type { RawChunk, ReferenceCorpus } from '../src/types.js';

const FENCE = '```';

function raw(
  name: string,
  content: string,
  overrides: Partial<RawChunk> = {},
): RawChunk {
  return {
    content,
    chunk_type: 'function',
    name,
    start_line: 1,
    end_line: content.split('\n').length,
    file_path: `packages/core/src/${name}.ts`,
    language: 'typescript',
    source: 'iwsdk',
    ...overrides,
  };
}

const longBody = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `  const widget${i} = ${i};`).join(
    '\n',
  );

const bigClass = `/** Moves grabbed widgets. */\nexport class WidgetSystem {\n${longBody(200)}\n}`;

const corpus: ReferenceCorpus = {
  schemaVersion: 1,
  referenceVersion: 'test',
  generatedAt: '2026-11-06T00:00:00.000Z',
  chunks: [
    raw('WidgetSystem', bigClass, {
      chunk_type: 'class',
      file_path: 'packages/core/src/widget.ts',
    }),
    raw('WidgetSystem.release', 'release(widget: Entity): void {}', {
      chunk_type: 'method',
      class_name: 'WidgetSystem',
      file_path: 'packages/core/src/widget.ts',
      start_line: 150,
      end_line: 150,
    }),
    raw(
      'Widgets > Making widgets',
      `## Making widgets\n\n${FENCE}ts\nwidget.make();\n${FENCE}\n\nWidgets are made.`,
      {
        chunk_type: 'doc',
        file_path: 'docs/guides/widgets.md',
        language: 'markdown',
      },
    ),
    raw('Widgets > More widgets', 'More widget prose about widgets.', {
      chunk_type: 'doc',
      file_path: 'docs/guides/widgets.md',
      language: 'markdown',
      start_line: 20,
      end_line: 20,
    }),
    raw(
      'configureWidgetPanel',
      'function configureWidgetPanel() { widget(); }',
      {
        file_path: 'examples/a/src/panel.ts',
      },
    ),
    raw(
      'configureWidgetPanel',
      'function configureWidgetPanel() { widget(); /* b */ }',
      {
        file_path: 'examples/b/src/panel.ts',
      },
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      raw(
        `widgetHelper${i}`,
        `export function widgetHelper${i}() {\n${longBody(30)}\n}`,
      ),
    ),
  ],
  files: {
    'iwsdk/packages/core/src/widget.ts': bigClass,
  },
};

let tempDir: string;
let service: SearchService;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-reference-output-'));
  const corpusPath = path.join(tempDir, 'corpus.json.gz');
  await writeFile(corpusPath, gzipSync(JSON.stringify(corpus)));
  process.env.IWSDK_REFERENCE_CORPUS = corpusPath;
  service = new SearchService();
  await service.initialize();
});

afterAll(async () => {
  delete process.env.IWSDK_REFERENCE_CORPUS;
  await rm(tempDir, { recursive: true, force: true });
});

describe('search output', () => {
  it('fences guide sections so their own fences cannot close the block', async () => {
    const text = (
      await searchCode(service, { query: 'making widgets', limit: 3 })
    ).content[0].text;
    expect(text).toContain('````markdown');
    expect(text).toContain(`${FENCE}ts\nwidget.make();\n${FENCE}`);
  });

  it('keeps one guide section and one copy of a duplicated example helper', async () => {
    const text = (
      await searchCode(service, { query: 'widget panel widgets', limit: 10 })
    ).content[0].text;
    expect(text.match(/\*\*Type\*\*: doc/g)?.length ?? 0).toBeLessThanOrEqual(
      1,
    );
    expect(text.match(/## configureWidgetPanel /g)?.length ?? 0).toBe(1);
  });

  it('shows lower-ranked results as short cards with a pointer', async () => {
    const text = (
      await searchCode(service, { query: 'widgetHelper widget', limit: 10 })
    ).content[0].text;
    const blocks = text
      .split('\n---\n')
      .filter((block) => block.includes('**Type**'));
    expect(blocks.length).toBeGreaterThan(3);
    expect(blocks[blocks.length - 1]).toMatch(
      /\[\.\.\. \d+ more lines: get_api_reference/,
    );
  });
});

describe('API and file output', () => {
  it('summarizes a large class as its head plus member signatures', async () => {
    const text = (
      await getApiReference(service, { name: 'WidgetSystem', limit: 1 })
    ).content[0].text;
    expect(text).toContain('/** Moves grabbed widgets. */');
    expect(text).toContain('// Members (1):');
    expect(text).toContain('release(widget: Entity): void {}');
    expect(text).not.toContain('widget199');
  });

  it('caps whole-file reads and returns explicit ranges in full', async () => {
    const files = new FileService();
    const whole = (
      await getFileContent(files, {
        file_path: 'packages/core/src/widget.ts',
        source: 'iwsdk',
      })
    ).content[0].text;
    expect(whole).toMatch(/\[\.\.\. \d+ more lines \(203 in total\)/);
    const ranged = (
      await getFileContent(files, {
        file_path: 'packages/core/src/widget.ts',
        source: 'iwsdk',
        start_line: 190,
        end_line: 203,
      })
    ).content[0].text;
    expect(ranged).toContain('widget199');
    expect(ranged).not.toContain('more lines');
  });
});
