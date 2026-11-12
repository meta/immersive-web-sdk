/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Code-aware BM25F ranking over reference chunks.
 *
 * Agent queries are mostly bags of identifiers ("UIKitMLAsset getElementById
 * setProperties click"), so lexical matching with identifier splitting ranks
 * them well without an embedding model. Each identifier is indexed both whole
 * and split into its camelCase/snake_case words, and fields are weighted so a
 * match on a chunk's own name outranks a mention in its body.
 */

import type { Chunk } from './types.js';

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'example',
  'examples',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'use',
  'used',
  'using',
  'what',
  'when',
  'where',
  'which',
  'with',
]);

const BM25_K1 = 1.2;

const NAME_BOOST = 2;
// Long chunks match more query words; this keeps focused declarations ahead.
const LENGTH_PENALTY = 0.25;
const LENGTH_PIVOT_LINES = 40;
const PATH_OWNER_BOOST = 2;
const DECLARATION_TYPES = new Set(['class', 'enum', 'interface', 'type']);

interface FieldSpec {
  name: 'name' | 'signature' | 'body';
  weight: number;
  b: number;
}

// `signature` holds the declaration's context (class, extends, implements,
// exports, labels); `body` holds the source text.
const FIELDS: FieldSpec[] = [
  { name: 'name', weight: 5, b: 0.3 },
  { name: 'signature', weight: 2, b: 0.5 },
  { name: 'body', weight: 1, b: 0.75 },
];

const IDENTIFIER_PATH =
  /[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g;

/**
 * Split text into lowercase terms: each identifier, its camelCase/snake_case
 * words, and each adjacent pair in a member path (`Types.Enum` adds
 * `types.enum`; `this.world.createTransformEntity` adds `this.world` and
 * `world.createtransformentity`).
 */
export function tokenize(text: string): string[] {
  const terms: string[] = [];
  for (const path of text.match(IDENTIFIER_PATH) ?? []) {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) {
      terms.push(
        `${parts[i - 1]}.${parts[i]}`.replace(/\$/g, '').toLowerCase(),
      );
    }
    terms.push(...tokenizeIdentifiers(parts));
  }
  return terms;
}

function tokenizeIdentifiers(identifiers: string[]): string[] {
  const terms: string[] = [];
  for (const identifier of identifiers) {
    const whole = identifier.replace(/\$/g, '').toLowerCase();
    if (whole.length === 0) {
      continue;
    }
    const words = identifier
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_$]+/)
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 0);
    if (words.length > 1) {
      terms.push(whole);
    }
    for (const word of words) {
      terms.push(stem(word));
    }
  }
  return terms;
}

/** Query terms: tokens minus stopwords, keeping each distinct term once. */
export function queryTerms(query: string): string[] {
  return Array.from(
    new Set(tokenize(query).filter((term) => !STOPWORDS.has(term))),
  );
}

/** Light plural/inflection folding so "buttons" matches "button". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 4 && word.endsWith('es') && /(ss|sh|ch|x)es$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

interface IndexedField {
  termFrequencies: Map<string, number>;
  length: number;
}

interface IndexedChunk {
  chunk: Chunk;
  fields: Record<FieldSpec['name'], IndexedField>;
  lowerName: string;
  lineCount: number;
}

function indexField(text: string): IndexedField {
  const termFrequencies = new Map<string, number>();
  const terms = tokenize(text);
  for (const term of terms) {
    termFrequencies.set(term, (termFrequencies.get(term) ?? 0) + 1);
  }
  return { termFrequencies, length: terms.length };
}

function signatureText(chunk: Chunk): string {
  const metadata = chunk.metadata;
  return [
    metadata.chunk_type,
    metadata.class_context ?? '',
    ...(metadata.extends ?? []),
    ...(metadata.implements ?? []),
    ...(metadata.semantic_labels ?? []),
    metadata.ecs_component ? 'ecs component' : '',
    metadata.ecs_system ? 'ecs system' : '',
    metadata.file_path,
  ].join(' ');
}

export interface LexicalSearchOptions {
  limit: number;
  sourceFilter?: string[];
}

export interface LexicalHit {
  chunk: Chunk;
  score: number;
}

export class LexicalIndex {
  private readonly entries: IndexedChunk[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: Record<FieldSpec['name'], number>;

  constructor(chunks: Chunk[]) {
    this.entries = chunks.map((chunk) => ({
      chunk,
      fields: {
        name: indexField(chunk.metadata.name),
        signature: indexField(signatureText(chunk)),
        body: indexField(chunk.content),
      },
      lowerName: chunk.metadata.name.toLowerCase(),
      lineCount: chunk.content.split('\n').length,
    }));

    const totals = { name: 0, signature: 0, body: 0 };
    for (const entry of this.entries) {
      const seen = new Set<string>();
      for (const field of FIELDS) {
        const indexed = entry.fields[field.name];
        totals[field.name] += indexed.length;
        for (const term of indexed.termFrequencies.keys()) {
          seen.add(term);
        }
      }
      for (const term of seen) {
        this.documentFrequency.set(
          term,
          (this.documentFrequency.get(term) ?? 0) + 1,
        );
      }
    }

    const count = Math.max(this.entries.length, 1);
    this.averageLength = {
      name: totals.name / count || 1,
      signature: totals.signature / count || 1,
      body: totals.body / count || 1,
    };
  }

  private idf(term: string): number {
    const n = this.entries.length;
    const df = this.documentFrequency.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, options: LexicalSearchOptions): LexicalHit[] {
    const terms = queryTerms(query);
    if (terms.length === 0) {
      return [];
    }
    const idfs = terms.map((term) => this.idf(term));
    // `Types.Entity` names both `Types` and `Entity` as well as the path.
    const identifiers = new Set(
      (query.match(/[A-Za-z_$][A-Za-z0-9_$.]*/g) ?? [])
        .flatMap((token) => [
          token,
          ...(token.includes('.') ? token.split('.') : []),
        ])
        .filter((token) => /[A-Z.]/.test(token.slice(1)) || token.length > 3)
        .map((token) => token.toLowerCase()),
    );

    // `Types.Entity` asks about the `Types` declaration itself.
    const pathOwners = new Set(
      (query.match(/[A-Za-z_$][A-Za-z0-9_$]*(?=\.[A-Za-z_$])/g) ?? []).map(
        (owner) => owner.toLowerCase(),
      ),
    );
    const hits: LexicalHit[] = [];
    for (const entry of this.entries) {
      if (
        options.sourceFilter &&
        options.sourceFilter.length > 0 &&
        !options.sourceFilter.includes(entry.chunk.metadata.source)
      ) {
        continue;
      }

      let score = 0;
      let matchedTerms = 0;
      for (let i = 0; i < terms.length; i++) {
        let weightedFrequency = 0;
        for (const field of FIELDS) {
          const indexed = entry.fields[field.name];
          const frequency = indexed.termFrequencies.get(terms[i]);
          if (!frequency) {
            continue;
          }
          const norm =
            1 -
            field.b +
            (field.b * indexed.length) / this.averageLength[field.name];
          weightedFrequency += (field.weight * frequency) / norm;
        }
        if (weightedFrequency > 0) {
          matchedTerms++;
          score +=
            (idfs[i] * weightedFrequency * (BM25_K1 + 1)) /
            (weightedFrequency + BM25_K1);
        }
      }
      if (score === 0) {
        continue;
      }

      // Reward chunks that cover more of the query, and chunks whose own name
      // is one of the identifiers the agent typed.
      score *= 0.5 + (0.5 * matchedTerms) / terms.length;
      const shortName = entry.lowerName.split('.').pop() ?? entry.lowerName;
      if (identifiers.has(entry.lowerName) || identifiers.has(shortName)) {
        score *= NAME_BOOST;
      }
      if (
        pathOwners.has(entry.lowerName) &&
        DECLARATION_TYPES.has(entry.chunk.metadata.chunk_type)
      ) {
        score *= PATH_OWNER_BOOST;
      }
      const lines = entry.lineCount;
      if (lines > LENGTH_PIVOT_LINES) {
        score /= 1 + LENGTH_PENALTY * Math.log2(lines / LENGTH_PIVOT_LINES);
      }
      if (entry.chunk.metadata.source === 'iwsdk') {
        score *= 1.1;
      }
      hits.push({ chunk: entry.chunk, score });
    }

    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, options.limit);
    const best = top[0]?.score ?? 1;
    return top.map((hit) => ({ chunk: hit.chunk, score: hit.score / best }));
  }
}

/**
 * Rank chunks for an API-name lookup: exact name, then the type's members
 * (`World.createEntity`) and members with that name, then prefix, then
 * substring.
 */
export function rankByName(chunks: Chunk[], name: string): Chunk[] {
  const needle = name.toLowerCase();
  const rank = (chunk: Chunk): number => {
    const candidate = chunk.metadata.name.toLowerCase();
    const member = candidate.split('.').pop() ?? candidate;
    if (candidate === needle) {
      return 0;
    }
    if (
      candidate.startsWith(`${needle}.`) ||
      member === needle ||
      candidate.endsWith(`.${needle}`)
    ) {
      return 1;
    }
    if (candidate.startsWith(needle) || member.startsWith(needle)) {
      return 2;
    }
    return 3;
  };
  const sourceRank = (chunk: Chunk) =>
    chunk.metadata.source === 'iwsdk' ? 0 : 1;
  return chunks
    .map((chunk, index) => ({ chunk, index, rank: rank(chunk) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        sourceRank(a.chunk) - sourceRank(b.chunk) ||
        a.chunk.metadata.name.length - b.chunk.metadata.name.length ||
        a.index - b.index,
    )
    .map((entry) => entry.chunk);
}
