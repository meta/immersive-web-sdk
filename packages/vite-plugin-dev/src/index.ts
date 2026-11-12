/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { homedir, tmpdir } from 'os';
import * as path from 'path';
import type { Duplex } from 'stream';
import { inflateSync } from 'zlib';
import {
  INTERNAL_BROWSER_PROBE_METHOD,
  RUNTIME_OPERATIONS,
  INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV,
  INTERNAL_RUNTIME_SHUTDOWN_METHOD,
  type RuntimeBrowserClient,
  type RuntimeBrowserProbeResult,
  type RuntimeBrowserState,
  type RuntimeIssueCause,
  type RuntimeIssueInfo,
} from '@iwsdk/cli/contract';
import { acquireRuntimeOwner } from '@iwsdk/cli/runtime-owner';
import {
  normalizeProjectDevOptions,
  PROJECT_EMULATOR_ROOMS,
  resolveProjectEmulatorRoom,
  type IwsdkProjectManifestV1,
} from '@iwsdk/core/project';
import {
  canonicalizeJson,
  composeSceneDocument,
  hashRuntimeSceneDocument,
  hashSceneDocument,
  parseSceneDocument,
  parseSceneReview,
  resolveSceneAuthoringTransforms,
  serializeSceneDocument,
  serializeSceneReview,
  validateSceneReviewAgainstDocument,
  type SceneDocument,
  type SceneFeature,
  type SceneNode,
  type SceneObjectInspectionSpec,
  type SceneReview,
} from '@iwsdk/scene-composition';
import { getCertificate } from '@vitejs/plugin-basic-ssl';
import open from 'open';
import { loadEnv, searchForWorkspaceRoot } from 'vite';
import type {
  ModuleNode,
  Plugin,
  ResolvedConfig,
  ViteDevServer,
  WebSocketClient,
} from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  hasManagedCommandRoles,
  hasReadyBrowserCommandPath,
  isBrowserBridgeConnectionAllowed,
  isSameBrowserEndpoint,
  normalizeBrowserHello,
  normalizeDeviceClass,
} from './browser-client-routing.js';
import { createUnavailableBrowserRpcError } from './browser-rpc-errors.js';
import {
  BUNDLED_FONT_MODULES,
  createDisabledBundledFontsModule,
  resolveBundledFontNames,
  resolveBundledLucideIcons,
  rewriteThreeDecoderDefaults,
  rewriteUIKitMLLucideKit,
} from './bundle-feature-gates.js';
import {
  createEditorRuntimeModuleSource,
  createEditorShellHtml,
  getCoreModuleImport,
  getEditorSessionModuleImport,
} from './editor/editor-runtime-source.js';
import { EDITOR_SHELL_CSS } from './editor/editor-shell-styles.js';
import {
  ensureChromiumInstalled,
  launchManagedBrowser,
  MANAGED_WORKSPACE_QUERY,
  type ManagedBrowser,
  type ManagedRuntimePublishEvidence,
} from './headless-browser.js';
import {
  buildInjectionBundle,
  createInjectionModuleSource,
  resolveInjectionRuntimeFile,
  resolveInjectionRuntimeId,
} from './injection-bundler.js';
import { ManagedBrowserLifecycle } from './managed-browser/lifecycle.js';
import { resolveManagedRenderMode } from './managed-browser/render-mode.js';
import { createRelayHandler } from './mcp-relay.js';
import { reportSessionStart, reportSessionEnd } from './metavr-telemetry.js';
import {
  loadIwsdkProject,
  resolveProjectModulePath,
  type LoadedIwsdkProject,
} from './project-config.js';
import {
  assertSceneReviewWorkflowPublishable,
  beginSceneReviewWorkflow,
  commitSceneReviewTransition,
  planSceneReviewTransition,
  recordSceneReviewWorkflowReview,
  SceneReviewWorkflowError,
  type SceneReviewTransitionPlan,
} from './review-workflow-store.js';
import {
  evaluateRuntimePresentationParity,
  evaluateRuntimeSceneParity,
  explainRuntimeCountDifferences,
  type RuntimeCountExplanation,
  type RuntimePresentationParityResult,
} from './runtime-proof-parity.js';
import {
  registerRuntimeSession,
  RuntimeSessionOwnershipError,
  setRuntimeSessionBrowserAutomation,
  setRuntimeSessionBrowserState,
  unregisterRuntimeSession,
  unregisterRuntimeSessionSync,
} from './runtime-session.js';
import type {
  AiOptions,
  DevPluginOptions,
  EmulatorOptions,
  ProcessedDevOptions,
  InjectionBundleResult,
  AiMode,
  WorkspaceOptions,
  TargetDevicePreviewOptions,
} from './types.js';
import { validateUIKitMLDirectory } from './uikitml-preflight.js';

interface ManagedBrowserCommandTarget {
  deviceClass?: 'managed' | 'physical';
  headsetId?: string;
  sessionId?: string;
  browserEpoch?: number;
  pageId?: string;
  role?: string;
  tabGeneration?: number;
}

interface ManagedBrowserRpcRequest {
  id: string;
  params?: Record<string, unknown>;
  target?: ManagedBrowserCommandTarget;
}

class ManagedBrowserTargetError extends Error {
  readonly code = 'stale_browser_tab';

  constructor(
    readonly expectedTab: ManagedBrowserCommandTarget,
    readonly currentTab: { id: string | null; generation: number | null },
  ) {
    super(
      `Browser tab precondition failed; current application ${JSON.stringify(
        currentTab,
      )} does not match ${JSON.stringify(expectedTab)}. Re-query state and retry with its _tab value.`,
    );
  }
}

// Export types for users
export type {
  DevPluginOptions,
  AiOptions,
  AiMode,
  EmulatorOptions,
  DevelopmentHttpsOptions,
  ProductionBundleOptions,
  UIKitMLBundledFontName,
  WorkspaceOptions,
  TargetDevicePreviewOptions,
  ProcessedDevOptions,
  IWERPluginOptions,
  SEMOptions,
} from './types.js';

/**
 * Derive internal headless / devUI / viewport settings from the AI mode.
 */
const MODE_SETTINGS: Record<
  AiMode,
  { headless: boolean; devUI: boolean; fixedViewport: boolean }
> = {
  agent: { headless: true, devUI: false, fixedViewport: true },
  collaborate: { headless: false, devUI: true, fixedViewport: false },
};

const VIRTUAL_ID = '/@iwer-injection-runtime';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;
const EDITOR_RUNTIME_ID = '/@iwsdk-editor-runtime';
const RESOLVED_EDITOR_RUNTIME_ID = '\0' + EDITOR_RUNTIME_ID;
const EDITOR_STYLESHEET_ID = '/@iwsdk-editor-styles.css';
const RESOLVED_EDITOR_STYLESHEET_ID = '\0' + EDITOR_STYLESHEET_ID;
const ASSET_MANIFEST_ID = '/@iwsdk-asset-manifest';
const RESOLVED_ASSET_MANIFEST_ID = '\0' + ASSET_MANIFEST_ID;
const COMPONENT_MANIFEST_ID = '/@iwsdk-component-manifest';
const RESOLVED_COMPONENT_MANIFEST_ID = '\0' + COMPONENT_MANIFEST_ID;
const PROJECT_MODULE_ID = 'virtual:iwsdk-project';
const RESOLVED_PROJECT_MODULE_ID = '\0' + PROJECT_MODULE_ID;
const HOT_CLIENT_ROLE_EVENT = 'iwsdk:hot-client-role';
const RUNTIME_SOURCE_CHANGE_EVENT = 'iwsdk:runtime-source-change';
const DISABLED_HAVOK_ID = 'virtual:iwsdk-disabled-havok';
const RESOLVED_DISABLED_HAVOK_ID = `\0${DISABLED_HAVOK_ID}`;
const DISABLED_BUNDLED_FONTS_ID = 'virtual:iwsdk-disabled-bundled-fonts';
const RESOLVED_DISABLED_BUNDLED_FONTS_ID = `\0${DISABLED_BUNDLED_FONTS_ID}`;

function createDisabledHavokModule(): string {
  return `export default async function disabledHavok() {
  throw new Error('[IWSDK] Physics was excluded from this production build because world.features.physics is false.');
}`;
}

function createProductionPayloadWorkerPlugin(): Plugin {
  return {
    name: 'iwsdk-production-payload-worker',
    resolveId(id) {
      if (id === DISABLED_HAVOK_ID) {
        return RESOLVED_DISABLED_HAVOK_ID;
      }
      if (id === DISABLED_BUNDLED_FONTS_ID) {
        return RESOLVED_DISABLED_BUNDLED_FONTS_ID;
      }
    },
    load(id) {
      if (id === RESOLVED_DISABLED_HAVOK_ID) {
        return createDisabledHavokModule();
      }
      if (id === RESOLVED_DISABLED_BUNDLED_FONTS_ID) {
        return createDisabledBundledFontsModule();
      }
    },
  };
}
const EDITOR_ROUTE = '/__iwsdk/editor';
const WORKSPACE_ROUTE = '/__iwsdk/workspace';
const WORKSPACE_SCENES_ROUTE = `${WORKSPACE_ROUTE}/scenes`;
const WORKSPACE_FILES_ROUTE = `${WORKSPACE_ROUTE}/files`;
const WORKSPACE_REVIEWS_ROUTE = `${WORKSPACE_ROUTE}/reviews`;
const WORKSPACE_REVIEW_CAPTURES_ROUTE = `${WORKSPACE_REVIEWS_ROUTE}/captures`;
const WORKSPACE_REVIEW_TRANSITIONS_ROUTE = `${WORKSPACE_REVIEWS_ROUTE}/transitions`;
const WORKSPACE_PUBLISH_ROUTE = `${WORKSPACE_ROUTE}/publish`;
const WORKSPACE_OPEN_RUNTIME_ROUTE = `${WORKSPACE_ROUTE}/open-runtime`;
const WORKSPACE_RUNTIME_PREFLIGHT_ROUTE = `${WORKSPACE_ROUTE}/runtime-preflight`;
const OPTIMIZER_EXCLUSIONS = [
  '@iwsdk/core',
  '@zappar/msdf-generator',
  'lucide',
  'preact',
  'preact/hooks',
  'preact/jsx-runtime',
];
const OPTIMIZER_INCLUSIONS = [
  '@iwsdk/core > elics',
  '@iwsdk/scene-composition',
  'three',
  'three-viewport-gizmo',
  'three/examples/jsm/controls/OrbitControls.js',
  'three/examples/jsm/controls/TransformControls.js',
];
const RUNTIME_STATE_WATCH_IGNORE = /(?:^|[/\\])\.iwsdk[/\\]runtime(?:[/\\]|$)/u;
const MANAGED_WORKSPACE_HEADER = 'x-iwsdk-managed-workspace';
const SCENE_ROOT_RELATIVE_PATH = path.join('public', 'scenes');
const SCENE_FILE_SUFFIX = '.iwsdk.scene.json';
const REVIEW_ROOT_SUFFIX = '.iwsdk.review';
const REVIEW_FILE_SUFFIX = '.iwsdk.scene-review.json';
const REVIEW_CAPTURE_FILE_SUFFIX = '.iwsdk.review-capture.json';
const OBJECT_INSPECTION_FILE_SUFFIX = '.iwsdk.object-inspection.json';
const RUNTIME_PREFLIGHT_FILE_SUFFIX = '.iwsdk.runtime-preflight.json';
const RUNTIME_PROOF_FILE_SUFFIX = '.iwsdk.runtime-proof.json';
const MAX_REVIEW_CAPTURE_BODY_BYTES = 48 * 1024 * 1024;
const MAX_REVIEW_RECORD_BODY_BYTES = 4 * 1024 * 1024;
const MAX_ISSUED_REVIEW_CAPTURE_BYTES = 128 * 1024 * 1024;
const MAX_ISSUED_REVIEW_CAPTURES = 64;
const MAX_ISSUED_REVIEW_TRANSITIONS = 64;

type ResolvedDevPluginOptions = DevPluginOptions & {
  /** Internal module paths resolved exclusively from iwsdk.config.json. */
  assetManifest?: string;
  componentManifest?: string;
  /** Operator-session switch populated only from the IWSDK CLI. */
  nativeXRControl?: boolean;
  /** Manifest-owned, development-server-only physical headset preview. */
  targetDevicePreview?: TargetDevicePreviewOptions;
};

/**
 * Process and normalize plugin options with defaults
 */
function processOptions(
  options: ResolvedDevPluginOptions = {},
): ProcessedDevOptions {
  const bridgeReadyTimeoutMs = options.bridgeReadyTimeoutMs ?? 5000;
  if (
    !Number.isSafeInteger(bridgeReadyTimeoutMs) ||
    bridgeReadyTimeoutMs <= 0
  ) {
    throw new Error(
      'iwsdkDev().bridgeReadyTimeoutMs must be a positive integer',
    );
  }
  const emulator = options.emulator ?? {};
  const processed: ProcessedDevOptions = {
    ...(options.assetManifest == null
      ? {}
      : { assetManifest: options.assetManifest }),
    ...(options.componentManifest == null
      ? {}
      : { componentManifest: options.componentManifest }),
    device: emulator.device || 'metaQuest3',
    injectOnBuild: emulator.injectOnBuild || false,
    activation: emulator.activation || 'localhost',
    verbose: options.verbose || false,
    userAgentException:
      emulator.userAgentException || new RegExp('OculusBrowser'),
    iwer: emulator.iwer ?? true,
    nativeXRControl: options.nativeXRControl ?? false,
    ...(options.targetDevicePreview == null
      ? {}
      : { targetDevicePreview: options.targetDevicePreview }),
    bridgeReadyTimeoutMs,
  };

  // Process SEM options from emulator.environment
  if (emulator.environment) {
    const room = resolveProjectEmulatorRoom(emulator.environment);
    if (room !== emulator.environment) {
      console.warn(
        `[IWSDK] dev.emulator.environment "${emulator.environment}" is a legacy capture room, which IWSDK no longer offers. Loading "${room}" instead; set it to one of: ${PROJECT_EMULATOR_ROOMS.join(', ')}.`,
      );
    }
    processed.sem = {
      defaultScene: room,
    };
  }

  if (processed.nativeXRControl && processed.iwer === false) {
    throw new Error(
      '[IWSDK] --native-xr-control requires dev.emulator.iwer to be enabled.',
    );
  }
  if (processed.targetDevicePreview && processed.iwer === false) {
    throw new Error(
      '[IWSDK] dev.targetDevicePreview requires dev.emulator.iwer to be enabled.',
    );
  }

  const normalizeScreenshotSize = (input?: {
    width?: number;
    height?: number;
  }) => {
    const width = input?.width;
    const height = input?.height;
    return {
      width: width ?? height ?? 800,
      height: height ?? width ?? 800,
    };
  };

  // AI agent tooling drives the page through the injected IWER runtime/MCP
  // bridge, so it cannot work when IWER injection is disabled (`iwer: false`).
  // Warn and skip the AI path rather than launching a managed browser + MCP
  // server that wait for a bridge that will never connect.
  if (options.ai && processed.iwer === false) {
    console.warn(
      '[IWSDK Dev] `ai` was requested but `emulator.iwer` is false. AI agent ' +
        'tooling requires the injected IWER runtime bridge, so it has been ' +
        'disabled. Set `emulator.iwer: true` (the default) to use AI features.',
    );
  }

  // AI is opt-in: omit `ai` to disable AI mode. Workspace may still be enabled
  // separately for manual editor workflows.
  if (options.ai && processed.iwer !== false) {
    const mode = options.ai.mode ?? 'collaborate';
    const settings = MODE_SETTINGS[mode];
    if (!settings) {
      const valid = Object.keys(MODE_SETTINGS).join(', ');
      throw new Error(
        `[IWSDK] Invalid ai.mode "${mode}". Valid modes: ${valid}`,
      );
    }
    const screenshotSize = normalizeScreenshotSize(options.ai.screenshotSize);

    processed.ai = {
      mode,
      headless: settings.headless,
      devUI: settings.devUI,
      viewport: settings.fixedViewport ? screenshotSize : null,
      screenshotSize,
    };
  }

  if (processed.ai || options.workspace?.enabled) {
    const screenshotSize =
      processed.ai?.screenshotSize ??
      normalizeScreenshotSize(options.workspace?.screenshotSize);
    const headless =
      processed.ai?.headless ?? options.workspace?.headless ?? false;
    processed.workspace = {
      enabled: true,
      open: options.workspace?.open ?? true,
      headless,
      devUI: processed.ai?.devUI ?? true,
      browserAutomation: options.workspace?.browserAutomation ?? false,
      viewport: processed.ai ? processed.ai.viewport : null,
      screenshotSize,
    };
  }

  return processed;
}

function assertNoRetiredMetadataOptions(options: DevPluginOptions): void {
  const input = options as DevPluginOptions & Record<string, unknown>;
  const retired = ['assetManifest', 'componentManifest'].filter(
    (name) => input[name] != null,
  );
  if (retired.length === 0) {
    return;
  }
  throw new Error(
    `[IWSDK] ${retired
      .map((name) => `iwsdkDev().${name}`)
      .join(
        ', ',
      )} ${retired.length === 1 ? 'was' : 'were'} removed in IWSDK 0.5. Declare the module path in iwsdk.config.json instead.`,
  );
}

function assertNoProjectOptionConflicts(options: DevPluginOptions): void {
  const projectOptions = [['emulator', options.emulator]]
    .filter(([, value]) => value != null)
    .map(([name]) => name);
  const sessionOptions = [
    ['ai', options.ai],
    ['workspace', options.workspace],
  ]
    .filter(([, value]) => value != null)
    .map(([name]) => name);
  if (projectOptions.length === 0 && sessionOptions.length === 0) {
    return;
  }
  const instructions = [
    ...(projectOptions.length === 0
      ? []
      : [
          `move ${projectOptions
            .map((name) => `iwsdkDev().${name}`)
            .join(', ')} into iwsdk.config.json`,
        ]),
    ...(sessionOptions.length === 0
      ? []
      : [
          `remove ${sessionOptions
            .map((name) => `iwsdkDev().${name}`)
            .join(
              ', ',
            )} and select AI/browser launch behavior through the dev command`,
        ]),
  ];
  throw new Error(
    `[IWSDK] iwsdk.config.json is the project authority: ${instructions.join('; ')}.`,
  );
}

function projectManifestPluginOptions(
  options: DevPluginOptions,
  manifest: IwsdkProjectManifestV1,
  projectRoot: string,
  command: 'serve' | 'build',
): ResolvedDevPluginOptions {
  const nativeXRControl =
    command === 'serve'
      ? (optionalBooleanEnvironment(
          'IWSDK_DEV_NATIVE_XR_CONTROL',
          process.env.IWSDK_DEV_NATIVE_XR_CONTROL,
        ) ?? false)
      : false;
  const dev = normalizeProjectDevOptions(manifest);
  const aiMode =
    command === 'serve'
      ? optionalAiMode(process.env.IWSDK_DEV_AI_MODE)
      : undefined;
  const headless =
    command === 'serve'
      ? optionalBooleanEnvironment(
          'IWSDK_DEV_HEADLESS',
          process.env.IWSDK_DEV_HEADLESS,
        )
      : undefined;
  const open =
    command === 'serve'
      ? optionalBooleanEnvironment('IWSDK_DEV_OPEN', process.env.IWSDK_DEV_OPEN)
      : undefined;
  const browserAutomation =
    command === 'serve'
      ? optionalBooleanEnvironment(
          'IWSDK_DEV_ALLOW_BROWSER_AUTOMATION',
          process.env.IWSDK_DEV_ALLOW_BROWSER_AUTOMATION,
        )
      : undefined;
  const screenshotSize =
    command === 'serve' ? optionalScreenshotSize() : undefined;
  const ai: AiOptions | undefined =
    aiMode == null
      ? undefined
      : {
          mode: aiMode,
          ...(screenshotSize == null ? {} : { screenshotSize }),
        };
  // A manifest-first app always exposes the managed editor and command
  // session. Whether its browser opens immediately, and whether that browser
  // is headed, are operator-session choices rather than project data.
  const workspace: WorkspaceOptions | undefined =
    command === 'serve'
      ? {
          enabled: true,
          ...(browserAutomation == null ? {} : { browserAutomation }),
          ...(headless == null ? {} : { headless }),
          ...(open == null ? {} : { open }),
          ...(screenshotSize == null ? {} : { screenshotSize }),
        }
      : undefined;

  return {
    ...(manifest.assets == null
      ? {}
      : {
          assetManifest: resolveProjectModulePath(
            projectRoot,
            manifest.assets.module,
            'Asset',
          ),
        }),
    ...(manifest.components == null
      ? {}
      : {
          componentManifest: resolveProjectModulePath(
            projectRoot,
            manifest.components.module,
            'Component',
          ),
        }),
    ...(dev.emulator == null
      ? {}
      : { emulator: dev.emulator as EmulatorOptions }),
    ...(ai == null ? {} : { ai }),
    ...(workspace == null ? {} : { workspace }),
    ...(nativeXRControl ? { nativeXRControl } : {}),
    ...(command === 'serve' && dev.targetDevicePreview != null
      ? { targetDevicePreview: dev.targetDevicePreview }
      : {}),
    ...(options.https == null ? {} : { https: options.https }),
    ...(options.verbose == null ? {} : { verbose: options.verbose }),
    ...(options.bridgeReadyTimeoutMs == null
      ? {}
      : { bridgeReadyTimeoutMs: options.bridgeReadyTimeoutMs }),
  };
}

function optionalAiMode(value: string | undefined): AiMode | undefined {
  if (value == null || value.trim().length === 0) {
    return undefined;
  }
  if (value === 'agent' || value === 'collaborate') {
    return value;
  }
  throw new Error('IWSDK_DEV_AI_MODE must be either "agent" or "collaborate"');
}

function optionalBooleanEnvironment(
  name: string,
  value: string | undefined,
): boolean | undefined {
  if (value == null || value.trim().length === 0) {
    return undefined;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  throw new Error(`${name} must be true, false, 1, or 0`);
}

function optionalScreenshotSize():
  | { width?: number; height?: number }
  | undefined {
  const width = optionalPositiveIntegerEnvironment(
    'IWSDK_DEV_SCREENSHOT_WIDTH',
    process.env.IWSDK_DEV_SCREENSHOT_WIDTH,
  );
  const height = optionalPositiveIntegerEnvironment(
    'IWSDK_DEV_SCREENSHOT_HEIGHT',
    process.env.IWSDK_DEV_SCREENSHOT_HEIGHT,
  );
  return width == null && height == null ? undefined : { width, height };
}

function optionalPositiveIntegerEnvironment(
  name: string,
  value: string | undefined,
): number | undefined {
  if (value == null || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function createProjectVirtualModuleSource(
  manifest: IwsdkProjectManifestV1,
  nativeXRControl = false,
): string {
  const optionBindings = [
    'level',
    ...(manifest.assets == null ? [] : ['assets']),
    ...(manifest.components == null ? [] : ['components']),
  ];
  return [
    `import { normalizeProjectWorldOptions } from '@iwsdk/core/project';`,
    `import assets from ${JSON.stringify(ASSET_MANIFEST_ID)};`,
    `import components from ${JSON.stringify(COMPONENT_MANIFEST_ID)};`,
    `const manifest = ${JSON.stringify(manifest)};`,
    `const normalized = normalizeProjectWorldOptions(manifest);`,
    `const xr = normalized.xr === false ? false : { ...normalized.xr${nativeXRControl ? ", offer: 'none', launchOnSessionGranted: true" : ''} };`,
    `const level = import.meta.env.BASE_URL + normalized.level.replace(/^\\.\\//, '');`,
    `const projectOptions = { ...normalized, xr, ${optionBindings.join(', ')} };`,
    `export { manifest };`,
    `export default projectOptions;`,
  ].join('\n');
}

function shouldInjectRuntime(
  command: 'serve' | 'build',
  options: ProcessedDevOptions,
): boolean {
  if (command === 'build' && options.nativeXRControl) {
    throw new Error(
      '[IWSDK] Native XR control is a development-session capability and cannot be injected into a production build.',
    );
  }
  if (command === 'serve') {
    return options.iwer !== false || options.workspace != null;
  }
  // The managed editor is a development-server capability. Production builds
  // include only explicitly requested IWER emulation, never the workspace
  // bridge merely because a project manifest exists.
  return options.iwer !== false && options.injectOnBuild;
}

function canonicalFilePath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function pathsReferToSameFile(left: string, right: string): boolean {
  return canonicalFilePath(left) === canonicalFilePath(right);
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  );
}

const VITE_FILE_SYSTEM_PREFIX = '/@fs/';

function resolveConfiguredExampleAssetDirectory(
  assetBaseUrl: string | undefined,
): string | null {
  const value = assetBaseUrl?.trim();
  if (!value?.startsWith(VITE_FILE_SYSTEM_PREFIX)) {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURI(value.slice('/@fs'.length));
  } catch {
    return null;
  }
  if (process.platform === 'win32' && /^\/[a-z]:[\\/]/iu.test(decodedPath)) {
    decodedPath = decodedPath.slice(1);
  }
  const resolvedPath = path.resolve(decodedPath);
  if (resolvedPath === path.parse(resolvedPath).root) {
    return null;
  }

  try {
    const canonicalPath = realpathSync.native(resolvedPath);
    const canonicalHome = realpathSync.native(homedir());
    const canonicalTemp = realpathSync.native(tmpdir());
    const canonicalRoot = path.parse(canonicalPath).root;
    const depth = path
      .relative(canonicalRoot, canonicalPath)
      .split(path.sep)
      .filter(Boolean).length;
    if (
      !statSync(canonicalPath).isDirectory() ||
      depth < 2 ||
      pathContains(canonicalPath, canonicalHome) ||
      pathsReferToSameFile(canonicalPath, canonicalTemp)
    ) {
      return null;
    }
    return canonicalPath;
  } catch {
    return null;
  }
}

/**
 * Vite plugin for IWSDK development — XR emulation, AI agent tooling, and Playwright browser
 */
export function iwsdkDev(options: DevPluginOptions = {}): Plugin {
  let pluginOptions = processOptions(options);
  let loadedProject: LoadedIwsdkProject | null = null;
  let bundlePhysics = true;
  let bundledFonts: ReadonlySet<string> | null = null;
  let bundledIcons: ReadonlySet<string> | 'all' = 'all';
  let injectionBundle: InjectionBundleResult | null = null;
  let config: ResolvedConfig;
  const hotClientRoles = new WeakMap<
    WebSocketClient,
    'editor' | 'preview' | 'runtime'
  >();
  const managedWorkspaceToken =
    process.env.NODE_ENV === 'test' &&
    process.env.IWSDK_TEST_MANAGED_WORKSPACE_TOKEN
      ? process.env.IWSDK_TEST_MANAGED_WORKSPACE_TOKEN
      : randomUUID();
  const issuedReviewCaptures = new IssuedReviewCaptureRegistry();
  const issuedReviewTransitions = new IssuedReviewTransitionRegistry();

  return {
    name: 'iwsdk-dev',

    async config(userConfig, environment) {
      assertNoRetiredMetadataOptions(options);
      const projectRoot = path.resolve(userConfig.root ?? process.cwd());
      loadedProject = loadIwsdkProject(projectRoot);
      if (loadedProject != null) {
        assertNoProjectOptionConflicts(options);
        pluginOptions = processOptions(
          projectManifestPluginOptions(
            options,
            loadedProject.manifest,
            projectRoot,
            environment.command,
          ),
        );
        if (environment.command === 'build') {
          const physics = loadedProject.manifest.world.features?.physics;
          bundlePhysics =
            physics === true ||
            (typeof physics === 'object' && physics !== null);
          const configuredPublicDirectory = userConfig.publicDir;
          const publicDirectory =
            configuredPublicDirectory === false
              ? undefined
              : path.resolve(
                  projectRoot,
                  configuredPublicDirectory ?? 'public',
                );
          bundledFonts = await resolveBundledFontNames(
            publicDirectory,
            options.bundle?.fonts,
          );
          bundledIcons = await resolveBundledLucideIcons(
            publicDirectory,
            options.bundle?.icons,
          );
        }
      }

      // A local example-asset override is an explicit /@fs/ request. Vite's
      // default allow-list can stop at a generated pnpm workspace boundary, so
      // add only that configured directory while preserving the default root.
      if (environment.command === 'serve') {
        const assetBaseUrl =
          userConfig.envDir === false
            ? process.env.VITE_IWSDK_EXAMPLE_ASSET_BASE_URL
            : loadEnv(
                environment.mode,
                path.resolve(projectRoot, userConfig.envDir ?? '.'),
              ).VITE_IWSDK_EXAMPLE_ASSET_BASE_URL;
        const configuredAssetDirectory =
          resolveConfiguredExampleAssetDirectory(assetBaseUrl);
        if (configuredAssetDirectory != null) {
          userConfig.server ??= {};
          userConfig.server.fs ??= {};
          const allowedDirectories = [
            ...(userConfig.server.fs.allow ?? [
              searchForWorkspaceRoot(projectRoot),
            ]),
          ];
          if (
            !allowedDirectories.some((directory) =>
              pathsReferToSameFile(directory, configuredAssetDirectory),
            )
          ) {
            allowedDirectories.push(configuredAssetDirectory);
            console.info(
              '[IWSDK Dev] Allowing local example assets from ' +
                configuredAssetDirectory,
            );
          }
          userConfig.server.fs.allow = allowedDirectories;
        }
      }

      // WebXR requires a secure context on network hosts. Generate an
      // untrusted certificate locally instead of installing a development CA
      // into the operating-system trust store. Playwright accepts it in the
      // managed browser; physical headsets retain their explicit warning.
      // Preserve Vite's own HTTPS configuration when the app supplies one.
      if (
        environment.command === 'serve' &&
        !pluginOptions.nativeXRControl &&
        options.https !== false &&
        userConfig.server?.https === undefined
      ) {
        const httpsOptions =
          typeof options.https === 'object' ? options.https : {};
        const configuredCacheDir =
          httpsOptions.certDir ?? path.join('.iwsdk', 'https');
        const certDir = path.isAbsolute(configuredCacheDir)
          ? configuredCacheDir
          : path.resolve(projectRoot, configuredCacheDir);
        const certificate = await getCertificate(
          certDir,
          httpsOptions.name ?? 'IWSDK Development',
          httpsOptions.domains,
          httpsOptions.ttlDays ?? 365,
        );
        // @vitejs/plugin-basic-ssl writes its cache asynchronously after
        // returning. Complete the write before Vite starts so a rapid restart
        // cannot generate a second certificate for the same project.
        mkdirSync(certDir, { recursive: true });
        writeFileSync(path.join(certDir, '_cert.pem'), certificate, {
          mode: 0o600,
        });
        userConfig.server ??= {};
        userConfig.server.https = {
          cert: certificate,
          key: certificate,
        };
      }

      // The editor workspace is loaded from a virtual module after the app has
      // started. Keep its framework dependencies out of Vite's late discovery
      // pass so opening the editor cannot invalidate the running page. The
      // MSDF generator must also stay unbundled so its relative worker and WASM
      // URLs continue to resolve when UIKit loads a TTF font. @iwsdk/core is
      // served unbundled, so pre-bundle its elics dependency through it; the
      // nested form resolves under pnpm, where elics is not visible from the
      // app root.
      userConfig.optimizeDeps ??= {};
      userConfig.optimizeDeps.exclude = [
        ...(userConfig.optimizeDeps.exclude ?? []),
        ...OPTIMIZER_EXCLUSIONS.filter(
          (dependency) =>
            !userConfig.optimizeDeps?.exclude?.includes(dependency),
        ),
      ];
      userConfig.optimizeDeps.include = [
        ...(userConfig.optimizeDeps.include ?? []),
        ...OPTIMIZER_INCLUSIONS.filter(
          (dependency) =>
            !userConfig.optimizeDeps?.include?.includes(dependency),
        ),
      ];
      // Emulator packages declare their own `three` dependency. Force every
      // browser-side import through the app's IWSDK-compatible Three.js entry
      // so the runtime and emulator share constructors and global state.
      userConfig.resolve ??= {};
      const productionAliases: Record<string, string> = {};
      if (!bundlePhysics) {
        productionAliases['@babylonjs/havok'] = DISABLED_HAVOK_ID;
      }
      if (bundledFonts) {
        for (const [font, definition] of Object.entries(BUNDLED_FONT_MODULES)) {
          if (!bundledFonts.has(font)) {
            productionAliases[definition.module] = DISABLED_BUNDLED_FONTS_ID;
          }
        }
      }
      if (Object.keys(productionAliases).length > 0) {
        const existingWorkerPlugins = userConfig.worker?.plugins;
        userConfig.worker ??= {};
        userConfig.worker.plugins = () => [
          createProductionPayloadWorkerPlugin(),
          ...(existingWorkerPlugins?.() ?? []),
        ];

        const existingAliases = userConfig.resolve.alias;
        userConfig.resolve.alias = Array.isArray(existingAliases)
          ? [
              ...Object.entries(productionAliases).map(
                ([find, replacement]) => ({ find, replacement }),
              ),
              ...existingAliases,
            ]
          : { ...(existingAliases ?? {}), ...productionAliases };
      }
      userConfig.resolve.dedupe = [
        ...(userConfig.resolve.dedupe ?? []),
        ...(!userConfig.resolve.dedupe?.includes('three') ? ['three'] : []),
      ];
      // Runtime coordination files are implementation state, not application
      // source. Watching session/lock churn causes full-page reload loops while
      // the managed browser is connecting or shutting down.
      userConfig.server ??= {};
      userConfig.server.fs ??= {};
      // Configure before Vite compiles fsDenyGlob. Preserve either the user's
      // deny list or Vite 7's defaults when extending it with private state.
      userConfig.server.fs.deny = [
        ...(userConfig.server.fs.deny ?? [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
        ]),
        '**/.iwsdk/**',
        '**/.iwsdk-browser-*/**',
      ];
      if (userConfig.server.watch !== null) {
        userConfig.server.watch ??= {};
        const existingIgnored = userConfig.server.watch.ignored;
        const ignoredPatterns = [
          ...(existingIgnored == null
            ? []
            : Array.isArray(existingIgnored)
              ? existingIgnored
              : [existingIgnored]),
        ];
        if (!ignoredPatterns.includes(RUNTIME_STATE_WATCH_IGNORE)) {
          ignoredPatterns.push(RUNTIME_STATE_WATCH_IGNORE);
        }
        userConfig.server.watch.ignored = ignoredPatterns;
      }
      // The Playwright window is the managed browser surface in every workspace
      // mode, so suppress Vite's independent browser launch.
      if (pluginOptions.workspace) {
        userConfig.server ??= {};
        userConfig.server.open = false;
      }
      // A configured port is the runtime's address (adb reverse forwards it
      // to headsets), so an occupied port fails startup instead of moving the
      // singleton runtime. An explicit strictPort still wins, and preview,
      // which inherits server.strictPort for its own port, is left alone.
      if (userConfig.server?.port !== undefined && !environment.isPreview) {
        userConfig.server.strictPort ??= true;
      }
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;

      if (pluginOptions.verbose) {
        console.log('🔧 IWSDK Dev Configuration:');
        console.log(`  - Device: ${pluginOptions.device}`);
        console.log(
          `  - SEM: ${pluginOptions.sem ? 'enabled (' + pluginOptions.sem.defaultScene + ')' : 'disabled'}`,
        );
        console.log(
          `  - AI: ${pluginOptions.ai ? `enabled (${pluginOptions.ai.mode} mode)` : 'disabled'}`,
        );
        console.log(
          `  - Workspace: ${pluginOptions.workspace ? `enabled (${pluginOptions.workspace.headless ? 'headless' : 'headed'})` : 'disabled'}`,
        );
        console.log(`  - Activation: ${pluginOptions.activation}`);
        if (pluginOptions.userAgentException) {
          console.log('  - UA exception: enabled');
        }
        console.log(`  - Inject on build: ${pluginOptions.injectOnBuild}`);
      }
    },

    async configureServer(server: ViteDevServer) {
      // These resources belong to this Vite server generation. Vite constructs
      // its replacement before closing the previous server, even when it reuses
      // the plugin object from an inline config.
      let mcpWss: WebSocketServer | null = null;
      let mcpClients: Set<WebSocket> | null = null;
      let managedBrowser: ManagedBrowser | null = null;
      const httpServer = server.httpServer;
      const sessionId = randomUUID();
      // Authorizes runtime commands for this server generation. It reaches
      // only clients that can read .iwsdk/runtime, never a browser page.
      const commandToken = randomBytes(32).toString('base64url');
      const expectedCommandToken = Buffer.from(commandToken, 'utf8');
      const sessionStartTime = Date.now();
      if (loadedProject != null) {
        server.watcher.add(loadedProject.configPath);
      }
      const registerHotClient = (
        data: { role?: unknown },
        client: WebSocketClient,
      ) => {
        if (
          data?.role === 'editor' ||
          data?.role === 'preview' ||
          data?.role === 'runtime'
        ) {
          hotClientRoles.set(client, data.role);
        }
      };
      server.ws?.on?.(HOT_CLIENT_ROLE_EVENT, registerHotClient);
      const publishSceneFileChange = (
        kind: 'add' | 'change' | 'unlink',
        absolutePath: string,
      ) => {
        if (!absolutePath.endsWith(SCENE_FILE_SUFFIX)) {
          return;
        }
        const relativePath = path.relative(config.root, absolutePath);
        if (
          relativePath === '' ||
          relativePath.startsWith('..') ||
          path.isAbsolute(relativePath)
        ) {
          return;
        }
        server.ws?.send({
          type: 'custom',
          event: 'iwsdk:scene-file-change',
          data: { kind, path: toPosixPath(relativePath) },
        });
      };
      const onSceneAdd = (filePath: string) =>
        publishSceneFileChange('add', filePath);
      const onSceneChange = (filePath: string) =>
        publishSceneFileChange('change', filePath);
      const onSceneUnlink = (filePath: string) =>
        publishSceneFileChange('unlink', filePath);
      server.watcher?.on('add', onSceneAdd);
      server.watcher?.on('change', onSceneChange);
      server.watcher?.on('unlink', onSceneUnlink);
      let serverObserversRemoved = false;
      const removeServerObservers = () => {
        if (serverObserversRemoved) {
          return;
        }
        serverObserversRemoved = true;
        server.ws?.off?.(HOT_CLIENT_ROLE_EVENT, registerHotClient);
        server.watcher?.off('add', onSceneAdd);
        server.watcher?.off('change', onSceneChange);
        server.watcher?.off('unlink', onSceneUnlink);
      };
      server.httpServer?.once?.('close', removeServerObservers);

      server.middlewares.use((request, response, next) => {
        const pathname = getRequestPathname(request.url);
        let privatePath = pathname;
        try {
          for (let n = 0; n < 4; n++) {
            const decoded = decodeURIComponent(privatePath);
            if (decoded === privatePath) {
              break;
            }
            privatePath = decoded;
          }
          privatePath = privatePath.replace(/\\/gu, '/');
        } catch {}
        if (
          /(?:^|\/)\.iwsdk(?:\/|$)|(?:^|\/)\.iwsdk-browser-[^/]*(?:\/|$)/iu.test(
            privatePath,
          )
        ) {
          response.statusCode = 404;
          response.end();
          return;
        }
        const isManagedWorkspaceRequest = hasManagedWorkspaceAccess(
          request,
          managedWorkspaceToken,
        );

        if (
          pathname === '/' &&
          request.method === 'GET' &&
          isManagedWorkspaceRequest &&
          !isIframeNavigation(request)
        ) {
          sendWorkspaceShell(response);
          return;
        }

        if (pathname === `${EDITOR_ROUTE}/document`) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'The IWSDK scene editor document endpoint is only available in the managed workspace browser.',
            );
            return;
          }
          handleEditorDocumentRequest(
            request,
            response,
            config.root,
            issuedReviewTransitions,
            loadedProject?.manifest.scene,
          );
          return;
        }

        if (pathname === EDITOR_STYLESHEET_ID) {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/css; charset=utf-8');
          response.end(EDITOR_SHELL_CSS);
          return;
        }

        if (pathname === WORKSPACE_SCENES_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'IWSDK scene file management is only available in the managed workspace browser.',
            );
            return;
          }
          handleWorkspaceScenesRequest(request, response, config.root);
          return;
        }

        if (pathname === WORKSPACE_FILES_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'IWSDK project file browsing is only available in the managed workspace browser.',
            );
            return;
          }
          handleWorkspaceFilesRequest(request, response, config.root);
          return;
        }

        if (pathname === WORKSPACE_REVIEW_CAPTURES_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'IWSDK review evidence persistence is only available in the managed workspace browser.',
            );
            return;
          }
          handleReviewCaptureRequest(
            request,
            response,
            config.root,
            issuedReviewCaptures,
          );
          return;
        }

        if (pathname === WORKSPACE_REVIEW_TRANSITIONS_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'IWSDK review transitions are only available in the managed workspace browser.',
            );
            return;
          }
          handleReviewTransitionRequest(
            request,
            response,
            config.root,
            issuedReviewTransitions,
          );
          return;
        }

        if (pathname === WORKSPACE_REVIEWS_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'IWSDK review record management is only available in the managed workspace browser.',
            );
            return;
          }
          handleReviewsRequest(request, response, config.root);
          return;
        }

        if (pathname === WORKSPACE_PUBLISH_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'IWSDK scene publishing is only available in the managed workspace browser.',
            );
            return;
          }
          handleScenePublishRequest(
            request,
            response,
            config.root,
            managedBrowser,
          );
          return;
        }

        if (pathname === WORKSPACE_OPEN_RUNTIME_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'Opening the runtime in the default browser is only available from the managed workspace browser.',
            );
            return;
          }
          handleOpenRuntimeRequest(request, response, server);
          return;
        }

        if (pathname === WORKSPACE_RUNTIME_PREFLIGHT_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            sendJsonError(
              response,
              403,
              'IWSDK runtime preflight is only available in the managed workspace browser.',
            );
            return;
          }
          handleRuntimePreflightRequest(
            request,
            response,
            config.root,
            managedBrowser,
          );
          return;
        }

        if (pathname === WORKSPACE_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            redirectToRuntimeApp(response);
            return;
          }

          sendWorkspaceShell(response);
          return;
        }

        if (pathname === EDITOR_ROUTE) {
          if (!isManagedWorkspaceRequest) {
            redirectToRuntimeApp(response);
            return;
          }

          redirectToWorkspace(response, request.url);
          return;
        }

        next();
      });

      if (!pluginOptions.workspace) {
        return;
      }
      let owner: Awaited<ReturnType<typeof acquireRuntimeOwner>> | undefined;
      let ownerAcquisition: Promise<void> | undefined;
      const acquireOwner = () =>
        (ownerAcquisition ??= acquireRuntimeOwner(config.root, sessionId).then(
          async (lease) => {
            owner = lease;
            if (serverShuttingDown) {
              await lease.release();
              throw new Error(
                'Runtime was closed before acquiring workspace ownership.',
              );
            }
          },
        ));

      let browserRuntimeClients: Set<WebSocket> | null = null;
      let browserCommandReadyClients: Set<WebSocket> | null = null;
      const browserPageRoles = new WeakMap<
        WebSocket,
        'app' | 'editor' | 'preview'
      >();
      const browserClientMetadata = new Map<WebSocket, RuntimeBrowserClient>();
      let serverShuttingDown = false;
      let browserUrl = '';
      // Tab mute is a dev-session preference, so relaunches inherit it.
      let managedBrowserAudioMuted = false;
      let currentBrowserState: RuntimeBrowserState | null = null;
      let lastBridgeConnectedAt: string | undefined;
      let lastCommandReadyAt: string | undefined;
      // Evidence that this epoch's managed bridge was connected and then lost.
      let managedBridgeLoss: { browserEpoch: number; at: string } | undefined;
      const BRIDGE_READY_TIMEOUT_MS = pluginOptions.bridgeReadyTimeoutMs;
      const traceEnabled = process.env.IWSDK_RUNTIME_TRACE === '1';
      const wsConnectionIds = new WeakMap<WebSocket, string>();
      const wsConnectionKinds = new WeakMap<WebSocket, 'command' | 'bridge'>();

      const traceRuntime = (
        event: string,
        details: Record<string, unknown> = {},
      ): void => {
        if (!traceEnabled) {
          return;
        }
        console.error(
          `[IWSDK-RUNTIME-TRACE][vite] ${event} ${JSON.stringify(details)}`,
        );
      };

      const getConnectionId = (ws: WebSocket): string =>
        wsConnectionIds.get(ws) ?? 'unknown';

      const getConnectionKind = (ws: WebSocket): 'command' | 'bridge' =>
        wsConnectionKinds.get(ws) ?? 'command';

      const markConnectionKind = (
        ws: WebSocket,
        kind: 'command' | 'bridge',
      ): void => {
        wsConnectionKinds.set(ws, kind);
      };

      const createBrowserIssue = (
        cause: RuntimeIssueCause,
        message: string,
        at: string,
      ): RuntimeIssueInfo => ({
        cause,
        message,
        at,
      });

      const listBrowserClients = (): RuntimeBrowserClient[] =>
        [...browserClientMetadata.entries()]
          .filter(
            ([client, metadata]) =>
              browserRuntimeClients?.has(client) &&
              client.readyState === WebSocket.OPEN &&
              (metadata.deviceClass === 'physical' ||
                (metadata.sessionId === sessionId &&
                  metadata.browserEpoch ===
                    controller.snapshot().browserEpoch &&
                  ['launching', 'running'].includes(
                    controller.snapshot().state,
                  ))),
          )
          .map(([client, metadata]) => ({
            ...metadata,
            commandReady: browserCommandReadyClients?.has(client) ?? false,
          }))
          .sort(
            (left, right) =>
              left.deviceClass.localeCompare(right.deviceClass) ||
              left.role.localeCompare(right.role) ||
              left.pageId.localeCompare(right.pageId) ||
              left.tabGeneration - right.tabGeneration,
          );

      const browserLaunchAllowed = pluginOptions.workspace.open !== false;
      const isBrowserCommandPathReady = (): boolean =>
        hasReadyBrowserCommandPath(listBrowserClients());
      const createBrowserState = (): RuntimeBrowserState => {
        const lifecycle = controller.snapshot();
        const clients = listBrowserClients();
        const managed = clients.filter(
          (client) => client.deviceClass === 'managed',
        );
        // A lost bridge is reported, not repaired: Chromium keeps running and
        // the lifecycle stays `running` until the page reconnects. Losing
        // either required role breaks the command path, so it is reported too.
        const bridgeLoss =
          lifecycle.state === 'running' &&
          !hasManagedCommandRoles(clients) &&
          managedBridgeLoss?.browserEpoch === lifecycle.browserEpoch
            ? managedBridgeLoss
            : undefined;
        const status: RuntimeBrowserState['status'] =
          lifecycle.state === 'launching'
            ? 'launching'
            : lifecycle.state === 'failed'
              ? 'launch_failed'
              : lifecycle.state === 'running'
                ? bridgeLoss
                  ? 'disconnected'
                  : managed.length
                    ? 'connected'
                    : 'waiting_for_connection'
                : lifecycle.state === 'idle'
                  ? 'not_launched'
                  : 'disconnected';
        return {
          lifecycle,
          status,
          clients,
          lastBridgeConnectedAt,
          lastCommandReadyAt,
          connected: managed.length > 0,
          commandReady:
            lifecycle.state === 'running' && isBrowserCommandPathReady(),
          connectedClientCount: managed.length,
          lastTransitionAt: lifecycle.stateEnteredAt,
          audioMuted: managedBrowserAudioMuted,
          renderMode: resolveManagedRenderMode(
            pluginOptions.workspace?.headless ?? false,
          ),
          ...(lifecycle.issue
            ? {
                lastError: createBrowserIssue(
                  lifecycle.issueCause ??
                    (lifecycle.state === 'failed'
                      ? 'browser_launch_failed'
                      : 'connection_lost'),
                  lifecycle.issue,
                  lifecycle.issueAt ?? lifecycle.stateEnteredAt,
                ),
              }
            : bridgeLoss
              ? {
                  lastError: createBrowserIssue(
                    'connection_lost',
                    'The managed browser bridge disconnected while Chromium kept running; a reloading page reconnects on its own. Use runtime_wait to observe it, and run `npx @iwsdk/cli browser reload` only if it does not reconnect. Chromium is not restarted.',
                    bridgeLoss.at,
                  ),
                }
              : !browserLaunchAllowed
                ? {
                    lastError: createBrowserIssue(
                      'browser_not_launched',
                      'Managed browser launch is disabled (--no-open). Physical targets and server tools remain available.',
                      lifecycle.stateEnteredAt,
                    ),
                  }
                : {}),
        };
      };
      const publishBrowserState = (): void => {
        currentBrowserState = createBrowserState();
        void setRuntimeSessionBrowserState(
          config.root,
          sessionId,
          currentBrowserState,
        ).catch((error) => {
          console.error('[IWSDK Dev] Failed to update browser state:', error);
        });
      };
      const controller = new ManagedBrowserLifecycle<ManagedBrowser>({
        sessionId,
        enabled: browserLaunchAllowed,
        prepare: ensureChromiumInstalled,
        onChange: (_state, browser) => {
          managedBrowser = browser;
          publishBrowserState();
          const automation = browser?.getAutomationTarget?.() ?? null;
          void setRuntimeSessionBrowserAutomation(config.root, sessionId, {
            configured: pluginOptions.workspace!.browserAutomation,
            enabled: automation != null,
            ...(automation ?? {}),
            protocol: 'cdp',
          }).catch(() => {});
        },
        launch: async (signal, browserEpoch) => {
          // Old endpoints are invalid before the next process is started.
          for (const [ws, metadata] of browserClientMetadata) {
            if (metadata.deviceClass === 'managed') {
              ws.close(1001, 'Managed browser epoch retired');
            }
          }
          return launchManagedBrowser(
            browserUrl,
            pluginOptions.workspace!.headless,
            pluginOptions.verbose,
            pluginOptions.workspace!.viewport,
            pluginOptions.workspace!.screenshotSize,
            traceEnabled,
            {
              headerName: MANAGED_WORKSPACE_HEADER,
              pathnames: [
                WORKSPACE_ROUTE,
                WORKSPACE_FILES_ROUTE,
                WORKSPACE_SCENES_ROUTE,
                WORKSPACE_REVIEWS_ROUTE,
                WORKSPACE_REVIEW_CAPTURES_ROUTE,
                WORKSPACE_REVIEW_TRANSITIONS_ROUTE,
                WORKSPACE_PUBLISH_ROUTE,
                WORKSPACE_OPEN_RUNTIME_ROUTE,
                WORKSPACE_RUNTIME_PREFLIGHT_ROUTE,
                `${EDITOR_ROUTE}/document`,
              ],
              topLevelPathnames: ['/'],
              token: managedWorkspaceToken,
              runtimeIdentity: { sessionId, browserEpoch },
            },
            pluginOptions.ai ? 'iwer' : 'workspace',
            config.root,
            pluginOptions.workspace!.browserAutomation,
            signal,
            {
              muted: managedBrowserAudioMuted,
              onMutedChange: (muted) => {
                managedBrowserAudioMuted = muted;
                publishBrowserState();
              },
            },
          );
        },
      });
      currentBrowserState = createBrowserState();
      const launchBrowser = () => controller.ensure();
      const ensureBrowser = () => controller.ensure();
      const waitForBridgeConnection = async (
        timeoutMs: number,
        target: ManagedBrowserCommandTarget,
      ): Promise<void> => {
        const deadline = Date.now() + Math.min(timeoutMs, 5000);
        while (!serverShuttingDown && Date.now() < deadline) {
          if (
            listBrowserClients().some(
              (client) =>
                client.deviceClass === 'managed' &&
                client.role === target.role &&
                (target.sessionId == null ||
                  client.sessionId === target.sessionId) &&
                (target.browserEpoch == null ||
                  client.browserEpoch === target.browserEpoch) &&
                client.commandReady,
            )
          ) {
            return;
          }
          await controller.wait(
            controller.snapshot().revision,
            Math.min(250, deadline - Date.now()),
          );
        }
      };

      // Initialize WebSocket server and client tracking
      mcpClients = new Set();
      browserRuntimeClients = new Set();
      browserCommandReadyClients = new Set();
      mcpWss = new WebSocketServer({ noServer: true });

      // Each request belongs to one exact endpoint and one caller.
      const pairedHeadsets = new Map<string, string>();
      const relay = createRelayHandler({
        verbose: pluginOptions.verbose,
        // The relay already fenced the endpoint generation. A managed page
        // that missed its deadline is unresponsive, so retire exactly that
        // epoch. A lost bridge is only reported: the page's reload registers
        // a new generation, and a healthy Chromium is never restarted for it.
        onOutcomeUnknown: ({ deviceClass, browserEpoch }, code) => {
          const browser = controller.current();
          if (
            code === 'command_timeout' &&
            deviceClass === 'managed' &&
            browser &&
            browserEpoch != null
          ) {
            controller.invalidateIfCurrent(
              browser,
              browserEpoch,
              'A runtime command exceeded its deadline, so its outcome is unknown.',
            );
          }
        },
      });

      const BROWSER_RELAUNCHED_RESULT = {
        code: 'browser_relaunched',
        outcome: 'not_executed',
        retryable: true,
        message:
          'A managed browser generation is now available. Rediscover its target and retry the request. In-memory page state changed; stored site data is retained.',
      };

      const sendWsJson = (
        ws: WebSocket,
        payload: Record<string, unknown>,
        context: string,
      ): void => {
        if (ws.readyState !== WebSocket.OPEN) {
          traceRuntime('ws_send_skipped', {
            connectionId: getConnectionId(ws),
            kind: getConnectionKind(ws),
            context,
            readyState: ws.readyState,
          });
          return;
        }
        traceRuntime('ws_send', {
          connectionId: getConnectionId(ws),
          kind: getConnectionKind(ws),
          context,
          id: payload.id ?? null,
        });
        ws.send(JSON.stringify(payload));
      };

      const runManagedBrowserCommand = async <T>(
        command: string,
        browser: ManagedBrowser,
        target: ManagedBrowserCommandTarget | undefined,
        operation: () => T | Promise<T>,
      ): Promise<{
        result: T;
        tab: { generation: number | null; id: string | null };
      }> =>
        browser.runCommandExclusive(async () => {
          if (controller.current() !== browser || serverShuttingDown) {
            throw Object.assign(
              new Error('Managed browser changed while command was queued.'),
              { code: 'stale_browser_tab', outcome: 'not_executed' },
            );
          }
          const startedAt = Date.now();
          const initialTab = await browser
            .getTabMetadata()
            .catch(() => ({ generation: null, id: null }));
          if (
            target?.deviceClass === 'physical' ||
            (target?.sessionId != null && target.sessionId !== sessionId) ||
            (target?.browserEpoch != null &&
              target.browserEpoch !== controller.snapshot().browserEpoch)
          ) {
            throw new ManagedBrowserTargetError(target, initialTab);
          }
          if (target?.role != null && target.role !== 'app') {
            throw new Error(
              `Managed browser commands require the app target; received ${JSON.stringify(target)}`,
            );
          }
          if (
            (target?.pageId != null && target.pageId !== initialTab.id) ||
            (target?.tabGeneration != null &&
              target.tabGeneration !== initialTab.generation)
          ) {
            throw new ManagedBrowserTargetError(target, initialTab);
          }
          traceRuntime('managed_browser_command_start', {
            command,
            applicationPageId: initialTab.id,
            applicationGeneration: initialTab.generation,
            relaunched: false,
          });
          try {
            const result = await operation();
            const resultRecord =
              typeof result === 'object' && result != null
                ? (result as Record<string, unknown>)
                : null;
            const application =
              resultRecord?.application != null &&
              typeof resultRecord.application === 'object'
                ? (resultRecord.application as Record<string, unknown>)
                : null;
            const tab =
              typeof application?.id === 'string'
                ? {
                    generation:
                      typeof application.generation === 'number'
                        ? application.generation
                        : null,
                    id: application.id,
                  }
                : typeof resultRecord?.id === 'string'
                  ? {
                      generation:
                        typeof resultRecord.generation === 'number'
                          ? resultRecord.generation
                          : null,
                      id: resultRecord.id,
                    }
                  : initialTab;
            traceRuntime('managed_browser_command_complete', {
              command,
              durationMs: Date.now() - startedAt,
              outcome: 'success',
              applicationPageId: tab.id,
              applicationGeneration: tab.generation,
              applicationUrl: application?.url ?? resultRecord?.url ?? null,
              workspaceFramed: application?.workspaceFramed ?? null,
              relaunched: false,
            });
            return { result, tab };
          } catch (error) {
            traceRuntime('managed_browser_command_complete', {
              command,
              durationMs: Date.now() - startedAt,
              outcome: 'failure',
              applicationPageId: initialTab.id,
              applicationGeneration: initialTab.generation,
              message: error instanceof Error ? error.message : String(error),
              relaunched: false,
            });
            const source =
              typeof error === 'object' && error != null
                ? (error as Record<string, unknown>)
                : null;
            throw Object.assign(
              new Error(error instanceof Error ? error.message : String(error)),
              {
                code:
                  typeof source?.code === 'string'
                    ? source.code
                    : 'browser_command_failed',
                outcome:
                  typeof source?.outcome === 'string'
                    ? source.outcome
                    : 'outcome_unknown',
                retryable:
                  typeof source?.retryable === 'boolean'
                    ? source.retryable
                    : false,
              },
            );
          }
        });

      const sendUnavailableBrowser = (
        ws: WebSocket,
        requestId: string,
        context: string,
      ): void => {
        sendWsJson(
          ws,
          {
            id: requestId,
            error: {
              ...createUnavailableBrowserRpcError(currentBrowserState),
              data: { outcome: 'not_executed', browser: currentBrowserState },
            },
          },
          context,
        );
      };

      const sendInternalError = (
        ws: WebSocket,
        requestId: string,
        error: unknown,
        context: string,
      ): void => {
        const data =
          error instanceof WorkspaceReviewError
            ? { code: error.code, ...error.extra }
            : error instanceof SceneReviewWorkflowError
              ? { code: error.code, ...error.details }
              : error instanceof ManagedBrowserTargetError
                ? {
                    code: error.code,
                    currentTab: error.currentTab,
                    expectedTab: error.expectedTab,
                    outcome: 'not_executed',
                  }
                : typeof error === 'object' &&
                    error != null &&
                    'code' in error &&
                    typeof error.code === 'string'
                  ? {
                      code: error.code,
                      ...('outcome' in error ? { outcome: error.outcome } : {}),
                      ...('retryable' in error &&
                      typeof error.retryable === 'boolean'
                        ? { retryable: error.retryable }
                        : {}),
                    }
                  : undefined;
        sendWsJson(
          ws,
          {
            id: requestId,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
              ...(data == null ? {} : { data }),
            },
          },
          context,
        );
      };

      const handleManagedBrowserRequest = async <T>(
        ws: WebSocket,
        parsed: ManagedBrowserRpcRequest,
        options: {
          command: string;
          errorContext: string;
          execute: (browser: ManagedBrowser) => Promise<T>;
          resultContext: string;
          serialize?: (result: T) => unknown;
          unavailableContext: string;
        },
      ): Promise<void> => {
        try {
          // These commands are implemented by the Playwright host and remain
          // useful for browser-first applications that have no runtime bridge.
          const readiness = await ensureBrowser();
          if (!readiness.browser) {
            sendUnavailableBrowser(ws, parsed.id, options.unavailableContext);
            return;
          }
          if (readiness.relaunched) {
            sendWsJson(
              ws,
              {
                id: parsed.id,
                error: {
                  code: -32010,
                  message: BROWSER_RELAUNCHED_RESULT.message,
                  data: {
                    ...BROWSER_RELAUNCHED_RESULT,
                    browser: createBrowserState(),
                  },
                },
              },
              `${options.resultContext}_relaunched`,
            );
            return;
          }
          const execution = await runManagedBrowserCommand(
            options.command,
            readiness.browser,
            parsed.target,
            () => options.execute(readiness.browser!),
          );
          sendWsJson(
            ws,
            {
              id: parsed.id,
              result:
                options.serialize == null
                  ? execution.result
                  : options.serialize(execution.result),
              ...(execution.tab.id == null
                ? {}
                : {
                    _tabId: execution.tab.id,
                    _tabGeneration: execution.tab.generation ?? undefined,
                  }),
            },
            options.resultContext,
          );
        } catch (error) {
          sendInternalError(ws, parsed.id, error, options.errorContext);
        }
      };

      const createBrowserProbeResult = (
        waitedForBridgeMs: number,
      ): RuntimeBrowserProbeResult => ({
        bridgeConnected: Boolean(currentBrowserState?.connected),
        commandReady: Boolean(currentBrowserState?.commandReady),
        waitedForBridgeMs,
        browser: createBrowserState(),
      });

      mcpWss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
        const connectionId = randomUUID();
        wsConnectionIds.set(ws, connectionId);
        markConnectionKind(ws, 'command');
        mcpClients!.add(ws);
        traceRuntime('ws_connected', {
          connectionId,
          kind: getConnectionKind(ws),
        });

        if (pluginOptions.verbose) {
          console.log('[IWSDK-MCP] Client connected');
        }

        ws.on('message', async (data: Buffer) => {
          const message = data.toString();
          traceRuntime('ws_message', {
            connectionId,
            kind: getConnectionKind(ws),
            bytes: data.length,
          });
          if (pluginOptions.verbose) {
            console.log(
              '[IWSDK-MCP] Message received:',
              message
                .replace(
                  /"commandToken":"[^"]*"/u,
                  '"commandToken":"[redacted]"',
                )
                .substring(0, 100),
            );
          }

          let intercepted = false;
          try {
            const parsed = JSON.parse(message) as {
              id?: string;
              method?: string;
              params?: Record<string, unknown>;
              type?: string;
              deviceClass?: string;
              pageId?: string;
              pageRole?: string;
              role?: string;
              sceneSessionId?: string;
              commandReady?: boolean;
              tabId?: string;
              tabGeneration?: number;
              sessionId?: string;
              expectedSessionId?: string;
              browserEpoch?: number;
              headsetToken?: string;
              commandToken?: unknown;
              target?: ManagedBrowserCommandTarget;
            };

            if (
              parsed.method &&
              parsed.expectedSessionId != null &&
              parsed.expectedSessionId !== sessionId
            ) {
              intercepted = true;
              // Not authenticated yet, so the reply omits the current
              // sessionId: it is part of a managed bridge's identity.
              sendWsJson(
                ws,
                {
                  id: parsed.id,
                  error: {
                    code: -32004,
                    message:
                      'Runtime ownership changed. Rediscover the workspace session.',
                    data: {
                      code: 'stale_runtime_owner',
                      outcome: 'not_executed',
                    },
                  },
                },
                'stale_owner',
              );
              return;
            }
            // Every command must carry this session's credential. Browser
            // bridges never hold it: their hello, readiness and replies carry
            // no method and keep their own identity, pairing and loopback
            // rules. The credential is dropped before anything is relayed.
            if (parsed.method != null) {
              if (
                !hasRuntimeCommandCredential(
                  parsed.commandToken,
                  expectedCommandToken,
                )
              ) {
                intercepted = true;
                traceRuntime('command_unauthorized', {
                  connectionId,
                  kind: getConnectionKind(ws),
                });
                sendWsJson(
                  ws,
                  {
                    id: parsed.id,
                    error: {
                      code: -32001,
                      cause: 'permission_denied',
                      message:
                        'Runtime command credential is missing or invalid. The iwsdk CLI and "iwsdk mcp stdio" send the one this dev server wrote to .iwsdk/runtime/command-credential.json: use them from the same IWSDK release as @iwsdk/vite-plugin-dev, or run "iwsdk dev restart" if that file is gone.',
                      data: {
                        code: 'runtime_unauthorized',
                        outcome: 'not_executed',
                      },
                    },
                  },
                  'command_unauthorized',
                );
                return;
              }
              delete parsed.commandToken;
            }
            if (parsed.method === '__iwsdk_browser_lease_release') {
              intercepted = true;
              return;
            }
            if (serverShuttingDown) {
              intercepted = true;
              if (parsed.type === 'iwsdk_browser_hello') {
                ws.close(1012, 'Runtime is shutting down');
              } else if (typeof parsed.id === 'string' && parsed.method) {
                sendWsJson(
                  ws,
                  {
                    id: parsed.id,
                    error: {
                      code: -32004,
                      message:
                        'Runtime is shutting down. Rediscover the workspace session.',
                      data: {
                        code: 'runtime_stopping',
                        outcome: 'not_executed',
                      },
                    },
                  },
                  'runtime_stopping',
                );
              }
              return;
            }
            if (
              parsed.method === '__iwsdk_browser_lease' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              const browser = controller.current();
              if (!browser) {
                sendUnavailableBrowser(ws, parsed.id, 'lease_unavailable');
                return;
              }
              const requestId = parsed.id;
              const epoch = controller.snapshot().browserEpoch;
              const timeoutMs = Number(parsed.params?.timeoutMs ?? 65000);
              if (
                !Number.isFinite(timeoutMs) ||
                timeoutMs < 1000 ||
                timeoutMs > 115000
              ) {
                sendInternalError(
                  ws,
                  requestId,
                  new Error(
                    'Browser lease timeout must be between 1000 and 115000 milliseconds.',
                  ),
                  'lease_error',
                );
                return;
              }
              let granted = false;
              try {
                await browser.runCommandExclusive(
                  async () => {
                    const automation = browser.getAutomationTarget();
                    if (
                      ws.readyState !== WebSocket.OPEN ||
                      controller.current() !== browser ||
                      parsed.params?.browserEpoch !== epoch ||
                      parsed.params?.targetId !== automation?.targetId
                    ) {
                      throw new Error(
                        'Managed browser identity changed before lease acquisition. Refresh runtime status.',
                      );
                    }
                    granted = true;
                    await new Promise<void>((resolve, reject) => {
                      const closed = () => {
                        cleanup();
                        reject(
                          new Error(
                            'Browser runner disconnected without releasing its lease.',
                          ),
                        );
                      };
                      const released = (raw: Buffer) => {
                        try {
                          const message = JSON.parse(raw.toString());
                          if (
                            message.id === requestId &&
                            message.method === '__iwsdk_browser_lease_release'
                          ) {
                            cleanup();
                            resolve();
                          }
                        } catch {}
                      };
                      const cleanup = () => {
                        ws.off('close', closed);
                        ws.off('message', released);
                      };
                      ws.once('close', closed);
                      ws.on('message', released);
                      sendWsJson(
                        ws,
                        {
                          id: requestId,
                          result: {
                            leased: true,
                            sessionId,
                            browserEpoch: epoch,
                          },
                        },
                        'browser_leased',
                      );
                    });
                  },
                  { timeoutMs },
                );
              } catch (error) {
                if (granted) {
                  controller.invalidateIfCurrent(
                    browser,
                    epoch,
                    'Browser runner lease was lost; retiring the browser to stop uncertain commands.',
                  );
                  ws.close(
                    1011,
                    'Browser lease ended before script completion',
                  );
                } else {
                  sendInternalError(ws, requestId, error, 'lease_error');
                }
              }
              return;
            }
            if (
              parsed.method &&
              [
                'runtime_get_status',
                'runtime_list_targets',
                'runtime_wait',
                'runtime_recover',
                'runtime_pair_headset',
              ].includes(parsed.method) &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              if (
                parsed.target != null ||
                parsed.params?.runtimeTarget != null ||
                parsed.params?.expectedTab != null
              ) {
                throw Object.assign(
                  new Error(
                    'Runtime control operations do not select a browser target.',
                  ),
                  { code: 'invalid_target', outcome: 'not_executed' },
                );
              }
              if (parsed.method === 'runtime_recover') {
                await controller.ensure(true);
              }
              if (parsed.method === 'runtime_wait') {
                const afterRevision =
                  parsed.params?.afterRevision ??
                  controller.snapshot().revision;
                const timeoutMs = parsed.params?.timeoutMs ?? 25000;
                if (
                  typeof afterRevision !== 'number' ||
                  !Number.isSafeInteger(afterRevision) ||
                  afterRevision < 0 ||
                  typeof timeoutMs !== 'number' ||
                  !Number.isSafeInteger(timeoutMs) ||
                  timeoutMs < 0 ||
                  timeoutMs > 25000
                ) {
                  throw Object.assign(
                    new Error(
                      'runtime_wait requires a nonnegative revision and a timeout from 0 to 25000ms.',
                    ),
                    { code: 'invalid_params', outcome: 'not_executed' },
                  );
                }
                const cancel = new AbortController();
                const closed = () => cancel.abort();
                ws.once('close', closed);
                try {
                  await controller.wait(
                    afterRevision,
                    timeoutMs,
                    cancel.signal,
                  );
                } finally {
                  ws.off('close', closed);
                }
              }
              if (parsed.method === 'runtime_pair_headset') {
                const headsetId = parsed.params?.headsetId;
                // adb serial forms: USB `1WMHH8`, wireless `192.168.1.5:5555`
                // and mDNS `adb-1WMHH8-AbCd._adb-tls-connect._tcp`. The id is
                // only published as JSON; the pairing URL carries the token.
                if (
                  typeof headsetId !== 'string' ||
                  !/^[A-Za-z0-9._:-]{1,128}$/.test(headsetId)
                ) {
                  throw new Error(
                    'headsetId must be the device identifier (for example, its adb serial).',
                  );
                }
                let token = [...pairedHeadsets].find(
                  ([, pairedId]) => pairedId === headsetId,
                )?.[0];
                if (!token && pairedHeadsets.size >= 32) {
                  const active = new Set(
                    listBrowserClients().map((client) => client.headsetId),
                  );
                  const inactive = [...pairedHeadsets].find(
                    ([, pairedId]) => !active.has(pairedId),
                  );
                  if (inactive) {
                    pairedHeadsets.delete(inactive[0]);
                  }
                }
                if (!token && pairedHeadsets.size >= 32) {
                  throw new Error(
                    'Headset pairing capacity reached (32 connected headsets).',
                  );
                }
                token ??= randomUUID();
                pairedHeadsets.set(token, headsetId);
                const url = new URL(browserUrl);
                url.searchParams.set('__iwsdk_headset', token);
                sendWsJson(
                  ws,
                  {
                    id: parsed.id,
                    result: {
                      headsetId,
                      sessionId,
                      url: url.toString(),
                      nextAction:
                        'Open this URL on that headset via adb reverse. Then use runtime_list_targets to select the exact page generation.',
                    },
                  },
                  'headset_pair',
                );
                return;
              }
              const browser = createBrowserState();
              const targets = listBrowserClients().map((client) => ({
                ...client,
                runtimeTarget: {
                  deviceClass: client.deviceClass,
                  headsetId: client.headsetId,
                  pageId: client.pageId,
                  tabGeneration: client.tabGeneration,
                  sessionId: client.sessionId,
                  browserEpoch: client.browserEpoch,
                },
                methods: RUNTIME_OPERATIONS.filter(
                  (operation) =>
                    operation.execution !== 'server' &&
                    (client.deviceClass === 'managed' || operation.physical) &&
                    (operation.target?.role ?? 'app') === client.role,
                ).map((operation) => operation.mcpName),
              }));
              sendWsJson(
                ws,
                {
                  id: parsed.id,
                  result: {
                    sessionId,
                    serverReady: !serverShuttingDown,
                    owner: owner?.identity,
                    browser,
                    targets,
                  },
                },
                'runtime_status',
              );
              return;
            }

            if (parsed?.type === 'iwsdk_browser_hello') {
              intercepted = true;
              const deviceClass = normalizeDeviceClass(parsed.deviceClass);
              const headsetId =
                deviceClass === 'physical'
                  ? pairedHeadsets.get(parsed.headsetToken ?? '')
                  : undefined;
              const helloOwner = {
                sessionId,
                browserEpoch: controller.snapshot().browserEpoch,
                headsetId,
                fallbackPageId: connectionId,
              };
              const registered = browserClientMetadata.get(ws);
              if (registered) {
                // A socket carries one immutable endpoint generation. Another
                // hello may restate it with new readiness; any other change is
                // ignored so pending commands keep their admitted endpoint.
                const repeated = normalizeBrowserHello(parsed, helloOwner);
                if (
                  !repeated ||
                  !isSameBrowserEndpoint(registered, repeated) ||
                  !relay.registerBrowserClient(ws, repeated)
                ) {
                  traceRuntime('bridge_hello_rejected', {
                    connectionId,
                    deviceClass,
                    reason: 'endpoint_identity_immutable',
                  });
                  return;
                }
                browserClientMetadata.set(ws, repeated);
                if (repeated.commandReady) {
                  browserCommandReadyClients!.add(ws);
                } else {
                  browserCommandReadyClients!.delete(ws);
                }
                if (
                  repeated.deviceClass === 'managed' &&
                  isBrowserCommandPathReady()
                ) {
                  lastCommandReadyAt = new Date().toISOString();
                }
                controller.observe();
                return;
              }
              if (
                deviceClass === 'managed' &&
                (parsed.sessionId !== sessionId ||
                  parsed.browserEpoch !== controller.snapshot().browserEpoch ||
                  !['launching', 'running'].includes(
                    controller.snapshot().state,
                  ))
              ) {
                ws.close(1008, 'Stale managed browser identity');
                return;
              }
              const remoteAddress = request.socket.remoteAddress;
              if (!isBrowserBridgeConnectionAllowed(remoteAddress)) {
                traceRuntime('browser_bridge_rejected', {
                  connectionId,
                  deviceClass,
                  remoteAddress: remoteAddress ?? null,
                });
                ws.close(
                  1008,
                  'IWSDK browser command control requires a loopback connection.',
                );
                return;
              }
              if (deviceClass === 'physical' && !headsetId) {
                ws.close(
                  1008,
                  'Unpaired headset. Use runtime_pair_headset and open its URL on the device.',
                );
                return;
              }
              // Validate before touching any registry, so a malformed hello
              // cannot displace, sort beside or publish over a live endpoint.
              const browserClient = normalizeBrowserHello(parsed, helloOwner);
              if (!browserClient) {
                traceRuntime('bridge_hello_rejected', {
                  connectionId,
                  deviceClass,
                  reason: 'malformed_identity',
                });
                ws.close(1008, 'Malformed browser identity');
                return;
              }
              const { pageId, role: pageRole, tabGeneration } = browserClient;
              const predecessors = [...browserClientMetadata].filter(
                ([oldWs, old]) =>
                  oldWs !== ws &&
                  old.deviceClass === deviceClass &&
                  old.headsetId === browserClient.headsetId &&
                  old.pageId === pageId,
              );
              if (
                predecessors.some(
                  ([, old]) => old.tabGeneration > tabGeneration,
                )
              ) {
                ws.close(1008, 'Stale page generation');
                return;
              }
              // Retire the old connection before registering a new generation.
              for (const [oldWs] of predecessors) {
                browserClientMetadata.delete(oldWs);
                relay.unregisterClient(oldWs);
                oldWs.close(1001, 'Page generation superseded');
              }
              if (!relay.registerBrowserClient(ws, browserClient)) {
                ws.close(1008, 'Stale endpoint or endpoint capacity reached');
                return;
              }
              markConnectionKind(ws, 'bridge');
              browserPageRoles.set(ws, pageRole);
              browserClientMetadata.set(ws, browserClient);
              browserRuntimeClients!.add(ws);
              if (browserClient.commandReady) {
                browserCommandReadyClients!.add(ws);
              }
              if (deviceClass === 'managed') {
                // Loss evidence lasts until the whole command path is back.
                if (hasManagedCommandRoles(listBrowserClients())) {
                  managedBridgeLoss = undefined;
                }
                lastBridgeConnectedAt = new Date().toISOString();
                if (isBrowserCommandPathReady()) {
                  lastCommandReadyAt = lastBridgeConnectedAt;
                }
              }
              controller.observe();
              traceRuntime('bridge_hello', {
                connectionId,
                deviceClass,
                pageId,
                pageRole,
                sceneSessionId: browserClient.sceneSessionId ?? null,
                tabId: parsed.tabId ?? null,
                tabGeneration,
                connectedClientCount: browserRuntimeClients!.size,
              });
              return;
            }

            if (parsed?.type === 'iwsdk_browser_ready') {
              intercepted = true;
              if (browserRuntimeClients!.has(ws)) {
                const metadata = browserClientMetadata.get(ws);
                // A superseding hello can retire this socket before a queued
                // ready message is handled. Never recreate a metadata-less
                // relay endpoint from that late signal.
                if (metadata == null) {
                  return;
                }
                const readyMetadata = {
                  ...metadata,
                  commandReady: true,
                };
                browserClientMetadata.set(ws, readyMetadata);
                if (metadata.deviceClass === 'managed') {
                  lastCommandReadyAt = new Date().toISOString();
                }
                if (!relay.registerBrowserClient(ws, readyMetadata)) {
                  browserClientMetadata.delete(ws);
                  browserRuntimeClients!.delete(ws);
                  browserCommandReadyClients!.delete(ws);
                  ws.close(1008, 'Stale endpoint or endpoint capacity reached');
                  controller.observe();
                  return;
                }
                browserCommandReadyClients!.add(ws);
                controller.observe();
                const commandReady = isBrowserCommandPathReady();
                traceRuntime('bridge_command_ready', {
                  connectionId,
                  pageRole: browserPageRoles.get(ws) ?? null,
                  commandReady,
                });
              }
              return;
            }

            if (
              parsed.method === INTERNAL_RUNTIME_SHUTDOWN_METHOD &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              const expectedClaimId =
                process.env[INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV];
              if (
                expectedClaimId
                  ? parsed.params?.claimId !== expectedClaimId
                  : parsed.params?.sessionId !== sessionId ||
                    parsed.expectedSessionId !== sessionId
              ) {
                sendWsJson(
                  ws,
                  {
                    id: parsed.id,
                    error: {
                      code: -32001,
                      message: 'Runtime shutdown authorization failed',
                    },
                  },
                  'runtime_shutdown_rejected',
                );
                return;
              }
              sendWsJson(
                ws,
                { id: parsed.id, result: { accepted: true } },
                'runtime_shutdown_accepted',
              );
              setImmediate(() => {
                void server.close().catch((error) => {
                  console.error('[IWSDK Dev] Failed to close runtime:', error);
                });
              });
              return;
            }

            if (
              parsed.method === INTERNAL_BROWSER_PROBE_METHOD &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              traceRuntime('probe_request', {
                connectionId,
                requestId: parsed.id,
              });
              try {
                sendWsJson(
                  ws,
                  { id: parsed.id, result: createBrowserProbeResult(0) },
                  'probe_status',
                );
              } catch (error) {
                sendInternalError(ws, parsed.id, error, 'probe_error');
              }
              return;
            }

            if (
              parsed.method === 'scene_record_object_inspection' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              try {
                const params = parsed.params ?? {};
                const paths = resolveReviewWorkspacePaths(
                  params.scenePath,
                  config.root,
                );
                const current = readCurrentReviewScene(paths.scenePath);
                const result = recordObjectInspectionEvidence({
                  capabilityHash: requireSha256(
                    params.capabilityHash,
                    'capabilityHash',
                  ),
                  captures: params.captures,
                  document: current,
                  expectedDocumentHash: requireSha256(
                    params.expectedDocumentHash,
                    'expectedDocumentHash',
                  ),
                  featureId: params.featureId,
                  paths,
                  results: params.results,
                  workspaceRoot: config.root,
                });
                sendWsJson(
                  ws,
                  { id: parsed.id, result },
                  'scene_record_object_inspection_result',
                );
              } catch (error) {
                sendInternalError(
                  ws,
                  parsed.id,
                  error,
                  'scene_record_object_inspection_error',
                );
              }
              return;
            }

            if (
              parsed.method === 'scene_begin_review' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              try {
                const params = parsed.params ?? {};
                const paths = resolveReviewWorkspacePaths(
                  params.scenePath,
                  config.root,
                );
                const current = readCurrentReviewScene(paths.scenePath);
                const entryEvidence = validateReviewEntryEvidence({
                  document: current,
                  paths,
                  runtimePreflightReceipt: params.runtimePreflightReceipt,
                  workspaceRoot: config.root,
                });
                const state = beginSceneReviewWorkflow({
                  document: current,
                  expectedDocumentHash: requireSha256(
                    params.expectedDocumentHash,
                    'expectedDocumentHash',
                  ),
                  reviewRoot: paths.reviewRoot,
                });
                sendWsJson(
                  ws,
                  {
                    id: parsed.id,
                    result: {
                      documentHash: state.documentHash,
                      lockedMaxCorrectionRounds:
                        state.lockedMaxCorrectionRounds,
                      round: state.round,
                      runtimeHash: state.runtimeHash,
                      objectInspectionReceipts:
                        entryEvidence.objectInspectionReceipts,
                      runtimePreflightReceipt:
                        entryEvidence.runtimePreflightReceipt,
                      status: 'review-begun',
                      workflowPhase: state.phase,
                    },
                  },
                  'scene_begin_review_result',
                );
              } catch (error) {
                sendInternalError(
                  ws,
                  parsed.id,
                  error,
                  'scene_begin_review_error',
                );
              }
              return;
            }

            if (
              typeof parsed.method === 'string' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              const operation =
                RUNTIME_OPERATIONS.find(
                  (entry) => entry.wsMethod === parsed.method,
                ) ??
                (parsed.method === 'workspace_get_state'
                  ? {
                      execution: 'runtime',
                      physical: false,
                      target: { role: 'editor' },
                    }
                  : undefined);
              if (!operation) {
                sendWsJson(
                  ws,
                  {
                    id: parsed.id,
                    error: {
                      code: -32601,
                      message: 'Unknown runtime method',
                      data: { code: 'unknown_method', outcome: 'not_executed' },
                    },
                  },
                  'unknown_method',
                );
                return;
              }
              const target = {
                role: operation.target?.role ?? 'app',
                deviceClass: 'managed',
                ...parsed.target,
              } as ManagedBrowserCommandTarget;
              if (
                !['managed', 'physical'].includes(target.deviceClass!) ||
                target.role !== (operation.target?.role ?? 'app')
              ) {
                sendWsJson(
                  ws,
                  {
                    id: parsed.id,
                    error: {
                      code: -32602,
                      message:
                        "The target must use a supported deviceClass and the operation's owning page role.",
                      data: { code: 'invalid_target', outcome: 'not_executed' },
                    },
                  },
                  'invalid_target',
                );
                return;
              }
              if (target.deviceClass === 'physical') {
                if (
                  !target.headsetId ||
                  !target.pageId ||
                  !Number.isInteger(target.tabGeneration) ||
                  target.tabGeneration! < 1
                ) {
                  sendWsJson(
                    ws,
                    {
                      id: parsed.id,
                      error: {
                        code: -32602,
                        message:
                          'Physical targets require headsetId, pageId and tabGeneration from runtime_list_targets.',
                        data: {
                          code: 'invalid_target',
                          outcome: 'not_executed',
                        },
                      },
                    },
                    'invalid_target',
                  );
                  return;
                }
                if (!operation.physical) {
                  sendWsJson(
                    ws,
                    {
                      id: parsed.id,
                      error: {
                        code: -32004,
                        message: `${parsed.method} is not supported on physical headset targets.`,
                        data: {
                          code: 'unsupported_on_target',
                          target,
                          outcome: 'not_executed',
                        },
                      },
                    },
                    'unsupported_target',
                  );
                  return;
                }
              } else if (operation.execution === 'runtime') {
                const readiness = await ensureBrowser();
                if (!readiness.browser) {
                  sendUnavailableBrowser(ws, parsed.id, 'runtime_unavailable');
                  return;
                }
                if (readiness.relaunched) {
                  sendWsJson(
                    ws,
                    {
                      id: parsed.id,
                      error: {
                        code: -32010,
                        message: BROWSER_RELAUNCHED_RESULT.message,
                        data: {
                          ...BROWSER_RELAUNCHED_RESULT,
                          browser: createBrowserState(),
                        },
                      },
                    },
                    'runtime_recovered',
                  );
                  return;
                }
                const admittedBrowser = readiness.browser;
                const admittedEpoch = controller.snapshot().browserEpoch;
                target.sessionId ??= sessionId;
                target.browserEpoch ??= admittedEpoch;
                await waitForBridgeConnection(BRIDGE_READY_TIMEOUT_MS, target);
                if (
                  controller.current() !== admittedBrowser ||
                  controller.snapshot().browserEpoch !== admittedEpoch
                ) {
                  sendWsJson(
                    ws,
                    {
                      id: parsed.id,
                      error: {
                        code: -32010,
                        message: BROWSER_RELAUNCHED_RESULT.message,
                        data: {
                          ...BROWSER_RELAUNCHED_RESULT,
                          browser: createBrowserState(),
                        },
                      },
                    },
                    'runtime_generation_changed',
                  );
                  return;
                }
              }
              parsed.target = target;
              if (
                operation.execution === 'runtime' ||
                target.deviceClass === 'physical'
              ) {
                relay.onMessage(ws, JSON.stringify(parsed), mcpClients!);
                return;
              }
            }

            if (
              parsed.method === 'reload_page' &&
              typeof parsed.id === 'string' &&
              parsed.target?.deviceClass !== 'physical'
            ) {
              intercepted = true;
              await handleManagedBrowserRequest(
                ws,
                parsed as ManagedBrowserRpcRequest,
                {
                  command: 'browser_reload_page',
                  errorContext: 'reload_error',
                  execute: (browser) => browser.reloadApplication(),
                  resultContext: 'reload_result',
                  serialize: (
                    result: Awaited<
                      ReturnType<ManagedBrowser['reloadApplication']>
                    >,
                  ) => ({
                    reloaded: true,
                    url: result.url,
                  }),
                  unavailableContext: 'reload_unavailable',
                },
              );
              return;
            }

            if (
              parsed.method === 'browser_set_muted' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              await handleManagedBrowserRequest(
                ws,
                parsed as ManagedBrowserRpcRequest,
                {
                  command: 'browser_set_muted',
                  errorContext: 'set_muted_error',
                  execute: (browser) =>
                    browser.setAudioMuted(parsed.params?.muted as boolean),
                  resultContext: 'set_muted_result',
                  serialize: (muted: boolean) => ({ muted }),
                  unavailableContext: 'set_muted_unavailable',
                },
              );
              return;
            }

            if (
              parsed.method === 'browser_snapshot' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              await handleManagedBrowserRequest(
                ws,
                parsed as ManagedBrowserRpcRequest,
                {
                  command: 'browser_snapshot',
                  errorContext: 'browser_snapshot_error',
                  execute: (browser) =>
                    browser.snapshotApplication(parsed.params ?? {}),
                  resultContext: 'browser_snapshot_result',
                  unavailableContext: 'browser_snapshot_unavailable',
                },
              );
              return;
            }

            if (
              parsed.method === 'browser_interact' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              await handleManagedBrowserRequest(
                ws,
                parsed as ManagedBrowserRpcRequest,
                {
                  command: 'browser_interact',
                  errorContext: 'browser_interact_error',
                  execute: (browser) =>
                    browser.interactApplication(parsed.params as never),
                  resultContext: 'browser_interact_result',
                  unavailableContext: 'browser_interact_unavailable',
                },
              );
              return;
            }

            if (
              parsed.method === 'browser_profile' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              await handleManagedBrowserRequest(
                ws,
                parsed as ManagedBrowserRpcRequest,
                {
                  command: 'browser_profile',
                  errorContext: 'browser_profile_error',
                  execute: (browser) =>
                    browser.profileApplication(parsed.params as never),
                  resultContext: 'browser_profile_result',
                  unavailableContext: 'browser_profile_unavailable',
                },
              );
              return;
            }

            if (
              parsed.method === 'get_console_logs' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              const params = {
                ...(parsed.params ?? {}),
                ...((parsed.params ?? {}).level == null
                  ? { level: ['log', 'info', 'warn', 'error'] }
                  : {}),
              } as Parameters<ManagedBrowser['queryLogs']>[0];
              await handleManagedBrowserRequest(
                ws,
                parsed as ManagedBrowserRpcRequest,
                {
                  command: 'browser_get_console_logs',
                  errorContext: 'console_logs_error',
                  execute: (browser) =>
                    Promise.resolve(browser.queryLogs(params)),
                  resultContext: 'console_logs_result',
                  unavailableContext: 'console_logs_unavailable',
                },
              );
              return;
            }

            if (
              parsed.method === 'screenshot' &&
              typeof parsed.id === 'string'
            ) {
              intercepted = true;
              await handleManagedBrowserRequest(
                ws,
                parsed as ManagedBrowserRpcRequest,
                {
                  command: 'browser_screenshot',
                  errorContext: 'screenshot_error',
                  execute: (browser) =>
                    browser.captureRuntimeScreenshot(parsed.params ?? {}),
                  resultContext: 'screenshot_result',
                  serialize: (
                    capture: Awaited<
                      ReturnType<ManagedBrowser['captureRuntimeScreenshot']>
                    >,
                  ) => ({
                    ...capture.metadata,
                    imageData: capture.bytes.toString('base64'),
                  }),
                  unavailableContext: 'screenshot_unavailable',
                },
              );
              return;
            }

            if (
              intercepted &&
              typeof parsed.id === 'string' &&
              typeof parsed.method === 'string'
            ) {
              sendWsJson(
                ws,
                {
                  id: parsed.id,
                  error: {
                    code: -32603,
                    message: `No host handler is registered for ${parsed.method}.`,
                    data: {
                      code: 'host_handler_missing',
                      outcome: 'not_executed',
                    },
                  },
                },
                'host_handler_missing',
              );
              return;
            }
          } catch (error) {
            try {
              const failed = JSON.parse(message);
              if (typeof failed.id === 'string') {
                intercepted = true;
                sendInternalError(ws, failed.id, error, 'dispatch_error');
              }
            } catch {}
            traceRuntime('ws_message_parse_fallthrough', {
              connectionId,
              kind: getConnectionKind(ws),
              message:
                error instanceof Error ? error.message : 'non_json_message',
            });
          }

          if (!intercepted) {
            relay.onMessage(ws, message, mcpClients!);
          }
        });

        ws.on('close', (code, reasonBuffer) => {
          const kind = getConnectionKind(ws);
          const reason =
            typeof reasonBuffer === 'string'
              ? reasonBuffer
              : reasonBuffer.toString('utf8');
          mcpClients!.delete(ws);
          relay.unregisterClient(ws);
          const metadata = browserClientMetadata.get(ws);
          const removedBridge = browserRuntimeClients!.delete(ws);
          browserCommandReadyClients!.delete(ws);
          browserClientMetadata.delete(ws);
          if (
            removedBridge &&
            metadata?.deviceClass === 'managed' &&
            metadata.browserEpoch === controller.snapshot().browserEpoch
          ) {
            // Only status changes: a healthy Chromium is never restarted for
            // a lost bridge, and runtime_recover leaves it running.
            managedBridgeLoss = {
              browserEpoch: metadata.browserEpoch,
              at: new Date().toISOString(),
            };
          }
          if (removedBridge) {
            controller.observe();
          }
          traceRuntime('ws_closed', {
            connectionId,
            kind,
            code,
            reason,
            removedBridge,
            browserRuntimeClients: browserRuntimeClients!.size,
          });
          if (pluginOptions.verbose) {
            console.log('[IWSDK-MCP] Client disconnected');
          }
        });

        ws.on('error', (error) => {
          traceRuntime('ws_error', {
            connectionId,
            kind: getConnectionKind(ws),
            message: error instanceof Error ? error.message : String(error),
          });
          if (pluginOptions.verbose) {
            console.error('[IWSDK-MCP] WebSocket error:', error);
          }
        });
      });

      // Set up WebSocket endpoint for MCP - handle upgrade requests
      const handleMcpUpgrade = (
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer,
      ): void => {
        if (request.url !== '/__iwer_mcp') {
          return;
        }
        const origin = request.headers.origin;
        let sameOrigin = origin == null;
        let localHost = false;
        try {
          const host = new URL(`http://${request.headers.host}`).hostname;
          localHost = ['localhost', '127.0.0.1', '[::1]'].includes(host);
        } catch {}
        if (origin != null) {
          try {
            sameOrigin = new URL(origin).host === request.headers.host;
          } catch {}
        }
        if (
          !isBrowserBridgeConnectionAllowed(request.socket.remoteAddress) ||
          !localHost ||
          !sameOrigin
        ) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return;
        }
        const webSocketServer = mcpWss;
        if (serverShuttingDown || webSocketServer == null) {
          socket.destroy();
          return;
        }

        traceRuntime('ws_upgrade', {
          url: request.url,
          remoteAddress: request.socket.remoteAddress ?? null,
        });
        if (pluginOptions.verbose) {
          console.log('[IWSDK-MCP] WebSocket upgrade request received');
        }

        webSocketServer.handleUpgrade(request, socket, head, (ws) => {
          webSocketServer.emit('connection', ws, request);
        });
      };
      server.httpServer?.on('upgrade', handleMcpUpgrade);

      if (pluginOptions.verbose) {
        console.log(
          '🔌 IWSDK-MCP: WebSocket endpoint registered at /__iwer_mcp',
        );
      }

      // Register the project-local runtime session after server start.
      // Waiting for 'listening' lets us record Vite's actual chosen port.

      // Resolve IWSDK version for telemetry attribution
      let iwsdkVersion: string | undefined;
      try {
        const pluginPkgPath = path.join(
          config.root,
          'node_modules',
          '@iwsdk',
          'vite-plugin-dev',
          'package.json',
        );
        const pluginPkg = JSON.parse(readFileSync(pluginPkgPath, 'utf-8'));
        iwsdkVersion = pluginPkg.version;
      } catch {
        // Version detection is best-effort
      }

      let sessionRegistered = false;
      let sessionRegistration:
        | ReturnType<typeof registerRuntimeSession>
        | undefined;
      let sessionStartReported = false;
      let lifecycleHandlersInstalled = false;
      let workspaceShutdownPromise: Promise<void> | null = null;
      let pendingHttpListen: Promise<void> | null = null;
      const waitForShutdownStep = async (
        operation: Promise<unknown>,
      ): Promise<void> => {
        let timeout: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            operation.catch(() => {}),
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, 2_000);
            }),
          ]);
        } finally {
          if (timeout != null) {
            clearTimeout(timeout);
          }
        }
      };
      const processExitCleanup = () => {
        unregisterRuntimeSessionSync(config.root, sessionId);
      };
      const removeLifecycleHandlers = () => {
        if (!lifecycleHandlersInstalled) {
          return;
        }
        lifecycleHandlersInstalled = false;
        process.off('SIGINT', handleProcessSignal);
        process.off('SIGHUP', handleProcessSignal);
        process.off('SIGTERM', handleProcessSignal);
      };
      const stopApplicationListener = async (): Promise<void> => {
        // Vite considers a server that has not emitted `listening` closed, even
        // when Node has already begun an asynchronous bind. Join that bind so
        // shutdown can close it before releasing workspace ownership.
        while (pendingHttpListen) {
          await pendingHttpListen;
        }
        if (!httpServer?.listening) {
          return;
        }
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => {
            if (
              error &&
              (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
            ) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      };
      const shutdownManagedWorkspace = (): Promise<void> => {
        if (workspaceShutdownPromise) {
          return workspaceShutdownPromise;
        }
        serverShuttingDown = true;
        removeLifecycleHandlers();
        const retiringBrowser = controller.stop();
        const applicationListenerStopped = Promise.resolve().then(
          stopApplicationListener,
        );

        workspaceShutdownPromise = (async () => {
          relay.close();
          removeServerObservers();
          server.httpServer?.off?.('upgrade', handleMcpUpgrade);
          server.httpServer?.off?.('listening', handleServerListening);

          await waitForShutdownStep(retiringBrowser);
          const webSocketServer = mcpWss;
          mcpWss = null;
          if (webSocketServer) {
            for (const client of new Set([
              ...webSocketServer.clients,
              ...(mcpClients ?? []),
            ])) {
              try {
                client.terminate();
              } catch {}
            }
            mcpClients?.clear();
            await waitForShutdownStep(
              new Promise<void>((resolve) => {
                webSocketServer.close(() => resolve());
              }),
            );
          }

          // listen() resolves before this plugin's async registration finishes.
          // Join that write before unregistering or releasing the owner, so an
          // immediate close cannot publish state after its successor starts.
          await sessionRegistration?.catch(() => {});
          const releaseOwner = async () => {
            await controller.whenStopped();
            await ownerAcquisition?.catch(() => {});
            await applicationListenerStopped;
            // Keep discovery and the synchronous exit fallback alive until all
            // owned resources are confirmed stopped. The owner endpoint is the
            // last thing released, so a replacement can never overlap cleanup.
            if (sessionRegistered) {
              await unregisterRuntimeSession(config.root, sessionId);
              sessionRegistered = false;
            }
            process.off('exit', processExitCleanup);
            await owner?.release();
          };
          // The replacement cannot bind until this exact generation releases
          // ownership. A cleanup deadline rejects close; late confirmed cleanup
          // can still release the lease, without ever allowing overlap.
          const released = releaseOwner();
          void released.catch((error) =>
            console.error('[IWSDK Dev] Retaining owner lease:', error),
          );
          await retiringBrowser;
          await released;

          if (sessionStartReported) {
            reportSessionEnd(sessionId, {
              durationMs: Date.now() - sessionStartTime,
              reason: 'user_closed',
              clientVersion: iwsdkVersion,
            });
            sessionStartReported = false;
          }
        })();

        return workspaceShutdownPromise;
      };
      const handleProcessSignal = (signal: NodeJS.Signals): void => {
        if (serverShuttingDown) {
          return;
        }
        process.exitCode =
          signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143;
        void server.close().catch((error) => {
          console.error(`[IWSDK Dev] Failed to close after ${signal}:`, error);
        });
      };
      const installLifecycleHandlers = () => {
        if (lifecycleHandlersInstalled) {
          return;
        }
        lifecycleHandlersInstalled = true;
        process.on('SIGINT', handleProcessSignal);
        process.on('SIGHUP', handleProcessSignal);
        process.on('SIGTERM', handleProcessSignal);
        process.once('exit', processExitCleanup);
      };

      // Wait for server to start listening to get the actual port. The guard
      // prevents duplicate browser launches if the event is emitted twice.
      let serverListeningHandled = false;
      const handleServerListening = async (): Promise<void> => {
        if (serverListeningHandled || serverShuttingDown) {
          return;
        }
        serverListeningHandled = true;
        const address = server.httpServer?.address();
        const actualPort =
          typeof address === 'object' && address
            ? address.port
            : server.config.server.port || 5173;

        const protocol = server.config.server.https ? 'https' : 'http';
        const fallbackLocalUrl = `${protocol}://localhost:${actualPort}/`;
        browserUrl = new URL(
          '/',
          server.resolvedUrls?.local?.[0] ?? fallbackLocalUrl,
        ).toString();
        try {
          sessionRegistration = registerRuntimeSession({
            sessionId,
            commandToken,
            ownerSessionId: owner?.identity.sessionId,
            workspaceRoot: config.root,
            pid: process.pid,
            port: actualPort,
            localUrl: server.resolvedUrls?.local?.[0] ?? fallbackLocalUrl,
            networkUrls: server.resolvedUrls?.network ?? [],
            aiMode: pluginOptions.ai?.mode,
            browser: currentBrowserState ?? undefined,
            browserAutomation: {
              configured: pluginOptions.workspace?.browserAutomation ?? false,
              enabled: false,
              protocol: 'cdp',
            },
          });
          await sessionRegistration;
          sessionRegistered = true;
        } catch (error) {
          process.exitCode = 1;
          const prefix =
            error instanceof RuntimeSessionOwnershipError
              ? '[IWSDK Dev] Refusing to start a duplicate runtime session:'
              : '[IWSDK Dev] Failed to register runtime session:';
          console.error(prefix, error);
          await server.close().catch(() => {});
          return;
        }

        if (serverShuttingDown) {
          return;
        }
        installLifecycleHandlers();

        // Report session start to MetaVR telemetry (fire-and-forget).
        reportSessionStart(sessionId, {
          iwsdkVersion,
          clientVersion: iwsdkVersion,
          port: actualPort,
        });
        sessionStartReported = true;

        // Launch only under the enabled policy; --no-open also disables recovery.
        if (pluginOptions.workspace?.open !== false) {
          void launchBrowser();
        }
      };
      server.httpServer?.on('listening', handleServerListening);

      // Ownership is acquired immediately before the application listener binds.
      // A replacement can be prepared while the old server is still serving;
      // Vite closes the old listener and awaits its cleanup before calling listen
      // on the replacement. No handoff exception or second owner is needed.
      const originalClose = server.close?.bind(server);
      server.close = async () => {
        const stopping = shutdownManagedWorkspace();
        await Promise.all([originalClose?.(), stopping]);
      };
      // A host without Vite's listen has no bind failure to clean up after.
      const originalServerListen = server.listen?.bind(server);
      if (originalServerListen) {
        server.listen = async (port?: number, isRestart?: boolean) => {
          try {
            return await originalServerListen(port, isRestart);
          } catch (error) {
            // A bind error does not emit `close`, so Vite otherwise leaves the
            // workspace owner and plugin resources alive in an embedding host.
            await server.close().catch((cleanupError) => {
              console.error(
                '[IWSDK Dev] Failed to clean up after listener startup failed:',
                cleanupError,
              );
            });
            throw error;
          }
        };
      }
      if (httpServer?.listen) {
        const listen = httpServer.listen.bind(httpServer);
        const rejectListenerStart = () =>
          queueMicrotask(() =>
            httpServer.emit(
              'error',
              new Error('Runtime listener has stopped.'),
            ),
          );
        httpServer.listen = ((...args: Parameters<typeof listen>) => {
          if (serverShuttingDown) {
            rejectListenerStart();
            return httpServer;
          }
          // Unless strictPort is set (the default for a configured port),
          // Vite retries listen() with the next port after EADDRINUSE.
          // Ownership is memoized independently, so a retry remains the same
          // singleton runtime rather than a second owner acquisition.
          void acquireOwner()
            .then(() => {
              if (serverShuttingDown) {
                rejectListenerStart();
                return;
              }
              let settleHttpListen!: () => void;
              const attempt = new Promise<void>((resolve) => {
                settleHttpListen = resolve;
              });
              pendingHttpListen = attempt;
              const settle = () => {
                httpServer.off('listening', settle);
                httpServer.off('error', settle);
                if (pendingHttpListen === attempt) {
                  pendingHttpListen = null;
                }
                settleHttpListen();
              };
              httpServer.once('listening', settle);
              httpServer.once('error', settle);
              try {
                listen(...args);
              } catch (error) {
                settle();
                throw error;
              }
            })
            .catch((error) => {
              httpServer.emit('error', error);
              void server.close().catch(() => {});
            });
          return httpServer;
        }) as typeof httpServer.listen;
      } else {
        // Middleware-mode servers have no owned application listener.
        try {
          await acquireOwner();
        } catch (error) {
          // configureServer() can reject before Vite calls close hooks. Join
          // the same idempotent cleanup path here so relay deadlines, the
          // WebSocket server, and listeners created above cannot outlive a
          // failed owner acquisition.
          await shutdownManagedWorkspace().catch(() => {});
          throw error;
        }
      }

      // The HTTP close event cannot await cleanup, so start it here and let
      // Vite's awaited closeBundle hook join the same idempotent promise.
      server.httpServer?.on('close', () => {
        void shutdownManagedWorkspace().catch((error) => {
          console.error('[IWSDK Dev] Runtime cleanup failed:', error);
        });
      });
    },

    resolveId(id, importer) {
      // The pre-built emulator runtime and its lazy chunks (GLTS, rooms).
      const runtimeId = resolveInjectionRuntimeId(id, importer);
      if (runtimeId != null) {
        return runtimeId;
      }
      if (
        id === DISABLED_HAVOK_ID ||
        (!bundlePhysics && id === '@babylonjs/havok')
      ) {
        return RESOLVED_DISABLED_HAVOK_ID;
      }
      if (id === DISABLED_BUNDLED_FONTS_ID) {
        return RESOLVED_DISABLED_BUNDLED_FONTS_ID;
      }
      const bundledFont = Object.entries(BUNDLED_FONT_MODULES).find(
        ([, definition]) => definition.module === id,
      )?.[0];
      if (bundledFont && bundledFonts && !bundledFonts.has(bundledFont)) {
        return RESOLVED_DISABLED_BUNDLED_FONTS_ID;
      }
      if (id === VIRTUAL_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
      if (id === EDITOR_RUNTIME_ID) {
        return RESOLVED_EDITOR_RUNTIME_ID;
      }
      if (id === EDITOR_STYLESHEET_ID) {
        return RESOLVED_EDITOR_STYLESHEET_ID;
      }
      if (id === ASSET_MANIFEST_ID) {
        return RESOLVED_ASSET_MANIFEST_ID;
      }
      if (id === COMPONENT_MANIFEST_ID) {
        return RESOLVED_COMPONENT_MANIFEST_ID;
      }
      if (id === PROJECT_MODULE_ID) {
        return RESOLVED_PROJECT_MODULE_ID;
      }
    },

    transform(code, id) {
      return config.command === 'build'
        ? (rewriteThreeDecoderDefaults(code, id) ??
            rewriteUIKitMLLucideKit(code, id, bundledIcons))
        : null;
    },

    async load(id) {
      const runtimeFile =
        injectionBundle && resolveInjectionRuntimeFile(injectionBundle, id);
      if (runtimeFile != null) {
        return readFileSync(runtimeFile, 'utf8');
      }
      if (id === RESOLVED_DISABLED_HAVOK_ID) {
        return createDisabledHavokModule();
      }
      if (id === RESOLVED_DISABLED_BUNDLED_FONTS_ID) {
        return createDisabledBundledFontsModule();
      }
      if (id === RESOLVED_VIRTUAL_ID) {
        if (!injectionBundle) {
          return 'console.warn("[IWSDK Dev] Runtime not available - injection bundle not loaded");';
        }
        return `${createInjectionModuleSource(injectionBundle)}
if (import.meta.hot) {
  const role =
    window.__IWSDK_MCP_PAGE_ROLE === 'editor'
      ? 'editor'
      : window.parent === window
        ? 'runtime'
        : 'preview';
  import.meta.hot.send('${HOT_CLIENT_ROLE_EVENT}', { role });
}`;
      }
      if (id === RESOLVED_EDITOR_RUNTIME_ID) {
        return createEditorRuntimeModuleSource(
          getEditorSessionModuleImport(),
          getCoreModuleImport(),
          ASSET_MANIFEST_ID,
          COMPONENT_MANIFEST_ID,
        );
      }
      if (id === RESOLVED_ASSET_MANIFEST_ID) {
        if (pluginOptions.assetManifest == null) {
          return 'export default {}';
        }
        const manifestPath = path.resolve(
          config.root,
          pluginOptions.assetManifest,
        );
        if (!existsSync(manifestPath)) {
          throw new Error(
            `[IWSDK] Asset manifest was not found: ${manifestPath}`,
          );
        }
        return `export { default } from ${JSON.stringify(`/@fs/${manifestPath}`)};`;
      }
      if (id === RESOLVED_COMPONENT_MANIFEST_ID) {
        if (pluginOptions.componentManifest == null) {
          return 'export default []';
        }
        const manifestPath = path.resolve(
          config.root,
          pluginOptions.componentManifest,
        );
        if (!existsSync(manifestPath)) {
          throw new Error(
            `[IWSDK] Component manifest was not found: ${manifestPath}`,
          );
        }
        const resolved = await this.resolve(manifestPath, undefined, {
          skipSelf: true,
        });
        const moduleId = resolved?.id ?? `/@fs/${manifestPath}`;
        return `export { default } from ${JSON.stringify(moduleId)};`;
      }
      if (id === RESOLVED_PROJECT_MODULE_ID) {
        if (loadedProject == null) {
          throw new Error(
            '[IWSDK] virtual:iwsdk-project requires iwsdk.config.json at the Vite project root.',
          );
        }
        return createProjectVirtualModuleSource(
          loadedProject.manifest,
          pluginOptions.nativeXRControl,
        );
      }
      if (id === RESOLVED_EDITOR_STYLESHEET_ID) {
        return EDITOR_SHELL_CSS;
      }
    },

    async handleHotUpdate(context) {
      if (
        loadedProject != null &&
        pathsReferToSameFile(context.file, loadedProject.configPath)
      ) {
        // Restarting from inside Vite's HMR callback destroys the callback's
        // `hot` context. Awaiting it here lets Vite resume against that torn-
        // down object and crash (`Cannot set properties of undefined`). Defer
        // until the watcher turn has returned, then let the new server/plugin
        // instance relaunch and reattach the managed browser normally.
        setTimeout(() => {
          void context.server.restart().catch((error) => {
            console.error('[IWSDK] Failed to reload iwsdk.config.json:', error);
          });
        }, 0);
        return [];
      }
      const changedModules = context.modules ?? [];
      if (
        pluginOptions.componentManifest != null &&
        changedModules.some((module) =>
          moduleImportsComponentManifest(
            module,
            new Set([
              RESOLVED_COMPONENT_MANIFEST_ID,
              path.resolve(
                config.root,
                pluginOptions.componentManifest as string,
              ),
            ]),
          ),
        )
      ) {
        context.server.ws.send({ type: 'full-reload' });
        return [];
      }

      // Vite resolves module files through symlinks, while its root and watcher
      // may retain an alias (for example /var vs /private/var on macOS).
      const sourceRoot = canonicalFilePath(config.root);
      const sourceFile = canonicalFilePath(context.file);
      const isProjectSource =
        isPathInside(sourceRoot, sourceFile) &&
        changedModules.some(
          (module) =>
            module.file != null &&
            isPathInside(sourceRoot, canonicalFilePath(module.file)) &&
            pathsReferToSameFile(module.file, context.file),
        );
      const relativePath = path.relative(sourceRoot, sourceFile);
      const clients = [...(context.server.ws?.clients ?? [])];
      if (
        !isProjectSource ||
        !clients.some((client) => hotClientRoles.get(client) === 'editor')
      ) {
        return;
      }

      // Let Vite deliver ordinary HMR updates when every affected module
      // accepts its own update or is accepted by all of its importers.
      // Intercepting those updates here would suppress the accept handler in
      // both the runtime and preview frames. This direct-importer check is
      // deliberately conservative: an extra runtime-only reload is safer than
      // letting a transitive boundary trigger an editor reload.
      const isAcceptedByViteHmr = (module: ModuleNode) =>
        module.isSelfAccepting ||
        (module.importers.size > 0 &&
          [...module.importers].every((importer) =>
            importer.acceptedHmrDeps.has(module),
          ));
      if (changedModules.every(isAcceptedByViteHmr)) {
        return;
      }

      for (const client of clients) {
        const role = hotClientRoles.get(client);
        if (role === 'editor') {
          client.send(RUNTIME_SOURCE_CHANGE_EVENT, {
            path: toPosixPath(relativePath),
          });
        } else if (role === 'runtime') {
          client.send({ type: 'full-reload' });
        }
      }
      return [];
    },

    async buildStart() {
      if (loadedProject != null) {
        this.addWatchFile(loadedProject.configPath);
      }
      if (config.command === 'build') {
        const validation = await validateUIKitMLDirectory(
          config.publicDir || path.resolve(config.root, 'public'),
        );
        for (const file of validation.files) {
          this.addWatchFile(file);
        }
        for (const warning of validation.warnings) {
          this.warn(warning);
        }
      }
      // Development always builds the managed-workspace bridge, even when
      // IWER is disabled. Production builds include only explicitly enabled
      // IWER emulation; the editor bridge is never a production side effect.
      const shouldInject = shouldInjectRuntime(config.command, pluginOptions);

      if (!shouldInject) {
        if (pluginOptions.verbose) {
          if (config.command === 'build' && pluginOptions.iwer === false) {
            console.log(
              '⏭️  IWSDK Dev: Skipping build injection (IWER disabled)',
            );
          } else if (config.command === 'build') {
            console.log(
              '⏭️  IWSDK Dev: Skipping build injection (injectOnBuild: false)',
            );
          }
        }
        return;
      }

      try {
        if (pluginOptions.verbose) {
          console.log('🚀 IWSDK Dev: Starting injection bundle generation...');
        }

        injectionBundle = await buildInjectionBundle(pluginOptions);

        if (pluginOptions.verbose) {
          console.log('✅ IWSDK Dev: Injection bundle ready');
        }
      } catch (error) {
        console.error(
          '❌ IWSDK Dev: Failed to generate injection bundle:',
          error,
        );
        // Continue without injection rather than failing the build
      }
    },

    transformIndexHtml: {
      order: 'pre', // Run before other HTML transformations
      handler(html) {
        // Check if the IWER runtime or managed-workspace bridge should load.
        const shouldInject = shouldInjectRuntime(config.command, pluginOptions);

        if (!shouldInject || !injectionBundle) {
          return html;
        }

        if (pluginOptions.verbose) {
          console.log('💉 IWSDK Dev: Injecting runtime script into HTML');
        }

        // Inject the script using Vite's tag API for robustness
        return {
          tags: [
            {
              tag: 'script',
              attrs: { type: 'module', src: VIRTUAL_ID },
              injectTo: 'head',
            },
          ],
        } as any;
      },
    },

    // Display summary at the end of build process
    closeBundle: {
      order: 'post',
      async handler() {
        // Only show summary when the runtime/workspace bundle actually loaded.
        const shouldInject = shouldInjectRuntime(config.command, pluginOptions);

        if (shouldInject && injectionBundle) {
          const mode = config.command === 'serve' ? 'Development' : 'Build';
          console.log(`\n🥽 IWSDK Dev Summary (${mode}):`);
          console.log(`  - Device: ${pluginOptions.device}`);
          console.log(
            `  - Runtime injected: ${(injectionBundle.size / 1024).toFixed(1)}KB`,
          );
          console.log(`  - Activation mode: ${pluginOptions.activation}`);

          if (pluginOptions.sem) {
            console.log(
              `  - SEM environment: ${pluginOptions.sem.defaultScene}`,
            );
          }

          if (pluginOptions.ai) {
            console.log(
              `  - AI: ${pluginOptions.ai.mode} mode (WebSocket at /__iwer_mcp)`,
            );
          }
          if (pluginOptions.workspace && !pluginOptions.ai) {
            console.log('  - Workspace: enabled (WebSocket at /__iwer_mcp)');
          }

          if (pluginOptions.activation === 'localhost') {
            console.log(
              '  - Note: Runtime only activates on localhost/local networks',
            );
          }

          console.log(''); // Extra line for spacing
        }
      },
    },
  };
}

function moduleImportsComponentManifest(
  module: ModuleNode,
  targets: ReadonlySet<string>,
  visited = new Set<ModuleNode>(),
): boolean {
  if (visited.has(module)) {
    return false;
  }
  visited.add(module);
  const id = module.id?.split('?', 1)[0];
  if (id != null && targets.has(id)) {
    return true;
  }
  return [...module.importers].some((importer) =>
    moduleImportsComponentManifest(importer, targets, visited),
  );
}

function getRequestPathname(url: string | undefined): string {
  if (url == null) {
    return '';
  }

  try {
    return new URL(url, 'http://iwsdk.local').pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] ?? url;
  }
}

function getRequestSearch(url: string | undefined): string {
  if (url == null) {
    return '';
  }

  try {
    return new URL(url, 'http://iwsdk.local').search;
  } catch {
    const searchIndex = url.indexOf('?');
    return searchIndex === -1 ? '' : url.slice(searchIndex);
  }
}

function isIframeNavigation(request: IncomingMessage): boolean {
  return getRequestHeaderValue(request, 'sec-fetch-dest') === 'iframe';
}

function sendWorkspaceShell(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(
    createEditorShellHtml(
      VIRTUAL_ID,
      EDITOR_RUNTIME_ID,
      EDITOR_STYLESHEET_ID,
      `${EDITOR_ROUTE}/document`,
      {
        projectFilesUrl: WORKSPACE_FILES_ROUTE,
        publishUrl: WORKSPACE_PUBLISH_ROUTE,
        runtimePreflightUrl: WORKSPACE_RUNTIME_PREFLIGHT_ROUTE,
        reviewCapturesUrl: WORKSPACE_REVIEW_CAPTURES_ROUTE,
        reviewsUrl: WORKSPACE_REVIEWS_ROUTE,
        sceneFilesUrl: WORKSPACE_SCENES_ROUTE,
      },
    ),
  );
}

function hasManagedWorkspaceAccess(
  request: IncomingMessage,
  token: string,
): boolean {
  if (getHeaderValue(request.headers?.[MANAGED_WORKSPACE_HEADER]) === token) {
    return true;
  }

  try {
    const parsed = new URL(request.url ?? '', 'http://iwsdk.local');
    return parsed.searchParams.get(MANAGED_WORKSPACE_QUERY) === token;
  } catch {
    return false;
  }
}

/** Compares a runtime command's credential in constant time. */
function hasRuntimeCommandCredential(
  presented: unknown,
  expected: Buffer,
): boolean {
  if (typeof presented !== 'string') {
    return false;
  }
  const actual = Buffer.from(presented, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getHeaderValue(
  value: string | string[] | number | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return value;
}

function getRequestHeaderValue(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const lowerName = name.toLowerCase();
  const direct = getHeaderValue(request.headers[lowerName]);
  if (direct != null) {
    return direct;
  }
  const entry = Object.entries(request.headers).find(
    ([key]) => key.toLowerCase() === lowerName,
  );
  return getHeaderValue(entry?.[1]);
}

function normalizeSceneRevisionHeader(
  value: string | undefined,
): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function redirectToRuntimeApp(response: ServerResponse): void {
  response.statusCode = 302;
  response.setHeader('Location', '/');
  response.end();
}

function redirectToWorkspace(
  response: ServerResponse,
  requestUrl: string | undefined,
): void {
  response.statusCode = 302;
  response.setHeader(
    'Location',
    `${WORKSPACE_ROUTE}${getRequestSearch(requestUrl)}`,
  );
  response.end();
}

function sendJsonError(
  response: ServerResponse,
  statusCode: number,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: message, ...extra }));
}

async function handleOpenRuntimeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  server: ViteDevServer,
): Promise<void> {
  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.setHeader('Allow', 'POST');
    response.end('Method not allowed');
    return;
  }

  const localUrl = server.resolvedUrls?.local?.[0];
  if (localUrl == null) {
    sendJsonError(response, 503, 'The local runtime URL is not available yet.');
    return;
  }

  try {
    await open(new URL('/', localUrl).toString(), { wait: false });
    response.statusCode = 204;
    response.end();
  } catch (error) {
    console.error('[IWSDK] Failed to open the default browser:', error);
    sendJsonError(response, 500, 'Failed to open the default browser.');
  }
}

async function handleEditorDocumentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceRoot: string,
  issuedTransitions: IssuedReviewTransitionRegistry,
  defaultScene?: string,
): Promise<void> {
  try {
    const scenePath = resolveEditorScenePath(
      request.url,
      workspaceRoot,
      defaultScene,
    );
    const relativeScenePath = path.relative(workspaceRoot, scenePath);

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (!existsSync(scenePath)) {
        sendJsonError(response, 404, 'Scene file does not exist.', {
          code: 'scene_file_not_found',
          path: relativeScenePath,
        });
        return;
      }
      const revision = getSceneFileRevision(scenePath);
      const documentText = readFileSync(scenePath, 'utf8');
      const document = parseSceneDocument(documentText, {
        validateAuthoringWorkflow: false,
      });
      const parsedRequest = new URL(request.url ?? '', 'http://iwsdk.local');
      const wantsComposedDocument =
        parsedRequest.searchParams.get('mode') === 'composed';
      const composed = wantsComposedDocument
        ? await composeWorkspaceSceneDocument(
            document,
            scenePath,
            workspaceRoot,
          )
        : null;
      const responseDocument = composed?.document ?? document;
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('X-IWSDK-Scene-Path', relativeScenePath);
      response.setHeader('X-IWSDK-Scene-Revision', revision.revision);
      response.setHeader(
        'X-IWSDK-Scene-Source-Hash',
        hashSceneDocument(document),
      );
      response.setHeader(
        'X-IWSDK-Scene-Document-Hash',
        hashSceneDocument(responseDocument),
      );
      response.setHeader(
        'X-IWSDK-Scene-Runtime-Hash',
        hashRuntimeSceneDocument(responseDocument),
      );
      response.end(
        request.method === 'HEAD'
          ? undefined
          : wantsComposedDocument
            ? JSON.stringify({
                dependencies: composed?.dependencies ?? [],
                document: responseDocument,
                documentHash: hashSceneDocument(responseDocument),
                path: toPosixPath(relativeScenePath),
                revision: revision.revision,
                runtimeHash: hashRuntimeSceneDocument(responseDocument),
                sourceDocument: document,
                sourceDocumentHash: hashSceneDocument(document),
              })
            : documentText,
      );
      return;
    }

    if (request.method === 'PUT') {
      if (!existsSync(scenePath)) {
        sendJsonError(response, 404, 'Scene file does not exist.', {
          code: 'scene_file_not_found',
          path: relativeScenePath,
        });
        return;
      }
      const body = await readRequestBody(request);
      const document = parseSceneDocument(body, {
        validateAuthoringWorkflow: false,
      });
      const serialized = serializeSceneDocument(document, {
        validateAuthoringWorkflow: false,
      });
      const documentHash = hashSceneDocument(document);
      const runtimeHash = hashRuntimeSceneDocument(document);
      const currentRevision = getSceneFileRevision(scenePath);
      const expectedRevision = normalizeSceneRevisionHeader(
        getRequestHeaderValue(request, 'if-match') ??
          getRequestHeaderValue(request, 'x-iwsdk-scene-revision'),
      );
      if (currentRevision.exists && expectedRevision == null) {
        sendJsonError(
          response,
          409,
          'Scene file revision is required before overwriting an existing scene.',
          {
            code: 'scene_revision_required',
            currentRevision: currentRevision.revision,
            path: relativeScenePath,
          },
        );
        return;
      }
      if (
        expectedRevision != null &&
        expectedRevision !== currentRevision.revision
      ) {
        sendJsonError(response, 409, 'Scene file changed on disk.', {
          code: 'scene_revision_conflict',
          currentRevision: currentRevision.revision,
          expectedRevision,
          path: relativeScenePath,
        });
        return;
      }
      const transitionTokenValue = getRequestHeaderValue(
        request,
        'x-iwsdk-review-transition',
      );
      let issuedTransition: IssuedReviewTransition | null = null;
      let transitionToken: `sha256:${string}` | null = null;
      if (transitionTokenValue != null) {
        const currentDocument = parseSceneDocument(
          readFileSync(scenePath, 'utf8'),
          { validateAuthoringWorkflow: false },
        );
        transitionToken = requireSha256(
          transitionTokenValue,
          'x-iwsdk-review-transition',
        );
        issuedTransition = issuedTransitions.require(
          transitionToken,
          requireReviewCaptureSessionId(
            getRequestHeaderValue(request, 'x-iwsdk-scene-session'),
          ),
          toPosixPath(relativeScenePath),
          documentHash,
        );
        if (
          issuedTransition.baseDocumentHash.toLowerCase() !==
          hashSceneDocument(currentDocument).toLowerCase()
        ) {
          throw new SceneReviewWorkflowError(
            'The persisted scene no longer matches the authorized transition base.',
            'review_transition_base_mismatch',
          );
        }
      }
      mkdirSync(path.dirname(scenePath), { recursive: true });
      const previousBytes = currentRevision.exists
        ? readFileSync(scenePath)
        : null;
      writeFileSync(scenePath, serialized, 'utf8');
      let committedWorkflowState: ReturnType<
        typeof commitSceneReviewTransition
      > | null = null;
      if (issuedTransition != null && transitionToken != null) {
        try {
          committedWorkflowState = commitSceneReviewTransition({
            document,
            plan: issuedTransition.plan,
            reviewRoot: issuedTransition.reviewRoot,
          });
          issuedTransitions.consume(transitionToken);
        } catch (error) {
          if (previousBytes == null) {
            unlinkSync(scenePath);
          } else {
            writeFileSync(scenePath, previousBytes);
          }
          throw error;
        }
      }
      const writtenRevision = getSceneFileRevision(scenePath);
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          bytes: Buffer.byteLength(serialized),
          correction: committedWorkflowState?.headCorrection ?? null,
          documentHash,
          path: relativeScenePath,
          previousRevision: currentRevision.revision,
          revision: writtenRevision.revision,
          runtimeHash,
          savedAt: new Date().toISOString(),
          workflowPhase: committedWorkflowState?.phase ?? null,
          writtenRevision: writtenRevision.revision,
        }),
      );
      return;
    }

    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD, PUT');
    response.end('Method not allowed');
  } catch (error) {
    if (
      error instanceof WorkspaceReviewError ||
      error instanceof SceneReviewWorkflowError
    ) {
      sendReviewRequestError(response, error);
      return;
    }
    response.statusCode = 400;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    const diagnostics = Array.isArray((error as { issues?: unknown }).issues)
      ? (error as { issues: unknown[] }).issues
      : [];
    response.end(
      JSON.stringify({
        code: 'scene_file_invalid',
        diagnostics,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function handleWorkspaceScenesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceRoot: string,
): Promise<void> {
  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const files = listSceneFiles(workspaceRoot);
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        request.method === 'HEAD' ? undefined : JSON.stringify({ files }),
      );
      return;
    }

    if (request.method === 'POST') {
      const body = JSON.parse(await readRequestBody(request, 64 * 1024)) as {
        action?: unknown;
        outputPath?: unknown;
        overwrite?: unknown;
        path?: unknown;
      };
      if (body.action !== 'flatten') {
        throw new Error('Unsupported scene-file action');
      }
      if (typeof body.path !== 'string' || body.path.trim().length === 0) {
        throw new Error('Scene flatten requires a source path');
      }
      const sourcePath = resolveManagedScenePath(body.path, workspaceRoot);
      if (!existsSync(sourcePath)) {
        sendJsonError(response, 404, 'Scene file does not exist.', {
          code: 'scene_file_not_found',
          path: toPosixPath(path.relative(workspaceRoot, sourcePath)),
        });
        return;
      }
      const sourceRelativePath = toPosixPath(
        path.relative(workspaceRoot, sourcePath),
      );
      const sourceDocument = parseSceneDocument(
        readFileSync(sourcePath, 'utf8'),
        { validateAuthoringWorkflow: false },
      );
      if ((sourceDocument.imports?.length ?? 0) === 0) {
        sendJsonError(response, 409, 'Scene is already import-free.', {
          code: 'scene_already_flat',
          path: sourceRelativePath,
        });
        return;
      }
      const defaultOutputPath = sourceRelativePath.replace(
        SCENE_FILE_SUFFIX,
        `.flat${SCENE_FILE_SUFFIX}`,
      );
      const outputPath = resolveManagedScenePath(
        typeof body.outputPath === 'string' && body.outputPath.trim().length > 0
          ? body.outputPath
          : defaultOutputPath,
        workspaceRoot,
      );
      const overwrite = body.overwrite === true;
      if (existsSync(outputPath) && !overwrite) {
        sendJsonError(response, 409, 'Flatten destination already exists.', {
          code: 'scene_flatten_destination_exists',
          outputPath: toPosixPath(path.relative(workspaceRoot, outputPath)),
        });
        return;
      }

      const composed = await composeWorkspaceSceneDocument(
        sourceDocument,
        sourcePath,
        workspaceRoot,
      );
      const sourceRuntimeHash = hashRuntimeSceneDocument(composed.document);
      const serialized = serializeSceneDocument(composed.document, {
        validateAuthoringWorkflow: false,
      });
      const flatDocument = parseSceneDocument(serialized, {
        validateAuthoringWorkflow: false,
      });
      const outputRuntimeHash = hashRuntimeSceneDocument(flatDocument);
      if (sourceRuntimeHash !== outputRuntimeHash) {
        sendJsonError(
          response,
          409,
          'Flattening changed runtime semantics; no file was written.',
          {
            code: 'scene_flatten_runtime_hash_mismatch',
            outputRuntimeHash,
            sourceRuntimeHash,
          },
        );
        return;
      }

      mkdirSync(path.dirname(outputPath), { recursive: true });
      const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
      try {
        writeFileSync(temporaryPath, serialized, 'utf8');
        renameSync(temporaryPath, outputPath);
      } finally {
        if (existsSync(temporaryPath)) {
          unlinkSync(temporaryPath);
        }
      }
      const outputRelativePath = toPosixPath(
        path.relative(workspaceRoot, outputPath),
      );
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          dependencies: composed.dependencies,
          documentHash: hashSceneDocument(flatDocument),
          outputPath: outputRelativePath,
          outputRuntimeHash,
          sourcePath: sourceRelativePath,
          sourceRuntimeHash,
          written: true,
        }),
      );
      return;
    }

    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD, POST');
    response.end('Method not allowed');
  } catch (error) {
    response.statusCode = 400;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function handleWorkspaceFilesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceRoot: string,
): Promise<void> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end('Method not allowed');
      return;
    }
    const parsed = new URL(request.url ?? '', 'http://iwsdk.local');
    const subfolder = parsed.searchParams.get('subfolder')?.trim() ?? '';
    const extensions = new Set(
      (parsed.searchParams.get('fileTypes') ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => /^\.[a-z0-9]+$/u.test(entry)),
    );
    const publicRoot = path.resolve(workspaceRoot, 'public');
    const browseRoot = path.resolve(publicRoot, subfolder);
    // The walk skips symbolic links; only the subfolder path can contain one.
    if (
      !isPathInside(publicRoot, browseRoot) ||
      !isRealPathInside(publicRoot, browseRoot)
    ) {
      throw new Error('File picker subfolder must stay inside public/.');
    }
    const files: Array<{ path: string; size: number }> = [];
    const visit = (directory: string): void => {
      if (!existsSync(directory)) {
        return;
      }
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath);
        } else if (
          entry.isFile() &&
          (extensions.size === 0 ||
            extensions.has(path.extname(entry.name).toLowerCase()))
        ) {
          files.push({
            path: `./${toPosixPath(path.relative(publicRoot, absolutePath))}`,
            size: statSync(absolutePath).size,
          });
        }
      }
    };
    visit(browseRoot);
    files.sort((left, right) => left.path.localeCompare(right.path));
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      request.method === 'HEAD' ? undefined : JSON.stringify({ files }),
    );
  } catch (error) {
    sendJsonError(
      response,
      400,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/**
 * Resolves symbolic links in the existing part of a path and appends the
 * missing tail unchanged. Returns null when the path cannot be resolved, such
 * as through a dangling link that a write would follow.
 */
function resolveRealPath(targetPath: string): string | null {
  const missing: string[] = [];
  let current = path.resolve(targetPath);
  while (true) {
    try {
      return path.join(realpathSync.native(current), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return null;
      }
    }
    try {
      lstatSync(current);
      return null;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    missing.unshift(path.basename(current));
    current = parent;
  }
}

/** Lexical checks cannot see symbolic links; this compares real paths. */
function isRealPathInside(parentPath: string, candidatePath: string): boolean {
  const realParent = resolveRealPath(parentPath);
  const realCandidate = resolveRealPath(candidatePath);
  return (
    realParent != null &&
    realCandidate != null &&
    isPathInside(realParent, realCandidate)
  );
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

interface ReviewWorkspacePaths {
  evidenceRoot: string;
  inspectionsRoot: string;
  proofsRoot: string;
  recordsRoot: string;
  reviewRoot: string;
  runtimeRoot: string;
  scenePath: string;
}

interface ReviewRecordSummary {
  captureCount: number;
  current: boolean;
  documentHash: string;
  path: string;
  result: SceneReview['result'];
  reviewSha256: string;
  round: number;
  runtimeHash: string;
  version: SceneReview['version'];
}

interface PersistedReviewCapture {
  byteLength: number;
  capabilityHash: `sha256:${string}`;
  captureId: string;
  captureToken: `sha256:${string}`;
  documentHash: `sha256:${string}`;
  facts: Record<string, unknown>;
  height: number;
  path: string;
  runtimeHash: `sha256:${string}`;
  sessionIdSha256: `sha256:${string}`;
  screenshotSha256: `sha256:${string}`;
  version: 'iwsdk.review-capture.v1';
  width: number;
}

interface IssuedReviewCapture {
  bytes: Buffer;
  captureToken: `sha256:${string}`;
  facts: Record<string, unknown>;
  persistedCaptureId?: string;
  scene: string;
  sessionId: string;
}

class IssuedReviewCaptureRegistry {
  private readonly captures = new Map<string, IssuedReviewCapture>();
  private totalBytes = 0;

  issue(capture: IssuedReviewCapture): void {
    this.captures.set(capture.captureToken, capture);
    this.totalBytes += capture.bytes.length;
    while (
      this.captures.size > MAX_ISSUED_REVIEW_CAPTURES ||
      this.totalBytes > MAX_ISSUED_REVIEW_CAPTURE_BYTES
    ) {
      const oldest = this.captures.entries().next().value as
        | [string, IssuedReviewCapture]
        | undefined;
      if (oldest == null || oldest[0] === capture.captureToken) {
        break;
      }
      this.captures.delete(oldest[0]);
      this.totalBytes -= oldest[1].bytes.length;
    }
  }

  require(
    captureToken: `sha256:${string}`,
    sessionId: string,
    scene: string,
  ): IssuedReviewCapture {
    const capture = this.captures.get(captureToken);
    if (capture == null) {
      throw new WorkspaceReviewError(
        'captureToken was not issued by this managed workspace session.',
        400,
        'unknown_review_capture',
      );
    }
    if (capture.sessionId !== sessionId || capture.scene !== scene) {
      throw new WorkspaceReviewError(
        'captureToken is not valid for this scene editor session.',
        403,
        'review_capture_session_mismatch',
      );
    }
    return capture;
  }
}

interface IssuedReviewTransition {
  baseDocumentHash: `sha256:${string}`;
  candidateDocumentHash: `sha256:${string}`;
  plan: SceneReviewTransitionPlan;
  reviewRoot: string;
  scene: string;
  sessionId: string;
  transitionToken: `sha256:${string}`;
}

class IssuedReviewTransitionRegistry {
  private readonly transitions = new Map<string, IssuedReviewTransition>();

  issue(
    transition: Omit<IssuedReviewTransition, 'transitionToken'>,
  ): `sha256:${string}` {
    const transitionToken = hashBytes(
      canonicalizeJson({
        baseDocumentHash: transition.baseDocumentHash,
        candidateDocumentHash: transition.candidateDocumentHash,
        nonce: randomUUID(),
        scene: transition.scene,
        sessionId: transition.sessionId,
      }),
    ) as `sha256:${string}`;
    this.transitions.set(transitionToken, { ...transition, transitionToken });
    while (this.transitions.size > MAX_ISSUED_REVIEW_TRANSITIONS) {
      const oldest = this.transitions.keys().next().value as string | undefined;
      if (oldest == null || oldest === transitionToken) {
        break;
      }
      this.transitions.delete(oldest);
    }
    return transitionToken;
  }

  require(
    transitionToken: `sha256:${string}`,
    sessionId: string,
    scene: string,
    candidateDocumentHash: `sha256:${string}`,
  ): IssuedReviewTransition {
    const transition = this.transitions.get(transitionToken);
    if (transition == null) {
      throw new WorkspaceReviewError(
        'transitionToken was not issued by this managed workspace session.',
        400,
        'unknown_review_transition',
      );
    }
    if (
      transition.sessionId !== sessionId ||
      transition.scene !== scene ||
      transition.candidateDocumentHash.toLowerCase() !==
        candidateDocumentHash.toLowerCase()
    ) {
      throw new WorkspaceReviewError(
        'transitionToken is not valid for this scene, session, or candidate.',
        403,
        'review_transition_session_mismatch',
      );
    }
    return transition;
  }

  consume(transitionToken: `sha256:${string}`): void {
    this.transitions.delete(transitionToken);
  }
}

class WorkspaceReviewError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'invalid_review_request',
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function handleReviewCaptureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceRoot: string,
  issuedCaptures: IssuedReviewCaptureRegistry,
): Promise<void> {
  try {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('Allow', 'POST');
      response.end('Method not allowed');
      return;
    }
    const body = JSON.parse(
      (await readRequestBody(request, MAX_REVIEW_CAPTURE_BODY_BYTES)) || '{}',
    ) as Record<string, unknown>;
    const paths = resolveReviewWorkspacePaths(body.scene, workspaceRoot);
    const scene = toPosixPath(path.relative(workspaceRoot, paths.scenePath));
    const sessionId = requireReviewCaptureSessionId(body.sessionId);
    if (body.action === 'issue') {
      const parsed = parseIssuedReviewCapture(body.capture);
      const sceneDocument = readCurrentReviewScene(paths.scenePath);
      const currentDocumentHash = hashSceneDocument(sceneDocument);
      const currentRuntimeHash = hashRuntimeSceneDocument(sceneDocument);
      const documentHash = requireTrustedCaptureHash(
        parsed.facts,
        'documentHash',
      );
      const runtimeHash = requireTrustedCaptureHash(
        parsed.facts,
        'runtimeHash',
      );
      if (
        documentHash !== currentDocumentHash ||
        runtimeHash !== currentRuntimeHash
      ) {
        throw new WorkspaceReviewError(
          'Review capture is stale for the current scene document.',
          409,
          'stale_review_capture',
          {
            currentDocumentHash,
            currentRuntimeHash,
            documentHash,
            runtimeHash,
          },
        );
      }
      const captureToken = hashBytes(
        canonicalizeJson({
          nonce: randomUUID(),
          scene,
          sessionId,
          screenshotSha256: parsed.facts.screenshotSha256,
        }),
      ) as `sha256:${string}`;
      issuedCaptures.issue({
        bytes: parsed.bytes,
        captureToken,
        facts: parsed.facts,
        scene,
        sessionId,
      });
      response.statusCode = 201;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          captureToken,
          screenshotSha256: parsed.facts.screenshotSha256,
          status: 'issued',
        }),
      );
      return;
    }
    if (body.action !== 'persist') {
      throw new WorkspaceReviewError(
        'action must be either issue or persist.',
        400,
        'invalid_review_capture_action',
      );
    }
    const captureId = requireSafeReviewCaptureId(body.captureId);
    const captureToken = requireSha256(body.captureToken, 'captureToken');
    const issued = issuedCaptures.require(captureToken, sessionId, scene);
    if (
      issued.persistedCaptureId != null &&
      issued.persistedCaptureId !== captureId
    ) {
      throw new WorkspaceReviewError(
        `captureToken is already bound to captureId "${issued.persistedCaptureId}".`,
        409,
        'review_capture_id_mismatch',
      );
    }
    const capabilityHash = requireTrustedCaptureHash(
      issued.facts,
      'capabilityHash',
    );
    const documentHash = requireTrustedCaptureHash(
      issued.facts,
      'documentHash',
    );
    const runtimeHash = requireTrustedCaptureHash(issued.facts, 'runtimeHash');
    const screenshotSha256 = requireTrustedCaptureHash(
      issued.facts,
      'screenshotSha256',
    );
    const sceneDocument = readCurrentReviewScene(paths.scenePath);
    const currentDocumentHash = hashSceneDocument(sceneDocument);
    const currentRuntimeHash = hashRuntimeSceneDocument(sceneDocument);
    if (
      documentHash !== currentDocumentHash ||
      runtimeHash !== currentRuntimeHash
    ) {
      throw new WorkspaceReviewError(
        'Review capture is stale for the current scene document.',
        409,
        'stale_review_capture',
        {
          currentDocumentHash,
          currentRuntimeHash,
          documentHash,
          runtimeHash,
        },
      );
    }
    const filePath = path.join(
      paths.evidenceRoot,
      `${captureId}-${captureToken.slice('sha256:'.length)}.png`,
    );
    const created = writeImmutableWorkspaceFile(
      workspaceRoot,
      filePath,
      issued.bytes,
    );
    const relativePath = toPosixPath(path.relative(workspaceRoot, filePath));
    const width = requireTrustedCaptureDimension(issued.facts, 'width');
    const height = requireTrustedCaptureDimension(issued.facts, 'height');
    const metadata: PersistedReviewCapture = {
      byteLength: issued.bytes.length,
      capabilityHash,
      captureId,
      captureToken,
      documentHash,
      facts: issued.facts,
      height,
      path: relativePath,
      runtimeHash,
      sessionIdSha256: hashBytes(sessionId) as `sha256:${string}`,
      screenshotSha256,
      version: 'iwsdk.review-capture.v1',
      width,
    };
    const metadataPath = reviewCaptureMetadataPath(filePath);
    const metadataCreated = writeImmutableWorkspaceFile(
      workspaceRoot,
      metadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    const relativeMetadataPath = toPosixPath(
      path.relative(workspaceRoot, metadataPath),
    );
    issued.persistedCaptureId = captureId;
    response.statusCode = created || metadataCreated ? 201 : 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        bytes: issued.bytes.length,
        captureId,
        captureToken,
        capabilityHash,
        documentHash,
        height,
        metadataPath: relativeMetadataPath,
        path: relativePath,
        runtimeHash,
        screenshotSha256,
        status: created || metadataCreated ? 'created' : 'existing',
        width,
      }),
    );
  } catch (error) {
    sendReviewRequestError(response, error);
  }
}

async function handleReviewTransitionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceRoot: string,
  issuedTransitions: IssuedReviewTransitionRegistry,
): Promise<void> {
  try {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('Allow', 'POST');
      response.end('Method not allowed');
      return;
    }
    const body = JSON.parse(
      (await readRequestBody(request, MAX_REVIEW_RECORD_BODY_BYTES)) || '{}',
    ) as Record<string, unknown>;
    const paths = resolveReviewWorkspacePaths(body.scene, workspaceRoot);
    const scene = toPosixPath(path.relative(workspaceRoot, paths.scenePath));
    if (body.action === 'begin-review') {
      const current = readCurrentReviewScene(paths.scenePath);
      const entryEvidence = validateReviewEntryEvidence({
        document: current,
        paths,
        runtimePreflightReceipt: body.runtimePreflightReceipt,
        workspaceRoot,
      });
      const state = beginSceneReviewWorkflow({
        document: current,
        expectedDocumentHash: requireSha256(
          body.expectedDocumentHash,
          'expectedDocumentHash',
        ),
        reviewRoot: paths.reviewRoot,
      });
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          documentHash: state.documentHash,
          lockedMaxCorrectionRounds: state.lockedMaxCorrectionRounds,
          round: state.round,
          runtimeHash: state.runtimeHash,
          objectInspectionReceipts: entryEvidence.objectInspectionReceipts,
          runtimePreflightReceipt: entryEvidence.runtimePreflightReceipt,
          status: 'review-begun',
          workflowPhase: state.phase,
        }),
      );
      return;
    }
    const sessionId = requireReviewCaptureSessionId(body.sessionId);
    const current = readCurrentReviewScene(paths.scenePath);
    const candidate = parseSceneDocument(JSON.stringify(body.candidate));
    const expectedBaseDocumentHash = requireSha256(
      body.expectedBaseDocumentHash,
      'expectedBaseDocumentHash',
    );
    const plan = planSceneReviewTransition({
      candidate,
      correction: body.correction,
      current,
      expectedBaseDocumentHash,
      operation: body.operation,
      patch: body.patch,
      reviewRoot: paths.reviewRoot,
    });
    const candidateDocumentHash = hashSceneDocument(candidate);
    const transitionToken =
      plan == null
        ? null
        : issuedTransitions.issue({
            baseDocumentHash: hashSceneDocument(current),
            candidateDocumentHash,
            plan,
            reviewRoot: paths.reviewRoot,
            scene,
            sessionId,
          });
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        candidateDocumentHash,
        status: 'authorized',
        transitionToken,
      }),
    );
  } catch (error) {
    sendReviewRequestError(response, error);
  }
}

async function handleReviewsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceRoot: string,
): Promise<void> {
  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const parsed = new URL(request.url ?? '', 'http://iwsdk.local');
      const paths = resolveReviewWorkspacePaths(
        parsed.searchParams.get('scene'),
        workspaceRoot,
      );
      const requestedPath = parsed.searchParams.get('path');
      const capabilityHash = requireSha256(
        parsed.searchParams.get('capabilityHash'),
        'capabilityHash',
      );
      const sceneDocument = readCurrentReviewScene(paths.scenePath);
      const result = requestedPath
        ? getSceneReviewRecord(
            requestedPath,
            paths,
            workspaceRoot,
            sceneDocument,
            capabilityHash,
          )
        : {
            reviews: listSceneReviewRecords(
              paths,
              workspaceRoot,
              sceneDocument,
              capabilityHash,
            ),
          };
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        request.method === 'HEAD' ? undefined : JSON.stringify(result),
      );
      return;
    }

    if (request.method === 'POST') {
      const body = JSON.parse(
        (await readRequestBody(request, MAX_REVIEW_RECORD_BODY_BYTES)) || '{}',
      ) as Record<string, unknown>;
      const paths = resolveReviewWorkspacePaths(body.scene, workspaceRoot);
      const sceneDocument = readCurrentReviewScene(paths.scenePath);
      const capabilityHash = requireSha256(
        body.capabilityHash,
        'capabilityHash',
      );
      rejectUntrustedReviewWaivers(body.review, sceneDocument);
      const validation = validateSceneReviewAgainstDocument(
        body.review,
        sceneDocument,
        capabilityHash,
      );
      if (!validation.valid) {
        throw new WorkspaceReviewError(
          'Review record does not match the current scene document.',
          400,
          'invalid_scene_review',
          { issues: validation.issues },
        );
      }
      const review = body.review as SceneReview;
      validatePersistedReviewLineage(review, paths, workspaceRoot);
      validatePersistedReviewEvidence(review, paths, workspaceRoot);
      const serialized = serializeSceneReview(review);
      const filePath = path.join(
        paths.recordsRoot,
        reviewRecordFileName(review),
      );
      const created = writeImmutableWorkspaceFile(
        workspaceRoot,
        filePath,
        serialized,
      );
      const relativePath = toPosixPath(path.relative(workspaceRoot, filePath));
      const reviewSha256 = hashBytes(
        Buffer.from(serialized, 'utf8'),
      ) as `sha256:${string}`;
      recordSceneReviewWorkflowReview({
        document: sceneDocument,
        review,
        reviewLink: { path: relativePath, reviewSha256 },
        reviewRoot: paths.reviewRoot,
      });
      response.statusCode = created ? 201 : 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          path: relativePath,
          reviewSha256,
          status: created ? 'created' : 'existing',
          summary: summarizeReviewRecord(
            review,
            relativePath,
            serialized,
            sceneDocument,
            true,
          ),
        }),
      );
      return;
    }

    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD, POST');
    response.end('Method not allowed');
  } catch (error) {
    sendReviewRequestError(response, error);
  }
}

type RuntimeProofStatus = 'passed' | 'failed';

interface RuntimeProofCheck {
  details: Record<string, unknown>;
  id: string;
  status: RuntimeProofStatus;
}

interface RuntimeProofWarning {
  details?: Record<string, unknown>;
  id: string;
  message: string;
}

interface RuntimeProofReport {
  capabilityHash: string;
  capture: null | {
    height: number;
    nonblank: boolean;
    path: string;
    sha256: string;
    width: number;
  };
  checks: RuntimeProofCheck[];
  completedAt: string;
  documentHash: string;
  editorCapture: RuntimeProofReport['capture'];
  hostPerformance: ManagedRuntimePublishEvidence['performance'] | null;
  logsWindow: {
    entries: unknown[];
    since: string;
    until: string;
  };
  measurementEnvironment: Record<string, unknown>;
  rawRenderCost: {
    editor: Record<string, unknown> | null;
    runtime: Record<string, unknown> | null;
  };
  countExplanation: RuntimeCountExplanation | null;
  presentation: RuntimePresentationParityResult | null;
  representativeNodeIds: string[];
  reviewPath: string;
  reviewSha256: string;
  runtimeHash: string;
  runtimeProven: RuntimeProofStatus;
  scenePath: string;
  startedAt: string;
  version: 'iwsdk.runtime-proof.v1';
  warnings: RuntimeProofWarning[];
}

async function handleRuntimePreflightRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceRoot: string,
  managedBrowser: ManagedBrowser | null,
): Promise<void> {
  try {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('Allow', 'POST');
      response.end('Method not allowed');
      return;
    }
    const body = JSON.parse(
      (await readRequestBody(request, MAX_REVIEW_RECORD_BODY_BYTES)) || '{}',
    ) as Record<string, unknown>;
    const detail = body.detail ?? 'compact';
    if (detail !== 'compact' && detail !== 'full') {
      throw new WorkspaceReviewError(
        'detail must be "compact" or "full".',
        400,
        'invalid_runtime_preflight_detail',
      );
    }
    const paths = resolveReviewWorkspacePaths(body.scene, workspaceRoot);
    const document = readCurrentReviewScene(paths.scenePath);
    const warmupFrames = requireFrameCount(
      body.warmupFrames,
      'warmupFrames',
      10,
      true,
    );
    const sampleFrames = requireFrameCount(
      body.sampleFrames,
      'sampleFrames',
      60,
      false,
    );
    if (managedBrowser == null || managedBrowser.isClosed()) {
      throw new WorkspaceReviewError(
        'Managed Playwright browser is unavailable.',
        503,
        'managed_browser_unavailable',
      );
    }
    const expectedDocumentHash = hashSceneDocument(document);
    const expectedRuntimeHash = hashRuntimeSceneDocument(document);
    const evidence = await managedBrowser.collectRuntimePreflightEvidence({
      sampleFrames,
      warmupFrames,
    });
    const heroView = resolveRuntimeHeroView(document);
    const presentation = evaluateRuntimePresentationParity(heroView, {
      camera: evidence.camera,
      framing: evidence.framing,
    });
    const renderState = evaluateRuntimeSceneParity(
      document,
      evidence.renderStats,
    );
    const checks: RuntimeProofCheck[] = [
      {
        details: {
          actualDocumentHash: evidence.editor.documentHash,
          actualRuntimeHash: evidence.editor.runtimeHash,
          dirty: evidence.editor.dirty,
          expectedDocumentHash,
          expectedRuntimeHash,
        },
        id: 'editor-binding',
        status:
          evidence.editor.documentHash === expectedDocumentHash &&
          evidence.editor.runtimeHash === expectedRuntimeHash
            ? 'passed'
            : 'failed',
      },
      {
        details: {
          expectedRuntimeHash,
          liveRuntimeHashes: evidence.runtimeHashes,
        },
        id: 'runtime-binding',
        status:
          evidence.runtimeHashes.length === 1 &&
          evidence.runtimeHashes[0] === expectedRuntimeHash
            ? 'passed'
            : 'failed',
      },
      {
        details: presentation.camera,
        id: 'runtime-camera',
        status: presentation.camera.passed ? 'passed' : 'failed',
      },
      {
        details: presentation.framing,
        id: 'runtime-framing',
        status: presentation.framing.passed ? 'passed' : 'failed',
      },
      {
        details: renderState,
        id: 'render-state',
        status: renderState.passed ? 'passed' : 'failed',
      },
    ];
    const warnings: RuntimeProofWarning[] = presentation.warnings.map(
      (message, index) => ({
        id: `presentation-${index + 1}`,
        message,
      }),
    );
    if (evidence.editor.dirty) {
      warnings.push({
        id: 'editor-dirty',
        message:
          'The editor has unsaved changes; preflight measured the saved runtime binding, not the dirty draft.',
      });
    }
    warnings.push({
      details: {
        sampleFrames: evidence.performance.sampleFrames,
        warmupFrames: evidence.performance.warmupFrames,
      },
      id: 'host-performance-classification',
      message:
        'Performance measurements are host-browser diagnostics only; they are not calibrated Quest or IWER device-performance claims.',
    });
    const failedChecks = checks
      .filter((check) => check.status === 'failed')
      .map(compactRuntimeProofCheck);
    const report = {
      checkedAt: new Date(evidence.collectedAt).toISOString(),
      countExplanation: explainRuntimeCountDifferences(
        document,
        evidence.editor.renderStats,
        evidence.renderStats,
        evidence.hierarchyObjectCount,
      ),
      documentHash: expectedDocumentHash,
      editor: evidence.editor,
      environment: evidence.environment,
      failedChecks,
      issuedBy: 'iwsdk-managed-workspace',
      passed: failedChecks.length === 0,
      performance: evidence.performance,
      presentation,
      renderStats: evidence.renderStats,
      runtimeHash: expectedRuntimeHash,
      scenePath: toPosixPath(path.relative(workspaceRoot, paths.scenePath)),
      version: 'iwsdk.runtime-preflight.v1' as const,
      warnings,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    const receiptSha256 = hashBytes(serialized) as `sha256:${string}`;
    const receiptFile = path.join(
      paths.runtimeRoot,
      `preflight-${receiptSha256.slice('sha256:'.length)}${RUNTIME_PREFLIGHT_FILE_SUFFIX}`,
    );
    const created = writeImmutableWorkspaceFile(
      workspaceRoot,
      receiptFile,
      serialized,
    );
    const receiptPath = toPosixPath(path.relative(workspaceRoot, receiptFile));
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        ...(detail === 'full'
          ? report
          : {
              checkedAt: report.checkedAt,
              countExplanation: report.countExplanation,
              documentHash: report.documentHash,
              failedChecks: report.failedChecks,
              passed: report.passed,
              performance: report.performance,
              presentation: report.presentation,
              runtimeHash: report.runtimeHash,
              scenePath: report.scenePath,
              version: report.version,
              warnings: report.warnings,
            }),
        receipt: { path: receiptPath, sha256: receiptSha256 },
        receiptPath,
        receiptSha256,
        receiptStatus: created ? 'created' : 'existing',
      }),
    );
  } catch (error) {
    sendReviewRequestError(response, error);
  }
}

type ObjectInspectionCategory =
  | 'silhouette'
  | 'proportions'
  | 'parts'
  | 'negativeSpace'
  | 'contacts'
  | 'materialResponse';

type ObjectInspectionCapture =
  SceneReview['lenses'][number]['captures'][number] & {
    lens: SceneReview['lenses'][number]['id'];
  };

interface ObjectInspectionAssessment {
  evidenceRefs: string[];
  id: string;
  observation: string;
  status: 'pass' | 'fail';
}

interface ObjectInspectionArtifact {
  capabilityHash: `sha256:${string}`;
  captures: ObjectInspectionCapture[];
  criteria: Record<ObjectInspectionCategory, ObjectInspectionAssessment[]>;
  documentHash: `sha256:${string}`;
  featureId: string;
  issuedAt: string;
  issuedBy: 'iwsdk-managed-workspace';
  requiredViews: Array<{ captureIds: string[]; view: string }>;
  result: 'pass' | 'fail';
  runtimeHash: `sha256:${string}`;
  sequence: number;
  version: 'iwsdk.object-inspection.v1';
}

interface ReviewEvidenceLink {
  path: string;
  sha256: `sha256:${string}`;
}

const OBJECT_INSPECTION_CATEGORIES: ObjectInspectionCategory[] = [
  'silhouette',
  'proportions',
  'parts',
  'negativeSpace',
  'contacts',
  'materialResponse',
];

function recordObjectInspectionEvidence(input: {
  capabilityHash: `sha256:${string}`;
  captures: unknown;
  document: SceneDocument;
  expectedDocumentHash: `sha256:${string}`;
  featureId: unknown;
  paths: ReviewWorkspacePaths;
  results: unknown;
  workspaceRoot: string;
}): {
  documentHash: `sha256:${string}`;
  featureId: string;
  path: string;
  result: 'pass' | 'fail';
  runtimeHash: `sha256:${string}`;
  sequence: number;
  sha256: `sha256:${string}`;
  status: 'created';
} {
  const documentHash = hashSceneDocument(input.document);
  const runtimeHash = hashRuntimeSceneDocument(input.document);
  if (!sameSha256(documentHash, input.expectedDocumentHash)) {
    throw new WorkspaceReviewError(
      'Object inspection hash does not match the current saved scene.',
      409,
      'object_inspection_document_mismatch',
      {
        currentDocumentHash: documentHash,
        retryAction:
          'Reload the saved document, recapture the object views, and call scene_record_object_inspection again.',
      },
    );
  }
  if (typeof input.featureId !== 'string' || input.featureId.length === 0) {
    throw new WorkspaceReviewError(
      'featureId must name one identity-critical composition feature.',
      400,
      'invalid_object_inspection',
    );
  }
  const composition = input.document.authoring?.composition;
  const feature = composition?.features.find(
    (candidate) => candidate.id === input.featureId,
  );
  if (
    feature == null ||
    feature.identityCritical !== true ||
    feature.objectInspection == null
  ) {
    throw new WorkspaceReviewError(
      `Feature "${input.featureId}" is not an identity-critical feature with an objectInspection spec.`,
      400,
      'invalid_object_inspection_feature',
    );
  }
  if (
    composition?.provenance.capabilityHash == null ||
    !sameSha256(input.capabilityHash, composition.provenance.capabilityHash)
  ) {
    throw new WorkspaceReviewError(
      'Object inspection capability hash does not match the composition provenance.',
      409,
      'object_inspection_capability_mismatch',
      { expectedCapabilityHash: composition?.provenance.capabilityHash },
    );
  }

  const captures = parseObjectInspectionCaptures(input.captures);
  validateObjectInspectionCaptureEvidence({
    capabilityHash: input.capabilityHash,
    captures,
    documentHash,
    paths: input.paths,
    runtimeHash,
    workspaceRoot: input.workspaceRoot,
  });
  const criteria = parseObjectInspectionAssessments(
    input.results,
    feature.objectInspection,
    new Set(captures.map((capture) => capture.id)),
  );
  const requiredViews = feature.objectInspection.requiredViews.map((view) => ({
    captureIds: captures
      .filter((capture) => capture.view === view)
      .map((capture) => capture.id),
    view,
  }));
  const evidenceIssues = collectObjectInspectionEvidenceIssues(
    feature,
    feature.objectInspection,
    captures,
    criteria,
  );
  if (evidenceIssues.length > 0) {
    throw new WorkspaceReviewError(
      `Object inspection evidence is incomplete for feature "${feature.id}".`,
      400,
      'invalid_object_inspection_evidence',
      { issues: evidenceIssues, retryAction: 'scene_capture_review_set' },
    );
  }

  const existing = readObjectInspectionArtifacts(
    input.paths,
    input.workspaceRoot,
  ).filter(({ artifact }) => artifact.featureId === feature.id);
  const sequence =
    existing.reduce(
      (maximum, entry) => Math.max(maximum, entry.artifact.sequence),
      0,
    ) + 1;
  const result = OBJECT_INSPECTION_CATEGORIES.every((category) =>
    criteria[category].every((assessment) => assessment.status === 'pass'),
  )
    ? 'pass'
    : 'fail';
  const artifact: ObjectInspectionArtifact = {
    capabilityHash: input.capabilityHash,
    captures,
    criteria,
    documentHash,
    featureId: feature.id,
    issuedAt: new Date().toISOString(),
    issuedBy: 'iwsdk-managed-workspace',
    requiredViews,
    result,
    runtimeHash,
    sequence,
    version: 'iwsdk.object-inspection.v1',
  };
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  const sha256 = hashBytes(serialized) as `sha256:${string}`;
  const featureKey = createHash('sha256')
    .update(feature.id)
    .digest('hex')
    .slice(0, 16);
  const filePath = path.join(
    input.paths.inspectionsRoot,
    `${featureKey}-${String(sequence).padStart(6, '0')}-${sha256.slice('sha256:'.length)}${OBJECT_INSPECTION_FILE_SUFFIX}`,
  );
  writeImmutableWorkspaceFile(input.workspaceRoot, filePath, serialized);
  return {
    documentHash,
    featureId: feature.id,
    path: toPosixPath(path.relative(input.workspaceRoot, filePath)),
    result,
    runtimeHash,
    sequence,
    sha256,
    status: 'created',
  };
}

function parseObjectInspectionCaptures(
  value: unknown,
): ObjectInspectionCapture[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new WorkspaceReviewError(
      'captures must contain 1 to 32 entries returned by scene_capture_review_set.',
      400,
      'invalid_object_inspection_evidence',
    );
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (
      !isPlainRecord(entry) ||
      typeof entry.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.id) ||
      (entry.lens !== 'layout' &&
        entry.lens !== 'geometry' &&
        entry.lens !== 'final') ||
      typeof entry.view !== 'string' ||
      entry.view.length === 0 ||
      typeof entry.path !== 'string' ||
      !Array.isArray(entry.visibleNodeIds) ||
      entry.visibleNodeIds.some((nodeId) => typeof nodeId !== 'string') ||
      !isPlainRecord(entry.camera) ||
      !isPlainRecord(entry.rendererEnvironment) ||
      !Number.isInteger(entry.width) ||
      !Number.isInteger(entry.height)
    ) {
      throw new WorkspaceReviewError(
        `captures[${index}] is not a compact persisted capture returned by scene_capture_review_set.`,
        400,
        'invalid_object_inspection_evidence',
      );
    }
    requireSha256(
      entry.screenshotSha256,
      `captures[${index}].screenshotSha256`,
    );
    if (ids.has(entry.id)) {
      throw new WorkspaceReviewError(
        `captures contains duplicate id "${entry.id}".`,
        400,
        'invalid_object_inspection_evidence',
      );
    }
    ids.add(entry.id);
    return entry as unknown as ObjectInspectionCapture;
  });
}

function parseObjectInspectionAssessments(
  value: unknown,
  spec: SceneObjectInspectionSpec,
  captureIds: Set<string>,
): Record<ObjectInspectionCategory, ObjectInspectionAssessment[]> {
  if (!isPlainRecord(value)) {
    throw invalidObjectInspectionResults([
      {
        code: 'results-required',
        message: 'results must contain every object-inspection category',
        path: '$.results',
      },
    ]);
  }
  const expected: Record<ObjectInspectionCategory, string[]> = {
    silhouette: spec.silhouette,
    proportions: spec.proportions,
    parts: spec.parts.map((entry) => entry.id),
    negativeSpace: spec.negativeSpace,
    contacts: spec.contacts.map((entry) => entry.id),
    materialResponse: spec.materialResponse,
  };
  const issues: Array<{ code: string; message: string; path: string }> = [];
  const parsed = {} as Record<
    ObjectInspectionCategory,
    ObjectInspectionAssessment[]
  >;
  for (const category of OBJECT_INSPECTION_CATEGORIES) {
    const entries = value[category];
    if (!Array.isArray(entries)) {
      issues.push({
        code: 'category-required',
        message: `${category} must be an array covering every declared criterion`,
        path: `$.results.${category}`,
      });
      parsed[category] = [];
      continue;
    }
    const seen = new Set<string>();
    parsed[category] = entries.flatMap((entry, index) => {
      const entryPath = `$.results.${category}[${index}]`;
      if (
        !isPlainRecord(entry) ||
        typeof entry.id !== 'string' ||
        (entry.status !== 'pass' && entry.status !== 'fail') ||
        !Array.isArray(entry.evidenceRefs) ||
        entry.evidenceRefs.length === 0 ||
        entry.evidenceRefs.some((id) => typeof id !== 'string') ||
        typeof entry.observation !== 'string' ||
        entry.observation.trim().length === 0
      ) {
        issues.push({
          code: 'criterion-result-invalid',
          message:
            'criterion results require id, pass/fail status, at least one evidenceRef, and a nonempty visual observation',
          path: entryPath,
        });
        return [];
      }
      if (seen.has(entry.id)) {
        issues.push({
          code: 'criterion-result-duplicate',
          message: `criterion "${entry.id}" appears more than once`,
          path: `${entryPath}.id`,
        });
      }
      seen.add(entry.id);
      for (const evidenceRef of entry.evidenceRefs as string[]) {
        if (!captureIds.has(evidenceRef)) {
          issues.push({
            code: 'evidence-ref-unknown',
            message: `evidenceRef "${evidenceRef}" is not one of the persisted captures`,
            path: `${entryPath}.evidenceRefs`,
          });
        }
      }
      return [
        {
          evidenceRefs: [...(entry.evidenceRefs as string[])],
          id: entry.id,
          observation: entry.observation,
          status: entry.status,
        },
      ];
    });
    const missing = expected[category].filter((id) => !seen.has(id));
    const unexpected = [...seen].filter(
      (id) => !expected[category].includes(id),
    );
    if (missing.length > 0 || unexpected.length > 0) {
      issues.push({
        code: 'criterion-coverage-mismatch',
        message: `criterion coverage mismatch; missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`,
        path: `$.results.${category}`,
      });
    }
  }
  const unexpectedCategories = Object.keys(value).filter(
    (key) =>
      !OBJECT_INSPECTION_CATEGORIES.includes(key as ObjectInspectionCategory),
  );
  if (unexpectedCategories.length > 0) {
    issues.push({
      code: 'category-unknown',
      message: `unknown result categories: ${unexpectedCategories.join(', ')}`,
      path: '$.results',
    });
  }
  if (issues.length > 0) {
    throw invalidObjectInspectionResults(issues);
  }
  return parsed;
}

function invalidObjectInspectionResults(
  issues: Array<{ code: string; message: string; path: string }>,
): WorkspaceReviewError {
  return new WorkspaceReviewError(
    'Object inspection results do not exactly cover the declared spec.',
    400,
    'invalid_object_inspection_results',
    {
      issues,
      retryAction:
        'Submit one pass/fail result per declared criterion through scene_record_object_inspection.',
    },
  );
}

function validateObjectInspectionCaptureEvidence(input: {
  capabilityHash: `sha256:${string}`;
  captures: ObjectInspectionCapture[];
  documentHash: `sha256:${string}`;
  paths: ReviewWorkspacePaths;
  runtimeHash: `sha256:${string}`;
  workspaceRoot: string;
}): void {
  const byLens = new Map<
    SceneReview['lenses'][number]['id'],
    SceneReview['lenses'][number]['captures']
  >();
  for (const { lens, ...capture } of input.captures) {
    const entries = byLens.get(lens) ?? [];
    entries.push(capture);
    byLens.set(lens, entries);
  }
  const evidenceReview: SceneReview = {
    capabilityHash: input.capabilityHash,
    documentHash: input.documentHash,
    featureResults: [],
    lenses: [...byLens].map(([id, captures]) => ({
      captures,
      id,
      status: 'not-applicable',
    })),
    result: 'fail',
    round: 0,
    runtimeHash: input.runtimeHash,
    sourceHashes: [],
    stop: { openDefectTags: ['object-inspection'], reason: 'plateau' },
    version: 'iwsdk.scene-review.v1',
    waivers: [],
  };
  validatePersistedReviewEvidence(
    evidenceReview,
    input.paths,
    input.workspaceRoot,
  );
}

function collectObjectInspectionEvidenceIssues(
  feature: SceneFeature,
  spec: SceneObjectInspectionSpec,
  captures: ObjectInspectionCapture[],
  criteria: Record<ObjectInspectionCategory, ObjectInspectionAssessment[]>,
): Array<Record<string, unknown>> {
  const issues: Array<Record<string, unknown>> = [];
  const contextNodeIds = spec.context.includeNodeRefs ?? [];
  for (const view of spec.requiredViews) {
    for (const lens of ['geometry', 'final'] as const) {
      const matching = captures.filter(
        (capture) => capture.view === view && capture.lens === lens,
      );
      if (matching.length === 0) {
        issues.push({
          code: 'inspection-lens-missing',
          featureId: feature.id,
          lens,
          message: `required object-inspection view "${view}" needs a ${lens} capture`,
          path: '$.captures',
          retryAction: 'scene_capture_review_set',
          view,
        });
        continue;
      }
      const completeCapture = matching.find(
        (capture) =>
          feature.nodeRefs.every((nodeId) =>
            capture.visibleNodeIds.includes(nodeId),
          ) &&
          contextNodeIds.every((nodeId) =>
            capture.visibleNodeIds.includes(nodeId),
          ),
      );
      if (completeCapture != null) {
        continue;
      }
      const missingSubjectNodeIds = feature.nodeRefs.filter(
        (nodeId) =>
          !matching.some((capture) => capture.visibleNodeIds.includes(nodeId)),
      );
      const missingContextNodeIds = contextNodeIds.filter(
        (nodeId) =>
          !matching.some((capture) => capture.visibleNodeIds.includes(nodeId)),
      );
      if (missingSubjectNodeIds.length > 0) {
        issues.push({
          code: 'subject-not-visible',
          featureId: feature.id,
          lens,
          message: `${lens} capture for view "${view}" is missing subject nodes: ${missingSubjectNodeIds.join(', ')}`,
          missingSubjectNodeIds,
          path: '$.captures',
          retryAction: 'scene_set_preview_visibility',
          view,
        });
      }
      if (missingContextNodeIds.length > 0) {
        issues.push({
          code: 'inspection-context-not-visible',
          featureId: feature.id,
          lens,
          message: `${lens} capture for view "${view}" is missing declared context nodes: ${missingContextNodeIds.join(', ')}`,
          missingContextNodeIds,
          path: '$.captures',
          retryAction: 'scene_set_preview_visibility',
          view,
        });
      }
      if (
        missingSubjectNodeIds.length === 0 &&
        missingContextNodeIds.length === 0
      ) {
        issues.push({
          code: 'inspection-subject-context-split',
          featureId: feature.id,
          lens,
          message: `${lens} evidence for view "${view}" does not show the complete subject and declared context in one capture`,
          path: '$.captures',
          retryAction: 'scene_capture_review_set',
          view,
        });
      }
    }
  }
  const captureById = new Map(captures.map((capture) => [capture.id, capture]));
  for (const category of OBJECT_INSPECTION_CATEGORIES) {
    const requiredLens = category === 'materialResponse' ? 'final' : 'geometry';
    criteria[category].forEach((assessment, index) => {
      if (
        !assessment.evidenceRefs.some(
          (captureId) => captureById.get(captureId)?.lens === requiredLens,
        )
      ) {
        issues.push({
          category,
          code: 'criterion-lens-evidence-missing',
          criterionId: assessment.id,
          featureId: feature.id,
          message: `${category} criterion "${assessment.id}" must reference a ${requiredLens} capture`,
          path: `$.results.${category}[${index}].evidenceRefs`,
          requiredLens,
          retryAction: 'scene_record_object_inspection',
        });
      }
    });
  }
  return issues;
}

function assertObjectInspectionArtifactIntegrity(input: {
  artifact: ObjectInspectionArtifact;
  feature: SceneFeature;
  paths: ReviewWorkspacePaths;
  workspaceRoot: string;
}): void {
  const spec = input.feature.objectInspection;
  if (spec == null) {
    throw new Error('identity-critical feature has no inspection spec');
  }
  const captures = parseObjectInspectionCaptures(input.artifact.captures);
  validateObjectInspectionCaptureEvidence({
    capabilityHash: input.artifact.capabilityHash,
    captures,
    documentHash: input.artifact.documentHash,
    paths: input.paths,
    runtimeHash: input.artifact.runtimeHash,
    workspaceRoot: input.workspaceRoot,
  });
  const criteria = parseObjectInspectionAssessments(
    input.artifact.criteria,
    spec,
    new Set(captures.map((capture) => capture.id)),
  );
  const expectedRequiredViews = spec.requiredViews.map((view) => ({
    captureIds: captures
      .filter((capture) => capture.view === view)
      .map((capture) => capture.id),
    view,
  }));
  if (!sameCanonicalJson(input.artifact.requiredViews, expectedRequiredViews)) {
    throw new Error(
      'object inspection required-view summary does not match its captures',
    );
  }
  const evidenceIssues = collectObjectInspectionEvidenceIssues(
    input.feature,
    spec,
    captures,
    criteria,
  );
  if (evidenceIssues.length > 0) {
    throw new Error(
      `object inspection evidence is incomplete: ${evidenceIssues
        .map((issue) => String(issue.message))
        .join('; ')}`,
    );
  }
  const derivedResult = OBJECT_INSPECTION_CATEGORIES.every((category) =>
    criteria[category].every((assessment) => assessment.status === 'pass'),
  )
    ? 'pass'
    : 'fail';
  if (input.artifact.result !== derivedResult) {
    throw new Error(
      `object inspection result must be derived as "${derivedResult}"`,
    );
  }
}

function validateReviewEntryEvidence(input: {
  document: SceneDocument;
  paths: ReviewWorkspacePaths;
  runtimePreflightReceipt: unknown;
  workspaceRoot: string;
}): {
  objectInspectionReceipts: Array<ReviewEvidenceLink & { featureId: string }>;
  runtimePreflightReceipt: ReviewEvidenceLink;
} {
  const issues: Array<Record<string, unknown>> = [];
  let runtimePreflightReceipt: ReviewEvidenceLink | null = null;
  try {
    runtimePreflightReceipt = validateRuntimePreflightReceipt(input);
  } catch (error) {
    if (error instanceof WorkspaceReviewError) {
      const nested = Array.isArray(error.extra.issues)
        ? (error.extra.issues as Array<Record<string, unknown>>)
        : [];
      issues.push(
        ...(nested.length > 0
          ? nested
          : [
              {
                code: error.code,
                message: error.message,
                path: '$.runtimePreflightReceipt',
                retryAction: 'scene_runtime_preflight',
              },
            ]),
      );
    } else {
      throw error;
    }
  }

  const documentHash = hashSceneDocument(input.document);
  const runtimeHash = hashRuntimeSceneDocument(input.document);
  const capabilityHash =
    input.document.authoring?.composition?.provenance.capabilityHash;
  const artifacts = readObjectInspectionArtifacts(
    input.paths,
    input.workspaceRoot,
  );
  const objectInspectionReceipts: Array<
    ReviewEvidenceLink & { featureId: string }
  > = [];
  for (const feature of (
    input.document.authoring?.composition?.features ?? []
  ).filter((candidate) => candidate.identityCritical === true)) {
    const forFeature = artifacts.filter(
      (entry) => entry.artifact.featureId === feature.id,
    );
    const current = forFeature
      .filter(
        (entry) =>
          sameSha256(entry.artifact.documentHash, documentHash) &&
          sameSha256(entry.artifact.runtimeHash, runtimeHash) &&
          capabilityHash != null &&
          sameSha256(entry.artifact.capabilityHash, capabilityHash),
      )
      .sort((left, right) => right.artifact.sequence - left.artifact.sequence);
    const latest = current[0];
    if (latest == null) {
      issues.push({
        code:
          forFeature.length === 0
            ? 'object-inspection-missing'
            : 'object-inspection-stale',
        currentDocumentHash: documentHash,
        currentRuntimeHash: runtimeHash,
        featureId: feature.id,
        message:
          forFeature.length === 0
            ? `identity-critical feature "${feature.id}" has no object-inspection evidence`
            : `identity-critical feature "${feature.id}" has only stale object-inspection evidence`,
        path: `$.authoring.composition.features.${feature.id}.objectInspection`,
        retryAction: 'scene_record_object_inspection',
      });
      continue;
    }
    try {
      assertObjectInspectionArtifactIntegrity({
        artifact: latest.artifact,
        feature,
        paths: input.paths,
        workspaceRoot: input.workspaceRoot,
      });
    } catch (error) {
      issues.push({
        code: 'object-inspection-invalid',
        featureId: feature.id,
        message:
          error instanceof Error
            ? error.message
            : 'object inspection artifact is invalid',
        path: latest.path,
        retryAction: 'scene_record_object_inspection',
      });
      continue;
    }
    if (latest.artifact.result !== 'pass') {
      issues.push({
        code: 'object-inspection-failed',
        featureId: feature.id,
        message: `latest current object inspection for feature "${feature.id}" failed`,
        path: latest.path,
        retryAction:
          'Refine the scene, recapture the required views, and run scene_record_object_inspection on the new saved document.',
      });
      continue;
    }
    objectInspectionReceipts.push({
      featureId: feature.id,
      path: latest.path,
      sha256: latest.sha256,
    });
  }
  if (issues.length > 0 || runtimePreflightReceipt == null) {
    throw new WorkspaceReviewError(
      'Formal review requires current passing runtime and identity-critical inspection evidence.',
      409,
      'review_entry_evidence_incomplete',
      {
        issues,
        recoverable: true,
        retryAction:
          'Run scene_runtime_preflight and scene_record_object_inspection for every listed feature, then retry scene_begin_review.',
      },
    );
  }
  return { objectInspectionReceipts, runtimePreflightReceipt };
}

function validateRuntimePreflightReceipt(input: {
  document: SceneDocument;
  paths: ReviewWorkspacePaths;
  runtimePreflightReceipt: unknown;
  workspaceRoot: string;
}): ReviewEvidenceLink {
  const value = input.runtimePreflightReceipt;
  if (
    !isPlainRecord(value) ||
    typeof value.path !== 'string' ||
    typeof value.sha256 !== 'string'
  ) {
    throw new WorkspaceReviewError(
      'scene_begin_review requires the exact receiptPath and receiptSha256 returned by scene_runtime_preflight.',
      409,
      'runtime_preflight_receipt_required',
    );
  }
  const sha256 = requireSha256(value.sha256, 'runtimePreflightReceipt.sha256');
  const filePath = path.resolve(input.workspaceRoot, value.path);
  const canonicalPath = toPosixPath(
    path.relative(input.workspaceRoot, filePath),
  );
  if (
    canonicalPath !== value.path ||
    !isPathInside(input.paths.runtimeRoot, filePath) ||
    !filePath.endsWith(RUNTIME_PREFLIGHT_FILE_SUFFIX)
  ) {
    throw new WorkspaceReviewError(
      'Runtime preflight receipt must be the exact workspace-relative artifact returned for this scene.',
      400,
      'invalid_runtime_preflight_receipt',
    );
  }
  assertNoSymlinkTraversal(input.workspaceRoot, filePath);
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    throw new WorkspaceReviewError(
      'Runtime preflight receipt does not exist.',
      409,
      'runtime_preflight_receipt_missing',
    );
  }
  const bytes = readFileSync(filePath);
  const actualSha256 = hashBytes(bytes) as `sha256:${string}`;
  if (!sameSha256(actualSha256, sha256)) {
    throw new WorkspaceReviewError(
      'Runtime preflight receipt hash does not match the persisted artifact.',
      409,
      'runtime_preflight_receipt_hash_mismatch',
      { actualSha256 },
    );
  }
  let receipt: Record<string, unknown>;
  try {
    receipt = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new WorkspaceReviewError(
      'Runtime preflight receipt is not valid JSON.',
      400,
      'invalid_runtime_preflight_receipt',
    );
  }
  const documentHash = hashSceneDocument(input.document);
  const runtimeHash = hashRuntimeSceneDocument(input.document);
  const expectedScenePath = toPosixPath(
    path.relative(input.workspaceRoot, input.paths.scenePath),
  );
  if (
    receipt.version !== 'iwsdk.runtime-preflight.v1' ||
    receipt.issuedBy !== 'iwsdk-managed-workspace' ||
    receipt.passed !== true ||
    !sameSha256(receipt.documentHash, documentHash) ||
    !sameSha256(receipt.runtimeHash, runtimeHash) ||
    receipt.scenePath !== expectedScenePath ||
    !Array.isArray(receipt.failedChecks) ||
    receipt.failedChecks.length !== 0
  ) {
    throw new WorkspaceReviewError(
      'Runtime preflight receipt is stale, failed, or belongs to another scene.',
      409,
      'runtime_preflight_receipt_not_current',
      {
        currentDocumentHash: documentHash,
        currentRuntimeHash: runtimeHash,
        issues: [
          {
            code: 'runtime-preflight-stale-or-failed',
            message:
              'Run scene_runtime_preflight against the current saved scene and use its returned receipt.',
            path: '$.runtimePreflightReceipt',
            retryAction: 'scene_runtime_preflight',
          },
        ],
      },
    );
  }
  return { path: canonicalPath, sha256 };
}

function readObjectInspectionArtifacts(
  paths: ReviewWorkspacePaths,
  workspaceRoot: string,
): Array<{
  artifact: ObjectInspectionArtifact;
  path: string;
  sha256: `sha256:${string}`;
}> {
  if (!existsSync(paths.inspectionsRoot)) {
    return [];
  }
  assertNoSymlinkTraversal(workspaceRoot, paths.inspectionsRoot);
  const artifacts: Array<{
    artifact: ObjectInspectionArtifact;
    path: string;
    sha256: `sha256:${string}`;
  }> = [];
  for (const entry of readdirSync(paths.inspectionsRoot, {
    withFileTypes: true,
  })) {
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      !entry.name.endsWith(OBJECT_INSPECTION_FILE_SUFFIX)
    ) {
      continue;
    }
    const filePath = path.join(paths.inspectionsRoot, entry.name);
    try {
      assertNoSymlinkTraversal(workspaceRoot, filePath);
      const bytes = readFileSync(filePath);
      const sha256 = hashBytes(bytes) as `sha256:${string}`;
      if (!entry.name.includes(sha256.slice('sha256:'.length))) {
        continue;
      }
      const artifact = JSON.parse(
        bytes.toString('utf8'),
      ) as ObjectInspectionArtifact;
      if (
        artifact.version !== 'iwsdk.object-inspection.v1' ||
        artifact.issuedBy !== 'iwsdk-managed-workspace' ||
        typeof artifact.featureId !== 'string' ||
        !Number.isInteger(artifact.sequence) ||
        artifact.sequence < 1 ||
        (artifact.result !== 'pass' && artifact.result !== 'fail')
      ) {
        continue;
      }
      artifacts.push({
        artifact,
        path: toPosixPath(path.relative(workspaceRoot, filePath)),
        sha256,
      });
    } catch {
      continue;
    }
  }
  return artifacts;
}

function requireFrameCount(
  value: unknown,
  name: string,
  fallback: number,
  allowZero: boolean,
): number {
  if (value == null) {
    return fallback;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 600
  ) {
    throw new WorkspaceReviewError(
      `${name} must be an integer from ${allowZero ? 0 : 1} through 600.`,
      400,
      'invalid_performance_frame_count',
    );
  }
  return value;
}

async function handleScenePublishRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaceRoot: string,
  managedBrowser: ManagedBrowser | null,
): Promise<void> {
  try {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('Allow', 'POST');
      response.end('Method not allowed');
      return;
    }
    const body = JSON.parse(
      (await readRequestBody(request, MAX_REVIEW_RECORD_BODY_BYTES)) || '{}',
    ) as Record<string, unknown>;
    const detail = body.detail ?? 'compact';
    if (detail !== 'compact' && detail !== 'full') {
      throw new WorkspaceReviewError(
        'detail must be "compact" or "full".',
        400,
        'invalid_publish_detail',
      );
    }
    const paths = resolveReviewWorkspacePaths(body.scene, workspaceRoot);
    const sceneDocument = readCurrentReviewScene(paths.scenePath);
    const capabilityHash = requireSha256(body.capabilityHash, 'capabilityHash');
    if (typeof body.reviewPath !== 'string' || body.reviewPath.length === 0) {
      throw new WorkspaceReviewError(
        'reviewPath must be an exact path returned by scene_list_reviews.',
        400,
        'invalid_review_path',
      );
    }
    const storedReview = getSceneReviewRecord(
      body.reviewPath,
      paths,
      workspaceRoot,
      sceneDocument,
      capabilityHash,
    );
    if (!storedReview.current) {
      throw new WorkspaceReviewError(
        'The selected review is not current for this scene and capability snapshot.',
        409,
        'stale_scene_review',
        { issues: storedReview.issues },
      );
    }
    assertSceneReviewWorkflowPublishable({
      document: sceneDocument,
      reviewLink: {
        path: storedReview.path,
        reviewSha256: storedReview.reviewSha256 as `sha256:${string}`,
      },
      reviewRoot: paths.reviewRoot,
    });
    if (storedReview.review.result === 'accepted-with-gaps') {
      throw new WorkspaceReviewError(
        'Publishing accepted gaps requires a trusted user-approval artifact, which this server does not issue yet.',
        409,
        'trusted_review_waiver_unavailable',
      );
    }
    if (storedReview.review.result !== 'pass') {
      throw new WorkspaceReviewError(
        'Publishing requires a passing review.',
        409,
        'review_not_publishable',
      );
    }

    const expectedDocumentHash = hashSceneDocument(sceneDocument);
    const expectedRuntimeHash = hashRuntimeSceneDocument(sceneDocument);
    const representativeNodeIds = collectPublishNodeIds(
      sceneDocument,
      body.representativeNodeIds,
    );
    const resolvedDocument = resolveSceneAuthoringTransforms(sceneDocument);
    const expectedNodes = new Map(
      flattenSceneDocumentNodes(resolvedDocument.nodes).map((node) => [
        node.id,
        node,
      ]),
    );
    const startedAtMs = Date.now();
    const checks: RuntimeProofCheck[] = [
      {
        details: {
          documentHash: expectedDocumentHash,
          runtimeHash: expectedRuntimeHash,
        },
        id: 'saved-scene',
        status: 'passed',
      },
      {
        details: {
          result: storedReview.review.result,
          reviewPath: storedReview.path,
          reviewSha256: storedReview.reviewSha256,
        },
        id: 'immutable-review',
        status: 'passed',
      },
    ];
    const warnings: RuntimeProofWarning[] = [];
    let presentation: RuntimePresentationParityResult | null = null;
    let countExplanation: RuntimeCountExplanation | null = null;
    let evidence: ManagedRuntimePublishEvidence | null = null;
    let collectionError: unknown = null;
    if (managedBrowser == null || managedBrowser.isClosed()) {
      collectionError = new Error('Managed Playwright browser is unavailable');
    } else {
      try {
        evidence = await managedBrowser.collectRuntimePublishEvidence({
          expectedDocumentHash,
          expectedRuntimeHash,
          heroView:
            sceneDocument.authoring?.composition?.review.heroView ??
            sceneDocument.authoring?.views?.find((view) => view.role === 'hero')
              ?.id,
          nodeIds: representativeNodeIds,
        });
      } catch (error) {
        collectionError = error;
      }
    }

    if (collectionError != null) {
      const editorState =
        collectionError != null && typeof collectionError === 'object'
          ? (collectionError as { publishEditorState?: unknown })
              .publishEditorState
          : null;
      checks.push({
        details: {
          editorState,
          message:
            collectionError instanceof Error
              ? collectionError.message
              : String(collectionError),
        },
        id: 'runtime-collection',
        status: 'failed',
      });
    } else if (evidence != null) {
      const diagnostics = appendRuntimePublishChecks(
        checks,
        evidence,
        sceneDocument,
        expectedNodes,
        representativeNodeIds,
        expectedDocumentHash,
        expectedRuntimeHash,
      );
      presentation = diagnostics.presentation;
      countExplanation = diagnostics.countExplanation;
      warnings.push(
        ...presentation.warnings.map((message, index) => ({
          id: `presentation-${index + 1}`,
          message,
        })),
      );
    }

    const logsSince = evidence?.reloadStartedAt ?? startedAtMs;
    const runtimeLogsSince = evidence?.runtimeReloadStartedAt ?? startedAtMs;
    const logsUntil = Date.now();
    const logs = [
      ...(evidence?.editor.logs ?? []),
      ...(managedBrowser?.queryLogs({
        since: runtimeLogsSince,
        until: logsUntil,
      }) ?? []),
    ].sort((left, right) => left.timestamp - right.timestamp);
    const blockingLogs = logs.filter(isBlockingRuntimePublishLog);
    const warningLogs = logs.filter(isNonBlockingRuntimePublishWarning);
    checks.push({
      details: {
        blockingCount: blockingLogs.length,
        blockingLogs,
        editorReloadStartedAt: evidence?.reloadStartedAt ?? null,
        entryCount: logs.length,
        runtimeReloadStartedAt: evidence?.runtimeReloadStartedAt ?? null,
      },
      id: 'runtime-console',
      status: blockingLogs.length === 0 ? 'passed' : 'failed',
    });
    if (warningLogs.length > 0) {
      warnings.push({
        details: { entries: warningLogs },
        id: 'runtime-render-warnings',
        message: `${warningLogs.length} non-blocking runtime rendering warning(s) were observed; inspect the immutable proof for details.`,
      });
    }

    let capture: RuntimeProofReport['capture'] = null;
    let editorCapture: RuntimeProofReport['editorCapture'] = null;
    if (evidence != null) {
      const editorCapturePath = path.join(
        paths.runtimeRoot,
        `editor-${evidence.editor.capture.sha256.slice('sha256:'.length)}.png`,
      );
      writeImmutableWorkspaceFile(
        workspaceRoot,
        editorCapturePath,
        evidence.editor.capture.bytes,
      );
      editorCapture = {
        height: evidence.editor.capture.height,
        nonblank: evidence.editor.capture.nonblank,
        path: toPosixPath(path.relative(workspaceRoot, editorCapturePath)),
        sha256: evidence.editor.capture.sha256,
        width: evidence.editor.capture.width,
      };
      const capturePath = path.join(
        paths.runtimeRoot,
        `runtime-${evidence.capture.sha256.slice('sha256:'.length)}.png`,
      );
      writeImmutableWorkspaceFile(
        workspaceRoot,
        capturePath,
        evidence.capture.bytes,
      );
      capture = {
        height: evidence.capture.height,
        nonblank: evidence.capture.nonblank,
        path: toPosixPath(path.relative(workspaceRoot, capturePath)),
        sha256: evidence.capture.sha256,
        width: evidence.capture.width,
      };
    }

    let finalDocumentHash: string | null = null;
    let finalRuntimeHash: string | null = null;
    let finalSceneError: string | null = null;
    try {
      const finalSceneDocument = readCurrentReviewScene(paths.scenePath);
      finalDocumentHash = hashSceneDocument(finalSceneDocument);
      finalRuntimeHash = hashRuntimeSceneDocument(finalSceneDocument);
    } catch (error) {
      finalSceneError = error instanceof Error ? error.message : String(error);
    }
    checks.push({
      details: {
        error: finalSceneError,
        expectedDocumentHash,
        expectedRuntimeHash,
        finalDocumentHash,
        finalRuntimeHash,
      },
      id: 'saved-scene-current',
      status:
        finalSceneError == null &&
        finalDocumentHash === expectedDocumentHash &&
        finalRuntimeHash === expectedRuntimeHash
          ? 'passed'
          : 'failed',
    });

    const runtimeProven: RuntimeProofStatus = checks.every(
      (check) => check.status === 'passed',
    )
      ? 'passed'
      : 'failed';
    const report: RuntimeProofReport = {
      capabilityHash,
      capture,
      checks,
      completedAt: new Date(logsUntil).toISOString(),
      documentHash: expectedDocumentHash,
      editorCapture,
      hostPerformance: evidence?.performance ?? null,
      logsWindow: {
        entries: logs,
        since: new Date(logsSince).toISOString(),
        until: new Date(logsUntil).toISOString(),
      },
      measurementEnvironment:
        evidence == null
          ? {}
          : {
              editor: isPlainRecord(evidence.editor.renderStats.environment)
                ? evidence.editor.renderStats.environment
                : {},
              runtime: evidence.environment,
            },
      rawRenderCost: {
        editor: evidence?.editor.renderStats ?? null,
        runtime: evidence?.renderStats ?? null,
      },
      countExplanation,
      presentation,
      representativeNodeIds,
      reviewPath: storedReview.path,
      reviewSha256: storedReview.reviewSha256,
      runtimeHash: expectedRuntimeHash,
      runtimeProven,
      scenePath: toPosixPath(path.relative(workspaceRoot, paths.scenePath)),
      startedAt: new Date(startedAtMs).toISOString(),
      version: 'iwsdk.runtime-proof.v1',
      warnings,
    };
    const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
    const proofSha256 = hashBytes(Buffer.from(serializedReport, 'utf8'));
    const proofPath = path.join(
      paths.proofsRoot,
      `proof-${proofSha256.slice('sha256:'.length)}${RUNTIME_PROOF_FILE_SUFFIX}`,
    );
    writeImmutableWorkspaceFile(workspaceRoot, proofPath, serializedReport);
    response.statusCode = runtimeProven === 'passed' ? 200 : 422;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    const failedChecks = checks
      .filter((check) => check.status === 'failed')
      .map(compactRuntimeProofCheck);
    const compactReport = {
      capture,
      checkCount: checks.length,
      countExplanation,
      documentHash: expectedDocumentHash,
      failedChecks,
      hostPerformance: evidence?.performance ?? null,
      passedCheckCount: checks.length - failedChecks.length,
      presentation,
      reviewPath: storedReview.path,
      runtimeHash: expectedRuntimeHash,
      runtimeProven,
      scenePath: toPosixPath(path.relative(workspaceRoot, paths.scenePath)),
      warnings,
    };
    response.end(
      JSON.stringify({
        ...(runtimeProven === 'failed'
          ? {
              code: 'runtime_publish_proof_failed',
              error: 'Runtime publish proof failed.',
            }
          : {}),
        failedChecks,
        proofPath: toPosixPath(path.relative(workspaceRoot, proofPath)),
        proofSha256,
        report: detail === 'full' ? report : compactReport,
        runtimeProven,
        warnings,
      }),
    );
  } catch (error) {
    sendReviewRequestError(response, error);
  }
}

function compactRuntimeProofCheck(check: RuntimeProofCheck): RuntimeProofCheck {
  if (check.id !== 'render-state') {
    return check;
  }
  const mismatches = Array.isArray(check.details.mismatches)
    ? check.details.mismatches
    : [];
  return {
    details: { mismatches },
    id: check.id,
    status: check.status,
  };
}

function collectPublishNodeIds(
  document: SceneDocument,
  requestedValue: unknown,
): string[] {
  if (
    requestedValue != null &&
    (!Array.isArray(requestedValue) ||
      !requestedValue.every(
        (nodeId) => typeof nodeId === 'string' && nodeId.length > 0,
      ))
  ) {
    throw new WorkspaceReviewError(
      'representativeNodeIds must be an array of scene node ids.',
      400,
      'invalid_representative_nodes',
    );
  }
  const allNodes = flattenSceneDocumentNodes(document.nodes);
  const knownIds = new Set(allNodes.map((node) => node.id));
  const nodeIds = new Set<string>();
  for (const feature of document.authoring?.composition?.features ?? []) {
    if (feature.priority === 'required') {
      feature.nodeRefs.forEach((nodeId) => nodeIds.add(nodeId));
    }
  }
  for (const nodeId of (requestedValue as string[] | undefined) ?? []) {
    nodeIds.add(nodeId);
  }
  if (nodeIds.size === 0) {
    allNodes.forEach((node) => nodeIds.add(node.id));
  }
  const unknownIds = [...nodeIds].filter((nodeId) => !knownIds.has(nodeId));
  if (unknownIds.length > 0) {
    throw new WorkspaceReviewError(
      `Representative nodes are not in the scene: ${unknownIds.join(', ')}`,
      400,
      'unknown_representative_nodes',
    );
  }
  return [...nodeIds].sort();
}

function resolveRuntimeHeroView(document: SceneDocument) {
  const views = document.authoring?.views ?? [];
  const configuredId = document.authoring?.composition?.review.heroView;
  return (
    (configuredId == null
      ? undefined
      : views.find((view) => view.id === configuredId)) ??
    views.find((view) => view.role === 'hero') ??
    null
  );
}

function flattenSceneDocumentNodes(
  nodes: SceneNode[],
  result: SceneNode[] = [],
): SceneNode[] {
  for (const node of nodes) {
    result.push(node);
    flattenSceneDocumentNodes(node.children ?? [], result);
  }
  return result;
}

function appendRuntimePublishChecks(
  checks: RuntimeProofCheck[],
  evidence: ManagedRuntimePublishEvidence,
  expectedDocument: SceneDocument,
  expectedNodes: Map<string, SceneNode>,
  representativeNodeIds: string[],
  expectedDocumentHash: string,
  expectedRuntimeHash: string,
): {
  countExplanation: RuntimeCountExplanation;
  presentation: RuntimePresentationParityResult;
} {
  const runtimeHashPassed =
    evidence.runtimeHashes.length === 1 &&
    evidence.runtimeHashes[0] === expectedRuntimeHash;
  checks.push({
    details: {
      expectedRuntimeHash,
      liveRuntimeHashes: evidence.runtimeHashes,
    },
    id: 'runtime-hash',
    status: runtimeHashPassed ? 'passed' : 'failed',
  });
  checks.push({
    details: {
      beforeReload: evidence.editor.beforeReload,
      dirty: evidence.editor.dirty,
      documentHash: evidence.editor.documentHash,
      expectedDocumentHash,
      runtimeHash: evidence.editor.runtimeHash,
    },
    id: 'editor-saved',
    status:
      !evidence.editor.dirty &&
      evidence.editor.documentHash === expectedDocumentHash &&
      evidence.editor.runtimeHash === expectedRuntimeHash
        ? 'passed'
        : 'failed',
  });
  checks.push({
    details: {
      documentHash: evidence.editor.documentHash,
      expectedDocumentHash,
      expectedRuntimeHash,
      reloadStartedAt: new Date(evidence.reloadStartedAt).toISOString(),
      runtimeHash: evidence.editor.runtimeHash,
    },
    id: 'editor-reload',
    status:
      evidence.editor.documentHash === expectedDocumentHash &&
      evidence.editor.runtimeHash === expectedRuntimeHash
        ? 'passed'
        : 'failed',
  });
  checks.push({
    details: {
      height: evidence.editor.capture.height,
      nonblank: evidence.editor.capture.nonblank,
      sha256: evidence.editor.capture.sha256,
      width: evidence.editor.capture.width,
    },
    id: 'editor-canvas',
    status: evidence.editor.capture.nonblank ? 'passed' : 'failed',
  });
  checks.push({
    details: {
      countExplanation: explainRuntimeCountDifferences(
        expectedDocument,
        evidence.editor.renderStats,
        evidence.renderStats,
        evidence.hierarchyObjectCount,
      ),
      editor: evidence.editor.renderStats,
      hostPerformance: evidence.performance,
      runtime: evidence.renderStats,
    },
    id: 'raw-render-cost',
    status:
      hasRawRenderCost(evidence.editor.renderStats) &&
      hasRawRenderCost(evidence.renderStats)
        ? 'passed'
        : 'failed',
  });
  const renderStateParity = evaluateRuntimeSceneParity(
    expectedDocument,
    evidence.renderStats,
  );
  checks.push({
    details: renderStateParity,
    id: 'render-state',
    status: renderStateParity.passed ? 'passed' : 'failed',
  });

  const missingNodes: string[] = [];
  const contentMismatches: string[] = [];
  const transformMismatches: string[] = [];
  const componentMismatches: string[] = [];
  for (const nodeId of representativeNodeIds) {
    const expected = expectedNodes.get(nodeId)!;
    const actual = evidence.nodes.find((entry) => entry.nodeId === nodeId);
    if (actual?.hierarchy == null) {
      missingNodes.push(nodeId);
      contentMismatches.push(nodeId);
      transformMismatches.push(nodeId);
      componentMismatches.push(nodeId);
      continue;
    }
    if (!runtimeNodeContentMatches(expected, actual.hierarchy)) {
      contentMismatches.push(nodeId);
    }
    if (!runtimeNodeTransformMatches(expected, actual.transform)) {
      transformMismatches.push(nodeId);
    }
    if (!runtimeNodeComponentsMatch(expected, actual.components)) {
      componentMismatches.push(nodeId);
    }
  }
  checks.push({
    details: { missingNodes, representativeNodeIds },
    id: 'representative-nodes',
    status: missingNodes.length === 0 ? 'passed' : 'failed',
  });
  checks.push({
    details: { mismatchedNodeIds: contentMismatches },
    id: 'content-and-resources',
    status: contentMismatches.length === 0 ? 'passed' : 'failed',
  });
  checks.push({
    details: { mismatchedNodeIds: transformMismatches },
    id: 'transforms',
    status: transformMismatches.length === 0 ? 'passed' : 'failed',
  });
  checks.push({
    details: { mismatchedNodeIds: componentMismatches },
    id: 'components',
    status: componentMismatches.length === 0 ? 'passed' : 'failed',
  });
  checks.push({
    details: {
      height: evidence.capture.height,
      nonblank: evidence.capture.nonblank,
      sha256: evidence.capture.sha256,
      width: evidence.capture.width,
    },
    id: 'runtime-canvas',
    status: evidence.capture.nonblank ? 'passed' : 'failed',
  });
  const presentation = evaluateRuntimePresentationParity(
    resolveRuntimeHeroView(expectedDocument),
    {
      camera: evidence.camera,
      framing: evidence.framing,
    },
  );
  checks.push({
    details: {
      actual: evidence.camera,
      ...presentation.camera,
      expected: presentation.expectedView,
    },
    id: 'runtime-camera',
    status: presentation.camera.passed ? 'passed' : 'failed',
  });
  checks.push({
    details: {
      actual: evidence.framing,
      ...presentation.framing,
    },
    id: 'runtime-framing',
    status: presentation.framing.passed ? 'passed' : 'failed',
  });
  return {
    countExplanation: explainRuntimeCountDifferences(
      expectedDocument,
      evidence.editor.renderStats,
      evidence.renderStats,
      evidence.hierarchyObjectCount,
    ),
    presentation,
  };
}

function hasRawRenderCost(value: unknown): boolean {
  if (!isPlainRecord(value) || value.available !== true) {
    return false;
  }
  return (
    typeof value.calls === 'number' &&
    Number.isFinite(value.calls) &&
    typeof value.triangles === 'number' &&
    Number.isFinite(value.triangles) &&
    Array.isArray(value.frameTimeSamplesMs) &&
    value.frameTimeSamplesMs.length > 0 &&
    value.frameTimeSamplesMs.every(
      (sample) => typeof sample === 'number' && Number.isFinite(sample),
    )
  );
}

function runtimeNodeContentMatches(
  expected: SceneNode,
  hierarchy: Record<string, unknown>,
): boolean {
  const expectedContent = expected.content ?? null;
  const actualContent = hierarchy.content ?? null;
  if (!sameCanonicalJson(expectedContent, actualContent)) {
    return false;
  }
  return sameCanonicalJson(
    expectedResourceRefs(expected),
    hierarchy.resourceRefs ?? {},
  );
}

function expectedResourceRefs(node: SceneNode): Record<string, string> {
  switch (node.content?.type) {
    case 'asset':
      return { assetId: node.content.asset };
    case 'instance':
    case 'pattern':
      return { prefabId: node.content.prefab };
    default:
      return {};
  }
}

function runtimeNodeTransformMatches(
  expected: SceneNode,
  value: unknown,
): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }
  const transform = expected.transform ?? {};
  const position = transform.position ?? [0, 0, 0];
  const scale =
    typeof transform.scale === 'number'
      ? [transform.scale, transform.scale, transform.scale]
      : (transform.scale ?? [1, 1, 1]);
  const quaternion = eulerDegreesToQuaternion(
    transform.rotationDeg ?? [0, 0, 0],
  );
  return (
    sameNumberArray(position, value.localPosition) &&
    sameNumberArray(scale, value.localScale) &&
    sameQuaternion(quaternion, value.localQuaternion)
  );
}

function eulerDegreesToQuaternion(
  rotation: [number, number, number],
): number[] {
  const [x, y, z] = rotation.map((value) => (value * Math.PI) / 180);
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function runtimeNodeComponentsMatch(
  expected: SceneNode,
  value: unknown,
): boolean {
  const expectedComponents = expected.components ?? {};
  if (Object.keys(expectedComponents).length === 0) {
    return true;
  }
  if (!isPlainRecord(value) || !Array.isArray(value.components)) {
    return false;
  }
  for (const [componentName, payload] of Object.entries(expectedComponents)) {
    const payloadRecord: Record<string, any> | null = isPlainRecord(payload)
      ? payload
      : null;
    const componentId = normalizeRuntimeComponentId(
      payloadRecord && typeof payloadRecord.type === 'string'
        ? payloadRecord.type
        : componentName,
    );
    const props =
      payloadRecord &&
      typeof payloadRecord.type === 'string' &&
      isPlainRecord(payloadRecord.props)
        ? payloadRecord.props
        : payload;
    const runtimeComponent = value.components.find(
      (entry) => isPlainRecord(entry) && entry.componentId === componentId,
    );
    if (
      !isPlainRecord(runtimeComponent) ||
      !isPlainRecord(runtimeComponent.values)
    ) {
      return false;
    }
    if (
      isPlainRecord(props) &&
      Object.entries(props).some(
        ([key, expectedValue]) =>
          !runtimeValueMatches(expectedValue, runtimeComponent.values[key]),
      )
    ) {
      return false;
    }
  }
  return true;
}

function normalizeRuntimeComponentId(componentName: string): string {
  const unprefixed = componentName.startsWith('com.iwsdk.components.')
    ? componentName.slice('com.iwsdk.components.'.length)
    : componentName;
  return unprefixed === 'Interactable' ? 'RayInteractable' : unprefixed;
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  try {
    return (
      canonicalizeJson(left as object) === canonicalizeJson(right as object)
    );
  } catch {
    return false;
  }
}

function sameNumberArray(expected: number[], actual: unknown): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every(
      (value, index) =>
        typeof value === 'number' && Math.abs(value - expected[index]) <= 1e-4,
    )
  );
}

function sameQuaternion(expected: number[], actual: unknown): boolean {
  return (
    sameNumberArray(expected, actual) ||
    sameNumberArray(
      expected.map((value) => -value),
      actual,
    )
  );
}

function runtimeValueMatches(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(expected - actual) <= 1e-4;
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) =>
        runtimeValueMatches(value, actual[index]),
      )
    );
  }
  if (isPlainRecord(expected)) {
    return (
      isPlainRecord(actual) &&
      Object.entries(expected).every(([key, value]) =>
        runtimeValueMatches(value, actual[key]),
      )
    );
  }
  return sameCanonicalJson(expected, actual);
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isBlockingRuntimePublishLog(log: {
  level?: unknown;
  message?: unknown;
}): boolean {
  if (typeof log.message !== 'string') {
    return false;
  }
  const namesPublishSubsystem = /scene|shader|webgl|material/i.test(
    log.message,
  );
  const namesFailure = /error|fail|invalid|uncaught|unhandled|compile/i.test(
    log.message,
  );
  return namesPublishSubsystem && (log.level === 'error' || namesFailure);
}

function isNonBlockingRuntimePublishWarning(log: {
  level?: unknown;
  message?: unknown;
}): boolean {
  if (typeof log.message !== 'string' || log.level !== 'warn') {
    return false;
  }
  return /scene|shader|webgl|material|texture|light|ibl|render|camera/i.test(
    log.message,
  );
}

function resolveReviewWorkspacePaths(
  requestedScene: unknown,
  workspaceRoot: string,
): ReviewWorkspacePaths {
  const scenePath = resolveManagedScenePath(requestedScene, workspaceRoot);
  assertNoSymlinkTraversal(workspaceRoot, scenePath);
  if (!existsSync(scenePath) || !lstatSync(scenePath).isFile()) {
    throw new WorkspaceReviewError(
      'The selected scene file does not exist.',
      404,
      'scene_not_found',
    );
  }
  const sceneName = path.basename(scenePath, SCENE_FILE_SUFFIX);
  const reviewRoot = path.join(
    path.dirname(scenePath),
    `${sceneName}${REVIEW_ROOT_SUFFIX}`,
  );
  const sceneRoot = path.resolve(workspaceRoot, SCENE_ROOT_RELATIVE_PATH);
  if (!isPathInside(sceneRoot, reviewRoot)) {
    throw new WorkspaceReviewError(
      'Review paths must stay inside public/scenes.',
      400,
      'review_path_escape',
    );
  }
  assertNoSymlinkTraversal(workspaceRoot, reviewRoot);
  return {
    evidenceRoot: path.join(reviewRoot, 'evidence'),
    inspectionsRoot: path.join(reviewRoot, 'inspections'),
    proofsRoot: path.join(reviewRoot, 'proofs'),
    recordsRoot: path.join(reviewRoot, 'records'),
    reviewRoot,
    runtimeRoot: path.join(reviewRoot, 'runtime'),
    scenePath,
  };
}

function readCurrentReviewScene(scenePath: string): SceneDocument {
  try {
    return parseSceneDocument(readFileSync(scenePath, 'utf8'));
  } catch (error) {
    throw new WorkspaceReviewError(
      `Cannot read the selected scene document: ${
        error instanceof Error ? error.message : String(error)
      }`,
      400,
      'invalid_scene_document',
    );
  }
}

function requireSafeReviewCaptureId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
  ) {
    throw new WorkspaceReviewError(
      'captureId must use 1-128 ASCII letters, digits, dots, underscores, or hyphens and cannot contain path separators.',
      400,
      'invalid_capture_id',
    );
  }
  return value;
}

function requireSha256(value: unknown, fieldName: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-fA-F]{64}$/.test(value)) {
    throw new WorkspaceReviewError(
      `${fieldName} must be a sha256:<64 hex> hash.`,
      400,
      'invalid_hash',
    );
  }
  return value.toLowerCase() as `sha256:${string}`;
}

function sameSha256(left: unknown, right: unknown): boolean {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function requireReviewCaptureSessionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    throw new WorkspaceReviewError(
      'sessionId must use 1-128 ASCII letters, digits, dots, underscores, colons, or hyphens.',
      400,
      'invalid_review_capture_session',
    );
  }
  return value;
}

function requireTrustedCaptureHash(
  facts: Record<string, unknown>,
  fieldName: string,
): `sha256:${string}` {
  return requireSha256(facts[fieldName], `capture.${fieldName}`);
}

function requireTrustedCaptureDimension(
  facts: Record<string, unknown>,
  fieldName: 'height' | 'width',
): number {
  const value = facts[fieldName];
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 4096
  ) {
    throw new WorkspaceReviewError(
      `capture.${fieldName} must be an integer from 1 through 4096.`,
      400,
      'invalid_png_dimensions',
    );
  }
  return value as number;
}

function parseIssuedReviewCapture(value: unknown): {
  bytes: Buffer;
  facts: Record<string, unknown>;
} {
  if (!isPlainRecord(value)) {
    throw new WorkspaceReviewError(
      'capture must be the complete result returned by scene_capture_review.',
      400,
      'invalid_review_capture',
    );
  }
  const png = decodeReviewPng(value.imageData);
  const screenshotSha256 = requireSha256(
    value.screenshotSha256,
    'capture.screenshotSha256',
  );
  const actualSha256 = hashBytes(png.bytes);
  if (actualSha256 !== screenshotSha256) {
    throw new WorkspaceReviewError(
      `Screenshot hash mismatch: supplied ${screenshotSha256}, computed ${actualSha256}`,
      400,
      'screenshot_hash_mismatch',
    );
  }
  requireSha256(value.capabilityHash, 'capture.capabilityHash');
  requireSha256(value.documentHash, 'capture.documentHash');
  requireSha256(value.runtimeHash, 'capture.runtimeHash');
  const width = requireTrustedCaptureDimension(value, 'width');
  const height = requireTrustedCaptureDimension(value, 'height');
  if (width !== png.width || height !== png.height) {
    throw new WorkspaceReviewError(
      `Capture dimensions ${width}x${height} do not match PNG dimensions ${png.width}x${png.height}.`,
      400,
      'invalid_png_dimensions',
    );
  }
  if (value.mimeType !== 'image/png') {
    throw new WorkspaceReviewError(
      'capture.mimeType must be image/png.',
      400,
      'invalid_png',
    );
  }
  if (value.screenshotHashAvailable !== true) {
    throw new WorkspaceReviewError(
      'Managed review captures require an available screenshot hash.',
      400,
      'invalid_review_capture',
    );
  }
  if (
    value.lens !== 'layout' &&
    value.lens !== 'geometry' &&
    value.lens !== 'final'
  ) {
    throw new WorkspaceReviewError(
      'capture.lens must be layout, geometry, or final.',
      400,
      'invalid_review_capture',
    );
  }
  validateIssuedCaptureCamera(value.camera);
  if (
    value.rendererEnvironment != null &&
    !isPlainRecord(value.rendererEnvironment)
  ) {
    throw new WorkspaceReviewError(
      'capture.rendererEnvironment must be an object or null.',
      400,
      'invalid_review_capture',
    );
  }
  if (!Array.isArray(value.logs) || !isPlainRecord(value.featureState)) {
    throw new WorkspaceReviewError(
      'capture logs and featureState are malformed.',
      400,
      'invalid_review_capture',
    );
  }
  if (
    value.visibleNodeIds != null &&
    (!Array.isArray(value.visibleNodeIds) ||
      value.visibleNodeIds.some((nodeId) => typeof nodeId !== 'string'))
  ) {
    throw new WorkspaceReviewError(
      'capture.visibleNodeIds must be an array of node ids or null.',
      400,
      'invalid_review_capture',
    );
  }
  const {
    captureToken: _captureToken,
    imageData: _imageData,
    ...rawFacts
  } = value;
  let facts: Record<string, unknown>;
  try {
    facts = JSON.parse(canonicalizeJson(rawFacts)) as Record<string, unknown>;
  } catch {
    throw new WorkspaceReviewError(
      'capture facts must contain only canonical JSON values.',
      400,
      'invalid_review_capture',
    );
  }
  facts.capabilityHash = requireSha256(
    facts.capabilityHash,
    'capture.capabilityHash',
  );
  facts.documentHash = requireSha256(
    facts.documentHash,
    'capture.documentHash',
  );
  facts.runtimeHash = requireSha256(facts.runtimeHash, 'capture.runtimeHash');
  facts.screenshotSha256 = screenshotSha256;
  return { bytes: png.bytes, facts };
}

function validateIssuedCaptureCamera(value: unknown): void {
  if (!isPlainRecord(value)) {
    throw new WorkspaceReviewError(
      'capture.camera must be an exact camera object.',
      400,
      'invalid_review_capture',
    );
  }
  if (
    value.projection !== 'perspective' &&
    value.projection !== 'orthographic'
  ) {
    throw new WorkspaceReviewError(
      'capture.camera.projection is invalid.',
      400,
      'invalid_review_capture',
    );
  }
  for (const fieldName of ['position', 'lookAt'] as const) {
    const vector = value[fieldName];
    if (
      !Array.isArray(vector) ||
      vector.length !== 3 ||
      vector.some(
        (component) =>
          typeof component !== 'number' || !Number.isFinite(component),
      )
    ) {
      throw new WorkspaceReviewError(
        `capture.camera.${fieldName} must be a finite vec3.`,
        400,
        'invalid_review_capture',
      );
    }
  }
  if (typeof value.view !== 'string' || value.view.length === 0) {
    throw new WorkspaceReviewError(
      'capture.camera.view is required.',
      400,
      'invalid_review_capture',
    );
  }
  if (
    value.viewId != null &&
    (typeof value.viewId !== 'string' || value.viewId.length === 0)
  ) {
    throw new WorkspaceReviewError(
      'capture.camera.viewId must be a non-empty string when present.',
      400,
      'invalid_review_capture',
    );
  }
  const projectionMeasure =
    value.projection === 'orthographic' ? value.height : value.fov;
  if (
    typeof projectionMeasure !== 'number' ||
    !Number.isFinite(projectionMeasure) ||
    projectionMeasure <= 0
  ) {
    throw new WorkspaceReviewError(
      `capture.camera.${value.projection === 'orthographic' ? 'height' : 'fov'} must be positive.`,
      400,
      'invalid_review_capture',
    );
  }
}

function decodeReviewPng(value: unknown): {
  bytes: Buffer;
  height: number;
  width: number;
} {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new WorkspaceReviewError(
      'imageData must be canonical base64 PNG bytes without a data URL prefix.',
      400,
      'invalid_png_base64',
    );
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new WorkspaceReviewError(
      'imageData must use canonical base64 encoding.',
      400,
      'invalid_png_base64',
    );
  }
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new WorkspaceReviewError(
      'imageData does not have a valid PNG signature.',
      400,
      'invalid_png',
    );
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawHeader = false;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  const imageDataChunks: Buffer[] = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) {
      throw invalidPng('PNG ends inside a chunk header.');
    }
    const length = bytes.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) {
      throw invalidPng('PNG contains a truncated chunk.');
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type) || /[a-z]/.test(type[2])) {
      throw invalidPng('PNG contains an invalid chunk type.');
    }
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = pngCrc32(bytes.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) {
      throw invalidPng(`PNG chunk ${type} has an invalid CRC.`);
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (!sawHeader && type !== 'IHDR') {
      throw invalidPng('IHDR must be the first PNG chunk.');
    }
    if (sawEnd) {
      throw invalidPng('PNG contains data after IEND.');
    }
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) {
        throw invalidPng('PNG must contain one 13-byte IHDR chunk.');
      }
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compressionMethod = data[10];
      const filterMethod = data[11];
      const interlaceMethod = data[12];
      if (width < 1 || height < 1 || width > 4096 || height > 4096) {
        throw new WorkspaceReviewError(
          'PNG width and height must be between 1 and 4096.',
          400,
          'invalid_png_dimensions',
        );
      }
      if (!isValidPngBitDepth(bitDepth, colorType)) {
        throw invalidPng('PNG IHDR has an invalid bit depth or color type.');
      }
      if (
        compressionMethod !== 0 ||
        filterMethod !== 0 ||
        interlaceMethod !== 0
      ) {
        throw invalidPng(
          'Review PNGs must use standard compression/filtering and no interlace.',
        );
      }
    } else if (type === 'PLTE') {
      if (
        sawPalette ||
        sawImageData ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 768 ||
        colorType === 0 ||
        colorType === 4
      ) {
        throw invalidPng('PNG contains an invalid PLTE chunk.');
      }
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (imageDataEnded) {
        throw invalidPng('PNG IDAT chunks must be consecutive.');
      }
      sawImageData = true;
      imageDataChunks.push(data);
    } else {
      if (sawImageData) {
        imageDataEnded = true;
      }
      if (type === 'IEND') {
        if (length !== 0 || !sawImageData) {
          throw invalidPng('PNG has an invalid IEND chunk.');
        }
        sawEnd = true;
      } else if (type[0] === type[0].toUpperCase()) {
        throw invalidPng(`PNG contains unknown critical chunk ${type}.`);
      }
    }
    offset = chunkEnd;
  }
  if (!sawHeader || !sawImageData || !sawEnd || offset !== bytes.length) {
    throw invalidPng('PNG is missing required IHDR, IDAT, or IEND chunks.');
  }
  if (colorType === 3 && !sawPalette) {
    throw invalidPng('Indexed PNGs require a PLTE chunk.');
  }
  const channels =
    colorType === 0
      ? 1
      : colorType === 2
        ? 3
        : colorType === 3
          ? 1
          : colorType === 4
            ? 2
            : 4;
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const expectedDecodedBytes = height * (rowBytes + 1);
  let decoded: Buffer;
  try {
    decoded = inflateSync(Buffer.concat(imageDataChunks), {
      maxOutputLength: expectedDecodedBytes,
    });
  } catch {
    throw invalidPng('PNG IDAT data is not a valid bounded zlib stream.');
  }
  if (decoded.length !== expectedDecodedBytes) {
    throw invalidPng('PNG scanline data has an invalid length.');
  }
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (rowBytes + 1)] > 4) {
      throw invalidPng('PNG scanline uses an invalid filter type.');
    }
  }
  return { bytes, height, width };
}

function invalidPng(message: string): WorkspaceReviewError {
  return new WorkspaceReviewError(message, 400, 'invalid_png');
}

function isValidPngBitDepth(bitDepth: number, colorType: number): boolean {
  const validByColorType: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  return validByColorType[colorType]?.includes(bitDepth) === true;
}

function pngCrc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hashBytes(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function writeImmutableWorkspaceFile(
  workspaceRoot: string,
  filePath: string,
  content: Buffer | string,
): boolean {
  assertNoSymlinkTraversal(workspaceRoot, filePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  assertNoSymlinkTraversal(workspaceRoot, filePath);
  const expected = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, 'utf8');
  const compareExisting = (): boolean => {
    if (!existsSync(filePath)) {
      return false;
    }
    if (!lstatSync(filePath).isFile()) {
      throw new WorkspaceReviewError(
        'Review evidence path is not a regular file.',
        409,
        'immutable_review_conflict',
      );
    }
    if (readFileSync(filePath).equals(expected)) {
      return true;
    }
    throw new WorkspaceReviewError(
      'Immutable review evidence already exists with different content.',
      409,
      'immutable_review_conflict',
    );
  };
  if (compareExisting()) {
    return false;
  }
  try {
    writeFileSync(filePath, content, { flag: 'wx' });
    return true;
  } catch (error) {
    if (
      error != null &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === 'EEXIST' &&
      compareExisting()
    ) {
      return false;
    }
    throw error;
  }
}

function assertNoSymlinkTraversal(
  workspaceRoot: string,
  targetPath: string,
): void {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(targetPath);
  if (!isPathInside(root, target)) {
    throw new WorkspaceReviewError(
      'Review path must stay inside the workspace.',
      400,
      'review_path_escape',
    );
  }
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new WorkspaceReviewError(
        'Review paths cannot traverse symbolic links.',
        400,
        'review_symlink_rejected',
      );
    }
  }
}

function reviewRecordFileName(review: SceneReview): string {
  const round = String(review.round).padStart(6, '0');
  const documentHash = review.documentHash
    .slice('sha256:'.length)
    .toLowerCase();
  const runtimeHash = review.runtimeHash.slice('sha256:'.length).toLowerCase();
  return `round-${round}-${documentHash}-${runtimeHash}${REVIEW_FILE_SUFFIX}`;
}

function reviewCaptureMetadataPath(capturePath: string): string {
  if (!capturePath.toLowerCase().endsWith('.png')) {
    throw new WorkspaceReviewError(
      'Review capture evidence path must end in .png.',
      400,
      'invalid_review_evidence',
    );
  }
  return `${capturePath.slice(0, -'.png'.length)}${REVIEW_CAPTURE_FILE_SUFFIX}`;
}

function validatePersistedCaptureMetadata(
  review: SceneReview,
  lensId: SceneReview['lenses'][number]['id'],
  capture: SceneReview['lenses'][number]['captures'][number],
  capturePath: string,
  workspaceRoot: string,
  byteLength: number,
): void {
  const metadataPath = reviewCaptureMetadataPath(capturePath);
  assertNoSymlinkTraversal(workspaceRoot, metadataPath);
  if (!existsSync(metadataPath) || !lstatSync(metadataPath).isFile()) {
    throw new Error('capture revision metadata does not exist');
  }
  const metadata = JSON.parse(
    readFileSync(metadataPath, 'utf8'),
  ) as Partial<PersistedReviewCapture>;
  if (
    typeof metadata.captureToken !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(metadata.captureToken)
  ) {
    throw new Error('capture revision metadata has an invalid capture token');
  }
  const expectedTopLevel = {
    byteLength,
    captureId: capture.id,
    height: capture.height,
    path: capture.path,
    version: 'iwsdk.review-capture.v1',
    width: capture.width,
  };
  if (
    Object.entries(expectedTopLevel).some(
      ([key, expected]) =>
        !sameCanonicalJson(
          metadata[key as keyof PersistedReviewCapture],
          expected,
        ),
    ) ||
    !sameSha256(metadata.capabilityHash, review.capabilityHash) ||
    !sameSha256(metadata.documentHash, review.documentHash) ||
    !sameSha256(metadata.runtimeHash, review.runtimeHash) ||
    !sameSha256(metadata.screenshotSha256, capture.screenshotSha256) ||
    typeof metadata.sessionIdSha256 !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(metadata.sessionIdSha256) ||
    !isPlainRecord(metadata.facts)
  ) {
    throw new Error(
      'capture revision metadata does not match the review identity',
    );
  }
  const facts = metadata.facts;
  if (
    !sameSha256(
      requireTrustedCaptureHash(facts, 'capabilityHash'),
      review.capabilityHash,
    ) ||
    !sameSha256(
      requireTrustedCaptureHash(facts, 'documentHash'),
      review.documentHash,
    ) ||
    !sameSha256(
      requireTrustedCaptureHash(facts, 'runtimeHash'),
      review.runtimeHash,
    ) ||
    !sameSha256(
      requireTrustedCaptureHash(facts, 'screenshotSha256'),
      capture.screenshotSha256,
    ) ||
    requireTrustedCaptureDimension(facts, 'width') !== capture.width ||
    requireTrustedCaptureDimension(facts, 'height') !== capture.height
  ) {
    throw new Error('trusted capture facts do not match the review identity');
  }
  if (facts.lens !== lensId) {
    throw new Error(
      `review lens ${lensId} does not match issued capture lens ${String(facts.lens)}`,
    );
  }
  if (!isPlainRecord(facts.camera)) {
    throw new Error('trusted capture camera is malformed');
  }
  const expectedView =
    typeof facts.camera.viewId === 'string'
      ? facts.camera.viewId
      : facts.camera.view;
  if (capture.view !== expectedView) {
    throw new Error(
      `review view ${capture.view} does not match issued capture view ${String(expectedView)}`,
    );
  }
  const expectedCamera = issuedCameraAsReviewCamera(facts.camera);
  if (!sameCanonicalJson(capture.camera, expectedCamera)) {
    throw new Error('review camera does not match the issued capture camera');
  }
  if (
    !sameCanonicalJson(capture.rendererEnvironment, facts.rendererEnvironment)
  ) {
    throw new Error(
      'review rendererEnvironment does not match the issued capture',
    );
  }
  if (!sameCanonicalJson(capture.visibleNodeIds, facts.visibleNodeIds)) {
    throw new Error(
      'review visibleNodeIds do not match the issued capture visibility',
    );
  }
  if (
    !sameCanonicalJson(
      capture.nodeMaskRegions ?? null,
      facts.nodeMaskRegions ?? null,
    )
  ) {
    throw new Error(
      'review nodeMaskRegions do not match the issued capture measurement facts',
    );
  }
}

function issuedCameraAsReviewCamera(
  camera: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    position: camera.position,
    projection: camera.projection,
    target: camera.lookAt,
  };
  if (camera.projection === 'orthographic') {
    result.height = camera.height;
  } else {
    result.fov = camera.fov;
  }
  return result;
}

function validatePersistedReviewEvidence(
  review: SceneReview,
  paths: ReviewWorkspacePaths,
  workspaceRoot: string,
): void {
  const issues = collectPersistedReviewEvidenceIssues(
    review,
    paths,
    workspaceRoot,
  );
  if (issues.length > 0) {
    throw new WorkspaceReviewError(
      'Review capture evidence is missing or does not match the record.',
      400,
      'invalid_review_evidence',
      { issues },
    );
  }
}

function rejectUntrustedReviewWaivers(
  review: unknown,
  document: SceneDocument,
): void {
  if (
    !isPlainRecord(review) ||
    !Array.isArray(review.waivers) ||
    review.waivers.length === 0
  ) {
    return;
  }
  const criteria = new Set(
    (document.authoring?.composition?.features ?? []).flatMap((feature) =>
      feature.acceptance.map(
        (criterion) => `${feature.id}\u0000${criterion.id}`,
      ),
    ),
  );
  const structurallyApplicable = review.waivers.every(
    (waiver) =>
      isPlainRecord(waiver) &&
      waiver.authorizedBy === 'user' &&
      typeof waiver.feature === 'string' &&
      typeof waiver.criterion === 'string' &&
      typeof waiver.reason === 'string' &&
      waiver.reason.length > 0 &&
      criteria.has(`${waiver.feature}\u0000${waiver.criterion}`),
  );
  if (!structurallyApplicable) {
    return;
  }
  throw new WorkspaceReviewError(
    'Review waivers cannot be persisted because this server has no trusted user-approval boundary.',
    409,
    'trusted_review_waiver_unavailable',
  );
}

function validatePersistedReviewLineage(
  review: SceneReview,
  paths: ReviewWorkspacePaths,
  workspaceRoot: string,
): void {
  const issues = collectPersistedReviewLineageIssues(
    review,
    paths,
    workspaceRoot,
  );
  if (issues.length > 0) {
    throw new WorkspaceReviewError(
      'Review correction lineage is missing or invalid.',
      400,
      'invalid_review_lineage',
      { issues },
    );
  }
}

function collectPersistedReviewLineageIssues(
  review: SceneReview,
  paths: ReviewWorkspacePaths,
  workspaceRoot: string,
): Array<{ code: string; message: string; path: string }> {
  const issues: Array<{ code: string; message: string; path: string }> = [];
  const visited = new Set<string>();
  let current = review;
  let issuePath = '$.previousReview';

  while (current.round > 0) {
    const lineage = current.previousReview;
    if (lineage == null) {
      issues.push({
        code: 'lineage-required',
        message: `correction round ${current.round} must link to immutable round ${current.round - 1}`,
        path: issuePath,
      });
      break;
    }

    const filePath = path.resolve(workspaceRoot, lineage.path);
    const canonicalRelativePath = toPosixPath(
      path.relative(workspaceRoot, filePath),
    );
    if (
      lineage.path !== canonicalRelativePath ||
      !isPathInside(paths.recordsRoot, filePath) ||
      !filePath.endsWith(REVIEW_FILE_SUFFIX)
    ) {
      issues.push({
        code: 'lineage-path',
        message:
          'previous review path must be the exact workspace-relative record path returned by scene_save_review',
        path: `${issuePath}.path`,
      });
      break;
    }
    if (visited.has(filePath)) {
      issues.push({
        code: 'lineage-cycle',
        message: 'review lineage contains a cycle',
        path: issuePath,
      });
      break;
    }
    visited.add(filePath);

    try {
      assertNoSymlinkTraversal(workspaceRoot, filePath);
      if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
        throw new Error('previous immutable review record does not exist');
      }
      const serialized = readFileSync(filePath, 'utf8');
      const actualHash = hashBytes(Buffer.from(serialized, 'utf8'));
      if (actualHash !== lineage.reviewSha256.toLowerCase()) {
        throw new Error(
          `previous review hash is ${actualHash}, not ${lineage.reviewSha256}`,
        );
      }
      const previous = parseSceneReview(serialized);
      if (previous.round !== current.round - 1) {
        throw new Error(
          `previous review is round ${previous.round}; expected ${current.round - 1}`,
        );
      }
      if (path.basename(filePath) !== reviewRecordFileName(previous)) {
        throw new Error('previous review filename does not match its identity');
      }
      if (
        previous.capabilityHash.toLowerCase() !==
        current.capabilityHash.toLowerCase()
      ) {
        throw new Error(
          'previous review uses a different capability snapshot and cannot continue this correction run',
        );
      }
      current = previous;
      issuePath = `${issuePath}.previousReview`;
    } catch (error) {
      issues.push({
        code: 'lineage-integrity',
        message: error instanceof Error ? error.message : String(error),
        path: issuePath,
      });
      break;
    }
  }
  return issues;
}

function collectPersistedReviewEvidenceIssues(
  review: SceneReview,
  paths: ReviewWorkspacePaths,
  workspaceRoot: string,
): Array<{ code: string; message: string; path: string }> {
  const issues: Array<{ code: string; message: string; path: string }> = [];
  review.lenses.forEach((lens, lensIndex) => {
    lens.captures.forEach((capture, captureIndex) => {
      const issuePath = `$.lenses[${lensIndex}].captures[${captureIndex}]`;
      const capturePath = path.resolve(workspaceRoot, capture.path);
      if (!isPathInside(paths.evidenceRoot, capturePath)) {
        issues.push({
          code: 'evidence-path',
          message:
            'capture path is not persisted under this scene review directory',
          path: `${issuePath}.path`,
        });
        return;
      }
      try {
        assertNoSymlinkTraversal(workspaceRoot, capturePath);
        if (!existsSync(capturePath) || !lstatSync(capturePath).isFile()) {
          throw new Error('capture file does not exist');
        }
        const bytes = readFileSync(capturePath);
        const actualHash = hashBytes(bytes);
        if (actualHash !== capture.screenshotSha256.toLowerCase()) {
          throw new Error(`capture hash is ${actualHash}`);
        }
        const png = decodeReviewPng(bytes.toString('base64'));
        if (png.width !== capture.width || png.height !== capture.height) {
          throw new Error(`capture dimensions are ${png.width}x${png.height}`);
        }
        validatePersistedCaptureMetadata(
          review,
          lens.id,
          capture,
          capturePath,
          workspaceRoot,
          bytes.length,
        );
      } catch (error) {
        issues.push({
          code: 'evidence-integrity',
          message: error instanceof Error ? error.message : String(error),
          path: issuePath,
        });
      }
    });
  });
  return issues;
}

function listSceneReviewRecords(
  paths: ReviewWorkspacePaths,
  workspaceRoot: string,
  sceneDocument: SceneDocument,
  expectedCapabilityHash: `sha256:${string}`,
): ReviewRecordSummary[] {
  if (!existsSync(paths.recordsRoot)) {
    return [];
  }
  assertNoSymlinkTraversal(workspaceRoot, paths.recordsRoot);
  const reviews: ReviewRecordSummary[] = [];
  for (const entry of readdirSync(paths.recordsRoot, { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      !entry.name.endsWith(REVIEW_FILE_SUFFIX)
    ) {
      continue;
    }
    const filePath = path.join(paths.recordsRoot, entry.name);
    try {
      const serialized = readFileSync(filePath, 'utf8');
      const review = parseSceneReview(serialized);
      const validation = validateSceneReviewAgainstDocument(
        review,
        sceneDocument,
        expectedCapabilityHash,
      );
      const evidenceIssues = collectPersistedReviewEvidenceIssues(
        review,
        paths,
        workspaceRoot,
      );
      const lineageIssues = collectPersistedReviewLineageIssues(
        review,
        paths,
        workspaceRoot,
      );
      reviews.push(
        summarizeReviewRecord(
          review,
          toPosixPath(path.relative(workspaceRoot, filePath)),
          serialized,
          sceneDocument,
          validation.valid &&
            evidenceIssues.length === 0 &&
            lineageIssues.length === 0,
        ),
      );
    } catch {
      continue;
    }
  }
  return reviews.sort((left, right) =>
    left.round !== right.round
      ? left.round - right.round
      : left.path < right.path
        ? -1
        : left.path > right.path
          ? 1
          : 0,
  );
}

function getSceneReviewRecord(
  requestedPath: string,
  paths: ReviewWorkspacePaths,
  workspaceRoot: string,
  sceneDocument: SceneDocument,
  expectedCapabilityHash: `sha256:${string}`,
) {
  const filePath = path.resolve(workspaceRoot, requestedPath);
  if (
    !isPathInside(paths.recordsRoot, filePath) ||
    !filePath.endsWith(REVIEW_FILE_SUFFIX)
  ) {
    throw new WorkspaceReviewError(
      'Review record path is not part of the selected scene.',
      400,
      'review_path_escape',
    );
  }
  assertNoSymlinkTraversal(workspaceRoot, filePath);
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    throw new WorkspaceReviewError(
      'Review record was not found.',
      404,
      'review_not_found',
    );
  }
  const serialized = readFileSync(filePath, 'utf8');
  let review: SceneReview;
  try {
    review = parseSceneReview(serialized);
  } catch {
    throw new WorkspaceReviewError(
      'Stored review record does not match the review schema.',
      400,
      'invalid_stored_review',
    );
  }
  const validation = validateSceneReviewAgainstDocument(
    review,
    sceneDocument,
    expectedCapabilityHash,
  );
  const evidenceIssues = collectPersistedReviewEvidenceIssues(
    review,
    paths,
    workspaceRoot,
  );
  const lineageIssues = collectPersistedReviewLineageIssues(
    review,
    paths,
    workspaceRoot,
  );
  const relativePath = toPosixPath(path.relative(workspaceRoot, filePath));
  return {
    current:
      validation.valid &&
      evidenceIssues.length === 0 &&
      lineageIssues.length === 0,
    issues: [...validation.issues, ...evidenceIssues, ...lineageIssues],
    path: relativePath,
    review,
    reviewSha256: hashBytes(Buffer.from(serialized, 'utf8')),
  };
}

function summarizeReviewRecord(
  review: SceneReview,
  relativePath: string,
  serialized: string,
  sceneDocument: SceneDocument,
  current = validateSceneReviewAgainstDocument(review, sceneDocument).valid,
): ReviewRecordSummary {
  return {
    captureCount: review.lenses.reduce(
      (total, lens) => total + lens.captures.length,
      0,
    ),
    current,
    documentHash: review.documentHash,
    path: relativePath,
    result: review.result,
    reviewSha256: hashBytes(Buffer.from(serialized, 'utf8')),
    round: review.round,
    runtimeHash: review.runtimeHash,
    version: review.version,
  };
}

function sendReviewRequestError(
  response: ServerResponse,
  error: unknown,
): void {
  if (error instanceof SceneReviewWorkflowError) {
    sendJsonError(response, error.statusCode, error.message, {
      code: error.code,
      ...error.details,
    });
    return;
  }
  if (error instanceof WorkspaceReviewError) {
    sendJsonError(response, error.statusCode, error.message, {
      code: error.code,
      ...error.extra,
    });
    return;
  }
  sendJsonError(
    response,
    400,
    error instanceof Error ? error.message : String(error),
    { code: 'invalid_review_request' },
  );
}

function resolveEditorScenePath(
  url: string | undefined,
  workspaceRoot: string,
  defaultScene?: string,
): string {
  const parsed = new URL(url ?? '', 'http://iwsdk.local');
  return resolveManagedScenePath(
    parsed.searchParams.get('scene'),
    workspaceRoot,
    defaultScene,
  );
}

function resolveManagedScenePath(
  requestedScene: unknown,
  workspaceRoot: string,
  defaultScene?: string,
): string {
  const scenePath =
    typeof requestedScene === 'string' && requestedScene.trim().length > 0
      ? requestedScene.trim()
      : (defaultScene ??
        path.join(SCENE_ROOT_RELATIVE_PATH, 'scene.iwsdk.scene.json'));
  const relativeScene = scenePath.replace(/^\/+/, '');
  const resolved = path.resolve(workspaceRoot, relativeScene);
  const sceneRoot = path.resolve(workspaceRoot, SCENE_ROOT_RELATIVE_PATH);
  const relativeToWorkspace = path.relative(workspaceRoot, resolved);
  const relativeToSceneRoot = path.relative(sceneRoot, resolved);

  if (
    relativeToWorkspace === '' ||
    relativeToWorkspace.startsWith('..') ||
    path.isAbsolute(relativeToWorkspace)
  ) {
    throw new Error('Scene path must stay inside the Vite workspace root');
  }
  if (
    relativeToSceneRoot === '' ||
    relativeToSceneRoot.startsWith('..') ||
    path.isAbsolute(relativeToSceneRoot)
  ) {
    throw new Error('Scene path must stay inside public/scenes/');
  }
  if (!resolved.endsWith(SCENE_FILE_SUFFIX)) {
    throw new Error(`Scene path must end with ${SCENE_FILE_SUFFIX}`);
  }
  // Every scene read and write goes through here, so a symbolic link at
  // public/scenes or inside it can never reach outside the project.
  if (!isRealPathInside(workspaceRoot, sceneRoot)) {
    throw new Error(
      'public/scenes/ must resolve inside the Vite workspace root, including through symbolic links',
    );
  }
  if (!isRealPathInside(sceneRoot, resolved)) {
    throw new Error(
      'Scene path must stay inside public/scenes/, including through symbolic links',
    );
  }

  return resolved;
}

async function composeWorkspaceSceneDocument(
  document: SceneDocument,
  scenePath: string,
  workspaceRoot: string,
) {
  const publicRoot = path.resolve(workspaceRoot, 'public');
  const sceneRoot = path.resolve(workspaceRoot, SCENE_ROOT_RELATIVE_PATH);
  const sourceForPath = (absolutePath: string): string =>
    `/${toPosixPath(path.relative(publicRoot, absolutePath))}`;

  const composed = await composeSceneDocument(document, {
    source: sourceForPath(scenePath),
    validateAuthoringWorkflow: false,
    resolve: ({ importer, src }) => {
      if (importer == null) {
        throw new Error(
          `Cannot resolve scene import "${src}" without an importer`,
        );
      }
      const base = new URL(importer, 'http://iwsdk.local');
      const resolvedUrl = new URL(src, base);
      if (resolvedUrl.origin !== base.origin) {
        throw new Error(
          `Scene import "${src}" must stay inside this workspace`,
        );
      }
      const decodedPath = decodeURIComponent(resolvedUrl.pathname);
      const absolutePath = path.resolve(publicRoot, `.${decodedPath}`);
      const relativeToSceneRoot = path.relative(sceneRoot, absolutePath);
      if (
        relativeToSceneRoot === '' ||
        relativeToSceneRoot.startsWith('..') ||
        path.isAbsolute(relativeToSceneRoot)
      ) {
        throw new Error(
          `Scene import "${src}" must resolve inside public/scenes/`,
        );
      }
      if (!absolutePath.endsWith(SCENE_FILE_SUFFIX)) {
        throw new Error(
          `Scene import "${src}" must end with ${SCENE_FILE_SUFFIX}`,
        );
      }
      if (!isRealPathInside(sceneRoot, absolutePath)) {
        throw new Error(
          `Scene import "${src}" must resolve inside public/scenes/, including through symbolic links`,
        );
      }
      if (!existsSync(absolutePath)) {
        throw new Error(`Scene import file does not exist: ${src}`);
      }
      return {
        document: parseSceneDocument(readFileSync(absolutePath, 'utf8'), {
          validateAuthoringWorkflow: false,
        }),
        source: sourceForPath(absolutePath),
      };
    },
  });

  return {
    document: composed.document,
    dependencies: composed.dependencies.map((dependency) => ({
      ...dependency,
      path: toPosixPath(path.join('public', dependency.source)),
    })),
  };
}

function listSceneFiles(workspaceRoot: string) {
  const sceneRoot = path.resolve(workspaceRoot, SCENE_ROOT_RELATIVE_PATH);
  if (!existsSync(sceneRoot)) {
    return [];
  }
  // The walk below skips symbolic links; only the root itself can be one.
  if (!isRealPathInside(workspaceRoot, sceneRoot)) {
    throw new Error(
      'public/scenes/ must resolve inside the Vite workspace root, including through symbolic links',
    );
  }

  const files: Array<{
    hasImports: boolean;
    modifiedAt: string;
    path: string;
    revision: string;
    size: number;
  }> = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !absolutePath.endsWith(SCENE_FILE_SUFFIX)) {
        continue;
      }
      const stats = statSync(absolutePath);
      let hasImports = false;
      try {
        const source = JSON.parse(readFileSync(absolutePath, 'utf8')) as {
          imports?: unknown;
        };
        hasImports = Array.isArray(source.imports) && source.imports.length > 0;
      } catch {}
      files.push({
        hasImports,
        modifiedAt: stats.mtime.toISOString(),
        path: path.relative(workspaceRoot, absolutePath),
        revision: sceneFileRevisionFromContent(readFileSync(absolutePath)),
        size: stats.size,
      });
    }
  };

  visit(sceneRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function getSceneFileRevision(filePath: string): {
  exists: boolean;
  modifiedAt?: string;
  revision: string;
  size?: number;
} {
  if (!existsSync(filePath)) {
    return { exists: false, revision: 'missing' };
  }
  const stats = statSync(filePath);
  return {
    exists: true,
    modifiedAt: stats.mtime.toISOString(),
    revision: sceneFileRevisionFromContent(readFileSync(filePath)),
    size: stats.size,
  };
}

function sceneFileRevisionFromContent(content: Buffer | string) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

async function readRequestBody(
  request: IncomingMessage,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += bytes.length;
    if (totalBytes > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** @deprecated Use `iwsdkDev` instead */
export const injectIWER = iwsdkDev;
