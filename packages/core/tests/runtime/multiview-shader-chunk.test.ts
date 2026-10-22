/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { REVISION, ShaderChunk } from '../../src/runtime/index.js';

describe('super-three multiview shader compatibility', () => {
  it('keeps viewMatrix out of shader function parameter lists', () => {
    // Multiview #defines viewMatrix as viewMatrices[VIEW_ID], which is not a
    // valid parameter declaration.
    expect(ShaderChunk.common).not.toMatch(/in mat4 viewMatrix\s*\)/);
  });

  it('still defines the r185 inverse-view helpers', () => {
    if (Number(REVISION) < 185) {
      return;
    }
    expect(ShaderChunk.common).toContain(
      'vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 inverseView )',
    );
    expect(ShaderChunk.common).toContain(
      'vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 inverseView )',
    );
    expect(ShaderChunk.common).toMatch(/\* inverseView \)\.xyz/);
  });
});
