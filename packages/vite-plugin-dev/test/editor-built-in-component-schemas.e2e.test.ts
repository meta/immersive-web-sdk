/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, test } from 'vitest';
import {
  addComponentViaPicker,
  createEditorTestHarness,
  dispatchSceneTool,
  expectRealWebGLViewport,
  selectNode,
  type EditorPageContext,
  type EditorTestHarness,
} from './editor-e2e-fixture.js';

let harness: EditorTestHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('editor built-in component schemas', () => {
  test('exposes IWSDK component schemas and commits representative typed built-in fields', async () => {
    harness = await createEditorTestHarness('editor-component-schema-matrix');
    const editor = await harness.openEditor();
    await expectRealWebGLViewport(editor);
    await selectNode(editor.page, 'table-1');

    await expect
      .poll(() => componentOptions(editor))
      .toEqual(
        expect.arrayContaining([
          'AudioSource',
          'AmbientLight',
          'DirectionalLight',
          'DistanceGrabbable',
          'DomeGradient',
          'HemisphereLight',
          'IBLGradient',
          'OneHandGrabbable',
          'PhysicsBody',
          'PhysicsShape',
          'PointLight',
          'RayInteractable',
          'RectAreaLight',
          'SpotLight',
          'TwoHandsGrabbable',
        ]),
      );
    expect(await componentOptions(editor)).not.toContain('Transform');
    expect(await componentOptions(editor)).not.toContain('Visibility');

    await addComponent(editor, 'AudioSource');
    await componentRow(editor, 'AudioSource')
      .locator('[data-component-file-browse]')
      .click();
    const filePicker = editor.page.locator('#component-file-picker-dialog');
    await expect.poll(() => filePicker.getAttribute('open')).not.toBeNull();
    await expect
      .poll(() => filePicker.locator('[data-file-picker-path]').count())
      .toBe(1);
    await filePicker
      .locator('[data-file-picker-path="./audio/ambient.wav"]')
      .click();
    await expect.poll(() => filePicker.count()).toBe(0);
    await componentRow(editor, 'AudioSource')
      .locator('[data-component-field="volume"]')
      .fill('0.5');
    await componentRow(editor, 'AudioSource')
      .locator('[data-component-field="loop"]')
      .setChecked(true);
    await componentRow(editor, 'AudioSource')
      .locator('[data-component-field="distanceModel"]')
      .selectOption('linear');
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'AudioSource'))
      .toMatchObject({
        distanceModel: 'linear',
        loop: true,
        src: './audio/ambient.wav',
        volume: 0.5,
      });

    await editor.page.locator('[data-node-visible]').setChecked(false);
    await expect
      .poll(() =>
        editor.page.evaluate(
          () =>
            (window as any).IWSDK_SCENE_EDITOR.session.document.nodes[0]
              .visible,
        ),
      )
      .toBe(false);

    await addComponent(editor, 'PhysicsBody');
    await componentRow(editor, 'PhysicsBody')
      .locator('[data-component-field="state"]')
      .selectOption('STATIC');
    await componentRow(editor, 'PhysicsBody')
      .locator('[data-component-field="gravityFactor"]')
      .fill('0.25');
    await fillVectorField(
      editor,
      'PhysicsBody',
      'centerOfMass',
      [0.1, 0.2, 0.3],
    );
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'PhysicsBody'))
      .toMatchObject({
        centerOfMass: [0.1, 0.2, 0.3],
        gravityFactor: 0.25,
        state: 'STATIC',
      });

    await addComponent(editor, 'PhysicsShape');
    await componentRow(editor, 'PhysicsShape')
      .locator('[data-component-field="shape"]')
      .selectOption('Box');
    await fillVectorField(editor, 'PhysicsShape', 'dimensions', [1, 2, 3]);
    await componentRow(editor, 'PhysicsShape')
      .locator('[data-component-field="friction"]')
      .fill('0.75');
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'PhysicsShape'))
      .toMatchObject({
        dimensions: [1, 2, 3],
        friction: 0.75,
        shape: 'Box',
      });

    await addComponent(editor, 'DistanceGrabbable');
    await expect
      .poll(async () =>
        Object.hasOwn(
          await componentValue(editor, 'DistanceGrabbable'),
          'rotateMax',
        ),
      )
      .toBe(false);
    await componentRow(editor, 'DistanceGrabbable')
      .locator('[data-component-field="translate"]')
      .setChecked(false);
    await expect
      .poll(() => componentValue(editor, 'DistanceGrabbable'))
      .toMatchObject({ translate: false });
    await componentRow(editor, 'DistanceGrabbable')
      .locator('[data-component-field="moveSpeedFactor"]')
      .fill('0.2');
    await componentRow(editor, 'DistanceGrabbable')
      .locator(
        '[data-component-vector-field="targetPositionOffset"][data-component-vector-index="0"]',
      )
      .focus();
    await expect
      .poll(() => componentValue(editor, 'DistanceGrabbable'))
      .toMatchObject({ moveSpeedFactor: 0.2, translate: false });
    await fillVectorField(
      editor,
      'DistanceGrabbable',
      'targetPositionOffset',
      [0, 0, -0.4],
    );
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'DistanceGrabbable'))
      .toMatchObject({
        moveSpeedFactor: 0.2,
        targetPositionOffset: [0, 0, -0.4],
        translate: false,
      });
    expect(
      Object.hasOwn(
        await componentValue(editor, 'DistanceGrabbable'),
        'rotateMax',
      ),
    ).toBe(false);

    await addComponent(editor, 'OneHandGrabbable');
    await addComponent(editor, 'TwoHandsGrabbable');
    await addComponent(editor, 'RayInteractable');
    await expect
      .poll(() => componentValue(editor, 'OneHandGrabbable'))
      .toMatchObject({ rotate: true });
    await expect
      .poll(() => componentValue(editor, 'TwoHandsGrabbable'))
      .toMatchObject({ scale: true });
    await expect
      .poll(() => componentValue(editor, 'RayInteractable'))
      .toEqual({});

    await addComponent(editor, 'DomeGradient');
    await fillColorField(editor, 'DomeGradient', 'sky', '#1c3854');
    await componentRow(editor, 'DomeGradient')
      .locator('[data-component-field="intensity"]')
      .fill('1.5');
    await componentRow(editor, 'DomeGradient')
      .locator('[data-component-field="elevationDeg"]')
      .fill('24');
    await componentRow(editor, 'DomeGradient')
      .locator('[data-component-field="azimuthDeg"]')
      .fill('-31');
    await componentRow(editor, 'DomeGradient')
      .locator('[data-component-field="dither"]')
      .setChecked(true);
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'DomeGradient'))
      .toMatchObject({
        azimuthDeg: -31,
        dither: true,
        elevationDeg: 24,
        intensity: 1.5,
        sky: [28 / 255, 56 / 255, 84 / 255, 1],
      });

    await addComponent(editor, 'IBLGradient');
    await fillColorField(editor, 'IBLGradient', 'ground', '#664d33');
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'IBLGradient'))
      .toMatchObject({
        ground: [102 / 255, 77 / 255, 51 / 255, 1],
      });

    await addComponent(editor, 'PointLight');
    await fillColorField(editor, 'PointLight', 'color', '#ff8844');
    await componentRow(editor, 'PointLight')
      .locator('[data-component-field="intensity"]')
      .fill('75');
    await componentRow(editor, 'PointLight')
      .locator('[data-component-field="distance"]')
      .fill('3.5');
    await componentRow(editor, 'PointLight')
      .locator('[data-component-field="castShadow"]')
      .setChecked(true);
    await componentRow(editor, 'PointLight')
      .locator('[data-component-field="shadowMapSize"]')
      .selectOption('512');
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'PointLight'))
      .toMatchObject({
        castShadow: true,
        color: [1, 136 / 255, 68 / 255, 1],
        distance: 3.5,
        intensity: 75,
        shadowMapSize: '512',
      });
    await expect
      .poll(() =>
        editor.page.evaluate(
          () =>
            (
              window as any
            ).IWSDK_SCENE_EDITOR_TEST_HOOKS.getAuthoredRenderState().lights,
        ),
      )
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            castShadow: true,
            color: '#ff8844',
            intensity: 75,
            nodeId: 'table-1',
            type: 'point',
          }),
        ]),
      );

    await expect(
      dispatchSceneTool(editor.page, 'scene_validate'),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      dispatchSceneTool(editor.page, 'scene_save'),
    ).resolves.toMatchObject({ dirty: false });
    const savedScene = await harness.readScene();
    expect(savedScene.nodes[0].visible).toBe(false);
    expect(savedScene.nodes[0].components).toEqual(
      expect.objectContaining({
        'com.iwsdk.components.AudioSource': expect.objectContaining({
          src: './audio/ambient.wav',
        }),
        'com.iwsdk.components.DistanceGrabbable': expect.objectContaining({
          translate: false,
        }),
        'com.iwsdk.components.DomeGradient': expect.objectContaining({
          azimuthDeg: -31,
          dither: true,
          elevationDeg: 24,
          intensity: 1.5,
        }),
        'com.iwsdk.components.IBLGradient': expect.objectContaining({
          ground: [102 / 255, 77 / 255, 51 / 255, 1],
        }),
        'com.iwsdk.components.PhysicsBody': expect.objectContaining({
          state: 'STATIC',
        }),
        'com.iwsdk.components.PhysicsShape': expect.objectContaining({
          shape: 'Box',
        }),
        'com.iwsdk.components.PointLight': expect.objectContaining({
          color: [1, 136 / 255, 68 / 255, 1],
          distance: 3.5,
          intensity: 75,
        }),
        'com.iwsdk.components.RayInteractable': {},
      }),
    );
    expect(savedScene.nodes[0].components).not.toHaveProperty(
      'com.iwsdk.components.Visibility',
    );
  }, 45000);
});

async function componentOptions(editor: EditorPageContext): Promise<string[]> {
  return editor.page
    .locator('[data-component-picker-option]')
    .evaluateAll((options) =>
      options
        .map((option) => option.getAttribute('data-component-picker-option'))
        .filter((value): value is string => value != null)
        .sort(),
    );
}

async function addComponent(
  editor: EditorPageContext,
  type: string,
): Promise<void> {
  await addComponentViaPicker(editor.page, type);
  await expect
    .poll(async () => {
      const count = await componentRow(editor, type).count();
      if (count === 0) {
        const message = await editor.page
          .locator('#component-editor-message')
          .textContent();
        if (message) {
          throw new Error(message);
        }
      }
      return count;
    })
    .toBe(1);
}

function componentRow(editor: EditorPageContext, type: string) {
  return editor.page.locator(`[data-component-type="${type}"]`);
}

async function componentValue(
  editor: EditorPageContext,
  type: string,
): Promise<any> {
  return editor.page.evaluate(
    ({ componentType }) =>
      (window as any).IWSDK_SCENE_EDITOR.session.document.nodes[0].components?.[
        `com.iwsdk.components.${componentType}`
      ],
    { componentType: type },
  );
}

async function fillVectorField(
  editor: EditorPageContext,
  componentType: string,
  fieldName: string,
  values: number[],
): Promise<void> {
  const row = componentRow(editor, componentType);
  for (let index = 0; index < values.length; index += 1) {
    await row
      .locator(
        `[data-component-vector-field="${fieldName}"][data-component-vector-index="${index}"]`,
      )
      .fill(String(values[index]));
  }
}

async function fillColorField(
  editor: EditorPageContext,
  componentType: string,
  fieldName: string,
  value: string,
): Promise<void> {
  const input = componentRow(editor, componentType).locator(
    `input[type="color"][data-component-field="${fieldName}"]`,
  );
  await input.fill(value);
  await input.evaluate((element) =>
    element.dispatchEvent(new Event('change', { bubbles: true })),
  );
}

async function focusComponentCommitTarget(
  editor: EditorPageContext,
): Promise<void> {
  await editor.page.locator('#add-component').focus();
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => (window as any).IWSDK_SCENE_EDITOR.session.isDirty,
      ),
    )
    .toBe(false);
}
