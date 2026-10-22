/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isFileServingAllowed, resolveConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iwsdkDev } from '../src/index.js';

vi.mock('@iwsdk/cli/runtime-owner', () => ({
  acquireRuntimeOwner: vi.fn(async () => ({
    identity: { sessionId: 'test' },
    release: vi.fn(async () => {}),
  })),
}));

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-project-plugin-'));
  await mkdir(path.join(projectRoot, 'public', 'scenes'), { recursive: true });
  await mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await writeFile(
    path.join(projectRoot, 'public', 'scenes', 'main.iwsdk.scene.json'),
    '{}',
  );
  await writeFile(
    path.join(projectRoot, 'src', 'assets.ts'),
    'export default {};\n',
  );
  await writeFile(
    path.join(projectRoot, 'src', 'components.ts'),
    'export default [];\n',
  );
  await writeFile(
    path.join(projectRoot, 'iwsdk.config.json'),
    `${JSON.stringify(
      {
        version: 'iwsdk.project.v1',
        scene: './public/scenes/main.iwsdk.scene.json',
        assets: { module: './src/assets' },
        components: { module: './src/components' },
        world: {
          xr: false,
          render: { near: 0.001, far: 200 },
        },
        dev: {
          emulator: {},
        },
      },
      null,
      2,
    )}\n`,
  );
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('manifest-first Vite integration', () => {
  it('validates the configurable managed-browser bridge timeout', () => {
    expect(() => iwsdkDev({ bridgeReadyTimeoutMs: 0 })).toThrow(
      'iwsdkDev().bridgeReadyTimeoutMs must be a positive integer',
    );
    expect(() => iwsdkDev({ bridgeReadyTimeoutMs: 15000 })).not.toThrow();
  });
  it('allows only the configured local example-asset directory outside the workspace', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-assets-'));
    const unrelatedRoot = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-other-'));
    try {
      await writeFile(
        path.join(projectRoot, 'pnpm-workspace.yaml'),
        'packages:\n  - .\n',
      );
      const assetFile = path.join(assetRoot, 'environment.gltf');
      const unrelatedFile = path.join(unrelatedRoot, 'secret.txt');
      await writeFile(assetFile, '{}');
      await writeFile(unrelatedFile, 'secret');
      vi.stubEnv('VITE_IWSDK_EXAMPLE_ASSET_BASE_URL', `/@fs${assetRoot}`);

      const resolvedConfig = await resolveConfig(
        {
          root: projectRoot,
          logLevel: 'silent',
          plugins: [iwsdkDev({ https: false })],
        },
        'serve',
        'development',
      );

      const canonicalProjectRoot = await realpath(projectRoot);
      const canonicalAssetRoot = await realpath(assetRoot);
      expect(resolvedConfig.server.fs.allow).toContain(canonicalProjectRoot);
      expect(resolvedConfig.server.fs.allow).toContain(canonicalAssetRoot);
      expect(resolvedConfig.server.fs.allow).not.toContain(
        path.dirname(assetRoot),
      );
      expect(isFileServingAllowed(resolvedConfig, `/@fs${assetFile}`)).toBe(
        true,
      );
      expect(isFileServingAllowed(resolvedConfig, `/@fs${unrelatedFile}`)).toBe(
        false,
      );
      expect(info).toHaveBeenCalledWith(
        `[IWSDK Dev] Allowing local example assets from ${canonicalAssetRoot}`,
      );
    } finally {
      info.mockRestore();
      await Promise.all([
        rm(assetRoot, { recursive: true, force: true }),
        rm(unrelatedRoot, { recursive: true, force: true }),
      ]);
    }
  });

  it('loads the local asset override from a custom Vite envDir', async () => {
    const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-assets-'));
    const envDir = path.join(projectRoot, 'config');
    const previousAssetBaseUrl = process.env.VITE_IWSDK_EXAMPLE_ASSET_BASE_URL;
    try {
      await mkdir(envDir, { recursive: true });
      await writeFile(
        path.join(envDir, '.env.development'),
        `VITE_IWSDK_EXAMPLE_ASSET_BASE_URL=/@fs${assetRoot}\n`,
      );
      delete process.env.VITE_IWSDK_EXAMPLE_ASSET_BASE_URL;

      const resolvedConfig = await resolveConfig(
        {
          envDir,
          root: projectRoot,
          logLevel: 'silent',
          plugins: [iwsdkDev({ https: false })],
        },
        'serve',
        'development',
      );

      expect(resolvedConfig.server.fs.allow).toContain(
        await realpath(assetRoot),
      );
    } finally {
      if (previousAssetBaseUrl == null) {
        delete process.env.VITE_IWSDK_EXAMPLE_ASSET_BASE_URL;
      } else {
        process.env.VITE_IWSDK_EXAMPLE_ASSET_BASE_URL = previousAssetBaseUrl;
      }
      await rm(assetRoot, { recursive: true, force: true });
    }
  });

  it('uses the process override when Vite env-file loading is disabled', async () => {
    const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-assets-'));
    try {
      vi.stubEnv('VITE_IWSDK_EXAMPLE_ASSET_BASE_URL', `/@fs${assetRoot}`);
      const resolvedConfig = await resolveConfig(
        {
          envDir: false,
          root: projectRoot,
          logLevel: 'silent',
          plugins: [iwsdkDev({ https: false })],
        },
        'serve',
        'development',
      );

      expect(resolvedConfig.server.fs.allow).toContain(
        await realpath(assetRoot),
      );
    } finally {
      await rm(assetRoot, { recursive: true, force: true });
    }
  });

  it('refuses broad local asset directories', async () => {
    const broadAlias = path.join(projectRoot, 'broad-assets');
    await symlink(path.dirname(os.homedir()), broadAlias, 'dir');
    for (const broadDirectory of [
      os.homedir(),
      path.dirname(os.homedir()),
      broadAlias,
    ]) {
      vi.stubEnv('VITE_IWSDK_EXAMPLE_ASSET_BASE_URL', `/@fs${broadDirectory}`);
      const resolvedConfig = await resolveConfig(
        {
          root: projectRoot,
          logLevel: 'silent',
          plugins: [iwsdkDev({ https: false })],
        },
        'serve',
        'development',
      );
      expect(resolvedConfig.server.fs.allow).not.toContain(
        await realpath(broadDirectory),
      );
    }
  });

  it('fails a production build before bundling invalid public UIKitML', async () => {
    const publicDirectory = path.join(projectRoot, 'public');
    await mkdir(path.join(publicDirectory, 'ui'), { recursive: true });
    const panelPath = path.join(publicDirectory, 'ui', 'panel.uikitml');
    await writeFile(
      panelPath,
      '<div style="padding: 12px 24px">Invalid shorthand</div>',
    );
    const plugin = iwsdkDev({ https: false });
    await callHook(
      plugin.config,
      plugin,
      { root: projectRoot },
      { command: 'build', mode: 'production' },
    );
    callHook(plugin.configResolved, plugin, {
      command: 'build',
      root: projectRoot,
      publicDir: publicDirectory,
      server: {},
    });

    await expect(
      callHook(plugin.buildStart, { addWatchFile: vi.fn(), warn: vi.fn() }),
    ).rejects.toThrow(/panel\.uikitml.*Invalid value for property "padding"/s);
  });

  it('gates production Havok and bundled-font modules from project features', async () => {
    const plugin = iwsdkDev({ https: false });
    const userConfig: {
      root: string;
      resolve?: { alias?: Record<string, string> };
    } = { root: projectRoot };
    await callHook(plugin.config, plugin, userConfig, {
      command: 'build',
      mode: 'production',
    });

    expect(userConfig.resolve?.alias).toMatchObject({
      '@babylonjs/havok': 'virtual:iwsdk-disabled-havok',
      '@pmndrs/msdfonts/roboto': 'virtual:iwsdk-disabled-bundled-fonts',
    });

    expect(callHook(plugin.resolveId, plugin, '@babylonjs/havok')).toBe(
      '\0virtual:iwsdk-disabled-havok',
    );
    expect(callHook(plugin.resolveId, plugin, '@pmndrs/msdfonts/roboto')).toBe(
      '\0virtual:iwsdk-disabled-bundled-fonts',
    );
    expect(
      await callHook(
        plugin.load,
        { resolve: vi.fn() },
        '\0virtual:iwsdk-disabled-havok',
      ),
    ).toContain('world.features.physics is false');

    const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.world.features = { physics: true };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await mkdir(path.join(projectRoot, 'public', 'ui'), { recursive: true });
    await writeFile(
      path.join(projectRoot, 'public', 'ui', 'copy.uikitml'),
      '<div style="font-family: roboto">Copy</div>',
    );
    const enabledPlugin = iwsdkDev({
      https: false,
      bundle: { fonts: ['inter'] },
    });
    await callHook(
      enabledPlugin.config,
      enabledPlugin,
      { root: projectRoot },
      { command: 'build', mode: 'production' },
    );

    expect(
      callHook(enabledPlugin.resolveId, enabledPlugin, '@babylonjs/havok'),
    ).toBeUndefined();
    expect(
      callHook(
        enabledPlugin.resolveId,
        enabledPlugin,
        '@pmndrs/msdfonts/roboto',
      ),
    ).toBeUndefined();
    expect(
      callHook(
        enabledPlugin.resolveId,
        enabledPlugin,
        '@pmndrs/msdfonts/inter',
      ),
    ).toBeUndefined();
    expect(
      callHook(enabledPlugin.resolveId, enabledPlugin, '@pmndrs/msdfonts/lato'),
    ).toBe('\0virtual:iwsdk-disabled-bundled-fonts');
  });

  it.each([{ useWorker: false }, { useWorker: true }])(
    'retains Havok for physics options with useWorker: $useWorker',
    async (physics) => {
      const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.world.features = { physics };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const plugin = iwsdkDev({ https: false });
      const userConfig: {
        root: string;
        resolve?: { alias?: Record<string, string> };
      } = { root: projectRoot };
      await callHook(plugin.config, plugin, userConfig, {
        command: 'build',
        mode: 'production',
      });

      expect(userConfig.resolve?.alias).not.toHaveProperty('@babylonjs/havok');
      expect(
        callHook(plugin.resolveId, plugin, '@babylonjs/havok'),
      ).toBeUndefined();
    },
  );

  it('rejects retired metadata options even when no project manifest exists', async () => {
    await rm(path.join(projectRoot, 'iwsdk.config.json'));
    const plugin = iwsdkDev({
      assetManifest: './src/assets',
    } as any);

    await expect(
      callHook(
        plugin.config,
        plugin,
        { root: projectRoot },
        { command: 'serve', mode: 'development' },
      ),
    ).rejects.toThrow(
      'iwsdkDev().assetManifest was removed in IWSDK 0.5. Declare the module path in iwsdk.config.json instead.',
    );
  });

  it('discovers project modules and emits ordinary WorldOptions', async () => {
    const plugin = iwsdkDev({ https: false });
    const userConfig: { root: string; server?: { open?: boolean } } = {
      root: projectRoot,
    };
    await callHook(plugin.config, plugin, userConfig, {
      command: 'serve',
      mode: 'development',
    });
    expect(userConfig.server?.open).toBe(false);
    callHook(plugin.configResolved, plugin, {
      command: 'serve',
      root: projectRoot,
      server: {},
    });

    const projectId = callHook(
      plugin.resolveId,
      plugin,
      'virtual:iwsdk-project',
    );
    expect(projectId).toBe('\0virtual:iwsdk-project');
    const source = await callHook(plugin.load, { resolve: vi.fn() }, projectId);
    expect(source).toContain('normalizeProjectWorldOptions(manifest)');
    expect(source).toContain('import.meta.env.BASE_URL');
    expect(source).toContain('level, assets, components');
    expect(source).toContain('"scene":"./public/scenes/main.iwsdk.scene.json"');

    const assetId = callHook(
      plugin.resolveId,
      plugin,
      '/@iwsdk-asset-manifest',
    );
    const assetSource = await callHook(
      plugin.load,
      { resolve: vi.fn() },
      assetId,
    );
    expect(assetSource).toContain(
      `/@fs/${await realpath(path.join(projectRoot, 'src', 'assets.ts'))}`,
    );
  });

  it('does not pass placeholder manifests for omitted optional modules', async () => {
    const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    delete manifest.assets;
    delete manifest.components;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const plugin = iwsdkDev({ https: false });

    await callHook(
      plugin.config,
      plugin,
      { root: projectRoot },
      { command: 'serve', mode: 'development' },
    );
    callHook(plugin.configResolved, plugin, {
      command: 'serve',
      root: projectRoot,
      server: {},
    });
    const projectId = callHook(
      plugin.resolveId,
      plugin,
      'virtual:iwsdk-project',
    );
    const source = await callHook(plugin.load, { resolve: vi.fn() }, projectId);

    expect(source).toContain(
      'const projectOptions = { ...normalized, xr, level };',
    );
    expect(source).not.toContain('level, assets');
    expect(source).not.toContain('level, components');
  });

  it('rejects duplicate project authority in plugin options', async () => {
    const plugin = iwsdkDev({
      https: false,
      workspace: { enabled: true },
    });

    await expect(
      callHook(
        plugin.config,
        plugin,
        { root: projectRoot },
        {
          command: 'serve',
          mode: 'development',
        },
      ),
    ).rejects.toThrow(
      'iwsdk.config.json is the project authority: remove iwsdkDev().workspace and select AI/browser launch behavior through the dev command',
    );
  });

  it('accepts explicit dev-session environment overrides', async () => {
    vi.stubEnv('IWSDK_DEV_AI_MODE', 'collaborate');
    vi.stubEnv('IWSDK_DEV_NATIVE_XR_CONTROL', 'true');
    vi.stubEnv('IWSDK_DEV_HEADLESS', 'false');
    vi.stubEnv('IWSDK_DEV_OPEN', 'false');
    vi.stubEnv('IWSDK_DEV_SCREENSHOT_WIDTH', '1024');
    vi.stubEnv('IWSDK_DEV_SCREENSHOT_HEIGHT', '768');
    const plugin = iwsdkDev({ https: false });
    const userConfig = {
      root: projectRoot,
      server: { open: true, strictPort: false },
    };

    await expect(
      callHook(plugin.config, plugin, userConfig, {
        command: 'serve',
        mode: 'development',
      }),
    ).resolves.toBeUndefined();
    expect(userConfig.server.open).toBe(false);
    expect(userConfig.server.strictPort).toBe(false);

    callHook(plugin.configResolved, plugin, {
      command: 'serve',
      root: projectRoot,
      server: {},
    });
    const projectId = callHook(
      plugin.resolveId,
      plugin,
      'virtual:iwsdk-project',
    );
    const source = await callHook(plugin.load, { resolve: vi.fn() }, projectId);
    expect(source).toContain("offer: 'none'");
    expect(source).toContain('launchOnSessionGranted: true');

    await callHook(plugin.buildStart, { addWatchFile: vi.fn() });
    const runtimeId = callHook(
      plugin.resolveId,
      plugin,
      '/@iwer-injection-runtime',
    );
    const runtimeSource = await callHook(
      plugin.load,
      { resolve: vi.fn() },
      runtimeId,
    );
    expect(runtimeSource).toContain('"nativeXRControl": true');
    expect(runtimeSource).toContain(
      'import { startIwsdkDevRuntime } from "virtual:iwsdk-dev-runtime/runtime.js"',
    );
    expect(await readInjectedRuntime()).toContain(
      'Native XR control requires Meta Quest Browser',
    );
  });

  it('keeps a configured port instead of moving the runtime', async () => {
    const configure = async (
      server: Record<string, unknown>,
      isPreview = false,
    ) => {
      const userConfig = { root: projectRoot, server };
      const plugin = iwsdkDev({ https: false });
      await callHook(plugin.config, plugin, userConfig, {
        command: 'serve',
        mode: 'development',
        isPreview,
      });
      return userConfig.server.strictPort;
    };
    // adb reverse forwards the configured port, so occupied fails closed.
    expect(await configure({ port: 8081 })).toBe(true);
    expect(await configure({ port: 8081, strictPort: false })).toBe(false);
    expect(await configure({})).toBeUndefined();
    expect(await configure({ port: 8081 }, true)).toBeUndefined();
  });

  it('rejects native XR control when IWER is disabled', async () => {
    const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dev.emulator.iwer = false;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    vi.stubEnv('IWSDK_DEV_NATIVE_XR_CONTROL', 'true');
    const plugin = iwsdkDev({ https: false });

    await expect(
      callHook(
        plugin.config,
        plugin,
        { root: projectRoot },
        { command: 'serve', mode: 'development' },
      ),
    ).rejects.toThrow(
      '--native-xr-control requires dev.emulator.iwer to be enabled',
    );
  });

  it('injects target-device preview only into the development server', async () => {
    const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dev.targetDevicePreview = { gazeSimulation: 'head' };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const servePlugin = iwsdkDev({ https: false });
    await callHook(
      servePlugin.config,
      servePlugin,
      { root: projectRoot },
      { command: 'serve', mode: 'development' },
    );
    callHook(servePlugin.configResolved, servePlugin, {
      command: 'serve',
      root: projectRoot,
      server: {},
    });
    await callHook(servePlugin.buildStart, { addWatchFile: vi.fn() });
    const runtimeId = callHook(
      servePlugin.resolveId,
      servePlugin,
      '/@iwer-injection-runtime',
    );
    const serveRuntime = await callHook(
      servePlugin.load,
      { resolve: vi.fn() },
      runtimeId,
    );
    expect(serveRuntime).toContain('"gazeSimulation": "head"');
    const runtimeCode = await readInjectedRuntime();
    expect(runtimeCode).toContain('gazeSimulation:!1');
    expect(runtimeCode).toContain('"gaze-only"');

    manifest.dev.emulator.injectOnBuild = true;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const buildPlugin = iwsdkDev({ https: false });
    await callHook(
      buildPlugin.config,
      buildPlugin,
      { root: projectRoot },
      { command: 'build', mode: 'production' },
    );
    callHook(buildPlugin.configResolved, buildPlugin, {
      command: 'build',
      root: projectRoot,
      server: {},
    });
    await callHook(buildPlugin.buildStart, { addWatchFile: vi.fn() });
    const buildRuntimeId = callHook(
      buildPlugin.resolveId,
      buildPlugin,
      '/@iwer-injection-runtime',
    );
    const buildRuntime = await callHook(
      buildPlugin.load,
      { resolve: vi.fn() },
      buildRuntimeId,
    );
    expect(buildRuntime).not.toContain('"targetDevicePreview": {');
  });

  it('rejects target-device preview when IWER is disabled', async () => {
    const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dev.emulator.iwer = false;
    manifest.dev.targetDevicePreview = { gazeSimulation: 'head' };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const plugin = iwsdkDev({ https: false });

    await expect(
      callHook(
        plugin.config,
        plugin,
        { root: projectRoot },
        { command: 'serve', mode: 'development' },
      ),
    ).rejects.toThrow(
      'dev.targetDevicePreview requires dev.emulator.iwer to be enabled',
    );
  });

  it('keeps IWER enabled when a Desktop manifest uses the target-independent default', async () => {
    const plugin = iwsdkDev({ https: false });
    await callHook(
      plugin.config,
      plugin,
      { root: projectRoot },
      {
        command: 'serve',
        mode: 'development',
      },
    );
    callHook(plugin.configResolved, plugin, {
      command: 'serve',
      root: projectRoot,
      server: {},
    });
    await callHook(plugin.buildStart, { addWatchFile: vi.fn() });

    const runtimeId = callHook(
      plugin.resolveId,
      plugin,
      '/@iwer-injection-runtime',
    );
    const runtimeSource = await callHook(
      plugin.load,
      { resolve: vi.fn() },
      runtimeId,
    );

    expect(runtimeSource).toContain('"iwer": true');
    expect(runtimeSource).toContain('"workspace": {');
  });

  it('restarts Vite when the project authority changes', async () => {
    vi.useFakeTimers();
    const plugin = iwsdkDev({ https: false });
    await callHook(
      plugin.config,
      plugin,
      { root: projectRoot },
      {
        command: 'serve',
        mode: 'development',
      },
    );
    const restart = vi.fn(async () => {});

    await expect(
      callHook(plugin.handleHotUpdate, plugin, {
        file: path.join(projectRoot, 'iwsdk.config.json'),
        modules: [],
        server: { restart },
      }),
    ).resolves.toEqual([]);
    expect(restart).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(restart).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('leaves Vite-accepted project modules to ordinary HMR', async () => {
    const plugin = iwsdkDev({ https: false });
    await callHook(
      plugin.config,
      plugin,
      { root: projectRoot },
      { command: 'serve', mode: 'development' },
    );
    callHook(plugin.configResolved, plugin, {
      command: 'serve',
      root: projectRoot,
      publicDir: path.join(projectRoot, 'public'),
      server: {},
    });

    let registerHotClient:
      | ((data: { role: string }, client: unknown) => void)
      | undefined;
    const editorClient = { send: vi.fn() };
    const runtimeClient = { send: vi.fn() };
    const unknownClient = { send: vi.fn() };
    const clients = new Set([editorClient, runtimeClient, unknownClient]);
    const ws = {
      clients,
      on: vi.fn((event: string, handler: typeof registerHotClient) => {
        if (event === 'iwsdk:hot-client-role') {
          registerHotClient = handler;
        }
      }),
      send: vi.fn(),
    };
    callHook(plugin.configureServer, plugin, {
      watcher: {
        add: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
      middlewares: { use: vi.fn() },
      ws,
    });
    expect(registerHotClient).toBeDefined();
    registerHotClient?.({ role: 'editor' }, editorClient);
    registerHotClient?.({ role: 'runtime' }, runtimeClient);

    const sourcePath = path.join(projectRoot, 'src', 'assets.ts');
    const selfAcceptingModule = {
      file: sourcePath,
      isSelfAccepting: true,
      importers: new Set(),
    };
    await expect(
      callHook(plugin.handleHotUpdate, plugin, {
        file: sourcePath,
        modules: [selfAcceptingModule],
        server: { ws },
      }),
    ).resolves.toBeUndefined();
    expect(editorClient.send).not.toHaveBeenCalled();
    expect(runtimeClient.send).not.toHaveBeenCalled();
    expect(unknownClient.send).not.toHaveBeenCalled();

    selfAcceptingModule.isSelfAccepting = false;
    const acceptingImporter = {
      acceptedHmrDeps: new Set([selfAcceptingModule]),
      importers: new Set(),
    };
    selfAcceptingModule.importers.add(acceptingImporter);
    await expect(
      callHook(plugin.handleHotUpdate, plugin, {
        file: sourcePath,
        modules: [selfAcceptingModule],
        server: { ws },
      }),
    ).resolves.toBeUndefined();
    expect(editorClient.send).not.toHaveBeenCalled();
    expect(runtimeClient.send).not.toHaveBeenCalled();
    expect(unknownClient.send).not.toHaveBeenCalled();

    const nonAcceptingImporter = {
      acceptedHmrDeps: new Set(),
      importers: new Set(),
    };
    selfAcceptingModule.importers.add(nonAcceptingImporter);
    await expect(
      callHook(plugin.handleHotUpdate, plugin, {
        file: sourcePath,
        modules: [selfAcceptingModule],
        server: { ws },
      }),
    ).resolves.toEqual([]);
    expect(editorClient.send).toHaveBeenCalledWith(
      'iwsdk:runtime-source-change',
      { path: 'src/assets.ts' },
    );
    expect(runtimeClient.send).toHaveBeenCalledWith({
      type: 'full-reload',
    });
    expect(unknownClient.send).not.toHaveBeenCalled();

    editorClient.send.mockClear();
    runtimeClient.send.mockClear();
    selfAcceptingModule.importers.clear();
    await expect(
      callHook(plugin.handleHotUpdate, plugin, {
        file: sourcePath,
        modules: [selfAcceptingModule],
        server: { ws },
      }),
    ).resolves.toEqual([]);
    expect(editorClient.send).toHaveBeenCalledWith(
      'iwsdk:runtime-source-change',
      { path: 'src/assets.ts' },
    );
    expect(runtimeClient.send).toHaveBeenCalledWith({
      type: 'full-reload',
    });
    expect(unknownClient.send).not.toHaveBeenCalled();
  });

  it('recognizes project HMR through an aliased workspace root', async () => {
    const aliasDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'iwsdk-project-plugin-alias-'),
    );
    const aliasRoot = path.join(aliasDirectory, 'workspace');
    await symlink(projectRoot, aliasRoot, 'junction');

    try {
      const plugin = iwsdkDev({ https: false });
      await callHook(
        plugin.config,
        plugin,
        { root: aliasRoot },
        { command: 'serve', mode: 'development' },
      );
      callHook(plugin.configResolved, plugin, {
        command: 'serve',
        root: aliasRoot,
        publicDir: path.join(aliasRoot, 'public'),
        server: {},
      });

      let registerHotClient:
        | ((data: { role: string }, client: unknown) => void)
        | undefined;
      const editorClient = { send: vi.fn() };
      const ws = {
        clients: new Set([editorClient]),
        on: vi.fn((event: string, handler: typeof registerHotClient) => {
          if (event === 'iwsdk:hot-client-role') {
            registerHotClient = handler;
          }
        }),
        send: vi.fn(),
      };
      callHook(plugin.configureServer, plugin, {
        watcher: {
          add: vi.fn(),
          on: vi.fn(),
          off: vi.fn(),
        },
        middlewares: { use: vi.fn() },
        ws,
      });
      registerHotClient?.({ role: 'editor' }, editorClient);

      const aliasedSourcePath = path.join(aliasRoot, 'src', 'assets.ts');
      const realSourcePath = await realpath(aliasedSourcePath);
      await expect(
        callHook(plugin.handleHotUpdate, plugin, {
          file: aliasedSourcePath,
          modules: [
            {
              file: realSourcePath,
              isSelfAccepting: false,
              importers: new Set(),
            },
          ],
          server: { ws },
        }),
      ).resolves.toEqual([]);
      expect(editorClient.send).toHaveBeenCalledWith(
        'iwsdk:runtime-source-change',
        { path: 'src/assets.ts' },
      );
    } finally {
      await rm(aliasDirectory, { recursive: true, force: true });
    }
  });

  it('does not inject the development workspace into production builds', async () => {
    const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dev.emulator = { iwer: false, injectOnBuild: true };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const plugin = iwsdkDev({ https: false, verbose: true });
    await callHook(
      plugin.config,
      plugin,
      { root: projectRoot },
      {
        command: 'build',
        mode: 'production',
      },
    );
    callHook(plugin.configResolved, plugin, {
      command: 'build',
      root: projectRoot,
      server: {},
    });
    const addWatchFile = vi.fn();

    await callHook(plugin.buildStart, { addWatchFile });

    expect(addWatchFile).toHaveBeenCalledWith(
      path.join(await realpath(projectRoot), 'iwsdk.config.json'),
    );
    expect(log).toHaveBeenCalledWith(
      '⏭️  IWSDK Dev: Skipping build injection (IWER disabled)',
    );
    expect(log).not.toHaveBeenCalledWith(
      '🚀 IWSDK Dev: Starting injection bundle generation...',
    );
  });

  it('starts the emulator in the configured room and maps legacy capture ids', async () => {
    const loadRuntime = async (environment: string) => {
      const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.dev.emulator = { environment };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const plugin = iwsdkDev({ https: false });
      await callHook(
        plugin.config,
        plugin,
        { root: projectRoot },
        { command: 'serve', mode: 'development' },
      );
      callHook(plugin.configResolved, plugin, {
        command: 'serve',
        root: projectRoot,
        server: {},
      });
      await callHook(plugin.buildStart, { addWatchFile: vi.fn() });
      const runtimeId = callHook(
        plugin.resolveId,
        plugin,
        '/@iwer-injection-runtime',
      );
      return callHook(plugin.load, { resolve: vi.fn() }, runtimeId);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await loadRuntime('kitchen')).toContain(
        '"defaultScene": "kitchen"',
      );
      expect(warn).not.toHaveBeenCalled();

      expect(await loadRuntime('office_large')).toContain(
        '"defaultScene": "open_office"',
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          '"office_large" is a legacy capture room, which IWSDK no longer offers. Loading "open_office" instead',
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('loads the pre-built emulator runtime and its lazy chunks as modules', async () => {
    const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dev.emulator = { iwer: true, injectOnBuild: true };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const plugin = iwsdkDev({ https: false });
    await callHook(
      plugin.config,
      plugin,
      { root: projectRoot },
      { command: 'build', mode: 'production' },
    );
    callHook(plugin.configResolved, plugin, {
      command: 'build',
      root: projectRoot,
      server: {},
    });
    await callHook(plugin.buildStart, { addWatchFile: vi.fn() });
    const runtimeId = callHook(
      plugin.resolveId,
      plugin,
      '/@iwer-injection-runtime',
    );
    const runtimeSource = await callHook(
      plugin.load,
      { resolve: vi.fn() },
      runtimeId,
    );
    expect(runtimeSource).toContain(
      'import { startIwsdkDevRuntime } from "virtual:iwsdk-dev-runtime/runtime.js"',
    );
    // The runtime and its chunks load from dist/injection, so in production
    // builds GLTS and the rooms become lazy chunks of the app.
    const entryId = callHook(
      plugin.resolveId,
      plugin,
      'virtual:iwsdk-dev-runtime/runtime.js',
    );
    expect(entryId).toBe('\0virtual:iwsdk-dev-runtime/runtime.js');
    const entry = await callHook(plugin.load, { resolve: vi.fn() }, entryId);
    const chunk = entry.match(/from\s*"(\.\/chunks\/[^"]+)"/)?.[1];
    expect(chunk).toBeDefined();
    const chunkId = callHook(plugin.resolveId, plugin, chunk, entryId);
    expect(chunkId).toBe(`\0virtual:iwsdk-dev-runtime/${chunk!.slice(2)}`);
    expect(
      await callHook(plugin.load, { resolve: vi.fn() }, chunkId),
    ).toContain('[IWSDK Dev]');
  });

  it('hands the IWSDK target resolver to the emulator for hand sequences', async () => {
    // Tree-shaking drops connectFrameworkTargetResolver unless the runtime
    // calls it, and the minifier keeps property names.
    const runtimeCode = await readInjectedRuntime();
    expect(runtimeCode).toContain(
      'setTargetResolver(window.FRAMEWORK_MCP_RUNTIME?.targetResolver',
    );
    expect(runtimeCode).toContain('"run_sequence"');
  });

  it('keeps production IWER injection independent from the development workspace', async () => {
    const manifestPath = path.join(projectRoot, 'iwsdk.config.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dev.emulator = { iwer: true, injectOnBuild: true };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const plugin = iwsdkDev({ https: false });
    await callHook(
      plugin.config,
      plugin,
      { root: projectRoot },
      {
        command: 'build',
        mode: 'production',
      },
    );
    callHook(plugin.configResolved, plugin, {
      command: 'build',
      root: projectRoot,
      server: {},
    });
    await callHook(plugin.buildStart, { addWatchFile: vi.fn() });

    const runtimeId = callHook(
      plugin.resolveId,
      plugin,
      '/@iwer-injection-runtime',
    );
    const runtimeSource = await callHook(
      plugin.load,
      { resolve: vi.fn() },
      runtimeId,
    );

    expect(runtimeSource).toContain('"iwer": true');
    expect(runtimeSource).not.toContain('"workspace": {');
  });
});

// The pre-built emulator runtime the injected module imports: its entry and
// everything that loads with it (not the lazy GLTS and room chunks).
async function readInjectedRuntime(
  file = path.resolve(import.meta.dirname, '../dist/injection/runtime.js'),
  seen = new Set<string>(),
): Promise<string> {
  if (seen.has(file)) {
    return '';
  }
  seen.add(file);
  const code = await readFile(file, 'utf8');
  const imports = [...code.matchAll(/from\s*"(\.{1,2}\/[^"]+)"/g)].map(
    (match) => path.resolve(path.dirname(file), match[1]),
  );
  const nested = await Promise.all(
    imports.map((imported) => readInjectedRuntime(imported, seen)),
  );
  return [code, ...nested].join('\n');
}

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
