/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createEditorTestHarness,
  dispatchSceneTool,
  expectRealWebGLViewport,
  MANAGED_WORKSPACE_HEADERS,
  type EditorTestHarness,
} from './editor-e2e-fixture.js';

let harness: EditorTestHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('file-first scene authoring', () => {
  test('rejects editor commands immediately when no scene is open', async () => {
    harness = await createEditorTestHarness('editor-no-open-scene');
    await writeFile(
      path.join(harness.tempRoot, 'public/scenes/second.iwsdk.scene.json'),
      JSON.stringify({
        version: 'iwsdk.scene.v1',
        units: 'meters',
        resources: {},
        nodes: [],
      }),
    );
    const context = await harness.browser.newContext({
      extraHTTPHeaders: MANAGED_WORKSPACE_HEADERS,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await page.goto(`${harness.baseUrl}__iwsdk/workspace`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () =>
        (window as any).__IWSDK_SCENE_EDITOR_READY === true &&
        (window as any).IWSDK_SCENE_EDITOR?.session === null,
    );

    const result = await page.evaluate(async () => {
      const runtime = (window as any).IWSDK_SCENE_EDITOR.runtime;
      try {
        await runtime.dispatch('ui_list_assets', {});
        return { handled: runtime.handles('ui_list_assets'), message: null };
      } catch (error) {
        return {
          handled: runtime.handles('ui_list_assets'),
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });

    expect(result.handled).toBe(true);
    expect(result.message).toContain('No scene is open in the IWSDK editor.');
    expect(result.message).toContain('npx @iwsdk/cli scene open --input-json');
    await context.close();
  }, 60000);

  test('atomically reloads roots and modules and renders detached files', async () => {
    harness = await createEditorTestHarness('editor-file-authoring');
    const editor = await harness.openEditor();
    await expectRealWebGLViewport(editor);

    const moduleRelativePath = 'public/scenes/modules/nook.iwsdk.scene.json';
    const modulePath = path.join(harness.tempRoot, moduleRelativePath);
    await mkdir(path.dirname(modulePath), { recursive: true });
    const moduleDocument = {
      version: 'iwsdk.scene.v1',
      units: 'meters',
      resources: {},
      nodes: [
        {
          id: 'seat',
          content: { type: 'asset', asset: 'procedural-plinth' },
          transform: { position: [0, 0.4, 0] },
        },
      ],
    };
    await writeFile(modulePath, JSON.stringify(moduleDocument, null, 2));
    await writeFile(
      harness.scenePath,
      JSON.stringify(
        {
          version: 'iwsdk.scene.v1',
          units: 'meters',
          imports: [
            {
              id: 'nook',
              src: './modules/nook.iwsdk.scene.json',
              transform: { position: [2, 0, 0] },
            },
          ],
          resources: {},
          nodes: [],
        },
        null,
        2,
      ),
    );

    await expect
      .poll(() =>
        editor.page.evaluate(() => [
          ...(window as any).IWSDK_SCENE_EDITOR.session.document.nodes,
        ]),
      )
      .toMatchObject([
        {
          id: 'nook',
          children: [{ id: 'nook/seat' }],
          transform: { position: [2, 0, 0] },
        },
      ]);
    await expect
      .poll(() =>
        editor.page.locator('[data-node-id="nook"] .node-row-icon svg').count(),
      )
      .toBe(1);
    await expect
      .poll(() => dispatchSceneTool(editor.page, 'scene_get_state'))
      .toMatchObject({
        conflict: false,
        dependencies: [moduleRelativePath],
        diagnostics: [],
        dirty: false,
      });

    await writeFile(modulePath, '{"version":');
    await expect
      .poll(() => dispatchSceneTool(editor.page, 'scene_get_state'))
      .toMatchObject({
        editor: { fileStatus: 'invalid' },
        validation: { valid: false },
      });
    expect(
      await editor.page.evaluate(
        () => (window as any).IWSDK_SCENE_EDITOR.session.document.nodes[0].id,
      ),
    ).toBe('nook');

    moduleDocument.nodes[0].transform.position = [0.5, 0.4, 0];
    await writeFile(modulePath, JSON.stringify(moduleDocument, null, 2));
    await expect
      .poll(() =>
        editor.page.evaluate(
          () =>
            (window as any).IWSDK_SCENE_EDITOR.session.document.nodes[0]
              .children[0].transform.position,
        ),
      )
      .toEqual([0.5, 0.4, 0]);

    const activeBefore = (
      await dispatchSceneTool(editor.page, 'scene_get_state')
    ).activeFile;
    const rendered = await dispatchSceneTool(editor.page, 'scene_render_file', {
      path: moduleRelativePath,
      view: 'quarter',
      width: 320,
      height: 240,
    });
    expect(rendered).toMatchObject({
      diagnostics: [],
      height: 240,
      mimeType: 'image/png',
      path: moduleRelativePath,
      valid: true,
      width: 320,
    });
    expect(rendered.imageData.length).toBeGreaterThan(100);
    expect(
      (await dispatchSceneTool(editor.page, 'scene_get_state')).activeFile,
    ).toBe(activeBefore);
  }, 60000);

  test('auto-opens the only scene in editor view and exposes it in the URL', async () => {
    harness = await createEditorTestHarness('editor-navigation');
    const context = await harness.browser.newContext({
      extraHTTPHeaders: MANAGED_WORKSPACE_HEADERS,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (window as any).__IWSDK_SCENE_EDITOR_READY === true,
    );
    expect(
      await page
        .locator(
          '[data-workspace-reload-button] + [data-workspace-open-browser-button]',
        )
        .count(),
    ).toBe(1);
    expect(
      await page
        .locator('[data-workspace-open-browser-button]')
        .getAttribute('aria-label'),
    ).toBe('Open runtime in default browser');
    // Tab muting needs the managed browser's binding, which this page lacks.
    expect(await page.locator('[data-workspace-mute-button]').count()).toBe(0);
    expect(new URL(page.url()).hash).toBe('');
    await expect
      .poll(() =>
        page.locator('html').getAttribute('data-iwsdk-workspace-view'),
      )
      .toBe('runtime');
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('[data-workspace-reload-button]').click(),
    ]);
    await page.waitForFunction(
      () => (window as any).__IWSDK_SCENE_EDITOR_READY === true,
    );
    await expect
      .poll(() =>
        page.locator('html').getAttribute('data-iwsdk-workspace-view'),
      )
      .toBe('runtime');

    await page.locator('[data-workspace-view-button="editor"]').click();
    await page.waitForURL(/\/#editor\/editor-smoke\.iwsdk\.scene\.json$/u);
    await page.waitForFunction(
      () =>
        (window as any).__IWSDK_SCENE_EDITOR_READY === true &&
        (window as any).IWSDK_SCENE_EDITOR?.session != null,
    );
    await expect
      .poll(() =>
        page.locator('html').getAttribute('data-iwsdk-workspace-view'),
      )
      .toBe('editor');
    await expect
      .poll(() => page.locator('#scene-canvas').isVisible())
      .toBe(true);
    await expect
      .poll(() => page.locator('.scene-picker-dialog').count())
      .toBe(0);
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('[data-workspace-reload-button]').click(),
    ]);
    await page.waitForFunction(
      () =>
        (window as any).__IWSDK_SCENE_EDITOR_READY === true &&
        (window as any).IWSDK_SCENE_EDITOR?.session != null,
    );
    expect(new URL(page.url()).hash).toBe(
      '#editor/editor-smoke.iwsdk.scene.json',
    );
    await expect
      .poll(() =>
        page.locator('html').getAttribute('data-iwsdk-workspace-view'),
      )
      .toBe('editor');

    await page.locator('[data-workspace-view-button="runtime"]').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    await expect
      .poll(() =>
        page.locator('html').getAttribute('data-iwsdk-workspace-view'),
      )
      .toBe('runtime');

    await page.goBack();
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe('#editor/editor-smoke.iwsdk.scene.json');
    await expect
      .poll(() =>
        page.locator('html').getAttribute('data-iwsdk-workspace-view'),
      )
      .toBe('editor');

    await page.goForward();
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    await expect
      .poll(() =>
        page.locator('html').getAttribute('data-iwsdk-workspace-view'),
      )
      .toBe('runtime');
    await context.close();
  }, 60000);
});
