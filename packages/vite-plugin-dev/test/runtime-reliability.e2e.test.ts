/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { acquireBrowserLease } from '../../cli/src/browser-lease.js';
import { getRuntimeSession } from '../../cli/src/runtime-state.js';
import { sendRuntimeCommand } from '../../cli/src/runtime-transport.js';
import { iwsdkDev } from '../src/index.js';
import { managedBrowserProfilePath } from '../src/managed-browser/launch.js';
import {
  createEditorTestHarness,
  type EditorTestHarness,
} from './editor-e2e-fixture.js';

let harness: EditorTestHarness;
async function command(method: string, params = {}, target?: any) {
  const session = await getRuntimeSession(harness.tempRoot);
  if (!session) {
    throw new Error('No runtime session');
  }
  return sendRuntimeCommand({
    port: session.port,
    method,
    params,
    target,
    runtimeSession: session,
    timeoutMs: 60000,
  });
}
async function status() {
  return (await command('runtime_get_status')).result as any;
}
async function ready() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      if (
        (await status()).targets.some(
          (t: any) =>
            t.role === 'app' && t.deviceClass === 'managed' && t.commandReady,
        )
      ) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Runtime did not become ready: ${JSON.stringify(await getRuntimeSession(harness.tempRoot))}`,
  );
}

describe('runtime reliability with real managed Chromium', () => {
  beforeAll(async () => {
    process.env.IWSDK_GPU = 'swiftshader';
    process.env.IWSDK_DEV_ALLOW_BROWSER_AUTOMATION = 'true';
    process.env.IWSDK_DEV_HEADLESS = 'true';
    try {
      harness = await createEditorTestHarness('runtime-reliability', {
        managedBrowser: true,
      });
    } finally {
      delete process.env.IWSDK_DEV_ALLOW_BROWSER_AUTOMATION;
      delete process.env.IWSDK_DEV_HEADLESS;
    }
    await ready();
  }, 90000);
  afterAll(async () => {
    await harness?.close();
    delete process.env.IWSDK_GPU;
  });

  test('exposes owner identity and exact endpoint capabilities without mutating status', async () => {
    const first = await status();
    const next = await status();
    expect(first.owner.sessionId).toBe(first.sessionId);
    expect(first.browser.lifecycle.state).toBe('running');
    expect(next.browser.lifecycle.browserEpoch).toBe(
      first.browser.lifecycle.browserEpoch,
    );
    expect(
      first.targets.find((t: any) => t.role === 'app').runtimeTarget,
    ).toMatchObject({
      deviceClass: 'managed',
      sessionId: first.sessionId,
      browserEpoch: 1,
    });
    expect((await command('ecs_list_systems')).error).toBeUndefined();
  });
  test('headless Chromium refuses a second process on the same owned profile', async () => {
    let duplicate:
      | Awaited<ReturnType<typeof chromium.launchPersistentContext>>
      | undefined;
    try {
      await expect(
        chromium
          .launchPersistentContext(
            managedBrowserProfilePath(harness.tempRoot),
            {
              channel: 'chromium',
              headless: true,
              timeout: 10000,
            },
          )
          .then((context) => {
            duplicate = context;
            return context;
          }),
      ).rejects.toThrow(
        /ProcessSingleton|SingletonLock|profile is already in use/iu,
      );
      expect((await status()).browser.lifecycle.state).toBe('running');
    } finally {
      await duplicate?.close();
    }
  }, 15000);
  test('refuses a second Vite owner before binding another port or launching a browser', async () => {
    const duplicate = await createServer({
      root: harness.tempRoot,
      logLevel: 'silent',
      plugins: [iwsdkDev()],
      server: { port: 0 },
    });
    try {
      await expect(duplicate.listen()).rejects.toThrow(
        'already has a dev runtime',
      );
    } finally {
      await duplicate.close();
    }
    expect((await status()).browser.lifecycle.browserEpoch).toBe(1);
  });
  test('rejects raw selectors that try to override the owning role or device class', async () => {
    for (const target of [
      { deviceClass: 'managed', role: 'editor' },
      { deviceClass: 'unknown' },
    ]) {
      await expect(
        command('ecs_list_systems', {}, target),
      ).rejects.toMatchObject({
        details: { code: 'invalid_target', outcome: 'not_executed' },
      });
    }
  });
  test('requires explicit physical selection, rejects host-only tools and relays reload once', async () => {
    const pair = (
      await command('runtime_pair_headset', { headsetId: 'integration-quest' })
    ).result as any;
    const socket = new WebSocket(
      `${harness.baseUrl.replace('https:', 'wss:').replace('http:', 'ws:')}__iwer_mcp`,
      { rejectUnauthorized: false },
    );
    await new Promise<void>((resolve) => socket.once('open', resolve));
    const requests: any[] = [];
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      requests.push(message);
      socket.send(
        JSON.stringify({ id: message.id, result: { reloaded: true } }),
      );
    });
    const target = {
      deviceClass: 'physical' as const,
      headsetId: 'integration-quest',
      pageId: 'native',
      tabGeneration: 1,
    };
    socket.send(
      JSON.stringify({
        type: 'iwsdk_browser_hello',
        deviceClass: 'physical',
        headsetToken: new URL(pair.url).searchParams.get('__iwsdk_headset'),
        role: 'app',
        pageId: 'native',
        tabGeneration: 1,
        commandReady: true,
      }),
    );
    try {
      await expect
        .poll(async () =>
          (await status()).targets.some(
            (t: any) => t.headsetId === target.headsetId,
          ),
        )
        .toBe(true);
      await command('ecs_list_systems');
      expect(requests).toHaveLength(0);
      await expect(
        command('browser_snapshot', {}, target),
      ).rejects.toMatchObject({
        details: { code: 'unsupported_on_target', outcome: 'not_executed' },
      });
      expect(
        (await command('ui_inspect', { entityIndex: 0 }, target)).result,
      ).toEqual({ reloaded: true });
      expect(requests.at(-1)).toMatchObject({ method: 'ui_inspect' });
      // The headset page only ever sees the command, never the credential.
      expect(requests.at(-1)).not.toHaveProperty('commandToken');
      expect((await command('reload_page', {}, target)).result).toEqual({
        reloaded: true,
      });
      expect(requests).toHaveLength(2);
      await expect(
        command('reload_page', {}, { ...target, tabGeneration: 2 }),
      ).rejects.toMatchObject({ details: { code: 'stale_browser_tab' } });
    } finally {
      socket.close();
    }
  });
  test('browser-run lease serializes host commands while status stays responsive', async () => {
    const session = await getRuntimeSession(harness.tempRoot);
    const lease = await acquireBrowserLease(session!, 5000);
    let completed = false;
    const snapshot = command('browser_snapshot').then((result) => {
      completed = true;
      return result;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(completed).toBe(false);
      expect((await status()).browser.lifecycle.state).toBe('running');
    } finally {
      lease.release();
    }
    expect((await snapshot).error).toBeUndefined();
  });
  test('retires the browser when a browser-run lease is abandoned', async () => {
    const before = await status();
    const session = await getRuntimeSession(harness.tempRoot);
    const lease = await acquireBrowserLease(session!, 5000);
    lease.abandon();
    await expect
      .poll(async () => (await status()).browser.lifecycle.state)
      .toBe('failed');
    await expect(command('ecs_list_systems')).rejects.toMatchObject({
      details: { code: 'browser_relaunched', outcome: 'not_executed' },
    });
    await ready();
    expect((await status()).browser.lifecycle.browserEpoch).toBe(
      before.browser.lifecycle.browserEpoch + 1,
    );
  }, 90000);
  test('recovers after a real page close through an ECS command without replaying it', async () => {
    const before = await status();
    const app = before.targets.find(
      (t: any) => t.deviceClass === 'managed' && t.role === 'app',
    );
    const session = await getRuntimeSession(harness.tempRoot);
    const browser = await chromium.connectOverCDP(
      session!.browserAutomation!.endpoint!,
    );
    try {
      await browser.contexts()[0].pages()[0].close();
    } finally {
      await browser.close();
    }
    await expect
      .poll(async () => (await status()).browser.lifecycle.state)
      .toBe('failed');
    await expect(command('ecs_list_systems')).rejects.toMatchObject({
      details: { code: 'browser_relaunched', outcome: 'not_executed' },
    });
    await ready();
    expect((await status()).browser.lifecycle.browserEpoch).toBe(
      before.browser.lifecycle.browserEpoch + 1,
    );
    await expect(
      command('ecs_list_systems', {}, app.runtimeTarget),
    ).rejects.toThrow();
    expect((await command('ecs_list_systems')).error).toBeUndefined();
  }, 90000);
});
