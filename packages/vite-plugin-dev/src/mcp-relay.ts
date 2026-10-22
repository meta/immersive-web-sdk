/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { randomUUID } from 'crypto';
import {
  getDefaultRuntimeCommandTimeoutMs,
  type RuntimePageTarget,
} from '@iwsdk/cli/contract';
import {
  isSameBrowserEndpoint,
  isValidBrowserEndpoint,
} from './browser-client-routing.js';

export interface RelayWebSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type RelayPageRole = 'app' | 'editor' | 'preview';
export type RelayDeviceClass = 'managed' | 'physical';
export type RelayPageTarget = RuntimePageTarget;
export interface RelayClientMetadata extends RuntimePageTarget {
  pageId: string;
  role: RelayPageRole;
  tabGeneration: number;
  commandReady?: boolean;
}
export interface RelayOptions {
  verbose?: boolean;
  targetReconnectGraceMs?: number;
  /**
   * Called once per dispatched command whose outcome became unknown (deadline,
   * dispatch failure or target disconnect), after the relay has fenced the
   * exact endpoint generation the command reached and before the caller is
   * told.
   */
  onOutcomeUnknown?(
    endpoint: RelayClientMetadata,
    code: RelayUnknownOutcomeCode,
  ): void;
}
export type RelayUnknownOutcomeCode = 'command_timeout' | 'connection_lost';
export interface RelayHandler {
  onMessage(
    senderWs: RelayWebSocket,
    data: string,
    clients: Set<RelayWebSocket>,
  ): void;
  /**
   * Registers a socket's one endpoint generation. A registered socket may only
   * update readiness; identity or generation changes return false unchanged.
   */
  registerBrowserClient(
    ws: RelayWebSocket,
    metadata: RelayClientMetadata,
  ): boolean;
  unregisterClient(ws: RelayWebSocket): void;
  pendingCount(): number;
  /** Settles every pending command as the runtime stops. */
  close(): void;
}
/**
 * A request's absolute `deadline` is shared with its caller, so the relay
 * settles this long before it for the fenced timeout reply to arrive in time.
 */
export const RELAY_TRANSPORT_MARGIN_MS = 250;
/**
 * Raw legacy requests without a `deadline` get their method's default budget,
 * ending this long before the caller's matching transport timeout.
 */
export const RELAY_DEADLINE_MARGIN_MS = 3_000;
/** setTimeout fires longer delays immediately, so reject such deadlines. */
const MAX_RELAY_WINDOW_MS = 2 ** 31 - 1;
/**
 * Generation floors kept for endpoints that are gone, oldest forgotten first.
 * Unknown-outcome fences are never forgotten.
 */
const MAX_TRACKED_IDENTITIES = 4096;
interface UnknownOutcome {
  code: RelayUnknownOutcomeCode;
  message: string;
  /** Retire and close a still-registered target with this reason. */
  closeReason?: string;
}
const COMMAND_TIMEOUT: UnknownOutcome = {
  code: 'command_timeout',
  message:
    'Target did not reply before the deadline. Inspect state before retrying.',
  closeReason: 'Runtime command deadline exceeded',
};
const DISPATCH_FAILED: UnknownOutcome = {
  code: 'connection_lost',
  message:
    'Target connection failed while dispatching; inspect state before retrying.',
  closeReason: 'Runtime command dispatch failed',
};
const TARGET_DISCONNECTED: UnknownOutcome = {
  code: 'connection_lost',
  message:
    'Target disconnected before replying. The command may have executed; inspect state before retrying.',
};
interface Pending {
  source: RelayWebSocket;
  target: RelayWebSocket;
  sourceId: string;
  endpoint: RelayClientMetadata;
  timer: ReturnType<typeof setTimeout>;
}

/** A request is delivered once to exactly one registered endpoint. Never replay. */
export function createRelayHandler(options?: RelayOptions): RelayHandler {
  const endpoints = new Map<RelayWebSocket, RelayClientMetadata>();
  // A socket's endpoint ends when it is unregistered; it never registers again.
  const retired = new WeakSet<RelayWebSocket>();
  const pending = new Map<string, Pending>();
  const generations = new Map<string, number>();
  // Identities whose generation may still be running an unknown-outcome
  // command, until a newer generation registers.
  const fenced = new Set<string>();
  const key = (m: RelayClientMetadata) =>
    JSON.stringify([
      m.deviceClass ?? 'managed',
      m.headsetId,
      m.sessionId,
      m.browserEpoch,
      m.role,
      m.pageId,
    ]);
  /** Records a generation floor as the most recently used identity. */
  function setGeneration(identity: string, generation: number) {
    generations.delete(identity);
    generations.set(identity, generation);
  }
  /**
   * Bounds the generation map: the least recently used identity that has no
   * live endpoint (so no pending command) and no unknown-outcome fence is
   * forgotten. With none left, the new endpoint is refused.
   */
  function hasRoomFor(identity: string): boolean {
    if (
      generations.has(identity) ||
      generations.size < MAX_TRACKED_IDENTITIES
    ) {
      return true;
    }
    const live = new Set([...endpoints.values()].map(key));
    for (const old of generations.keys()) {
      if (!live.has(old) && !fenced.has(old)) {
        generations.delete(old);
        return true;
      }
    }
    return false;
  }
  function replyError(
    source: RelayWebSocket,
    id: string,
    code: string,
    message: string,
    outcome = 'not_executed',
    details = {},
  ) {
    if (source.readyState !== 1) {
      return;
    }
    try {
      source.send(
        JSON.stringify({
          id,
          error: { code: -32004, message, data: { code, outcome, ...details } },
        }),
      );
    } catch {}
  }
  function settle(id: string): Pending | undefined {
    const request = pending.get(id);
    if (request) {
      pending.delete(id);
      clearTimeout(request.timer);
    }
    return request;
  }
  /** The only settlement path for a dispatched command with no reply. */
  function settleUnknown(id: string, outcome: UnknownOutcome) {
    const request = settle(id);
    if (!request) {
      return;
    }
    // The command may still be running, so this exact generation must never
    // receive another command. A reload is a new generation and may register.
    const identity = key(request.endpoint);
    fenced.add(identity);
    setGeneration(
      identity,
      Math.max(
        generations.get(identity) ?? 0,
        request.endpoint.tabGeneration + 1,
      ),
    );
    if (outcome.closeReason && endpoints.has(request.target)) {
      unregisterClient(request.target);
      try {
        request.target.close(1011, outcome.closeReason);
      } catch {}
    }
    options?.onOutcomeUnknown?.(request.endpoint, outcome.code);
    replyError(
      request.source,
      request.sourceId,
      outcome.code,
      outcome.message,
      'outcome_unknown',
    );
  }
  /** Milliseconds this relay may wait, NaN when the deadline is malformed. */
  function relayWindowMs(
    method: string,
    deadline: unknown,
    params: unknown,
  ): number {
    // Only an omitted deadline is legacy; an explicit null is malformed.
    if (deadline === undefined) {
      return (
        getDefaultRuntimeCommandTimeoutMs(method, params) -
        RELAY_DEADLINE_MARGIN_MS
      );
    }
    if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
      return NaN;
    }
    const remainingMs = deadline - Date.now();
    return remainingMs <= MAX_RELAY_WINDOW_MS
      ? remainingMs - RELAY_TRANSPORT_MARGIN_MS
      : NaN;
  }
  function onMessage(
    source: RelayWebSocket,
    data: string,
    clients: Set<RelayWebSocket>,
  ) {
    let message: {
      id?: string;
      method?: string;
      /** The caller's absolute deadline in epoch milliseconds. */
      deadline?: unknown;
      target?: RuntimePageTarget;
      result?: unknown;
      error?: unknown;
      [key: string]: unknown;
    };
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!message || typeof message.id !== 'string') {
      return;
    }
    if (typeof message.method !== 'string') {
      const request = pending.get(message.id);
      if (!request || request.target !== source) {
        return;
      }
      settle(message.id);
      if (request.source.readyState === 1) {
        try {
          request.source.send(
            JSON.stringify({ ...message, id: request.sourceId }),
          );
        } catch {}
      }
      return;
    }
    const windowMs = relayWindowMs(
      message.method,
      message.deadline,
      message.params,
    );
    if (Number.isNaN(windowMs)) {
      return replyError(
        source,
        message.id,
        'invalid_params',
        'deadline must be an absolute epoch time in milliseconds within 24 days.',
      );
    }
    if (windowMs <= 0) {
      return replyError(
        source,
        message.id,
        'deadline_exceeded',
        'The request deadline elapsed before dispatch; the command did not run.',
      );
    }
    const target = {
      role: 'app' as const,
      deviceClass: 'managed' as const,
      ...message.target,
    };
    if (
      target.deviceClass === 'physical' &&
      (!target.headsetId ||
        !target.pageId ||
        !Number.isInteger(target.tabGeneration))
    ) {
      return replyError(
        source,
        message.id,
        'invalid_target',
        'Physical targets require headsetId, pageId and tabGeneration. Use runtime_list_targets.',
      );
    }
    const candidates = [...endpoints].filter(
      ([ws, metadata]) =>
        ws !== source &&
        ws.readyState === 1 &&
        clients.has(ws) &&
        matches(metadata, target),
    );
    if (candidates.length !== 1) {
      const stale = target.pageId != null || target.tabGeneration != null;
      return replyError(
        source,
        message.id,
        candidates.length > 1
          ? 'ambiguous_target'
          : stale
            ? 'stale_browser_tab'
            : 'target_unavailable',
        candidates.length > 1
          ? 'More than one endpoint matches; supply an exact runtimeTarget.'
          : 'No current endpoint matches. Use runtime_list_targets to refresh its identity.',
        'not_executed',
        { target },
      );
    }
    const [destination, metadata] = candidates[0];
    if (metadata.commandReady === false && message.method !== 'reload_page') {
      return replyError(
        source,
        message.id,
        'target_not_ready',
        'The selected runtime is connected but not command-ready.',
      );
    }
    if (pending.size >= 256) {
      return replyError(
        source,
        message.id,
        'runtime_busy',
        'Runtime command capacity reached.',
      );
    }
    const wireId = randomUUID();
    const timer = setTimeout(
      () => settleUnknown(wireId, COMMAND_TIMEOUT),
      windowMs,
    );
    timer.unref?.();
    pending.set(wireId, {
      source,
      target: destination,
      sourceId: message.id,
      endpoint: metadata,
      timer,
    });
    // The caller's command credential is never forwarded to a page.
    const { commandToken: _commandToken, ...request } = message;
    try {
      destination.send(JSON.stringify({ ...request, id: wireId, target }));
    } catch {
      settleUnknown(wireId, DISPATCH_FAILED);
    }
  }
  function unregisterClient(ws: RelayWebSocket) {
    endpoints.delete(ws);
    retired.add(ws);
    // A departed caller leaves its commands armed: the target still owns an
    // unknown outcome until it replies or the deadline fences it.
    for (const [id, request] of pending) {
      if (request.target === ws) {
        settleUnknown(id, TARGET_DISCONNECTED);
      }
    }
  }
  return {
    onMessage,
    registerBrowserClient(ws, metadata) {
      if (!isValidBrowserEndpoint(metadata)) {
        return false;
      }
      const endpoint = {
        ...metadata,
        deviceClass: metadata.deviceClass ?? 'managed',
      };
      const current = endpoints.get(ws);
      if (current) {
        // Pending commands stay bound to the identity they were admitted to.
        if (!isSameBrowserEndpoint(current, endpoint)) {
          return false;
        }
        endpoints.set(ws, { ...current, commandReady: endpoint.commandReady });
        return true;
      }
      const identity = key(endpoint);
      const predecessors = [...endpoints].filter(
        ([, old]) => key(old) === identity,
      );
      if (
        retired.has(ws) ||
        (generations.get(identity) ?? 0) > endpoint.tabGeneration ||
        predecessors.some(
          ([, old]) => old.tabGeneration > endpoint.tabGeneration,
        ) ||
        !hasRoomFor(identity)
      ) {
        return false;
      }
      // A new connection/generation retires its predecessor. This also fences
      // responses from old sockets and prevents a stale generation resurfacing.
      for (const [existing] of predecessors) {
        unregisterClient(existing);
      }
      // A retired predecessor with an unknown outcome fences its generation.
      if ((generations.get(identity) ?? 0) > endpoint.tabGeneration) {
        return false;
      }
      setGeneration(identity, endpoint.tabGeneration);
      fenced.delete(identity);
      endpoints.set(ws, endpoint);
      return true;
    },
    unregisterClient,
    pendingCount: () => pending.size,
    close() {
      endpoints.clear();
      for (const [id, request] of pending) {
        settle(id);
        replyError(
          request.source,
          request.sourceId,
          'runtime_stopping',
          'Runtime stopped before the target replied. Inspect state after restarting.',
          'outcome_unknown',
        );
      }
    },
  };
}
function matches(metadata: RelayClientMetadata, target: RuntimePageTarget) {
  return Object.entries(target).every(
    ([key, value]) =>
      value == null ||
      (key === 'deviceClass'
        ? (metadata.deviceClass ?? 'managed')
        : metadata[key as keyof RelayClientMetadata]) === value,
  );
}
