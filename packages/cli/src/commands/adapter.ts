/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import {
  buildGenericAdapterPrompt,
  getAdapterSupportStatus,
  pruneAgentAdapters,
  syncAgentAdapters,
  type AdapterSupportStatus,
} from '../agent-adapters.js';
import { createSuccess } from '../cli-results.js';
import type {
  CliOptions,
  CliOptionValue,
  CliSuccess,
  ResolvedCliIo,
} from '../cli-types.js';
import {
  ALL_MANAGED_MCP_SERVER_NAMES,
  DEFAULT_MCP_SERVER_ARGS,
  DEFAULT_MCP_SERVER_NAME,
  LEGACY_MCP_ARG_TOKENS,
  LEGACY_MCP_SERVER_NAMES,
  getManagedMcpServerRegistry,
  hasManagedMcpArgToken,
  hasManagedMcpServerReference,
} from '../mcp-adapters.js';
import {
  MCP_CONFIG_TARGETS,
  SUPPORTED_AI_TOOLS,
  type AiTool,
} from '../runtime-contract.js';
import { resolveWorkspaceRoot } from '../runtime-state.js';

export interface AdapterStatusEntry {
  tool: AiTool;
  file: string;
  exists: boolean;
  status: 'configured' | 'missing' | 'stale';
  support: AdapterSupportStatus;
}

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCanonicalManagedAdapterEntry(content: string): boolean {
  return (
    (content.includes('@iwsdk/cli') ||
      hasManagedMcpServerReference(content, DEFAULT_MCP_SERVER_NAME)) &&
    DEFAULT_MCP_SERVER_ARGS.every((arg) => hasManagedMcpArgToken(content, arg))
  );
}

function extractManagedTomlSections(content: string): string {
  const managedNames = new Set(ALL_MANAGED_MCP_SERVER_NAMES);
  const lines = content.split('\n');
  const result: string[] = [];
  let currentSectionManaged = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (sectionMatch) {
      currentSectionManaged = managedNames.has(sectionMatch[1]);
      if (currentSectionManaged) {
        result.push(line);
      }
      continue;
    }

    if (trimmed.startsWith('[')) {
      currentSectionManaged = false;
    }

    if (currentSectionManaged) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function getManagedAdapterContent(
  content: string,
  target: (typeof MCP_CONFIG_TARGETS)[AiTool],
): string | null {
  if (target.format === 'toml') {
    return extractManagedTomlSections(content);
  }

  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) {
      return null;
    }

    const sectionValue = parsed[target.jsonKey ?? 'mcpServers'];
    if (!isRecord(sectionValue)) {
      return null;
    }

    const managedEntries = Object.fromEntries(
      Object.entries(sectionValue).filter(([name]) =>
        ALL_MANAGED_MCP_SERVER_NAMES.includes(name),
      ),
    );
    return JSON.stringify(managedEntries);
  } catch {
    return null;
  }
}

function hasLegacyManagedAdapterEntry(content: string): boolean {
  return (
    LEGACY_MCP_SERVER_NAMES.some((name) =>
      hasManagedMcpServerReference(content, name),
    ) ||
    LEGACY_MCP_ARG_TOKENS.some((arg) => hasManagedMcpArgToken(content, arg))
  );
}

function isAiTool(value: string): value is AiTool {
  return SUPPORTED_AI_TOOLS.includes(value as AiTool);
}

export async function readAdapterStatus(
  workspaceRoot: string,
): Promise<AdapterStatusEntry[]> {
  const status: AdapterStatusEntry[] = [];
  const serverNames = Object.keys(
    getManagedMcpServerRegistry({ workspaceRoot }).entries,
  );

  for (const tool of SUPPORTED_AI_TOOLS) {
    const target = MCP_CONFIG_TARGETS[tool];
    const filePath = path.join(workspaceRoot, target.file);
    const support = await getAdapterSupportStatus(
      workspaceRoot,
      tool,
      serverNames,
    );
    if (!existsSync(filePath)) {
      status.push({
        tool,
        file: target.file,
        exists: false,
        status: 'missing',
        support,
      });
      continue;
    }

    const content = await readFile(filePath, 'utf8');
    const managedContent = getManagedAdapterContent(content, target);
    status.push({
      tool,
      file: target.file,
      exists: true,
      status:
        managedContent !== null &&
        hasCanonicalManagedAdapterEntry(managedContent) &&
        !hasLegacyManagedAdapterEntry(managedContent) &&
        support.instruction.status === 'configured' &&
        support.permissions.status !== 'missing'
          ? 'configured'
          : 'stale',
      support,
    });
  }

  return status;
}

export function resolveAdapterTools(options: CliOptions): AiTool[] {
  if (typeof options.tools === 'string') {
    const requested = options.tools
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const invalid = requested.filter((tool) => !isAiTool(tool));
    if (invalid.length > 0) {
      throw new Error(`Unsupported AI tools: ${invalid.join(', ')}`);
    }

    return requested.filter((tool): tool is AiTool => isAiTool(tool));
  }

  return [...SUPPORTED_AI_TOOLS];
}

async function resolveWorkspace(
  io: ResolvedCliIo,
  workspace: CliOptionValue | undefined,
): Promise<string> {
  return resolveWorkspaceRoot({
    cwd: io.cwd,
    workspace: typeof workspace === 'string' ? workspace : undefined,
    requireRunning: false,
  });
}

export async function handleAdapterSync(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown>> {
  const workspaceRoot = await resolveWorkspace(io, options.workspace);
  const result = await syncAgentAdapters({
    workspaceRoot,
    // Undefined keeps the guidance tools the project already has.
    tools:
      typeof options.tools === 'string'
        ? resolveAdapterTools(options)
        : undefined,
  });
  return createSuccess({
    ...result,
    adapters: await readAdapterStatus(workspaceRoot),
  });
}

export async function handleAdapterPrune(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown>> {
  const workspaceRoot = await resolveWorkspace(io, options.workspace);
  const tools = resolveAdapterTools(options);
  await pruneAgentAdapters({ workspaceRoot, tools });
  return createSuccess({
    workspaceRoot,
    tools,
    adapters: await readAdapterStatus(workspaceRoot),
  });
}

export async function handleAdapterStatus(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown>> {
  const workspaceRoot = await resolveWorkspace(io, options.workspace);
  return createSuccess({
    workspaceRoot,
    adapters: await readAdapterStatus(workspaceRoot),
  });
}

export async function handleAdapterPrompt(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<null> {
  const workspaceRoot = await resolveWorkspace(io, options.workspace);
  io.stdout.write(`${buildGenericAdapterPrompt(workspaceRoot)}\n`);
  return null;
}
