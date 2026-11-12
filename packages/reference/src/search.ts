/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Search service for IWSDK code chunks
 */

import { loadReferenceCorpus } from './corpus.js';
import { LexicalIndex, rankByName } from './lexical.js';
import type {
  Chunk,
  RawChunk,
  SearchResult,
  RelationshipQuery,
} from './types.js';

/**
 * Helper to safely convert a field to an array
 */
function toArray(value: any): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

export class SearchService {
  private chunks: Chunk[] = [];
  private index: LexicalIndex | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const corpus = loadReferenceCorpus();
    const counters = new Map<string, number>();
    this.chunks = corpus.chunks.map((raw) => {
      const next = counters.get(raw.source) ?? 0;
      counters.set(raw.source, next + 1);
      return this.rawChunkToChunk(raw, `${raw.source}_${next}`);
    });
    this.index = new LexicalIndex(this.chunks);
    this.initialized = true;
  }

  /**
   * Transform a RawChunk from the corpus into a Chunk object
   */
  private rawChunkToChunk(raw: RawChunk, id: string): Chunk {
    return {
      id,
      content: raw.content,
      metadata: {
        source: raw.source,
        file_path: raw.file_path,
        chunk_type: raw.chunk_type,
        name: raw.name,
        start_line: raw.start_line,
        end_line: raw.end_line,
        class_context: raw.class_name,
        semantic_labels: raw.semantic_labels,
        extends: raw.extends,
        implements: raw.implements,
        imports: raw.imports,
        calls: raw.calls,
        webxr_api_usage: raw.webxr_api_usage,
        ecs_component: raw.ecs_component,
        ecs_system: raw.ecs_system,
      },
    };
  }

  /**
   * Ranked lexical search across all code chunks. Scores are relative to the
   * best hit (1.0).
   */
  async search(
    query: string,
    options: {
      limit?: number;
      source_filter?: string[];
      min_score?: number;
    } = {},
  ): Promise<SearchResult[]> {
    if (!this.initialized || !this.index) {
      throw new Error(
        'Search service not initialized. Call initialize() first.',
      );
    }

    const minScore = options.min_score ?? 0.0;
    return this.index
      .search(query, {
        limit: options.limit ?? 10,
        sourceFilter: options.source_filter,
      })
      .filter((result) => result.score >= minScore);
  }

  /**
   * Find chunks by relationship (extends, implements, imports, calls, uses WebXR API)
   */
  findByRelationship(query: RelationshipQuery): Chunk[] {
    if (!this.initialized) {
      throw new Error(
        'Search service not initialized. Call initialize() first.',
      );
    }

    const limit = query.limit ?? 20;
    const results: Chunk[] = [];

    for (const chunk of this.chunks) {
      let matches = false;

      switch (query.type) {
        case 'extends':
          matches = toArray(chunk.metadata.extends).some((e) =>
            e.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;

        case 'implements':
          matches = toArray(chunk.metadata.implements).some((i) =>
            i.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;

        case 'imports':
          matches = toArray(chunk.metadata.imports).some((imp) =>
            imp.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;

        case 'calls':
          matches = toArray(chunk.metadata.calls).some((call) =>
            call.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;

        case 'uses_webxr_api':
          matches = toArray(chunk.metadata.webxr_api_usage).some((api) =>
            api.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;
      }

      if (matches) {
        results.push(chunk);
        if (results.length >= limit) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Get chunks by name for API reference lookups, best match first: exact
   * name, then members, then prefix, then substring matches.
   */
  getByName(
    name: string,
    options: {
      chunk_type?: string;
      source_filter?: string[];
    } = {},
  ): Chunk[] {
    if (!this.initialized) {
      throw new Error(
        'Search service not initialized. Call initialize() first.',
      );
    }

    // Guide sections are found by search; API lookups return declarations.
    let results = this.chunks.filter(
      (chunk) =>
        chunk.metadata.chunk_type !== 'doc' &&
        chunk.metadata.name.toLowerCase().includes(name.toLowerCase()),
    );
    results = rankByName(results, name);

    if (options.chunk_type) {
      results = results.filter(
        (chunk) => chunk.metadata.chunk_type === options.chunk_type,
      );
    }

    if (options.source_filter && options.source_filter.length > 0) {
      results = results.filter((chunk) =>
        options.source_filter!.includes(chunk.metadata.source),
      );
    }

    return results;
  }

  /**
   * Get statistics about the indexed data
   */
  getStats(): {
    total_chunks: number;
    by_source: Record<string, number>;
    by_type: Record<string, number>;
  } {
    const bySource: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const chunk of this.chunks) {
      bySource[chunk.metadata.source] =
        (bySource[chunk.metadata.source] ?? 0) + 1;
      byType[chunk.metadata.chunk_type] =
        (byType[chunk.metadata.chunk_type] ?? 0) + 1;
    }

    return {
      total_chunks: this.chunks.length,
      by_source: bySource,
      by_type: byType,
    };
  }

  /**
   * Get all chunks (for advanced filtering in tools)
   */
  getAllChunks(): Chunk[] {
    return this.chunks;
  }
}
