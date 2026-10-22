/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRelayHandler,
  RELAY_TRANSPORT_MARGIN_MS,
  type RelayOptions,
} from '../src/mcp-relay.js';
const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() });
const decode = (ws: ReturnType<typeof socket>, index = 0) =>
  JSON.parse(ws.send.mock.calls[index][0]);
const QUEST_TARGET = {
  deviceClass: 'physical',
  headsetId: 'quest',
  pageId: 'native',
  tabGeneration: 1,
};
function fixture(options?: RelayOptions) {
  const relay = createRelayHandler(options);
  const agent = socket();
  const app = socket();
  const quest = socket();
  const editor = socket();
  const clients = new Set([agent, app, quest, editor]);
  relay.registerBrowserClient(app, {
    deviceClass: 'managed',
    pageId: 'app',
    role: 'app',
    tabGeneration: 1,
    commandReady: true,
  });
  relay.registerBrowserClient(editor, {
    deviceClass: 'managed',
    pageId: 'editor',
    role: 'editor',
    tabGeneration: 1,
    commandReady: true,
  });
  relay.registerBrowserClient(quest, {
    deviceClass: 'physical',
    headsetId: 'quest',
    pageId: 'native',
    role: 'app',
    tabGeneration: 1,
    commandReady: true,
  });
  return {
    relay,
    agent,
    app,
    quest,
    editor,
    clients,
    request: (
      target?: unknown,
      id = 'request',
      method = 'ecs_pause',
      extra: Record<string, unknown> = {},
    ) =>
      relay.onMessage(
        agent,
        JSON.stringify({ id, method, target, ...extra }),
        clients,
      ),
  };
}
const QUEST_PAGE = {
  deviceClass: 'physical' as const,
  headsetId: 'quest',
  pageId: 'native',
  role: 'app' as const,
  commandReady: true,
};
describe('single-destination runtime relay', () => {
  test('default selects only managed app, even with one physical headset', () => {
    const f = fixture();
    f.request();
    expect(f.app.send).toHaveBeenCalledOnce();
    expect(f.quest.send).not.toHaveBeenCalled();
    expect(f.editor.send).not.toHaveBeenCalled();
    const wireId = decode(f.app).id;
    f.relay.onMessage(
      f.app,
      JSON.stringify({
        id: wireId,
        result: { paused: true },
        _tabId: 'app',
        _tabGeneration: 1,
      }),
      f.clients,
    );
    expect(decode(f.agent)).toMatchObject({
      id: 'request',
      result: { paused: true },
      _tabId: 'app',
    });
    expect(f.relay.pendingCount()).toBe(0);
  });
  test('never forwards the caller command credential to a page', () => {
    const f = fixture();
    f.request(QUEST_TARGET, 'credentialed', 'ecs_pause', {
      commandToken: 'session-secret',
    });
    expect(decode(f.quest)).toMatchObject({
      method: 'ecs_pause',
      target: QUEST_TARGET,
    });
    expect(f.quest.send.mock.calls[0][0]).not.toContain('session-secret');
  });
  test('never falls back to a physical headset when managed app is absent', () => {
    const f = fixture();
    f.relay.unregisterClient(f.app);
    f.request();
    expect(f.quest.send).not.toHaveBeenCalled();
    expect(decode(f.agent).error.data).toMatchObject({
      code: 'target_unavailable',
      outcome: 'not_executed',
    });
  });
  test('requires full physical identity and resolves exactly that device/page/generation', () => {
    const f = fixture();
    f.request({ deviceClass: 'physical', pageId: 'native' });
    expect(decode(f.agent).error.data.code).toBe('invalid_target');
    f.request({
      deviceClass: 'physical',
      headsetId: 'quest',
      pageId: 'native',
      tabGeneration: 1,
    });
    expect(f.quest.send).toHaveBeenCalledOnce();
    expect(f.app.send).not.toHaveBeenCalled();
    f.request({
      deviceClass: 'physical',
      headsetId: 'other',
      pageId: 'native',
      tabGeneration: 1,
    });
    expect(decode(f.agent, 1).error.data.code).toBe('stale_browser_tab');
  });
  test('explicit editor role only reaches editor; two matching apps fail as ambiguous', () => {
    const f = fixture();
    f.request({ role: 'editor' });
    expect(f.editor.send).toHaveBeenCalledOnce();
    expect(f.app.send).not.toHaveBeenCalled();
    const other = socket();
    f.clients.add(other);
    f.relay.registerBrowserClient(other, {
      pageId: 'other',
      role: 'app',
      tabGeneration: 1,
    });
    f.request();
    expect(decode(f.agent).error.data.code).toBe('ambiguous_target');
    expect(other.send).not.toHaveBeenCalled();
  });
  test('disconnect settles uncertain commands without replay on reconnect', () => {
    const f = fixture();
    f.request();
    f.relay.unregisterClient(f.app);
    expect(decode(f.agent).error.data.outcome).toBe('outcome_unknown');
    const next = socket();
    f.clients.add(next);
    f.relay.registerBrowserClient(next, {
      pageId: 'app',
      role: 'app',
      tabGeneration: 2,
    });
    expect(next.send).not.toHaveBeenCalled();
    expect(f.relay.pendingCount()).toBe(0);
    f.request({ pageId: 'app', tabGeneration: 1 });
    expect(decode(f.agent, 1).error.data.code).toBe('stale_browser_tab');
  });
  test('fences superseded sockets and ignores unsolicited responses', () => {
    const f = fixture();
    f.request();
    const wireId = decode(f.app).id;
    f.relay.onMessage(
      f.quest,
      JSON.stringify({ id: wireId, result: 'wrong page' }),
      f.clients,
    );
    expect(f.agent.send).not.toHaveBeenCalled();
    const next = socket();
    f.clients.add(next);
    f.relay.registerBrowserClient(next, {
      pageId: 'app',
      role: 'app',
      tabGeneration: 2,
    });
    f.relay.onMessage(
      f.app,
      JSON.stringify({ id: wireId, result: 'old page' }),
      f.clients,
    );
    expect(f.agent.send).toHaveBeenCalledOnce();
    expect(decode(f.agent).error.data.outcome).toBe('outcome_unknown');
  });
  test('request IDs are scoped to callers and rewritten on responses', () => {
    const f = fixture();
    const other = socket();
    f.clients.add(other);
    f.request();
    f.relay.onMessage(
      other,
      JSON.stringify({ id: 'request', method: 'ecs_pause' }),
      f.clients,
    );
    const one = decode(f.app).id;
    const two = decode(f.app, 1).id;
    expect(one).not.toBe(two);
    f.relay.onMessage(f.app, JSON.stringify({ id: two, result: 2 }), f.clients);
    expect(decode(other)).toEqual({ id: 'request', result: 2 });
    expect(f.agent.send).not.toHaveBeenCalled();
    f.relay.onMessage(f.app, JSON.stringify({ id: one, result: 1 }), f.clients);
    expect(decode(f.agent).result).toBe(1);
  });
  test('unknown messages never broadcast', () => {
    const f = fixture();
    f.relay.onMessage(f.agent, 'raw message', f.clients);
    expect(f.app.send).not.toHaveBeenCalled();
    expect(f.editor.send).not.toHaveBeenCalled();
    expect(f.quest.send).not.toHaveBeenCalled();
  });
  test('reload is available before framework readiness; other commands fail without dispatch', () => {
    const f = fixture();
    f.relay.registerBrowserClient(f.app, {
      pageId: 'app',
      role: 'app',
      tabGeneration: 1,
      commandReady: false,
    });
    f.request();
    expect(decode(f.agent).error.data.code).toBe('target_not_ready');
    expect(f.app.send).not.toHaveBeenCalled();
    f.relay.onMessage(
      f.agent,
      JSON.stringify({ id: 'reload', method: 'reload_page' }),
      f.clients,
    );
    expect(f.app.send).toHaveBeenCalledOnce();
  });
});

describe('runtime relay command deadlines', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('keeps a long preview pending past 60s and times it out once at its deadline', () => {
    vi.useFakeTimers();
    const onOutcomeUnknown = vi.fn();
    const f = fixture({ onOutcomeUnknown });
    f.request({ role: 'editor' }, 'preview', 'asset_render_preview');
    const wireId = decode(f.editor).id;

    // asset_render_preview: 120s caller deadline minus the 3s relay margin.
    vi.advanceTimersByTime(60_000);
    expect(f.relay.pendingCount()).toBe(1);
    vi.advanceTimersByTime(56_999);
    expect(f.agent.send).not.toHaveBeenCalled();
    expect(f.editor.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.agent.send).toHaveBeenCalledOnce();
    expect(decode(f.agent)).toMatchObject({
      id: 'preview',
      error: { data: { code: 'command_timeout', outcome: 'outcome_unknown' } },
    });
    expect(f.editor.close).toHaveBeenCalledOnce();
    expect(f.editor.close).toHaveBeenCalledWith(
      1011,
      'Runtime command deadline exceeded',
    );
    expect(onOutcomeUnknown).toHaveBeenCalledOnce();
    expect(onOutcomeUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceClass: 'managed',
        pageId: 'editor',
        role: 'editor',
        tabGeneration: 1,
      }),
      'command_timeout',
    );

    f.relay.onMessage(
      f.editor,
      JSON.stringify({ id: wireId, result: 'late' }),
      f.clients,
    );
    vi.advanceTimersByTime(600_000);
    expect(f.agent.send).toHaveBeenCalledOnce();
    expect(onOutcomeUnknown).toHaveBeenCalledOnce();
    expect(f.relay.pendingCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a default command uses its shorter deadline', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request();

    // Default runtime methods: 30s caller deadline minus the 3s relay margin.
    vi.advanceTimersByTime(26_999);
    expect(f.agent.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(decode(f.agent).error.data).toMatchObject({
      code: 'command_timeout',
      outcome: 'outcome_unknown',
    });
  });

  test('a hand sequence outlasts the 28 s IWER gives it', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request(undefined, 'sequence', 'run_sequence');

    // run_sequence: 40s caller deadline minus the 3s relay margin, so IWER's
    // own deadline result (28s after dispatch) arrives first.
    vi.advanceTimersByTime(36_999);
    expect(f.agent.send).not.toHaveBeenCalled();
    f.relay.onMessage(
      f.app,
      JSON.stringify({
        id: decode(f.app).id,
        result: { completed: false, reason: 'deadline' },
      }),
      f.clients,
    );
    expect(decode(f.agent)).toMatchObject({
      id: 'sequence',
      result: { completed: false, reason: 'deadline' },
    });
    expect(f.relay.pendingCount()).toBe(0);
  });

  test('a pose fade waits out its duration', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request(undefined, 'fade', 'set_hand_pose', {
      params: { device: 'hand-right', poseId: 'fist', duration: 45 },
    });

    // IWER replies when the fade ends: 30s plus 45s, less the 3s margin.
    vi.advanceTimersByTime(71_999);
    expect(f.agent.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(decode(f.agent).error.data).toMatchObject({
      code: 'command_timeout',
      outcome: 'outcome_unknown',
    });
  });

  test('every settlement path disarms the exact deadline', () => {
    vi.useFakeTimers();
    const onOutcomeUnknown = vi.fn();
    const f = fixture({ onOutcomeUnknown });

    f.request();
    f.relay.onMessage(
      f.app,
      JSON.stringify({ id: decode(f.app).id, result: 'done' }),
      f.clients,
    );
    f.request({ role: 'editor' }, 'target-disconnect');
    f.relay.unregisterClient(f.editor);
    f.quest.send.mockImplementationOnce(() => {
      throw new Error('socket closed');
    });
    f.request(QUEST_TARGET, 'dispatch-failure');
    expect(f.relay.pendingCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // Both unknown outcomes settled through the one fencing path.
    expect(onOutcomeUnknown.mock.calls).toEqual([
      [expect.objectContaining({ pageId: 'editor' }), 'connection_lost'],
      [expect.objectContaining({ headsetId: 'quest' }), 'connection_lost'],
    ]);
    expect(f.quest.close).toHaveBeenCalledWith(
      1011,
      'Runtime command dispatch failed',
    );

    const stopping = fixture({ onOutcomeUnknown });
    stopping.request();
    stopping.relay.close();
    expect(decode(stopping.agent).error.data).toMatchObject({
      code: 'runtime_stopping',
      outcome: 'outcome_unknown',
    });
    expect(vi.getTimerCount()).toBe(0);
    stopping.request(undefined, 'after-close');
    expect(decode(stopping.agent, 1).error.data.code).toBe(
      'target_unavailable',
    );

    vi.advanceTimersByTime(600_000);
    expect(onOutcomeUnknown).toHaveBeenCalledTimes(2);
    expect(f.app.close).not.toHaveBeenCalled();
    expect(f.editor.close).not.toHaveBeenCalled();
  });

  test('a departed caller leaves the deadline armed to fence a silent target', () => {
    vi.useFakeTimers();
    const onOutcomeUnknown = vi.fn();
    const f = fixture({ onOutcomeUnknown });
    f.request();
    f.agent.readyState = 3;
    f.relay.unregisterClient(f.agent);
    expect(f.relay.pendingCount()).toBe(1);

    vi.advanceTimersByTime(27_000);
    expect(f.app.close).toHaveBeenCalledOnce();
    expect(onOutcomeUnknown).toHaveBeenCalledOnce();
    expect(onOutcomeUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'app' }),
      'command_timeout',
    );
    expect(f.agent.send).not.toHaveBeenCalled();
  });

  test('a departed caller leaves a target that later succeeds healthy', () => {
    vi.useFakeTimers();
    const onOutcomeUnknown = vi.fn();
    const f = fixture({ onOutcomeUnknown });
    f.request(QUEST_TARGET, 'orphaned');
    const wireId = decode(f.quest).id;
    f.agent.readyState = 3;
    f.relay.unregisterClient(f.agent);
    expect(f.relay.pendingCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    // The target, not the departed caller, settles the command internally.
    f.relay.onMessage(
      f.quest,
      JSON.stringify({ id: wireId, result: 'done' }),
      f.clients,
    );
    expect(f.relay.pendingCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(f.quest.close).not.toHaveBeenCalled();
    expect(onOutcomeUnknown).not.toHaveBeenCalled();
    expect(f.agent.send).not.toHaveBeenCalled();

    // The same generation stays routable for the next caller.
    const next = socket();
    f.clients.add(next);
    f.relay.onMessage(
      next,
      JSON.stringify({ id: 'next', method: 'ecs_pause', target: QUEST_TARGET }),
      f.clients,
    );
    expect(f.quest.send).toHaveBeenCalledTimes(2);
    f.relay.onMessage(
      f.quest,
      JSON.stringify({ id: decode(f.quest, 1).id, result: 'again' }),
      f.clients,
    );
    expect(decode(next)).toEqual({ id: 'next', result: 'again' });
  });

  test('a timeout fences exactly the admitted endpoint generation', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request(QUEST_TARGET);
    vi.advanceTimersByTime(27_000);
    expect(f.quest.close).toHaveBeenCalledOnce();

    const reconnect = socket();
    f.clients.add(reconnect);
    const questPage = {
      deviceClass: 'physical' as const,
      headsetId: 'quest',
      pageId: 'native',
      role: 'app' as const,
      commandReady: true,
    };
    expect(
      f.relay.registerBrowserClient(reconnect, {
        ...questPage,
        tabGeneration: 1,
      }),
    ).toBe(false);
    f.request(QUEST_TARGET, 'same-generation');
    expect(decode(f.agent, 1).error.data).toMatchObject({
      code: 'stale_browser_tab',
      outcome: 'not_executed',
    });
    expect(reconnect.send).not.toHaveBeenCalled();

    f.request(undefined, 'managed-app');
    expect(f.app.send).toHaveBeenCalledOnce();
    expect(
      f.relay.registerBrowserClient(reconnect, {
        ...questPage,
        tabGeneration: 2,
      }),
    ).toBe(true);
    f.request({ ...QUEST_TARGET, tabGeneration: 2 }, 'reloaded-page');
    expect(reconnect.send).toHaveBeenCalledOnce();
  });
});

describe('runtime relay absolute deadlines', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('settles at the caller deadline, not a fresh window after admission', () => {
    vi.useFakeTimers();
    const f = fixture();
    const deadline = Date.now() + 10_000;
    // Admission (browser and bridge waits) already spent part of the budget.
    vi.advanceTimersByTime(4_000);
    f.request(undefined, 'short', 'ecs_pause', { deadline });
    expect(f.app.send).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(6_000 - RELAY_TRANSPORT_MARGIN_MS - 1);
    expect(f.agent.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(decode(f.agent)).toMatchObject({
      id: 'short',
      error: { data: { code: 'command_timeout', outcome: 'outcome_unknown' } },
    });
  });

  test('a custom deadline may outlast the method default', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request(QUEST_TARGET, 'long', 'ecs_pause', {
      deadline: Date.now() + 50_000,
    });

    // Past the 27s window a legacy ecs_pause request would get.
    vi.advanceTimersByTime(27_000);
    expect(f.relay.pendingCount()).toBe(1);
    vi.advanceTimersByTime(23_000 - RELAY_TRANSPORT_MARGIN_MS - 1);
    expect(f.agent.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(decode(f.agent).error.data.code).toBe('command_timeout');
    expect(f.quest.close).toHaveBeenCalledWith(
      1011,
      'Runtime command deadline exceeded',
    );
  });

  test('an elapsed deadline is rejected before physical dispatch', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request(QUEST_TARGET, 'elapsed', 'ecs_pause', {
      deadline: Date.now() - 1,
    });
    // No time is left to relay a timeout reply before the caller gives up.
    f.request(QUEST_TARGET, 'inside-margin', 'ecs_pause', {
      deadline: Date.now() + RELAY_TRANSPORT_MARGIN_MS,
    });
    expect(f.quest.send).not.toHaveBeenCalled();
    expect([decode(f.agent), decode(f.agent, 1)]).toEqual([
      expect.objectContaining({ id: 'elapsed' }),
      expect.objectContaining({ id: 'inside-margin' }),
    ]);
    for (const index of [0, 1]) {
      expect(decode(f.agent, index).error.data).toEqual({
        code: 'deadline_exceeded',
        outcome: 'not_executed',
      });
    }
    expect(f.relay.pendingCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    f.request(QUEST_TARGET, 'in-time', 'ecs_pause', {
      deadline: Date.now() + RELAY_TRANSPORT_MARGIN_MS + 1,
    });
    expect(f.quest.send).toHaveBeenCalledOnce();
  });

  test('rejects malformed and overlong deadlines without dispatch', () => {
    // A real clock can tick between building and checking the deadline,
    // bringing Date.now() + 2 ** 31 back inside the relay window.
    vi.useFakeTimers();
    const f = fixture();
    const deadlines = [
      'soon',
      true,
      {},
      [Date.now() + 1_000],
      Date.now() + 2 ** 31,
      // Only an omitted deadline takes the legacy default.
      null,
    ];
    for (const deadline of deadlines) {
      f.request(QUEST_TARGET, 'malformed', 'ecs_pause', { deadline });
    }
    expect(f.quest.send).not.toHaveBeenCalled();
    expect(f.relay.pendingCount()).toBe(0);
    deadlines.forEach((_, index) =>
      expect(decode(f.agent, index).error.data).toEqual({
        code: 'invalid_params',
        outcome: 'not_executed',
      }),
    );
  });
});

describe('runtime relay unknown-outcome fencing', () => {
  function expectFencedUntilReload(
    f: ReturnType<typeof fixture>,
    generation: number,
  ) {
    const replies = f.agent.send.mock.calls.length;
    const reconnect = socket();
    f.clients.add(reconnect);
    expect(
      f.relay.registerBrowserClient(reconnect, {
        ...QUEST_PAGE,
        tabGeneration: generation,
      }),
    ).toBe(false);
    f.request({ ...QUEST_TARGET, tabGeneration: generation }, 'fenced');
    expect(decode(f.agent, replies).error.data).toMatchObject({
      code: 'stale_browser_tab',
      outcome: 'not_executed',
    });
    expect(reconnect.send).not.toHaveBeenCalled();

    const reloaded = socket();
    f.clients.add(reloaded);
    expect(
      f.relay.registerBrowserClient(reloaded, {
        ...QUEST_PAGE,
        tabGeneration: generation + 1,
      }),
    ).toBe(true);
    f.request({ ...QUEST_TARGET, tabGeneration: generation + 1 }, 'reloaded');
    f.relay.onMessage(
      reloaded,
      JSON.stringify({ id: decode(reloaded).id, result: 'ok' }),
      f.clients,
    );
    expect(decode(f.agent, replies + 1)).toEqual({
      id: 'reloaded',
      result: 'ok',
    });
  }

  test('a dispatch failure fences generation N while N+1 succeeds', () => {
    const onOutcomeUnknown = vi.fn();
    const f = fixture({ onOutcomeUnknown });
    f.quest.send.mockImplementationOnce(() => {
      throw new Error('socket closed');
    });
    f.request(QUEST_TARGET, 'lost');
    expect(decode(f.agent)).toMatchObject({
      id: 'lost',
      error: { data: { code: 'connection_lost', outcome: 'outcome_unknown' } },
    });
    expect(f.quest.close).toHaveBeenCalledWith(
      1011,
      'Runtime command dispatch failed',
    );
    expect(onOutcomeUnknown).toHaveBeenCalledOnce();
    expect(onOutcomeUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ headsetId: 'quest', tabGeneration: 1 }),
      'connection_lost',
    );
    expect(f.relay.pendingCount()).toBe(0);
    expectFencedUntilReload(f, 1);
    f.request(undefined, 'managed');
    expect(f.app.send).toHaveBeenCalledOnce();
  });

  test('a target disconnect fences generation N while N+1 succeeds', () => {
    const onOutcomeUnknown = vi.fn();
    const f = fixture({ onOutcomeUnknown });
    f.request(QUEST_TARGET, 'lost');
    f.quest.readyState = 3;
    f.relay.unregisterClient(f.quest);
    f.relay.unregisterClient(f.quest);
    expect(f.agent.send).toHaveBeenCalledOnce();
    expect(decode(f.agent)).toMatchObject({
      id: 'lost',
      error: { data: { code: 'connection_lost', outcome: 'outcome_unknown' } },
    });
    expect(f.quest.close).not.toHaveBeenCalled();
    expect(onOutcomeUnknown).toHaveBeenCalledOnce();
    expect(onOutcomeUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ headsetId: 'quest', tabGeneration: 1 }),
      'connection_lost',
    );
    expectFencedUntilReload(f, 1);
  });

  test('a disconnect with nothing pending leaves the generation reusable', () => {
    const onOutcomeUnknown = vi.fn();
    const f = fixture({ onOutcomeUnknown });
    f.relay.unregisterClient(f.quest);
    const reconnect = socket();
    f.clients.add(reconnect);
    expect(
      f.relay.registerBrowserClient(reconnect, {
        ...QUEST_PAGE,
        tabGeneration: 1,
      }),
    ).toBe(true);
    f.request(QUEST_TARGET);
    expect(reconnect.send).toHaveBeenCalledOnce();
    expect(onOutcomeUnknown).not.toHaveBeenCalled();
  });
});

describe('runtime relay endpoint registration', () => {
  test('a socket keeps one identity and generation, even with a command pending', () => {
    const f = fixture();
    f.request(QUEST_TARGET, 'pending');
    const wireId = decode(f.quest).id;
    const mutations = [
      { tabGeneration: 2 },
      { pageId: 'other' },
      { headsetId: 'other' },
      { role: 'editor' as const },
      { sceneSessionId: 'scene' },
      { deviceClass: 'managed' as const, headsetId: undefined },
    ];
    for (const mutation of mutations) {
      expect(
        f.relay.registerBrowserClient(f.quest, {
          ...QUEST_PAGE,
          tabGeneration: 1,
          ...mutation,
        }),
      ).toBe(false);
    }

    // The pending command settles against the endpoint it was admitted to.
    f.relay.onMessage(
      f.quest,
      JSON.stringify({ id: wireId, result: 'done' }),
      f.clients,
    );
    expect(decode(f.agent)).toEqual({ id: 'pending', result: 'done' });
    f.request({ ...QUEST_TARGET, tabGeneration: 2 }, 'mutated');
    expect(decode(f.agent, 1).error.data.code).toBe('stale_browser_tab');

    // Readiness is the one field an exact restatement may change.
    expect(
      f.relay.registerBrowserClient(f.quest, {
        ...QUEST_PAGE,
        tabGeneration: 1,
        commandReady: false,
      }),
    ).toBe(true);
    f.request(QUEST_TARGET, 'not-ready');
    expect(decode(f.agent, 2).error.data.code).toBe('target_not_ready');
    expect(
      f.relay.registerBrowserClient(f.quest, {
        ...QUEST_PAGE,
        tabGeneration: 1,
      }),
    ).toBe(true);
    f.request(QUEST_TARGET, 'ready');
    expect(f.quest.send).toHaveBeenCalledTimes(2);
    expect(f.quest.close).not.toHaveBeenCalled();
  });

  test('rejects malformed metadata without disturbing registrations or fences', () => {
    const f = fixture();
    const intruder = socket();
    f.clients.add(intruder);
    const malformed = [
      { pageId: 42 },
      { pageId: '' },
      { pageId: 'x'.repeat(257) },
      { tabGeneration: '2' },
      { tabGeneration: 0 },
      { tabGeneration: 1.5 },
      { tabGeneration: -1 },
      { tabGeneration: 2 ** 53 },
      { tabGeneration: 99, role: 'admin' },
      { tabGeneration: 99, deviceClass: 'tablet' },
      { tabGeneration: 99, headsetId: undefined },
      { tabGeneration: 99, sessionId: 7 },
      { tabGeneration: 99, sceneSessionId: {} },
      { tabGeneration: 99, browserEpoch: -1 },
    ];
    for (const change of malformed) {
      expect(
        f.relay.registerBrowserClient(intruder, {
          ...QUEST_PAGE,
          tabGeneration: 1,
          ...change,
        } as never),
      ).toBe(false);
    }

    f.request(QUEST_TARGET);
    expect(f.quest.send).toHaveBeenCalledOnce();
    expect(intruder.send).not.toHaveBeenCalled();
    f.relay.onMessage(
      f.quest,
      JSON.stringify({ id: decode(f.quest).id, result: 'ok' }),
      f.clients,
    );
    expect(decode(f.agent)).toEqual({ id: 'request', result: 'ok' });
    // None of the rejected generations (such as 99) became a fence.
    const reloaded = socket();
    f.clients.add(reloaded);
    expect(
      f.relay.registerBrowserClient(reloaded, {
        ...QUEST_PAGE,
        tabGeneration: 2,
      }),
    ).toBe(true);
  });

  test('bounds generation floors by forgetting the oldest unfenced gone endpoint', () => {
    const f = fixture();
    f.quest.send.mockImplementationOnce(() => {
      throw new Error('socket closed');
    });
    f.request(QUEST_TARGET, 'lost');
    const register = (pageId: string, tabGeneration = 1) => {
      const ws = socket();
      f.clients.add(ws);
      return {
        ws,
        registered: f.relay.registerBrowserClient(ws, {
          ...QUEST_PAGE,
          pageId,
          tabGeneration,
        }),
      };
    };
    // With app, editor and the fenced Quest page, 4093 more fill the table.
    for (let index = 0; index < 4093; index += 1) {
      const page = register(`gone-${index}`);
      expect(page.registered).toBe(true);
      f.relay.unregisterClient(page.ws);
    }
    expect(register('native').registered).toBe(false);
    // A new identity forgets the oldest unfenced gone one, never the fence.
    expect(register('one-more').registered).toBe(true);
    expect(register('native').registered).toBe(false);
    expect(register('gone-0').registered).toBe(true);
    // The fence clears once a newer generation replaces the fenced page.
    expect(register('native', 2).registered).toBe(true);
    f.request(undefined, 'managed');
    expect(f.app.send).toHaveBeenCalledOnce();
  });

  test('refuses a new identity when every tracked one is live or fenced', () => {
    const f = fixture();
    f.quest.send.mockImplementationOnce(() => {
      throw new Error('socket closed');
    });
    f.request(QUEST_TARGET, 'lost');
    for (let index = 0; index < 4093; index += 1) {
      const ws = socket();
      f.clients.add(ws);
      expect(
        f.relay.registerBrowserClient(ws, {
          ...QUEST_PAGE,
          pageId: `live-${index}`,
          tabGeneration: 1,
        }),
      ).toBe(true);
    }
    const ws = socket();
    f.clients.add(ws);
    expect(
      f.relay.registerBrowserClient(ws, {
        ...QUEST_PAGE,
        pageId: 'overflow',
        tabGeneration: 1,
      }),
    ).toBe(false);
  });

  test('refuses a new identity only when every tracked one is live', () => {
    const f = fixture();
    const register = (pageId: string, tabGeneration = 1) => {
      const ws = socket();
      f.clients.add(ws);
      return f.relay.registerBrowserClient(ws, {
        ...QUEST_PAGE,
        pageId,
        tabGeneration,
      });
    };
    for (let index = 0; index < 4093; index += 1) {
      expect(register(`live-${index}`)).toBe(true);
    }
    expect(register('overflow')).toBe(false);
    // Tracked identities still reload into their next generation.
    expect(register('live-0', 2)).toBe(true);
    f.request({ ...QUEST_TARGET, tabGeneration: 1 });
    expect(f.quest.send).toHaveBeenCalledOnce();
  });

  test('an unregistered socket never registers again', () => {
    const f = fixture();
    f.relay.unregisterClient(f.quest);
    expect(
      f.relay.registerBrowserClient(f.quest, {
        ...QUEST_PAGE,
        tabGeneration: 2,
      }),
    ).toBe(false);
    f.request({ ...QUEST_TARGET, tabGeneration: 2 });
    expect(f.quest.send).not.toHaveBeenCalled();
    expect(decode(f.agent).error.data.code).toBe('stale_browser_tab');
  });
});
