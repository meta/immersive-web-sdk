/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iwsdkDev } from '../src/index.js';
import { buildInjectionBundle } from '../src/injection-bundler.js';

vi.mock('@iwsdk/cli/runtime-owner', () => ({
  acquireRuntimeOwner: vi.fn(async () => ({
    identity: { sessionId: 'test' },
    release: vi.fn(async () => {}),
  })),
}));
// The real bundle is large and irrelevant here: only whether it is requested
// matters. The module's other exports (the runtime's module ids) stay real:
// the plugin's resolveId calls them for every id.
vi.mock('../src/injection-bundler.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/injection-bundler.js')>()),
  buildInjectionBundle: vi.fn(async () => ({
    code: '/* emulator */',
    size: 16,
  })),
}));

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-native-target-'));
  await mkdir(path.join(projectRoot, 'public', 'scenes'), { recursive: true });
  await writeFile(
    path.join(projectRoot, 'public', 'scenes', 'main.iwsdk.scene.json'),
    '{}',
  );
  await writeFile(
    path.join(projectRoot, 'iwsdk.config.json'),
    `${JSON.stringify(
      {
        version: 'iwsdk.project.v1',
        scene: './public/scenes/main.iwsdk.scene.json',
        world: { xr: { mode: 'vr', offer: 'always' } },
        dev: { emulator: { injectOnBuild: true } },
        native: {
          packageId: 'com.example.nativetarget',
          signing: { keystore: '../keys/release.jks' },
        },
      },
      null,
      2,
    )}\n`,
  );
  vi.mocked(buildInjectionBundle).mockClear();
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function buildPlugin(mode: string) {
  const plugin = iwsdkDev({ https: false });
  await callHook(
    plugin.config,
    plugin,
    { root: projectRoot },
    { command: 'build', mode },
  );
  callHook(plugin.configResolved, plugin, {
    command: 'build',
    mode,
    root: projectRoot,
    publicDir: path.join(projectRoot, 'public'),
    server: {},
  });
  await callHook(plugin.buildStart, {
    addWatchFile: vi.fn(),
    warn: vi.fn(),
  });
  return plugin;
}

describe('native (metavr) builds', () => {
  it('injects the emulator into a normal production build with injectOnBuild', async () => {
    const plugin = await buildPlugin('production');
    expect(buildInjectionBundle).toHaveBeenCalledTimes(1);
    const html = callHook(plugin.transformIndexHtml, plugin, '<html></html>');
    expect(html).toEqual({
      tags: [expect.objectContaining({ tag: 'script' })],
    });
  });

  it('never injects the emulator into `vite build --mode metavr`', async () => {
    const plugin = await buildPlugin('metavr');
    expect(buildInjectionBundle).not.toHaveBeenCalled();
    expect(callHook(plugin.transformIndexHtml, plugin, '<html></html>')).toBe(
      '<html></html>',
    );
  });

  it('honours IWSDK_BUILD_TARGET=metavr for wrappers that cannot pass a mode', async () => {
    vi.stubEnv('IWSDK_BUILD_TARGET', 'metavr');
    const plugin = await buildPlugin('production');
    expect(buildInjectionBundle).not.toHaveBeenCalled();
    expect(callHook(plugin.transformIndexHtml, plugin, '<html></html>')).toBe(
      '<html></html>',
    );
  });

  it('keeps the native section out of the bundled project module', async () => {
    const plugin = await buildPlugin('metavr');
    const id = callHook(plugin.resolveId, plugin, 'virtual:iwsdk-project');
    const source = await callHook(plugin.load, { resolve: vi.fn() }, id);
    expect(source).toContain('"scene":"./public/scenes/main.iwsdk.scene.json"');
    expect(source).not.toContain('com.example.nativetarget');
    expect(source).not.toContain('release.jks');
  });
});

function callHook(hook: unknown, context: unknown, ...args: unknown[]): any {
  if (typeof hook === 'function') {
    return hook.apply(context, args);
  }
  if (
    hook != null &&
    typeof hook === 'object' &&
    'handler' in hook &&
    typeof (hook as { handler?: unknown }).handler === 'function'
  ) {
    return (
      hook as { handler: (...values: unknown[]) => unknown }
    ).handler.apply(context, args);
  }
  throw new Error('Expected a Vite plugin hook');
}
