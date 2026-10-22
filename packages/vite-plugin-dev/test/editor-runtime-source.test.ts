/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  Box3,
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { describe, expect, test } from 'vitest';
import {
  createEditorRuntimeModuleSource,
  createEditorShellHtml,
} from '../src/editor/editor-runtime-source.js';
import {
  TAB_AUDIO_BINDING,
  TAB_AUDIO_CHANGE_EVENT,
} from '../src/managed-browser/tab-audio.js';

const workspaceSource = readFileSync(
  new URL('../src/editor/editor-workspace.tsx', import.meta.url),
  'utf8',
);

function createRuntimeSource(): string {
  return createEditorRuntimeModuleSource(
    '/editor-session.js',
    '/core.js',
    '/assets.js',
    '/components.js',
    '/orbit-controls.js',
    '/transform-controls.js',
    '/viewport-gizmo.js',
    {},
    '/scene-composition.js',
  );
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

type AssetPreviewHierarchyEntry = {
  name: string;
  object: Object3D;
  path: string;
  type: string;
};

type AssetPreviewHelpers = {
  assetPreviewHierarchyBounds(
    entries: AssetPreviewHierarchyEntry[],
  ): Map<Object3D, Box3>;
  assetPreviewHierarchyEntries(root: Object3D): AssetPreviewHierarchyEntry[];
  assetPreviewRenderedTriangleCount(
    object: Mesh | InstancedMesh,
    geometry: BufferGeometry,
    position: { count: number },
    index: { count: number } | null,
  ): number;
  objectPreviewGeometryBounds(object: Mesh): Box3 | null;
  resolveAssetPreviewFocus(
    entries: AssetPreviewHierarchyEntry[],
    focus: string,
  ): AssetPreviewHierarchyEntry | null;
};

async function loadAssetPreviewHelpers(): Promise<AssetPreviewHelpers> {
  const source = createRuntimeSource();
  const helpers = section(
    source,
    'const ASSET_PREVIEW_FOCUS_PATH_LIMIT',
    'function inspectAssetPreviewGeometry',
  );
  const require = createRequire(import.meta.url);
  const threeUrl = pathToFileURL(require.resolve('three')).href;
  const directory = await mkdtemp(
    path.join(tmpdir(), 'iwsdk-asset-preview-helpers-'),
  );
  const modulePath = path.join(directory, 'helpers.mjs');
  try {
    await writeFile(
      modulePath,
      `import { AdditiveBlending, Box3 } from ${JSON.stringify(threeUrl)};\n${helpers}\nexport { assetPreviewHierarchyBounds, assetPreviewHierarchyEntries, assetPreviewRenderedTriangleCount, objectPreviewGeometryBounds, resolveAssetPreviewFocus };\n`,
    );
    return (await import(
      pathToFileURL(modulePath).href
    )) as AssetPreviewHelpers;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

describe('editor runtime source', () => {
  test('shows startup progress for real editor loading phases', () => {
    const source = createRuntimeSource();
    const shell = createEditorShellHtml(
      '/injection.js',
      '/editor-runtime.js',
      '/editor.css',
      '/__iwsdk/editor/document',
    );

    expect(shell).toContain('class="editor-loading"');
    expect(shell).toContain('editor-loading-progress-indeterminate');
    expect(shell).not.toContain('Editor UI modules will mount here');
    expect(source).toContain(
      "updateEditorStartupProgress('Loading editor modules…', 12)",
    );
    expect(source).toContain(
      "updateEditorStartupProgress('Loading scene…', 48)",
    );
    expect(source).toContain(
      "updateEditorStartupProgress('Building scene preview…', 70)",
    );
    expect(source).toContain('completeEditorStartup();');
  });

  test('exposes runtime and editor workspace views with browser controls', () => {
    const source = createRuntimeSource();
    const viewState = section(
      source,
      'window.__IWSDK_WORKSPACE_VIEW =',
      'window.__IWSDK_WORKSPACE_PAGE_ID =',
    );
    const viewSetter = section(
      source,
      'function setWorkspaceView',
      'function forceEditorViewportRender',
    );
    const frame = section(
      source,
      'function createEditorFrame',
      'function getViewportHost',
    );
    const controller = section(
      source,
      'function editorWorkspaceController',
      'function createEditorFrame',
    );

    expect(viewState).toContain('initialWorkspaceRoute.view');
    expect(viewSetter).toContain("['runtime', 'editor']");
    expect(viewSetter).toContain(
      'workspace_set_view.view must be runtime or editor',
    );
    expect(viewSetter).not.toContain('waitForWorkspaceRuntimeFrame');
    expect(source).toContain(
      "case 'workspace_set_view':\n      setWorkspaceView(params.view);\n      if (params.view === 'runtime') {\n        await waitForWorkspaceRuntimeFrame();",
    );
    expect(frame).toContain('mountEditorWorkspace(root');
    expect(workspaceSource).toContain('data-workspace-view-button={view}');
    expect(workspaceSource).toContain("(['runtime', 'editor'] as const)");
    expect(workspaceSource).toContain('data-workspace-reload-button');
    expect(workspaceSource).toContain('controller.reloadPage?.()');
    expect(controller).toContain('window.location.reload()');
    expect(workspaceSource).toContain('data-workspace-open-browser-button');
    expect(workspaceSource).toContain('Open runtime in default browser');
    expect(workspaceSource).toContain('controller.openRuntimeInBrowser?.()');
    expect(controller).toContain("fetch('/__iwsdk/workspace/open-runtime', {");
    expect(controller).toContain("method: 'POST'");
    expect(workspaceSource).not.toContain("'split'");
  });

  test('shows the tab mute control only when the managed browser provides it', () => {
    const source = createRuntimeSource();
    const frame = section(
      source,
      'function createEditorFrame',
      'function getViewportHost',
    );
    const controller = section(
      source,
      'function editorWorkspaceController',
      'function createEditorFrame',
    );
    const tabAudioState = section(
      source,
      'function workspaceTabAudioState',
      'async function waitForWorkspaceRuntimeFrame',
    );

    expect(source).toContain(
      `const TAB_AUDIO_BINDING = ${JSON.stringify(TAB_AUDIO_BINDING)};`,
    );
    expect(source).toContain(
      `const TAB_AUDIO_CHANGE_EVENT = ${JSON.stringify(TAB_AUDIO_CHANGE_EVENT)};`,
    );
    expect(source).toContain(
      'window.addEventListener(TAB_AUDIO_CHANGE_EVENT, () => {\n    workspaceUi?.update(workspaceTabAudioState());',
    );
    expect(tabAudioState).toContain(
      "tabAudio != null && typeof window[TAB_AUDIO_BINDING] === 'function'",
    );
    expect(frame).toContain('...workspaceTabAudioState(),');
    expect(controller).toContain('const setMuted = window[TAB_AUDIO_BINDING];');
    expect(workspaceSource).toContain('{snapshot.tabAudioAvailable ? (');
    expect(workspaceSource).toContain('data-workspace-mute-button');
    expect(workspaceSource).toContain(
      "muted ? 'Unmute tab audio' : 'Mute tab audio'",
    );
    expect(workspaceSource).toContain('controller.setTabAudioMuted?.(muted)');
  });

  test('does not turn a slow initial runtime frame into an unhandled view transition', () => {
    const source = createRuntimeSource();
    const viewSetter = section(
      source,
      'function setWorkspaceView',
      'function sceneEditorDocumentTitle',
    );
    const workspaceWindow = {
      __IWSDK_WORKSPACE_RUNTIME_STALE: false,
      __IWSDK_WORKSPACE_VIEW: 'editor',
    };
    let loadCalls = 0;

    const result = runInNewContext(
      `${viewSetter}\nsetWorkspaceView('runtime', { syncRoute: false });`,
      {
        document: {
          documentElement: { dataset: {} },
          querySelectorAll: () => [],
        },
        loadWorkspaceRuntimeFrame: () => {
          loadCalls += 1;
          return true;
        },
        scheduleEditorViewportRender: () => {},
        syncWorkspaceLocation: () => {},
        updateWorkspaceDocumentTitle: () => {},
        window: workspaceWindow,
        workspaceUi: null,
      },
    );

    expect(result).toBeUndefined();
    expect(loadCalls).toBe(1);
    expect(workspaceWindow.__IWSDK_WORKSPACE_VIEW).toBe('runtime');
  });

  test('fails fast when editor commands require an open scene', () => {
    const source = createRuntimeSource();
    const routing = section(
      source,
      'function handlesEditorMethodWithoutSession',
      'function readStoredWorkspaceScenePath',
    );

    expect(source).toContain("String(method).startsWith('ui_')");
    expect(routing).toContain("value.startsWith('scene_')");
    expect(routing).toContain("value.startsWith('ui_')");
    expect(routing).toContain('No scene is open in the IWSDK editor.');
    expect(routing).toContain('npx @iwsdk/cli scene open --input-json');
    expect(source).toContain(
      'runtimeHandles = (method) => handlesEditorMethodWithoutSession(method)',
    );
    expect(source).toContain(
      'dispatchEditorMethodWithoutSession(method, params)',
    );
  });

  test('keeps editor view and scene selection in the visible URL', () => {
    const source = createRuntimeSource();
    const sceneImport = section(
      source,
      'function readStoredWorkspaceScenePath',
      'function currentScenePath',
    );
    const sceneOpen = section(
      source,
      'function documentUrlForScene',
      'async function fetchJsonOrThrow',
    );

    expect(source).toContain(
      "const WORKSPACE_SCENE_PATH_KEY = 'iwsdk-workspace-scene-path'",
    );
    expect(source).toContain("const WORKSPACE_EDITOR_HASH_PREFIX = '#editor'");
    expect(sceneImport).toContain("pageUrl.searchParams.get('scene')");
    expect(sceneImport).toContain(
      "scenePath: relativePath.startsWith('public/scenes/')",
    );
    expect(sceneImport).toContain(
      "relativePath.split('/').map(encodeURIComponent)",
    );
    expect(sceneImport).toContain(
      "const view = editorRoute.matched || legacyScenePath ? 'editor' : 'runtime'",
    );
    expect(sceneOpen).toContain('storeWorkspaceScenePath(scenePath)');
    expect(sceneOpen).toContain("syncWorkspaceLocation('editor', scenePath)");
    expect(sceneOpen).toContain('window.location.reload()');
    expect(source).toContain(
      "window.addEventListener('hashchange', applyWorkspaceLocation)",
    );
    expect(source).toContain(
      "window.addEventListener('popstate', applyWorkspaceLocation)",
    );
    expect(source).toContain('fetchComposedSceneDocument(currentScenePath())');
    expect(source).toContain('if (sceneFiles.length === 1)');
    expect(source).toContain('storeWorkspaceScenePath(sceneFiles[0].path)');
    expect(source).toContain('installSceneFileWatcher(session');
    expect(source).toContain('fetch(activeDocumentUrl(), {');
  });

  test('reloads watched root and module files without exposing mutation tools', () => {
    const source = createRuntimeSource();

    expect(source).toContain(
      "import.meta.hot.on('iwsdk:runtime-source-change'",
    );
    expect(source).toContain("import.meta.hot.on('iwsdk:scene-file-change'");
    expect(source).toContain('session.replaceFromDisk(loaded.document)');
    expect(source).toContain("status: 'invalid'");
    expect(source).toContain("status: 'conflict'");
    expect(source).toContain("'scene_render_file'");
    expect(source).not.toContain(
      "'scene_replace_document',\n    'scene_apply_transaction'",
    );
  });

  test('marks an unloaded runtime frame stale while the editor is visible', () => {
    const source = createRuntimeSource();
    const reloadRuntimeFrame = section(
      source,
      'function reloadWorkspaceRuntimeFrame',
      'function documentUrlForScene',
    );
    class TestIFrame {
      getAttribute(_name: string): null {
        return null;
      }
    }
    const runtimeFrame = new TestIFrame();
    const workspaceWindow = {
      __IWSDK_WORKSPACE_RUNTIME_READY: true,
      __IWSDK_WORKSPACE_RUNTIME_STALE: false,
      __IWSDK_WORKSPACE_VIEW: 'editor',
    };
    let loadCalls = 0;

    const result = runInNewContext(
      `${reloadRuntimeFrame}\nreloadWorkspaceRuntimeFrame();`,
      {
        document: { getElementById: () => runtimeFrame },
        HTMLIFrameElement: TestIFrame,
        loadWorkspaceRuntimeFrame: () => {
          loadCalls += 1;
          return true;
        },
        window: workspaceWindow,
      },
    );

    expect(result).toBe(true);
    expect(workspaceWindow.__IWSDK_WORKSPACE_RUNTIME_STALE).toBe(true);
    expect(workspaceWindow.__IWSDK_WORKSPACE_RUNTIME_READY).toBe(false);
    expect(loadCalls).toBe(0);
  });

  test('shares one canonical UIKitML asset render across editor consumers', () => {
    const source = createRuntimeSource();
    const panelDocument = section(
      source,
      'async function createEditorPanelDocument',
      'function refreshEditorPanelClassLists',
    );

    expect(panelDocument).toContain(
      'loadUIKitMLComponent(config, { forceReload: true })',
    );

    const thumbnailRender = section(
      source,
      'async function generateAssetThumbnails',
      'function sceneComponentScalar',
    );
    const sceneRender = section(
      source,
      'async function materializeEditorPanelPreviews',
      'function disposeEditorPanelPreviews',
    );
    expect(thumbnailRender).toContain(
      'await getEditorPanelAssetPreview(asset.id)',
    );
    expect(sceneRender).toContain(
      'await getEditorPanelAssetPreview(props.config)',
    );
    expect(sceneRender).not.toContain('renderEditorPanelCanvas(');
    expect(source).toContain('const assetPanelPreviewCache = new Map()');

    const detachedRender = section(
      source,
      'async function renderSceneFile',
      'function setWorkspaceView',
    );
    expect(detachedRender).toContain(
      'scheduleEditorSceneLowering(temporarySession, { force: true })',
    );
  });

  test('uses context-efficient defaults for isolated model previews', () => {
    const source = createRuntimeSource();
    const assetPreview = section(
      source,
      'async function renderSceneAssetPreview',
      'function scenePrefabs',
    );

    expect(assetPreview).toContain(
      'boundedAssetPreviewDimension(options.width, 640, 320)',
    );
    expect(assetPreview).toContain(
      'boundedAssetPreviewDimension(options.height, 480, 240)',
    );
  });

  test('keeps isolated model preview metadata complete', () => {
    const source = createRuntimeSource();
    const diagnostics = section(
      source,
      'function inspectAssetPreviewGeometry',
      'function applyAssetPreviewClayMaterial',
    );

    expect(diagnostics).toContain('root.traverseVisible((object) => {');
    expect(diagnostics).toContain('const namedParts = namedEntries.map');
    expect(diagnostics).toContain('namedPartsTruncated: false');
    expect(diagnostics).not.toContain('namedEntries.slice(0, 200)');
  });

  test('executes isolated model preview geometry diagnostics', async () => {
    const helpers = await loadAssetPreviewHelpers();
    const sharedGeometry = new BoxGeometry(1, 1, 1);
    const translatedMesh = new Mesh(sharedGeometry, new MeshStandardMaterial());
    translatedMesh.position.x = 5;
    translatedMesh.updateWorldMatrix(true, false);

    const translatedBounds =
      helpers.objectPreviewGeometryBounds(translatedMesh);
    expect(sharedGeometry.boundingBox).toBeNull();
    expect(translatedBounds?.min.x).toBeCloseTo(4.5);
    expect(translatedBounds?.max.x).toBeCloseTo(5.5);

    const triangleCount = (mesh: Mesh | InstancedMesh) =>
      helpers.assetPreviewRenderedTriangleCount(
        mesh,
        mesh.geometry,
        mesh.geometry.getAttribute('position'),
        mesh.geometry.getIndex(),
      );
    const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    expect(triangleCount(box)).toBe(12);
    box.material.visible = false;
    expect(triangleCount(box)).toBe(0);

    const ranged = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial(),
    );
    ranged.geometry.setDrawRange(3, 9);
    expect(triangleCount(ranged)).toBe(3);

    const groupedMaterials = Array.from(
      { length: 6 },
      () => new MeshStandardMaterial(),
    );
    groupedMaterials[0].visible = false;
    const grouped = new Mesh(new BoxGeometry(1, 1, 1), groupedMaterials);
    expect(triangleCount(grouped)).toBe(10);

    const instanced = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial(),
      4,
    );
    expect(triangleCount(instanced)).toBe(48);

    const root = new Group();
    root.name = 'Root';
    const visible = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial(),
    );
    visible.name = 'Visible';
    const hidden = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial(),
    );
    hidden.name = 'Hidden';
    hidden.position.x = 10;
    hidden.visible = false;
    root.add(visible, hidden);
    root.updateWorldMatrix(true, true);
    const entries = helpers.assetPreviewHierarchyEntries(root);
    const hierarchyBounds = helpers.assetPreviewHierarchyBounds(entries);
    expect(hierarchyBounds.get(root)?.max.x).toBeCloseTo(0.5);

    const duplicateRoot = new Group();
    duplicateRoot.name = 'DuplicateRoot';
    for (let index = 0; index < 50; index += 1) {
      const duplicate = new Group();
      duplicate.name = 'Duplicate';
      duplicateRoot.add(duplicate);
    }
    const duplicateEntries =
      helpers.assetPreviewHierarchyEntries(duplicateRoot);
    expect(duplicateEntries).toHaveLength(51);
    expect(() =>
      helpers.resolveAssetPreviewFocus(duplicateEntries, 'Duplicate'),
    ).toThrow('and 42 more');

    const deepRoot = new Group();
    deepRoot.name = 'RootAssemblyNode0000';
    let deepParent = deepRoot;
    for (let index = 0; index < 8; index += 1) {
      const group = new Group();
      group.name = `SubAssemblyNode${String(index).padStart(4, '0')}`;
      deepParent.add(group);
      deepParent = group;
    }
    for (let index = 0; index < 2; index += 1) {
      const duplicate = new Group();
      duplicate.name = 'TerminalDetailPart01';
      deepParent.add(duplicate);
    }
    const deepEntries = helpers.assetPreviewHierarchyEntries(deepRoot);
    const deepLeaves = deepEntries.filter(
      (entry) => entry.name === 'TerminalDetailPart01',
    );
    expect(deepLeaves[0].path.length).toBeGreaterThan(160);
    expect(deepLeaves[0].path.length).toBeLessThanOrEqual(512);
    expect(
      helpers.resolveAssetPreviewFocus(deepEntries, deepLeaves[0].path),
    ).toBe(deepLeaves[0]);
    let ambiguityMessage = '';
    try {
      helpers.resolveAssetPreviewFocus(deepEntries, 'TerminalDetailPart01');
    } catch (error) {
      ambiguityMessage = error instanceof Error ? error.message : String(error);
    }
    expect(ambiguityMessage).toContain('…');
    expect(ambiguityMessage).toContain('TerminalDetailPart01[1]');
    expect(ambiguityMessage).toContain('TerminalDetailPart01[2]');
    expect(ambiguityMessage.length).toBeLessThan(500);

    const sharedPrefix = `Root/${'a'.repeat(95)}`;
    const sharedSuffix = 'z'.repeat(90);
    const collidingPaths = [
      `${sharedPrefix}/first/${sharedSuffix}`,
      `${sharedPrefix}/second/${sharedSuffix}`,
    ];
    const collidingEntries = collidingPaths.map((entryPath) => ({
      name: 'CollidingLeaf',
      object: new Group(),
      path: entryPath,
      type: 'Group',
    }));
    let collidingMessage = '';
    try {
      helpers.resolveAssetPreviewFocus(collidingEntries, 'CollidingLeaf');
    } catch (error) {
      collidingMessage = error instanceof Error ? error.message : String(error);
    }
    expect(collidingMessage).toContain(collidingPaths[0]);
    expect(collidingMessage).toContain(collidingPaths[1]);
    expect(collidingMessage).not.toContain('…');

    const oversizedPrefix = `Root/${'a'.repeat(600)}`;
    const oversizedPaths = [
      `${oversizedPrefix}/first/${sharedSuffix}`,
      `${oversizedPrefix}/second/${sharedSuffix}`,
    ];
    const oversizedEntries = oversizedPaths.map((entryPath) => ({
      name: 'OversizedLeaf',
      object: new Group(),
      path: entryPath,
      type: 'Group',
    }));
    let oversizedMessage = '';
    try {
      helpers.resolveAssetPreviewFocus(oversizedEntries, 'OversizedLeaf');
    } catch (error) {
      oversizedMessage = error instanceof Error ? error.message : String(error);
    }
    const oversizedSuggestions = oversizedMessage
      .split('hierarchy paths: ')[1]
      .split(', ');
    expect(oversizedMessage.length).toBeLessThan(500);
    expect(oversizedSuggestions).toHaveLength(2);
    expect(oversizedSuggestions.every((path) => path.length <= 512)).toBe(true);
    expect(oversizedMessage).not.toContain(oversizedPaths[0]);
    expect(oversizedMessage).not.toContain(oversizedPaths[1]);

    let notFoundMessage = '';
    try {
      helpers.resolveAssetPreviewFocus(entries, 'z'.repeat(5_000));
    } catch (error) {
      notFoundMessage = error instanceof Error ? error.message : String(error);
    }
    expect(notFoundMessage).toContain('was not found');
    expect(notFoundMessage.length).toBeLessThan(300);
  });

  test('settles UIKitML previews from render and resource signals', () => {
    const source = createRuntimeSource();
    const scheduler = section(
      source,
      'function createEditorPanelFrameScheduler',
      'function refreshEditorPanelClassLists',
    );
    const settle = section(
      source,
      'async function settleEditorPanelLayout',
      'function disposeEditorPanelDocument',
    );

    expect(scheduler).toContain('rootContext.requestFrame = requestFrame');
    expect(scheduler).toContain('rootContext.requestRender = requestRender');
    expect(scheduler).toContain('object.fontSignal?.subscribe');
    expect(scheduler).toContain('object.texture?.subscribe');
    expect(settle).toContain('frameScheduler.resourcesReady()');
    expect(settle).toContain('frameScheduler.waitForFrameRequest(remaining)');
    expect(settle).not.toContain('minimumRenderFrames');
    expect(settle).not.toContain('stableFrames');
  });

  test('authors visibility intrinsically while keeping outliner visibility preview-only', () => {
    const source = createRuntimeSource();
    const schemas = section(
      source,
      'function authoredNodeVisible',
      'function runtimeComponentSchemas',
    );
    const inspector = section(
      source,
      'function renderInspector',
      'function projectNodePosition',
    );

    expect(schemas).toContain(
      "node?.components?.['com.iwsdk.components.Visibility']",
    );
    expect(schemas).toContain('schema.editor?.hidden !== true');
    expect(inspector).toContain('data-node-visible');
    expect(inspector).toContain("op: 'updateVisibility'");
    expect(workspaceSource).toContain('data-preview-visibility-toggle');
    expect(workspaceSource).toContain('Hide in editor');
    expect(workspaceSource).toContain('Show in editor');
  });

  test('stops the automatic world loop before configuring the editor renderer', () => {
    const source = createRuntimeSource();
    const worldCreated = source.indexOf('const world = await World.create');
    const loopStopped = source.indexOf(
      'world.renderer.setAnimationLoop(null);',
    );
    const runtimeRestored = source.indexOf(
      'window.FRAMEWORK_MCP_RUNTIME = editorRuntime;',
      worldCreated,
    );

    expect(worldCreated).toBeGreaterThan(-1);
    expect(loopStopped).toBeGreaterThan(worldCreated);
    expect(loopStopped).toBeLessThan(runtimeRestored);
  });

  test('adds manifest assets without exposing geometry or material editing', () => {
    const source = createRuntimeSource();
    const catalogAdd = section(
      source,
      'function addAssetFromCatalog',
      'function hideSceneGraphContextMenu',
    );
    const inspectorRender = section(
      source,
      'function renderAssetInspector',
      'function renderMultiSelectInspector',
    );

    expect(catalogAdd).toContain("{ asset: assetId, type: 'asset' }");
    expect(catalogAdd).not.toContain("'com.iwsdk.components.PanelUI'");
    expect(catalogAdd).not.toContain('geometry');
    expect(catalogAdd).not.toContain('material');
    expect(inspectorRender).toContain('data-node-asset-ref');
    expect(inspectorRender).not.toContain('geometry');
    expect(inspectorRender).not.toContain('material');
  });

  test('keeps human editor mutations outside the correction workflow', () => {
    const source = createRuntimeSource();

    expect(source).not.toContain('authorizeDocumentTransition:');
    expect(source).not.toContain('X-IWSDK-Review-Transition');
    expect(source).not.toContain('pendingReviewTransitionToken');
    expect(source).toContain('fetch(activeDocumentUrl(), {');
  });

  test('keeps expensive proof collection off interactive editor paths', () => {
    const source = createRuntimeSource();
    const orbitChange = section(
      source,
      "orbitControls.addEventListener('change'",
      'editorWorldState.orientationGizmo =',
    );
    const canvasPointerMove = section(
      source,
      "canvas.addEventListener('pointermove'",
      "canvas.addEventListener('pointercancel'",
    );
    const testHooksStart = source.indexOf(
      'window.IWSDK_SCENE_EDITOR_TEST_HOOKS =',
    );
    const interactiveRuntime = source.slice(0, testHooksStart);

    expect(testHooksStart).toBeGreaterThan(-1);
    expect(orbitChange).not.toContain('createViewportProof()');
    expect(canvasPointerMove).not.toContain('createViewportProof()');
    expect(interactiveRuntime.match(/createViewportProof\(\)/g)).toHaveLength(
      1,
    );
    expect(source).not.toContain('requestEditorUiRefresh');
    expect(source).not.toContain('invalidateViewportProof');
    expect(source).not.toContain('lastProof');
  });

  test('includes overhead floor probes only in on-demand visibility evidence', () => {
    const source = createRuntimeSource();
    const sampling = section(
      source,
      'function projectedFirstHitSamples',
      'function firstHitVisibleRenderables',
    );
    const canvasPointerMove = section(
      source,
      "canvas.addEventListener('pointermove'",
      "canvas.addEventListener('pointercancel'",
    );

    expect(sampling).toContain('camera.getWorldPosition(cameraPosition)');
    expect(sampling).toContain('cameraPosition.y > bounds.max.y');
    expect(sampling).toContain('new Vector2(0, -0.8)');
    expect(canvasPointerMove).not.toContain('visibleEditorSceneNodeIds()');
    expect(canvasPointerMove).not.toContain('firstHitVisibleRenderables(');
  });

  test('keeps agent review metadata out of the consolidated human asset UI', () => {
    const source = createRuntimeSource();
    const frame = section(
      source,
      'function createEditorFrame',
      'function getViewportHost',
    );
    const uiRender = section(
      source,
      'function renderUi',
      'function attachCanvasInteractions',
    );

    expect(frame).toContain('mountEditorWorkspace(root');
    expect(workspaceSource).toContain('data-bottom-tab="assets"');
    expect(workspaceSource).toContain('id="assets-panel"');
    expect(workspaceSource).toContain('id="asset-catalog"');
    expect(workspaceSource).toContain('thumbnailUrl={asset.thumbnailUrl}');
    expect(workspaceSource).toContain('name={asset.id}');
    expect(workspaceSource).not.toContain('id="primitive-catalog"');
    expect(workspaceSource).not.toContain('Composition Plan');
    expect(workspaceSource).not.toContain('Review Evidence');
    expect(workspaceSource).not.toContain('Scene Resources');
    expect(workspaceSource).not.toContain('data-reference-mode');
    expect(workspaceSource).not.toContain('data-review-lens');
    expect(uiRender).not.toContain('renderCompositionPlan(');
    expect(uiRender).not.toContain('renderReferenceViewer(');
    expect(uiRender).not.toContain('renderResourceInspector(');
    expect(uiRender).not.toContain('renderSceneResources(');
    expect(uiRender).not.toContain('updateReviewEvidenceStatus(');
    expect(source).not.toContain('data-primitive-material');
  });

  test('bundles group and UIKitML icons used by outliner rows', () => {
    const outliner = section(
      workspaceSource,
      'function SceneNodeRow',
      'function filterSceneNodes',
    );

    expect(workspaceSource).toContain('Boxes,');
    expect(workspaceSource).toContain('PanelTop,');
    expect(outliner).toContain('sceneNodeHasPanelUI(node)');
    expect(outliner).toContain("? 'PanelTop'");
    expect(outliner).toContain("? 'Boxes'");
  });

  test('renders one hidden-state icon per outliner row', () => {
    const outliner = section(
      workspaceSource,
      'function SceneNodeRow',
      'function filterSceneNodes',
    );

    expect(outliner.match(/EyeOff/g)).toHaveLength(1);
    expect(outliner).toContain("hidden ? 'EyeOff' : 'Eye'");
  });
});
