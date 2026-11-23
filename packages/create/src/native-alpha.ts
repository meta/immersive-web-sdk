/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ExperienceTarget } from './types.js';

/**
 * Alpha: `--metavr-native` (or IWSDK_CREATE_METAVR_NATIVE=1) adds the native
 * Quest build to a new VR or AR project. `npm run build:metavr` builds with Vite in
 * the `metavr` mode (the dev plugin then leaves the IWER emulator out) and packs
 * dist/ into dist-metavr/<appName>.apk with @iwer/native, which runs the app
 * without a browser. Off by default while @iwer/native is an alpha.
 */
export const NATIVE_ALPHA_FLAG = '--metavr-native';
export const NATIVE_ALPHA_ENV = 'IWSDK_CREATE_METAVR_NATIVE';

/** Pinned exactly: experimental releases may change commands and config keys. */
export const IWER_NATIVE_ALPHA_VERSION = '2.9.0';

export const BUILD_METAVR_SCRIPT =
  'vite build --mode metavr && iwer-native pack';

export const NATIVE_ALPHA_GITIGNORE =
  '\n# Native Quest builds (npm run build:metavr)\ndist-metavr/\n';

export function nativeAlphaRequested(
  args: readonly string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    args.includes(NATIVE_ALPHA_FLAG) ||
    env[NATIVE_ALPHA_ENV] === '1' ||
    env[NATIVE_ALPHA_ENV] === 'true'
  );
}

/**
 * The native runtime runs immersive sessions only: immersive-vr, and
 * immersive-ar over passthrough, which pack declares from world.xr.mode "ar".
 * It has no 2D page, so the Desktop 3D starting point cannot be packed.
 */
export function validateNativeAlphaTarget(target: ExperienceTarget): void {
  if (target !== 'vr' && target !== 'ar') {
    throw new Error(
      `${NATIVE_ALPHA_FLAG} is available for --target vr or ar only (the @iwer/native alpha runs immersive sessions, with no 2D page; got ${target}).`,
    );
  }
}

// aapt2 rejects package segments that are Java keywords or literals.
const JAVA_KEYWORDS = new Set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _'.split(
    ' ',
  ),
);

/** Android application id from the project name: com.example.<name>, which the packer flags as a placeholder. */
export function nativePackageId(appName: string): string {
  let segment = appName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(segment)) {
    segment = `app${segment ? `_${segment}` : ''}`;
  }
  if (JAVA_KEYWORDS.has(segment)) {
    segment = `${segment}_app`;
  }
  return `com.example.${segment}`;
}

/**
 * Origins the starter fetches from at run time. The native runtime refuses
 * every origin outside native.network.allow; the starter loads its controller
 * models from the WebXR input profiles on jsDelivr (@iwsdk/xr-input
 * DEFAULT_PROFILES_PATH), so without this entry controllers have no model.
 */
export const NATIVE_ALPHA_NETWORK_ALLOW: readonly string[] = [
  'https://cdn.jsdelivr.net',
];

/** The `native` section of iwsdk.config.json (validated by @iwer/native). */
export function createNativeTargetSection(appName: string): {
  packageId: string;
  appName: string;
  network: { allow: string[] };
} {
  return {
    packageId: nativePackageId(appName),
    appName: appName.replace(/^@[^/]+\//, ''),
    network: { allow: [...NATIVE_ALPHA_NETWORK_ALLOW] },
  };
}
