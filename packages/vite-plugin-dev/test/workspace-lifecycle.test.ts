/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { acquireRuntimeOwner } from '@iwsdk/cli/runtime-owner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { iwsdkDev } from '../src/index.js';

vi.mock('@iwsdk/cli/runtime-owner', () => ({
  acquireRuntimeOwner: vi.fn(async () => ({
    identity: { sessionId: 'test' },
    release: vi.fn(async () => {}),
  })),
}));

const mocks = vi.hoisted(() => ({
  launchManagedBrowser: vi.fn(),
  registerRuntimeSession: vi.fn().mockResolvedValue(undefined),
  reportSessionEnd: vi.fn(),
  reportSessionStart: vi.fn(),
  setRuntimeSessionBrowserAutomation: vi.fn().mockResolvedValue(undefined),
  setRuntimeSessionBrowserState: vi.fn().mockResolvedValue(undefined),
  unregisterRuntimeSession: vi.fn().mockResolvedValue(undefined),
  unregisterRuntimeSessionSync: vi.fn(),
}));

vi.mock('../src/headless-browser.js', () => ({
  ensureChromiumInstalled: vi.fn(async () => {}),
  launchManagedBrowser: mocks.launchManagedBrowser,
}));

vi.mock('../src/metavr-telemetry.js', () => ({
  reportSessionEnd: mocks.reportSessionEnd,
  reportSessionStart: mocks.reportSessionStart,
}));

vi.mock('../src/runtime-session.js', () => ({
  registerRuntimeSession: mocks.registerRuntimeSession,
  RuntimeSessionOwnershipError: class RuntimeSessionOwnershipError extends Error {},
  setRuntimeSessionBrowserAutomation: mocks.setRuntimeSessionBrowserAutomation,
  setRuntimeSessionBrowserState: mocks.setRuntimeSessionBrowserState,
  unregisterRuntimeSession: mocks.unregisterRuntimeSession,
  unregisterRuntimeSessionSync: mocks.unregisterRuntimeSessionSync,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('managed workspace lifecycle', () => {
  test('cleans middleware-mode observers when owner acquisition fails', async () => {
    vi.mocked(acquireRuntimeOwner).mockRejectedValueOnce(
      new Error('workspace already owned'),
    );
    const watcher = {
      add: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const ws = {
      on: vi.fn(),
      off: vi.fn(),
      send: vi.fn(),
    };
    const plugin = iwsdkDev({ ai: {} });
    plugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-middleware-owner-failure',
      server: {},
    } as never);
    const server = {
      close: vi.fn(async () => {}),
      config: { server: { port: 4173 } },
      httpServer: null,
      middlewares: { use: vi.fn() },
      watcher,
      ws,
    };

    await expect(plugin.configureServer?.(server as never)).rejects.toThrow(
      'workspace already owned',
    );
    expect(ws.off).toHaveBeenCalledWith(
      'iwsdk:hot-client-role',
      expect.any(Function),
    );
    expect(watcher.off).toHaveBeenCalledWith('add', expect.any(Function));
    expect(watcher.off).toHaveBeenCalledWith('change', expect.any(Function));
    expect(watcher.off).toHaveBeenCalledWith('unlink', expect.any(Function));
  });

  test('wraps only a host listen hook and releases ownership when it fails', async () => {
    const plugin = iwsdkDev({ ai: {} });
    plugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-listen-hook',
      server: {},
    } as never);
    const hostWithoutListen = {
      close: vi.fn(async () => {}),
      config: { server: { port: 4173 } },
      httpServer: null,
      middlewares: { use: vi.fn() },
    };
    await plugin.configureServer?.(hostWithoutListen as never);
    expect(hostWithoutListen).not.toHaveProperty('listen');
    await hostWithoutListen.close();

    const bindError = new Error('listen EADDRINUSE');
    const originalClose = vi.fn(async () => {});
    const originalListen = vi.fn(async () => {
      throw bindError;
    });
    const failingPlugin = iwsdkDev({ ai: {} });
    failingPlugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-listen-failure',
      server: {},
    } as never);
    const server = {
      close: originalClose,
      config: { server: { port: 4173 } },
      httpServer: null,
      listen: originalListen as (port?: number) => Promise<unknown>,
      middlewares: { use: vi.fn() },
    };
    await failingPlugin.configureServer?.(server as never);
    const owner = await vi.mocked(acquireRuntimeOwner).mock.results[1]?.value;

    await expect(server.listen(4173)).rejects.toBe(bindError);
    expect(originalListen).toHaveBeenCalledWith(4173, undefined);
    expect(originalClose).toHaveBeenCalledOnce();
    expect(owner.release).toHaveBeenCalledOnce();
  });

  test('awaits a racing browser launch and closes it during shutdown', async () => {
    const initialSigintListeners = process.listenerCount('SIGINT');
    const initialSigtermListeners = process.listenerCount('SIGTERM');
    const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
    const httpServer = {
      address: vi.fn(() => ({ port: 4173 })),
      off: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
    };
    let finishBrowserClose!: () => void;
    const managedBrowser = {
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishBrowserClose = resolve;
          }),
      ),
      getAutomationEndpoint: vi.fn(() => null),
      onClose: vi.fn(),
    };
    let finishBrowserLaunch!: (browser: typeof managedBrowser) => void;
    mocks.launchManagedBrowser.mockReturnValueOnce(
      new Promise((resolve) => {
        finishBrowserLaunch = resolve;
      }),
    );

    const plugin = iwsdkDev({ ai: {} });
    plugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-browser-shutdown-race',
      server: {},
    } as never);
    const server = {
      close: vi.fn(async () => {}),
      config: { server: { port: 4173 } },
      httpServer,
      middlewares: { use: vi.fn() },
      resolvedUrls: {
        local: ['http://localhost:4173/'],
        network: [],
      },
    };
    await plugin.configureServer?.(server as never);

    await handlers.get('listening')?.[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.launchManagedBrowser).toHaveBeenCalledOnce();
    const launchSignal = mocks.launchManagedBrowser.mock.calls[0]?.[10] as
      | AbortSignal
      | undefined;
    expect(launchSignal?.aborted).toBe(false);
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners + 1);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners + 1);

    for (const handler of handlers.get('close') ?? []) {
      handler();
    }
    expect(launchSignal?.aborted).toBe(true);
    let shutdownFinished = false;
    const shutdown = server.close().then(() => {
      shutdownFinished = true;
    });

    await Promise.resolve();
    expect(shutdownFinished).toBe(false);

    finishBrowserLaunch(managedBrowser);
    await vi.waitFor(() => expect(managedBrowser.close).toHaveBeenCalledOnce());
    expect(shutdownFinished).toBe(false);
    finishBrowserClose();
    await shutdown;

    expect(managedBrowser.close).toHaveBeenCalledOnce();
    expect(mocks.unregisterRuntimeSession).toHaveBeenCalledWith(
      '/tmp/iwsdk-browser-shutdown-race',
      expect.any(String),
    );
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners);
  });

  test('defaults AI sessions to the visible collaborate workspace', async () => {
    const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
    const httpServer = {
      address: vi.fn(() => ({ port: 4173 })),
      off: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
    };
    const managedBrowser = {
      close: vi.fn().mockResolvedValue(undefined),
      getAutomationEndpoint: vi.fn(() => null),
      onClose: vi.fn(),
    };
    mocks.launchManagedBrowser.mockResolvedValueOnce(managedBrowser);
    const plugin = iwsdkDev({ ai: {} });
    plugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-ai-default-collaborate',
      server: {},
    } as never);
    await plugin.configureServer?.({
      config: { server: { port: 4173 } },
      httpServer,
      middlewares: { use: vi.fn() },
      resolvedUrls: {
        local: ['http://localhost:4173/'],
        network: [],
      },
    } as never);

    await handlers.get('listening')?.[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.launchManagedBrowser).toHaveBeenCalledWith(
      'http://localhost:4173/',
      false,
      false,
      null,
      { height: 800, width: 800 },
      false,
      expect.any(Object),
      'iwer',
      '/tmp/iwsdk-ai-default-collaborate',
      false,
      expect.any(AbortSignal),
      { muted: false, onMutedChange: expect.any(Function) },
    );
    expect(mocks.registerRuntimeSession).toHaveBeenCalledWith(
      expect.objectContaining({ aiMode: 'collaborate' }),
    );

    handlers.get('close')?.[0]?.();
  });

  test('keeps agent mode as an explicit headless option', async () => {
    const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
    const httpServer = {
      address: vi.fn(() => ({ port: 4173 })),
      off: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
    };
    const managedBrowser = {
      close: vi.fn().mockResolvedValue(undefined),
      getAutomationEndpoint: vi.fn(() => null),
      onClose: vi.fn(),
    };
    mocks.launchManagedBrowser.mockResolvedValueOnce(managedBrowser);
    const plugin = iwsdkDev({ ai: { mode: 'agent' } });
    plugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-ai-agent',
      server: {},
    } as never);
    await plugin.configureServer?.({
      config: { server: { port: 4173 } },
      httpServer,
      middlewares: { use: vi.fn() },
      resolvedUrls: {
        local: ['http://localhost:4173/'],
        network: [],
      },
    } as never);

    await handlers.get('listening')?.[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.launchManagedBrowser).toHaveBeenCalledWith(
      'http://localhost:4173/',
      true,
      false,
      { height: 800, width: 800 },
      { height: 800, width: 800 },
      false,
      expect.any(Object),
      'iwer',
      '/tmp/iwsdk-ai-agent',
      false,
      expect.any(AbortSignal),
      { muted: false, onMutedChange: expect.any(Function) },
    );
    expect(mocks.registerRuntimeSession).toHaveBeenCalledWith(
      expect.objectContaining({ aiMode: 'agent' }),
    );

    handlers.get('close')?.[0]?.();
  });

  test('launches the managed browser at the clean origin root', async () => {
    const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
    const httpServer = {
      address: vi.fn(() => ({ port: 4173 })),
      off: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
    };
    const managedBrowser = {
      close: vi.fn().mockResolvedValue(undefined),
      getAutomationEndpoint: vi.fn(() => null),
      onClose: vi.fn(),
    };
    mocks.launchManagedBrowser.mockResolvedValueOnce(managedBrowser);
    const plugin = iwsdkDev({ workspace: { enabled: true } });
    plugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-workspace-clean-root',
      server: {},
    } as never);
    await plugin.configureServer?.({
      config: { server: { port: 4173 } },
      httpServer,
      middlewares: { use: vi.fn() },
      resolvedUrls: {
        local: ['http://localhost:4173/'],
        network: [],
      },
    } as never);

    await handlers.get('listening')?.[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.launchManagedBrowser).toHaveBeenCalledWith(
      'http://localhost:4173/',
      false,
      false,
      null,
      { height: 800, width: 800 },
      false,
      expect.objectContaining({
        pathnames: expect.arrayContaining(['/__iwsdk/workspace/open-runtime']),
        topLevelPathnames: ['/'],
      }),
      'workspace',
      '/tmp/iwsdk-workspace-clean-root',
      false,
      expect.any(AbortSignal),
      { muted: false, onMutedChange: expect.any(Function) },
    );

    await Promise.resolve();
    handlers.get('close')?.[0]?.();
  });

  test('registers an explicit not-launched state when workspace.open is false', async () => {
    const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
    const httpServer = {
      address: vi.fn(() => ({ port: 4173 })),
      off: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
    };
    const plugin = iwsdkDev({
      workspace: { enabled: true, open: false },
    });
    plugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-workspace-open-false',
      server: {},
    } as never);
    await plugin.configureServer?.({
      config: { server: { port: 4173 } },
      httpServer,
      middlewares: { use: vi.fn() },
      resolvedUrls: {
        local: ['http://localhost:4173/'],
        network: [],
      },
    } as never);

    const listening = handlers.get('listening')?.[0];
    expect(listening).toBeDefined();
    await listening?.();

    expect(mocks.registerRuntimeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        aiMode: undefined,
        browser: expect.objectContaining({
          status: 'not_launched',
          connected: false,
          commandReady: false,
          connectedClientCount: 0,
          lastError: expect.objectContaining({
            cause: 'browser_not_launched',
          }),
        }),
        port: 4173,
      }),
    );
    expect(mocks.launchManagedBrowser).not.toHaveBeenCalled();

    handlers.get('close')?.[0]?.();
  });

  test('publishes configured browser automation separately from live endpoint availability', async () => {
    const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
    const httpServer = {
      address: vi.fn(() => ({ port: 4173 })),
      off: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
      }),
    };
    let closeUnexpectedly = () => {};
    const managedBrowser = {
      close: vi.fn().mockResolvedValue(undefined),
      getAutomationTarget: vi.fn(() => ({
        endpoint: 'http://127.0.0.1:9222',
        targetId: 'managed-target',
      })),
      onClose: vi.fn((callback: () => void) => {
        closeUnexpectedly = callback;
      }),
    };
    mocks.launchManagedBrowser.mockResolvedValueOnce(managedBrowser);
    const plugin = iwsdkDev({
      workspace: { browserAutomation: true, enabled: true },
    });
    plugin.configResolved?.({
      command: 'serve',
      root: '/tmp/iwsdk-browser-automation-state',
      server: {},
    } as never);
    await plugin.configureServer?.({
      config: { server: { port: 4173 } },
      httpServer,
      middlewares: { use: vi.fn() },
      resolvedUrls: {
        local: ['http://localhost:4173/'],
        network: [],
      },
    } as never);

    await handlers.get('listening')?.[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() =>
      expect(mocks.setRuntimeSessionBrowserAutomation).toHaveBeenCalledWith(
        '/tmp/iwsdk-browser-automation-state',
        expect.any(String),
        {
          configured: true,
          enabled: true,
          endpoint: 'http://127.0.0.1:9222',
          protocol: 'cdp',
          targetId: 'managed-target',
        },
      ),
    );
    expect(mocks.registerRuntimeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        browserAutomation: {
          configured: true,
          enabled: false,
          protocol: 'cdp',
        },
      }),
    );

    closeUnexpectedly();
    expect(mocks.setRuntimeSessionBrowserAutomation).toHaveBeenLastCalledWith(
      '/tmp/iwsdk-browser-automation-state',
      expect.any(String),
      { configured: true, enabled: false, protocol: 'cdp' },
    );
    handlers.get('close')?.[0]?.();
  });

  test('marks workspace readiness only after editor initialization resolves', async () => {
    const plugin = iwsdkDev({ workspace: { enabled: true } });
    const source = (await plugin.load?.('\0/@iwsdk-editor-runtime')) as string;
    const initStart = source.indexOf('init().then(() => {');
    const ready = source.indexOf('window.__IWSDK_SCENE_EDITOR_READY = true;');

    expect(source).toContain('window.__IWSDK_SCENE_EDITOR_READY = false;');
    expect(initStart).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(initStart);
  });
});
