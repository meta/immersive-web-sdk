/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Object3D, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { MultiPointer } from '../src/pointer/multi-pointer.js';

/** The candidates a hand's touch pointer intersects. */
function touchCandidates(
  handedness: 'left' | 'right',
  scene: Scene & Record<string, unknown>,
): Object3D[] | undefined {
  // Only the selection logic is under test; a full MultiPointer needs a DOM.
  return (MultiPointer.prototype as any).touchCandidates.call({
    handedness,
    sceneWithDescendants: scene,
  });
}

describe('MultiPointer touch candidates (#62)', () => {
  it("pokes only the objects listed for the pointer's hand", () => {
    const shared = new Object3D();
    const leftOnly = new Object3D();
    const rightOnly = new Object3D();
    const scene = new Scene() as Scene & Record<string, unknown>;
    scene.touchDescendants = [shared, leftOnly, rightOnly];
    scene.touchDescendantsByHand = {
      left: [shared, leftOnly],
      right: [shared, rightOnly],
    };

    expect(touchCandidates('left', scene)).toEqual([shared, leftOnly]);
    expect(touchCandidates('right', scene)).toEqual([shared, rightOnly]);
  });

  it('falls back to the shared list when the scene has no per-hand lists', () => {
    const target = new Object3D();
    const scene = new Scene() as Scene & Record<string, unknown>;
    scene.touchDescendants = [target];

    expect(touchCandidates('left', scene)).toEqual([target]);
    expect(touchCandidates('right', scene)).toEqual([target]);
  });
});
