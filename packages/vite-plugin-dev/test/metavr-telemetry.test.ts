/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { reportSessionStart } from '../src/metavr-telemetry.js';

const mocks = vi.hoisted(() => {
  const child = {
    on: vi.fn(),
    unref: vi.fn(),
  };
  return {
    child,
    resolve: vi.fn(),
    spawn: vi.fn(() => child),
  };
});

vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('module', () => ({
  createRequire: () => ({ resolve: mocks.resolve }),
}));

describe('MetaVR telemetry launcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockReturnValue(
      '/workspace/node_modules/@meta-quest/metavr/bin.js',
    );
  });

  test('uses the Node entrypoint without relying on the Windows npx.cmd shim', () => {
    reportSessionStart('session-1', {
      iwsdkVersion: '0.5.0',
      port: 8081,
      clientVersion: '1.2.3',
    });

    expect(mocks.resolve).toHaveBeenCalledWith('@meta-quest/metavr/bin.js');
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '/workspace/node_modules/@meta-quest/metavr/bin.js',
        'xxiwsdk',
        '--client-version',
        '1.2.3',
        'session-start',
        '--session-id',
        'session-1',
        '--iwsdk-version',
        '0.5.0',
        '--port',
        '8081',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    expect(mocks.child.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mocks.child.unref).toHaveBeenCalledOnce();
  });
});

describe('MetaVR telemetry queue', () => {
  // The queue lives at module level, so each test loads a fresh copy.
  async function freshModule() {
    vi.resetModules();
    return import('../src/metavr-telemetry.js');
  }

  function fakeChildren() {
    const children: EventEmitter[] = [];
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      children.push(child);
      return child as never;
    });
    return children;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockReturnValue(
      '/workspace/node_modules/@meta-quest/metavr/bin.js',
    );
  });

  test('runs at most four MetaVR processes and starts the next as one exits', async () => {
    const { reportToolCall: report } = await freshModule();
    const children = fakeChildren();

    for (let i = 0; i < 10; i++) {
      report(`tool_${i}`, true, 1);
    }
    expect(mocks.spawn).toHaveBeenCalledTimes(4);

    children[0].emit('exit', 0);
    expect(mocks.spawn).toHaveBeenCalledTimes(5);
    expect(mocks.spawn.mock.calls[4][1]).toContain('tool_4');

    // A child that fails to start frees its slot too, exactly once.
    children[1].emit('error', new Error('spawn failed'));
    children[1].emit('exit', 1);
    expect(mocks.spawn).toHaveBeenCalledTimes(6);
  });

  test('drops events beyond the queue limit instead of growing without bound', async () => {
    const { reportToolCall: report } = await freshModule();
    const children = fakeChildren();

    for (let i = 0; i < 1100; i++) {
      report('tool', true, 1);
    }
    expect(mocks.spawn).toHaveBeenCalledTimes(4);

    // Each exit starts the next waiting event; the array grows as they start.
    for (let i = 0; i < children.length; i++) {
      children[i].emit('exit', 0);
    }
    // Four ran immediately and 1000 waited; the last 96 were dropped.
    expect(mocks.spawn).toHaveBeenCalledTimes(1004);
  });

  test('session and error events go ahead of a backlog of tool calls', async () => {
    const { reportToolCall: report, reportSessionEnd } = await freshModule();
    const children = fakeChildren();

    for (let i = 0; i < 1100; i++) {
      report('tool', true, 1);
    }
    reportSessionEnd('session-1', { reason: 'stopped' });
    expect(mocks.spawn).toHaveBeenCalledTimes(4);

    children[0].emit('exit', 0);
    expect(mocks.spawn).toHaveBeenCalledTimes(5);
    expect(mocks.spawn.mock.calls[4][1]).toContain('session-end');
  });

  test('on exit, starts a few waiting events and drops the rest', async () => {
    const { reportToolCall: report, flushQueuedTelemetry } =
      await freshModule();
    fakeChildren();

    for (let i = 0; i < 20; i++) {
      report(`tool_${i}`, true, 1);
    }
    expect(mocks.spawn).toHaveBeenCalledTimes(4);

    flushQueuedTelemetry();
    expect(mocks.spawn).toHaveBeenCalledTimes(8);
    expect(mocks.spawn.mock.calls[7][1]).toContain('tool_7');

    flushQueuedTelemetry();
    expect(mocks.spawn).toHaveBeenCalledTimes(8);
  });
});
