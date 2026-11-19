/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HavokPhysics, {
  type HavokPhysicsWithBindings,
  type HP_BodyId,
  type HP_ShapeId,
  type HP_WorldId,
  type MassProperties,
  type MotionType,
  type QTransform,
  type Quaternion,
  type Vector3,
} from '@babylonjs/havok';
import {
  getCapsuleAxisEndpoints,
  PHYSICS_HEADER_BYTES,
  PHYSICS_HEADER_WORDS,
  PHYSICS_INPUT_RECORD_FLOATS,
  PHYSICS_OUTPUT_RECORD_FLOATS,
  PHYSICS_PROTOCOL_VERSION,
  PhysicsCommandFlag,
  PhysicsExchangeStatus,
  PhysicsHeaderIndex,
  PhysicsInputOffset,
  PhysicsOutputOffset,
  type PhysicsWorkerAddBodyMessage,
  type PhysicsWorkerBodyState,
  type PhysicsWorkerShapeDescriptor,
} from './physics-worker-protocol.js';
import { reusableFloat32View } from './physics-worker-utils.js';

interface WorkerBody {
  body: HP_BodyId;
  shape: HP_ShapeId;
  transformOffset: number;
  state: PhysicsWorkerBodyState;
  targetVelocity: Vector3;
  /**
   * The last target this body was driven to. Havok reaches a target by
   * setting a velocity that persists afterwards, so a body whose driver stops
   * sending targets is settled onto this pose instead of drifting past it.
   */
  drivenTarget?: QTransform;
}

interface TargetTransform {
  entry: WorkerBody;
  body: HP_BodyId;
  from: QTransform;
  to: QTransform;
}

interface PhysicsRuntimeState {
  havok?: HavokPhysicsWithBindings;
  havokWorld?: HP_WorldId;
  heapFloatView?: Float32Array;
  initializePromise?: Promise<void>;
  bodies: Map<number, WorkerBody>;
  /** Bodies with a {@link WorkerBody.drivenTarget}. */
  drivenBodies: Set<WorkerBody>;
  destroyed: boolean;
}

// Target motion beyond what a hand can do (~10 g, two turns per second) is a
// tracking jump rather than motion to sweep through neighbours.
const MAX_TARGET_ACCELERATION = 100;
const MAX_TARGET_ANGULAR_SPEED = 4 * Math.PI;

async function initialize(
  state: PhysicsRuntimeState,
  gravity: [number, number, number],
): Promise<void> {
  if (state.destroyed) {
    throw new Error('Physics runtime has been destroyed');
  }
  if (!state.initializePromise) {
    state.initializePromise = (async () => {
      const engine = await HavokPhysics();
      if (state.destroyed) {
        throw new Error('Physics runtime was destroyed during initialization');
      }
      const world = engine.HP_World_Create()[1];
      try {
        engine.HP_World_SetGravity(world, gravity);
      } catch (error) {
        engine.HP_World_Release(world);
        throw error;
      }
      state.havok = engine;
      state.havokWorld = world;
    })();
  }
  await state.initializePromise;
}

function requireHavok(
  state: PhysicsRuntimeState,
): [HavokPhysicsWithBindings, HP_WorldId] {
  if (!state.havok || !state.havokWorld) {
    throw new Error('Physics runtime received a message before initialization');
  }
  return [state.havok, state.havokWorld];
}

function getHeapFloatView(
  state: PhysicsRuntimeState,
  engine: HavokPhysicsWithBindings,
): Float32Array {
  state.heapFloatView = reusableFloat32View(
    state.heapFloatView,
    engine.HEAPU8.buffer,
  );
  return state.heapFloatView;
}

function copyFloat32ToHeap(
  engine: HavokPhysicsWithBindings,
  source: Float32Array,
): number {
  const offset = engine._malloc(source.byteLength);
  new Float32Array(engine.HEAPU8.buffer, offset, source.length).set(source);
  return offset;
}

function copyInt32ToHeap(
  engine: HavokPhysicsWithBindings,
  source: Uint32Array,
): number {
  const offset = engine._malloc(source.byteLength);
  new Int32Array(engine.HEAPU8.buffer, offset, source.length).set(source);
  return offset;
}

function configureShapeMaterial(
  engine: HavokPhysicsWithBindings,
  shape: HP_ShapeId,
  descriptor: PhysicsWorkerShapeDescriptor,
): HP_ShapeId {
  engine.HP_Shape_SetDensity(shape, descriptor.density);
  engine.HP_Shape_SetMaterial(shape, [
    descriptor.friction,
    descriptor.friction,
    descriptor.restitution,
    engine.MaterialCombine.MINIMUM,
    engine.MaterialCombine.MAXIMUM,
  ]);
  return shape;
}

function createShape(
  engine: HavokPhysicsWithBindings,
  descriptor: PhysicsWorkerShapeDescriptor,
): HP_ShapeId {
  const dimensions = descriptor.dimensions;
  let shape: HP_ShapeId | undefined;

  try {
    switch (descriptor.type) {
      case 'Sphere':
        shape = engine.HP_Shape_CreateSphere([0, 0, 0], dimensions[0])[1];
        break;
      case 'Box':
        shape = engine.HP_Shape_CreateBox(
          [0, 0, 0],
          [0, 0, 0, 1],
          dimensions,
        )[1];
        break;
      case 'Cylinder':
        shape = engine.HP_Shape_CreateCylinder(
          [0, -dimensions[1] / 2, 0],
          [0, dimensions[1] / 2, 0],
          dimensions[0],
        )[1];
        break;
      case 'Capsules': {
        const endpoints = getCapsuleAxisEndpoints(dimensions[0], dimensions[1]);
        if (!endpoints) {
          throw new Error(
            'Capsule dimensions require a positive radius and a total height greater than or equal to twice the radius',
          );
        }
        shape = engine.HP_Shape_CreateCapsule(
          endpoints[0],
          endpoints[1],
          dimensions[0],
        )[1];
        break;
      }
      case 'ConvexHull': {
        if (!descriptor.vertices) {
          throw new Error('Convex hull body is missing its vertex buffer');
        }
        const vertices = new Float32Array(descriptor.vertices);
        const vertexOffset = copyFloat32ToHeap(engine, vertices);
        try {
          shape = engine.HP_Shape_CreateConvexHull(
            vertexOffset,
            vertices.length / 3,
          )[1];
        } finally {
          engine._free(vertexOffset);
        }
        break;
      }
      case 'TriMesh': {
        if (!descriptor.vertices || !descriptor.indices) {
          throw new Error('Tri-mesh body is missing vertex or index data');
        }
        const vertices = new Float32Array(descriptor.vertices);
        const indices = new Uint32Array(descriptor.indices);
        const vertexOffset = copyFloat32ToHeap(engine, vertices);
        const indexOffset = copyInt32ToHeap(engine, indices);
        try {
          shape = engine.HP_Shape_CreateMesh(
            vertexOffset,
            vertices.length / 3,
            indexOffset,
            indices.length / 3,
          )[1];
        } finally {
          engine._free(vertexOffset);
          engine._free(indexOffset);
        }
        break;
      }
    }

    return configureShapeMaterial(engine, shape, descriptor);
  } catch (error) {
    if (shape) {
      engine.HP_Shape_Release(shape);
    }
    throw error;
  }
}

function motionTypeForState(
  engine: HavokPhysicsWithBindings,
  state: PhysicsWorkerBodyState,
): MotionType {
  switch (state) {
    case 'STATIC':
      return engine.MotionType.STATIC;
    case 'KINEMATIC':
      return engine.MotionType.KINEMATIC;
    case 'DYNAMIC':
    default:
      return engine.MotionType.DYNAMIC;
  }
}

function removeBody(state: PhysicsRuntimeState, handle: number): void {
  const entry = state.bodies.get(handle);
  if (!entry) {
    return;
  }
  const [engine, world] = requireHavok(state);
  engine.HP_World_RemoveBody(world, entry.body);
  engine.HP_Body_Release(entry.body);
  engine.HP_Shape_Release(entry.shape);
  state.bodies.delete(handle);
  state.drivenBodies.delete(entry);
}

function addBody(
  state: PhysicsRuntimeState,
  message: PhysicsWorkerAddBodyMessage,
): [number, number, number] {
  const [engine, world] = requireHavok(state);
  removeBody(state, message.handle);

  const shape = createShape(engine, message.shape);
  let body: HP_BodyId | undefined;
  let addedToWorld = false;
  try {
    body = engine.HP_Body_Create()[1];
    engine.HP_Body_SetShape(body, shape);
    engine.HP_Body_SetQTransform(body, [message.position, message.quaternion]);
    engine.HP_Body_SetLinearDamping(body, message.linearDamping);
    engine.HP_Body_SetAngularDamping(body, message.angularDamping);
    engine.HP_Body_SetGravityFactor(body, message.gravityFactor);

    const shapeMass = engine.HP_Shape_BuildMassProperties(shape);
    const massProperties: MassProperties =
      shapeMass[0] === engine.Result.RESULT_OK
        ? shapeMass[1]
        : [[0, 0, 0], 1, [1, 1, 1], [0, 0, 0, 1]];

    if (message.centerOfMass.every((value) => value === Infinity)) {
      message.centerOfMass = [...massProperties[0]];
    } else {
      massProperties[0] = [...message.centerOfMass];
    }

    engine.HP_Body_SetMassProperties(body, massProperties);
    engine.HP_Body_SetMotionType(
      body,
      motionTypeForState(engine, message.state),
    );
    engine.HP_World_AddBody(world, body, false);
    addedToWorld = true;

    state.bodies.set(message.handle, {
      body,
      shape,
      state: message.state,
      transformOffset: engine.HP_Body_GetWorldTransformOffset(body)[1],
      targetVelocity: [0, 0, 0],
    });
  } catch (error) {
    if (body) {
      if (addedToWorld) {
        engine.HP_World_RemoveBody(world, body);
      }
      engine.HP_Body_Release(body);
    }
    engine.HP_Shape_Release(shape);
    throw error;
  }

  return message.centerOfMass;
}

function quaternionDot(left: Quaternion, right: Quaternion): number {
  return (
    left[0] * right[0] +
    left[1] * right[1] +
    left[2] * right[2] +
    left[3] * right[3]
  );
}

function isTrackingJump(
  previousVelocity: Vector3,
  velocity: Vector3,
  fromRotation: Quaternion,
  toRotation: Quaternion,
  duration: number,
): boolean {
  const velocityChange = Math.hypot(
    velocity[0] - previousVelocity[0],
    velocity[1] - previousVelocity[1],
    velocity[2] - previousVelocity[2],
  );
  const angle =
    2 *
    Math.acos(Math.min(1, Math.abs(quaternionDot(fromRotation, toRotation))));
  return (
    velocityChange > MAX_TARGET_ACCELERATION * duration ||
    angle > MAX_TARGET_ANGULAR_SPEED * duration
  );
}

function interpolateTransform(
  from: QTransform,
  to: QTransform,
  progress: number,
): QTransform {
  if (progress >= 1) {
    return to;
  }
  const [fromPosition, fromRotation] = from;
  const [toPosition, toRotation] = to;
  const sign = quaternionDot(fromRotation, toRotation) < 0 ? -1 : 1;
  const rotation = fromRotation.map(
    (value, index) => value + (sign * toRotation[index] - value) * progress,
  );
  const length = Math.hypot(...rotation);
  return [
    [
      fromPosition[0] + (toPosition[0] - fromPosition[0]) * progress,
      fromPosition[1] + (toPosition[1] - fromPosition[1]) * progress,
      fromPosition[2] + (toPosition[2] - fromPosition[2]) * progress,
    ],
    [
      rotation[0] / length,
      rotation[1] / length,
      rotation[2] / length,
      rotation[3] / length,
    ],
  ];
}

function applyCommands(
  state: PhysicsRuntimeState,
  buffer: ArrayBuffer,
  duration: number,
): TargetTransform[] {
  const [engine] = requireHavok(state);
  const ints = new Int32Array(buffer);
  const floats = new Float32Array(buffer);
  const commandCount = ints[PhysicsHeaderIndex.CommandCount];
  const targets: TargetTransform[] = [];

  for (let index = 0; index < commandCount; index++) {
    const base = PHYSICS_HEADER_WORDS + index * PHYSICS_INPUT_RECORD_FLOATS;
    const handle = floats[base + PhysicsInputOffset.Handle];
    const flags = floats[base + PhysicsInputOffset.Flags];
    const entry = state.bodies.get(handle);
    if (!entry) {
      continue;
    }

    if (flags & PhysicsCommandFlag.SetKinematicOverride) {
      engine.HP_Body_SetMotionType(
        entry.body,
        floats[base + PhysicsInputOffset.KinematicOverride]
          ? engine.MotionType.KINEMATIC
          : motionTypeForState(engine, entry.state),
      );
      // Each grab starts tracking from rest.
      entry.targetVelocity = [0, 0, 0];
      entry.drivenTarget = undefined;
    }
    if (
      flags &
      (PhysicsCommandFlag.SetTransform | PhysicsCommandFlag.SetTargetTransform)
    ) {
      const position: [number, number, number] = [
        floats[base + PhysicsInputOffset.PositionX],
        floats[base + PhysicsInputOffset.PositionY],
        floats[base + PhysicsInputOffset.PositionZ],
      ];
      const quaternion: [number, number, number, number] = [
        floats[base + PhysicsInputOffset.QuaternionX],
        floats[base + PhysicsInputOffset.QuaternionY],
        floats[base + PhysicsInputOffset.QuaternionZ],
        floats[base + PhysicsInputOffset.QuaternionW],
      ];
      if (flags & PhysicsCommandFlag.SetTransform) {
        engine.HP_Body_SetQTransform(entry.body, [position, quaternion]);
        entry.drivenTarget = undefined;
      }
      if (flags & PhysicsCommandFlag.SetTargetTransform && duration > 0) {
        const to: QTransform = [position, quaternion];
        let from = engine.HP_Body_GetQTransform(entry.body)[1];
        const velocity: Vector3 = [
          (position[0] - from[0][0]) / duration,
          (position[1] - from[0][1]) / duration,
          (position[2] - from[0][2]) / duration,
        ];
        if (
          isTrackingJump(
            entry.targetVelocity,
            velocity,
            from[1],
            quaternion,
            duration,
          )
        ) {
          engine.HP_Body_SetQTransform(entry.body, to);
          from = to;
        }
        entry.targetVelocity = velocity;
        targets.push({ entry, body: entry.body, from, to });
      }
    }
    if (flags & PhysicsCommandFlag.ResetLinearVelocity) {
      engine.HP_Body_SetLinearVelocity(entry.body, [0, 0, 0]);
    }
    if (flags & PhysicsCommandFlag.ResetAngularVelocity) {
      engine.HP_Body_SetAngularVelocity(entry.body, [0, 0, 0]);
    }
    if (flags & PhysicsCommandFlag.ApplyImpulse) {
      engine.HP_Body_ApplyImpulse(
        entry.body,
        [
          floats[base + PhysicsInputOffset.ImpulsePointX],
          floats[base + PhysicsInputOffset.ImpulsePointY],
          floats[base + PhysicsInputOffset.ImpulsePointZ],
        ],
        [
          floats[base + PhysicsInputOffset.ImpulseX],
          floats[base + PhysicsInputOffset.ImpulseY],
          floats[base + PhysicsInputOffset.ImpulseZ],
        ],
      );
    }
    if (flags & PhysicsCommandFlag.SetLinearVelocity) {
      engine.HP_Body_SetLinearVelocity(entry.body, [
        floats[base + PhysicsInputOffset.LinearVelocityX],
        floats[base + PhysicsInputOffset.LinearVelocityY],
        floats[base + PhysicsInputOffset.LinearVelocityZ],
      ]);
    }
    if (flags & PhysicsCommandFlag.SetAngularVelocity) {
      engine.HP_Body_SetAngularVelocity(entry.body, [
        floats[base + PhysicsInputOffset.AngularVelocityX],
        floats[base + PhysicsInputOffset.AngularVelocityY],
        floats[base + PhysicsInputOffset.AngularVelocityZ],
      ]);
    }
    if (flags & PhysicsCommandFlag.SetGravityFactor) {
      engine.HP_Body_SetGravityFactor(
        entry.body,
        floats[base + PhysicsInputOffset.GravityFactor],
      );
    }
    if (flags & PhysicsCommandFlag.SetLinearDamping) {
      engine.HP_Body_SetLinearDamping(
        entry.body,
        floats[base + PhysicsInputOffset.LinearDamping],
      );
    }
    if (flags & PhysicsCommandFlag.SetAngularDamping) {
      engine.HP_Body_SetAngularDamping(
        entry.body,
        floats[base + PhysicsInputOffset.AngularDamping],
      );
    }
  }
  return targets;
}

/**
 * Settles every body that was driven by a target in an earlier exchange but
 * got none in this one: it is placed on its last target and stopped, so a
 * kinematic platform that stops moving stays under its mesh.
 */
function settleUndrivenBodies(
  state: PhysicsRuntimeState,
  targets: TargetTransform[],
): void {
  const [engine] = requireHavok(state);
  const driven = new Set(targets.map((target) => target.entry));
  for (const entry of state.drivenBodies) {
    if (driven.has(entry)) {
      continue;
    }
    if (entry.drivenTarget) {
      engine.HP_Body_SetQTransform(entry.body, entry.drivenTarget);
      engine.HP_Body_SetLinearVelocity(entry.body, [0, 0, 0]);
      engine.HP_Body_SetAngularVelocity(entry.body, [0, 0, 0]);
    }
    entry.drivenTarget = undefined;
    state.drivenBodies.delete(entry);
  }
  for (const target of targets) {
    target.entry.drivenTarget = target.to;
    state.drivenBodies.add(target.entry);
  }
}

function writeQuaternionFromMatrix(
  heap: Float32Array,
  matrixBase: number,
  output: Float32Array,
  outputBase: number,
): void {
  const m11 = heap[matrixBase];
  const m12 = heap[matrixBase + 4];
  const m13 = heap[matrixBase + 8];
  const m21 = heap[matrixBase + 1];
  const m22 = heap[matrixBase + 5];
  const m23 = heap[matrixBase + 9];
  const m31 = heap[matrixBase + 2];
  const m32 = heap[matrixBase + 6];
  const m33 = heap[matrixBase + 10];
  const trace = m11 + m22 + m33;

  let x: number;
  let y: number;
  let z: number;
  let w: number;

  if (trace > 0) {
    const scale = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / scale;
    x = (m32 - m23) * scale;
    y = (m13 - m31) * scale;
    z = (m21 - m12) * scale;
  } else if (m11 > m22 && m11 > m33) {
    const scale = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / scale;
    x = 0.25 * scale;
    y = (m12 + m21) / scale;
    z = (m13 + m31) / scale;
  } else if (m22 > m33) {
    const scale = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / scale;
    x = (m12 + m21) / scale;
    y = 0.25 * scale;
    z = (m23 + m32) / scale;
  } else {
    const scale = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / scale;
    x = (m13 + m31) / scale;
    y = (m23 + m32) / scale;
    z = 0.25 * scale;
  }

  output[outputBase + PhysicsOutputOffset.QuaternionX] = x;
  output[outputBase + PhysicsOutputOffset.QuaternionY] = y;
  output[outputBase + PhysicsOutputOffset.QuaternionZ] = z;
  output[outputBase + PhysicsOutputOffset.QuaternionW] = w;
}

function writeResults(state: PhysicsRuntimeState, buffer: ArrayBuffer): void {
  const [engine, world] = requireHavok(state);
  const ints = new Int32Array(buffer);
  const floats = new Float32Array(buffer);
  const bodyBuffer = engine.HP_World_GetBodyBuffer(world)[1];
  const maxResults = Math.floor(
    (buffer.byteLength - PHYSICS_HEADER_BYTES) /
      (PHYSICS_OUTPUT_RECORD_FLOATS * 4),
  );
  let resultCount = 0;

  for (const [handle, entry] of state.bodies) {
    if (entry.state === 'STATIC') {
      continue;
    }
    if (resultCount === maxResults) {
      ints[PhysicsHeaderIndex.Status] |= PhysicsExchangeStatus.ResultsTruncated;
      break;
    }

    const base =
      PHYSICS_HEADER_WORDS + resultCount * PHYSICS_OUTPUT_RECORD_FLOATS;
    const matrixBase = (bodyBuffer + entry.transformOffset) >> 2;
    const linearVelocity = engine.HP_Body_GetLinearVelocity(entry.body)[1];
    const angularVelocity = engine.HP_Body_GetAngularVelocity(entry.body)[1];
    const heap = getHeapFloatView(state, engine);

    floats[base + PhysicsOutputOffset.Handle] = handle;
    floats[base + PhysicsOutputOffset.PositionX] = heap[matrixBase + 12];
    floats[base + PhysicsOutputOffset.PositionY] = heap[matrixBase + 13];
    floats[base + PhysicsOutputOffset.PositionZ] = heap[matrixBase + 14];
    writeQuaternionFromMatrix(heap, matrixBase, floats, base);
    floats[base + PhysicsOutputOffset.LinearVelocityX] = linearVelocity[0];
    floats[base + PhysicsOutputOffset.LinearVelocityY] = linearVelocity[1];
    floats[base + PhysicsOutputOffset.LinearVelocityZ] = linearVelocity[2];
    floats[base + PhysicsOutputOffset.AngularVelocityX] = angularVelocity[0];
    floats[base + PhysicsOutputOffset.AngularVelocityY] = angularVelocity[1];
    floats[base + PhysicsOutputOffset.AngularVelocityZ] = angularVelocity[2];
    resultCount++;
  }

  ints[PhysicsHeaderIndex.ResultCount] = resultCount;
}

export interface PhysicsRuntimeStepResult {
  buffer: ArrayBuffer;
  error?: string;
}

/** Shared Havok runtime used by both main-thread and worker transports. */
export class PhysicsRuntime {
  private readonly state: PhysicsRuntimeState = {
    bodies: new Map<number, WorkerBody>(),
    drivenBodies: new Set<WorkerBody>(),
    destroyed: false,
  };

  initialize(gravity: [number, number, number]): Promise<void> {
    return initialize(this.state, gravity);
  }

  setGravity(gravity: [number, number, number]): void {
    const [engine, world] = requireHavok(this.state);
    engine.HP_World_SetGravity(world, gravity);
  }

  addBody(message: PhysicsWorkerAddBodyMessage): [number, number, number] {
    return addBody(this.state, message);
  }

  removeBody(handle: number): void {
    removeBody(this.state, handle);
  }

  step(buffer: ArrayBuffer): PhysicsRuntimeStepResult {
    const ints = new Int32Array(buffer);
    try {
      if (ints[PhysicsHeaderIndex.Version] !== PHYSICS_PROTOCOL_VERSION) {
        throw new Error('Physics exchange buffer protocol version mismatch');
      }
      const [engine, world] = requireHavok(this.state);
      const floats = new Float32Array(buffer);
      const delta = floats[PhysicsHeaderIndex.Delta];
      const stepCount = Math.max(0, ints[PhysicsHeaderIndex.StepCount]);
      const targets = applyCommands(this.state, buffer, delta * stepCount);
      if (stepCount > 0) {
        settleUndrivenBodies(this.state, targets);
      }
      for (let index = 0; index < stepCount; index++) {
        // Havok reaches a target within one step and keeps that velocity, so
        // every substep gets its share of the motion.
        const progress = (index + 1) / stepCount;
        for (const target of targets) {
          engine.HP_Body_SetTargetQTransform(
            target.body,
            interpolateTransform(target.from, target.to, progress),
          );
        }
        engine.HP_World_SetIdealStepTime(world, delta);
        engine.HP_World_Step(world, delta);
      }
      writeResults(this.state, buffer);
      return { buffer };
    } catch (error) {
      ints[PhysicsHeaderIndex.Status] |= PhysicsExchangeStatus.StepFailed;
      ints[PhysicsHeaderIndex.ResultCount] = 0;
      return {
        buffer,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  destroy(): void {
    if (this.state.destroyed) {
      return;
    }
    this.state.destroyed = true;
    for (const handle of [...this.state.bodies.keys()]) {
      removeBody(this.state, handle);
    }
    if (this.state.havok && this.state.havokWorld) {
      this.state.havok.HP_World_Release(this.state.havokWorld);
    }
    this.state.havok = undefined;
    this.state.havokWorld = undefined;
    this.state.heapFloatView = undefined;
    this.state.initializePromise = undefined;
  }
}
