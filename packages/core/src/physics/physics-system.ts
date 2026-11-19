/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { effect } from '@preact/signals-core';
import { createSystem, Entity, Grabbed, ne, Types } from '.././index.js';
import { Mesh, Object3D, Quaternion, Vector3 } from '../runtime/three.js';
import {
  setWorldPosition,
  setWorldQuaternion,
} from '../transform/transform-utils.js';
import {
  createPhysicsTransport,
  type PhysicsTransport,
} from './physics-transport.js';
import {
  getCapsuleAxisEndpoints,
  PHYSICS_HEADER_WORDS,
  PHYSICS_INPUT_RECORD_FLOATS,
  PHYSICS_OUTPUT_RECORD_FLOATS,
  PHYSICS_PROTOCOL_VERSION,
  PhysicsCommandFlag,
  PhysicsExchangeStatus,
  PhysicsHeaderIndex,
  PhysicsInputOffset,
  PhysicsOutputOffset,
  physicsExchangeByteLength,
  type PhysicsWorkerAddBodyMessage,
  type PhysicsWorkerBodyState,
  type PhysicsWorkerOutputMessage,
  type PhysicsWorkerShapeDescriptor,
} from './physics-worker-protocol.js';
import {
  DEFAULT_ANGULAR_DAMPING,
  DEFAULT_GRAVITY_FACTOR,
  DEFAULT_LINEAR_DAMPING,
  PhysicsBody,
  PhysicsState,
} from './physicsBody.js';
import { PhysicsManipulation } from './physicsManipulation.js';
import { PhysicsShape, PhysicsShapeType } from './physicsShape.js';
import {
  detectShapeFromGeometry,
  generateMergedGeometry,
  sequentialIndices,
} from './utils.js';

export { getCapsuleAxisEndpoints } from './physics-worker-protocol.js';

type Vector3Input = Vector3 | readonly [number, number, number];
type QuaternionInput = Quaternion | readonly [number, number, number, number];

/** Pose passed to {@link PhysicsSystem.setBodyTransform}. */
export interface PhysicsBodyTransformPose {
  position: Vector3Input;
  quaternion: QuaternionInput;
}

/** Options for {@link PhysicsSystem.setBodyTransform}. */
export interface PhysicsBodyTransformOptions {
  /**
   * Clear linear and angular velocity after teleporting the body.
   *
   * @default true
   */
  resetVelocity?: boolean;
  /**
   * Whether `pose` is relative to the entity's parent (`'local'`, like
   * `object3D.position`) or in world space.
   *
   * @default 'local'
   */
  space?: 'local' | 'world';
}

interface PendingBodyCommand {
  handle: number;
  flags: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  impulsePoint: [number, number, number];
  impulse: [number, number, number];
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  gravityFactor: number;
  linearDamping: number;
  angularDamping: number;
  kinematicOverride: boolean;
}

interface SerializedShape {
  descriptor: PhysicsWorkerShapeDescriptor;
  transfer: ArrayBuffer[];
}

interface BodyPoseSnapshot {
  previousPosition: Vector3;
  currentPosition: Vector3;
  previousQuaternion: Quaternion;
  currentQuaternion: Quaternion;
}

interface CompletedExchange {
  buffer: ArrayBuffer;
  ints: Int32Array;
  floats: Float32Array;
  sequence: number;
}

interface GrabbedBodyState {
  position: Vector3;
  quaternion: Quaternion;
  linearVelocity: Vector3;
  angularVelocity: Vector3;
}

const ZERO_VECTOR = [0, 0, 0] as const;
const EXCHANGE_BUFFER_COUNT = 2;
const INITIAL_RESULT_CAPACITY = 64;
const DEFAULT_UPDATE_FREQUENCY = 60;
const MAX_UPDATE_FREQUENCY = 240;
const MAX_ACCUMULATED_STEPS = 4;
const RELEASE_VELOCITY_SMOOTHING_SECONDS = 0.05;
const MAX_RELEASE_LINEAR_SPEED = 10;
const MAX_RELEASE_ANGULAR_SPEED = 4 * Math.PI;

const tempVelocity = new Vector3();
const tempRotation = new Quaternion();
const posePosition = new Vector3();
const poseQuaternion = new Quaternion();
const poseScale = new Vector3();
const handPosition = new Vector3();
const handQuaternion = new Quaternion();

/**
 * Havok simulates in world space while an entity's Object3D pose is relative
 * to its parent (the level root, or another entity), so every pose crossing
 * the transport goes through these two helpers.
 */
function readWorldPose(
  object3D: Object3D,
  position: Vector3,
  quaternion: Quaternion,
): void {
  object3D.updateWorldMatrix(true, false);
  object3D.matrixWorld.decompose(position, quaternion, poseScale);
}

function writeWorldPose(
  object3D: Object3D,
  position: Vector3,
  quaternion: Quaternion,
): void {
  setWorldPosition(object3D, position);
  setWorldQuaternion(object3D, quaternion);
}

function vector3ToArray(value: Vector3Input): [number, number, number] {
  return 'x' in value
    ? [value.x, value.y, value.z]
    : [value[0], value[1], value[2]];
}

function quaternionToArray(
  value: QuaternionInput,
): [number, number, number, number] {
  return 'w' in value
    ? [value.x, value.y, value.z, value.w]
    : [value[0], value[1], value[2], value[3]];
}

function createPendingCommand(handle: number): PendingBodyCommand {
  return {
    handle,
    flags: 0,
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    impulsePoint: [0, 0, 0],
    impulse: [0, 0, 0],
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    gravityFactor: DEFAULT_GRAVITY_FACTOR,
    linearDamping: DEFAULT_LINEAR_DAMPING,
    angularDamping: DEFAULT_ANGULAR_DAMPING,
    kinematicOverride: false,
  };
}

function isZeroVector(value: ArrayLike<number>): boolean {
  return value[0] === 0 && value[1] === 0 && value[2] === 0;
}

/**
 * Manages a Havok simulation on either a dedicated worker or the main thread.
 *
 * Per-frame commands and poses travel through a pair of transferable
 * ArrayBuffers.
 * Both execution modes use the same binary protocol and shared Havok runtime.
 * Worker mode alternates ownership of transferable ArrayBuffers, avoiding both
 * structured-clone copies and SharedArrayBuffer's cross-origin-isolation
 * requirement. Shape creation/removal uses infrequent control messages.
 *
 * @remarks
 * - Supports Sphere, Box, Cylinder, Capsule, ConvexHull, TriMesh, and Auto shapes.
 * - Synchronizes dynamic body poses and velocities back to ECS entities.
 * - Sends grab targets, impulses, velocity edits, damping, and gravity changes through one transport contract.
 * - Holds grabbed dynamic bodies kinematically and releases them with the hand's smoothed, capped velocity.
 * - Automatically releases bodies and shapes when entities are removed.
 *
 * @category Physics
 */
export class PhysicsSystem extends createSystem(
  {
    physicsEntities: {
      required: [PhysicsBody, PhysicsShape],
    },
    manipluatedEntities: {
      required: [PhysicsBody, PhysicsManipulation],
      where: [ne(PhysicsBody, '_engineBody', 0)],
    },
    gravityOverrides: {
      required: [PhysicsBody, PhysicsShape],
      where: [ne(PhysicsBody, 'gravityFactor', DEFAULT_GRAVITY_FACTOR)],
    },
    linearDampingOverrides: {
      required: [PhysicsBody, PhysicsShape],
      where: [ne(PhysicsBody, 'linearDamping', DEFAULT_LINEAR_DAMPING)],
    },
    angularDampingOverrides: {
      required: [PhysicsBody, PhysicsShape],
      where: [ne(PhysicsBody, 'angularDamping', DEFAULT_ANGULAR_DAMPING)],
    },
  },
  {
    gravity: { type: Types.Vec3, default: [0, -9.81, 0] },
    useWorker: { type: Types.Boolean, default: true },
    updateFrequency: { type: Types.Float32, default: DEFAULT_UPDATE_FREQUENCY },
    interpolation: { type: Types.Boolean, default: true },
  },
) {
  private transport?: PhysicsTransport;
  private transportReady = false;
  private nextBodyHandle = 1;
  private nextSequence = 1;
  private bodyEntities = new Map<number, Entity>();
  private bodySnapshots = new Map<number, BodyPoseSnapshot>();
  private bodyResultSequenceFloors = new Map<number, number>();
  private grabbedBodies = new Map<number, GrabbedBodyState>();
  private failedBodyEntities = new WeakSet<Entity>();
  private pendingCommands = new Map<number, PendingBodyCommand>();
  private commandPool: PendingBodyCommand[] = [];
  private freeExchangeBuffers: ArrayBuffer[] = [];
  private completedExchanges: CompletedExchange[] = [];

  private inFlightExchangeCount = 0;
  private stepAccumulator = 0;
  private pendingDebugStepDelta?: number;
  private debugFlushWaiters = new Set<() => void>();

  init(): void {
    const initialByteLength = physicsExchangeByteLength(
      0,
      INITIAL_RESULT_CAPACITY,
    );
    for (let index = 0; index < EXCHANGE_BUFFER_COUNT; index++) {
      this.freeExchangeBuffers.push(new ArrayBuffer(initialByteLength));
    }

    try {
      const transport = createPhysicsTransport(
        this.config.useWorker.value as boolean,
      );
      transport.onmessage = (event: MessageEvent<PhysicsWorkerOutputMessage>) =>
        this.handleTransportMessage(event.data);
      transport.onerror = (event) => {
        this.handleTransportFailure(
          `Physics transport error: ${event.message}`,
        );
      };
      transport.onmessageerror = () => {
        this.handleTransportFailure(
          'Physics transport message could not be decoded',
        );
      };
      this.transport = transport;
      transport.postMessage({
        type: 'init',
        gravity: [...this.config.gravity.value],
      });
      this.cleanupFuncs.push(
        effect(() => {
          const gravity = this.config.gravity.value;
          this.transport?.postMessage({
            type: 'set-gravity',
            gravity: [gravity[0], gravity[1], gravity[2]],
          });
        }),
      );
    } catch (error) {
      this.transport?.terminate();
      this.transport = undefined;
      console.error(
        this.config.useWorker.value
          ? 'Failed to start physics worker. Set features.physics.useWorker to false to run physics on the main thread:'
          : 'Failed to start main-thread physics:',
        error,
      );
    }

    this.cleanupFuncs.push(
      this.queries.physicsEntities.subscribe('disqualify', (entity) => {
        this.removeBody(entity);
      }),
    );
    this.subscribeReactiveOverrides();

    this.cleanupFuncs.push(() => {
      this.transport?.terminate();
      this.transport = undefined;
      this.transportReady = false;
      this.bodyEntities.clear();
      this.bodySnapshots.clear();
      this.bodyResultSequenceFloors.clear();
      this.grabbedBodies.clear();
      this.failedBodyEntities = new WeakSet<Entity>();
      this.pendingCommands.clear();
      this.freeExchangeBuffers.length = 0;
      this.completedExchanges.length = 0;
      this.stepAccumulator = 0;
      this.pendingDebugStepDelta = undefined;
      this.resolveDebugFlushWaiters(true);
    });
  }

  /**
   * Teleport an existing physics body and mirror the pose immediately on its
   * Object3D. The runtime consumes the command on the next available exchange.
   */
  setBodyTransform(
    entity: Entity,
    pose: PhysicsBodyTransformPose,
    options: PhysicsBodyTransformOptions = {},
  ): void {
    if (!entity.hasComponent(PhysicsBody)) {
      return;
    }

    const handle = entity.getValue(PhysicsBody, '_engineBody');
    if (!handle) {
      return;
    }

    posePosition.fromArray(vector3ToArray(pose.position));
    poseQuaternion.fromArray(quaternionToArray(pose.quaternion));
    const object3D = entity.object3D;
    if (object3D) {
      if (options.space === 'world') {
        writeWorldPose(object3D, posePosition, poseQuaternion);
      } else {
        object3D.position.copy(posePosition);
        object3D.quaternion.copy(poseQuaternion);
      }
      object3D.updateMatrixWorld(true);
      readWorldPose(object3D, posePosition, poseQuaternion);
    }

    const command = this.getPendingCommand(handle);
    command.flags |= PhysicsCommandFlag.SetTransform;
    command.position = posePosition.toArray();
    command.quaternion = poseQuaternion.toArray() as [
      number,
      number,
      number,
      number,
    ];
    if (this.bodySnapshots.has(handle)) {
      this.bodyResultSequenceFloors.set(handle, this.nextSequence);
    }
    if (object3D) {
      this.syncSnapshotToObject(handle, object3D);
    }

    if (options.resetVelocity === false) {
      return;
    }

    command.flags |=
      PhysicsCommandFlag.ResetLinearVelocity |
      PhysicsCommandFlag.ResetAngularVelocity;
    entity.getVectorView(PhysicsBody, '_linearVelocity').set(ZERO_VECTOR);
    entity.getVectorView(PhysicsBody, '_angularVelocity').set(ZERO_VECTOR);
  }

  update(delta: number): void {
    this.applyCompletedExchange();

    if (!this.transport) {
      return;
    }

    this.queries.physicsEntities.entities.forEach((entity) => {
      this.ensureBody(entity);
      const handle = entity.getValue(PhysicsBody, '_engineBody');
      if (!handle || !entity.object3D) {
        return;
      }
      const grab = this.grabbedBodies.get(handle);
      if (Grabbed.bitmask && entity.hasComponent(Grabbed)) {
        const command = this.getPendingCommand(handle);
        command.flags |= PhysicsCommandFlag.SetTargetTransform;
        readWorldPose(entity.object3D, posePosition, poseQuaternion);
        posePosition.toArray(command.position);
        poseQuaternion.toArray(command.quaternion);
        this.syncSnapshotToObject(handle, entity.object3D);
        this.trackGrabbedBody(entity, handle, entity.object3D, grab, delta);
      } else if (grab) {
        this.releaseGrabbedBody(entity, handle, entity.object3D, grab);
      }
    });

    this.syncReactiveOverrides();
    this.queueManipulations();

    if (this.pendingDebugStepDelta !== undefined) {
      this.stepAccumulator = 0;
      this.trySendPendingDebugStep();
      this.renderInterpolatedTransforms(1);
      return;
    }

    const stepInterval = this.getStepInterval();
    this.stepAccumulator = Math.min(
      this.stepAccumulator + Math.max(0, delta),
      stepInterval * MAX_ACCUMULATED_STEPS,
    );

    if (this.transportReady) {
      const stepCount = Math.min(
        Math.floor(this.stepAccumulator / stepInterval + 1e-9),
        MAX_ACCUMULATED_STEPS,
      );
      if (stepCount > 0 && this.sendExchange(stepInterval, stepCount)) {
        this.stepAccumulator = Math.max(
          0,
          this.stepAccumulator - stepInterval * stepCount,
        );
      }
    }

    const interpolationAlpha = this.config.interpolation.value
      ? Math.min(this.stepAccumulator / stepInterval, 1)
      : 1;
    this.renderInterpolatedTransforms(interpolationAlpha);
  }

  /** Prepare one exact-delta physics tick for an ECS debugger step. */
  prepareDebugFrame(delta: number): void {
    this.pendingDebugStepDelta =
      Number.isFinite(delta) && delta > 0 ? delta : this.getStepInterval();
    this.stepAccumulator = 0;
  }

  /**
   * Wait until all submitted physics work is reflected in ECS transforms.
   * Used by debugger pause/step so worker and inline execution expose the same
   * settled state at command boundaries.
   */
  async flushDebugFrame(): Promise<void> {
    this.applyCompletedExchange();
    this.trySendPendingDebugStep();
    await this.waitForDebugWork();
    this.applyCompletedExchange();

    // Pausing between fixed ticks must commit queued commands without moving
    // simulation time; a zero-step exchange preserves the old inline behavior.
    if (
      this.pendingDebugStepDelta === undefined &&
      this.pendingCommands.size > 0 &&
      this.transportReady &&
      this.sendExchange(0, 0)
    ) {
      await this.waitForDebugWork();
      this.applyCompletedExchange();
    }

    this.renderInterpolatedTransforms(1);
    for (const snapshot of this.bodySnapshots.values()) {
      snapshot.previousPosition.copy(snapshot.currentPosition);
      snapshot.previousQuaternion.copy(snapshot.currentQuaternion);
    }
  }

  private handleTransportMessage(message: PhysicsWorkerOutputMessage): void {
    switch (message.type) {
      case 'ready':
        this.transportReady = true;
        this.trySendPendingDebugStep();
        break;
      case 'body-created': {
        const entity = this.bodyEntities.get(message.handle);
        if (entity?.hasComponent(PhysicsBody)) {
          entity
            .getVectorView(PhysicsBody, 'centerOfMass')
            .set(message.centerOfMass);
        }
        break;
      }
      case 'step-result':
        this.inFlightExchangeCount = Math.max(
          0,
          this.inFlightExchangeCount - 1,
        );
        const ints = new Int32Array(message.buffer);
        this.completedExchanges.push({
          buffer: message.buffer,
          ints,
          floats: new Float32Array(message.buffer),
          sequence: ints[PhysicsHeaderIndex.Sequence],
        });
        if (this.pendingDebugStepDelta !== undefined) {
          this.applyCompletedExchange();
          this.trySendPendingDebugStep();
        }
        if (this.inFlightExchangeCount === 0) {
          this.resolveDebugFlushWaiters();
        }
        break;
      case 'error':
        if (message.handle !== undefined) {
          console.error(`Physics runtime: ${message.message}`);
          const entity = this.bodyEntities.get(message.handle);
          if (entity) {
            this.failedBodyEntities.add(entity);
            this.setEngineHandles(entity, 0);
          }
          this.bodyEntities.delete(message.handle);
          this.bodySnapshots.delete(message.handle);
          this.bodyResultSequenceFloors.delete(message.handle);
          this.grabbedBodies.delete(message.handle);
          this.discardPendingCommand(message.handle);
        } else {
          this.handleTransportFailure(`Physics runtime: ${message.message}`);
        }
        break;
    }
  }

  private handleTransportFailure(message: string): void {
    console.error(
      this.config.useWorker.value
        ? `${message}. Set features.physics.useWorker to false to run physics on the main thread.`
        : message,
    );
    this.transportReady = false;
    this.transport?.terminate();
    this.transport = undefined;
    this.inFlightExchangeCount = 0;
    this.pendingDebugStepDelta = undefined;
    this.resolveDebugFlushWaiters();
  }

  private async waitForDebugWork(): Promise<void> {
    if (
      this.pendingDebugStepDelta === undefined &&
      this.inFlightExchangeCount === 0
    ) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.debugFlushWaiters.add(resolve);
    });
  }

  private resolveDebugFlushWaiters(force = false): void {
    if (
      !force &&
      (this.pendingDebugStepDelta !== undefined ||
        this.inFlightExchangeCount > 0)
    ) {
      return;
    }
    for (const resolve of this.debugFlushWaiters) {
      resolve();
    }
    this.debugFlushWaiters.clear();
  }

  private applyCompletedExchange(): void {
    if (this.completedExchanges.length === 0) {
      return;
    }

    this.completedExchanges.sort(
      (left, right) => left.sequence - right.sequence,
    );
    for (const exchange of this.completedExchanges) {
      this.applyExchangeBuffer(exchange);
      this.freeExchangeBuffers.push(exchange.buffer);
    }
    this.completedExchanges.length = 0;
  }

  private applyExchangeBuffer({ ints, floats }: CompletedExchange): void {
    const status = ints[PhysicsHeaderIndex.Status];
    if (status & PhysicsExchangeStatus.ResultsTruncated) {
      console.warn('Physics result buffer was unexpectedly truncated');
    }
    const resultCount = ints[PhysicsHeaderIndex.ResultCount];
    const sequence = ints[PhysicsHeaderIndex.Sequence];
    const stepCount = Math.max(1, ints[PhysicsHeaderIndex.StepCount]);

    for (let index = 0; index < resultCount; index++) {
      const base = PHYSICS_HEADER_WORDS + index * PHYSICS_OUTPUT_RECORD_FLOATS;
      const handle = floats[base + PhysicsOutputOffset.Handle];
      const entity = this.bodyEntities.get(handle);
      if (!entity?.object3D || !entity.hasComponent(PhysicsBody)) {
        continue;
      }
      const sequenceFloor = this.bodyResultSequenceFloors.get(handle);
      if (sequenceFloor !== undefined) {
        if (sequence < sequenceFloor) {
          continue;
        }
        this.bodyResultSequenceFloors.delete(handle);
      }

      const linearVelocity = entity.getVectorView(
        PhysicsBody,
        '_linearVelocity',
      );
      linearVelocity[0] = floats[base + PhysicsOutputOffset.LinearVelocityX];
      linearVelocity[1] = floats[base + PhysicsOutputOffset.LinearVelocityY];
      linearVelocity[2] = floats[base + PhysicsOutputOffset.LinearVelocityZ];
      const angularVelocity = entity.getVectorView(
        PhysicsBody,
        '_angularVelocity',
      );
      angularVelocity[0] = floats[base + PhysicsOutputOffset.AngularVelocityX];
      angularVelocity[1] = floats[base + PhysicsOutputOffset.AngularVelocityY];
      angularVelocity[2] = floats[base + PhysicsOutputOffset.AngularVelocityZ];

      if (Grabbed.bitmask && entity.hasComponent(Grabbed)) {
        continue;
      }

      const snapshot = this.bodySnapshots.get(handle);
      if (!snapshot) {
        continue;
      }
      if (stepCount === 1) {
        snapshot.previousPosition.copy(snapshot.currentPosition);
        snapshot.previousQuaternion.copy(snapshot.currentQuaternion);
      }
      snapshot.currentPosition.set(
        floats[base + PhysicsOutputOffset.PositionX],
        floats[base + PhysicsOutputOffset.PositionY],
        floats[base + PhysicsOutputOffset.PositionZ],
      );
      snapshot.currentQuaternion.set(
        floats[base + PhysicsOutputOffset.QuaternionX],
        floats[base + PhysicsOutputOffset.QuaternionY],
        floats[base + PhysicsOutputOffset.QuaternionZ],
        floats[base + PhysicsOutputOffset.QuaternionW],
      );
      if (stepCount > 1) {
        snapshot.previousPosition.copy(snapshot.currentPosition);
        snapshot.previousQuaternion.copy(snapshot.currentQuaternion);
      }
    }
  }

  private renderInterpolatedTransforms(alpha: number): void {
    for (const [handle, snapshot] of this.bodySnapshots) {
      const entity = this.bodyEntities.get(handle);
      if (
        !entity?.object3D ||
        (Grabbed.bitmask && entity.hasComponent(Grabbed))
      ) {
        continue;
      }
      posePosition.lerpVectors(
        snapshot.previousPosition,
        snapshot.currentPosition,
        alpha,
      );
      poseQuaternion.slerpQuaternions(
        snapshot.previousQuaternion,
        snapshot.currentQuaternion,
        alpha,
      );
      writeWorldPose(entity.object3D, posePosition, poseQuaternion);
    }
  }

  private trackGrabbedBody(
    entity: Entity,
    handle: number,
    object3D: Object3D,
    grab: GrabbedBodyState | undefined,
    delta: number,
  ): void {
    // Velocities are world space, like the body they are handed to.
    readWorldPose(object3D, handPosition, handQuaternion);
    if (!grab) {
      if (entity.getValue(PhysicsBody, 'state') !== PhysicsState.Dynamic) {
        return;
      }
      this.grabbedBodies.set(handle, {
        position: handPosition.clone(),
        quaternion: handQuaternion.clone(),
        linearVelocity: new Vector3(),
        angularVelocity: new Vector3(),
      });
      const command = this.getPendingCommand(handle);
      command.flags |= PhysicsCommandFlag.SetKinematicOverride;
      command.kinematicOverride = true;
      return;
    }

    if (delta > 0) {
      const blend = 1 - Math.exp(-delta / RELEASE_VELOCITY_SMOOTHING_SECONDS);
      grab.linearVelocity.lerp(
        tempVelocity
          .subVectors(handPosition, grab.position)
          .divideScalar(delta),
        blend,
      );
      // Small-angle angular velocity: twice the vector part of the frame's
      // shortest-arc rotation delta, divided by the frame time.
      tempRotation.copy(grab.quaternion).invert().premultiply(handQuaternion);
      grab.angularVelocity.lerp(
        tempVelocity
          .set(tempRotation.x, tempRotation.y, tempRotation.z)
          .multiplyScalar((tempRotation.w < 0 ? -2 : 2) / delta),
        blend,
      );
    }
    grab.position.copy(handPosition);
    grab.quaternion.copy(handQuaternion);
  }

  private releaseGrabbedBody(
    entity: Entity,
    handle: number,
    object3D: Object3D,
    grab: GrabbedBodyState,
  ): void {
    this.grabbedBodies.delete(handle);
    this.setBodyTransform(entity, object3D, {
      resetVelocity: false,
      space: 'local',
    });

    const command = this.getPendingCommand(handle);
    // A target queued by an earlier frame of this exchange would hold the
    // body in place and discard the release velocity.
    command.flags &= ~PhysicsCommandFlag.SetTargetTransform;
    command.flags |=
      PhysicsCommandFlag.SetKinematicOverride |
      PhysicsCommandFlag.SetLinearVelocity |
      PhysicsCommandFlag.SetAngularVelocity;
    command.kinematicOverride = false;
    grab.linearVelocity
      .clampLength(0, MAX_RELEASE_LINEAR_SPEED)
      .toArray(command.linearVelocity);
    grab.angularVelocity
      .clampLength(0, MAX_RELEASE_ANGULAR_SPEED)
      .toArray(command.angularVelocity);
    entity
      .getVectorView(PhysicsBody, '_linearVelocity')
      .set(command.linearVelocity);
    entity
      .getVectorView(PhysicsBody, '_angularVelocity')
      .set(command.angularVelocity);
  }

  private syncSnapshotToObject(handle: number, object3D: Object3D): void {
    const snapshot = this.bodySnapshots.get(handle);
    if (!snapshot) {
      return;
    }
    readWorldPose(
      object3D,
      snapshot.currentPosition,
      snapshot.currentQuaternion,
    );
    snapshot.previousPosition.copy(snapshot.currentPosition);
    snapshot.previousQuaternion.copy(snapshot.currentQuaternion);
  }

  private getStepInterval(): number {
    const configuredFrequency = this.config.updateFrequency.value;
    const frequency =
      Number.isFinite(configuredFrequency) && configuredFrequency > 0
        ? Math.min(configuredFrequency, MAX_UPDATE_FREQUENCY)
        : DEFAULT_UPDATE_FREQUENCY;
    return 1 / frequency;
  }

  private sendExchange(delta: number, stepCount = 1): boolean {
    const transport = this.transport;
    const buffer = this.freeExchangeBuffers.pop();
    if (!transport || !buffer) {
      return false;
    }

    const resultCapacity = this.bodySnapshots.size;

    const requiredByteLength = physicsExchangeByteLength(
      this.pendingCommands.size,
      resultCapacity,
    );
    const exchangeBuffer =
      buffer.byteLength >= requiredByteLength
        ? buffer
        : new ArrayBuffer(requiredByteLength);
    const ints = new Int32Array(exchangeBuffer);
    const floats = new Float32Array(exchangeBuffer);
    ints.fill(0, 0, PHYSICS_HEADER_WORDS);
    ints[PhysicsHeaderIndex.Version] = PHYSICS_PROTOCOL_VERSION;
    const sequence = this.nextSequence++;
    ints[PhysicsHeaderIndex.Sequence] = sequence;
    ints[PhysicsHeaderIndex.CommandCount] = this.pendingCommands.size;
    ints[PhysicsHeaderIndex.StepCount] = stepCount;
    floats[PhysicsHeaderIndex.Delta] = delta;

    let commandIndex = 0;
    for (const command of this.pendingCommands.values()) {
      this.writeCommand(floats, commandIndex++, command);
      if (command.flags & PhysicsCommandFlag.SetTransform) {
        this.bodyResultSequenceFloors.set(command.handle, sequence);
      }
    }

    try {
      transport.postMessage({ type: 'step', buffer: exchangeBuffer }, [
        exchangeBuffer,
      ]);
      this.inFlightExchangeCount++;
      this.releasePendingCommands();
      return true;
    } catch (error) {
      this.freeExchangeBuffers.push(exchangeBuffer);
      console.error('Failed to post physics exchange buffer:', error);
      return false;
    }
  }

  private trySendPendingDebugStep(): void {
    if (this.pendingDebugStepDelta === undefined) {
      return;
    }
    if (!this.transport) {
      this.pendingDebugStepDelta = undefined;
      this.resolveDebugFlushWaiters();
      return;
    }
    if (!this.transportReady) {
      return;
    }
    if (this.sendExchange(this.pendingDebugStepDelta, 1)) {
      this.pendingDebugStepDelta = undefined;
    }
  }

  private writeCommand(
    output: Float32Array,
    index: number,
    command: PendingBodyCommand,
  ): void {
    const base = PHYSICS_HEADER_WORDS + index * PHYSICS_INPUT_RECORD_FLOATS;
    output[base + PhysicsInputOffset.Handle] = command.handle;
    output[base + PhysicsInputOffset.Flags] = command.flags;
    output[base + PhysicsInputOffset.PositionX] = command.position[0];
    output[base + PhysicsInputOffset.PositionY] = command.position[1];
    output[base + PhysicsInputOffset.PositionZ] = command.position[2];
    output[base + PhysicsInputOffset.QuaternionX] = command.quaternion[0];
    output[base + PhysicsInputOffset.QuaternionY] = command.quaternion[1];
    output[base + PhysicsInputOffset.QuaternionZ] = command.quaternion[2];
    output[base + PhysicsInputOffset.QuaternionW] = command.quaternion[3];
    output[base + PhysicsInputOffset.ImpulsePointX] = command.impulsePoint[0];
    output[base + PhysicsInputOffset.ImpulsePointY] = command.impulsePoint[1];
    output[base + PhysicsInputOffset.ImpulsePointZ] = command.impulsePoint[2];
    output[base + PhysicsInputOffset.ImpulseX] = command.impulse[0];
    output[base + PhysicsInputOffset.ImpulseY] = command.impulse[1];
    output[base + PhysicsInputOffset.ImpulseZ] = command.impulse[2];
    output[base + PhysicsInputOffset.LinearVelocityX] =
      command.linearVelocity[0];
    output[base + PhysicsInputOffset.LinearVelocityY] =
      command.linearVelocity[1];
    output[base + PhysicsInputOffset.LinearVelocityZ] =
      command.linearVelocity[2];
    output[base + PhysicsInputOffset.AngularVelocityX] =
      command.angularVelocity[0];
    output[base + PhysicsInputOffset.AngularVelocityY] =
      command.angularVelocity[1];
    output[base + PhysicsInputOffset.AngularVelocityZ] =
      command.angularVelocity[2];
    output[base + PhysicsInputOffset.GravityFactor] = command.gravityFactor;
    output[base + PhysicsInputOffset.LinearDamping] = command.linearDamping;
    output[base + PhysicsInputOffset.AngularDamping] = command.angularDamping;
    output[base + PhysicsInputOffset.KinematicOverride] =
      command.kinematicOverride ? 1 : 0;
  }

  private getPendingCommand(handle: number): PendingBodyCommand {
    let command = this.pendingCommands.get(handle);
    if (!command) {
      command = this.commandPool.pop() ?? createPendingCommand(handle);
      command.handle = handle;
      command.flags = 0;
      command.impulse[0] = 0;
      command.impulse[1] = 0;
      command.impulse[2] = 0;
      this.pendingCommands.set(handle, command);
    }
    return command;
  }

  private releasePendingCommands(): void {
    for (const command of this.pendingCommands.values()) {
      command.flags = 0;
      this.commandPool.push(command);
    }
    this.pendingCommands.clear();
  }

  private discardPendingCommand(handle: number): void {
    const command = this.pendingCommands.get(handle);
    if (command) {
      command.flags = 0;
      this.commandPool.push(command);
      this.pendingCommands.delete(handle);
    }
  }

  private ensureBody(entity: Entity): void {
    if (!this.transport || !entity.object3D) {
      return;
    }
    if (this.failedBodyEntities.has(entity)) {
      return;
    }
    if (entity.getValue(PhysicsBody, '_engineBody')) {
      return;
    }

    let serialized: SerializedShape | undefined;
    try {
      serialized = this.serializeShape(entity, entity.object3D);
    } catch (error) {
      // One entity whose collider can't be built must not stop the whole
      // system every frame; it stays without a body until it is re-added.
      this.failedBodyEntities.add(entity);
      console.error(
        `PhysicsSystem: Failed to build the collider for ${entity.object3D.name || `entity ${entity.index}`}:`,
        error,
      );
      return;
    }
    if (!serialized) {
      return;
    }

    const handle = this.nextBodyHandle++;
    readWorldPose(entity.object3D, posePosition, poseQuaternion);
    const linearDamping =
      entity.getValue(PhysicsBody, 'linearDamping') ?? DEFAULT_LINEAR_DAMPING;
    const angularDamping =
      entity.getValue(PhysicsBody, 'angularDamping') ?? DEFAULT_ANGULAR_DAMPING;
    const gravityFactor =
      entity.getValue(PhysicsBody, 'gravityFactor') ?? DEFAULT_GRAVITY_FACTOR;
    const centerOfMass = entity.getVectorView(PhysicsBody, 'centerOfMass');
    const message: PhysicsWorkerAddBodyMessage = {
      type: 'add-body',
      handle,
      shape: serialized.descriptor,
      state: entity.getValue(PhysicsBody, 'state') as PhysicsWorkerBodyState,
      position: posePosition.toArray(),
      quaternion: poseQuaternion.toArray() as [number, number, number, number],
      linearDamping,
      angularDamping,
      gravityFactor,
      centerOfMass: [centerOfMass[0], centerOfMass[1], centerOfMass[2]],
    };

    this.setEngineHandles(entity, handle);
    PhysicsBody.data._engineGravityFactor[entity.index] = gravityFactor;
    PhysicsBody.data._engineLinearDamping[entity.index] = linearDamping;
    PhysicsBody.data._engineAngularDamping[entity.index] = angularDamping;
    this.bodyEntities.set(handle, entity);
    if (message.state !== PhysicsState.Static) {
      this.bodySnapshots.set(handle, {
        previousPosition: posePosition.clone(),
        currentPosition: posePosition.clone(),
        previousQuaternion: poseQuaternion.clone(),
        currentQuaternion: poseQuaternion.clone(),
      });
    }

    try {
      this.transport.postMessage(message, serialized.transfer);
    } catch (error) {
      this.failedBodyEntities.add(entity);
      this.setEngineHandles(entity, 0);
      this.bodyEntities.delete(handle);
      this.bodySnapshots.delete(handle);
      this.bodyResultSequenceFloors.delete(handle);
      console.error('Failed to create physics body:', error);
    }
  }

  private serializeShape(
    entity: Entity,
    object3D: Object3D,
  ): SerializedShape | undefined {
    const dimensionsView = entity.getVectorView(PhysicsShape, 'dimensions');
    let shapeType = entity.getValue(PhysicsShape, 'shape');

    if (shapeType === PhysicsShapeType.Auto) {
      const detection = detectShapeFromGeometry(object3D);
      entity.setValue(PhysicsShape, 'shape', detection.shapeType);
      shapeType = detection.shapeType;
      if (detection.dimensions) {
        dimensionsView.set(detection.dimensions);
      }
    }

    if (
      shapeType === PhysicsShapeType.Capsules &&
      !getCapsuleAxisEndpoints(dimensionsView[0], dimensionsView[1])
    ) {
      console.warn(
        'PhysicsSystem: Capsule dimensions require a positive radius and a total height greater than or equal to twice the radius',
      );
      return;
    }

    const descriptor: PhysicsWorkerShapeDescriptor = {
      type: shapeType as PhysicsWorkerShapeDescriptor['type'],
      dimensions: [dimensionsView[0], dimensionsView[1], dimensionsView[2]],
      density: entity.getValue(PhysicsShape, 'density') ?? 1,
      restitution: entity.getValue(PhysicsShape, 'restitution') ?? 0,
      friction: entity.getValue(PhysicsShape, 'friction') ?? 0.5,
    };
    const transfer: ArrayBuffer[] = [];

    if (
      shapeType === PhysicsShapeType.ConvexHull ||
      shapeType === PhysicsShapeType.TriMesh
    ) {
      const ownsGeometry = !(object3D instanceof Mesh);
      const geometry =
        object3D instanceof Mesh
          ? object3D.geometry
          : generateMergedGeometry(object3D);
      try {
        const positionAttribute = geometry.attributes.position;
        if (!positionAttribute) {
          console.warn(
            `PhysicsSystem: Failed to get vertices for ${shapeType} shape with object3D name ${object3D.name} &id ${object3D.id}`,
          );
          return;
        }

        const vertices = Float32Array.from(
          positionAttribute.array as ArrayLike<number>,
        );
        descriptor.vertices = vertices.buffer as ArrayBuffer;
        transfer.push(descriptor.vertices);

        if (shapeType === PhysicsShapeType.TriMesh) {
          const sourceIndices =
            geometry.index?.array ?? sequentialIndices(positionAttribute.count);
          const indices = Uint32Array.from(sourceIndices as ArrayLike<number>);
          descriptor.indices = indices.buffer as ArrayBuffer;
          transfer.push(descriptor.indices);
        }
      } finally {
        if (ownsGeometry) {
          geometry.dispose();
        }
      }
    }

    return { descriptor, transfer };
  }

  private removeBody(entity: Entity): void {
    this.failedBodyEntities.delete(entity);
    const handle = PhysicsBody.data._engineBody[entity.index];
    if (!handle) {
      return;
    }

    this.transport?.postMessage({ type: 'remove-body', handle });
    this.bodyEntities.delete(handle);
    this.bodySnapshots.delete(handle);
    this.bodyResultSequenceFloors.delete(handle);
    this.grabbedBodies.delete(handle);
    this.discardPendingCommand(handle);
    this.setEngineHandles(entity, 0);
  }

  private setEngineHandles(entity: Entity, handle: number): void {
    if (entity.hasComponent(PhysicsBody)) {
      entity.setValue(PhysicsBody, '_engineBody', handle);
      entity.setValue(PhysicsBody, '_engineOffset', 0);
    } else {
      PhysicsBody.data._engineBody[entity.index] = handle;
      PhysicsBody.data._engineOffset[entity.index] = 0;
    }
    if (entity.hasComponent(PhysicsShape)) {
      entity.setValue(PhysicsShape, '_engineShape', handle);
    } else {
      PhysicsShape.data._engineShape[entity.index] = handle;
    }
  }

  private subscribeReactiveOverrides(): void {
    this.cleanupFuncs.push(
      this.queries.gravityOverrides.subscribe('disqualify', (entity) => {
        if (
          entity.hasComponent(PhysicsBody) &&
          entity.hasComponent(PhysicsShape)
        ) {
          this.syncGravityFactor(entity);
        }
      }),
      this.queries.linearDampingOverrides.subscribe('disqualify', (entity) => {
        if (
          entity.hasComponent(PhysicsBody) &&
          entity.hasComponent(PhysicsShape)
        ) {
          this.syncLinearDamping(entity);
        }
      }),
      this.queries.angularDampingOverrides.subscribe('disqualify', (entity) => {
        if (
          entity.hasComponent(PhysicsBody) &&
          entity.hasComponent(PhysicsShape)
        ) {
          this.syncAngularDamping(entity);
        }
      }),
    );
  }

  private syncReactiveOverrides(): void {
    this.queries.gravityOverrides.entities.forEach((entity) => {
      this.syncGravityFactor(entity);
    });
    this.queries.linearDampingOverrides.entities.forEach((entity) => {
      this.syncLinearDamping(entity);
    });
    this.queries.angularDampingOverrides.entities.forEach((entity) => {
      this.syncAngularDamping(entity);
    });
  }

  private syncGravityFactor(entity: Entity): void {
    const index = entity.index;
    const handle = PhysicsBody.data._engineBody[index];
    if (!handle) {
      return;
    }
    const target = PhysicsBody.data.gravityFactor[index];
    if (PhysicsBody.data._engineGravityFactor[index] === target) {
      return;
    }
    const command = this.getPendingCommand(handle);
    command.flags |= PhysicsCommandFlag.SetGravityFactor;
    command.gravityFactor = target;
    PhysicsBody.data._engineGravityFactor[index] = target;
  }

  private syncLinearDamping(entity: Entity): void {
    const index = entity.index;
    const handle = PhysicsBody.data._engineBody[index];
    if (!handle) {
      return;
    }
    const target = PhysicsBody.data.linearDamping[index];
    if (PhysicsBody.data._engineLinearDamping[index] === target) {
      return;
    }
    const command = this.getPendingCommand(handle);
    command.flags |= PhysicsCommandFlag.SetLinearDamping;
    command.linearDamping = target;
    PhysicsBody.data._engineLinearDamping[index] = target;
  }

  private syncAngularDamping(entity: Entity): void {
    const index = entity.index;
    const handle = PhysicsBody.data._engineBody[index];
    if (!handle) {
      return;
    }
    const target = PhysicsBody.data.angularDamping[index];
    if (PhysicsBody.data._engineAngularDamping[index] === target) {
      return;
    }
    const command = this.getPendingCommand(handle);
    command.flags |= PhysicsCommandFlag.SetAngularDamping;
    command.angularDamping = target;
    PhysicsBody.data._engineAngularDamping[index] = target;
  }

  private queueManipulations(): void {
    this.queries.manipluatedEntities.entities.forEach((entity) => {
      const handle = entity.getValue(PhysicsBody, '_engineBody');
      if (!handle || !entity.object3D) {
        return;
      }

      const force = entity.getVectorView(PhysicsManipulation, 'force');
      const linearVelocity = entity.getVectorView(
        PhysicsManipulation,
        'linearVelocity',
      );
      const angularVelocity = entity.getVectorView(
        PhysicsManipulation,
        'angularVelocity',
      );
      const hasForce = !isZeroVector(force);
      const hasLinearVelocity = !isZeroVector(linearVelocity);
      const hasAngularVelocity = !isZeroVector(angularVelocity);
      if (!hasForce && !hasLinearVelocity && !hasAngularVelocity) {
        entity.removeComponent(PhysicsManipulation);
        return;
      }
      const command = this.getPendingCommand(handle);

      if (hasForce) {
        command.flags |= PhysicsCommandFlag.ApplyImpulse;
        let impulsePosition = this.bodySnapshots.get(handle)?.currentPosition;
        if (!impulsePosition) {
          readWorldPose(entity.object3D, posePosition, poseQuaternion);
          impulsePosition = posePosition;
        }
        command.impulsePoint[0] = impulsePosition.x;
        command.impulsePoint[1] = impulsePosition.y;
        command.impulsePoint[2] = impulsePosition.z;
        command.impulse[0] += force[0];
        command.impulse[1] += force[1];
        command.impulse[2] += force[2];
      }
      if (hasLinearVelocity) {
        command.flags |= PhysicsCommandFlag.SetLinearVelocity;
        command.linearVelocity[0] = linearVelocity[0];
        command.linearVelocity[1] = linearVelocity[1];
        command.linearVelocity[2] = linearVelocity[2];
      }
      if (hasAngularVelocity) {
        command.flags |= PhysicsCommandFlag.SetAngularVelocity;
        command.angularVelocity[0] = angularVelocity[0];
        command.angularVelocity[1] = angularVelocity[1];
        command.angularVelocity[2] = angularVelocity[2];
      }

      entity.removeComponent(PhysicsManipulation);
    });
  }
}
