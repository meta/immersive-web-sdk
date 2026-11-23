/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * MetaVR telemetry integration for IWSDK.
 *
 * Reports MCP tool calls, session lifecycle, and errors through MetaVR's
 * DeveloperTelemetry pipeline via the `metavr xxiwsdk` subcommand.
 * All calls are fire-and-forget — telemetry never blocks or breaks the tool.
 * At most a few MetaVR processes run at once; further events wait their turn.
 *
 * Executes MetaVR's JavaScript entrypoint with the current Node executable.
 * This avoids platform shell shims and works the same way on Windows and Unix.
 * If MetaVR is not installed in the workspace, telemetry is silently skipped.
 */

import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

function resolveMetaVrEntrypoint(): string | null {
  try {
    const requireFromWorkspace = createRequire(
      path.join(process.cwd(), 'package.json'),
    );
    return requireFromWorkspace.resolve('@meta-quest/metavr/bin.js');
  } catch {
    return null;
  }
}

// At most this many MetaVR processes run at once. Each event is its own
// Node process that lives under a second; the dev server reports every MCP
// tool call, and an agent can issue them faster than that, so without a limit
// thousands of these processes piled up on a devserver.
const MAX_RUNNING = 4;
// Events waiting beyond this are dropped, so telemetry never grows without
// bound when a caller outpaces MetaVR for a long time.
const MAX_QUEUED = 1000;

const queued: string[][] = [];
let running = 0;
let exitHookInstalled = false;

function launch(argv: string[]): void {
  running++;
  let finished = false;
  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    running--;
    drain();
  };
  try {
    const child = spawn(process.execPath, argv, {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', finish);
    child.on('exit', finish);
    child.unref();
  } catch {
    finish();
  }
}

function drain(): void {
  while (running < MAX_RUNNING && queued.length > 0) {
    launch(queued.shift()!);
  }
}

/**
 * Starts up to MAX_RUNNING of the events still waiting and drops the rest.
 * Runs when the process exits, so a burst at the end neither floods the
 * machine nor keeps the process alive. Session and error events wait at the
 * front, so they are the ones started.
 */
export function flushQueuedTelemetry(): void {
  const remaining = queued.splice(0, MAX_RUNNING);
  queued.length = 0;
  for (const argv of remaining) {
    launch(argv);
  }
}

function metaVrTelemetry(
  args: string[],
  clientVersion?: string,
  urgent = false,
): void {
  const entrypoint = resolveMetaVrEntrypoint();
  if (entrypoint == null) {
    return;
  }

  const globalArgs = ['xxiwsdk'];
  if (clientVersion) {
    globalArgs.push('--client-version', clientVersion);
  }
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', flushQueuedTelemetry);
  }
  const argv = [entrypoint, ...globalArgs, ...args];
  if (urgent) {
    // Session boundaries and errors are rare and matter more than any one
    // tool call, so they go ahead of a backlog and are never dropped for it.
    queued.unshift(argv);
  } else if (queued.length < MAX_QUEUED) {
    queued.push(argv);
  }
  drain();
}

export function reportToolCall(
  toolName: string,
  success: boolean,
  durationMs: number,
  error?: string,
  sessionId?: string,
  clientVersion?: string,
): void {
  const args = [
    'tool-call',
    '--tool-name',
    toolName,
    '--duration-ms',
    String(Math.round(durationMs)),
  ];
  if (!success) {
    args.push('--failure');
  }
  if (error) {
    args.push('--error', error);
  }
  if (sessionId) {
    args.push('--session-id', sessionId);
  }
  metaVrTelemetry(args, clientVersion);
}

export function reportSessionStart(
  sessionId: string,
  opts?: {
    iwsdkVersion?: string;
    device?: string;
    port?: number;
    clientVersion?: string;
  },
): void {
  const args = ['session-start', '--session-id', sessionId];
  if (opts?.iwsdkVersion) {
    args.push('--iwsdk-version', opts.iwsdkVersion);
  }
  if (opts?.device) {
    args.push('--device', opts.device);
  }
  if (opts?.port) {
    args.push('--port', String(opts.port));
  }
  metaVrTelemetry(args, opts?.clientVersion, true);
}

export function reportSessionEnd(
  sessionId: string,
  opts?: { durationMs?: number; reason?: string; clientVersion?: string },
): void {
  const args = ['session-end', '--session-id', sessionId];
  if (opts?.durationMs != null) {
    args.push('--duration-ms', String(Math.round(opts.durationMs)));
  }
  if (opts?.reason) {
    args.push('--reason', opts.reason);
  }
  metaVrTelemetry(args, opts?.clientVersion, true);
}

export function reportError(
  type: string,
  message: string,
  opts?: { context?: string; sessionId?: string; clientVersion?: string },
): void {
  const args = ['error', '--type', type, '--message', message];
  if (opts?.context) {
    args.push('--context', opts.context);
  }
  if (opts?.sessionId) {
    args.push('--session-id', opts.sessionId);
  }
  metaVrTelemetry(args, opts?.clientVersion, true);
}
