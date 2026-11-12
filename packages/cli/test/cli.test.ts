/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  INTERNAL_BROWSER_PROBE_METHOD,
  INTERNAL_RUNTIME_SHUTDOWN_METHOD,
  IWSDK_RUNTIME_STATE_SCHEMA_VERSION,
  type RuntimeBrowserState,
} from '@iwsdk/cli/contract';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AiTool } from '../src/runtime-contract.js';
import { getRuntimeFileLockPath } from '../src/runtime-files.js';
import {
  acquireRuntimeOwner,
  inspectRuntimeOwner,
  runtimeOwnerEndpoint,
} from '../src/runtime-owner.js';
import {
  getRuntimeLaunchFilePath,
  getRuntimeSessionFilePath,
} from '../src/runtime-state.js';
import {
  registerRuntimeSession,
  unregisterRuntimeSession,
} from './runtime-session-fixture.js';

const CLI_PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const WORKSPACE_ROOT = path.resolve(CLI_PACKAGE_ROOT, '..', '..');
const CLI_PATH = path.join(CLI_PACKAGE_ROOT, 'dist', 'cli.js');
const CLI_PACKAGE_JSON_PATH = path.join(CLI_PACKAGE_ROOT, 'package.json');
const CLI_RUNTIME_OWNER_URL = new URL(
  '../dist/runtime-owner.js',
  import.meta.url,
).href;

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0ZQAAAAASUVORK5CYII=';
const REFERENCE_TEST_MODEL = {
  source: 'archive',
  format: 'transformers-js',
  archiveSha256: 'model-hash',
  archiveSize: 123,
  dtype: 'q8',
  pooling: 'mean',
  normalize: true,
};

let tempDir: string;
let appA: string;
let appB: string;

async function createAppFixture(
  root: string,
  packageJsonOverrides: Record<string, unknown> = {},
) {
  await mkdir(root, { recursive: true });
  const packageJson = {
    name: 'fixture-app',
    private: true,
    ...packageJsonOverrides,
  };
  packageJson.devDependencies = {
    '@iwsdk/vite-plugin-dev': 'workspace:*',
    ...(packageJsonOverrides.devDependencies as
      | Record<string, unknown>
      | undefined),
  };
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'vite.config.ts'),
    'export default {}\n',
    'utf8',
  );
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'main.ts'), 'export {};\n', 'utf8');
}

async function installReferenceFixture(
  root: string,
  options: {
    statusData?: Record<string, unknown>;
    warmupData?: Record<string, unknown>;
  } = {},
) {
  const normalizedRoot = await realpath(root);
  const entrypoint = path.join(
    root,
    'node_modules',
    '@iwsdk',
    'reference',
    'dist',
    'cli.js',
  );
  await mkdir(path.dirname(entrypoint), { recursive: true });
  const statusData = options.statusData ?? {
    packageVersion: '0.3.1',
    assetsPackage: {
      name: '@iwsdk/reference-assets',
      version: '0.3.1',
    },
    workspaceRoot: normalizedRoot,
    stateRoot: path.join(normalizedRoot, '.iwsdk', 'reference'),
    sharedDataRoot: '/tmp/reference-cache/corpora',
    sharedModelRoot: '/tmp/reference-cache/models',
    initState: 'not_started',
    manifestUrl: null,
    dataDir: null,
    dataSha256: null,
    modelDir: null,
    modelSha256: null,
    modelUrl: null,
    model: null,
    startedAt: null,
    completedAt: null,
    updatedAt: null,
    error: null,
    warmupRequired: true,
  };
  const warmupData = options.warmupData ?? {
    ...statusData,
    initState: 'ready',
    warmupRequired: false,
    dataDir: '/tmp/reference-cache/data',
    dataSha256: 'data-hash',
    modelDir: '/tmp/reference-cache/models/model-hash/model',
    modelSha256: REFERENCE_TEST_MODEL.archiveSha256,
    modelUrl: 'https://cdn.example.test/model.tgz',
    model: REFERENCE_TEST_MODEL,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(
    entrypoint,
    `function readOption(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : true;
}
const args = new Set(process.argv.slice(2));
if (args.has('--status-json')) {
  process.stdout.write(${JSON.stringify(
    `${JSON.stringify({ ok: true, data: statusData })}\n`,
  )});
  process.exit(0);
}
if (args.has('--warmup')) {
  process.stderr.write('warming reference assets\\n');
  process.stdout.write(${JSON.stringify(
    `${JSON.stringify({ ok: true, data: warmupData })}\n`,
  )});
  process.exit(0);
}
if (args.has('--inspect-json')) {
  const tool = readOption('--tool');
  const operations = [
    {
      id: 'search',
      cliName: 'search',
      handlerId: 'searchCode',
      mcpName: 'search_code',
      description: 'Search code',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      requiresSearchService: true,
    },
    {
      id: 'examples',
      cliName: 'examples',
      handlerId: 'findUsageExamples',
      mcpName: 'find_usage_examples',
      description: 'Find usage examples',
      inputSchema: { type: 'object', properties: { api_name: { type: 'string' } }, required: ['api_name'] },
      requiresSearchService: true,
    },
  ];
  const match = tool
    ? operations.find((entry) => entry.cliName === tool || entry.mcpName === tool)
    : null;
  if (tool && !match) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: 'unknown_reference_tool', message: 'Unknown reference tool "' + tool + '"' } }) + '\\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ ok: true, data: match ?? { operations } }) + '\\n');
  process.exit(0);
}
const cliOperation = readOption('--cli-operation');
if (typeof cliOperation === 'string') {
  const inputJson = readOption('--input-json');
  if (cliOperation === 'explode') {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: 'reference_query_failed', message: 'fixture exploded' } }) + '\\n');
    process.exit(1);
  }
  const parsedInput = typeof inputJson === 'string' ? JSON.parse(inputJson) : {};
  process.stdout.write(JSON.stringify({
    ok: true,
    data: {
      operation: cliOperation,
      cliName: cliOperation,
      mcpName: cliOperation === 'search' ? 'search_code' : cliOperation,
      result: {
        subcommand: cliOperation,
        input: parsedInput,
      },
    },
  }) + '\\n');
  process.exit(0);
}
process.stderr.write('IWSDK Reference MCP Server is ready\\n');
setInterval(() => {}, 1000);
`,
    'utf8',
  );
}

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function waitForSessionFile(
  sessionFile: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(sessionFile)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${sessionFile}`);
}

async function waitForOutput(
  readOutput: () => string,
  expected: string,
  timeoutMs = 15000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readOutput().includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for output ${JSON.stringify(expected)}. Last output:\n${readOutput()}`,
  );
}

async function startRuntimeFixture(
  workspaceRoot: string,
  options: {
    aiTools?: AiTool[];
    relaunchFirstScreenshot?: boolean;
    runtimeErrorMethod?: string;
  } = {},
) {
  const aiTools = options.aiTools ?? ['claude', 'cursor'];
  let screenshotRequestCount = 0;
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  server.on('connection', (socket) => {
    socket.on('message', (chunk) => {
      const request = JSON.parse(chunk.toString());
      if (request.method === options.runtimeErrorMethod) {
        socket.send(
          JSON.stringify({
            id: request.id,
            error: { message: 'No XR session is currently offered' },
          }),
        );
        return;
      }
      if (request.method === 'screenshot') {
        screenshotRequestCount += 1;
      }
      const response = {
        id: request.id,
        result:
          request.method === 'get_session_status'
            ? { sessionMode: 'immersive-vr', running: true }
            : request.method === 'screenshot' &&
                options.relaunchFirstScreenshot &&
                screenshotRequestCount === 1
              ? {
                  status: 'browser_relaunched',
                  message: 'Browser was relaunched; retry the request.',
                }
              : request.method === 'browser_interact'
                ? {
                    application: {
                      generation: 1,
                      id: 'tab-1',
                      url: `http://localhost:${port}/`,
                    },
                    completed: [],
                    failure: {
                      action: 'click',
                      index: 0,
                      message: 'element detached',
                      recovery: 'Capture a fresh browser_snapshot and retry.',
                      retryable: true,
                      screenshot: {
                        imageData: ONE_BY_ONE_PNG_BASE64,
                        mimeType: 'image/png',
                      },
                      snapshot: null,
                    },
                    success: false,
                  }
                : request.method === 'browser_filmstrip'
                  ? {
                      // Echo the params next to the image so alias tests can
                      // check them after the image is written to disk.
                      imageData: ONE_BY_ONE_PNG_BASE64,
                      mimeType: 'image/png',
                      method: request.method,
                      params: request.params ?? {},
                    }
                  : request.method === 'screenshot' ||
                      request.method === 'scene_screenshot' ||
                      request.method === 'asset_render_preview' ||
                      request.method === 'ui_render_preview'
                    ? {
                        imageData: ONE_BY_ONE_PNG_BASE64,
                        mimeType: 'image/png',
                      }
                    : {
                        ok: true,
                        method: request.method,
                        params: request.params ?? {},
                      },
        _tabId: 'tab-1',
        _tabGeneration: 1,
      };
      socket.send(JSON.stringify(response));
    });
  });

  await registerRuntimeSession({
    sessionId: `session-${path.basename(workspaceRoot)}`,
    workspaceRoot,
    pid: process.pid,
    port,
    localUrl: `http://localhost:${port}`,
    aiMode: 'agent',
    aiTools,
    browser: {
      status: 'connected',
      connected: true,
      commandReady: true,
      connectedClientCount: 1,
      lastTransitionAt: new Date().toISOString(),
      lastBridgeConnectedAt: new Date().toISOString(),
      lastCommandReadyAt: new Date().toISOString(),
    },
  });

  return {
    getScreenshotRequestCount() {
      return screenshotRequestCount;
    },
    async close() {
      await unregisterRuntimeSession(workspaceRoot);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function createBrowserState(
  status: RuntimeBrowserState['status'],
  overrides: Partial<RuntimeBrowserState> = {},
): RuntimeBrowserState {
  return {
    status,
    connected: status === 'connected',
    commandReady: status === 'connected',
    connectedClientCount: status === 'connected' ? 1 : 0,
    lastTransitionAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildManagedRuntimeScript(
  sessionId: string,
  options: {
    environmentCapturePath?: string;
    initialBrowserStatus?: RuntimeBrowserState['status'];
    finalBrowserStatus?: RuntimeBrowserState['status'];
    finalBrowserDelayMs?: number;
    finalBrowserError?: RuntimeBrowserState['lastError'];
    includeLifecycle?: boolean;
    includeOwner?: boolean;
    probeReadyDelayMs?: number;
    probeWritesSession?: boolean;
    startupMarkerPath?: string;
    workspaceOnly?: boolean;
  } = {},
): string {
  const includeLifecycle = options.includeLifecycle ?? false;
  const includeOwner = options.includeOwner ?? true;
  const lifecycle = (state: 'launching' | 'running') => ({
    state,
    policy: 'eager' as const,
    sessionId,
    browserEpoch: 1,
    revision: state === 'running' ? 2 : 1,
    stateEnteredAt: new Date().toISOString(),
    lastObservedAt: new Date().toISOString(),
    failures: 0,
    cleanupConfirmed: true,
    attemptLimit: 3,
    historyTruncated: false,
    retryEligible: false,
    nextAction:
      state === 'running'
        ? 'Use runtime_list_targets to inspect endpoint readiness.'
        : 'Use runtime_wait to observe launch progress.',
    history: [],
  });
  const initialBrowser = JSON.stringify(
    createBrowserState(options.initialBrowserStatus ?? 'launching', {
      commandReady: false,
      ...(includeLifecycle ? { lifecycle: lifecycle('launching') } : {}),
    }),
  );
  const finalBrowser =
    (options.finalBrowserStatus ?? 'connected')
      ? JSON.stringify(
          createBrowserState(options.finalBrowserStatus ?? 'connected', {
            commandReady: false,
            ...(includeLifecycle ? { lifecycle: lifecycle('running') } : {}),
            ...(options.finalBrowserError
              ? {
                  lastError: options.finalBrowserError,
                }
              : {}),
          }),
        )
      : null;
  const finalBrowserDelayMs = options.finalBrowserDelayMs ?? 100;
  const probeReadyDelayMs = options.probeReadyDelayMs ?? 0;

  return `import http from 'node:http';
import { appendFileSync, realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(${JSON.stringify(CLI_PACKAGE_JSON_PATH)});
const { WebSocketServer } = require('ws');

const workspaceRoot = realpathSync.native(process.cwd());
const ownerLease = ${includeOwner ? `await (await import(${JSON.stringify(CLI_RUNTIME_OWNER_URL)})).acquireRuntimeOwner(workspaceRoot, ${JSON.stringify(sessionId)})` : 'null'};
const startupMarkerPath = ${JSON.stringify(options.startupMarkerPath ?? null)};
if (startupMarkerPath) {
  appendFileSync(startupMarkerPath, String(process.pid) + '\\n', 'utf8');
}
const environmentCapturePath = ${JSON.stringify(options.environmentCapturePath ?? null)};
if (environmentCapturePath) {
  await writeFile(
    environmentCapturePath,
    JSON.stringify({
      aiMode: process.env.IWSDK_DEV_AI_MODE,
      headless: process.env.IWSDK_DEV_HEADLESS,
      open: process.env.IWSDK_DEV_OPEN,
      screenshotHeight: process.env.IWSDK_DEV_SCREENSHOT_HEIGHT,
      screenshotWidth: process.env.IWSDK_DEV_SCREENSHOT_WIDTH,
    }) + '\\n',
    'utf8',
  );
}
const sessionFile = path.join(workspaceRoot, '.iwsdk', 'runtime', 'session.json');
const server = http.createServer((_, res) => res.end('ok'));
const wss = new WebSocketServer({ server });
let currentPort = 0;
let currentBrowser = ${initialBrowser};

async function writeSession(port, browser) {
  const now = new Date().toISOString();
  const session = {
    schemaVersion: ${IWSDK_RUNTIME_STATE_SCHEMA_VERSION},
    sessionId: ${JSON.stringify(sessionId)},
    workspaceRoot,
    pid: process.pid,
    port,
    localUrl: 'http://localhost:' + port,
    networkUrls: [],
    ${options.workspaceOnly ? '' : "aiMode: 'agent',"}
    aiTools: ['claude', 'cursor'],
    browser,
    registeredAt: now,
    updatedAt: now,
  };
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, JSON.stringify(session, null, 2) + '\\n', 'utf8');
}

wss.on('connection', (socket) => {
  socket.on('message', (chunk) => {
    const request = JSON.parse(chunk.toString());
    if (request.method === ${JSON.stringify(INTERNAL_RUNTIME_SHUTDOWN_METHOD)}) {
      socket.send(JSON.stringify({ id: request.id, result: { accepted: true } }));
      setImmediate(() => process.kill(process.pid, 'SIGTERM'));
      return;
    }
    if (request.method !== ${JSON.stringify(INTERNAL_BROWSER_PROBE_METHOD)}) {
      return;
    }

    if (currentBrowser.status === 'launch_failed') {
      socket.send(
        JSON.stringify({
          id: request.id,
          error: {
            code: -32000,
            message:
              currentBrowser.lastError?.message ?? 'Managed browser launch failed.',
            cause:
              currentBrowser.lastError?.cause ?? 'browser_launch_failed',
          },
        }),
      );
      return;
    }

    if (currentBrowser.status !== 'connected') {
      socket.send(
        JSON.stringify({
          id: request.id,
          error: {
            code: -32000,
            message: 'Browser not ready',
            cause: 'browser_not_ready',
          },
        }),
      );
      return;
    }

    setTimeout(async () => {
      currentBrowser = {
        ...currentBrowser,
        connected: true,
        commandReady: true,
        connectedClientCount: 1,
        lastTransitionAt: new Date().toISOString(),
        lastBridgeConnectedAt:
          currentBrowser.lastBridgeConnectedAt ?? new Date().toISOString(),
        lastCommandReadyAt: new Date().toISOString(),
      };
      ${options.probeWritesSession === false ? '' : 'await writeSession(currentPort, currentBrowser);'}
      socket.send(
        JSON.stringify({
          id: request.id,
          result: {
            bridgeConnected: true,
            commandReady: true,
            waitedForBridgeMs: ${probeReadyDelayMs},
            browser: currentBrowser,
          },
        }),
      );
    }, ${probeReadyDelayMs});
  });
});

server.listen(0, '127.0.0.1', async () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  currentPort = port;
  await writeSession(port, currentBrowser);
  ${
    finalBrowser
      ? `setTimeout(() => {
  currentBrowser = ${finalBrowser};
  void writeSession(port, currentBrowser);
}, ${finalBrowserDelayMs});`
      : ''
  }
});

process.on('SIGTERM', async () => {
  await rm(sessionFile, { force: true }).catch(() => {});
  await ownerLease?.release();
  wss.close(() => server.close(() => process.exit(0)));
});

setInterval(() => {}, 1000);
`;
}

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  appA = path.join(tempDir, 'apps', 'app-a');
  appB = path.join(tempDir, 'apps', 'app-b');
  await createAppFixture(appA);
  await createAppFixture(appB);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('runtime commands and project resolution', () => {
  test('resolves the nearest IWSDK workspace root for runtime commands', async () => {
    const runtime = await startRuntimeFixture(appA);

    try {
      const xrStatus = await runCli(['xr', 'status'], path.join(appA, 'src'));
      expect(xrStatus.exitCode).toBe(0);
      const parsedStatus = JSON.parse(xrStatus.stdout);
      expect(parsedStatus.data.workspaceRoot).toBe(await realpath(appA));
      expect(parsedStatus.data.operation).toBe('xr.status');
      expect(parsedStatus.data.result.running).toBe(true);

      const sceneState = await runCli(
        ['scene', 'state'],
        path.join(appA, 'src'),
      );
      expect(sceneState.exitCode).toBe(0);
      const parsedSceneState = JSON.parse(sceneState.stdout);
      expect(parsedSceneState.data.operation).toBe('scene.state');
      expect(parsedSceneState.data.result.method).toBe('scene_get_state');

      const screenshot = await runCli(
        ['browser', 'screenshot'],
        path.join(appA, 'src'),
      );
      expect(screenshot.exitCode).toBe(0);
      const parsedScreenshot = JSON.parse(screenshot.stdout);
      expect(existsSync(parsedScreenshot.data.screenshotPath)).toBe(true);

      const requestedSceneScreenshot = path.join(appA, 'scene-capture.png');
      const sceneScreenshot = await runCli(
        [
          'scene',
          'screenshot',
          '--output-file',
          requestedSceneScreenshot,
          '--raw',
        ],
        path.join(appA, 'src'),
      );
      expect(sceneScreenshot.exitCode).toBe(0);
      const parsedSceneScreenshot = JSON.parse(sceneScreenshot.stdout);
      expect(parsedSceneScreenshot.data.screenshotPath).toBe(
        requestedSceneScreenshot,
      );
      expect(existsSync(requestedSceneScreenshot)).toBe(true);
      expect(parsedSceneScreenshot.imageData).toBeUndefined();

      const requestedAssetPreview = path.join(appA, 'asset-preview.png');
      const assetPreview = await runCli(
        [
          'asset',
          'render-preview',
          '--input-json',
          '{"assetId":"robot","mode":"clay"}',
          '--output-file',
          requestedAssetPreview,
        ],
        path.join(appA, 'src'),
      );
      expect(assetPreview.exitCode).toBe(0);
      expect(JSON.parse(assetPreview.stdout).data.screenshotPath).toBe(
        requestedAssetPreview,
      );
      expect(existsSync(requestedAssetPreview)).toBe(true);

      const requestedUIPreview = path.join(appA, 'ui-preview.png');
      const uiPreview = await runCli(
        [
          'ui',
          'render-preview',
          '--input-json',
          '{"assetId":"welcome-panel"}',
          '--output-file',
          requestedUIPreview,
        ],
        path.join(appA, 'src'),
      );
      expect(uiPreview.exitCode).toBe(0);
      expect(JSON.parse(uiPreview.stdout).data.screenshotPath).toBe(
        requestedUIPreview,
      );
      expect(existsSync(requestedUIPreview)).toBe(true);

      const uiAssets = await runCli(
        ['ui', 'assets', '--raw'],
        path.join(appA, 'src'),
      );
      expect(uiAssets.exitCode).toBe(0);
      expect(JSON.parse(uiAssets.stdout)).toMatchObject({
        method: 'ui_list_assets',
      });
      const uiInspect = await runCli(
        [
          'ui',
          'inspect',
          '--input-json',
          '{"entityIndex":14,"selector":"#counter-button"}',
        ],
        path.join(appA, 'src'),
      );
      expect(uiInspect.exitCode).toBe(0);
      expect(JSON.parse(uiInspect.stdout).data).toMatchObject({
        operation: 'ui.inspect',
        result: {
          method: 'ui_inspect',
          params: {
            entityIndex: 14,
            selector: '#counter-button',
          },
        },
      });
    } finally {
      await runtime.close();
    }
  });

  test('reports recovery without replay and writes the screenshot on a fresh command', async () => {
    const runtime = await startRuntimeFixture(appA, {
      relaunchFirstScreenshot: true,
    });
    const requestedScreenshot = path.join(
      appA,
      'captures',
      'nested',
      'browser.png',
    );

    try {
      const recovered = await runCli(
        ['browser', 'screenshot', '--output-file', requestedScreenshot],
        appA,
      );
      expect(JSON.parse(recovered.stdout).data.result.status).toBe(
        'browser_relaunched',
      );
      expect(runtime.getScreenshotRequestCount()).toBe(1);
      expect(existsSync(requestedScreenshot)).toBe(false);
      const screenshot = await runCli(
        ['browser', 'screenshot', '--output-file', requestedScreenshot],
        appA,
      );

      expect(screenshot.exitCode).toBe(0);
      expect(JSON.parse(screenshot.stdout).data.screenshotPath).toBe(
        requestedScreenshot,
      );
      expect(existsSync(requestedScreenshot)).toBe(true);
      expect(runtime.getScreenshotRequestCount()).toBe(2);
    } finally {
      await runtime.close();
    }
  });

  test('writes nested browser interaction failure images instead of printing base64', async () => {
    const runtime = await startRuntimeFixture(appA);
    try {
      const interaction = await runCli(
        [
          'browser',
          'interact',
          '--input-json',
          '{"steps":[{"action":"click","ref":"e1"}]}',
          '--raw',
        ],
        appA,
      );
      expect(interaction.exitCode).toBe(0);
      const result = JSON.parse(interaction.stdout);
      expect(result.failure.screenshot).toMatchObject({
        captured: true,
        mimeType: 'image/png',
      });
      expect(result.failure.screenshot.imageData).toBeUndefined();
      expect(existsSync(result.failure.screenshot.screenshotPath)).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  test('fails outside an IWSDK workspace for runtime commands', async () => {
    const result = await runCli(['xr', 'status'], tempDir);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stderr);
    expect(parsed.error.message).toContain('No IWSDK app found at or above');
  });

  test('suggests starting the runtime when no session is active', async () => {
    const result = await runCli(['xr', 'status'], appA);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stderr);
    expect(parsed.error.message).toContain('No running IWSDK runtime found');
    expect(parsed.error.message).toContain('iwsdk dev up');
  });
});

describe('runtime introspection and raw output', () => {
  test('reports browser readiness in dev status', async () => {
    await registerRuntimeSession({
      sessionId: 'session-status',
      workspaceRoot: appA,
      pid: process.pid,
      port: 5190,
      localUrl: 'http://localhost:5190',
      aiMode: 'agent',
      aiTools: ['claude'],
      browser: createBrowserState('connected'),
    });

    const status = await runCli(['dev', 'status'], appA);
    expect(status.exitCode).toBe(0);
    const parsed = JSON.parse(status.stdout);
    expect(parsed.data.state.browserConnected).toBe(true);
    expect(parsed.data.state.browserCommandReady).toBe(true);
    expect(parsed.data.state.session.browser.status).toBe('connected');
  });

  test('explains an intentional --no-open session in dev status', async () => {
    await registerRuntimeSession({
      sessionId: 'session-no-browser',
      workspaceRoot: appA,
      pid: process.pid,
      port: 5191,
      localUrl: 'http://localhost:5191',
      browser: createBrowserState('not_launched', {
        lastError: {
          cause: 'browser_not_launched',
          message:
            'No managed browser was launched because the dev server was started with --no-open.',
          at: new Date().toISOString(),
        },
      }),
    });

    const status = await runCli(['dev', 'status'], appA);
    const parsed = JSON.parse(status.stdout);
    expect(parsed.data.state).toMatchObject({
      browserConnected: false,
      browserCommandReady: false,
      browserIssue: { cause: 'browser_not_launched' },
      session: { browser: { status: 'not_launched' } },
    });
  });

  test('inspects one runtime tool schema', async () => {
    const inspect = await runCli(
      ['mcp', 'inspect', '--tool', 'xr_look_at'],
      appA,
    );
    expect(inspect.exitCode).toBe(0);
    const parsed = JSON.parse(inspect.stdout);
    expect(parsed.data.tool.mcpName).toBe('xr_look_at');
    expect(parsed.data.tool.cliPath).toBe('xr look-at');
    expect(parsed.data.tool.inputSchema.required).toContain('device');
    expect(parsed.data.tool.inputSchema.required).toContain('target');
  });

  test('prints schema-backed help for runtime commands', async () => {
    const sceneDomainHelp = await runCli(['scene', '--help'], appA);
    expect(sceneDomainHelp.exitCode).toBe(0);
    expect(sceneDomainHelp.stdout).toContain('Usage: iwsdk scene <action>');
    expect(sceneDomainHelp.stdout).toContain('render-file');
    expect(sceneDomainHelp.stdout).toContain('flatten');

    const uiDomainHelp = await runCli(['ui', '--help'], appA);
    expect(uiDomainHelp.exitCode).toBe(0);
    expect(uiDomainHelp.stdout).toContain('Usage: iwsdk ui <action>');
    expect(uiDomainHelp.stdout).toContain('render-preview');

    const browserDomainHelp = await runCli(['browser', '--help'], appA);
    expect(browserDomainHelp.exitCode).toBe(0);
    expect(browserDomainHelp.stdout).toContain('snapshot');
    expect(browserDomainHelp.stdout).toContain('profile');
    expect(browserDomainHelp.stdout).toContain('run');

    const browserRunHelp = await runCli(['browser', 'run', '--help'], appA);
    expect(browserRunHelp.exitCode).toBe(0);
    expect(browserRunHelp.stdout).toContain('--allow-browser-automation');
    expect(browserRunHelp.stdout).toContain(
      'browser, context, page, frame, cdp',
    );

    const xrHelp = await runCli(['xr', 'look-at', '--help'], appA);
    expect(xrHelp.exitCode).toBe(0);
    expect(xrHelp.stdout).toContain('Usage: iwsdk xr look-at');
    expect(xrHelp.stdout).toContain('device (required) [enum]');
    expect(xrHelp.stdout).toContain('controller-right');
    expect(xrHelp.stdout).toContain('Example:');
    expect(xrHelp.stdout).toContain('--input-json');

    const ecsHelp = await runCli(['ecs', 'toggle-system', '--help'], appA);
    expect(ecsHelp.exitCode).toBe(0);
    expect(ecsHelp.stdout).toContain('Usage: iwsdk ecs toggle-system');
    expect(ecsHelp.stdout).toContain('name (required)');
    expect(ecsHelp.stdout).not.toContain('systemName');

    const ecsStepHelp = await runCli(['ecs', 'step', '--help'], appA);
    expect(ecsStepHelp.stdout).toContain('--frames <count>');

    const muteHelp = await runCli(['browser', 'set-muted', '--help'], appA);
    expect(muteHelp.exitCode).toBe(0);
    expect(muteHelp.stdout).toContain('muted (required)');
    expect(muteHelp.stdout).toContain('--muted <true|false>');

    const renderFileHelp = await runCli(
      ['scene', 'render-file', '--help'],
      appA,
    );
    expect(renderFileHelp.exitCode).toBe(0);
    expect(renderFileHelp.stdout).toContain('Usage: iwsdk scene render-file');
    expect(renderFileHelp.stdout).toContain('path (required)');

    const sceneScreenshotHelp = await runCli(
      ['scene', 'screenshot', '--help'],
      appA,
    );
    expect(sceneScreenshotHelp.exitCode).toBe(0);
    expect(sceneScreenshotHelp.stdout).toContain('--output-file <path>');
    expect(sceneScreenshotHelp.stdout).toContain('takes precedence over --raw');

    const filmstripHelp = await runCli(
      ['browser', 'filmstrip', '--help'],
      appA,
    );
    expect(filmstripHelp.exitCode).toBe(0);
    for (const line of [
      '--count <frames>',
      '--every <frames>',
      '--format <png|jpeg>',
      '--output-file <path>',
    ]) {
      expect(filmstripHelp.stdout).toContain(line);
    }

    const uiPreviewHelp = await runCli(
      ['ui', 'render-preview', '--help'],
      appA,
    );
    expect(uiPreviewHelp.exitCode).toBe(0);
    expect(uiPreviewHelp.stdout).toContain('assetId (required)');
    expect(uiPreviewHelp.stdout).toContain('--output-file <path>');

    const uiAssetsHelp = await runCli(['ui', 'assets', '--help'], appA);
    expect(uiAssetsHelp.exitCode).toBe(0);
    expect(uiAssetsHelp.stdout).toContain('Usage: iwsdk ui assets');
  });

  test('rejects unknown runtime flags and wrong JSON keys', async () => {
    const unknownFlag = await runCli(['ecs', 'step', '--framse', '3'], appA);
    expect(unknownFlag.exitCode).toBe(1);
    expect(JSON.parse(unknownFlag.stderr).error.message).toContain(
      'Unknown option --framse',
    );

    const wrongKey = await runCli(
      ['ecs', 'step', '--input-json', '{"frames":3}'],
      appA,
    );
    expect(wrongKey.exitCode).toBe(1);
    expect(JSON.parse(wrongKey.stderr).error.message).toContain(
      'unknown parameter "frames"',
    );
  });

  test('accepts safe direct aliases and prints domain help without undefined', async () => {
    const runtime = await startRuntimeFixture(appA);
    try {
      const step = await runCli(
        ['ecs', 'step', '--frames', '2', '--delta', '0.01'],
        appA,
      );
      expect(step.exitCode).toBe(0);
      expect(JSON.parse(step.stdout).data.result.params).toEqual({
        count: 2,
        delta: 0.01,
      });

      for (const [flags, muted] of [
        [['--muted'], true],
        [['--muted', 'true'], true],
        [['--muted', 'false'], false],
      ] as const) {
        const mute = await runCli(['browser', 'set-muted', ...flags], appA);
        expect(mute.exitCode).toBe(0);
        expect(JSON.parse(mute.stdout).data.result).toMatchObject({
          method: 'browser_set_muted',
          params: { muted },
        });
      }
      const filmstrip = await runCli(
        [
          'browser',
          'filmstrip',
          '--count',
          '4',
          '--every',
          '10',
          '--format',
          'jpeg',
        ],
        appA,
      );
      expect(filmstrip.exitCode).toBe(0);
      const filmstripData = JSON.parse(filmstrip.stdout).data;
      expect(filmstripData.result).toMatchObject({
        method: 'browser_filmstrip',
        params: { count: 4, every: 10, format: 'jpeg' },
      });
      // The contact sheet is written to disk, never printed as base64.
      expect(filmstripData.result.imageData).toBeUndefined();
      expect(path.isAbsolute(filmstripData.screenshotPath)).toBe(true);
      expect(await readFile(filmstripData.screenshotPath, 'base64')).toBe(
        ONE_BY_ONE_PNG_BASE64,
      );
      const requestedFilmstrip = path.join(appA, 'captures', 'strip.png');
      const filmstripToFile = await runCli(
        ['browser', 'filmstrip', '--output-file', requestedFilmstrip],
        appA,
      );
      expect(filmstripToFile.exitCode).toBe(0);
      expect(JSON.parse(filmstripToFile.stdout).data.screenshotPath).toBe(
        requestedFilmstrip,
      );
      expect(await readFile(requestedFilmstrip, 'base64')).toBe(
        ONE_BY_ONE_PNG_BASE64,
      );
      const invalidFilmstrip = await runCli(
        ['browser', 'filmstrip', '--count', '1'],
        appA,
      );
      expect(invalidFilmstrip.exitCode).toBe(1);
      expect(JSON.parse(invalidFilmstrip.stderr).error.message).toContain(
        'browser_filmstrip.count must be at least 2',
      );

      const invalidMute = await runCli(
        ['browser', 'set-muted', '--muted', 'off'],
        appA,
      );
      expect(invalidMute.exitCode).toBe(1);
      expect(JSON.parse(invalidMute.stderr).error.message).toContain(
        '--muted must be true or false',
      );
    } finally {
      await runtime.close();
    }

    const missingAction = await runCli(['xr'], appA);
    expect(missingAction.exitCode).toBe(1);
    expect(JSON.parse(missingAction.stderr).error.message).toContain(
      'Usage: iwsdk xr <action>',
    );
    expect(missingAction.stderr).not.toContain('undefined');
  });

  test('explains how to make an XR session enterable', async () => {
    const runtime = await startRuntimeFixture(appA, {
      runtimeErrorMethod: 'accept_session',
    });
    try {
      const enter = await runCli(['xr', 'enter'], appA);
      expect(enter.exitCode).toBe(1);
      expect(JSON.parse(enter.stderr).error.message).toContain(
        'world.xr.offer as "once" or "always"',
      );
    } finally {
      await runtime.close();
    }
  });

  test('returns underlying runtime payloads with --raw', async () => {
    const runtime = await startRuntimeFixture(appA);

    try {
      const xrStatus = await runCli(
        ['xr', 'status', '--raw'],
        path.join(appA, 'src'),
      );
      expect(xrStatus.exitCode).toBe(0);
      const parsedStatus = JSON.parse(xrStatus.stdout);
      expect(parsedStatus.running).toBe(true);
      expect(parsedStatus.browserConnected).toBe(true);
      expect(parsedStatus.browserCommandReady).toBe(true);
      expect(parsedStatus.ok).toBeUndefined();

      const screenshot = await runCli(
        ['browser', 'screenshot', '--raw'],
        path.join(appA, 'src'),
      );
      expect(screenshot.exitCode).toBe(0);
      const parsedScreenshot = JSON.parse(screenshot.stdout);
      expect(parsedScreenshot.mimeType).toBe('image/png');
      expect(typeof parsedScreenshot.imageData).toBe('string');
      expect(parsedScreenshot.imageData.length).toBeGreaterThan(0);
      expect(parsedScreenshot.ok).toBeUndefined();
    } finally {
      await runtime.close();
    }
  });
});

describe('reference commands', () => {
  test('reports install and cache state from a nested cwd', async () => {
    await installReferenceFixture(appA);

    const result = await runCli(
      ['reference', 'status'],
      path.join(appA, 'src'),
    );
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.data.installed).toBe(true);
    expect(parsed.data.workspaceRoot).toBe(await realpath(appA));
    expect(parsed.data.initState).toBe('not_started');
    expect(parsed.data.warmupRequired).toBe(true);
  });

  test('supports --workspace for reference warmup', async () => {
    await installReferenceFixture(appA);

    const result = await runCli(
      ['reference', 'warmup', '--workspace', appA],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.data.workspaceRoot).toBe(await realpath(appA));
    expect(parsed.data.initState).toBe('ready');
    expect(parsed.data.warmupRequired).toBe(false);
    expect(result.stderr).toContain('warming reference assets');
  });

  test('reports when reference is not installed', async () => {
    const result = await runCli(
      ['reference', 'status'],
      path.join(appA, 'src'),
    );
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.data.installed).toBe(false);
    expect(parsed.data.packageRoot).toBeNull();
  });

  test('inspects the reference contract through the workspace package', async () => {
    await installReferenceFixture(appA);

    const result = await runCli(
      ['reference', 'inspect', '--tool', 'search'],
      path.join(appA, 'src'),
    );
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.data.operation).toBe('inspect');
    expect(parsed.data.result.cliName).toBe('search');
    expect(parsed.data.result.mcpName).toBe('search_code');
  });

  test('shells out dedicated reference query subcommands', async () => {
    await installReferenceFixture(appA);

    const result = await runCli(
      [
        'reference',
        'search',
        '--input-json',
        JSON.stringify({ query: 'player rig', limit: 2 }),
      ],
      path.join(appA, 'src'),
    );
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.data.operation).toBe('search');
    expect(parsed.data.result).toEqual({
      subcommand: 'search',
      input: {
        query: 'player rig',
        limit: 2,
      },
    });
  });

  test('surfaces reference query failures with CLI failure envelopes', async () => {
    await installReferenceFixture(appA);

    const result = await runCli(
      ['reference', 'explode'],
      path.join(appA, 'src'),
    );
    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stderr);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('reference_query_failed');
    expect(parsed.error.message).toContain('fixture exploded');
  });
});

describe('adapter management', () => {
  test('writes stable adapter configs that point to iwsdk mcp stdio without workspace args', async () => {
    const result = await runCli(['adapter', 'sync'], appA);
    expect(result.exitCode).toBe(0);

    const claude = JSON.parse(
      await readFile(path.join(appA, '.mcp.json'), 'utf8'),
    );
    const cursor = JSON.parse(
      await readFile(path.join(appA, '.cursor', 'mcp.json'), 'utf8'),
    );
    const codex = await readFile(
      path.join(appA, '.codex', 'config.toml'),
      'utf8',
    );
    const normalizedAppA = await realpath(appA);

    expect(claude.mcpServers['iwsdk-runtime'].command).toBe('node');
    expect(claude.mcpServers['iwsdk-runtime'].args).toContain(
      path.join(
        normalizedAppA,
        'node_modules',
        '@iwsdk',
        'cli',
        'dist',
        'cli.js',
      ),
    );
    expect(claude.mcpServers['iwsdk-runtime'].args).toContain('mcp');
    expect(claude.mcpServers['iwsdk-runtime'].args).toContain('stdio');
    expect(claude.mcpServers['iwsdk-runtime'].args).not.toContain(
      '--workspace',
    );
    expect(cursor.mcpServers['iwsdk-runtime'].command).toBe('node');
    expect(codex).toContain('[mcp_servers.iwsdk-runtime]');
    expect(codex).not.toContain('--port');
    expect(codex).not.toContain('--workspace');
  });

  test('prints a self-contained fallback prompt for unsupported harnesses', async () => {
    const result = await runCli(['adapter', 'prompt'], appA);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Treat AGENTS.md as the canonical');
    expect(result.stdout).toContain('iwsdk-runtime');
    expect(result.stdout).toContain('"mcp","stdio"');
    expect(result.stdout).toContain('Do not disable approvals or sandboxing');
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  test('ignores legacy-looking args on unrelated user-owned MCP entries', async () => {
    const sync = await runCli(['adapter', 'sync'], appA);
    expect(sync.exitCode).toBe(0);

    const claudePath = path.join(appA, '.mcp.json');
    const cursorPath = path.join(appA, '.cursor', 'mcp.json');
    const copilotPath = path.join(appA, '.vscode', 'mcp.json');
    const codexPath = path.join(appA, '.codex', 'config.toml');

    const claude = JSON.parse(await readFile(claudePath, 'utf8'));
    claude.mcpServers['user-owned'] = {
      command: 'node',
      args: ['custom.js', '--workspace', '/tmp/elsewhere'],
    };
    await writeFile(claudePath, `${JSON.stringify(claude, null, 2)}\n`, 'utf8');

    const cursor = JSON.parse(await readFile(cursorPath, 'utf8'));
    cursor.mcpServers['user-owned'] = {
      command: 'node',
      args: ['custom.js', '--workspace', '/tmp/elsewhere'],
    };
    await writeFile(cursorPath, `${JSON.stringify(cursor, null, 2)}\n`, 'utf8');

    const copilot = JSON.parse(await readFile(copilotPath, 'utf8'));
    copilot.servers['user-owned'] = {
      command: 'node',
      args: ['custom.js', '--workspace', '/tmp/elsewhere'],
    };
    await writeFile(
      copilotPath,
      `${JSON.stringify(copilot, null, 2)}\n`,
      'utf8',
    );

    const codex = await readFile(codexPath, 'utf8');
    await writeFile(
      codexPath,
      `${codex}\n[mcp_servers.user-owned]\ncommand = "node"\nargs = ["custom.js", "--workspace", "/tmp/elsewhere"]\n`,
      'utf8',
    );

    const status = await runCli(['adapter', 'status'], appA);
    expect(status.exitCode).toBe(0);
    const parsedStatus = JSON.parse(status.stdout);
    const adapterStatuses = Object.fromEntries(
      parsedStatus.data.adapters.map(
        (entry: { tool: string; status: string }) => [entry.tool, entry.status],
      ),
    );
    expect(adapterStatuses.claude).toBe('configured');
    expect(adapterStatuses.cursor).toBe('configured');
    expect(adapterStatuses.copilot).toBe('configured');
    expect(adapterStatuses.codex).toBe('configured');
  });

  test('works against the manifest-first starter app shape', async () => {
    const starterApp = path.join(tempDir, 'starter-app');
    await mkdir(starterApp, { recursive: true });

    const starterPackageJson = `${JSON.stringify(
      {
        name: 'starter-app',
        private: true,
        scripts: {
          dev: 'iwsdk dev restart --open --foreground',
          'dev:runtime': 'vite',
          'dev:down': 'iwsdk dev down',
          'dev:status': 'iwsdk dev status',
        },
        devDependencies: {
          '@iwsdk/cli': '0.5.0',
          '@iwsdk/vite-plugin-dev': '0.5.0',
          vite: '^7.1.4',
        },
      },
      null,
      2,
    )}\n`;
    const starterViteConfig = await readFile(
      path.join(
        WORKSPACE_ROOT,
        'packages',
        'create',
        'template',
        'common',
        'vite.config.ts',
      ),
      'utf8',
    );
    const parsedStarterPackageJson = JSON.parse(starterPackageJson);

    expect(parsedStarterPackageJson.scripts.dev).toBe(
      'iwsdk dev restart --open --foreground',
    );
    expect(parsedStarterPackageJson.scripts['dev:runtime']).toBe('vite');
    expect(parsedStarterPackageJson.scripts['dev:down']).toBe('iwsdk dev down');
    expect(parsedStarterPackageJson.scripts['dev:status']).toBe(
      'iwsdk dev status',
    );
    expect(parsedStarterPackageJson.devDependencies['@iwsdk/cli']).toBe(
      '0.5.0',
    );
    expect(starterViteConfig).toContain('iwsdkDev()');
    expect(starterViteConfig).not.toContain('IWSDK_DEV_PORT');
    expect(starterViteConfig).not.toContain('IWSDK_DEV_OPEN');
    expect(starterViteConfig).not.toContain('strictPort');

    await writeFile(
      path.join(starterApp, 'package.json'),
      starterPackageJson,
      'utf8',
    );
    await writeFile(
      path.join(starterApp, 'vite.config.ts'),
      starterViteConfig,
      'utf8',
    );
    await writeFile(
      path.join(starterApp, 'iwsdk.config.json'),
      '{"version":"iwsdk.project.v1","scene":"./public/scenes/main.iwsdk.scene.json","world":{"xr":false}}\n',
      'utf8',
    );

    const status = await runCli(['status'], starterApp);
    expect(status.exitCode).toBe(0);
    const parsedStatus = JSON.parse(status.stdout);
    expect(parsedStatus.data.workspaceRoot).toBe(await realpath(starterApp));

    const sync = await runCli(['adapter', 'sync'], starterApp);
    expect(sync.exitCode).toBe(0);
    const parsedSync = JSON.parse(sync.stdout);
    expect(
      parsedSync.data.adapters.every(
        (entry: { status: string }) => entry.status === 'configured',
      ),
    ).toBe(true);
  });
});

describe('dev lifecycle', () => {
  test('propagates CLI-owned session settings into a manifest-first dev process', async () => {
    const fixtureScript = path.join(appA, 'dev-session-env.mjs');
    const environmentCapturePath = path.join(appA, 'dev-session-env.json');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-session-env', {
        environmentCapturePath,
      }),
      'utf8',
    );
    await createAppFixture(appA, {
      scripts: { 'dev:runtime': 'node dev-session-env.mjs' },
    });
    await rm(path.join(appA, 'vite.config.ts'));
    await writeFile(
      path.join(appA, 'iwsdk.config.json'),
      '{"version":"iwsdk.project.v1"}\n',
      'utf8',
    );

    const up = await runCli(
      [
        'dev',
        'up',
        '--ai-mode',
        'agent',
        '--headless',
        '--no-open',
        '--screenshot-width',
        '1280',
        '--screenshot-height',
        '720',
        '--timeout',
        '15000',
      ],
      appA,
    );
    expect(up.exitCode, up.stderr).toBe(0);
    expect(JSON.parse(await readFile(environmentCapturePath, 'utf8'))).toEqual({
      aiMode: 'agent',
      headless: 'true',
      open: 'false',
      screenshotHeight: '720',
      screenshotWidth: '1280',
    });

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode, down.stderr).toBe(0);
  });

  test('requires dev:runtime and records observed launch state', async () => {
    const fixtureScript = path.join(appA, 'dev-runtime.mjs');
    const fallbackScript = path.join(appA, 'dev-should-not-run.mjs');
    const fallbackMarkerPath = path.join(appA, 'dev-script-hit.txt');

    await writeFile(
      fallbackScript,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(fallbackMarkerPath)}, 'dev should not run\\n', 'utf8');
process.exit(1);
`,
      'utf8',
    );

    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-dev-runtime'),
      'utf8',
    );

    await createAppFixture(appA, {
      scripts: {
        dev: 'node dev-should-not-run.mjs',
        'dev:runtime': 'node dev-runtime.mjs',
      },
    });

    const up = await runCli(['dev', 'up', '--timeout', '15000'], appA);
    expect(up.exitCode).toBe(0);
    const parsedUp = JSON.parse(up.stdout);
    expect(parsedUp.data.action).toBe('started');
    expect(parsedUp.data.browserCommandReady).toBe(true);
    expect(parsedUp.data.session.localUrl).toContain('http://localhost:');
    expect(parsedUp.data.session.browser.status).toBe('connected');
    expect(parsedUp.data.session.browser.commandReady).toBe(true);
    expect(existsSync(fallbackMarkerPath)).toBe(false);

    const launch = parsedUp.data.launch;
    expect(launch.scriptName).toBe('dev:runtime');
    expect(launch.openBrowser).toBe(true);
    expect(typeof launch.port).toBe('number');
    expect(parsedUp.data.session.port).toBe(launch.port);
    expect(typeof parsedUp.data.logPath).toBe('string');
    expect(String(parsedUp.data.logPath)).toContain(
      path.join('.iwsdk', 'runtime', 'logs'),
    );

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode).toBe(0);
  });

  test('starts, reattaches, and stops a managed dev process', async () => {
    const fixtureScript = path.join(appA, 'dev-server.mjs');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-dev'),
      'utf8',
    );

    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-server.mjs',
      },
    });

    const up = await runCli(['dev', 'up', '--timeout', '15000'], appA);
    expect(up.exitCode).toBe(0);
    const parsedUp = JSON.parse(up.stdout);
    expect(parsedUp.data.action).toBe('started');
    expect(parsedUp.data.session.localUrl).toContain('http://localhost:');
    expect(parsedUp.data.launch.scriptName).toBe('dev:runtime');
    expect(parsedUp.data.launch.port).toBe(parsedUp.data.session.port);
    expect(parsedUp.data.launch.launcherPid).toEqual(expect.any(Number));
    if (process.platform !== 'win32') {
      expect(parsedUp.data.launch.processGroupId).toEqual(expect.any(Number));
    }
    expect(parsedUp.data.session.browser.status).toBe('connected');
    expect(parsedUp.data.session.browser.commandReady).toBe(true);

    const again = await runCli(['dev', 'up'], appA);
    expect(again.exitCode).toBe(0);
    const parsedAgain = JSON.parse(again.stdout);
    expect(parsedAgain.data.action).toBe('attached');
    expect(parsedAgain.data.browserCommandReady).toBe(true);

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode).toBe(0);
    const parsedDown = JSON.parse(down.stdout);
    expect(parsedDown.data.stopped).toBe(true);
    if (process.platform !== 'win32') {
      expect(() =>
        process.kill(-parsedUp.data.launch.processGroupId, 0),
      ).toThrow();
    }
  });

  test('coalesces simultaneous dev up calls into one spawned runtime', async () => {
    const fixtureScript = path.join(appA, 'dev-concurrent.mjs');
    const startupMarkerPath = path.join(appA, 'runtime-starts.txt');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-concurrent', { startupMarkerPath }),
      'utf8',
    );
    await createAppFixture(appA, {
      scripts: { 'dev:runtime': 'node dev-concurrent.mjs' },
    });
    const staleLockPath = getRuntimeFileLockPath(
      getRuntimeLaunchFilePath(appA),
    );
    await mkdir(staleLockPath, { recursive: true });
    await writeFile(
      path.join(staleLockPath, 'owner.json'),
      `${JSON.stringify({
        acquiredAt: Date.now() - 60_000,
        lockId: 'orphaned-lock',
        pid: 999_999_999,
      })}\n`,
      'utf8',
    );

    const [first, second] = await Promise.all([
      runCli(['dev', 'up', '--timeout', '15000'], appA),
      runCli(['dev', 'up', '--timeout', '15000'], appA),
    ]);
    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(
      [
        JSON.parse(first.stdout).data.action,
        JSON.parse(second.stdout).data.action,
      ].sort(),
    ).toEqual(['attached', 'started']);
    expect(
      (await readFile(startupMarkerPath, 'utf8')).trim().split('\n'),
    ).toHaveLength(1);

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode, down.stderr).toBe(0);
  });

  test('terminates and forgets a background launch that times out', async () => {
    const fixtureScript = path.join(appA, 'dev-never-registers.mjs');
    const pidPath = path.join(appA, 'dev-never-registers.pid');
    await writeFile(
      fixtureScript,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pidPath)}, String(process.pid), 'utf8');
setInterval(() => {}, 1000);
`,
      'utf8',
    );
    await createAppFixture(appA, {
      scripts: { 'dev:runtime': 'node dev-never-registers.mjs' },
    });

    const up = await runCli(
      ['dev', 'up', '--no-open', '--timeout', '1000'],
      appA,
    );
    expect(up.exitCode).toBe(1);
    const parsedUp = JSON.parse(up.stderr);
    expect(parsedUp.error).toMatchObject({
      code: 'dev_up_timeout',
      details: { cleanupConfirmed: true },
    });
    expect(existsSync(getRuntimeLaunchFilePath(appA))).toBe(false);

    const runtimePid = Number(await readFile(pidPath, 'utf8'));
    expect(() => process.kill(runtimePid, 0)).toThrow();

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode, down.stderr).toBe(0);
    expect(JSON.parse(down.stdout).data.stopped).toBe(false);
  });

  test('treats dev down as a clean stop for a foreground dev process', async () => {
    const fixtureScript = path.join(appA, 'dev-foreground.mjs');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-foreground'),
      'utf8',
    );
    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-foreground.mjs',
      },
    });

    const foreground = spawn(
      'node',
      [CLI_PATH, 'dev', 'up', '--foreground', '--timeout', '15000'],
      {
        cwd: appA,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    foreground.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    foreground.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const foregroundExit = new Promise<number>((resolve, reject) => {
      foreground.on('error', reject);
      foreground.on('close', (exitCode) => resolve(exitCode ?? 1));
    });

    await waitForOutput(() => stdout, '[IWSDK] Runtime ready at');
    const attached = await runCli(['dev', 'up', '--timeout', '15000'], appA);
    expect(attached.exitCode, attached.stderr).toBe(0);
    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode, down.stderr).toBe(0);

    const foregroundExitCode = await foregroundExit;
    expect(
      foregroundExitCode,
      `foreground stdout:\n${stdout}\nforeground stderr:\n${stderr}`,
    ).toBe(0);
    expect(stdout).toContain('[IWSDK] Runtime ready at');
    expect(stderr).not.toContain('dev_up_exit');
  });

  test('treats Ctrl-C during browser readiness as a clean cancellation', async () => {
    const fixtureScript = path.join(appA, 'dev-cancel-readiness.mjs');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-cancel-readiness', {
        probeReadyDelayMs: 10_000,
      }),
      'utf8',
    );
    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-cancel-readiness.mjs',
      },
    });

    const foreground = spawn(
      'node',
      [CLI_PATH, 'dev', 'up', '--foreground', '--timeout', '15000'],
      {
        cwd: appA,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    foreground.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    foreground.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const foregroundExit = new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      foreground.on('error', reject);
      foreground.on('close', (exitCode, signal) =>
        resolve({ exitCode, signal }),
      );
    });

    await waitForSessionFile(getRuntimeSessionFilePath(appA));
    foreground.kill('SIGINT');
    const exit = await foregroundExit;

    expect(exit).toEqual({ exitCode: 130, signal: null });
    expect(stdout).not.toContain('dev_browser_not_ready');
    expect(stderr).not.toContain('dev_browser_not_ready');
  });

  test('waits for browser command readiness before reporting dev up success', async () => {
    const fixtureScript = path.join(appA, 'dev-probe-delay.mjs');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-probe-delay', {
        finalBrowserDelayMs: 25,
        probeReadyDelayMs: 700,
      }),
      'utf8',
    );

    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-probe-delay.mjs',
      },
    });

    const startedAt = Date.now();
    const up = await runCli(['dev', 'up', '--timeout', '15000'], appA);
    const elapsedMs = Date.now() - startedAt;
    expect(up.exitCode).toBe(0);
    const parsedUp = JSON.parse(up.stdout);
    expect(parsedUp.data.browserCommandReady).toBe(true);
    expect(parsedUp.data.session.browser.commandReady).toBe(true);
    expect(parsedUp.data.session.browser.lastCommandReadyAt).toEqual(
      expect.any(String),
    );
    expect(elapsedMs).toBeGreaterThanOrEqual(650);

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode).toBe(0);
  });

  test('reports lifecycle-managed startup before browser command readiness', async () => {
    const fixtureScript = path.join(appA, 'dev-lifecycle-launching.mjs');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-lifecycle-launching', {
        finalBrowserDelayMs: 10_000,
        includeLifecycle: true,
      }),
      'utf8',
    );
    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-lifecycle-launching.mjs',
      },
    });

    const startedAt = Date.now();
    const up = await runCli(['dev', 'up', '--timeout', '15000'], appA);
    expect(up.exitCode, up.stderr).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(JSON.parse(up.stdout).data).toMatchObject({
      action: 'started',
      browserCommandReady: false,
      browserIssue: null,
      browserNextAction: 'Use runtime_wait to observe launch progress.',
      session: {
        browser: {
          commandReady: false,
          lifecycle: { state: 'launching' },
        },
      },
    });

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode, down.stderr).toBe(0);
  });

  test('returns workspace-only command-ready probe state when session persistence lags', async () => {
    const fixtureScript = path.join(appA, 'dev-probe-session-lag.mjs');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-probe-session-lag', {
        finalBrowserDelayMs: 25,
        probeWritesSession: false,
        workspaceOnly: true,
      }),
      'utf8',
    );

    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-probe-session-lag.mjs',
      },
    });

    const up = await runCli(['dev', 'up', '--timeout', '15000'], appA);
    expect(up.exitCode, up.stderr).toBe(0);
    const parsedUp = JSON.parse(up.stdout);
    expect(parsedUp.data.session.aiMode).toBeUndefined();
    expect(parsedUp.data.session.browser.status).toBe('connected');
    expect(parsedUp.data.session.browser.commandReady).toBe(true);

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode).toBe(0);
  });

  test('keeps the server available while browser commands warm up', async () => {
    const fixtureScript = path.join(appA, 'dev-workspace-only.mjs');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-workspace-only', {
        finalBrowserDelayMs: 100,
        finalBrowserStatus: 'waiting_for_connection',
        workspaceOnly: true,
      }),
      'utf8',
    );

    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-workspace-only.mjs',
      },
    });

    const up = await runCli(['dev', 'up', '--timeout', '750'], appA);
    expect(up.exitCode).toBe(0);
    const parsedUp = JSON.parse(up.stdout);
    expect(parsedUp.data.session.aiMode).toBeUndefined();
    expect(parsedUp.data.session.browser.status).toBe('waiting_for_connection');
    expect(parsedUp.data.session.browser.commandReady).toBe(false);
    expect(parsedUp.data.session.browser.lastCommandReadyAt).toBeUndefined();

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode).toBe(0);
  });

  test('waits for browser command readiness when attaching to an existing runtime', async () => {
    const fixtureScript = path.join(appA, 'dev-attach-probe-delay.mjs');
    const sessionFile = getRuntimeSessionFilePath(appA);
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-attach-probe-delay', {
        initialBrowserStatus: 'connected',
        finalBrowserStatus: 'connected',
        finalBrowserDelayMs: 0,
        probeReadyDelayMs: 700,
      }),
      'utf8',
    );

    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-attach-probe-delay.mjs',
      },
    });

    const runtime = spawn('node', [fixtureScript], {
      cwd: appA,
      env: process.env,
      stdio: 'ignore',
    });

    try {
      await waitForSessionFile(sessionFile);
      const startedAt = Date.now();
      const up = await runCli(['dev', 'up', '--timeout', '15000'], appA);
      const elapsedMs = Date.now() - startedAt;
      expect(up.exitCode).toBe(0);
      const parsedUp = JSON.parse(up.stdout);
      expect(parsedUp.data.action).toBe('attached');
      expect(parsedUp.data.session.browser.commandReady).toBe(true);
      expect(parsedUp.data.session.browser.lastCommandReadyAt).toEqual(
        expect.any(String),
      );
      expect(elapsedMs).toBeGreaterThanOrEqual(650);
    } finally {
      const down = await runCli(['dev', 'down'], appA);
      expect(down.exitCode).toBe(0);
      if (runtime.exitCode === null) {
        runtime.kill('SIGKILL');
      }
    }
  });

  test('attaches to legacy connected runtimes that do not publish commandReady', async () => {
    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node -e "setInterval(() => {}, 1000)"',
      },
    });

    const keeper = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: appA,
      env: process.env,
      stdio: 'ignore',
    });
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const sessionFile = getRuntimeSessionFilePath(appA);
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(
      sessionFile,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          sessionId: 'legacy-session',
          workspaceRoot: await realpath(appA),
          pid: keeper.pid,
          port,
          localUrl: `http://localhost:${port}`,
          networkUrls: [],
          aiMode: 'agent',
          aiTools: ['claude', 'cursor'],
          browser: {
            status: 'connected',
            connected: true,
            connectedClientCount: 1,
            lastTransitionAt: new Date().toISOString(),
          },
          registeredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    try {
      const up = await runCli(['dev', 'up', '--timeout', '1500'], appA);
      expect(up.exitCode).toBe(0);
      const parsedUp = JSON.parse(up.stdout);
      expect(parsedUp.data.action).toBe('attached');

      const status = await runCli(['status'], appA);
      expect(status.exitCode).toBe(0);
      const parsedStatus = JSON.parse(status.stdout);
      expect(parsedStatus.data.state.browserConnected).toBe(true);
      expect(parsedStatus.data.state.browserCommandReady).toBe(true);

      const down = await runCli(['dev', 'down'], appA);
      expect(down.exitCode).toBe(1);
      expect(JSON.parse(down.stderr).error.message).toContain(
        'no verifiable owner endpoint',
      );
      expect(keeper.exitCode).toBeNull();
      expect(keeper.signalCode).toBeNull();
    } finally {
      await unregisterRuntimeSession(appA);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (keeper.pid && keeper.exitCode === null) {
        keeper.kill('SIGKILL');
      }
    }
  });

  test('does not sync adapters when the runtime explicitly disables AI tools', async () => {
    const runtime = await startRuntimeFixture(appA, { aiTools: [] });

    try {
      const up = await runCli(['dev', 'up'], appA);
      expect(up.exitCode).toBe(0);
      const parsedUp = JSON.parse(up.stdout);
      expect(parsedUp.data.action).toBe('attached');
      expect(
        parsedUp.data.adapters.every(
          (entry: { status: string }) => entry.status === 'missing',
        ),
      ).toBe(true);
      expect(existsSync(path.join(appA, '.mcp.json'))).toBe(false);
      expect(existsSync(path.join(appA, '.cursor', 'mcp.json'))).toBe(false);
      expect(existsSync(path.join(appA, '.vscode', 'mcp.json'))).toBe(false);
      expect(existsSync(path.join(appA, '.codex', 'config.toml'))).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  test('keeps the server running when managed browser launch fails', async () => {
    const fixtureScript = path.join(appA, 'dev-browser-fail.mjs');
    await writeFile(
      fixtureScript,
      buildManagedRuntimeScript('fixture-browser-fail', {
        finalBrowserStatus: 'launch_failed',
        finalBrowserDelayMs: 50,
        workspaceOnly: true,
        finalBrowserError: {
          cause: 'browser_launch_failed',
          message: 'Playwright sandbox denied',
          at: new Date().toISOString(),
        },
      }),
      'utf8',
    );

    await createAppFixture(appA, {
      scripts: {
        'dev:runtime': 'node dev-browser-fail.mjs',
      },
    });

    const up = await runCli(['dev', 'up', '--timeout', '5000'], appA);
    expect(up.exitCode).toBe(0);
    const parsedUp = JSON.parse(up.stdout);
    expect(parsedUp.data.session.browser.status).toBe('launch_failed');
    expect(parsedUp.data.session.browser.lastError.message).toContain(
      'Playwright sandbox denied',
    );

    const down = await runCli(['dev', 'down'], appA);
    expect(down.exitCode).toBe(0);
  });

  test('fails fast when dev:runtime is missing', async () => {
    await createAppFixture(appA, {
      scripts: {
        dev: 'vite',
      },
    });

    const up = await runCli(['dev', 'up'], appA);
    expect(up.exitCode).toBe(1);
    const parsedUp = JSON.parse(up.stderr);
    expect(parsedUp.error.message).toContain(
      'Missing required "dev:runtime" script',
    );
  });

  test.each(['up', 'down', 'restart'])(
    'dev %s recovers a stale lifecycle session with a reused PID',
    async (action) => {
      const file = getRuntimeSessionFilePath(appA);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          sessionId: 'stale',
          workspaceRoot: await realpath(appA),
          pid: process.pid,
          processStart: 'previous-birth',
          browser: { lifecycle: { state: 'idle' } },
        }),
      );
      const result = await runCli(['dev', action, '--no-open'], appA);
      expect(existsSync(file)).toBe(false);
      if (action === 'down') {
        expect(result.exitCode).toBe(0);
      } else {
        // Reaches normal startup validation instead of attaching to stale JSON.
        expect(result.stderr).toContain('Missing required');
        expect(result.stdout).not.toContain('attached');
      }
    },
  );

  test('dev up and down find a live owner without a session registry file', async () => {
    const code = `import { acquireRuntimeOwner } from ${JSON.stringify(new URL('../dist/runtime-owner.js', import.meta.url).href)};
      await acquireRuntimeOwner(process.cwd(), 'unregistered');
      setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: appA,
      stdio: 'ignore',
    });
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => resolve()),
    );
    try {
      await expect
        .poll(
          async () =>
            (await inspectRuntimeOwner(runtimeOwnerEndpoint(appA))).state,
        )
        .toBe('live');
      const up = await runCli(
        ['dev', 'up', '--no-open', '--timeout', '200'],
        appA,
      );
      expect(up.exitCode).toBe(1);
      expect(up.stderr).toContain('runtime_owner_unregistered');
      expect(existsSync(getRuntimeLaunchFilePath(appA))).toBe(false);
      const down = await runCli(['dev', 'down'], appA);
      expect(down.exitCode).toBe(0);
      expect(JSON.parse(down.stdout).data.stopped).toBe(true);
      await exited;
    } finally {
      if (child.exitCode == null && child.signalCode == null) {
        child.kill('SIGKILL');
      }
      await exited;
    }
  });

  test('attaching dev up exits promptly when the observed owner stops', async () => {
    const lease = await acquireRuntimeOwner(appA, 'stopping');
    const up = runCli(['dev', 'up', '--no-open'], appA);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await lease.release();
      const result = await up;
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'stopped while this command was attaching',
      );
    } finally {
      await lease.release();
    }
  }, 5000);
});
