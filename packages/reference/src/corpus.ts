/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The reference corpus ships inside this package as `dist/corpus.json.gz`,
 * so queries work offline right after install: there is no warmup, download,
 * cache or embedding model.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';
import type { ReferenceCorpus } from './types.js';

export const REFERENCE_CORPUS_SCHEMA_VERSION = 1;

/** `IWSDK_REFERENCE_CORPUS` points at another corpus file, e.g. in tests. */
export function getReferenceCorpusPath(): string {
  return (
    process.env.IWSDK_REFERENCE_CORPUS ??
    fileURLToPath(new URL('./corpus.json.gz', import.meta.url))
  );
}

export function getReferencePackageVersion(): string {
  try {
    const manifest = readFileSync(
      fileURLToPath(new URL('../package.json', import.meta.url)),
      'utf-8',
    );
    return (JSON.parse(manifest) as { version?: string }).version ?? '';
  } catch {
    return '';
  }
}

let cached: { path: string; corpus: ReferenceCorpus } | null = null;

export function loadReferenceCorpus(): ReferenceCorpus {
  const corpusPath = getReferenceCorpusPath();
  if (cached?.path === corpusPath) {
    return cached.corpus;
  }
  if (!existsSync(corpusPath)) {
    throw new Error(
      `The IWSDK reference corpus is missing from ${corpusPath}. Reinstall @iwsdk/reference.`,
    );
  }
  const raw = readFileSync(corpusPath);
  const text = corpusPath.endsWith('.gz')
    ? gunzipSync(raw).toString('utf-8')
    : raw.toString('utf-8');
  const corpus = JSON.parse(text) as ReferenceCorpus;
  if (corpus.schemaVersion !== REFERENCE_CORPUS_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported reference corpus schema ${String(corpus.schemaVersion)} in ${corpusPath}; expected ${REFERENCE_CORPUS_SCHEMA_VERSION}.`,
    );
  }
  cached = { path: corpusPath, corpus };
  return corpus;
}

export interface ReferenceStatus {
  packageVersion: string;
  corpusPath: string;
  corpusBytes: number | null;
  corpusVersion: string | null;
  generatedAt: string | null;
  initState: 'ready' | 'failed';
  error: { message: string; at: string } | null;
  // Kept for `iwsdk reference status` callers written against the warmup cache.
  warmupRequired: false;
}

export function getReferenceStatus(): ReferenceStatus {
  const corpusPath = getReferenceCorpusPath();
  const base = {
    packageVersion: getReferencePackageVersion(),
    corpusPath,
    warmupRequired: false as const,
  };
  try {
    const corpus = loadReferenceCorpus();
    return {
      ...base,
      corpusBytes: statSync(corpusPath).size,
      corpusVersion: corpus.referenceVersion,
      generatedAt: corpus.generatedAt,
      initState: 'ready',
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      corpusBytes: null,
      corpusVersion: null,
      generatedAt: null,
      initState: 'failed',
      error: {
        message: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      },
    };
  }
}
