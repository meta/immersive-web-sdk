/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigateAndVerifyManagedPage: vi.fn(),
  openManagedChromium: vi.fn(),
}));

vi.mock('../src/managed-browser/launch.js', async () => ({
  ...(await vi.importActual('../src/managed-browser/launch.js')),
  navigateAndVerifyManagedPage: mocks.navigateAndVerifyManagedPage,
  openManagedChromium: mocks.openManagedChromium,
}));

vi.mock('../src/managed-browser/tab-audio.js', () => ({
  ManagedTabAudio: { install: vi.fn(async () => ({})) },
}));

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.IWSDK_DEV_RENDER_MODE;
});

/** Launch until navigation, then stop: only the navigation arguments matter. */
async function navigationRenderMode(headless: boolean) {
  const page = { on: vi.fn(), off: vi.fn(), isClosed: () => false };
  const dispose = vi.fn(async () => {});
  mocks.openManagedChromium.mockResolvedValueOnce({
    browser: {},
    browserAutomationEndpoint: null,
    context: {},
    dispose,
    page,
  });
  mocks.navigateAndVerifyManagedPage.mockRejectedValueOnce(new Error('stop'));
  const { launchManagedBrowser } = await import(
    '../src/managed-browser/session.js'
  );
  await expect(
    launchManagedBrowser('http://localhost:5173/', headless, false),
  ).rejects.toThrow('stop');
  expect(dispose).toHaveBeenCalled();
  return mocks.navigateAndVerifyManagedPage.mock.calls.at(-1)?.[0]?.renderMode;
}

describe('launchManagedBrowser render mode', () => {
  test('headless sessions start the app on demand', async () => {
    expect(await navigationRenderMode(true)).toBe('on-demand');
  });

  test('headed sessions start the app continuous', async () => {
    expect(await navigationRenderMode(false)).toBe('continuous');
  });

  test('IWSDK_DEV_RENDER_MODE=continuous opts headless sessions out', async () => {
    process.env.IWSDK_DEV_RENDER_MODE = 'continuous';
    expect(await navigationRenderMode(true)).toBe('continuous');
  });
});
