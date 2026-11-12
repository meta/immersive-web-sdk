/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../../src/asset/index.js';
import { AudioSystem } from '../../src/audio/audio-system.js';
import { AudioSource } from '../../src/audio/audio.js';
import { World } from '../../src/ecs/world.js';
import { Object3D, PerspectiveCamera, Scene } from '../../src/runtime/three.js';

// audio-system.ts -> runtime barrel -> xr-input cursor-visual.ts touches
// `document` at module load; provide a minimal canvas stub before importing.
vi.hoisted(() => {
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => ({
        arc: () => {},
        beginPath: () => {},
        clearRect: () => {},
        fill: () => {},
        fillStyle: '',
        lineWidth: 0,
        stroke: () => {},
        strokeStyle: '',
      }),
      height: 0,
      width: 0,
    }),
  };
});

/** An AudioSystem driven by hand over one entity with an AudioSource. */
function setup(src: string) {
  const world = new World();
  world.registerComponent(AudioSource);
  const entity = world.createEntity().addComponent(AudioSource, { src });
  const system = new AudioSystem(
    {
      camera: new PerspectiveCamera(),
      globals: {},
      input: {},
      player: new Object3D(),
      playerEntity: {},
      playerHeadEntity: {},
      renderer: {},
      scene: new Scene(),
      session: undefined,
      visibilityState: { value: 'visible' },
    } as any,
    {} as any,
    0,
  );
  (system as any).queries = {
    audioEntities: { entities: new Set([entity]) },
  };
  return { entity, system };
}

/** Let the pending load settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AudioSystem load failures', () => {
  it('does not refetch a failed src every frame, and retries a new src', async () => {
    vi.spyOn(AssetManager, 'getAudio').mockReturnValue(undefined as any);
    const load = vi
      .spyOn(AssetManager, 'loadAudio')
      .mockRejectedValue(new Error('404'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { entity, system } = setup('./audio/missing.mp3');

    system.update(0, 0);
    await settle();
    for (let frame = 1; frame <= 5; frame++) {
      system.update(0.016, frame * 0.016);
      await settle();
    }

    expect(load).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(AudioSource.data._loaded[entity.index]).toBe(0);
    expect(AudioSource.data._loading[entity.index]).toBe(0);

    // A new src is a new attempt.
    const buffer = {} as AudioBuffer;
    load.mockResolvedValueOnce(buffer);
    entity.setValue(AudioSource, 'src', './audio/found.mp3');
    system.update(0.016, 1);
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith('./audio/found.mp3');
    expect(AudioSource.data._loaded[entity.index]).toBe(1);
    expect(AudioSource.data._buffer[entity.index]).toBe(buffer);
  });
});
