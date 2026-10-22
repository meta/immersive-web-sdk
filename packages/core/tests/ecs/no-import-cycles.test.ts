/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { AudioSystem } from '../../src/audio/audio-system.js';
import { AudioSource } from '../../src/audio/audio.js';
import { EnvironmentSystem } from '../../src/environment/environment-system.js';
import {
  DomeFade,
  DomeGradient,
  DomeTexture,
  IBLGradient,
  IBLTexture,
} from '../../src/environment/index.js';
import { InputSystem } from '../../src/input/input-system.js';
import {
  PokeInteractable,
  RayInteractable,
} from '../../src/input/state-tags.js';
import { LevelRoot } from '../../src/level/level-root.js';
import { LevelSystem } from '../../src/level/level-system.js';
import { LevelTag } from '../../src/level/level-tag.js';
import { Transform } from '../../src/transform/transform.js';
import { TransformSystem } from '../../src/transform/transform.js';

// Regression guard for module-cycle TDZ bugs.
//
// System classes capture their `required:` component references at class-body
// evaluation time via `createSystem({queries: {required: [X]}})`. If the
// bundler emits the System class before the Component declaration — which
// happens whenever a value-level import cycle exists in the dependency graph
// of either `ecs/world.js` or `init/world-initializer.js` — `X` is `undefined`
// and the query metadata holds `[undefined]`. The crash only surfaces later
// at QueryManager.registerQuery with
// `Cannot read properties of undefined (reading 'bitmask')`.
describe('module load order — System.queries must capture defined components', () => {
  it('AudioSystem.queries.audioEntities.required[0] is AudioSource', () => {
    expect(AudioSource).toBeDefined();
    const required = (AudioSystem as any).queries?.audioEntities?.required;
    expect(required?.[0]).toBe(AudioSource);
  });

  // Coverage for the broader cycle: ecs/world.ts → level/transform barrels →
  // ecs/index.js → ecs/world.ts. Every core system registered in
  // `registerCoreSystems` / `createWorldInstance` must have its query refs
  // defined at class-body evaluation time. Any one of these going undefined
  // would crash QueryManager.registerQuery the same way AudioSource did.
  const cases: Array<[string, any, string, any[]]> = [
    [
      'EnvironmentSystem',
      EnvironmentSystem,
      'domeTextures',
      [DomeTexture, LevelRoot],
    ],
    [
      'EnvironmentSystem',
      EnvironmentSystem,
      'domeGradients',
      [DomeGradient, LevelRoot],
    ],
    [
      'EnvironmentSystem',
      EnvironmentSystem,
      'iblTextures',
      [IBLTexture, LevelRoot],
    ],
    [
      'EnvironmentSystem',
      EnvironmentSystem,
      'iblGradients',
      [IBLGradient, LevelRoot],
    ],
    ['EnvironmentSystem', EnvironmentSystem, 'domeFades', [DomeFade]],
    ['LevelSystem', LevelSystem, 'levelEntities', [LevelTag]],
    ['TransformSystem', TransformSystem, 'transform', [Transform]],
    [
      'InputSystem',
      InputSystem,
      'rayInteractables',
      [RayInteractable, Transform],
    ],
    [
      'InputSystem',
      InputSystem,
      'pokeInteractables',
      [PokeInteractable, Transform],
    ],
  ];

  for (const [sysName, Sys, queryKey, expectedRefs] of cases) {
    it(`${sysName}.queries.${queryKey}.required holds defined component refs`, () => {
      const required = (Sys as any).queries?.[queryKey]?.required as
        | any[]
        | undefined;
      expect(
        required,
        `${sysName}.queries.${queryKey}.required must exist`,
      ).toBeDefined();
      expect(required!.length).toBe(expectedRefs.length);
      for (let i = 0; i < expectedRefs.length; i++) {
        expect(
          required![i],
          `${sysName}.queries.${queryKey}.required[${i}] must not be undefined (component captured before declaration → bundler emitted System before Component → cycle returned)`,
        ).toBe(expectedRefs[i]);
      }
    });
  }
});
