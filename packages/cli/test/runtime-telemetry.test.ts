/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WorkspaceResolutionError } from '../src/runtime-state.js';
import {
  getRuntimeFailureReason,
  startRuntimeOperationTelemetry,
} from '../src/runtime-telemetry.js';
import { RuntimeCommandExecutionError } from '../src/runtime-transport.js';

const mocks = vi.hoisted(() => ({ reportToolCall: vi.fn() }));

vi.mock('../src/metavr-telemetry.js', () => ({
  reportToolCall: mocks.reportToolCall,
}));

const CLI_PACKAGE_VERSION = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

const operation = { mcpName: 'browser_screenshot' };

describe('runtime operation telemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    mocks.reportToolCall.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('reports a success under the MCP tool name with the session and CLI version', () => {
    const telemetry = startRuntimeOperationTelemetry(operation);
    telemetry.attachSession({ sessionId: 'session-1' });
    vi.advanceTimersByTime(42);
    telemetry.succeed();

    expect(mocks.reportToolCall).toHaveBeenCalledOnce();
    expect(mocks.reportToolCall).toHaveBeenCalledWith(
      'browser_screenshot',
      true,
      42,
      undefined,
      'session-1',
      CLI_PACKAGE_VERSION,
    );
  });

  test('reports a failure as its reason with the session', () => {
    const telemetry = startRuntimeOperationTelemetry(operation);
    telemetry.attachSession({ sessionId: 'session-1' });
    telemetry.fail('connection_lost');

    expect(mocks.reportToolCall).toHaveBeenCalledWith(
      'browser_screenshot',
      false,
      0,
      'connection_lost',
      'session-1',
      CLI_PACKAGE_VERSION,
    );
  });

  test('reports a failure without a session when none was attached', () => {
    const telemetry = startRuntimeOperationTelemetry(operation);
    telemetry.fail('no_runtime');

    expect(mocks.reportToolCall).toHaveBeenCalledWith(
      'browser_screenshot',
      false,
      0,
      'no_runtime',
      undefined,
      CLI_PACKAGE_VERSION,
    );
  });

  test('reports nothing until the operation settles', () => {
    const telemetry = startRuntimeOperationTelemetry(operation);
    telemetry.attachSession({ sessionId: 'session-1' });

    expect(mocks.reportToolCall).not.toHaveBeenCalled();
  });

  test('reports only the first outcome of an operation', () => {
    const telemetry = startRuntimeOperationTelemetry(operation);
    telemetry.succeed();
    telemetry.fail('unknown');
    telemetry.succeed();

    expect(mocks.reportToolCall).toHaveBeenCalledOnce();
    expect(mocks.reportToolCall).toHaveBeenCalledWith(
      'browser_screenshot',
      true,
      0,
      undefined,
      undefined,
      CLI_PACKAGE_VERSION,
    );
  });

  test('keeps the first failure when an operation fails twice', () => {
    const telemetry = startRuntimeOperationTelemetry(operation);
    telemetry.fail('no_runtime');
    telemetry.fail('runtime_error');

    expect(mocks.reportToolCall).toHaveBeenCalledOnce();
    expect(mocks.reportToolCall.mock.calls[0]?.[3]).toBe('no_runtime');
  });
});

describe('runtime failure reasons', () => {
  test.each(['no_app', 'no_runtime'] as const)(
    'reports a workspace failure as %s',
    (reason) => {
      expect(
        getRuntimeFailureReason(
          new WorkspaceResolutionError('No IWSDK app found at /app.', reason),
        ),
      ).toBe(reason);
    },
  );

  test('reports a runtime failure as its known cause', () => {
    expect(
      getRuntimeFailureReason(
        new RuntimeCommandExecutionError('Tab throttled', {
          issueCause: 'tab_throttled',
        }),
      ),
    ).toBe('tab_throttled');
  });

  test('reports other runtime failures without their message or cause', () => {
    expect(
      getRuntimeFailureReason(
        new RuntimeCommandExecutionError(
          "Component 'PlayerHealth' not found in registry.",
        ),
      ),
    ).toBe('runtime_error');
    expect(
      getRuntimeFailureReason(
        new RuntimeCommandExecutionError('Spawn failed', {
          issueCause: 'PlayerHealth' as never,
        }),
      ),
    ).toBe('runtime_error');
  });

  test.each([
    'command_timeout',
    'browser_command_timeout',
    'target_not_ready',
    'target_unavailable',
    'browser_relaunched',
    'connection_lost',
  ])('reports the host error code %s when there is no known cause', (code) => {
    expect(
      getRuntimeFailureReason(
        new RuntimeCommandExecutionError('Target did not reply.', {
          details: { code, outcome: 'outcome_unknown' },
        }),
      ),
    ).toBe(code);
  });

  test('prefers a known cause over the host error code', () => {
    expect(
      getRuntimeFailureReason(
        new RuntimeCommandExecutionError('Request timeout for screenshot', {
          issueCause: 'browser_not_ready',
          details: { code: 'command_timeout' },
        }),
      ),
    ).toBe('browser_not_ready');
  });

  test('reports unlisted or non-string host error codes as runtime_error', () => {
    for (const code of ['PlayerHealth', 'scene_file_not_found', 42]) {
      expect(
        getRuntimeFailureReason(
          new RuntimeCommandExecutionError('Spawn failed', {
            details: { code },
          }),
        ),
      ).toBe('runtime_error');
    }
  });

  test('reports any other error as unknown', () => {
    expect(
      getRuntimeFailureReason(new Error('Failed to save /app/shot.png')),
    ).toBe('unknown');
    expect(getRuntimeFailureReason('failed')).toBe('unknown');
  });
});
