/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIwsdkProjectManifest } from '@iwsdk/core/project';
import { describe, expect, it } from 'vitest';
import { getRecommendedConfiguration } from '../src/catalog.js';
import {
  BUILD_METAVR_SCRIPT,
  IWER_NATIVE_ALPHA_VERSION,
  NATIVE_ALPHA_NETWORK_ALLOW,
  nativeAlphaRequested,
  nativePackageId,
  validateNativeAlphaTarget,
} from '../src/native-alpha.js';
import { buildStarterProjectFiles } from '../src/project-files.js';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const TEMPLATE_ROOT = path.join(PACKAGE_ROOT, 'dist', 'template');
const npmSource = { getPackageInstallSpec: () => undefined };

async function files(nativeAlpha: boolean | undefined, appName = 'quest-app') {
  return buildStarterProjectFiles({
    appName,
    configuration: { ...getRecommendedConfiguration('vr'), nativeAlpha },
    language: 'ts',
    packageSource: npmSource,
    templateRoot: TEMPLATE_ROOT,
  });
}

function text(
  generated: Awaited<ReturnType<typeof buildStarterProjectFiles>>,
  filePath: string,
): string {
  const file = generated.find((candidate) => candidate.path === filePath);
  if (file == null) {
    throw new Error(`Missing generated file ${filePath}`);
  }
  return typeof file.contents === 'string'
    ? file.contents
    : Buffer.from(file.contents).toString('utf8');
}

describe('--metavr-native (alpha)', () => {
  it('is off by default: no build:metavr, no @iwer/native, no native section', async () => {
    for (const flag of [undefined, false]) {
      const generated = await files(flag);
      const pkg = JSON.parse(text(generated, 'package.json'));
      expect(pkg.scripts).not.toHaveProperty('build:metavr');
      expect(pkg.devDependencies).not.toHaveProperty('@iwer/native');
      expect(
        JSON.parse(text(generated, 'iwsdk.config.json')),
      ).not.toHaveProperty('native');
      expect(text(generated, '.gitignore')).not.toContain('dist-metavr');
    }
  });

  it('adds the build script, the pinned alpha package, a valid native section and the ignore entry', async () => {
    const generated = await files(true);
    const pkg = JSON.parse(text(generated, 'package.json'));
    expect(pkg.scripts['build:metavr']).toBe(BUILD_METAVR_SCRIPT);
    expect(pkg.scripts['build:metavr']).toBe(
      'vite build --mode metavr && iwer-native pack',
    );
    expect(pkg.scripts.build).toBe('vite build');
    expect(pkg.devDependencies['@iwer/native']).toBe(IWER_NATIVE_ALPHA_VERSION);
    expect(IWER_NATIVE_ALPHA_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);

    const manifest = JSON.parse(text(generated, 'iwsdk.config.json'));
    expect(manifest.native).toEqual({
      packageId: 'com.example.quest_app',
      appName: 'quest-app',
      network: { allow: ['https://cdn.jsdelivr.net'] },
    });
    // the starter's controller models come from that origin (@iwsdk/xr-input DEFAULT_PROFILES_PATH)
    const profiles = readFileSync(
      path.join(
        PACKAGE_ROOT,
        '..',
        'xr-input',
        'src',
        'gamepad',
        'input-profiles.ts',
      ),
      'utf8',
    );
    const profilesPath = /DEFAULT_PROFILES_PATH\s*=\s*'([^']+)'/u.exec(
      profiles,
    )?.[1];
    expect(profilesPath?.startsWith(`${NATIVE_ALPHA_NETWORK_ALLOW[0]}/`)).toBe(
      true,
    );
    // IWSDK accepts the section (its keys belong to @iwer/native)
    expect(validateIwsdkProjectManifest(manifest)).toEqual({
      valid: true,
      issues: [],
    });
    // the emulator settings are untouched: the metavr mode turns injection off
    expect(manifest.dev.emulator).toEqual({ device: 'metaQuest3' });
    expect(manifest.world.xr.offer).toBe('always');

    const gitignore = text(generated, '.gitignore');
    expect(gitignore).toContain('\ndist-metavr/\n');
    expect(gitignore).toContain('dist/');
  });

  it('derives Android-valid package ids', () => {
    expect(nativePackageId('quest-app')).toBe('com.example.quest_app');
    expect(nativePackageId('@scope/My App!')).toBe('com.example.my_app');
    expect(nativePackageId('3d-demo')).toBe('com.example.app_3d_demo');
    expect(nativePackageId('---')).toBe('com.example.app');
    expect(nativePackageId('new')).toBe('com.example.new_app');
    for (const name of [
      'quest-app',
      '@scope/My App!',
      '3d-demo',
      'new',
      'ÄÖ',
    ]) {
      expect(nativePackageId(name)).toMatch(/^com\.example\.[a-z][a-z0-9_]*$/u);
    }
  });

  it('is requested by flag or environment, and only for VR', () => {
    expect(nativeAlphaRequested(['my-app', '--metavr-native'], {})).toBe(true);
    expect(nativeAlphaRequested(['my-app'], {})).toBe(false);
    expect(
      nativeAlphaRequested(['my-app'], { IWSDK_CREATE_METAVR_NATIVE: '1' }),
    ).toBe(true);
    expect(
      nativeAlphaRequested(['my-app'], { IWSDK_CREATE_METAVR_NATIVE: '0' }),
    ).toBe(false);
    expect(() => validateNativeAlphaTarget('vr')).not.toThrow();
    expect(() => validateNativeAlphaTarget('ar')).not.toThrow();
    expect(() => validateNativeAlphaTarget('browser')).toThrow(
      /--target vr or ar only/u,
    );
  });
});
