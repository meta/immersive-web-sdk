/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { PositionalAudio, AudioListener, Audio as AmbientAudio } from 'three';
import { AssetManager } from '../asset/index.js';
// Import directly from submodules — not the `../ecs/index.js` barrel — to
// avoid a value-level import cycle: ecs/index.js re-exports ecs/world.js,
// which (via its transitive deps) loops back to audio/audio-system.js while
// it is still being evaluated. That would leave the AudioSource reference
// captured in `audioEntities.required` as `undefined` at class-body eval time.
import { Types } from '../ecs/component.js';
import { Entity } from '../ecs/entity.js';
import { createSystem } from '../ecs/system.js';
import { AudioInstance, AudioPool } from './audio-pool.js';
import { AudioSource, InstanceStealPolicy, PlaybackMode } from './audio.js';

/**
 * Runtime audio manager that loads sources, pools players, and applies XR-aware behavior.
 *
 * @remarks
 * - Creates an `AudioListener` on the player head, resumes the audio context
 *   when an XR session starts, and pauses playing audio while out of XR.
 * - Pools `Audio`/`PositionalAudio` instances per entity to minimize allocations
 *   and implements play/overlap/fade-restart behaviors.
 * - Optionally culls distant positional audio by a distance multiplier.
 *
 * @category Audio
 */
export class AudioSystem extends createSystem(
  {
    audioEntities: { required: [AudioSource] },
  },
  {
    /** Enable distance-based culling for positional audio instances. */
    enableDistanceCulling: { type: Types.Boolean, default: true },
    /** Multiplier applied to `maxDistance` for culling threshold. */
    cullingDistanceMultiplier: { type: Types.Float32, default: 1.5 },
  },
) {
  private listener!: AudioListener;
  private activeInstances: Map<
    Entity,
    (AudioInstance<AmbientAudio> | AudioInstance<PositionalAudio>)[]
  > = new Map();

  init(): void {
    // Create and attach AudioListener to camera
    this.listener = new AudioListener();
    this.player.head.add(this.listener);

    // Handle XR session changes
    this.renderer.xr.addEventListener('sessionstart', this.onXRSessionStart);
    this.renderer.xr.addEventListener('sessionend', this.onXRSessionEnd);

    // Handle entity lifecycle
    this.queries.audioEntities.subscribe('disqualify', (entity) => {
      this.cleanupEntity(entity);
    });
  }

  private onXRSessionStart = () => {
    // Resume audio context when entering XR
    const context = this.listener.context;
    if (context.state === 'suspended') {
      context.resume();
    }

    // Resume audio that was paused by session end
    for (const [entity, instances] of this.activeInstances) {
      instances.forEach((instance) => {
        if (instance.pausedBySessionEnd) {
          instance.audio.play();
          instance.pausedBySessionEnd = false;
          // three's pause() dropped the old source and its onended handler.
          this.attachOnEnded(entity, instance);
        }
      });
    }
  };

  private onXRSessionEnd = () => {
    // Pause all active audio when exiting XR
    for (const [, instances] of this.activeInstances) {
      instances.forEach((instance) => {
        if (instance.audio.isPlaying) {
          instance.audio.pause();
          instance.pausedBySessionEnd = true;
        }
      });
    }
    // Keep the audio context running: the page goes on in 2D, and only
    // session start resumes a suspended context, so suspending it here
    // silenced every sound until the next XR session.
  };

  update(_delta: number, _time: number): void {
    const time = _time;
    const entities = this.queries.audioEntities.entities;

    // Early exit if no audio entities
    if (entities.size === 0) {
      return;
    }

    entities.forEach((entity) => {
      const index = entity.index;

      // Handle audio loading
      if (
        !AudioSource.data._loaded[index] &&
        !AudioSource.data._loading[index]
      ) {
        const src = AudioSource.data.src[index];
        if (src) {
          this.loadAudio(entity, src);
        }
        return; // Skip further processing until loaded
      }

      // Skip if not loaded yet
      if (!AudioSource.data._loaded[index]) {
        return;
      }

      // Create pool if needed
      if (!AudioSource.data._pool[index]) {
        this.createPool(entity);
      }

      // Handle playback requests
      this.handlePlaybackRequests(entity, time);

      // Update active instances
      this.updateActiveInstances(entity, time);

      // Handle autoplay (only trigger once, not loop)
      if (
        AudioSource.data.autoplay[index] &&
        !AudioSource.data._isPlaying[index] &&
        AudioSource.data._playRequested[index] === 0 // Only if not already requested
      ) {
        AudioSource.data._playRequested[index] = 1;
        // Disable autoplay after first trigger to prevent looping
        AudioSource.data.autoplay[index] = 0;
      }
    });
  }

  private async loadAudio(entity: Entity, src: string): Promise<void> {
    const index = entity.index;
    AudioSource.data._loading[index] = 1;

    try {
      // Try to get from AssetManager cache first (fast path)
      let buffer = AssetManager.getAudio(src);

      if (!buffer) {
        // Load if not in cache (handles caching automatically)
        buffer = await AssetManager.loadAudio(src);
      }

      // TODO: Add AssetManager.retain(src) when memory management is implemented

      AudioSource.data._buffer[index] = buffer;
      AudioSource.data._loaded[index] = 1;
    } catch (error) {
      console.error(`Failed to load audio: ${src}`, error);
    } finally {
      AudioSource.data._loading[index] = 0;
    }
  }

  private createPool(entity: Entity): void {
    const index = entity.index;
    const maxInstances = AudioSource.data.maxInstances[index];
    const positional = AudioSource.data.positional[index];

    // Get entity's Object3D
    const parent = entity.object3D || this.scene;

    // Auto-calculate pool size from maxInstances (no need for separate poolSize config)
    const poolSize = maxInstances;

    const pool =
      positional === 1
        ? new AudioPool<PositionalAudio>(this.listener, poolSize, true, parent)
        : new AudioPool<AmbientAudio>(this.listener, poolSize, false, parent);
    AudioSource.data._pool[index] = pool;

    // Configure spatial properties for all instances
    if (positional) {
      const positionalPool = pool as AudioPool<PositionalAudio>;
      const instances = positionalPool.getAllInstances();
      instances.forEach((audio) => {
        audio.setRefDistance(AudioSource.data.refDistance[index]);
        audio.setRolloffFactor(AudioSource.data.rolloffFactor[index]);
        audio.setMaxDistance(AudioSource.data.maxDistance[index]);
        audio.setDistanceModel(
          AudioSource.data.distanceModel[index] as DistanceModelType,
        );
        audio.setDirectionalCone(
          AudioSource.data.coneInnerAngle[index],
          AudioSource.data.coneOuterAngle[index],
          AudioSource.data.coneOuterGain[index],
        );
      });
    }
  }

  private handlePlaybackRequests(entity: Entity, time: number): void {
    const index = entity.index;

    // Handle stop request first
    if (AudioSource.data._stopRequested[index]) {
      this.stopAllInstances(entity);
      AudioSource.data._stopRequested[index] = 0;
      AudioSource.data._playRequested[index] = 0;
      AudioSource.data._pauseRequested[index] = 0;
      return;
    }

    // Handle pause request
    if (AudioSource.data._pauseRequested[index]) {
      const fadeOut = AudioSource.data._fadeOut[index];
      this.pauseAllInstances(entity, fadeOut, time);
      AudioSource.data._pauseRequested[index] = 0;
      return;
    }

    // Handle play request
    if (
      AudioSource.data._playRequested[index] &&
      AudioSource.data._loaded[index]
    ) {
      const playbackMode = AudioSource.data.playbackMode[index];
      const fadeIn = AudioSource.data._fadeIn[index];

      switch (playbackMode) {
        case PlaybackMode.Restart:
          this.playRestart(entity, fadeIn, time);
          break;
        case PlaybackMode.Overlap:
          this.playOverlap(entity, fadeIn, time);
          break;
        case PlaybackMode.Ignore:
          this.playIgnore(entity, fadeIn, time);
          break;
        case PlaybackMode.FadeRestart:
          this.playFadeRestart(entity, time);
          break;
      }

      AudioSource.data._playRequested[index] = 0;
    }
  }

  private playRestart(entity: Entity, fadeIn: number, time: number): void {
    this.stopAllInstances(entity);
    this.createAndPlayInstance(entity, fadeIn, time);
  }

  private playOverlap(entity: Entity, fadeIn: number, time: number): void {
    const index = entity.index;
    const instances = this.activeInstances.get(entity) || [];
    const maxInstances = AudioSource.data.maxInstances[index];

    if (instances.length < maxInstances) {
      this.createAndPlayInstance(entity, fadeIn, time);
    } else {
      // Apply steal policy
      const policy = AudioSource.data.instanceStealPolicy[index];
      this.stealInstance(entity, instances, policy, time);
      this.createAndPlayInstance(entity, fadeIn, time);
    }
  }

  private playIgnore(entity: Entity, fadeIn: number, time: number): void {
    const instances = this.activeInstances.get(entity) || [];

    if (instances.length === 0) {
      this.createAndPlayInstance(entity, fadeIn, time);
    } else {
    }
  }

  private playFadeRestart(entity: Entity, time: number): void {
    const index = entity.index;
    const crossfadeDuration = AudioSource.data.crossfadeDuration[index];
    const instances = this.activeInstances.get(entity) || [];

    // Fade out existing instances
    instances.forEach((instance) => {
      instance.isFadingOut = true;
      instance.fadeStartTime = time;
      instance.fadeStartVolume = instance.audio.getVolume();
      instance.fadeDuration = crossfadeDuration;
    });

    // Start new instance with fade in
    this.createAndPlayInstance(entity, crossfadeDuration, time);
  }

  private createAndPlayInstance(
    entity: Entity,
    fadeIn: number,
    time: number,
  ): void {
    const index = entity.index;
    const pool = AudioSource.data._pool[index] as
      | AudioPool<AmbientAudio>
      | AudioPool<PositionalAudio>;
    const buffer = AudioSource.data._buffer[index] as AudioBuffer;

    if (!pool || !buffer) {
      return;
    }

    const audio = pool.acquire();
    if (!audio) {
      return;
    }

    // Set buffer and properties
    audio.setBuffer(buffer);
    const shouldLoop = AudioSource.data.loop[index] === 1;
    audio.setLoop(shouldLoop);
    audio.setVolume(fadeIn > 0 ? 0 : AudioSource.data.volume[index]);

    // Create instance tracking
    const instance:
      | AudioInstance<AmbientAudio>
      | AudioInstance<PositionalAudio> = {
      audio,
      startTime: time,
    } as any;

    if (fadeIn > 0) {
      instance.isFadingIn = true;
      instance.fadeStartTime = instance.startTime;
      instance.fadeStartVolume = 0;
      instance.fadeDuration = fadeIn;
    }

    // Add to active instances
    const instances = this.activeInstances.get(entity) || [];
    instances.push(instance);
    this.activeInstances.set(entity, instances);

    // Start playback
    audio.play();
    AudioSource.data._isPlaying[index] = 1;
    this.attachOnEnded(entity, instance);
  }

  private attachOnEnded(
    entity: Entity,
    instance: AudioInstance<AmbientAudio> | AudioInstance<PositionalAudio>,
  ): void {
    const { audio } = instance;
    // Handle onEnded - use audio.source.onended (the only method that works reliably).
    // three types `source` as AudioNode; for buffer playback it is an
    // AudioBufferSourceNode, which has onended.
    const playbackSource = () =>
      audio.source as AudioScheduledSourceNode | null;
    const source = playbackSource();
    if (source) {
      source.onended = () => {
        this.onInstanceEnded(entity, instance);
      };
    } else {
      // If source not available immediately, try after a short delay. Track the
      // timer on the instance so releaseInstance() can cancel it; otherwise this
      // callback could run after `audio` has been returned to the pool and
      // reacquired for a different sound, clobbering that sound's onended.
      instance.onendedTimeout = setTimeout(() => {
        instance.onendedTimeout = undefined;
        const delayedSource = playbackSource();
        if (delayedSource) {
          delayedSource.onended = () => {
            this.onInstanceEnded(entity, instance);
          };
        }
      }, 10);
    }
  }

  private clearInstanceTimeout(
    instance: AudioInstance<AmbientAudio> | AudioInstance<PositionalAudio>,
  ): void {
    if (instance.onendedTimeout !== undefined) {
      clearTimeout(instance.onendedTimeout);
      instance.onendedTimeout = undefined;
    }
  }

  private updateActiveInstances(entity: Entity, time: number): void {
    const instances = this.activeInstances.get(entity);
    if (!instances || instances.length === 0) {
      return;
    }

    const index = entity.index;
    const currentTime = time;
    const targetVolume = AudioSource.data.volume[index];

    // Update each instance
    for (let i = instances.length - 1; i >= 0; i--) {
      const instance = instances[i];

      // Handle fade in
      if (
        instance.isFadingIn &&
        instance.fadeStartTime &&
        instance.fadeDuration
      ) {
        const fadeProgress =
          (currentTime - instance.fadeStartTime) / instance.fadeDuration;
        if (fadeProgress >= 1) {
          instance.audio.setVolume(targetVolume);
          instance.isFadingIn = false;
        } else {
          const currentVolume = targetVolume * fadeProgress;
          instance.audio.setVolume(currentVolume);
        }
      }

      // Handle fade out
      if (
        instance.isFadingOut &&
        instance.fadeStartTime &&
        instance.fadeDuration
      ) {
        const fadeProgress =
          (currentTime - instance.fadeStartTime) / instance.fadeDuration;
        if (fadeProgress >= 1) {
          this.releaseInstance(entity, instance, i);
        } else {
          const startVolume = instance.fadeStartVolume || targetVolume;
          const currentVolume = startVolume * (1 - fadeProgress);
          instance.audio.setVolume(currentVolume);
        }
      }

      // Update volume if it changed (and not currently fading)
      if (!instance.isFadingIn && !instance.isFadingOut) {
        const currentVolume = instance.audio.getVolume();
        if (Math.abs(currentVolume - targetVolume) > 0.01) {
          instance.audio.setVolume(targetVolume);
        }
      }

      // Update spatial properties if they changed
      if (
        AudioSource.data.positional[index] &&
        instance.audio instanceof PositionalAudio
      ) {
        if (
          instance.audio.getRefDistance() !==
          AudioSource.data.refDistance[index]
        ) {
          instance.audio.setRefDistance(AudioSource.data.refDistance[index]);
        }
        instance.audio.setRolloffFactor(AudioSource.data.rolloffFactor[index]);
        instance.audio.setMaxDistance(AudioSource.data.maxDistance[index]);
      }
    }

    // Update playing state
    AudioSource.data._isPlaying[index] = instances.length > 0 ? 1 : 0;
  }

  private onInstanceEnded(
    entity: Entity,
    instance: AudioInstance<AmbientAudio> | AudioInstance<PositionalAudio>,
  ): void {
    const instances = this.activeInstances.get(entity);
    if (!instances) {
      return;
    }

    const instanceIndex = instances.indexOf(instance);
    if (instanceIndex !== -1) {
      this.releaseInstance(entity, instance, instanceIndex);
    }
  }

  private releaseInstance(
    entity: Entity,
    instance: AudioInstance<AmbientAudio> | AudioInstance<PositionalAudio>,
    instanceIndex: number,
  ): void {
    const index = entity.index;
    const pool = AudioSource.data._pool[index] as
      | AudioPool<AmbientAudio>
      | AudioPool<PositionalAudio>;
    const instances = this.activeInstances.get(entity)!;

    // Cancel any pending onended-attach timer before the audio returns to the pool.
    this.clearInstanceTimeout(instance);

    // Release back to pool
    (pool as any).release(instance.audio);

    // Remove from active instances
    instances.splice(instanceIndex, 1);

    if (instances.length === 0) {
      this.activeInstances.delete(entity);
      AudioSource.data._isPlaying[index] = 0;
    }
  }

  private stopAllInstances(entity: Entity): void {
    const instances = this.activeInstances.get(entity);
    if (!instances) {
      return;
    }

    const index = entity.index;
    const pool = AudioSource.data._pool[index] as
      | AudioPool<AmbientAudio>
      | AudioPool<PositionalAudio>;

    instances.forEach((instance) => {
      this.clearInstanceTimeout(instance);
      (pool as any).release(instance.audio);
    });

    this.activeInstances.delete(entity);
    AudioSource.data._isPlaying[index] = 0;
  }

  private pauseAllInstances(
    entity: Entity,
    fadeOut: number,
    time: number,
  ): void {
    const instances = this.activeInstances.get(entity);
    if (!instances) {
      return;
    }

    if (fadeOut > 0) {
      instances.forEach((instance) => {
        instance.isFadingOut = true;
        instance.fadeStartTime = time;
        instance.fadeStartVolume = instance.audio.getVolume();
        instance.fadeDuration = fadeOut;
      });
    } else {
      instances.forEach((instance) => {
        instance.audio.pause();
      });
    }
  }

  private stealInstance(
    entity: Entity,
    instances: (AudioInstance<AmbientAudio> | AudioInstance<PositionalAudio>)[],
    policy: string,
    _time: number,
  ): void {
    if (instances.length === 0) {
      return;
    }

    let instanceToSteal:
      | AudioInstance<AmbientAudio>
      | AudioInstance<PositionalAudio>;

    switch (policy) {
      case InstanceStealPolicy.Oldest:
        instanceToSteal = instances[0];
        break;
      case InstanceStealPolicy.Quietest:
        instanceToSteal = instances.reduce((quietest, current) =>
          current.audio.getVolume() < quietest.audio.getVolume()
            ? current
            : quietest,
        );
        break;
      case InstanceStealPolicy.Furthest:
        // Implement distance-based stealing using camera position
        const cameraPosition = this.player.head.position;
        instanceToSteal = instances.reduce((furthest, current) => {
          const furthestDistance = furthest.audio.position
            ? cameraPosition.distanceTo(furthest.audio.position)
            : 0;
          const currentDistance = current.audio.position
            ? cameraPosition.distanceTo(current.audio.position)
            : 0;

          return currentDistance > furthestDistance ? current : furthest;
        });
        break;
      default:
        instanceToSteal = instances[0];
    }

    const instanceIndex = instances.indexOf(instanceToSteal);
    this.releaseInstance(entity, instanceToSteal, instanceIndex);
  }

  private cleanupEntity(entity: Entity): void {
    const instances = this.activeInstances.get(entity);
    if (!instances) {
      return;
    }

    const index = entity.index;
    const pool = AudioSource.data._pool[index] as
      | (AudioPool<AmbientAudio> | AudioPool<PositionalAudio>)
      | undefined;

    if (pool) {
      instances.forEach((instance) => {
        this.clearInstanceTimeout(instance);
        (pool as any).release(instance.audio);
      });
      pool.dispose();
    }

    // TODO: Add AssetManager.release(src) when memory management is implemented
    // const src = AudioSource.data.src[index];
    // if (src) AssetManager.release(src);

    this.activeInstances.delete(entity);
  }

  destroy(): void {
    // Clean up all entities
    for (const [entity] of this.activeInstances) {
      this.cleanupEntity(entity);
    }

    // Remove event listeners
    this.renderer.xr.removeEventListener('sessionstart', this.onXRSessionStart);
    this.renderer.xr.removeEventListener('sessionend', this.onXRSessionEnd);
  }
}

// Type alias for Three.js distance model
type DistanceModelType = 'linear' | 'inverse' | 'exponential';
