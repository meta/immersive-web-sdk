/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/entity.js';
import { createSystem } from '../../src/ecs/system.js';
import { World } from '../../src/ecs/world.js';
import {
  DirectionalLightComponent,
  LightSystem,
  SpotLightComponent,
} from '../../src/lighting/index.js';
import {
  DirectionalLight,
  DirectionalLightHelper,
  Object3D,
  Scene,
  SpotLight,
  SpotLightHelper,
  Vector3,
} from '../../src/runtime/index.js';
import { Transform } from '../../src/transform/index.js';

type Move = (object: Object3D) => void;
type Moves = { early?: Move; late?: Move };

/** A system that applies `moves[phase]` to every light entity it runs on. */
function moverSystem(moves: Moves, phase: keyof Moves) {
  return class extends createSystem({
    directional: { required: [DirectionalLightComponent] },
    spot: { required: [SpotLightComponent] },
  }) {
    update(): void {
      const move = moves[phase];
      if (move == null) {
        return;
      }
      for (const entity of [
        ...this.queries.directional.entities,
        ...this.queries.spot.entities,
      ]) {
        move(entity.object3D!);
      }
    }
  };
}

function createLightWorld() {
  const moves: Moves = {};
  const world = new World();
  world.scene = new Scene();
  world
    .registerComponent(Transform)
    .registerComponent(DirectionalLightComponent)
    .registerComponent(SpotLightComponent);
  world.sceneEntity = world.createTransformEntity(world.scene);
  world
    .registerSystem(moverSystem(moves, 'early'), { priority: -1 })
    .registerSystem(LightSystem)
    // Same priority, registered later: it runs after LightSystem.
    .registerSystem(moverSystem(moves, 'late'));
  return { moves, world };
}

function lightOf(entity: Entity): DirectionalLight | SpotLight {
  return entity.object3D!.children.find(
    (child) =>
      (child as DirectionalLight).isDirectionalLight ||
      (child as SpotLight).isSpotLight,
  ) as DirectionalLight | SpotLight;
}

/** World direction of an object's local -Z. */
function forwardOf(object: Object3D): Vector3 {
  return new Vector3()
    .setFromMatrixColumn(object.matrixWorld, 2)
    .negate()
    .normalize();
}

/** World direction of a helper part's local +Z (Object3D.lookAt turns it to the target). */
function aimOf(part: Object3D): Vector3 {
  part.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixColumn(part.matrixWorld, 2).normalize();
}

describe('LightSystem', () => {
  it('keeps a light moved after LightSystem aimed along its -Z in the same frame', () => {
    const { moves, world } = createLightWorld();
    const sun = world.createTransformEntity(undefined, {
      parent: world.sceneEntity,
    });
    sun.object3D!.position.set(10, 40, 25);
    sun.object3D!.rotation.set(-1.24, 0.73, 0);
    sun.addComponent(DirectionalLightComponent, { castShadow: true });
    const lamp = world.createTransformEntity(undefined, {
      parent: world.sceneEntity,
    });
    lamp.object3D!.position.set(1, 2.5, -1);
    lamp.object3D!.rotation.set(-1.2, 0.3, 0);
    lamp.addComponent(SpotLightComponent, { castShadow: true });
    const helpers = [
      {
        entity: sun,
        helper: new DirectionalLightHelper(lightOf(sun) as DirectionalLight),
      },
      { entity: lamp, helper: new SpotLightHelper(lightOf(lamp) as SpotLight) },
    ];

    const frames: Moves[] = [
      // before LightSystem: it aims the light from where the light now stands
      { early: (object) => object.translateZ(-1) },
      // after LightSystem: a 1 m step along the light puts the old target on it
      { late: (object) => object.translateZ(-1) },
      // past it, the old target is behind the light
      { late: (object) => object.translateZ(-1.5) },
      // a step across the light would tilt it 14 degrees
      { late: (object) => object.translateX(0.25) },
      // and a turn would leave it aimed the old way
      { late: (object) => object.rotateY(0.5).rotateX(0.1) },
      {
        early: (object) => object.translateY(0.5),
        late: (object) => object.translateZ(0.75),
      },
      {},
    ];
    frames.forEach((frame, index) => {
      moves.early = frame.early;
      moves.late = frame.late;
      world.update(1 / 72, index / 72);
      // WebGLRenderer.render() starts with this (scene.matrixWorldAutoUpdate)
      world.scene.updateMatrixWorld();

      for (const entity of [sun, lamp]) {
        const object = entity.object3D!;
        const light = lightOf(entity);
        const forward = forwardOf(object);
        const lightPosition = new Vector3().setFromMatrixPosition(
          light.matrixWorld,
        );
        const targetPosition = new Vector3().setFromMatrixPosition(
          light.target.matrixWorld,
        );
        expect(
          lightPosition.distanceTo(
            new Vector3().setFromMatrixPosition(object.matrixWorld),
          ),
          `frame ${index}: light position`,
        ).toBeLessThan(1e-6);
        // WebGLLights shades along light - target
        expect(
          targetPosition.sub(lightPosition).distanceTo(forward),
          `frame ${index}: light to target`,
        ).toBeLessThan(1e-6);
        // and LightShadow aims the shadow camera from the light at the target
        light.shadow.updateMatrices(light);
        expect(
          light.shadow.camera
            .getWorldDirection(new Vector3())
            .distanceTo(forward),
          `frame ${index}: shadow camera`,
        ).toBeLessThan(1e-6);
      }
      for (const { entity, helper } of helpers) {
        helper.update();
        const part =
          helper instanceof DirectionalLightHelper
            ? helper.targetLine
            : helper.cone;
        expect(
          aimOf(part).distanceTo(forwardOf(entity.object3D!)),
          `frame ${index}: ${helper.type}`,
        ).toBeLessThan(1e-6);
      }
    });
  });
});
