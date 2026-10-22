/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn as mockedSpawn } from 'cross-spawn';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import {
  configureDependenciesFromBundle,
  installDependenciesFromBundle,
  printNextSteps,
  warmupReference,
} from '../src/installer.js';
import type { ResolvedSource } from '../src/source.js';

// Mock cross-spawn before importing installer
vi.mock('cross-spawn', () => {
  const { EventEmitter } = require('events');
  let nextExitCode = 0;
  return {
    default: vi.fn(() => {
      const child = new EventEmitter();
      // Emit exit on next tick so the promise handler is attached first
      process.nextTick(() => child.emit('exit', nextExitCode));
      return child;
    }),
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      child.kill = vi.fn();
      process.nextTick(() => child.emit('exit', nextExitCode));
      return child;
    }),
    __setExitCode: (code: number) => {
      nextExitCode = code;
    },
  };
});

/** Create a fake ResolvedSource that maps known packages to file: paths */
function makeFakeSource(packageMap: Record<string, string>): ResolvedSource {
  return {
    isBundleMode: true,
    prepare: async () => {},
    getPackageInstallSpec: (name: string) => packageMap[name],
    getPackageInstallSpecs: () => packageMap,
    downloadPackages: async () => {},
    cleanup: async () => {},
  };
}

async function readPnpmWorkspace(tmpDir: string) {
  return parse(
    await fsp.readFile(path.join(tmpDir, 'pnpm-workspace.yaml'), 'utf-8'),
  );
}
describe('installDependenciesFromBundle', () => {
  let tmpDir: string;
  let pkgPath: string;

  const originalPkg = {
    name: 'test-app',
    dependencies: {
      '@iwsdk/core': '^0.1.0',
      '@iwsdk/locomotor': '^0.1.0',
      three: '^0.165.0',
      vite: '^5.0.0',
    },
    devDependencies: {
      '@iwsdk/cli': '^0.1.0',
      '@iwsdk/vite-plugin-dev': '^0.1.0',
      vitest: '^2.0.0',
    },
  };

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'installer-test-'));
    pkgPath = path.join(tmpDir, 'package.json');
    await fsp.writeFile(pkgPath, JSON.stringify(originalPkg, null, 2) + '\n');

    // Reset exit code to success
    const mock = await import('cross-spawn');
    (mock as any).__setExitCode(0);
    vi.mocked(mockedSpawn).mockClear();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('rewrites @iwsdk/* deps in both dependencies and devDependencies to file: paths', async () => {
    const source = makeFakeSource({
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
      '@iwsdk/locomotor': 'file:.sdk-packages/locomotor/iwsdk-locomotor.tgz',
      '@iwsdk/cli': 'file:.sdk-packages/cli/iwsdk-cli.tgz',
      '@iwsdk/vite-plugin-dev':
        'file:.sdk-packages/vite-plugin-dev/iwsdk-vite-plugin-dev.tgz',
    });

    await installDependenciesFromBundle(tmpDir, source);

    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    expect(pkg.dependencies['@iwsdk/core']).toBe(
      'file:.sdk-packages/core/iwsdk-core.tgz',
    );
    expect(pkg.dependencies['@iwsdk/locomotor']).toBe(
      'file:.sdk-packages/locomotor/iwsdk-locomotor.tgz',
    );
    expect(pkg.devDependencies['@iwsdk/cli']).toBe(
      'file:.sdk-packages/cli/iwsdk-cli.tgz',
    );
    expect(pkg.devDependencies['@iwsdk/vite-plugin-dev']).toBe(
      'file:.sdk-packages/vite-plugin-dev/iwsdk-vite-plugin-dev.tgz',
    );
  });

  it('can persist bundle paths without starting an install', async () => {
    const source = makeFakeSource({
      '@iwsdk/cli': 'file:.sdk-packages/cli/iwsdk-cli.tgz',
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
      '@iwsdk/scene-composition':
        'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
    });

    configureDependenciesFromBundle(tmpDir, source);

    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    expect(pkg.dependencies['@iwsdk/core']).toBe(
      'file:.sdk-packages/core/iwsdk-core.tgz',
    );
    expect((await readPnpmWorkspace(tmpDir)).overrides).toMatchObject({
      '@iwsdk/cli': 'file:.sdk-packages/cli/iwsdk-cli.tgz',
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
      '@iwsdk/scene-composition':
        'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('adds pnpm overrides when every bundled package is a direct dependency', async () => {
    const directPackageSpecs = {
      '@iwsdk/cli': 'file:.sdk-packages/cli/iwsdk-cli.tgz',
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
      '@iwsdk/locomotor': 'file:.sdk-packages/locomotor/iwsdk-locomotor.tgz',
      '@iwsdk/vite-plugin-dev':
        'file:.sdk-packages/vite-plugin-dev/iwsdk-vite-plugin-dev.tgz',
    };
    configureDependenciesFromBundle(tmpDir, makeFakeSource(directPackageSpecs));

    expect((await readPnpmWorkspace(tmpDir)).overrides).toMatchObject(
      directPackageSpecs,
    );
  });

  it('preserves existing workspace configuration and deterministically merges quoted bundle overrides', async () => {
    const existingPnpmWorkspace = {
      packages: ['legacy/*'],
      overrides: { custom: '1.0.0', sharp: '0.1.0' },
      supportedArchitectures: { os: ['current'] },
    };
    await fsp.writeFile(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      stringify(existingPnpmWorkspace),
    );
    const bundlePackageSpecs = {
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
      '@iwsdk/scene-composition':
        'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
    };
    configureDependenciesFromBundle(tmpDir, makeFakeSource(bundlePackageSpecs));
    const firstBytes = await fsp.readFile(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      'utf-8',
    );
    const pnpmWorkspace = parse(firstBytes);
    expect(pnpmWorkspace).toMatchObject({
      packages: ['.'],
      overrides: {
        custom: '1.0.0',
        sharp: '0.35.4',
        three: 'npm:super-three@0.185.0',
        ...bundlePackageSpecs,
      },
      onlyBuiltDependencies: ['esbuild', 'protobufjs', 'sharp'],
      ignoredBuiltDependencies: ['@meta-quest/metavr', 'onnxruntime-node'],
      allowBuilds: {
        esbuild: true,
        protobufjs: true,
        sharp: true,
        '@meta-quest/metavr': false,
        'onnxruntime-node': false,
      },
      supportedArchitectures: { os: ['current'] },
    });
    expect(firstBytes).toContain('"@iwsdk/core":');
    configureDependenciesFromBundle(tmpDir, makeFakeSource(bundlePackageSpecs));
    expect(
      await fsp.readFile(path.join(tmpDir, 'pnpm-workspace.yaml'), 'utf-8'),
    ).toBe(firstBytes);
  });

  it('leaves non-@iwsdk/* deps untouched', async () => {
    const source = makeFakeSource({
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
      '@iwsdk/locomotor': 'file:.sdk-packages/locomotor/iwsdk-locomotor.tgz',
      '@iwsdk/cli': 'file:.sdk-packages/cli/iwsdk-cli.tgz',
      '@iwsdk/vite-plugin-dev':
        'file:.sdk-packages/vite-plugin-dev/iwsdk-vite-plugin-dev.tgz',
    });

    await installDependenciesFromBundle(tmpDir, source);

    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    expect(pkg.dependencies['three']).toBe('^0.165.0');
    expect(pkg.dependencies['vite']).toBe('^5.0.0');
    expect(pkg.devDependencies['vitest']).toBe('^2.0.0');
  });

  it('does NOT restore original package.json — file: paths remain permanently', async () => {
    const source = makeFakeSource({
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
    });

    await installDependenciesFromBundle(tmpDir, source);

    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    // file: path should still be there after install
    expect(pkg.dependencies['@iwsdk/core']).toBe(
      'file:.sdk-packages/core/iwsdk-core.tgz',
    );
  });

  it('adds bundle overrides for transitive @iwsdk/* packages without conflicting with direct deps', async () => {
    const source = makeFakeSource({
      '@iwsdk/cli': 'file:.sdk-packages/cli/iwsdk-cli.tgz',
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
      '@iwsdk/scene-composition':
        'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
      '@iwsdk/vite-plugin-dev':
        'file:.sdk-packages/vite-plugin-dev/iwsdk-vite-plugin-dev.tgz',
    });

    await installDependenciesFromBundle(tmpDir, source);

    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    expect(pkg.dependencies['@iwsdk/core']).toBe(
      'file:.sdk-packages/core/iwsdk-core.tgz',
    );
    expect(pkg.devDependencies['@iwsdk/cli']).toBe(
      'file:.sdk-packages/cli/iwsdk-cli.tgz',
    );
    expect(pkg.overrides).toMatchObject({
      '@iwsdk/scene-composition':
        'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
    });
    expect((await readPnpmWorkspace(tmpDir)).overrides).toMatchObject({
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
      '@iwsdk/scene-composition':
        'file:.sdk-packages/scene-composition/iwsdk-scene-composition.tgz',
    });
    expect(pkg.overrides).not.toHaveProperty('@iwsdk/cli');
    expect(pkg.overrides).not.toHaveProperty('@iwsdk/core');
    expect((await readPnpmWorkspace(tmpDir)).overrides['@iwsdk/cli']).toBe(
      'file:.sdk-packages/cli/iwsdk-cli.tgz',
    );
  });

  it('does NOT restore package.json after install failure', async () => {
    const mock = await import('cross-spawn');
    (mock as any).__setExitCode(1);

    const source = makeFakeSource({
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
    });

    await expect(installDependenciesFromBundle(tmpDir, source)).rejects.toThrow(
      'Install failed',
    );

    // file: path should still be in package.json (no restore)
    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    expect(pkg.dependencies['@iwsdk/core']).toBe(
      'file:.sdk-packages/core/iwsdk-core.tgz',
    );
  });

  it('skips @iwsdk/* deps when source returns undefined', async () => {
    // Source only knows about core, not locomotor or devDeps
    const source = makeFakeSource({
      '@iwsdk/core': 'file:.sdk-packages/core/iwsdk-core.tgz',
    });

    await installDependenciesFromBundle(tmpDir, source);

    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    expect(pkg.dependencies['@iwsdk/core']).toBe(
      'file:.sdk-packages/core/iwsdk-core.tgz',
    );
    // locomotor should remain unchanged since source doesn't know it
    expect(pkg.dependencies['@iwsdk/locomotor']).toBe('^0.1.0');
    // devDeps should also remain unchanged
    expect(pkg.devDependencies['@iwsdk/cli']).toBe('^0.1.0');
    expect(pkg.devDependencies['@iwsdk/vite-plugin-dev']).toBe('^0.1.0');
  });
});

describe('warmupReference', () => {
  it('runs the installed IWSDK reference warmup as part of creation', async () => {
    await expect(warmupReference('/tmp/generated-iwsdk-app')).resolves.toBe(
      true,
    );
    expect(mockedSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '/tmp/generated-iwsdk-app/node_modules/@iwsdk/cli/dist/cli.js',
        'reference',
        'warmup',
      ],
      {
        cwd: '/tmp/generated-iwsdk-app',
        stdio: 'inherit',
      },
    );
  });

  it('does not fail project creation when reference warmup fails', async () => {
    const mock = await import('cross-spawn');
    (mock as any).__setExitCode(1);

    await expect(warmupReference('/tmp/generated-iwsdk-app')).resolves.toBe(
      false,
    );
  });

  it('terminates a reference warmup that exceeds its time limit', async () => {
    const { EventEmitter } = await import('events');
    const child = new EventEmitter() as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn();
    vi.mocked(mockedSpawn).mockReturnValueOnce(child as any);

    await expect(warmupReference('/tmp/generated-iwsdk-app', 1)).resolves.toBe(
      false,
    );
    expect(child.kill).toHaveBeenCalledOnce();
  });
});

describe('printNextSteps', () => {
  it('links generated projects to the IWER controls', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    printNextSteps('example-app', true, [], false, true, true);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls',
      ),
    );
    log.mockRestore();
  });

  it('prints the metavr notice before the next steps', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    printNextSteps('example-app', true, [], false, true, true);

    const lines = log.mock.calls.map(([line]) => String(line));
    const noticeIndex = lines.indexOf('\nAbout metavr CLI:');
    expect(noticeIndex).toBeGreaterThanOrEqual(0);
    expect(noticeIndex).toBeLessThan(lines.indexOf('\nNext steps:'));
    expect(lines.join('\n')).toContain(
      'https://developers.meta.com/horizon/licenses/oculussdk/',
    );
    expect(lines.join('\n')).toContain('npm uninstall @meta-quest/metavr');
    log.mockRestore();
  });

  it('does not show IWER controls for browser-first projects', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    printNextSteps('example-app', true, [], false, true, false);

    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining('IWER controls:'),
    );
    log.mockRestore();
  });
});
