/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  handleBrowserRun,
  protectManagedOwnership,
  selectManagedBrowserPage,
  withRenderHold,
} from '../src/commands/browser.js';

const temporaryPaths: string[] = [];

async function createWorkspace(browserAutomation: {
  configured?: boolean;
  enabled: boolean;
  endpoint?: string;
  protocol: string;
  targetId?: string;
}): Promise<string> {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'iwsdk-browser-run-test-'),
  );
  temporaryPaths.push(workspaceRoot);
  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      dependencies: { '@iwsdk/cli': '*' },
      name: 'browser-run-test',
      type: 'module',
    }),
  );
  await writeFile(
    path.join(workspaceRoot, 'vite.config.ts'),
    'export default {};',
  );
  await writeFile(
    path.join(workspaceRoot, 'run.mjs'),
    'export default () => null;',
  );
  await mkdir(path.join(workspaceRoot, '.iwsdk', 'runtime'), {
    recursive: true,
  });
  await writeFile(
    path.join(workspaceRoot, '.iwsdk', 'runtime', 'session.json'),
    JSON.stringify({
      browserAutomation: {
        configured: browserAutomation.configured ?? browserAutomation.enabled,
        ...browserAutomation,
      },
      localUrl: 'http://127.0.0.1:5173/',
      networkUrls: [],
      pid: process.pid,
      port: 5173,
      registeredAt: new Date().toISOString(),
      schemaVersion: 2,
      sessionId: 'browser-run-test',
      updatedAt: new Date().toISOString(),
      workspaceRoot,
    }),
  );
  return workspaceRoot;
}

describe('browser run command', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((entry) =>
        rm(entry, {
          force: true,
          recursive: true,
        }),
      ),
    );
  });

  test('is unavailable without explicit dev-server opt-in', async () => {
    const workspaceRoot = await createWorkspace({
      enabled: false,
      protocol: 'cdp',
    });
    await expect(
      handleBrowserRun(
        'run.mjs',
        {},
        { cwd: workspaceRoot, stderr: process.stderr, stdout: process.stdout },
      ),
    ).rejects.toThrow('Managed browser automation is disabled');
  });

  test('distinguishes an opted-in session whose browser is not running', async () => {
    const workspaceRoot = await createWorkspace({
      configured: true,
      enabled: false,
      protocol: 'cdp',
    });
    await expect(
      handleBrowserRun(
        'run.mjs',
        {},
        { cwd: workspaceRoot, stderr: process.stderr, stdout: process.stdout },
      ),
    ).rejects.toThrow('configured, but the managed browser is not running');
  });

  test('accepts relative and absolute script paths through a workspace directory alias', async () => {
    const workspaceRoot = await createWorkspace({
      enabled: false,
      protocol: 'cdp',
    });
    const aliasRoot = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-run-alias-'));
    temporaryPaths.push(aliasRoot);
    const alias = path.join(aliasRoot, 'workspace');
    await symlink(workspaceRoot, alias, 'junction');
    for (const script of ['run.mjs', path.join(alias, 'run.mjs')]) {
      await expect(
        handleBrowserRun(
          script,
          {},
          {
            cwd: alias,
            stderr: process.stderr,
            stdout: process.stdout,
          },
        ),
      ).rejects.toThrow('Managed browser automation is disabled');
    }
  });

  test('rejects an outside script symlink reached through a workspace directory alias', async () => {
    const workspaceRoot = await createWorkspace({
      enabled: false,
      protocol: 'cdp',
    });
    const aliasRoot = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-run-alias-'));
    temporaryPaths.push(aliasRoot);
    const alias = path.join(aliasRoot, 'workspace');
    await symlink(workspaceRoot, alias, 'junction');

    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), 'iwsdk-browser-run-outside-'),
    );
    temporaryPaths.push(outsideRoot);
    const outsideScript = path.join(outsideRoot, 'outside.mjs');
    await writeFile(outsideScript, 'export default () => null;');
    await symlink(outsideScript, path.join(workspaceRoot, 'linked.mjs'));

    await expect(
      handleBrowserRun(
        path.join(alias, 'linked.mjs'),
        {},
        {
          cwd: alias,
          stderr: process.stderr,
          stdout: process.stdout,
        },
      ),
    ).rejects.toThrow('symlinks must stay inside the IWSDK workspace');
  });

  test('rejects scripts and symlinks outside the workspace', async () => {
    const workspaceRoot = await createWorkspace({
      enabled: true,
      endpoint: 'http://127.0.0.1:9222',
      protocol: 'cdp',
    });
    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), 'iwsdk-browser-run-outside-'),
    );
    temporaryPaths.push(outsideRoot);
    const outsideScript = path.join(outsideRoot, 'outside.mjs');
    await writeFile(outsideScript, 'export default () => null;');

    await expect(
      handleBrowserRun(
        outsideScript,
        {},
        { cwd: workspaceRoot, stderr: process.stderr, stdout: process.stdout },
      ),
    ).rejects.toThrow('must stay inside the IWSDK workspace');

    await symlink(outsideScript, path.join(workspaceRoot, 'linked.mjs'));
    await expect(
      handleBrowserRun(
        'linked.mjs',
        {},
        { cwd: workspaceRoot, stderr: process.stderr, stdout: process.stdout },
      ),
    ).rejects.toThrow('symlinks must stay inside the IWSDK workspace');
  });

  test('rejects non-loopback automation endpoints', async () => {
    const workspaceRoot = await createWorkspace({
      enabled: true,
      endpoint: 'https://attacker.example/devtools/browser/owner',
      protocol: 'cdp',
      targetId: 'target-1',
    });
    await expect(
      handleBrowserRun(
        'run.mjs',
        {},
        { cwd: workspaceRoot, stderr: process.stderr, stdout: process.stdout },
      ),
    ).rejects.toThrow('must use loopback HTTP');
  });

  test('rejects unsupported automation protocols', async () => {
    const workspaceRoot = await createWorkspace({
      enabled: true,
      endpoint: 'http://127.0.0.1:9222',
      protocol: 'webdriver',
      targetId: 'target-1',
    });
    await expect(
      handleBrowserRun(
        'run.mjs',
        {},
        { cwd: workspaceRoot, stderr: process.stderr, stdout: process.stdout },
      ),
    ).rejects.toThrow('automation protocol is unsupported');
  });

  test('blocks destructive methods on every exposed CDP session', async () => {
    const createCdp = () => ({
      send: vi.fn(async (method: string) => ({ method })),
    });
    const primaryCdp = createCdp();
    const contextCdp = createCdp();
    const browserCdp = createCdp();
    const context = {
      close: vi.fn(),
      newCDPSession: vi.fn(async () => contextCdp),
    };
    const browser = {
      close: vi.fn(),
      newBrowserCDPSession: vi.fn(async () => browserCdp),
    };
    const page = { close: vi.fn() };

    protectManagedOwnership(browser, context, page, primaryCdp);

    expect(() => browser.close()).toThrow('direct close operations');
    expect(() => context.close()).toThrow('direct close operations');
    expect(() => page.close()).toThrow('direct close operations');
    await expect(primaryCdp.send('Browser.close')).rejects.toThrow(
      'Direct CDP method Browser.close is blocked',
    );
    await expect(
      (await context.newCDPSession(page)).send('Target.closeTarget'),
    ).rejects.toThrow('Direct CDP method Target.closeTarget is blocked');
    await expect(
      (await browser.newBrowserCDPSession()).send('Page.close'),
    ).rejects.toThrow('Direct CDP method Page.close is blocked');
    await expect(primaryCdp.send('Runtime.evaluate')).resolves.toEqual({
      method: 'Runtime.evaluate',
    });
  });

  test('rejects zero verified managed pages', async () => {
    const page = {
      evaluate: async () => false,
      opener: async () => null,
      url: () => 'http://127.0.0.1:5173/',
    };
    const context = {
      newCDPSession: async () => ({
        detach: async () => {},
        send: async () => ({ targetInfo: { targetId: 'target-1' } }),
      }),
      pages: () => [page],
    };

    await expect(
      selectManagedBrowserPage(
        { contexts: () => [context] },
        'http://127.0.0.1:5173',
        'target-1',
      ),
    ).rejects.toThrow('found 0');
  });

  test('rejects multiple pages claiming the managed target', async () => {
    const createPage = () => ({
      evaluate: async () => true,
      opener: async () => null,
      url: () => 'http://127.0.0.1:5173/',
    });
    const pages = [createPage(), createPage()];
    const context = {
      newCDPSession: async () => ({
        detach: async () => {},
        send: async () => ({ targetInfo: { targetId: 'target-1' } }),
      }),
      pages: () => pages,
    };

    await expect(
      selectManagedBrowserPage(
        { contexts: () => [context] },
        'http://127.0.0.1:5173',
        'target-1',
      ),
    ).rejects.toThrow('found 2');
  });
});

describe('browser run render hold', () => {
  function holdFrame(runtime?: object) {
    const pageWindow: Record<string, unknown> = runtime
      ? { FRAMEWORK_MCP_RUNTIME: runtime }
      : {};
    return {
      evaluate: vi.fn(async (fn: (arg: unknown) => unknown, arg: unknown) => {
        const previous = (globalThis as any).FRAMEWORK_MCP_RUNTIME;
        (globalThis as any).FRAMEWORK_MCP_RUNTIME =
          pageWindow.FRAMEWORK_MCP_RUNTIME;
        try {
          return await fn(arg);
        } finally {
          (globalThis as any).FRAMEWORK_MCP_RUNTIME = previous;
        }
      }),
    };
  }

  function fakeRuntime() {
    const holds = new Set<string>();
    return {
      holds,
      acquireRenderHold: vi.fn(() => {
        holds.add('hold-1');
        return 'hold-1';
      }),
      releaseRenderHold: vi.fn((id: string) => holds.delete(id)),
    };
  }

  test('holds rendering while the script runs and releases it afterwards', async () => {
    const runtime = fakeRuntime();
    const result = await withRenderHold(holdFrame(runtime), async () => {
      expect(runtime.holds.size).toBe(1);
      return 'done';
    });
    expect(result).toBe('done');
    expect(runtime.holds.size).toBe(0);
  });

  test('releases the hold when the script throws', async () => {
    const runtime = fakeRuntime();
    await expect(
      withRenderHold(holdFrame(runtime), async () => {
        throw new Error('script failed');
      }),
    ).rejects.toThrow('script failed');
    expect(runtime.releaseRenderHold).toHaveBeenCalledWith('hold-1');
    expect(runtime.holds.size).toBe(0);
  });

  test('runs scripts unchanged on apps without render holds', async () => {
    await expect(withRenderHold(holdFrame(), async () => 'done')).resolves.toBe(
      'done',
    );
  });
});
