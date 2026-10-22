/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import {
  INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV,
  INTERNAL_RUNTIME_SHUTDOWN_METHOD,
} from '@iwsdk/cli/contract';
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
  servers: [] as any[],
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

vi.mock('ws', () => {
  class FakeWebSocketServer {
    clients = new Set<any>();
    private handlers = new Map<string, Array<(...args: any[]) => void>>();

    constructor() {
      mocks.servers.push(this);
    }
    emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args);
      }
    }
    on(event: string, handler: (...args: any[]) => void) {
      const entries = this.handlers.get(event) ?? [];
      entries.push(handler);
      this.handlers.set(event, entries);
      return this;
    }
    close(callback?: () => void) {
      callback?.();
    }
    handleUpgrade() {}
  }
  return {
    WebSocket: { OPEN: 1 },
    WebSocketServer: FakeWebSocketServer,
  };
});

function createManagedBrowser() {
  let closed = false;
  let onClose = () => {};
  let audioMuted = false;
  return {
    browser: {
      // A real browser reports changes through the onMutedChange launch option.
      setAudioMuted: vi.fn(async (muted: boolean) => {
        if (muted !== audioMuted) {
          audioMuted = muted;
          launchTabAudioOptions()?.onMutedChange?.(muted);
        }
        return muted;
      }),
      captureRuntimeScreenshot: vi.fn().mockResolvedValue({
        bytes: Buffer.from('png'),
        metadata: {
          generation: 3,
          id: 'app-page',
          mimeType: 'image/png',
          url: 'http://localhost:4173/',
        },
      }),
      close: vi.fn().mockImplementation(async () => {
        closed = true;
      }),
      getAutomationTarget: vi.fn(() => null),
      getTabMetadata: vi.fn().mockResolvedValue({
        generation: 3,
        id: 'app-page',
      }),
      isClosed: vi.fn(() => closed),
      onClose: vi.fn((callback: () => void) => {
        onClose = callback;
      }),
      runCommandExclusive: vi.fn(async (operation: () => Promise<unknown>) =>
        operation(),
      ),
      reloadApplication: vi.fn().mockResolvedValue({
        url: 'http://localhost:4173/',
      }),
      snapshotApplication: vi.fn().mockResolvedValue({
        application: {
          generation: 3,
          id: 'app-page',
          outerUrl: 'http://localhost:4173/',
          url: 'http://localhost:4173/',
          workspaceFramed: false,
        },
        elements: [],
        snapshotId: 'snapshot-1',
        truncated: false,
      }),
    },
    closeUnexpectedly() {
      closed = true;
      onClose();
    },
  };
}

function launchTabAudioOptions():
  | { muted: boolean; onMutedChange?: (muted: boolean) => void }
  | undefined {
  return mocks.launchManagedBrowser.mock.calls.at(-1)?.at(-1);
}

const harnessCleanup: Array<() => Promise<void>> = [];

async function createHarness(
  managedBrowser: ReturnType<typeof createManagedBrowser>['browser'],
  nativeXRControl = false,
) {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const httpServer = {
    address: vi.fn(() => ({ port: 4173 })),
    off: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      const entries = handlers.get(event) ?? [];
      entries.push(handler);
      handlers.set(event, entries);
    }),
    once: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      const entries = handlers.get(event) ?? [];
      entries.push(handler);
      handlers.set(event, entries);
    }),
  };
  const close = vi.fn().mockResolvedValue(undefined);
  mocks.launchManagedBrowser.mockResolvedValueOnce(managedBrowser);
  const plugin = iwsdkDev({
    nativeXRControl,
    workspace: { enabled: true },
  });
  plugin.configResolved?.({
    command: 'serve',
    root: '/tmp/iwsdk-browser-routing',
    server: {},
  } as never);
  const server = {
    close,
    config: { server: { port: 4173 } },
    httpServer,
    middlewares: { use: vi.fn() },
    resolvedUrls: { local: ['http://localhost:4173/'], network: [] },
  };
  await plugin.configureServer?.(server as never);
  await handlers.get('listening')?.[0]?.();
  await vi.waitFor(() => expect(managedBrowser.onClose).toHaveBeenCalled());
  const sessionId = mocks.registerRuntimeSession.mock.calls.at(-1)?.[0]
    ?.sessionId as string;

  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  });
  mocks.servers.at(-1).emit('connection', socket);
  harnessCleanup.push(() => server.close());
  return { close, handlers, sessionId, socket };
}

function connectBrowserPage(hello: Record<string, unknown>) {
  const page = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  });
  mocks.servers.at(-1).emit('connection', page, {
    socket: { remoteAddress: '127.0.0.1' },
  });
  sendJson(page, {
    type: 'iwsdk_browser_hello',
    commandReady: true,
    tabGeneration: 1,
    ...hello,
  });
  return page;
}

function sendJson(socket: EventEmitter, message: unknown) {
  socket.emit('message', Buffer.from(JSON.stringify(message)));
}

function responses(socket: { send: ReturnType<typeof vi.fn> }) {
  return socket.send.mock.calls.map(([data]) => JSON.parse(data));
}

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of harnessCleanup.splice(0)) {
    await cleanup();
  }
  mocks.servers.length = 0;
  vi.clearAllMocks();
});

describe('managed browser WebSocket routing', () => {
  test('runs host browser commands without a runtime bridge', async () => {
    const managed = createManagedBrowser();
    const { socket } = await createHarness(managed.browser);

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({ id: 'snapshot', method: 'browser_snapshot' }),
      ),
    );

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const response = JSON.parse(socket.send.mock.calls[0]![0]);
    expect(response).toMatchObject({
      _tabGeneration: 3,
      _tabId: 'app-page',
      id: 'snapshot',
      result: { snapshotId: 'snapshot-1' },
    });
    expect(managed.browser.snapshotApplication).toHaveBeenCalledOnce();
  });

  test('relays reload_page to a physical app in native XR control mode', async () => {
    const managed = createManagedBrowser();
    const { socket } = await createHarness(managed.browser, true);
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          id: 'pair',
          method: 'runtime_pair_headset',
          params: { headsetId: 'quest-serial' },
        }),
      ),
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const token = new URL(
      JSON.parse(socket.send.mock.calls[0][0]).result.url,
    ).searchParams.get('__iwsdk_headset');
    socket.send.mockClear();
    const physicalSocket = Object.assign(new EventEmitter(), {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
    });
    mocks.servers.at(-1).emit('connection', physicalSocket, {
      socket: { remoteAddress: '127.0.0.1' },
    });
    physicalSocket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'iwsdk_browser_hello',
          commandReady: true,
          deviceClass: 'physical',
          headsetToken: token,
          pageId: 'quest-page',
          pageRole: 'app',
          tabGeneration: 1,
        }),
      ),
    );

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          id: 'reload',
          method: 'reload_page',
          target: {
            deviceClass: 'physical',
            headsetId: 'quest-serial',
            pageId: 'quest-page',
            tabGeneration: 1,
          },
        }),
      ),
    );

    await vi.waitFor(() => expect(physicalSocket.send).toHaveBeenCalledOnce());
    expect(JSON.parse(physicalSocket.send.mock.calls[0]![0])).toMatchObject({
      id: expect.any(String),
      method: 'reload_page',
    });
    expect(managed.browser.reloadApplication).not.toHaveBeenCalled();
  });

  test('does not combine a new application id with a stale generation', async () => {
    const managed = createManagedBrowser();
    managed.browser.snapshotApplication.mockResolvedValueOnce({
      application: { id: 'replacement-page' },
      elements: [],
      snapshotId: 'snapshot-2',
      truncated: false,
    });
    const { socket } = await createHarness(managed.browser);

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({ id: 'snapshot', method: 'browser_snapshot' }),
      ),
    );

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const response = JSON.parse(socket.send.mock.calls[0]![0]);
    expect(response).toMatchObject({
      _tabId: 'replacement-page',
    });
    expect(response).not.toHaveProperty('_tabGeneration');
  });

  test('rejects a stale target inside the browser command mutex', async () => {
    const managed = createManagedBrowser();
    const { socket } = await createHarness(managed.browser);

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          id: 'snapshot',
          method: 'browser_snapshot',
          target: { pageId: 'old-page', role: 'app', tabGeneration: 2 },
        }),
      ),
    );

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const response = JSON.parse(socket.send.mock.calls[0]![0]);
    expect(response.error.data).toMatchObject({
      code: 'stale_browser_tab',
      currentTab: { generation: 3, id: 'app-page' },
    });
    expect(managed.browser.runCommandExclusive).toHaveBeenCalledOnce();
    expect(managed.browser.snapshotApplication).not.toHaveBeenCalled();
  });

  test('propagates retryable managed-browser coordinator errors', async () => {
    const managed = createManagedBrowser();
    managed.browser.snapshotApplication.mockRejectedValueOnce(
      Object.assign(
        new Error('Managed browser command timed out in the queue'),
        {
          code: 'browser_command_queue_timeout',
          retryable: true,
        },
      ),
    );
    const { socket } = await createHarness(managed.browser);

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({ id: 'snapshot', method: 'browser_snapshot' }),
      ),
    );

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      error: {
        code: -32000,
        data: {
          code: 'browser_command_queue_timeout',
          retryable: true,
        },
        message: 'Managed browser command timed out in the queue',
      },
      id: 'snapshot',
    });
  });

  test('marks failures after a host command starts as outcome unknown', async () => {
    const managed = createManagedBrowser();
    managed.browser.snapshotApplication.mockRejectedValueOnce(
      new Error('Playwright transport failed'),
    );
    const { socket } = await createHarness(managed.browser);

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({ id: 'snapshot', method: 'browser_snapshot' }),
      ),
    );

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      error: {
        data: {
          code: 'browser_command_failed',
          outcome: 'outcome_unknown',
          retryable: false,
        },
        message: 'Playwright transport failed',
      },
      id: 'snapshot',
    });
  });

  test.each(['ecs_list_systems', 'ui_inspect'])(
    'pins managed %s dispatch to the admitted browser generation',
    async (method) => {
      const managed = createManagedBrowser();
      const { sessionId, socket } = await createHarness(managed.browser);
      const bridge = Object.assign(new EventEmitter(), {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
        terminate: vi.fn(),
      });
      mocks.servers.at(-1).emit('connection', bridge, {
        socket: { remoteAddress: '127.0.0.1' },
      });
      bridge.emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'iwsdk_browser_hello',
            browserEpoch: 1,
            commandReady: true,
            deviceClass: 'managed',
            pageId: 'runtime-app',
            pageRole: 'app',
            sessionId,
            tabGeneration: 1,
          }),
        ),
      );

      socket.emit(
        'message',
        Buffer.from(JSON.stringify({ id: 'runtime-command', method })),
      );

      await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledOnce());
      expect(JSON.parse(bridge.send.mock.calls[0]![0])).toMatchObject({
        id: expect.any(String),
        method,
        target: {
          browserEpoch: 1,
          deviceClass: 'managed',
          role: 'app',
          sessionId,
        },
      });
      bridge.emit('close', 1000, Buffer.from('done'));
    },
  );

  test('mutes the managed tab and publishes the dev-session state', async () => {
    const managed = createManagedBrowser();
    const { socket } = await createHarness(managed.browser);
    expect(
      mocks.setRuntimeSessionBrowserState.mock.calls.at(-1)?.[2]?.audioMuted,
    ).toBe(false);

    sendJson(socket, {
      id: 'mute',
      method: 'browser_set_muted',
      params: { muted: true },
    });

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    expect(managed.browser.setAudioMuted).toHaveBeenCalledWith(true);
    expect(managed.browser.runCommandExclusive).toHaveBeenCalled();
    expect(responses(socket)[0]).toEqual({
      id: 'mute',
      result: { muted: true },
      _tabId: 'app-page',
      _tabGeneration: 3,
    });
    expect(
      mocks.setRuntimeSessionBrowserState.mock.calls.at(-1)?.[2]?.audioMuted,
    ).toBe(true);
  });

  test('relaunches the managed browser with the dev-session mute state', async () => {
    const managed = createManagedBrowser();
    const replacement = createManagedBrowser();
    const { socket } = await createHarness(managed.browser);
    expect(launchTabAudioOptions()?.muted).toBe(false);
    await managed.browser.setAudioMuted(true);

    mocks.launchManagedBrowser.mockResolvedValueOnce(replacement.browser);
    managed.closeUnexpectedly();
    await vi.waitFor(() =>
      expect(
        mocks.setRuntimeSessionBrowserState.mock.calls.at(-1)?.[2]?.lifecycle
          ?.state,
      ).toBe('failed'),
    );
    sendJson(socket, { id: 'relaunch', method: 'browser_snapshot' });

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    expect(mocks.launchManagedBrowser).toHaveBeenCalledTimes(2);
    expect(launchTabAudioOptions()?.muted).toBe(true);
    expect(
      mocks.setRuntimeSessionBrowserState.mock.calls.at(-1)?.[2]?.audioMuted,
    ).toBe(true);
  });

  test('reports a lazy relaunch before routing the next host command', async () => {
    const managed = createManagedBrowser();
    const replacement = createManagedBrowser();
    const { socket } = await createHarness(managed.browser);
    mocks.launchManagedBrowser.mockResolvedValueOnce(replacement.browser);
    managed.closeUnexpectedly();
    await vi.waitFor(() =>
      expect(
        mocks.setRuntimeSessionBrowserState.mock.calls.at(-1)?.[2]?.lifecycle
          ?.state,
      ).toBe('failed'),
    );

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({ id: 'snapshot', method: 'browser_snapshot' }),
      ),
    );

    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      id: 'snapshot',
      error: { data: { code: 'browser_relaunched', outcome: 'not_executed' } },
    });
    expect(replacement.browser.snapshotApplication).not.toHaveBeenCalled();
  });

  test('only accepts a runtime shutdown carrying the launch claim', async () => {
    const previousClaim = process.env[INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV];
    process.env[INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV] = 'owned-claim';
    try {
      const managed = createManagedBrowser();
      const { close, socket } = await createHarness(managed.browser);

      socket.emit(
        'message',
        Buffer.from(
          JSON.stringify({
            id: 'bad-shutdown',
            method: INTERNAL_RUNTIME_SHUTDOWN_METHOD,
            params: { claimId: 'foreign-claim' },
          }),
        ),
      );
      await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
      expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
        id: 'bad-shutdown',
        error: { code: -32001 },
      });
      expect(close).not.toHaveBeenCalled();

      socket.send.mockClear();
      socket.emit(
        'message',
        Buffer.from(
          JSON.stringify({
            id: 'owned-shutdown',
            method: INTERNAL_RUNTIME_SHUTDOWN_METHOD,
            params: { claimId: 'owned-claim' },
          }),
        ),
      );
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
        id: 'owned-shutdown',
        result: { accepted: true },
      });
    } finally {
      if (previousClaim == null) {
        delete process.env[INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV];
      } else {
        process.env[INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV] = previousClaim;
      }
    }
  });

  test('retires the admitted managed epoch when a long command misses its deadline', async () => {
    const managed = createManagedBrowser();
    const replacement = createManagedBrowser();
    let finishClose!: () => void;
    managed.browser.close.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishClose = resolve)),
    );
    const { sessionId, socket } = await createHarness(managed.browser);
    const editor = connectBrowserPage({
      browserEpoch: 1,
      deviceClass: 'managed',
      pageId: 'runtime-editor',
      pageRole: 'editor',
      sessionId,
    });
    vi.useFakeTimers();

    sendJson(socket, { id: 'preview', method: 'asset_render_preview' });
    await vi.waitFor(() => expect(editor.send).toHaveBeenCalledOnce());
    const wireId = JSON.parse(editor.send.mock.calls[0]![0]).id;

    // A 120s budget outlives any 60s sweep; it expires at its own deadline.
    await vi.advanceTimersByTimeAsync(116_900);
    expect(socket.send).not.toHaveBeenCalled();
    expect(managed.browser.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(responses(socket)).toEqual([
      expect.objectContaining({
        id: 'preview',
        error: expect.objectContaining({
          data: { code: 'command_timeout', outcome: 'outcome_unknown' },
        }),
      }),
    ]);
    expect(editor.close).toHaveBeenCalledWith(
      1011,
      'Runtime command deadline exceeded',
    );
    expect(managed.browser.close).toHaveBeenCalledOnce();

    // Until retirement is confirmed, nothing reaches the fenced generation.
    sendJson(editor, { id: wireId, result: 'late' });
    sendJson(socket, { id: 'during-close', method: 'asset_render_preview' });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2));
    expect(responses(socket)[1]).toMatchObject({
      id: 'during-close',
      error: { data: { outcome: 'not_executed' } },
    });

    mocks.launchManagedBrowser.mockResolvedValueOnce(replacement.browser);
    finishClose();
    await vi.waitFor(() =>
      expect(
        mocks.setRuntimeSessionBrowserState.mock.calls.at(-1)?.[2]?.lifecycle
          ?.state,
      ).toBe('failed'),
    );
    sendJson(socket, { id: 'after-close', method: 'asset_render_preview' });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(3));
    expect(responses(socket)[2]).toMatchObject({
      id: 'after-close',
      error: { data: { code: 'browser_relaunched', outcome: 'not_executed' } },
    });
    expect(editor.send).toHaveBeenCalledOnce();
    expect(replacement.browser.close).not.toHaveBeenCalled();
  });

  test('an old epoch deadline never retires its replacement', async () => {
    const managed = createManagedBrowser();
    const replacement = createManagedBrowser();
    const { sessionId, socket } = await createHarness(managed.browser);
    const app = connectBrowserPage({
      browserEpoch: 1,
      deviceClass: 'managed',
      pageId: 'runtime-app',
      pageRole: 'app',
      sessionId,
    });
    vi.useFakeTimers();

    sendJson(socket, { id: 'old-epoch', method: 'ecs_list_systems' });
    await vi.waitFor(() => expect(app.send).toHaveBeenCalledOnce());
    // The retired page socket has not finished closing when epoch 2 starts.
    mocks.launchManagedBrowser.mockResolvedValueOnce(replacement.browser);
    managed.closeUnexpectedly();
    await vi.waitFor(() =>
      expect(
        mocks.setRuntimeSessionBrowserState.mock.calls.at(-1)?.[2]?.lifecycle
          ?.state,
      ).toBe('failed'),
    );
    sendJson(socket, { id: 'relaunch', method: 'browser_snapshot' });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    expect(responses(socket)[0]).toMatchObject({
      id: 'relaunch',
      error: { data: { code: 'browser_relaunched' } },
    });

    await vi.advanceTimersByTimeAsync(27_000);
    expect(responses(socket)[1]).toMatchObject({
      id: 'old-epoch',
      error: { data: { code: 'command_timeout', outcome: 'outcome_unknown' } },
    });
    expect(replacement.browser.close).not.toHaveBeenCalled();
    sendJson(socket, { id: 'snapshot', method: 'browser_snapshot' });
    await vi.waitFor(() =>
      expect(replacement.browser.snapshotApplication).toHaveBeenCalledOnce(),
    );
  });

  test('fences a timed-out physical page without retiring the managed browser', async () => {
    const managed = createManagedBrowser();
    const { socket } = await createHarness(managed.browser, true);
    sendJson(socket, {
      id: 'pair',
      method: 'runtime_pair_headset',
      params: { headsetId: 'quest-serial' },
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const headsetToken = new URL(
      responses(socket)[0].result.url,
    ).searchParams.get('__iwsdk_headset');
    socket.send.mockClear();
    const questPage = {
      deviceClass: 'physical',
      headsetToken,
      pageId: 'quest-page',
      pageRole: 'app',
    };
    const quest = connectBrowserPage(questPage);
    const target = {
      deviceClass: 'physical',
      headsetId: 'quest-serial',
      pageId: 'quest-page',
      tabGeneration: 1,
    };
    vi.useFakeTimers();

    sendJson(socket, { id: 'physical', method: 'ecs_list_systems', target });
    await vi.waitFor(() => expect(quest.send).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(27_000);
    expect(responses(socket)).toEqual([
      expect.objectContaining({
        id: 'physical',
        error: expect.objectContaining({
          data: { code: 'command_timeout', outcome: 'outcome_unknown' },
        }),
      }),
    ]);
    expect(quest.close).toHaveBeenCalledWith(
      1011,
      'Runtime command deadline exceeded',
    );
    quest.emit('close', 1011, Buffer.from('deadline'));

    const reconnect = connectBrowserPage(questPage);
    expect(reconnect.close).toHaveBeenCalledWith(
      1008,
      'Stale endpoint or endpoint capacity reached',
    );
    sendJson(socket, { id: 'retry', method: 'ecs_list_systems', target });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2));
    expect(responses(socket)[1]).toMatchObject({
      id: 'retry',
      error: { data: { code: 'stale_browser_tab', outcome: 'not_executed' } },
    });

    sendJson(socket, { id: 'snapshot', method: 'browser_snapshot' });
    await vi.waitFor(() =>
      expect(managed.browser.snapshotApplication).toHaveBeenCalledOnce(),
    );
    expect(managed.browser.close).not.toHaveBeenCalled();
  });
});
