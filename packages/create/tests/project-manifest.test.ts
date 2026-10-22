/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  normalizeProjectWorldOptions,
  validateIwsdkProjectManifest,
} from '@iwsdk/core/project';
import { describe, expect, it } from 'vitest';
import { getRecommendedConfiguration } from '../src/catalog.js';
import { createProjectManifest } from '../src/project-manifest.js';

describe('starter project manifest', () => {
  it.each(['vr', 'ar', 'browser'] as const)(
    'builds a valid %s authority that normalizes to ordinary WorldOptions',
    (target) => {
      const manifest = createProjectManifest(
        getRecommendedConfiguration(target),
      );

      expect(validateIwsdkProjectManifest(manifest)).toEqual({
        valid: true,
        issues: [],
      });
      expect(normalizeProjectWorldOptions(manifest)).toMatchObject({
        level: './scenes/main.iwsdk.scene.json',
        xr:
          target === 'browser'
            ? false
            : {
                sessionMode: target === 'ar' ? 'immersive-ar' : 'immersive-vr',
              },
      });
      expect(manifest.assets).toEqual({ module: './src/assets' });
      expect(manifest.components).toEqual({ module: './src/components' });
      expect(manifest.dev?.emulator?.iwer).toBeUndefined();
      expect(manifest.world.render?.fov).toBe(70);
      expect(manifest.world.render?.camera).toEqual(
        target === 'browser'
          ? { position: [0, 1.6, 0], lookAt: [0, 0.95, -2.95] }
          : { position: [0, 1.6, 1], lookAt: [0, 0.95, -1.95] },
      );
      expect(
        typeof manifest.world.features?.locomotion === 'object'
          ? manifest.world.features.locomotion.initialPlayerPosition
          : undefined,
      ).toEqual(target === 'browser' ? [0, 0, 1] : undefined);
    },
  );

  it('places target choices in data without serializing systems', () => {
    const manifest = createProjectManifest(getRecommendedConfiguration('ar'));
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain('registerSystem');
    expect(serialized).not.toContain('workspace');
    expect(serialized).not.toContain('assets.include');
    expect(serialized).not.toContain('"iwer"');
    expect(manifest.dev?.emulator?.environment).toBe('sunlit_living_room');
  });
});
