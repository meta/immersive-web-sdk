/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import WebSocket from 'ws';
import {
  getDefaultRuntimeCommandTimeoutMs,
  isRuntimeBrowserCommandReady,
  type RuntimePageTarget,
  type RuntimeBrowserState,
  type RuntimeIssueCause,
  type RuntimeSession,
} from './runtime-contract.js';
import { getRuntimeCommandToken } from './runtime-state.js';

const FAST_WSS_FALLBACK_TIMEOUT_MS = 1500;
const SCENE_OPEN_READY_POLL_INTERVAL_MS = 50;

type RuntimeCommandError = {
  message?: string;
  cause?: RuntimeIssueCause;
  data?: Record<string, unknown>;
};
type TransportProtocol = 'ws' | 'wss';

export interface RuntimeCommandResponse {
  id?: string;
  result?: unknown;
  _tabId?: string;
  _tabGeneration?: number;
  error?: RuntimeCommandError;
}

export interface SendRuntimeCommandOptions {
  port: number;
  method: string;
  params?: unknown;
  target?: RuntimePageTarget;
  timeoutMs?: number;
  runtimeSession?: RuntimeSession | null;
}

type RuntimeCommandRequest = Omit<SendRuntimeCommandOptions, 'timeoutMs'> & {
  commandToken?: string;
};

export class RuntimeCommandExecutionError extends Error {
  issueCause?: RuntimeIssueCause;
  browser?: RuntimeBrowserState;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      issueCause?: RuntimeIssueCause;
      browser?: RuntimeBrowserState;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = 'RuntimeCommandExecutionError';
    this.issueCause = options.issueCause;
    this.browser = options.browser;
    this.details = options.details;
  }
}

class RuntimeCommandTransportError extends RuntimeCommandExecutionError {
  constructor(
    message: string,
    options: {
      issueCause?: RuntimeIssueCause;
      browser?: RuntimeBrowserState;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message, options);
    this.name = 'RuntimeCommandTransportError';
  }
}

function isTraceEnabled(): boolean {
  return process.env.IWSDK_RUNTIME_TRACE === '1';
}

function traceTransport(
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!isTraceEnabled()) {
    return;
  }
  console.error(
    `[IWSDK-RUNTIME-TRACE][transport] ${event} ${JSON.stringify(details)}`,
  );
}

function getRawDataSize(data: WebSocket.RawData): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data);
  }
  if (Array.isArray(data)) {
    return data.reduce((total, chunk) => total + chunk.length, 0);
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  return data.length;
}

function getProtocolOrder(
  runtimeSession?: RuntimeSession | null,
): TransportProtocol[] {
  if (runtimeSession?.localUrl.startsWith('http://')) {
    return ['ws'];
  }
  if (runtimeSession?.localUrl.startsWith('https://')) {
    return ['wss'];
  }
  return ['wss', 'ws'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

const PERMISSION_FAILURE =
  /permission|not permitted|denied|sandbox|eacces|eperm/i;

function isTransportFailure(normalized: string): boolean {
  return (
    normalized.includes('socket hang up') ||
    normalized.includes('closed before response') ||
    normalized.includes('request timeout') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused')
  );
}

/** A headset's failures are its own; managed browser state never explains them. */
function inferPhysicalIssueCause(
  message: string,
  explicitCause?: RuntimeIssueCause,
): RuntimeIssueCause | undefined {
  if (explicitCause) {
    return explicitCause;
  }
  if (PERMISSION_FAILURE.test(message)) {
    return 'permission_denied';
  }
  return isTransportFailure(message.toLowerCase())
    ? 'connection_lost'
    : undefined;
}

function inferRuntimeIssueCause(
  message: string,
  browser: RuntimeBrowserState | undefined,
  explicitCause?: RuntimeIssueCause,
): RuntimeIssueCause | undefined {
  if (explicitCause) {
    return explicitCause;
  }

  const normalized = message.toLowerCase();
  if (browser?.status === 'launch_failed') {
    return browser.lastError?.cause ?? 'browser_launch_failed';
  }
  if (browser?.status === 'not_launched') {
    return 'browser_not_launched';
  }
  if (
    browser?.status === 'launching' ||
    browser?.status === 'waiting_for_connection'
  ) {
    return 'browser_not_ready';
  }
  if (browser?.status === 'disconnected') {
    return browser.lastError?.cause ?? 'connection_lost';
  }
  if (normalized.includes('browser not ready')) {
    return browser?.lastError?.cause ?? 'browser_not_ready';
  }
  if (
    normalized.includes('browser_relaunched') ||
    normalized.includes('relaunch')
  ) {
    return 'browser_relaunched';
  }
  if (PERMISSION_FAILURE.test(normalized)) {
    return 'permission_denied';
  }
  if (isTransportFailure(normalized)) {
    if (
      browser &&
      !isRuntimeBrowserCommandReady({
        schemaVersion: 1,
        browser,
      })
    ) {
      return 'browser_not_ready';
    }
    return browser?.connected ? 'connection_lost' : 'browser_not_ready';
  }
  return undefined;
}

async function trySendRuntimeCommand(
  protocol: TransportProtocol,
  port: number,
  method: string,
  params: unknown,
  target: RuntimePageTarget | undefined,
  deadline: number,
  connectDeadline: number,
  browser: RuntimeBrowserState | undefined,
  expectedSessionId?: string,
  commandToken?: string,
): Promise<RuntimeCommandResponse> {
  const inferCause = (message: string, explicitCause?: RuntimeIssueCause) =>
    target?.deviceClass === 'physical'
      ? inferPhysicalIssueCause(message, explicitCause)
      : inferRuntimeIssueCause(message, browser, explicitCause);
  return new Promise<RuntimeCommandResponse>((resolve, reject) => {
    const timeoutMs = Math.max(
      Math.min(deadline, connectDeadline) - Date.now(),
      1,
    );
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const wsUrl = `${protocol}://127.0.0.1:${port}/__iwer_mcp`;
    const ws = new WebSocket(wsUrl, {
      rejectUnauthorized: false,
    });
    let settled = false;
    let dispatched = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const closeSocket = () => {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };

    traceTransport('connect_start', {
      method,
      requestId,
      protocol,
      port,
      timeoutMs,
      browserStatus: browser?.status,
      bridgeConnected: browser?.connected ?? false,
      commandReady: browser
        ? isRuntimeBrowserCommandReady({
            schemaVersion: 1,
            browser,
          })
        : false,
    });

    const onTimeout = () => {
      const message = `Request timeout for ${method}`;
      traceTransport('timeout', {
        method,
        requestId,
        protocol,
        port,
      });
      closeSocket();
      finish(() =>
        reject(
          new RuntimeCommandTransportError(message, {
            issueCause: inferCause(message),
            browser,
            details: {
              outcome: dispatched ? 'outcome_unknown' : 'not_executed',
            },
          }),
        ),
      );
    };
    // Until the socket opens, only the connection budget applies; a probe that
    // times out has dispatched nothing and may fall back to another protocol.
    let timeout = setTimeout(onTimeout, timeoutMs);

    ws.on('open', () => {
      // Once open, the command gets its whole original deadline, and the relay
      // settles against that same absolute deadline, so admission time and a
      // WSS probe never extend or shorten the caller's budget. An open that
      // lands after the deadline dispatches nothing.
      clearTimeout(timeout);
      if (deadline <= Date.now()) {
        onTimeout();
        return;
      }
      timeout = setTimeout(onTimeout, deadline - Date.now());
      const payload = JSON.stringify({
        deadline,
        expectedSessionId,
        id: requestId,
        method,
        params: params ?? {},
        ...(target ? { target } : {}),
        commandToken,
      });
      traceTransport('open', {
        method,
        requestId,
        protocol,
        port,
      });
      dispatched = true;
      ws.send(payload, (error) => {
        if (!error) {
          traceTransport('send', {
            method,
            requestId,
            protocol,
            bytes: Buffer.byteLength(payload),
          });
          return;
        }
        traceTransport('send_error', {
          method,
          requestId,
          protocol,
          message: error.message,
        });
        closeSocket();
        finish(() =>
          reject(
            new RuntimeCommandTransportError(error.message, {
              issueCause: inferCause(error.message),
              browser,
              details: {
                outcome: dispatched ? 'outcome_unknown' : 'not_executed',
              },
            }),
          ),
        );
      });
    });

    ws.on('message', (data: WebSocket.RawData) => {
      traceTransport('message', {
        method,
        requestId,
        protocol,
        bytes: getRawDataSize(data),
      });
      try {
        const response = JSON.parse(data.toString()) as RuntimeCommandResponse;
        if (response.id !== requestId) {
          traceTransport('message_ignored', {
            method,
            requestId,
            protocol,
            responseId: response.id ?? null,
          });
          return;
        }

        closeSocket();
        if (response.error) {
          const message = response.error.message ?? 'Unknown runtime error';
          const explicitCause = response.error.cause;
          const details = response.error.data;
          traceTransport('runtime_error', {
            method,
            requestId,
            protocol,
            message,
            cause: explicitCause ?? null,
          });
          finish(() =>
            reject(
              new RuntimeCommandExecutionError(message, {
                issueCause: inferCause(message, explicitCause),
                browser,
                details,
              }),
            ),
          );
          return;
        }
        traceTransport('response', {
          method,
          requestId,
          protocol,
        });
        finish(() => resolve(response));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        traceTransport('message_parse_error', {
          method,
          requestId,
          protocol,
          message,
        });
        closeSocket();
        finish(() =>
          reject(
            new RuntimeCommandTransportError(message, {
              issueCause: inferCause(message),
              browser,
              details: {
                outcome: dispatched ? 'outcome_unknown' : 'not_executed',
              },
            }),
          ),
        );
      }
    });

    ws.on('error', (error: Error) => {
      traceTransport('error', {
        method,
        requestId,
        protocol,
        message: error.message,
      });
      closeSocket();
      finish(() =>
        reject(
          new RuntimeCommandTransportError(error.message, {
            issueCause: inferCause(error.message),
            browser,
            details: {
              outcome: dispatched ? 'outcome_unknown' : 'not_executed',
            },
          }),
        ),
      );
    });

    ws.on('close', (code, reasonBuffer) => {
      const reason =
        typeof reasonBuffer === 'string'
          ? reasonBuffer
          : reasonBuffer.toString('utf8');
      traceTransport('close', {
        method,
        requestId,
        protocol,
        code,
        reason,
        settled,
      });
      if (settled) {
        return;
      }
      const message =
        reason && reason.length > 0
          ? `Connection closed before response for ${method}: ${reason}`
          : `Connection closed before response for ${method} (code ${code})`;
      finish(() =>
        reject(
          new RuntimeCommandTransportError(message, {
            issueCause: inferCause(message),
            browser,
            details: {
              outcome: dispatched ? 'outcome_unknown' : 'not_executed',
            },
          }),
        ),
      );
    });
  });
}

async function sendRuntimeCommandBeforeDeadline(
  options: RuntimeCommandRequest,
  deadline: number,
): Promise<RuntimeCommandResponse> {
  const { commandToken, method, params, port, runtimeSession, target } =
    options;
  // Managed browser state describes the host browser only, never a headset.
  const browser =
    target?.deviceClass === 'physical' ? undefined : runtimeSession?.browser;
  const protocolOrder = getProtocolOrder(runtimeSession);
  const firstProtocol = protocolOrder[0];
  const fallbackProtocol = protocolOrder[1];
  const remainingAtStart = Math.max(deadline - Date.now(), 1);
  // An unknown scheme probes WSS briefly; the budget covers connecting only.
  const connectDeadline =
    fallbackProtocol && firstProtocol === 'wss'
      ? Date.now() + FAST_WSS_FALLBACK_TIMEOUT_MS
      : deadline;

  try {
    return await trySendRuntimeCommand(
      firstProtocol,
      port,
      method,
      params,
      target,
      deadline,
      connectDeadline,
      browser,
      runtimeSession?.sessionId,
      commandToken,
    );
  } catch (error) {
    if (!(error instanceof RuntimeCommandTransportError)) {
      throw error;
    }
    if (
      error.details?.outcome === 'outcome_unknown' ||
      !fallbackProtocol ||
      fallbackProtocol === firstProtocol
    ) {
      throw error;
    }
    const remainingMs = Math.max(deadline - Date.now(), 1);
    traceTransport('fallback_protocol', {
      method,
      from: firstProtocol,
      to: fallbackProtocol,
      elapsedMs: remainingAtStart - remainingMs,
      remainingMs,
      browserStatus: browser?.status,
      bridgeConnected: browser?.connected ?? false,
      commandReady: browser
        ? isRuntimeBrowserCommandReady({
            schemaVersion: 1,
            browser,
          })
        : false,
    });
    return trySendRuntimeCommand(
      fallbackProtocol,
      port,
      method,
      params,
      target,
      deadline,
      deadline,
      browser,
      runtimeSession?.sessionId,
      commandToken,
    );
  }
}

function sceneOpenReadinessRequest(
  method: string,
  params: unknown,
  response: RuntimeCommandResponse,
  previousSceneSessionId: string | null,
): { path: string; previousSceneSessionId: string | null } | null {
  if (method !== 'scene_open' || !isRecord(response.result)) {
    return null;
  }
  const result = response.result;
  if (result.reloading !== true || result.ready === true) {
    return null;
  }
  const request = isRecord(params) ? params : {};
  const scenePath =
    typeof result.path === 'string'
      ? result.path
      : typeof request.path === 'string'
        ? request.path
        : null;
  if (scenePath == null) {
    return null;
  }
  return {
    path: scenePath,
    previousSceneSessionId,
  };
}

function sceneWillOpen(method: string): boolean {
  return method === 'scene_open';
}

async function captureSceneOpenSessionBaseline(
  options: RuntimeCommandRequest,
  deadline: number,
): Promise<string | null> {
  if (!sceneWillOpen(options.method)) {
    return null;
  }
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const stateResponse = await sendRuntimeCommandBeforeDeadline(
        {
          commandToken: options.commandToken,
          method: 'scene_get_state',
          params: {},
          port: options.port,
          runtimeSession: options.runtimeSession,
          target: { role: 'editor' },
        },
        deadline,
      );
      const state = stateResponse.result;
      return isRecord(state) &&
        isRecord(state.editor) &&
        typeof state.editor.sceneSessionId === 'string'
        ? state.editor.sceneSessionId
        : null;
    } catch (error) {
      lastError = error;
    }
    await delayBeforeDeadline(deadline);
  }
  throw lastError instanceof Error
    ? lastError
    : new RuntimeCommandExecutionError(
        'Editor scene state was unavailable before opening the scene.',
        {
          browser: options.runtimeSession?.browser,
          issueCause: 'browser_not_ready',
        },
      );
}

function editorReadyForOpenedScene(
  state: unknown,
  scenePath: string,
  previousSceneSessionId: string | null,
): { sceneSessionId: string } | null {
  if (!isRecord(state) || !isRecord(state.editor)) {
    return null;
  }
  const editor = state.editor;
  const sceneSessionId = editor.sceneSessionId;
  if (
    editor.ready !== true ||
    (state.activeFile !== scenePath && editor.scenePath !== scenePath) ||
    typeof sceneSessionId !== 'string' ||
    sceneSessionId.length === 0 ||
    (previousSceneSessionId != null &&
      sceneSessionId === previousSceneSessionId)
  ) {
    return null;
  }
  return { sceneSessionId };
}

function delayBeforeDeadline(deadline: number): Promise<void> {
  const delayMs = Math.min(
    SCENE_OPEN_READY_POLL_INTERVAL_MS,
    Math.max(deadline - Date.now(), 0),
  );
  return delayMs > 0
    ? new Promise((resolve) => setTimeout(resolve, delayMs))
    : Promise.resolve();
}

async function confirmOpenedSceneReady(
  options: RuntimeCommandRequest,
  response: RuntimeCommandResponse,
  deadline: number,
  previousSceneSessionId: string | null,
): Promise<RuntimeCommandResponse> {
  const readiness = sceneOpenReadinessRequest(
    options.method,
    options.params,
    response,
    previousSceneSessionId,
  );
  if (readiness == null) {
    return response;
  }

  let lastWorkspaceState: unknown = null;
  let lastError: RuntimeCommandExecutionError | null = null;
  while (Date.now() < deadline) {
    try {
      const stateResponse = await sendRuntimeCommandBeforeDeadline(
        {
          commandToken: options.commandToken,
          method: 'scene_get_state',
          params: {},
          port: options.port,
          runtimeSession: options.runtimeSession,
          target: { role: 'editor' },
        },
        deadline,
      );
      lastWorkspaceState = stateResponse.result;
      lastError = null;
      const readyEditor = editorReadyForOpenedScene(
        lastWorkspaceState,
        readiness.path,
        readiness.previousSceneSessionId,
      );
      if (readyEditor != null) {
        return {
          ...response,
          ...(stateResponse._tabId == null
            ? {}
            : { _tabId: stateResponse._tabId }),
          ...(stateResponse._tabGeneration == null
            ? {}
            : { _tabGeneration: stateResponse._tabGeneration }),
          result: {
            ...(response.result as Record<string, unknown>),
            ready: true,
            reloading: false,
            sceneSessionId: readyEditor.sceneSessionId,
          },
        };
      }
    } catch (error) {
      lastError = error instanceof RuntimeCommandExecutionError ? error : null;
    }
    await delayBeforeDeadline(deadline);
  }

  const lastErrorSummary =
    lastError == null
      ? null
      : {
          cause: lastError.issueCause ?? null,
          message: lastError.message,
        };
  throw new RuntimeCommandExecutionError(
    `Scene "${readiness.path}" was opened, but the editor did not reconnect to it before the command timeout.`,
    {
      browser: options.runtimeSession?.browser,
      details: {
        code: 'scene_open_not_ready',
        opened: true,
        editorReady: false,
        lastError: lastErrorSummary,
        lastWorkspaceState,
        path: readiness.path,
        previousSceneSessionId: readiness.previousSceneSessionId,
        recoverable: true,
        retryAction: 'scene_get_state',
      },
      issueCause:
        lastWorkspaceState == null
          ? (lastError?.issueCause ?? 'browser_not_ready')
          : 'browser_not_ready',
    },
  );
}

export async function sendRuntimeCommand({
  port,
  method,
  params,
  target,
  timeoutMs = getDefaultRuntimeCommandTimeoutMs(method, params),
  runtimeSession,
}: SendRuntimeCommandOptions): Promise<RuntimeCommandResponse> {
  const deadline = Date.now() + Math.max(timeoutMs, 1);
  const commandToken =
    runtimeSession == null ? undefined : getRuntimeCommandToken(runtimeSession);
  const options = {
    commandToken,
    method,
    params,
    port,
    runtimeSession,
    target,
  };
  const previousSceneSessionId = await captureSceneOpenSessionBaseline(
    options,
    deadline,
  );
  const response = await sendRuntimeCommandBeforeDeadline(options, deadline);
  return confirmOpenedSceneReady(
    options,
    response,
    deadline,
    previousSceneSessionId,
  );
}
