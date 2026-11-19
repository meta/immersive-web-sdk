/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from 'elics';
import { describe, expect, it, vi } from 'vitest';
import { Grabbed } from '../../src/grab/grabbed.js';
import { PhysicsSystem } from '../../src/physics/physics-system.js';
import { PhysicsCommandFlag } from '../../src/physics/physics-worker-protocol.js';
import { PhysicsBody, PhysicsState } from '../../src/physics/physicsBody.js';
import {
  PhysicsShape,
  PhysicsShapeType,
} from '../../src/physics/physicsShape.js';
import { Object3D, Quaternion, Vector3 } from '../../src/runtime/three.js';

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

const BODY_ID = 7;

type PhysicsStateValue = (typeof PhysicsState)[keyof typeof PhysicsState];

function setup(state: PhysicsStateValue = PhysicsState.Dynamic) {
  const world = new World();
  // Registered first so its type id never collides with the physics
  // components registered by an earlier test's world.
  world.registerComponent(Grabbed);
  const queries = Object.fromEntries(
    Object.entries((PhysicsSystem as any).queries).map(([name, query]) => [
      name,
      world.queryManager.registerQuery(query as any),
    ]),
  );
  const system = new PhysicsSystem({} as any, world.queryManager as any, 0);
  (system as any).queries = queries;
  (system as any).transport = { postMessage: vi.fn() };

  const entity = world.createEntity();
  entity.object3D = new Object3D();
  entity.addComponent(PhysicsShape, {
    shape: PhysicsShapeType.Box,
    dimensions: [1, 1, 1],
  });
  entity.addComponent(PhysicsBody, { state });
  entity.setValue(PhysicsBody, '_engineBody', BODY_ID);
  (system as any).bodyEntities.set(BODY_ID, entity);
  (system as any).bodySnapshots.set(BODY_ID, {
    previousPosition: new Vector3(),
    currentPosition: new Vector3(),
    previousQuaternion: new Quaternion(),
    currentQuaternion: new Quaternion(),
  });

  return { system, entity };
}

const pending = (system: PhysicsSystem) =>
  (system as any).pendingCommands.get(BODY_ID);

function grab(
  move: (object3D: Object3D) => void = () => {},
  {
    frames = 30,
    state = PhysicsState.Dynamic,
  }: { frames?: number; state?: PhysicsStateValue } = {},
) {
  const { system, entity } = setup(state);
  entity.addComponent(Grabbed);
  for (let frame = 0; frame < frames; frame++) {
    move(entity.object3D!);
    system.update(1 / 60);
  }
  return { system, entity };
}

function release(
  system: PhysicsSystem,
  entity: ReturnType<typeof setup>['entity'],
) {
  entity.removeComponent(Grabbed);
  system.update(1 / 60);
  return pending(system);
}

describe('PhysicsSystem grabbed bodies', () => {
  it('drives a grabbed dynamic body kinematically', () => {
    const { system } = grab(undefined, { frames: 1 });

    const command = pending(system);
    expect(command.flags & PhysicsCommandFlag.SetTargetTransform).toBe(
      PhysicsCommandFlag.SetTargetTransform,
    );
    expect(command.flags & PhysicsCommandFlag.SetKinematicOverride).toBe(
      PhysicsCommandFlag.SetKinematicOverride,
    );
    expect(command.kinematicOverride).toBe(true);
  });

  it.each([PhysicsState.Kinematic, PhysicsState.Static])(
    'leaves the motion type of %s bodies alone',
    (state) => {
      const { system, entity } = grab((object3D) => object3D.translateX(1), {
        state,
      });

      const command = release(system, entity);
      expect(command.flags & PhysicsCommandFlag.SetKinematicOverride).toBe(0);
      expect(command.flags & PhysicsCommandFlag.SetLinearVelocity).toBe(0);
    },
  );

  it('restores the motion type and releases a still hand at rest', () => {
    const { system, entity } = grab((object3D) =>
      object3D.position.set(1, 2, 3),
    );

    const command = release(system, entity);
    expect(command.flags & PhysicsCommandFlag.SetKinematicOverride).toBe(
      PhysicsCommandFlag.SetKinematicOverride,
    );
    expect(command.kinematicOverride).toBe(false);
    expect(command.flags & PhysicsCommandFlag.SetTransform).toBe(
      PhysicsCommandFlag.SetTransform,
    );
    expect(command.flags & PhysicsCommandFlag.SetTargetTransform).toBe(0);
    expect(command.position).toEqual([1, 2, 3]);
    expect(command.linearVelocity).toEqual([0, 0, 0]);
    expect(command.angularVelocity).toEqual([0, 0, 0]);
  });

  it('releases with the smoothed hand velocity', () => {
    const { system, entity } = grab((object3D) => {
      object3D.position.x += 0.02;
      object3D.rotateY(0.01);
    });

    const command = release(system, entity);
    expect(command.linearVelocity[0]).toBeCloseTo(1.2, 3);
    expect(command.linearVelocity[1]).toBeCloseTo(0, 6);
    expect(command.angularVelocity[1]).toBeCloseTo(0.6, 3);
    expect(entity.getVectorView(PhysicsBody, '_linearVelocity')[0]).toBeCloseTo(
      1.2,
      3,
    );
  });

  it('attenuates a single-frame tracking jump just before release', () => {
    const { system, entity } = grab();
    // 20 cm in one 60 Hz frame reads as 12 m/s.
    entity.object3D!.position.y += 0.2;
    system.update(1 / 60);

    const command = release(system, entity);
    expect(command.linearVelocity[1]).toBeGreaterThan(0);
    expect(command.linearVelocity[1]).toBeLessThan(6);
  });

  it('caps the release velocity', () => {
    const { system, entity } = grab((object3D) => {
      object3D.position.y += 1;
      object3D.rotateX(1);
    });

    const command = release(system, entity);
    expect(Math.hypot(...command.linearVelocity)).toBeCloseTo(10);
    expect(Math.hypot(...command.angularVelocity)).toBeCloseTo(4 * Math.PI);
  });

  it('forgets grab state when a held body is removed', () => {
    const { system, entity } = grab(undefined, { frames: 1 });

    (system as any).removeBody(entity);

    expect((system as any).grabbedBodies.size).toBe(0);
  });
});
