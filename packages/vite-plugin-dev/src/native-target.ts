/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { IwsdkProjectManifestV1 } from '@iwsdk/core/project';

/**
 * Vite mode of a native (metavr) build: `vite build --mode metavr`, which the
 * `build:metavr` script of projects created with `--metavr-native` runs before
 * `iwer-native pack`. Alpha: the @iwer/native runtime is an opt-in preview.
 */
export const METAVR_BUILD_MODE = 'metavr';

/** Environment switch for wrappers that cannot pass a Vite mode (`iwsdk build --target metavr`). */
export const BUILD_TARGET_ENV = 'IWSDK_BUILD_TARGET';

/**
 * True for a production build that @iwer/native packs into an APK. Such a build
 * must not carry the IWER emulator: the native runtime provides WebXR itself
 * (IWER host mode), and an injected emulator would take over navigator.xr.
 * `dev.emulator.injectOnBuild` keeps applying to browser builds.
 */
export function isNativeTargetBuild(
  command: 'serve' | 'build',
  mode: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (command !== 'build') {
    return false;
  }
  return mode === METAVR_BUILD_MODE || env[BUILD_TARGET_ENV] === 'metavr';
}

/**
 * The manifest as the browser bundle sees it. The `native` section configures
 * packaging (package id, signing keystore path, env-var names) and is read by
 * @iwer/native at pack time, so it stays out of the shipped JavaScript.
 */
export function runtimeProjectManifest(
  manifest: IwsdkProjectManifestV1,
): IwsdkProjectManifestV1 {
  if (!('native' in manifest)) {
    return manifest;
  }
  const { native: _native, ...runtime } = manifest;
  return runtime;
}
