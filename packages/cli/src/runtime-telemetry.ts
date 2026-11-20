/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { reportToolCall } from './metavr-telemetry.js';
import type {
  RuntimeIssueCause,
  RuntimeOperationDefinition,
  RuntimeSession,
} from './runtime-contract.js';
import { WorkspaceResolutionError } from './runtime-state.js';
import { RuntimeCommandExecutionError } from './runtime-transport.js';
import { CLI_VERSION } from './version.js';

/**
 * Codes the dev server, its relay, and the managed browser's command lock put
 * in `error.data.code`. They are constants defined there, so unlike messages
 * they never carry project content.
 */
type RuntimeHostErrorCode =
  | 'command_timeout'
  | 'browser_command_timeout'
  | 'browser_command_busy'
  | 'browser_command_queue_timeout'
  | 'target_not_ready'
  | 'target_unavailable'
  | 'ambiguous_target'
  | 'stale_browser_tab'
  | 'runtime_busy'
  | 'runtime_stopping'
  | 'unsupported_on_target';

/**
 * Why an operation failed, from a fixed list. Error messages are never
 * reported because they can name the project's files, components, or scenes.
 */
export type RuntimeFailureReason =
  | 'invalid_input'
  | 'no_app'
  | 'no_runtime'
  | 'runtime_error'
  | 'unknown'
  | RuntimeIssueCause
  | RuntimeHostErrorCode;

const ISSUE_CAUSES: Record<RuntimeIssueCause, true> = {
  browser_not_ready: true,
  browser_not_launched: true,
  browser_launch_failed: true,
  connection_lost: true,
  permission_denied: true,
  browser_relaunched: true,
  tab_throttled: true,
  open_failed: true,
};
const KNOWN_ISSUE_CAUSES: ReadonlySet<string> = new Set(
  Object.keys(ISSUE_CAUSES),
);

const HOST_ERROR_CODES: Record<RuntimeHostErrorCode, true> = {
  command_timeout: true,
  browser_command_timeout: true,
  browser_command_busy: true,
  browser_command_queue_timeout: true,
  target_not_ready: true,
  target_unavailable: true,
  ambiguous_target: true,
  stale_browser_tab: true,
  runtime_busy: true,
  runtime_stopping: true,
  unsupported_on_target: true,
};
const KNOWN_HOST_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.keys(HOST_ERROR_CODES),
);

/** Maps an error from resolving or running an operation to its reason. */
export function getRuntimeFailureReason(error: unknown): RuntimeFailureReason {
  if (error instanceof WorkspaceResolutionError) {
    return error.reason;
  }
  if (error instanceof RuntimeCommandExecutionError) {
    // The runtime forwards a string cause from whatever the app threw, so
    // only the known causes are reported.
    const cause = error.issueCause;
    if (cause && KNOWN_ISSUE_CAUSES.has(cause)) {
      return cause;
    }
    const code = error.details?.code;
    return typeof code === 'string' &&
      (KNOWN_HOST_ERROR_CODES.has(code) || KNOWN_ISSUE_CAUSES.has(code))
      ? (code as RuntimeHostErrorCode | RuntimeIssueCause)
      : 'runtime_error';
  }
  return 'unknown';
}

export interface RuntimeOperationTelemetry {
  /** Correlates the operation with the runtime session that serves it. */
  attachSession(session: Pick<RuntimeSession, 'sessionId'>): void;
  succeed(): void;
  fail(reason: RuntimeFailureReason): void;
}

/**
 * Records one runtime operation, whether the MCP server or the CLI ran it.
 * Both report the operation under its MCP tool name, so the same operation
 * produces the same event from either surface. Only the first outcome is
 * reported: a failure while presenting a successful result does not record
 * the operation a second time.
 */
export function startRuntimeOperationTelemetry(
  operation: Pick<RuntimeOperationDefinition, 'mcpName'>,
): RuntimeOperationTelemetry {
  const startTime = Date.now();
  let sessionId: string | undefined;
  let settled = false;

  const settle = (success: boolean, error?: string) => {
    if (settled) {
      return;
    }
    settled = true;
    reportToolCall(
      operation.mcpName,
      success,
      Date.now() - startTime,
      error,
      sessionId,
      CLI_VERSION,
    );
  };

  return {
    attachSession(session) {
      sessionId = session.sessionId;
    },
    succeed() {
      settle(true);
    },
    fail(reason) {
      settle(false, reason);
    },
  };
}
