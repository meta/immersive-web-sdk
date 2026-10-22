/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { writeFile } from 'fs/promises';
import { afterEach, describe, expect, test } from 'vitest';
import {
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

function domeFadeState(editor: EditorPageContext): Promise<any> {
  return editor.page.evaluate(() =>
    (window as any).IWSDK_SCENE_EDITOR_TEST_HOOKS.getDomeFadeState(),
  );
}

async function programCount(editor: EditorPageContext): Promise<number> {
  const stats = await dispatchSceneTool(editor.page, 'scene_get_render_stats');
  return stats.programs;
}

/** The program count once on-demand renders have settled. */
async function settledProgramCount(editor: EditorPageContext): Promise<number> {
  let previous = await programCount(editor);
  for (let stableReads = 0; stableReads < 3; ) {
    await editor.page.waitForTimeout(250);
    const next = await programCount(editor);
    stableReads = next === previous ? stableReads + 1 : 0;
    previous = next;
  }
  return previous;
}

describe('editor DomeFade', () => {
  test('fades a floor node into the root DomeGradient through the shared binding', async () => {
    harness = await createEditorTestHarness('editor-dome-fade');
    const scene = await harness.readScene();
    scene.nodes.push({
      components: {
        'com.iwsdk.components.DomeFade': { end: 10, start: 4 },
      },
      content: { asset: 'procedural-plinth', type: 'asset' },
      id: 'floor',
      transform: { position: [0, -0.1, 0], scale: [30, 0.5, 30] },
    });
    await writeFile(harness.scenePath, JSON.stringify(scene, null, 2), 'utf8');
    const editor = await harness.openEditor();
    await expectRealWebGLViewport(editor);

    await expect
      .poll(() => domeFadeState(editor))
      .toEqual({
        floor: {
          active: true,
          end: 10,
          inactiveReason: null,
          meshCount: 1,
          skippedMaterials: 0,
          start: 4,
        },
      });

    // Ghosting swaps in copies of the fade clones; they are faded as new
    // sources, and unghosting restores the original clones.
    await dispatchSceneTool(editor.page, 'scene_set_preview_visibility', {
      mode: 'ghost',
      nodeIds: ['floor'],
    });
    await expect
      .poll(async () => (await domeFadeState(editor)).floor)
      .toMatchObject({ active: true, meshCount: 1, skippedMaterials: 0 });
    await dispatchSceneTool(editor.page, 'scene_set_preview_visibility', {
      mode: 'unghost',
      nodeIds: ['floor'],
    });
    await expect
      .poll(async () => (await domeFadeState(editor)).floor)
      .toMatchObject({ active: true, meshCount: 1, skippedMaterials: 0 });

    await selectNode(editor.page, 'floor');
    const fadeRow = editor.page.locator('[data-component-type="DomeFade"]');
    await expect.poll(() => fadeRow.count()).toBe(1);
    expect(await fadeRow.textContent()).toContain('Fade start (m)');
    // Count after selection, whose helpers compile programs of their own.
    const programsBefore = await settledProgramCount(editor);
    expect(programsBefore).toBeGreaterThan(0);
    await fadeRow.locator('[data-component-field="start"]').fill('6');
    await editor.page.locator('#add-component').focus();
    await expect
      .poll(() =>
        editor.page.evaluate(
          () =>
            (window as any).IWSDK_SCENE_EDITOR.session.document.nodes.find(
              (node: any) => node.id === 'floor',
            )?.components?.['com.iwsdk.components.DomeFade']?.start,
        ),
      )
      .toBe(6);
    await expect
      .poll(async () => (await domeFadeState(editor)).floor)
      .toMatchObject({ active: true, meshCount: 1, start: 6 });
    // A new fade distance is a uniform write: no program is compiled for it.
    expect(await settledProgramCount(editor)).toBe(programsBefore);

    await editor.page.locator('#scene-root-drop-target').click();
    const rootInspector = editor.page.locator('[data-scene-root-inspector]');
    await expect.poll(() => rootInspector.count()).toBe(1);
    await rootInspector
      .locator('[data-component-name$="DomeGradient"]')
      .locator('[data-remove-component]')
      .click();
    await expect
      .poll(async () => (await domeFadeState(editor)).floor)
      .toMatchObject({
        active: false,
        inactiveReason: 'no-dome-gradient',
        meshCount: 1,
      });
    expect(editor.errors()).toEqual([]);
  }, 45000);
});
