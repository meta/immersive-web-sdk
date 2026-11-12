/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { FileService } from './files.js';
import type {
  ApiReferenceQueryResult,
  ComponentsQueryResult,
  DependentsQueryResult,
  FileContentQueryResult,
  ReferenceChunkResult,
  ReferenceSymbolResult,
  RelationshipQueryResult,
  SearchCodeQueryResult,
  SystemsQueryResult,
  UsageExamplesQueryResult,
} from './query-handlers.js';
import {
  findByRelationshipQuery,
  findDependentsQuery,
  findUsageExamplesQuery,
  getApiReferenceQuery,
  getFileContentQuery,
  listEcsComponentsQuery,
  listEcsSystemsQuery,
  searchCodeQuery,
} from './query-handlers.js';
import type { SearchService } from './search.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function createErrorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function formatChunk(result: ReferenceChunkResult): string {
  const lines: string[] = [];

  if (result.score !== undefined) {
    lines.push(`## ${result.name} (score: ${result.score.toFixed(3)})`);
  } else {
    lines.push(`## ${result.name}`);
  }

  lines.push('');
  lines.push(`**Type**: ${result.chunkType}`);
  lines.push(`**Source**: ${result.source}`);
  lines.push(
    `**File**: ${result.filePath}:${result.startLine}-${result.endLine}`,
  );

  if (result.classContext) {
    lines.push(`**Class**: ${result.classContext}`);
  }
  if (result.extends.length > 0) {
    lines.push(`**Extends**: ${result.extends.join(', ')}`);
  }
  if (result.implements.length > 0) {
    lines.push(`**Implements**: ${result.implements.join(', ')}`);
  }
  if (result.webxrApis.length > 0) {
    lines.push(`**WebXR APIs**: ${result.webxrApis.join(', ')}`);
  }
  if (result.ecsComponent) {
    lines.push('**Pattern**: ECS Component');
  }
  if (result.ecsSystem) {
    lines.push('**Pattern**: ECS System');
  }

  lines.push('');
  lines.push(
    ...fenced(
      result.content,
      result.chunkType === 'doc' ? 'markdown' : 'typescript',
    ),
  );
  return lines.join('\n');
}

/** Fence text with more backticks than any run inside it, so nested fences in guide sections cannot close the block early. */
function fenced(content: string, language: string): string[] {
  const longest = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [`${fence}${language}`, content, fence];
}

function formatSymbol(result: ReferenceSymbolResult): string {
  const lines = [
    `## ${result.name}`,
    `**Source**: ${result.source}`,
    `**File**: ${result.filePath}:${result.startLine}`,
  ];

  if (result.extends.length > 0) {
    lines.push(`**Extends**: ${result.extends.join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}

function wrapText(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function renderSearchCodeResult(result: SearchCodeQueryResult): ToolResult {
  if (result.totalResults === 0) {
    const hintText =
      result.hints.length > 0
        ? `\n\n**Source filtering hints**:\n${result.hints.map((hint) => `- ${hint}`).join('\n')}`
        : '';
    return wrapText(`No results found for query: "${result.query}"${hintText}`);
  }

  const output: string[] = [
    `# Search Results for: "${result.query}"`,
    '',
    `Found ${result.totalResults} relevant code chunks:`,
    '',
  ];

  for (const entry of result.results) {
    output.push(formatChunk(entry), '', '---', '');
  }

  if (result.hints.length > 0) {
    output.push(
      '**Source filtering hints**:',
      ...result.hints.map((hint) => `- ${hint}`),
    );
  }

  return wrapText(output.join('\n'));
}

function renderRelationshipResult(result: RelationshipQueryResult): ToolResult {
  const typeLabel = result.type.replace('_', ' ');
  if (result.totalResults === 0) {
    return wrapText(`No code found that ${typeLabel}: "${result.target}"`);
  }

  const output: string[] = [
    `# Code that ${typeLabel}: "${result.target}"`,
    '',
    `Found ${result.totalResults} code chunks:`,
    '',
  ];

  for (const entry of result.results) {
    output.push(formatChunk(entry), '', '---', '');
  }

  return wrapText(output.join('\n'));
}

function renderApiReferenceResult(result: ApiReferenceQueryResult): ToolResult {
  if (result.totalResults === 0) {
    return wrapText(
      `No API found with name: "${result.name}"${
        result.type ? ` (type: ${result.type})` : ''
      }`,
    );
  }

  const output: string[] = [
    `# API Reference: "${result.name}"`,
    '',
    result.totalMatches > result.totalResults
      ? `Showing the best ${result.totalResults} of ${result.totalMatches} matching definitions (raise \`limit\` for more):`
      : `Found ${result.totalResults} matching definitions:`,
    '',
  ];

  for (const entry of result.results) {
    output.push(formatChunk(entry), '', '---', '');
  }

  return wrapText(output.join('\n'));
}

function renderFileContentResult(result: FileContentQueryResult): ToolResult {
  const output: string[] = [
    `# File: ${result.filePath}`,
    `**Source**: ${result.source}`,
  ];

  if (result.startLine || result.endLine) {
    output.push(
      `**Lines**: ${result.startLine || 1}-${result.endLine || 'end'}`,
    );
  }

  output.push(
    '',
    ...fenced(
      result.content,
      result.filePath.endsWith('.md') ? 'markdown' : 'typescript',
    ),
  );
  return wrapText(output.join('\n'));
}

function renderComponentsResult(result: ComponentsQueryResult): ToolResult {
  if (result.totalResults === 0) {
    return wrapText('No ECS components found');
  }

  const output: string[] = [
    '# ECS Components',
    '',
    `Found ${result.totalResults} ECS components:`,
    '',
  ];

  for (const entry of result.results) {
    output.push(formatSymbol(entry));
  }

  return wrapText(output.join('\n'));
}

function renderSystemsResult(result: SystemsQueryResult): ToolResult {
  if (result.totalResults === 0) {
    return wrapText('No ECS systems found');
  }

  const output: string[] = [
    '# ECS Systems',
    '',
    `Found ${result.totalResults} ECS systems:`,
    '',
  ];

  for (const entry of result.results) {
    output.push(formatSymbol(entry));
  }

  return wrapText(output.join('\n'));
}

function renderDependentsResult(result: DependentsQueryResult): ToolResult {
  if (result.totalResults === 0) {
    return wrapText(
      `No code found that depends on "${result.apiName}"${
        result.dependencyType !== 'any'
          ? ` (type: ${result.dependencyType})`
          : ''
      }`,
    );
  }

  const output: string[] = [
    `# Code that depends on: "${result.apiName}"`,
    '',
    `Found ${result.totalResults} dependents:`,
    '',
  ];

  for (const entry of result.results) {
    output.push(formatChunk(entry), '', '---', '');
  }

  return wrapText(output.join('\n'));
}

function renderUsageExamplesResult(
  result: UsageExamplesQueryResult,
): ToolResult {
  if (result.totalResults === 0) {
    return wrapText(`No usage examples found for "${result.apiName}"`);
  }

  const output: string[] = [
    `# Usage Examples: "${result.apiName}"`,
    '',
    `Found ${result.totalResults} usage examples (ranked by relevance):`,
    '',
  ];

  for (const entry of result.results) {
    output.push(formatChunk(entry), '', '---', '');
  }

  return wrapText(output.join('\n'));
}

export async function searchCode(
  searchService: SearchService,
  args: {
    query: string;
    limit?: number;
    source?: string[];
    min_score?: number;
    verbosity?: number;
  },
): Promise<ToolResult> {
  try {
    return renderSearchCodeResult(await searchCodeQuery(searchService, args));
  } catch (error) {
    return createErrorResult(
      `Error searching code: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function findByRelationship(
  searchService: SearchService,
  args: {
    type: 'extends' | 'implements' | 'imports' | 'calls' | 'uses_webxr_api';
    target: string;
    limit?: number;
  },
): Promise<ToolResult> {
  try {
    return renderRelationshipResult(
      await findByRelationshipQuery(searchService, args),
    );
  } catch (error) {
    return createErrorResult(
      `Error finding by relationship: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function getApiReference(
  searchService: SearchService,
  args: {
    name: string;
    type?: 'class' | 'function' | 'interface' | 'type';
    source?: string[];
    limit?: number;
  },
): Promise<ToolResult> {
  try {
    return renderApiReferenceResult(
      await getApiReferenceQuery(searchService, args),
    );
  } catch (error) {
    return createErrorResult(
      `Error getting API reference: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function getFileContent(
  fileService: FileService,
  args: {
    file_path: string;
    source: 'iwsdk' | 'deps';
    start_line?: number;
    end_line?: number;
  },
): Promise<ToolResult> {
  try {
    return renderFileContentResult(
      await getFileContentQuery(fileService, args),
    );
  } catch (error) {
    return createErrorResult(
      `Error reading file: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function listEcsComponents(
  searchService: SearchService,
  args: {
    source?: string[];
    limit?: number;
  },
): Promise<ToolResult> {
  try {
    return renderComponentsResult(
      await listEcsComponentsQuery(searchService, args),
    );
  } catch (error) {
    return createErrorResult(
      `Error listing components: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function listEcsSystems(
  searchService: SearchService,
  args: {
    source?: string[];
    limit?: number;
  },
): Promise<ToolResult> {
  try {
    return renderSystemsResult(await listEcsSystemsQuery(searchService, args));
  } catch (error) {
    return createErrorResult(
      `Error listing systems: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function findDependents(
  searchService: SearchService,
  args: {
    api_name: string;
    dependency_type?: 'imports' | 'calls' | 'extends' | 'implements' | 'any';
    limit?: number;
  },
): Promise<ToolResult> {
  try {
    return renderDependentsResult(
      await findDependentsQuery(searchService, args),
    );
  } catch (error) {
    return createErrorResult(
      `Error finding dependents: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function findUsageExamples(
  searchService: SearchService,
  args: {
    api_name: string;
    limit?: number;
  },
): Promise<ToolResult> {
  try {
    return renderUsageExamplesResult(
      await findUsageExamplesQuery(searchService, args),
    );
  } catch (error) {
    return createErrorResult(
      `Error finding usage examples: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
