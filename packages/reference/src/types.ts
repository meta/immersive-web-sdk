/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Type definitions for IWSDK Reference MCP Server
 */

export interface ChunkMetadata {
  source: string;
  file_path: string;
  chunk_type: string;
  name: string;
  start_line: number;
  end_line: number;
  class_context?: string;
  semantic_labels?: string[];
  extends?: string[];
  implements?: string[];
  imports?: string[];
  calls?: string[];
  webxr_api_usage?: string[];
  ecs_component?: boolean;
  ecs_system?: boolean;
}

export interface Chunk {
  id: string;
  content: string;
  metadata: ChunkMetadata;
}

// Raw chunk format from embeddings.json (flattened structure)
export interface RawChunk {
  content: string;
  chunk_type: string;
  name: string;
  start_line: number;
  end_line: number;
  file_path: string;
  language: string;
  module_path?: string;
  class_name?: string;
  imports?: string[];
  exports?: string[];
  type_parameters?: string[];
  decorators?: string[];
  calls?: string[];
  extends?: string[];
  implements?: string[];
  uses_types?: string[];
  ecs_component?: boolean;
  ecs_system?: boolean;
  webxr_api_usage?: string[];
  three_js_usage?: string[];
  semantic_labels?: string[];
  source: string;
}

/** `dist/corpus.json.gz`: every chunk plus the source files they come from. */
export interface ReferenceCorpus {
  schemaVersion: number;
  referenceVersion: string;
  generatedAt: string;
  chunks: RawChunk[];
  /** File text keyed by `iwsdk/<repo path>` or `deps/<package path>`. */
  files: Record<string, string>;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export interface RelationshipQuery {
  type: 'extends' | 'implements' | 'imports' | 'calls' | 'uses_webxr_api';
  target: string;
  limit?: number;
}
