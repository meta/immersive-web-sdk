/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { navigateAndVerifyManagedPage } from '../src/managed-browser/launch.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Run every init script the page registered against a fresh fake window. */
async function runInitScripts(page: {
  addInitScript: ReturnType<typeof vi.fn>;
}) {
  const pageWindow: Record<string, unknown> = {
    addEventListener: () => {},
    location: { href: 'http://localhost:5173/' },
  };
  const previous = (globalThis as any).window;
  (globalThis as any).window = pageWindow;
  try {
    for (const [fn, arg] of page.addInitScript.mock.calls) {
      await fn(arg);
    }
  } finally {
    (globalThis as any).window = previous;
  }
  return pageWindow;
}

function fakePage() {
  return {
    addInitScript: vi.fn(async () => {}),
    goto: vi.fn(async () => null),
    isClosed: () => false,
  };
}

describe('managed page render mode', () => {
  for (const renderMode of ['on-demand', 'continuous'] as const) {
    test(`the init script tells the app to start ${renderMode}`, async () => {
      const page = fakePage();
      await navigateAndVerifyManagedPage({
        browserAutomationEndpoint: null,
        context: {} as never,
        managedWorkspaceToken: null,
        page: page as never,
        readiness: 'iwer',
        renderMode,
        traceMcp: false,
        url: 'http://localhost:5173/',
        waitForRuntime: false,
      });
      const pageWindow = await runInitScripts(page);
      expect(pageWindow.__IWSDK_RENDER_MODE).toBe(renderMode);
      expect(pageWindow.__IWER_MCP_MANAGED).toBe(true);
    });
  }

  test('pages opened without a mode start continuous', async () => {
    const page = fakePage();
    await navigateAndVerifyManagedPage({
      browserAutomationEndpoint: null,
      context: {} as never,
      managedWorkspaceToken: null,
      page: page as never,
      readiness: 'iwer',
      traceMcp: false,
      url: 'http://localhost:5173/',
      waitForRuntime: false,
    });
    expect((await runInitScripts(page)).__IWSDK_RENDER_MODE).toBe('continuous');
  });
});
