/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  GuidanceSourceError,
  installedGuidanceTools,
  ownedSkillNames,
  resolveProjectGuidance,
  syncAgentGuidance,
} from './agent-guidance.js';
import {
  ALL_MANAGED_MCP_SERVER_NAMES,
  getManagedMcpServerRegistry,
  pruneMcpAdapters,
  syncMcpAdapters,
} from './mcp-adapters.js';
import { SUPPORTED_AI_TOOLS, type AiTool } from './runtime-contract.js';
import { normalizeWorkspaceRoot } from './runtime-state.js';

type JsonObject = Record<string, unknown>;

const AGENTS_FILE = 'AGENTS.md';
const CLAUDE_FILE = 'CLAUDE.md';
const CLAUDE_SETTINGS_FILE = '.claude/settings.json';
const CURSOR_PERMISSIONS_FILE = '.cursor/permissions.json';
const OPENCODE_CONFIG_FILE = 'opencode.json';
const OPENCODE_SKILL_PERMISSION = 'iwsdk-*';
const CURSOR_ALLOW_PREFIX = 'Allow IWSDK-managed MCP tools from ';

export interface AdapterSupportStatus {
  instruction: {
    file: string;
    status: 'configured' | 'missing';
  };
  permissions: {
    file: string | null;
    status: 'configured' | 'manual' | 'missing';
    note?: string;
  };
}

export interface SyncAgentAdaptersOptions {
  workspaceRoot: string;
  tools?: AiTool[];
  command?: string;
  args?: string[];
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}

async function readJsonObject(filePath: string): Promise<{
  created: boolean;
  value: JsonObject;
}> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!isRecord(parsed)) {
      throw new Error(`Existing config at ${filePath} must contain an object`);
    }
    return { created: false, value: parsed };
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return { created: true, value: {} };
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Existing config at ${filePath} is invalid JSON`);
    }
    throw error;
  }
}

async function writeJsonObject(
  filePath: string,
  value: JsonObject,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function managedClaudePermission(serverName: string): string {
  return `mcp__${serverName}__*`;
}

function isManagedClaudePermission(rule: unknown): boolean {
  return (
    typeof rule === 'string' &&
    ALL_MANAGED_MCP_SERVER_NAMES.some((serverName) =>
      rule.startsWith(`mcp__${serverName}__`),
    )
  );
}

async function syncClaudeSettings(
  workspaceRoot: string,
  serverNames: string[],
): Promise<void> {
  const filePath = path.join(workspaceRoot, CLAUDE_SETTINGS_FILE);
  const { value } = await readJsonObject(filePath);
  const permissionsValue = value.permissions;
  if (permissionsValue != null && !isRecord(permissionsValue)) {
    throw new Error(
      `Existing Claude settings section "permissions" at ${filePath} must be an object`,
    );
  }
  const permissions = isRecord(permissionsValue) ? { ...permissionsValue } : {};
  const allowValue = permissions.allow;
  if (allowValue != null && !Array.isArray(allowValue)) {
    throw new Error(
      `Existing Claude settings section "permissions.allow" at ${filePath} must be an array`,
    );
  }
  permissions.allow = [
    ...(Array.isArray(allowValue)
      ? allowValue.filter((rule) => !isManagedClaudePermission(rule))
      : []),
    ...serverNames.map(managedClaudePermission),
  ];
  value.permissions = permissions;

  const enabledValue = value.enabledMcpjsonServers;
  if (enabledValue != null && !Array.isArray(enabledValue)) {
    throw new Error(
      `Existing Claude setting "enabledMcpjsonServers" at ${filePath} must be an array`,
    );
  }
  value.enabledMcpjsonServers = [
    ...(Array.isArray(enabledValue)
      ? enabledValue.filter(
          (name) =>
            typeof name === 'string' &&
            !(ALL_MANAGED_MCP_SERVER_NAMES as readonly string[]).includes(name),
        )
      : []),
    ...serverNames,
  ];
  // Older IWSDK starters enabled every project MCP server. That setting would
  // bypass the narrow server allowlist above, including for user-owned MCPs.
  if (value.enableAllProjectMcpServers === true) {
    delete value.enableAllProjectMcpServers;
  }
  value.$schema ??= 'https://json.schemastore.org/claude-code-settings.json';
  await writeJsonObject(filePath, value);
}

/** Skills IWSDK has shipped, so prune leaves a developer's own alone. */
async function readOwnedSkillNames(
  workspaceRoot: string,
): Promise<Set<string>> {
  try {
    return ownedSkillNames(
      (await resolveProjectGuidance(workspaceRoot)).manifest,
    );
  } catch {
    return new Set();
  }
}

async function pruneClaudeSettings(workspaceRoot: string): Promise<void> {
  const filePath = path.join(workspaceRoot, CLAUDE_SETTINGS_FILE);
  if (!existsSync(filePath)) {
    return;
  }
  const { value } = await readJsonObject(filePath);
  const permissions = value.permissions;
  if (isRecord(permissions) && Array.isArray(permissions.allow)) {
    const ownedSkills = await readOwnedSkillNames(workspaceRoot);
    const filteredAllow = permissions.allow.filter((rule) => {
      const skill =
        typeof rule === 'string'
          ? rule.match(/^Skill\((iwsdk-[^)]*)\)$/u)?.[1]
          : undefined;
      return (
        !isManagedClaudePermission(rule) &&
        !(skill != null && ownedSkills.has(skill))
      );
    });
    if (filteredAllow.length === 0) {
      delete permissions.allow;
    } else {
      permissions.allow = filteredAllow;
    }
    if (Object.keys(permissions).length === 0) {
      delete value.permissions;
    }
  }
  const enabledMcpjsonServers = value.enabledMcpjsonServers;
  if (Array.isArray(enabledMcpjsonServers)) {
    const filteredEnabledServers = enabledMcpjsonServers.filter(
      (name) =>
        typeof name === 'string' &&
        !(ALL_MANAGED_MCP_SERVER_NAMES as readonly string[]).includes(name),
    );
    if (filteredEnabledServers.length === 0) {
      delete value.enabledMcpjsonServers;
    } else {
      value.enabledMcpjsonServers = filteredEnabledServers;
    }
  }
  await writeJsonObject(filePath, value);
}

function cursorAllowInstruction(serverNames: string[]): string {
  return `${CURSOR_ALLOW_PREFIX}${serverNames.join(', ')} to run without manual approval.`;
}

async function syncCursorPermissions(
  workspaceRoot: string,
  serverNames: string[],
): Promise<void> {
  const filePath = path.join(workspaceRoot, CURSOR_PERMISSIONS_FILE);
  const { value } = await readJsonObject(filePath);
  const autoRunValue = value.autoRun;
  if (autoRunValue != null && !isRecord(autoRunValue)) {
    throw new Error(
      `Existing Cursor permissions section "autoRun" at ${filePath} must be an object`,
    );
  }
  const autoRun = isRecord(autoRunValue) ? { ...autoRunValue } : {};
  const allowValue = autoRun.allow_instructions;
  if (allowValue != null && !Array.isArray(allowValue)) {
    throw new Error(
      `Existing Cursor permissions section "autoRun.allow_instructions" at ${filePath} must be an array`,
    );
  }
  autoRun.allow_instructions = [
    ...(Array.isArray(allowValue)
      ? allowValue.filter(
          (entry) =>
            typeof entry !== 'string' || !entry.startsWith(CURSOR_ALLOW_PREFIX),
        )
      : []),
    cursorAllowInstruction(serverNames),
  ];
  autoRun.block_instructions ??= [];
  value.autoRun = autoRun;
  await writeJsonObject(filePath, value);
}

async function pruneCursorPermissions(workspaceRoot: string): Promise<void> {
  const filePath = path.join(workspaceRoot, CURSOR_PERMISSIONS_FILE);
  if (!existsSync(filePath)) {
    return;
  }
  const { value } = await readJsonObject(filePath);
  const autoRun = value.autoRun;
  if (isRecord(autoRun) && Array.isArray(autoRun.allow_instructions)) {
    const filteredAllowInstructions = autoRun.allow_instructions.filter(
      (entry) =>
        typeof entry !== 'string' || !entry.startsWith(CURSOR_ALLOW_PREFIX),
    );
    if (filteredAllowInstructions.length === 0) {
      delete autoRun.allow_instructions;
    } else {
      autoRun.allow_instructions = filteredAllowInstructions;
    }
    if (Object.keys(autoRun).length === 0) {
      delete value.autoRun;
    }
  }
  await writeJsonObject(filePath, value);
}

async function syncOpenCodeSkillPermissions(
  workspaceRoot: string,
): Promise<void> {
  const filePath = path.join(workspaceRoot, OPENCODE_CONFIG_FILE);
  const { value } = await readJsonObject(filePath);
  const permissionValue = value.permission;
  if (
    permissionValue != null &&
    typeof permissionValue !== 'string' &&
    !isRecord(permissionValue)
  ) {
    throw new Error(
      `Existing OpenCode setting "permission" at ${filePath} must be a string or object`,
    );
  }
  const permissions: JsonObject =
    typeof permissionValue === 'string'
      ? { '*': permissionValue }
      : isRecord(permissionValue)
        ? { ...permissionValue }
        : {};
  const skillValue = permissions.skill;
  if (
    skillValue != null &&
    typeof skillValue !== 'string' &&
    !isRecord(skillValue)
  ) {
    throw new Error(
      `Existing OpenCode setting "permission.skill" at ${filePath} must be a string or object`,
    );
  }
  const skillPermissions: JsonObject =
    typeof skillValue === 'string'
      ? { '*': skillValue }
      : isRecord(skillValue)
        ? { ...skillValue }
        : {};
  skillPermissions[OPENCODE_SKILL_PERMISSION] = 'allow';
  permissions.skill = skillPermissions;
  value.permission = permissions;
  value.$schema ??= 'https://opencode.ai/config.json';
  await writeJsonObject(filePath, value);
}

async function pruneOpenCodeSkillPermissions(
  workspaceRoot: string,
): Promise<void> {
  const filePath = path.join(workspaceRoot, OPENCODE_CONFIG_FILE);
  if (!existsSync(filePath)) {
    return;
  }
  const { value } = await readJsonObject(filePath);
  if (isRecord(value.permission) && isRecord(value.permission.skill)) {
    delete value.permission.skill[OPENCODE_SKILL_PERMISSION];
    if (Object.keys(value.permission.skill).length === 0) {
      delete value.permission.skill;
    }
    if (Object.keys(value.permission).length === 0) {
      delete value.permission;
    }
  }
  await writeJsonObject(filePath, value);
}

/**
 * Without --tools, keep the coding tools the project already has guidance
 * for; a project without any gets all of them.
 */
async function existingGuidanceTools(workspaceRoot: string): Promise<AiTool[]> {
  try {
    const installed = await installedGuidanceTools(
      workspaceRoot,
      await resolveProjectGuidance(workspaceRoot),
    );
    return installed.length > 0 ? installed : [...SUPPORTED_AI_TOOLS];
  } catch {
    return [...SUPPORTED_AI_TOOLS];
  }
}

async function syncInstructions(
  workspaceRoot: string,
  tools: AiTool[],
): Promise<AdapterGuidanceResult> {
  try {
    const source = await resolveProjectGuidance(workspaceRoot);
    const result = await syncAgentGuidance({
      projectRoot: workspaceRoot,
      source,
      tools,
    });
    return {
      status: 'synced',
      version: result.version,
      origin: result.origin,
      changed: result.changed,
      skipped: result.skipped.map((entry) => entry.path),
    };
  } catch (error) {
    if (error instanceof GuidanceSourceError) {
      return {
        status: 'unavailable',
        code: error.code,
        message: error.message,
      };
    }
    throw error;
  }
}

export type AdapterGuidanceResult =
  | {
      status: 'synced';
      version: string;
      origin: string;
      changed: boolean;
      skipped: string[];
    }
  | { status: 'unavailable'; code: string; message: string };

export async function syncAgentAdapters({
  workspaceRoot,
  tools,
  command,
  args,
}: SyncAgentAdaptersOptions): Promise<{
  workspaceRoot: string;
  tools: AiTool[];
  serverNames: string[];
  guidance: AdapterGuidanceResult;
}> {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const appliedTools = tools ?? [...SUPPORTED_AI_TOOLS];
  // Decide which tools get guidance before the MCP files below exist.
  const guidanceTools =
    tools ?? (await existingGuidanceTools(normalizedWorkspaceRoot));
  const result = await syncMcpAdapters({
    workspaceRoot: normalizedWorkspaceRoot,
    tools: appliedTools,
    command,
    args,
  });
  await Promise.all([
    ...(appliedTools.includes('claude')
      ? [syncClaudeSettings(normalizedWorkspaceRoot, result.serverNames)]
      : []),
    ...(appliedTools.includes('cursor')
      ? [syncCursorPermissions(normalizedWorkspaceRoot, result.serverNames)]
      : []),
    ...(appliedTools.includes('opencode')
      ? [syncOpenCodeSkillPermissions(normalizedWorkspaceRoot)]
      : []),
  ]);
  // After the settings writes above: guidance also edits .claude/settings.json.
  const guidance = await syncInstructions(
    normalizedWorkspaceRoot,
    guidanceTools,
  );
  return { ...result, guidance };
}

export async function pruneAgentAdapters({
  workspaceRoot,
  tools,
}: {
  workspaceRoot: string;
  tools?: AiTool[];
}): Promise<void> {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const appliedTools = tools ?? [...SUPPORTED_AI_TOOLS];
  await pruneMcpAdapters({
    workspaceRoot: normalizedWorkspaceRoot,
    tools: appliedTools,
  });
  await Promise.all([
    ...(appliedTools.includes('claude')
      ? [pruneClaudeSettings(normalizedWorkspaceRoot)]
      : []),
    ...(appliedTools.includes('cursor')
      ? [pruneCursorPermissions(normalizedWorkspaceRoot)]
      : []),
    ...(appliedTools.includes('opencode')
      ? [pruneOpenCodeSkillPermissions(normalizedWorkspaceRoot)]
      : []),
  ]);
}

function instructionFileForTool(
  workspaceRoot: string,
  tool: AiTool,
): string | null {
  if (tool === 'claude') {
    for (const candidate of [CLAUDE_FILE, `.claude/${CLAUDE_FILE}`]) {
      if (existsSync(path.join(workspaceRoot, candidate))) {
        return candidate;
      }
    }
    return null;
  }
  return existsSync(path.join(workspaceRoot, AGENTS_FILE)) ? AGENTS_FILE : null;
}

async function hasClaudePermissions(
  workspaceRoot: string,
  serverNames: string[],
): Promise<boolean> {
  const filePath = path.join(workspaceRoot, CLAUDE_SETTINGS_FILE);
  if (!existsSync(filePath)) {
    return false;
  }
  const { value } = await readJsonObject(filePath);
  const allow = isRecord(value.permissions) ? value.permissions.allow : null;
  const enabled = value.enabledMcpjsonServers;
  return (
    Array.isArray(allow) &&
    serverNames.every((name) =>
      allow.includes(managedClaudePermission(name)),
    ) &&
    Array.isArray(enabled) &&
    serverNames.every((name) => enabled.includes(name))
  );
}

async function hasCursorPermissions(
  workspaceRoot: string,
  serverNames: string[],
): Promise<boolean> {
  const filePath = path.join(workspaceRoot, CURSOR_PERMISSIONS_FILE);
  if (!existsSync(filePath)) {
    return false;
  }
  const { value } = await readJsonObject(filePath);
  return (
    isRecord(value.autoRun) &&
    Array.isArray(value.autoRun.allow_instructions) &&
    value.autoRun.allow_instructions.includes(
      cursorAllowInstruction(serverNames),
    )
  );
}

async function hasCodexPermissions(
  workspaceRoot: string,
  serverNames: string[],
): Promise<boolean> {
  const filePath = path.join(workspaceRoot, '.codex/config.toml');
  if (!existsSync(filePath)) {
    return false;
  }
  const content = await readFile(filePath, 'utf8');
  return serverNames.every((name) => {
    const start = content.indexOf(`[mcp_servers.${name}]`);
    if (start < 0) {
      return false;
    }
    const next = content.indexOf('[mcp_servers.', start + 1);
    const section = content.slice(start, next < 0 ? undefined : next);
    return section.includes('default_tools_approval_mode = "approve"');
  });
}

async function hasOpenCodePermissions(
  workspaceRoot: string,
  serverNames: string[],
): Promise<boolean> {
  const filePath = path.join(workspaceRoot, 'opencode.json');
  if (!existsSync(filePath)) {
    return false;
  }
  const { value } = await readJsonObject(filePath);
  const permission = value.permission;
  return (
    isRecord(permission) &&
    serverNames.every((name) => permission[`${name}_*`] === 'allow') &&
    isRecord(permission.skill) &&
    permission.skill[OPENCODE_SKILL_PERMISSION] === 'allow'
  );
}

export async function getAdapterSupportStatus(
  workspaceRoot: string,
  tool: AiTool,
  serverNames: string[],
): Promise<AdapterSupportStatus> {
  const instructionFile = instructionFileForTool(workspaceRoot, tool);
  if (tool === 'copilot') {
    return {
      instruction: {
        file: instructionFile ?? AGENTS_FILE,
        status: instructionFile == null ? 'missing' : 'configured',
      },
      permissions: {
        file: null,
        status: 'manual',
        note: 'VS Code stores MCP tool approvals interactively; approve the IWSDK server once for the workspace.',
      },
    };
  }

  const permissionFile =
    tool === 'claude'
      ? CLAUDE_SETTINGS_FILE
      : tool === 'cursor'
        ? CURSOR_PERMISSIONS_FILE
        : tool === 'codex'
          ? '.codex/config.toml'
          : 'opencode.json';
  const configured =
    tool === 'claude'
      ? await hasClaudePermissions(workspaceRoot, serverNames)
      : tool === 'cursor'
        ? await hasCursorPermissions(workspaceRoot, serverNames)
        : tool === 'codex'
          ? await hasCodexPermissions(workspaceRoot, serverNames)
          : await hasOpenCodePermissions(workspaceRoot, serverNames);
  return {
    instruction: {
      file: instructionFile ?? (tool === 'claude' ? CLAUDE_FILE : AGENTS_FILE),
      status: instructionFile == null ? 'missing' : 'configured',
    },
    permissions: {
      file: permissionFile,
      status: configured ? 'configured' : 'missing',
    },
  };
}

export function buildGenericAdapterPrompt(workspaceRoot: string): string {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const registry = getManagedMcpServerRegistry({
    workspaceRoot: normalizedWorkspaceRoot,
  });
  const servers = Object.entries(registry.entries)
    .map(
      ([name, entry]) =>
        `- ${name}: command ${JSON.stringify(entry.command)}, args ${JSON.stringify(entry.args)}`,
    )
    .join('\n');
  const namespaces = Object.keys(registry.entries)
    .map((name) => `${name}/*`)
    .join(', ');
  return `Configure this repository for the coding-agent harness you are currently running in.

Repository: ${normalizedWorkspaceRoot}

1. Treat AGENTS.md as the canonical project instructions. If this harness does not read AGENTS.md natively, configure its repository instruction file to load or import AGENTS.md without duplicating the content.
2. Discover the Agent Skills Open Standard definitions under .agents/skills/. If this harness requires another project skill directory, link or configure that directory to the canonical tree instead of copying and editing the skill contents.
3. Preserve the nested AGENTS.md scopes under src/, public/scenes/, and public/ui/. If this harness has a native path-rule format, translate those scopes without changing their instructions.
4. Preserve all unrelated user-owned configuration and register these local stdio MCP servers in this harness's repository-scoped configuration:
${servers}
5. Enable and preapprove only the tools from these managed MCP namespaces: ${namespaces}. Preapprove loading iwsdk-* skills when the harness has a separate skill permission. Do not disable approvals or sandboxing for unrelated tools.
6. If this harness cannot persist repository-scoped MCP permissions, explain the one-time manual approval the user must perform instead of inventing an unsupported config file.
7. Verify that project instructions and skills load, every configured MCP server starts, and its tools are visible. Do not start or modify the IWSDK application itself as part of adapter setup.`;
}
