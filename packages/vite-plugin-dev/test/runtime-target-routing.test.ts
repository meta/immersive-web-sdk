/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
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
  servers: [] as any[],
}));

vi.mock('../src/headless-browser.js', () => ({
  ensureChromiumInstalled: vi.fn(async () => {}),
  launchManagedBrowser: mocks.launchManagedBrowser,
}));

vi.mock('../src/metavr-telemetry.js', () => ({
  reportSessionEnd: vi.fn(),
  reportSessionStart: vi.fn(),
}));

vi.mock('../src/runtime-session.js', () => ({
  registerRuntimeSession: mocks.registerRuntimeSession,
  RuntimeSessionOwnershipError: class RuntimeSessionOwnershipError extends Error {},
  setRuntimeSessionBrowserAutomation: vi.fn().mockResolvedValue(undefined),
  setRuntimeSessionBrowserState: vi.fn().mockResolvedValue(undefined),
  unregisterRuntimeSession: vi.fn().mockResolvedValue(undefined),
  unregisterRuntimeSessionSync: vi.fn(),
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
  return {
    close: vi.fn().mockImplementation(async () => {
      closed = true;
    }),
    getAutomationTarget: vi.fn(() => null),
    getTabMetadata: vi.fn().mockResolvedValue({ generation: 1, id: 'app' }),
    isClosed: vi.fn(() => closed),
    onClose: vi.fn(),
    runCommandExclusive: vi.fn(async (operation: () => Promise<unknown>) =>
      operation(),
    ),
    reloadApplication: vi.fn().mockResolvedValue({ url: 'http://x/' }),
  };
}

const cleanup: Array<() => Promise<void>> = [];

async function createHarness(nativeXRControl = false) {
  const managed = createManagedBrowser();
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const register = (event: string, handler: (...args: any[]) => unknown) =>
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
  const httpServer = {
    address: vi.fn(() => ({ port: 4173 })),
    off: vi.fn(),
    on: vi.fn(register),
    once: vi.fn(register),
  };
  mocks.launchManagedBrowser.mockResolvedValueOnce(managed);
  const plugin = iwsdkDev({ nativeXRControl, workspace: { enabled: true } });
  plugin.configResolved?.({
    command: 'serve',
    root: '/tmp/iwsdk-target-routing',
    server: {},
  } as never);
  const server = {
    close: vi.fn().mockResolvedValue(undefined),
    config: { server: { port: 4173 } },
    httpServer,
    middlewares: { use: vi.fn() },
    resolvedUrls: { local: ['http://localhost:4173/'], network: [] },
  };
  await plugin.configureServer?.(server as never);
  await handlers.get('listening')?.[0]?.();
  await vi.waitFor(() => expect(managed.onClose).toHaveBeenCalled());
  const sessionId = mocks.registerRuntimeSession.mock.calls.at(-1)?.[0]
    ?.sessionId as string;
  const agent = connect();
  cleanup.push(() => server.close());

  let nextId = 0;
  /** Sends one command from the agent and resolves with its reply. */
  const call = async (message: Record<string, unknown>) => {
    const id = `call-${(nextId += 1)}`;
    const replies = agent.send.mock.calls.length;
    sendJson(agent, { id, ...message });
    await vi.waitFor(() =>
      expect(agent.send.mock.calls.length).toBeGreaterThan(replies),
    );
    return JSON.parse(agent.send.mock.calls.at(-1)![0]);
  };
  const managedPage = (role: 'app' | 'editor', tabGeneration = 1) =>
    hello({
      browserEpoch: 1,
      deviceClass: 'managed',
      pageId: `runtime-${role}`,
      pageRole: role,
      sessionId,
      tabGeneration,
    });
  return { agent, call, managed, managedPage, sessionId };
}

function connect() {
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  });
  mocks.servers.at(-1).emit('connection', socket, {
    socket: { remoteAddress: '127.0.0.1' },
  });
  return socket;
}

function hello(fields: Record<string, unknown>) {
  const page = connect();
  sendJson(page, {
    type: 'iwsdk_browser_hello',
    commandReady: true,
    tabGeneration: 1,
    ...fields,
  });
  return page;
}

function sendJson(socket: EventEmitter, message: unknown) {
  socket.emit('message', Buffer.from(JSON.stringify(message)));
}

function wire(page: { send: ReturnType<typeof vi.fn> }, index = 0) {
  return JSON.parse(page.send.mock.calls[index]![0]);
}

afterEach(async () => {
  vi.useRealTimers();
  for (const stop of cleanup.splice(0)) {
    await stop();
  }
  mocks.servers.length = 0;
  vi.clearAllMocks();
});

describe('runtime target routing through the plugin server', () => {
  test('a malformed hello is closed while the prior page still routes', async () => {
    const h = await createHarness();
    const app = h.managedPage('app');
    const malformed = [
      { deviceClass: 'browser' },
      { deviceClass: null },
      { pageRole: 'viewer', role: 'viewer' },
      { pageId: null },
      { pageId: 'runtime-app', tabId: 'other' },
      { commandReady: 'yes' },
      { tabGeneration: 2 ** 53 },
    ];
    for (const change of malformed) {
      const intruder = hello({
        browserEpoch: 1,
        deviceClass: 'managed',
        pageId: 'runtime-app',
        pageRole: 'app',
        sessionId: h.sessionId,
        tabGeneration: 9,
        ...change,
      });
      expect(intruder.close).toHaveBeenCalledWith(
        1008,
        'Malformed browser identity',
      );
    }
    // A registered socket cannot restate itself as another generation.
    sendJson(app, {
      type: 'iwsdk_browser_hello',
      browserEpoch: 1,
      commandReady: true,
      deviceClass: 'managed',
      pageId: 'runtime-app',
      pageRole: 'app',
      sessionId: h.sessionId,
      tabGeneration: 9,
    });
    expect(app.close).not.toHaveBeenCalled();

    sendJson(h.agent, { id: 'routed', method: 'ecs_list_systems' });
    await vi.waitFor(() => expect(app.send).toHaveBeenCalledOnce());
    expect(wire(app)).toMatchObject({
      method: 'ecs_list_systems',
      target: { deviceClass: 'managed', role: 'app', browserEpoch: 1 },
    });
  });

  test('losing either managed role reports disconnected without a relaunch', async () => {
    const h = await createHarness();
    const app = h.managedPage('app');
    const editor = h.managedPage('editor');
    expect(
      (await h.call({ method: 'runtime_get_status' })).result.browser,
    ).toMatchObject({ status: 'connected' });

    editor.emit('close', 1006, Buffer.from(''));
    const lost = (await h.call({ method: 'runtime_get_status' })).result
      .browser;
    expect(lost).toMatchObject({
      status: 'disconnected',
      lastError: { cause: 'connection_lost' },
    });
    expect(lost.lastError.message).toContain('browser reload');

    // The app alone is not the command path; the editor's reload restores it.
    app.emit('close', 1006, Buffer.from(''));
    h.managedPage('app', 2);
    expect(
      (await h.call({ method: 'runtime_get_status' })).result.browser.status,
    ).toBe('disconnected');
    h.managedPage('editor', 2);
    expect(
      (await h.call({ method: 'runtime_get_status' })).result.browser.status,
    ).toBe('connected');
    expect(h.managed.close).not.toHaveBeenCalled();
    expect(mocks.launchManagedBrowser).toHaveBeenCalledOnce();
  });

  test('runtime_recover leaves a healthy browser running', async () => {
    const h = await createHarness();
    h.managedPage('app');
    h.managedPage('editor');
    const recovered = await h.call({ method: 'runtime_recover' });
    expect(recovered.result.browser).toMatchObject({ status: 'connected' });
    expect(h.managed.close).not.toHaveBeenCalled();
    expect(mocks.launchManagedBrowser).toHaveBeenCalledOnce();
  });

  test('a lost managed bridge fences its generation but keeps Chromium', async () => {
    const h = await createHarness();
    const app = h.managedPage('app');
    h.managedPage('editor');

    sendJson(h.agent, { id: 'lost', method: 'ecs_list_systems' });
    await vi.waitFor(() => expect(app.send).toHaveBeenCalledOnce());
    app.emit('close', 1006, Buffer.from(''));
    await vi.waitFor(() => expect(h.agent.send).toHaveBeenCalledOnce());
    expect(wire(h.agent)).toMatchObject({
      id: 'lost',
      error: { data: { code: 'connection_lost', outcome: 'outcome_unknown' } },
    });

    // Generation 1 may have run the command; only its reload is routable.
    const stale = h.managedPage('app', 1);
    expect(stale.close).toHaveBeenCalledWith(
      1008,
      'Stale endpoint or endpoint capacity reached',
    );
    const reloaded = h.managedPage('app', 2);
    sendJson(h.agent, { id: 'after', method: 'ecs_list_systems' });
    await vi.waitFor(() => expect(reloaded.send).toHaveBeenCalledOnce());
    expect(h.managed.close).not.toHaveBeenCalled();
    expect(mocks.launchManagedBrowser).toHaveBeenCalledOnce();
  });

  test('routes the hand tools to the app page and lists them for every XR target', async () => {
    const h = await createHarness(true);
    const app = h.managedPage('app');
    h.managedPage('editor');
    const handMethods = [
      'set_hand_pose',
      'microgesture',
      'get_hand_state',
      'run_sequence',
      'cancel_sequence',
      'list_targets',
    ];
    const params = {
      device: 'hand-right',
      steps: [{ target: 'counter-button', press: {} }],
    };

    for (const [index, method] of handMethods.entries()) {
      sendJson(h.agent, {
        id: `hand-${method}`,
        method,
        params: method === 'run_sequence' ? params : {},
      });
      await vi.waitFor(() => expect(app.send).toHaveBeenCalledTimes(index + 1));
      expect(wire(app, index)).toMatchObject({
        method,
        target: { deviceClass: 'managed', role: 'app' },
      });
    }
    expect(wire(app, 3).params).toEqual(params);

    const paired = await h.call({
      method: 'runtime_pair_headset',
      params: { headsetId: 'quest-serial' },
    });
    hello({
      deviceClass: 'physical',
      headsetToken: new URL(paired.result.url).searchParams.get(
        '__iwsdk_headset',
      ),
      pageId: 'quest-page',
      pageRole: 'app',
    });
    const targets = (await h.call({ method: 'runtime_list_targets' })).result
      .targets;
    for (const deviceClass of ['managed', 'physical']) {
      const target = targets.find(
        (entry: any) =>
          entry.deviceClass === deviceClass && entry.role === 'app',
      );
      expect(target?.methods, deviceClass).toEqual(
        expect.arrayContaining([
          'xr_set_hand_pose',
          'xr_microgesture',
          'xr_get_hand_state',
          'xr_run_sequence',
          'xr_cancel_sequence',
          'xr_list_targets',
        ]),
      );
    }
    expect(
      targets.find((entry: any) => entry.role === 'editor')?.methods,
    ).not.toContain('xr_run_sequence');
  });

  test('targetless commands never fall back to the only connected headset', async () => {
    const h = await createHarness(true);
    const paired = await h.call({
      method: 'runtime_pair_headset',
      params: { headsetId: 'quest-serial' },
    });
    const quest = hello({
      deviceClass: 'physical',
      headsetToken: new URL(paired.result.url).searchParams.get(
        '__iwsdk_headset',
      ),
      pageId: 'quest-page',
      pageRole: 'app',
    });
    vi.useFakeTimers();

    sendJson(h.agent, { id: 'targetless', method: 'ecs_list_systems' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wire(h.agent, 1)).toMatchObject({
      id: 'targetless',
      error: { data: { outcome: 'not_executed' } },
    });
    expect(quest.send).not.toHaveBeenCalled();
  });

  test('pairs wireless and mDNS adb serials but rejects unsafe identifiers', async () => {
    const h = await createHarness(true);
    for (const headsetId of [
      '192.168.1.5:5555',
      'adb-1WMHH8-AbCdEf._adb-tls-connect._tcp',
    ]) {
      const paired = await h.call({
        method: 'runtime_pair_headset',
        params: { headsetId },
      });
      expect(paired.result.headsetId).toBe(headsetId);
      const url = new URL(paired.result.url);
      // Only the opaque token travels in the URL.
      expect([...url.searchParams.keys()]).toEqual(['__iwsdk_headset']);
      expect(url.toString()).not.toContain(encodeURIComponent(headsetId));
      hello({
        deviceClass: 'physical',
        headsetToken: url.searchParams.get('__iwsdk_headset'),
        pageId: `page-${headsetId}`,
        pageRole: 'app',
      });
    }
    const targets = (await h.call({ method: 'runtime_list_targets' })).result
      .targets;
    expect(
      targets
        .filter((target: any) => target.deviceClass === 'physical')
        .map((target: any) => target.runtimeTarget.headsetId)
        .sort(),
    ).toEqual(['192.168.1.5:5555', 'adb-1WMHH8-AbCdEf._adb-tls-connect._tcp']);

    for (const headsetId of ['', 'quest serial', '../quest', 'a'.repeat(129)]) {
      expect(
        (
          await h.call({
            method: 'runtime_pair_headset',
            params: { headsetId },
          })
        ).error,
      ).toBeDefined();
    }
  });
});
