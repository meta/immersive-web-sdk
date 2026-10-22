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
  getEditorProof,
  selectNode,
  type EditorPageContext,
  type EditorTestHarness,
} from './editor-e2e-fixture.js';

let harness: EditorTestHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function plinthNode(id: string, x: number, components?: object) {
  return {
    children: [
      {
        content: { asset: 'procedural-plinth', type: 'asset' },
        id: `${id}-body`,
        transform: { position: [0, 0.1, 0] },
      },
    ],
    ...(components == null ? {} : { components }),
    content: { type: 'group' },
    id,
    transform: { position: [x, 0, 1.6] },
  };
}

describe('editor ground shadows', () => {
  test('renders ContactShadow and ShadowCatcher nodes as runtime-only meshes', async () => {
    harness = await createEditorTestHarness('editor-ground-shadows');
    const editor = await harness.openEditor();
    await expectRealWebGLViewport(editor);

    await dispatchSceneTool(editor.page, 'scene_add_node', {
      node: plinthNode('plinth-shadowed', -1, {
        'com.iwsdk.components.ContactShadow': { size: [1.2, 0.9] },
      }),
    });
    await dispatchSceneTool(editor.page, 'scene_add_node', {
      node: plinthNode('plinth-bare', 1),
    });
    await dispatchSceneTool(editor.page, 'scene_add_node', {
      node: {
        components: {
          'com.iwsdk.components.ShadowCatcher': { opacity: 0.3 },
        },
        content: { type: 'group' },
        id: 'catcher',
      },
    });
    // The layout lens masks nodes annotated for another review layer.
    await dispatchSceneTool(editor.page, 'scene_apply_patch', {
      patch: {
        authoring: {
          nodeAnnotations: [
            { node: 'plinth-shadowed', reviewLayer: 'geometry' },
          ],
        },
        op: 'setAuthoring',
      },
    });

    await expect
      .poll(async () => (await groundShadowState(editor))?.meshes)
      .toEqual([
        {
          castShadow: false,
          color: '#000000',
          kind: 'shadow-catcher',
          layerMask: 1,
          materialType: 'ShadowMaterial',
          materialUuid: expect.any(String),
          nodeId: 'catcher',
          opacity: 0.3,
          positionY: 0,
          receiveShadow: true,
          runtimeOnly: true,
          scale: [6, 6],
          visible: true,
        },
        {
          castShadow: false,
          color: '#606474',
          kind: 'contact-shadow',
          layerMask: 1,
          materialType: 'MeshBasicMaterial',
          materialUuid: expect.any(String),
          nodeId: 'plinth-shadowed',
          opacity: expect.closeTo(0.72, 6),
          positionY: 0.002,
          receiveShadow: false,
          runtimeOnly: true,
          scale: [1.2, 0.9],
          visible: true,
        },
      ]);
    const state = await groundShadowState(editor);
    expect(state.bindingNodeIds).toEqual(['catcher', 'plinth-shadowed']);

    // The blob does not widen the plinth's selection bounds.
    expect(state.nodeBounds['plinth-shadowed']).toEqual({
      max: [-0.7, 0.2, 1.9],
      min: [-1.3, 0, 1.3],
    });
    expect(state.nodeBounds['plinth-bare']).toEqual({
      max: [1.3, 0.2, 1.9],
      min: [0.7, 0, 1.3],
    });
    await selectNode(editor.page, 'plinth-shadowed');
    await expect
      .poll(async () => (await getEditorProof(editor.page)).selectionBounds)
      .toMatchObject({
        centerDistance: 0,
        helperCenter: [-1, 0.1, 1.6],
        maxDistance: 0,
        minDistance: 0,
        nodeId: 'plinth-shadowed',
      });
    // Nor does the 6 m catcher widen the scene framing bounds (table + plinths).
    const { framingBounds } = (await getEditorProof(editor.page)).renderStats;
    expect(framingBounds.min).toEqual([
      expect.closeTo(-1.3, 4),
      expect.closeTo(0, 4),
      expect.closeTo(-1, 4),
    ]);
    expect(framingBounds.max).toEqual([
      expect.closeTo(1.3, 4),
      expect.closeTo(0.5, 4),
      expect.closeTo(1.9, 4),
    ]);

    // Review lenses leave the blob and catcher materials alone. The layout
    // lens masks the blob with its geometry-layer plinth; the catcher's node
    // has no annotation, so it stays.
    const finalMaterials = state.meshes.map((mesh: any) => mesh.materialUuid);
    for (const [lens, layerMasks] of [
      ['geometry', [1, 1]],
      ['layout', [1, 0]],
      ['final', [1, 1]],
    ] as const) {
      await dispatchSceneTool(editor.page, 'scene_set_review_lens', { lens });
      const lensed = await groundShadowState(editor);
      expect(lensed.meshes.map((mesh: any) => mesh.materialUuid)).toEqual(
        finalMaterials,
      );
      expect(lensed.meshes.map((mesh: any) => mesh.layerMask)).toEqual(
        layerMasks,
      );
    }

    // Preview ghosting fades the plinth but not its blob.
    await dispatchSceneTool(editor.page, 'scene_set_preview_visibility', {
      mode: 'ghost',
      nodeIds: ['plinth-shadowed'],
    });
    expect(
      (await groundShadowState(editor)).meshes.map(
        (mesh: any) => mesh.materialUuid,
      ),
    ).toEqual(finalMaterials);
    await dispatchSceneTool(editor.page, 'scene_set_preview_visibility', {
      mode: 'reset',
    });

    await dispatchSceneTool(editor.page, 'scene_remove_node', {
      nodeId: 'plinth-shadowed',
    });
    await expect
      .poll(async () => (await groundShadowState(editor))?.bindingNodeIds)
      .toEqual(['catcher']);
    expect(editor.errors()).toEqual([]);
  }, 60000);

  test('lists both components in the picker and round-trips their fields', async () => {
    harness = await createEditorTestHarness('editor-ground-shadow-schemas');
    const editor = await harness.openEditor();
    await expectRealWebGLViewport(editor);
    await selectNode(editor.page, 'table-1');
    await expect
      .poll(
        async () =>
          (await getEditorProof(editor.page)).selectedRuntime.meshCount,
      )
      .toBeGreaterThan(0);
    const tableProof = await getEditorProof(editor.page);
    const tableAssets = tableProof.renderStats.sceneAssets;
    const tableMeshCount = tableProof.selectedRuntime.meshCount;
    expect(tableAssets).toEqual([{ id: 'table', meshCount: tableMeshCount }]);

    await expect
      .poll(() => componentOptions(editor))
      .toEqual(expect.arrayContaining(['ContactShadow', 'ShadowCatcher']));

    await addComponent(editor, 'ContactShadow');
    await fillVectorField(editor, 'ContactShadow', 'size', [2.4, 2]);
    await componentRow(editor, 'ContactShadow')
      .locator('[data-component-field="opacity"]')
      .fill('0.5');
    await componentRow(editor, 'ContactShadow')
      .locator('[data-component-field="height"]')
      .fill('0.01');
    await fillColorField(editor, 'ContactShadow', 'color', '#203040');
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'ContactShadow'))
      .toMatchObject({
        color: [32 / 255, 48 / 255, 64 / 255, 1],
        height: 0.01,
        opacity: 0.5,
        size: [2.4, 2],
      });

    await addComponent(editor, 'ShadowCatcher');
    await fillVectorField(editor, 'ShadowCatcher', 'size', [3, 4]);
    await componentRow(editor, 'ShadowCatcher')
      .locator('[data-component-field="opacity"]')
      .fill('0.4');
    await focusComponentCommitTarget(editor);
    await expect
      .poll(() => componentValue(editor, 'ShadowCatcher'))
      .toMatchObject({ opacity: 0.4, size: [3, 4] });

    await expect
      .poll(async () => (await groundShadowState(editor))?.meshes)
      .toEqual([
        expect.objectContaining({
          color: '#203040',
          kind: 'contact-shadow',
          nodeId: 'table-1',
          opacity: 0.5,
          positionY: 0.01,
          scale: [2.4, 2],
        }),
        expect.objectContaining({
          kind: 'shadow-catcher',
          nodeId: 'table-1',
          opacity: expect.closeTo(0.4, 6),
          scale: [3, 4],
        }),
      ]);
    // The table's selection bounds stay its own 2 x 0.5 x 2 box.
    expect((await groundShadowState(editor)).nodeBounds['table-1']).toEqual({
      max: [1, 0.5, 1],
      min: [-1, 0, -1],
    });
    // Neither mesh counts toward the table asset or the node summary.
    const shadowedProof = await getEditorProof(editor.page);
    expect(shadowedProof.renderStats.sceneAssets).toEqual(tableAssets);
    expect(shadowedProof.selectedRuntime.meshCount).toBe(tableMeshCount);

    await expect(
      dispatchSceneTool(editor.page, 'scene_validate'),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      dispatchSceneTool(editor.page, 'scene_save'),
    ).resolves.toMatchObject({ dirty: false });
    expect((await harness.readScene()).nodes[0].components).toEqual(
      expect.objectContaining({
        'com.iwsdk.components.ContactShadow': expect.objectContaining({
          height: 0.01,
          opacity: 0.5,
          size: [2.4, 2],
        }),
        'com.iwsdk.components.ShadowCatcher': expect.objectContaining({
          opacity: 0.4,
          size: [3, 4],
        }),
      }),
    );
    expect(editor.errors()).toEqual([]);
  }, 60000);
});

async function groundShadowState(editor: EditorPageContext): Promise<any> {
  return editor.page.evaluate(() =>
    (window as any).IWSDK_SCENE_EDITOR_TEST_HOOKS.getGroundShadowState(),
  );
}

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
  await expect.poll(() => componentRow(editor, type).count()).toBe(1);
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
