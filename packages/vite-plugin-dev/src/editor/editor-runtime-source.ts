/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  TAB_AUDIO_BINDING,
  TAB_AUDIO_CHANGE_EVENT,
} from '../managed-browser/tab-audio.js';

export function getEditorSessionModuleImport(): string {
  const candidates = [
    './scene-editor-session.js',
    './editor/scene-editor-session.js',
    './scene-editor-session.ts',
    './editor/scene-editor-session.ts',
  ];
  for (const candidate of candidates) {
    const modulePath = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(modulePath)) {
      return `/@fs/${modulePath}`;
    }
  }

  return `/@fs/${fileURLToPath(
    new URL('./scene-editor-session.ts', import.meta.url),
  )}`;
}

export function getEditorWorkspaceModuleImport(): string {
  const candidates = [
    './editor-workspace.js',
    './editor/editor-workspace.js',
    './editor-workspace.tsx',
    './editor/editor-workspace.tsx',
  ];
  for (const candidate of candidates) {
    const modulePath = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(modulePath)) {
      return `/@fs/${modulePath}`;
    }
  }

  return '@iwsdk/vite-plugin-dev/editor/workspace';
}

export function getCoreModuleImport(): string {
  const candidates = ['../../../core/src/index.ts', '../../core/src/index.ts'];
  for (const candidate of candidates) {
    const sourceModulePath = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(sourceModulePath)) {
      return `/@fs/${sourceModulePath}`;
    }
  }

  return '@iwsdk/core';
}

export function getSceneCompositionModuleImport(): string {
  const candidates = [
    '../../../scene-composition/src/index.ts',
    '../../scene-composition/src/index.ts',
  ];
  for (const candidate of candidates) {
    const sourceModulePath = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(sourceModulePath)) {
      return `/@fs/${sourceModulePath}`;
    }
  }

  return '@iwsdk/scene-composition';
}

export function getOrbitControlsModuleImport(): string {
  const candidates = [
    '../../../core/node_modules/three/examples/jsm/controls/OrbitControls.js',
    '../../core/node_modules/three/examples/jsm/controls/OrbitControls.js',
  ];
  for (const candidate of candidates) {
    const sourceModulePath = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(sourceModulePath)) {
      return `/@fs/${sourceModulePath}`;
    }
  }

  return 'three/examples/jsm/controls/OrbitControls.js';
}

export function getTransformControlsModuleImport(): string {
  const candidates = [
    '../../../core/node_modules/three/examples/jsm/controls/TransformControls.js',
    '../../core/node_modules/three/examples/jsm/controls/TransformControls.js',
  ];
  for (const candidate of candidates) {
    const sourceModulePath = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(sourceModulePath)) {
      return `/@fs/${sourceModulePath}`;
    }
  }

  return 'three/examples/jsm/controls/TransformControls.js';
}

export function getViewportGizmoModuleImport(): string {
  const candidates = [
    '../node_modules/three-viewport-gizmo/dist/three-viewport-gizmo.js',
    '../../node_modules/three-viewport-gizmo/dist/three-viewport-gizmo.js',
  ];
  for (const candidate of candidates) {
    const sourceModulePath = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(sourceModulePath)) {
      return `/@fs/${sourceModulePath}`;
    }
  }

  return 'three-viewport-gizmo';
}

const LUCIDE_DEFAULT_ATTRIBUTES = {
  fill: 'none',
  height: 24,
  stroke: 'currentColor',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'stroke-width': 2,
  viewBox: '0 0 24 24',
  width: 24,
  xmlns: 'http://www.w3.org/2000/svg',
};

const LUCIDE_ICON_NODES = {
  Box: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      [
        'path',
        {
          d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
        },
      ],
      ['path', { d: 'm3.3 7 8.7 5 8.7-5' }],
      ['path', { d: 'M12 22V12' }],
    ],
  ],
  CheckCheck: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M18 6 7 17l-5-5' }],
      ['path', { d: 'm22 10-7.5 7.5L13 16' }],
    ],
  ],
  Boxes: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      [
        'path',
        {
          d: 'M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0z',
        },
      ],
      ['path', { d: 'M7 17v5' }],
      ['path', { d: 'M11.7 14.2 7 17l-4.7-2.8' }],
      [
        'path',
        {
          d: 'M12.97 3.92A2 2 0 0 0 12 5.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71V5.63a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0z',
        },
      ],
      ['path', { d: 'M17 8v5' }],
      ['path', { d: 'm21.7 5.2-4.7 2.8-4.7-2.8' }],
    ],
  ],
  Check: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [['path', { d: 'M20 6 9 17l-5-5' }]],
  ],
  ChevronDown: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [['path', { d: 'm6 9 6 6 6-6' }]],
  ],
  ChevronRight: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [['path', { d: 'm9 18 6-6-6-6' }]],
  ],
  Eye: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      [
        'path',
        {
          d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
        },
      ],
      ['circle', { cx: '12', cy: '12', r: '3' }],
    ],
  ],
  EyeOff: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'm2 2 20 20' }],
      [
        'path',
        {
          d: 'M6.7 6.7C4.9 7.9 3.4 9.6 2.1 11.7a1 1 0 0 0 0 .6C4.2 15.8 7.7 18 12 18c1.1 0 2.2-.2 3.2-.5',
        },
      ],
      [
        'path',
        {
          d: 'M10.7 5.1A10.8 10.8 0 0 1 12 5c4.3 0 7.8 2.2 9.9 5.7a1 1 0 0 1 0 .6 14.3 14.3 0 0 1-2.4 3.1',
        },
      ],
      ['path', { d: 'M14.1 14.1A3 3 0 0 1 9.9 9.9' }],
    ],
  ],
  Focus: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['circle', { cx: '12', cy: '12', r: '3' }],
      ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2' }],
      ['path', { d: 'M17 3h2a2 2 0 0 1 2 2v2' }],
      ['path', { d: 'M21 17v2a2 2 0 0 1-2 2h-2' }],
      ['path', { d: 'M7 21H5a2 2 0 0 1-2-2v-2' }],
    ],
  ],
  Lock: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      [
        'rect',
        { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' },
      ],
      ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
    ],
  ],
  Unlock: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      [
        'rect',
        { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' },
      ],
      ['path', { d: 'M7 11V7a5 5 0 0 1 9.3-2.5' }],
    ],
  ],
  Globe2: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M21.54 15H17a2 2 0 0 0-2 2v4.54' }],
      [
        'path',
        {
          d: 'M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17',
        },
      ],
      [
        'path',
        { d: 'M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05' },
      ],
      ['circle', { cx: '12', cy: '12', r: '10' }],
    ],
  ],
  Magnet: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      [
        'path',
        {
          d: 'm6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15',
        },
      ],
      ['path', { d: 'm5 8 4 4' }],
      ['path', { d: 'm12 15 4 4' }],
    ],
  ],
  Move3D: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M5 3v16h16' }],
      ['path', { d: 'm5 19 6-6' }],
      ['path', { d: 'm2 6 3-3 3 3' }],
      ['path', { d: 'm18 16 3 3-3 3' }],
    ],
  ],
  Pencil: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }],
      ['path', { d: 'm15 5 4 4' }],
    ],
  ],
  Plus: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M5 12h14' }],
      ['path', { d: 'M12 5v14' }],
    ],
  ],
  X: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M18 6 6 18' }],
      ['path', { d: 'm6 6 12 12' }],
    ],
  ],
  Redo2: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'm15 14 5-5-5-5' }],
      ['path', { d: 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13' }],
    ],
  ],
  RefreshCcw: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
      ['path', { d: 'M3 3v5h5' }],
      ['path', { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' }],
      ['path', { d: 'M16 16h5v5' }],
    ],
  ],
  RotateCcw: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
      ['path', { d: 'M3 3v5h5' }],
    ],
  ],
  Rotate3D: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      [
        'path',
        {
          d: 'M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2',
        },
      ],
      ['path', { d: 'm15.194 13.707 3.814 1.86-1.86 3.814' }],
      [
        'path',
        {
          d: 'M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4',
        },
      ],
    ],
  ],
  Save: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      [
        'path',
        {
          d: 'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
        },
      ],
      ['path', { d: 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7' }],
      ['path', { d: 'M7 3v4a1 1 0 0 0 1 1h7' }],
    ],
  ],
  Scale3D: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M5 7v11a1 1 0 0 0 1 1h11' }],
      ['path', { d: 'M5.293 18.707 11 13' }],
      ['circle', { cx: '19', cy: '19', r: '2' }],
      ['circle', { cx: '5', cy: '5', r: '2' }],
    ],
  ],
  Undo2: [
    'svg',
    LUCIDE_DEFAULT_ATTRIBUTES,
    [
      ['path', { d: 'M9 14 4 9l5-5' }],
      [
        'path',
        { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' },
      ],
    ],
  ],
};

export function createEditorRuntimeModuleSource(
  editorSessionImport: string,
  coreImport: string,
  assetManifestImport = '/@iwsdk-asset-manifest',
  componentManifestImport = '/@iwsdk-component-manifest',
  orbitControlsImport = getOrbitControlsModuleImport(),
  transformControlsImport = getTransformControlsModuleImport(),
  viewportGizmoImport = getViewportGizmoModuleImport(),
  lucideIconNodes = LUCIDE_ICON_NODES,
  sceneCompositionImport = getSceneCompositionModuleImport(),
  editorWorkspaceImport = getEditorWorkspaceModuleImport(),
): string {
  return `
window.__IWSDK_SCENE_EDITOR_READY = false;
let SceneEditorSession;
let mountEditorWorkspace;
let OrbitControls;
let TransformControls;
let ViewportGizmo;
const LucideIcons = ${JSON.stringify(lucideIconNodes)};
let AdditiveBlending;
let AmbientLight;
let applySceneEnvironment;
let applyScenePatch;
let Box3;
let Box3Helper;
let BoxGeometry;
let BufferGeometry;
let CanvasTexture;
let Color;
let ComponentRegistry;
let componentCatalogFromComponents;
let configureUIKitRenderer;
let disposeLoweredSceneNodes;
let DomeFadeBinding;
let domeFadeSpecFromComponentValue;
let ConeGeometry;
let CylinderGeometry;
let DirectionalLight;
let EnvironmentSystem;
let Float32BufferAttribute;
let Frustum;
let FrontSide;
let finalizeSceneReviewDraft;
let Group;
let hashSceneDocument;
let hashRuntimeSceneDocument;
let LevelComponentApplier;
let LineBasicMaterial;
let LineSegments;
let LightBinding;
let lightSpecFromComponentValue;
let lowerSceneDocumentObjects;
let MathUtils;
let Matrix4;
let Mesh;
let MeshBasicMaterial;
let MeshStandardMaterial;
let OrthographicCamera;
let PerspectiveCamera;
let PlaneGeometry;
let Quaternion;
let Raycaster;
let restoreSceneEnvironment;
let Scene;
let ShaderMaterial;
let SphereGeometry;
let SRGBColorSpace;
let Types;
let UIKitDocument;
let IWSDK_BUILTIN_COMPONENTS;
let loadUIKitMLComponent;
let validateSceneReviewAgainstDocument;
let Vector2;
let Vector3;
let WebGLRenderer;
let WebGLRenderTarget;
let World;
let workspaceUi = null;
let editorAssetManifest = {};
let editorComponentManifest = [];
let editorPanelPreviewRendererState = null;
let editorPanelPreviewRendererCreatedCount = 0;
let editorPanelPreviewRenderQueue = Promise.resolve();
const editorPanelFrameSchedulers = new WeakMap();
const DEFAULT_EDITOR_DRAW_DISTANCE = 5000;
const MIN_EDITOR_DRAW_DISTANCE = 50;
const MAX_EDITOR_DRAW_DISTANCE = 100000;
const MIN_EDITOR_GRID_SPACING = 0.5;
const EDITOR_DRAW_DISTANCE_STORAGE_KEY = 'iwsdk-editor-view-distance';
const DEFAULT_EDITOR_TRANSFORM_SNAP = Object.freeze({
  rotationDeg: 15,
  scale: 0.1,
  translation: 0.25,
});
const EDITOR_TRANSFORM_SNAP_LIMITS = Object.freeze({
  rotationDeg: { max: 180, min: 0.1 },
  scale: { max: 10, min: 0.001 },
  translation: { max: 10000, min: 0.001 },
});
const EDITOR_TRANSFORM_SNAP_STORAGE_KEY = 'iwsdk-editor-transform-snap';
const TAB_AUDIO_BINDING = ${JSON.stringify(TAB_AUDIO_BINDING)};
const TAB_AUDIO_CHANGE_EVENT = ${JSON.stringify(TAB_AUDIO_CHANGE_EVENT)};

async function loadEditorRuntimeDependencies() {
  const [
    editorSessionModule,
    coreModule,
    orbitControlsModule,
    transformControlsModule,
    viewportGizmoModule,
    sceneCompositionModule,
    editorWorkspaceModule,
    assetManifestModule,
    componentManifestModule,
  ] = await Promise.all([
    import(${JSON.stringify(editorSessionImport)}),
    import(${JSON.stringify(coreImport)}),
    import(${JSON.stringify(orbitControlsImport)}),
    import(${JSON.stringify(transformControlsImport)}),
    import(${JSON.stringify(viewportGizmoImport)}),
    import(${JSON.stringify(sceneCompositionImport)}),
    import(${JSON.stringify(editorWorkspaceImport)}),
    import(${JSON.stringify(assetManifestImport)}),
    import(${JSON.stringify(componentManifestImport)}),
  ]);
  editorAssetManifest = assetManifestModule.default || {};
  ({ SceneEditorSession } = editorSessionModule);
  ({ mountEditorWorkspace } = editorWorkspaceModule);
  ({ OrbitControls } = orbitControlsModule);
  ({ TransformControls } = transformControlsModule);
  ({ ViewportGizmo } = viewportGizmoModule);
  ({
    applyScenePatch,
    finalizeSceneReviewDraft,
    hashRuntimeSceneDocument,
    hashSceneDocument,
    validateSceneReviewAgainstDocument,
  } = sceneCompositionModule);
  ({
    AdditiveBlending,
    AmbientLight,
    applySceneEnvironment,
    Box3,
    Box3Helper,
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Color,
    ComponentRegistry,
    componentCatalogFromComponents,
    configureUIKitRenderer,
    disposeLoweredSceneNodes,
    DomeFadeBinding,
    domeFadeSpecFromComponentValue,
    ConeGeometry,
    CylinderGeometry,
    DirectionalLight,
    EnvironmentSystem,
    Float32BufferAttribute,
    Frustum,
    FrontSide,
    Group,
    LevelComponentApplier,
    LineBasicMaterial,
    LineSegments,
    LightBinding,
    lightSpecFromComponentValue,
    lowerSceneDocumentObjects,
    MathUtils,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    OrthographicCamera,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    Raycaster,
    restoreSceneEnvironment,
    Scene,
    ShaderMaterial,
    SphereGeometry,
    SRGBColorSpace,
    Types,
    UIKitDocument,
    IWSDK_BUILTIN_COMPONENTS,
    loadUIKitMLComponent,
    Vector2,
    Vector3,
    WebGLRenderer,
    WebGLRenderTarget,
    World,
  } = coreModule);
  editorComponentManifest = componentManifestModule.default || [];
  if (!Array.isArray(editorComponentManifest)) {
    throw new Error('The IWSDK component manifest must default-export defineComponents([...])');
  }
  if (
    editorComponentManifest.componentRegistry &&
    editorComponentManifest.componentRegistry !== ComponentRegistry
  ) {
    throw new Error(
      'The component manifest and editor loaded different Elics registries. Ensure @iwsdk/core and elics resolve to one copy.',
    );
  }
}

const config = window.__IWSDK_EDITOR_CONFIG || {};
const documentUrl = config.documentUrl || '/__iwsdk/editor/document';
const sceneFilesUrl = config.sceneFilesUrl || '/__iwsdk/workspace/scenes';
const projectFilesUrl = config.projectFilesUrl || '/__iwsdk/workspace/files';
const reviewCapturesUrl =
  config.reviewCapturesUrl || '/__iwsdk/workspace/reviews/captures';
const reviewsUrl = config.reviewsUrl || '/__iwsdk/workspace/reviews';
const publishUrl = config.publishUrl || '/__iwsdk/workspace/publish';
const runtimePreflightUrl =
  config.runtimePreflightUrl || '/__iwsdk/workspace/runtime-preflight';
const root = document.getElementById('root');
const EDITOR_OPTIMIZE_RELOAD_KEY = 'iwsdk-editor-optimize-dep-reload';
const WORKSPACE_SCENE_PATH_KEY = 'iwsdk-workspace-scene-path';
const WORKSPACE_EDITOR_HASH_PREFIX = '#editor';
const ENTITY_REFERENCE_MIME = 'application/x-iwsdk-entity-reference';
const initialWorkspaceRoute = importWorkspaceRoute();
let editorWorldState = null;
let editorMutationQueue = Promise.resolve();
let editorStartupState = {
  loading: true,
  loadingProgress: 8,
  loadingStatus: 'Starting editor…',
};
let sceneDocumentPath = null;
let sceneDocumentRevision = null;
let sceneSourceDocumentHash = null;
let sceneComposedDocumentHash = null;
let sceneRuntimeHash = null;
let sceneSourceHasImports = false;
let sceneDependencyPaths = new Set();
let sceneFileReloadTimer = null;
let sceneFileReloadState = {
  conflict: false,
  diagnostics: [],
  lastReloadedAt: null,
  status: 'idle',
};
let workspaceScenePath = initialWorkspaceRoute.scenePath;
const assetThumbnailCache = new Map();
const assetThumbnailFailures = new Set();
const assetPanelNaturalSizeCache = new Map();
const assetPanelPreviewCache = new Map();
const assetPanelPreviewVersions = new Map();
let assetThumbnailGeneration = null;
let runtimeDispatch = async () => {
  throw new Error('Scene editor runtime is still loading');
};
let runtimeHandles = (method) =>
  String(method).startsWith('scene_') ||
  String(method).startsWith('ui_') ||
  String(method).startsWith('workspace_');
const collapsedOutlinerNodeIds = new Set();
const hiddenOutlinerNodeIds = new Set();
const ghostedOutlinerNodeIds = new Set();
const lockedOutlinerNodeIds = new Set();
const previewContextNodeIds = new Set();
let soloOutlinerNodeId = null;
let visibilityArrangementScenePath = null;
let visibilityArrangements = new Map();
let reviewStatusRequest = 0;
let reviewStatusState = {
  documentHash: null,
  reviews: [],
  status: 'idle',
};
window.__IWSDK_WORKSPACE_VIEW = initialWorkspaceRoute.view;
window.__IWSDK_WORKSPACE_PAGE_ID =
  window.__IWSDK_WORKSPACE_PAGE_ID ||
  \`workspace-\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2, 8)}\`;
window.__IWSDK_WORKSPACE_TAB_GENERATION =
  window.__IWSDK_WORKSPACE_TAB_GENERATION || 1;
window.__IWSDK_EDITOR_BOTTOM_TAB = 'assets';
window.__IWSDK_EDITOR_REVIEW_LENS = 'final';
window.__IWSDK_EDITOR_REFERENCE_MODE = 'hidden';
window.__IWSDK_EDITOR_REFERENCE_ID = null;
window.__IWSDK_EDITOR_RESOURCE_SELECTION = null;
window.__IWSDK_EDITOR_ROOT_SELECTED = false;
window.__IWSDK_EDITOR_BUILTIN_SELECTION = null;
window.__IWSDK_EDITOR_EVENTS = [];
document.documentElement.dataset.iwsdkWorkspaceView = window.__IWSDK_WORKSPACE_VIEW;

window.FRAMEWORK_MCP_RUNTIME = {
  handles: (method) => runtimeHandles(method),
  dispatch: (method, params = {}) => runtimeDispatch(method, params),
};

function recordEditorEvent(method, result) {
  if (
    [
      'scene_get_document',
      'scene_get_hierarchy',
      'scene_get_logs',
      'scene_get_selection',
      'scene_list_assets',
      'scene_list_component_schemas',
      'scene_screenshot',
      'scene_compare_screenshots',
    ].includes(method)
  ) {
    return;
  }
  const events = Array.isArray(window.__IWSDK_EDITOR_EVENTS)
    ? window.__IWSDK_EDITOR_EVENTS
    : [];
  const action =
    result && typeof result === 'object' && typeof result.action === 'string'
      ? result.action
      : method;
  events.push({
    action,
    method,
    timestamp: Date.now(),
  });
  window.__IWSDK_EDITOR_EVENTS = events.slice(-50);
}

function handlesWorkspaceMethod(method) {
  return [
    'scene_get_state',
    'scene_flatten_file',
    'scene_render_file',
    'scene_measure_image_regions',
    'scene_set_preview_visibility',
    'scene_open',
  ].includes(method);
}

function handlesEditorMethodWithoutSession(method) {
  const value = String(method);
  return (
    handlesWorkspaceMethod(value) ||
    value.startsWith('scene_') ||
    value.startsWith('ui_')
  );
}

function dispatchEditorMethodWithoutSession(
  method,
  params = {},
  unavailableMessage =
    'No scene is open in the IWSDK editor. Open the Editor view and select a scene, or run npx @iwsdk/cli scene open --input-json with the scene path.',
) {
  if (handlesWorkspaceMethod(method)) {
    return dispatchWorkspaceCommand(null, method, params);
  }
  throw new Error(
    unavailableMessage + \` Then retry "\${String(method)}".\`,
  );
}

function readStoredWorkspaceScenePath() {
  try {
    const value = sessionStorage.getItem(WORKSPACE_SCENE_PATH_KEY);
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  } catch {
    return null;
  }
}

function storeWorkspaceScenePath(scenePath) {
  workspaceScenePath = scenePath;
  try {
    sessionStorage.setItem(WORKSPACE_SCENE_PATH_KEY, scenePath);
  } catch {}
}

function parseWorkspaceEditorHash(hash = window.location.hash) {
  if (hash === WORKSPACE_EDITOR_HASH_PREFIX) {
    return { matched: true, scenePath: null };
  }
  if (!hash.startsWith(WORKSPACE_EDITOR_HASH_PREFIX + '/')) {
    return { matched: false, scenePath: null };
  }
  const encodedPath = hash.slice(WORKSPACE_EDITOR_HASH_PREFIX.length + 1);
  try {
    const segments = encodedPath.split('/').map(decodeURIComponent);
    if (
      segments.length === 0 ||
      segments.some(
        (segment) =>
          !segment || segment === '.' || segment === '..' || segment.includes('/'),
      )
    ) {
      return { matched: true, scenePath: null };
    }
    const relativePath = segments.join('/');
    if (!relativePath.endsWith('.iwsdk.scene.json')) {
      return { matched: true, scenePath: null };
    }
    return {
      matched: true,
      scenePath: relativePath.startsWith('public/scenes/')
        ? relativePath
        : 'public/scenes/' + relativePath,
    };
  } catch {
    return { matched: true, scenePath: null };
  }
}

function editorHashForScene(scenePath) {
  if (!scenePath) {
    return WORKSPACE_EDITOR_HASH_PREFIX;
  }
  const relativePath = scenePath.startsWith('public/scenes/')
    ? scenePath.slice('public/scenes/'.length)
    : scenePath;
  return (
    WORKSPACE_EDITOR_HASH_PREFIX +
    '/' +
    relativePath.split('/').map(encodeURIComponent).join('/')
  );
}

function workspaceLocationFor(view, scenePath = null) {
  return view === 'editor' ? '/' + editorHashForScene(scenePath) : '/';
}

function syncWorkspaceLocation(view, scenePath, { replace = false } = {}) {
  const target = workspaceLocationFor(view, scenePath);
  const current =
    window.location.pathname + window.location.search + window.location.hash;
  if (current === target) {
    return;
  }
  history[replace ? 'replaceState' : 'pushState'](history.state, '', target);
}

function importWorkspaceRoute() {
  const pageUrl = new URL(window.location.href);
  const configuredDocumentUrl = new URL(documentUrl, pageUrl);
  const editorRoute = parseWorkspaceEditorHash(pageUrl.hash);
  const importedScenePath =
    pageUrl.searchParams.get('scene') ||
    configuredDocumentUrl.searchParams.get('scene');
  const legacyScenePath =
    typeof importedScenePath === 'string' && importedScenePath.trim().length > 0
      ? importedScenePath.trim()
      : null;
  const view = editorRoute.matched || legacyScenePath ? 'editor' : 'runtime';
  const scenePath = editorRoute.matched
    ? editorRoute.scenePath
    : legacyScenePath || readStoredWorkspaceScenePath();
  if (scenePath) {
    try {
      sessionStorage.setItem(WORKSPACE_SCENE_PATH_KEY, scenePath);
    } catch {}
  }
  syncWorkspaceLocation(view, scenePath, { replace: true });
  return { scenePath, view };
}

function currentScenePath() {
  return workspaceScenePath;
}

function hasConfiguredScenePath() {
  return currentScenePath() != null;
}

function requireOpenScenePath() {
  const scenePath = currentScenePath();
  if (!scenePath) {
    throw new Error('Open a scene before using review evidence tools');
  }
  return scenePath;
}

function workspaceState(session) {
  const pageId =
    window.__IWSDK_MCP_PAGE_ID ||
    (typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('iwer-mcp-tab-id:editor')
      : null) ||
    window.__IWSDK_WORKSPACE_PAGE_ID;
  const rawGeneration =
    window.__IWSDK_MCP_TAB_GENERATION ||
    (typeof sessionStorage !== 'undefined'
      ? Number(sessionStorage.getItem('iwer-mcp-gen:editor') || '0')
      : null) ||
    window.__IWSDK_WORKSPACE_TAB_GENERATION;
  const tabGeneration = Number.isFinite(rawGeneration)
    ? rawGeneration
    : null;
  const sceneSessionId = window.__IWSDK_SCENE_SESSION_ID;
  const bridge = window.IWER_MCP;
  const runtimeFrame = document.getElementById('workspace-runtime-frame');
  const runtimePresent = runtimeFrame instanceof HTMLIFrameElement;
  const runtimeReady = window.__IWSDK_WORKSPACE_RUNTIME_READY === true;
  const runtimeStale = window.__IWSDK_WORKSPACE_RUNTIME_STALE === true;
  const runtimeReadinessReason = runtimeReady
    ? null
    : !runtimePresent
      ? 'runtime_frame_missing'
      : runtimeStale
        ? 'reload_deferred_until_runtime_view'
        : runtimeFrame.getAttribute('src')
          ? 'runtime_frame_loading'
          : 'runtime_frame_not_loaded';
  const iwerDevice = window.IWER_DEVICE;
  const emulationProfile = window.__IWSDK_EMULATION_PROFILE;
  const iwerAvailable = iwerDevice != null;
  return {
    view: window.__IWSDK_WORKSPACE_VIEW || 'runtime',
    managed: window.__IWER_MCP_MANAGED === true,
    bridge: {
      available: bridge != null,
      connected: bridge?.connected === true,
      connectionState:
        typeof bridge?.connectionState === 'string'
          ? bridge.connectionState
          : 'unavailable',
      pageId,
      pageRole: window.__IWSDK_MCP_PAGE_ROLE || 'editor',
      tabGeneration,
    },
    workspace: {
      pageId,
      tabGeneration,
    },
    runtime: {
      present: runtimePresent,
      ready: runtimeReady,
      readinessReason: runtimeReadinessReason,
      stale: runtimeStale,
      pageId: pageId ? \`\${pageId}:runtime\` : null,
    },
    editor: {
      present: true,
      ready: Boolean(session),
      commandReady: Boolean(session),
      viewportReady: Boolean(editorWorldState?.world),
      scenePath: currentScenePath(),
      pageId: pageId ? \`\${pageId}:editor\` : null,
      sceneSessionId: session ? sceneSessionId : null,
      dirty: Boolean(session?.isDirty),
    },
    iwer: {
      available: iwerAvailable,
      active:
        iwerAvailable && emulationProfile?.active === true,
      deviceName:
        iwerAvailable && typeof iwerDevice.name === 'string'
          ? iwerDevice.name
          : null,
    },
    xr: {
      apiAvailable: navigator.xr != null,
      sessionObservable: iwerAvailable,
      sessionActive: iwerAvailable
        ? Boolean(iwerDevice.activeSession)
        : null,
      sessionOffered: iwerAvailable
        ? Boolean(iwerDevice.sessionOffered)
        : null,
    },
  };
}

async function sceneState(session) {
  const workspace = workspaceState(session);
  if (!session) {
    return {
      activeFile: currentScenePath(),
      conflict: false,
      diagnostics: [],
      dirty: false,
      editor: workspace.editor,
      renderStats: null,
      runtime: workspace.runtime,
      selection: { nodeIds: [] },
      validation: { issues: [], valid: false },
    };
  }
  const [selection, validation, hashes] = await Promise.all([
    session.dispatch('scene_get_selection', {}),
    session.dispatch('scene_validate', {}),
    session.dispatch('scene_get_document', {}),
  ]);
  const runtimeFrame = document.getElementById('workspace-runtime-frame');
  return {
    activeFile: currentScenePath(),
    composedDocumentHash: sceneComposedDocumentHash || hashes.documentHash,
    conflict: sceneFileReloadState.conflict,
    dependencies: [...sceneDependencyPaths].filter(
      (path) => path !== currentScenePath(),
    ),
    diagnostics: sceneFileReloadState.diagnostics,
    dirty: session.isDirty,
    editor: {
      ...workspace.editor,
      fileStatus: sceneFileReloadState.status,
      lastReloadedAt: sceneFileReloadState.lastReloadedAt,
    },
    renderStats: currentEditorRenderStats(),
    runtime: {
      ...workspace.runtime,
      error: window.__IWSDK_WORKSPACE_RUNTIME_ERROR || null,
      expectedRuntimeHash: sceneRuntimeHash || hashes.runtimeHash,
      frameConnected:
        runtimeFrame instanceof HTMLIFrameElement &&
        runtimeFrame.contentWindow != null,
    },
    runtimeHash: sceneRuntimeHash || hashes.runtimeHash,
    selection: {
      ...selection,
      builtInTarget: window.__IWSDK_EDITOR_BUILTIN_SELECTION || null,
      rootSelected: window.__IWSDK_EDITOR_ROOT_SELECTED === true,
    },
    sourceDocumentHash: sceneSourceDocumentHash,
    validation:
      sceneFileReloadState.status === 'invalid'
        ? { issues: sceneFileReloadState.diagnostics, valid: false }
        : validation,
  };
}

function updateComposedSceneIdentity(loaded) {
  sceneDocumentPath = loaded.path || currentScenePath();
  sceneDocumentRevision = loaded.revision || sceneDocumentRevision;
  sceneSourceDocumentHash = loaded.sourceDocumentHash || null;
  sceneComposedDocumentHash = loaded.documentHash || null;
  sceneRuntimeHash = loaded.runtimeHash || null;
  sceneSourceHasImports = Array.isArray(loaded.sourceDocument?.imports) &&
    loaded.sourceDocument.imports.length > 0;
  sceneDependencyPaths = new Set([
    currentScenePath(),
    ...(loaded.dependencies || []).map((dependency) => dependency.path),
  ].filter((value) => typeof value === 'string' && value.length > 0));
}

function fileReloadDiagnostics(error) {
  if (Array.isArray(error?.diagnostics) && error.diagnostics.length > 0) {
    return error.diagnostics;
  }
  if (Array.isArray(error?.issues) && error.issues.length > 0) {
    return error.issues;
  }
  return [{
    code: error?.code || 'scene_file_reload_failed',
    message: String(error?.message || error),
    path: '$',
  }];
}

async function reloadComposedSceneFromDisk(session, getCamera) {
  if (!session || !currentScenePath()) {
    return;
  }
  // The watcher also observes this editor's autosaves. Let any mutation that
  // caused the event finish updating the saved revision/hash before deciding
  // whether the disk write came from another author.
  await editorMutationQueue;
  sceneFileReloadState = {
    ...sceneFileReloadState,
    conflict: false,
    diagnostics: [],
    status: 'loading',
  };
  try {
    const loaded = await fetchComposedSceneDocument(currentScenePath());
    if (
      loaded.sourceDocumentHash === sceneSourceDocumentHash &&
      loaded.documentHash === sceneComposedDocumentHash
    ) {
      sceneDocumentRevision = loaded.revision || sceneDocumentRevision;
      sceneFileReloadState = {
        conflict: false,
        diagnostics: [],
        lastReloadedAt: sceneFileReloadState.lastReloadedAt,
        status: 'ready',
      };
      return;
    }
    if (session.isDirty) {
      sceneFileReloadState = {
        conflict: true,
        diagnostics: [{
          code: 'scene_file_editor_conflict',
          message:
            'The scene changed on disk while the editor has unsaved changes.',
          path: '$',
        }],
        lastReloadedAt: sceneFileReloadState.lastReloadedAt,
        status: 'conflict',
      };
      renderUi(session, getCamera());
      return;
    }
    await session.replaceFromDisk(loaded.document);
    updateComposedSceneIdentity(loaded);
    sceneFileReloadState = {
      conflict: false,
      diagnostics: [],
      lastReloadedAt: new Date().toISOString(),
      status: 'ready',
    };
    setEditorSelection(
      (await session.dispatch('scene_get_selection', {})).nodeIds || [],
    );
    clearValidationResult();
    renderCanvas(session, getCamera());
    renderUi(session, getCamera());
    reloadWorkspaceRuntimeFrame();
  } catch (error) {
    const diagnostics = fileReloadDiagnostics(error);
    sceneFileReloadState = {
      conflict: false,
      diagnostics,
      lastReloadedAt: sceneFileReloadState.lastReloadedAt,
      status: 'invalid',
    };
    setValidationResult({ issues: diagnostics, valid: false });
    renderUi(session, getCamera());
  }
}

function installSceneFileWatcher(session, getCamera) {
  if (!import.meta.hot) {
    return;
  }
  import.meta.hot.on('iwsdk:runtime-source-change', () => {
    reloadWorkspaceRuntimeFrame();
  });
  import.meta.hot.on('iwsdk:scene-file-change', (event) => {
    const changedPath = String(event?.path || '');
    if (!sceneDependencyPaths.has(changedPath)) {
      return;
    }
    if (sceneFileReloadTimer != null) {
      clearTimeout(sceneFileReloadTimer);
    }
    sceneFileReloadTimer = setTimeout(() => {
      sceneFileReloadTimer = null;
      void reloadComposedSceneFromDisk(session, getCamera);
    }, 80);
  });
}

async function renderSceneFile(session, params = {}) {
  const scenePath = requireScenePath(params);
  let loaded;
  try {
    loaded = await fetchComposedSceneDocument(scenePath);
  } catch (error) {
    return {
      diagnostics: fileReloadDiagnostics(error),
      error: String(error?.message || error),
      path: scenePath,
      valid: false,
    };
  }

  const temporarySession = new SceneEditorSession({
    componentCatalog: runtimeComponentCatalog(),
    document: loaded.document,
    listAssets: () =>
      editorWorldState?.world?.assets?.catalog?.() ||
      editorWorldState?.world?.assets?.list?.() ||
      [],
    resolveAssetBounds: (assetId) =>
      editorWorldState?.world?.assets?.bounds?.(assetId),
  });
  const cameraParams =
    params.camera && typeof params.camera === 'object'
      ? params.camera
      : params;
  const cameraResult = await temporarySession.dispatch(
    'scene_set_camera',
    cameraParams,
  );
  const camera = cameraResult.camera;
  const width = Number.isFinite(params.width)
    ? Math.max(1, Math.floor(params.width))
    : undefined;
  const height = Number.isFinite(params.height)
    ? Math.max(1, Math.floor(params.height))
    : undefined;
  const previousSession = editorWorldState?.currentSession || session || null;
  const previousCamera = editorWorldState?.currentCamera || null;
  const previousSceneDocumentPath = sceneDocumentPath;
  let restoreCaptureState = () => {};
  try {
    sceneDocumentPath = loaded.path || scenePath;
    if (!editorWorldState) {
      await createEditorWorld(temporarySession, camera);
    }
    restoreCaptureState = beginRenderOnlyCapture();
    editorWorldState.currentSession = temporarySession;
    // A detached render is also an explicit request to re-evaluate external
    // assets. The scene JSON may be unchanged while a same-URL UIKitML source
    // (or another manifest-backed resource) changed on disk.
    await scheduleEditorSceneLowering(temporarySession, { force: true });
    renderCanvas(temporarySession, camera, { height, width });
    await waitForAssetLoads();
    renderCanvas(temporarySession, camera, { height, width });
    const canvas = getCanvas();
    const imageData = canvas.toDataURL('image/png').split(',')[1] || '';
    return {
      camera,
      composedDocumentHash: loaded.documentHash,
      dependencies: loaded.dependencies || [],
      diagnostics: [],
      height: canvas.height,
      imageData,
      mimeType: 'image/png',
      path: loaded.path || scenePath,
      renderStats: currentEditorRenderStats(),
      runtimeHash: loaded.runtimeHash,
      screenshotSha256: await sha256Base64Bytes(imageData),
      sourceDocumentHash: loaded.sourceDocumentHash,
      valid: true,
      width: canvas.width,
    };
  } catch (error) {
    return {
      diagnostics: fileReloadDiagnostics(error),
      error: String(error?.message || error),
      path: loaded.path || scenePath,
      valid: false,
    };
  } finally {
    restoreCaptureState();
    sceneDocumentPath = previousSceneDocumentPath;
    if (previousSession && editorWorldState) {
      editorWorldState.currentSession = previousSession;
      await scheduleEditorSceneLowering(previousSession).catch(() => {});
      renderCanvas(
        previousSession,
        previousCamera || editorWorldState.currentCamera,
      );
    }
  }
}

function setWorkspaceView(
  view,
  { replaceRoute = false, syncRoute = true } = {},
) {
  if (!['runtime', 'editor'].includes(view)) {
    throw new Error('workspace_set_view.view must be runtime or editor');
  }
  if (syncRoute) {
    syncWorkspaceLocation(view, currentScenePath(), { replace: replaceRoute });
  }
  window.__IWSDK_WORKSPACE_VIEW = view;
  document.documentElement.dataset.iwsdkWorkspaceView = view;
  workspaceUi?.update({ view });
  updateWorkspaceDocumentTitle(view);
  for (const button of document.querySelectorAll('[data-workspace-view-button]')) {
    button.toggleAttribute('data-active', button.dataset.workspaceViewButton === view);
  }
  if (view !== 'editor') {
    const reload = window.__IWSDK_WORKSPACE_RUNTIME_STALE === true;
    loadWorkspaceRuntimeFrame({ reload });
    window.__IWSDK_WORKSPACE_RUNTIME_STALE = false;
  }
  if (view !== 'runtime') {
    scheduleEditorViewportRender();
  }
}

function sceneEditorDocumentTitle() {
  const scenePath = currentScenePath();
  if (!scenePath) {
    return 'IWSDK Scene Editor';
  }
  const fileName = scenePath.split('/').pop() || scenePath;
  const sceneName = fileName.replace(/\.iwsdk\.scene\.json$/i, '');
  return sceneName + ' - IWSDK Scene Editor';
}

function runtimeDocumentTitle() {
  const runtimeFrame = document.getElementById('workspace-runtime-frame');
  try {
    const title = runtimeFrame?.contentDocument?.title?.trim();
    if (title) {
      return title;
    }
  } catch {}
  return 'IWSDK Runtime';
}

function updateWorkspaceDocumentTitle(
  view = window.__IWSDK_WORKSPACE_VIEW || 'runtime',
) {
  document.title =
    view === 'runtime' ? runtimeDocumentTitle() : sceneEditorDocumentTitle();
}

let workspaceNavigationReloading = false;

function applyWorkspaceLocation() {
  if (workspaceNavigationReloading) {
    return;
  }
  const route = parseWorkspaceEditorHash();
  if (!route.matched) {
    void setWorkspaceView('runtime', { syncRoute: false });
    return;
  }
  if (route.scenePath === currentScenePath()) {
    void setWorkspaceView('editor', { syncRoute: false });
    return;
  }
  workspaceNavigationReloading = true;
  if (route.scenePath) {
    storeWorkspaceScenePath(route.scenePath);
  }
  window.location.reload();
}

function forceEditorViewportRender() {
  if (!editorWorldState) {
    return;
  }
  resizeEditorRenderer();
  renderEditorWorld();
  if (editorWorldState.currentSession) {
    updateProjectedHitTargets(editorWorldState.currentSession);
  }
}

function scheduleEditorViewportRender() {
  if (typeof requestAnimationFrame !== 'function') {
    forceEditorViewportRender();
    return;
  }
  requestAnimationFrame(() => {
    forceEditorViewportRender();
    requestAnimationFrame(forceEditorViewportRender);
  });
}

function attachWorkspaceViewControls() {
  const runtimeFrame = document.getElementById('workspace-runtime-frame');
  if (runtimeFrame) {
    runtimeFrame.addEventListener('load', () => {
      window.__IWSDK_WORKSPACE_RUNTIME_READY = true;
      if ((window.__IWSDK_WORKSPACE_VIEW || 'runtime') === 'runtime') {
        updateWorkspaceDocumentTitle('runtime');
      }
    });
  }
  window.addEventListener('hashchange', applyWorkspaceLocation);
  window.addEventListener('popstate', applyWorkspaceLocation);
  window.addEventListener(TAB_AUDIO_CHANGE_EVENT, () => {
    workspaceUi?.update(workspaceTabAudioState());
  });
  void setWorkspaceView(window.__IWSDK_WORKSPACE_VIEW || 'runtime', {
    syncRoute: false,
  });
}

// The managed browser installs the tab audio controller and host binding;
// the mute control stays hidden in any other browser.
function workspaceTabAudioState() {
  const tabAudio = window.__IWSDK_TAB_AUDIO;
  return {
    tabAudioAvailable:
      tabAudio != null && typeof window[TAB_AUDIO_BINDING] === 'function',
    tabAudioMuted: tabAudio?.muted === true,
  };
}

async function waitForWorkspaceRuntimeFrame(timeoutMs = 10000) {
  const startedAt = performance.now();
  while (window.__IWSDK_WORKSPACE_RUNTIME_READY !== true) {
    if (performance.now() - startedAt >= timeoutMs) {
      throw new Error('Workspace runtime frame did not become ready');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function loadWorkspaceRuntimeFrame({ reload = false } = {}) {
  const runtimeFrame = document.getElementById('workspace-runtime-frame');
  if (!(runtimeFrame instanceof HTMLIFrameElement)) {
    return false;
  }

  const currentSrc = runtimeFrame.getAttribute('src');
  if (!reload && currentSrc) {
    return true;
  }

  window.__IWSDK_WORKSPACE_RUNTIME_READY = false;
  const source = runtimeFrame.dataset.workspaceRuntimeSrc || currentSrc || '/';
  const url = new URL(source, window.location.href);
  if (reload) {
    url.searchParams.set('__iwsdk_preview_reload', Date.now().toString(36));
  }
  runtimeFrame.src = url.pathname + url.search + url.hash;
  return true;
}

function reloadWorkspaceRuntimeFrame() {
  const runtimeFrame = document.getElementById('workspace-runtime-frame');
  if (!(runtimeFrame instanceof HTMLIFrameElement)) {
    return false;
  }
  if ((window.__IWSDK_WORKSPACE_VIEW || 'editor') === 'editor') {
    window.__IWSDK_WORKSPACE_RUNTIME_STALE = true;
    window.__IWSDK_WORKSPACE_RUNTIME_READY = false;
    return true;
  }
  if (!runtimeFrame.getAttribute('src')) {
    return false;
  }
  return loadWorkspaceRuntimeFrame({ reload: true });
}

function documentUrlForScene(scenePath) {
  const url = new URL(documentUrl, window.location.href);
  url.searchParams.set('scene', scenePath);
  return url.pathname + url.search;
}

function activeDocumentUrl() {
  const scenePath = currentScenePath();
  return scenePath ? documentUrlForScene(scenePath) : documentUrl;
}

function composedDocumentUrlForScene(scenePath) {
  const url = new URL(documentUrlForScene(scenePath), window.location.href);
  url.searchParams.set('mode', 'composed');
  return url.pathname + url.search;
}

function scheduleSceneOpen(scenePath) {
  storeWorkspaceScenePath(scenePath);
  setTimeout(() => {
    syncWorkspaceLocation('editor', scenePath);
    window.location.reload();
  }, 25);
}

async function fetchJsonOrThrow(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw sceneFetchError(json, text || response.statusText);
  }
  return json;
}

async function fetchSceneDocumentWithRevision(url) {
  const response = await fetch(url);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw sceneFetchError(json, text || response.statusText);
  }
  return {
    document: json,
    path: response.headers.get('X-IWSDK-Scene-Path'),
    revision: response.headers.get('X-IWSDK-Scene-Revision'),
  };
}

async function fetchComposedSceneDocument(scenePath) {
  const response = await fetch(composedDocumentUrlForScene(scenePath));
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = sceneFetchError(json, text || response.statusText);
    Object.assign(error, {
      diagnostics: Array.isArray(json?.diagnostics) ? json.diagnostics : [],
      path: scenePath,
      status: response.status,
    });
    throw error;
  }
  if (!json?.document || !json?.sourceDocument) {
    throw new Error('Composed scene response is missing document data');
  }
  return json;
}

function sceneFetchError(json, fallback) {
  const error = new Error(json?.error || fallback);
  if (json && typeof json === 'object') {
    Object.assign(error, json);
  }
  return error;
}

function requireScenePath(params) {
  const scenePath = params?.path;
  if (typeof scenePath !== 'string' || scenePath.trim().length === 0) {
    throw new Error('A scene path under public/scenes is required');
  }
  return scenePath.trim();
}

function importBearingSceneError(scenePath, sourceDocument) {
  const error = new Error(
    'This scene is an authoring composition with imports. Flatten it before opening it in the editable editor or application runtime.',
  );
  Object.assign(error, {
    code: 'scene_imports_require_flattening',
    details: {
      imports: (sourceDocument?.imports || []).map((entry) => ({
        id: entry.id,
        src: entry.src,
      })),
      path: scenePath,
      suggestedCommand:
        'npx @iwsdk/cli scene flatten --input-json ' +
        JSON.stringify(JSON.stringify({ path: scenePath })),
    },
    recoverable: true,
    retryAction: 'scene_flatten_file',
  });
  return error;
}

async function flattenSceneFile(params = {}) {
  const scenePath = requireScenePath(params);
  return fetchJsonOrThrow(sceneFilesUrl, {
    body: JSON.stringify({
      action: 'flatten',
      path: scenePath,
      ...(typeof params.outputPath === 'string'
        ? { outputPath: params.outputPath }
        : {}),
      ...(params.overwrite === true ? { overwrite: true } : {}),
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

function subtreeNodeIds(documentValue, nodeId) {
  const node = findNodeById(documentValue, nodeId);
  if (!node) {
    throw new Error('Scene node does not exist: ' + nodeId);
  }
  const ids = [];
  const visit = (entry) => {
    ids.push(entry.id);
    for (const child of entry.children || []) {
      visit(child);
    }
  };
  visit(node);
  return ids;
}

async function sha256Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return (
    'sha256:' +
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  );
}

async function setPreviewVisibilityFromCommand(session, params) {
  const mode = typeof params.mode === 'string' ? params.mode : null;
  const supportedModes = [
    'apply-arrangement',
    'context',
    'ghost',
    'hide',
    'lock',
    'reset',
    'save-arrangement',
    'show',
    'solo',
    'uncontext',
    'unghost',
    'unlock',
  ];
  if (!supportedModes.includes(mode)) {
    throw new Error(
      'scene_set_preview_visibility.mode must be ' + supportedModes.join(', '),
    );
  }
  const nodeIds = Array.isArray(params.nodeIds) ? params.nodeIds : [];
  if (nodeIds.some((nodeId) => typeof nodeId !== 'string')) {
    throw new Error('scene_set_preview_visibility.nodeIds must contain node ids');
  }
  for (const nodeId of nodeIds) {
    findNodeHierarchyInfo(session.document, nodeId) ||
      (() => {
        throw new Error('Scene node does not exist: ' + nodeId);
      })();
  }
  if (mode === 'reset') {
    resetPreviewVisibilityState();
  } else if (mode === 'solo') {
    if (nodeIds.length > 1) {
      throw new Error('Solo accepts at most one node id');
    }
    soloOutlinerNodeId = nodeIds[0] || null;
  } else if (mode === 'save-arrangement' || mode === 'apply-arrangement') {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!name) {
      throw new Error(mode + ' requires a non-empty name');
    }
    loadVisibilityArrangements();
    if (mode === 'save-arrangement') {
      visibilityArrangements.set(name, currentPreviewVisibilityState());
      persistVisibilityArrangements();
    } else {
      const state = visibilityArrangements.get(name);
      if (!state) {
        throw new Error('Visibility arrangement does not exist: ' + name);
      }
      restorePreviewVisibilityArrangement(state);
    }
  } else {
    const target =
      mode === 'hide' || mode === 'show'
        ? hiddenOutlinerNodeIds
        : mode === 'ghost' || mode === 'unghost'
          ? ghostedOutlinerNodeIds
          : mode === 'lock' || mode === 'unlock'
            ? lockedOutlinerNodeIds
            : previewContextNodeIds;
    const remove = ['show', 'unghost', 'unlock', 'uncontext'].includes(mode);
    for (const nodeId of nodeIds) {
      const affectedIds =
        remove && params.recursive !== false
          ? subtreeNodeIds(session.document, nodeId)
          : [nodeId];
      for (const affectedId of affectedIds) {
        if (remove) {
          target.delete(affectedId);
        } else {
          target.add(affectedId);
        }
      }
    }
  }
  applyEditorReviewLens(session.document);
  syncTransformControlsToSelection(session);
  renderEditorWorld();
  const state = currentPreviewVisibilityState();
  const hashes = await session.dispatch('scene_get_document', {});
  const visibleNodeIds = nodesInDocument(session.document)
    .filter((node) => editorWorldState?.objectMap.get(node.id)?.visible === true)
    .map((node) => node.id);
  return {
    action: 'previewVisibilityUpdated',
    documentHash: hashes.documentHash,
    previewState: state,
    previewStateHash: await sha256Utf8(JSON.stringify(state)),
    runtimeHash: hashes.runtimeHash,
    visibleNodeIds,
  };
}

function normalizedImageRegion(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
  ) {
    throw new Error(label + ' must be [x, y, width, height]');
  }
  const [x, y, width, height] = value;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new Error(label + ' must be a positive normalized region inside the image');
  }
  return [x, y, width, height];
}

async function sha256ArrayBuffer(value) {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return (
    'sha256:' +
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  );
}

async function imageBitmapFromBytes(bytes, mimeType) {
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const image = new Image();
  image.src = objectUrl;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  return {
    close: () => URL.revokeObjectURL(objectUrl),
    height: image.naturalHeight,
    source: image,
    width: image.naturalWidth,
  };
}

function base64ImageBytes(imageData) {
  const binary = atob(imageData);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function imageRegionPixels(bitmap, region) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('2D image measurement canvas is unavailable');
  }
  context.drawImage(bitmap.source, 0, 0);
  const x = Math.max(0, Math.floor(region[0] * bitmap.width));
  const y = Math.max(0, Math.floor(region[1] * bitmap.height));
  const width = Math.max(1, Math.ceil(region[2] * bitmap.width));
  const height = Math.max(1, Math.ceil(region[3] * bitmap.height));
  return context.getImageData(
    x,
    y,
    Math.min(width, bitmap.width - x),
    Math.min(height, bitmap.height - y),
  );
}

function srgbChannelToLinear(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearRgbToOklab(red, green, blue) {
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function summarizeImageRegion(imageData) {
  const luma = [];
  const oklab = [0, 0, 0];
  let highlightCount = 0;
  let shadowCount = 0;
  let count = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3] / 255;
    if (alpha <= 0.001) {
      continue;
    }
    const red = srgbChannelToLinear(imageData.data[index]);
    const green = srgbChannelToLinear(imageData.data[index + 1]);
    const blue = srgbChannelToLinear(imageData.data[index + 2]);
    const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const lab = linearRgbToOklab(red, green, blue);
    luma.push(value);
    oklab[0] += lab[0];
    oklab[1] += lab[1];
    oklab[2] += lab[2];
    highlightCount += value >= 0.8 ? 1 : 0;
    shadowCount += value <= 0.2 ? 1 : 0;
    count += 1;
  }
  luma.sort((left, right) => left - right);
  const divisor = Math.max(1, count);
  return {
    highlightFootprint: Number((highlightCount / divisor).toFixed(6)),
    lumaPercentiles: {
      p10: Number(percentile(luma, 0.1).toFixed(6)),
      p50: Number(percentile(luma, 0.5).toFixed(6)),
      p90: Number(percentile(luma, 0.9).toFixed(6)),
    },
    meanOklab: oklab.map((value) => Number((value / divisor).toFixed(6))),
    pixelCount: count,
    shadowFootprint: Number((shadowCount / divisor).toFixed(6)),
  };
}

function imageMetricDelta(reference, render) {
  return {
    highlightFootprint: Number((render.highlightFootprint - reference.highlightFootprint).toFixed(6)),
    lumaPercentiles: {
      p10: Number((render.lumaPercentiles.p10 - reference.lumaPercentiles.p10).toFixed(6)),
      p50: Number((render.lumaPercentiles.p50 - reference.lumaPercentiles.p50).toFixed(6)),
      p90: Number((render.lumaPercentiles.p90 - reference.lumaPercentiles.p90).toFixed(6)),
    },
    meanOklab: render.meanOklab.map((value, index) =>
      Number((value - reference.meanOklab[index]).toFixed(6)),
    ),
    shadowFootprint: Number((render.shadowFootprint - reference.shadowFootprint).toFixed(6)),
  };
}

async function measureImageRegions(session, params) {
  const captureToken = typeof params.captureToken === 'string' ? params.captureToken : '';
  const referenceId = typeof params.referenceId === 'string' ? params.referenceId : '';
  const capture = session.getPendingReviewCapture(captureToken);
  const reference = session.document.authoring?.composition?.input?.references?.find(
    (entry) => entry.id === referenceId,
  );
  if (!reference) {
    throw new Error('referenceId must name a declared composition input reference');
  }
  if (!Array.isArray(params.regions) || params.regions.length === 0 || params.regions.length > 64) {
    throw new Error('scene_measure_image_regions.regions must contain 1 to 64 regions');
  }
  const referenceResponse = await fetch(reference.uri);
  if (!referenceResponse.ok) {
    throw new Error('Could not load declared reference ' + reference.uri);
  }
  const referenceBytes = await referenceResponse.arrayBuffer();
  const referenceSha256 = await sha256ArrayBuffer(referenceBytes);
  if (
    referenceSha256.slice('sha256:'.length).toLowerCase() !==
    reference.sha256.toLowerCase()
  ) {
    throw new Error('Declared reference SHA-256 does not match loaded bytes');
  }
  const captureBytes = base64ImageBytes(capture.imageData);
  const [referenceBitmap, renderBitmap] = await Promise.all([
    imageBitmapFromBytes(referenceBytes, referenceResponse.headers.get('content-type') || 'image/png'),
    imageBitmapFromBytes(captureBytes, capture.mimeType || 'image/png'),
  ]);
  try {
    const regions = params.regions.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('regions[' + index + '] must be an object');
      }
      const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : 'region-' + index;
      const referenceRegion = normalizedImageRegion(entry.referenceRegion, 'regions[' + index + '].referenceRegion');
      const renderRegion = entry.renderRegion == null
        ? referenceRegion
        : normalizedImageRegion(entry.renderRegion, 'regions[' + index + '].renderRegion');
      const referenceSummary = summarizeImageRegion(imageRegionPixels(referenceBitmap, referenceRegion));
      const renderSummary = summarizeImageRegion(imageRegionPixels(renderBitmap, renderRegion));
      return {
        delta: imageMetricDelta(referenceSummary, renderSummary),
        id,
        reference: { metrics: referenceSummary, region: referenceRegion },
        render: { metrics: renderSummary, region: renderRegion },
      };
    });
    return {
      applicability: 'aligned-declared-regions-only',
      captureToken,
      interpretation: 'diagnostic-deltas-not-a-universal-pass-gate',
      policy: {
        alpha: 'ignore-fully-transparent',
        colorSpace: 'linear-srgb-to-oklab',
        highlightLumaThreshold: 0.8,
        shadowLumaThreshold: 0.2,
      },
      reference: {
        height: reference.height,
        id: reference.id,
        sha256: referenceSha256,
        uri: reference.uri,
        width: reference.width,
      },
      regions,
      render: {
        height: capture.height,
        screenshotSha256: capture.screenshotSha256,
        width: capture.width,
      },
    };
  } finally {
    referenceBitmap.close();
    renderBitmap.close();
  }
}

function reviewValidationError(message, issues) {
  const safeIssues = Array.isArray(issues) ? issues : [];
  const details = safeIssues
    .slice(0, 12)
    .map((issue) =>
      String(issue?.path || '$') + ': ' + String(issue?.message || issue),
    );
  if (safeIssues.length > details.length) {
    details.push('... ' + (safeIssues.length - details.length) + ' more issue(s)');
  }
  const error = new Error(
    details.length === 0 ? message : message + ': ' + details.join('; '),
  );
  error.code = 'invalid_scene_review';
  error.issues = safeIssues;
  return error;
}

async function persistPendingReviewCapture(session, captureId, captureToken) {
  const scene = requireOpenScenePath();
  const capture = session.getPendingReviewCapture(captureToken);
  return fetchJsonOrThrow(reviewCapturesUrl, {
    body: JSON.stringify({
      action: 'persist',
      captureId,
      captureToken: capture.captureToken,
      scene,
      sessionId: window.__IWSDK_SCENE_SESSION_ID,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

function reviewCaptureFromBatchResult(id, view, capture, persisted) {
  if (
    capture?.reviewCamera == null ||
    capture?.rendererEnvironment == null ||
    !Array.isArray(capture?.visibleNodeIds)
  ) {
    throw new Error(
      'Review capture metadata is incomplete; renderer, camera, and visibility facts are required',
    );
  }
  return {
    camera: capture.reviewCamera,
    height: persisted.height,
    id,
    path: persisted.path,
    rendererEnvironment: capture.rendererEnvironment,
    screenshotSha256: persisted.screenshotSha256,
    view,
    visibleNodeIds: capture.visibleNodeIds,
    width: persisted.width,
    ...(capture.nodeMaskRegions == null
      ? {}
      : { nodeMaskRegions: capture.nodeMaskRegions }),
  };
}

async function captureReviewSet(session, params) {
  if (session.isDirty) {
    throw new Error(
      'Scene has unsaved editor changes; save before capturing immutable review evidence',
    );
  }
  const requests = Array.isArray(params.captures) ? params.captures : [];
  if (requests.length === 0 || requests.length > 32) {
    throw new Error('scene_capture_review_set.captures must contain 1 to 32 requests');
  }
  const ids = new Set();
  for (const request of requests) {
    if (!request || typeof request !== 'object') {
      throw new Error('Each review capture request must be an object');
    }
    if (
      typeof request.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.id)
    ) {
      throw new Error('Each review capture request requires a safe, stable id');
    }
    if (ids.has(request.id)) {
      throw new Error('Duplicate review capture id: ' + request.id);
    }
    ids.add(request.id);
    if (!['layout', 'geometry', 'final'].includes(request.lens)) {
      throw new Error(
        'Review capture "' + request.id + '" lens must be layout, geometry, or final',
      );
    }
    if (typeof request.viewId !== 'string' || request.viewId.length === 0) {
      throw new Error(
        'Review capture "' + request.id + '" requires an exact saved authoring viewId',
      );
    }
  }

  const defaultWidth = params.width;
  const defaultHeight = params.height;
  const captures = [];
  let activeLens = null;
  try {
    for (const request of requests) {
      const width = request.width ?? defaultWidth;
      const height = request.height ?? defaultHeight;
      if (
        !Number.isInteger(width) ||
        width < 1 ||
        width > 4096 ||
        !Number.isInteger(height) ||
        height < 1 ||
        height > 4096
      ) {
        throw new Error(
          'Review capture "' + request.id + '" requires integer width/height from 1 to 4096',
        );
      }
      if (activeLens !== request.lens) {
        await session.dispatch('scene_set_review_lens', { lens: request.lens });
        activeLens = request.lens;
      }
      const capture = await session.dispatch('scene_capture_review', {
        featureState: request.featureState,
        height,
        includeImageData: false,
        viewId: request.viewId,
        width,
      });
      const persisted = await persistPendingReviewCapture(
        session,
        request.id,
        capture.captureToken,
      );
      captures.push({
        lens: request.lens,
        ...reviewCaptureFromBatchResult(
          request.id,
          request.viewId,
          capture,
          persisted,
        ),
      });
    }
  } catch (error) {
    if (error && typeof error === 'object') {
      error.completedCaptures = captures;
    }
    throw error;
  }
  const hashes = await session.dispatch('scene_get_document', {});
  const capabilities = await session.dispatch('scene_get_capabilities', {});
  return {
    action: 'reviewSetCaptured',
    capabilityHash: capabilities.capabilityHash,
    captureCount: captures.length,
    captures,
    documentHash: hashes.documentHash,
    runtimeHash: hashes.runtimeHash,
    status: 'persisted',
  };
}

async function finalizeAndSaveReview(session, params) {
  if (session.isDirty) {
    throw new Error(
      'Scene has unsaved editor changes; save before finalizing a review',
    );
  }
  const captureEntries = Array.isArray(params.captures) ? params.captures : [];
  const lensResults = Array.isArray(params.lensResults)
    ? params.lensResults
    : [];
  if (captureEntries.length === 0) {
    throw new Error(
      'scene_finalize_review.captures must include persisted evidence from scene_capture_review_set',
    );
  }
  if (lensResults.length === 0) {
    throw new Error(
      'scene_finalize_review.lensResults must include a human status for every configured lens',
    );
  }
  const statusByLens = new Map();
  for (const result of lensResults) {
    if (
      !result ||
      !['layout', 'geometry', 'final'].includes(result.lens) ||
      !['pass', 'partial', 'fail', 'not-applicable'].includes(result.status)
    ) {
      throw new Error(
        'scene_finalize_review.lensResults entries require a canonical lens and review status',
      );
    }
    if (statusByLens.has(result.lens)) {
      throw new Error(
        'scene_finalize_review.lensResults contains duplicate lens: ' +
          result.lens,
      );
    }
    statusByLens.set(result.lens, result.status);
  }
  const capturesByLens = new Map();
  for (const entry of captureEntries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !['layout', 'geometry', 'final'].includes(entry.lens)
    ) {
      throw new Error(
        'scene_finalize_review.captures must be entries returned by scene_capture_review_set',
      );
    }
    const { lens, ...capture } = entry;
    const lensCaptures = capturesByLens.get(lens) || [];
    lensCaptures.push(capture);
    capturesByLens.set(lens, lensCaptures);
  }
  const configuredLenses =
    session.document.authoring?.composition?.review?.lenses ||
    [...capturesByLens.keys()];
  for (const lens of configuredLenses) {
    if (!statusByLens.has(lens)) {
      throw new Error(
        'scene_finalize_review.lensResults is missing configured lens: ' + lens,
      );
    }
  }
  for (const lens of new Set([
    ...statusByLens.keys(),
    ...capturesByLens.keys(),
  ])) {
    if (!configuredLenses.includes(lens)) {
      throw new Error(
        'scene_finalize_review includes unconfigured review lens: ' + lens,
      );
    }
  }
  const lenses = configuredLenses.map((lens) => ({
    captures: capturesByLens.get(lens) || [],
    id: lens,
    status: statusByLens.get(lens),
  }));
  const capabilities = await session.dispatch('scene_get_capabilities', {});
  const finalized = finalizeSceneReviewDraft(
    session.document,
    capabilities.capabilityHash,
    {
      correction: params.correction,
      lenses,
      openDefectTags: params.openDefectTags,
      previousReview: params.previousReview,
      round: params.round,
      stopReason: params.stopReason,
      visualResults: params.visualResults,
    },
  );
  const validation = validateSceneReviewAgainstDocument(
    finalized.review,
    session.document,
    capabilities.capabilityHash,
  );
  if (!validation.valid) {
    throw reviewValidationError(
      'Assisted review finalization failed validation',
      validation.issues,
    );
  }
  const result = await fetchJsonOrThrow(reviewsUrl, {
    body: JSON.stringify({
      capabilityHash: capabilities.capabilityHash,
      review: finalized.review,
      scene: requireOpenScenePath(),
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  reviewStatusState = { documentHash: null, reviews: [], status: 'idle' };
  return {
    ...result,
    deterministicResults: finalized.deterministicEvaluations.map(
      ({ criterion, feature, reason, status }) => ({
        criterion,
        feature,
        reason,
        status,
      }),
    ),
    result: finalized.review.result,
    routing:
      finalized.review.result === 'pass'
        ? { next: 'scene_publish', status: 'ready-to-publish' }
        : { next: 'scene_apply_transaction', status: 'continue-refining' },
    stop: finalized.review.stop,
  };
}

async function dispatchWorkspaceCommand(session, method, params = {}) {
  switch (method) {
    case 'scene_get_state':
      return sceneState(session);
    case 'scene_flatten_file':
      return flattenSceneFile(params);
    case 'scene_render_file':
      return renderSceneFile(session, params);
    case 'workspace_get_state':
      return workspaceState(session);
    case 'workspace_set_view':
      setWorkspaceView(params.view);
      if (params.view === 'runtime') {
        await waitForWorkspaceRuntimeFrame();
      }
      return workspaceState(session);
    case 'scene_set_preview_visibility':
      if (!session) {
        throw new Error('Open a scene before changing preview visibility');
      }
      return setPreviewVisibilityFromCommand(session, params);
    case 'scene_measure_image_regions':
      if (!session) {
        throw new Error('Open a scene before measuring image regions');
      }
      return measureImageRegions(session, params);
    case 'scene_capture_review_set':
      if (!session) {
        throw new Error('Open a scene before capturing review evidence');
      }
      return captureReviewSet(session, params);
    case 'scene_list_files': {
      const result = await fetchJsonOrThrow(sceneFilesUrl);
      const query =
        typeof params.query === 'string' ? params.query.toLowerCase() : '';
      return query
        ? {
            files: (result.files || []).filter((file) =>
              String(file.path || '').toLowerCase().includes(query),
            ),
          }
        : result;
    }
    case 'scene_persist_review_capture': {
      if (!session) {
        throw new Error('Open a scene before persisting review evidence');
      }
      return persistPendingReviewCapture(
        session,
        params.captureId,
        params.captureToken,
      );
    }
    case 'scene_finalize_review':
      if (!session) {
        throw new Error('Open a scene before finalizing a review');
      }
      return finalizeAndSaveReview(session, params);
    case 'scene_save_review': {
      if (!session) {
        throw new Error('Open a scene before saving a review record');
      }
      const scene = requireOpenScenePath();
      const capabilities = await session.dispatch('scene_get_capabilities', {});
      const validation = validateSceneReviewAgainstDocument(
        params.review,
        session.document,
        capabilities.capabilityHash,
      );
      if (!validation.valid) {
        throw reviewValidationError(
          'Review record does not match the active editor scene and capabilities',
          validation.issues,
        );
      }
      const result = await fetchJsonOrThrow(reviewsUrl, {
        body: JSON.stringify({
          capabilityHash: capabilities.capabilityHash,
          review: params.review,
          scene,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      reviewStatusState = { documentHash: null, reviews: [], status: 'idle' };
      return result;
    }
    case 'scene_list_reviews': {
      if (!session) {
        throw new Error('Open a scene before listing review records');
      }
      const capabilities = await session.dispatch('scene_get_capabilities', {});
      const url = new URL(reviewsUrl, window.location.href);
      url.searchParams.set('scene', requireOpenScenePath());
      url.searchParams.set('capabilityHash', capabilities.capabilityHash);
      return fetchJsonOrThrow(url.pathname + url.search);
    }
    case 'scene_get_review': {
      if (!session) {
        throw new Error('Open a scene before reading a review record');
      }
      const reviewPath =
        typeof params.path === 'string' && params.path.trim().length > 0
          ? params.path.trim()
          : null;
      if (!reviewPath) {
        throw new Error('scene_get_review.path is required');
      }
      const capabilities = await session.dispatch('scene_get_capabilities', {});
      const url = new URL(reviewsUrl, window.location.href);
      url.searchParams.set('scene', requireOpenScenePath());
      url.searchParams.set('capabilityHash', capabilities.capabilityHash);
      url.searchParams.set('path', reviewPath);
      return fetchJsonOrThrow(url.pathname + url.search);
    }
    case 'scene_publish': {
      if (!session) {
        throw new Error('Open a scene before publishing');
      }
      if (session.isDirty) {
        throw new Error('Scene has unsaved editor changes; save before publishing');
      }
      const reviewPath =
        typeof params.reviewPath === 'string' &&
        params.reviewPath.trim().length > 0
          ? params.reviewPath.trim()
          : null;
      if (!reviewPath) {
        throw new Error('scene_publish.reviewPath is required');
      }
      const representativeNodeIds = Array.isArray(params.representativeNodeIds)
        ? params.representativeNodeIds
        : undefined;
      if (
        representativeNodeIds?.some(
          (nodeId) => typeof nodeId !== 'string' || nodeId.trim().length === 0,
        )
      ) {
        throw new Error(
          'scene_publish.representativeNodeIds must contain non-empty node ids',
        );
      }
      const capabilities = await session.dispatch('scene_get_capabilities', {});
      try {
        return await fetchJsonOrThrow(publishUrl, {
          body: JSON.stringify({
            capabilityHash: capabilities.capabilityHash,
            detail: params.detail === 'full' ? 'full' : 'compact',
            representativeNodeIds,
            reviewPath,
            scene: requireOpenScenePath(),
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
      } catch (error) {
        if (
          error?.code === 'runtime_publish_proof_failed' &&
          error?.report?.runtimeProven === 'failed'
        ) {
          return {
            code: error.code,
            error: error.message,
            failedChecks:
              error.failedChecks || error.report?.failedChecks || [],
            proofPath: error.proofPath,
            proofSha256: error.proofSha256,
            report: error.report,
            runtimeProven:
              error.runtimeProven || error.report?.runtimeProven || 'failed',
            warnings: error.warnings || error.report?.warnings || [],
          };
        }
        throw error;
      }
    }
    case 'scene_runtime_preflight': {
      if (!session) {
        throw new Error('Open a scene before checking runtime preflight');
      }
      if (session.isDirty) {
        throw new Error('Save the scene before checking runtime preflight');
      }
      return fetchJsonOrThrow(runtimePreflightUrl, {
        body: JSON.stringify({
          detail: params.detail,
          sampleFrames: params.sampleFrames,
          scene: requireOpenScenePath(),
          warmupFrames: params.warmupFrames,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
    }
    case 'scene_open': {
      const scenePath = requireScenePath(params);
      const opened = await fetchComposedSceneDocument(scenePath);
      if ((opened.sourceDocument?.imports?.length || 0) > 0) {
        throw importBearingSceneError(scenePath, opened.sourceDocument);
      }
      scheduleSceneOpen(scenePath);
      return {
        composedDocumentHash: opened.documentHash,
        dependencies: opened.dependencies || [],
        path: scenePath,
        revision: opened.revision,
        reloading: true,
        runtimeHash: opened.runtimeHash,
        sceneSessionId: window.__IWSDK_SCENE_SESSION_ID,
        sourceDocumentHash: opened.sourceDocumentHash,
      };
    }
    default:
      throw new Error(\`Unsupported workspace method "\${method}"\`);
  }
}

async function renderScenePicker() {
  const status = document.getElementById('editor-status-strip');
  if (status) {
    status.textContent = 'Choose a scene file';
  }
  const host = document.querySelector('[data-workspace-editor-pane]');
  if (!host) {
    return;
  }
  const dialog = document.createElement('section');
  dialog.className = 'scene-picker-dialog';
  dialog.setAttribute('aria-label', 'Open scene file');
  dialog.innerHTML =
    '<div class="scene-picker-card">' +
    '<div class="scene-picker-header">' +
    '<h1>Open Scene</h1>' +
    '<p>Scene files live under <code>public/scenes/</code>.</p>' +
    '</div>' +
    '<div id="scene-picker-list" class="scene-picker-list">Loading scenes...</div>' +
    '</div>';
  host.appendChild(dialog);

  const list = dialog.querySelector('#scene-picker-list');
  const renderFiles = async () => {
    const result = await dispatchWorkspaceCommand(null, 'scene_list_files', {});
    const files = result.files || [];
    if (files.length === 0) {
      list.innerHTML =
        '<div class="scene-picker-empty">No scene files found.</div>';
      return;
    }
    list.innerHTML = files
      .map(
        (file) =>
          '<button type="button" data-scene-picker-path="' +
          escapePickerAttribute(file.path) +
          '" data-scene-picker-imports="' +
          (file.hasImports ? 'true' : 'false') +
          '">' +
          escapePickerHtml(file.path) +
          (file.hasImports ? ' · Flatten to edit' : '') +
          '</button>',
      )
      .join('');
    for (const button of list.querySelectorAll('[data-scene-picker-path]')) {
      button.addEventListener('click', async () => {
        try {
          let scenePath = button.dataset.scenePickerPath;
          if (button.dataset.scenePickerImports === 'true') {
            button.disabled = true;
            button.textContent = 'Flattening ' + scenePath + '…';
            const flattened = await dispatchWorkspaceCommand(
              null,
              'scene_flatten_file',
              { path: scenePath },
            );
            scenePath = flattened.outputPath;
          }
          await dispatchWorkspaceCommand(null, 'scene_open', {
            path: scenePath,
          });
        } catch (error) {
          list.textContent = String(error?.message || error);
        }
      });
    }
  };

  await renderFiles();
}

async function renderFlattenRequired(scenePath, sourceDocument) {
  const status = document.getElementById('editor-status-strip');
  if (status) {
    status.textContent = 'Flatten composition to edit';
  }
  const host = document.querySelector('[data-workspace-editor-pane]');
  if (!host) {
    return;
  }
  const importCount = sourceDocument?.imports?.length || 0;
  const dialog = document.createElement('section');
  dialog.className = 'scene-picker-dialog';
  dialog.setAttribute('aria-label', 'Flatten scene composition');
  dialog.innerHTML =
    '<div class="scene-picker-card">' +
    '<div class="scene-picker-header">' +
    '<h1>Flatten to Edit</h1>' +
    '<p><code>' + escapePickerHtml(scenePath) + '</code> is an authoring composition with ' +
    importCount + ' import' + (importCount === 1 ? '' : 's') +
    '. Runtime and editable scenes must be import-free.</p>' +
    '</div>' +
    '<div class="scene-picker-list">' +
    '<button type="button" data-flatten-active-scene>Flatten into a new editable scene</button>' +
    '<p data-flatten-active-status>Scratch modules remain unchanged. The flat output becomes the source of truth.</p>' +
    '</div>' +
    '</div>';
  host.appendChild(dialog);
  const button = dialog.querySelector('[data-flatten-active-scene]');
  const message = dialog.querySelector('[data-flatten-active-status]');
  button?.addEventListener('click', async () => {
    button.disabled = true;
    if (message) message.textContent = 'Composing and verifying runtime hash…';
    try {
      const flattened = await flattenSceneFile({ path: scenePath });
      if (message) message.textContent = 'Opening ' + flattened.outputPath + '…';
      scheduleSceneOpen(flattened.outputPath);
    } catch (error) {
      button.disabled = false;
      if (message) message.textContent = String(error?.message || error);
    }
  });
}

function escapePickerHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    })[character],
  );
}

function escapePickerAttribute(value) {
  return escapePickerHtml(value).replace(/'/g, '&#39;');
}

function setRoot(content) {
  if (root) {
    root.innerHTML = content;
  }
}

function updateEditorStartupProgress(status, progress) {
  const normalizedProgress = Math.min(100, Math.max(0, Number(progress) || 0));
  editorStartupState = {
    loading: true,
    loadingProgress: normalizedProgress,
    loadingStatus: String(status),
  };
  workspaceUi?.update(editorStartupState);

  const statusElement = document.getElementById('editor-loading-status');
  if (statusElement) {
    statusElement.textContent = editorStartupState.loadingStatus;
  }
  const progressElement = document.getElementById('editor-loading-progress');
  if (progressElement) {
    progressElement.classList.remove('editor-loading-progress-indeterminate');
    progressElement.style.width = normalizedProgress + '%';
  }
  const track = document.getElementById('editor-loading-track');
  track?.setAttribute('aria-valuenow', String(normalizedProgress));
}

function completeEditorStartup() {
  editorStartupState = {
    loading: false,
    loadingProgress: 100,
    loadingStatus: 'Editor ready',
  };
  workspaceUi?.update(editorStartupState);
}

function renderLucideIcon(name) {
  const icon = LucideIcons?.[name];
  if (!Array.isArray(icon)) {
    return '';
  }
  return renderLucideNode(icon);
}

function renderLucideNode(node) {
  const [tagName, attributes = {}, children = []] = node;
  const attrs = Object.entries(attributes)
    .map(([name, value]) => \`\${name}="\${escapeHtml(value)}"\`)
    .join(' ');
  const childMarkup = Array.isArray(children)
    ? children.map((child) => renderLucideNode(child)).join('')
    : '';
  return \`<\${tagName} class="lucide-icon" \${attrs} aria-hidden="true">\${childMarkup}</\${tagName}>\`;
}

const EDITOR_CONTRIBUTION_SLOTS = [
  'bottomPanel.tab',
  'inspector.global',
  'inspector.pinned',
  'inspector.section',
  'sidebar.bottom',
  'sidebar.top',
  'toolbar.center',
  'toolbar.left',
  'toolbar.right',
  'viewport.overlay',
];

const EDITOR_CONTRIBUTION_SLOT_SET = new Set(EDITOR_CONTRIBUTION_SLOTS);

function editorContributions() {
  if (!Array.isArray(window.__IWSDK_EDITOR_CONTRIBUTIONS)) {
    window.__IWSDK_EDITOR_CONTRIBUTIONS = [];
  }
  return window.__IWSDK_EDITOR_CONTRIBUTIONS;
}

function validateEditorContribution(contribution) {
  if (!contribution || typeof contribution !== 'object') {
    throw new Error('Editor contribution must be an object');
  }
  const id = String(contribution.id || '').trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(id)) {
    throw new Error('Editor contribution id must be a stable identifier');
  }
  const slot = String(contribution.slot || '').trim();
  if (!EDITOR_CONTRIBUTION_SLOT_SET.has(slot)) {
    throw new Error('Unsupported editor contribution slot "' + slot + '"');
  }
  const label = String(contribution.label || '').trim();
  if (label.length === 0) {
    throw new Error('Editor contribution label is required');
  }
  if (
    contribution.onClick != null &&
    typeof contribution.onClick !== 'function'
  ) {
    throw new Error('Editor contribution onClick must be a function');
  }
  return {
    body:
      contribution.body == null
        ? ''
        : String(contribution.body).slice(0, 800),
    icon:
      typeof contribution.icon === 'string' &&
      LucideIcons[contribution.icon] != null
        ? contribution.icon
        : '',
    id,
    label,
    onClick: contribution.onClick,
    order: Number.isFinite(contribution.order) ? contribution.order : 0,
    slot,
  };
}

function registerEditorContribution(contribution) {
  const normalized = validateEditorContribution(contribution);
  const contributions = editorContributions();
  const existingIndex = contributions.findIndex(
    (entry) => entry.id === normalized.id,
  );
  if (existingIndex === -1) {
    contributions.push(normalized);
  } else {
    contributions.splice(existingIndex, 1, normalized);
  }
  sortEditorContributions(contributions);
  rerenderEditorContributions();
  return {
    contribution: {
      body: normalized.body,
      icon: normalized.icon,
      id: normalized.id,
      label: normalized.label,
      order: normalized.order,
      slot: normalized.slot,
    },
    valid: true,
  };
}

function unregisterEditorContribution(id) {
  const contributions = editorContributions();
  const index = contributions.findIndex((entry) => entry.id === id);
  if (index !== -1) {
    contributions.splice(index, 1);
    rerenderEditorContributions();
  }
  return { id, removed: index !== -1 };
}

function sortEditorContributions(contributions) {
  contributions.sort(
    (left, right) =>
      left.slot.localeCompare(right.slot) ||
      left.order - right.order ||
      left.id.localeCompare(right.id),
  );
}

function contributionsForSlot(slot) {
  return editorContributions().filter((entry) => entry.slot === slot);
}

function contributionPublicSnapshot(contribution) {
  return {
    body: contribution.body,
    icon: contribution.icon,
    id: contribution.id,
    label: contribution.label,
    order: contribution.order,
    slot: contribution.slot,
  };
}

function editorContributionProof() {
  const slots = {};
  for (const slot of EDITOR_CONTRIBUTION_SLOTS) {
    slots[slot] = contributionsForSlot(slot).length;
  }
  return {
    count: editorContributions().length,
    items: editorContributions().map(contributionPublicSnapshot),
    slots,
  };
}

function renderEditorContributionSlots(session, camera) {
  document.querySelectorAll('[data-editor-slot]').forEach((element) => {
    const slot = element.getAttribute('data-editor-slot') || '';
    if (slot === 'bottomPanel.tab') {
      return;
    }
    element.innerHTML = contributionsForSlot(slot)
      .map((contribution) => renderEditorContribution(contribution, slot))
      .join('');
  });
  bindEditorContributionActions(session, camera);
}

function renderEditorContribution(contribution, slot) {
  const id = escapeHtml(contribution.id);
  const label = escapeHtml(contribution.label);
  const body = escapeHtml(contribution.body);
  const icon = contribution.icon ? renderLucideIcon(contribution.icon) : '';
  if (slot.startsWith('toolbar.')) {
    return \`
      <button class="editor-contribution editor-contribution-button icon-button" data-editor-contribution-id="\${id}" title="\${label}" aria-label="\${label}">
        \${icon}
        <span>\${label}</span>
      </button>
    \`;
  }
  if (slot === 'inspector.section') {
    return \`
      <details class="inspector-section editor-contribution-section" data-editor-contribution-id="\${id}" open>
        \${inspectorSectionSummary(contribution.label)}
        <div class="editor-contribution-body">\${body}</div>
      </details>
    \`;
  }
  return \`
    <div class="editor-contribution editor-contribution-card" data-editor-contribution-id="\${id}">
      <div class="editor-contribution-title">\${icon}<span>\${label}</span></div>
      \${body ? \`<div class="editor-contribution-body">\${body}</div>\` : ''}
    </div>
  \`;
}

function renderBottomPanelContributionTab(contribution) {
  return \`
    <button data-bottom-tab="contribution:\${escapeHtml(contribution.id)}" data-contribution-tab data-editor-contribution-id="\${escapeHtml(contribution.id)}">
      \${escapeHtml(contribution.label)}
    </button>
  \`;
}

function renderBottomPanelContributionContent(contribution) {
  return \`
    <div class="editor-contribution editor-contribution-bottom" data-editor-contribution-id="\${escapeHtml(contribution.id)}">
      <strong>\${escapeHtml(contribution.label)}</strong>
      <span>\${escapeHtml(contribution.body || 'No contribution content')}</span>
    </div>
  \`;
}

function bindEditorContributionActions(session, camera) {
  document.querySelectorAll('[data-editor-contribution-id]').forEach((element) => {
    if (element.dataset.contributionBound === 'true') {
      return;
    }
    element.dataset.contributionBound = 'true';
    element.addEventListener('click', (event) => {
      const id = element.getAttribute('data-editor-contribution-id');
      const contribution = editorContributions().find((entry) => entry.id === id);
      if (!contribution || typeof contribution.onClick !== 'function') {
        return;
      }
      contribution.onClick({
        camera: currentEditorCamera(camera),
        contribution: contributionPublicSnapshot(contribution),
        event,
        session,
      });
    });
  });
}

function rerenderEditorContributions() {
  const session = editorWorldState?.currentSession;
  const camera = editorWorldState?.currentCamera;
  if (!session || !camera) {
    return;
  }
  renderEditorContributionSlots(session, camera);
  const diagnosticsPanel = document.getElementById('editor-bottom-panel');
  if (diagnosticsPanel) {
    renderDiagnosticsPanel(diagnosticsPanel, session, camera);
  }
}

function currentEditorCamera(fallback) {
  return editorWorldState?.currentCamera || fallback;
}

function activeEditorSession() {
  return editorWorldState?.currentSession || null;
}

function refreshActiveEditor() {
  const session = activeEditorSession();
  const camera = editorWorldState?.currentCamera;
  if (session && camera) {
    renderUi(session, camera);
  }
}

function editorWorkspaceController() {
  return {
    addAsset(assetId) {
      const session = activeEditorSession();
      const camera = editorWorldState?.currentCamera;
      if (session && camera) {
        addAssetFromCatalog(session, camera, assetId);
      }
    },
    addEntity() {
      const session = activeEditorSession();
      const camera = editorWorldState?.currentCamera;
      if (session && camera) {
        addEmptyEntity(session, camera);
      }
    },
    moveNode(nodeId, parentId, parent) {
      const session = activeEditorSession();
      const camera = editorWorldState?.currentCamera;
      if (
        session &&
        camera &&
        isValidOutlinerDrop(session.document, nodeId, parentId, parent)
      ) {
        applyOutlinerReparent(session, camera, nodeId, parentId, parent);
      }
    },
    openNodeContextMenu(nodeId, point) {
      const session = activeEditorSession();
      const camera = editorWorldState?.currentCamera;
      if (session && camera) {
        showSceneGraphContextMenu(session, camera, nodeId, point);
      }
    },
    redo() {
      const session = activeEditorSession();
      if (session) {
        void session.dispatch('scene_redo', {}).then(() => {
          clearValidationResult();
          refreshActiveEditor();
        });
      }
    },
    reloadPage() {
      window.location.reload();
    },
    setTabAudioMuted(muted) {
      const setMuted = window[TAB_AUDIO_BINDING];
      if (typeof setMuted !== 'function') {
        return;
      }
      void setMuted(muted).catch((error) => {
        console.error('[IWSDK] Failed to change tab audio:', error);
      });
    },
    openRuntimeInBrowser() {
      void fetch('/__iwsdk/workspace/open-runtime', {
        method: 'POST',
      })
        .then((response) => {
          if (!response.ok) {
            console.error(
              '[IWSDK] Failed to open runtime in default browser:',
              response.status,
            );
          }
        })
        .catch((error) => {
          console.error(
            '[IWSDK] Failed to open runtime in default browser:',
            error,
          );
        });
    },
    selectNode(nodeId, modifiers) {
      const session = activeEditorSession();
      if (!session) {
        return;
      }
      const nodeIds = selectionForNodeClick(nodeId, modifiers);
      window.__IWSDK_EDITOR_RESOURCE_SELECTION = null;
      setEditorSelection(nodeIds);
      void session.dispatch('scene_select', { nodeIds }).then(refreshActiveEditor);
    },
    selectBuiltin(target) {
      const session = activeEditorSession();
      if (!session) {
        return;
      }
      window.__IWSDK_EDITOR_RESOURCE_SELECTION = null;
      setEditorBuiltinSelection(target);
      void session.dispatch('scene_select', { nodeIds: [] }).then(() => {
        setEditorBuiltinSelection(target);
        refreshActiveEditor();
      });
    },
    selectRoot() {
      const session = activeEditorSession();
      if (!session) {
        return;
      }
      window.__IWSDK_EDITOR_RESOURCE_SELECTION = null;
      setEditorSelection([]);
      void session
        .dispatch('scene_select', { nodeIds: [] })
        .then(refreshActiveEditor);
    },
    setTransformMode,
    setTransformSnap(mode, value) {
      setTransformSnapValue(mode, value);
      refreshActiveEditor();
    },
    setTransformSpace,
    setViewportDrawDistance(distance) {
      setEditorDrawDistance(distance);
    },
    setView(view) {
      void setWorkspaceView(view);
    },
    toggleNodeExpanded(nodeId) {
      if (collapsedOutlinerNodeIds.has(nodeId)) {
        collapsedOutlinerNodeIds.delete(nodeId);
      } else {
        collapsedOutlinerNodeIds.add(nodeId);
      }
      refreshActiveEditor();
    },
    toggleNodeVisibility(nodeId) {
      if (hiddenOutlinerNodeIds.has(nodeId)) {
        hiddenOutlinerNodeIds.delete(nodeId);
      } else {
        hiddenOutlinerNodeIds.add(nodeId);
      }
      const session = activeEditorSession();
      if (session) {
        applyEditorReviewLens(session.document);
      }
      refreshActiveEditor();
    },
    toggleTransformSnap() {
      setTransformSnapEnabled(!editorWorldState?.transformSnapEnabled);
      refreshActiveEditor();
    },
    undo() {
      const session = activeEditorSession();
      if (session) {
        void session.dispatch('scene_undo', {}).then(() => {
          clearValidationResult();
          refreshActiveEditor();
        });
      }
    },
  };
}

function createEditorFrame() {
  if (typeof mountEditorWorkspace !== 'function') {
    throw new Error('Preact editor workspace module is unavailable');
  }
  workspaceUi?.unmount?.();
  workspaceUi = mountEditorWorkspace(root, editorWorkspaceController(), {
    ...editorStartupState,
    ...workspaceTabAudioState(),
    view: window.__IWSDK_WORKSPACE_VIEW || 'runtime',
  });
}

function getViewportHost() {
  const host = document.getElementById('scene-viewport');
  if (!(host instanceof HTMLDivElement)) {
    throw new Error('Scene editor viewport host is missing');
  }
  return host;
}

function getCanvas() {
  const canvas = document.getElementById('scene-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Scene editor canvas is missing');
  }
  return canvas;
}

function sceneResources(documentValue) {
  return documentValue?.resources || {};
}

function sceneAssets(documentValue) {
  return (
    editorWorldState?.world?.assets?.catalog?.() ||
    editorWorldState?.world?.assets?.list?.() ||
    []
  );
}

function catalogSceneAssets(documentValue) {
  return sceneAssets(documentValue).map((asset) => ({
    ...asset,
    thumbnailUrl: assetThumbnailCache.get(asset.id) || null,
  }));
}

async function ensureAssetThumbnails(documentValue) {
  if (assetThumbnailGeneration) {
    return assetThumbnailGeneration;
  }
  const assets = sceneAssets(documentValue).filter(
    (asset) =>
      !assetThumbnailCache.has(asset.id) &&
      !assetThumbnailFailures.has(asset.id),
  );
  if (assets.length === 0 || !editorWorldState?.world?.assets) {
    return;
  }
  assetThumbnailGeneration = generateAssetThumbnails(assets, documentValue)
    .catch((error) => {
      console.warn('[IWSDK editor] Asset thumbnail generation failed', error);
    })
    .finally(() => {
      assetThumbnailGeneration = null;
    });
  return assetThumbnailGeneration;
}

async function generateAssetThumbnails(assets, documentValue) {
  const canvas = document.createElement('canvas');
  const width = 180;
  const height = 112;
  canvas.width = width;
  canvas.height = height;
  const renderer = new WebGLRenderer({
    alpha: false,
    antialias: true,
    canvas,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.localClippingEnabled = true;

  const thumbnailScene = new Scene();
  thumbnailScene.background = new Color('#202226');
  const camera = new PerspectiveCamera(34, width / height, 0.001, 1000);
  const ambient = new AmbientLight('#ffffff', 1.15);
  const key = new DirectionalLight('#fff4df', 2.4);
  const fill = new DirectionalLight('#b9d4ff', 0.9);
  thumbnailScene.add(ambient, key, fill);

  try {
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      let frame = null;
      try {
        if (asset.kind === 'uikitml') {
          // UIKitML thumbnails are the canonical editor render. The asset
          // drawer scales this large transparent image down, and placed scene
          // instances consume the exact same canvas instead of parsing and
          // rendering the document a second time.
          await getEditorPanelAssetPreview(asset.id);
        } else {
          const object = await editorWorldState.world.assets.instantiate(
            asset.id,
          );
          frame = new Group();
          frame.add(object);
          thumbnailScene.add(frame);
          object.updateMatrixWorld(true);
          const bounds = new Box3().setFromObject(object);
          if (bounds.isEmpty()) {
            throw new Error(
              'Renderable asset "' + asset.id + '" has empty bounds',
            );
          }
          const center = new Vector3();
          const size = new Vector3();
          bounds.getCenter(center);
          bounds.getSize(size);
          frame.position.copy(center).multiplyScalar(-1);
          frame.updateMatrixWorld(true);

          const radius = Math.max(size.length() * 0.5, 0.01);
          const distance =
            (radius / Math.tan(MathUtils.degToRad(camera.fov * 0.5))) * 1.22;
          const viewDirection = new Vector3(1.15, 0.82, 1.35).normalize();
          camera.position.copy(viewDirection).multiplyScalar(distance);
          camera.near = Math.max(0.001, distance - radius * 2.2);
          camera.far = distance + radius * 3.5;
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();
          key.position.set(distance, distance * 1.35, distance * 1.2);
          fill.position.set(-distance, distance * 0.45, -distance * 0.8);
          renderer.render(thumbnailScene, camera);
          assetThumbnailCache.set(asset.id, canvas.toDataURL('image/png'));
        }
      } catch (error) {
        assetThumbnailFailures.add(asset.id);
        console.warn(
          '[IWSDK editor] Could not render thumbnail for "' + asset.id + '"',
          error,
        );
      } finally {
        if (frame) {
          thumbnailScene.remove(frame);
        }
      }

      if ((index + 1) % 6 === 0 || index === assets.length - 1) {
        workspaceUi?.update({
          sceneAssets: catalogSceneAssets(documentValue),
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}

function sceneComponentScalar(value) {
  return value && typeof value === 'object' && 'value' in value
    ? value.value
    : value;
}

function panelPropsForNode(node) {
  const contentAssetId =
    node?.content?.type === 'asset' ? node.content.asset : null;
  if (
    contentAssetId &&
    sceneAssets(editorWorldState?.currentSession?.document).some(
      (asset) => asset.id === contentAssetId && asset.kind === 'uikitml',
    )
  ) {
    return { config: contentAssetId };
  }
  const components = node?.components || {};
  const component =
    components['com.iwsdk.components.PanelUI'] || components.PanelUI;
  if (!component || typeof component !== 'object') {
    return null;
  }
  const config = sceneComponentScalar(component.config);
  if (typeof config !== 'string' || config.trim().length === 0) {
    return null;
  }
  return { config };
}

function resolveEditorPanelConfig(config) {
  const assets = sceneAssets(editorWorldState?.currentSession?.document);
  const direct = assets.find(
    (asset) => asset.kind === 'uikitml' && asset.id === config,
  );
  if (direct) {
    return direct.id;
  }
  const appURL = new URL(config, window.location.origin + '/');
  const manifestAsset = assets.find((asset) => {
    if (asset.kind !== 'uikitml' || typeof asset.url !== 'string') {
      return false;
    }
    return new URL(asset.url, window.location.origin + '/').href === appURL.href;
  });
  return manifestAsset?.id || appURL.href;
}

async function createEditorPanelDocument(config) {
  // Authoring previews must reflect the current source file after HMR. Runtime
  // panels keep the normal asset cache, while the editor deliberately reloads.
  const rootElement = await loadUIKitMLComponent(config, { forceReload: true });
  const frameScheduler = createEditorPanelFrameScheduler(rootElement);
  const document = new UIKitDocument(rootElement);
  editorPanelFrameSchedulers.set(document, frameScheduler);
  document.updateMatrixWorld(true);
  return document;
}

function createEditorPanelFrameScheduler(rootElement) {
  const rootContext = rootElement.root?.peek?.() || rootElement.root?.value;
  if (!rootContext) {
    throw new Error('UIKitML preview root did not expose a render context');
  }

  const previousRequestFrame = rootContext.requestFrame;
  const previousRequestRender = rootContext.requestRender;
  let frameRequested = true;
  let wakeRequest = null;

  const markFrameRequested = () => {
    frameRequested = true;
    const wake = wakeRequest;
    wakeRequest = null;
    wake?.();
  };
  const requestFrame = () => {
    markFrameRequested();
    previousRequestFrame?.();
  };
  const requestRender = () => {
    // A render requested during update is satisfied by the render immediately
    // following that update. Requests outside update need another frame.
    if (!rootContext.isUpdateRunning) {
      markFrameRequested();
    }
    previousRequestRender?.();
  };
  rootContext.requestFrame = requestFrame;
  rootContext.requestRender = requestRender;

  const readinessSignals = [];
  rootElement.traverse((object) => {
    if (object.fontSignal?.subscribe) {
      readinessSignals.push(object.fontSignal);
    }
    if (
      object.texture?.subscribe &&
      object.properties?.value?.src != null
    ) {
      readinessSignals.push(object.texture);
    }
  });
  const unsubscribe = readinessSignals.map((signal) =>
    signal.subscribe(markFrameRequested),
  );

  return {
    consumeFrameRequest: () => {
      frameRequested = false;
    },
    dispose: () => {
      for (const stop of unsubscribe) {
        stop();
      }
      if (rootContext.requestFrame === requestFrame) {
        rootContext.requestFrame = previousRequestFrame;
      }
      if (rootContext.requestRender === requestRender) {
        rootContext.requestRender = previousRequestRender;
      }
      const wake = wakeRequest;
      wakeRequest = null;
      wake?.();
    },
    hasFrameRequest: () => frameRequested,
    resourcesReady: () =>
      readinessSignals.every((signal) => signal.value != null),
    waitForFrameRequest: (timeoutMs) => {
      if (frameRequested) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (wakeRequest === wake) {
            wakeRequest = null;
          }
          resolve(false);
        }, timeoutMs);
        const wake = () => {
          clearTimeout(timeout);
          resolve(true);
        };
        wakeRequest = wake;
      });
    },
  };
}

function refreshEditorPanelClassLists(document) {
  document.rootElement.traverse((object) => {
    if (!object.classList || object.parentContainer?.value == null) {
      return;
    }
    const classes = [...(object.classList.list || [])];
    if (classes.length > 0) {
      object.classList.set(...classes);
    }
  });
}

async function settleEditorPanelLayout(document, renderer, scene, camera) {
  const frameScheduler = editorPanelFrameSchedulers.get(document);
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    frameScheduler.consumeFrameRequest();
    document.rootElement.update?.(1 / 60);
    document.updateMatrixWorld(true);
    renderer.render(scene, camera);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const size = document.computedSize;
    if (
      size?.width > 0 &&
      size?.height > 0 &&
      frameScheduler.resourcesReady() &&
      !frameScheduler.hasFrameRequest()
    ) {
      return;
    }

    if (!frameScheduler.hasFrameRequest()) {
      const remaining = Math.max(0, deadline - performance.now());
      if (!(await frameScheduler.waitForFrameRequest(remaining))) {
        break;
      }
    }
  }
  throw new Error('UIKitML preview did not reach a render-ready state');
}

function disposeEditorPanelDocument(document) {
  editorPanelFrameSchedulers.get(document)?.dispose();
  editorPanelFrameSchedulers.delete(document);
  document.removeFromParent();
  document.dispose?.();
}

function positivePreviewDimension(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.min(4096, Math.round(value)))
    : fallback;
}

function getEditorPanelPreviewRenderer() {
  if (editorPanelPreviewRendererState) {
    const state = editorPanelPreviewRendererState;
    if (!state.contextLost && !state.renderer.getContext().isContextLost()) {
      return state;
    }
    disposeEditorPanelPreviewRenderer(state);
  }
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  configureUIKitRenderer(renderer);
  const state = {
    canvas,
    contextLossCount: 0,
    contextLost: false,
    createdCount: ++editorPanelPreviewRendererCreatedCount,
    renderCount: 0,
    renderer,
  };
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    state.contextLost = true;
    state.contextLossCount += 1;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    state.contextLost = false;
  });
  window.addEventListener(
    'pagehide',
    () => {
      disposeEditorPanelPreviewRenderer(state);
    },
    { once: true },
  );
  editorPanelPreviewRendererState = state;
  return state;
}

function disposeEditorPanelPreviewRenderer(state) {
  if (!state) {
    return;
  }
  if (editorPanelPreviewRendererState === state) {
    editorPanelPreviewRendererState = null;
  }
  state.renderer.dispose();
  state.renderer.forceContextLoss?.();
}

async function waitForEditorPanelPreviewContext(state) {
  if (!state.contextLost && !state.renderer.getContext().isContextLost()) {
    return;
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.canvas.removeEventListener('webglcontextrestored', restored);
      reject(new Error('UIKitML preview WebGL context did not recover'));
    }, 2000);
    const restored = () => {
      clearTimeout(timeout);
      resolve();
    };
    state.canvas.addEventListener('webglcontextrestored', restored, {
      once: true,
    });
  });
}

function editorPanelCanvasHasVisibleContent(context, width, height) {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      return true;
    }
  }
  return false;
}

async function renderEditorPanelCanvasExclusive(config) {
  let panelDocument = null;
  try {
    let width = 512;
    let height = 512;
    const previewRenderer = getEditorPanelPreviewRenderer();
    await waitForEditorPanelPreviewContext(previewRenderer);
    const { canvas: renderCanvas, renderer } = previewRenderer;
    previewRenderer.renderCount += 1;
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);

    const previewScene = new Scene();
    previewScene.background = null;
    panelDocument = await createEditorPanelDocument(config);
    previewScene.add(panelDocument);
    refreshEditorPanelClassLists(panelDocument);

    let camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1000, 1000);
    camera.position.set(0, 0, 100);
    camera.updateProjectionMatrix();
    await settleEditorPanelLayout(
      panelDocument,
      renderer,
      previewScene,
      camera,
    );

    const computedSize = panelDocument.computedSize;
    if (!computedSize || computedSize.width <= 0 || computedSize.height <= 0) {
      throw new Error('UIKitML asset "' + config + '" has no computed size');
    }

    const naturalWidth = computedSize.width / 100;
    const naturalHeight = computedSize.height / 100;
    const worldWidth = naturalWidth;
    const worldHeight = naturalHeight;
    const contentAspect = worldWidth / worldHeight;
    if (contentAspect >= 1) {
      width = 512;
      height = Math.max(32, Math.round(width / contentAspect));
    } else {
      height = 512;
      width = Math.max(32, Math.round(height * contentAspect));
    }
    renderer.setSize(width, height, false);

    const padding = 1.12;
    let viewWidth = worldWidth * padding;
    let viewHeight = worldHeight * padding;
    const canvasAspect = width / height;
    if (viewWidth / viewHeight < canvasAspect) {
      viewWidth = viewHeight * canvasAspect;
    } else {
      viewHeight = viewWidth / canvasAspect;
    }
    camera = new OrthographicCamera(
      -viewWidth / 2,
      viewWidth / 2,
      viewHeight / 2,
      -viewHeight / 2,
      -1000,
      1000,
    );
    camera.position.set(0, 0, 100);
    camera.updateProjectionMatrix();

    await settleEditorPanelLayout(
      panelDocument,
      renderer,
      previewScene,
      camera,
    );
    renderer.render(previewScene, camera);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create UIKitML preview canvas');
    }
    context.drawImage(renderCanvas, 0, 0);
    if (
      previewRenderer.contextLost ||
      renderer.getContext().isContextLost() ||
      !editorPanelCanvasHasVisibleContent(context, width, height)
    ) {
      throw new Error(
        'UIKitML preview capture was transparent after a WebGL context interruption',
      );
    }
    return {
      canvas,
      computedSize,
      dataURL: canvas.toDataURL('image/png'),
      height,
      viewHeight,
      viewWidth,
      width,
      worldHeight,
      worldWidth,
    };
  } finally {
    if (panelDocument) {
      disposeEditorPanelDocument(panelDocument);
    }
  }
}

function renderEditorPanelCanvas(config) {
  const render = () => renderEditorPanelCanvasExclusive(config);
  const result = editorPanelPreviewRenderQueue.then(render, render);
  editorPanelPreviewRenderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function invalidateEditorPanelAssetPreview(config) {
  const resolvedConfig = resolveEditorPanelConfig(config);
  assetPanelPreviewVersions.set(
    resolvedConfig,
    (assetPanelPreviewVersions.get(resolvedConfig) || 0) + 1,
  );
  assetPanelPreviewCache.delete(resolvedConfig);
  assetThumbnailCache.delete(resolvedConfig);
  assetThumbnailFailures.delete(resolvedConfig);
  assetPanelNaturalSizeCache.delete(resolvedConfig);
}

function invalidateEditorPanelAssetPreviews() {
  const configs = new Set(assetPanelPreviewCache.keys());
  for (const asset of sceneAssets(editorWorldState?.currentSession?.document)) {
    if (asset.kind === 'uikitml') {
      configs.add(asset.id);
    }
  }
  for (const config of configs) {
    invalidateEditorPanelAssetPreview(config);
  }
}

function getEditorPanelAssetPreview(config) {
  const resolvedConfig = resolveEditorPanelConfig(config);
  const cached = assetPanelPreviewCache.get(resolvedConfig);
  if (cached) {
    return cached;
  }

  const version = assetPanelPreviewVersions.get(resolvedConfig) || 0;
  const result = renderEditorPanelCanvas(resolvedConfig).then((preview) => {
    if (
      (assetPanelPreviewVersions.get(resolvedConfig) || 0) === version &&
      assetPanelPreviewCache.get(resolvedConfig) === result
    ) {
      assetThumbnailCache.set(resolvedConfig, preview.dataURL);
      assetPanelNaturalSizeCache.set(resolvedConfig, {
        height: preview.worldHeight,
        width: preview.worldWidth,
      });
    }
    return preview;
  });
  assetPanelPreviewCache.set(resolvedConfig, result);
  result.catch(() => {
    if (assetPanelPreviewCache.get(resolvedConfig) === result) {
      assetPanelPreviewCache.delete(resolvedConfig);
    }
  });
  return result;
}

function createEditorPanelTexturePreview(preview) {
  const texture = new CanvasTexture(preview.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  const material = new MeshBasicMaterial({
    depthWrite: false,
    map: texture,
    toneMapped: false,
    transparent: true,
  });
  const object = new Mesh(
    new PlaneGeometry(preview.viewWidth, preview.viewHeight),
    material,
  );
  object.name = 'IWSDK PanelUI Preview';
  object.userData.iwsdkEditorPanelComputedSize = preview.computedSize;
  object.userData.iwsdkEditorPanelPreview = true;
  object.userData.iwsdkEditorPanelPreviewKind = 'texture';
  return object;
}

function disposeEditorPanelTexturePreview(object) {
  object.removeFromParent();
  object.geometry?.dispose?.();
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  for (const material of materials) {
    material?.map?.dispose?.();
    material?.dispose?.();
  }
}

async function materializeEditorPanelPreviews(loweredNodes) {
  const visit = async (lowered) => {
    const props = panelPropsForNode(lowered.node);
    if (props) {
      try {
        const preview = await getEditorPanelAssetPreview(props.config);
        lowered.object.add(createEditorPanelTexturePreview(preview));
        delete lowered.object.userData.iwsdkEditorPanelPreviewError;
      } catch (error) {
        lowered.object.userData.iwsdkEditorPanelPreviewError = String(
          error?.message || error,
        );
        console.warn(
          '[IWSDK editor] Could not render PanelUI preview for "' +
            lowered.id +
            '"',
          error,
        );
      }
    }
    await Promise.all((lowered.children || []).map(visit));
  };
  await Promise.all((loweredNodes || []).map(visit));
}

function disposeEditorPanelPreviews(...loweredNodes) {
  for (const lowered of loweredNodes) {
    const previews = [];
    lowered.object.traverse((object) => {
      if (object.userData?.iwsdkEditorPanelPreview === true) {
        previews.push(object);
      }
    });
    previews.forEach(disposeEditorPanelTexturePreview);
  }
}

async function renderUIKitMLAssetPreview(assetId, options = {}) {
  const asset = sceneAssets(editorWorldState?.currentSession?.document).find(
    (entry) => entry.id === assetId,
  );
  if (!asset) {
    throw new Error('Unknown asset "' + assetId + '"');
  }
  if (asset.kind !== 'uikitml') {
    throw new Error('Asset "' + assetId + '" is not a UIKitML asset');
  }

  const background = options.background || '#202226';
  const width = positivePreviewDimension(options.width, 512);
  const height = positivePreviewDimension(options.height, 512);
  // Explicit preview commands are also the refresh boundary for same-URL
  // UIKitML sources. Refresh the canonical render, then composite that exact
  // image onto the requested inspection background.
  invalidateEditorPanelAssetPreview(asset.id);
  const preview = await getEditorPanelAssetPreview(asset.id);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create UIKitML inspection canvas');
  }
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  const scale = Math.min(width / preview.width, height / preview.height);
  const drawWidth = preview.width * scale;
  const drawHeight = preview.height * scale;
  context.drawImage(
    preview.canvas,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return {
    assetId,
    background,
    height,
    imageData: canvas.toDataURL('image/png').split(',')[1] || '',
    mimeType: 'image/png',
    width,
  };
}

const ASSET_PREVIEW_DEFAULT_VIEWS = Object.freeze([
  'front',
  'back',
  'right',
  'top',
  'quarter',
]);

const ASSET_PREVIEW_VIEW_DIRECTIONS = Object.freeze({
  back: [0, 0.08, -1],
  front: [0, 0.08, 1],
  left: [-1, 0.08, 0],
  quarter: [1, 0.65, 1],
  right: [1, 0.08, 0],
  top: [0, 1, 0],
});

const ASSET_PREVIEW_FOCUS_PATH_LIMIT = 8;
const ASSET_PREVIEW_FOCUS_PATH_LENGTH_LIMIT = 160;
const ASSET_PREVIEW_FOCUS_INPUT_LENGTH_LIMIT = 512;

function abbreviatedAssetPreviewFocusPath(path) {
  if (path.length <= ASSET_PREVIEW_FOCUS_PATH_LENGTH_LIMIT) {
    return path;
  }
  const prefixLength = Math.floor(
    (ASSET_PREVIEW_FOCUS_PATH_LENGTH_LIMIT - 1) / 2,
  );
  const suffixLength =
    ASSET_PREVIEW_FOCUS_PATH_LENGTH_LIMIT - prefixLength - 1;
  return path.slice(0, prefixLength) + '…' + path.slice(-suffixLength);
}

function abbreviatedAssetPreviewFocusPaths(paths) {
  const abbreviatedPaths = paths.map(abbreviatedAssetPreviewFocusPath);
  const counts = new Map();
  for (const path of abbreviatedPaths) {
    counts.set(path, (counts.get(path) || 0) + 1);
  }
  return abbreviatedPaths.map((path, index) =>
    counts.get(path) > 1 &&
    paths[index].length <= ASSET_PREVIEW_FOCUS_INPUT_LENGTH_LIMIT
      ? paths[index]
      : path,
  );
}

function boundedAssetPreviewDimension(value, fallback, minimum) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(2048, Math.round(value)))
    : fallback;
}

function serializeAssetPreviewBounds(bounds) {
  if (!bounds || bounds.isEmpty()) {
    return null;
  }
  return {
    max: bounds.max.toArray(),
    min: bounds.min.toArray(),
  };
}

function objectPreviewGeometryBounds(object) {
  const geometry = object.geometry;
  if (!geometry) {
    return null;
  }
  let localBounds;
  if (object.isInstancedMesh === true || object.isSkinnedMesh === true) {
    object.computeBoundingBox?.();
    localBounds = object.boundingBox;
  } else {
    const previewGeometry = geometry.clone();
    previewGeometry.computeBoundingBox?.();
    localBounds = previewGeometry.boundingBox;
  }
  return localBounds && !localBounds.isEmpty()
    ? localBounds.clone().applyMatrix4(object.matrixWorld)
    : null;
}

function materialExcludedFromAssetPreviewFraming(material) {
  return (
    material &&
    (material.blending === AdditiveBlending ||
      (material.transparent === true && Number(material.opacity) < 0.5))
  );
}

function objectExcludedFromAssetPreviewFraming(object) {
  if (object.userData?.iwsdkPreviewBounds === 'exclude') {
    return true;
  }
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  return (
    materials.length > 0 &&
    materials.every(materialExcludedFromAssetPreviewFraming)
  );
}

function measureAssetPreviewBounds(root, framingOnly = false) {
  root.updateWorldMatrix(true, true);
  const bounds = new Box3().makeEmpty();
  let excludedGeometryCount = 0;
  root.traverseVisible((object) => {
    if (framingOnly && objectExcludedFromAssetPreviewFraming(object)) {
      if (object.geometry) {
        excludedGeometryCount += 1;
      }
      return;
    }
    const geometryBounds = objectPreviewGeometryBounds(object);
    if (geometryBounds) {
      bounds.union(geometryBounds);
    }
  });
  return { bounds, excludedGeometryCount };
}

function assetPreviewHierarchyEntries(root) {
  const entries = [];
  const visit = (object, parentPath, siblingIndex) => {
    const name =
      typeof object.name === 'string' && object.name.trim().length > 0
        ? object.name.trim()
        : '';
    const baseSegment = name || object.type || 'Object3D';
    const segment = siblingIndex == null
      ? baseSegment
      : baseSegment + '[' + siblingIndex + ']';
    const path = parentPath ? parentPath + '/' + segment : segment;
    entries.push({ name, object, path, type: object.type || 'Object3D' });

    const totals = new Map();
    for (const child of object.children || []) {
      const childName =
        typeof child.name === 'string' && child.name.trim().length > 0
          ? child.name.trim()
          : child.type || 'Object3D';
      totals.set(childName, (totals.get(childName) || 0) + 1);
    }
    const seen = new Map();
    for (const child of object.children || []) {
      const childName =
        typeof child.name === 'string' && child.name.trim().length > 0
          ? child.name.trim()
          : child.type || 'Object3D';
      const index = (seen.get(childName) || 0) + 1;
      seen.set(childName, index);
      visit(child, path, totals.get(childName) > 1 ? index : null);
    }
  };
  visit(root, '', null);
  return entries;
}

function resolveAssetPreviewFocus(entries, focus) {
  if (!focus) {
    return null;
  }
  const boundedFocus = String(focus).slice(
    0,
    ASSET_PREVIEW_FOCUS_PATH_LENGTH_LIMIT,
  );
  const exactPaths = entries.filter((entry) => entry.path === focus);
  if (exactPaths.length === 1) {
    return exactPaths[0];
  }
  const exactNames = entries.filter((entry) => entry.name === focus);
  if (exactNames.length === 1) {
    return exactNames[0];
  }
  if (exactNames.length > 1) {
    const fullPaths = exactNames
      .slice(0, ASSET_PREVIEW_FOCUS_PATH_LIMIT)
      .map((entry) => String(entry.path));
    const paths = abbreviatedAssetPreviewFocusPaths(fullPaths);
    const remaining = exactNames.length - paths.length;
    throw new Error(
      'Asset preview focus "' +
        boundedFocus +
        '" is ambiguous. Use one of these hierarchy paths: ' +
        paths.join(', ') +
        (remaining > 0 ? ', … and ' + String(remaining) + ' more' : ''),
    );
  }
  throw new Error(
    'Asset preview focus "' +
      boundedFocus +
      '" was not found. Name model parts before requesting a focused preview.',
  );
}

function assetPreviewRenderedTriangleCount(object, geometry, position, index) {
  const elementCount = index?.count ?? position.count;
  const drawStart = Math.max(
    0,
    Math.min(elementCount, Math.floor(geometry.drawRange?.start || 0)),
  );
  const requestedCount = geometry.drawRange?.count;
  const drawEnd = Math.max(
    drawStart,
    Math.min(
      elementCount,
      Number.isFinite(requestedCount)
        ? drawStart + Math.max(0, Math.floor(requestedCount))
        : elementCount,
    ),
  );
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  let triangles = 0;

  if (Array.isArray(object.material)) {
    for (const group of geometry.groups || []) {
      const material = materials[group.materialIndex || 0];
      if (!material || material.visible === false) {
        continue;
      }
      const groupStart = Math.max(0, Math.floor(group.start || 0));
      const groupCount = Number.isFinite(group.count)
        ? Math.max(0, Math.floor(group.count))
        : elementCount - groupStart;
      const start = Math.max(drawStart, groupStart);
      const end = Math.min(drawEnd, groupStart + groupCount);
      triangles += Math.floor(Math.max(0, end - start) / 3);
    }
  } else if (materials[0] && materials[0].visible !== false) {
    triangles = Math.floor(Math.max(0, drawEnd - drawStart) / 3);
  }

  const instanceCount = object.isInstancedMesh === true ? object.count : 1;
  return triangles * Math.max(0, instanceCount || 0);
}

function assetPreviewHierarchyBounds(entries) {
  const boundsByObject = new Map();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const object = entries[index].object;
    const bounds = new Box3().makeEmpty();
    if (object.visible !== false) {
      const geometryBounds = objectPreviewGeometryBounds(object);
      if (geometryBounds) {
        bounds.union(geometryBounds);
      }
      for (const child of object.children || []) {
        const childBounds = boundsByObject.get(child);
        if (childBounds && !childBounds.isEmpty()) {
          bounds.union(childBounds);
        }
      }
    }
    boundsByObject.set(object, bounds);
  }
  return boundsByObject;
}

function inspectAssetPreviewGeometry(root, entries, rawBounds, framingBounds) {
  const geometries = new Set();
  const inspectedGeometries = new Set();
  const materials = new Set();
  const warnings = [];
  let meshCount = 0;
  let objectCount = 0;
  let renderedTriangles = 0;
  let unnamedMeshCount = 0;
  let doubleSidedMeshCount = 0;

  const pathByObject = new Map(entries.map((entry) => [entry.object, entry.path]));
  root.traverseVisible((object) => {
    objectCount += 1;
    const path = pathByObject.get(object) || object.name || object.type;
    if (
      !Array.from(object.matrixWorld.elements || []).every((value) =>
        Number.isFinite(value),
      )
    ) {
      warnings.push({
        code: 'non_finite_transform',
        message: 'Object has a non-finite world transform.',
        path,
      });
    }
    if (object.isMesh !== true) {
      return;
    }
    meshCount += 1;
    if (!object.name) {
      unnamedMeshCount += 1;
    }
    const geometry = object.geometry;
    if (!geometry) {
      warnings.push({
        code: 'missing_geometry',
        message: 'Mesh has no geometry.',
        path,
      });
      return;
    }
    geometries.add(geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of objectMaterials) {
      if (material) {
        materials.add(material);
        if (material.side !== FrontSide) {
          doubleSidedMeshCount += 1;
        }
      }
    }

    const position = geometry.getAttribute?.('position');
    if (!position) {
      warnings.push({
        code: 'missing_positions',
        message: 'Geometry has no position attribute.',
        path,
      });
      return;
    }
    const index = geometry.getIndex?.() || geometry.index;
    const baseTriangles = Math.floor((index?.count || position.count) / 3);
    renderedTriangles += assetPreviewRenderedTriangleCount(
      object,
      geometry,
      position,
      index,
    );

    if (inspectedGeometries.has(geometry)) {
      return;
    }
    inspectedGeometries.add(geometry);
    if (!geometry.getAttribute?.('normal')) {
      warnings.push({
        code: 'missing_normals',
        message: 'Geometry has no normal attribute.',
        path,
      });
    }
    let nonFinitePositions = 0;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      if (
        !Number.isFinite(position.getX(vertex)) ||
        !Number.isFinite(position.getY(vertex)) ||
        !Number.isFinite(position.getZ(vertex))
      ) {
        nonFinitePositions += 1;
      }
    }
    if (nonFinitePositions > 0) {
      warnings.push({
        code: 'non_finite_positions',
        message:
          String(nonFinitePositions) + ' vertices contain non-finite positions.',
        path,
      });
    }
    let invalidIndices = 0;
    if (index) {
      for (let cursor = 0; cursor < index.count; cursor += 1) {
        const value = index.getX(cursor);
        if (!Number.isInteger(value) || value < 0 || value >= position.count) {
          invalidIndices += 1;
        }
      }
    }
    if (invalidIndices > 0) {
      warnings.push({
        code: 'invalid_indices',
        message:
          String(invalidIndices) + ' geometry indices are outside the position attribute.',
        path,
      });
    }

    let degenerateTriangles = 0;
    for (let triangle = 0; triangle < baseTriangles; triangle += 1) {
      const offset = triangle * 3;
      const a = index ? index.getX(offset) : offset;
      const b = index ? index.getX(offset + 1) : offset + 1;
      const c = index ? index.getX(offset + 2) : offset + 2;
      if (
        a < 0 ||
        b < 0 ||
        c < 0 ||
        a >= position.count ||
        b >= position.count ||
        c >= position.count
      ) {
        continue;
      }
      const abx = position.getX(b) - position.getX(a);
      const aby = position.getY(b) - position.getY(a);
      const abz = position.getZ(b) - position.getZ(a);
      const acx = position.getX(c) - position.getX(a);
      const acy = position.getY(c) - position.getY(a);
      const acz = position.getZ(c) - position.getZ(a);
      const crossX = aby * acz - abz * acy;
      const crossY = abz * acx - abx * acz;
      const crossZ = abx * acy - aby * acx;
      if (crossX * crossX + crossY * crossY + crossZ * crossZ < 1e-16) {
        degenerateTriangles += 1;
      }
    }
    if (degenerateTriangles > 0) {
      warnings.push({
        code: 'degenerate_triangles',
        message:
          String(degenerateTriangles) + ' triangles have effectively zero area.',
        path,
      });
    }
  });

  if (!rawBounds || rawBounds.isEmpty()) {
    warnings.push({
      code: 'empty_bounds',
      message: 'The asset has no visible renderable bounds.',
    });
  }
  if (unnamedMeshCount > 0) {
    warnings.push({
      code: 'unnamed_meshes',
      message:
        String(unnamedMeshCount) +
        ' meshes are unnamed, which prevents stable focused inspection.',
    });
  }
  if (doubleSidedMeshCount > 0) {
    warnings.push({
      code: 'non_front_side_materials',
      message:
        String(doubleSidedMeshCount) +
        ' mesh material assignments render back faces; verify this is intentional.',
    });
  }
  if (
    rawBounds &&
    framingBounds &&
    !rawBounds.isEmpty() &&
    !framingBounds.isEmpty() &&
    !rawBounds.equals(framingBounds)
  ) {
    warnings.push({
      code: 'effects_excluded_from_framing',
      message:
        'Transparent, additive, or explicitly excluded geometry was omitted from preview framing.',
    });
  }

  const namedEntries = entries.filter((entry) => entry.name);
  const hierarchyBounds = assetPreviewHierarchyBounds(entries);
  const namedParts = namedEntries.map((entry) => ({
    bounds: serializeAssetPreviewBounds(hierarchyBounds.get(entry.object)),
    name: entry.name,
    path: entry.path,
    type: entry.type,
  }));

  return {
    bounds: serializeAssetPreviewBounds(rawBounds),
    framingBounds: serializeAssetPreviewBounds(framingBounds),
    geometryCount: geometries.size,
    materialCount: materials.size,
    meshCount,
    namedPartCount: namedEntries.length,
    namedParts,
    namedPartsTruncated: false,
    objectCount,
    renderedTriangles,
    warnings,
  };
}

function applyAssetPreviewClayMaterial(root) {
  const clay = new MeshStandardMaterial({
    color: 0xb8bdc4,
    metalness: 0,
    roughness: 0.82,
  });
  root.traverse((object) => {
    if (object.isMesh !== true) {
      return;
    }
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const additiveEffect =
      materials.length > 0 &&
      materials.every((material) => material?.blending === AdditiveBlending);
    if (object.userData?.iwsdkPreviewBounds === 'exclude' || additiveEffect) {
      object.visible = false;
      return;
    }
    object.material = clay;
  });
  return clay;
}

function assetPreviewCameraDirection(view) {
  const direction = ASSET_PREVIEW_VIEW_DIRECTIONS[view];
  if (!direction) {
    throw new Error('Unsupported asset preview view "' + String(view) + '"');
  }
  return new Vector3(direction[0], direction[1], direction[2]).normalize();
}

function configureAssetPreviewCamera(camera, view, bounds, aspect) {
  const center = bounds.getCenter(new Vector3());
  const direction = assetPreviewCameraDirection(view);
  camera.up.set(0, 1, 0);
  if (view === 'top') {
    camera.up.set(0, 0, -1);
  }

  const forward = direction.clone().negate();
  const right = forward.clone().cross(camera.up).normalize();
  const vertical = right.clone().cross(forward).normalize();
  const verticalFov = MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const tanVertical = Math.tan(Math.max(0.01, verticalFov / 2));
  const tanHorizontal = Math.tan(Math.max(0.01, horizontalFov / 2));
  const relativeCorner = new Vector3();
  let minimumDepth = Infinity;
  let maximumDepth = -Infinity;
  let requiredDistance = 0.1;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        relativeCorner.set(x, y, z).sub(center);
        const depth = relativeCorner.dot(direction);
        minimumDepth = Math.min(minimumDepth, depth);
        maximumDepth = Math.max(maximumDepth, depth);
        const lateralDistance = Math.max(
          Math.abs(relativeCorner.dot(right)) / tanHorizontal,
          Math.abs(relativeCorner.dot(vertical)) / tanVertical,
        );
        requiredDistance = Math.max(
          requiredDistance,
          depth + lateralDistance * 1.18,
        );
      }
    }
  }

  const distance = requiredDistance;
  camera.aspect = aspect;
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.001, (distance - maximumDepth) * 0.5);
  camera.far = Math.max(
    camera.near + 1,
    (distance - minimumDepth) * 1.5,
  );
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return { center, direction, distance };
}

async function renderSceneAssetPreview(assetId, options = {}) {
  const asset = sceneAssets(editorWorldState?.currentSession?.document).find(
    (entry) => entry.id === assetId,
  );
  if (!asset) {
    throw new Error('Unknown asset "' + assetId + '"');
  }
  if (asset.kind === 'uikitml') {
    throw new Error(
      'Asset "' + assetId + '" is UIKitML; use ui_render_preview instead.',
    );
  }

  const views = options.views || ASSET_PREVIEW_DEFAULT_VIEWS;
  const mode = options.mode || 'material';
  const background = options.background || '#202226';
  const width = boundedAssetPreviewDimension(options.width, 640, 320);
  const height = boundedAssetPreviewDimension(options.height, 480, 240);
  const columns = Math.min(3, views.length);
  const rows = Math.ceil(views.length / columns);
  const cellWidth = Math.max(1, Math.floor(width / columns));
  const cellHeight = Math.max(1, Math.floor(height / rows));
  const labelHeight = Math.min(28, Math.max(20, Math.floor(cellHeight * 0.1)));
  const renderHeight = Math.max(1, cellHeight - labelHeight);

  const renderCanvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({
    alpha: false,
    antialias: true,
    canvas: renderCanvas,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(cellWidth, renderHeight, false);
  renderer.setClearColor(new Color(background), 1);

  const composite = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const context = composite.getContext('2d');
  if (!context) {
    renderer.dispose();
    renderer.forceContextLoss?.();
    throw new Error('Could not create asset preview contact sheet');
  }
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const previewScene = new Scene();
  previewScene.background = new Color(background);
  const camera = new PerspectiveCamera(34, cellWidth / renderHeight, 0.001, 1000);
  const ambient = new AmbientLight('#ffffff', 1.15);
  const key = new DirectionalLight('#fff4df', 2.4);
  const fill = new DirectionalLight('#b9d4ff', 0.9);
  const lightTarget = new Group();
  key.target = lightTarget;
  fill.target = lightTarget;
  previewScene.add(ambient, key, fill, lightTarget);

  let object = null;
  let clayMaterial = null;
  try {
    object = await editorWorldState.world.assets.instantiate(assetId);
    if (!object || object.isObject3D !== true) {
      throw new Error('Asset "' + assetId + '" did not instantiate an Object3D');
    }
    previewScene.add(object);
    object.updateWorldMatrix(true, true);

    const entries = assetPreviewHierarchyEntries(object);
    const focusEntry = resolveAssetPreviewFocus(entries, options.focus);
    const rawBoundsResult = measureAssetPreviewBounds(object);
    const framingBoundsResult = measureAssetPreviewBounds(object, true);
    const focusBoundsResult = focusEntry
      ? measureAssetPreviewBounds(focusEntry.object)
      : null;
    const renderBounds = focusBoundsResult?.bounds?.isEmpty() === false
      ? focusBoundsResult.bounds
      : framingBoundsResult.bounds.isEmpty()
        ? rawBoundsResult.bounds
        : framingBoundsResult.bounds;
    if (renderBounds.isEmpty()) {
      throw new Error('Renderable asset "' + assetId + '" has empty bounds');
    }

    const diagnostics = inspectAssetPreviewGeometry(
      object,
      entries,
      rawBoundsResult.bounds,
      framingBoundsResult.bounds,
    );
    diagnostics.focusBounds = serializeAssetPreviewBounds(
      focusBoundsResult?.bounds,
    );
    if (mode === 'clay') {
      clayMaterial = applyAssetPreviewClayMaterial(object);
    }

    for (let index = 0; index < views.length; index += 1) {
      const view = views[index];
      const cameraState = configureAssetPreviewCamera(
        camera,
        view,
        renderBounds,
        cellWidth / renderHeight,
      );
      lightTarget.position.copy(cameraState.center);
      key.position
        .copy(cameraState.center)
        .addScaledVector(cameraState.direction, cameraState.distance)
        .add(new Vector3(0, cameraState.distance * 0.8, 0));
      fill.position
        .copy(cameraState.center)
        .addScaledVector(cameraState.direction, -cameraState.distance * 0.55)
        .add(new Vector3(-cameraState.distance * 0.45, cameraState.distance * 0.2, 0));
      renderer.render(previewScene, camera);

      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * cellWidth;
      const y = row * cellHeight;
      context.drawImage(renderCanvas, x, y, cellWidth, renderHeight);
      context.fillStyle = 'rgba(0, 0, 0, 0.78)';
      context.fillRect(x, y + renderHeight, cellWidth, labelHeight);
      context.fillStyle = '#ffffff';
      context.font = Math.max(12, Math.floor(labelHeight * 0.55)) + 'px sans-serif';
      context.textBaseline = 'middle';
      context.fillText(
        String(view) + (focusEntry ? ' · ' + focusEntry.path : ''),
        x + 10,
        y + renderHeight + labelHeight / 2,
        cellWidth - 20,
      );
    }

    return {
      assetId,
      background,
      diagnostics,
      ...(focusEntry ? { focus: focusEntry.path } : {}),
      height,
      imageData: composite.toDataURL('image/png').split(',')[1] || '',
      mimeType: 'image/png',
      mode,
      views: [...views],
      width,
    };
  } finally {
    object?.removeFromParent?.();
    clayMaterial?.dispose?.();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}

function scenePrefabs(documentValue) {
  return sceneResources(documentValue).prefabs || [];
}

function referencedSceneAssetIds(documentValue) {
  const ids = new Set();
  const visit = (node) => {
    if (node?.content?.type === 'asset') {
      ids.add(node.content.asset);
    }
    for (const child of node?.children || []) {
      visit(child);
    }
  };
  for (const node of documentValue?.nodes || []) {
    visit(node);
  }
  for (const prefab of scenePrefabs(documentValue)) {
    visit(prefab.root);
  }
  return [...ids];
}

function editorSceneAssetKind(assetId) {
  return sceneAssets(editorWorldState?.currentSession?.document).find(
    (asset) => asset.id === assetId,
  )?.kind;
}

function instantiateEditorSceneAsset(assetId) {
  return editorSceneAssetKind(assetId) === 'uikitml'
    ? Promise.resolve(new Group())
    : editorWorldState.world.assets.instantiate(assetId);
}

function nodeContentKind(node) {
  if (node?.content?.type) {
    return node.content.type;
  }
  if (node?.asset) {
    return 'asset';
  }
  return 'group';
}

function nodeAssetId(node) {
  return node?.content?.type === 'asset'
    ? node.content.asset
    : node?.asset || null;
}

function legacyPanelAssetId(node, assets) {
  const props = panelPropsForNode(node);
  if (!props) {
    return null;
  }
  const direct = assets.find(
    (asset) => asset.kind === 'uikitml' && asset.id === props.config,
  );
  if (direct) {
    return direct.id;
  }
  let configURL;
  try {
    configURL = new URL(props.config, window.location.origin + '/').href;
  } catch {
    return null;
  }
  return (
    assets.find(
      (asset) =>
        asset.kind === 'uikitml' &&
        typeof asset.url === 'string' &&
        new URL(asset.url, window.location.origin + '/').href === configURL,
    )?.id || null
  );
}

function getAssetBounds(documentValue, assetId) {
  const asset = sceneAssets(documentValue).find((entry) => entry.id === assetId);
  const bounds = asset?.bounds;
  const min =
    Array.isArray(bounds?.min) && bounds.min.length === 3
      ? bounds.min
      : [-0.25, 0, -0.25];
  const max =
    Array.isArray(bounds?.max) && bounds.max.length === 3
      ? bounds.max
      : [0.25, 0.5, 0.25];
  return { asset, max, min };
}

function disposeObjectTree(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    const material = child.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose?.());
    } else {
      material?.dispose?.();
    }
  });
}

function applyNodeTransform(object, transform = {}) {
  const position = Array.isArray(transform.position)
    ? transform.position
    : [0, 0, 0];
  const rotationDeg = Array.isArray(transform.rotationDeg)
    ? transform.rotationDeg
    : [0, 0, 0];
  const scale =
    typeof transform.scale === 'number'
      ? [transform.scale, transform.scale, transform.scale]
      : Array.isArray(transform.scale)
        ? transform.scale
        : [1, 1, 1];
  object.position.set(position[0], position[1], position[2]);
  object.rotation.set(
    MathUtils.degToRad(rotationDeg[0]),
    MathUtils.degToRad(rotationDeg[1]),
    MathUtils.degToRad(rotationDeg[2]),
  );
  object.scale.set(scale[0], scale[1], scale[2]);
  object.updateMatrixWorld(true);
}

function cloneTransform(transform = {}) {
  return {
    ...transform,
    position: Array.isArray(transform.position)
      ? [...transform.position]
      : [0, 0, 0],
    rotationDeg: Array.isArray(transform.rotationDeg)
      ? [...transform.rotationDeg]
      : [0, 0, 0],
    scale:
      typeof transform.scale === 'number'
        ? [transform.scale, transform.scale, transform.scale]
        : Array.isArray(transform.scale)
          ? [...transform.scale]
          : [1, 1, 1],
  };
}

function transformFromObject(object, existingTransform = {}) {
  const scale = [object.scale.x, object.scale.y, object.scale.z].map((value) =>
    Number(value.toFixed(4)),
  );
  const isUniformScale = scale.every((value) => value === scale[0]);
  return {
    ...existingTransform,
    position: roundVec3([object.position.x, object.position.y, object.position.z]),
    rotationDeg: roundVec3([
      MathUtils.radToDeg(object.rotation.x),
      MathUtils.radToDeg(object.rotation.y),
      MathUtils.radToDeg(object.rotation.z),
    ]),
    scale: isUniformScale ? scale[0] : scale,
  };
}

function snapNumber(value, increment) {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) {
    return value;
  }
  return Number((Math.round(value / increment) * increment).toFixed(6));
}

function snapVector(values, increment) {
  return values.map((value) => snapNumber(value, increment));
}

function snapScaleVector(values, increment) {
  return values.map((value) => {
    const snapped = snapNumber(value, increment);
    return snapped === 0 ? (Math.sign(value) || 1) * increment : snapped;
  });
}

function scaleVectorFromTransform(transform = {}) {
  return typeof transform.scale === 'number'
    ? [transform.scale, transform.scale, transform.scale]
    : Array.isArray(transform.scale)
      ? transform.scale
      : [1, 1, 1];
}

function compactScaleValue(scale) {
  return scale.every((value) => value === scale[0]) ? scale[0] : scale;
}

function snapTransformForCurrentMode(transform) {
  if (!editorWorldState?.transformSnapEnabled || !editorWorldState.transformSnap) {
    return transform;
  }
  const mode = editorWorldState.transformMode || 'translate';
  const snap = editorWorldState.transformSnap;
  if (mode === 'translate') {
    return {
      ...transform,
      position: snapVector(
        Array.isArray(transform.position) ? transform.position : [0, 0, 0],
        snap.translation,
      ),
    };
  }
  if (mode === 'rotate') {
    return {
      ...transform,
      rotationDeg: snapVector(
        Array.isArray(transform.rotationDeg) ? transform.rotationDeg : [0, 0, 0],
        snap.rotationDeg,
      ),
    };
  }
  if (mode === 'scale') {
    return {
      ...transform,
      scale: compactScaleValue(
        snapScaleVector(scaleVectorFromTransform(transform), snap.scale),
      ),
    };
  }
  return transform;
}

function transformsEqual(first = {}, second = {}) {
  return JSON.stringify(cloneTransform(first)) === JSON.stringify(cloneTransform(second));
}

function objectTransformProof(object) {
  if (!object) {
    return null;
  }
  return {
    position: roundVec3([object.position.x, object.position.y, object.position.z]),
    rotationDeg: roundVec3([
      MathUtils.radToDeg(object.rotation.x),
      MathUtils.radToDeg(object.rotation.y),
      MathUtils.radToDeg(object.rotation.z),
    ]),
    scale: roundVec3([object.scale.x, object.scale.y, object.scale.z]),
  };
}

function runtimeSummaryForNode(node) {
  const componentLabels = Object.entries(node?.components || {}).map(
    ([name, value]) => componentPayloadType(name, value),
  );
  const contentKind = nodeContentKind(node);
  const assetId = nodeAssetId(node);
  const summary = {
    assetStatus: assetId ? 'registered' : 'none',
    assetUrl: null,
    bounds: null,
    componentCount: componentLabels.length,
    components: componentLabels,
    fallback: null,
    helperType: null,
    materialCount: 0,
    meshCount: 0,
    nodeId: node?.id || null,
    objectCount: 0,
    ready: false,
  };
  if (!editorWorldState || !node) {
    return summary;
  }
  const assetProof = assetId
    ? editorWorldState.assetProof.get(assetId)
    : null;
  if (assetProof) {
    summary.assetStatus = assetProof.status || summary.assetStatus;
    summary.assetUrl = assetProof.url || null;
  }
  const object = editorWorldState.objectMap.get(node.id);
  if (!object) {
    return summary;
  }
  summary.ready = true;
  object.updateMatrixWorld(true);
  object.traverse((entry) => {
    summary.objectCount += 1;
    if (entry.userData?.iwsdkEditorFallback && summary.fallback == null) {
      summary.fallback = entry.userData.iwsdkEditorFallback;
    }
    if (entry.userData?.iwsdkEditorHelperType && summary.helperType == null) {
      summary.helperType = entry.userData.iwsdkEditorHelperType;
    }
    if (entry.isMesh === true) {
      summary.meshCount += 1;
      summary.materialCount += Array.isArray(entry.material)
        ? entry.material.length
        : entry.material
          ? 1
          : 0;
    }
  });
  const bounds = boundsForObjectWithoutEditorHelpers(object);
  if (bounds) {
    const center = new Vector3();
    const size = new Vector3();
    bounds.getCenter(center);
    bounds.getSize(size);
    summary.bounds = {
      center: roundVec3(center.toArray()),
      max: roundVec3(bounds.max.toArray()),
      min: roundVec3(bounds.min.toArray()),
      size: roundVec3(size.toArray()),
    };
  }
  return summary;
}

function selectedRuntimeSummaryProof() {
  const nodeId = selectedNodeId();
  const documentValue = editorWorldState?.currentSession?.document;
  return runtimeSummaryForNode(
    nodeId && documentValue ? findNodeById(documentValue, nodeId) : null,
  );
}

function selectionBoundsProof() {
  if (!editorWorldState) {
    return null;
  }
  const selectedIds = window.__IWSDK_EDITOR_SELECTION || [];
  if (selectedIds.length > 1) {
    const bounds = boundsForSelectedObjects();
    if (!bounds) {
      return { nodeIds: selectedIds, aggregateBounds: null };
    }
    const center = new Vector3();
    bounds.getCenter(center);
    return {
      aggregateBounds: {
        center: roundVec3(center.toArray()),
        max: roundVec3(bounds.max.toArray()),
        min: roundVec3(bounds.min.toArray()),
      },
      nodeIds: selectedIds,
    };
  }
  const nodeId = selectedIds.length === 1 ? selectedIds[0] : null;
  const object = nodeId ? editorWorldState.objectMap.get(nodeId) : null;
  if (!nodeId || !object) {
    return null;
  }
  let helper = null;
  editorWorldState.proxyRoot.traverse((entry) => {
    if (
      helper == null &&
      entry.userData?.iwsdkEditorSelectionHelper === true &&
      entry.userData?.iwsdkSceneNodeId === nodeId
    ) {
      helper = entry;
    }
  });
  if (!helper) {
    return { nodeId, helper: null };
  }
  const objectBounds = boundsForObjectWithoutEditorHelpers(object);
  if (!objectBounds) {
    return { nodeId, helper: null };
  }
  const helperBounds = new Box3().setFromObject(helper);
  const objectCenter = new Vector3();
  const helperCenter = new Vector3();
  objectBounds.getCenter(objectCenter);
  helperBounds.getCenter(helperCenter);
  return {
    centerDistance: Number(objectCenter.distanceTo(helperCenter).toFixed(4)),
    helperCenter: roundVec3(helperCenter.toArray()),
    maxDistance: Number(objectBounds.max.distanceTo(helperBounds.max).toFixed(4)),
    minDistance: Number(objectBounds.min.distanceTo(helperBounds.min).toFixed(4)),
    nodeId,
    objectCenter: roundVec3(objectCenter.toArray()),
  };
}

function hoverBoundsProof() {
  if (!editorWorldState?.hoveredNodeId || !editorWorldState.hoverHelper) {
    return null;
  }
  const object = editorWorldState.objectMap.get(editorWorldState.hoveredNodeId);
  if (!object) {
    return null;
  }
  const objectCenter = new Vector3();
  const helperCenter = new Vector3();
  const objectBounds = boundsForObjectWithoutEditorHelpers(object);
  if (!objectBounds) {
    return null;
  }
  objectBounds.getCenter(objectCenter);
  new Box3().setFromObject(editorWorldState.hoverHelper).getCenter(helperCenter);
  return {
    centerDistance: Number(objectCenter.distanceTo(helperCenter).toFixed(4)),
    helperCenter: roundVec3(helperCenter.toArray()),
    nodeId: editorWorldState.hoveredNodeId,
    objectCenter: roundVec3(objectCenter.toArray()),
  };
}

function objectHierarchyProof() {
  if (!editorWorldState) {
    return [];
  }
  return [...editorWorldState.objectMap.entries()].map(([nodeId, object]) => {
    let parent = object.parent;
    let parentNodeId = null;
    let builtinParent = null;
    while (parent && parent !== editorWorldState.proxyRoot) {
      const candidate = parent.userData?.iwsdkSceneNodeId;
      if (typeof candidate === 'string' && candidate !== nodeId) {
        parentNodeId = candidate;
        break;
      }
      const candidateBuiltin = parent.userData?.iwsdkBuiltinTarget;
      if (typeof candidateBuiltin === 'string') {
        builtinParent = candidateBuiltin;
        break;
      }
      parent = parent.parent;
    }
    const worldPosition = new Vector3();
    object.updateMatrixWorld(true);
    object.getWorldPosition(worldPosition);
    const content = object.userData?.iwsdkSceneContent;
    return {
      assetId: content?.type === 'asset' ? content.asset : null,
      ...(builtinParent && builtinParent !== 'level-root'
        ? { builtinParent }
        : {}),
      contentType: object.userData?.iwsdkSceneContentType ?? null,
      fallback: object.userData?.iwsdkEditorFallback ?? null,
      helperType: object.userData?.iwsdkEditorHelperType ?? null,
      localPosition: roundVec3([
        object.position.x,
        object.position.y,
        object.position.z,
      ]),
      nodeId,
      parentNodeId,
      runtimeHash: object.userData?.iwsdkSceneRuntimeHash ?? null,
      sourceNodeId: object.userData?.iwsdkSceneSourceNodeId ?? null,
      worldPosition: roundVec3(worldPosition.toArray()),
    };
  });
}

function disposeEditorHelper(helper) {
  helper?.geometry?.dispose?.();
  helper?.material?.dispose?.();
}

function updateHoverHelper(session, nodeId) {
  if (!editorWorldState) {
    return;
  }
  const selected = new Set(window.__IWSDK_EDITOR_SELECTION || []);
  const nextNodeId = nodeId && !selected.has(nodeId) ? nodeId : null;
  if (editorWorldState.hoveredNodeId === nextNodeId) {
    return;
  }
  if (editorWorldState.hoverHelper) {
    editorWorldState.hoverHelper.parent?.remove(editorWorldState.hoverHelper);
    disposeEditorHelper(editorWorldState.hoverHelper);
    editorWorldState.hoverHelper = null;
  }
  editorWorldState.hoveredNodeId = nextNodeId;
  if (!nextNodeId || !findNodeById(session.document, nextNodeId)) {
    return;
  }
  const object = editorWorldState.objectMap.get(nextNodeId);
  if (!object) {
    return;
  }
  const helper = createEditorBoundsHelper(object, 0x2d7ff9);
  if (!helper) {
    return;
  }
  helper.name = \`\${nextNodeId}-hover-outline\`;
  helper.userData.iwsdkEditorHelper = true;
  helper.userData.iwsdkEditorHoverHelper = true;
  helper.userData.iwsdkSceneNodeId = nextNodeId;
  editorWorldState.proxyRoot.add(helper);
  editorWorldState.hoverHelper = helper;
}

function componentHelperType(node) {
  const componentTypes = Object.entries(node?.components || {}).map(
    ([name, value]) => componentPayloadType(name, value),
  );
  if (componentTypes.includes('AudioSource')) {
    return 'audio-source';
  }
  if (componentTypes.includes('CameraSource')) {
    return 'camera-source';
  }
  if (componentTypes.includes('DirectionalLight')) {
    return 'directional-light';
  }
  if (componentTypes.includes('PointLight')) {
    return 'point-light';
  }
  if (componentTypes.includes('SpotLight')) {
    return 'spot-light';
  }
  if (componentTypes.includes('RectAreaLight')) {
    return 'rect-area-light';
  }
  if (
    componentTypes.includes('AmbientLight') ||
    componentTypes.includes('HemisphereLight') ||
    componentTypes.includes('DomeGradient') ||
    componentTypes.includes('DomeTexture') ||
    componentTypes.includes('IBLGradient') ||
    componentTypes.includes('IBLTexture')
  ) {
    return 'environment-light';
  }
  return null;
}

function markOwnedEditorHelper(mesh, nodeId, helperType) {
  mesh.userData.iwsdkEditorHelper = true;
  mesh.userData.iwsdkEditorHelperType = helperType;
  mesh.userData.iwsdkOwnsPrimitiveResources = true;
  mesh.userData.iwsdkSceneNodeId = nodeId;
  return mesh;
}

function markLightEditorHelper(mesh, nodeId, helperType, role) {
  markOwnedEditorHelper(mesh, nodeId, helperType);
  mesh.userData.iwsdkEditorLightRole = role;
  mesh.userData.iwsdkEditorPickable = role === 'handle';
  return mesh;
}

function createLightPickHandle(nodeId, helperType, color) {
  return markLightEditorHelper(
    new Mesh(
      new SphereGeometry(0.09, 16, 10),
      new MeshBasicMaterial({
        color,
        colorWrite: false,
        depthWrite: false,
      }),
    ),
    nodeId,
    helperType,
    'handle',
  );
}

function createLightCenterDot(nodeId, helperType, color) {
  return markLightEditorHelper(
    new Mesh(
      new SphereGeometry(0.025, 12, 8),
      new MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
    ),
    nodeId,
    helperType,
    'visual',
  );
}

function appendLightOutlineSegment(points, start, end) {
  points.push(new Vector3(...start), new Vector3(...end));
}

function appendLightOutlineCircle(
  points,
  radius,
  plane = 'xy',
  center = [0, 0, 0],
  segments = 24,
) {
  const pointAt = (angle) => {
    const cosine = Math.cos(angle) * radius;
    const sine = Math.sin(angle) * radius;
    if (plane === 'yz') {
      return [center[0], center[1] + cosine, center[2] + sine];
    }
    if (plane === 'xz') {
      return [center[0] + cosine, center[1], center[2] + sine];
    }
    return [center[0] + cosine, center[1] + sine, center[2]];
  };
  for (let index = 0; index < segments; index += 1) {
    appendLightOutlineSegment(
      points,
      pointAt((index / segments) * Math.PI * 2),
      pointAt(((index + 1) / segments) * Math.PI * 2),
    );
  }
}

function appendDashedLightOutlineCircle(points, radius, segments) {
  const ring = Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0];
  });
  for (let index = 0; index < segments; index += 2) {
    appendLightOutlineSegment(points, ring[index], ring[index + 1]);
  }
}

function appendLightOutlineDiamond(points, radius) {
  const diamond = [
    [radius, 0, 0],
    [0, radius, 0],
    [-radius, 0, 0],
    [0, -radius, 0],
  ];
  for (let index = 0; index < diamond.length; index += 1) {
    appendLightOutlineSegment(
      points,
      diamond[index],
      diamond[(index + 1) % diamond.length],
    );
  }
}

function createLightOutline(
  nodeId,
  helperType,
  color,
  points,
  alignment = 'object',
) {
  let material;
  if (alignment === 'object') {
    material = new LineBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      opacity: 0.9,
      transparent: true,
    });
  } else {
    const screenSpace = alignment === 'screen-space';
    material = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      fragmentShader: \`uniform vec3 outlineColor;
void main() { gl_FragColor = vec4(outlineColor, 0.9); }\`,
      transparent: true,
      uniforms: {
        outlineColor: { value: color },
        viewportSize: { value: new Vector2(1, 1) },
      },
      vertexShader: screenSpace
        ? \`uniform vec2 viewportSize;
void main() {
  vec4 center = projectionMatrix * viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  center.xy += position.xy * 200.0 / viewportSize * center.w;
  gl_Position = center;
}\`
        : \`void main() {
  vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 worldPosition = center + right * position.x + up * position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}\`,
    });
  }
  const outline = new LineSegments(
    new BufferGeometry().setFromPoints(points),
    material,
  );
  if (alignment === 'screen-space') {
    const viewportSize = material.uniforms.viewportSize.value;
    outline.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(viewportSize);
    };
  }
  return markLightEditorHelper(
    outline,
    nodeId,
    helperType,
    'visual',
  );
}

function createBlenderLightIcon(nodeId, helperType, color, sunRays = false) {
  const points = [];
  appendLightOutlineDiamond(points, 0.027);
  appendDashedLightOutlineCircle(points, 0.09, 16);
  appendDashedLightOutlineCircle(points, 0.1197, 20);
  if (sunRays) {
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const direction = [Math.cos(angle), Math.sin(angle)];
      for (const [startScale, endScale] of [
        [0.144, 0.171],
        [0.198, 0.225],
      ]) {
        appendLightOutlineSegment(
          points,
          [direction[0] * startScale, direction[1] * startScale, 0],
          [direction[0] * endScale, direction[1] * endScale, 0],
        );
      }
    }
  }
  return createLightOutline(
    nodeId,
    helperType,
    color,
    points,
    'screen-space',
  );
}

function createSpotSilhouette(
  nodeId,
  helperType,
  color,
  radius,
  length,
  segments = 32,
) {
  const positions = [];
  const adjacentNormalsA = [];
  const adjacentNormalsB = [];
  const edgeCenters = [];
  const angularStep = (Math.PI * 2) / segments;
  const appendVectorTwice = (target, value) => {
    target.push(...value, ...value);
  };
  const faceNormal = (angle) =>
    new Vector3(
      length * Math.cos(angle),
      length * Math.sin(angle),
      radius,
    )
      .normalize()
      .toArray();
  for (let index = 0; index < segments; index += 1) {
    const angle = index * angularStep;
    const base = [
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      -length,
    ];
    positions.push(0, 0, 0, ...base);
    appendVectorTwice(
      adjacentNormalsA,
      faceNormal(angle - angularStep / 2),
    );
    appendVectorTwice(
      adjacentNormalsB,
      faceNormal(angle + angularStep / 2),
    );
    appendVectorTwice(edgeCenters, [base[0] / 2, base[1] / 2, -length / 2]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    'adjacentNormalA',
    new Float32BufferAttribute(adjacentNormalsA, 3),
  );
  geometry.setAttribute(
    'adjacentNormalB',
    new Float32BufferAttribute(adjacentNormalsB, 3),
  );
  geometry.setAttribute(
    'edgeCenter',
    new Float32BufferAttribute(edgeCenters, 3),
  );
  return markLightEditorHelper(
    new LineSegments(
      geometry,
      new ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        fragmentShader: \`uniform vec3 outlineColor;
void main() {
  gl_FragColor = vec4(outlineColor, 0.9);
}\`,
        transparent: true,
        uniforms: { outlineColor: { value: color } },
        vertexShader: \`attribute vec3 adjacentNormalA;
attribute vec3 adjacentNormalB;
attribute vec3 edgeCenter;
void main() {
  vec3 centerInView = (modelViewMatrix * vec4(edgeCenter, 1.0)).xyz;
  bool perspective = projectionMatrix[2][3] == -1.0;
  vec3 viewDirection = perspective ? normalize(-centerInView) : vec3(0.0, 0.0, 1.0);
  float facingA = dot(normalize(normalMatrix * adjacentNormalA), viewDirection);
  float facingB = dot(normalize(normalMatrix * adjacentNormalB), viewDirection);
  vec3 visiblePosition = facingA * facingB <= 0.0 ? position : vec3(0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(visiblePosition, 1.0);
}\`,
      }),
    ),
    nodeId,
    helperType,
    'visual',
  );
}

function createComponentHelperDecoration(node, helperType) {
  const group = new Group();
  group.name = node.id + '-' + helperType + '-helper';
  group.userData.iwsdkEditorHelper = true;
  group.userData.iwsdkEditorHelperType = helperType;
  group.userData.iwsdkSceneNodeId = node.id;
  if (isLightEditorHelperType(helperType)) {
    group.matrixAutoUpdate = false;
    group.matrixWorldAutoUpdate = false;
    group.userData.iwsdkEditorScaleInvariant = true;
    group.userData.iwsdkEditorWorldPosition = new Vector3();
    group.userData.iwsdkEditorWorldQuaternion = new Quaternion();
    group.userData.iwsdkEditorWorldScale = new Vector3(1, 1, 1);
  }

  const lightSpec = Object.entries(node.components || {})
    .map(([componentName, value]) =>
      lightSpecFromComponentValue(componentName, value),
    )
    .find(Boolean);
  const lightColor = new Color(0xffa62b);

  if (helperType === 'audio-source') {
    const body = markOwnedEditorHelper(
      new Mesh(
        new BoxGeometry(0.16, 0.18, 0.1),
        new MeshBasicMaterial({ color: 0x5ce1e6, opacity: 0.9, transparent: true }),
      ),
      node.id,
      helperType,
    );
    const wave = markOwnedEditorHelper(
      new Mesh(
        new ConeGeometry(0.16, 0.22, 24, 1, true),
        new MeshBasicMaterial({
          color: 0xb8f7ff,
          opacity: 0.55,
          transparent: true,
          wireframe: true,
        }),
      ),
      node.id,
      helperType,
    );
    wave.rotation.z = -Math.PI / 2;
    wave.position.x = 0.18;
    group.add(body, wave);
  } else if (helperType === 'camera-source') {
    const cameraColor = new Color(0xffa62b);
    const handle = createLightPickHandle(node.id, helperType, cameraColor);
    const center = createLightCenterDot(node.id, helperType, cameraColor);
    const points = [];
    const planeZ = -0.44;
    const corners = [
      [-0.22, -0.14, planeZ],
      [0.22, -0.14, planeZ],
      [0.22, 0.14, planeZ],
      [-0.22, 0.14, planeZ],
    ];
    for (const corner of corners) {
      appendLightOutlineSegment(points, [0, 0, 0], corner);
    }
    for (let index = 0; index < corners.length; index += 1) {
      appendLightOutlineSegment(
        points,
        corners[index],
        corners[(index + 1) % corners.length],
      );
    }
    const frustum = createLightOutline(
      node.id,
      helperType,
      cameraColor,
      points,
    );
    const upMarker = markLightEditorHelper(
      new Mesh(
        new BufferGeometry().setFromPoints([
          new Vector3(-0.08, 0.16, planeZ),
          new Vector3(0.08, 0.16, planeZ),
          new Vector3(0, 0.29, planeZ),
          new Vector3(0, 0.29, planeZ),
          new Vector3(0.08, 0.16, planeZ),
          new Vector3(-0.08, 0.16, planeZ),
        ]),
        new MeshBasicMaterial({
          color: cameraColor,
          depthTest: false,
          depthWrite: false,
        }),
      ),
      node.id,
      helperType,
      'visual',
    );
    group.add(handle, center, frustum, upMarker);
  } else if (helperType === 'point-light') {
    const handle = createLightPickHandle(node.id, helperType, lightColor);
    const center = createLightCenterDot(node.id, helperType, lightColor);
    const icon = createBlenderLightIcon(node.id, helperType, lightColor);
    const points = [];
    appendLightOutlineCircle(points, 0.13, 'xy', [0, 0, 0], 32);
    const symbol = createLightOutline(
      node.id,
      helperType,
      lightColor,
      points,
      'screen-aligned',
    );
    group.add(handle, center, icon, symbol);
  } else if (helperType === 'spot-light') {
    const handle = createLightPickHandle(node.id, helperType, lightColor);
    const center = createLightCenterDot(node.id, helperType, lightColor);
    const icon = createBlenderLightIcon(node.id, helperType, lightColor);
    const emitterPoints = [];
    appendLightOutlineCircle(emitterPoints, 0.07, 'xy', [0, 0, 0], 32);
    const emitter = createLightOutline(
      node.id,
      helperType,
      lightColor,
      emitterPoints,
      'screen-aligned',
    );
    const length = 0.5;
    const angleDeg = lightSpec?.kind === 'spot' ? lightSpec.angleDeg : 60;
    const radius = MathUtils.clamp(
      Math.tan(MathUtils.degToRad(MathUtils.clamp(angleDeg, 5, 70))) * length,
      0.08,
      0.26,
    );
    const points = [];
    appendLightOutlineCircle(points, radius, 'xy', [0, 0, -length], 24);
    appendLightOutlineCircle(
      points,
      radius * 0.86,
      'xy',
      [0, 0, -length],
      24,
    );
    appendLightOutlineSegment(points, [0, 0, 0], [0, 0, -length]);
    const coneOutline = createLightOutline(
      node.id,
      helperType,
      lightColor,
      points,
    );
    const coneSilhouette = createSpotSilhouette(
      node.id,
      helperType,
      lightColor,
      radius,
      length,
    );
    group.add(handle, center, icon, emitter, coneOutline, coneSilhouette);
  } else if (helperType === 'directional-light') {
    const handle = createLightPickHandle(node.id, helperType, lightColor);
    const center = createLightCenterDot(node.id, helperType, lightColor);
    const icon = createBlenderLightIcon(node.id, helperType, lightColor, true);
    const points = [];
    appendLightOutlineSegment(points, [0, 0, 0], [0, 0, -0.46]);
    const direction = createLightOutline(
      node.id,
      helperType,
      lightColor,
      points,
    );
    const endpointPoints = [];
    appendLightOutlineDiamond(endpointPoints, 0.022);
    const endpoint = createLightOutline(
      node.id,
      helperType,
      lightColor,
      endpointPoints,
      'screen-space',
    );
    endpoint.position.z = -0.46;
    group.add(handle, center, icon, direction, endpoint);
  } else if (helperType === 'rect-area-light') {
    const authoredWidth = lightSpec?.kind === 'rect-area' ? lightSpec.width : 0.48;
    const authoredHeight = lightSpec?.kind === 'rect-area' ? lightSpec.height : 0.32;
    const fitScale = Math.min(
      1,
      0.42 / Math.max(Math.abs(authoredWidth), Math.abs(authoredHeight), 0.01),
    );
    const width = Math.max(0.12, Math.abs(authoredWidth) * fitScale);
    const height = Math.max(0.08, Math.abs(authoredHeight) * fitScale);
    const handle = createLightPickHandle(node.id, helperType, lightColor);
    const center = createLightCenterDot(node.id, helperType, lightColor);
    const icon = createBlenderLightIcon(node.id, helperType, lightColor);
    const points = [];
    const corners = [
      [-width / 2, -height / 2, 0],
      [width / 2, -height / 2, 0],
      [width / 2, height / 2, 0],
      [-width / 2, height / 2, 0],
    ];
    for (let index = 0; index < corners.length; index += 1) {
      appendLightOutlineSegment(
        points,
        corners[index],
        corners[(index + 1) % corners.length],
      );
    }
    appendLightOutlineSegment(points, [0, 0, 0], [0, 0, -0.44]);
    const panel = createLightOutline(
      node.id,
      helperType,
      lightColor,
      points,
    );
    const endpointPoints = [];
    appendLightOutlineDiamond(endpointPoints, 0.022);
    const endpoint = createLightOutline(
      node.id,
      helperType,
      lightColor,
      endpointPoints,
      'screen-space',
    );
    endpoint.position.z = -0.44;
    group.add(handle, center, icon, panel, endpoint);
  } else {
    const handle = createLightPickHandle(node.id, helperType, lightColor);
    const center = createLightCenterDot(node.id, helperType, lightColor);
    const points = [];
    appendLightOutlineCircle(points, 0.17, 'xy', [0, 0, 0], 24);
    appendLightOutlineCircle(points, 0.17, 'xz', [0, 0, 0], 24);
    const halo = createLightOutline(
      node.id,
      helperType,
      lightColor,
      points,
    );
    group.add(handle, center, halo);
  }
  return group;
}

function componentHelperProof(nodeId) {
  syncEditorLightHelperTransforms();
  const object = editorWorldState?.objectMap.get(nodeId);
  const helper = object?.children.find(
    (child) =>
      child.userData?.iwsdkEditorHelper === true &&
      typeof child.userData?.iwsdkEditorHelperType === 'string',
  );
  if (!helper) {
    return null;
  }
  helper.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(helper);
  const size = new Vector3();
  if (!bounds.isEmpty()) {
    bounds.getSize(size);
  }
  const meshes = [];
  helper.traverse((entry) => {
    if (!entry.isMesh && !entry.isLine) {
      return;
    }
    meshes.push({
      color:
        entry.material?.color?.getHexString?.() ||
        entry.material?.uniforms?.outlineColor?.value?.getHexString?.() ||
        null,
      geometry: entry.geometry?.type || null,
      kind: entry.isLine ? 'line' : 'mesh',
      material: entry.material?.type || null,
      pickable: entry.userData?.iwsdkEditorPickable !== false,
      role: entry.userData?.iwsdkEditorLightRole || null,
      vertexCount: entry.geometry?.attributes?.position?.count || 0,
    });
  });
  return {
    helperType: helper.userData.iwsdkEditorHelperType,
    meshes,
    size: roundVec3(size.toArray()),
  };
}

async function waitForAssetLoads() {
  if (!editorWorldState) {
    return;
  }
  if (editorWorldState.lowerPromise) {
    await editorWorldState.lowerPromise;
  }
}

function restoreEditorReviewLens() {
  if (!editorWorldState) {
    return;
  }
  for (const [object, layerMask] of editorWorldState.lensLayerMasks || []) {
    object.layers.mask = layerMask;
  }
  for (const [object, visible] of editorWorldState.lensVisibility || []) {
    object.visible = visible;
  }
  for (const [mesh, material] of editorWorldState.lensMaterials || []) {
    mesh.material = material;
  }
  editorWorldState.lensLayerMasks = new Map();
  editorWorldState.lensVisibility = new Map();
  editorWorldState.lensMaterials = new Map();
  editorWorldState.neutralMaterial?.dispose?.();
  editorWorldState.neutralMaterial = null;
}

function nearestReviewAnnotation(object, annotationByNode) {
  for (let current = object; current; current = current.parent) {
    const nodeId = current.userData?.iwsdkSceneNodeId;
    if (typeof nodeId === 'string') {
      const annotation = annotationByNode.get(nodeId);
      if (annotation) {
        return annotation;
      }
    }
  }
  return null;
}

function isDirectReviewRenderable(object) {
  return (
    object.isMesh === true ||
    object.isLine === true ||
    object.isPoints === true ||
    object.isSprite === true
  );
}

function maskObjectFromReviewLens(object) {
  if (!editorWorldState.lensLayerMasks.has(object)) {
    editorWorldState.lensLayerMasks.set(object, object.layers.mask);
  }
  object.layers.mask = 0;
}

function applyEditorReviewLens(documentValue) {
  if (!editorWorldState) {
    return;
  }
  restoreEditorPreviewVisibility();
  restoreEditorReviewLens();
  const lens = window.__IWSDK_EDITOR_REVIEW_LENS || 'final';
  const hasAuthoredLights =
    (editorWorldState.lightBindings?.size || 0) > 0 ||
    nodeHasLightComponent({ components: documentValue.components });
  if (editorWorldState.editorAmbient) {
    editorWorldState.editorAmbient.visible = lens !== 'final' || !hasAuthoredLights;
  }
  if (editorWorldState.editorDirectional) {
    editorWorldState.editorDirectional.visible =
      lens !== 'final' || !hasAuthoredLights;
  }
  if (lens === 'final') {
    applyEditorPreviewVisibility(documentValue);
    return;
  }
  const annotationByNode = new Map(
    (documentValue.authoring?.nodeAnnotations || []).map((entry) => [
      entry.node,
      entry,
    ]),
  );
  if (lens === 'layout') {
    editorWorldState.proxyRoot.traverse((object) => {
      if (object.userData?.iwsdkEditorHelper === true) {
        return;
      }
      if (object.isLight === true) {
        maskObjectFromReviewLens(object);
        return;
      }
      if (!isDirectReviewRenderable(object)) {
        return;
      }
      const annotation = nearestReviewAnnotation(object, annotationByNode);
      if (annotation && annotation.reviewLayer !== 'layout') {
        maskObjectFromReviewLens(object);
      }
    });
    applyEditorPreviewVisibility(documentValue);
    return;
  }
  const neutral = new MeshStandardMaterial({
    color: 0xb8bdc4,
    metalness: 0,
    roughness: 0.82,
  });
  editorWorldState.neutralMaterial = neutral;
  const visited = new Set();
  editorWorldState.proxyRoot.traverse((child) => {
    if (visited.has(child)) {
      return;
    }
    visited.add(child);
    if (child.isLight) {
      maskObjectFromReviewLens(child);
    }
    if (child.isMesh) {
      editorWorldState.lensMaterials.set(child, child.material);
      child.material = neutral;
    }
  });
  applyEditorPreviewVisibility(documentValue);
}

function indexLoweredNode(lowered) {
  const helperType = componentHelperType(lowered.node);
  if (
    helperType &&
    !lowered.object.children.some(
      (child) =>
        child.userData?.iwsdkEditorHelper === true &&
        child.userData?.iwsdkEditorHelperType === helperType,
    )
  ) {
    lowered.object.userData.iwsdkEditorFallback = helperType + '-helper';
    lowered.object.userData.iwsdkEditorHelperType = helperType;
    lowered.object.add(createComponentHelperDecoration(lowered.node, helperType));
  }
  editorWorldState.objectMap.set(lowered.id, lowered.object);
  attachEditorLightBindings(lowered);
  attachEditorEnvironmentBindings(lowered);
  for (const virtual of lowered.virtualNodes || []) {
    editorWorldState.objectMap.set(virtual.id, virtual.object);
  }
  for (const child of lowered.children || []) {
    indexLoweredNode(child);
  }
}

const EDITOR_BUILTIN_PREVIEW_TRANSFORMS = {
  player: {},
  camera: { position: [0, 1.7, 0] },
  head: { position: [0, 1.7, 0] },
  'left-target-ray': { position: [-0.26, 1.35, -0.32] },
  'right-target-ray': { position: [0.26, 1.35, -0.32] },
  'left-grip': { position: [-0.24, 1.28, -0.24] },
  'right-grip': { position: [0.24, 1.28, -0.24] },
};

function playerRigTransform(documentValue, target) {
  return target === 'player'
    ? documentValue.player?.transform || {}
    : EDITOR_BUILTIN_PREVIEW_TRANSFORMS[target] || {};
}

function applyEditorBuiltinRigTransforms(documentValue) {
  if (!editorWorldState?.builtInObjectMap) {
    return;
  }
  for (const [target, object] of editorWorldState.builtInObjectMap) {
    if (target === 'level-root') {
      applyNodeTransform(object, {});
    } else {
      applyNodeTransform(object, playerRigTransform(documentValue, target));
    }
  }
}

function editorParentForRootNode(node) {
  const target = node?.parent?.target;
  return target
    ? editorWorldState.builtInObjectMap.get(target)
    : editorWorldState.levelRootProxy;
}

function markBuiltinEditorHelper(object, target) {
  object.userData.iwsdkBuiltinTarget = target;
  object.userData.iwsdkEditorHelper = true;
  object.userData.iwsdkOwnsPrimitiveResources = true;
  return object;
}

function createBuiltinEditorDecoration(target) {
  const color = target === 'level-root' ? 0xa8ff78 : 0x68a7ff;
  const decoration = new Group();
  decoration.name = 'IWSDK-' + target + '-helper';
  markBuiltinEditorHelper(decoration, target);
  const radius =
    target === 'head'
      ? 0.09
      : target === 'camera'
        ? 0.065
        : target.includes('target-ray')
          ? 0.045
          : target.includes('grip')
            ? 0.055
            : 0.075;
  const anchor = new Mesh(
    new SphereGeometry(radius, 20, 14),
    new MeshBasicMaterial({
      color,
      depthWrite: false,
      opacity: 0.32,
      transparent: true,
    }),
  );
  decoration.add(markBuiltinEditorHelper(anchor, target));
  return decoration;
}

function createEditorBuiltinRig(proxyRoot) {
  const player = new Group();
  player.name = 'IWSDKPlayerSpaceProxy';
  player.userData.iwsdkBuiltinTarget = 'player';
  const levelRoot = new Group();
  levelRoot.name = 'IWSDKLevelRootProxy';
  levelRoot.userData.iwsdkBuiltinTarget = 'level-root';
  const map = new Map([
    ['player', player],
    ['level-root', levelRoot],
  ]);
  for (const target of [
    'camera',
    'head',
    'left-target-ray',
    'left-grip',
    'right-target-ray',
    'right-grip',
  ]) {
    const object = new Group();
    object.name = 'IWSDK-' + target + '-proxy';
    object.userData.iwsdkBuiltinTarget = target;
    player.add(object);
    map.set(target, object);
  }
  for (const [target, object] of map) {
    object.add(createBuiltinEditorDecoration(target));
  }
  proxyRoot.add(player, levelRoot);
  return { builtInObjectMap: map, levelRootProxy: levelRoot };
}

function detachEditorSceneForSwap() {
  restoreEditorPreviewVisibility();
  restoreEditorReviewLens();
  editorWorldState.transformControls?.detach();
  editorWorldState.hoverHelper = null;
  editorWorldState.hoveredNodeId = null;
  disposeEditorLightBindings();
  disposeEditorEnvironmentBindings();
  for (const root of editorWorldState.loweredNodes || []) {
    root.object.removeFromParent();
  }
  for (const child of [...editorWorldState.proxyRoot.children]) {
    if (child.userData.iwsdkEditorHelper === true) {
      editorWorldState.proxyRoot.remove(child);
      disposeObjectTree(child);
    }
  }
  editorWorldState.objectMap.clear();
}

function attachEditorLightBindings(lowered) {
  const bindings = [];
  for (const [componentName, value] of Object.entries(
    lowered.node?.components || {},
  )) {
    const spec = lightSpecFromComponentValue(componentName, value);
    if (!spec) continue;
    const binding = new LightBinding(
      lowered.object,
      editorWorldState.world.scene,
      spec,
    );
    binding.light.userData.iwsdkEditorAuthoredLight = true;
    bindings.push(binding);
  }
  if (bindings.length > 0) {
    editorWorldState.lightBindings.set(lowered.id, bindings);
  }
}

function disposeEditorLightBindings() {
  if (!editorWorldState?.lightBindings) return;
  for (const bindings of editorWorldState.lightBindings.values()) {
    for (const binding of bindings) binding.dispose();
  }
  editorWorldState.lightBindings.clear();
}

function syncEditorLightBindings() {
  if (!editorWorldState?.lightBindings) return;
  for (const bindings of editorWorldState.lightBindings.values()) {
    for (const binding of bindings) binding.syncTransform();
  }
}

function editorDomeGradientUniforms() {
  return editorWorldState.world
    .getSystem(EnvironmentSystem)
    ?.getDomeGradientUniforms();
}

// Node components never become ECS components in the editor, so DomeFade
// renders through the same binding EnvironmentSystem uses at runtime.
function attachEditorEnvironmentBindings(lowered) {
  const uniforms = editorDomeGradientUniforms();
  if (!uniforms) return;
  const bindings = [];
  for (const [componentName, value] of Object.entries(
    lowered.node?.components || {},
  )) {
    const spec = domeFadeSpecFromComponentValue(componentName, value);
    if (!spec) continue;
    bindings.push(new DomeFadeBinding(lowered.object, uniforms, spec));
  }
  if (bindings.length > 0) {
    editorWorldState.environmentBindings.set(lowered.id, bindings);
  }
}

function disposeEditorEnvironmentBindings() {
  if (!editorWorldState?.environmentBindings) return;
  for (const bindings of editorWorldState.environmentBindings.values()) {
    for (const binding of bindings) binding.dispose();
  }
  editorWorldState.environmentBindings.clear();
}

function syncEditorEnvironmentBindings() {
  if (!editorWorldState?.environmentBindings?.size) return;
  const active = editorDomeGradientUniforms()?.active.value === 1;
  for (const bindings of editorWorldState.environmentBindings.values()) {
    for (const binding of bindings) {
      binding.refresh();
      binding.syncTransform();
      binding.writeMarker(active, active ? null : 'no-dome-gradient');
    }
  }
}

function domeFadeStateProof() {
  const state = {};
  for (const [nodeId, bindings] of editorWorldState?.environmentBindings ||
    []) {
    for (const binding of bindings) {
      if (binding instanceof DomeFadeBinding) {
        state[nodeId] = binding.root.userData.iwsdkDomeFade ?? null;
      }
    }
  }
  return state;
}

function syncEditorLightHelperTransforms() {
  if (!editorWorldState?.objectMap) return;
  for (const object of editorWorldState.objectMap.values()) {
    const helper = object.children.find(
      (child) => child.userData?.iwsdkEditorScaleInvariant === true,
    );
    if (!helper) continue;
    object.updateWorldMatrix(true, false);
    const position = helper.userData.iwsdkEditorWorldPosition;
    const quaternion = helper.userData.iwsdkEditorWorldQuaternion;
    const scale = helper.userData.iwsdkEditorWorldScale;
    object.getWorldPosition(position);
    object.getWorldQuaternion(quaternion);
    helper.matrixWorld.compose(position, quaternion, scale);
    helper.matrixWorldNeedsUpdate = false;
    helper.updateWorldMatrix(false, true);
  }
}

function runtimeComponentForSceneName(componentName) {
  const componentId = stripComponentPrefix(componentName);
  const targetId = componentId === 'Interactable' ? 'RayInteractable' : componentId;
  return ComponentRegistry.getAllComponents().find(
    (component) => component.id === targetId,
  );
}

function reconcileEditorRootComponents(components) {
  const rootEntity = editorWorldState.world.activeLevel?.value;
  if (!rootEntity) {
    throw new Error('Editor level root is unavailable');
  }
  const previousNames = [...editorWorldState.appliedRootComponentNames];
  const nextComponents = components || {};
  const nextNames = Object.keys(nextComponents);
  for (const componentName of previousNames) {
    const component = runtimeComponentForSceneName(componentName);
    if (component && rootEntity.hasComponent(component)) {
      rootEntity.removeComponent(component);
    }
  }
  editorWorldState.appliedRootComponentNames = new Set([
    ...previousNames,
    ...nextNames,
  ]);
  LevelComponentApplier.applyComponents(
    rootEntity,
    nextComponents,
    editorWorldState.world,
    { nodeId: '$root', strict: true },
  );
  editorWorldState.appliedRootComponentNames = new Set(nextNames);
  // The editor renders on demand, so explicitly run component systems once.
  editorWorldState.world.update(0, performance.now() / 1000);
}

function installLoweredEditorScene(documentValue, lowered, key, session) {
  const previousDocument = editorWorldState.currentDocumentValue;
  const previousKey = editorWorldState.loweredDocumentKey;
  const previousPendingKey = editorWorldState.pendingDocumentKey;
  const previousHoveredNodeId = editorWorldState.hoveredNodeId;
  const previousLowered = editorWorldState.loweredNodes || [];
  const previousEnvironmentBase = editorWorldState.environmentPreviousState;
  detachEditorSceneForSwap();
  let replacedEnvironmentState;
  try {
    replacedEnvironmentState = applySceneEnvironment(
      editorWorldState.world.scene,
      editorWorldState.world.renderer,
      documentValue.environment,
      previousEnvironmentBase || undefined,
    );
    editorWorldState.environmentPreviousState =
      previousEnvironmentBase || replacedEnvironmentState;
    reconcileEditorRootComponents(documentValue.components);
    applyEditorBuiltinRigTransforms(documentValue);
    editorWorldState.currentDocumentValue = documentValue;
    editorWorldState.loweredNodes = lowered;
    for (const root of lowered) {
      editorParentForRootNode(root.node).add(root.object);
      indexLoweredNode(root);
    }
    consumeMaterializationFailure('install');
    editorWorldState.loweredDocumentKey = key;
    editorWorldState.pendingDocumentKey = null;
    applyEditorReviewLens(documentValue);
    rebuildSelectionHelpers();
    if (session) {
      syncTransformControlsToSelection(session);
      updateHoverHelper(session, editorWorldState.hoveredNodeId);
      updateProjectedHitTargets(session);
    }
    renderEditorWorld();
  } catch (error) {
    detachEditorSceneForSwap();
    disposeEditorPanelPreviews(...lowered);
    disposeLoweredSceneNodes(...lowered);
    if (replacedEnvironmentState) {
      restoreSceneEnvironment(
        editorWorldState.world.scene,
        editorWorldState.world.renderer,
        replacedEnvironmentState,
      );
    }
    editorWorldState.environmentPreviousState = previousEnvironmentBase;
    editorWorldState.currentDocumentValue = previousDocument;
    reconcileEditorRootComponents(previousDocument?.components);
    editorWorldState.loweredNodes = previousLowered;
    editorWorldState.loweredDocumentKey = previousKey;
    editorWorldState.pendingDocumentKey = previousPendingKey;
    editorWorldState.hoveredNodeId = previousHoveredNodeId;
    for (const root of previousLowered) {
      editorParentForRootNode(root.node).add(root.object);
      indexLoweredNode(root);
    }
    if (previousDocument) {
      applyEditorReviewLens(previousDocument);
    }
    rebuildSelectionHelpers();
    if (session) {
      syncTransformControlsToSelection(session);
      updateHoverHelper(session, previousHoveredNodeId);
      updateProjectedHitTargets(session);
    }
    renderEditorWorld();
    throw error;
  }
  if (previousLowered.length > 0) {
    disposeEditorPanelPreviews(...previousLowered);
    disposeLoweredSceneNodes(...previousLowered);
  }
}

function consumeMaterializationFailure(phase) {
  const failure = editorWorldState?.nextMaterializationFailure;
  if (!failure || failure.phase !== phase) {
    return;
  }
  editorWorldState.nextMaterializationFailure = null;
  throw new Error(failure.message || 'Injected ' + phase + ' failure');
}

function discardStagedEditorPreview() {
  const staged = editorWorldState?.stagedPreview;
  if (staged?.lowered) {
    disposeEditorPanelPreviews(...staged.lowered);
    disposeLoweredSceneNodes(...staged.lowered);
  }
  if (editorWorldState) {
    editorWorldState.stagedPreview = null;
  }
}

async function preloadEditorDocumentResources(documentValue) {
  if (!editorWorldState) {
    throw new Error('Editor world is not ready for resource preflight');
  }
  discardStagedEditorPreview();
  const staged = {
    assetProof: new Map(),
    documentValue,
    key: JSON.stringify(documentValue),
    lowered: null,
  };
  editorWorldState.stagedPreview = staged;
  for (const assetId of referencedSceneAssetIds(documentValue)) {
    if (!editorWorldState.world.assets.hasAuthoringAsset(assetId)) {
      throw new Error('Scene references unknown manifest asset "' + assetId + '"');
    }
    // UIKitML is materialized as an isolated texture preview in editor mode;
    // the editor world intentionally leaves spatialUI disabled. Conventional
    // assets still instantiate through the world registry here.
    const proof = await instantiateEditorSceneAsset(assetId);
    proof.userData.iwsdkDisposeAsset?.();
    staged.assetProof.set(assetId, {
      assetId,
      loadedAt: Date.now(),
      status: 'loaded',
    });
  }
}

async function instantiateEditorDocumentPreview(documentValue) {
  if (!editorWorldState) {
    throw new Error('Editor world is not ready for detached instantiation');
  }
  const key = JSON.stringify(documentValue);
  const staged = editorWorldState.stagedPreview;
  if (!staged || staged.key !== key) {
    throw new Error(
      'Detached editor instantiation requires matching preflighted resources',
    );
  }
  consumeMaterializationFailure('detached');
  const lowered = await lowerSceneDocumentObjects(documentValue, {
    loadAsset: instantiateEditorSceneAsset,
    resolveAssetBounds: (assetId) => editorWorldState.world.assets.bounds(assetId),
    useInstancing: true,
  });
  try {
    await materializeEditorPanelPreviews(lowered);
    staged.lowered = lowered;
  } catch (error) {
    disposeEditorPanelPreviews(...lowered);
    disposeLoweredSceneNodes(...lowered);
    throw error;
  }
}

function commitEditorDocument(documentValue) {
  if (!editorWorldState) {
    throw new Error('Editor world is not ready for scene commit');
  }
  const key = JSON.stringify(documentValue);
  const staged = editorWorldState.stagedPreview;
  if (!staged || staged.key !== key || !staged.lowered) {
    throw new Error('Editor scene commit does not match the preflighted document');
  }
  editorWorldState.lowerGeneration =
    (editorWorldState.lowerGeneration || 0) + 1;
  editorWorldState.lowerPromise = null;
  editorWorldState.pendingDocumentKey = null;
  const lowered = staged.lowered;
  staged.lowered = null;
  installLoweredEditorScene(
    documentValue,
    lowered,
    key,
    editorWorldState.currentSession,
  );
  editorWorldState.assetProof = new Map(staged.assetProof);
  editorWorldState.stagedPreview = null;
}

function rollbackEditorDocument() {
  discardStagedEditorPreview();
}

function scheduleEditorSceneLowering(session, { force = false } = {}) {
  if (!editorWorldState) {
    return Promise.resolve();
  }
  if (force) {
    invalidateEditorPanelAssetPreviews();
  }
  const documentValue = session.document;
  const key = JSON.stringify(documentValue);
  if (!force && editorWorldState.loweredDocumentKey === key) {
    applyEditorReviewLens(documentValue);
    return editorWorldState.lowerPromise || Promise.resolve();
  }
  if (
    !force &&
    editorWorldState.pendingDocumentKey === key &&
    editorWorldState.lowerPromise
  ) {
    return editorWorldState.lowerPromise;
  }
  const generation = (editorWorldState.lowerGeneration || 0) + 1;
  editorWorldState.lowerGeneration = generation;
  editorWorldState.pendingDocumentKey = key;
  const promise = (async () => {
    const documentResult = await session.dispatch('scene_get_document', {});
    const lowered = await lowerSceneDocumentObjects(documentValue, {
      loadAsset: instantiateEditorSceneAsset,
      resolveAssetBounds: (assetId) => editorWorldState.world.assets.bounds(assetId),
      runtimeHash: documentResult?.runtimeHash,
      useInstancing: true,
    });
    try {
      await materializeEditorPanelPreviews(lowered);
    } catch (error) {
      disposeEditorPanelPreviews(...lowered);
      disposeLoweredSceneNodes(...lowered);
      throw error;
    }
    if (!editorWorldState || editorWorldState.lowerGeneration !== generation) {
      disposeEditorPanelPreviews(...lowered);
      disposeLoweredSceneNodes(...lowered);
      return;
    }
    installLoweredEditorScene(documentValue, lowered, key, session);
  })().catch((error) => {
    if (editorWorldState?.lowerGeneration === generation) {
      editorWorldState.pendingDocumentKey = null;
    }
    console.error('[IWSDK Scene Editor] Scene materialization failed:', error);
    throw error;
  });
  editorWorldState.lowerPromise = promise.finally(() => {
    if (editorWorldState?.lowerGeneration === generation) {
      editorWorldState.lowerPromise = null;
    }
  });
  return editorWorldState.lowerPromise;
}

function updateSelectionHelpers() {
  if (!editorWorldState) {
    return;
  }
  const replacements = [];
  editorWorldState.proxyRoot.traverse((object) => {
    if (
      object.userData?.iwsdkEditorSelectionHelper === true &&
      object.object
    ) {
      replacements.push({
        helper: object,
        nodeId: object.userData.iwsdkSceneNodeId,
        target: object.object,
      });
    }
  });
  for (const entry of replacements) {
    if (!entry.target) {
      continue;
    }
    const replacement = createEditorBoundsHelper(entry.target, 0x9ff3c7);
    if (!replacement) {
      entry.helper.parent?.remove(entry.helper);
      disposeEditorHelper(entry.helper);
      continue;
    }
    replacement.name = \`\${entry.nodeId}-selection-outline\`;
    replacement.userData.iwsdkEditorHelper = true;
    replacement.userData.iwsdkEditorSelectionHelper = true;
    replacement.userData.iwsdkSceneNodeId = entry.nodeId;
    entry.helper.parent?.remove(entry.helper);
    disposeEditorHelper(entry.helper);
    editorWorldState.proxyRoot.add(replacement);
  }
}

function rebuildSelectionHelpers() {
  if (!editorWorldState) {
    return;
  }
  const existing = [];
  editorWorldState.proxyRoot.traverse((object) => {
    if (object.userData?.iwsdkEditorSelectionHelper === true) {
      existing.push(object);
    }
  });
  for (const helper of existing) {
    helper.parent?.remove(helper);
    helper.geometry?.dispose?.();
    helper.material?.dispose?.();
  }
  for (const nodeId of window.__IWSDK_EDITOR_SELECTION || []) {
    const object = editorWorldState.objectMap.get(nodeId);
    if (!object || !object.parent) {
      continue;
    }
    const helper = createEditorBoundsHelper(object, 0x9ff3c7);
    if (!helper) {
      continue;
    }
    helper.name = nodeId + '-selection-outline';
    helper.userData.iwsdkEditorHelper = true;
    helper.userData.iwsdkEditorSelectionHelper = true;
    helper.userData.iwsdkSceneNodeId = nodeId;
    editorWorldState.proxyRoot.add(helper);
  }
}

function resizeEditorRenderer(size = {}, cameraState = null) {
  if (!editorWorldState) {
    return { height: 1, width: 1 };
  }
  const rect = editorWorldState.host.getBoundingClientRect();
  const width = Math.max(1, Math.floor(size.width || rect.width || 960));
  const height = Math.max(1, Math.floor(size.height || rect.height || 640));
  editorWorldState.world.renderer.setSize(width, height, false);
  editorWorldState.world.renderer.domElement.style.height = '100%';
  editorWorldState.world.renderer.domElement.style.width = '100%';
  updateEditorCameraProjection(
    editorWorldState.world.camera,
    cameraState || editorWorldState.currentCamera,
    width / height,
  );
  return { height, width };
}

function setEditorProjectionCamera(projection) {
  if (!editorWorldState) {
    return null;
  }
  const nextCamera =
    projection === 'orthographic'
      ? editorWorldState.orthographicCamera
      : editorWorldState.perspectiveCamera;
  if (editorWorldState.world.camera === nextCamera) {
    return nextCamera;
  }
  editorWorldState.world.camera = nextCamera;
  if (editorWorldState.orbitControls) {
    editorWorldState.orbitControls.object = nextCamera;
  }
  if (editorWorldState.transformControls) {
    editorWorldState.transformControls.camera = nextCamera;
  }
  return nextCamera;
}

function updateEditorCameraProjection(camera, state, aspect) {
  if (!camera) {
    return;
  }
  if (camera.isOrthographicCamera === true) {
    const height = Math.max(0.001, state?.height ?? 10);
    const halfHeight = height / 2;
    const halfWidth = halfHeight * Math.max(0.001, aspect || 1);
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
  } else {
    camera.aspect = Math.max(0.001, aspect || 1);
    camera.fov = state?.fov ?? 50;
  }
  camera.updateProjectionMatrix();
}

function applyEditorCamera(camera) {
  if (!editorWorldState) {
    return;
  }
  const state = camera || {
    fov: 50,
    lookAt: [0, 0, 0],
    position: [4, 3, 4],
    projection: 'perspective',
    view: 'quarter',
  };
  const projection =
    state.projection === 'orthographic' ? 'orthographic' : 'perspective';
  const activeCamera = setEditorProjectionCamera(projection);
  activeCamera.position.set(
    state.position?.[0] ?? 4,
    state.position?.[1] ?? 3,
    state.position?.[2] ?? 4,
  );
  activeCamera.lookAt(
    state.lookAt?.[0] ?? 0,
    state.lookAt?.[1] ?? 0,
    state.lookAt?.[2] ?? 0,
  );
  if (editorWorldState.orbitControls) {
    editorWorldState.orbitControls.target.set(
      state.lookAt?.[0] ?? 0,
      state.lookAt?.[1] ?? 0,
      state.lookAt?.[2] ?? 0,
    );
    editorWorldState.suppressOrbitChange = true;
    try {
      editorWorldState.orbitControls.update();
    } finally {
      editorWorldState.suppressOrbitChange = false;
    }
  }
  const canvas = editorWorldState.world.renderer.domElement;
  updateEditorCameraProjection(
    activeCamera,
    state,
    canvas.width / Math.max(1, canvas.height),
  );
  activeCamera.updateMatrixWorld(true);
}

function boundsForObjects(objects) {
  const bounds = new Box3();
  bounds.makeEmpty();
  for (const object of objects) {
    if (!object) {
      continue;
    }
    const objectBounds = boundsForObjectWithoutEditorHelpers(object);
    if (objectBounds) {
      bounds.union(objectBounds);
    }
  }
  return bounds.isEmpty() ? null : bounds;
}

function boundsForSelectedObjects() {
  if (!editorWorldState) {
    return null;
  }
  const selectedIds = window.__IWSDK_EDITOR_SELECTION || [];
  return boundsForObjects(
    selectedIds
      .map((nodeId) => editorWorldState.objectMap.get(nodeId))
      .filter(Boolean),
  );
}

function boundsForSceneObjects() {
  if (!editorWorldState) {
    return null;
  }
  return boundsForObjects([...editorWorldState.objectMap.values()]);
}

function boundsForSceneFramingObjects() {
  if (!editorWorldState) {
    return null;
  }
  const bounds = new Box3();
  bounds.makeEmpty();
  editorWorldState.proxyRoot.updateMatrixWorld(true);
  editorWorldState.proxyRoot.traverse((object) => {
    if (
      !objectIsEffectivelyVisible(object) ||
      object.userData?.iwsdkEditorHelper === true ||
      object.userData?.iwsdkSceneFramingRole === 'support'
    ) {
      return;
    }
    expandBoundsByOwnGeometry(bounds, object);
  });
  return bounds.isEmpty() ? null : bounds;
}

function expandBoundsByOwnGeometry(bounds, object) {
  const geometry = object.geometry;
  if (!geometry) {
    return;
  }
  let localBounds;
  if (object.isInstancedMesh === true || object.isSkinnedMesh === true) {
    object.computeBoundingBox?.();
    localBounds = object.boundingBox;
  } else {
    geometry.computeBoundingBox?.();
    localBounds = geometry.boundingBox;
  }
  if (!localBounds || localBounds.isEmpty()) {
    return;
  }
  bounds.union(localBounds.clone().applyMatrix4(object.matrixWorld));
}

function boundsForObjectWithoutEditorHelpers(object) {
  object.updateMatrixWorld(true);
  const authoredBounds = new Box3();
  authoredBounds.makeEmpty();
  object.traverse((entry) => {
    if (entry.userData?.iwsdkEditorHelper === true) {
      return;
    }
    expandBoundsByOwnGeometry(authoredBounds, entry);
  });
  if (!authoredBounds.isEmpty()) {
    return authoredBounds;
  }
  const fallbackBounds = new Box3().setFromObject(object);
  return fallbackBounds.isEmpty() ? null : fallbackBounds;
}

function isLightEditorHelperType(helperType) {
  return (
    helperType === 'directional-light' ||
    helperType === 'environment-light' ||
    helperType === 'point-light' ||
    helperType === 'rect-area-light' ||
    helperType === 'spot-light'
  );
}

function createEditorBoundsHelper(object, color) {
  if (isLightEditorHelperType(object.userData?.iwsdkEditorHelperType)) {
    return null;
  }
  const bounds = boundsForObjectWithoutEditorHelpers(object);
  if (!bounds) {
    return null;
  }
  const helper = new Box3Helper(bounds, color);
  helper.object = object;
  return helper;
}

function roundCameraVec3(vector) {
  return [
    Number(vector.x.toFixed(4)),
    Number(vector.y.toFixed(4)),
    Number(vector.z.toFixed(4)),
  ];
}

function frameViewportBounds(bounds, cameraState) {
  if (!editorWorldState || !bounds) {
    return null;
  }
  const center = new Vector3();
  const size = new Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);

  const currentCamera = editorWorldState.world.camera;
  const currentTarget =
    editorWorldState.orbitControls?.target || new Vector3(0, 0, 0);
  const direction = new Vector3()
    .subVectors(currentCamera.position, currentTarget)
    .normalize();
  if (!Number.isFinite(direction.length()) || direction.lengthSq() < 0.0001) {
    direction.set(1, 0.75, 1).normalize();
  }

  const maxSize = Math.max(size.x, size.y, size.z, 0.5);
  const projection =
    cameraState?.projection === 'orthographic'
      ? 'orthographic'
      : 'perspective';
  const fov = cameraState?.fov ?? editorWorldState.perspectiveCamera.fov ?? 50;
  const radius = maxSize * 0.5;
  const distance =
    projection === 'orthographic'
      ? Math.max(1.5, currentCamera.position.distanceTo(currentTarget))
      : Math.max(
          1.5,
          (radius / Math.sin(MathUtils.degToRad(fov) / 2)) * 1.35,
        );
  const position = center.clone().add(direction.multiplyScalar(distance));
  const nextCamera = {
    fov,
    ...(projection === 'orthographic' ? { height: maxSize * 1.35 } : {}),
    lookAt: roundCameraVec3(center),
    position: roundCameraVec3(position),
    projection,
    view: 'custom',
  };
  if (cameraState) {
    Object.assign(cameraState, nextCamera);
  }
  editorWorldState.currentCamera = cameraState || nextCamera;
  applyEditorCamera(editorWorldState.currentCamera);
  renderEditorWorld();
  if (editorWorldState.currentSession) {
    updateProjectedHitTargets(editorWorldState.currentSession);
  }
  return editorWorldState.currentCamera;
}

function frameViewport(target, cameraState) {
  const bounds =
    target === 'scene'
      ? boundsForSceneFramingObjects()
      : boundsForSelectedObjects() || boundsForSceneFramingObjects();
  return frameViewportBounds(bounds, cameraState);
}

function updateCameraStateFromWorld(cameraState) {
  if (!editorWorldState || !cameraState) {
    return cameraState;
  }
  const camera = editorWorldState.world.camera;
  const target = editorWorldState.orbitControls?.target || new Vector3(0, 0, 0);
  const lookAt = [target.x, target.y, target.z];
  const position = [camera.position.x, camera.position.y, camera.position.z];
  cameraState.projection =
    camera.isOrthographicCamera === true ? 'orthographic' : 'perspective';
  if (camera.isOrthographicCamera === true) {
    cameraState.height = camera.top - camera.bottom;
  } else {
    cameraState.fov = camera.fov;
    delete cameraState.height;
  }
  cameraState.lookAt = lookAt;
  cameraState.position = position;
  cameraState.view = inferNamedCameraView(position, lookAt);
  delete cameraState.viewId;
  window.__IWSDK_EDITOR_CAMERA = cameraState;
  return cameraState;
}

function inferNamedCameraView(position, lookAt) {
  const direction = new Vector3(
    position[0] - lookAt[0],
    position[1] - lookAt[1],
    position[2] - lookAt[2],
  );
  if (direction.lengthSq() < 0.0001) {
    return 'custom';
  }
  direction.normalize();
  const epsilon = 0.015;
  if (Math.abs(direction.x - 1) < epsilon) {
    return 'right';
  }
  if (Math.abs(direction.x + 1) < epsilon) {
    return 'left';
  }
  if (Math.abs(direction.y - 1) < epsilon) {
    return 'top';
  }
  if (Math.abs(direction.z - 1) < epsilon) {
    return 'front';
  }
  if (Math.abs(direction.z + 1) < epsilon) {
    return 'back';
  }
  return 'custom';
}

function createOrientationGizmo(session) {
  const host = document.getElementById('orientation-gizmo');
  if (!(host instanceof HTMLElement) || !editorWorldState) {
    return null;
  }

  host.innerHTML = '';
  const gizmo = new ViewportGizmo(
    editorWorldState.world.camera,
    editorWorldState.world.renderer,
    {
      animated: false,
      background: {
        enabled: false,
      },
      className: 'orientation-gizmo-widget',
      container: host,
      corners: { enabled: false },
      edges: { enabled: false },
      font: {
        family: 'Inter, ui-sans-serif, system-ui, sans-serif',
        weight: 700,
      },
      lineWidth: 2,
      nx: {
        color: 0x9d2f2f,
        label: '-X',
        labelColor: 0xffffff,
      },
      ny: {
        enabled: false,
      },
      nz: {
        color: 0x325fbd,
        label: '-Z',
        labelColor: 0xffffff,
      },
      offset: {
        bottom: 0,
        left: 0,
        right: 0,
        top: 0,
      },
      placement: 'top-left',
      size: 112,
      x: {
        color: 0xff5d5d,
        label: 'X',
        labelColor: 0xffffff,
      },
      y: {
        color: 0x5ee58a,
        label: 'Y',
        labelColor: 0x0a0a0b,
      },
      z: {
        color: 0x63a9ff,
        label: 'Z',
        labelColor: 0x0a0a0b,
      },
    },
  );
  gizmo.attachControls(editorWorldState.orbitControls);
  gizmo.addEventListener('change', () => {
    updateCameraStateFromWorld(editorWorldState.currentCamera);
    renderEditorWorld();
    if (editorWorldState.currentSession) {
      updateProjectedHitTargets(editorWorldState.currentSession);
    }
  });

  renderOrientationGizmo(gizmo);
  return gizmo;
}

function renderOrientationGizmo(gizmo = editorWorldState?.orientationGizmo) {
  if (!editorWorldState || !gizmo) {
    return;
  }
  gizmo.update(false);
  gizmo.render();
  gizmo.clickTargets = computeOrientationGizmoClickTargets(gizmo);
  renderOrientationGizmoVisual(gizmo);
}

function hideCurrentEditorHelpersForRenderOnlyCapture() {
  if (!editorWorldState || editorWorldState.renderOnlyCaptureDepth === 0) {
    return;
  }
  const visibility = editorWorldState.renderOnlyHelperVisibility || [];
  const tracked =
    editorWorldState.renderOnlyTrackedHelpers ||
    new Set(visibility.map(([object]) => object));
  editorWorldState.renderOnlyHelperVisibility = visibility;
  editorWorldState.renderOnlyTrackedHelpers = tracked;
  editorWorldState.world.scene.traverse((object) => {
    if (
      object.userData?.iwsdkEditorHelper !== true ||
      object.isLight === true
    ) {
      return;
    }
    if (!tracked.has(object)) {
      tracked.add(object);
      visibility.push([object, object.visible]);
    }
    object.visible = false;
  });
  editorWorldState.renderEditorOverlays = false;
}

function renderEditorWorld() {
  if (!editorWorldState) {
    return;
  }
  hideCurrentEditorHelpersForRenderOnlyCapture();
  syncEditorLightBindings();
  syncEditorEnvironmentBindings();
  syncEditorLightHelperTransforms();
  syncInfiniteEditorGrid();
  const startedAt = performance.now();
  editorWorldState.world.renderer.render(
    editorWorldState.world.scene,
    editorWorldState.world.camera,
  );
  const sceneRender = editorWorldState.world.renderer.info.render;
  editorWorldState.lastSceneRenderInfo = {
    calls: sceneRender.calls,
    lines: sceneRender.lines,
    points: sceneRender.points,
    triangles: sceneRender.triangles,
  };
  const elapsed = performance.now() - startedAt;
  editorWorldState.frameTimeSamples.push(Number(elapsed.toFixed(3)));
  if (editorWorldState.frameTimeSamples.length > 120) {
    editorWorldState.frameTimeSamples.shift();
  }
  if (editorWorldState.renderEditorOverlays !== false) {
    renderOrientationGizmo();
  }
}

function beginRenderOnlyCapture() {
  if (!editorWorldState) {
    return () => {};
  }
  if (editorWorldState.renderOnlyCaptureDepth === 0) {
    editorWorldState.renderOnlyPreviousOverlayState =
      editorWorldState.renderEditorOverlays;
    editorWorldState.renderOnlyHelperVisibility = [];
    editorWorldState.renderOnlyTrackedHelpers = new Set();
    editorWorldState.renderEditorOverlays = false;
  }
  editorWorldState.renderOnlyCaptureDepth += 1;
  hideCurrentEditorHelpersForRenderOnlyCapture();
  let restored = false;
  return () => {
    if (restored || !editorWorldState) {
      return;
    }
    restored = true;
    editorWorldState.renderOnlyCaptureDepth = Math.max(
      0,
      editorWorldState.renderOnlyCaptureDepth - 1,
    );
    if (editorWorldState.renderOnlyCaptureDepth !== 0) {
      return;
    }
    for (const [object, visible] of
      editorWorldState.renderOnlyHelperVisibility || []) {
      object.visible = visible;
    }
    editorWorldState.renderOnlyHelperVisibility = null;
    editorWorldState.renderOnlyTrackedHelpers = null;
    editorWorldState.renderEditorOverlays =
      editorWorldState.renderOnlyPreviousOverlayState;
    editorWorldState.renderOnlyPreviousOverlayState = true;
  };
}

function captureReviewNodeMaskRegions(documentValue, width, height) {
  if (!editorWorldState || !WebGLRenderTarget || width <= 0 || height <= 0) {
    return {};
  }
  const nodeIds = new Set();
  for (const feature of documentValue.authoring?.composition?.features || []) {
    for (const criterion of feature.acceptance || []) {
      if (
        criterion.kind === 'projected-region' &&
        criterion.measurement?.method === 'capture-node-mask-bounds-v1'
      ) {
        for (const nodeId of criterion.nodeRefs || []) {
          nodeIds.add(nodeId);
        }
      }
    }
  }
  if (nodeIds.size === 0) {
    return {};
  }

  const renderer = editorWorldState.world.renderer;
  const scene = editorWorldState.world.scene;
  const camera = editorWorldState.world.camera;
  const previousTarget = renderer.getRenderTarget();
  const previousBackground = scene.background;
  const previousClearColor = renderer.getClearColor(new Color()).clone();
  const previousClearAlpha = renderer.getClearAlpha();
  const renderTarget = new WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  const pixels = new Uint8Array(width * height * 4);
  const regions = {};
  try {
    scene.background = null;
    renderer.setClearColor(0x000000, 1);
    for (const nodeId of nodeIds) {
      const targetObject = editorWorldState.objectMap.get(nodeId);
      if (!targetObject || !objectIsEffectivelyVisible(targetObject)) {
        continue;
      }
      const targetObjects = new Set();
      targetObject.traverse((object) => targetObjects.add(object));
      const originals = [];
      const generatedMaterials = [];
      scene.traverse((object) => {
        if (
          object.isMesh !== true ||
          !objectIsEffectivelyVisible(object) ||
          !materialCanRender(object.material)
        ) {
          return;
        }
        originals.push([object, object.material]);
        object.material = createReviewMaskMaterial(
          object.material,
          targetObjects.has(object) ? 0xffffff : 0x000000,
          generatedMaterials,
        );
      });
      try {
        renderer.setRenderTarget(renderTarget);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(
          renderTarget,
          0,
          0,
          width,
          height,
          pixels,
        );
        const region = regionFromNodeMaskPixels(pixels, width, height);
        if (region) {
          regions[nodeId] = region;
        }
      } finally {
        for (const [object, material] of originals) {
          object.material = material;
        }
        for (const material of generatedMaterials) {
          material.dispose();
        }
      }
    }
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    scene.background = previousBackground;
    renderTarget.dispose();
  }
  return regions;
}

function createReviewMaskMaterial(material, color, generatedMaterials) {
  const sourceMaterials = Array.isArray(material) ? material : [material];
  const replacements = sourceMaterials.map((source) => {
    const replacement = new MeshBasicMaterial({
      color,
      colorWrite: source?.colorWrite !== false,
      depthTest: source?.depthTest !== false,
      depthWrite: source?.depthWrite !== false,
      fog: false,
      side: source?.side,
      toneMapped: false,
      visible: source?.visible !== false,
    });
    generatedMaterials.push(replacement);
    return replacement;
  });
  return Array.isArray(material) ? replacements : replacements[0];
}

function regionFromNodeMaskPixels(pixels, width, height) {
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (pixels[offset] <= 127) {
        continue;
      }
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
    }
  }
  if (maximumX < minimumX || maximumY < minimumY) {
    return null;
  }
  const top = height - 1 - maximumY;
  return [
    minimumX / width,
    top / height,
    (maximumX - minimumX + 1) / width,
    (maximumY - minimumY + 1) / height,
  ];
}

function materialCanRender(material) {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => entry && entry.visible !== false);
}

function objectIsSubmittedForCamera(object, camera, frustum) {
  if (!object.layers?.test(camera.layers)) {
    return false;
  }
  // Lights enter the renderer's light lists based on visibility and layers rather
  // than camera-frustum intersection, so retain them as rendering contributors.
  if (object.isLight === true) {
    return true;
  }
  if (object.isSprite === true) {
    return (
      materialCanRender(object.material) &&
      (object.frustumCulled === false || frustum.intersectsSprite(object))
    );
  }
  if (
    object.isMesh !== true &&
    object.isLine !== true &&
    object.isPoints !== true
  ) {
    return false;
  }
  return (
    object.geometry != null &&
    materialCanRender(object.material) &&
    (object.frustumCulled === false || frustum.intersectsObject(object))
  );
}

function objectIsEffectivelyVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (
      current.visible === false ||
      current.userData?.iwsdkEditorHelper === true
    ) {
      return false;
    }
  }
  return true;
}

function intersectionMaterialCanRender(intersection) {
  const material = intersection.object?.material;
  if (!Array.isArray(material)) {
    return materialCanRender(material);
  }
  const materialIndex = intersection.face?.materialIndex;
  if (materialIndex == null) {
    return materialCanRender(material);
  }
  const entry = material[materialIndex];
  return entry != null && entry.visible !== false;
}

function renderableWorldBounds(object) {
  const geometry = object.geometry;
  if (geometry) {
    if (geometry.boundingBox == null) {
      geometry.computeBoundingBox?.();
    }
    if (geometry.boundingBox != null) {
      return new Box3().copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
    }
  }
  const bounds = new Box3().setFromObject(object, true);
  return bounds.isEmpty() ? null : bounds;
}

function projectedFirstHitSamples(object, camera) {
  if (object.isSprite === true) {
    const center = new Vector3();
    object.getWorldPosition(center);
    center.project(camera);
    return Number.isFinite(center.x) && Number.isFinite(center.y)
      ? [new Vector2(center.x, center.y)]
      : [];
  }
  const bounds = renderableWorldBounds(object);
  if (!bounds) {
    return [];
  }
  const projected = [
    [bounds.min.x, bounds.min.y, bounds.min.z],
    [bounds.min.x, bounds.min.y, bounds.max.z],
    [bounds.min.x, bounds.max.y, bounds.min.z],
    [bounds.min.x, bounds.max.y, bounds.max.z],
    [bounds.max.x, bounds.min.y, bounds.min.z],
    [bounds.max.x, bounds.min.y, bounds.max.z],
    [bounds.max.x, bounds.max.y, bounds.min.z],
    [bounds.max.x, bounds.max.y, bounds.max.z],
  ]
    .map(([x, y, z]) => new Vector3(x, y, z).project(camera))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (projected.length === 0) {
    return [];
  }
  const minimumX = Math.max(-1, Math.min(...projected.map((point) => point.x)));
  const maximumX = Math.min(1, Math.max(...projected.map((point) => point.x)));
  const minimumY = Math.max(-1, Math.min(...projected.map((point) => point.y)));
  const maximumY = Math.min(1, Math.max(...projected.map((point) => point.y)));
  if (minimumX > maximumX || minimumY > maximumY) {
    return [];
  }
  const fractions = [0.5, 0.15, 0.85];
  const samples = [];
  for (const xFraction of fractions) {
    for (const yFraction of fractions) {
      samples.push(
        new Vector2(
          minimumX + (maximumX - minimumX) * xFraction,
          minimumY + (maximumY - minimumY) * yFraction,
        ),
      );
    }
  }
  const cameraPosition = new Vector3();
  camera.getWorldPosition(cameraPosition);
  if (
    cameraPosition.x >= bounds.min.x &&
    cameraPosition.x <= bounds.max.x &&
    cameraPosition.z >= bounds.min.z &&
    cameraPosition.z <= bounds.max.z &&
    cameraPosition.y > bounds.max.y
  ) {
    samples.push(
      new Vector2(-0.5, -0.8),
      new Vector2(0, -0.8),
      new Vector2(0.5, -0.8),
    );
  }
  return samples;
}

function firstHitVisibleRenderables(camera, raycastObjects) {
  const visible = new Set();
  const raycaster = new Raycaster();
  raycaster.layers.mask = camera.layers.mask;
  raycaster.near = camera.near;
  raycaster.far = camera.far;
  for (const object of raycastObjects) {
    for (const sample of projectedFirstHitSamples(object, camera)) {
      raycaster.setFromCamera(sample, camera);
      const firstHit = raycaster
        .intersectObjects(raycastObjects, false)
        .find(intersectionMaterialCanRender);
      if (firstHit?.object === object) {
        visible.add(object);
        break;
      }
    }
  }
  return visible;
}

function objectTreeContributesToCapture(root, visibleRenderables, lights) {
  if (!objectIsEffectivelyVisible(root)) {
    return false;
  }
  let contributes = false;
  const visit = (object) => {
    if (
      contributes ||
      object.visible === false ||
      object.userData?.iwsdkEditorHelper === true
    ) {
      return;
    }
    if (visibleRenderables.has(object) || lights.has(object)) {
      contributes = true;
      return;
    }
    for (const child of object.children || []) {
      visit(child);
      if (contributes) {
        return;
      }
    }
  };
  visit(root);
  return contributes;
}

function visibleEditorSceneNodeIds() {
  if (!editorWorldState) {
    return [];
  }
  const camera = editorWorldState.world.camera;
  editorWorldState.world.scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const projection = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new Frustum().setFromProjectionMatrix(projection);
  const raycastObjects = [];
  const lights = new Set();
  editorWorldState.world.scene.traverse((object) => {
    if (
      !objectIsEffectivelyVisible(object) ||
      !objectIsSubmittedForCamera(object, camera, frustum)
    ) {
      return;
    }
    if (object.isLight === true) {
      lights.add(object);
    } else {
      raycastObjects.push(object);
    }
  });
  const visibleRenderables = firstHitVisibleRenderables(camera, raycastObjects);
  return [...editorWorldState.objectMap.entries()]
    .filter(([, object]) =>
      objectTreeContributesToCapture(object, visibleRenderables, lights),
    )
    .map(([nodeId]) => nodeId)
    .sort();
}

function currentEditorRenderStats() {
  if (!editorWorldState) {
    return null;
  }
  const renderer = editorWorldState.world.renderer;
  const info = renderer.info;
  const renderInfo = editorWorldState.lastSceneRenderInfo || info.render;
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const hostEnvironment = window.__IWSDK_HOST_BROWSER_ENVIRONMENT || {};
  const emulationProfile = window.__IWSDK_EMULATION_PROFILE || {
    active: false,
    device: null,
    runtime: null,
  };
  const hostUserAgent = hostEnvironment.userAgent || navigator.userAgent;
  const shadowCasters = [];
  const geometries = new Set();
  const materials = new Set();
  const renderedAssets = [];
  let meshCount = 0;
  let objectCount = 0;
  editorWorldState.proxyRoot.traverse((object) => {
    if (object === editorWorldState.proxyRoot || object.userData?.iwsdkEditorHelper) {
      return;
    }
    objectCount += 1;
    const assetId = object.userData?.iwsdkSceneAssetId;
    if (typeof assetId === 'string') {
      let assetMeshCount = 0;
      object.traverse((entry) => {
        if (entry.isMesh === true) {
          assetMeshCount += 1;
        }
      });
      renderedAssets.push({ id: assetId, meshCount: assetMeshCount });
    }
    if (object.isMesh !== true) {
      return;
    }
    meshCount += 1;
    if (object.geometry) {
      geometries.add(object.geometry.uuid || object.geometry);
    }
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of objectMaterials) {
      if (material) {
        materials.add(material.uuid || material);
      }
    }
  });
  editorWorldState.world.scene.traverse((object) => {
    if (object.castShadow === true) {
      shadowCasters.push(object.uuid);
    }
  });
  return {
    available: true,
    calls: renderInfo.calls,
    frameTimeSamplesMs: [...editorWorldState.frameTimeSamples],
    lines: renderInfo.lines,
    environment: {
      browser: hostUserAgent,
      devicePixelRatio: window.devicePixelRatio,
      emulatedUserAgent: emulationProfile.active ? navigator.userAgent : null,
      emulationProfile: {
        active: emulationProfile.active === true,
        device: emulationProfile.device || null,
        runtime: emulationProfile.runtime || null,
      },
      gpu: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      hostPlatform:
        hostEnvironment.platform || navigator.platform || 'unknown',
      hostUserAgent,
      renderer: 'IWSDK WebGL',
      visibility: {
        method: 'threejs-first-hit-sampling-v1',
        occlusion: 'conservative-cpu-first-hit',
        sampleGrid: '3x3-projected-bounds+overhead-lower-frame',
        uncertainObjectsIncluded: false,
      },
    },
    geometryCount: geometries.size,
    points: renderInfo.points,
    programs: Array.isArray(info.programs) ? info.programs.length : 0,
    materialCount: materials.size,
    meshCount,
    nodeCount: countSceneDocumentNodes(
      editorWorldState.currentSession?.document?.nodes || [],
    ),
    objectCount,
    shadowCasters: shadowCasters.length,
    sceneAssets: renderedAssets,
    textures: info.memory.textures,
    triangles: renderInfo.triangles,
    visibleNodeIds: visibleEditorSceneNodeIds(),
    framingBounds: sceneFramingBoundsStats(),
    worldBounds: sceneWorldBoundsStats(),
  };
}

function countSceneDocumentNodes(nodes) {
  return nodes.reduce(
    (count, node) => count + 1 + countSceneDocumentNodes(node.children || []),
    0,
  );
}

function sceneWorldBoundsStats() {
  const bounds = boundsForSceneObjects();
  if (!bounds) {
    return null;
  }
  const size = new Vector3();
  bounds.getSize(size);
  return {
    max: roundVec3(bounds.max.toArray()),
    min: roundVec3(bounds.min.toArray()),
    size: roundVec3(size.toArray()),
  };
}

function sceneFramingBoundsStats() {
  const bounds = boundsForSceneFramingObjects();
  if (!bounds) {
    return null;
  }
  const size = new Vector3();
  bounds.getSize(size);
  return {
    max: roundVec3(bounds.max.toArray()),
    min: roundVec3(bounds.min.toArray()),
    size: roundVec3(size.toArray()),
  };
}

function renderOrientationGizmoVisual(gizmo) {
  const element = gizmo._domElement;
  if (!(element instanceof HTMLElement)) {
    return;
  }
  const width = element.clientWidth || 112;
  const height = element.clientHeight || 112;
  const center = { x: width / 2, y: height / 2 };
  const targets = Array.isArray(gizmo.clickTargets) ? gizmo.clickTargets : [];
  const colors = {
    back: '#325fbd',
    bottom: '#3f8f59',
    front: '#63a9ff',
    left: '#9d2f2f',
    right: '#ff5d5d',
    top: '#5ee58a',
  };
  const labels = {
    back: '-Z',
    bottom: '-Y',
    front: 'Z',
    left: '-X',
    right: 'X',
    top: 'Y',
  };
  const orderedTargets = [...targets].sort((a, b) => {
    const order = {
      back: 0,
      bottom: 1,
      left: 2,
      right: 3,
      front: 4,
      top: 5,
    };
    return (order[a.view] ?? 0) - (order[b.view] ?? 0);
  });
  const axisMarkup = orderedTargets
    .map((target) => {
      const view = target.view;
      const color = colors[view] || '#ededed';
      const label = labels[view] || view;
      const isPositive = ['right', 'top', 'front'].includes(view);
      const opacity = isPositive ? 1 : 0.58;
      const radius = isPositive ? 10 : 8;
      const labelColor = view === 'top' || view === 'front' ? '#0a0a0b' : '#ffffff';
      return \`
        <line x1="\${center.x.toFixed(2)}" y1="\${center.y.toFixed(2)}" x2="\${Number(target.x).toFixed(2)}" y2="\${Number(target.y).toFixed(2)}" stroke="\${color}" stroke-width="\${isPositive ? 2.5 : 1.5}" stroke-linecap="round" opacity="\${opacity}" />
        <circle cx="\${Number(target.x).toFixed(2)}" cy="\${Number(target.y).toFixed(2)}" r="\${radius}" fill="\${color}" stroke="rgba(255,255,255,0.72)" stroke-width="1" opacity="\${opacity}" />
        <text x="\${Number(target.x).toFixed(2)}" y="\${(Number(target.y) + 3.6).toFixed(2)}" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="\${isPositive ? 10 : 8}" font-weight="800" fill="\${labelColor}" opacity="\${opacity}">\${escapeHtml(label)}</text>
      \`;
    })
    .join('');
  element.innerHTML = \`
    <svg class="orientation-gizmo-visual" viewBox="0 0 \${width} \${height}" aria-hidden="true">
      <circle cx="\${center.x}" cy="\${center.y}" r="4" fill="#ededed" opacity="0.75" />
      \${axisMarkup}
    </svg>
  \`;
}

function computeOrientationGizmoClickTargets(gizmo) {
  const element = gizmo._domElement;
  const camera = gizmo._camera;
  const axes = Array.isArray(gizmo._intersections)
    ? gizmo._intersections
    : [];
  if (!(element instanceof HTMLElement) || !camera) {
    return [];
  }
  const width = element.clientWidth || 112;
  const height = element.clientHeight || 112;
  const targetPosition = new Vector3();
  return axes
    .map((axis) => {
      const view = orientationViewFromDirection(axis.position);
      if (!view) {
        return null;
      }
      axis.updateMatrixWorld(true);
      axis.getWorldPosition(targetPosition).project(camera);
      return {
        view,
        x: ((targetPosition.x + 1) / 2) * width,
        y: ((1 - targetPosition.y) / 2) * height,
      };
    })
    .filter(Boolean);
}

function orientationViewFromDirection(direction) {
  const absX = Math.abs(direction.x);
  const absY = Math.abs(direction.y);
  const absZ = Math.abs(direction.z);
  if (absX >= absY && absX >= absZ) {
    return direction.x >= 0 ? 'right' : 'left';
  }
  if (absY >= absX && absY >= absZ) {
    return direction.y >= 0 ? 'top' : 'bottom';
  }
  return direction.z >= 0 ? 'front' : 'back';
}

function selectedNodeId() {
  const selection = window.__IWSDK_EDITOR_SELECTION || [];
  return selection.length === 1 ? selection[0] : null;
}

function selectedBuiltinTarget() {
  const target = window.__IWSDK_EDITOR_BUILTIN_SELECTION;
  return target === 'player' ? target : null;
}

function lightScaleTarget(node) {
  if (!node || node.content != null) {
    return null;
  }
  for (const [component, value] of Object.entries(node.components || {})) {
    const spec = lightSpecFromComponentValue(component, value);
    if (spec) {
      return { component, spec, value };
    }
  }
  return null;
}

function lightScaleAxisPolicy(node) {
  const target = lightScaleTarget(node);
  if (!target) return null;
  switch (target.spec.kind) {
    case 'point':
      return {
        x: target.spec.distance > 0,
        y: target.spec.distance > 0,
        z: target.spec.distance > 0,
      };
    case 'spot':
      return {
        x: true,
        y: true,
        z: target.spec.distance > 0,
      };
    case 'rect-area':
      return { x: true, y: true, z: false };
    default:
      return { x: false, y: false, z: false };
  }
}

function selectionForNodeClick(nodeId, event) {
  const currentSelection = Array.isArray(window.__IWSDK_EDITOR_SELECTION)
    ? window.__IWSDK_EDITOR_SELECTION
    : [];
  if (!event?.shiftKey && !event?.metaKey && !event?.ctrlKey) {
    return [nodeId];
  }
  if (currentSelection.includes(nodeId)) {
    return currentSelection.filter((entry) => entry !== nodeId);
  }
  return [...currentSelection, nodeId];
}

function applyTransformControlSettings() {
  if (!editorWorldState?.transformControls) {
    return;
  }
  const mode = editorWorldState.transformMode || 'translate';
  const space = editorWorldState.transformSpace || 'local';
  const transformControls = editorWorldState.transformControls;
  transformControls.setMode(mode);
  transformControls.setSpace(space);
  const nodeId = selectedNodeId();
  const node = nodeId
    ? findNodeById(editorWorldState.currentSession?.document, nodeId)
    : null;
  const lightPolicy = mode === 'scale' ? lightScaleAxisPolicy(node) : null;
  transformControls.showX = lightPolicy?.x ?? true;
  transformControls.showY = lightPolicy?.y ?? true;
  transformControls.showZ = lightPolicy?.z ?? true;
  const snap = editorWorldState.transformSnapEnabled
    ? editorWorldState.transformSnap
    : null;
  setTransformControlSnap(
    transformControls,
    'setTranslationSnap',
    'translationSnap',
    snap?.translation ?? null,
  );
  setTransformControlSnap(
    transformControls,
    'setRotationSnap',
    'rotationSnap',
    snap ? MathUtils.degToRad(snap.rotationDeg) : null,
  );
  setTransformControlSnap(
    transformControls,
    'setScaleSnap',
    'scaleSnap',
    snap?.scale ?? null,
  );
  editorWorldState.transformSnapApplied = snap
    ? {
        rotationSnapDeg: snap.rotationDeg,
        scaleSnap: snap.scale,
        translationSnap: snap.translation,
      }
    : {
        rotationSnapDeg: null,
        scaleSnap: null,
        translationSnap: null,
      };
}

function setTransformControlSnap(transformControls, method, property, value) {
  if (typeof transformControls[method] === 'function') {
    transformControls[method](value);
  } else {
    transformControls[property] = value;
  }
}

function scaleRatio(startTransform, nextTransform) {
  const start = scaleVectorFromTransform(startTransform);
  const next = scaleVectorFromTransform(nextTransform);
  return start.map((value, index) =>
    Math.max(
      0.001,
      Math.abs(value) > 1e-6 ? Math.abs(next[index] / value) : 1,
    ),
  );
}

function inferredScaleAxis(ratio) {
  const changed = ['X', 'Y', 'Z'].filter(
    (_axis, index) => Math.abs(ratio[index] - 1) > 1e-4,
  );
  if (
    changed.length === 3 &&
    Math.abs(ratio[0] - ratio[1]) < 1e-4 &&
    Math.abs(ratio[1] - ratio[2]) < 1e-4
  ) {
    return 'XYZ';
  }
  return changed.join('');
}

function combinedScaleFactor(ratio, axis) {
  const indices = ['X', 'Y', 'Z']
    .map((name, index) => (axis.includes(name) ? index : -1))
    .filter((index) => index >= 0);
  if (indices.length === 0) return 1;
  return Math.pow(
    indices.reduce((product, index) => product * ratio[index], 1),
    1 / indices.length,
  );
}

function roundedLightProperty(value) {
  return Number(value.toFixed(4));
}

function lightPropertyScaleEdit(node, startTransform, nextTransform, scaleAxis) {
  const target = lightScaleTarget(node);
  if (!target) return null;
  const ratio = scaleRatio(startTransform, nextTransform);
  const axis = scaleAxis || inferredScaleAxis(ratio);
  const value = { ...target.value };
  let changed = false;
  switch (target.spec.kind) {
    case 'point': {
      if (target.spec.distance <= 0) break;
      const factor = combinedScaleFactor(ratio, axis || 'XYZ');
      value.distance = roundedLightProperty(
        Math.max(0.001, target.spec.distance * factor),
      );
      changed = value.distance !== target.spec.distance;
      break;
    }
    case 'spot': {
      if (axis !== 'XYZ' && (axis.includes('X') || axis.includes('Y'))) {
        const radialAxis = ['X', 'Y'].filter((name) => axis.includes(name)).join('');
        const radialFactor = combinedScaleFactor(ratio, radialAxis);
        value.angleDeg = roundedLightProperty(
          MathUtils.clamp(
            MathUtils.radToDeg(
              Math.atan(
                Math.tan(MathUtils.degToRad(target.spec.angleDeg)) *
                  radialFactor,
              ),
            ),
            0.1,
            90,
          ),
        );
        changed = value.angleDeg !== target.spec.angleDeg;
      }
      if (axis.includes('Z') && target.spec.distance > 0) {
        value.distance = roundedLightProperty(
          Math.max(0.001, target.spec.distance * ratio[2]),
        );
        changed = changed || value.distance !== target.spec.distance;
      }
      break;
    }
    case 'rect-area': {
      if (axis.includes('X')) {
        value.width = roundedLightProperty(
          Math.max(0.001, target.spec.width * ratio[0]),
        );
        changed = value.width !== target.spec.width;
      }
      if (axis.includes('Y')) {
        value.height = roundedLightProperty(
          Math.max(0.001, target.spec.height * ratio[1]),
        );
        changed = changed || value.height !== target.spec.height;
      }
      break;
    }
  }
  return {
    changed,
    patch: changed
      ? {
          component: target.component,
          nodeId: node.id,
          op: 'updateComponent',
          value,
        }
      : null,
    policy: target.spec.kind,
  };
}

function renderTransformToolbar() {
  const mode = editorWorldState?.transformMode || 'translate';
  const space = editorWorldState?.transformSpace || 'local';
  const snapEnabled = Boolean(editorWorldState?.transformSnapEnabled);
  document.querySelectorAll('[data-transform-mode]').forEach((button) => {
    button.toggleAttribute(
      'data-active',
      button.getAttribute('data-transform-mode') === mode,
    );
  });
  document.querySelectorAll('[data-transform-space]').forEach((button) => {
    button.toggleAttribute(
      'data-active',
      button.getAttribute('data-transform-space') === space,
    );
  });
  document.querySelectorAll('[data-transform-snap]').forEach((button) => {
    button.toggleAttribute('data-active', snapEnabled);
  });
}

function setTransformMode(mode) {
  if (!['translate', 'rotate', 'scale'].includes(mode)) {
    return;
  }
  if (editorWorldState) {
    editorWorldState.transformMode = mode;
    applyTransformControlSettings();
    workspaceUi?.update({ transformMode: mode });
    renderEditorWorld();
  }
  renderTransformToolbar();
}

function setTransformSpace(space) {
  if (!['local', 'world'].includes(space)) {
    return;
  }
  if (editorWorldState) {
    editorWorldState.transformSpace = space;
    applyTransformControlSettings();
    renderEditorWorld();
  }
  renderTransformToolbar();
}

function transformSnapPropertyForMode(mode) {
  if (mode === 'rotate') {
    return 'rotationDeg';
  }
  if (mode === 'scale') {
    return 'scale';
  }
  return 'translation';
}

function setTransformSnapValue(mode, value, persist = true) {
  if (!editorWorldState) {
    return null;
  }
  const property = transformSnapPropertyForMode(mode);
  const nextValue = normalizeEditorTransformSnapValue(property, value);
  editorWorldState.transformSnap = {
    ...editorWorldState.transformSnap,
    [property]: nextValue,
  };
  applyTransformControlSettings();
  if (persist && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(
        EDITOR_TRANSFORM_SNAP_STORAGE_KEY,
        JSON.stringify(editorWorldState.transformSnap),
      );
    } catch {
      // The snap settings still apply when browser storage is unavailable.
    }
  }
  workspaceUi?.update({
    transformSnapRotationDeg: editorWorldState.transformSnap.rotationDeg,
    transformSnapScale: editorWorldState.transformSnap.scale,
    transformSnapTranslation: editorWorldState.transformSnap.translation,
  });
  renderEditorWorld();
  return nextValue;
}

function setTransformSnapEnabled(enabled) {
  if (editorWorldState) {
    editorWorldState.transformSnapEnabled = Boolean(enabled);
    applyTransformControlSettings();
    renderEditorWorld();
  }
  renderTransformToolbar();
}

function syncTransformControlsToSelection(session) {
  if (!editorWorldState?.transformControls) {
    return;
  }
  applyTransformControlSettings();
  const nodeId = selectedNodeId();
  const builtinTarget = selectedBuiltinTarget();
  const object = builtinTarget
    ? editorWorldState.builtInObjectMap.get(builtinTarget)
    : nodeId
      ? editorWorldState.objectMap.get(nodeId)
      : null;
  const helper = editorWorldState.transformControls.getHelper();
  if (
    !object ||
    (!builtinTarget && (!nodeId || lockedOutlinerNodeIds.has(nodeId)))
  ) {
    editorWorldState.transformControls.detach();
    editorWorldState.transformControlsAttachedNodeId = null;
    helper.visible = false;
    return;
  }
  const node = nodeId ? findNodeById(session.document, nodeId) : null;
  if (!builtinTarget && !node) {
    editorWorldState.transformControls.detach();
    editorWorldState.transformControlsAttachedNodeId = null;
    helper.visible = false;
    return;
  }
  editorWorldState.transformControls.attach(object);
  editorWorldState.transformControls.enabled = true;
  editorWorldState.transformControlsAttachedNodeId = builtinTarget
    ? 'builtin:' + builtinTarget
    : nodeId;
  helper.visible = true;
}

async function commitTransformControlDrag(session, rerender) {
  if (!editorWorldState?.transformControls || !editorWorldState.transformDragState) {
    return;
  }
  const dragState = editorWorldState.transformDragState;
  editorWorldState.transformDragState = null;
  const object = editorWorldState.transformControls.object;
  if (!object) {
    return;
  }
  if (dragState.builtinTarget) {
    const nextTransform = snapTransformForCurrentMode(
      transformFromObject(
        object,
        playerRigTransform(session.document, dragState.builtinTarget),
      ),
    );
    applyNodeTransform(object, nextTransform);
    renderEditorWorld();
    if (transformsEqual(dragState.startTransform, nextTransform)) {
      rerender();
      return;
    }
    await session.dispatch('scene_apply_patch', {
      patch: {
        op: 'updatePlayerTransform',
        target: dragState.builtinTarget,
        transform: nextTransform,
      },
    });
    clearValidationResult();
    rerender();
    return;
  }
  const node = findNodeById(session.document, dragState.nodeId);
  if (!node) {
    return;
  }
  const nextTransform = snapTransformForCurrentMode(
    transformFromObject(object, node.transform || {}),
  );
  const lightScaleEdit =
    dragState.mode === 'scale'
      ? lightPropertyScaleEdit(
          node,
          dragState.startTransform,
          nextTransform,
          dragState.scaleAxis,
        )
      : null;
  if (lightScaleEdit) {
    applyNodeTransform(object, dragState.startTransform);
    updateSelectionHelpers();
    renderEditorWorld();
    if (lightScaleEdit.patch) {
      await session.dispatch('scene_apply_patch', {
        patch: lightScaleEdit.patch,
      });
      clearValidationResult();
    }
    rerender();
    return;
  }
  applyNodeTransform(object, nextTransform);
  updateSelectionHelpers();
  renderEditorWorld();
  if (transformsEqual(dragState.startTransform, nextTransform)) {
    rerender();
    return;
  }
  await session.dispatch('scene_set_transform', {
    nodeId: dragState.nodeId,
    transform: nextTransform,
  });
  clearValidationResult();
  rerender();
}

function cancelTransformControlDrag(session) {
  if (!editorWorldState?.transformControls || !editorWorldState.transformDragState) {
    return false;
  }
  const dragState = editorWorldState.transformDragState;
  const object = editorWorldState.transformControls.object;
  editorWorldState.transformDragState = null;
  editorWorldState.orbitControls.enabled = true;
  if (!object) {
    return true;
  }
  applyNodeTransform(object, dragState.startTransform);
  updateSelectionHelpers();
  renderEditorWorld();
  if (session) {
    updateProjectedHitTargets(session);
  }
  return true;
}

function eventHitsTransformControls(canvas, event) {
  if (
    !editorWorldState?.transformControls ||
    !editorWorldState.transformControls.object ||
    !editorWorldState.transformControls.enabled
  ) {
    return false;
  }
  const rect = canvas.getBoundingClientRect();
  editorWorldState.pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  editorWorldState.transformControls.pointerHover(editorWorldState.pointer);
  return Boolean(editorWorldState.transformControls.axis);
}

function findTransformControlPointerTarget(axis = 'X') {
  if (
    !editorWorldState?.transformControls ||
    !editorWorldState.transformControls.object
  ) {
    throw new Error('Transform controls are not attached to an object');
  }
  const canvas = getCanvas();
  const rect = canvas.getBoundingClientRect();
  const center = new Vector3();
  editorWorldState.transformControls.object.getWorldPosition(center);
  center.project(editorWorldState.world.camera);
  const centerX = ((center.x + 1) / 2) * canvas.width;
  const centerY = ((1 - center.y) / 2) * canvas.height;
  const step = 5;
  const radius = 150;
  for (let offsetRadius = 0; offsetRadius <= radius; offsetRadius += step) {
    for (let y = centerY - offsetRadius; y <= centerY + offsetRadius; y += step) {
      for (let x = centerX - offsetRadius; x <= centerX + offsetRadius; x += step) {
        if (
          x < 0 ||
          y < 0 ||
          x > canvas.width ||
          y > canvas.height ||
          Math.abs(x - centerX) !== offsetRadius &&
            Math.abs(y - centerY) !== offsetRadius
        ) {
          continue;
        }
        editorWorldState.pointer.set(
          (x / canvas.width) * 2 - 1,
          -(y / canvas.height) * 2 + 1,
        );
        editorWorldState.transformControls.pointerHover(
          editorWorldState.pointer,
        );
        const hitAxis = editorWorldState.transformControls.axis;
        if (hitAxis === axis || hitAxis?.startsWith(axis)) {
          return {
            axis: hitAxis,
            canvasX: x,
            canvasY: y,
            x: rect.left + (x / canvas.width) * rect.width,
            y: rect.top + (y / canvas.height) * rect.height,
          };
        }
      }
    }
  }
  throw new Error(\`Could not find transform control target for axis "\${axis}"\`);
}

function updateProjectedHitTargets(session) {
  if (!editorWorldState) {
    window.__IWSDK_EDITOR_NODE_HITS = [];
    return;
  }
  const canvas = getCanvas();
  const hits = [];
  const center = new Vector3();
  for (const [id, object] of editorWorldState.objectMap.entries()) {
    object.updateMatrixWorld(true);
    new Box3().setFromObject(object).getCenter(center);
    const projected = center.clone().project(editorWorldState.world.camera);
    hits.push({
      id,
      radius: 18,
      x: ((projected.x + 1) / 2) * canvas.width,
      y: ((1 - projected.y) / 2) * canvas.height,
    });
  }
  window.__IWSDK_EDITOR_NODE_HITS = hits;
}

function syncEditorWorld(session, camera, size = {}) {
  if (!editorWorldState) {
    return;
  }
  editorWorldState.currentCamera = camera;
  editorWorldState.currentSession = session;
  resizeEditorRenderer(size, camera);
  applyEditorCamera(camera);
  void scheduleEditorSceneLowering(session).catch(() => {});
  rebuildSelectionHelpers();
  syncTransformControlsToSelection(session);
  updateHoverHelper(session, editorWorldState.hoveredNodeId);
  editorWorldState.world.renderer.clear(true, true, true);
  renderEditorWorld();
  updateProjectedHitTargets(session);
}

function normalizeEditorDrawDistance(value) {
  if (value == null || value === '') {
    return DEFAULT_EDITOR_DRAW_DISTANCE;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_EDITOR_DRAW_DISTANCE;
  }
  return Math.round(
    MathUtils.clamp(
      numeric,
      MIN_EDITOR_DRAW_DISTANCE,
      MAX_EDITOR_DRAW_DISTANCE,
    ),
  );
}

function loadEditorDrawDistance() {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_EDITOR_DRAW_DISTANCE;
  }
  try {
    return normalizeEditorDrawDistance(
      localStorage.getItem(EDITOR_DRAW_DISTANCE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_EDITOR_DRAW_DISTANCE;
  }
}

function normalizeEditorTransformSnapValue(property, value) {
  const fallback = DEFAULT_EDITOR_TRANSFORM_SNAP[property];
  const limits = EDITOR_TRANSFORM_SNAP_LIMITS[property];
  const numeric = Number(value);
  if (!limits || !Number.isFinite(numeric)) {
    return fallback;
  }
  return Number(
    MathUtils.clamp(numeric, limits.min, limits.max).toFixed(6),
  );
}

function normalizeEditorTransformSnap(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  return {
    rotationDeg: normalizeEditorTransformSnapValue(
      'rotationDeg',
      candidate.rotationDeg,
    ),
    scale: normalizeEditorTransformSnapValue('scale', candidate.scale),
    translation: normalizeEditorTransformSnapValue(
      'translation',
      candidate.translation,
    ),
  };
}

function loadEditorTransformSnap() {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_EDITOR_TRANSFORM_SNAP };
  }
  try {
    const stored = localStorage.getItem(EDITOR_TRANSFORM_SNAP_STORAGE_KEY);
    return normalizeEditorTransformSnap(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_EDITOR_TRANSFORM_SNAP };
  }
}

function createInfiniteEditorGrid(drawDistance) {
  const material = new ShaderMaterial({
    depthTest: true,
    depthWrite: false,
    extensions: { derivatives: true },
    fragmentShader:
      'varying vec3 gridWorldPosition; ' +
      'uniform float drawDistance; ' +
      'uniform float minimumGridSpacing; ' +
      'uniform bool perspectiveView; ' +
      'float gridLine(vec2 position, float scale) { ' +
      '  vec2 coordinate = position / scale; ' +
      '  vec2 width = max(fwidth(coordinate), vec2(0.0001)); ' +
      '  vec2 lineDistance = abs(fract(coordinate - 0.5) - 0.5) / width; ' +
      '  return 1.0 - min(min(lineDistance.x, lineDistance.y), 1.0); ' +
      '} ' +
      'void main() { ' +
      '  vec2 gridPosition = gridWorldPosition.xz; ' +
      '  float pixelWorldSize = max(length(fwidth(gridPosition)), 0.0001); ' +
      '  float level = log(max((pixelWorldSize * 10.0) / minimumGridSpacing, 1.0)) / log(10.0); ' +
      '  float gridScale = minimumGridSpacing * pow(10.0, floor(level)); ' +
      '  float levelBlend = fract(level); ' +
      '  float fineLine = gridLine(gridPosition, gridScale); ' +
      '  float middleLine = gridLine(gridPosition, gridScale * 10.0); ' +
      '  float coarseLine = gridLine(gridPosition, gridScale * 100.0); ' +
      '  float fineAlpha = fineLine * (1.0 - levelBlend) * 0.22; ' +
      '  float middleAlpha = middleLine * mix(0.48, 0.22, levelBlend); ' +
      '  float coarseAlpha = coarseLine * levelBlend * 0.48; ' +
      '  float gridAlpha = max(fineAlpha, max(middleAlpha, coarseAlpha)); ' +
      '  float xAxis = 1.0 - smoothstep(0.0, max(fwidth(gridWorldPosition.z) * 1.5, 0.0001), abs(gridWorldPosition.z)); ' +
      '  float zAxis = 1.0 - smoothstep(0.0, max(fwidth(gridWorldPosition.x) * 1.5, 0.0001), abs(gridWorldPosition.x)); ' +
      '  vec3 color = vec3(0.24, 0.29, 0.32); ' +
      '  color = mix(color, vec3(0.63, 0.20, 0.19), xAxis); ' +
      '  color = mix(color, vec3(0.28, 0.53, 0.16), zAxis); ' +
      '  float alpha = max(gridAlpha, max(xAxis, zAxis) * 0.78); ' +
      '  float cameraDistance = length(cameraPosition - gridWorldPosition); ' +
      '  float distanceFade = 1.0 - smoothstep(drawDistance * 0.5, drawDistance, cameraDistance); ' +
      '  if (perspectiveView) { ' +
      '    vec3 viewDirection = normalize(cameraPosition - gridWorldPosition); ' +
      '    float angleFade = 1.0 - pow(1.0 - abs(viewDirection.y), 3.0); ' +
      '    distanceFade *= angleFade; ' +
      '  } ' +
      '  alpha *= distanceFade; ' +
      '  if (alpha < 0.003) discard; ' +
      '  gl_FragColor = vec4(color, alpha); ' +
      '}',
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    transparent: true,
    uniforms: {
      drawDistance: { value: drawDistance },
      minimumGridSpacing: { value: MIN_EDITOR_GRID_SPACING },
      perspectiveView: { value: true },
    },
    vertexShader:
      'varying vec3 gridWorldPosition; ' +
      'void main() { ' +
      '  vec4 worldPosition = modelMatrix * vec4(position, 1.0); ' +
      '  gridWorldPosition = worldPosition.xyz; ' +
      '  gl_Position = projectionMatrix * viewMatrix * worldPosition; ' +
      '}',
  });
  const grid = new Mesh(new PlaneGeometry(2, 2), material);
  grid.name = 'IWSDKSceneEditorGrid';
  grid.rotation.x = -Math.PI / 2;
  grid.scale.set(drawDistance, drawDistance, 1);
  grid.frustumCulled = false;
  grid.renderOrder = -1;
  grid.userData.iwsdkEditorHelper = true;
  grid.userData.iwsdkEditorInfiniteGrid = true;
  return grid;
}

function syncInfiniteEditorGrid() {
  if (!editorWorldState?.editorGrid) {
    return;
  }
  const camera = editorWorldState.world.camera;
  const grid = editorWorldState.editorGrid;
  const drawDistance = editorWorldState.drawDistance;
  grid.position.set(camera.position.x, 0, camera.position.z);
  grid.scale.set(drawDistance, drawDistance, 1);
  grid.material.uniforms.drawDistance.value = drawDistance;
  grid.material.uniforms.perspectiveView.value =
    camera.isPerspectiveCamera === true;
  grid.updateMatrixWorld(true);
}

function setEditorDrawDistance(value, persist = true) {
  const drawDistance = normalizeEditorDrawDistance(value);
  if (!editorWorldState) {
    return drawDistance;
  }
  editorWorldState.drawDistance = drawDistance;
  for (const camera of [
    editorWorldState.perspectiveCamera,
    editorWorldState.orthographicCamera,
  ]) {
    camera.far = drawDistance;
    camera.updateProjectionMatrix();
  }
  if (persist && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(
        EDITOR_DRAW_DISTANCE_STORAGE_KEY,
        String(drawDistance),
      );
    } catch {
      // The viewport setting still applies when browser storage is unavailable.
    }
  }
  syncInfiniteEditorGrid();
  workspaceUi?.update({ viewportDrawDistance: drawDistance });
  renderEditorWorld();
  return drawDistance;
}

async function createEditorWorld(session, camera) {
  const host = getViewportHost();
  const editorRuntime = window.FRAMEWORK_MCP_RUNTIME;
  const world = await World.create(host, {
    assets: editorAssetManifest,
    components: editorComponentManifest.componentRegistry
      ? editorComponentManifest
      : undefined,
    features: {
      camera: false,
      environmentRaycast: false,
      grabbing: false,
      locomotion: false,
      physics: false,
      sceneUnderstanding: false,
      spatialUI: false,
    },
    render: {
      camera: {
        lookAt: camera.lookAt,
        position: camera.position,
      },
      fov: camera.fov,
    },
    xr: false,
  });
  // The editor renders on demand and must not compete with the runtime viewport.
  world.renderer.setAnimationLoop(null);
  window.FRAMEWORK_MCP_RUNTIME = editorRuntime;
  const canvas = world.renderer.domElement;
  canvas.id = 'scene-canvas';
  canvas.dataset.renderer = 'iwsdk-webgl';
  canvas.style.height = '100%';
  canvas.style.width = '100%';
  canvas.setAttribute('aria-label', 'IWSDK 3D scene viewport');
  world.renderer.setClearColor(0x101418, 1);

  const drawDistance = loadEditorDrawDistance();
  const transformSnap = loadEditorTransformSnap();
  const perspectiveCamera = world.camera;
  perspectiveCamera.far = drawDistance;
  perspectiveCamera.updateProjectionMatrix();
  const orthographicCamera = new OrthographicCamera(
    -1,
    1,
    1,
    -1,
    perspectiveCamera.near,
    perspectiveCamera.far,
  );

  const orbitControls = new OrbitControls(world.camera, canvas);
  orbitControls.enableDamping = false;
  orbitControls.enablePan = true;
  orbitControls.enableRotate = true;
  orbitControls.enableZoom = true;
  orbitControls.screenSpacePanning = false;
  orbitControls.target.set(
    camera.lookAt?.[0] ?? 0,
    camera.lookAt?.[1] ?? 0,
    camera.lookAt?.[2] ?? 0,
  );
  orbitControls.update();

  const transformControls = new TransformControls(world.camera, canvas);
  transformControls.size = 0.85;
  transformControls.setMode('translate');
  transformControls.setSpace('local');
  const transformHelper = transformControls.getHelper();
  transformHelper.name = 'IWSDKSceneEditorTransformControls';
  transformHelper.userData.iwsdkEditorHelper = true;
  transformHelper.visible = false;
  world.scene.add(transformHelper);

  const proxyRoot = new Group();
  proxyRoot.name = 'IWSDKSceneEditorProxyRoot';
  proxyRoot.userData.iwsdkEditorProxyRoot = true;
  world.scene.add(proxyRoot);
  const { builtInObjectMap, levelRootProxy } =
    createEditorBuiltinRig(proxyRoot);

  const grid = createInfiniteEditorGrid(drawDistance);
  world.scene.add(grid);
  const ambient = new AmbientLight(0xffffff, 0.65);
  ambient.name = 'IWSDKSceneEditorAmbientLight';
  ambient.userData.iwsdkEditorHelper = true;
  world.scene.add(ambient);
  const directional = new DirectionalLight(0xffffff, 1.2);
  directional.name = 'IWSDKSceneEditorKeyLight';
  directional.position.set(4, 8, 5);
  directional.userData.iwsdkEditorHelper = true;
  world.scene.add(directional);

  editorWorldState = {
    appliedRootComponentNames: new Set(),
    assetProof: new Map(),
    builtInObjectMap,
    currentCamera: camera,
    currentDocumentValue: null,
    currentSession: session,
    drawDistance,
    editorAmbient: ambient,
    editorDirectional: directional,
    editorGrid: grid,
    environmentBindings: new Map(),
    environmentPreviousState: null,
    frameTimeSamples: [],
    host,
    hoveredNodeId: null,
    hoverHelper: null,
    lensLayerMasks: new Map(),
    lensMaterials: new Map(),
    lensVisibility: new Map(),
    levelRootProxy,
    lightBindings: new Map(),
    lowerGeneration: 0,
    loweredDocumentKey: null,
    loweredNodes: [],
    lowerPromise: null,
    neutralMaterial: null,
    nextMaterializationFailure: null,
    objectMap: new Map(),
    orthographicCamera,
    orbitControls,
    perspectiveCamera,
    proxyRoot,
    raycaster: new Raycaster(),
    raycastCount: 0,
    requestRender: () => {
      if (editorWorldState?.currentSession) {
        renderCanvas(
          editorWorldState.currentSession,
          editorWorldState.currentCamera,
        );
      }
    },
    renderEditorOverlays: true,
    renderOnlyCaptureDepth: 0,
    renderOnlyHelperVisibility: null,
    renderOnlyTrackedHelpers: null,
    renderOnlyPreviousOverlayState: true,
    pointer: new Vector2(),
    pendingDocumentKey: null,
    previewGhostMaterials: [],
    previewVisibilityBaseline: new Map(),
    stagedPreview: null,
    transformControlsAttachedNodeId: null,
    transformControls,
    transformDragState: null,
    transformHelper,
    transformMode: 'translate',
    transformSnap,
    transformSnapApplied: {
      rotationSnapDeg: null,
      scaleSnap: null,
      translationSnap: null,
    },
    transformSnapEnabled: false,
    transformSpace: 'local',
    world,
  };
  applyEditorBuiltinRigTransforms(session.document);
  loadVisibilityArrangements();
  transformControls.addEventListener('mouseDown', () => {
    const nodeId = selectedNodeId();
    const node = nodeId ? findNodeById(session.document, nodeId) : null;
    const builtinTarget = selectedBuiltinTarget();
    editorWorldState.transformDragState = builtinTarget
      ? {
          builtinTarget,
          startTransform: cloneTransform(
            playerRigTransform(session.document, builtinTarget),
          ),
        }
      : nodeId && node
        ? {
            nodeId,
            mode: editorWorldState.transformMode,
            scaleAxis: transformControls.axis,
            startTransform: cloneTransform(node.transform || {}),
          }
        : null;
    orbitControls.enabled = false;
  });
  transformControls.addEventListener('mouseUp', () => {
    orbitControls.enabled = true;
    commitTransformControlDrag(session, () =>
      renderUi(session, editorWorldState.currentCamera),
    ).catch((error) => {
      console.error('[IWSDK Scene Editor] Transform commit failed:', error);
      renderUi(session, editorWorldState.currentCamera);
    });
  });
  transformControls.addEventListener('objectChange', () => {
    updateSelectionHelpers();
    renderEditorWorld();
    updateProjectedHitTargets(session);
  });
  transformControls.addEventListener('change', () => {
    updateSelectionHelpers();
    renderEditorWorld();
  });
  orbitControls.addEventListener('change', () => {
    if (editorWorldState.suppressOrbitChange) {
      return;
    }
    updateCameraStateFromWorld(editorWorldState.currentCamera);
    renderEditorWorld();
    if (editorWorldState.currentSession) {
      updateProjectedHitTargets(editorWorldState.currentSession);
    }
  });
  editorWorldState.orientationGizmo = createOrientationGizmo(session);
  syncEditorWorld(session, camera);
  await waitForAssetLoads();
}

function editorResourceStateProof() {
  if (!editorWorldState) {
    return { proof: [], staged: null };
  }
  const summarizeProof = (proof) =>
    [...proof.values()].sort((first, second) =>
      first.assetId.localeCompare(second.assetId),
    );
  const staged = editorWorldState.stagedPreview;
  return {
    proof: summarizeProof(editorWorldState.assetProof),
    staged: staged
      ? {
          key: staged.key,
          lowered: Array.isArray(staged.lowered),
          proof: summarizeProof(staged.assetProof),
        }
      : null,
  };
}

function authoredRenderStateProof() {
  if (!editorWorldState) {
    return null;
  }
  const materials = new Map();
  const lights = [];
  editorWorldState.proxyRoot.traverse((object) => {
    if (object.isMesh === true) {
      const entries = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of entries) {
        const id = material?.userData?.iwsdkSceneMaterialId;
        if (!id || materials.has(id)) {
          continue;
        }
        const textures = [];
        for (const property of [
          'map',
          'emissiveMap',
          'roughnessMap',
          'metalnessMap',
          'aoMap',
          'alphaMap',
          'normalMap',
          'bumpMap',
        ]) {
          const texture = material[property];
          const metadata = texture?.userData?.iwsdkSceneProceduralTexture;
          if (metadata) {
            textures.push({ ...metadata, property, uuid: texture.uuid });
          }
        }
        materials.set(id, {
          id,
          model: material.userData.iwsdkSceneMaterialModel,
          textures,
          type: material.type,
          uuid: material.uuid,
        });
      }
    }
  });
  editorWorldState.world.scene.traverse((object) => {
    if (
      object.isLight === true &&
      typeof object.userData?.iwsdkLightComponent === 'string'
    ) {
      lights.push({
        castShadow: object.castShadow === true,
        color: object.color?.getHexString
          ? '#' + object.color.getHexString()
          : null,
        intensity: object.intensity,
        nodeId: object.userData.iwsdkSceneNodeId,
        type: object.userData.iwsdkLightComponent,
        uuid: object.uuid,
      });
    }
  });
  const background = editorWorldState.world.scene.background;
  const imageBasedLighting = editorWorldState.world.scene.environment;
  let domeGradient = null;
  editorWorldState.world.scene.traverse((object) => {
    if (object.userData?.iwsdkSceneDomeGradient != null) {
      domeGradient = object.userData.iwsdkSceneDomeGradient;
    }
  });
  return {
    background:
      background?.userData?.iwsdkSceneGradientBackground == null
        ? null
        : {
            spec: background.userData.iwsdkSceneGradientBackground,
            uuid: background.uuid,
          },
    domeGradient,
    imageBasedLighting:
      imageBasedLighting?.userData?.iwsdkSceneImageBasedLighting == null &&
      imageBasedLighting?.userData?.iwsdkSceneIBLGradient == null
        ? null
        : {
            spec:
              imageBasedLighting.userData.iwsdkSceneImageBasedLighting ||
              imageBasedLighting.userData.iwsdkSceneIBLGradient,
            uuid: imageBasedLighting.uuid,
          },
    lights,
    materials: [...materials.values()],
    shadowMapType: editorWorldState.world.renderer.shadowMap.type,
  };
}

function rendererGlobalsProof() {
  if (!editorWorldState) {
    return null;
  }
  const renderer = editorWorldState.world.renderer;
  const scene = editorWorldState.world.scene;
  const clearColor = new Color();
  renderer.getClearColor(clearColor);
  const background = scene.background;
  const fog = scene.fog;
  return {
    background:
      background?.isColor === true
        ? { color: '#' + background.getHexString(), type: 'color' }
        : background == null
          ? null
          : { type: background.type || background.constructor?.name || 'object' },
    clearAlpha: renderer.getClearAlpha(),
    clearColor: '#' + clearColor.getHexString(),
    exposure: renderer.toneMappingExposure,
    fog:
      fog == null
        ? null
        : {
            color: fog.color ? '#' + fog.color.getHexString() : null,
            density: fog.density ?? null,
            far: fog.far ?? null,
            near: fog.near ?? null,
            type: fog.type || fog.constructor?.name || 'fog',
          },
    shadows: renderer.shadowMap.enabled,
    toneMapping: renderer.toneMapping,
  };
}

function createViewportProof() {
  if (!editorWorldState) {
    return {
      layout: createLayoutProof(),
      renderer: 'none',
      uses2DRenderer: false,
      webgl: false,
      worldReady: false,
    };
  }
  const canvas = getCanvas();
  const context =
    canvas.getContext('webgl2') ||
    canvas.getContext('webgl') ||
    canvas.getContext('experimental-webgl');
  let meshCount = 0;
  let materialCount = 0;
  editorWorldState.proxyRoot.traverse((object) => {
    if (object.isMesh === true) {
      meshCount += 1;
      materialCount += Array.isArray(object.material)
        ? object.material.length
        : 1;
    }
  });
  return {
    assetLoads: [...editorWorldState.assetProof.values()],
    builtInObjects: [...editorWorldState.builtInObjectMap.entries()].map(
      ([target, object]) => {
        let meshCount = 0;
        let wireframeMaterialCount = 0;
        const materialOpacities = [];
        object.traverse((entry) => {
          if (entry.isMesh !== true) return;
          meshCount += 1;
          if (
            entry.userData?.iwsdkEditorHelper !== true ||
            entry.userData?.iwsdkBuiltinTarget !== target
          ) {
            return;
          }
          const materials = Array.isArray(entry.material)
            ? entry.material
            : [entry.material];
          for (const material of materials) {
            if (material?.wireframe === true) wireframeMaterialCount += 1;
            if (Number.isFinite(material?.opacity)) {
              materialOpacities.push(material.opacity);
            }
          }
        });
        return {
          materialOpacity:
            materialOpacities.length > 0
              ? Math.max(...materialOpacities)
              : null,
          meshCount,
          target,
          transform: objectTransformProof(object),
          wireframeMaterialCount,
        };
      },
    ),
    canvasHeight: canvas.height,
    canvasWidth: canvas.width,
    cameraHeight: editorWorldState.currentCamera?.height ?? null,
    cameraLookAt: editorWorldState.currentCamera?.lookAt ?? null,
    cameraPosition: editorWorldState.currentCamera?.position ?? null,
    cameraProjection:
      editorWorldState.currentCamera?.projection ?? 'perspective',
    cameraViewId: editorWorldState.currentCamera?.viewId ?? null,
    contributions: editorContributionProof(),
    documentHash: editorWorldState.currentSession
      ? hashSceneDocument(editorWorldState.currentSession.document)
      : null,
    layout: createLayoutProof(),
    materialCount,
    meshCount,
    editorGrid: {
      cameraAnchored:
        editorWorldState.editorGrid.position.x ===
          editorWorldState.world.camera.position.x &&
        editorWorldState.editorGrid.position.z ===
          editorWorldState.world.camera.position.z,
      drawDistance: editorWorldState.drawDistance,
      fadeEnd: editorWorldState.drawDistance,
      fadeStart: editorWorldState.drawDistance * 0.5,
      followsCamera: true,
      geometry: editorWorldState.editorGrid.geometry.type,
      material: editorWorldState.editorGrid.material.type,
      minimumSpacing:
        editorWorldState.editorGrid.material.uniforms.minimumGridSpacing.value,
      planeSize: editorWorldState.drawDistance * 2,
      position: roundCameraVec3(editorWorldState.editorGrid.position),
      seamlessLod:
        editorWorldState.editorGrid.material.fragmentShader.includes(
          'middleLine * mix(0.48, 0.22, levelBlend)',
        ) &&
        editorWorldState.editorGrid.material.fragmentShader.includes(
          'coarseLine * levelBlend * 0.48',
        ),
      shaderFade:
        editorWorldState.editorGrid.material.fragmentShader.includes(
          'smoothstep(drawDistance * 0.5, drawDistance, cameraDistance)',
        ),
    },
    nodeObjectCount: editorWorldState.objectMap.size,
    objectHierarchy: objectHierarchyProof(),
    orbitControls: Boolean(editorWorldState.orbitControls),
    orientationGizmo: editorWorldState.orientationGizmo
      ? {
          animating: editorWorldState.orientationGizmo.animating === true,
          axisCount:
            editorWorldState.orientationGizmo._intersections?.length ?? 0,
          clickTargets: editorWorldState.orientationGizmo.clickTargets,
          draggable: true,
          renderer: 'shared-webgl',
          widget: elementLayout('#orientation-gizmo .orientation-gizmo-widget'),
          webgl: Boolean(
            editorWorldState.world.renderer.domElement.getContext('webgl2') ||
              editorWorldState.world.renderer.domElement.getContext('webgl'),
          ),
        }
      : null,
    renderer: canvas.dataset.renderer || 'unknown',
    rendererCamera: {
      far: editorWorldState.world.camera.far,
      isOrthographicCamera:
        editorWorldState.world.camera.isOrthographicCamera === true,
      isPerspectiveCamera:
        editorWorldState.world.camera.isPerspectiveCamera === true,
      near: editorWorldState.world.camera.near,
      type: editorWorldState.world.camera.type,
    },
    renderStats: currentEditorRenderStats(),
    referenceMode: window.__IWSDK_EDITOR_REFERENCE_MODE || 'hidden',
    rendererGlobals: rendererGlobalsProof(),
    resourceState: editorResourceStateProof(),
    reviewLens: window.__IWSDK_EDITOR_REVIEW_LENS || 'final',
    runtimeHash: editorWorldState.currentSession
      ? hashRuntimeSceneDocument(editorWorldState.currentSession.document)
      : null,
    hoverBounds: hoverBoundsProof(),
    selectionBounds: selectionBoundsProof(),
    selectedRuntime: selectedRuntimeSummaryProof(),
    transformControls: editorWorldState.transformControls
      ? {
          attachedNodeId: editorWorldState.transformControlsAttachedNodeId || null,
          mode: editorWorldState.transformControls.mode,
          snapping: {
            applied: editorWorldState.transformSnapApplied || {
              rotationSnapDeg: null,
              scaleSnap: null,
              translationSnap: null,
            },
            enabled: Boolean(editorWorldState.transformSnapEnabled),
            rotationDeg: editorWorldState.transformSnap?.rotationDeg ?? null,
            scale: editorWorldState.transformSnap?.scale ?? null,
            translation: editorWorldState.transformSnap?.translation ?? null,
          },
          dragging: Boolean(editorWorldState.transformDragState),
          space: editorWorldState.transformControls.space,
          visible: Boolean(
            editorWorldState.transformControls.getHelper().visible &&
              editorWorldState.transformControls.object,
          ),
        }
      : null,
    uses2DRenderer: false,
    webgl: Boolean(context),
    webglContextType: context
      ? context.constructor?.name || 'WebGLRenderingContext'
      : null,
    worldReady: Boolean(editorWorldState.world),
  };
}

function createLayoutProof() {
  return {
    canvas: elementLayout('#scene-canvas'),
    bottomPanel: elementLayout('#editor-bottom-panel'),
    contributionSlots: Object.fromEntries(
      EDITOR_CONTRIBUTION_SLOTS.map((slot) => [
        slot,
        elementLayout('[data-editor-slot="' + slot + '"]'),
      ]),
    ),
    leftPanel: elementLayout('[data-editor-panel="composition"]'),
    orientationGizmo: elementLayout('#orientation-gizmo'),
    rightPanel: elementLayout('[data-editor-panel="inspector"]'),
    statusStrip: elementLayout('#editor-status-strip'),
    toolbar: elementLayout('.editor-toolbar'),
    viewport: elementLayout('#scene-viewport'),
    window: {
      height: window.innerHeight,
      width: window.innerWidth,
    },
  };
}

function elementLayout(selector) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return {
    bottom: Number(rect.bottom.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
    left: Number(rect.left.toFixed(2)),
    pointerEvents: style.pointerEvents,
    position: style.position,
    resize: style.resize,
    right: Number(rect.right.toFixed(2)),
    top: Number(rect.top.toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    zIndex: style.zIndex,
  };
}

function nodesInDocument(documentValue) {
  const nodes = [];
  const visit = (items) => {
    for (const node of items || []) {
      nodes.push(node);
      visit(node.children || []);
    }
  };
  visit(documentValue.nodes || []);
  return nodes;
}

function findNodeById(documentValue, nodeId) {
  return nodesInDocument(documentValue).find((node) => node.id === nodeId);
}

function nodeHasDescendant(node, nodeId) {
  for (const child of node.children || []) {
    if (child.id === nodeId || nodeHasDescendant(child, nodeId)) {
      return true;
    }
  }
  return false;
}

function findNodeHierarchyInfo(documentValue, nodeId) {
  const visit = (items, parentId, depth) => {
    for (let index = 0; index < (items || []).length; index += 1) {
      const node = items[index];
      if (node.id === nodeId) {
        return {
          depth,
          index,
          node,
          parentId,
          playerTarget:
            parentId == null ? node.parent?.target || null : null,
          siblings: items,
        };
      }
      const childResult = visit(node.children || [], node.id, depth + 1);
      if (childResult) {
        return childResult;
      }
    }
    return null;
  };
  return visit(documentValue.nodes || [], null, 0);
}

function previewVisibilityStorageKey(scenePath = currentScenePath()) {
  return scenePath ? 'iwsdk-editor-visibility:' + scenePath : null;
}

function loadVisibilityArrangements() {
  const scenePath = currentScenePath();
  if (visibilityArrangementScenePath === scenePath) {
    return;
  }
  visibilityArrangementScenePath = scenePath;
  visibilityArrangements = new Map();
  const storageKey = previewVisibilityStorageKey(scenePath);
  if (!storageKey || typeof localStorage === 'undefined') {
    return;
  }
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
    for (const [name, state] of Object.entries(value)) {
      if (state && typeof state === 'object' && !Array.isArray(state)) {
        visibilityArrangements.set(name, state);
      }
    }
  } catch {
    visibilityArrangements = new Map();
  }
}

function currentPreviewVisibilityState() {
  return {
    contextNodeIds: [...previewContextNodeIds].sort(),
    ghostedNodeIds: [...ghostedOutlinerNodeIds].sort(),
    hiddenNodeIds: [...hiddenOutlinerNodeIds].sort(),
    lockedNodeIds: [...lockedOutlinerNodeIds].sort(),
    soloNodeId: soloOutlinerNodeId,
  };
}

function persistVisibilityArrangements() {
  const storageKey = previewVisibilityStorageKey();
  if (!storageKey || typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(
    storageKey,
    JSON.stringify(Object.fromEntries(visibilityArrangements)),
  );
}

function replaceSetContents(target, values) {
  target.clear();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value === 'string') {
      target.add(value);
    }
  }
}

function restorePreviewVisibilityArrangement(state) {
  replaceSetContents(hiddenOutlinerNodeIds, state?.hiddenNodeIds);
  replaceSetContents(ghostedOutlinerNodeIds, state?.ghostedNodeIds);
  replaceSetContents(lockedOutlinerNodeIds, state?.lockedNodeIds);
  replaceSetContents(previewContextNodeIds, state?.contextNodeIds);
  soloOutlinerNodeId =
    typeof state?.soloNodeId === 'string' ? state.soloNodeId : null;
}

function resetPreviewVisibilityState() {
  hiddenOutlinerNodeIds.clear();
  ghostedOutlinerNodeIds.clear();
  lockedOutlinerNodeIds.clear();
  previewContextNodeIds.clear();
  soloOutlinerNodeId = null;
}

function nodeOrAncestorMatches(documentValue, nodeId, ids) {
  let info = findNodeHierarchyInfo(documentValue, nodeId);
  while (info) {
    if (ids.has(info.node.id)) {
      return true;
    }
    info = info.parentId
      ? findNodeHierarchyInfo(documentValue, info.parentId)
      : null;
  }
  return false;
}

function nodeContainsNode(documentValue, ancestorId, nodeId) {
  if (ancestorId === nodeId) {
    return true;
  }
  const ancestor = findNodeById(documentValue, ancestorId);
  return Boolean(ancestor && nodeHasDescendant(ancestor, nodeId));
}

function nodeIsPreviewContext(node) {
  if (!node) {
    return false;
  }
  if (
    previewContextNodeIds.has(node.id) ||
    node.framingRole === 'support' ||
    nodeHasLightComponent(node)
  ) {
    return true;
  }
  const label = [node.id, node.name].filter(Boolean).join(' ').toLowerCase();
  return /\\b(room|shell|stage|background|floor|ground|wall|ceiling|lighting)\\b/.test(
    label,
  );
}

function nodeOrAncestorIsPreviewContext(documentValue, node) {
  let current = node;
  while (current) {
    if (nodeIsPreviewContext(current)) {
      return true;
    }
    const info = findNodeHierarchyInfo(documentValue, current.id);
    current = info?.parentId
      ? findNodeById(documentValue, info.parentId)
      : null;
  }
  return false;
}

function nodeIsInSoloContext(documentValue, node) {
  if (!soloOutlinerNodeId) {
    return true;
  }
  return (
    nodeContainsNode(documentValue, soloOutlinerNodeId, node.id) ||
    nodeContainsNode(documentValue, node.id, soloOutlinerNodeId) ||
    nodeOrAncestorIsPreviewContext(documentValue, node)
  );
}

function restoreEditorPreviewVisibility() {
  if (!editorWorldState) {
    return;
  }
  for (const [object, visible] of
    editorWorldState.previewVisibilityBaseline || []) {
    object.visible = visible;
  }
  editorWorldState.previewVisibilityBaseline = new Map();
  for (const entry of editorWorldState.previewGhostMaterials || []) {
    entry.mesh.material = entry.original;
    for (const material of entry.clones) {
      material.dispose?.();
    }
  }
  editorWorldState.previewGhostMaterials = [];
}

function ghostObjectMaterials(object) {
  if (!editorWorldState || !object) {
    return;
  }
  object.traverse((child) => {
    if (!child.isMesh || child.userData?.iwsdkEditorHelper === true) {
      return;
    }
    const original = child.material;
    const originals = Array.isArray(original) ? original : [original];
    const clones = originals.filter(Boolean).map((material) => {
      const clone = material.clone();
      clone.transparent = true;
      clone.opacity = Math.min(Number(material.opacity ?? 1), 0.18);
      clone.depthWrite = false;
      return clone;
    });
    if (clones.length === 0) {
      return;
    }
    child.material = Array.isArray(original) ? clones : clones[0];
    editorWorldState.previewGhostMaterials.push({
      clones,
      mesh: child,
      original,
    });
  });
}

function applyEditorPreviewVisibility(documentValue) {
  if (!editorWorldState) {
    return;
  }
  restoreEditorPreviewVisibility();
  const nodes = nodesInDocument(documentValue);
  for (const node of nodes) {
    const object = editorWorldState.objectMap.get(node.id);
    if (!object) {
      continue;
    }
    editorWorldState.previewVisibilityBaseline.set(object, object.visible);
    object.visible =
      object.visible &&
      !nodeOrAncestorMatches(documentValue, node.id, hiddenOutlinerNodeIds) &&
      nodeIsInSoloContext(documentValue, node);
  }
  for (const node of nodes) {
    const object = editorWorldState.objectMap.get(node.id);
    if (!object?.visible) {
      continue;
    }
    const explicitlyGhosted = ghostedOutlinerNodeIds.has(node.id);
    const soloContextGhost =
      soloOutlinerNodeId != null &&
      nodeIsPreviewContext(node) &&
      !nodeContainsNode(documentValue, node.id, soloOutlinerNodeId) &&
      !nodeContainsNode(documentValue, soloOutlinerNodeId, node.id);
    if (explicitlyGhosted || soloContextGhost) {
      ghostObjectMaterials(object);
    }
  }
}

function trimNumber(value, digits = 2) {
  return Number(value.toFixed(digits)).toString();
}

function createNodeIdForAsset(documentValue, assetId) {
  const base =
    String(assetId || 'asset')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'asset';
  const ids = new Set(nodesInDocument(documentValue).map((node) => node.id));
  let index = 1;
  let candidate = base + '-' + index;
  while (ids.has(candidate)) {
    index += 1;
    candidate = base + '-' + index;
  }
  return candidate;
}

async function dispatchEditorTransaction(session, patches) {
  const base = await session.dispatch('scene_get_document', {});
  const candidate = applyScenePatch(session.document, {
    op: 'transaction',
    patches,
  }).document;
  return session.dispatch('scene_apply_transaction', {
    candidateDocumentHash: hashSceneDocument(candidate),
    expectedBaseDocumentHash: base.documentHash,
    ownershipMode: 'replace-new',
    patches,
  });
}

function createGroupNodeId(documentValue) {
  const ids = new Set(nodesInDocument(documentValue).map((node) => node.id));
  let index = 1;
  let candidate = 'group-' + index;
  while (ids.has(candidate)) {
    index += 1;
    candidate = 'group-' + index;
  }
  return candidate;
}

function createEmptyEntityNodeId(documentValue) {
  const ids = new Set(nodesInDocument(documentValue).map((node) => node.id));
  let index = 1;
  let candidate = 'entity-' + index;
  while (ids.has(candidate)) {
    index += 1;
    candidate = 'entity-' + index;
  }
  return candidate;
}

function defaultTransformForAsset(documentValue, assetId) {
  const assetIndex = nodesInDocument(documentValue).length;
  const { max, min } = getAssetBounds(documentValue, assetId);
  const extents = max.map((value, index) =>
    Math.abs(value - Number(min[index] ?? value)),
  );
  const boundsAreSane = extents.every(
    (value) => Number.isFinite(value) && value < 50,
  );
  const y = boundsAreSane && Number(min[1]) < 0 ? -Number(min[1]) : 0;
  return {
    position: [
      Number((((assetIndex % 5) - 2) * 0.45).toFixed(3)),
      Number(y.toFixed(3)),
      Number((Math.floor(assetIndex / 5) * 0.45).toFixed(3)),
    ],
  };
}

async function initialScaleForPanelAsset(assetId) {
  let size = assetPanelNaturalSizeCache.get(assetId);
  if (!size) {
    const preview = await getEditorPanelAssetPreview(assetId);
    size = { height: preview.worldHeight, width: preview.worldWidth };
    assetPanelNaturalSizeCache.set(assetId, size);
  }
  const largestDimension = Math.max(size.width, size.height);
  return largestDimension > 0
    ? Number((1 / largestDimension).toFixed(6))
    : 1;
}

function addAssetFromCatalog(session, camera, assetId) {
  return runEditorMutation(async () => {
    const asset = sceneAssets(session.document).find(
      (entry) => entry.id === assetId,
    );
    if (!asset) {
      throw new Error(\`Unknown asset "\${assetId}"\`);
    }
    const nodeId = createNodeIdForAsset(session.document, assetId);
    const isUIKitML = asset.kind === 'uikitml';
    const transform = defaultTransformForAsset(session.document, assetId);
    if (isUIKitML) {
      transform.position[1] = 1.25;
      transform.scale = await initialScaleForPanelAsset(assetId);
    }
    let result = await dispatchEditorTransaction(session, [{
      node: {
        content: { asset: assetId, type: 'asset' },
        id: nodeId,
        transform,
      },
      op: 'addNode',
    }]);
    setEditorSelection([nodeId]);
    result = await session.dispatch('scene_select', { nodeIds: [nodeId] });
    syncSelectionFromResult(result);
    clearValidationResult();
    renderUi(session, camera);
  });
}

function addEmptyEntity(session, camera) {
  return runEditorMutation(async () => {
    const nodeId = createEmptyEntityNodeId(session.document);
    const result = await session.dispatch('scene_add_node', {
      node: {
        id: nodeId,
      },
    });
    syncSelectionFromResult(result);
    clearValidationResult();
    renderUi(session, camera);
  });
}

function hideSceneGraphContextMenu() {
  const menu = document.getElementById('scene-graph-context-menu');
  if (!menu) {
    return;
  }
  menu.hidden = true;
  menu.innerHTML = '';
  delete menu.dataset.contextNodeId;
}

function showSceneGraphContextMenu(session, camera, nodeId, point) {
  const menu = document.getElementById('scene-graph-context-menu');
  if (!menu) {
    return;
  }
  const hierarchyInfo = findNodeHierarchyInfo(session.document, nodeId);
  const groupable = groupableSelectedNodes(session.document, nodeId);
  const canUngroup = Boolean(hierarchyInfo?.node?.children?.length);
  menu.innerHTML = \`
    <div class="context-menu-label">\${escapeHtml(nodeId)}</div>
    <div class="context-menu-group">
      <button data-scene-graph-action="toggle-solo">\${
        soloOutlinerNodeId === nodeId ? 'Exit Solo' : 'Solo Group'
      }</button>
      <button data-scene-graph-action="toggle-ghost">\${
        ghostedOutlinerNodeIds.has(nodeId) ? 'Show Normally' : 'Ghost Group'
      }</button>
      <button data-scene-graph-action="toggle-lock">\${
        lockedOutlinerNodeIds.has(nodeId) ? 'Unlock Group' : 'Lock Group'
      }</button>
      <button data-scene-graph-action="reset-visibility">Reset Visibility</button>
    </div>
    <div class="context-menu-group">
      <button data-scene-graph-action="group-selection" \${groupable ? '' : 'disabled'}>Group Selection</button>
      <button data-scene-graph-action="ungroup" \${canUngroup ? '' : 'disabled'}>Ungroup</button>
      <button data-scene-graph-action="duplicate">Duplicate Node</button>
    </div>
    <div class="context-menu-group">
      <button data-scene-graph-action="remove" data-destructive>Remove Node</button>
    </div>
  \`;
  menu.dataset.contextNodeId = nodeId;
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.visibility = 'hidden';
  menu.hidden = false;
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  menu.style.left = \`\${Math.max(8, Math.min(point.x, window.innerWidth - menuWidth - 8))}px\`;
  menu.style.top = \`\${Math.max(8, Math.min(point.y, window.innerHeight - menuHeight - 8))}px\`;
  menu.style.visibility = '';

  menu.querySelectorAll('[data-scene-graph-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.getAttribute('data-scene-graph-action');
      runSceneGraphContextAction(session, camera, nodeId, action);
    });
  });
}

function runSceneGraphContextAction(session, camera, nodeId, action) {
  runEditorMutation(async () => {
    if (action === 'toggle-solo') {
      soloOutlinerNodeId = soloOutlinerNodeId === nodeId ? null : nodeId;
      applyEditorReviewLens(session.document);
    } else if (action === 'toggle-ghost') {
      if (ghostedOutlinerNodeIds.has(nodeId)) {
        ghostedOutlinerNodeIds.delete(nodeId);
      } else {
        ghostedOutlinerNodeIds.add(nodeId);
      }
      applyEditorReviewLens(session.document);
    } else if (action === 'toggle-lock') {
      if (lockedOutlinerNodeIds.has(nodeId)) {
        lockedOutlinerNodeIds.delete(nodeId);
      } else {
        lockedOutlinerNodeIds.add(nodeId);
      }
      syncTransformControlsToSelection(session);
    } else if (action === 'reset-visibility') {
      resetPreviewVisibilityState();
      applyEditorReviewLens(session.document);
      syncTransformControlsToSelection(session);
    } else if (action === 'duplicate') {
      const result = await session.dispatch('scene_duplicate_node', { nodeId });
      syncSelectionFromResult(result);
    } else if (action === 'remove') {
      const result = await session.dispatch('scene_remove_node', { nodeId });
      syncSelectionFromResult(result);
    } else if (action === 'group-selection') {
      const result = await groupSelectedNodes(session, nodeId);
      syncSelectionFromResult(result);
    } else if (action === 'ungroup') {
      const result = await ungroupNode(session, nodeId);
      syncSelectionFromResult(result);
    }
    hideSceneGraphContextMenu();
    clearValidationResult();
    renderUi(session, camera);
  });
}

function selectedOutlinerNodeIds() {
  const selection = Array.isArray(window.__IWSDK_EDITOR_SELECTION)
    ? window.__IWSDK_EDITOR_SELECTION
    : [];
  const seen = new Set();
  return selection.filter((nodeId) => {
    if (typeof nodeId !== 'string' || seen.has(nodeId)) {
      return false;
    }
    seen.add(nodeId);
    return true;
  });
}

function groupableSelectedNodes(documentValue, contextNodeId) {
  const selectedIds = selectedOutlinerNodeIds();
  if (selectedIds.length < 2 || !selectedIds.includes(contextNodeId)) {
    return null;
  }
  const infos = selectedIds.map((nodeId) =>
    findNodeHierarchyInfo(documentValue, nodeId),
  );
  if (infos.some((info) => !info)) {
    return null;
  }
  const parentId = infos[0].parentId;
  const playerTarget = infos[0].playerTarget;
  if (
    infos.some(
      (info) =>
        info.parentId !== parentId || info.playerTarget !== playerTarget,
    )
  ) {
    return null;
  }
  const sortedInfos = [...infos].sort((left, right) => left.index - right.index);
  return {
    insertIndex: sortedInfos[0].index,
    nodeIds: sortedInfos.map((info) => info.node.id),
    parentId,
    playerTarget,
  };
}

async function groupSelectedNodes(session, contextNodeId) {
  const groupable = groupableSelectedNodes(session.document, contextNodeId);
  if (!groupable) {
    return {
      action: 'nodeGroupSkipped',
      selection: selectedOutlinerNodeIds(),
      valid: true,
    };
  }
  const groupId = createGroupNodeId(session.document);
  await session.dispatch('scene_apply_patch', {
    patch: {
      index: groupable.insertIndex,
      node: {
        id: groupId,
        ...(groupable.playerTarget
          ? {
              parent: {
                target: groupable.playerTarget,
                type: 'player-space',
              },
            }
          : {}),
      },
      op: 'addNode',
      parentId: groupable.parentId,
    },
  });
  for (const childId of groupable.nodeIds) {
    await session.dispatch('scene_apply_patch', {
      patch: {
        nodeId: childId,
        op: 'moveNode',
        parentId: groupId,
        preserveWorldTransform: true,
      },
    });
  }
  await session.dispatch('scene_select', { nodeIds: [groupId] });
  return {
    action: 'nodesGrouped',
    groupId,
    nodeIds: groupable.nodeIds,
    selection: [groupId],
    valid: true,
  };
}

async function ungroupNode(session, nodeId) {
  const hierarchyInfo = findNodeHierarchyInfo(session.document, nodeId);
  const childIds = (hierarchyInfo?.node?.children || []).map((child) => child.id);
  if (!hierarchyInfo || childIds.length === 0) {
    return {
      action: 'nodeUngroupSkipped',
      selection: [nodeId],
      valid: true,
    };
  }
  for (let index = 0; index < childIds.length; index += 1) {
    await session.dispatch('scene_apply_patch', {
      patch: {
        index: hierarchyInfo.index + index,
        nodeId: childIds[index],
        op: 'moveNode',
        parentId: hierarchyInfo.parentId,
        ...(hierarchyInfo.playerTarget
          ? {
              parent: {
                target: hierarchyInfo.playerTarget,
                type: 'player-space',
              },
            }
          : {}),
        preserveWorldTransform: true,
      },
    });
  }
  await session.dispatch('scene_apply_patch', {
    patch: {
      nodeId,
      op: 'removeNode',
    },
  });
  await session.dispatch('scene_select', { nodeIds: childIds });
  return {
    action: 'nodeUngrouped',
    nodeId,
    nodeIds: childIds,
    selection: childIds,
    valid: true,
  };
}

function isValidOutlinerDrop(
  documentValue,
  draggedNodeId,
  targetNodeId,
  parent,
) {
  if (!draggedNodeId || draggedNodeId === targetNodeId) {
    return false;
  }
  const draggedNode = findNodeById(documentValue, draggedNodeId);
  const targetNode = targetNodeId == null ? null : findNodeById(documentValue, targetNodeId);
  if (!draggedNode || (targetNodeId != null && !targetNode)) {
    return false;
  }
  const current = findNodeHierarchyInfo(documentValue, draggedNodeId);
  const currentPlayerTarget =
    current?.parentId == null ? current?.node?.parent?.target : null;
  const nextPlayerTarget = parent?.target || null;
  if (
    current?.parentId === targetNodeId &&
    currentPlayerTarget === nextPlayerTarget
  ) {
    return false;
  }
  return targetNodeId == null || !nodeHasDescendant(draggedNode, targetNodeId);
}

function applyOutlinerReparent(session, camera, nodeId, parentId, parent) {
  return runEditorMutation(async () => {
    const result = await session.dispatch('scene_apply_patch', {
      patch: {
        nodeId,
        op: 'moveNode',
        parentId,
        ...(parent ? { parent } : {}),
        preserveWorldTransform: true,
      },
    });
    syncSelectionFromResult(result);
    clearValidationResult();
    renderUi(session, camera);
  });
}

function setEditorSelection(nodeIds, { rootWhenEmpty = true } = {}) {
  const selection = Array.isArray(nodeIds)
    ? nodeIds.filter((nodeId) => typeof nodeId === 'string')
    : [];
  window.__IWSDK_EDITOR_SELECTION = selection;
  window.__IWSDK_EDITOR_ROOT_SELECTED =
    rootWhenEmpty && selection.length === 0;
  window.__IWSDK_EDITOR_BUILTIN_SELECTION =
    window.__IWSDK_EDITOR_ROOT_SELECTED ? 'level-root' : null;
  return selection;
}

function setEditorBuiltinSelection(target) {
  window.__IWSDK_EDITOR_SELECTION = [];
  window.__IWSDK_EDITOR_ROOT_SELECTED = target === 'level-root';
  window.__IWSDK_EDITOR_BUILTIN_SELECTION = target;
}

function syncSelectionFromResult(result) {
  const selection =
    result && typeof result === 'object' ? result.selection : undefined;
  if (Array.isArray(selection)) {
    setEditorSelection(selection);
  }
}

function setValidationResult(validation) {
  window.__IWSDK_EDITOR_VALIDATION = validation || null;
}

function clearValidationResult() {
  window.__IWSDK_EDITOR_VALIDATION = null;
}

function invalidatesValidation(method) {
  return [
    'scene_add_node',
    'scene_remove_node',
    'scene_duplicate_node',
    'scene_set_transform',
    'scene_set_framing_role',
    'scene_apply_patch',
    'scene_apply_transaction',
    'scene_replace_document',
    'scene_look_at',
    'scene_undo',
    'scene_redo',
  ].includes(method);
}

function shouldAutosaveAfterMethod(method) {
  return invalidatesValidation(method);
}

function mutationResultIsValid(result) {
  return !(
    result &&
    typeof result === 'object' &&
    result.valid === false
  );
}

function mergeAutosaveResult(result, saveResult) {
  if (
    !result ||
    typeof result !== 'object' ||
    !saveResult ||
    typeof saveResult !== 'object'
  ) {
    return result;
  }
  const merged = { ...result, ...saveResult };
  if (typeof result.action === 'string') {
    merged.action = result.action;
  }
  if (result.lifecycle && typeof result.lifecycle === 'object') {
    merged.lifecycle = result.lifecycle;
  }
  return merged;
}

function handleEditorMutationError(error) {
  console.error(error);
  if (
    error?.code === 'scene_revision_conflict' ||
    error?.code === 'scene_revision_required'
  ) {
    showSceneConflictDialog(error);
    return;
  }
  if (Array.isArray(error?.issues)) {
    setValidationResult({
      issues: error.issues,
      lifecycle: error.lifecycle,
      valid: false,
    });
    window.__IWSDK_EDITOR_BOTTOM_TAB = 'validation';
    const panel = document.getElementById('editor-bottom-panel');
    if (panel && editorWorldState?.currentSession) {
      renderDiagnosticsPanel(
        panel,
        editorWorldState.currentSession,
        editorWorldState.currentCamera,
      );
    }
  }
  const statusStrip = document.getElementById('editor-status-strip');
  if (statusStrip) {
    statusStrip.dataset.state = 'dirty';
    statusStrip.textContent = 'Error | ' + String(error?.message || error);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function vec3FromTransform(transform, field, fallback) {
  const value = transform?.[field];
  return Array.isArray(value) && value.length === 3 ? value : fallback;
}

function scaleToEditorVec3(scale) {
  if (typeof scale === 'number') {
    return [scale, scale, scale];
  }
  return Array.isArray(scale) && scale.length === 3 ? scale : [1, 1, 1];
}

function readFiniteInput(inspector, field) {
  const input = inspector.querySelector(\`[data-transform-field="\${field}"]\`);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(\`Missing transform field \${field}\`);
  }
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    throw new Error(\`Transform field \${field} must be a finite number\`);
  }
  return value;
}

function readScale(inspector) {
  const scale = [
    readFiniteInput(inspector, 'scale.0'),
    readFiniteInput(inspector, 'scale.1'),
    readFiniteInput(inspector, 'scale.2'),
  ];
  return scale.every((value) => value === scale[0]) ? scale[0] : scale;
}

function readTransformFields(inspector, baseTransform) {
  return {
    ...baseTransform,
    position: [
      readFiniteInput(inspector, 'position.0'),
      readFiniteInput(inspector, 'position.1'),
      readFiniteInput(inspector, 'position.2'),
    ],
    rotationDeg: [
      readFiniteInput(inspector, 'rotationDeg.0'),
      readFiniteInput(inspector, 'rotationDeg.1'),
      readFiniteInput(inspector, 'rotationDeg.2'),
    ],
    scale: readScale(inspector),
  };
}

function parseTransformFieldKey(fieldKey) {
  const [field, indexText] = String(fieldKey || '').split('.');
  const index = Number(indexText);
  if (
    !['position', 'rotationDeg', 'scale'].includes(field) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 2
  ) {
    throw new Error('Unknown transform field ' + fieldKey);
  }
  return { field, index };
}

function transformVectorForField(transform, field) {
  if (field === 'scale') {
    return scaleToEditorVec3(transform?.scale);
  }
  return vec3FromTransform(transform, field, [0, 0, 0]);
}

function transformWithFieldValue(transform, field, index, value) {
  const vector = [...transformVectorForField(transform, field)];
  vector[index] = value;
  if (field === 'scale') {
    return {
      ...(transform || {}),
      scale: compactScaleValue(vector),
    };
  }
  return {
    ...(transform || {}),
    [field]: vector,
  };
}

function commonTransformFieldValue(nodes, field, index) {
  const values = nodes.map((node) =>
    transformVectorForField(node.transform || {}, field)[index],
  );
  if (values.length === 0) {
    return '';
  }
  return values.every((value) => Object.is(value, values[0]))
    ? String(values[0])
    : '';
}

function transformEditorSignature(transform) {
  return JSON.stringify({
    position: transform.position,
    rotationDeg: transform.rotationDeg,
    scale: transform.scale,
  });
}

function setTransformEditorMessage(inspector, message, isError = false) {
  const messageNode = inspector.querySelector('#transform-editor-message');
  if (messageNode) {
    messageNode.textContent = message;
    messageNode.className = isError ? 'transform-editor-error' : '';
  }
}

async function runTransformMutation(inspector, operation) {
  try {
    await queueEditorMutation(operation);
  } catch (error) {
    setTransformEditorMessage(inspector, String(error?.message || error), true);
  }
}

function commitTransformFields(inspector, session, camera, node, baseTransform) {
  runTransformMutation(inspector, async () => {
    const nextTransform = readTransformFields(inspector, baseTransform);
    const nextSignature = transformEditorSignature(nextTransform);
    if (
      inspector.dataset.committedTransformValue === nextSignature ||
      inspector.dataset.pendingTransformValue === nextSignature
    ) {
      setTransformEditorMessage(inspector, '');
      return;
    }
    inspector.dataset.pendingTransformValue = nextSignature;
    try {
      await session.dispatch('scene_set_transform', {
        nodeId: node.id,
        transform: nextTransform,
      });
      inspector.dataset.committedTransformValue = nextSignature;
      clearValidationResult();
      renderUi(session, camera);
    } finally {
      if (inspector.dataset.pendingTransformValue === nextSignature) {
        delete inspector.dataset.pendingTransformValue;
      }
    }
  });
}

function commitMultiTransformField(inspector, session, camera, nodes, fieldKey) {
  runTransformMutation(inspector, async () => {
    const input = inspector.querySelector(
      '[data-transform-field="' + fieldKey + '"]',
    );
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Missing transform field ' + fieldKey);
    }
    const rawValue = input.value.trim();
    if (rawValue.length === 0) {
      setTransformEditorMessage(inspector, '');
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new Error('Transform field ' + fieldKey + ' must be a finite number');
    }
    const { field, index } = parseTransformFieldKey(fieldKey);
    const signature = JSON.stringify({
      field,
      index,
      nodeIds: nodes.map((node) => node.id),
      value,
    });
    if (inspector.dataset.pendingTransformValue === signature) {
      return;
    }
    inspector.dataset.pendingTransformValue = signature;
    try {
      for (const node of nodes) {
        const nextTransform = transformWithFieldValue(
          node.transform || {},
          field,
          index,
          value,
        );
        if (!transformsEqual(node.transform || {}, nextTransform)) {
          await session.dispatch('scene_set_transform', {
            nodeId: node.id,
            transform: nextTransform,
          });
        }
      }
      clearValidationResult();
      setTransformEditorMessage(inspector, '');
      renderUi(session, camera);
    } finally {
      if (inspector.dataset.pendingTransformValue === signature) {
        delete inspector.dataset.pendingTransformValue;
      }
    }
  });
}

function resetTransformField(inspector, session, camera, node, field) {
  runTransformMutation(inspector, async () => {
    const nextTransform = {
      ...(node.transform || {}),
    };
    if (field === 'position') {
      nextTransform.position = [0, 0, 0];
    } else if (field === 'rotationDeg') {
      nextTransform.rotationDeg = [0, 0, 0];
    } else if (field === 'scale') {
      nextTransform.scale = 1;
    } else {
      throw new Error('Unknown transform field ' + field);
    }
    await session.dispatch('scene_set_transform', {
      nodeId: node.id,
      transform: nextTransform,
    });
    clearValidationResult();
    renderUi(session, camera);
  });
}

function documentStatusLabel() {
  return currentScenePath() || documentUrl;
}

function componentValueText(value) {
  return JSON.stringify(value, null, 2);
}

function stripComponentPrefix(componentName) {
  const prefix = 'com.iwsdk.components.';
  return typeof componentName === 'string' && componentName.startsWith(prefix)
    ? componentName.slice(prefix.length)
    : componentName;
}

function componentNameForSchema(schema) {
  return schema?.source === 'iwsdk'
    ? 'com.iwsdk.components.' + schema.id
    : schema.id;
}

function authoredNodeVisible(node) {
  if (typeof node?.visible === 'boolean') {
    return node.visible;
  }
  const legacy =
    node?.components?.Visibility ||
    node?.components?.['com.iwsdk.components.Visibility'];
  return legacy?.isVisible !== false;
}

function componentSchemasForDocument(_documentValue) {
  return runtimeComponentSchemas().filter(
    (schema) =>
      schema.id !== 'PanelUI' &&
      schema.id !== 'PanelDocument' &&
      schema.editor?.hidden !== true,
  );
}

function componentSchemaMapForDocument(_documentValue) {
  return new Map(
    runtimeComponentSchemas().map((schema) => [schema.id, schema]),
  );
}

function runtimeComponentSchemas() {
  return Object.values(runtimeComponentCatalog()).sort((first, second) =>
    first.id.localeCompare(second.id),
  );
}

function runtimeComponentCatalog() {
  if (!componentCatalogFromComponents || !IWSDK_BUILTIN_COMPONENTS) {
    return {};
  }
  const builtins = componentCatalogFromComponents(IWSDK_BUILTIN_COMPONENTS, {
    source: 'iwsdk',
  });
  const application = componentCatalogFromComponents(editorComponentManifest, {
    source: 'app',
  });
  return { ...builtins, ...application };
}

function isPlainEditorRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function componentPayloadType(componentName, _value) {
  return stripComponentPrefix(componentName);
}

function nodeHasLightComponent(node) {
  return Object.keys(node?.components || {}).some((name) =>
    [
      'AmbientLight',
      'HemisphereLight',
      'DirectionalLight',
      'PointLight',
      'SpotLight',
      'RectAreaLight',
    ].includes(stripComponentPrefix(name)),
  );
}

function componentPayloadProps(value) {
  return isPlainEditorRecord(value) ? value : {};
}

function defaultComponentProps(schema) {
  const props = {};
  for (const [fieldName, field] of Object.entries(schema.fields || {})) {
    if (field.hidden === true) {
      continue;
    }
    if (field.default !== undefined) {
      props[fieldName] = field.default;
    }
  }
  return props;
}

function defaultValueForField(field) {
  if (field.widget === 'entity') {
    return null;
  }
  switch (field.type) {
    case 'Boolean':
      return false;
    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'Float32':
    case 'Float64':
      return 0;
    case 'Vec2':
      return [0, 0];
    case 'Vec3':
      return [0, 0, 0];
    case 'Vec4':
    case 'Color':
      return [0, 0, 0, 1];
    case 'Enum':
      return Object.values(field.enum || {})[0] || '';
    case 'String':
    case 'FilePath':
      return '';
    case 'Entity':
      return null;
    case 'Object':
    default:
      return {};
  }
}

function setComponentEditorMessage(inspector, message, isError = false) {
  const messageNode = inspector.querySelector(
    '#component-editor-message',
  );
  if (messageNode) {
    messageNode.textContent = message;
    messageNode.className = isError ? 'component-editor-error' : '';
  }
}

function parseComponentValue(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      'Component payload must be valid JSON: ' + String(error?.message || error),
    );
  }
}

function renderComponentRows(componentEntries, componentSchemaMap, documentValue) {
  if (componentEntries.length === 0) {
    return '<p class="empty-state">No components</p>';
  }

  return componentEntries
    .map(([name, value], index) =>
      renderComponentRow(name, value, index, componentSchemaMap, documentValue),
    )
    .join('');
}

function renderComponentRow(name, value, index, componentSchemaMap, documentValue) {
  const componentType = componentPayloadType(name, value);
  const schema = componentSchemaMap.get(componentType);
  const props = componentPayloadProps(value);
  const title = schema?.name || componentType || name;
  const description = distinctComponentDescription(
    schema?.description,
    title,
    name,
  );
  const fieldControls = schema
    ? Object.entries(schema.fields || {})
        .filter(([, field]) => field.hidden !== true)
        .map(([fieldName, field]) =>
          renderComponentField(fieldName, field, props[fieldName], documentValue),
        )
        .join('')
    : '<label>Payload <textarea data-component-value rows="5">' +
      escapeHtml(componentValueText(props)) +
      '</textarea></label>';

  return (
    '<div class="component-row" data-component-index="' +
    index +
    '" data-component-name="' +
    escapeHtml(name) +
    '" data-component-type="' +
    escapeHtml(componentType) +
    '" data-component-props="' +
    escapeHtml(componentValueText(props)) +
    '">' +
    '<div class="component-row-header"><span class="component-row-title"><strong>' +
    escapeHtml(title) +
    '</strong>' +
    (description ? '<span>' + escapeHtml(description) + '</span>' : '') +
    '</span><button class="component-remove-button icon-button" data-remove-component title="Remove ' +
    escapeHtml(title) +
    '" aria-label="Remove ' +
    escapeHtml(title) +
    '">' +
    renderLucideIcon('X') +
    '<span class="sr-only">Remove ' +
    escapeHtml(title) +
    '</span></button></div>' +
    fieldControls +
    '</div>'
  );
}

function distinctComponentDescription(description, ...identifiers) {
  const value = typeof description === 'string' ? description.trim() : '';
  if (!value) {
    return '';
  }
  const normalized = value.toLocaleLowerCase();
  return identifiers.some(
    (identifier) =>
      typeof identifier === 'string' &&
      identifier.trim().toLocaleLowerCase() === normalized,
  )
    ? ''
    : value;
}

function renderComponentField(fieldName, field, value, documentValue) {
  const fieldValue =
    value !== undefined
      ? value
      : field.default !== undefined
        ? field.default
        : defaultValueForField(field);
  const fieldLabelText = field.label || fieldName;
  const fieldLabel =
    '<span class="component-field-label"' +
    (field.help ? ' title="' + escapeHtml(field.help) + '"' : '') +
    '>' +
    escapeHtml(fieldLabelText) +
    '</span>';
  const omittedAttribute =
    value === undefined ? ' data-component-field-omitted="true"' : '';

  if (field.type === 'Boolean') {
    return (
      '<label class="component-field-row component-boolean-row" data-component-field-row="' +
      escapeHtml(fieldName) +
      '"' +
      omittedAttribute +
      '>' +
      fieldLabel +
      '<input type="checkbox" data-component-field="' +
      escapeHtml(fieldName) +
      '" data-component-field-type="' +
      escapeHtml(field.type) +
      '" ' +
      (fieldValue === true ? 'checked' : '') +
      ' /></label>'
    );
  }

  if (field.type === 'Enum') {
    const options = Object.entries(field.enum || {})
      .map(([alias, optionValue]) => {
        const selected = optionValue === fieldValue ? 'selected' : '';
        return (
          '<option value="' +
          escapeHtml(optionValue) +
          '" ' +
          selected +
          '>' +
          escapeHtml(alias) +
          '</option>'
        );
      })
      .join('');
    return (
      '<label class="component-field-row" data-component-field-row="' +
      escapeHtml(fieldName) +
      '"' +
      omittedAttribute +
      '>' +
      fieldLabel +
      '<select data-component-field="' +
      escapeHtml(fieldName) +
      '" data-component-field-type="' +
      escapeHtml(field.type) +
      '">' +
      options +
      '</select></label>'
    );
  }

  if (field.type === 'Color') {
    const alpha =
      Array.isArray(fieldValue) && Number.isFinite(fieldValue[3])
        ? fieldValue[3]
        : 1;
    return (
      '<label class="component-field-row component-color-row" data-component-field-row="' +
      escapeHtml(fieldName) +
      '"' +
      omittedAttribute +
      '>' +
      fieldLabel +
      '<input type="color" data-component-field="' +
      escapeHtml(fieldName) +
      '" data-component-field-type="Color" data-component-color-alpha="' +
      escapeHtml(String(alpha)) +
      '" value="' +
      escapeHtml(componentColorHex(fieldValue)) +
      '" aria-label="' +
      escapeHtml(fieldLabelText + ' color') +
      '" /></label>'
    );
  }

  if (isVectorComponentField(field.type)) {
    const length = vectorComponentFieldLength(field.type);
    return (
      '<div class="component-field-row component-vector-row" data-component-field-row="' +
      escapeHtml(fieldName) +
      '"' +
      omittedAttribute +
      '>' +
      fieldLabel +
      '<div class="component-vector-field" data-component-field="' +
      escapeHtml(fieldName) +
      '" data-component-field-type="' +
      escapeHtml(field.type) +
      '" data-component-vector-count="' +
      length +
      '" style="--component-vector-count: ' +
      length +
      '">' +
      renderVectorComponentInputs(fieldName, field.type, fieldValue) +
      '</div></div>'
    );
  }

  if (isNumericComponentField(field.type)) {
    const numericAttributes =
      ' step="' + escapeHtml(String(field.step ?? 0.01)) + '"' +
      (Number.isFinite(field.min)
        ? ' min="' + escapeHtml(String(field.min)) + '"'
        : '') +
      (Number.isFinite(field.max)
        ? ' max="' + escapeHtml(String(field.max)) + '"'
        : '');
    return (
      '<label class="component-field-row" data-component-field-row="' +
      escapeHtml(fieldName) +
      '"' +
      omittedAttribute +
      '>' +
      fieldLabel +
      '<input type="number"' + numericAttributes + ' data-component-field="' +
      escapeHtml(fieldName) +
      '" data-component-field-type="' +
      escapeHtml(field.type) +
      '" value="' +
      escapeHtml(String(Number.isFinite(fieldValue) ? fieldValue : 0)) +
      '" /></label>'
    );
  }

  if (field.type === 'FilePath') {
    const missing = String(fieldValue ?? '').trim().length === 0;
    return (
      '<div class="component-field-row component-file-row" data-component-field-row="' +
      escapeHtml(fieldName) +
      '" data-field-invalid="' +
      String(missing) +
      '"' +
      omittedAttribute +
      '>' +
      fieldLabel +
      '<div class="component-file-control"><input data-component-field="' +
      escapeHtml(fieldName) +
      '" data-component-field-type="FilePath" value="' +
      escapeHtml(String(fieldValue ?? '')) +
      '" /><button type="button" class="component-file-browse-button icon-button" data-component-file-browse data-file-types="' +
      escapeHtml(field.fileTypes || '') +
      '" data-subfolder="' +
      escapeHtml(field.subfolder || '') +
      '" title="Choose ' +
      escapeHtml(fieldLabelText) +
      '" aria-label="Choose ' +
      escapeHtml(fieldLabelText) +
      '">' +
      renderLucideIcon('FolderOpen') +
      '</button></div>' +
      (missing
        ? '<span class="component-field-warning">Select a project file</span>'
        : '') +
      '</div>'
    );
  }

  if (field.type === 'Entity' || field.widget === 'entity') {
    return renderEntityReferenceField(
      fieldName,
      field,
      fieldValue,
      fieldLabel,
      omittedAttribute,
      documentValue,
    );
  }

  if (field.type === 'Object') {
    return (
      '<label class="component-field-row component-object-row" data-component-field-row="' +
      escapeHtml(fieldName) +
      '"' +
      omittedAttribute +
      '>' +
      fieldLabel +
      '<textarea data-component-field="' +
      escapeHtml(fieldName) +
      '" data-component-field-type="' +
      escapeHtml(field.type) +
      '" rows="4">' +
      escapeHtml(componentValueText(fieldValue ?? {})) +
      '</textarea></label>'
    );
  }

  return (
    '<label class="component-field-row" data-component-field-row="' +
    escapeHtml(fieldName) +
    '"' +
    omittedAttribute +
    '>' +
    fieldLabel +
    '<input data-component-field="' +
    escapeHtml(fieldName) +
    '" data-component-field-type="' +
    escapeHtml(field.type) +
    '" value="' +
    escapeHtml(String(fieldValue ?? '')) +
    '" /></label>'
  );
}

function renderEntityReferenceField(
  fieldName,
  field,
  value,
  fieldLabel,
  omittedAttribute,
  documentValue,
) {
  const state = entityReferenceDisplayState(value, documentValue);
  return (
    '<div class="component-field-row component-entity-row" data-component-field-row="' +
    escapeHtml(fieldName) +
    '" data-field-invalid="' +
    String(!state.valid) +
    '"' +
    omittedAttribute +
    '>' +
    fieldLabel +
    '<div class="component-entity-control" data-component-entity-drop data-field-invalid="' +
    String(!state.valid) +
    '" aria-invalid="' +
    String(!state.valid) +
    '" tabindex="0">' +
    '<input type="hidden" data-component-field="' +
    escapeHtml(fieldName) +
    '" data-component-field-type="' +
    escapeHtml(field.type) +
    '" data-component-field-widget="entity" value="' +
    escapeHtml(componentValueText(value ?? null)) +
    '" />' +
    '<span class="component-entity-icon">' +
    renderLucideIcon(state.builtin ? 'PersonStanding' : 'Box') +
    '</span><span class="component-entity-value">' +
    escapeHtml(state.label) +
    '</span>' +
    (value == null
      ? ''
      : '<button type="button" class="component-entity-clear-button icon-button" data-component-entity-clear title="Clear entity reference" aria-label="Clear entity reference">' +
        renderLucideIcon('X') +
        '</button>') +
    '</div>' +
    (!state.valid
      ? '<span class="component-field-warning">' +
        escapeHtml(state.warning) +
        '</span>'
      : '') +
    '</div>'
  );
}

function entityReferenceDisplayState(value, documentValue) {
  if (value?.type === 'node' && typeof value.id === 'string') {
    const valid = Boolean(findNodeById(documentValue, value.id));
    return {
      builtin: false,
      label: valid ? value.id : value.id + ' (Missing)',
      valid,
      warning: valid ? '' : 'Referenced entity no longer exists',
    };
  }
  if (
    value?.type === 'player-space' &&
    [
      'player',
      'camera',
      'head',
      'left-target-ray',
      'left-grip',
      'right-target-ray',
      'right-grip',
    ].includes(value.target)
  ) {
    return {
      builtin: true,
      label: playerRigTargetLabel(value.target),
      valid: true,
      warning: '',
    };
  }
  if (value?.type === 'level-root') {
    return { builtin: true, label: 'Level Root', valid: true, warning: '' };
  }
  if (Number.isInteger(value)) {
    return {
      builtin: false,
      label: 'Runtime entity #' + value,
      valid: true,
      warning: '',
    };
  }
  return {
    builtin: false,
    label: 'None (drop an entity)',
    valid: false,
    warning: 'Drag an entity from the Scene Graph',
  };
}

function componentColorHex(value) {
  const entries = Array.isArray(value) ? value : [0, 0, 0, 1];
  const channelHex = (channel) =>
    Math.round(
      Math.min(1, Math.max(0, Number.isFinite(channel) ? channel : 0)) * 255,
    )
      .toString(16)
      .padStart(2, '0');
  return '#' + entries.slice(0, 3).map(channelHex).join('');
}

function renderVectorComponentInputs(fieldName, fieldType, value) {
  const length = vectorComponentFieldLength(fieldType);
  const entries = Array.isArray(value) ? value : defaultValueForField({ type: fieldType });
  return Array.from({ length }, (_, index) => {
    const axis = ['X', 'Y', 'Z', 'W'][index] || String(index + 1);
    return (
      '<label class="component-axis-field">' +
      '<span>' +
      axis +
      '</span>' +
      '<input type="number" step="0.01" data-component-vector-field="' +
      escapeHtml(fieldName) +
      '" data-component-vector-index="' +
      index +
      '" value="' +
      escapeHtml(String(Number.isFinite(entries[index]) ? entries[index] : 0)) +
      '" /></label>'
    );
  }).join('');
}

function isNumericComponentField(type) {
  return ['Int8', 'Int16', 'Int32', 'Float32', 'Float64'].includes(type);
}

function isVectorComponentField(type) {
  return ['Vec2', 'Vec3', 'Vec4'].includes(type);
}

function vectorComponentFieldLength(type) {
  switch (type) {
    case 'Vec2':
      return 2;
    case 'Vec3':
      return 3;
    case 'Vec4':
      return 4;
    default:
      return 0;
  }
}

function readComponentRow(row, componentSchemaMap) {
  const component = row.getAttribute('data-component-name') || '';
  const componentType = row.getAttribute('data-component-type') || stripComponentPrefix(component);
  if (component.length === 0) {
    throw new Error('Component name is required');
  }
  const schema = componentSchemaMap.get(componentType);
  return {
    component,
    value: schema
      ? readComponentFields(row, schema)
      : parseComponentValue(
          row.querySelector('[data-component-value]')?.value || '{}',
        ),
  };
}

function readComponentFields(row, schema) {
  const original = parseComponentValue(
    row.getAttribute('data-component-props') || '{}',
  );
  const props =
    original && typeof original === 'object' && !Array.isArray(original)
      ? { ...original }
      : {};
  for (const [fieldName, field] of Object.entries(schema.fields || {})) {
    if (field.hidden === true) {
      continue;
    }
    const fieldRow = Array.from(
      row.querySelectorAll('[data-component-field-row]'),
    ).find(
      (entry) => entry.getAttribute('data-component-field-row') === fieldName,
    );
    if (fieldRow?.dataset.componentFieldOmitted === 'true') {
      continue;
    }
    props[fieldName] = readComponentField(row, fieldName, field);
  }
  return props;
}

function readComponentField(row, fieldName, field) {
  if (isVectorComponentField(field.type)) {
    const length = vectorComponentFieldLength(field.type);
    return Array.from({ length }, (_, index) => {
      const input = row.querySelector(
        '[data-component-vector-field="' +
          fieldName +
          '"][data-component-vector-index="' +
          index +
          '"]',
      );
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('Missing component vector field ' + fieldName);
      }
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        throw new Error('Component field ' + fieldName + ' must be finite');
      }
      return value;
    });
  }

  const input = row.querySelector('[data-component-field="' + fieldName + '"]');
  if (
    !(input instanceof HTMLInputElement) &&
    !(input instanceof HTMLSelectElement) &&
    !(input instanceof HTMLTextAreaElement)
  ) {
    throw new Error('Missing component field ' + fieldName);
  }

  if (field.type === 'Color') {
    const match =
      input instanceof HTMLInputElement
        ? /^#([0-9a-f]{6})$/iu.exec(input.value)
        : null;
    if (!match) {
      throw new Error('Component field ' + fieldName + ' must be a color');
    }
    const alpha = Number(input.dataset.componentColorAlpha);
    return [
      parseInt(match[1].slice(0, 2), 16) / 255,
      parseInt(match[1].slice(2, 4), 16) / 255,
      parseInt(match[1].slice(4, 6), 16) / 255,
      Number.isFinite(alpha) ? alpha : 1,
    ];
  }
  if (field.type === 'Boolean') {
    return input instanceof HTMLInputElement ? input.checked : false;
  }
  if (isNumericComponentField(field.type)) {
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      throw new Error('Component field ' + fieldName + ' must be finite');
    }
    return value;
  }
  if (field.type === 'Entity' || field.widget === 'entity') {
    return parseComponentValue(input.value || 'null');
  }
  if (field.type === 'Object') {
    return parseComponentValue(input.value || '{}');
  }
  return input.value;
}

function queueEditorMutation(operation) {
  const task = editorMutationQueue.then(operation);
  editorMutationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function runEditorMutation(operation) {
  return queueEditorMutation(operation).catch(handleEditorMutationError);
}

function showSceneConflictDialog(error) {
  const existing = document.getElementById('scene-save-conflict-dialog');
  if (existing) {
    existing.remove();
  }
  const statusStrip = document.getElementById('editor-status-strip');
  if (statusStrip) {
    statusStrip.dataset.state = 'dirty';
    statusStrip.textContent = 'Conflict | Scene file changed on disk';
  }
  const dialog = document.createElement('section');
  dialog.id = 'scene-save-conflict-dialog';
  dialog.className = 'scene-conflict-dialog';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'false');
  dialog.setAttribute('aria-labelledby', 'scene-conflict-title');
  dialog.innerHTML = \`
    <div class="scene-conflict-card">
      <h2 id="scene-conflict-title">Scene Changed On Disk</h2>
      <p>The selected scene file changed after this editor opened it. Reload the scene before saving again to avoid overwriting external edits.</p>
      <dl>
        <dt>Scene</dt>
        <dd>\${escapeHtml(error?.path || currentScenePath() || 'current scene')}</dd>
        <dt>Loaded revision</dt>
        <dd>\${escapeHtml(error?.expectedRevision || sceneDocumentRevision || 'unknown')}</dd>
        <dt>Disk revision</dt>
        <dd>\${escapeHtml(error?.currentRevision || 'unknown')}</dd>
      </dl>
      <div class="scene-conflict-actions">
        <button type="button" data-scene-conflict-reload>Reload Scene</button>
        <button type="button" data-scene-conflict-dismiss>Dismiss</button>
      </div>
    </div>
  \`;
  dialog
    .querySelector('[data-scene-conflict-reload]')
    ?.addEventListener('click', () => window.location.reload());
  dialog
    .querySelector('[data-scene-conflict-dismiss]')
    ?.addEventListener('click', () => dialog.remove());
  document.body.append(dialog);
}

async function runInspectorMutation(inspector, operation) {
  try {
    await queueEditorMutation(operation);
  } catch (error) {
    setComponentEditorMessage(inspector, String(error?.message || error), true);
  }
}

function componentRowSignature(row, componentSchemaMap) {
  const { component, value } = readComponentRow(row, componentSchemaMap);
  return JSON.stringify({ component, value });
}

function isComponentEditTarget(target) {
  return (
    target instanceof HTMLElement &&
    target.matches(
      '[data-component-field], [data-component-vector-field], [data-component-value]',
    )
  );
}

function markComponentFieldAuthored(target) {
  if (!isComponentEditTarget(target)) {
    return;
  }
  const fieldRow = target.closest('[data-component-field-row]');
  if (fieldRow instanceof HTMLElement) {
    delete fieldRow.dataset.componentFieldOmitted;
  }
}

function refreshInlineComponentFieldValidity(target) {
  if (
    !(target instanceof HTMLInputElement) ||
    target.dataset.componentFieldType !== 'FilePath'
  ) {
    return;
  }
  const fieldRow = target.closest('[data-component-field-row]');
  if (!(fieldRow instanceof HTMLElement)) {
    return;
  }
  const invalid = target.value.trim().length === 0;
  fieldRow.dataset.fieldInvalid = String(invalid);
  target.setAttribute('aria-invalid', String(invalid));
  const existing = fieldRow.querySelector('.component-field-warning');
  if (!invalid) {
    existing?.remove();
    return;
  }
  if (existing == null) {
    const warning = document.createElement('span');
    warning.className = 'component-field-warning';
    warning.textContent = 'Select a project file';
    fieldRow.append(warning);
  }
}

function refreshEditorStatus(session, camera) {
  window.__IWSDK_EDITOR_CAMERA = camera;
  const documentValue = session.document;
  const assets = sceneAssets(documentValue);
  const nodes = nodesInDocument(documentValue);
  const status = document.getElementById('scene-status');
  const dirtyStatus = document.getElementById('dirty-status');
  const statusStrip = document.getElementById('editor-status-strip');
  const diagnosticsPanel = document.getElementById('editor-bottom-panel');

  if (status) {
    status.textContent = \`\${nodes.length} nodes, \${assets.length} assets\`;
  }
  if (dirtyStatus) {
    const fileStatus = sceneFileReloadState.status;
    dirtyStatus.textContent = session.isDirty
      ? 'Unsaved changes'
      : fileStatus === 'invalid'
        ? 'Invalid file; showing last valid scene'
        : fileStatus === 'conflict'
          ? 'File conflict'
          : 'Saved';
    dirtyStatus.dataset.state =
      session.isDirty || fileStatus === 'invalid' || fileStatus === 'conflict'
        ? 'dirty'
        : 'saved';
  }
  if (statusStrip) {
    statusStrip.textContent = [
      documentStatusLabel(),
      \`\${nodes.length} nodes\`,
      session.isDirty
        ? 'unsaved changes'
        : sceneFileReloadState.status === 'invalid'
          ? 'invalid file; last valid scene shown'
          : sceneFileReloadState.status === 'conflict'
            ? 'file conflict'
            : 'saved',
      'IWSDK WebGL',
    ].join(' | ');
    statusStrip.dataset.state = session.isDirty ? 'dirty' : 'saved';
  }
  if (diagnosticsPanel) {
    renderDiagnosticsPanel(diagnosticsPanel, session, camera);
  }
}

function componentPatchForTarget(target, component, value) {
  if (target?.root === true) {
    return { component, op: 'updateRootComponent', value };
  }
  if (typeof target?.playerTarget === 'string') {
    return {
      component,
      op: 'updatePlayerComponent',
      target: target.playerTarget,
      value,
    };
  }
  return { component, nodeId: target.id, op: 'updateComponent', value };
}

function commitComponentRow(inspector, row, session, camera, target, componentSchemaMap) {
  let signature;
  try {
    // Capture the complete row at the DOM event boundary. The inspector may be
    // rerendered while earlier autosaved edits are still queued.
    signature = componentRowSignature(row, componentSchemaMap);
  } catch (error) {
    setComponentEditorMessage(inspector, String(error?.message || error), true);
    return Promise.resolve();
  }
  return runInspectorMutation(inspector, async () => {
    if (
      signature === row.dataset.committedValue ||
      signature === row.dataset.pendingValue
    ) {
      return;
    }
    row.dataset.pendingValue = signature;
    try {
      const { component, value } = JSON.parse(signature);
      const result = await session.dispatch('scene_apply_patch', {
        patch: componentPatchForTarget(target, component, value),
      });
      row.dataset.committedValue = signature;
      syncSelectionFromResult(result);
      clearValidationResult();
      setComponentEditorMessage(inspector, '');
      refreshEditorStatus(session, camera);
      renderCanvas(session, camera);
    } finally {
      if (row.dataset.pendingValue === signature) {
        delete row.dataset.pendingValue;
      }
    }
  });
}

function renderDiagnosticsPanel(panel, session, camera) {
  const requestedTab = window.__IWSDK_EDITOR_BOTTOM_TAB || 'assets';
  const bottomPanelContributions = contributionsForSlot('bottomPanel.tab');
  const contributionTabIds = bottomPanelContributions.map(
    (contribution) => 'contribution:' + contribution.id,
  );
  const activeTab = [
    'assets',
    'console',
    'validation',
    ...contributionTabIds,
  ].includes(requestedTab)
    ? requestedTab
    : 'assets';
  window.__IWSDK_EDITOR_BOTTOM_TAB = activeTab;
  panel.dataset.activeTab = activeTab;
  const tabList = panel.querySelector('.bottom-panel-tabs');
  if (tabList) {
    tabList
      .querySelectorAll('[data-contribution-tab]')
      .forEach((entry) => entry.remove());
    tabList.insertAdjacentHTML(
      'beforeend',
      bottomPanelContributions
        .map((contribution) => renderBottomPanelContributionTab(contribution))
        .join(''),
    );
  }
  panel.querySelectorAll('[data-bottom-tab]').forEach((button) => {
    const tab = button.getAttribute('data-bottom-tab');
    if (tab === activeTab) {
      button.setAttribute('data-active', '');
    } else {
      button.removeAttribute('data-active');
    }
    if (button.dataset.bound !== 'true') {
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        window.__IWSDK_EDITOR_BOTTOM_TAB = tab || 'assets';
        renderDiagnosticsPanel(panel, session, camera);
      });
    }
  });

  const content = panel.querySelector('#bottom-panel-content');
  if (!content) {
    return;
  }

  if (activeTab === 'assets') {
    void ensureAssetThumbnails(session.document);
    return;
  }

  if (activeTab.startsWith('contribution:')) {
    const contributionId = activeTab.slice('contribution:'.length);
    const contribution = bottomPanelContributions.find(
      (entry) => entry.id === contributionId,
    );
    content.innerHTML = contribution
      ? renderBottomPanelContributionContent(contribution)
      : '<div class="empty-state">Unknown contribution tab</div>';
    bindEditorContributionActions(session, camera);
    return;
  }

  if (activeTab === 'validation') {
    content.innerHTML = renderValidationDiagnostics(window.__IWSDK_EDITOR_VALIDATION);
    bindValidationDiagnostics(content, session, camera);
    return;
  }

  content.innerHTML = '<div class="empty-state">Loading console logs...</div>';
  session
    .dispatch('scene_get_logs', { count: 12 })
    .then((result) => {
      if (window.__IWSDK_EDITOR_BOTTOM_TAB !== 'console') {
        return;
      }
      const logs = Array.isArray(result?.logs) ? [...result.logs].reverse() : [];
      content.innerHTML = logs.length
        ? \`
          <ul class="diagnostics-list">
            \${logs
              .map(
                (log) => \`
                  <li data-diagnostic-log="\${escapeHtml(log.level)}" data-state="\${escapeHtml(log.level)}">
                    <strong>\${escapeHtml(log.level)}</strong>
                    <span>\${escapeHtml(log.message)}</span>
                    <em>\${escapeHtml(formatTimestamp(log.timestamp))}</em>
                  </li>
                \`,
              )
              .join('')}
          </ul>
        \`
        : '<div class="empty-state">No console logs yet</div>';
    })
    .catch((error) => {
      content.innerHTML = \`<div class="empty-state">\${escapeHtml(String(error?.message || error))}</div>\`;
    });
}

function renderValidationDiagnostics(validation) {
  if (!validation) {
    return '<div class="empty-state">No validation result yet</div>';
  }
  const issues = Array.isArray(validation.issues) ? validation.issues : [];
  if (validation.valid === true && issues.length === 0) {
    return \`
      <ul class="diagnostics-list">
        <li data-diagnostic-validation="valid" data-state="info">
          <strong>Valid</strong>
          <span>Scene validation passed</span>
          <em>\${escapeHtml(String(issues.length))} issues</em>
        </li>
      </ul>
    \`;
  }
  if (issues.length === 0) {
    return \`
      <ul class="diagnostics-list">
        <li data-diagnostic-validation="unknown" data-state="warn">
          <strong>Unknown</strong>
          <span>Validation returned no issue details</span>
          <em>\${escapeHtml(String(validation.valid))}</em>
        </li>
      </ul>
    \`;
  }
  return \`
    <ul class="diagnostics-list">
      \${issues
        .map((issue, index) => {
          const path = issue?.path || issue?.nodeId || 'scene';
          const message = issue?.message || JSON.stringify(issue);
          const suggestedFix = issue?.suggestedFix;
          const severity = issue?.severity || 'error';
          return \`
            <li data-diagnostic-validation="\${escapeHtml(path)}" data-state="\${escapeHtml(severity)}" \${
              issue?.nodeId
                ? 'data-validation-node-id="' + escapeHtml(issue.nodeId) + '" tabindex="0"'
                : ''
            }>
              <strong>\${escapeHtml(path)}</strong>
              <span>\${escapeHtml(message)}\${
                suggestedFix
                  ? '<small class="diagnostic-fix">Fix: ' +
                    escapeHtml(suggestedFix) +
                    '</small>'
                  : ''
              }</span>
              <em>\${escapeHtml(severity + ' #' + (index + 1))}</em>
            </li>
          \`;
        })
        .join('')}
    </ul>
  \`;
}

function bindValidationDiagnostics(content, session, camera) {
  content.querySelectorAll('[data-validation-node-id]').forEach((entry) => {
    const selectIssueNode = async () => {
      const nodeId = entry.getAttribute('data-validation-node-id');
      if (!nodeId || !findNodeById(session.document, nodeId)) {
        return;
      }
      setEditorSelection([nodeId]);
      await session.dispatch('scene_select', { nodeIds: [nodeId] });
      renderUi(session, currentEditorCamera(camera));
    };
    entry.addEventListener('click', selectIssueNode);
    entry.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void selectIssueNode();
      }
    });
  });
}

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function inspectorSectionSummary(label, meta = '') {
  return \`
    <summary>
      <span class="inspector-section-title">
        <span class="inspector-section-chevron">\${renderLucideIcon('ChevronDown')}</span>
        <span>\${escapeHtml(label)}</span>
      </span>
      \${meta === '' ? '' : \`<span class="inspector-section-meta">\${escapeHtml(meta)}</span>\`}
    </summary>
  \`;
}

function renderAssetInspector(node, assets) {
  const assetId = nodeAssetId(node) || legacyPanelAssetId(node, assets);
  const selectedAssetExists = (assets || []).some(
    (asset) => asset.id === assetId,
  );
  const options = [
    '<option value="">No asset</option>',
    ...(assets || []).map(
      (asset) =>
        '<option value="' +
        escapeHtml(asset.id) +
        '" ' +
        (asset.id === assetId ? 'selected' : '') +
        '>' +
        escapeHtml(asset.name || asset.id) +
        '</option>',
    ),
  ].join('');
  const warning =
    assetId && !selectedAssetExists
      ? '<div class="asset-inspector-warning">Unknown asset reference: ' +
        escapeHtml(assetId) +
        '</div>'
      : '';

  return (
    '<div class="asset-inspector-card"><label class="asset-reference-row">' +
    '<span>Asset</span><select data-node-asset-ref>' +
    options +
    '</select></label>' +
    warning +
    '</div>'
  );
}

function renderMultiSelectInspector(inspector, session, camera, nodes) {
  const fields = [
    ['Position', 'position'],
    ['Rotation', 'rotationDeg'],
    ['Scale', 'scale'],
  ];
  inspector.innerHTML = \`
    <div class="inspector-node multi-select-inspector" data-multi-selection-count="\${nodes.length}">
      <div class="inspector-title">\${nodes.length} selected</div>
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.pinned"></div>
      <details class="inspector-section identity-editor" open>
        \${inspectorSectionSummary('Selection')}
        <div class="multi-selection-list">
          \${nodes
            .map((node) => '<code>' + escapeHtml(node.id) + '</code>')
            .join('')}
        </div>
      </details>
      <details class="inspector-section transform-section" open>
        \${inspectorSectionSummary('Common Transform')}
        <div class="transform-editor">
          \${fields
            .map(
              ([label, field]) => \`
                <div class="transform-row">
                  <span class="transform-row-label">\${label}</span>
                  \${[0, 1, 2]
                    .map((index) => {
                      const axis = ['X', 'Y', 'Z'][index];
                      const fieldKey = field + '.' + index;
                      const value = commonTransformFieldValue(nodes, field, index);
                      return (
                        '<label>' +
                        axis +
                        ' <input type="number" step="0.01" data-transform-field="' +
                        fieldKey +
                        '" value="' +
                        escapeHtml(value) +
                        '" placeholder="mixed" /></label>'
                      );
                    })
                    .join('')}
                </div>
              \`,
            )
            .join('')}
        </div>
        <div id="transform-editor-message"></div>
      </details>
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.global"></div>
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.section"></div>
    </div>
  \`;

  inspector.querySelectorAll('[data-transform-field]').forEach((input) => {
    input.addEventListener('change', () => {
      commitMultiTransformField(
        inspector,
        session,
        camera,
        nodes,
        input.getAttribute('data-transform-field') || '',
      );
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      if (event.target instanceof HTMLElement) {
        event.target.blur();
      }
    });
  });
}

function commitNodeTitleEdit(inspector, session, camera, node) {
  const input = inspector.querySelector('[data-node-title-edit]');
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const newNodeId = input.value.trim();
  if (newNodeId === node.id) {
    input.value = node.id;
    return;
  }
  runEditorMutation(async () => {
    const result = await session.dispatch('scene_apply_patch', {
      patch: {
        newNodeId,
        nodeId: node.id,
        op: 'renameNode',
      },
    });
    syncSelectionFromResult(result);
    clearValidationResult();
    renderUi(session, camera);
  });
}

function selectedSceneResource(documentValue, selection) {
  const id = selection?.id;
  switch (selection?.kind) {
    case 'prefabs':
      return scenePrefabs(documentValue).find((entry) => entry.id === id);
    case 'views':
      return (documentValue.authoring?.views || []).find((entry) => entry.id === id);
    case 'environment':
      return documentValue.environment;
    case 'patterns':
      return nodesInDocument(documentValue).find(
        (node) => node.id === id && nodeContentKind(node) === 'pattern',
      );
    default:
      return null;
  }
}

function resourcePatchForSelection(selection, value) {
  switch (selection.kind) {
    case 'prefabs':
      return { op: 'updatePrefab', prefab: value, prefabId: selection.id };
    case 'views':
      return { op: 'updateAuthoringView', view: value, viewId: selection.id };
    case 'environment':
      return { environment: value, op: 'setEnvironment' };
    case 'patterns':
      return { content: value.content, nodeId: selection.id, op: 'updateContent' };
    default:
      throw new Error('Unsupported scene resource kind');
  }
}

const ROOT_INTRINSIC_COMPONENT_IDS = new Set([
  'LevelRoot',
  'LevelTag',
  'Transform',
  'Visibility',
]);

function renderComponentEditor(
  components,
  componentSchemas,
  componentSchemaMap,
  excludedIds = new Set(),
  documentValue,
) {
  const componentEntries = Object.entries(components || {}).filter(([name]) => {
    const componentId = stripComponentPrefix(name);
    return (
      !['PanelUI', 'PanelDocument'].includes(componentId) &&
      componentSchemaMap.get(componentId)?.editor?.hidden !== true
    );
  });
  const componentRows = renderComponentRows(
    componentEntries,
    componentSchemaMap,
    documentValue,
  );
  const addableComponents = componentSchemas.filter(
    (schema) =>
      !excludedIds.has(schema.id) &&
      components?.[componentNameForSchema(schema)] == null,
  );
  return \`
    <details class="inspector-section component-editor" open>
      \${inspectorSectionSummary('Components', String(componentEntries.length))}
      <div id="component-editor-message"></div>
      \${componentRows}
      <button id="add-component" class="component-add-button" \${addableComponents.length > 0 ? '' : 'disabled'}>\${renderLucideIcon('Plus')}<span>Add Component</span></button>
      \${renderComponentPicker(addableComponents)}
    </details>
  \`;
}

function renderComponentPicker(componentSchemas) {
  const options = componentSchemas
    .map((schema) => {
      const name = schema.id;
      const description = distinctComponentDescription(
        schema.description,
        name,
      );
      const searchText = [name, schema.id, description, schema.source || '']
        .join(' ')
        .toLowerCase();
      return \`
        <button type="button" class="component-picker-option" data-component-picker-option="\${escapeHtml(schema.id)}" data-component-picker-search="\${escapeHtml(searchText)}">
          <strong>\${escapeHtml(name)}</strong>
          \${description ? '<span>' + escapeHtml(description) + '</span>' : ''}
        </button>
      \`;
    })
    .join('');
  return \`
    <dialog id="component-picker-dialog" class="component-picker-dialog" aria-labelledby="component-picker-title">
      <div class="component-picker-card">
        <header class="component-picker-header">
          <h3 id="component-picker-title">Add Component</h3>
          <button type="button" class="icon-button" data-close-component-picker aria-label="Close component picker" title="Close">\${renderLucideIcon('X')}</button>
        </header>
        <input id="component-picker-search" type="search" placeholder="Search components" aria-label="Search components" autocomplete="off" />
        <div id="component-picker-list" class="component-picker-list">\${options}</div>
        <div class="component-picker-empty" hidden>No matching components</div>
      </div>
    </dialog>
  \`;
}

function renderRootInspector(inspector, session, camera) {
  const componentSchemas = componentSchemasForDocument(session.document);
  const componentSchemaMap = componentSchemaMapForDocument(session.document);
  inspector.innerHTML = \`
    <div class="inspector-node scene-root-inspector" data-scene-root-inspector>
      <div class="inspector-title">Level Root</div>
      <div class="inspector-built-in-note">Built-in runtime entity</div>
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.pinned"></div>
      \${renderComponentEditor(
        session.document.components,
        componentSchemas,
        componentSchemaMap,
        ROOT_INTRINSIC_COMPONENT_IDS,
        session.document,
      )}
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.global"></div>
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.section"></div>
    </div>
  \`;
  bindComponentEditor(
    inspector,
    session,
    camera,
    { root: true },
    componentSchemaMap,
  );
}

function playerRigDescriptor(documentValue, target) {
  const player = documentValue.player || {};
  switch (target) {
    case 'player':
      return player;
    case 'camera':
      return player.camera || {};
    case 'head':
      return player.head || {};
    case 'left-target-ray':
      return player.leftTargetRay || {};
    case 'right-target-ray':
      return player.rightTargetRay || {};
    case 'left-grip':
      return player.leftGrip || {};
    case 'right-grip':
      return player.rightGrip || {};
    default:
      return {};
  }
}

function playerRigTargetLabel(target) {
  return {
    player: 'Player Space',
    camera: 'Camera',
    head: 'Head',
    'left-target-ray': 'Left Target Ray',
    'right-target-ray': 'Right Target Ray',
    'left-grip': 'Left Grip',
    'right-grip': 'Right Grip',
  }[target] || target;
}

function renderBuiltinTransformEditor(transform, target) {
  const fields = [
    ['Position', 'position', vec3FromTransform(transform, 'position', [0, 0, 0])],
    [
      'Rotation',
      'rotationDeg',
      vec3FromTransform(transform, 'rotationDeg', [0, 0, 0]),
    ],
    ['Scale', 'scale', scaleToEditorVec3(transform.scale)],
  ];
  const tracked = !['player', 'camera'].includes(target);
  return \`
    <details class="inspector-section transform-section" open>
      \${inspectorSectionSummary('Transform')}
      \${tracked ? '<div class="inspector-built-in-note">Preview pose; runtime tracking can override it.</div>' : ''}
      <div class="transform-editor">
        \${fields
          .map(
            ([label, field, values]) => \`
              <div class="transform-row">
                <span class="transform-row-label">\${label}</span>
                <label>X <input type="number" step="0.01" data-transform-field="\${field}.0" value="\${values[0]}" /></label>
                <label>Y <input type="number" step="0.01" data-transform-field="\${field}.1" value="\${values[1]}" /></label>
                <label>Z <input type="number" step="0.01" data-transform-field="\${field}.2" value="\${values[2]}" /></label>
                <button class="transform-reset-button icon-button" data-reset-builtin-transform="\${escapeHtml(field)}" title="Reset \${escapeHtml(label)}" aria-label="Reset \${escapeHtml(label)}">\${renderLucideIcon('RefreshCcw')}</button>
              </div>
            \`,
          )
          .join('')}
      </div>
      <div id="transform-editor-message"></div>
    </details>
  \`;
}

function bindBuiltinTransformEditor(
  inspector,
  session,
  camera,
  target,
  baseTransform,
) {
  const commit = () => {
    runTransformMutation(inspector, async () => {
      const nextTransform = readTransformFields(inspector, baseTransform);
      await session.dispatch('scene_apply_patch', {
        patch: {
          op: 'updatePlayerTransform',
          target,
          transform: nextTransform,
        },
      });
      clearValidationResult();
      renderUi(session, camera);
    });
  };
  inspector.querySelectorAll('[data-transform-field]').forEach((input) => {
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.target?.blur?.();
      }
    });
  });
  inspector
    .querySelectorAll('[data-reset-builtin-transform]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const field = button.getAttribute('data-reset-builtin-transform');
        const nextTransform = { ...baseTransform };
        if (field === 'position') nextTransform.position = [0, 0, 0];
        if (field === 'rotationDeg') nextTransform.rotationDeg = [0, 0, 0];
        if (field === 'scale') nextTransform.scale = 1;
        runTransformMutation(inspector, async () => {
          await session.dispatch('scene_apply_patch', {
            patch: {
              op: 'updatePlayerTransform',
              target,
              transform: nextTransform,
            },
          });
          clearValidationResult();
          renderUi(session, camera);
        });
      });
    });
}

function renderPlayerRigInspector(inspector, session, camera, target) {
  const componentSchemas = componentSchemasForDocument(session.document);
  const componentSchemaMap = componentSchemaMapForDocument(session.document);
  const descriptor = playerRigDescriptor(session.document, target);
  const transform = playerRigTransform(session.document, target);
  inspector.innerHTML = \`
    <div class="inspector-node builtin-inspector" data-builtin-inspector="\${escapeHtml(target)}">
      <div class="inspector-title">\${escapeHtml(playerRigTargetLabel(target))}</div>
      <div class="inspector-built-in-note">\${
        target === 'player'
          ? 'Authored player origin in the virtual environment'
          : 'Built-in runtime-tracked entity'
      }</div>
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.pinned"></div>
      \${target === 'player' ? renderBuiltinTransformEditor(transform, target) : ''}
      \${renderComponentEditor(
        descriptor.components,
        componentSchemas,
        componentSchemaMap,
        ROOT_INTRINSIC_COMPONENT_IDS,
        session.document,
      )}
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.global"></div>
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.section"></div>
    </div>
  \`;
  if (target === 'player') {
    bindBuiltinTransformEditor(
      inspector,
      session,
      camera,
      target,
      transform,
    );
  }
  bindComponentEditor(
    inspector,
    session,
    camera,
    { playerTarget: target },
    componentSchemaMap,
  );
}

function bindComponentFilePickers(
  inspector,
  session,
  camera,
  target,
  componentSchemaMap,
) {
  inspector.querySelectorAll('[data-component-file-browse]').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest('[data-component-index]');
      const fieldRow = button.closest('[data-component-field-row]');
      const input = fieldRow?.querySelector('[data-component-field]');
      if (!(row instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
        setComponentEditorMessage(inspector, 'File field is unavailable', true);
        return;
      }

      button.disabled = true;
      setComponentEditorMessage(inspector, 'Loading project files…');
      try {
        const url = new URL(projectFilesUrl, window.location.href);
        const subfolder = button.getAttribute('data-subfolder') || '';
        const fileTypes = button.getAttribute('data-file-types') || '';
        if (subfolder) url.searchParams.set('subfolder', subfolder);
        if (fileTypes) url.searchParams.set('fileTypes', fileTypes);
        const response = await fetch(url);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Unable to list project files');
        }
        const files = Array.isArray(payload.files) ? payload.files : [];
        showComponentFilePicker({
          files,
          fileTypes,
          initialValue: input.value,
          label:
            fieldRow.querySelector('.component-field-label')?.textContent ||
            'file',
          onSelect: (path) => {
            input.value = path;
            markComponentFieldAuthored(input);
            refreshInlineComponentFieldValidity(input);
            commitComponentRow(
              inspector,
              row,
              session,
              camera,
              target,
              componentSchemaMap,
            );
          },
        });
        setComponentEditorMessage(inspector, '');
      } catch (error) {
        setComponentEditorMessage(
          inspector,
          String(error?.message || error),
          true,
        );
      } finally {
        button.disabled = false;
      }
    });
  });
}

function showComponentFilePicker({
  files,
  fileTypes,
  initialValue,
  label,
  onSelect,
}) {
  document.getElementById('component-file-picker-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'component-file-picker-dialog';
  dialog.className = 'component-picker-dialog';
  const typeHint = fileTypes
    ? '<span>Showing ' + escapeHtml(fileTypes.split(',').join(', ')) + '</span>'
    : '';
  dialog.innerHTML =
    '<div class="component-picker-card">' +
    '<div class="component-picker-header"><h3>Choose ' +
    escapeHtml(label) +
    '</h3><button type="button" class="icon-button" data-close-file-picker aria-label="Close file picker">' +
    renderLucideIcon('X') +
    '</button></div>' +
    '<input class="component-file-picker-search" type="search" placeholder="Search project files" aria-label="Search project files" />' +
    typeHint +
    '<div class="component-picker-list"></div>' +
    '</div>';
  const list = dialog.querySelector('.component-picker-list');
  const search = dialog.querySelector('.component-file-picker-search');
  const entries = files.map((file) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'component-picker-option';
    option.dataset.filePickerPath = String(file.path || '');
    option.innerHTML = '<strong>' + escapeHtml(String(file.path || '')) + '</strong>';
    if (file.path === initialValue) {
      option.dataset.selected = 'true';
    }
    option.addEventListener('click', () => {
      onSelect(String(file.path || ''));
      dialog.close();
    });
    list?.append(option);
    return option;
  });
  const empty = document.createElement('p');
  empty.className = 'component-picker-empty';
  empty.textContent =
    files.length === 0
      ? 'No matching files found in public/.'
      : 'No files match this search.';
  empty.hidden = files.length > 0;
  list?.append(empty);
  const filter = () => {
    const query =
      search instanceof HTMLInputElement
        ? search.value.trim().toLocaleLowerCase()
        : '';
    let visibleCount = 0;
    for (const entry of entries) {
      const visible =
        query.length === 0 ||
        (entry.dataset.filePickerPath || '').toLocaleLowerCase().includes(query);
      entry.hidden = !visible;
      if (visible) visibleCount += 1;
    }
    empty.hidden = visibleCount > 0;
  };
  search?.addEventListener('input', filter);
  dialog
    .querySelector('[data-close-file-picker]')
    ?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  requestAnimationFrame(() => search?.focus());
}

function bindComponentEntityFields(
  inspector,
  session,
  camera,
  target,
  componentSchemaMap,
) {
  inspector.querySelectorAll('[data-component-entity-drop]').forEach((control) => {
    const row = control.closest('[data-component-index]');
    const input = control.querySelector('[data-component-field]');
    if (!(row instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
      return;
    }
    const setDropActive = (active) => {
      control.dataset.dropActive = active ? 'true' : 'false';
    };
    control.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes(ENTITY_REFERENCE_MIME)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    });
    control.addEventListener('dragleave', (event) => {
      if (event.relatedTarget instanceof Node && control.contains(event.relatedTarget)) {
        return;
      }
      setDropActive(false);
    });
    control.addEventListener('drop', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDropActive(false);
      try {
        const reference = parseEntityReferenceTransfer(event.dataTransfer);
        input.value = componentValueText(reference);
        markComponentFieldAuthored(input);
        await commitComponentRow(
          inspector,
          row,
          session,
          camera,
          target,
          componentSchemaMap,
        );
        renderUi(session, camera);
      } catch (error) {
        setComponentEditorMessage(
          inspector,
          String(error?.message || error),
          true,
        );
      }
    });
    control
      .querySelector('[data-component-entity-clear]')
      ?.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        input.value = 'null';
        markComponentFieldAuthored(input);
        await commitComponentRow(
          inspector,
          row,
          session,
          camera,
          target,
          componentSchemaMap,
        );
        renderUi(session, camera);
      });
  });
}

function parseEntityReferenceTransfer(transfer) {
  const text = transfer?.getData(ENTITY_REFERENCE_MIME) || '';
  const reference = parseComponentValue(text);
  if (
    reference?.type === 'node' &&
    typeof reference.id === 'string' &&
    reference.id.length > 0
  ) {
    return reference;
  }
  if (
    reference?.type === 'player-space' &&
    typeof reference.target === 'string'
  ) {
    return reference;
  }
  if (reference?.type === 'level-root') {
    return reference;
  }
  throw new Error('Drop an entity from the Scene Graph');
}

function bindComponentEditor(
  inspector,
  session,
  camera,
  target,
  componentSchemaMap,
) {
  inspector.querySelectorAll('[data-component-index]').forEach((row) => {
    row.dataset.committedValue = componentRowSignature(
      row,
      componentSchemaMap,
    );
    row.addEventListener('input', (event) => {
      markComponentFieldAuthored(event.target);
      refreshInlineComponentFieldValidity(event.target);
    });
    row.addEventListener('change', (event) => {
      const eventTarget = event.target;
      markComponentFieldAuthored(eventTarget);
      // Commit every completed field edit before an autosave/file-watcher
      // refresh can replace the inspector row. Numeric and vector inputs used
      // to remain DOM-only while focus moved between fields in the same row;
      // a concurrent refresh could then restore their previous document
      // value. commitComponentRow captures the whole row synchronously and
      // deduplicates the matching focusout commit through its signatures.
      if (isComponentEditTarget(eventTarget)) {
        commitComponentRow(
          inspector,
          row,
          session,
          camera,
          target,
          componentSchemaMap,
        );
      }
    });
    row.addEventListener('focusout', (event) => {
      if (!isComponentEditTarget(event.target)) {
        return;
      }
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && row.contains(nextTarget)) {
        return;
      }
      commitComponentRow(
        inspector,
        row,
        session,
        camera,
        target,
        componentSchemaMap,
      );
    });
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !isComponentEditTarget(event.target)) {
        return;
      }
      if (
        event.target instanceof HTMLTextAreaElement &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        return;
      }
      event.preventDefault();
      if (event.target instanceof HTMLElement) {
        event.target.blur();
      }
      commitComponentRow(
        inspector,
        row,
        session,
        camera,
        target,
        componentSchemaMap,
      );
    });
    row
      .querySelector('[data-remove-component]')
      ?.addEventListener('click', () => {
        runInspectorMutation(inspector, async () => {
          const component = row.getAttribute('data-component-name') || '';
          if (component.length === 0) {
            throw new Error('Component name is required');
          }
          await session.dispatch('scene_apply_patch', {
            patch: componentPatchForTarget(target, component),
          });
          clearValidationResult();
          renderUi(session, camera);
        });
      });
  });
  bindComponentFilePickers(
    inspector,
    session,
    camera,
    target,
    componentSchemaMap,
  );
  bindComponentEntityFields(
    inspector,
    session,
    camera,
    target,
    componentSchemaMap,
  );
  const componentPicker = inspector.querySelector('#component-picker-dialog');
  const componentSearch = inspector.querySelector('#component-picker-search');
  const componentOptions = [
    ...inspector.querySelectorAll('[data-component-picker-option]'),
  ];
  const filterComponentOptions = () => {
    const query =
      componentSearch instanceof HTMLInputElement
        ? componentSearch.value.trim().toLowerCase()
        : '';
    let visibleCount = 0;
    for (const option of componentOptions) {
      const visible =
        query.length === 0 ||
        (option.getAttribute('data-component-picker-search') || '').includes(
          query,
        );
      option.hidden = !visible;
      if (visible) visibleCount += 1;
    }
    const empty = inspector.querySelector('.component-picker-empty');
    if (empty instanceof HTMLElement) {
      empty.hidden = visibleCount > 0;
    }
  };
  inspector.querySelector('#add-component')?.addEventListener('click', () => {
    if (!(componentPicker instanceof HTMLDialogElement)) {
      throw new Error('Component picker dialog is unavailable');
    }
    if (componentSearch instanceof HTMLInputElement) {
      componentSearch.value = '';
    }
    filterComponentOptions();
    componentPicker.showModal();
    requestAnimationFrame(() => componentSearch?.focus());
  });
  componentSearch?.addEventListener('input', filterComponentOptions);
  componentPicker
    ?.querySelector('[data-close-component-picker]')
    ?.addEventListener('click', () => componentPicker.close());
  componentPicker?.addEventListener('click', (event) => {
    if (event.target === componentPicker) {
      componentPicker.close();
    }
  });
  for (const option of componentOptions) {
    option.addEventListener('click', () => {
      const schemaId = option.getAttribute('data-component-picker-option');
      const schema = schemaId ? componentSchemaMap.get(schemaId) : null;
      if (!schema) {
        throw new Error('Component schema is required');
      }
      componentPicker?.close();
      runInspectorMutation(inspector, async () => {
        const component = componentNameForSchema(schema);
        await session.dispatch('scene_apply_patch', {
          patch: componentPatchForTarget(
            target,
            component,
            defaultComponentProps(schema),
          ),
        });
        clearValidationResult();
        renderUi(session, camera);
      });
    });
  }
}

function renderInspector(inspector, session, camera, node) {
  if (!node) {
    inspector.innerHTML = \`
      <div class="inspector-node">
        <div class="inspector-title">No selection</div>
        <div class="editor-slot inspector-slot" data-editor-slot="inspector.global"></div>
      </div>
    \`;
    return;
  }

  const transform = node.transform || {};
  const position = vec3FromTransform(transform, 'position', [0, 0, 0]);
  const rotationDeg = vec3FromTransform(transform, 'rotationDeg', [0, 0, 0]);
  const scale = scaleToEditorVec3(transform.scale);
  const visible = authoredNodeVisible(node);
  const fields = [
    ['Position', 'position', position],
    ['Rotation', 'rotationDeg', rotationDeg],
    ['Scale', 'scale', scale],
  ];
  const assets = sceneAssets(session.document);
  const componentSchemas = componentSchemasForDocument(session.document);
  const componentSchemaMap = componentSchemaMapForDocument(session.document);
  inspector.innerHTML = \`
    <div class="inspector-node">
      <input class="inspector-title inspector-title-edit" data-node-title-edit value="\${escapeHtml(node.id)}" aria-label="Node name" title="Rename node" spellcheck="false" />
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.pinned"></div>
      <details class="inspector-section asset-editor" open>
        \${inspectorSectionSummary('Asset')}
        \${renderAssetInspector(node, assets)}
      </details>
      <details class="inspector-section visibility-section" open>
        \${inspectorSectionSummary('Visibility')}
        <div class="visibility-editor">
          <label class="component-field-row component-boolean-row">
            <span class="component-field-label">Visible</span>
            <input type="checkbox" data-node-visible \${visible ? 'checked' : ''} />
          </label>
        </div>
      </details>
      <details class="inspector-section transform-section" open>
        \${inspectorSectionSummary('Transform')}
        <div class="transform-editor">
          \${fields
            .map(
              ([label, field, values]) => \`
                <div class="transform-row">
                  <span class="transform-row-label">\${label}</span>
                  <label>X <input type="number" step="0.01" data-transform-field="\${field}.0" value="\${values[0]}" /></label>
                  <label>Y <input type="number" step="0.01" data-transform-field="\${field}.1" value="\${values[1]}" /></label>
                  <label>Z <input type="number" step="0.01" data-transform-field="\${field}.2" value="\${values[2]}" /></label>
                  <button class="transform-reset-button icon-button" data-reset-transform="\${escapeHtml(field)}" title="Reset \${escapeHtml(label)}" aria-label="Reset \${escapeHtml(label)}">\${renderLucideIcon('RefreshCcw')}</button>
                </div>
              \`,
            )
            .join('')}
        </div>
        <div id="transform-editor-message"></div>
      </details>
      \${renderComponentEditor(
        node.components,
        componentSchemas,
        componentSchemaMap,
        new Set(),
        session.document,
      )}
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.global"></div>
      <div class="editor-slot inspector-slot" data-editor-slot="inspector.section"></div>
    </div>
  \`;

  inspector.dataset.committedTransformValue = transformEditorSignature(
    readTransformFields(inspector, transform),
  );
  inspector.querySelector('[data-node-title-edit]')?.addEventListener('focus', (event) => {
    if (event.target instanceof HTMLInputElement) {
      event.target.select();
    }
  });
  inspector.querySelector('[data-node-title-edit]')?.addEventListener('focusout', () => {
    commitNodeTitleEdit(inspector, session, camera, node);
  });
  inspector.querySelector('[data-node-title-edit]')?.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.target.value = node.id;
      event.target.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
    }
  });
  inspector.querySelector('[data-node-visible]')?.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    const nextVisible = event.target.checked;
    runInspectorMutation(inspector, async () => {
      await session.dispatch('scene_apply_patch', {
        patch: nextVisible
          ? { nodeId: node.id, op: 'updateVisibility' }
          : { nodeId: node.id, op: 'updateVisibility', visible: false },
      });
      clearValidationResult();
      renderUi(session, camera);
    });
  });
  inspector.querySelectorAll('[data-transform-field]').forEach((input) => {
    input.addEventListener('change', () => {
      commitTransformFields(inspector, session, camera, node, transform);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      if (event.target instanceof HTMLElement) {
        event.target.blur();
      }
      commitTransformFields(inspector, session, camera, node, transform);
    });
  });
  inspector.querySelectorAll('[data-reset-transform]').forEach((button) => {
    button.addEventListener('click', () => {
      resetTransformField(
        inspector,
        session,
        camera,
        node,
        button.getAttribute('data-reset-transform') || '',
      );
    });
  });
  inspector.querySelector('[data-node-asset-ref]')?.addEventListener('change', (event) => {
    runInspectorMutation(inspector, async () => {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error('Missing asset reference field');
      }
      const asset = select.value;
      const patches = [{
        nodeId: node.id,
        op: 'updateContent',
        ...(asset ? { content: { asset, type: 'asset' } } : {}),
      }];
      for (const component of [
        'PanelUI',
        'com.iwsdk.components.PanelUI',
        'PanelDocument',
        'com.iwsdk.components.PanelDocument',
      ]) {
        if (node.components?.[component] != null) {
          patches.push({ component, nodeId: node.id, op: 'updateComponent' });
        }
      }
      const result = await dispatchEditorTransaction(session, patches);
      syncSelectionFromResult(result);
      clearValidationResult();
      renderUi(session, camera);
    });
  });
  bindComponentEditor(inspector, session, camera, node, componentSchemaMap);
}

function projectNodePosition(position, camera) {
  const view = camera?.view || 'quarter';
  switch (view) {
    case 'top':
      return [position[0], position[2]];
    case 'front':
      return [position[0], position[1]];
    case 'back':
      return [-position[0], position[1]];
    case 'left':
      return [position[2], position[1]];
    case 'right':
      return [-position[2], position[1]];
    case 'orbit': {
      const cameraPosition = camera?.position || [4, 3, 4];
      const length = Math.hypot(cameraPosition[0], cameraPosition[2]) || 1;
      const right = [cameraPosition[2] / length, -cameraPosition[0] / length];
      const depth = [cameraPosition[0] / length, cameraPosition[2] / length];
      return [
        position[0] * right[0] + position[2] * right[1],
        position[1] - (position[0] * depth[0] + position[2] * depth[1]) * 0.25,
      ];
    }
    case 'custom':
    case 'quarter':
    default:
      return [
        (position[0] - position[2]) * 0.7,
        position[1] - (position[0] + position[2]) * 0.25,
      ];
  }
}

function eventCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width === 0 ? 1 : canvas.width / rect.width;
  const scaleY = rect.height === 0 ? 1 : canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function roundVec3(values) {
  return values.map((value) => Number(value.toFixed(4)));
}

function pickCanvasNode(session, camera, canvas, event) {
  if (!editorWorldState) {
    return null;
  }
  editorWorldState.raycastCount += 1;
  const rect = canvas.getBoundingClientRect();
  editorWorldState.pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  editorWorldState.raycaster.setFromCamera(
    editorWorldState.pointer,
    editorWorldState.world.camera,
  );
  const intersections = editorWorldState.raycaster.intersectObjects(
    [
      ...editorWorldState.objectMap.values(),
      editorWorldState.builtInObjectMap.get('player'),
      editorWorldState.builtInObjectMap.get('level-root'),
    ].filter(Boolean),
    true,
  );
  for (const intersection of intersections) {
    if (intersection.object.userData?.iwsdkEditorPickable === false) {
      continue;
    }
    let current = intersection.object;
    while (current) {
      const nodeId = current.userData?.iwsdkSceneNodeId;
      if (typeof nodeId === 'string') {
        if (nodeOrAncestorMatches(session.document, nodeId, lockedOutlinerNodeIds)) {
          current = current.parent;
          continue;
        }
        const node = findNodeById(session.document, nodeId);
        if (node) {
          return {
            node,
            point: eventCanvasPoint(canvas, event),
          };
        }
      }
      const builtinTarget = current.userData?.iwsdkBuiltinTarget;
      if (typeof builtinTarget === 'string') {
        return {
          builtinTarget,
          point: eventCanvasPoint(canvas, event),
        };
      }
      current = current.parent;
    }
  }
  return null;
}

function pickNodeAtObjectCenter(session, nodeId) {
  if (!editorWorldState) {
    return null;
  }
  const object = editorWorldState.objectMap.get(nodeId);
  if (!object) {
    return { builtinTarget: null, nodeId: null };
  }
  const bounds = boundsForObjectWithoutEditorHelpers(object);
  if (!bounds) {
    return { builtinTarget: null, nodeId: null };
  }
  const projected = new Vector3();
  bounds.getCenter(projected);
  projected.project(editorWorldState.world.camera);
  if (!Number.isFinite(projected.z) || projected.z < -1 || projected.z > 1) {
    return { builtinTarget: null, nodeId: null };
  }
  const canvas = getCanvas();
  const rect = canvas.getBoundingClientRect();
  const hit = pickCanvasNode(session, editorWorldState.currentCamera, canvas, {
    clientX: rect.left + ((projected.x + 1) / 2) * rect.width,
    clientY: rect.top + ((1 - projected.y) / 2) * rect.height,
  });
  return {
    builtinTarget: hit?.builtinTarget || null,
    nodeId: hit?.node?.id || null,
  };
}

function renderCanvas(session, camera, size = {}) {
  if (!editorWorldState) {
    return;
  }
  syncEditorWorld(session, camera, size);
}

function editorWorkspaceSceneNodes(nodes, assets) {
  return (nodes || []).map((node) => ({
    ...node,
    assetKind:
      assets.find((asset) => asset.id === nodeAssetId(node))?.kind ||
      (legacyPanelAssetId(node, assets) ? 'uikitml' : null),
    expanded: !collapsedOutlinerNodeIds.has(node.id),
    children: editorWorkspaceSceneNodes(node.children || [], assets),
  }));
}

function editorDirtyStatus(session) {
  if (session.isDirty) {
    return 'Unsaved changes';
  }
  if (sceneFileReloadState.status === 'invalid') {
    return 'Invalid file; showing last valid scene';
  }
  if (sceneFileReloadState.status === 'conflict') {
    return 'File conflict';
  }
  return 'Saved';
}

function editorStatusStripText(session, nodeCount) {
  const documentState = session.isDirty
    ? 'unsaved changes'
    : sceneFileReloadState.status === 'invalid'
      ? 'invalid file; last valid scene shown'
      : sceneFileReloadState.status === 'conflict'
        ? 'file conflict'
        : 'saved';
  return [
    documentStatusLabel(),
    nodeCount + ' nodes',
    documentState,
    'IWSDK WebGL',
  ].join(' | ');
}

function renderUi(session, camera) {
  window.__IWSDK_EDITOR_CAMERA = camera;
  const documentValue = session.document;
  const assets = sceneAssets(documentValue);
  const nodes = nodesInDocument(documentValue);
  const selected = window.__IWSDK_EDITOR_SELECTION || [];
  loadVisibilityArrangements();

  workspaceUi?.update({
    assetCount: assets.length,
    dirty: session.isDirty,
    dirtyStatus: editorDirtyStatus(session),
    ghostedNodeIds: [...ghostedOutlinerNodeIds],
    hiddenNodeIds: [...hiddenOutlinerNodeIds],
    lockedNodeIds: [...lockedOutlinerNodeIds],
    nodeCount: nodes.length,
    nodes: editorWorkspaceSceneNodes(documentValue.nodes || [], assets),
    rootSelected: window.__IWSDK_EDITOR_ROOT_SELECTED === true,
    builtInSelection: window.__IWSDK_EDITOR_BUILTIN_SELECTION || null,
    sceneAssets: catalogSceneAssets(documentValue),
    scenePath: currentScenePath(),
    selectedNodeIds: selected,
    soloNodeId: soloOutlinerNodeId,
    statusStrip: editorStatusStripText(session, nodes.length),
    transformMode: editorWorldState?.transformMode || 'translate',
    transformSnapRotationDeg:
      editorWorldState?.transformSnap?.rotationDeg ??
      DEFAULT_EDITOR_TRANSFORM_SNAP.rotationDeg,
    transformSnapScale:
      editorWorldState?.transformSnap?.scale ??
      DEFAULT_EDITOR_TRANSFORM_SNAP.scale,
    transformSnapTranslation:
      editorWorldState?.transformSnap?.translation ??
      DEFAULT_EDITOR_TRANSFORM_SNAP.translation,
    transformSnapEnabled:
      editorWorldState?.transformSnapEnabled === true,
    transformSpace: editorWorldState?.transformSpace || 'local',
    viewportDrawDistance:
      editorWorldState?.drawDistance ?? DEFAULT_EDITOR_DRAW_DISTANCE,
    view: window.__IWSDK_WORKSPACE_VIEW || 'runtime',
  });

  const diagnosticsPanel = document.getElementById('editor-bottom-panel');
  if (diagnosticsPanel) {
    renderDiagnosticsPanel(diagnosticsPanel, session, camera);
  }

  const inspector = document.getElementById('inspector');
  if (inspector) {
    const builtInSelection = window.__IWSDK_EDITOR_BUILTIN_SELECTION;
    if (builtInSelection === 'level-root') {
      renderRootInspector(inspector, session, camera);
    } else if (builtInSelection) {
      renderPlayerRigInspector(
        inspector,
        session,
        camera,
        builtInSelection,
      );
    } else {
      const selectedNodes = selected
        .map((nodeId) => findNodeById(documentValue, nodeId))
        .filter(Boolean);
      if (selectedNodes.length > 1) {
        renderMultiSelectInspector(inspector, session, camera, selectedNodes);
      } else {
        renderInspector(inspector, session, camera, selectedNodes[0] || null);
      }
    }
  }
  renderEditorContributionSlots(session, camera);
  renderCanvas(session, camera);
}

function attachCanvasInteractions(canvas, session, getCamera, rerender) {
  let clickCandidate = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || eventHitsTransformControls(canvas, event)) {
      clickCandidate = null;
      return;
    }
    clickCandidate = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    };
  }, true);

  canvas.addEventListener('pointerup', async (event) => {
    const candidate = clickCandidate;
    clickCandidate = null;
    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.hypot(
      event.clientX - candidate.clientX,
      event.clientY - candidate.clientY,
    );
    if (distance > 4 || eventHitsTransformControls(canvas, event)) {
      return;
    }
    const camera = getCamera();
    const hit = pickCanvasNode(session, camera, canvas, event);
    if (!hit) {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
        setEditorSelection([]);
        await session.dispatch('scene_select', { nodeIds: [] });
        rerender();
      }
      return;
    }
    if (hit.builtinTarget) {
      setEditorBuiltinSelection(hit.builtinTarget);
      await session.dispatch('scene_select', { nodeIds: [] });
      setEditorBuiltinSelection(hit.builtinTarget);
      rerender();
      return;
    }
    const nodeIds = selectionForNodeClick(hit.node.id, event);
    setEditorSelection(nodeIds);
    await session.dispatch('scene_select', { nodeIds });
    rerender();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!editorWorldState?.transformDragState) {
      return;
    }
    queueMicrotask(() => {
      if (!editorWorldState?.transformDragState) {
        return;
      }
      updateSelectionHelpers();
      renderEditorWorld();
      if (editorWorldState.currentSession) {
        updateProjectedHitTargets(editorWorldState.currentSession);
      }
    });
  });

  canvas.addEventListener('pointercancel', (event) => {
    if (clickCandidate?.pointerId === event.pointerId) {
      clickCandidate = null;
    }
    updateHoverHelper(session, null);
    if (editorWorldState) {
      renderEditorWorld();
    }
  });

  canvas.addEventListener('pointerleave', () => {
    updateHoverHelper(session, null);
    if (editorWorldState) {
      renderEditorWorld();
    }
  });
}

function isTextEditingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable === true
  );
}

function attachKeyboardShortcuts(session, getCamera, rerender) {
  document.addEventListener('keydown', async (event) => {
    if (isTextEditingTarget(event.target)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (!event.metaKey && !event.ctrlKey) {
      if (key === 'escape') {
        if (cancelTransformControlDrag(session)) {
          event.preventDefault();
          rerender();
          return;
        }
        if ((window.__IWSDK_EDITOR_SELECTION || []).length > 0) {
          event.preventDefault();
          setEditorSelection([]);
          await session.dispatch('scene_select', { nodeIds: [] });
          rerender();
          return;
        }
      }
      if (key === 'w') {
        event.preventDefault();
        setTransformMode('translate');
        return;
      }
      if (key === 'e') {
        event.preventDefault();
        setTransformMode('rotate');
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        setTransformMode('scale');
        return;
      }
      if (key === 'f') {
        event.preventDefault();
        frameViewport('selection', getCamera());
        rerender();
        return;
      }
      if (key === 'q') {
        event.preventDefault();
        setTransformSpace(
          editorWorldState?.transformSpace === 'world' ? 'local' : 'world',
        );
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        const nodeIds = window.__IWSDK_EDITOR_SELECTION || [];
        if (nodeIds.length === 0) {
          return;
        }
        event.preventDefault();
        await runEditorMutation(async () => {
          for (const nodeId of nodeIds) {
            await session.dispatch('scene_remove_node', { nodeId });
          }
          setEditorSelection([]);
          clearValidationResult();
          rerender();
        });
        return;
      }
      if (key === '1') {
        event.preventDefault();
        const result = await session.dispatch('scene_set_camera', { view: 'top' });
        Object.assign(getCamera(), result.camera);
        rerender();
        return;
      }
      return;
    }
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }
    if (key === 'z') {
      event.preventDefault();
      await runEditorMutation(async () => {
        await session.dispatch(event.shiftKey ? 'scene_redo' : 'scene_undo', {});
        clearValidationResult();
        rerender();
      });
      return;
    }
    if (key === 'y') {
      event.preventDefault();
      await runEditorMutation(async () => {
        await session.dispatch('scene_redo', {});
        clearValidationResult();
        rerender();
      });
      return;
    }
    if (key === 's') {
      event.preventDefault();
      runEditorMutation(async () => {
        await session.dispatch('scene_save', {});
        rerender();
      });
      return;
    }
  });
}

async function sha256Base64Bytes(imageData) {
  const binary = atob(imageData);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return (
    'sha256:' +
    [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  );
}

async function init() {
  updateEditorStartupProgress('Loading editor modules…', 12);
  await loadEditorRuntimeDependencies();
  updateEditorStartupProgress('Opening workspace…', 28);
  createEditorFrame();
  attachWorkspaceViewControls();
  if (!hasConfiguredScenePath()) {
    updateEditorStartupProgress('Finding scene files…', 38);
    const listedScenes = await dispatchWorkspaceCommand(
      null,
      'scene_list_files',
      {},
    );
    const sceneFiles = listedScenes.files || [];
    if (sceneFiles.length === 1) {
      storeWorkspaceScenePath(sceneFiles[0].path);
      if (window.__IWSDK_WORKSPACE_VIEW === 'editor') {
        syncWorkspaceLocation('editor', currentScenePath(), { replace: true });
      }
    } else {
      runtimeHandles = (method) => handlesEditorMethodWithoutSession(method);
      runtimeDispatch = (method, params = {}) =>
        dispatchEditorMethodWithoutSession(method, params);
      window.IWSDK_SCENE_EDITOR = {
        listContributions: () => [],
        registerContribution: registerEditorContribution,
        runtime: window.FRAMEWORK_MCP_RUNTIME,
        session: null,
        unregisterContribution: unregisterEditorContribution,
      };
      window.dispatchEvent(new Event('iwsdk:mcp-runtime-ready'));
      completeEditorStartup();
      await renderScenePicker();
      return;
    }
  }
  updateEditorStartupProgress('Loading scene…', 48);
  const loadedScene = await fetchComposedSceneDocument(currentScenePath());
  if ((loadedScene.sourceDocument?.imports?.length || 0) > 0) {
    runtimeHandles = (method) => handlesEditorMethodWithoutSession(method);
    runtimeDispatch = (method, params = {}) =>
      dispatchEditorMethodWithoutSession(
        method,
        params,
        'The selected scene uses imports and cannot be edited directly. Flatten it first, then open the flattened scene.',
      );
    window.IWSDK_SCENE_EDITOR = {
      listContributions: () => [],
      registerContribution: registerEditorContribution,
      runtime: window.FRAMEWORK_MCP_RUNTIME,
      session: null,
      unregisterContribution: unregisterEditorContribution,
    };
    window.dispatchEvent(new Event('iwsdk:mcp-runtime-ready'));
    completeEditorStartup();
    await renderFlattenRequired(
      currentScenePath(),
      loadedScene.sourceDocument,
    );
    return;
  }
  const documentValue = loadedScene.document;
  updateComposedSceneIdentity(loadedScene);
  sceneFileReloadState = {
    conflict: false,
    diagnostics: [],
    lastReloadedAt: new Date().toISOString(),
    status: 'ready',
  };
  let activeCamera = {
    fov: 50,
    lookAt: [0, 0, 0],
    position: [4, 3, 4],
    projection: 'perspective',
    view: 'quarter',
  };
  setEditorSelection([]);

  const session = new SceneEditorSession({
    componentCatalog: runtimeComponentCatalog(),
    commitDocument: commitEditorDocument,
    document: documentValue,
    listAssets: () =>
      editorWorldState?.world?.assets?.catalog?.() ||
      editorWorldState?.world?.assets?.list?.() ||
      [],
    instantiateDocumentPreview: instantiateEditorDocumentPreview,
    preloadDocumentResources: preloadEditorDocumentResources,
    resolveAssetBounds: (assetId) =>
      editorWorldState?.world?.assets?.bounds?.(assetId),
    registerReviewCapture: (capture) =>
      fetchJsonOrThrow(reviewCapturesUrl, {
        body: JSON.stringify({
          action: 'issue',
          capture,
          scene: requireOpenScenePath(),
          sessionId: window.__IWSDK_SCENE_SESSION_ID,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    renderStats: () => {
      const stats = currentEditorRenderStats();
      if (!stats) {
        throw new Error('Editor renderer statistics are unavailable');
      }
      return stats;
    },
    renderAssetPreview: renderSceneAssetPreview,
    renderUIPreview: renderUIKitMLAssetPreview,
    rollbackDocument: rollbackEditorDocument,
    saveDocument: async (serializedDocument) => {
      if (sceneSourceHasImports) {
        const error = new Error(
          'Import-bearing compositions are preview-only. Flatten this scene before editing it; the flat output becomes the source of truth.',
        );
        Object.assign(error, {
          code: 'scene_imports_require_flattening',
          recoverable: true,
          retryAction: 'scene_flatten_file',
        });
        throw error;
      }
      const headers = { 'Content-Type': 'application/json' };
      if (sceneDocumentRevision != null) {
        headers['If-Match'] = sceneDocumentRevision;
      }
      const saveResponse = await fetch(activeDocumentUrl(), {
        body: serializedDocument,
        headers,
        method: 'PUT',
      });
      const text = await saveResponse.text();
      const json = text ? JSON.parse(text) : {};
      if (!saveResponse.ok) {
        // A failed save must retain the revision of the document loaded in the
        // editor. Adopting the disk revision would let a retry overwrite it.
        const error = sceneFetchError(json, text || saveResponse.statusText);
        Object.assign(error, {
          recoverable:
            json?.code === 'scene_revision_conflict' ||
            saveResponse.status >= 500,
          retryAction: 'scene_save',
        });
        throw error;
      }
      sceneDocumentRevision =
        json?.revision ||
        saveResponse.headers.get('X-IWSDK-Scene-Revision') ||
        sceneDocumentRevision;
      sceneSourceDocumentHash = json?.documentHash || sceneSourceDocumentHash;
      sceneComposedDocumentHash = json?.documentHash || sceneComposedDocumentHash;
      sceneRuntimeHash = json?.runtimeHash || sceneRuntimeHash;
      sceneFileReloadState = {
        conflict: false,
        diagnostics: [],
        lastReloadedAt: new Date().toISOString(),
        status: 'ready',
      };
      return json;
    },
    screenshot: async (camera, options) => {
      activeCamera = camera;
      const captureMode = options.captureMode || 'render';
      const restoreCaptureState =
        captureMode === 'render' ? beginRenderOnlyCapture() : () => {};
      try {
        renderCanvas(session, camera, options);
        await waitForAssetLoads();
        renderCanvas(session, camera, options);
        const canvas = getCanvas();
        const imageData = canvas.toDataURL('image/png').split(',')[1] || '';
        const screenshotSha256 = await sha256Base64Bytes(imageData);
        const hashes = await session.dispatch('scene_get_document', {});
        const renderStats = currentEditorRenderStats();
        if (!renderStats) {
          throw new Error('Editor renderer statistics are unavailable');
        }
        const nodeMaskRegions =
          captureMode === 'render'
            ? captureReviewNodeMaskRegions(
                session.document,
                canvas.width,
                canvas.height,
              )
            : {};
        return {
          activeLens: window.__IWSDK_EDITOR_REVIEW_LENS || 'final',
          camera,
          captureMode,
          documentHash: hashes?.documentHash,
          height: canvas.height,
          imageData,
          mimeType: 'image/png',
          ...(Object.keys(nodeMaskRegions).length === 0
            ? {}
            : { nodeMaskRegions }),
          renderStats,
          rendererEnvironment: renderStats?.environment,
          runtimeHash: hashes?.runtimeHash,
          screenshotSha256,
          visibleNodeIds: renderStats.visibleNodeIds,
          width: canvas.width,
        };
      } finally {
        restoreCaptureState();
        renderCanvas(session, activeCamera);
      }
    },
    setReviewLens: (lens) => {
      window.__IWSDK_EDITOR_REVIEW_LENS = lens;
      if (editorWorldState) {
        applyEditorReviewLens(session.document);
        renderEditorWorld();
      }
    },
  });
  const dispatchSceneCommand = session.dispatch.bind(session);
  session.dispatch = async (method, params = {}) => {
    const result = await dispatchSceneCommand(method, params);
    recordEditorEvent(method, result);
    let finalResult = result;
    if (method === 'scene_save') {
      reloadWorkspaceRuntimeFrame();
    } else if (
      shouldAutosaveAfterMethod(method) &&
      session.isDirty &&
      mutationResultIsValid(result)
    ) {
      try {
        finalResult = mergeAutosaveResult(
          result,
          await session.dispatch('scene_save', {}),
        );
      } catch (error) {
        const recoveryState = await dispatchSceneCommand(
          'scene_get_document',
          {},
        );
        if (error && typeof error === 'object') {
          Object.assign(error, {
            dirty: session.isDirty,
            documentHash: recoveryState?.documentHash,
            runtimeHash: recoveryState?.runtimeHash,
            retryAction: error.retryAction || 'scene_save',
          });
        }
        handleEditorMutationError(error);
        throw error;
      }
    }
    return finalResult;
  };

  updateEditorStartupProgress('Building scene preview…', 70);
  await createEditorWorld(session, activeCamera);
  updateEditorStartupProgress('Finalizing editor…', 94);
  installSceneFileWatcher(session, () => activeCamera);

  const runtime = window.FRAMEWORK_MCP_RUNTIME;
  runtimeHandles = (method) =>
    handlesWorkspaceMethod(method) || session.handles(method);
  runtimeDispatch = async (method, params = {}) => {
    let result = handlesWorkspaceMethod(method)
      ? await dispatchWorkspaceCommand(session, method, params)
      : await session.dispatch(method, params);
    if (method === 'scene_screenshot' && result && typeof result === 'object') {
      result = {
        ...result,
        activeFile: currentScenePath(),
        composedDocumentHash:
          sceneComposedDocumentHash || result.documentHash || null,
        conflict: sceneFileReloadState.conflict,
        diagnostics: sceneFileReloadState.diagnostics,
        runtimeHash: sceneRuntimeHash || result.runtimeHash || null,
        sourceDocumentHash: sceneSourceDocumentHash,
      };
    }
    syncSelectionFromResult(result);
    if (method === 'scene_validate') {
      setValidationResult(result);
    } else if (invalidatesValidation(method)) {
      if (result && typeof result === 'object' && result.valid === false) {
        setValidationResult(result);
      } else {
        clearValidationResult();
      }
    }
    if (method === 'scene_get_selection' || method === 'scene_select') {
      const selection = await session.dispatch('scene_get_selection', {});
      setEditorSelection(selection.nodeIds || []);
    }
    if (method === 'scene_set_camera' && result.camera) {
      activeCamera = result.camera;
    }
    renderUi(session, activeCamera);
    return result;
  };
  window.IWSDK_SCENE_EDITOR = {
    listContributions: () =>
      editorContributions().map(contributionPublicSnapshot),
    registerContribution: registerEditorContribution,
    runtime,
    session,
    unregisterContribution: unregisterEditorContribution,
  };
  window.IWSDK_SCENE_EDITOR_TEST_HOOKS = {
    applyReviewLensDocument: (documentValue) => {
      applyEditorReviewLens(documentValue);
      renderEditorWorld();
      return {
        visibleNodeIds: visibleEditorSceneNodeIds(),
      };
    },
    captureViewport: (camera = activeCamera, size = {}) => {
      renderCanvas(session, camera, size);
      const canvas = getCanvas();
      return {
        camera,
        imageDataLength: canvas.toDataURL('image/png').length,
        proof: createViewportProof(),
      };
    },
    getCamera: () => activeCamera,
    getComponentHelperState: (nodeId) => componentHelperProof(nodeId),
    getObjectSummary: () => ({
      ids: editorWorldState ? [...editorWorldState.objectMap.keys()] : [],
      objectCount: editorWorldState?.objectMap.size ?? 0,
    }),
    pickNodeAtObjectCenter: (nodeId) =>
      pickNodeAtObjectCenter(session, nodeId),
    getPanelPreviewState: (nodeId) => {
      const object = editorWorldState?.objectMap.get(nodeId);
      const preview = object?.children.find(
        (child) => child.userData?.iwsdkEditorPanelPreview === true,
      );
      const image = preview?.material?.map?.image;
      const context =
        image instanceof HTMLCanvasElement ? image.getContext('2d') : null;
      const node = findNodeById(
        editorWorldState?.currentSession?.document,
        nodeId,
      );
      const panelProps = panelPropsForNode(node);
      const canonicalConfig = panelProps
        ? resolveEditorPanelConfig(panelProps.config)
        : null;
      const cornerAlpha = context
        ? [
            [0, 0],
            [image.width - 1, 0],
            [0, image.height - 1],
            [image.width - 1, image.height - 1],
          ].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3])
        : null;
      const roundedCornerAlpha = context
        ? [
            [0.06, 0.06],
            [0.94, 0.06],
            [0.06, 0.94],
            [0.94, 0.94],
          ].map(([x, y]) =>
            context.getImageData(
              Math.round((image.width - 1) * x),
              Math.round((image.height - 1) * y),
              1,
              1,
            ).data[3],
          )
        : null;
      return preview
        ? {
            cornerAlpha,
            computedSize:
              preview.userData?.iwsdkEditorPanelComputedSize || null,
            materialType: preview.material?.type || null,
            pixelSize: image
              ? { height: image.height, width: image.width }
              : null,
            roundedCornerAlpha,
            textureColorSpace: preview.material?.map?.colorSpace || null,
            toneMapped: preview.material?.toneMapped ?? null,
            transparent: preview.material?.transparent ?? null,
            usesAssetThumbnail:
              canonicalConfig != null && context != null
                ? assetThumbnailCache.get(canonicalConfig) ===
                  image.toDataURL('image/png')
                : false,
            scale: preview.scale.toArray(),
          }
        : null;
    },
    getPanelPreviewRendererState: () =>
      editorPanelPreviewRendererState
        ? {
            contextLossCount:
              editorPanelPreviewRendererState.contextLossCount,
            contextLost: editorPanelPreviewRendererState.contextLost,
            createdCount: editorPanelPreviewRendererState.createdCount,
            renderCount: editorPanelPreviewRendererState.renderCount,
          }
        : null,
    forcePanelPreviewContextLoss: () => {
      const state = getEditorPanelPreviewRenderer();
      state.renderer.forceContextLoss?.();
      state.contextLost = true;
      return {
        createdCount: state.createdCount,
        contextLost: state.contextLost,
      };
    },
    getPreviewVisibilityState: () => ({
      ...currentPreviewVisibilityState(),
      raycastCount: editorWorldState?.raycastCount ?? 0,
      objects: Object.fromEntries(
        [...(editorWorldState?.objectMap || new Map())].map(
          ([nodeId, object]) => [
            nodeId,
            {
              visible: object.visible,
            },
          ],
        ),
      ),
    }),
    setObjectRenderState: (nodeId, state = {}) => {
      const object = editorWorldState?.objectMap.get(nodeId);
      if (!object) {
        throw new Error('Unknown editor object "' + nodeId + '"');
      }
      if (typeof state.visible === 'boolean') {
        object.visible = state.visible;
        if (editorWorldState.previewVisibilityBaseline?.has(object)) {
          editorWorldState.previewVisibilityBaseline.set(object, state.visible);
        }
      }
      if (state.layer != null) {
        if (!Number.isInteger(state.layer) || state.layer < 0 || state.layer > 31) {
          throw new Error('Object layer must be an integer from 0 through 31');
        }
        object.traverse((entry) => entry.layers.set(state.layer));
      }
      renderEditorWorld();
      return {
        layerMask: object.layers.mask,
        visible: object.visible,
      };
    },
    getContributions: () => editorContributionProof(),
    getAuthoredRenderState: () => authoredRenderStateProof(),
    getDomeFadeState: () => domeFadeStateProof(),
    getEnvironmentDomeState: () => {
      const camera = editorWorldState?.world?.camera;
      let dome = null;
      editorWorldState?.world?.scene?.traverse((object) => {
        if (object.userData?.iwsdkSceneDomeGradient != null) {
          dome = object;
        }
      });
      return {
        cameraFar: camera?.far ?? null,
        cameraPosition: camera?.position?.toArray?.() ?? null,
        domeClipDepth:
          dome?.material?.vertexShader?.includes?.('clipPosition.xyww') ?? false,
        domePosition: dome?.position?.toArray?.() ?? null,
        domeRadius: dome?.scale?.x ?? null,
        domeTranslationFree:
          dome?.material?.vertexShader?.includes?.('mat3(viewMatrix)') ?? false,
      };
    },
    getProof: () => createViewportProof(),
    getResourceState: () => editorResourceStateProof(),
    getRendererGlobals: () => rendererGlobalsProof(),
    getTransformControlObjectTransform: () =>
      objectTransformProof(editorWorldState?.transformControls?.object),
    getTransformControlAxisVisibility: () => ({
      x: editorWorldState?.transformControls?.showX ?? null,
      y: editorWorldState?.transformControls?.showY ?? null,
      z: editorWorldState?.transformControls?.showZ ?? null,
    }),
    findTransformControlPointerTarget: (axis = 'X') =>
      findTransformControlPointerTarget(axis),
    beginTransformControlDrag: (transform) => {
      const nodeId = selectedNodeId();
      if (!nodeId || !editorWorldState?.transformControls?.object) {
        throw new Error('A selected node with attached transform controls is required');
      }
      const node = findNodeById(session.document, nodeId);
      if (!node) {
        throw new Error('Selected node "' + nodeId + '" is missing');
      }
      editorWorldState.transformDragState = {
        nodeId,
        startTransform: cloneTransform(node.transform || {}),
      };
      editorWorldState.orbitControls.enabled = false;
      if (transform) {
        applyNodeTransform(editorWorldState.transformControls.object, transform);
      }
      updateSelectionHelpers();
      renderEditorWorld();
      updateProjectedHitTargets(session);
      return {
        documentTransform: findNodeById(session.document, nodeId)?.transform,
        objectTransform: objectTransformProof(editorWorldState.transformControls.object),
        proof: createViewportProof(),
      };
    },
    cancelTransformControlDrag: () => {
      const cancelled = cancelTransformControlDrag(session);
      renderUi(session, activeCamera);
      return {
        cancelled,
        proof: createViewportProof(),
      };
    },
    setCamera: async (camera) => {
      const result = await session.dispatch('scene_set_camera', camera);
      activeCamera = result.camera;
      renderUi(session, activeCamera);
      return result;
    },
    frameViewport: (target = 'selection') => {
      activeCamera = frameViewport(target, activeCamera) || activeCamera;
      renderUi(session, activeCamera);
      return activeCamera;
    },
    setTransformMode: (mode) => setTransformMode(mode),
    setTransformSnap: (mode, value) => setTransformSnapValue(mode, value),
    setSurfacePlacementEnabled: (enabled) =>
      setSurfacePlacementEnabled(enabled),
    setTransformSnapEnabled: (enabled) => setTransformSnapEnabled(enabled),
    setTransformSpace: (space) => setTransformSpace(space),
    setNextMaterializationFailure: (phase, message) => {
      if (!['detached', 'install'].includes(phase)) {
        throw new Error('Materialization failure phase must be detached or install');
      }
      editorWorldState.nextMaterializationFailure = {
        message: String(message || 'Injected ' + phase + ' failure'),
        phase,
      };
    },
    hasSharedAsset: (key) => editorWorldState?.world.assets.has(String(key)) === true,
    simulateTransformControlCommit: async (transform, scaleAxis = null) => {
      const nodeId = selectedNodeId();
      if (!nodeId || !editorWorldState?.transformControls?.object) {
        throw new Error('A selected node with attached transform controls is required');
      }
      const node = findNodeById(session.document, nodeId);
      if (!node) {
        throw new Error(\`Selected node "\${nodeId}" is missing\`);
      }
      editorWorldState.transformDragState = {
        nodeId,
        mode: editorWorldState.transformMode,
        scaleAxis,
        startTransform: cloneTransform(node.transform || {}),
      };
      applyNodeTransform(editorWorldState.transformControls.object, transform);
      await commitTransformControlDrag(session, () => renderUi(session, activeCamera));
      return {
        documentTransform: findNodeById(session.document, nodeId)?.transform,
        proof: createViewportProof(),
      };
    },
  };

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('#scene-graph-context-menu')
    ) {
      return;
    }
    hideSceneGraphContextMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideSceneGraphContextMenu();
    }
  });
  attachCanvasInteractions(
    getCanvas(),
    session,
    () => activeCamera,
    () => renderUi(session, activeCamera),
  );
  attachKeyboardShortcuts(
    session,
    () => activeCamera,
    () => renderUi(session, activeCamera),
  );

  renderUi(session, activeCamera);
  window.dispatchEvent(new Event('iwsdk:mcp-runtime-ready'));
  completeEditorStartup();
}

function shouldRetryEditorStartup(error) {
  const message = String(error?.message || error);
  if (!message.includes('Failed to fetch dynamically imported module')) {
    return false;
  }
  if (sessionStorage.getItem(EDITOR_OPTIMIZE_RELOAD_KEY) === '1') {
    return false;
  }
  sessionStorage.setItem(EDITOR_OPTIMIZE_RELOAD_KEY, '1');
  window.location.reload();
  return true;
}

init().then(() => {
  window.__IWSDK_SCENE_EDITOR_READY = true;
  sessionStorage.removeItem(EDITOR_OPTIMIZE_RELOAD_KEY);
}).catch((error) => {
  if (shouldRetryEditorStartup(error)) {
    return;
  }
  console.error('[IWSDK Scene Editor] Failed to initialize:', error);
  setRoot(\`<main class="editor-error"><h1>IWSDK Scene Editor</h1><pre>\${String(error?.message || error)}</pre></main>\`);
});
`;
}

export function createEditorShellHtml(
  injectionVirtualId: string,
  editorRuntimeVirtualId: string,
  editorStylesheetVirtualId: string,
  documentUrl: string,
  options: {
    projectFilesUrl?: string;
    publishUrl?: string;
    reviewCapturesUrl?: string;
    reviewsUrl?: string;
    runtimePreflightUrl?: string;
    sceneFilesUrl?: string;
  } = {},
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="${editorStylesheetVirtualId}" />
    <title>IWSDK Scene Editor</title>
    <script>
      window.__IWER_MCP_MANAGED = true;
      window.__IWSDK_MCP_PAGE_ROLE = 'editor';
      window.__IWSDK_SCENE_SESSION_ID =
        window.__IWSDK_SCENE_SESSION_ID ||
        'scene-' + Math.random().toString(36).slice(2);
      window.__IWSDK_EDITOR_CONFIG = {
        documentUrl: ${JSON.stringify(documentUrl)},
        projectFilesUrl: ${JSON.stringify(options.projectFilesUrl ?? '/__iwsdk/workspace/files')},
        publishUrl: ${JSON.stringify(options.publishUrl ?? '/__iwsdk/workspace/publish')},
        reviewCapturesUrl: ${JSON.stringify(options.reviewCapturesUrl ?? '/__iwsdk/workspace/reviews/captures')},
        reviewsUrl: ${JSON.stringify(options.reviewsUrl ?? '/__iwsdk/workspace/reviews')},
        runtimePreflightUrl: ${JSON.stringify(options.runtimePreflightUrl ?? '/__iwsdk/workspace/runtime-preflight')},
        sceneFilesUrl: ${JSON.stringify(options.sceneFilesUrl ?? '/__iwsdk/workspace/scenes')}
      };
      window.__IWSDK_HOST_BROWSER_ENVIRONMENT =
        window.__IWSDK_HOST_BROWSER_ENVIRONMENT || Object.freeze({
          platform: navigator.userAgentData?.platform || navigator.platform || null,
          userAgent: navigator.userAgent
        });
    </script>
    <script>
      import(${JSON.stringify(editorRuntimeVirtualId)}).catch((error) => {
        console.error('[IWSDK Scene Editor] Failed to load runtime module:', error);
        const root = document.getElementById('root');
        const message = String(error && (error.stack || error.message) || error)
          .replace(/[&<>]/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
          })[character]);
        if (root) {
          root.innerHTML =
            '<main class="editor-error"><h1>IWSDK Scene Editor</h1><pre>' +
            message +
            '</pre></main>';
        }
      });
    </script>
    <script type="module" src="${injectionVirtualId}"></script>
  </head>
  <body>
    <div id="root">
      <main class="editor-loading" role="status" aria-live="polite">
        <div class="editor-loading-content">
          <div class="editor-loading-spinner" aria-hidden="true"></div>
        <h1>IWSDK Scene Editor</h1>
          <p id="editor-loading-status">Starting editor…</p>
          <div
            id="editor-loading-track"
            class="editor-loading-track"
            role="progressbar"
            aria-label="Editor startup"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span
              id="editor-loading-progress"
              class="editor-loading-progress editor-loading-progress-indeterminate"
            ></span>
          </div>
        </div>
      </main>
    </div>
  </body>
</html>`;
}
