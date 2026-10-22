/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkinnedMesh,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  type InputLayout,
  loadInputProfile,
} from '../src/gamepad/input-profiles.js';
import { AnimatedControllerHand } from '../src/visual/impl/animated-controller-hand.js';
import { AnimatedController } from '../src/visual/impl/animated-controller.js';

const MAX_POSITION_Y = 0.01;

// Samsung Galaxy XR controllers report six buttons, while the samsung-galaxyxr
// input profile maps thumbrest and menu to buttons 6 and 7.
function createInputSource(buttonCount: number, axisCount: number) {
  return {
    handedness: 'left',
    profiles: ['samsung-galaxyxr', 'oculus-touch'],
    gamepad: {
      mapping: 'xr-standard',
      buttons: Array.from({ length: buttonCount }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      })),
      axes: new Array<number>(axisCount).fill(0),
    },
  } as unknown as XRInputSource;
}

// Stand-in for the controller glTF: one empty node per visual response node,
// with every max node offset so animated value nodes visibly move.
function createModel(layout: InputLayout) {
  const model = new Group();
  for (const component of Object.values(layout.components)) {
    for (const response of Object.values(component.visualResponses)) {
      for (const name of [
        response.valueNodeName,
        response.minNodeName,
        response.maxNodeName,
      ]) {
        if (name && !model.getObjectByName(name)) {
          const node = new Object3D();
          node.name = name;
          if (name === response.maxNodeName) {
            node.position.y = MAX_POSITION_Y;
          }
          model.add(node);
        }
      }
    }
  }
  return model;
}

function connectController(inputSource: XRInputSource) {
  const { layout, resolvedProfileId } = loadInputProfile(inputSource);
  expect(resolvedProfileId).toBe('samsung-galaxyxr');
  const model = createModel(layout);
  const controller = new AnimatedController(
    new Scene(),
    new PerspectiveCamera(),
    model,
    layout,
  );
  controller.init();
  controller.connect(inputSource, true);
  return { controller, model };
}

function expectFiniteTransform(model: Group, nodeName: string) {
  const node = model.getObjectByName(nodeName);
  expect(node).toBeDefined();
  expect(node!.position.toArray().every(Number.isFinite)).toBe(true);
  expect(node!.quaternion.toArray().every(Number.isFinite)).toBe(true);
}

describe('AnimatedController', () => {
  it('skips profile buttons the gamepad does not report', () => {
    const inputSource = createInputSource(6, 4);
    const { controller, model } = connectController(inputSource);
    (inputSource.gamepad!.buttons[0] as { value: number }).value = 1;

    expect(() => controller.update()).not.toThrow();

    expect(
      model.getObjectByName('xr_standard_trigger_pressed_value')!.position.y,
    ).toBeCloseTo(MAX_POSITION_Y);
    expectFiniteTransform(model, 'thumbrest_pressed_value');
    expectFiniteTransform(model, 'menu_pressed_value');
  });

  it('skips profile axes the gamepad does not report', () => {
    const inputSource = createInputSource(8, 2);
    const { controller, model } = connectController(inputSource);

    expect(() => controller.update()).not.toThrow();

    expectFiniteTransform(model, 'xr_standard_thumbstick_xaxis_pressed_value');
    expectFiniteTransform(model, 'xr_standard_thumbstick_yaxis_pressed_value');
  });
});

describe('AnimatedControllerHand', () => {
  it('keeps joints at rest for buttons the gamepad does not report', () => {
    const inputSource = createInputSource(2, 0);
    const { layout } = loadInputProfile(inputSource);
    const model = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(3), 3),
    );
    const meshRoot = new Group();
    meshRoot.add(new SkinnedMesh(geometry));
    model.add(meshRoot);
    for (const jointName of Object.keys(AnimatedControllerHand.defaultPose)) {
      const joint = new Object3D();
      joint.name = jointName;
      model.add(joint);
    }
    const visual = new AnimatedControllerHand(
      model,
      new Scene(),
      new PerspectiveCamera(),
      layout,
    );
    visual.init();
    visual.connect(inputSource, true);

    // The thumb joints read button 3, which a two-button gamepad lacks.
    expect(() => visual.update(1 / 60)).not.toThrow();

    expectFiniteTransform(model, 'thumb-phalanx-distal');
  });
});
