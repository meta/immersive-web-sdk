/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ReferenceOperationDefinition } from './contract.js';
import { FileService } from './files.js';
import type { SearchService } from './search.js';
import type { Chunk } from './types.js';

export interface SearchCodeQueryArgs {
  query: string;
  limit?: number;
  source?: string[];
  min_score?: number;
  verbosity?: number;
}

export interface RelationshipQueryArgs {
  type: 'extends' | 'implements' | 'imports' | 'calls' | 'uses_webxr_api';
  target: string;
  limit?: number;
}

export interface ApiReferenceQueryArgs {
  name: string;
  type?: 'class' | 'function' | 'interface' | 'type';
  source?: string[];
}

export interface FileContentQueryArgs {
  file_path: string;
  source: 'iwsdk' | 'deps';
  start_line?: number;
  end_line?: number;
}

export interface ListQueryArgs {
  source?: string[];
  limit?: number;
}

export interface DependentsQueryArgs {
  api_name: string;
  dependency_type?: 'imports' | 'calls' | 'extends' | 'implements' | 'any';
  limit?: number;
}

export interface UsageExamplesQueryArgs {
  api_name: string;
  limit?: number;
}

export interface ReferenceChunkResult {
  name: string;
  chunkType: string;
  source: string;
  filePath: string;
  startLine: number;
  endLine: number;
  classContext?: string;
  extends: string[];
  implements: string[];
  webxrApis: string[];
  ecsComponent: boolean;
  ecsSystem: boolean;
  content: string;
  score?: number;
}

export interface ReferenceSymbolResult {
  name: string;
  source: string;
  filePath: string;
  startLine: number;
  extends: string[];
}

export interface SearchCodeQueryResult {
  operation: 'search';
  query: string;
  totalResults: number;
  results: ReferenceChunkResult[];
  hints: string[];
  verbosity: number;
}

export interface RelationshipQueryResult {
  operation: 'relationship';
  type: 'extends' | 'implements' | 'imports' | 'calls' | 'uses_webxr_api';
  target: string;
  totalResults: number;
  results: ReferenceChunkResult[];
}

export interface ApiReferenceQueryResult {
  operation: 'api';
  name: string;
  type?: 'class' | 'function' | 'interface' | 'type';
  totalResults: number;
  results: ReferenceChunkResult[];
}

export interface FileContentQueryResult {
  operation: 'file';
  filePath: string;
  source: 'iwsdk' | 'deps';
  startLine?: number;
  endLine?: number;
  content: string;
}

export interface ComponentsQueryResult {
  operation: 'components';
  totalResults: number;
  results: ReferenceSymbolResult[];
}

export interface SystemsQueryResult {
  operation: 'systems';
  totalResults: number;
  results: ReferenceSymbolResult[];
}

export interface DependentsQueryResult {
  operation: 'dependents';
  apiName: string;
  dependencyType: 'imports' | 'calls' | 'extends' | 'implements' | 'any';
  totalResults: number;
  results: ReferenceChunkResult[];
}

export interface UsageExamplesQueryResult {
  operation: 'examples';
  apiName: string;
  totalResults: number;
  results: ReferenceChunkResult[];
}

export type ReferenceQueryResult =
  | SearchCodeQueryResult
  | RelationshipQueryResult
  | ApiReferenceQueryResult
  | FileContentQueryResult
  | ComponentsQueryResult
  | SystemsQueryResult
  | DependentsQueryResult
  | UsageExamplesQueryResult;

export interface ReferenceQueryServices {
  searchService: SearchService;
  fileService: FileService;
}

function toArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  return value;
}

function assertPositiveLimit(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`);
  }

  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }

  return value;
}

function deduplicateByLineRange<T>(
  items: T[],
  getChunk: (item: T) => Chunk,
): T[] {
  const seen = new Map<string, Array<[number, number]>>();
  const deduplicated: T[] = [];

  for (const item of items) {
    const chunk = getChunk(item);
    const key = chunk.metadata.file_path;
    const start = chunk.metadata.start_line;
    const end = chunk.metadata.end_line;

    const existingRanges = seen.get(key) || [];
    const hasOverlap = existingRanges.some(
      ([existStart, existEnd]) => !(end < existStart || start > existEnd),
    );

    if (!hasOverlap) {
      deduplicated.push(item);
      existingRanges.push([start, end]);
      seen.set(key, existingRanges);
    }
  }

  return deduplicated;
}

function getIwsdkPathPriority(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('packages/core/')) {
    return 0;
  }
  if (
    normalized.startsWith('packages/create/template/') ||
    normalized.startsWith('packages/core/agent-guidance/')
  ) {
    return 4;
  }
  if (
    normalized.startsWith('packages/') &&
    !normalized.startsWith('packages/reference-assets/')
  ) {
    return 1;
  }
  if (normalized.startsWith('examples/')) {
    return 2;
  }
  if (normalized.startsWith('playground/')) {
    return 3;
  }
  if (normalized.startsWith('packages/reference-assets/')) {
    return 5;
  }
  if (normalized.startsWith('packages/')) {
    return 6;
  }
  return 7;
}

function compareChunkPriority(a: Chunk, b: Chunk): number {
  const priorityDiff =
    getIwsdkPathPriority(a.metadata.file_path) -
    getIwsdkPathPriority(b.metadata.file_path);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const pathDiff = a.metadata.file_path.localeCompare(b.metadata.file_path);
  if (pathDiff !== 0) {
    return pathDiff;
  }

  return a.metadata.start_line - b.metadata.start_line;
}

function deduplicateByName(chunks: Chunk[]): Chunk[] {
  const seen = new Map<string, Chunk>();
  for (const chunk of chunks) {
    const name = chunk.metadata.name;
    const existing = seen.get(name);
    if (!existing) {
      seen.set(name, chunk);
    } else if (compareChunkPriority(chunk, existing) < 0) {
      seen.set(name, chunk);
    }
  }
  return Array.from(seen.values());
}

function getSourceHints(results: Chunk[], query: string): string[] {
  if (results.length === 0) {
    return [
      'Try searching without source filters to see all available results.',
    ];
  }

  const sourceCounts = new Map<string, number>();
  for (const chunk of results) {
    const source = chunk.metadata.source;
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }

  const queryLower = query.toLowerCase();
  const hints: string[] = [];

  if (
    queryLower.includes('material') ||
    queryLower.includes('mesh') ||
    queryLower.includes('geometry') ||
    queryLower.includes('vector') ||
    queryLower.includes('scene') ||
    queryLower.includes('renderer')
  ) {
    if (!sourceCounts.has('deps') || sourceCounts.get('deps')! < 3) {
      hints.push('For Three.js types, try: `source: ["deps"]`');
    }
  }

  if (
    queryLower.includes('component') ||
    queryLower.includes('system') ||
    queryLower.includes('entity') ||
    queryLower.includes('query')
  ) {
    if (!sourceCounts.has('iwsdk') || sourceCounts.get('iwsdk')! < 3) {
      hints.push('For ECS patterns, try: `source: ["iwsdk"]`');
    }
  }

  if (
    queryLower.includes('xr') ||
    queryLower.includes('controller') ||
    queryLower.includes('vr') ||
    queryLower.includes('ar')
  ) {
    hints.push('For WebXR types, try: `source: ["deps"]`');
  }

  return hints;
}

function summarizeContent(content: string, verbosity = 3): string {
  if (verbosity >= 3) {
    return content;
  }

  const lines = content.split('\n');
  if (verbosity === 0) {
    return `[${lines.length} lines - use verbosity 1+ to see content]`;
  }

  const maxLines = verbosity === 1 ? 10 : 30;
  if (lines.length <= maxLines) {
    return content;
  }

  const truncated = lines.slice(0, maxLines).join('\n');
  return (
    truncated +
    `\n\n// ... ${lines.length - maxLines} more lines (increase verbosity to see more)`
  );
}

function toChunkResult(
  chunk: Chunk,
  options: {
    score?: number;
    verbosity?: number;
  } = {},
): ReferenceChunkResult {
  return {
    name: chunk.metadata.name,
    chunkType: chunk.metadata.chunk_type,
    source: chunk.metadata.source,
    filePath: chunk.metadata.file_path,
    startLine: chunk.metadata.start_line,
    endLine: chunk.metadata.end_line,
    classContext: chunk.metadata.class_context,
    extends: toArray(chunk.metadata.extends),
    implements: toArray(chunk.metadata.implements),
    webxrApis: toArray(chunk.metadata.webxr_api_usage),
    ecsComponent: chunk.metadata.ecs_component === true,
    ecsSystem: chunk.metadata.ecs_system === true,
    content: summarizeContent(chunk.content, options.verbosity),
    ...(options.score !== undefined ? { score: options.score } : {}),
  };
}

function toSymbolResult(chunk: Chunk): ReferenceSymbolResult {
  return {
    name: chunk.metadata.name,
    source: chunk.metadata.source,
    filePath: chunk.metadata.file_path,
    startLine: chunk.metadata.start_line,
    extends: toArray(chunk.metadata.extends),
  };
}

export async function searchCodeQuery(
  searchService: SearchService,
  args: SearchCodeQueryArgs,
): Promise<SearchCodeQueryResult> {
  const query = assertNonEmptyString(args.query, 'Query');
  const limit = assertPositiveLimit(args.limit, 'Limit', 1, 100) ?? 10;
  const minScore = args.min_score ?? 0.0;
  if (typeof minScore !== 'number' || minScore < 0 || minScore > 1) {
    throw new Error('min_score must be between 0 and 1');
  }

  const verbosity = typeof args.verbosity === 'number' ? args.verbosity : 3;
  if (!Number.isFinite(verbosity) || verbosity < 0 || verbosity > 3) {
    throw new Error('verbosity must be between 0 and 3');
  }

  const requestLimit = Math.min(limit * 2, 100);
  const results = await searchService.search(query, {
    limit: requestLimit,
    source_filter: args.source,
    min_score: minScore,
  });

  const deduplicated = deduplicateByLineRange(
    results,
    (result) => result.chunk,
  );
  const finalResults = deduplicated.slice(0, limit);

  return {
    operation: 'search',
    query,
    totalResults: finalResults.length,
    results: finalResults.map((result) =>
      toChunkResult(result.chunk, {
        score: result.score,
        verbosity,
      }),
    ),
    hints: getSourceHints(
      finalResults.map((result) => result.chunk),
      query,
    ),
    verbosity,
  };
}

export async function findByRelationshipQuery(
  searchService: SearchService,
  args: RelationshipQueryArgs,
): Promise<RelationshipQueryResult> {
  const target = assertNonEmptyString(args.target, 'Target');
  const limit = assertPositiveLimit(args.limit, 'Limit', 1, 100) ?? 20;
  const results = deduplicateByLineRange(
    searchService.findByRelationship({
      type: args.type,
      target,
      limit,
    }),
    (chunk) => chunk,
  );

  return {
    operation: 'relationship',
    type: args.type,
    target,
    totalResults: results.length,
    results: results.map((chunk) => toChunkResult(chunk)),
  };
}

export async function getApiReferenceQuery(
  searchService: SearchService,
  args: ApiReferenceQueryArgs,
): Promise<ApiReferenceQueryResult> {
  const name = assertNonEmptyString(args.name, 'Name');
  const results = deduplicateByLineRange(
    searchService.getByName(name, {
      chunk_type: args.type,
      source_filter: args.source,
    }),
    (chunk) => chunk,
  );

  return {
    operation: 'api',
    name,
    type: args.type,
    totalResults: results.length,
    results: results.map((chunk) => toChunkResult(chunk)),
  };
}

export async function getFileContentQuery(
  fileService: FileService,
  args: FileContentQueryArgs,
): Promise<FileContentQueryResult> {
  const filePath = assertNonEmptyString(args.file_path, 'file_path');
  if (args.source !== 'iwsdk' && args.source !== 'deps') {
    throw new Error('source must be "iwsdk" or "deps"');
  }

  const content = await fileService.readFile(filePath, args.source, {
    startLine: args.start_line,
    endLine: args.end_line,
  });
  if (content === null) {
    throw new Error(`File not found: ${filePath} (source: ${args.source})`);
  }

  return {
    operation: 'file',
    filePath,
    source: args.source,
    startLine: args.start_line,
    endLine: args.end_line,
    content,
  };
}

export async function listEcsComponentsQuery(
  searchService: SearchService,
  args: ListQueryArgs,
): Promise<ComponentsQueryResult> {
  const limit = assertPositiveLimit(args.limit, 'Limit', 1, 1000) ?? 100;
  let components = searchService
    .getAllChunks()
    .filter((chunk) => chunk.metadata.ecs_component === true);

  components = deduplicateByLineRange(components, (chunk) => chunk);
  components = deduplicateByName(components);
  components.sort(compareChunkPriority);

  if (args.source && args.source.length > 0) {
    components = components.filter((chunk) =>
      args.source!.includes(chunk.metadata.source),
    );
  }

  const finalResults = components.slice(0, limit);
  return {
    operation: 'components',
    totalResults: finalResults.length,
    results: finalResults.map((chunk) => toSymbolResult(chunk)),
  };
}

export async function listEcsSystemsQuery(
  searchService: SearchService,
  args: ListQueryArgs,
): Promise<SystemsQueryResult> {
  const limit = assertPositiveLimit(args.limit, 'Limit', 1, 1000) ?? 100;
  let systems = searchService
    .getAllChunks()
    .filter((chunk) => chunk.metadata.ecs_system === true);

  systems = deduplicateByLineRange(systems, (chunk) => chunk);
  systems = deduplicateByName(systems);
  systems.sort(compareChunkPriority);

  if (args.source && args.source.length > 0) {
    systems = systems.filter((chunk) =>
      args.source!.includes(chunk.metadata.source),
    );
  }

  const finalResults = systems.slice(0, limit);
  return {
    operation: 'systems',
    totalResults: finalResults.length,
    results: finalResults.map((chunk) => toSymbolResult(chunk)),
  };
}

export async function findDependentsQuery(
  searchService: SearchService,
  args: DependentsQueryArgs,
): Promise<DependentsQueryResult> {
  const apiName = assertNonEmptyString(args.api_name, 'api_name');
  const dependencyType = args.dependency_type ?? 'any';
  const limit = assertPositiveLimit(args.limit, 'Limit', 1, 1000) ?? 20;
  const allChunks = searchService.getAllChunks();
  const apiNameLower = apiName.toLowerCase();

  interface ScoredChunk {
    chunk: Chunk;
    score: number;
  }

  const dependents: ScoredChunk[] = [];

  for (const chunk of allChunks) {
    let score = 0;

    const importsApi =
      (dependencyType === 'any' || dependencyType === 'imports') &&
      toArray(chunk.metadata.imports).some((entry) =>
        entry.toLowerCase().includes(apiNameLower),
      );
    const callsApi =
      (dependencyType === 'any' || dependencyType === 'calls') &&
      toArray(chunk.metadata.calls).some((entry) =>
        entry.toLowerCase().includes(apiNameLower),
      );
    const extendsApi =
      (dependencyType === 'any' || dependencyType === 'extends') &&
      toArray(chunk.metadata.extends).some((entry) =>
        entry.toLowerCase().includes(apiNameLower),
      );
    const implementsApi =
      (dependencyType === 'any' || dependencyType === 'implements') &&
      toArray(chunk.metadata.implements).some((entry) =>
        entry.toLowerCase().includes(apiNameLower),
      );
    const mentionedInCode =
      dependencyType === 'any' &&
      chunk.content.toLowerCase().includes(apiNameLower);

    if (
      !importsApi &&
      !callsApi &&
      !extendsApi &&
      !implementsApi &&
      !mentionedInCode
    ) {
      continue;
    }

    if (callsApi) {
      score += 10;
    }
    if (extendsApi || implementsApi) {
      score += 9;
    }
    if (importsApi) {
      score += mentionedInCode ? 6 : 2;
    } else if (mentionedInCode) {
      score += 5;
    }

    if (
      chunk.metadata.chunk_type === 'class' ||
      chunk.metadata.chunk_type === 'function'
    ) {
      score += 1;
    }

    if (
      chunk.metadata.chunk_type === 'type' ||
      chunk.metadata.chunk_type === 'interface'
    ) {
      score -= 1;
    }

    dependents.push({ chunk, score });
  }

  dependents.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const leftCore = left.chunk.metadata.file_path.startsWith('packages/')
      ? 0
      : 1;
    const rightCore = right.chunk.metadata.file_path.startsWith('packages/')
      ? 0
      : 1;
    if (leftCore !== rightCore) {
      return leftCore - rightCore;
    }

    return left.chunk.metadata.file_path.localeCompare(
      right.chunk.metadata.file_path,
    );
  });

  const finalResults = deduplicateByLineRange(
    dependents,
    (entry) => entry.chunk,
  )
    .slice(0, limit)
    .map((entry) => toChunkResult(entry.chunk, { score: entry.score }));

  return {
    operation: 'dependents',
    apiName,
    dependencyType,
    totalResults: finalResults.length,
    results: finalResults,
  };
}

export async function findUsageExamplesQuery(
  searchService: SearchService,
  args: UsageExamplesQueryArgs,
): Promise<UsageExamplesQueryResult> {
  const apiName = assertNonEmptyString(args.api_name, 'api_name');
  const limit = assertPositiveLimit(args.limit, 'Limit', 1, 1000) ?? 10;
  const allChunks = searchService.getAllChunks();
  const apiNameLower = apiName.toLowerCase();

  interface ScoredChunk {
    chunk: Chunk;
    score: number;
  }

  const examples: ScoredChunk[] = [];

  for (const chunk of allChunks) {
    let score = 0;
    const importsApi = toArray(chunk.metadata.imports).some((entry) =>
      entry.toLowerCase().includes(apiNameLower),
    );
    const callsApi = toArray(chunk.metadata.calls).some((entry) =>
      entry.toLowerCase().includes(apiNameLower),
    );
    const extendsApi = toArray(chunk.metadata.extends).some((entry) =>
      entry.toLowerCase().includes(apiNameLower),
    );
    const implementsApi = toArray(chunk.metadata.implements).some((entry) =>
      entry.toLowerCase().includes(apiNameLower),
    );
    const mentionedInCode = chunk.content.toLowerCase().includes(apiNameLower);

    if (importsApi && callsApi) {
      score += 10;
    } else if (importsApi && (extendsApi || implementsApi)) {
      score += 8;
    } else if (importsApi) {
      score += 3;
    }

    if (mentionedInCode) {
      score += 2;
    }

    if (
      chunk.metadata.chunk_type === 'class' ||
      chunk.metadata.chunk_type === 'function'
    ) {
      score += 3;
    }

    if (
      chunk.metadata.chunk_type === 'type' ||
      chunk.metadata.chunk_type === 'interface'
    ) {
      score -= 2;
    }

    if (score > 0) {
      examples.push({ chunk, score });
    }
  }

  examples.sort((left, right) => right.score - left.score);

  const finalResults = deduplicateByLineRange(examples, (entry) => entry.chunk)
    .slice(0, limit)
    .map((entry) => toChunkResult(entry.chunk, { score: entry.score / 10 }));

  return {
    operation: 'examples',
    apiName,
    totalResults: finalResults.length,
    results: finalResults,
  };
}

export async function executeReferenceOperation(
  operation: ReferenceOperationDefinition,
  services: ReferenceQueryServices,
  args: Record<string, unknown>,
): Promise<ReferenceQueryResult> {
  switch (operation.id) {
    case 'search':
      return searchCodeQuery(
        services.searchService,
        args as unknown as SearchCodeQueryArgs,
      );
    case 'relationship':
      return findByRelationshipQuery(
        services.searchService,
        args as unknown as RelationshipQueryArgs,
      );
    case 'api':
      return getApiReferenceQuery(
        services.searchService,
        args as unknown as ApiReferenceQueryArgs,
      );
    case 'file':
      return getFileContentQuery(
        services.fileService,
        args as unknown as FileContentQueryArgs,
      );
    case 'components':
      return listEcsComponentsQuery(
        services.searchService,
        args as unknown as ListQueryArgs,
      );
    case 'systems':
      return listEcsSystemsQuery(
        services.searchService,
        args as unknown as ListQueryArgs,
      );
    case 'dependents':
      return findDependentsQuery(
        services.searchService,
        args as unknown as DependentsQueryArgs,
      );
    case 'examples':
      return findUsageExamplesQuery(
        services.searchService,
        args as unknown as UsageExamplesQueryArgs,
      );
    default: {
      const exhaustiveCheck: never = operation.id;
      throw new Error(`Unknown reference operation: ${exhaustiveCheck}`);
    }
  }
}
