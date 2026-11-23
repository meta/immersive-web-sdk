/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
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
// Node process that lives under a second; a caller that issues commands
// faster than that (an agent's check script calling runCli in a loop, the MCP
// server) would otherwise start one per command with nothing waiting for
// them, and thousands piled up on a devserver.
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
 * machine nor keeps the process alive.
 */
export function flushQueuedTelemetry(): void {
  const remaining = queued.splice(0, MAX_RUNNING);
  queued.length = 0;
  for (const argv of remaining) {
    launch(argv);
  }
}

function metaVrTelemetry(args: string[], clientVersion?: string): void {
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
  if (queued.length >= MAX_QUEUED) {
    return;
  }
  queued.push([entrypoint, ...globalArgs, ...args]);
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
    // Attached, so MetaVR accepts messages that start with "-", such as
    // "--input-json must be valid JSON".
    args.push(`--error=${error}`);
  }
  if (sessionId) {
    args.push('--session-id', sessionId);
  }
  metaVrTelemetry(args, clientVersion);
}
