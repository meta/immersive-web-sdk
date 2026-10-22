/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, test } from 'vitest';
import { findUnsupportedThreeDeclarations } from '../../../scripts/check-three-version.mjs';

const expectedInstallSpec = 'npm:super-three@0.185.0';

describe('published Three.js declarations', () => {
  test('rejects an unrecorded floating peer dependency', () => {
    expect(
      findUnsupportedThreeDeclarations(
        {
          name: '@iwsdk/example',
          peerDependencies: { three: '>=0.160.0' },
        },
        expectedInstallSpec,
      ),
    ).toEqual([{ dependencyType: 'peerDependencies', version: '>=0.160.0' }]);
  });

  test('accepts exact dependencies and the two intentional peer ranges', () => {
    expect(
      findUnsupportedThreeDeclarations(
        {
          name: '@iwsdk/core',
          dependencies: { three: expectedInstallSpec },
        },
        expectedInstallSpec,
      ),
    ).toEqual([]);
    for (const name of ['@iwsdk/locomotor', '@iwsdk/xr-input']) {
      expect(
        findUnsupportedThreeDeclarations(
          { name, peerDependencies: { three: '>=0.160.0' } },
          expectedInstallSpec,
        ),
      ).toEqual([]);
    }
  });

  test('rejects drift in an allowlisted peer or any dev dependency', () => {
    expect(
      findUnsupportedThreeDeclarations(
        {
          name: '@iwsdk/xr-input',
          peerDependencies: { three: '>=0.170.0' },
        },
        expectedInstallSpec,
      ),
    ).toEqual([{ dependencyType: 'peerDependencies', version: '>=0.170.0' }]);
    expect(
      findUnsupportedThreeDeclarations(
        {
          name: '@iwsdk/example',
          devDependencies: { three: '^0.181.0' },
        },
        expectedInstallSpec,
      ),
    ).toEqual([{ dependencyType: 'devDependencies', version: '^0.181.0' }]);
  });
});
