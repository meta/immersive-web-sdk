/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFile, spawn } from 'child_process';
import { once } from 'events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { createServer as createNetServer } from 'net';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { withRuntimeFileLock } from '../../cli/src/runtime-files.js';
import {
  inspectRuntimeOwner,
  runtimeOwnerEndpoint,
} from '../../cli/src/runtime-owner.js';
import { getRuntimeSession } from '../../cli/src/runtime-state.js';
import { sendRuntimeCommand } from '../../cli/src/runtime-transport.js';
import { iwsdkDev } from '../src/index.js';
import { unusedPort } from './unused-port.js';

const roots: string[] = [];
const servers: ViteDevServer[] = [];
const pluginUrl = pathToFileURL(
  path.resolve(import.meta.dirname, '../dist/index.js'),
).href;
afterEach(async () => {
  for (const server of servers.splice(0)) {
    // Also breaks a failed restart's listener/cleanup dependency cycle.
    server.httpServer?.close();
    await server.close();
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});
async function setup(fromConfigFile = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-runtime-server-'));
  roots.push(root);
  await writeFile(path.join(root, 'index.html'), '<h1>Vite is alive</h1>');
  const plugin = iwsdkDev({
    https: false,
    iwer: false,
    workspace: { enabled: true, open: false },
  });
  if (fromConfigFile) {
    await writeFile(
      path.join(root, 'vite.config.mjs'),
      `import { iwsdkDev } from ${JSON.stringify(pluginUrl)};\nexport default { plugins: [iwsdkDev({ https: false, iwer: false, workspace: { enabled: true, open: false } })] };\n`,
    );
  }
  const server = await createServer({
    root,
    configFile: fromConfigFile ? undefined : false,
    logLevel: 'silent',
    plugins: fromConfigFile ? [] : [plugin],
    server: { host: '127.0.0.1', port: await unusedPort() },
  });
  servers.push(server);
  await server.listen();
  await expect.poll(() => getRuntimeSession(root)).not.toBeNull();
  return { root, server };
}

describe('real Vite lifecycle without a target', () => {
  // A configured port alone fails closed: the singleton runtime never moves.
  test.each([
    ['a strict-port', { strictPort: true }],
    ['a configured-port', {}],
  ])('releases ownership when %s bind fails', async (_name, strictness) => {
    const blocker = createNetServer();
    try {
      blocker.listen(0, '127.0.0.1');
      await once(blocker, 'listening');
      const address = blocker.address();
      expect(typeof address).toBe('object');
      const occupiedPort = (address as { port: number }).port;

      const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-bind-failure-'));
      roots.push(root);
      await writeFile(path.join(root, 'index.html'), '<h1>Vite is alive</h1>');
      const server = await createServer({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          iwsdkDev({
            https: false,
            iwer: false,
            workspace: { enabled: true, open: false },
          }),
        ],
        server: {
          host: '127.0.0.1',
          port: occupiedPort,
          ...strictness,
        },
      });
      servers.push(server);

      await expect(server.listen()).rejects.toThrow(
        `Port ${occupiedPort} is already in use`,
      );
      expect(await getRuntimeSession(root)).toBeNull();
      expect(
        (await inspectRuntimeOwner(runtimeOwnerEndpoint(root))).state,
      ).toBe('absent');
    } finally {
      if (blocker.listening) {
        await new Promise<void>((resolve, reject) =>
          blocker.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  test('closes a listener whose bind completes during shutdown', async () => {
    let closing: Promise<void> | undefined;
    const closeDuringBind: Plugin = {
      name: 'close-during-bind',
      configureServer(server) {
        const listen = server.httpServer!.listen.bind(server.httpServer);
        server.httpServer!.listen = ((...args: Parameters<typeof listen>) => {
          const result = listen(...args);
          closing = server.close();
          return result;
        }) as typeof server.httpServer.listen;
      },
    };
    const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-bind-close-'));
    roots.push(root);
    await writeFile(path.join(root, 'index.html'), '<h1>Vite is alive</h1>');
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        closeDuringBind,
        iwsdkDev({
          https: false,
          iwer: false,
          workspace: { enabled: true, open: false },
        }),
      ],
      server: { host: '127.0.0.1', port: 0 },
    });
    servers.push(server);

    await server.listen();
    expect(closing).toBeDefined();
    await closing;

    expect(server.httpServer?.listening).toBe(false);
    expect(await getRuntimeSession(root)).toBeNull();
    expect((await inspectRuntimeOwner(runtimeOwnerEndpoint(root))).state).toBe(
      'absent',
    );
  });

  test('retains singleton ownership while Vite retries an occupied port', async () => {
    const blocker = createNetServer();
    try {
      blocker.listen(0, '127.0.0.1');
      await once(blocker, 'listening');
      const address = blocker.address();
      expect(typeof address).toBe('object');
      const occupiedPort = (address as { port: number }).port;

      const root = await mkdtemp(
        path.join(os.tmpdir(), 'iwsdk-port-fallback-'),
      );
      roots.push(root);
      await writeFile(path.join(root, 'index.html'), '<h1>Vite is alive</h1>');
      const server = await createServer({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          iwsdkDev({
            https: false,
            iwer: false,
            workspace: { enabled: true, open: false },
          }),
        ],
        // Only an explicit opt-out lets Vite move a configured port.
        server: { host: '127.0.0.1', port: occupiedPort, strictPort: false },
      });
      servers.push(server);
      await server.listen();
      await expect.poll(() => getRuntimeSession(root)).not.toBeNull();
      const session = (await getRuntimeSession(root))!;
      expect(session.port).not.toBe(occupiedPort);
      expect(server.resolvedUrls?.local[0]).toContain(`:${session.port}/`);
      expect(
        (await inspectRuntimeOwner(runtimeOwnerEndpoint(root))).state,
      ).toBe('live');
    } finally {
      if (blocker.listening) {
        await new Promise<void>((resolve, reject) =>
          blocker.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  test('close joins a registration write that is still waiting for its lock', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'iwsdk-close-registration-'),
    );
    roots.push(root);
    let unlock!: () => void;
    let acquired = false;
    const blocked = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const lock = withRuntimeFileLock(
      path.join(root, '.iwsdk/runtime/session.json'),
      async () => {
        acquired = true;
        await blocked;
      },
    );
    await expect.poll(() => acquired).toBe(true);
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        iwsdkDev({
          https: false,
          iwer: false,
          workspace: { enabled: true, open: false },
        }),
      ],
      server: { host: '127.0.0.1', port: await unusedPort() },
    });
    servers.push(server);
    try {
      await server.listen();
      let closed = false;
      const closing = server.close().then(() => {
        closed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(closed).toBe(false);
      expect(
        (await inspectRuntimeOwner(runtimeOwnerEndpoint(root))).state,
      ).toBe('live');
      unlock();
      await lock;
      await closing;
      expect(await getRuntimeSession(root)).toBeNull();
      expect(
        (await inspectRuntimeOwner(runtimeOwnerEndpoint(root))).state,
      ).toBe('absent');
    } finally {
      unlock();
      await lock;
    }
  });
  test('private runtime records and profiles are inaccessible over HTTP', async () => {
    const { root, server } = await setup();
    const profile = path.join(root, '.iwsdk/runtime/chromium/Default');
    await mkdir(profile, { recursive: true });
    await writeFile(path.join(profile, 'Cookies'), 'private-cookie-secret');
    for (const pathname of [
      '/.iwsdk/runtime/session.json',
      '/.iwsdk/runtime/command-credential.json',
      '/.iwsdk/runtime/owner.json',
      '/.iwsdk/runtime/chromium/Default/Cookies',
      '/%2eiwsdk/runtime/session.json',
      '/.iwsdk%2fruntime%2fsession.json?raw',
      '/%252eiwsdk/runtime/session.json',
      `/@fs/${root}/.iwsdk/runtime/session.json`,
    ]) {
      const response = await fetch(
        new URL(pathname, server.resolvedUrls!.local[0]),
      );
      expect([403, 404], pathname).toContain(response.status);
      expect(await response.text()).not.toContain('private-cookie-secret');
    }
  });
  test.each([
    { origin: 'https://untrusted.invalid' },
    {
      origin: 'http://rebind.attacker.test',
      headers: { Host: 'rebind.attacker.test' },
    },
  ])(
    'rejects cross-origin and rebinding control websockets: %j',
    async (headers) => {
      const { root } = await setup();
      const session = (await getRuntimeSession(root))!;
      const socket = new WebSocket(
        `ws://127.0.0.1:${session.port}/__iwer_mcp`,
        headers,
      );
      try {
        const status = await new Promise<number>((resolve, reject) => {
          socket.once('unexpected-response', (_request, response) => {
            response.resume();
            resolve(response.statusCode!);
          });
          socket.once('open', () =>
            reject(new Error('Cross-origin socket unexpectedly opened')),
          );
          socket.once('error', reject);
        });
        expect(status).toBe(403);
      } finally {
        socket.terminate();
      }
      await expect(
        sendRuntimeCommand({
          port: session.port,
          method: 'runtime_get_status',
          runtimeSession: session,
        }),
      ).resolves.toMatchObject({ result: { serverReady: true } });
      await expect(
        sendRuntimeCommand({
          port: session.port,
          method: 'runtime_wait',
          params: { timeoutMs: -1 },
          runtimeSession: session,
        }),
      ).rejects.toMatchObject({
        details: { code: 'invalid_params', outcome: 'not_executed' },
      });
      await expect(
        sendRuntimeCommand({
          port: session.port,
          method: 'runtime_get_status',
          params: { runtimeTarget: { deviceClass: 'managed' } },
          runtimeSession: session,
        }),
      ).rejects.toMatchObject({
        details: { code: 'invalid_target', outcome: 'not_executed' },
      });
    },
  );
  test('control commands need the session credential from .iwsdk/runtime', async () => {
    const { root, server } = await setup();
    const session = (await getRuntimeSession(root))!;
    const credentialPath = path.join(
      root,
      '.iwsdk/runtime/command-credential.json',
    );
    const credential = JSON.parse(await readFile(credentialPath, 'utf8'));
    expect(credential).toEqual({
      schemaVersion: 2,
      sessionId: session.sessionId,
      commandToken: expect.stringMatching(/^[\w-]{43}$/),
    });
    if (process.platform !== 'win32') {
      expect((await stat(credentialPath)).mode & 0o777).toBe(0o600);
    }
    expect(JSON.stringify(session)).not.toContain(credential.commandToken);

    const socket = new WebSocket(`ws://127.0.0.1:${session.port}/__iwer_mcp`);
    await once(socket, 'open');
    const reply = (message: Record<string, unknown>) =>
      new Promise<any>((resolve) => {
        socket.once('message', (raw) => resolve(JSON.parse(raw.toString())));
        socket.send(JSON.stringify(message));
      });
    try {
      expect(
        await reply({ id: 'anonymous', method: 'runtime_get_status' }),
      ).toMatchObject({
        id: 'anonymous',
        error: {
          code: -32001,
          data: { code: 'runtime_unauthorized', outcome: 'not_executed' },
        },
      });
      expect(
        await reply({
          id: 'forged',
          method: 'runtime_pair_headset',
          params: { headsetId: 'quest' },
          commandToken: 'x'.repeat(43),
        }),
      ).toMatchObject({ id: 'forged', error: { code: -32001 } });
      // A stale CLI still gets the recoverable ownership error first.
      expect(
        await reply({
          id: 'stale',
          method: 'runtime_get_status',
          expectedSessionId: 'previous-session',
        }),
      ).toMatchObject({
        id: 'stale',
        error: { code: -32004, data: { code: 'stale_runtime_owner' } },
      });
      expect(
        await reply({
          id: 'credentialed',
          method: 'runtime_get_status',
          commandToken: credential.commandToken,
        }),
      ).toMatchObject({
        id: 'credentialed',
        result: { serverReady: true, sessionId: session.sessionId },
      });
    } finally {
      socket.terminate();
    }
    // The CLI transport reads the credential for the session it resolved.
    await expect(
      sendRuntimeCommand({
        port: session.port,
        method: 'runtime_get_status',
        runtimeSession: session,
      }),
    ).resolves.toMatchObject({ result: { sessionId: session.sessionId } });

    await server.close();
    await expect(readFile(credentialPath, 'utf8')).rejects.toThrow();
  });
  test('serves normally with no browser and pure observation never launches it', async () => {
    const { root, server } = await setup();
    const session = (await getRuntimeSession(root))!;
    const response = await sendRuntimeCommand({
      port: session.port,
      method: 'runtime_get_status',
      runtimeSession: session,
    });
    expect(response.result).toMatchObject({
      serverReady: true,
      targets: [],
      browser: {
        lifecycle: { state: 'idle', policy: 'disabled', browserEpoch: 0 },
      },
    });
    expect(await (await fetch(server.resolvedUrls!.local[0])).text()).toContain(
      'Vite is alive',
    );
  });
  test.each([false, true])(
    'restarts on the same application port (fresh config plugin: %s)',
    async (fromConfigFile) => {
      const { root, server } = await setup(fromConfigFile);
      const before = (await getRuntimeSession(root))!;
      await server.restart();
      await expect
        .poll(async () => {
          const current = await getRuntimeSession(root);
          return current != null && current.sessionId !== before.sessionId;
        })
        .toBe(true);
      const after = (await getRuntimeSession(root))!;
      expect(after.port).toBe(before.port);
      expect(
        await (await fetch(server.resolvedUrls!.local[0])).text(),
      ).toContain('Vite is alive');
    },
    15000,
  );
  test.each(['SIGTERM', 'dev down', 'dev restart'])(
    '%s releases the real runtime owner and application port',
    async (action) => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), 'iwsdk-runtime-signal-'),
      );
      roots.push(root);
      const script = path.join(root, 'run.mjs');
      await writeFile(path.join(root, 'index.html'), '<h1>Vite is alive</h1>');
      const viteUrl = pathToFileURL(
        path.resolve(
          import.meta.dirname,
          '../node_modules/vite/dist/node/index.js',
        ),
      ).href;
      await writeFile(
        script,
        `import { createServer } from ${JSON.stringify(viteUrl)};\nimport { iwsdkDev } from ${JSON.stringify(pluginUrl)};\nconst server = await createServer({ root: ${JSON.stringify(root)}, configFile: false, logLevel: 'silent', plugins: [iwsdkDev({ https: false, iwer: false, workspace: { enabled: true, open: false } })], server: { host: '127.0.0.1', port: ${await unusedPort()} } });\nawait server.listen();\nconsole.log('IWSDK_SIGNAL_READY');\n`,
      );
      await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'runtime-lifecycle-test',
          private: true,
          type: 'module',
          scripts: { 'dev:runtime': 'node run.mjs' },
          devDependencies: { '@iwsdk/vite-plugin-dev': '0.0.0' },
        }),
      );
      await writeFile(
        path.join(root, 'vite.config.mjs'),
        'export default {};\n',
      );
      const cli = (...args: string[]) =>
        promisify(execFile)(
          process.execPath,
          [
            path.resolve(import.meta.dirname, '../../cli/dist/cli.js'),
            ...args,
            '--workspace',
            root,
            '--json',
          ],
          { timeout: 15000, cwd: root, env: process.env },
        );
      const child = spawn(process.execPath, [script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
      const exited = once(child, 'exit');
      try {
        await expect
          .poll(() => output, { timeout: 10000 })
          .toContain('IWSDK_SIGNAL_READY');
        await expect.poll(() => getRuntimeSession(root)).not.toBeNull();
        const before = (await getRuntimeSession(root))!;
        if (action === 'SIGTERM') {
          child.kill('SIGTERM');
        } else {
          await cli(
            'dev',
            action === 'dev down' ? 'down' : 'restart',
            '--no-open',
            '--timeout',
            '10000',
          );
        }
        await expect
          .poll(() => child.exitCode, { timeout: 5000 })
          .toBe(action === 'SIGTERM' ? 143 : 0);
        await exited;
        if (action === 'dev restart') {
          const after = (await getRuntimeSession(root))!;
          expect(after.sessionId).not.toBe(before.sessionId);
          expect(after.port).toBe(before.port);
          expect((await fetch(`http://127.0.0.1:${after.port}/`)).ok).toBe(
            true,
          );
          await cli('dev', 'down');
        }
        expect(await getRuntimeSession(root)).toBeNull();
      } finally {
        if (child.exitCode == null && child.signalCode == null) {
          child.kill('SIGKILL');
        }
        await exited;
        if (action === 'dev restart' && (await getRuntimeSession(root))) {
          await cli('dev', 'down');
        }
      }
    },
    45000,
  );
});
