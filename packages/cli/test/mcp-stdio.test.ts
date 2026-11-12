/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { type RuntimeBrowserState } from '@iwsdk/cli/contract';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  registerRuntimeSession,
  unregisterRuntimeSession,
} from './runtime-session-fixture.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0ZQAAAAASUVORK5CYII=';

let tempDir: string;
let appRoot: string;

type RuntimeResponse = {
  result?: unknown;
  error?: {
    message?: string;
    data?: Record<string, unknown>;
    cause?:
      | 'browser_not_ready'
      | 'browser_not_launched'
      | 'browser_launch_failed'
      | 'connection_lost'
      | 'permission_denied'
      | 'browser_relaunched'
      | 'tab_throttled'
      | 'open_failed';
  };
  _tabId?: string;
  _tabGeneration?: number;
};

async function createAppFixture(root: string) {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        devDependencies: {
          '@iwsdk/vite-plugin-dev': 'workspace:*',
        },
      },
      null,
      2,
    ) + '\n',
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

function createBrowserState(
  status: RuntimeBrowserState['status'] = 'connected',
): RuntimeBrowserState {
  return {
    status,
    connected: status === 'connected',
    commandReady: status === 'connected',
    connectedClientCount: status === 'connected' ? 1 : 0,
    lastTransitionAt: new Date().toISOString(),
  };
}

async function startRuntimeFixture(
  workspaceRoot: string,
  handler: (request: {
    method: string;
    params?: unknown;
    target?: unknown;
    commandToken?: unknown;
  }) => RuntimeResponse,
) {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  server.on('connection', (socket) => {
    socket.on('message', (chunk) => {
      const request = JSON.parse(chunk.toString()) as {
        id: string;
        method: string;
        params?: unknown;
        target?: unknown;
        commandToken?: unknown;
      };
      const response = handler({
        method: request.method,
        params: request.params,
        target: request.target,
        commandToken: request.commandToken,
      });
      socket.send(
        JSON.stringify({
          id: request.id,
          ...response,
        }),
      );
    });
  });

  await registerRuntimeSession({
    sessionId: `session-${path.basename(workspaceRoot)}`,
    workspaceRoot,
    pid: process.pid,
    port,
    localUrl: `http://localhost:${port}`,
    aiMode: 'agent',
    aiTools: ['claude'],
    browser: createBrowserState(),
  });

  return {
    async close() {
      await unregisterRuntimeSession(workspaceRoot);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function connectMcpClient(workspaceRoot: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'mcp', 'stdio'],
    cwd: workspaceRoot,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mcp-stdio-test', version: '1.0.0' });
  await client.connect(transport);

  return {
    client,
    async close() {
      await transport.close();
    },
  };
}

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-mcp-stdio-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  appRoot = path.join(tempDir, 'apps', 'app-a');
  await createAppFixture(appRoot);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('mcp stdio interface shaping', () => {
  test("presents the dev server's command credential on runtime commands", async () => {
    const tokens: unknown[] = [];
    const runtime = await startRuntimeFixture(appRoot, (request) => {
      tokens.push(request.commandToken);
      return { result: { sessionMode: 'immersive-vr', running: true } };
    });
    await writeFile(
      path.join(appRoot, '.iwsdk', 'runtime', 'command-credential.json'),
      JSON.stringify({
        schemaVersion: 2,
        sessionId: `session-${path.basename(appRoot)}`,
        commandToken: 'stdio-command-token',
      }),
      'utf8',
    );
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'xr_get_session_status',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(tokens).toEqual(['stdio-command-token']);
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('advertises and routes live UIKit inspection to the application page', async () => {
    let forwarded:
      | { method: string; params?: unknown; target?: unknown }
      | undefined;
    const runtime = await startRuntimeFixture(appRoot, (request) => {
      forwarded = request;
      return {
        result: {
          elements: [{ id: 'save-button', text: 'Save' }],
          limited: false,
          panel: { entityIndex: 14, name: 'Settings Panel' },
          total: 1,
        },
        _tabId: 'tab-1',
        _tabGeneration: 1,
      };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const tools = await mcp.client.listTools();
      expect(
        tools.tools.find((tool) => tool.name === 'ui_inspect'),
      ).toMatchObject({
        inputSchema: {
          required: ['entityIndex'],
        },
      });

      const result = await mcp.client.callTool({
        name: 'ui_inspect',
        arguments: {
          entityIndex: 14,
          selector: '#save-button',
        },
      });

      expect(result.isError).not.toBe(true);
      expect(forwarded).toEqual({
        method: 'ui_inspect',
        params: {
          entityIndex: 14,
          selector: '#save-button',
        },
        target: { role: 'app' },
      });
      expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({
        elements: [{ id: 'save-button', text: 'Save' }],
        panel: { entityIndex: 14, name: 'Settings Panel' },
        total: 1,
      });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('returns array payloads before the separate _tab metadata block', async () => {
    const runtime = await startRuntimeFixture(appRoot, ({ method }) => {
      if (method === 'get_console_logs') {
        return {
          result: [
            {
              level: 'info',
              text: 'hello from runtime',
              timestamp: '2026-04-07T00:00:00.000Z',
            },
          ],
          _tabId: 'tab-1',
          _tabGeneration: 1,
        };
      }

      return {
        result: { ok: true },
        _tabId: 'tab-1',
        _tabGeneration: 1,
      };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'browser_get_console_logs',
        arguments: { count: 20, level: ['info'] },
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(2);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[1]?.type).toBe('text');
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual([
        {
          level: 'info',
          text: 'hello from runtime',
          timestamp: '2026-04-07T00:00:00.000Z',
        },
      ]);
      expect(JSON.parse(result.content[1]?.text ?? '')).toEqual({
        _tab: { id: 'tab-1', generation: 1 },
      });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('emits a warning when the active tab reloads', async () => {
    let currentTabId = 'tab-1';
    let currentGeneration = 1;

    const runtime = await startRuntimeFixture(appRoot, ({ method }) => {
      if (method === 'reload_page') {
        currentGeneration = 2;
        return {
          result: { reloaded: true },
          _tabId: currentTabId,
          _tabGeneration: currentGeneration,
        };
      }

      return {
        result: { sessionOffered: true, sessionActive: false },
        _tabId: currentTabId,
        _tabGeneration: currentGeneration,
      };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const initial = await mcp.client.callTool({
        name: 'xr_get_session_status',
        arguments: {},
      });
      expect(initial.isError).not.toBe(true);

      const reloaded = await mcp.client.callTool({
        name: 'browser_reload_page',
        arguments: {},
      });
      expect(reloaded.isError).not.toBe(true);
      expect(reloaded.content[0]?.type).toBe('text');
      expect(reloaded.content[0]?.text).toContain(
        'Active browser tab reloaded',
      );
      expect(JSON.parse(reloaded.content[1]?.text ?? '')).toMatchObject({
        reloaded: true,
        _tab: { id: 'tab-1', generation: 2 },
      });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('persists browser screenshots and returns a compact path', async () => {
    let observedTarget: unknown;
    const runtime = await startRuntimeFixture(appRoot, ({ method, target }) => {
      if (method === 'screenshot') {
        observedTarget = target;
        return {
          result: {
            imageData: ONE_BY_ONE_PNG_BASE64,
            mimeType: 'image/png',
          },
          _tabId: 'tab-1',
          _tabGeneration: 1,
        };
      }

      return {
        result: { ok: true },
        _tabId: 'tab-1',
        _tabGeneration: 1,
      };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'browser_screenshot',
        arguments: {},
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      const payload = JSON.parse(result.content[0]?.text ?? '');
      expect(payload).toMatchObject({
        _tab: { generation: 1, id: 'tab-1' },
        mimeType: 'image/png',
      });
      expect(payload.imageData).toBeUndefined();
      expect(path.isAbsolute(payload.screenshotPath)).toBe(true);
      expect(await readFile(payload.screenshotPath, 'base64')).toBe(
        ONE_BY_ONE_PNG_BASE64,
      );
      await rm(payload.screenshotPath, { force: true });
      expect(observedTarget).toEqual({ role: 'app' });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('persists browser filmstrips and returns a compact path', async () => {
    let observed: { method?: string; params?: unknown; target?: unknown } = {};
    const runtime = await startRuntimeFixture(
      appRoot,
      ({ method, params, target }) => {
        if (method === 'browser_filmstrip') {
          observed = { method, params, target };
          return {
            result: {
              imageData: ONE_BY_ONE_PNG_BASE64,
              mimeType: 'image/png',
              frameOffsets: [0, 5],
            },
            _tabId: 'tab-1',
            _tabGeneration: 1,
          };
        }
        return { result: { ok: true }, _tabId: 'tab-1', _tabGeneration: 1 };
      },
    );
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'browser_filmstrip',
        arguments: { count: 2, every: 5 },
      });

      expect(result.isError).not.toBe(true);
      const payload = JSON.parse(
        (result.content as Array<{ text?: string }>)[0]?.text ?? '',
      );
      expect(payload).toMatchObject({
        frameOffsets: [0, 5],
        mimeType: 'image/png',
      });
      expect(payload.imageData).toBeUndefined();
      expect(path.isAbsolute(payload.screenshotPath)).toBe(true);
      expect(await readFile(payload.screenshotPath, 'base64')).toBe(
        ONE_BY_ONE_PNG_BASE64,
      );
      await rm(payload.screenshotPath, { force: true });
      expect(observed).toMatchObject({
        method: 'browser_filmstrip',
        params: { count: 2, every: 5 },
        target: { role: 'app' },
      });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('returns browser interaction failures with structured recovery evidence', async () => {
    let observedTarget: unknown;
    const runtime = await startRuntimeFixture(appRoot, ({ method, target }) => {
      if (method === 'browser_interact') {
        observedTarget = target;
        return {
          result: {
            application: {
              generation: 1,
              id: 'tab-1',
              url: 'https://localhost:5173/',
            },
            completed: [],
            failure: {
              action: 'click',
              index: 0,
              message: 'element detached',
              retryable: true,
              screenshot: {
                imageData: ONE_BY_ONE_PNG_BASE64,
              },
              snapshot: null,
            },
            success: false,
          },
          _tabId: 'tab-1',
          _tabGeneration: 1,
        };
      }
      return { result: { ok: true } };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'browser_interact',
        arguments: { steps: [{ action: 'click', ref: 'e1' }] },
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(3);
      expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({
        failure: {
          action: 'click',
          index: 0,
          retryable: true,
          screenshot: { captured: true, mimeType: 'image/png' },
        },
        success: false,
      });
      expect(result.content[1]).toMatchObject({
        type: 'image',
        data: ONE_BY_ONE_PNG_BASE64,
        mimeType: 'image/png',
      });
      expect(JSON.parse(result.content[2]?.text ?? '')).toEqual({
        _tab: { id: 'tab-1', generation: 1 },
      });
      expect(observedTarget).toEqual({ role: 'app' });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('routes native scene screenshots to the editor page target', async () => {
    let observedTarget: unknown;
    const runtime = await startRuntimeFixture(appRoot, ({ method, target }) => {
      if (method === 'scene_screenshot') {
        observedTarget = target;
        return {
          result: {
            imageData: ONE_BY_ONE_PNG_BASE64,
            mimeType: 'image/png',
          },
          _tabId: 'editor-tab',
          _tabGeneration: 1,
        };
      }

      return {
        result: { ok: true },
        _tabId: 'tab-1',
        _tabGeneration: 1,
      };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'scene_screenshot',
        arguments: { view: 'top' },
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      const payload = JSON.parse(result.content[0]?.text ?? '');
      expect(payload).toMatchObject({
        _tab: { generation: 1, id: 'editor-tab' },
        mimeType: 'image/png',
      });
      expect(payload.imageData).toBeUndefined();
      expect(await readFile(payload.screenshotPath, 'base64')).toBe(
        ONE_BY_ONE_PNG_BASE64,
      );
      await rm(payload.screenshotPath, { force: true });
      expect(observedTarget).toEqual({ role: 'editor' });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('returns render-file metadata with a persisted PNG path', async () => {
    const runtime = await startRuntimeFixture(appRoot, ({ method }) => {
      if (method === 'scene_render_file') {
        return {
          result: {
            composedDocumentHash: `sha256:${'a'.repeat(64)}`,
            diagnostics: [],
            imageData: ONE_BY_ONE_PNG_BASE64,
            mimeType: 'image/png',
            path: 'public/scenes/test.iwsdk.scene.json',
            valid: true,
          },
          _tabId: 'editor-tab',
          _tabGeneration: 2,
        };
      }
      return { result: { ok: true } };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'scene_render_file',
        arguments: { path: 'public/scenes/test.iwsdk.scene.json' },
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      const payload = JSON.parse(result.content[0]?.text ?? '');
      expect(payload).toMatchObject({
        _tab: { generation: 2, id: 'editor-tab' },
        mimeType: 'image/png',
        path: 'public/scenes/test.iwsdk.scene.json',
        valid: true,
      });
      expect(payload.imageData).toBeUndefined();
      expect(await readFile(payload.screenshotPath, 'base64')).toBe(
        ONE_BY_ONE_PNG_BASE64,
      );
      await rm(payload.screenshotPath, { force: true });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('returns model-preview diagnostics with a persisted PNG path', async () => {
    const runtime = await startRuntimeFixture(appRoot, ({ method }) => {
      if (method === 'asset_render_preview') {
        return {
          result: {
            assetId: 'ship',
            diagnostics: {
              meshCount: 12,
              namedPartCount: 518,
              namedParts: Array.from({ length: 60 }, (_, index) => ({
                bounds: {
                  max: [index + 1, index + 1, index + 1],
                  min: [index, index, index],
                },
                name: `Part${index}`,
                path: `Ship/Part${index}`,
                type: 'Mesh',
              })),
              namedPartsTruncated: true,
              renderedTriangles: 480,
              warnings: [
                ...Array.from({ length: 10 }, (_, index) => ({
                  code: 'degenerate_triangles',
                  message: '4 triangles have effectively zero area.',
                  path: `Ship/Plate${index}`,
                })),
                ...Array.from({ length: 4 }, (_, index) => ({
                  code: 'missing_normals',
                  message: 'Geometry has no normal attribute.',
                  path: `Ship/Raw${index}`,
                })),
                { code: 'non_front_side_materials', message: 'Verify this.' },
              ],
            },
            imageData: ONE_BY_ONE_PNG_BASE64,
            mimeType: 'image/png',
            mode: 'clay',
            views: ['front', 'right', 'quarter'],
          },
          _tabId: 'editor-tab',
          _tabGeneration: 2,
        };
      }
      return { result: { ok: true } };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'asset_render_preview',
        arguments: { assetId: 'ship', mode: 'clay' },
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      const metadata = JSON.parse(result.content[0]?.text ?? '');
      expect(metadata).toMatchObject({
        _tab: { generation: 2, id: 'editor-tab' },
        assetId: 'ship',
        diagnostics: {
          meshCount: 12,
          namedPartCount: 518,
          namedPartsTruncated: true,
          renderedTriangles: 480,
          warningCodeCounts: {
            degenerate_triangles: 10,
            missing_normals: 4,
            non_front_side_materials: 1,
          },
          warningCount: 15,
          warningsTruncated: true,
        },
        mode: 'clay',
      });
      expect(metadata.diagnostics.namedParts).toHaveLength(40);
      expect(metadata.diagnostics.namedParts[0]).toEqual({
        name: 'Part0',
        path: 'Ship/Part0',
        type: 'Mesh',
      });
      expect(metadata.diagnostics.warnings).toHaveLength(7);
      expect(
        metadata.diagnostics.warnings.map(
          (warning: { code: string }) => warning.code,
        ),
      ).toEqual([
        'degenerate_triangles',
        'degenerate_triangles',
        'degenerate_triangles',
        'missing_normals',
        'missing_normals',
        'missing_normals',
        'non_front_side_materials',
      ]);
      expect(metadata.imageData).toBeUndefined();
      expect(await readFile(metadata.screenshotPath, 'base64')).toBe(
        ONE_BY_ONE_PNG_BASE64,
      );
      await rm(metadata.screenshotPath, { force: true });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('persists UIKit previews and returns a compact path', async () => {
    const runtime = await startRuntimeFixture(appRoot, ({ method }) => {
      if (method === 'ui_render_preview') {
        return {
          result: {
            assetId: 'panel',
            imageData: ONE_BY_ONE_PNG_BASE64,
            mimeType: 'image/png',
          },
          _tabId: 'editor-tab',
          _tabGeneration: 2,
        };
      }
      return { result: { ok: true } };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'ui_render_preview',
        arguments: { assetId: 'panel' },
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      const payload = JSON.parse(result.content[0]?.text ?? '');
      expect(payload).toMatchObject({
        _tab: { generation: 2, id: 'editor-tab' },
        assetId: 'panel',
        mimeType: 'image/png',
      });
      expect(payload.imageData).toBeUndefined();
      expect(await readFile(payload.screenshotPath, 'base64')).toBe(
        ONE_BY_ONE_PNG_BASE64,
      );
      await rm(payload.screenshotPath, { force: true });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('returns structured JSON error content with cause and browser details', async () => {
    const runtime = await startRuntimeFixture(appRoot, ({ method }) => {
      if (method === 'scene_get_state') {
        return {
          error: {
            message: 'Permission denied while reading scene state',
            cause: 'permission_denied',
            data: {
              code: 'scene_state_denied',
              issues: [{ code: 'state-unavailable' }],
              recoverable: false,
              retryAction: 'scene_get_state',
            },
          },
          _tabId: 'tab-1',
          _tabGeneration: 1,
        };
      }

      return {
        result: { ok: true },
        _tabId: 'tab-1',
        _tabGeneration: 1,
      };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'scene_get_state',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const payload = JSON.parse(result.content[0]?.text ?? '');
      expect(payload).toMatchObject({
        message: 'Permission denied while reading scene state',
        cause: 'permission_denied',
        code: 'scene_state_denied',
        issues: [{ code: 'state-unavailable' }],
        recoverable: false,
        retryAction: 'scene_get_state',
        browser: {
          status: 'connected',
          connected: true,
          commandReady: true,
          connectedClientCount: 1,
        },
      });
      expect(typeof payload.browser.lastTransitionAt).toBe('string');
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('surfaces unavailable-browser errors for console log requests', async () => {
    const runtime = await startRuntimeFixture(appRoot, ({ method }) => {
      if (method === 'get_console_logs') {
        return {
          error: {
            message: 'Playwright sandbox denied',
            cause: 'permission_denied',
          },
          _tabId: 'tab-1',
          _tabGeneration: 1,
        };
      }

      return {
        result: { ok: true },
        _tabId: 'tab-1',
        _tabGeneration: 1,
      };
    });
    const mcp = await connectMcpClient(appRoot);

    try {
      const result = await mcp.client.callTool({
        name: 'browser_get_console_logs',
        arguments: { count: 5 },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({
        message: 'Playwright sandbox denied',
        cause: 'permission_denied',
        browser: {
          status: 'connected',
          connected: true,
          commandReady: true,
          connectedClientCount: 1,
        },
      });
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });

  test('keeps managed browser status out of a headset session status', async () => {
    const runtime = await startRuntimeFixture(appRoot, () => ({
      result: { sessionOffered: true, sessionActive: true },
    }));
    const mcp = await connectMcpClient(appRoot);

    try {
      const headset = await mcp.client.callTool({
        name: 'xr_get_session_status',
        arguments: {
          runtimeTarget: {
            deviceClass: 'physical',
            headsetId: '192.168.1.5:5555',
            pageId: 'page-a',
            tabGeneration: 1,
          },
        },
      });
      expect(headset.isError).not.toBe(true);
      const headsetStatus = JSON.parse(headset.content[0]?.text ?? '');
      expect(headsetStatus).toMatchObject({ sessionActive: true });
      expect(headsetStatus).not.toHaveProperty('browserCommandReady');

      // The managed browser keeps its merged status.
      const managed = await mcp.client.callTool({
        name: 'xr_get_session_status',
        arguments: {},
      });
      expect(JSON.parse(managed.content[0]?.text ?? '')).toHaveProperty(
        'browserCommandReady',
      );
    } finally {
      await mcp.close();
      await runtime.close();
    }
  });
});
