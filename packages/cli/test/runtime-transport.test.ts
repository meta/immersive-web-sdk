/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';
import { WebSocketServer } from 'ws';
import { acquireBrowserLease } from '../src/browser-lease.js';
import {
  getDefaultRuntimeCommandTimeoutMs,
  IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
  type RuntimeSession,
} from '../src/runtime-contract.js';
import { sendRuntimeCommand } from '../src/runtime-transport.js';

describe('runtime command transport', () => {
  test('allows server and physical commands even when the managed browser is disabled', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' ? address.port : 0;
    const session = createTestRuntimeSession(port);
    session.browser = {
      status: 'not_launched',
      connected: false,
      commandReady: false,
      connectedClientCount: 0,
      lastTransitionAt: new Date().toISOString(),
    };
    const received: unknown[] = [];
    server.on('connection', (socket) =>
      socket.on('message', (data) => {
        const request = JSON.parse(data.toString());
        received.push(request);
        socket.send(JSON.stringify({ id: request.id, result: { ok: true } }));
      }),
    );
    try {
      await sendRuntimeCommand({
        port,
        method: 'runtime_list_targets',
        runtimeSession: session,
      });
      await sendRuntimeCommand({
        port,
        method: 'reload_page',
        runtimeSession: session,
        target: {
          deviceClass: 'physical',
          headsetId: 'quest',
          pageId: 'native',
          tabGeneration: 1,
        },
      });
      expect(received).toHaveLength(2);
      expect(received[1]).toMatchObject({
        expectedSessionId: session.sessionId,
        target: { headsetId: 'quest' },
      });
    } finally {
      for (const ws of server.clients) {
        ws.terminate();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("presents the dev server's command credential only for its own session", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'iwsdk-transport-credential-'),
    );
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' ? address.port : 0;
    const received: Array<Record<string, unknown>> = [];
    server.on('connection', (socket) =>
      socket.on('message', (data) => {
        const request = JSON.parse(data.toString());
        received.push(request);
        socket.send(JSON.stringify({ id: request.id, result: { ok: true } }));
      }),
    );
    const session = { ...createTestRuntimeSession(port), workspaceRoot };
    const credentialPath = path.join(
      workspaceRoot,
      IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
    );
    const send = () =>
      sendRuntimeCommand({
        port,
        method: 'runtime_get_status',
        runtimeSession: session,
      });
    try {
      // An older dev server writes no credential.
      await send();
      await mkdir(path.dirname(credentialPath), { recursive: true });
      await writeFile(
        credentialPath,
        JSON.stringify({
          schemaVersion: 2,
          sessionId: 'previous-session',
          commandToken: 'previous-token',
        }),
      );
      await send();
      await writeFile(
        credentialPath,
        JSON.stringify({
          schemaVersion: 2,
          sessionId: session.sessionId,
          commandToken: 'session-token',
        }),
      );
      await send();
      expect(received.map((request) => request.commandToken)).toEqual([
        undefined,
        undefined,
        'session-token',
      ]);
      expect(received[2]).toMatchObject({
        expectedSessionId: session.sessionId,
        method: 'runtime_get_status',
      });
    } finally {
      for (const ws of server.clients) {
        ws.terminate();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('the browser lease presents the credential when acquired and released', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'iwsdk-lease-credential-'),
    );
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' ? address.port : 0;
    const received: Array<Record<string, unknown>> = [];
    server.on('connection', (socket) =>
      socket.on('message', (data) => {
        const request = JSON.parse(data.toString());
        received.push(request);
        if (request.method === '__iwsdk_browser_lease') {
          socket.send(
            JSON.stringify({ id: request.id, result: { leased: true } }),
          );
        }
      }),
    );
    const session = { ...createTestRuntimeSession(port), workspaceRoot };
    const credentialPath = path.join(
      workspaceRoot,
      IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
    );
    await mkdir(path.dirname(credentialPath), { recursive: true });
    await writeFile(
      credentialPath,
      JSON.stringify({
        schemaVersion: 2,
        sessionId: session.sessionId,
        commandToken: 'lease-token',
      }),
    );
    try {
      const lease = await acquireBrowserLease(session, 5000);
      lease.release();
      await expect.poll(() => received.length).toBe(2);
      expect(received).toEqual([
        expect.objectContaining({
          method: '__iwsdk_browser_lease',
          commandToken: 'lease-token',
        }),
        expect.objectContaining({
          method: '__iwsdk_browser_lease_release',
          commandToken: 'lease-token',
        }),
      ]);
    } finally {
      for (const ws of server.clients) {
        ws.terminate();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('uses one timeout budget across the WSS to WS fallback path', async () => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => {
        sockets.delete(socket);
      });
      socket.on('error', () => {});
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const startedAt = Date.now();

    try {
      await expect(
        sendRuntimeCommand({
          port,
          method: 'never_responds',
          timeoutMs: 2000,
        }),
      ).rejects.toThrow();
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeLessThan(3200);
  });

  test('prefers ws first for http runtime sessions', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    server.on('connection', (socket) => {
      socket.on('message', (chunk) => {
        const request = JSON.parse(chunk.toString()) as { id: string };
        socket.send(
          JSON.stringify({
            id: request.id,
            result: { ok: true },
          }),
        );
      });
    });

    const startedAt = Date.now();
    try {
      const response = await sendRuntimeCommand({
        port,
        method: 'internal_probe',
        timeoutMs: 3000,
        runtimeSession: {
          schemaVersion: 1,
          sessionId: 'session-http',
          workspaceRoot: '/tmp/app',
          pid: process.pid,
          port,
          localUrl: `http://localhost:${port}`,
          networkUrls: [],
          aiTools: [],
          registeredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          browser: {
            status: 'connected',
            connected: true,
            commandReady: false,
            connectedClientCount: 1,
            lastTransitionAt: new Date().toISOString(),
          },
        },
      });
      expect(response.result).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeLessThan(1000);
  });

  test('sends page target metadata with runtime commands', async () => {
    const server = new WebSocketServer({ port: 0 });
    let received: unknown;
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    server.on('connection', (socket) => {
      socket.on('message', (chunk) => {
        const request = JSON.parse(chunk.toString()) as { id: string };
        received = request;
        socket.send(
          JSON.stringify({
            id: request.id,
            result: { ok: true },
          }),
        );
      });
    });

    try {
      await sendRuntimeCommand({
        port,
        method: 'scene_screenshot',
        target: { role: 'editor', sceneSessionId: 'scene-a' },
        timeoutMs: 3000,
        runtimeSession: {
          schemaVersion: 1,
          sessionId: 'session-target',
          workspaceRoot: '/tmp/app',
          pid: process.pid,
          port,
          localUrl: `http://localhost:${port}`,
          networkUrls: [],
          aiTools: [],
          registeredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          browser: {
            status: 'connected',
            connected: true,
            commandReady: true,
            connectedClientCount: 2,
            lastTransitionAt: new Date().toISOString(),
          },
        },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(received).toMatchObject({
      method: 'scene_screenshot',
      target: { role: 'editor', sceneSessionId: 'scene-a' },
    });
  });

  test('sends every sub-request the caller absolute deadline', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const scenePath = 'public/scenes/room.iwsdk.scene.json';
    const received: Array<{ id: string; method: string; deadline?: unknown }> =
      [];
    server.on('connection', (socket) =>
      socket.on('message', (chunk) => {
        const request = JSON.parse(chunk.toString());
        received.push(request);
        socket.send(
          JSON.stringify({
            id: request.id,
            result:
              request.method === 'scene_open'
                ? { opened: true, path: scenePath, reloading: true }
                : {
                    editor: {
                      ready: true,
                      scenePath,
                      sceneSessionId:
                        received.length > 2 ? 'scene-new' : 'scene-old',
                    },
                  },
          }),
        );
      }),
    );
    try {
      let before = Date.now();
      await sendRuntimeCommand({
        port,
        method: 'ecs_pause',
        runtimeSession: createTestRuntimeSession(port),
      });
      const defaultTimeoutMs = getDefaultRuntimeCommandTimeoutMs('ecs_pause');
      expect(received[0].deadline).toBeGreaterThanOrEqual(
        before + defaultTimeoutMs,
      );
      expect(received[0].deadline).toBeLessThanOrEqual(
        Date.now() + defaultTimeoutMs,
      );

      // IWER replies to a pose fade when it ends, so its duration counts.
      received.length = 0;
      before = Date.now();
      await sendRuntimeCommand({
        port,
        method: 'set_hand_pose',
        params: { device: 'hand-right', poseId: 'point', duration: 45 },
        runtimeSession: createTestRuntimeSession(port),
      });
      expect(received[0].deadline).toBeGreaterThanOrEqual(before + 75_000);
      expect(received[0].deadline).toBeLessThanOrEqual(Date.now() + 75_000);

      received.length = 0;
      before = Date.now();
      await sendRuntimeCommand({
        method: 'scene_open',
        params: { path: scenePath },
        port,
        runtimeSession: createTestRuntimeSession(port),
        timeoutMs: 4000,
      });
      expect(received.map((request) => request.method)).toEqual([
        'scene_get_state',
        'scene_open',
        'scene_get_state',
      ]);
      // Polling for readiness never restarts the budget the caller chose.
      const deadlines = new Set(received.map((request) => request.deadline));
      expect(deadlines.size).toBe(1);
      const [deadline] = deadlines as Set<number>;
      expect(deadline).toBeGreaterThanOrEqual(before + 4000);
      expect(deadline).toBeLessThanOrEqual(Date.now() + 4000);
    } finally {
      for (const ws of server.clients) {
        ws.terminate();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('classifies closed-before-response as browser_not_ready while warming', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    server.on('connection', (socket) => {
      socket.on('message', () => {
        socket.close();
      });
    });

    try {
      await expect(
        sendRuntimeCommand({
          port,
          method: 'screenshot',
          timeoutMs: 1500,
          runtimeSession: {
            schemaVersion: 1,
            sessionId: 'session-close',
            workspaceRoot: '/tmp/app',
            pid: process.pid,
            port,
            localUrl: `http://localhost:${port}`,
            networkUrls: [],
            aiTools: [],
            registeredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            browser: {
              status: 'connected',
              connected: true,
              commandReady: false,
              connectedClientCount: 1,
              lastTransitionAt: new Date().toISOString(),
            },
          },
        }),
      ).rejects.toMatchObject({
        issueCause: 'browser_not_ready',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('preserves structured browser error data on execution errors', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.on('connection', (socket) => {
      socket.on('message', (chunk) => {
        const request = JSON.parse(chunk.toString()) as { id: string };
        socket.send(
          JSON.stringify({
            error: {
              code: -32000,
              data: {
                code: 'invalid_scene',
                issues: [{ code: 'below-floor', nodeId: 'chair' }],
                lifecycle: { schemaValid: 'failed' },
                recoverable: true,
                retryAction: 'scene_render_file',
              },
              message: 'Scene is invalid',
            },
            id: request.id,
          }),
        );
      });
    });

    try {
      await expect(
        sendRuntimeCommand({
          port,
          method: 'scene_render_file',
          timeoutMs: 3000,
          runtimeSession: {
            schemaVersion: 1,
            sessionId: 'session-structured-error',
            workspaceRoot: '/tmp/app',
            pid: process.pid,
            port,
            localUrl: `http://localhost:${port}`,
            networkUrls: [],
            aiTools: [],
            registeredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            browser: {
              status: 'connected',
              connected: true,
              commandReady: true,
              connectedClientCount: 1,
              lastTransitionAt: new Date().toISOString(),
            },
          },
        }),
      ).rejects.toMatchObject({
        details: {
          code: 'invalid_scene',
          issues: [{ code: 'below-floor', nodeId: 'chair' }],
          lifecycle: { schemaValid: 'failed' },
          recoverable: true,
          retryAction: 'scene_render_file',
        },
        message: 'Scene is invalid',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('waits for scene_open to reconnect with a new session id', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const requests: Array<{
      method: string;
      target?: { role?: string; sceneSessionId?: string };
    }> = [];
    let stateRequestCount = 0;

    server.on('connection', (socket) => {
      socket.on('message', (chunk) => {
        const request = JSON.parse(chunk.toString()) as {
          id: string;
          method: string;
          target?: { role?: string; sceneSessionId?: string };
        };
        requests.push(request);
        if (request.method === 'scene_open') {
          socket.send(
            JSON.stringify({
              _tabGeneration: 3,
              _tabId: 'editor-tab',
              id: request.id,
              result: {
                opened: true,
                path: 'public/scenes/room.iwsdk.scene.json',
                reloading: true,
              },
            }),
          );
          return;
        }
        stateRequestCount += 1;
        const ready = stateRequestCount >= 3;
        socket.send(
          JSON.stringify({
            _tabGeneration: ready ? 4 : 3,
            _tabId: 'editor-tab',
            id: request.id,
            result: {
              editor: {
                ready: true,
                scenePath: 'public/scenes/room.iwsdk.scene.json',
                sceneSessionId: ready ? 'scene-new' : 'scene-old',
              },
            },
          }),
        );
      });
    });

    try {
      const response = await sendRuntimeCommand({
        method: 'scene_open',
        params: {
          path: 'public/scenes/room.iwsdk.scene.json',
        },
        port,
        runtimeSession: createTestRuntimeSession(port),
        target: { role: 'editor', sceneSessionId: 'scene-old' },
        timeoutMs: 2000,
      });
      expect(response).toMatchObject({
        _tabGeneration: 4,
        _tabId: 'editor-tab',
        result: {
          opened: true,
          path: 'public/scenes/room.iwsdk.scene.json',
          ready: true,
          reloading: false,
          sceneSessionId: 'scene-new',
        },
      });
      expect(requests.map((request) => request.method)).toEqual([
        'scene_get_state',
        'scene_open',
        'scene_get_state',
        'scene_get_state',
      ]);
      expect(
        requests
          .filter((request) => request.method === 'scene_get_state')
          .map((request) => request.target),
      ).toEqual([{ role: 'editor' }, { role: 'editor' }, { role: 'editor' }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('reports a recoverable partial success when the opened editor session never becomes ready', async () => {
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
        };
        socket.send(
          JSON.stringify({
            id: request.id,
            result:
              request.method === 'scene_open'
                ? {
                    opened: true,
                    path: 'public/scenes/stalled.iwsdk.scene.json',
                    reloading: true,
                  }
                : {
                    editor: {
                      ready: true,
                      scenePath: 'public/scenes/stalled.iwsdk.scene.json',
                      sceneSessionId: 'scene-stale',
                    },
                  },
          }),
        );
      });
    });

    try {
      await expect(
        sendRuntimeCommand({
          method: 'scene_open',
          params: { path: 'public/scenes/stalled.iwsdk.scene.json' },
          port,
          runtimeSession: createTestRuntimeSession(port),
          target: { role: 'editor', sceneSessionId: 'scene-stale' },
          timeoutMs: 180,
        }),
      ).rejects.toMatchObject({
        details: {
          code: 'scene_open_not_ready',
          opened: true,
          editorReady: false,
          lastWorkspaceState: {
            editor: {
              ready: true,
              scenePath: 'public/scenes/stalled.iwsdk.scene.json',
              sceneSessionId: 'scene-stale',
            },
          },
          path: 'public/scenes/stalled.iwsdk.scene.json',
          previousSceneSessionId: 'scene-stale',
          recoverable: true,
          retryAction: 'scene_get_state',
        },
        issueCause: 'browser_not_ready',
        message: expect.stringContaining('was opened'),
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('does not poll editor readiness for scene_render_file', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const methods: string[] = [];

    server.on('connection', (socket) => {
      socket.on('message', (chunk) => {
        const request = JSON.parse(chunk.toString()) as {
          id: string;
          method: string;
        };
        methods.push(request.method);
        socket.send(
          JSON.stringify({
            id: request.id,
            result: {
              valid: false,
              path: 'public/scenes/not-opened.iwsdk.scene.json',
            },
          }),
        );
      });
    });

    try {
      await expect(
        sendRuntimeCommand({
          method: 'scene_render_file',
          params: {
            path: 'public/scenes/not-opened.iwsdk.scene.json',
          },
          port,
          runtimeSession: createTestRuntimeSession(port),
          target: { role: 'editor' },
          timeoutMs: 1000,
        }),
      ).resolves.toMatchObject({
        result: {
          valid: false,
          path: 'public/scenes/not-opened.iwsdk.scene.json',
        },
      });
      expect(methods).toEqual(['scene_render_file']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function createTestRuntimeSession(port: number): RuntimeSession {
  const now = new Date().toISOString();
  return {
    aiTools: [],
    browser: {
      commandReady: true,
      connected: true,
      connectedClientCount: 1,
      lastTransitionAt: now,
      status: 'connected',
    },
    localUrl: `http://localhost:${port}`,
    networkUrls: [],
    pid: process.pid,
    port,
    registeredAt: now,
    schemaVersion: 1,
    sessionId: 'runtime-transport-test',
    updatedAt: now,
    workspaceRoot: '/tmp/app',
  };
}
