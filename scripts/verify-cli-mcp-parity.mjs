#!/usr/bin/env node --no-warnings
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Live CLI vs MCP parity harness for the runtime-first surface.
 *
 * Usage:
 *   node scripts/verify-cli-mcp-parity.mjs
 *   node scripts/verify-cli-mcp-parity.mjs --skip-build-tgz
 *   node scripts/verify-cli-mcp-parity.mjs --keep-temp
 *
 * The harness:
 *   - builds fresh local .tgz packages unless explicitly skipped
 *   - creates two temporary copies of examples/poke
 *   - installs dependencies and starts both apps through headless `iwsdk dev up`
 *   - compares representative CLI vs `iwsdk mcp stdio` interface seams
 *   - verifies tool discovery, object/array/screenshot payloads, structured errors,
 *     and MCP tab metadata / tab-change behavior
 *   - normalizes tab ids, Vite hashes, timestamps, and other per-instance noise
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runBrowserWarmup } from './browser-warmup-utils.mjs';
import {
  assertPngScreenshotParity,
  summarizePngScreenshot,
} from './screenshot-parity-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE_EXAMPLE = path.join(ROOT, 'examples', 'poke');
const SOURCE_EXAMPLE_ASSETS = path.join(
  ROOT,
  'packages',
  'example-assets',
  'assets',
);
const CLI_PATH = path.join(ROOT, 'packages', 'cli', 'dist', 'cli.js');
const cliPackageRequire = createRequire(
  path.join(ROOT, 'packages', 'cli', 'package.json'),
);
const EXCLUDE_NAMES = new Set([
  'node_modules',
  'package-lock.json',
  'dist',
  '.mcp.json',
  '.cursor',
  '.vscode',
  '.codex',
]);
const DEFAULT_INSTALL_RETRIES = 2;
const DEFAULT_DEV_TIMEOUT_MS = 120000;
const NUMBER_TOLERANCE = 2e-2;
const TAB_CHANGE_WARNING = 'WARNING: Active browser tab changed';
const HARNESS_RUNTIME_ENV = {
  IWSDK_RUNTIME_TRACE: '1',
};
const NODE_BINARY = 'node';

let normalizationWorkspaceRoots = [];
let runtimeContract = null;
let runtimeTransport = null;
const reservedParityPorts = new Set();

async function loadRuntimeContract() {
  if (runtimeContract) {
    return runtimeContract;
  }

  runtimeContract = await import('@iwsdk/cli/contract');
  return runtimeContract;
}

function getRuntimeContract() {
  assert(
    runtimeContract,
    'Runtime contract must be loaded after building @iwsdk/cli',
  );
  return runtimeContract;
}

async function loadRuntimeTransport() {
  if (runtimeTransport) {
    return runtimeTransport;
  }

  runtimeTransport = await import(
    pathToFileURL(path.join(ROOT, 'packages', 'cli', 'dist', 'index.js')).href
  );
  return runtimeTransport;
}

function parseArgs(argv) {
  const allowedFlags = new Set(['--help', '--keep-temp', '--skip-build-tgz']);
  for (const token of argv) {
    if (!allowedFlags.has(token)) {
      throw new Error(`Unknown option: ${token}`);
    }
  }

  if (argv.includes('--help')) {
    console.log(`Usage: node scripts/verify-cli-mcp-parity.mjs [--skip-build-tgz] [--keep-temp]

Options:
  --skip-build-tgz   Reuse existing package tarballs instead of rebuilding them
  --keep-temp        Preserve temporary example copies for debugging`);
    process.exit(0);
  }

  return {
    keepTemp: argv.includes('--keep-temp'),
    skipBuildTgz: argv.includes('--skip-build-tgz'),
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

function sanitizeString(value) {
  let result = String(value);
  for (const workspaceRoot of normalizationWorkspaceRoots) {
    result = result.replaceAll(workspaceRoot, '<workspace>');
  }
  return result
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,
      '<timestamp>',
    )
    .replace(/(?:https?|wss?):\/\/localhost:\d+\/?/g, '<local-url>')
    .replace(
      /(?:https?|wss?):\/\/(?:\d{1,3}\.){3}\d{1,3}:\d+\/?/g,
      '<network-url>',
    )
    .replace(/\[\.WebGL-0x[0-9a-f]+\]/gi, '[.WebGL-<context>]')
    .replace(/\?v=[a-z0-9]+/gi, '?v=<hash>')
    .replace(/tab-[a-z0-9-]+/gi, '<tab-id>');
}

function normalizeValue(value, toolName) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry, toolName));
  }
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '_tab') continue;
      if (key === 'sceneSessionId') continue;
      // CLI and MCP run in separate workspaces with distinct owner/attempt IDs.
      // Their readiness and lifecycle state still participate in comparison.
      if (key === 'sessionId' || key === 'attemptId') continue;
      if (key === 'frameTimeSamplesMs') continue;
      if (key === 'durationMs') continue;
      if (key === 'profileId') continue;
      if (key === 'ref') continue;
      if (key === 'snapshotId') continue;
      if (key.toLowerCase() === 'uuid') continue;
      if (key.toLowerCase().endsWith('uuid')) continue;
      if (toolName === 'browser_get_console_logs' && key === 'timestamp') {
        continue;
      }
      if (
        toolName.startsWith('ecs_') &&
        key !== 'framesAdvanced' &&
        key.toLowerCase().includes('frame')
      ) {
        continue;
      }
      if (toolName.startsWith('ecs_') && key.toLowerCase().includes('time')) {
        continue;
      }
      normalized[key] = normalizeValue(entry, toolName);
    }
    return normalized;
  }
  return value;
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= NUMBER_TOLERANCE;
}

function tolerantEqual(left, right) {
  if (typeof left === 'number' && typeof right === 'number') {
    return nearlyEqual(left, right);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => tolerantEqual(entry, right[index]))
    );
  }
  if (left && typeof left === 'object' && right && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      isDeepStrictEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => tolerantEqual(left[key], right[key]))
    );
  }
  return isDeepStrictEqual(left, right);
}

async function runCommand(
  command,
  args,
  { cwd = ROOT, env = {}, captureOutput = false, allowFailure = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    let stdout = '';
    let stderr = '';

    if (captureOutput) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', reject);
    child.on('close', (exitCode) => {
      const result = {
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      };
      if (result.exitCode !== 0 && !allowFailure) {
        const details = stderr || stdout;
        reject(
          new Error(
            `${command} ${args.join(' ')} failed with exit ${result.exitCode}${
              details ? `\n${details}` : ''
            }`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

async function runCliJson(args, cwd = ROOT, options = {}) {
  const { stdout, stderr } = await runCommand(
    NODE_BINARY,
    [CLI_PATH, ...args],
    {
      captureOutput: true,
      cwd,
      env: {
        ...(options.trace ? HARNESS_RUNTIME_ENV : {}),
        ...(options.env ?? {}),
      },
    },
  );

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Failed to parse CLI JSON for "${args.join(' ')}": ${
        stderr || stdout || String(error)
      }`,
    );
  }

  if (!parsed.ok) {
    throw new Error(
      `CLI ${args.join(' ')} failed: ${JSON.stringify(parsed.error)}`,
    );
  }

  return parsed.data;
}

function parseJsonOrThrow(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON for ${label}: ${
        text || (error instanceof Error ? error.message : String(error))
      }`,
    );
  }
}

async function callCliToolOutcome(
  workspaceRoot,
  toolName,
  inputJson = {},
  options = {},
) {
  const { getRuntimeOperationByToolName } = getRuntimeContract();
  const operation = getRuntimeOperationByToolName(toolName);
  assert(operation, `No CLI mapping found for ${toolName}`);

  const args = [operation.domain, operation.action, '--raw'];
  if (Object.keys(inputJson).length > 0) {
    args.push('--input-json', JSON.stringify(inputJson));
  }

  const { exitCode, stdout, stderr } = await runCommand(
    NODE_BINARY,
    [CLI_PATH, ...args],
    {
      captureOutput: true,
      cwd: workspaceRoot,
      allowFailure: true,
      env: options.trace ? HARNESS_RUNTIME_ENV : {},
    },
  );
  const output = exitCode === 0 ? stdout : stderr || stdout;
  const parsed = parseJsonOrThrow(output, `CLI ${toolName}`);

  if (exitCode !== 0) {
    const errorPayload =
      isRecord(parsed) && isRecord(parsed.error) ? parsed.error : parsed;
    return {
      ok: false,
      error: errorPayload,
      raw: parsed,
    };
  }

  if (
    toolName === 'browser_screenshot' &&
    isRecord(parsed) &&
    typeof parsed.imageData === 'string'
  ) {
    const image = Buffer.from(parsed.imageData, 'base64');
    return {
      ok: true,
      result: summarizePngScreenshot(
        image,
        parsed.mimeType,
        'CLI browser_screenshot',
      ),
      raw: parsed,
    };
  }

  return {
    ok: true,
    result: parsed,
    raw: parsed,
  };
}

async function readWorkspaceRuntimeSession(workspaceRoot) {
  const { IWSDK_RUNTIME_SESSION_PATH } = getRuntimeContract();
  const sessionPath = path.join(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH);
  try {
    return parseJsonOrThrow(
      await readFile(sessionPath, 'utf8'),
      `runtime session ${sessionPath}`,
    );
  } catch {
    return null;
  }
}

async function waitForBrowserCommandReady(
  workspaceRoot,
  label,
  timeoutMs = DEFAULT_DEV_TIMEOUT_MS,
) {
  const { INTERNAL_BROWSER_PROBE_METHOD } = getRuntimeContract();
  const { sendRuntimeCommand } = await loadRuntimeTransport();
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const session = await readWorkspaceRuntimeSession(workspaceRoot);
      if (!session) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const remainingMs = Math.max(deadline - Date.now(), 1);
      const response = await sendRuntimeCommand({
        port: session.port,
        method: INTERNAL_BROWSER_PROBE_METHOD,
        timeoutMs: Math.min(remainingMs, 3000),
        runtimeSession: session,
      });
      if (isRecord(response.result) && response.result.commandReady === true) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(
    `[${label}] browser command path did not become ready within ${timeoutMs}ms${
      message ? ` (${message})` : ''
    }`,
  );
}

function tryParseJsonTextBlock(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isTabMetadataBlock(value) {
  return (
    isRecord(value) && Object.keys(value).length === 1 && isRecord(value._tab)
  );
}

function parseMcpToolContent(content) {
  const warnings = [];
  const jsonBlocks = [];

  for (const entry of content) {
    if (entry.type !== 'text') {
      continue;
    }
    const parsed = tryParseJsonTextBlock(entry.text);
    if (parsed === null) {
      warnings.push(entry.text);
    } else {
      jsonBlocks.push(parsed);
    }
  }

  const primaryJson = jsonBlocks.find((block) => !isTabMetadataBlock(block));
  const tabMetadata = jsonBlocks.find((block) => isTabMetadataBlock(block));
  const inlineTabMetadata =
    isRecord(primaryJson) && isRecord(primaryJson._tab)
      ? primaryJson._tab
      : null;

  return {
    result: primaryJson,
    tab:
      inlineTabMetadata ??
      (isTabMetadataBlock(tabMetadata) ? tabMetadata._tab : null),
    warnings,
  };
}

async function callMcpToolOutcome(client, toolName, args) {
  const response = await client.callTool({ name: toolName, arguments: args });
  const parsed = parseMcpToolContent(response.content);

  const imageBlock = response.content.find((entry) => entry.type === 'image');
  if (toolName === 'browser_screenshot' && imageBlock?.type === 'image') {
    const image = Buffer.from(imageBlock.data, 'base64');
    return {
      ok: !response.isError,
      result: summarizePngScreenshot(
        image,
        imageBlock.mimeType,
        'MCP browser_screenshot',
      ),
      warnings: parsed.warnings,
      tab: parsed.tab,
      raw: response,
    };
  }

  const payload = parsed.result ?? {
    message: `No JSON payload returned for ${toolName}`,
  };

  if (response.isError) {
    return {
      ok: false,
      error: payload,
      warnings: parsed.warnings,
      tab: parsed.tab,
      raw: response,
    };
  }

  if (
    toolName === 'browser_screenshot' &&
    isRecord(payload) &&
    typeof payload.screenshotPath === 'string'
  ) {
    const image = await readFile(payload.screenshotPath);
    await rm(payload.screenshotPath, { force: true });
    return {
      ok: true,
      result: summarizePngScreenshot(
        image,
        payload.mimeType,
        'MCP browser_screenshot',
      ),
      warnings: parsed.warnings,
      tab: parsed.tab,
      raw: response,
    };
  }

  return {
    ok: true,
    result: payload,
    warnings: parsed.warnings,
    tab: parsed.tab,
    raw: response,
  };
}

function normalizeCliError(error) {
  const details = isRecord(error?.details) ? error.details : {};
  return {
    message: error?.message ?? String(error),
    cause: details.cause,
    browser: details.browser ?? null,
  };
}

function normalizeMcpError(error) {
  return {
    message: error?.message ?? String(error),
    cause: error?.cause,
    browser: error?.browser ?? null,
  };
}

const RECOVERABLE_BROWSER_CAUSES = new Set([
  'connection_lost',
  'browser_not_ready',
  'browser_relaunched',
]);

function assertImageSmoke(label, cliValue, mcpValue) {
  assertPngScreenshotParity(label, cliValue, mcpValue);
}

function assertEquivalent(label, toolName, cliValue, mcpValue) {
  if (toolName === 'browser_screenshot') {
    assertImageSmoke(label, cliValue, mcpValue);
    return;
  }

  const cliNormalized = stable(normalizeValue(cliValue, toolName));
  const mcpNormalized = stable(normalizeValue(mcpValue, toolName));

  if (!tolerantEqual(cliNormalized, mcpNormalized)) {
    console.log(`FAIL ${label}`);
    console.log(
      JSON.stringify(
        {
          label,
          toolName,
          cliNormalized,
          mcpNormalized,
          cliValue,
          mcpValue,
        },
        null,
        2,
      ),
    );
    throw new Error(`Parity mismatch for ${label}`);
  }
}

function rewriteFileDependencies(dependencies) {
  if (!dependencies) {
    return;
  }

  for (const [name, specifier] of Object.entries(dependencies)) {
    if (typeof specifier !== 'string' || !specifier.startsWith('file:')) {
      continue;
    }
    dependencies[name] = `file:${path.resolve(
      SOURCE_EXAMPLE,
      specifier.slice('file:'.length),
    )}`;
  }
}

async function prepareExampleClone(targetRoot, packageName) {
  await cp(SOURCE_EXAMPLE, targetRoot, {
    recursive: true,
    filter(source) {
      return !EXCLUDE_NAMES.has(path.basename(source));
    },
  });
  await cp(
    SOURCE_EXAMPLE_ASSETS,
    path.join(targetRoot, 'public', 'iwsdk-example-assets'),
    { recursive: true },
  );

  const packageJsonPath = path.join(targetRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  packageJson.name = packageName;
  // Keep temporary parity runtimes isolated from existing Vite dev servers.
  packageJson.scripts['dev:runtime'] =
    `vite --port ${await reserveAvailablePort()} --strictPort`;
  rewriteFileDependencies(packageJson.dependencies);
  rewriteFileDependencies(packageJson.devDependencies);
  await writeFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf8',
  );
}

async function reserveAvailablePort() {
  while (true) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address == null || typeof address === 'string') {
          server.close();
          reject(new Error('Failed to reserve a parity dev-server port'));
          return;
        }
        server.close((error) =>
          error == null ? resolve(address.port) : reject(error),
        );
      });
    });
    if (!reservedParityPorts.has(port)) {
      reservedParityPorts.add(port);
      return port;
    }
  }
}

async function installWorkspace(workspaceRoot, label) {
  for (let attempt = 1; attempt <= DEFAULT_INSTALL_RETRIES; attempt++) {
    console.log(
      `[${label}] npm install (attempt ${attempt}/${DEFAULT_INSTALL_RETRIES})`,
    );
    try {
      await runCommand('npm', ['install'], { cwd: workspaceRoot });
      return;
    } catch (error) {
      if (attempt === DEFAULT_INSTALL_RETRIES) {
        throw error;
      }
      console.log(`[${label}] install failed, retrying once...`);
    }
  }
}

async function ensureRuntimeStarted(workspaceRoot, label) {
  console.log(`[${label}] starting dev server`);
  const data = await runCliJson(
    ['dev', 'up', '--headless', '--timeout', String(DEFAULT_DEV_TIMEOUT_MS)],
    workspaceRoot,
    {
      trace: true,
      env: {
        VITE_IWSDK_EXAMPLE_ASSET_BASE_URL: '/iwsdk-example-assets',
      },
    },
  );
  console.log(`[${label}] dev server ${data.action}`);
  console.log(`[${label}] runtime log: ${data.logPath ?? 'n/a'}`);
  return data;
}

async function ensureRuntimeStopped(workspaceRoot, label) {
  console.log(`[${label}] stopping dev server`);
  const result = await runCliJson(['dev', 'down'], workspaceRoot);
  console.log(`[${label}] dev server stopped=${Boolean(result.stopped)}`);
  return result;
}

async function waitFor(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function warmBrowser(workspaceRoot, label) {
  console.log(`[${label}] warming managed browser`);
  await waitForBrowserCommandReady(workspaceRoot, label);
  await runBrowserWarmup({
    runAttempt: async () => {
      const outcome = await callCliToolOutcome(
        workspaceRoot,
        'browser_screenshot',
        {},
        { trace: true },
      );
      if (outcome.ok && outcome.result?.status !== 'browser_relaunched') {
        return { kind: 'success' };
      }
      if (outcome.ok && outcome.result?.status === 'browser_relaunched') {
        return { kind: 'relaunched' };
      }
      const normalized = normalizeCliError(outcome.error);
      return {
        kind: 'failure',
        error: new Error(JSON.stringify(outcome.error)),
        cause: normalized.cause,
        message: normalized.message,
      };
    },
    waitForCommandReady: () => waitForBrowserCommandReady(workspaceRoot, label),
    onRelaunched: async () => {
      console.log(
        `[${label}] browser relaunched, waiting for fresh command readiness`,
      );
    },
    onRetryableFailure: async (failureCount, attempt) => {
      console.log(
        `[${label}] screenshot warm-up failed (${attempt.message}), retrying (${failureCount}/3)`,
      );
    },
  });
}

async function recoverCliOutcome(
  workspaceRoot,
  label,
  toolName,
  args,
  outcome,
) {
  if (outcome.ok) {
    return outcome;
  }
  const normalized = normalizeCliError(outcome.error);
  if (!RECOVERABLE_BROWSER_CAUSES.has(normalized.cause)) {
    return outcome;
  }

  console.log(
    `[${label}] ${toolName} hit ${normalized.cause}; rewarming runtime and retrying once`,
  );
  await warmBrowser(workspaceRoot, label);
  return callCliToolOutcome(workspaceRoot, toolName, args);
}

async function recoverMcpOutcome(
  workspaceRoot,
  client,
  label,
  toolName,
  args,
  outcome,
) {
  if (outcome.ok) {
    return outcome;
  }
  const normalized = normalizeMcpError(outcome.error);
  if (!RECOVERABLE_BROWSER_CAUSES.has(normalized.cause)) {
    return outcome;
  }

  console.log(
    `[${label}] ${toolName} hit ${normalized.cause}; rewarming runtime and retrying once`,
  );
  await warmBrowser(workspaceRoot, label);
  return callMcpToolOutcome(client, toolName, args);
}

const SMOKE_STEPS = [
  {
    name: 'xr_get_session_status',
    args: () => ({}),
    expectTabMetadata: true,
    after({ mcpOutcome, context }) {
      context.initialTabId = mcpOutcome.tab?.id ?? null;
      assert(
        context.initialTabId,
        'Initial MCP status should include tab metadata',
      );
    },
  },
  { name: 'xr_accept_session', args: () => ({}) },
  {
    name: 'ecs_list_systems',
    args: () => ({}),
    expectTabMetadata: true,
  },
  {
    name: 'browser_get_console_logs',
    args: () => ({ count: 10, level: ['warn', 'error'] }),
    expectTabMetadata: true,
  },
  // Hand steps go after the console logs: the time they take changes how
  // the two runtimes group repeated warnings.
  { name: 'xr_set_input_mode', args: () => ({ mode: 'hand' }) },
  {
    name: 'xr_list_targets',
    args: () => ({}),
    expectTabMetadata: true,
    after({ cliOutcome }) {
      const names = cliOutcome.result.targets.map((target) => target.name);
      assert(
        cliOutcome.result.resolver && names.includes('counter-button'),
        `IWSDK should resolve the poke panel's counter-button: ${names}`,
      );
    },
  },
  {
    name: 'xr_run_sequence',
    args: () => ({
      device: 'hand-right',
      dryRun: true,
      steps: [{ label: 'press', target: 'counter-button', press: {} }],
    }),
  },
  { name: 'xr_get_hand_state', args: () => ({ device: 'hand-right' }) },
  {
    name: 'xr_run_sequence',
    args: () => ({ device: 'hand-right', steps: [{ pose: 'point' }] }),
    expectError: true,
  },
  { name: 'xr_set_input_mode', args: () => ({ mode: 'controller' }) },
  {
    name: 'browser_snapshot',
    args: () => ({ maxNodes: 20, maxTextLength: 80 }),
    expectTabMetadata: true,
  },
  {
    name: 'browser_interact',
    args: () => ({ steps: [{ action: 'wait', path: '/' }] }),
    expectTabMetadata: true,
  },
  {
    name: 'browser_profile',
    args: () => ({
      action: 'start',
      maxDurationMs: 30_000,
      mode: 'interaction',
    }),
    expectTabMetadata: true,
  },
  {
    name: 'scene_get_state',
    args: () => ({}),
    expectTabMetadata: true,
  },
  {
    name: 'browser_set_muted',
    args: () => ({ muted: true }),
    expectTabMetadata: true,
  },
  {
    name: 'browser_set_muted',
    args: () => ({ muted: false }),
    expectTabMetadata: true,
  },
  { name: 'browser_screenshot', args: () => ({}) },
  { name: 'browser_reload_page', args: () => ({}) },
];

function assertSmokeCoverage() {
  assert.equal(
    sanitizeString('[.WebGL-0x1140043f000] GPU stall'),
    '[.WebGL-<context>] GPU stall',
    'GPU context ids must not make parity results nondeterministic',
  );
  const { RUNTIME_MCP_TOOLS, getRuntimeOperationByToolName } =
    getRuntimeContract();
  const expectedNames = new Set(RUNTIME_MCP_TOOLS.map((tool) => tool.name));

  for (const step of SMOKE_STEPS) {
    assert(
      expectedNames.has(step.name),
      `Unknown runtime MCP tool in smoke step ${step.name}`,
    );
    assert(
      getRuntimeOperationByToolName(step.name),
      `Missing CLI mapping for smoke step ${step.name}`,
    );
  }
}

async function loadMcpSdk() {
  const { Client } = cliPackageRequire(
    '@modelcontextprotocol/sdk/client/index.js',
  );
  const { StdioClientTransport } = cliPackageRequire(
    '@modelcontextprotocol/sdk/client/stdio.js',
  );
  return { Client, StdioClientTransport };
}

async function waitForOfferedState(
  cliWorkspace,
  client,
  label = 'both runtimes to return to an offered non-immersive state',
) {
  await waitFor(async () => {
    const cliStatus = await callCliToolOutcome(
      cliWorkspace,
      'xr_get_session_status',
    );
    const mcpStatus = await callMcpToolOutcome(
      client,
      'xr_get_session_status',
      {},
    );
    return (
      cliStatus.ok &&
      mcpStatus.ok &&
      cliStatus.result.sessionOffered === true &&
      cliStatus.result.sessionActive === false &&
      mcpStatus.result.sessionOffered === true &&
      mcpStatus.result.sessionActive === false
    );
  }, label);
}

async function resetRuntimeBaseline(cliWorkspace, client) {
  const cliReload = await callCliToolOutcome(
    cliWorkspace,
    'browser_reload_page',
  );
  const mcpReload = await callMcpToolOutcome(client, 'browser_reload_page', {});
  assert(
    cliReload.ok,
    `CLI browser_reload_page failed during baseline reset: ${JSON.stringify(cliReload.error)}`,
  );
  assert(
    mcpReload.ok,
    `MCP browser_reload_page failed during baseline reset: ${JSON.stringify(mcpReload.error)}`,
  );
  await waitForOfferedState(cliWorkspace, client);
}

async function runParitySweep(cliWorkspace, mcpWorkspace) {
  const { RUNTIME_MCP_TOOLS } = getRuntimeContract();
  const { Client, StdioClientTransport } = await loadMcpSdk();
  const transport = new StdioClientTransport({
    command: NODE_BINARY,
    args: [CLI_PATH, 'mcp', 'stdio'],
    cwd: mcpWorkspace,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => process.stderr.write(chunk));

  const client = new Client({ name: 'cli-mcp-parity', version: '1.0.0' });

  await client.connect(transport);

  try {
    const listedTools = await client.listTools();
    const expectedToolNames = [
      ...RUNTIME_MCP_TOOLS.map((tool) => tool.name),
    ].sort();
    const actualToolNames = [
      ...listedTools.tools.map((tool) => tool.name),
    ].sort();
    assert.deepEqual(
      actualToolNames,
      expectedToolNames,
      'MCP stdio tool list does not match the shared runtime contract',
    );

    await resetRuntimeBaseline(cliWorkspace, client);

    const context = {};

    for (const step of SMOKE_STEPS) {
      const cliArgs = step.args(context);
      const mcpArgs = step.args(context);
      let cliOutcome = await callCliToolOutcome(
        cliWorkspace,
        step.name,
        cliArgs,
      );
      cliOutcome = await recoverCliOutcome(
        cliWorkspace,
        'cli',
        step.name,
        cliArgs,
        cliOutcome,
      );
      let mcpOutcome = await callMcpToolOutcome(client, step.name, mcpArgs);
      mcpOutcome = await recoverMcpOutcome(
        mcpWorkspace,
        client,
        'mcp',
        step.name,
        mcpArgs,
        mcpOutcome,
      );

      if (step.expectError) {
        assert(
          !cliOutcome.ok,
          `CLI ${step.name} should fail for smoke coverage`,
        );
        assert(
          !mcpOutcome.ok,
          `MCP ${step.name} should fail for smoke coverage`,
        );
        assertEquivalent(
          `${step.name} (error)`,
          step.name,
          normalizeCliError(cliOutcome.error),
          normalizeMcpError(mcpOutcome.error),
        );
      } else {
        assert(
          cliOutcome.ok,
          `CLI ${step.name} failed: ${JSON.stringify(cliOutcome.error)}`,
        );
        assert(
          mcpOutcome.ok,
          `MCP ${step.name} failed: ${JSON.stringify(mcpOutcome.error)}`,
        );
        assertEquivalent(
          step.name,
          step.name,
          cliOutcome.result,
          mcpOutcome.result,
        );
      }

      if (step.expectTabMetadata) {
        assert(
          mcpOutcome.tab?.id,
          `MCP ${step.name} should include _tab metadata`,
        );
      }

      console.log(`PASS ${step.name}`);

      if (step.after) {
        await step.after({
          cliOutcome,
          mcpOutcome,
          context,
        });
      }

      if (step.name === 'browser_reload_page') {
        await waitForOfferedState(
          cliWorkspace,
          client,
          'final browser reload to settle',
        );
        const postReloadStatus = await callMcpToolOutcome(
          client,
          'xr_get_session_status',
          {},
        );
        assert(
          postReloadStatus.ok,
          `MCP xr_get_session_status failed after reload: ${JSON.stringify(postReloadStatus.error)}`,
        );
        assert(
          postReloadStatus.tab?.id,
          'MCP xr_get_session_status should include _tab metadata after reload',
        );
        context.reloadedTabId = postReloadStatus.tab.id;

        const tabChanged = context.reloadedTabId !== context.initialTabId;
        const sawWarning =
          mcpOutcome.warnings.some((text) =>
            text.includes(TAB_CHANGE_WARNING),
          ) ||
          postReloadStatus.warnings.some((text) =>
            text.includes(TAB_CHANGE_WARNING),
          );
        const reloadDetail = tabChanged
          ? `tab changed to ${context.reloadedTabId}`
          : sawWarning
            ? `warning observed for ${context.reloadedTabId}`
            : `tab metadata remained ${context.reloadedTabId}`;
        console.log(`PASS browser_reload_page (${reloadDetail})`);
      }
    }
  } finally {
    await transport.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let runError = null;
  const runtimeLogs = [];

  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), 'iwsdk-cli-mcp-parity-'),
  );
  const cliWorkspace = path.join(tempRoot, 'poke-cli');
  const mcpWorkspace = path.join(tempRoot, 'poke-mcp');
  normalizationWorkspaceRoots = [cliWorkspace, mcpWorkspace];

  try {
    if (options.skipBuildTgz) {
      console.log('Skipping pnpm build:tgz');
    } else {
      console.log('Building fresh package tarballs with pnpm build:tgz');
      await runCommand('pnpm', ['build:tgz']);
    }

    console.log('Building internal runtime CLI package');
    await runCommand('pnpm', ['--filter', '@iwsdk/cli', 'build']);
    await loadRuntimeContract();
    await loadRuntimeTransport();
    assertSmokeCoverage();

    console.log(`Preparing temporary poke clones in ${tempRoot}`);
    await prepareExampleClone(cliWorkspace, 'poke-cli-parity');
    await prepareExampleClone(mcpWorkspace, 'poke-mcp-parity');

    await installWorkspace(cliWorkspace, 'cli');
    await installWorkspace(mcpWorkspace, 'mcp');

    const cliRuntime = await ensureRuntimeStarted(cliWorkspace, 'cli');
    runtimeLogs.push({
      label: 'cli',
      workspaceRoot: cliWorkspace,
      logPath: cliRuntime.logPath ?? null,
    });
    const mcpRuntime = await ensureRuntimeStarted(mcpWorkspace, 'mcp');
    runtimeLogs.push({
      label: 'mcp',
      workspaceRoot: mcpWorkspace,
      logPath: mcpRuntime.logPath ?? null,
    });

    await warmBrowser(cliWorkspace, 'cli');
    await warmBrowser(mcpWorkspace, 'mcp');

    await runParitySweep(cliWorkspace, mcpWorkspace);
    console.log('ALL_PARITY_CHECKS_PASSED');
  } catch (error) {
    runError = error;
    if (runtimeLogs.length > 0) {
      console.error('Runtime logs retained for diagnostics:');
      for (const entry of runtimeLogs) {
        console.error(
          `  [${entry.label}] workspace=${entry.workspaceRoot} log=${entry.logPath ?? 'n/a'}`,
        );
      }
    }
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const [workspaceRoot, label] of [
      [mcpWorkspace, 'mcp'],
      [cliWorkspace, 'cli'],
    ]) {
      try {
        await ensureRuntimeStopped(workspaceRoot, label);
      } catch (error) {
        const cleanupError =
          error instanceof Error ? error : new Error(String(error));
        cleanupErrors.push(cleanupError);
        console.warn(
          `[${label}] failed to stop cleanly: ${cleanupError.message}`,
        );
      }
    }
    if (options.keepTemp || runError) {
      console.log(`Keeping temporary workspaces at ${tempRoot}`);
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
    if (cleanupErrors.length > 0 && !runError) {
      throw new AggregateError(
        cleanupErrors,
        'Failed to stop parity runtimes cleanly',
      );
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    'Temporary parity workspaces were preserved so the runtime logs and cloned apps can be inspected.',
  );
  process.exit(1);
}
