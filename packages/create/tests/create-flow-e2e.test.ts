/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawn } from 'child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'fs/promises';
import { createServer, type Server } from 'http';
import { get as httpsGet } from 'https';
import { createRequire } from 'module';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { parse } from 'yaml';
import { isExampleAssetRequest } from '../../../scripts/development-url.mjs';
import { createPackedExampleAssetFixture } from '../../../scripts/example-asset-package-fixture.mjs';
import { iwsdkDev } from '../../vite-plugin-dev/src/index.js';
import { getRecommendedConfiguration } from '../src/catalog.js';
import { VERSION } from '../src/version.js';

type Middleware = (
  request: Readable & {
    headers?: Record<string, string | string[] | number | undefined>;
    method?: string;
    url?: string;
  },
  response: {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
    end(body?: string): void;
    setHeader(name: string, value: string): void;
  },
  next: () => void,
) => void;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CREATE_CLI = path.join(REPO_ROOT, 'packages', 'create', 'dist', 'cli.js');
const CREATE_E2E_EVIDENCE_DIR =
  process.env.IWSDK_CREATE_E2E_EVIDENCE_DIR == null
    ? undefined
    : path.resolve(REPO_ROOT, process.env.IWSDK_CREATE_E2E_EVIDENCE_DIR);
const requireFromVitePluginDev = createRequire(
  path.join(REPO_ROOT, 'packages', 'vite-plugin-dev', 'package.json'),
);
const { chromium } = requireFromVitePluginDev('playwright');
const LEGACY_EDITOR_TOKEN = ['meta', 'spatial'].join('');
const LEGACY_EDITOR_LABEL = ['Meta', 'Spatial'].join(' ');
const LEGACY_FLAGS = [
  `--${LEGACY_EDITOR_TOKEN}`,
  `--no-${LEGACY_EDITOR_TOKEN}`,
] as const;
const LEGACY_GENERATE_EXPORT = ['generate', 'GLXF'].join('');
const LEGACY_DISCOVER_EXPORT = ['discover', 'Components'].join('');
const LEGACY_EDITOR_CLI_ENV = ['META', 'SPATIAL', 'EDITOR', 'CLI', 'PATH'].join(
  '_',
);
const TEST_MANAGED_WORKSPACE_TOKEN = 'create-flow-managed-workspace-token';
const PACKED_ASSET_PUBLIC_PATH = '__iwsdk-example-assets/assets';
const EXPECTED_SHARP_VERSION = '0.35.4';
const MANAGED_WORKSPACE_HEADERS = {
  'x-iwsdk-managed-workspace': TEST_MANAGED_WORKSPACE_TOKEN,
};
const BUNDLE_PACKAGE_PATHS: Record<string, string> = {
  '@iwsdk/cli': 'packages/cli/iwsdk-cli.tgz',
  '@iwsdk/core': 'packages/core/iwsdk-core.tgz',
  '@iwsdk/locomotor': 'packages/locomotor/iwsdk-locomotor.tgz',
  '@iwsdk/reference': 'packages/reference/iwsdk-reference.tgz',
  '@iwsdk/scene-composition':
    'packages/scene-composition/iwsdk-scene-composition.tgz',
  '@iwsdk/vite-plugin-dev':
    'packages/vite-plugin-dev/iwsdk-vite-plugin-dev.tgz',
  '@iwsdk/xr-input': 'packages/xr-input/iwsdk-xr-input.tgz',
};
const maybeInstallE2ETest =
  process.env.IWSDK_CREATE_INSTALL_E2E === '1' ? test : test.skip;
const EXPERIENCE_TARGETS = ['browser', 'vr', 'ar'] as const;
type ExperienceTarget = (typeof EXPERIENCE_TARGETS)[number];

const tempDirs: string[] = [];
let browser:
  | { close(): Promise<void>; newPage(options?: unknown): Promise<any> }
  | undefined;
let previousManagedWorkspaceToken: string | undefined;

beforeAll(async () => {
  previousManagedWorkspaceToken =
    process.env.IWSDK_TEST_MANAGED_WORKSPACE_TOKEN;
  process.env.IWSDK_TEST_MANAGED_WORKSPACE_TOKEN = TEST_MANAGED_WORKSPACE_TOKEN;
  await stat(CREATE_CLI);
});

afterAll(() => {
  if (previousManagedWorkspaceToken == null) {
    delete process.env.IWSDK_TEST_MANAGED_WORKSPACE_TOKEN;
  } else {
    process.env.IWSDK_TEST_MANAGED_WORKSPACE_TOKEN =
      previousManagedWorkspaceToken;
  }
});

afterEach(async () => {
  await browser?.close();
  browser = undefined;
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
}, 60000);

describe('create-iwsdk scene flow E2E', () => {
  test('scaffolds in place when the current directory is empty', async () => {
    const workspace = await makeTempDir();
    const bundleServer = await startBundleServer();

    try {
      const result = await runCreate(
        [
          '.',
          '-y',
          '--target',
          'browser',
          '--no-install',
          '--no-git',
          '--canary',
          bundleServer.origin,
        ],
        workspace,
      );

      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      const packageJson = JSON.parse(
        await readFile(path.join(workspace, 'package.json'), 'utf8'),
      );
      expect(packageJson.name).toBe(path.basename(workspace).toLowerCase());
      expect(result.stdout).not.toContain('cd .');
      await stat(path.join(workspace, 'src', 'index.ts'));
    } finally {
      await bundleServer.close();
    }
  });

  test('requires --force before scaffolding into a non-empty directory', async () => {
    const workspace = await makeTempDir();
    const sentinelPath = path.join(workspace, 'cloud-harness.txt');
    await writeFile(sentinelPath, 'preserve me', 'utf8');

    const result = await runCreate(
      ['.', '-y', '--target', 'browser', '--no-install', '--no-git'],
      workspace,
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain(
      'Current directory is not empty',
    );
    expect(result.stderr + result.stdout).toContain('--force');
    expect(await readFile(sentinelPath, 'utf8')).toBe('preserve me');
    await expect(
      stat(path.join(workspace, 'package.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rechecks an unforced target immediately before writing', async () => {
    const workspace = await makeTempDir();
    const readmePath = path.join(workspace, 'README.md');
    let injectedContent = false;
    const bundleServer = await startBundleServer({
      onRequest: async (relativePath) => {
        if (relativePath === 'bundle.json' && !injectedContent) {
          injectedContent = true;
          await writeFile(readmePath, 'arrived during fetch', 'utf8');
        }
      },
    });

    try {
      const result = await runCreate(
        [
          '.',
          '-y',
          '--target',
          'browser',
          '--no-install',
          '--no-git',
          '--canary',
          bundleServer.origin,
        ],
        workspace,
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toContain(
        'Target directory is not empty',
      );
      expect(result.stderr + result.stdout).toContain('--force');
      expect(await readFile(readmePath, 'utf8')).toBe('arrived during fetch');
      await expect(
        stat(path.join(workspace, 'package.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await bundleServer.close();
    }
  });

  test('rejects generated-path symlinks without writing outside the target', async () => {
    const workspace = await makeTempDir();
    const externalDirectory = await makeTempDir();
    const externalSource = path.join(externalDirectory, 'index.ts');
    await writeFile(externalSource, 'preserve me', 'utf8');
    await symlink(externalDirectory, path.join(workspace, 'src'), 'dir');
    const bundleServer = await startBundleServer();

    try {
      const result = await runCreate(
        [
          '.',
          '-y',
          '--force',
          '--target',
          'browser',
          '--no-install',
          '--no-git',
          '--canary',
          bundleServer.origin,
        ],
        workspace,
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toContain(
        'Refusing to scaffold through symbolic link "src"',
      );
      expect(await readFile(externalSource, 'utf8')).toBe('preserve me');
      await expect(
        stat(path.join(workspace, 'package.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await bundleServer.close();
    }
  });

  test('preflights every generated path before a forced overlay', async () => {
    const workspace = await makeTempDir();
    const readmePath = path.join(workspace, 'README.md');
    const sourcePath = path.join(workspace, 'src');
    await writeFile(readmePath, 'preserve me', 'utf8');
    await writeFile(sourcePath, 'not a directory', 'utf8');
    const bundleServer = await startBundleServer();

    try {
      const result = await runCreate(
        [
          '.',
          '-y',
          '--force',
          '--target',
          'browser',
          '--no-install',
          '--no-git',
          '--canary',
          bundleServer.origin,
        ],
        workspace,
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toContain(
        '"src" is not a directory',
      );
      expect(await readFile(readmePath, 'utf8')).toBe('preserve me');
      expect(await readFile(sourcePath, 'utf8')).toBe('not a directory');
      await expect(
        stat(path.join(workspace, 'package.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await bundleServer.close();
    }
  });

  test('force-overlays generated files while preserving an existing repository', async () => {
    const repository = await makeTempDir();
    const workspace = path.join(repository, 'existing-app');
    await mkdir(workspace);
    const bundleServer = await startBundleServer();
    const gitInit = await runCommand('git', ['init'], repository);
    expect(gitInit.exitCode, gitInit.stderr + gitInit.stdout).toBe(0);
    const sentinelPath = path.join(workspace, 'cloud-harness.txt');
    await writeFile(sentinelPath, 'preserve me', 'utf8');
    await writeFile(path.join(workspace, 'README.md'), 'replace me', 'utf8');

    try {
      const result = await runCreate(
        [
          '.',
          '-y',
          '--force',
          '--target',
          'browser',
          '--no-install',
          '--canary',
          bundleServer.origin,
        ],
        workspace,
      );

      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      expect(result.stderr + result.stdout).toContain(
        '--force will overwrite conflicting generated files',
      );
      expect(await readFile(sentinelPath, 'utf8')).toBe('preserve me');
      expect(
        await readFile(path.join(workspace, 'README.md'), 'utf8'),
      ).not.toBe('replace me');
      await stat(path.join(repository, '.git', 'HEAD'));
      await expect(stat(path.join(workspace, '.git'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await stat(path.join(workspace, 'package.json'));
    } finally {
      await bundleServer.close();
    }
  });

  test('scaffolds every supported starter with scene JSON and editor-readable scenes', async () => {
    const workspace = await makeTempDir();
    const bundleServer = await startBundleServer();

    try {
      for (const target of EXPERIENCE_TARGETS) {
        for (const language of ['ts', 'js'] as const) {
          const appName = `app-${target}-${language}`;
          const result = await runCreate(
            [
              appName,
              '-y',
              '--target',
              target,
              '--language',
              language,
              '--no-install',
              '--no-git',
              '--canary',
              bundleServer.origin,
            ],
            workspace,
          );

          expect(result.exitCode, result.stderr + result.stdout).toBe(0);

          const appRoot = path.join(workspace, appName);
          const packageJson = JSON.parse(
            await readFile(path.join(appRoot, 'package.json'), 'utf8'),
          );
          const sceneFile = path.join(
            appRoot,
            'public',
            'scenes',
            'main.iwsdk.scene.json',
          );
          const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
          const projectManifest = JSON.parse(
            await readFile(path.join(appRoot, 'iwsdk.config.json'), 'utf8'),
          );
          const generatedScenes = (
            await readdir(path.join(appRoot, 'public', 'scenes'))
          ).filter((file) => file.endsWith('.iwsdk.scene.json'));
          const viteConfig = await readFile(
            path.join(
              appRoot,
              `vite.config.${language === 'ts' ? 'ts' : 'js'}`,
            ),
            'utf8',
          );
          const source = await readFile(
            path.join(appRoot, 'src', `index.${language}`),
            'utf8',
          );

          expect(packageJson.devDependencies).toHaveProperty(
            '@iwsdk/vite-plugin-dev',
          );
          expect(JSON.stringify(packageJson)).not.toMatch(
            new RegExp(LEGACY_EDITOR_TOKEN, 'i'),
          );
          expect(scene).toMatchObject({
            units: 'meters',
            version: 'iwsdk.scene.v1',
          });
          expect(generatedScenes).toEqual(['main.iwsdk.scene.json']);
          expect(source).toContain("from 'virtual:iwsdk-project'");
          expect(source).not.toMatch(/SessionMode|\bxr:\s*(?:false|\{)/u);
          expect(viteConfig).toContain('iwsdkDev()');
          expect(viteConfig).not.toMatch(
            /assetManifest|componentManifest|workspace:|\bai:/u,
          );
          expect(projectManifest).toMatchObject({
            version: 'iwsdk.project.v1',
            scene: './public/scenes/main.iwsdk.scene.json',
            world: {
              xr:
                target === 'browser'
                  ? false
                  : expect.objectContaining({ mode: target }),
            },
          });
          for (const demoPath of [
            path.join('src', `robot.${language}`),
            path.join('src', `panel.${language}`),
            path.join('src', 'scene-assets', `studio.scene-asset.${language}`),
            path.join('src', 'scene-assets', `decor.scene-asset.${language}`),
            path.join('public', 'ui', 'welcome.uikitml'),
            path.join('public', 'ui', 'label-grab.uikitml'),
            path.join('public', 'ui', 'label-select.uikitml'),
            path.join('public', 'ui', 'label-spin.uikitml'),
            path.join('public', 'audio'),
          ]) {
            await expect(
              stat(path.join(appRoot, demoPath)),
            ).resolves.toBeDefined();
          }
          expect(viteConfig).not.toMatch(
            new RegExp(
              `${LEGACY_GENERATE_EXPORT}|${LEGACY_DISCOVER_EXPORT}`,
              'i',
            ),
          );
          await expect(
            stat(path.join(appRoot, LEGACY_EDITOR_TOKEN)),
          ).rejects.toMatchObject({ code: 'ENOENT' });

          const editorMiddleware = createEditorMiddleware(appRoot);
          const documentResponse = await runMiddleware(
            editorMiddleware,
            'GET',
            '/__iwsdk/editor/document?scene=public/scenes/main.iwsdk.scene.json',
            '',
            MANAGED_WORKSPACE_HEADERS,
          );
          expect(documentResponse.statusCode).toBe(200);
          expect(JSON.parse(documentResponse.body)).toMatchObject({
            units: 'meters',
            version: 'iwsdk.scene.v1',
          });

          const editorShell = await runMiddleware(
            editorMiddleware,
            'GET',
            '/__iwsdk/workspace?scene=public/scenes/main.iwsdk.scene.json',
            '',
            MANAGED_WORKSPACE_HEADERS,
          );
          expect(editorShell.statusCode).toBe(200);
          expect(editorShell.body).toContain('IWSDK Scene Editor');
          expect(editorShell.body).toContain(
            'documentUrl: "/__iwsdk/editor/document"',
          );
          expect(editorShell.body).not.toContain(
            'scene=public/scenes/main.iwsdk.scene.json',
          );
        }
      }
    } finally {
      await bundleServer.close();
    }
  }, 30000);

  test('does not advertise or accept retired setup flags', async () => {
    const workspace = await makeTempDir();
    const help = await runCreate(['--help'], workspace);

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toMatch(
      /Project directory \(use "\." for the current\s+directory\)/,
    );
    expect(help.stdout).toContain('--force');
    expect(help.stdout).toContain('Use the desktop 3D starting point');
    expect(help.stdout).not.toContain('--ai-tools');
    expect(help.stdout).not.toMatch(
      new RegExp(
        `${LEGACY_EDITOR_LABEL}|${LEGACY_FLAGS.map(escapeRegex).join('|')}`,
        'i',
      ),
    );

    for (const flag of LEGACY_FLAGS) {
      const legacy = await runCreate(
        [`legacy-app-${flag.replace(/^--/, '')}`, '-y', '--no-install', flag],
        workspace,
      );

      expect(legacy.exitCode).not.toBe(0);
      expect(legacy.stderr + legacy.stdout).toMatch(
        new RegExp(`unknown option.*${LEGACY_EDITOR_TOKEN}`, 'i'),
      );
      expect(legacy.stderr + legacy.stdout).not.toMatch(
        /Preparing SDK bundle/i,
      );
    }

    const retiredToolSelection = await runCreate(
      ['retired-ai-tools-app', '-y', '--no-install', '--ai-tools', 'none'],
      workspace,
    );
    expect(retiredToolSelection.exitCode).not.toBe(0);
    expect(retiredToolSelection.stderr + retiredToolSelection.stdout).toMatch(
      /unknown option.*--ai-tools/i,
    );
    expect(
      retiredToolSelection.stderr + retiredToolSelection.stdout,
    ).not.toMatch(/Preparing SDK bundle/i);
  });

  test('applies noninteractive browser feature flags deterministically', async () => {
    const workspace = await makeTempDir();
    const bundleServer = await startBundleServer();

    try {
      const appName = 'browser-overrides-app';
      const result = await runCreate(
        [
          appName,
          '-y',
          '--target',
          'browser',
          '--language',
          'ts',
          '--no-locomotion',
          '--no-grabbing',
          '--physics',
          '--no-install',
          '--no-git',
          '--canary',
          bundleServer.origin,
        ],
        workspace,
      );

      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      const manifest = JSON.parse(
        await readFile(
          path.join(workspace, appName, 'iwsdk.config.json'),
          'utf8',
        ),
      );
      const source = await readFile(
        path.join(workspace, appName, 'src', 'index.ts'),
        'utf8',
      );
      const configuration = getRecommendedConfiguration('browser', {
        locomotionEnabled: false,
        grabbingEnabled: false,
        physicsEnabled: true,
      });
      expect(source).toContain("from 'virtual:iwsdk-project'");
      expect(manifest.world).toMatchObject({
        xr: false,
        features: {
          locomotion: false,
          grabbing: false,
          physics: true,
        },
      });
      expect(configuration.featureFlags.physicsEnabled).toBe(true);
    } finally {
      await bundleServer.close();
    }
  });

  test('rejects feature flags that do not apply to the selected target', async () => {
    const workspace = await makeTempDir();
    const cases = [
      { option: '--locomotion', target: 'ar' },
      { option: '--scene-understanding', target: 'vr' },
      { option: '--environment-raycast', target: 'browser' },
    ] as const;

    for (const { option, target } of cases) {
      const result = await runCreate(
        [
          `incompatible-${target}-app`,
          '-y',
          '--target',
          target,
          option,
          '--no-install',
        ],
        workspace,
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toContain(
        `${option} is not available for --target ${target}`,
      );
      expect(result.stderr + result.stdout).not.toMatch(
        /Preparing SDK bundle/i,
      );
    }
  });

  test('embeds all coding-harness guidance without template network requests', async () => {
    const workspace = await makeTempDir();
    const requests: string[] = [];
    const bundleServer = await startBundleServer({
      onRequest: (relativePath) => requests.push(relativePath),
    });

    try {
      const appName = 'missing-ai-guidance-app';
      const result = await runCreate(
        [
          appName,
          '-y',
          '--target',
          'vr',
          '--no-install',
          '--no-git',
          '--canary',
          bundleServer.origin,
        ],
        workspace,
      );
      const output = result.stderr + result.stdout;

      expect(result.exitCode, output).toBe(0);
      expect(output).not.toContain('Could not configure');
      expect(output).not.toContain('iwsdk adapter sync');
      await stat(path.join(workspace, appName, 'package.json'));
      await stat(path.join(workspace, appName, 'AGENTS.md'));
      await stat(path.join(workspace, appName, 'CLAUDE.md'));
      await stat(path.join(workspace, appName, '.claude', 'settings.json'));
      await stat(
        path.join(
          workspace,
          appName,
          '.agents',
          'skills',
          'iwsdk-dev',
          'SKILL.md',
        ),
      );
      await stat(path.join(workspace, appName, '.codex', 'config.toml'));
      await stat(
        path.join(workspace, appName, '.cursor', 'rules', 'scene-json.mdc'),
      );
      await stat(
        path.join(
          workspace,
          appName,
          '.github',
          'instructions',
          'scene-json.instructions.md',
        ),
      );
      await stat(path.join(workspace, appName, 'src', 'AGENTS.md'));
      expect(requests).toEqual(['bundle.json']);
    } finally {
      await bundleServer.close();
    }
  });

  maybeInstallE2ETest(
    'supports a deferred pnpm install from a downloaded canary bundle',
    async () => {
      const workspace = await makeTempDir();
      const bundleServer = await startBundleServer({
        packages: BUNDLE_PACKAGE_PATHS,
      });

      try {
        await assertBundleTarballsExist();
        for (const pnpmVersion of ['10.18.3', '11.21.0']) {
          const appName = `deferred-pnpm-${pnpmVersion.replaceAll('.', '-')}`;

          const result = await runCreate(
            [
              appName,
              '-y',
              '--target',
              'vr',
              '--no-install',
              '--no-git',
              '--canary',
              bundleServer.origin,
            ],
            workspace,
          );
          expect(result.exitCode, result.stderr + result.stdout).toBe(0);

          const appRoot = path.join(workspace, appName);
          const pnpmWorkspace = await readPnpmWorkspace(appRoot);
          expect(pnpmWorkspace.overrides).toMatchObject({
            sharp: EXPECTED_SHARP_VERSION,
            '@iwsdk/cli': 'file:.sdk-packages/cli/iwsdk-cli.tgz',
            '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
            '@iwsdk/scene-composition':
              'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
          });
          expect(pnpmWorkspace.onlyBuiltDependencies).toEqual([
            'esbuild',
            'protobufjs',
            'sharp',
          ]);
          expect(pnpmWorkspace.ignoredBuiltDependencies).toEqual([
            '@meta-quest/metavr',
            'onnxruntime-node',
          ]);
          expect(pnpmWorkspace.allowBuilds).toEqual({
            esbuild: true,
            protobufjs: true,
            sharp: true,
            '@meta-quest/metavr': false,
            'onnxruntime-node': false,
          });

          const install = await runCommand(
            'corepack',
            [`pnpm@${pnpmVersion}`, 'install', '--no-frozen-lockfile'],
            appRoot,
            { timeoutMs: 180000 },
          );
          expect(install.exitCode, install.stderr + install.stdout).toBe(0);
          const pnpmLock = await readFile(
            path.join(appRoot, 'pnpm-lock.yaml'),
            'utf8',
          );
          expect(pnpmLock).toMatch(/^  sharp@0\.35\.4:/mu);
          expect(pnpmLock).not.toMatch(/^  sharp@0\.34\./mu);
          expect(install.stderr + install.stdout).not.toContain(
            'Ignored build scripts',
          );
          const ignoredBuilds = await runCommand(
            'corepack',
            [`pnpm@${pnpmVersion}`, 'ignored-builds'],
            appRoot,
            { timeoutMs: 60000 },
          );
          expect(
            ignoredBuilds.exitCode,
            ignoredBuilds.stderr + ignoredBuilds.stdout,
          ).toBe(0);
          expect(ignoredBuilds.stdout).toMatch(
            /Automatically ignored builds during installation:\s+None/u,
          );

          const typecheck = await runCommand(
            'corepack',
            [`pnpm@${pnpmVersion}`, 'exec', 'tsc', '--noEmit'],
            appRoot,
            { timeoutMs: 180000 },
          );
          expect(typecheck.exitCode, typecheck.stderr + typecheck.stdout).toBe(
            0,
          );

          const build = await runCommand(
            'corepack',
            [`pnpm@${pnpmVersion}`, 'run', 'build'],
            appRoot,
            { timeoutMs: 180000 },
          );
          expect(build.exitCode, build.stderr + build.stdout).toBe(0);
        }
      } finally {
        await bundleServer.close();
      }
    },
    480000,
  );

  maybeInstallE2ETest(
    'installs, builds, and serves every generated starter with the native editor route',
    async () => {
      const workspace = await makeTempDir();
      let packedAssetFixture: Awaited<
        ReturnType<typeof createPackedExampleAssetFixture>
      > | null = null;
      let bundleServer: TestBundleServer | null = null;

      try {
        packedAssetFixture = await createPackedExampleAssetFixture();
        bundleServer = await startBundleServer({
          packages: BUNDLE_PACKAGE_PATHS,
        });
        await assertBundleTarballsExist();
        for (const target of EXPERIENCE_TARGETS) {
          for (const language of ['ts', 'js'] as const) {
            const appName = `installed-${target}-${language}-app`;
            const result = await runCreate(
              [
                appName,
                '-y',
                '--target',
                target,
                '--language',
                language,
                '--no-git',
                '--canary',
                bundleServer.origin,
              ],
              workspace,
              { timeoutMs: 240000 },
            );
            expect(result.exitCode, result.stderr + result.stdout).toBe(0);

            const appRoot = path.join(workspace, appName);
            const packageJson = JSON.parse(
              await readFile(path.join(appRoot, 'package.json'), 'utf8'),
            );
            const pnpmWorkspace = await readPnpmWorkspace(appRoot);
            const packageLock = JSON.parse(
              await readFile(path.join(appRoot, 'package-lock.json'), 'utf8'),
            ) as {
              packages?: Record<string, { version?: string }>;
            };
            const sharpVersions = Object.entries(packageLock.packages ?? {})
              .filter(([packagePath]) =>
                packagePath.endsWith('node_modules/sharp'),
              )
              .map(([, packageEntry]) => packageEntry.version);
            expect(packageJson.dependencies['@iwsdk/core']).toMatch(
              /^file:\.sdk-packages\/core\/iwsdk-core\.tgz$/,
            );
            expect(
              packageJson.devDependencies['@iwsdk/vite-plugin-dev'],
            ).toMatch(
              /^file:\.sdk-packages\/vite-plugin-dev\/iwsdk-vite-plugin-dev\.tgz$/,
            );
            expect(packageJson.overrides).toMatchObject({
              '@iwsdk/scene-composition':
                'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
            });
            expect(sharpVersions.length).toBeGreaterThan(0);
            expect(new Set(sharpVersions)).toEqual(
              new Set([EXPECTED_SHARP_VERSION]),
            );
            expect(pnpmWorkspace.overrides).toMatchObject({
              sharp: EXPECTED_SHARP_VERSION,
              '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
              '@iwsdk/scene-composition':
                'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
            });
            expect(pnpmWorkspace.onlyBuiltDependencies).toEqual([
              'esbuild',
              'protobufjs',
              'sharp',
            ]);
            expect(pnpmWorkspace.ignoredBuiltDependencies).toEqual([
              '@meta-quest/metavr',
              'onnxruntime-node',
            ]);
            await stat(path.join(appRoot, 'node_modules'));

            if (language === 'ts') {
              const typecheck = await runCommand(
                'npm',
                ['run', 'typecheck'],
                appRoot,
                { timeoutMs: 180000 },
              );
              expect(
                typecheck.exitCode,
                typecheck.stderr + typecheck.stdout,
              ).toBe(0);
            }

            const build = await runCommand('npm', ['run', 'build'], appRoot, {
              timeoutMs: 180000,
            });
            expect(build.exitCode, build.stderr + build.stdout).toBe(0);
            await stat(path.join(appRoot, 'dist', 'index.html'));

            // The plugin-owned managed browser cannot inherit routes from the
            // test's Playwright pages. Serve the verified packed fixture from
            // the generated app so every browser consumes the same bytes.
            const packedAssetPublicRoot = path.join(
              appRoot,
              'public',
              PACKED_ASSET_PUBLIC_PATH,
            );
            await cp(packedAssetFixture.assetRoot, packedAssetPublicRoot, {
              recursive: true,
            });
            const port = await getFreePort();
            const devServer = startLongRunningCommand(
              'npm',
              [
                'run',
                'dev:runtime',
                '--',
                '--host',
                '127.0.0.1',
                '--port',
                String(port),
                '--strictPort',
              ],
              appRoot,
              {
                env: {
                  // Automated coverage is explicitly headless. Product and
                  // generated-project defaults remain headed.
                  IWSDK_DEV_AI_MODE: '',
                  IWSDK_DEV_HEADLESS: 'true',
                  IWSDK_DEV_OPEN: 'true',
                  IWSDK_DEV_SCREENSHOT_HEIGHT: '',
                  IWSDK_DEV_SCREENSHOT_WIDTH: '',
                  VITE_IWSDK_EXAMPLE_ASSET_BASE_URL: `/${PACKED_ASSET_PUBLIC_PATH}`,
                },
              },
            );

            try {
              const baseUrl = `https://127.0.0.1:${port}`;
              const appPage = await waitForHttpOk(`${baseUrl}/`, devServer);
              expect(await appPage.text()).toContain('scene-container');

              const scenePath = 'public/scenes/main.iwsdk.scene.json';
              const editorPage = await waitForHttpOk(
                `${baseUrl}/__iwsdk/editor`,
                devServer,
                45000,
                MANAGED_WORKSPACE_HEADERS,
              );
              expect(await editorPage.text()).toContain('IWSDK Scene Editor');

              const documentResponse = await waitForHttpOk(
                `${baseUrl}/__iwsdk/editor/document`,
                devServer,
                45000,
                MANAGED_WORKSPACE_HEADERS,
              );
              expect(await documentResponse.json()).toMatchObject({
                units: 'meters',
                version: 'iwsdk.scene.v1',
              });

              const runtimeSession = await waitForManagedBrowserLaunch(
                appRoot,
                devServer,
              );
              expect(runtimeSession.aiMode).toBeUndefined();
              expect(runtimeSession.browser).toMatchObject({
                commandReady: true,
                connected: true,
                status: 'connected',
              });
              if (target === 'browser') {
                if (language === 'ts') {
                  const workspaceStatus = await runCommand(
                    'npm',
                    ['run', '--silent', 'dev:status'],
                    appRoot,
                    { timeoutMs: 60000 },
                  );
                  expect(
                    workspaceStatus.exitCode,
                    workspaceStatus.stderr + workspaceStatus.stdout,
                  ).toBe(0);
                  expect(JSON.parse(workspaceStatus.stdout)).toMatchObject({
                    data: {
                      state: {
                        session: {
                          browser: {
                            connected: true,
                            status: 'connected',
                          },
                        },
                      },
                    },
                  });
                }
              }

              await smokeGeneratedAppEditorFlow({
                appRoot,
                baseUrl,
                language,
                target,
                scenePath,
              });
            } finally {
              await devServer.close();
              await rm(packedAssetPublicRoot, { force: true, recursive: true });
            }
          }
        }
      } finally {
        await bundleServer?.close();
        await packedAssetFixture?.close();
      }
    },
    900000,
  );
});

async function smokeGeneratedAppEditorFlow({
  appRoot,
  baseUrl,
  language,
  target,
  scenePath,
}: {
  appRoot: string;
  baseUrl: string;
  language: 'js' | 'ts';
  target: ExperienceTarget;
  scenePath: string;
}) {
  const scenePublicUrl = scenePath.replace(/^public\//, '');
  browser ??= await launchChromium();
  const originalScene = JSON.parse(
    await readFile(path.join(appRoot, scenePath), 'utf8'),
  ) as { assets?: unknown[]; nodes?: unknown[] };
  // The editor status counts nested nodes too.
  const expectedNodeCount =
    flattenSceneNodes(originalScene.nodes ?? []).length + 1;
  const addedNodeId =
    target === 'browser' ? 'scaffold-added-group' : 'scaffold-added-robot';
  const assetIds = getSceneAssetIds(originalScene);
  const sharedAssetIds = assetIds.filter((assetId) => assetId === 'robot');
  const evidenceDir =
    CREATE_E2E_EVIDENCE_DIR == null || language !== 'ts'
      ? undefined
      : path.join(CREATE_E2E_EVIDENCE_DIR, `generated-${target}`);
  if (evidenceDir != null) {
    await mkdir(evidenceDir, { recursive: true });
  }

  const appPage = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { height: 720, width: 960 },
  });
  const editorPage = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { height: 720, width: 960 },
  });
  await installManagedWorkspaceRoute(editorPage, baseUrl);
  const appDiagnostics = collectPageDiagnostics(appPage, sharedAssetIds);
  const editorDiagnostics = collectPageDiagnostics(editorPage, sharedAssetIds);

  try {
    await appPage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    expect(await appPage.evaluate(() => window.isSecureContext)).toBe(true);
    try {
      await appPage.waitForFunction(
        () => Boolean((window as any).FRAMEWORK_MCP_RUNTIME),
        undefined,
        { timeout: 30000 },
      );
    } catch (error) {
      throw new Error(
        `generated ${target}/${language} runtime did not initialize\n${JSON.stringify(
          appDiagnostics.snapshot(),
          null,
          2,
        )}`,
        { cause: error },
      );
    }
    await appPage.waitForFunction(
      () => document.querySelectorAll('canvas').length > 0,
      undefined,
      { timeout: 30000 },
    );
    const appScreenshotStats = await waitForNonblankScreenshot(
      appPage,
      evidenceDir == null ? undefined : path.join(evidenceDir, 'app.png'),
    );
    expect(
      appScreenshotStats.uniqueColors,
      `generated ${target} app should render a nonblank frame\n${JSON.stringify(
        appDiagnostics.snapshot(),
        null,
        2,
      )}`,
    ).toBeGreaterThan(8);
    const systems = (await dispatchRuntime(
      appPage,
      'ecs_list_systems',
      {},
    )) as {
      systems: Array<{ name: string }>;
    };
    expect(systems.systems.map((system) => system.name)).not.toContain(
      'BrowserMouseLookSystem',
    );

    await editorPage.goto(`${baseUrl}/__iwsdk/workspace`, {
      waitUntil: 'domcontentloaded',
    });
    expect(await editorPage.evaluate(() => window.isSecureContext)).toBe(true);
    try {
      await editorPage.waitForFunction(
        () => Boolean((window as any).IWSDK_SCENE_EDITOR),
        undefined,
        { timeout: 60000 },
      );
    } catch (error) {
      throw new Error(
        `generated ${target}/${language} editor did not initialize at ${editorPage.url()}\n${JSON.stringify(
          {
            diagnostics: editorDiagnostics.snapshot(),
            html: (await editorPage.content()).slice(0, 4000),
          },
          null,
          2,
        )}`,
        { cause: error },
      );
    }
    await editorPage.waitForFunction(
      () =>
        Boolean(
          (window as any).IWSDK_SCENE_EDITOR_TEST_HOOKS?.getProof?.()
            ?.worldReady,
        ),
      undefined,
      { timeout: 30000 },
    );
    await expect
      .poll(() => editorPage.locator('#dirty-status').textContent())
      .toBe('Saved');
    const editorProofBefore = await editorPage.evaluate(() =>
      (window as any).IWSDK_SCENE_EDITOR_TEST_HOOKS.getProof(),
    );
    expect(editorProofBefore).toMatchObject({
      renderer: 'iwsdk-webgl',
      uses2DRenderer: false,
      webgl: true,
      worldReady: true,
    });
    // The workspace can report Saved before its runtime iframe presents a
    // frame. Until it does, AR's transparent canvas shows the workspace
    // background, which with the toolbar already samples about a dozen
    // colors, so require more than the app page does.
    const editorScreenshotStats = await waitForNonblankScreenshot(
      editorPage,
      evidenceDir == null ? undefined : path.join(evidenceDir, 'editor.png'),
      { minUniqueColors: 17 },
    );
    expect(editorScreenshotStats.uniqueColors).toBeGreaterThan(16);

    const toolResult = await editorPage.evaluate(async (experienceTarget) => {
      const runtime = (window as any).IWSDK_SCENE_EDITOR.runtime;
      const node =
        experienceTarget === 'browser'
          ? {
              content: { type: 'group' },
              id: 'scaffold-added-group',
              name: 'Scaffold Added Group',
            }
          : {
              content: {
                asset: 'robot',
                type: 'asset',
              },
              id: 'scaffold-added-robot',
              name: 'Scaffold Added Robot',
              transform: {
                position: [0.45, 0.28, -0.7],
                rotationDeg: [0, -20, 0],
                scale: 0.6,
              },
            };
      await runtime.dispatch('scene_add_node', {
        node,
      });
      await runtime.dispatch('scene_set_camera', { view: 'top' });
      const screenshots = [];
      for (const view of ['top', 'front', 'right', 'quarter']) {
        screenshots.push(
          await runtime.dispatch('scene_screenshot', {
            height: 240,
            view,
            width: 320,
          }),
        );
      }
      const validation = await runtime.dispatch('scene_validate', {});
      const saved = await runtime.dispatch('scene_save', {});
      const documentResult = await runtime.dispatch('scene_get_document', {});
      return { documentResult, saved, screenshots, validation };
    }, target);

    expect(toolResult.saved).toMatchObject({
      dirty: false,
      path: scenePath,
    });
    expect(
      (toolResult.documentResult as { document: { nodes: unknown[] } }).document
        .nodes,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: addedNodeId })]),
    );
    expect(
      (
        toolResult.screenshots as Array<{
          camera: { view: string };
          imageData: string;
          mimeType: string;
        }>
      ).map((screenshot) => screenshot.camera.view),
    ).toEqual(['top', 'front', 'right', 'quarter']);
    for (const screenshot of toolResult.screenshots as Array<{
      imageData: string;
      mimeType: string;
    }>) {
      expect(screenshot.mimeType).toBe('image/png');
      expect(screenshot.imageData.length).toBeGreaterThan(1000);
    }
    expect(toolResult.validation).toMatchObject({
      issues: expect.any(Array),
      valid: expect.any(Boolean),
    });

    await editorPage.reload({ waitUntil: 'domcontentloaded' });
    await editorPage.waitForFunction(
      () => Boolean((window as any).IWSDK_SCENE_EDITOR),
      undefined,
      { timeout: 60000 },
    );
    await expect
      .poll(() => editorPage.locator('#scene-status').textContent())
      .toContain(`${expectedNodeCount} nodes`);

    await appPage.reload({ waitUntil: 'domcontentloaded' });
    await appPage.waitForFunction(
      () => Boolean((window as any).FRAMEWORK_MCP_RUNTIME),
      undefined,
      { timeout: 90000 },
    );
    await appPage.waitForFunction(
      () => document.querySelectorAll('canvas').length > 0,
      undefined,
      { timeout: 30000 },
    );
    await appPage.waitForTimeout(1000);
    const appScene = await appPage.evaluate(async (url) => {
      const response = await fetch(`/${url}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`scene reload failed: ${response.status}`);
      }
      return response.json();
    }, scenePublicUrl);
    expect(appScene.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: addedNodeId })]),
    );

    const savedScene = JSON.parse(
      await readFile(path.join(appRoot, scenePath), 'utf8'),
    );
    expect(savedScene.nodes).toEqual(
      expect.arrayContaining([
        target === 'browser'
          ? expect.objectContaining({
              content: { type: 'group' },
              id: addedNodeId,
            })
          : expect.objectContaining({
              content: {
                asset: 'robot',
                type: 'asset',
              },
              id: addedNodeId,
              transform: expect.objectContaining({
                position: [0.45, 0.28, -0.7],
              }),
            }),
      ]),
    );
    const savedComponentIds = getSceneComponentIds(savedScene);
    const hierarchy = await dispatchRuntime(appPage, 'get_scene_hierarchy', {
      maxChildren: 100,
      maxDepth: 10,
    });
    for (const componentId of savedComponentIds) {
      expect(
        await waitForRuntimeComponentCount(appPage, componentId),
        `runtime component ${componentId}`,
      ).toBeGreaterThan(0);
    }
    const componentSummary = await getRuntimeComponentSummary(
      appPage,
      savedComponentIds,
    );
    const appAfterReloadScreenshotStats = await waitForNonblankScreenshot(
      appPage,
      evidenceDir == null
        ? undefined
        : path.join(evidenceDir, 'app-after-reload.png'),
    );
    expect(appAfterReloadScreenshotStats.uniqueColors).toBeGreaterThan(8);

    const appSnapshot = appDiagnostics.snapshot();
    const editorSnapshot = editorDiagnostics.snapshot();
    expect(filterIgnorableBrowserErrors(appSnapshot.consoleErrors)).toEqual([]);
    expect(filterIgnorableBrowserErrors(editorSnapshot.consoleErrors)).toEqual(
      [],
    );
    expect(
      filterIgnorableRequestFailures(appSnapshot.failedRequests, baseUrl),
    ).toEqual([]);
    expect(
      filterIgnorableRequestFailures(editorSnapshot.failedRequests, baseUrl),
    ).toEqual([]);
    expect(filterIgnorableBadResponses(appSnapshot.badResponses)).toEqual([]);
    expect(filterIgnorableBadResponses(editorSnapshot.badResponses)).toEqual(
      [],
    );
    assertAssetResponses(appSnapshot.assetResponses, sharedAssetIds);
    assertAssetResponses(editorSnapshot.assetResponses, sharedAssetIds);
    if (evidenceDir != null) {
      await writeFile(
        path.join(evidenceDir, 'proof.json'),
        JSON.stringify(
          {
            app: {
              afterReloadScreenshot: {
                path: 'app-after-reload.png',
                stats: appAfterReloadScreenshotStats,
              },
              hierarchy,
              initialScreenshot: {
                path: 'app.png',
                stats: appScreenshotStats,
              },
              runtimeComponents: componentSummary,
            },
            browser: {
              baseUrl,
              mode: target,
              target,
              scenePath,
            },
            editor: {
              proofBefore: editorProofBefore,
              screenshot: {
                path: 'editor.png',
                stats: editorScreenshotStats,
              },
              toolResult: {
                saved: toolResult.saved,
                screenshotViews: (
                  toolResult.screenshots as Array<{
                    camera: { view: string };
                    imageData: string;
                    mimeType: string;
                  }>
                ).map((screenshot) => ({
                  imageDataLength: screenshot.imageData.length,
                  mimeType: screenshot.mimeType,
                  view: screenshot.camera.view,
                })),
                validation: toolResult.validation,
              },
            },
            network: {
              app: appSnapshot,
              editor: editorSnapshot,
            },
            scene: {
              after: savedScene,
              before: originalScene,
            },
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await editorPage.close();
    await appPage.close();
  }
}

async function readPnpmWorkspace(appRoot: string) {
  return parse(
    await readFile(path.join(appRoot, 'pnpm-workspace.yaml'), 'utf8'),
  );
}
async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-create-e2e-'));
  tempDirs.push(tempDir);
  return tempDir;
}

async function runCreate(
  args: string[],
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<CommandResult> {
  return runCommand(process.execPath, [CREATE_CLI, ...args], cwd, {
    env: {
      [LEGACY_EDITOR_CLI_ENV]: '',
    },
    timeoutMs: options.timeoutMs,
  });
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise<CommandResult>((resolve, reject) => {
    const timeout =
      options.timeoutMs == null
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            stderr += `\nCommand timed out after ${options.timeoutMs}ms: ${command} ${args.join(
              ' ',
            )}\n`;
            child.kill('SIGTERM');
          }, options.timeoutMs);
    child.on('error', reject);
    child.on('exit', (exitCode) => {
      if (timeout != null) {
        clearTimeout(timeout);
      }
      resolve({ exitCode, stderr, stdout, timedOut });
    });
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type BundleServerOptions = {
  onRequest?: (relativePath: string) => Promise<void> | void;
  packages?: Record<string, string>;
};

type TestBundleServer = {
  close: () => Promise<void>;
  origin: string;
};

async function startBundleServer(
  options: BundleServerOptions = {},
): Promise<TestBundleServer> {
  const packages = options?.packages ?? {};
  const server: Server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(
      /^\/+/,
      '',
    );
    await options?.onRequest?.(relativePath);

    if (relativePath === 'bundle.json') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          packages,
          schemaVersion: 1,
          sdkVersion: VERSION,
        }),
      );
      return;
    }

    const serveRoot = REPO_ROOT;
    const filePath = path.resolve(serveRoot, relativePath);
    if (
      filePath !== serveRoot &&
      !filePath.startsWith(`${serveRoot}${path.sep}`)
    ) {
      response.writeHead(403).end();
      return;
    }

    try {
      response.writeHead(200).end(await readFile(filePath));
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function assertBundleTarballsExist() {
  await Promise.all(
    Object.values(BUNDLE_PACKAGE_PATHS).map((relativePath) =>
      stat(path.join(REPO_ROOT, relativePath)),
    ),
  );
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function startLongRunningCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { env?: Record<string, string> } = {},
) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env: {
      ...process.env,
      BROWSER: 'none',
      NO_COLOR: '1',
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let exitCode: number | null | undefined;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitPromise = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      exitCode = code;
      resolve(code);
    });
  });

  return {
    close: async () => {
      if (exitCode === undefined && child.pid != null) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {}
        await Promise.race([exitPromise, sleep(3000)]);
      }
      if (exitCode === undefined && child.pid != null) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
        await Promise.race([exitPromise, sleep(1000)]);
      }
    },
    hasExited: () => exitCode !== undefined,
    output: () => stderr + stdout,
  };
}

async function waitForHttpOk(
  url: string,
  processHandle: { hasExited(): boolean; output(): string },
  timeoutMs = 45000,
  headers?: Record<string, string>,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (processHandle.hasExited()) {
      throw new Error(
        `Dev server exited before ${url} became available:\n${processHandle.output()}`,
      );
    }
    try {
      const response = await fetchDevelopmentUrl(url, headers);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }\n${processHandle.output()}`,
  );
}

function fetchDevelopmentUrl(
  url: string,
  headers?: Record<string, string>,
  redirectsRemaining = 5,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      {
        headers,
        // Mirrors a developer accepting the expected self-signed certificate
        // warning without weakening trust for any other test traffic.
        rejectUnauthorized: false,
      },
      (response) => {
        if (
          response.statusCode != null &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location != null &&
          redirectsRemaining > 0
        ) {
          response.resume();
          resolve(
            fetchDevelopmentUrl(
              new URL(response.headers.location, url).href,
              headers,
              redirectsRemaining - 1,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              headers: response.headers as HeadersInit,
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
            }),
          );
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(5000, () => {
      request.destroy(new Error(`Timed out fetching ${url}`));
    });
  });
}

async function waitForManagedBrowserLaunch(
  appRoot: string,
  processHandle: { hasExited(): boolean; output(): string },
  timeoutMs = 45000,
): Promise<{
  aiMode?: string;
  browser: {
    commandReady: boolean;
    connected: boolean;
    status: string;
  };
}> {
  const sessionPath = path.join(appRoot, '.iwsdk', 'runtime', 'session.json');
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (processHandle.hasExited()) {
      throw new Error(
        `Dev server exited before the managed browser launched:\n${processHandle.output()}`,
      );
    }

    try {
      const session = JSON.parse(await readFile(sessionPath, 'utf8'));
      if (session.browser?.status === 'launch_failed') {
        throw new Error(
          `Managed browser launch failed: ${JSON.stringify(session.browser)}`,
        );
      }
      if (
        session.browser?.status === 'connected' &&
        session.browser?.commandReady === true
      ) {
        return session;
      }
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        error.message.startsWith('Managed browser launch failed:')
      ) {
        throw error;
      }
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for the managed browser: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }\n${processHandle.output()}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEditorMiddleware(root: string): Middleware {
  const middlewares: Middleware[] = [];
  const plugin = iwsdkDev();
  plugin.configResolved?.({
    command: 'serve',
    root,
    server: {},
  } as never);
  plugin.configureServer?.({
    httpServer: { on: vi.fn() },
    middlewares: {
      use: (middleware: Middleware) => {
        middlewares.push(middleware);
      },
    },
  } as never);

  expect(middlewares.length).toBeGreaterThan(0);
  return middlewares[0];
}

function runMiddleware(
  middleware: Middleware,
  method: string,
  url: string,
  body = '',
  headers: Record<string, string> = {},
) {
  return new Promise<{
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }>((resolve, reject) => {
    const request = Readable.from(body ? [body] : []) as Readable & {
      method?: string;
      url?: string;
    };
    request.method = method;
    request.url = url;
    request.headers = headers;
    const response = {
      body: '',
      headers: {} as Record<string, string>,
      statusCode: 0,
      end: (responseBody?: string) => {
        response.body = responseBody ?? '';
        resolve(response);
      },
      setHeader: (name: string, value: string) => {
        response.headers[name] = value;
      },
    };

    try {
      middleware(request, response, () =>
        reject(new Error(`Unexpected next() for ${method} ${url}`)),
      );
    } catch (error) {
      reject(error);
    }
  });
}

function collectPageDiagnostics(page: any, assetIds: string[]) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const badResponses: string[] = [];
  const assetResponses = new Map<string, number[]>(
    assetIds.map((assetId) => [assetId, []]),
  );

  page.on('console', (message: { text(): string; type(): string }) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error: Error) =>
    consoleErrors.push(error.stack ?? error.message),
  );
  page.on('requestfailed', (request: any) => {
    failedRequests.push(
      `${request.method()} ${request.url()} ${
        request.failure()?.errorText ?? 'failed'
      }`,
    );
  });
  page.on('response', (response: any) => {
    const url = response.url();
    if (response.status() >= 400) {
      badResponses.push(`${response.status()} ${url}`);
    }
    for (const assetId of assetIds) {
      if (isExampleAssetRequest(url, assetId)) {
        assetResponses.get(assetId)?.push(response.status());
      }
    }
  });

  return {
    snapshot: () => ({
      assetResponses: Object.fromEntries(assetResponses.entries()),
      badResponses,
      consoleErrors,
      failedRequests,
    }),
  };
}

function filterIgnorableBrowserErrors(errors: string[]): string[] {
  return errors.filter(
    (error) =>
      // Chromium can surface an empty pageerror for a rejected browser API
      // without an Error payload. Keep diagnostics that contain a message.
      error.trim().length > 0 &&
      !error.includes('Outdated Optimize Dep') &&
      !error.includes(
        'Error loading environment living_room from CDN TypeError: Failed to fetch',
      ),
  );
}

function filterIgnorableRequestFailures(
  failures: string[],
  baseUrl: string,
): string[] {
  const managedOrigin = `${new URL(baseUrl).origin}/`;
  return failures.filter(
    (failure) =>
      !failure.includes('/favicon.ico') &&
      !failure.includes('/.well-known/') &&
      // The managed workspace intentionally replaces its runtime iframe with
      // the editor. Chromium reports in-flight module GETs canceled by that
      // navigation as ERR_ABORTED even though the destination is healthy.
      !(
        failure.startsWith(`GET ${managedOrigin}`) &&
        failure.endsWith(' net::ERR_ABORTED')
      ) &&
      !(
        failure.includes('@iwer/sem@') &&
        failure.includes('/captures/living_room.json')
      ),
  );
}

function filterIgnorableBadResponses(responses: string[]): string[] {
  return responses.filter(
    (response) =>
      !response.includes('/favicon.ico') &&
      !response.includes('/.well-known/') &&
      !(
        response.startsWith('504 ') &&
        response.includes('/node_modules/.vite/deps/')
      ) &&
      !response.includes('Outdated Optimize Dep'),
  );
}

function assertAssetResponses(
  assetResponses: Record<string, number[]>,
  assetIds: string[],
) {
  for (const assetId of assetIds) {
    const statuses = assetResponses[assetId] ?? [];
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((status) => status >= 200 && status < 300)).toBe(
      true,
    );
  }
}

async function getPageScreenshotStats(page: any): Promise<{
  sampledPixels: number;
  uniqueColors: number;
}>;
async function getPageScreenshotStats(
  page: any,
  screenshotPath?: string,
): Promise<{
  sampledPixels: number;
  uniqueColors: number;
}> {
  const screenshot = await page.screenshot({
    path: screenshotPath,
    type: 'png',
  });
  return page.evaluate(async (base64: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context == null) {
      return { sampledPixels: 0, uniqueColors: 0 };
    }

    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set<string>();
    const step = Math.max(4, Math.floor(data.length / 4000));
    let sampledPixels = 0;
    for (let index = 0; index < data.length; index += step - (step % 4)) {
      colors.add(
        `${data[index]},${data[index + 1]},${data[index + 2]},${
          data[index + 3]
        }`,
      );
      sampledPixels += 1;
      if (colors.size >= 32) {
        break;
      }
    }

    return { sampledPixels, uniqueColors: colors.size };
  }, screenshot.toString('base64'));
}

async function waitForNonblankScreenshot(
  page: any,
  screenshotPath?: string,
  { minUniqueColors = 9, timeoutMs = 30000 } = {},
): Promise<{ sampledPixels: number; uniqueColors: number }> {
  const deadline = Date.now() + timeoutMs;
  let stats = await getPageScreenshotStats(page, screenshotPath);
  while (stats.uniqueColors < minUniqueColors && Date.now() < deadline) {
    await page.waitForTimeout(250);
    stats = await getPageScreenshotStats(page, screenshotPath);
  }
  return stats;
}

async function installManagedWorkspaceRoute(
  page: any,
  baseUrl: string,
): Promise<void> {
  const managedOrigin = new URL(baseUrl).origin;
  await page.route(`${managedOrigin}/**`, async (route: any) => {
    const request = route.request();
    await route.continue({
      headers: {
        ...request.headers(),
        ...MANAGED_WORKSPACE_HEADERS,
      },
    });
  });
}

async function dispatchRuntime(
  page: any,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate(
    ({ method: runtimeMethod, params: runtimeParams }) =>
      (window as any).FRAMEWORK_MCP_RUNTIME.dispatch(
        runtimeMethod,
        runtimeParams,
      ),
    { method, params },
  );
}

async function getRuntimeComponentSummary(
  page: any,
  componentIds: string[],
): Promise<Record<string, { total: number }>> {
  const summary: Record<string, { total: number }> = {};
  for (const componentId of componentIds) {
    const result = (await dispatchRuntime(page, 'ecs_find_entities', {
      limit: 50,
      withComponents: [componentId],
    })) as { total?: number };
    summary[componentId] = { total: result.total ?? 0 };
  }
  return summary;
}

async function waitForRuntimeComponentCount(
  page: any,
  componentId: string,
): Promise<number> {
  let lastCount = 0;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const summary = await getRuntimeComponentSummary(page, [componentId]);
    lastCount = summary[componentId]?.total ?? 0;
    if (lastCount > 0) {
      return lastCount;
    }
    await sleep(250);
  }
  return lastCount;
}

function getSceneAssetIds(scene: { nodes?: unknown[] }): string[] {
  return Array.from(
    new Set(
      flattenSceneNodes(scene.nodes ?? [])
        .map((node) =>
          typeof node?.content === 'object' &&
          node.content != null &&
          node.content.type === 'asset' &&
          typeof node.content.asset === 'string'
            ? node.content.asset
            : undefined,
        )
        .filter((assetId): assetId is string => assetId != null),
    ),
  ).sort();
}

function getSceneComponentIds(scene: { nodes?: unknown[] }): string[] {
  return Array.from(
    new Set(
      flattenSceneNodes(scene.nodes ?? []).flatMap((node) =>
        typeof node === 'object' &&
        node != null &&
        'components' in node &&
        typeof node.components === 'object' &&
        node.components != null &&
        !Array.isArray(node.components)
          ? Object.keys(node.components).map(stripComponentPrefix)
          : [],
      ),
    ),
  ).sort();
}

function flattenSceneNodes(nodes: unknown[]): any[] {
  return nodes.flatMap((node) =>
    typeof node === 'object' && node != null && !Array.isArray(node)
      ? [
          node,
          ...flattenSceneNodes(
            Array.isArray((node as { children?: unknown }).children)
              ? ((node as { children: unknown[] }).children ?? [])
              : [],
          ),
        ]
      : [],
  );
}

function stripComponentPrefix(componentName: string): string {
  return componentName.startsWith('com.iwsdk.components.')
    ? componentName.slice('com.iwsdk.components.'.length)
    : componentName;
}

async function launchChromium() {
  return chromium.launch({
    args: [
      '--enable-webgl',
      '--ignore-certificate-errors',
      '--use-angle=metal',
    ],
    channel: 'chromium',
    headless: true,
  });
}
