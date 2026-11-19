/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhysicsRuntime } from '../../src/physics/physics-runtime.js';
import {
  PHYSICS_HEADER_WORDS,
  PHYSICS_PROTOCOL_VERSION,
  PhysicsCommandFlag,
  PhysicsExchangeStatus,
  PhysicsHeaderIndex,
  PhysicsInputOffset,
  PhysicsOutputOffset,
  physicsExchangeByteLength,
  type PhysicsWorkerAddBodyMessage,
} from '../../src/physics/physics-worker-protocol.js';

const havokMock = vi.hoisted(() => {
  const heap = new Float32Array(256);
  const bodyOffsets = new Map<bigint, number>();
  let nextBodyId = 20n;
  let nextShapeId = 10n;

  const writeTransform = (
    body: [bigint],
    transform: [[number, number, number], [number, number, number, number]],
  ) => {
    const base = (bodyOffsets.get(body[0]) ?? 0) >> 2;
    const [position] = transform;
    heap[base] = 1;
    heap[base + 5] = 1;
    heap[base + 10] = 1;
    heap[base + 15] = 1;
    heap[base + 12] = position[0];
    heap[base + 13] = position[1];
    heap[base + 14] = position[2];
  };

  const engine = {
    HEAPU8: new Uint8Array(heap.buffer),
    MaterialCombine: { MINIMUM: 0, MAXIMUM: 1 },
    MotionType: { STATIC: 0, DYNAMIC: 1, KINEMATIC: 2 },
    Result: { RESULT_OK: 0 },
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HP_World_Create: vi.fn(() => [0, [1n]]),
    HP_World_SetGravity: vi.fn(),
    HP_World_Release: vi.fn(),
    HP_World_AddBody: vi.fn(),
    HP_World_RemoveBody: vi.fn(),
    HP_World_GetBodyBuffer: vi.fn(() => [0, 0]),
    HP_World_SetIdealStepTime: vi.fn(),
    HP_World_Step: vi.fn(() => {
      for (const offset of bodyOffsets.values()) {
        heap[(offset >> 2) + 13] -= 0.01;
      }
    }),
    HP_Shape_CreateSphere: vi.fn(() => [0, [nextShapeId++]]),
    HP_Shape_CreateBox: vi.fn(() => [0, [nextShapeId++]]),
    HP_Shape_CreateCylinder: vi.fn(() => [0, [nextShapeId++]]),
    HP_Shape_CreateCapsule: vi.fn(() => [0, [nextShapeId++]]),
    HP_Shape_CreateConvexHull: vi.fn(() => [0, [nextShapeId++]]),
    HP_Shape_CreateMesh: vi.fn(() => [0, [nextShapeId++]]),
    HP_Shape_SetDensity: vi.fn(),
    HP_Shape_SetMaterial: vi.fn(),
    HP_Shape_BuildMassProperties: vi.fn(() => [
      0,
      [[0, 0, 0], 1, [1, 1, 1], [0, 0, 0, 1]],
    ]),
    HP_Shape_Release: vi.fn(),
    HP_Body_Create: vi.fn(() => {
      const id = nextBodyId++;
      bodyOffsets.set(id, Number(id - 20n) * 64);
      return [0, [id]];
    }),
    HP_Body_SetShape: vi.fn(),
    HP_Body_SetQTransform: vi.fn(writeTransform),
    HP_Body_GetQTransform: vi.fn((body: [bigint]) => {
      const base = (bodyOffsets.get(body[0]) ?? 0) >> 2;
      return [
        0,
        [
          [heap[base + 12], heap[base + 13], heap[base + 14]],
          [0, 0, 0, 1],
        ],
      ];
    }),
    HP_Body_SetTargetQTransform: vi.fn(),
    HP_Body_SetLinearDamping: vi.fn(),
    HP_Body_SetAngularDamping: vi.fn(),
    HP_Body_SetGravityFactor: vi.fn(),
    HP_Body_SetMassProperties: vi.fn(),
    HP_Body_SetMotionType: vi.fn(),
    HP_Body_GetWorldTransformOffset: vi.fn((body: [bigint]) => [
      0,
      bodyOffsets.get(body[0]) ?? 0,
    ]),
    HP_Body_SetLinearVelocity: vi.fn(),
    HP_Body_SetAngularVelocity: vi.fn(),
    HP_Body_GetLinearVelocity: vi.fn(() => [0, [1, 2, 3]]),
    HP_Body_GetAngularVelocity: vi.fn(() => [0, [4, 5, 6]]),
    HP_Body_ApplyImpulse: vi.fn(),
    HP_Body_Release: vi.fn(),
  };

  return {
    engine,
    reset() {
      heap.fill(0);
      bodyOffsets.clear();
      nextBodyId = 20n;
      nextShapeId = 10n;
      for (const value of Object.values(engine)) {
        if (typeof value === 'function' && 'mockClear' in value) {
          value.mockClear();
        }
      }
      engine.HP_Body_SetQTransform.mockImplementation(writeTransform);
    },
  };
});

vi.mock('@babylonjs/havok', () => ({
  default: vi.fn(async () => havokMock.engine),
}));

function bodyMessage(handle: number): PhysicsWorkerAddBodyMessage {
  return {
    type: 'add-body',
    handle,
    shape: {
      type: 'Sphere',
      dimensions: [0.5, 0.5, 0.5],
      density: 1,
      restitution: 0,
      friction: 0.5,
    },
    state: 'DYNAMIC',
    position: [0, 1, 0],
    quaternion: [0, 0, 0, 1],
    linearDamping: 0,
    angularDamping: 0,
    gravityFactor: 1,
    centerOfMass: [Infinity, Infinity, Infinity],
  };
}

function commandExchange(
  stepCount: number,
  writeCommand: (floats: Float32Array, base: number) => void,
): ArrayBuffer {
  const buffer = new ArrayBuffer(physicsExchangeByteLength(1, 1));
  const ints = new Int32Array(buffer);
  const floats = new Float32Array(buffer);
  ints[PhysicsHeaderIndex.Version] = PHYSICS_PROTOCOL_VERSION;
  ints[PhysicsHeaderIndex.CommandCount] = 1;
  ints[PhysicsHeaderIndex.StepCount] = stepCount;
  floats[PhysicsHeaderIndex.Delta] = 1 / 60;
  writeCommand(floats, PHYSICS_HEADER_WORDS);
  return buffer;
}

function targetExchange(stepCount: number, x: number): ArrayBuffer {
  return commandExchange(stepCount, (floats, base) => {
    floats[base + PhysicsInputOffset.Handle] = 7;
    floats[base + PhysicsInputOffset.Flags] =
      PhysicsCommandFlag.SetTargetTransform;
    floats[base + PhysicsInputOffset.PositionX] = x;
    floats[base + PhysicsInputOffset.PositionY] = 1;
    floats[base + PhysicsInputOffset.QuaternionW] = 1;
  });
}

function overrideExchange(kinematic: number): ArrayBuffer {
  return commandExchange(0, (floats, base) => {
    floats[base + PhysicsInputOffset.Handle] = 7;
    floats[base + PhysicsInputOffset.Flags] =
      PhysicsCommandFlag.SetKinematicOverride;
    floats[base + PhysicsInputOffset.KinematicOverride] = kinematic;
  });
}

beforeEach(() => {
  havokMock.reset();
});

describe('PhysicsRuntime', () => {
  it('updates gravity and releases the Havok world on teardown', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    runtime.setGravity([0, -1.62, 0]);
    runtime.destroy();

    expect(havokMock.engine.HP_World_SetGravity).toHaveBeenNthCalledWith(
      1,
      [1n],
      [0, -9.81, 0],
    );
    expect(havokMock.engine.HP_World_SetGravity).toHaveBeenNthCalledWith(
      2,
      [1n],
      [0, -1.62, 0],
    );
    expect(havokMock.engine.HP_World_Release).toHaveBeenCalledWith([1n]);
  });

  it('applies encoded commands and writes poses, rotations, and velocities', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    runtime.addBody(bodyMessage(7));

    const buffer = new ArrayBuffer(physicsExchangeByteLength(1, 1));
    const ints = new Int32Array(buffer);
    const floats = new Float32Array(buffer);
    ints[PhysicsHeaderIndex.Version] = PHYSICS_PROTOCOL_VERSION;
    ints[PhysicsHeaderIndex.CommandCount] = 1;
    ints[PhysicsHeaderIndex.StepCount] = 1;
    floats[PhysicsHeaderIndex.Delta] = 1 / 60;
    const base = PHYSICS_HEADER_WORDS;
    floats[base + PhysicsInputOffset.Handle] = 7;
    floats[base + PhysicsInputOffset.Flags] =
      PhysicsCommandFlag.SetLinearVelocity |
      PhysicsCommandFlag.SetGravityFactor;
    floats[base + PhysicsInputOffset.LinearVelocityX] = 8;
    floats[base + PhysicsInputOffset.LinearVelocityY] = 9;
    floats[base + PhysicsInputOffset.LinearVelocityZ] = 10;
    floats[base + PhysicsInputOffset.GravityFactor] = 0.5;

    const result = runtime.step(buffer);

    expect(result.error).toBeUndefined();
    expect(havokMock.engine.HP_Body_SetLinearVelocity).toHaveBeenLastCalledWith(
      [20n],
      [8, 9, 10],
    );
    expect(havokMock.engine.HP_Body_SetGravityFactor).toHaveBeenLastCalledWith(
      [20n],
      0.5,
    );
    expect(ints[PhysicsHeaderIndex.ResultCount]).toBe(1);
    expect(floats[base + PhysicsOutputOffset.Handle]).toBe(7);
    expect(floats[base + PhysicsOutputOffset.PositionY]).toBeCloseTo(0.99);
    expect(floats[base + PhysicsOutputOffset.QuaternionX]).toBe(0);
    expect(floats[base + PhysicsOutputOffset.QuaternionY]).toBe(0);
    expect(floats[base + PhysicsOutputOffset.QuaternionZ]).toBe(0);
    expect(floats[base + PhysicsOutputOffset.QuaternionW]).toBe(1);
    expect(floats[base + PhysicsOutputOffset.LinearVelocityX]).toBe(1);
    expect(floats[base + PhysicsOutputOffset.AngularVelocityZ]).toBe(6);
  });

  it('flags truncated result buffers', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    runtime.addBody(bodyMessage(1));
    runtime.addBody(bodyMessage(2));
    const buffer = new ArrayBuffer(physicsExchangeByteLength(0, 1));
    const ints = new Int32Array(buffer);
    const floats = new Float32Array(buffer);
    ints[PhysicsHeaderIndex.Version] = PHYSICS_PROTOCOL_VERSION;
    ints[PhysicsHeaderIndex.StepCount] = 1;
    floats[PhysicsHeaderIndex.Delta] = 1 / 60;

    runtime.step(buffer);

    expect(ints[PhysicsHeaderIndex.ResultCount]).toBe(1);
    expect(
      ints[PhysicsHeaderIndex.Status] & PhysicsExchangeStatus.ResultsTruncated,
    ).toBe(PhysicsExchangeStatus.ResultsTruncated);
  });

  it('applies command-only exchanges without stepping the world', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    runtime.addBody(bodyMessage(7));
    const buffer = new ArrayBuffer(physicsExchangeByteLength(1, 1));
    const ints = new Int32Array(buffer);
    const floats = new Float32Array(buffer);
    ints[PhysicsHeaderIndex.Version] = PHYSICS_PROTOCOL_VERSION;
    ints[PhysicsHeaderIndex.CommandCount] = 1;
    ints[PhysicsHeaderIndex.StepCount] = 0;
    const base = PHYSICS_HEADER_WORDS;
    floats[base + PhysicsInputOffset.Handle] = 7;
    floats[base + PhysicsInputOffset.Flags] =
      PhysicsCommandFlag.SetLinearVelocity;
    floats[base + PhysicsInputOffset.LinearVelocityX] = 8;
    floats[base + PhysicsInputOffset.LinearVelocityY] = 9;
    floats[base + PhysicsInputOffset.LinearVelocityZ] = 10;

    const result = runtime.step(buffer);

    expect(result.error).toBeUndefined();
    expect(havokMock.engine.HP_Body_SetLinearVelocity).toHaveBeenCalledWith(
      [20n],
      [8, 9, 10],
    );
    expect(havokMock.engine.HP_World_Step).not.toHaveBeenCalled();
    expect(ints[PhysicsHeaderIndex.ResultCount]).toBe(1);
  });

  it('switches a body to kinematic and back to its created motion type', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    runtime.addBody(bodyMessage(7));

    runtime.step(overrideExchange(1));
    expect(havokMock.engine.HP_Body_SetMotionType).toHaveBeenLastCalledWith(
      [20n],
      havokMock.engine.MotionType.KINEMATIC,
    );

    runtime.step(overrideExchange(0));
    expect(havokMock.engine.HP_Body_SetMotionType).toHaveBeenLastCalledWith(
      [20n],
      havokMock.engine.MotionType.DYNAMIC,
    );
  });

  it('spreads a target transform across every substep', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    runtime.addBody(bodyMessage(7));

    runtime.step(targetExchange(4, 0.04));

    const targets = havokMock.engine.HP_Body_SetTargetQTransform.mock.calls;
    expect(targets).toHaveLength(4);
    targets.forEach(([body, [position, rotation]], index) => {
      expect(body).toEqual([20n]);
      expect(position[0]).toBeCloseTo(0.01 * (index + 1));
      expect(position[1]).toBeCloseTo(1);
      expect(rotation).toEqual([0, 0, 0, 1]);
    });
    expect(havokMock.engine.HP_Body_SetQTransform).toHaveBeenCalledTimes(1);
  });

  it('teleports to a target that jumps faster than a hand can move', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    runtime.addBody(bodyMessage(7));

    runtime.step(targetExchange(1, 0.2));

    expect(havokMock.engine.HP_Body_SetQTransform).toHaveBeenCalledTimes(2);
    const [body, [position]] =
      havokMock.engine.HP_Body_SetQTransform.mock.lastCall!;
    expect(body).toEqual([20n]);
    expect(position[0]).toBeCloseTo(0.2);
    const [, [target]] =
      havokMock.engine.HP_Body_SetTargetQTransform.mock.lastCall!;
    expect(target[0]).toBeCloseTo(0.2);
  });

  it('judges the first target of a new grab against rest', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    runtime.addBody(bodyMessage(7));
    runtime.step(targetExchange(1, 0.2));
    runtime.step(overrideExchange(0));
    runtime.step(overrideExchange(1));

    runtime.step(targetExchange(1, 0.21));

    expect(havokMock.engine.HP_Body_SetQTransform).toHaveBeenCalledTimes(2);
  });

  it('releases partial allocations when body creation fails', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    havokMock.engine.HP_Body_SetQTransform.mockImplementationOnce(() => {
      throw new Error('invalid transform');
    });

    expect(() => runtime.addBody(bodyMessage(1))).toThrow('invalid transform');
    expect(havokMock.engine.HP_Body_Release).toHaveBeenCalledWith([20n]);
    expect(havokMock.engine.HP_Shape_Release).toHaveBeenCalledWith([10n]);
  });

  it('releases a shape when material configuration fails', async () => {
    const runtime = new PhysicsRuntime();
    await runtime.initialize([0, -9.81, 0]);
    havokMock.engine.HP_Shape_SetMaterial.mockImplementationOnce(() => {
      throw new Error('invalid material');
    });

    expect(() => runtime.addBody(bodyMessage(1))).toThrow('invalid material');
    expect(havokMock.engine.HP_Shape_Release).toHaveBeenCalledWith([10n]);
    expect(havokMock.engine.HP_Body_Create).not.toHaveBeenCalled();
  });
});
