/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, readFile, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
  IWSDK_RUNTIME_SESSION_PATH,
} from '@iwsdk/cli/contract';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createUnavailableBrowserRpcError } from '../src/browser-rpc-errors.js';
import {
  registerRuntimeSession,
  RuntimeSessionOwnershipError,
  setRuntimeSessionBrowserState,
  unregisterRuntimeSession,
  unregisterRuntimeSessionSync,
} from '../src/runtime-session.js';

let tempDir: string;
let workspaceRoot: string;

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-plugin-runtime-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  workspaceRoot = path.join(tempDir, 'app');
  await mkdir(workspaceRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('runtime session writer', () => {
  test('writes and removes project-local runtime session files', async () => {
    const session = await registerRuntimeSession({
      sessionId: 'session-1',
      commandToken: 'token-session-1',
      workspaceRoot,
      pid: process.pid,
      port: 5174,
      localUrl: 'https://localhost:5174',
      networkUrls: ['https://192.168.1.2:5174'],
      aiMode: 'agent',
    });

    const sessionFile = path.join(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH);
    const written = JSON.parse(await readFile(sessionFile, 'utf8'));

    expect(session.port).toBe(5174);
    expect(written.port).toBe(5174);
    expect(written.localUrl).toBe('https://localhost:5174');

    await unregisterRuntimeSession(workspaceRoot, 'session-1');
    await expect(readFile(sessionFile, 'utf8')).rejects.toThrow();
  });

  test('keeps the command credential in a private file beside the session', async () => {
    await registerRuntimeSession({
      sessionId: 'credential-session',
      commandToken: 'secret-command-token',
      workspaceRoot,
      pid: process.pid,
      port: 5174,
      localUrl: 'https://localhost:5174',
    });

    const credentialFile = path.join(
      workspaceRoot,
      IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
    );
    expect(JSON.parse(await readFile(credentialFile, 'utf8'))).toEqual({
      schemaVersion: 2,
      sessionId: 'credential-session',
      commandToken: 'secret-command-token',
    });
    if (process.platform !== 'win32') {
      expect((await stat(credentialFile)).mode & 0o777).toBe(0o600);
    }
    // Status output prints the session record, so it never holds the secret.
    expect(
      await readFile(
        path.join(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH),
        'utf8',
      ),
    ).not.toContain('secret-command-token');

    await unregisterRuntimeSession(workspaceRoot, 'credential-session');
    await expect(readFile(credentialFile, 'utf8')).rejects.toThrow();
  });

  test('exit-time cleanup removes only its own command credential', async () => {
    const credentialFile = path.join(
      workspaceRoot,
      IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
    );
    await registerRuntimeSession({
      sessionId: 'exiting-session',
      commandToken: 'exiting-token',
      workspaceRoot,
      pid: process.pid,
      port: 5174,
      localUrl: 'https://localhost:5174',
    });

    unregisterRuntimeSessionSync(workspaceRoot, 'another-session');
    expect(JSON.parse(await readFile(credentialFile, 'utf8'))).toMatchObject({
      sessionId: 'exiting-session',
    });
    unregisterRuntimeSessionSync(workspaceRoot, 'exiting-session');
    await expect(readFile(credentialFile, 'utf8')).rejects.toThrow();
    await expect(
      readFile(path.join(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH), 'utf8'),
    ).rejects.toThrow();
  });

  test('updates browser readiness state incrementally', async () => {
    await registerRuntimeSession({
      sessionId: 'session-2',
      commandToken: 'token-session-2',
      workspaceRoot,
      pid: process.pid,
      port: 5175,
      localUrl: 'https://localhost:5175',
      aiMode: 'agent',
      browser: {
        status: 'launching',
        connected: false,
        commandReady: false,
        connectedClientCount: 0,
        lastTransitionAt: new Date().toISOString(),
      },
    });

    const updated = await setRuntimeSessionBrowserState(
      workspaceRoot,
      'session-2',
      {
        status: 'connected',
        connected: true,
        commandReady: true,
        connectedClientCount: 1,
        lastTransitionAt: new Date().toISOString(),
        lastBridgeConnectedAt: new Date().toISOString(),
        lastCommandReadyAt: new Date().toISOString(),
      },
    );

    const sessionFile = path.join(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH);
    const written = JSON.parse(await readFile(sessionFile, 'utf8'));
    expect(updated?.browser?.status).toBe('connected');
    expect(written.browser.connected).toBe(true);
    expect(written.browser.commandReady).toBe(true);
    expect(written.browser.connectedClientCount).toBe(1);
  });

  test('clears stale browser state when registration explicitly omits a launch', async () => {
    await registerRuntimeSession({
      sessionId: 'previous-session',
      commandToken: 'token-previous-session',
      workspaceRoot,
      pid: 2_147_483_647,
      port: 5175,
      localUrl: 'https://localhost:5175',
      browser: {
        status: 'launching',
        connected: false,
        commandReady: false,
        connectedClientCount: 0,
        lastTransitionAt: new Date().toISOString(),
      },
    });

    const restarted = await registerRuntimeSession({
      sessionId: 'workspace-open-false',
      commandToken: 'token-workspace-open-false',
      workspaceRoot,
      pid: process.pid,
      port: 5176,
      localUrl: 'https://localhost:5176',
      browser: undefined,
    });

    const sessionFile = path.join(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH);
    const written = JSON.parse(await readFile(sessionFile, 'utf8'));
    expect(restarted.browser).toBeUndefined();
    expect(written.browser).toBeUndefined();
  });

  test('serializes concurrent browser state writes so the latest update wins', async () => {
    await registerRuntimeSession({
      sessionId: 'session-3',
      commandToken: 'token-session-3',
      workspaceRoot,
      pid: process.pid,
      port: 5176,
      localUrl: 'https://localhost:5176',
      aiMode: 'agent',
      browser: {
        status: 'launching',
        connected: false,
        commandReady: false,
        connectedClientCount: 0,
        lastTransitionAt: new Date().toISOString(),
      },
    });

    const staleUpdate = setRuntimeSessionBrowserState(
      workspaceRoot,
      'session-3',
      {
        status: 'connected',
        connected: true,
        commandReady: false,
        connectedClientCount: 1,
        lastTransitionAt: new Date().toISOString(),
        lastBridgeConnectedAt: new Date().toISOString(),
        lastError: {
          cause: 'browser_not_ready',
          message: 'warming'.repeat(256 * 1024),
          at: new Date().toISOString(),
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const readyUpdate = setRuntimeSessionBrowserState(
      workspaceRoot,
      'session-3',
      {
        status: 'connected',
        connected: true,
        commandReady: true,
        connectedClientCount: 1,
        lastTransitionAt: new Date().toISOString(),
        lastBridgeConnectedAt: new Date().toISOString(),
        lastCommandReadyAt: new Date().toISOString(),
      },
    );

    await Promise.all([staleUpdate, readyUpdate]);

    const sessionFile = path.join(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH);
    const written = JSON.parse(await readFile(sessionFile, 'utf8'));
    expect(written.browser.connected).toBe(true);
    expect(written.browser.commandReady).toBe(true);
    expect(written.browser.lastError).toBeUndefined();
  });

  test('rejects a second live owner for the same workspace', async () => {
    await registerRuntimeSession({
      sessionId: 'owner-session',
      commandToken: 'token-owner-session',
      workspaceRoot,
      pid: process.ppid,
      port: 5176,
      localUrl: 'https://localhost:5176',
    });

    await expect(
      registerRuntimeSession({
        sessionId: 'duplicate-session',
        commandToken: 'token-duplicate-session',
        workspaceRoot,
        pid: process.pid,
        port: 5177,
        localUrl: 'https://localhost:5177',
      }),
    ).rejects.toBeInstanceOf(RuntimeSessionOwnershipError);
    // The refused server never replaces the owner's credential.
    expect(
      JSON.parse(
        await readFile(
          path.join(workspaceRoot, IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH),
          'utf8',
        ),
      ),
    ).toMatchObject({ commandToken: 'token-owner-session' });
  });

  test('allows an in-process plugin restart to replace its stale session id', async () => {
    await registerRuntimeSession({
      sessionId: 'before-restart',
      commandToken: 'token-before-restart',
      workspaceRoot,
      pid: process.pid,
      port: 5176,
      localUrl: 'https://localhost:5176',
    });

    const restarted = await registerRuntimeSession({
      sessionId: 'after-restart',
      commandToken: 'token-after-restart',
      workspaceRoot,
      pid: process.pid,
      port: 5177,
      localUrl: 'https://localhost:5177',
    });

    expect(restarted.sessionId).toBe('after-restart');
    expect(restarted.port).toBe(5177);
  });

  test('prevents an old session from updating or deleting its replacement', async () => {
    await registerRuntimeSession({
      sessionId: 'old-session',
      commandToken: 'token-old-session',
      workspaceRoot,
      pid: process.pid,
      port: 5176,
      localUrl: 'https://localhost:5176',
    });
    await unregisterRuntimeSession(workspaceRoot, 'old-session');
    await registerRuntimeSession({
      sessionId: 'new-session',
      commandToken: 'token-new-session',
      workspaceRoot,
      pid: process.pid,
      port: 5177,
      localUrl: 'https://localhost:5177',
    });

    expect(
      await setRuntimeSessionBrowserState(workspaceRoot, 'old-session', {
        status: 'launch_failed',
        connected: false,
        commandReady: false,
        connectedClientCount: 0,
        lastTransitionAt: new Date().toISOString(),
      }),
    ).toBeNull();
    await unregisterRuntimeSession(workspaceRoot, 'old-session');

    const written = JSON.parse(
      await readFile(
        path.join(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH),
        'utf8',
      ),
    );
    expect(written.sessionId).toBe('new-session');
    expect(written.browser).toBeUndefined();
    expect(
      JSON.parse(
        await readFile(
          path.join(workspaceRoot, IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH),
          'utf8',
        ),
      ),
    ).toMatchObject({
      sessionId: 'new-session',
      commandToken: 'token-new-session',
    });
  });
});

describe('browser rpc errors', () => {
  test('defaults to browser_not_ready while the browser is still starting', () => {
    expect(
      createUnavailableBrowserRpcError({
        status: 'launching',
        connected: false,
        commandReady: false,
        connectedClientCount: 0,
        lastTransitionAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      code: -32000,
      message: 'Browser not ready',
      cause: 'browser_not_ready',
    });
  });

  test('reuses the published browser issue when launch failed', () => {
    expect(
      createUnavailableBrowserRpcError({
        status: 'launch_failed',
        connected: false,
        commandReady: false,
        connectedClientCount: 0,
        lastTransitionAt: new Date().toISOString(),
        lastError: {
          cause: 'permission_denied',
          message: 'Playwright sandbox denied',
          at: new Date().toISOString(),
        },
      }),
    ).toMatchObject({
      code: -32000,
      message: 'Playwright sandbox denied',
      cause: 'permission_denied',
    });
  });

  test('surfaces command warm-up state after bridge connect', () => {
    expect(
      createUnavailableBrowserRpcError({
        status: 'connected',
        connected: true,
        commandReady: false,
        connectedClientCount: 1,
        lastTransitionAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      code: -32000,
      message: 'Managed browser command path is still warming up.',
      cause: 'browser_not_ready',
    });
  });
});
