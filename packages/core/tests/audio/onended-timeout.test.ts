/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSystem } from '../../src/audio/audio-system.js';
import { AudioSource } from '../../src/audio/audio.js';
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

function createAudioSystem() {
  const world = {
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
  };
  return new AudioSystem(world as any, {} as any, 0);
}

describe('AudioSystem XR session transitions', () => {
  it('keeps audio playable in 2D after an XR session ends', () => {
    const system = createAudioSystem();
    const context = {
      state: 'running',
      resume: vi.fn(),
      suspend: vi.fn(),
    };
    const audio = { isPlaying: true, pause: vi.fn(), play: vi.fn() };
    const instance: any = { audio, startTime: 0 };
    (system as any).listener = { context };
    (system as any).activeInstances = new Map([[0, [instance]]]);

    (system as any).onXRSessionEnd();

    expect(context.suspend).not.toHaveBeenCalled();
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(instance.pausedBySessionEnd).toBe(true);

    (system as any).onXRSessionStart();

    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(instance.pausedBySessionEnd).toBe(false);
  });

  it('re-attaches the end handler to audio resumed by the next session', () => {
    const system = createAudioSystem();
    const entity = { index: 7 };
    // three's play() creates a new source node; pause() discarded the old one.
    const audio: any = {
      isPlaying: false,
      source: null,
      play: vi.fn(() => {
        audio.source = {};
      }),
    };
    const instance: any = { audio, startTime: 0, pausedBySessionEnd: true };
    const onInstanceEnded = vi.fn();
    (system as any).onInstanceEnded = onInstanceEnded;
    (system as any).listener = { context: { state: 'running' } };
    (system as any).activeInstances = new Map([[entity, [instance]]]);

    (system as any).onXRSessionStart();
    audio.source.onended();

    expect(onInstanceEnded).toHaveBeenCalledWith(entity, instance);
  });
});

describe('AudioSystem.clearInstanceTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cancels a pending onended-attach timer so it never fires', () => {
    const system = createAudioSystem();
    const fired = vi.fn();
    const instance: any = {
      audio: {},
      startTime: 0,
      onendedTimeout: setTimeout(fired, 10),
    };

    (system as any).clearInstanceTimeout(instance);
    vi.advanceTimersByTime(1000);

    expect(fired).not.toHaveBeenCalled();
    expect(instance.onendedTimeout).toBeUndefined();
  });

  it('is a no-op when no timer is pending', () => {
    const system = createAudioSystem();
    const instance: any = { audio: {}, startTime: 0 };
    expect(() => (system as any).clearInstanceTimeout(instance)).not.toThrow();
  });
});

describe('AudioSystem.releaseInstance', () => {
  let savedPool: unknown;
  let savedIsPlaying: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    savedPool = (AudioSource.data as any)._pool;
    savedIsPlaying = (AudioSource.data as any)._isPlaying;
  });

  afterEach(() => {
    vi.useRealTimers();
    (AudioSource.data as any)._pool = savedPool;
    (AudioSource.data as any)._isPlaying = savedIsPlaying;
  });

  it('cancels the pending onended timer and releases the audio to the pool', () => {
    const system = createAudioSystem();
    const release = vi.fn();
    (AudioSource.data as any)._pool = [{ release }];
    (AudioSource.data as any)._isPlaying = [1];

    const entity = { index: 0 } as any;
    const fired = vi.fn();
    const audio = { id: 'audio-node' };
    const instance: any = {
      audio,
      startTime: 0,
      onendedTimeout: setTimeout(fired, 10),
    };
    (system as any).activeInstances.set(entity, [instance]);

    (system as any).releaseInstance(entity, instance, 0);

    // Regression: a stale timer firing after release could clobber the onended
    // of a reacquired pooled audio node. It must be cancelled on release.
    vi.advanceTimersByTime(1000);
    expect(fired).not.toHaveBeenCalled();
    expect(instance.onendedTimeout).toBeUndefined();

    // Audio returned to the pool, bookkeeping cleared.
    expect(release).toHaveBeenCalledWith(audio);
    expect((AudioSource.data as any)._isPlaying[0]).toBe(0);
    expect((system as any).activeInstances.has(entity)).toBe(false);
  });
});
