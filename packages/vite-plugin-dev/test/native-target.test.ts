/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { IwsdkProjectManifestV1 } from '@iwsdk/core/project';
import { describe, expect, it } from 'vitest';
import {
  BUILD_TARGET_ENV,
  METAVR_BUILD_MODE,
  isNativeTargetBuild,
  runtimeProjectManifest,
} from '../src/native-target.js';

const manifest = {
  version: 'iwsdk.project.v1',
  scene: './public/scenes/main.iwsdk.scene.json',
  world: { xr: { mode: 'vr', offer: 'always' } },
  dev: { emulator: { injectOnBuild: true } },
} as IwsdkProjectManifestV1;

describe('native (metavr) build target', () => {
  it('recognises `vite build --mode metavr` and IWSDK_BUILD_TARGET=metavr builds only', () => {
    expect(METAVR_BUILD_MODE).toBe('metavr');
    expect(isNativeTargetBuild('build', 'metavr', {})).toBe(true);
    expect(isNativeTargetBuild('build', 'production', {})).toBe(false);
    expect(
      isNativeTargetBuild('build', 'production', {
        [BUILD_TARGET_ENV]: 'metavr',
      }),
    ).toBe(true);
    expect(
      isNativeTargetBuild('build', 'production', {
        [BUILD_TARGET_ENV]: 'browser',
      }),
    ).toBe(false);
    // dev servers keep their emulator/workspace bridge
    expect(isNativeTargetBuild('serve', 'metavr', {})).toBe(false);
    expect(
      isNativeTargetBuild('serve', 'development', {
        [BUILD_TARGET_ENV]: 'metavr',
      }),
    ).toBe(false);
  });

  it('keeps the native section out of the browser bundle manifest', () => {
    const withNative = {
      ...manifest,
      native: {
        packageId: 'com.example.app',
        signing: { keystore: '../keys/release.jks', storePasswordEnv: 'PW' },
      },
    } as IwsdkProjectManifestV1;
    const runtime = runtimeProjectManifest(withNative);
    expect(runtime).not.toHaveProperty('native');
    expect(runtime).toEqual(manifest);
    expect(JSON.stringify(runtime)).not.toContain('release.jks');
    // manifests without the section are passed through untouched
    expect(runtimeProjectManifest(manifest)).toBe(manifest);
  });
});
