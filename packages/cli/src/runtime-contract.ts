/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export type AiTool = 'claude' | 'cursor' | 'copilot' | 'codex' | 'opencode';

export const DEFAULT_RUNTIME_COMMAND_TIMEOUT_MS = 30_000;
export const UI_RENDER_PREVIEW_TIMEOUT_MS = 60_000;
export const ASSET_RENDER_PREVIEW_TIMEOUT_MS = 120_000;
export const BROWSER_RUNTIME_COMMAND_TIMEOUT_MS = 60_000;
/**
 * IWER resolves a running hand sequence at most 28 s after dispatch, with a
 * partial result when it runs out of time. The default budget, less the
 * relay's margin, would give up first.
 */
export const HAND_SEQUENCE_COMMAND_TIMEOUT_MS = 40_000;
/** The longest `duration` (seconds) that extends a default command timeout. */
export const MAX_TIMED_COMMAND_DURATION_S = 3_600;

/** IWER replies to these only once their `duration` (seconds) has elapsed. */
const TIMED_RUNTIME_METHODS = new Set([
  'animate_to',
  'select',
  'set_hand_pose',
  'set_select_value',
]);

const BROWSER_RUNTIME_METHODS = new Set([
  'browser_interact',
  'browser_profile',
  'browser_set_muted',
  'browser_snapshot',
  'get_console_logs',
  'reload_page',
  'screenshot',
]);

export function getDefaultRuntimeCommandTimeoutMs(
  method: string,
  params?: unknown,
): number {
  if (method === 'asset_render_preview') {
    return ASSET_RENDER_PREVIEW_TIMEOUT_MS;
  }
  if (method === 'ui_render_preview') {
    return UI_RENDER_PREVIEW_TIMEOUT_MS;
  }
  if (method === 'run_sequence') {
    return HAND_SEQUENCE_COMMAND_TIMEOUT_MS;
  }
  if (TIMED_RUNTIME_METHODS.has(method)) {
    // A long fade or ramp gets the default budget on top of its duration.
    const duration = (params as { duration?: unknown } | undefined)?.duration;
    return typeof duration === 'number' && duration > 0
      ? DEFAULT_RUNTIME_COMMAND_TIMEOUT_MS +
          Math.ceil(Math.min(duration, MAX_TIMED_COMMAND_DURATION_S) * 1000)
      : DEFAULT_RUNTIME_COMMAND_TIMEOUT_MS;
  }
  return BROWSER_RUNTIME_METHODS.has(method)
    ? BROWSER_RUNTIME_COMMAND_TIMEOUT_MS
    : DEFAULT_RUNTIME_COMMAND_TIMEOUT_MS;
}

export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: string[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  not?: JsonSchema;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchema;
};

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/**
 * The error of the union member a value was evidently meant for: the only one
 * of its type, or the object shape sharing the most of its keys. A misspelt
 * key in a hand direction then reports that key, not "a supported shape".
 */
function closestShapeError(
  value: unknown,
  candidates: JsonSchema[],
  errors: unknown[],
): unknown {
  const kind = describeValue(value);
  const sameKind = candidates
    .map((candidate, index) => ({ candidate, error: errors[index] }))
    .filter(
      ({ candidate }) =>
        candidate.type == null ||
        candidate.type === kind ||
        (candidate.type === 'integer' && kind === 'number'),
    );
  if (sameKind.length === 1) {
    return sameKind[0].error;
  }
  if (!isRecord(value)) {
    return null;
  }
  const keys = Object.keys(value);
  let best: (typeof sameKind)[number] | null = null;
  let bestScore = 0;
  let tied = false;
  for (const entry of sameKind) {
    const score = keys.filter(
      (key) => entry.candidate.properties?.[key] != null,
    ).length;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  return best && !tied ? best.error : null;
}

function assertSchemaValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
): void {
  if (schema.oneOf?.length) {
    const matches = schema.oneOf.filter((candidate) => {
      try {
        assertSchemaValue(value, candidate, path);
        return true;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) {
      throw new Error(`${path} must match exactly one supported shape`);
    }
  }
  if (schema.anyOf?.length) {
    const errors: unknown[] = [];
    const matches = schema.anyOf.some((candidate) => {
      try {
        assertSchemaValue(value, candidate, path);
        return true;
      } catch (error) {
        errors.push(error);
        return false;
      }
    });
    if (!matches) {
      throw (
        closestShapeError(value, schema.anyOf, errors) ??
        new Error(`${path} must match a supported shape`)
      );
    }
  }
  if (schema.not) {
    let matchesDisallowedSchema = true;
    try {
      assertSchemaValue(value, schema.not, path);
    } catch {
      matchesDisallowedSchema = false;
    }
    if (matchesDisallowedSchema) {
      throw new Error(`${path} uses a disallowed value`);
    }
  }

  const typeMatches =
    schema.type == null ||
    (schema.type === 'null' && value === null) ||
    (schema.type === 'array' && Array.isArray(value)) ||
    (schema.type === 'object' && isRecord(value)) ||
    (schema.type === 'integer' && Number.isInteger(value)) ||
    (schema.type === 'number' &&
      typeof value === 'number' &&
      Number.isFinite(value)) ||
    (schema.type === 'string' && typeof value === 'string') ||
    (schema.type === 'boolean' && typeof value === 'boolean');
  if (!typeMatches) {
    throw new Error(
      `${path} must be ${schema.type}; received ${describeValue(value)}`,
    );
  }

  if (schema.enum && !schema.enum.includes(value as string)) {
    throw new Error(`${path} must be one of: ${schema.enum.join(', ')}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) {
      throw new Error(`${path} must be at least ${schema.minimum}`);
    }
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) {
      throw new Error(
        `${path} must be greater than ${schema.exclusiveMinimum}`,
      );
    }
    if (schema.maximum != null && value > schema.maximum) {
      throw new Error(`${path} must be at most ${schema.maximum}`);
    }
  }
  if (typeof value === 'string') {
    if (schema.maxLength != null && value.length > schema.maxLength) {
      throw new Error(`${path} allows at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      throw new Error(`${path} must match ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      throw new Error(`${path} requires at least ${schema.minItems} items`);
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      throw new Error(`${path} allows at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((entry, index) =>
        assertSchemaValue(entry, schema.items!, `${path}[${index}]`),
      );
    }
  }
  if (isRecord(value)) {
    const properties = schema.properties;
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        throw new Error(`${path}.${required} is required`);
      }
    }
    for (const [name, entry] of Object.entries(value)) {
      const propertySchema = properties?.[name];
      if (propertySchema) {
        assertSchemaValue(entry, propertySchema, `${path}.${name}`);
      } else if (!properties || schema.additionalProperties === true) {
        continue;
      } else if (typeof schema.additionalProperties === 'object') {
        assertSchemaValue(
          entry,
          schema.additionalProperties,
          `${path}.${name}`,
        );
      } else {
        const allowed = Object.keys(properties);
        throw new Error(
          `${path} has unknown parameter "${name}"${
            allowed.length ? `; allowed: ${allowed.join(', ')}` : ''
          }`,
        );
      }
    }
  }
}

export interface McpConfigTarget {
  file: string;
  jsonKey: string | null;
  format: 'json' | 'toml' | 'opencode';
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface RuntimeOperationDefinition {
  id: string;
  domain: string;
  action: string;
  cliPath: [string, string] | string[];
  mcpName: string;
  wsMethod: string;
  target?: RuntimePageTarget;
  execution: 'server' | 'host' | 'runtime';
  physical: boolean;
  description: string;
  inputSchema: JsonSchema;
}

export type RuntimePageRole = 'app' | 'editor' | 'preview';
export type RuntimeDeviceClass = 'managed' | 'physical';

export interface RuntimePageTarget {
  role?: RuntimePageRole;
  deviceClass?: RuntimeDeviceClass;
  pageId?: string;
  tabGeneration?: number;
  sceneSessionId?: string;
  headsetId?: string;
  browserEpoch?: number;
  sessionId?: string;
}

export const IWSDK_PROJECT_STATE_DIR = '.iwsdk';
export const IWSDK_RUNTIME_STATE_DIR = '.iwsdk/runtime';
export const IWSDK_RUNTIME_LOGS_DIR = '.iwsdk/runtime/logs';
export const IWSDK_RUNTIME_SESSION_PATH = '.iwsdk/runtime/session.json';
export const IWSDK_RUNTIME_LAUNCH_PATH = '.iwsdk/runtime/launch.json';
export const IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH =
  '.iwsdk/runtime/command-credential.json';
export const IWSDK_RUNTIME_STATE_SCHEMA_VERSION = 2;
export const IWSDK_RUNTIME_BROWSER_READY_SCHEMA_VERSION = 2;
export const INTERNAL_BROWSER_PROBE_METHOD = '__iwsdk_browser_probe';
export const INTERNAL_RUNTIME_SHUTDOWN_METHOD = '__iwsdk_runtime_shutdown';
export const INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV = 'IWSDK_DEV_LAUNCH_CLAIM_ID';

export type RuntimeIssueCause =
  | 'browser_not_ready'
  | 'browser_not_launched'
  | 'browser_launch_failed'
  | 'connection_lost'
  | 'permission_denied'
  | 'browser_relaunched'
  | 'tab_throttled'
  | 'open_failed';

export interface RuntimeIssueInfo {
  cause: RuntimeIssueCause;
  message: string;
  at: string;
}

export type RuntimeBrowserStatus =
  | 'not_launched'
  | 'launching'
  | 'waiting_for_connection'
  | 'connected'
  | 'disconnected'
  | 'launch_failed';

export interface RuntimeBrowserClient {
  pageId: string;
  role: RuntimePageRole;
  deviceClass: RuntimeDeviceClass;
  tabGeneration: number;
  commandReady: boolean;
  sceneSessionId?: string;
  headsetId?: string;
  browserEpoch?: number;
  sessionId?: string;
}

export interface RuntimeBrowserLifecycle {
  state: 'idle' | 'launching' | 'running' | 'closing' | 'failed' | 'stopped';
  policy: 'disabled' | 'eager';
  sessionId: string;
  browserEpoch: number;
  revision: number;
  stateEnteredAt: string;
  lastObservedAt: string;
  attemptId?: string;
  phase?: 'installing' | 'starting';
  deadline?: string;
  cleanupConfirmed?: boolean;
  issueAt?: string;
  issueCause?: RuntimeIssueCause;
  historyTruncated?: boolean;
  attemptLimit?: number;
  failures: number;
  retryEligible: boolean;
  nextAction: string;
  issue?: string;
  history: Array<{
    revision: number;
    state: RuntimeBrowserLifecycle['state'];
    at: string;
    reason: string;
  }>;
}

export interface RuntimeBrowserState {
  lifecycle?: RuntimeBrowserLifecycle;
  status: RuntimeBrowserStatus;
  connected: boolean;
  commandReady: boolean;
  connectedClientCount: number;
  clients?: RuntimeBrowserClient[];
  lastTransitionAt: string;
  lastBridgeConnectedAt?: string;
  lastCommandReadyAt?: string;
  lastError?: RuntimeIssueInfo;
  /** Dev-session tab mute state; it survives reloads and browser relaunches. */
  audioMuted?: boolean;
}

export interface RuntimeBrowserProbeResult {
  bridgeConnected: boolean;
  commandReady: boolean;
  waitedForBridgeMs: number;
  browser: RuntimeBrowserState;
}

export interface RuntimeSession {
  schemaVersion: number;
  sessionId: string;
  workspaceRoot: string;
  pid: number;
  processStart?: string | null;
  port: number;
  localUrl: string;
  networkUrls: string[];
  aiMode?: string;
  browser?: RuntimeBrowserState;
  browserAutomation?: {
    configured: boolean;
    enabled: boolean;
    endpoint?: string;
    protocol: 'cdp';
    targetId?: string;
  };
  registeredAt: string;
  updatedAt: string;
}

/**
 * Authorizes runtime commands on `/__iwer_mcp` for one dev-server session. It
 * is kept out of session.json, so status output never carries it.
 */
export interface RuntimeCommandCredential {
  schemaVersion: number;
  sessionId: string;
  commandToken: string;
}

export interface LaunchMetadata {
  schemaVersion: number;
  /** Unique owner token for compare-and-clear startup coordination. */
  claimId?: string;
  /** Distinguishes an interruptible startup claim from a running child. */
  phase?: 'starting' | 'running';
  workspaceRoot: string;
  pid: number;
  processStart?: string | null;
  /** Package-manager shim initially spawned by the CLI. */
  launcherPid?: number;
  /** Detached POSIX process group used to stop the complete dev subprocess tree. */
  processGroupId?: number;
  command: string;
  args: string[];
  logPath: string | null;
  scriptName: string;
  port: number | null;
  openBrowser: boolean;
  createdAt: string;
}

export interface WorkspaceRuntimeState {
  workspaceRoot: string;
  running: boolean;
  starting: boolean;
  browserConnected: boolean;
  browserCommandReady: boolean;
  browserIssue?: RuntimeIssueInfo;
  session: RuntimeSession | null;
  launch: LaunchMetadata | null;
}

type RuntimeBrowserStatusSession = Pick<
  RuntimeSession,
  'schemaVersion' | 'browser'
>;

export function hasRuntimeBrowserCommandReadyContract(
  session: RuntimeBrowserStatusSession | null | undefined,
): boolean {
  if (!session?.browser) {
    return false;
  }

  return (
    session.schemaVersion >= IWSDK_RUNTIME_BROWSER_READY_SCHEMA_VERSION ||
    typeof session.browser.commandReady === 'boolean'
  );
}

export function isRuntimeBrowserCommandReady(
  session: RuntimeBrowserStatusSession | null | undefined,
): boolean {
  if (!session?.browser) {
    return false;
  }

  if (!hasRuntimeBrowserCommandReadyContract(session)) {
    return session.browser.connected;
  }

  return session.browser.commandReady === true;
}

export const SUPPORTED_AI_TOOLS: AiTool[] = [
  'claude',
  'cursor',
  'copilot',
  'codex',
  'opencode',
];

export const MCP_CONFIG_TARGETS: Record<AiTool, McpConfigTarget> = {
  claude: { file: '.mcp.json', jsonKey: 'mcpServers', format: 'json' },
  cursor: { file: '.cursor/mcp.json', jsonKey: 'mcpServers', format: 'json' },
  copilot: { file: '.vscode/mcp.json', jsonKey: 'servers', format: 'json' },
  codex: { file: '.codex/config.toml', jsonKey: null, format: 'toml' },
  opencode: { file: 'opencode.json', jsonKey: 'mcp', format: 'opencode' },
};

const VECTOR3_SCHEMA: JsonSchema = {
  type: 'array',
  items: { type: 'number' },
  description: '[x, y, z] in meters or degrees depending on the field',
};

const SCENE_TRANSFORM_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Scene node transform. position is meters, rotationDeg is Euler degrees, scale is a scalar or [x,y,z].',
  properties: {
    position: VECTOR3_SCHEMA,
    rotationDeg: VECTOR3_SCHEMA,
    scale: {
      oneOf: [{ type: 'number' }, VECTOR3_SCHEMA],
      description: 'Uniform scale number or non-uniform [x, y, z] scale',
    },
  },
};

const SCENE_CONSTRAINTS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lookAt: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: VECTOR3_SCHEMA,
        mode: {
          type: 'string',
          enum: ['yaw-v1'],
        },
      },
      required: ['target', 'mode'],
    },
  },
};

const SCENE_CONTENT_SCHEMA: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: { type: { type: 'string', enum: ['group'] } },
      required: ['type'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['asset'] },
        asset: { type: 'string' },
        castShadow: { type: 'boolean' },
        receiveShadow: { type: 'boolean' },
      },
      required: ['type', 'asset'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['instance'] },
        prefab: { type: 'string' },
        overrides: { type: 'object' },
      },
      required: ['type', 'prefab'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['pattern'] },
        prefab: { type: 'string' },
        distribution: { type: 'object' },
        overrides: { type: 'object' },
      },
      required: ['type', 'prefab', 'distribution'],
    },
  ],
};

const SCENE_NODE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Scene node. Content is discriminated as group, asset, instance, or pattern. Renderable assets, including procedural geometry, are declared in the asset manifest; behavior capabilities such as lights are components.',
  properties: {
    id: { type: 'string', description: 'Stable scene node id.' },
    name: { type: 'string', description: 'Optional display name.' },
    framingRole: {
      type: 'string',
      enum: ['content', 'support'],
      description:
        'Camera-framing role. Omission behaves as content; support remains rendered but is excluded from content framing.',
    },
    content: SCENE_CONTENT_SCHEMA,
    transform: SCENE_TRANSFORM_SCHEMA,
    constraints: SCENE_CONSTRAINTS_SCHEMA,
    components: {
      type: 'object',
      description:
        'Optional native scene component values keyed by component id.',
    },
    children: {
      type: 'array',
      items: { type: 'object' },
      description: 'Optional nested scene nodes.',
    },
    metadata: { type: 'object' },
  },
  required: ['id'],
};

const SCENE_CAMERA_VIEW_SCHEMA: JsonSchema = {
  type: 'string',
  enum: [
    'current',
    'top',
    'front',
    'back',
    'left',
    'right',
    'quarter',
    'orbit',
  ],
  description:
    'Named editor camera view. "current" preserves the active camera.',
};

const SCENE_CAMERA_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    viewId: {
      type: 'string',
      description:
        'Stable id of an exact perspective or orthographic view declared in document.authoring.views.',
    },
    view: SCENE_CAMERA_VIEW_SCHEMA,
    orbitStep: {
      type: 'number',
      description:
        'Deterministic 45-degree orbit step when view is "orbit" (0-7 wrap around; negative values are allowed).',
    },
    step: {
      type: 'number',
      description: 'Alias for orbitStep when view is "orbit".',
    },
    position: VECTOR3_SCHEMA,
    lookAt: VECTOR3_SCHEMA,
    fov: {
      type: 'number',
      minimum: 1,
      maximum: 179,
      description: 'Vertical field of view in degrees',
    },
    projection: {
      type: 'string',
      enum: ['perspective', 'orthographic'],
      description:
        'Projection for an explicit camera pose. Named built-in views are perspective; saved viewId projections come from the document.',
    },
    orthographicHeight: {
      type: 'number',
      exclusiveMinimum: 0,
      description:
        'Vertical world-space span for an explicit orthographic camera. Kept distinct from screenshot pixel height.',
    },
  },
};

const SCENE_HASH_SCHEMA: JsonSchema = {
  type: 'string',
  pattern: '^sha256:[0-9a-f]{64}$',
  description: 'Canonical sha256:<64 lowercase hex> content hash.',
};

const SCENE_DOCUMENT_INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'Complete closed iwsdk.scene.v1 document. Validate against the exported normative scene schema before sending.',
};

const SCENE_REVIEW_INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Complete closed iwsdk.scene-review.v1 record. Server validation binds hashes, capabilities, required views, lenses, criteria, correction lineage, and persisted capture evidence to the active scene. Waivers are representable but cannot be persisted without a trusted user-approval artifact.',
  required: [
    'version',
    'documentHash',
    'runtimeHash',
    'capabilityHash',
    'sourceHashes',
    'round',
    'result',
    'lenses',
    'featureResults',
    'waivers',
    'stop',
  ],
  properties: {
    version: { type: 'string', enum: ['iwsdk.scene-review.v1'] },
    documentHash: SCENE_HASH_SCHEMA,
    runtimeHash: SCENE_HASH_SCHEMA,
    capabilityHash: SCENE_HASH_SCHEMA,
    sourceHashes: { type: 'array', items: SCENE_HASH_SCHEMA },
    round: { type: 'integer', minimum: 0, maximum: 10 },
    previousReview: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        reviewSha256: SCENE_HASH_SCHEMA,
      },
      required: ['path', 'reviewSha256'],
    },
    correction: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        correctionSha256: SCENE_HASH_SCHEMA,
      },
      required: ['path', 'correctionSha256'],
    },
    result: {
      type: 'string',
      enum: ['pass', 'accepted-with-gaps', 'fail'],
    },
    lenses: { type: 'array', items: { type: 'object' } },
    featureResults: { type: 'array', items: { type: 'object' } },
    waivers: { type: 'array', items: { type: 'object' } },
    stop: { type: 'object' },
  },
};

const SCENE_REVIEW_CAMERA_INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projection: {
      type: 'string',
      enum: ['perspective', 'orthographic'],
    },
    position: VECTOR3_SCHEMA,
    target: VECTOR3_SCHEMA,
    fov: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
  },
  required: ['projection', 'position', 'target'],
};

const SCENE_BATCH_REVIEW_CAPTURE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'One compact persisted capture entry returned by scene_capture_review_set.',
  properties: {
    lens: {
      type: 'string',
      enum: ['layout', 'geometry', 'final'],
    },
    id: { type: 'string' },
    view: { type: 'string' },
    path: { type: 'string' },
    screenshotSha256: SCENE_HASH_SCHEMA,
    width: { type: 'integer', minimum: 1, maximum: 4096 },
    height: { type: 'integer', minimum: 1, maximum: 4096 },
    camera: SCENE_REVIEW_CAMERA_INPUT_SCHEMA,
    rendererEnvironment: { type: 'object' },
    visibleNodeIds: { type: 'array', items: { type: 'string' } },
    nodeMaskRegions: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'number' },
        minItems: 4,
        maxItems: 4,
      },
    },
  },
  required: [
    'lens',
    'id',
    'view',
    'path',
    'screenshotSha256',
    'width',
    'height',
    'camera',
    'rendererEnvironment',
    'visibleNodeIds',
  ],
};

const SCENE_REVIEW_EVIDENCE_LINK_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: {
      type: 'string',
      description: 'Exact workspace-relative immutable artifact path.',
    },
    sha256: SCENE_HASH_SCHEMA,
  },
  required: ['path', 'sha256'],
};

const SCENE_OBJECT_INSPECTION_ASSESSMENT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      description:
        'Exact declared criterion text, or exact part/contact id, from objectInspection.',
    },
    status: { type: 'string', enum: ['pass', 'fail'] },
    evidenceRefs: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Capture ids from the supplied persisted capture set.',
    },
    observation: {
      type: 'string',
      pattern: '\\S',
      description:
        'Concrete visual observation explaining the status against the declared criterion.',
    },
  },
  required: ['id', 'status', 'evidenceRefs', 'observation'],
};

// =============================================================================
// Emulated device shapes
// =============================================================================
// The xr_* schemas mirror IWER's extension-bridge contract and its JSON Schema
// catalog (`iwer/lib/remote/catalog.js`): the same parameters, unions and
// descriptions. vite-plugin-dev's tests compare them with the catalog of the
// IWER it installs.

const XR_POSITION_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'A 3D position in metres, XR-origin relative.',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
  },
  required: ['x', 'y', 'z'],
};

const XR_STRICT_POSITION_SCHEMA: JsonSchema = {
  ...XR_POSITION_SCHEMA,
  additionalProperties: false,
};

const XR_TUPLE3_SCHEMA: JsonSchema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
};

const XR_QUATERNION_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', description: 'Quaternion X component' },
    y: { type: 'number', description: 'Quaternion Y component' },
    z: { type: 'number', description: 'Quaternion Z component' },
    w: { type: 'number', description: 'Quaternion W component' },
  },
  required: ['x', 'y', 'z', 'w'],
};

const XR_EULER_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pitch: { type: 'number', description: 'Pitch in degrees (X rotation)' },
    yaw: { type: 'number', description: 'Yaw in degrees (Y rotation)' },
    roll: { type: 'number', description: 'Roll in degrees (Z rotation)' },
  },
};

const XR_ORIENTATION_SCHEMA: JsonSchema = {
  anyOf: [XR_QUATERNION_SCHEMA, XR_EULER_SCHEMA],
  description:
    'Orientation as a quaternion {x,y,z,w} or euler degrees {pitch,yaw,roll}.',
};

const XR_DIRECTION_SCHEMA: JsonSchema = {
  anyOf: [
    {
      type: 'string',
      enum: [
        'up',
        'down',
        'forward',
        'back',
        'left',
        'right',
        'toward-head',
        'away-from-head',
      ],
    },
    XR_STRICT_POSITION_SCHEMA,
    XR_TUPLE3_SCHEMA,
  ],
  description:
    'A direction: a name (up, down, forward, back, left, right, toward-head, away-from-head; forward/left/right follow where the headset faces) or an XR-origin vector (approximate is fine).',
};

// Hand directions come before quaternion/euler and every orientation object
// is strict, so a misspelt hand direction is an error, not an empty euler.
const XR_HAND_DIRECTIONS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Hand orientation by direction: where the fingers point plus where the palm faces OR where the thumb side points. A thumbs up is {fingers:"forward", thumb:"up"}.',
  properties: {
    fingers: XR_DIRECTION_SCHEMA,
    palm: XR_DIRECTION_SCHEMA,
    thumb: XR_DIRECTION_SCHEMA,
  },
  required: ['fingers'],
};

const XR_PLACEMENT_ORIENTATION_SCHEMA: JsonSchema = {
  anyOf: [
    { type: 'string', enum: ['auto'] },
    XR_HAND_DIRECTIONS_SCHEMA,
    XR_QUATERNION_SCHEMA,
    XR_EULER_SCHEMA,
  ],
  description:
    'For hands: {fingers, palm|thumb} directions, or "auto" (a natural reach from the shoulder toward the position). A quaternion {x,y,z,w} or euler degrees {pitch,yaw,roll} sets the device (for hands, the target ray) as before.',
};

const XR_HAND_ANCHOR_SCHEMA: JsonSchema = {
  type: 'string',
  description:
    'Hands: the point of the hand `position` places and keeps there while the hand changes shape: index-tip (press), grasp (where thumb and index tips meet in a full pinch), wrist (gestures), grip, thumb-tip, target-ray (default), or a WebXR joint name.',
};

const XR_EASING_SCHEMA: JsonSchema = {
  type: 'string',
  enum: ['linear', 'minimum-jerk'],
  description: 'Time curve; minimum-jerk starts and stops like a human reach.',
};

const XR_HAND_DEVICE_SCHEMA: JsonSchema = {
  type: 'string',
  enum: ['hand-left', 'hand-right'],
  description: 'A hand-tracking device.',
};

// One short gloss per built-in IWER hand pose, for xr_set_hand_pose. Keep in
// sync with IWER's BUILTIN_HAND_POSE_IDS (checked by vite-plugin-dev's tests).
export const XR_HAND_POSE_GLOSS: Readonly<Record<string, string>> = {
  default: 'relaxed',
  pinch: 'thumb and index touching',
  point: 'index extended',
  open: 'high five',
  flat: 'fingers together, blade',
  fist: 'closed fist',
  'thumbs-up': 'fist with thumb up',
  'finger-gun': 'index and thumb out',
  peace: 'V sign',
  three: 'index, middle, ring up',
  four: 'four fingers up, thumb folded',
  ok: 'thumb-index circle',
  rock: 'index and pinky out',
  call: 'thumb and pinky out',
  'pinch-middle': 'thumb to middle tip',
  'pinch-ring': 'thumb to ring tip',
  'pinch-pinky': 'thumb to pinky tip',
  tripod: 'thumb, index, middle tips together',
  'key-pinch': 'thumb against side of index',
  microgesture: 'loose curl, thumb by the side of the index',
  grip: 'wrapped around a handle',
  claw: 'holding a ball',
  hook: 'carrying a bag handle',
  cup: 'scooping water',
};

const XR_HAND_POSE_GLOSSES = Object.entries(XR_HAND_POSE_GLOSS)
  .map(([id, gloss]) => `${id} (${gloss})`)
  .join(', ');

const XR_FINGER_POSE_SCHEMA: JsonSchema = {
  anyOf: [
    { type: 'string' },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        poseId: { type: 'string' },
        weight: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['poseId'],
    },
  ],
  description:
    'A pose id, or {poseId, weight} where weight 0-1 blends from the base pose toward it.',
};

const XR_FINGER_POSES_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Fingers to take from other poses, on top of poseId.',
  properties: {
    thumb: XR_FINGER_POSE_SCHEMA,
    index: XR_FINGER_POSE_SCHEMA,
    middle: XR_FINGER_POSE_SCHEMA,
    ring: XR_FINGER_POSE_SCHEMA,
    pinky: XR_FINGER_POSE_SCHEMA,
  },
};

const XR_INPUT_STATE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    connected: { type: 'boolean' },
    position: XR_POSITION_SCHEMA,
    orientation: XR_ORIENTATION_SCHEMA,
  },
};

const XR_HAND_STATE_SCHEMA: JsonSchema = {
  ...XR_INPUT_STATE_SCHEMA,
  properties: {
    ...XR_INPUT_STATE_SCHEMA.properties,
    poseId: { type: 'string' },
    pinchValue: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const XR_MICROGESTURE_SCHEMA: JsonSchema = {
  type: 'string',
  enum: ['swipe-left', 'swipe-right', 'swipe-forward', 'swipe-backward', 'tap'],
  description:
    "A thumb microgesture on the side of the curled index finger: swipe left / right (the user's), forward (over the finger), backward (toward the palm), or tap.",
};

// --- run_sequence ------------------------------------------------------------

const XR_FRACTION_SCHEMA: JsonSchema = {
  type: 'number',
  minimum: 0,
  maximum: 1,
};

const XR_TIMED_WINDOW_PROPERTIES: Record<string, JsonSchema> = {
  start: XR_FRACTION_SCHEMA,
  end: XR_FRACTION_SCHEMA,
  easing: XR_EASING_SCHEMA,
};

const XR_SEQUENCE_TARGET_SCHEMA: JsonSchema = {
  anyOf: [
    { type: 'string' },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        face: {
          type: 'string',
          enum: ['front', 'back', 'top', 'bottom', 'left', 'right'],
        },
      },
      required: ['name'],
    },
  ],
  description:
    'A target name from xr_list_targets, or {name, face}; resolved again when the step starts.',
};

const XR_SEQUENCE_POSITION_SCHEMA: JsonSchema = {
  anyOf: [
    XR_TUPLE3_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        normal: XR_DIRECTION_SCHEMA,
      },
      required: ['x', 'y', 'z'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        relativeTo: { type: 'string', enum: ['head', 'body'] },
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
      },
      required: ['relativeTo', 'x', 'y', 'z'],
    },
  ],
  description:
    'XR-origin metres (optionally with the surface normal), or {relativeTo:"head"|"body", x right, y up, z back} turning with the body, never with head pitch; "body" measures y from the floor.',
};

const XR_STAND_OFF_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    distance: { type: 'number', minimum: 0 },
    normal: XR_DIRECTION_SCHEMA,
  },
  required: ['distance'],
};

const XR_SEQUENCE_STEP_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string' },
    duration: {
      anyOf: [
        { type: 'number', minimum: 0 },
        { type: 'string', enum: ['auto'] },
      ],
      description:
        'Seconds for the reach, or "auto" (the default for moves): scaled to distance, turn and pose change.',
    },
    target: XR_SEQUENCE_TARGET_SCHEMA,
    position: XR_SEQUENCE_POSITION_SCHEMA,
    offset: {
      anyOf: [
        XR_STRICT_POSITION_SCHEMA,
        {
          type: 'object',
          additionalProperties: false,
          properties: { normal: { type: 'number' } },
          required: ['normal'],
        },
      ],
      description:
        'Added to the target or position; {normal:d} moves d metres along the surface normal. Setting a held object down: its clearance above the surface.',
    },
    approach: {
      ...XR_STAND_OFF_SCHEMA,
      description:
        'Come straight in along the surface normal (straight down while holding) for the last `distance` metres.',
    },
    depart: {
      ...XR_STAND_OFF_SCHEMA,
      description:
        'Lift straight off first, along the last surface normal (straight up while holding).',
    },
    press: {
      type: 'object',
      additionalProperties: false,
      properties: {
        depth: { type: 'number', minimum: 0, maximum: 0.015 },
        hold: { type: 'number', minimum: 0, maximum: 0.2 },
        retract: { type: 'number', minimum: 0.05 },
      },
      description:
        'Press the target with the index fingertip: reach, go `depth` m (default 0.008) past the surface, hold `hold` s, pull back `retract` m. Implies anchor index-tip and pose point. Use this for buttons, not a pinch.',
    },
    anchor: XR_HAND_ANCHOR_SCHEMA,
    orientation: XR_PLACEMENT_ORIENTATION_SCHEMA,
    poseId: {
      anyOf: [
        { type: 'string' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string' },
            ...XR_TIMED_WINDOW_PROPERTIES,
          },
          required: ['value'],
        },
      ],
      description:
        'Pose to fade to during the step; {value, start, end} as fractions of the reach. Never "pinch": poses do not select.',
    },
    fingers: XR_FINGER_POSES_SCHEMA,
    pinch: {
      anyOf: [
        XR_FRACTION_SCHEMA,
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: XR_FRACTION_SCHEMA,
            ...XR_TIMED_WINDOW_PROPERTIES,
          },
          required: ['value'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: XR_FRACTION_SCHEMA,
            at: { type: 'string', enum: ['arrival'] },
          },
          required: ['value', 'at'],
        },
      ],
      description:
        'Pinch 0..1 (selects at 0.9, lets go at 0.7). {value:1, at:"arrival"} opens to a grip and closes as the hand arrives; on a target it implies anchor grasp.',
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        position: XR_SEQUENCE_POSITION_SCHEMA,
        stepTo: XR_SEQUENCE_TARGET_SCHEMA,
        facing: XR_DIRECTION_SCHEMA,
      },
      description:
        'Move the body first: to position, or a step closer to stepTo; facing turns it. The hand goes along.',
    },
    microgesture: {
      ...XR_MICROGESTURE_SCHEMA,
      description:
        'Make a microgesture where the hand is, as a step of its own (only label alongside); events report it by name.',
    },
  },
};

const XR_RUN_SEQUENCE_DESCRIPTION =
  "Run a whole hand interaction in one call with natural motion: one smooth arc per move, the head turning to each target first, the body leaning or stepping closer when needed, the other hand resting by the hip. Steps run in order and each step's properties animate together. Positions are XR-origin metres; -Z is forward, +Y up. Resolves when done with the select events the app saw, step times, press contact times, warnings and the final hand state. " +
  'Rules: press buttons with `press`, not a pinch. To pick something up, target it with `pinch:{value:1,at:"arrival"}` (the grasp point, between thumb and index, goes on the target). While holding, targeting a surface sets the object down on it; let go with pinch 0. The anchor carries over to later steps. A thumbs up is poseId "thumbs-up" with orientation {fingers:"forward",thumb:"up"} at a head-relative position. A microgesture is a step of its own, {"microgesture":"swipe-left"}, with the hand raised in view and the pinch open (see xr_microgesture). Get names from xr_list_targets and check a plan with dryRun:true first. ' +
  'Example: {"device":"hand-right","steps":[{"label":"reach","target":"button","press":{}},{"label":"grab","target":"piece","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},{"label":"carry","target":"tray","depart":{"distance":0.08},"approach":{"distance":0.06}},{"label":"release","pinch":0,"duration":0.15},{"label":"thumbs up","position":{"relativeTo":"head","x":0.12,"y":-0.35,"z":-0.35},"anchor":"wrist","orientation":{"fingers":"forward","thumb":"up"},"poseId":"thumbs-up"},{"label":"hold","duration":1}]}';

const ALL_RUNTIME_MCP_TOOLS: McpToolDefinition[] = [
  // =============================================================================
  // Session Management
  // =============================================================================
  {
    name: 'xr_get_session_status',
    description: 'Get XR session and device status',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'xr_accept_session',
    description:
      'Accept an offered XR session (equivalent to clicking "Enter XR" button)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'xr_end_session',
    description: 'End the current active XR session',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // =============================================================================
  // Transform Control
  // =============================================================================
  {
    name: 'xr_get_transform',
    description:
      'Get position and orientation of a tracked device. Gaze reports the headset-derived origin and its world orientation.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          enum: [
            'headset',
            'controller-left',
            'controller-right',
            'hand-left',
            'hand-right',
            'gaze',
          ],
          description: 'The device to query',
        },
      },
      required: ['device'],
    },
  },
  {
    name: 'xr_set_transform',
    description:
      'Set a device position and/or orientation immediately (XR-origin). Gaze accepts orientation only; move its origin with the headset. Hands: `anchor` puts that point of the hand at `position` and keeps it there while the hand changes shape (e.g. anchor "index-tip" on a button, "grasp" on an object before pinching); orientation may be hand directions or "auto". Requires an active session.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        device: {
          type: 'string',
          enum: [
            'headset',
            'controller-left',
            'controller-right',
            'hand-left',
            'hand-right',
            'gaze',
          ],
          description: 'The device to move',
        },
        position: {
          ...XR_POSITION_SCHEMA,
          properties: {
            x: { type: 'number', description: 'X position (left/right)' },
            y: {
              type: 'number',
              description: 'Y position (up/down, 1.6 is standing height)',
            },
            z: {
              type: 'number',
              description: 'Z position (forward/back, negative is forward)',
            },
          },
        },
        orientation: XR_PLACEMENT_ORIENTATION_SCHEMA,
        anchor: XR_HAND_ANCHOR_SCHEMA,
      },
      required: ['device'],
    },
  },
  {
    name: 'xr_look_at',
    description:
      'Orient a device to look at a specific world position. Gaze keeps its headset-derived origin.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          enum: [
            'headset',
            'controller-left',
            'controller-right',
            'hand-left',
            'hand-right',
            'gaze',
          ],
          description: 'The device to orient',
        },
        target: {
          type: 'object',
          description: 'World position to look at',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
        },
        moveToDistance: {
          type: 'number',
          description:
            'Optional: move device to this distance from target (not supported for gaze)',
        },
      },
      required: ['device', 'target'],
    },
  },
  {
    name: 'xr_animate_to',
    description:
      'Animate a device to a target position and/or orientation (XR-origin) over `duration` seconds (default 0.5), from where it is when the animation starts. Gaze accepts orientation only. Hands take `anchor` and hand directions as in xr_set_transform. easing "minimum-jerk" moves like a person (default "linear"). For multi-step hand interactions (press, grab, carry, gestures) prefer xr_run_sequence. Requires an active, rendering session.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        device: {
          type: 'string',
          enum: [
            'headset',
            'controller-left',
            'controller-right',
            'hand-left',
            'hand-right',
            'gaze',
          ],
          description: 'The device to animate',
        },
        position: XR_POSITION_SCHEMA,
        orientation: XR_PLACEMENT_ORIENTATION_SCHEMA,
        duration: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Animation duration in seconds (default: 0.5)',
        },
        easing: XR_EASING_SCHEMA,
        anchor: XR_HAND_ANCHOR_SCHEMA,
      },
      required: ['device'],
    },
  },

  // =============================================================================
  // Input Mode
  // =============================================================================
  {
    name: 'xr_set_input_mode',
    description: 'Switch between controller and hand tracking input modes',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['controller', 'hand'],
          description: 'Input mode to switch to',
        },
      },
      required: ['mode'],
    },
  },
  {
    name: 'xr_set_connected',
    description: 'Connect or disconnect a controller, hand, or gaze source',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          enum: [
            'controller-left',
            'controller-right',
            'hand-left',
            'hand-right',
            'gaze',
          ],
          description: 'The input device',
        },
        connected: {
          type: 'boolean',
          description: 'Whether the device should be connected',
        },
      },
      required: ['device', 'connected'],
    },
  },

  // =============================================================================
  // Select/Trigger Input
  // =============================================================================
  {
    name: 'xr_get_select_value',
    description:
      'Get the current select (trigger/pinch) value for an input device',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          enum: [
            'controller-left',
            'controller-right',
            'hand-left',
            'hand-right',
          ],
          description: 'The input device',
        },
      },
      required: ['device'],
    },
  },
  {
    name: 'xr_set_select_value',
    description:
      'Set the select value (trigger/pinch), 0..1, optionally ramping from the current value over `duration` seconds (easing default minimum-jerk). A hand pinch selects at 0.9 and lets go at 0.7; a trigger selects above 0. Use xr_select for a full press+release.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        device: {
          type: 'string',
          enum: [
            'controller-left',
            'controller-right',
            'hand-left',
            'hand-right',
          ],
          description: 'The input device',
        },
        value: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Select value (0=released, 1=fully pressed/pinched)',
        },
        duration: {
          type: 'number',
          minimum: 0,
          description: 'Seconds to ramp from the current value (default: 0)',
        },
        easing: XR_EASING_SCHEMA,
      },
      required: ['device', 'value'],
    },
  },
  {
    name: 'xr_select',
    description:
      'Perform a full select gesture: selectstart on press, then select and selectend on release, holding `duration` seconds (default 0.15). A hand closes its pinch over 0.1 s before the hold and opens it over 0.1 s after. Requires an active session.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          enum: [
            'controller-left',
            'controller-right',
            'hand-left',
            'hand-right',
          ],
          description: 'The input device',
        },
        duration: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'How long to hold in seconds (default: 0.15)',
        },
      },
      required: ['device'],
    },
  },

  // =============================================================================
  // Gamepad State (Controllers only)
  // =============================================================================
  {
    name: 'xr_get_gamepad_state',
    description:
      'Get full gamepad state including all buttons and axes. Button indices in the result: 0=trigger, 1=squeeze, 2=thumbstick, 3=A/X, 4=B/Y, 5=thumbrest.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          enum: ['controller-left', 'controller-right'],
          description: 'The controller',
        },
      },
      required: ['device'],
    },
  },
  {
    name: 'xr_set_gamepad_state',
    description: 'Set gamepad button and axis values by index',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          enum: ['controller-left', 'controller-right'],
          description: 'The controller',
        },
        buttons: {
          type: 'array',
          description: 'Button states to set',
          items: {
            type: 'object',
            properties: {
              index: {
                type: 'number',
                description:
                  'Button index (0=trigger, 1=squeeze, 2=thumbstick, 3=A/X, 4=B/Y, 5=thumbrest)',
              },
              value: { type: 'number', description: 'Button value 0-1' },
              touched: {
                type: 'boolean',
                description: 'Whether button is touched',
              },
            },
            required: ['index', 'value'],
          },
        },
        axes: {
          type: 'array',
          description: 'Axis values to set',
          items: {
            type: 'object',
            properties: {
              index: {
                type: 'number',
                description: 'Axis index (0=thumbstick X, 1=thumbstick Y)',
              },
              value: { type: 'number', description: 'Axis value -1 to 1' },
            },
            required: ['index', 'value'],
          },
        },
      },
      required: ['device'],
    },
  },

  // =============================================================================
  // Screenshot
  // =============================================================================
  {
    name: 'browser_screenshot',
    description:
      'Capture the current application in the managed browser, persist the image locally, and return screenshotPath with capture metadata. The application surface is resolved automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description: 'Image format. Defaults to png.',
        },
        quality: {
          type: 'number',
          minimum: 20,
          maximum: 100,
          description: 'JPEG quality. Ignored for PNG.',
        },
        fullPage: {
          type: 'boolean',
          description:
            'Capture the full application document when it fits the bounded 32-megapixel and 64-tile limits.',
        },
        ref: {
          type: 'string',
          description:
            'Capture one fully visible element ref returned by browser_snapshot. Targets larger than the application viewport are rejected as non-retryable.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_snapshot',
    description:
      'Inspect the current application as a compact accessibility-first list of interactive elements and canvas regions. Use returned refs with browser_interact.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxNodes: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          description: 'Maximum returned elements. Defaults to 200.',
        },
        maxTextLength: {
          type: 'integer',
          minimum: 16,
          maximum: 1000,
          description: 'Maximum text/name length per element. Defaults to 200.',
        },
        rootRef: {
          type: 'string',
          description: 'Optional existing ref used as the snapshot root.',
        },
      },
    },
  },
  {
    name: 'browser_interact',
    description:
      'Perform up to 10 trusted Playwright actions against the current application. Prefer refs from browser_snapshot; use coordinates for canvas input. Hold keys within one batch with keyDown, wait, and keyUp; keyDown and keyUp focus an optional ref or locator, and any held keys are released when the batch ends. This tool does not navigate to arbitrary URLs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        timeoutMs: {
          type: 'integer',
          minimum: 100,
          maximum: 12000,
          description:
            'Total timeout budget for the complete batch. Defaults to 10000 and is capped at 12000 so workspace restoration completes before the host command deadline.',
        },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: {
                type: 'string',
                enum: [
                  'click',
                  'doubleClick',
                  'hover',
                  'pointerMove',
                  'pointerDown',
                  'pointerUp',
                  'wheel',
                  'fill',
                  'type',
                  'clear',
                  'press',
                  'keyDown',
                  'keyUp',
                  'check',
                  'uncheck',
                  'select',
                  'scroll',
                  'drag',
                  'wait',
                ],
              },
              ref: { type: 'string' },
              targetRef: { type: 'string' },
              locator: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  role: { type: 'string' },
                  name: { type: 'string' },
                  testId: { type: 'string' },
                  text: { type: 'string' },
                },
              },
              targetLocator: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  role: { type: 'string' },
                  name: { type: 'string' },
                  testId: { type: 'string' },
                  text: { type: 'string' },
                },
              },
              point: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  canvasRef: { type: 'string' },
                },
                required: ['x', 'y'],
              },
              targetPoint: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  canvasRef: { type: 'string' },
                },
                required: ['x', 'y'],
              },
              button: {
                type: 'string',
                enum: ['left', 'middle', 'right'],
              },
              key: {
                type: 'string',
                maxLength: 100,
                description:
                  'Keyboard key for press, keyDown, or keyUp. Keys held by keyDown are scoped to this batch and released automatically at the end.',
              },
              durationMs: {
                type: 'integer',
                minimum: 0,
                maximum: 12000,
                description:
                  'For wait, pause for this duration within the batch timeout.',
              },
              value: { type: 'string' },
              values: { type: 'array', items: { type: 'string' } },
              text: { type: 'string' },
              path: {
                type: 'string',
                description:
                  'For wait, the expected application pathname, search, and hash.',
              },
              loadState: {
                type: 'string',
                enum: ['domcontentloaded', 'load', 'networkidle'],
                description: 'For wait, the application load state to await.',
              },
              state: {
                type: 'string',
                enum: [
                  'attached',
                  'checked',
                  'detached',
                  'disabled',
                  'editable',
                  'enabled',
                  'focused',
                  'hidden',
                  'unchecked',
                  'visible',
                ],
              },
              deltaX: { type: 'number' },
              deltaY: { type: 'number' },
              timeoutMs: {
                type: 'integer',
                minimum: 100,
                maximum: 12000,
              },
            },
            required: ['action'],
          },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'browser_profile',
    description:
      'Start, stop, or inspect a bounded uncalibrated desktop-browser performance profile for the current application.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'status', 'stop'],
        },
        mode: {
          type: 'string',
          enum: ['interaction', 'rendering', 'trace'],
          description: 'Profile mode used when action is start.',
        },
        maxDurationMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 60000,
          description: 'Safety auto-stop duration. Defaults to 30000.',
        },
        profileId: {
          type: 'string',
          description: 'Optional profile ID precondition for stop.',
        },
      },
      required: ['action'],
    },
  },

  // =============================================================================
  // Device State
  // =============================================================================
  {
    name: 'xr_get_device_state',
    description:
      'Get a full snapshot: headset pose, input mode, controllers, hands (with poseId and pinchValue), gaze, stereo, and FOV. Positions are XR-origin relative.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'xr_set_device_state',
    description:
      'Apply a partial device state (positions XR-origin; hands also take poseId and pinchValue). Call with no `state` to reset everything to defaults.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: {
          type: 'object',
          additionalProperties: false,
          description:
            'Partial device state to apply. Omit to reset to defaults.',
          properties: {
            headset: {
              type: 'object',
              additionalProperties: false,
              description: 'Headset transform',
              properties: {
                position: XR_POSITION_SCHEMA,
                orientation: XR_ORIENTATION_SCHEMA,
              },
            },
            inputMode: {
              type: 'string',
              enum: ['controller', 'hand'],
              description: 'Input mode',
            },
            stereoEnabled: {
              type: 'boolean',
              description: 'Whether stereo rendering is enabled',
            },
            fov: {
              type: 'number',
              description: 'Field of view in degrees',
            },
            controllers: {
              type: 'object',
              additionalProperties: false,
              description: 'Controller states',
              properties: {
                left: XR_INPUT_STATE_SCHEMA,
                right: XR_INPUT_STATE_SCHEMA,
              },
            },
            hands: {
              type: 'object',
              additionalProperties: false,
              description: 'Hand states, including poseId and pinchValue',
              properties: {
                left: XR_HAND_STATE_SCHEMA,
                right: XR_HAND_STATE_SCHEMA,
              },
            },
            gaze: {
              type: 'object',
              additionalProperties: false,
              description:
                'Gaze state. Its origin is derived from the headset and cannot be set independently.',
              properties: {
                connected: { type: 'boolean' },
                orientation: XR_ORIENTATION_SCHEMA,
              },
            },
          },
        },
      },
    },
  },

  // =============================================================================
  // Hands
  // =============================================================================
  {
    name: 'xr_set_hand_pose',
    description:
      `Set a named hand pose on a hand device. Poses only shape the hand; to pinch (select), use the pinch value (xr_set_select_value). Poses: ${XR_HAND_POSE_GLOSSES}. ` +
      'Optionally take individual fingers from other poses, e.g. poseId "open" with fingers {"middle":"fist","ring":"fist","pinky":"fist"}, or blend partway with {"poseId":"fist","weight":0.5}. Setting a pose clears earlier finger overrides. `duration` fades from the hand as shown (easing default minimum-jerk); a hand placed by an anchor keeps the anchor in place.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        device: XR_HAND_DEVICE_SCHEMA,
        poseId: { type: 'string' },
        fingers: XR_FINGER_POSES_SCHEMA,
        duration: { type: 'number', minimum: 0 },
        easing: XR_EASING_SCHEMA,
      },
      required: ['device', 'poseId'],
    },
  },
  {
    name: 'xr_microgesture',
    description:
      'Swipe or tap the thumb on the side of the curled index finger, as on Quest. The app sees the hand gamepad (xr-standard) button pressed for 35 ms when the gesture completes: 5 swipe-left, 6 swipe-right, 7 swipe-forward, 8 swipe-backward, 9 tap; no select events. A hand not in the "microgesture" pose takes it first (0.25 s); a hand that is selecting must let go first. Raise the hand side-on in view first, e.g. xr_set_transform with anchor "wrist" and orientation {fingers:[0,-0.6,-0.8],palm:"left"} (right hand; "right" for the left). Requires an active session and hand input.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        device: XR_HAND_DEVICE_SCHEMA,
        gesture: XR_MICROGESTURE_SCHEMA,
      },
      required: ['device', 'gesture'],
    },
  },
  {
    name: 'xr_get_hand_state',
    description:
      'Read a hand: pose, finger blends, a pose fade in progress, pinch value, whether select is pressed, its anchor pin, and XR-origin positions of the wrist, grip, grasp point, index tip and thumb tip, plus its finger/palm/thumb directions (joints:"all" adds every joint).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        device: XR_HAND_DEVICE_SCHEMA,
        joints: { type: 'string', enum: ['key', 'all'] },
      },
      required: ['device'],
    },
  },
  {
    name: 'xr_run_sequence',
    description: XR_RUN_SEQUENCE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        device: XR_HAND_DEVICE_SCHEMA,
        steps: {
          type: 'array',
          items: XR_SEQUENCE_STEP_SCHEMA,
          minItems: 1,
        },
        idleHand: {
          type: 'string',
          enum: ['keep', 'rest'],
          description:
            'The other hand: rest it by the hip (the default unless it is pinching) or keep it where it is.',
        },
        body: {
          type: 'string',
          enum: ['auto', 'fixed'],
          description:
            'auto (default): lean for low targets and step closer to ones out of reach. fixed: out of reach is an error.',
        },
        gaze: {
          type: 'string',
          enum: ['follow', 'fixed'],
          description:
            'follow (default): the head turns to each target before the hand gets there.',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Validate and return the planned steps, walks, durations and warnings without moving anything.',
        },
      },
      required: ['device', 'steps'],
    },
  },
  {
    name: 'xr_cancel_sequence',
    description:
      'Stop the running xr_run_sequence where it is; that call returns with cancelled: true and the steps done. The pinch is left as it is (no select events).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    name: 'xr_list_targets',
    description:
      "List the named targets xr_run_sequence steps can use, from the page's target resolver: name, box centre and size (XR-origin). resolver:false means the page has none; use positions.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },

  // =============================================================================
  // Console Logs (Plugin-specific, not in IWER)
  // =============================================================================
  {
    name: 'browser_get_console_logs',
    description:
      'Get console logs from the browser with optional filtering. By default excludes debug level logs.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          minimum: 1,
          maximum: 200,
          description:
            'Maximum number of logs to return (most recent N). Defaults to 100 and is capped at 200.',
        },
        level: {
          oneOf: [
            {
              type: 'string',
              enum: ['log', 'info', 'warn', 'error', 'debug', 'trace'],
            },
            {
              type: 'array',
              items: {
                type: 'string',
                enum: ['log', 'info', 'warn', 'error', 'debug', 'trace'],
              },
            },
          ],
          description:
            'Filter by log level(s). Default: ["log", "info", "warn", "error"] (excludes debug)',
        },
        pattern: {
          type: 'string',
          description: 'Regex pattern to filter log messages',
        },
        since: {
          type: 'number',
          description: 'Return logs since this timestamp (ms since epoch)',
        },
      },
    },
  },
  {
    name: 'browser_reload_page',
    description:
      'Reload the browser page to reset application state. Use when the app enters an unrecoverable state or to apply code changes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_set_muted',
    description:
      'Mute or unmute all audio in the managed browser tab, whose app-mode window hides the browser mute control. The state is shared with the workspace mute button and persists across reloads and browser relaunches for the dev session.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        muted: {
          type: 'boolean',
          description: 'true mutes the tab; false unmutes it',
        },
      },
      required: ['muted'],
    },
  },

  // =============================================================================
  // Managed Workspace Tools
  // =============================================================================
  {
    name: 'workspace_get_state',
    description:
      'Get explicit managed-workspace status for the browser bridge, editor command/viewport readiness, application runtime frame, IWER availability, observable XR session state, selected scene path, scene session id, and dirty state.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'workspace_set_view',
    description:
      'Set the visible managed IWSDK workspace view. This changes UI presentation only; tool routing remains semantic and deterministic.',
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: ['runtime', 'editor'],
          description: 'Workspace view to show',
        },
      },
      required: ['view'],
    },
  },
  {
    name: 'workspace_open_scene',
    description:
      'Open a scene file from public/scenes in the managed IWSDK workspace editor.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Scene file path under public/scenes, ending in .iwsdk.scene.json',
        },
      },
      required: ['path'],
    },
  },

  // =============================================================================
  // Native Scene Composition Editor Tools
  // =============================================================================
  {
    name: 'scene_list_files',
    description:
      'List IWSDK scene JSON files available under public/scenes in the managed workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional case-insensitive scene path filter',
        },
      },
    },
  },
  {
    name: 'scene_open',
    description:
      'Open an existing IWSDK scene JSON file from public/scenes in the managed workspace editor.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Scene file path under public/scenes, ending in .iwsdk.scene.json',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'scene_render_file',
    description:
      'Validate, compose, and render an IWSDK scene JSON file without opening it in the live editor. Invalid files return structured diagnostics and no PNG; valid files persist the PNG locally and return screenshotPath with hashes and render metadata.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description:
            'Existing scene file path under public/scenes, ending in .iwsdk.scene.json',
        },
        view: {
          ...SCENE_CAMERA_VIEW_SCHEMA,
        },
        viewId: {
          type: 'string',
          description:
            'Stable id of an exact camera declared in document.authoring.views. Use this, not view, for names such as "hero".',
        },
        width: {
          type: 'number',
          minimum: 1,
          description:
            'Render width in pixels. For agent-loop review use 512 or smaller; use 384 or smaller when verifying a correction.',
        },
        height: {
          type: 'number',
          minimum: 1,
          description:
            'Render height in pixels. For agent-loop review use 512 or smaller; use 384 or smaller when verifying a correction.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'scene_flatten_file',
    description:
      'Resolve an authoring-only imported scene into one editable, runtime-loadable scene file. The write is refused unless runtime semantics are unchanged.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Import-bearing source scene path under public/scenes',
        },
        outputPath: {
          type: 'string',
          description:
            'Flat destination under public/scenes. Defaults to <source>.flat.iwsdk.scene.json.',
        },
        overwrite: {
          type: 'boolean',
          description:
            'Allow replacing an existing destination, including an explicit in-place flatten.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'scene_get_state',
    description:
      'Get the active scene file, selection, source/composed/runtime hashes, validation diagnostics, dirty or conflict state, runtime readiness, and current render statistics.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'scene_create',
    description:
      'Create a new IWSDK scene JSON file under public/scenes and open it in the managed workspace editor by default.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Scene file path under public/scenes, ending in .iwsdk.scene.json',
        },
        overwrite: {
          type: 'boolean',
          description: 'Replace an existing scene file when true',
        },
        open: {
          type: 'boolean',
          description:
            'Open the newly-created scene in the editor. Defaults to true.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'scene_get_capabilities',
    description:
      'Get a compact canonical hash-bound editor capability summary. Pass full:true only when the complete component schemas and compatibility payload are needed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        full: {
          type: 'boolean',
          description:
            'Include complete registered component schemas. Defaults to false.',
        },
      },
    },
  },
  {
    name: 'scene_list_assets',
    description:
      'List assets available to the native IWSDK scene editor, including ids, names, URIs, and bounds metadata when present.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional case-insensitive asset id/name filter',
        },
      },
    },
  },
  {
    name: 'scene_search_project_assets',
    description:
      'Search static .gltf and .glb model files available under the current workspace public directory. This is a project-local provider and is distinct from scene_list_assets.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description:
            'Optional case-insensitive filter over suggested id, name, URI, and workspace path.',
        },
      },
    },
  },
  {
    name: 'scene_import_project_asset',
    description:
      'Import one URI returned by scene_search_project_assets into the current scene resources through a hash-checked, preflighted transaction. The import is one undo entry and rejects unknown project paths, duplicate URIs, and id collisions.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        uri: {
          type: 'string',
          description:
            'Exact project URI returned by scene_search_project_assets.',
        },
        id: {
          type: 'string',
          description:
            'Optional scene asset id. Defaults to the provider suggested id.',
        },
        name: {
          type: 'string',
          description:
            'Optional display name. Defaults to the project filename without its extension.',
        },
        bounds: {
          type: 'object',
          additionalProperties: false,
          description: 'Optional model-space bounds in meters.',
          properties: {
            min: VECTOR3_SCHEMA,
            max: VECTOR3_SCHEMA,
          },
          required: ['min', 'max'],
        },
      },
      required: ['uri'],
    },
  },
  {
    name: 'scene_list_component_schemas',
    description:
      'List typed component schemas available to the native IWSDK scene editor. Use this before adding or editing component payloads so scene JSON uses typed component props.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional case-insensitive component id/name/description filter',
        },
      },
    },
  },
  {
    name: 'scene_get_document',
    description:
      'Get the current native IWSDK scene JSON document from the editor page.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'scene_get_hierarchy',
    description:
      'Get the current native IWSDK scene document hierarchy from the editor page. Returns native scene node ids, not Object3D UUIDs.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: {
          type: 'string',
          description:
            'Scene node id of the parent to start from. Defaults to scene root if omitted.',
        },
        maxDepth: {
          type: 'number',
          description:
            'Maximum depth to traverse (default: 5). Use to limit context size.',
        },
      },
    },
  },
  {
    name: 'scene_get_selection',
    description: 'Get the current native scene editor selection.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'scene_select',
    description: 'Select one or more scene node ids in the native editor.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scene node ids to select. Pass [] to clear selection.',
        },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'scene_add_node',
    description:
      'Add a group, asset, instance, pattern, light, or component-bearing node to the native scene JSON document. Procedural geometry must first be declared as an asset.',
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          ...SCENE_NODE_SCHEMA,
        },
        parentId: {
          type: 'string',
          description: 'Optional parent scene node id',
        },
        index: {
          type: 'number',
          description: 'Optional insertion index within the parent children',
        },
      },
      required: ['node'],
    },
  },
  {
    name: 'scene_remove_node',
    description: 'Remove a node from the native scene JSON document.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Scene node id to remove' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'scene_duplicate_node',
    description:
      'Duplicate a node and its children in the native scene editor.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Scene node id to duplicate' },
        newNodeId: {
          type: 'string',
          description: 'Optional id for the duplicated root node',
        },
        parentId: {
          type: 'string',
          description:
            'Optional parent id for the duplicate. Defaults to the original parent.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'scene_set_transform',
    description: 'Replace the transform for a native scene node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Scene node id' },
        transform: SCENE_TRANSFORM_SCHEMA,
      },
      required: ['nodeId', 'transform'],
    },
  },
  {
    name: 'scene_set_framing_role',
    description:
      'Set a native scene node camera-framing role to content or support as one undoable patch. Use scene_apply_transaction for hash-checked review corrections.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nodeId: { type: 'string', description: 'Scene node id' },
        framingRole: {
          type: 'string',
          enum: ['content', 'support'],
          description:
            'content participates in automatic framing; support remains rendered but is excluded.',
        },
      },
      required: ['nodeId', 'framingRole'],
    },
  },
  {
    name: 'scene_apply_patch',
    description:
      'Apply one native scene JSON patch operation with undo support. Replacement and transactions must use their dedicated hash-checked tools.',
    inputSchema: {
      type: 'object',
      properties: {
        patch: {
          type: 'object',
          description:
            'ScenePatch operation such as addNode/removeNode, updateContent/updateConstraints, setEnvironment/setAuthoring, add/update/remove Asset, Material, Prefab, or AuthoringView. Resource references are validated on the resulting document.',
        },
      },
      required: ['patch'],
    },
  },
  {
    name: 'scene_apply_transaction',
    description:
      'Stage ordered scene patches, validate and preflight the complete candidate, then commit them atomically as one undo entry. Any failure leaves the live document unchanged.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        patches: {
          type: 'array',
          items: { type: 'object' },
          minItems: 1,
          description:
            'Ordered scene patches. Supports node, asset, material, prefab, environment, authoring, and authoring-view operations.',
        },
        expectedBaseDocumentHash: {
          oneOf: [SCENE_HASH_SCHEMA, { type: 'null' }],
          description:
            'Required optimistic-concurrency hash. Null is accepted only for a blank new scene.',
        },
        candidateDocumentHash: {
          ...SCENE_HASH_SCHEMA,
          description:
            'Optional caller-computed integrity assertion. When omitted, the editor computes and returns the canonical candidate hash.',
        },
        correction: {
          type: 'object',
          additionalProperties: false,
          description:
            'Required only after scene_begin_review freezes the draft. Binds one correction to the exact current immutable review and defect.',
          properties: {
            kind: {
              type: 'string',
              enum: ['scene', 'resource', 'camera', 'contract'],
            },
            defectTags: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
            },
            reason: { type: 'string' },
            previousReview: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                reviewSha256: SCENE_HASH_SCHEMA,
              },
              required: ['path', 'reviewSha256'],
            },
          },
          required: ['kind', 'defectTags', 'previousReview'],
        },
        ownershipMode: {
          type: 'string',
          enum: ['replace-new'],
          description:
            'Materialization ownership. merge-under-root is not yet supported.',
        },
      },
      required: ['patches', 'expectedBaseDocumentHash'],
    },
  },
  {
    name: 'scene_replace_document',
    description:
      'Atomically replace the complete editor document after the required base-hash concurrency check, any optional candidate-hash integrity assertion, validation, detached resource/runtime preflight, and commit. Creates one undo entry.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        document: SCENE_DOCUMENT_INPUT_SCHEMA,
        expectedBaseDocumentHash: {
          oneOf: [SCENE_HASH_SCHEMA, { type: 'null' }],
          description:
            'Required optimistic-concurrency hash. Null is accepted only for a blank new scene.',
        },
        candidateDocumentHash: {
          ...SCENE_HASH_SCHEMA,
          description:
            'Optional caller-computed integrity assertion. When omitted, the editor computes and returns the canonical document hash.',
        },
        ownershipMode: {
          type: 'string',
          enum: ['replace-new'],
        },
      },
      required: ['document', 'expectedBaseDocumentHash'],
    },
  },
  {
    name: 'scene_look_at',
    description:
      'Yaw a scene node so it faces a target point while preserving pitch and roll.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node to orient' },
        target: VECTOR3_SCHEMA,
      },
      required: ['nodeId', 'target'],
    },
  },
  {
    name: 'scene_validate',
    description:
      'Validate the current native scene JSON document and return structured issues with paths and suggested fixes where available.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'scene_save',
    description:
      'Save the current native scene JSON document from the editor page to disk.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'scene_undo',
    description: 'Undo the most recent native scene editor command.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'scene_redo',
    description: 'Redo the most recently undone native scene editor command.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'scene_set_preview_visibility',
    description:
      'Change editor-only preview visibility without modifying or saving the scene document. Supports recursive hide/show, ghosting, locking, context, solo, reset, and named local arrangements.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          enum: [
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
          ],
        },
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Scene node ids affected by the preview operation. Solo accepts at most one.',
        },
        recursive: {
          type: 'boolean',
          description:
            'Apply the operation to descendants. Defaults to true for hierarchy visibility operations.',
        },
        name: {
          type: 'string',
          description:
            'Arrangement name for save-arrangement or apply-arrangement.',
        },
      },
      required: ['mode'],
    },
  },
  {
    name: 'scene_get_logs',
    description: 'Get native scene editor logs.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Maximum number of recent logs to return',
        },
        level: {
          type: 'string',
          enum: ['info', 'warn', 'error'],
          description: 'Optional log level filter',
        },
      },
    },
  },
  {
    name: 'scene_set_camera',
    description:
      'Set the native scene editor camera to a built-in view, exact saved authoring viewId, or explicit perspective/orthographic pose.',
    inputSchema: {
      type: 'object',
      properties: SCENE_CAMERA_SCHEMA.properties,
    },
  },
  {
    name: 'scene_screenshot',
    description:
      'Capture a native scene editor screenshot, persist the PNG locally, and return screenshotPath. Supports exact saved authoring viewId cameras, current/top/front/back/left/right/quarter/orbit views, and explicit perspective/orthographic poses.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SCENE_CAMERA_SCHEMA.properties,
        width: {
          type: 'number',
          minimum: 1,
          maximum: 4096,
          description: 'Optional screenshot width in pixels',
        },
        height: {
          type: 'number',
          minimum: 1,
          maximum: 4096,
          description: 'Optional screenshot height in pixels',
        },
        captureMode: {
          type: 'string',
          enum: ['render', 'editor'],
          description:
            'render (default) excludes editor-only grid, selection, transform, component-helper, and orientation overlays; editor includes them for UI diagnostics.',
        },
      },
    },
  },
  {
    name: 'asset_render_preview',
    description:
      'Render an isolated manifest model as one labelled multi-view contact sheet without changing the open scene. Supports authored materials or a neutral clay pass, optional framing around one named subtree, persists the PNG locally, and returns screenshotPath with deterministic geometry diagnostics. UIKitML assets must use ui_render_preview.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        assetId: {
          type: 'string',
          description:
            'Renderable glTF or Object3D manifest asset id. UIKitML assets are rejected with guidance to use ui_render_preview.',
        },
        views: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'string',
            enum: ['front', 'back', 'left', 'right', 'top', 'quarter'],
          },
          description:
            'Ordered contact-sheet views. Defaults to front, back, right, top, and quarter.',
        },
        mode: {
          type: 'string',
          enum: ['material', 'clay'],
          description:
            'Use authored materials or a fixed neutral clay material. Defaults to material.',
        },
        focus: {
          type: 'string',
          maxLength: 512,
          description:
            'Optional exact object name or slash-separated named hierarchy path to frame. The full asset remains visible for attachment context.',
        },
        width: {
          type: 'number',
          minimum: 320,
          maximum: 2048,
          description:
            'Composite contact-sheet width in pixels. Defaults to 640. Keep agent-loop previews at 640 or smaller; use focus rather than more pixels for detail review.',
        },
        height: {
          type: 'number',
          minimum: 240,
          maximum: 2048,
          description:
            'Composite contact-sheet height in pixels. Defaults to 480. Keep agent-loop previews at 480 or smaller; use focus rather than more pixels for detail review.',
        },
        background: {
          type: 'string',
          description:
            'Three.js-compatible background color. Defaults to #202226.',
        },
      },
      required: ['assetId'],
    },
  },
  {
    name: 'ui_list_assets',
    description:
      'List UIKitML assets available in the project asset manifest. Use a returned asset id with ui_render_preview or a PanelUI component config.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description:
            'Optional case-insensitive filter over UIKitML asset ids and names.',
        },
      },
    },
  },
  {
    name: 'ui_render_preview',
    description:
      'Render one UIKitML asset from the project asset manifest in isolation against a plain background, persist the PNG locally, and return screenshotPath. Use this to inspect panel layout without the surrounding scene.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        assetId: {
          type: 'string',
          description:
            'Manifest id of an AssetType.UIKitML entry. Discover ids with ui_list_assets.',
        },
        width: {
          type: 'number',
          minimum: 1,
          maximum: 4096,
          description: 'Preview width in pixels. Defaults to 512.',
        },
        height: {
          type: 'number',
          minimum: 1,
          maximum: 4096,
          description: 'Preview height in pixels. Defaults to 512.',
        },
        background: {
          type: 'string',
          description:
            'Three.js-compatible background color. Defaults to #202226.',
        },
      },
      required: ['assetId'],
    },
  },
  {
    name: 'ui_inspect',
    description:
      'Inspect live UIKitML elements owned by one ECS panel entity. Omit selector to list stable-ID elements, or use #id, .class, and descendant selectors for focused inspection. Returns bounded current text, state, layout, and selected computed properties without interacting with the UI; documents over 10,000 objects fail explicitly. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        entityIndex: {
          type: 'integer',
          minimum: 0,
          description:
            'Panel entity index from ecs_find_entities or scene_get_runtime_hierarchy.',
        },
        selector: {
          type: 'string',
          maxLength: 512,
          description:
            'Optional #id, .class, or descendant selector with at most 16 parts. Omit to list every stable-ID element in document order.',
        },
        properties: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'string',
            maxLength: 64,
            pattern: '^[A-Za-z][A-Za-z0-9]*$',
            description: 'Camel-case UIKit property name.',
          },
          description:
            'Optional computed UIKit property names to return. Defaults to common text, value, state, display, and pointer-event properties.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Maximum returned elements. Defaults to 50.',
        },
      },
      required: ['entityIndex'],
    },
  },
  {
    name: 'scene_compare_screenshots',
    description:
      'Capture two native scene editor screenshots and report byte identity. This is not a perceptual image comparison.',
    inputSchema: {
      type: 'object',
      properties: {
        first: {
          type: 'object',
          description:
            'First camera request. Accepts the same fields as scene_screenshot.',
          properties: {
            ...SCENE_CAMERA_SCHEMA.properties,
            captureMode: {
              type: 'string',
              enum: ['render', 'editor'],
              description:
                'render excludes editor-only overlays; editor includes them.',
            },
          },
        },
        second: {
          type: 'object',
          description:
            'Second camera request. Accepts the same fields as scene_screenshot.',
          properties: {
            ...SCENE_CAMERA_SCHEMA.properties,
            captureMode: {
              type: 'string',
              enum: ['render', 'editor'],
              description:
                'render excludes editor-only overlays; editor includes them.',
            },
          },
        },
        width: {
          type: 'number',
          minimum: 1,
          maximum: 4096,
          description: 'Optional screenshot width in pixels',
        },
        height: {
          type: 'number',
          minimum: 1,
          maximum: 4096,
          description: 'Optional screenshot height in pixels',
        },
      },
      required: ['first', 'second'],
    },
  },
  {
    name: 'scene_begin_review',
    description:
      'Freeze the current saved draft scene as formal review round 0. After this one-way boundary, every scene or camera change requires an adjacent immutable review and authorized correction.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scenePath: {
          type: 'string',
          description:
            'Scene file path under public/scenes, ending in .iwsdk.scene.json.',
        },
        expectedDocumentHash: {
          ...SCENE_HASH_SCHEMA,
          description:
            'Canonical hash returned by scene_save for the exact draft to freeze.',
        },
        runtimePreflightReceipt: {
          ...SCENE_REVIEW_EVIDENCE_LINK_SCHEMA,
          description:
            'Exact current passing receipt returned by scene_runtime_preflight.receipt.',
        },
      },
      required: [
        'scenePath',
        'expectedDocumentHash',
        'runtimePreflightReceipt',
      ],
    },
  },
  {
    name: 'scene_set_review_lens',
    description:
      'Set the editor-only layout, geometry, or final review lens without changing the scene document.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lens: {
          type: 'string',
          enum: ['layout', 'geometry', 'final'],
        },
      },
      required: ['lens'],
    },
  },
  {
    name: 'scene_capture_review',
    description:
      'Capture review evidence bound to document/runtime/capability hashes, exact normalized reviewCamera and resolution, active lens, logs, feature state, visibility metadata, and measured renderer statistics. The server registers the PNG internally; the response omits base64 imageData unless includeImageData:true is explicitly requested.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...SCENE_CAMERA_SCHEMA.properties,
        width: {
          type: 'integer',
          minimum: 1,
          maximum: 4096,
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: 4096,
        },
        featureState: {
          type: 'object',
          description:
            'Caller-provided feature-state metadata recorded with the capture.',
        },
        includeImageData: {
          type: 'boolean',
          description:
            'Return the full base64 PNG in imageData. Defaults to false because captureToken is sufficient for persistence.',
        },
      },
      required: ['width', 'height'],
    },
  },
  {
    name: 'scene_persist_review_capture',
    description:
      'Persist a server-issued, session-bound capture returned by scene_capture_review under the active scene review directory. The server resolves captureToken to its registered PNG bytes and trusted capture facts, then writes immutable PNG plus metadata; an exact repeat is idempotent and capture fields cannot be relabeled.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        captureId: {
          type: 'string',
          pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
          description: 'Stable evidence id used in the review capture entry.',
        },
        captureToken: {
          ...SCENE_HASH_SCHEMA,
          description:
            'Session-bound token returned by scene_capture_review.captureToken.',
        },
      },
      required: ['captureId', 'captureToken'],
    },
  },
  {
    name: 'scene_measure_image_regions',
    description:
      'Measure aligned declared-reference and render-capture regions using linear-sRGB luma percentiles, mean OKLab color, and highlight/shadow footprints. Returns raw diagnostics and deltas, never a universal similarity pass.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        captureToken: {
          ...SCENE_HASH_SCHEMA,
          description: 'Trusted token returned by scene_capture_review.',
        },
        referenceId: {
          type: 'string',
          description:
            'ID of a hash-bound reference declared in authoring.composition.input.references.',
        },
        regions: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              referenceRegion: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: { type: 'number', minimum: 0, maximum: 1 },
                description: 'Normalized [x, y, width, height].',
              },
              renderRegion: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: { type: 'number', minimum: 0, maximum: 1 },
                description:
                  'Aligned normalized render region. Defaults to referenceRegion.',
              },
            },
            required: ['id', 'referenceRegion'],
          },
        },
      },
      required: ['captureToken', 'referenceId', 'regions'],
    },
  },
  {
    name: 'scene_capture_review_set',
    description:
      'Capture and immutably persist a complete requested set of saved authoring views across review lenses in one call. Lens switching is automatic, PNG bytes stay server-side, and the response contains only compact schema-ready capture metadata for scene_finalize_review.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: {
          type: 'integer',
          minimum: 1,
          maximum: 4096,
          description: 'Default capture width for the set.',
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: 4096,
          description: 'Default capture height for the set.',
        },
        captures: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: {
                type: 'string',
                pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
              },
              lens: {
                type: 'string',
                enum: ['layout', 'geometry', 'final'],
              },
              viewId: {
                type: 'string',
                description:
                  'Exact id from document.authoring.views; arbitrary built-in cameras are not accepted as immutable review evidence.',
              },
              width: { type: 'integer', minimum: 1, maximum: 4096 },
              height: { type: 'integer', minimum: 1, maximum: 4096 },
              featureState: { type: 'object' },
            },
            required: ['id', 'lens', 'viewId'],
          },
        },
      },
      required: ['width', 'height', 'captures'],
    },
  },
  {
    name: 'scene_record_object_inspection',
    description:
      'Record immutable server-issued inspection evidence for one identity-critical feature. Every required view needs geometry and final captures with the complete subject and declared context visible; form criteria must cite geometry evidence and material response must cite final evidence. Validates persisted capture provenance and complete silhouette, proportions, parts, negative-space, contacts, and material-response coverage. The server derives pass/fail and binds the artifact to current document, runtime, and capability hashes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scenePath: {
          type: 'string',
          description:
            'Scene file path under public/scenes, ending in .iwsdk.scene.json.',
        },
        expectedDocumentHash: SCENE_HASH_SCHEMA,
        capabilityHash: SCENE_HASH_SCHEMA,
        featureId: {
          type: 'string',
          description:
            'Exact id of an identityCritical feature with objectInspection.',
        },
        captures: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: SCENE_BATCH_REVIEW_CAPTURE_SCHEMA,
        },
        results: {
          type: 'object',
          additionalProperties: false,
          properties: {
            silhouette: {
              type: 'array',
              items: SCENE_OBJECT_INSPECTION_ASSESSMENT_SCHEMA,
            },
            proportions: {
              type: 'array',
              items: SCENE_OBJECT_INSPECTION_ASSESSMENT_SCHEMA,
            },
            parts: {
              type: 'array',
              items: SCENE_OBJECT_INSPECTION_ASSESSMENT_SCHEMA,
            },
            negativeSpace: {
              type: 'array',
              items: SCENE_OBJECT_INSPECTION_ASSESSMENT_SCHEMA,
            },
            contacts: {
              type: 'array',
              items: SCENE_OBJECT_INSPECTION_ASSESSMENT_SCHEMA,
            },
            materialResponse: {
              type: 'array',
              items: SCENE_OBJECT_INSPECTION_ASSESSMENT_SCHEMA,
            },
          },
          required: [
            'silhouette',
            'proportions',
            'parts',
            'negativeSpace',
            'contacts',
            'materialResponse',
          ],
        },
      },
      required: [
        'scenePath',
        'expectedDocumentHash',
        'capabilityHash',
        'featureId',
        'captures',
        'results',
      ],
    },
  },
  {
    name: 'scene_finalize_review',
    description:
      'Finalize and immutably save a review from batch capture metadata plus human lens and visual judgments. The SDK fills revision/source hashes, evaluates every deterministic criterion, derives the overall result, validates exact evidence, and routes failures to continue-refining; callers cannot guess deterministic statuses or force a passing result.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        round: { type: 'integer', minimum: 0, maximum: 10 },
        captures: {
          type: 'array',
          minItems: 1,
          items: SCENE_BATCH_REVIEW_CAPTURE_SCHEMA,
        },
        lensResults: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              lens: {
                type: 'string',
                enum: ['layout', 'geometry', 'final'],
              },
              status: {
                type: 'string',
                enum: ['pass', 'partial', 'fail', 'not-applicable'],
              },
            },
            required: ['lens', 'status'],
          },
        },
        visualResults: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              feature: { type: 'string' },
              criterion: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pass', 'partial', 'fail', 'not-applicable'],
              },
              evidenceRefs: {
                type: 'array',
                items: { type: 'string' },
              },
              observation: { type: 'string' },
            },
            required: ['feature', 'criterion', 'status', 'observation'],
          },
        },
        previousReview: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            reviewSha256: SCENE_HASH_SCHEMA,
          },
          required: ['path', 'reviewSha256'],
        },
        correction: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            correctionSha256: SCENE_HASH_SCHEMA,
          },
          required: ['path', 'correctionSha256'],
        },
        openDefectTags: { type: 'array', items: { type: 'string' } },
        stopReason: {
          type: 'string',
          enum: [
            'continue-refining',
            'round-limit',
            'repeated-defect',
            'oscillation',
            'plateau',
            'missing-input',
            'representation-gap',
          ],
        },
      },
      required: ['round', 'captures', 'lensResults'],
    },
  },
  {
    name: 'scene_save_review',
    description:
      'Validate and immutably persist one complete iwsdk.scene-review.v1 record against the active scene document, capability hash, required review contract, persisted PNG evidence, and adjacent immutable correction lineage. Round 0 is initial; every higher round must link by exact path and SHA-256 to round-1. Exact repeats are idempotent. Waivers are refused until a trusted user-approval artifact exists.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { review: SCENE_REVIEW_INPUT_SCHEMA },
      required: ['review'],
    },
  },
  {
    name: 'scene_list_reviews',
    description:
      'List validated review record summaries for the active scene. The current flag requires matching document, runtime, capability, schema, and persisted evidence integrity.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'scene_get_review',
    description:
      'Get one complete immutable review record for the active scene by an exact workspace-relative path returned by scene_list_reviews.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description:
            'Exact workspace-relative review path returned by scene_list_reviews.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'scene_runtime_preflight',
    description:
      'Before formal review, reload and compare the selected editor scene with the live app runtime, then persist a content-addressed receipt required by scene_begin_review. Separately reports scene binding, camera/framing presentation, warnings, structural counts, and host-browser frame diagnostics. The default response is compact; host measurements are never presented as calibrated Quest performance.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        warmupFrames: {
          type: 'integer',
          minimum: 0,
          maximum: 600,
          description: 'Frames excluded before measurement. Defaults to 10.',
        },
        sampleFrames: {
          type: 'integer',
          minimum: 1,
          maximum: 600,
          description: 'Measured host-browser frames. Defaults to 60.',
        },
        detail: {
          type: 'string',
          enum: ['compact', 'full'],
          description:
            'Compact response by default; full returns the complete persisted report inline.',
        },
      },
    },
  },
  {
    name: 'scene_publish',
    description:
      'Publish the active saved scene against one exact current immutable passing review. Reloads the live app runtime, proves document/runtime hash parity, representative node content, resources, transforms and components, a nonblank canvas, and a clean scene/shader/WebGL/material log window, then persists an immutable runtime-proof report. Refuses dirty, stale, mismatched, waived, or unproven scenes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewPath: {
          type: 'string',
          description:
            'Exact current immutable review path returned by scene_list_reviews.',
        },
        representativeNodeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional additional authored node ids whose live content, resources, transforms, and components must match. Required review feature nodeRefs are always included.',
        },
        detail: {
          type: 'string',
          enum: ['compact', 'full'],
          description:
            'Compact returns status, hashes, failed checks, warnings, and artifact path. Full also returns the complete persisted proof inline.',
        },
      },
      required: ['reviewPath'],
    },
  },
  {
    name: 'scene_get_render_stats',
    description:
      'Get measured scene structure (world bounds, object/node/mesh/geometry/material counts and visible node ids) plus raw renderer calls, triangles, points, lines, textures, programs, shadow casters, frame-time samples, and renderer environment. Returns available:false when no measurement bridge is installed.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // =============================================================================
  // Framework-Specific Tools (IWSDK or any framework with FRAMEWORK_MCP_RUNTIME)
  // =============================================================================
  {
    name: 'scene_get_runtime_hierarchy',
    description:
      'Get the live Three.js Object3D hierarchy from the app runtime, including names, UUIDs, object types, native scene node ids, asset ids, primitive descriptors, and ECS entity indices. Use scene_get_hierarchy for the native scene document in the editor.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: {
          type: 'string',
          description:
            'Object3D UUID to start from. Defaults to the runtime scene root if omitted.',
        },
        maxDepth: {
          type: 'number',
          description:
            'Maximum depth to traverse (default: 5). Use to limit context size.',
        },
      },
    },
  },
  {
    name: 'scene_get_object_transform',
    description:
      'Get local and global transforms of an Object3D by Object3D UUID or native scene node id. Includes positionRelativeToXROrigin which can be used directly with xr_look_at tool. Requires IWSDK or a framework that provides FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: {
          type: 'string',
          description:
            'UUID of the Object3D (get this from scene_get_runtime_hierarchy, not the native editor scene hierarchy)',
        },
        nodeId: {
          type: 'string',
          description:
            'Native scene node id (get this from scene_get_hierarchy when using the native scene editor)',
        },
      },
    },
  },

  // =============================================================================
  // ECS Debugging (IWSDK — requires FRAMEWORK_MCP_RUNTIME)
  // =============================================================================
  {
    name: 'ecs_pause',
    description:
      'Pause ECS system updates. The render loop continues (XR session stays alive, screenshots still work) but no systems tick. Use ecs_step to advance individual frames while paused. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ecs_resume',
    description:
      'Resume ECS system updates after pausing. The first frame after resume uses a capped delta to avoid physics explosions. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ecs_step',
    description:
      'Advance N ECS frames with a fixed timestep while paused. Must call ecs_pause first. Useful for frame-by-frame debugging. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of frames to advance (1-120, default: 1)',
        },
        delta: {
          type: 'number',
          description:
            'Fixed timestep in seconds for each frame (default: 1/72 ≈ 0.0139, matching Quest refresh rate)',
        },
      },
    },
  },
  {
    name: 'ecs_query_entity',
    description:
      'Get all component data for an entity. Use entityIndex from ecs_find_entities. Returns serialized component values including vectors, entity refs, and Object3D references. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {
        entityIndex: {
          type: 'number',
          description: 'Entity index (get this from ecs_find_entities)',
        },
        components: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of component IDs to include. If omitted, returns all components on the entity.',
        },
      },
      required: ['entityIndex'],
    },
  },
  {
    name: 'ecs_find_entities',
    description:
      'Find entities by component composition and/or name. Returns entity indices and component lists. Use the returned entityIndex values with ecs_query_entity for detailed inspection. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {
        withComponents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Component IDs that entities must have (AND logic)',
        },
        withoutComponents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Component IDs that entities must NOT have',
        },
        namePattern: {
          type: 'string',
          description:
            'Regex pattern to match against entity Object3D name (case-insensitive)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (1-50, default: 50)',
        },
      },
    },
  },
  {
    name: 'ecs_list_systems',
    description:
      'List all registered ECS systems with name, priority, pause state, config keys, and query entity counts. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ecs_list_components',
    description:
      'List all registered ECS components with their field schemas (type, default). Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ecs_toggle_system',
    description:
      'Pause or resume a specific ECS system by name. Use ecs_list_systems to discover system names. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "System class name (e.g. 'OrbSystem', 'RobotSystem')",
        },
        paused: {
          type: 'boolean',
          description:
            'Set to true to pause, false to resume. If omitted, toggles current state.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'ecs_set_component',
    description:
      'Set a component field value on an entity. Scalars use setValue (with validation), vectors accept arrays. Use ecs_query_entity to inspect current values first. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {
        entityIndex: {
          type: 'number',
          description: 'Entity index (from ecs_find_entities)',
        },
        componentId: {
          type: 'string',
          description: "Component ID (e.g. 'Orb', 'RobotMood', 'Transform')",
        },
        field: {
          type: 'string',
          description:
            "Field name within the component (e.g. 'orbitSpeed', 'mood')",
        },
        value: {
          description:
            'New value. Scalars: number/string/boolean. Vectors: array of numbers (e.g. [1,2,3] for Vec3).',
        },
      },
      required: ['entityIndex', 'componentId', 'field', 'value'],
    },
  },
  {
    name: 'ecs_snapshot',
    description:
      'Capture a snapshot of all ECS entity/component state. Retains 2 snapshots by default; set capacity (2-20) to keep a larger rolling window. Use with ecs_diff to compare. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description:
            'Label for this snapshot (default: auto-generated). Use to reference in ecs_diff.',
        },
        capacity: {
          type: 'number',
          description:
            'Rolling snapshot capacity for this runtime (integer 2-20). Omit to keep the current capacity; defaults to 2.',
        },
      },
    },
  },
  {
    name: 'ecs_diff',
    description:
      'Compare two ECS snapshots. Shows added/removed/changed entities and field-level diffs. Requires FRAMEWORK_MCP_RUNTIME.',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: "Label of the 'before' snapshot",
        },
        to: {
          type: 'string',
          description: "Label of the 'after' snapshot",
        },
      },
      required: ['from', 'to'],
    },
  },
];

export const SCENE_MCP_TOOL_NAMES = [
  'scene_open',
  'scene_render_file',
  'scene_flatten_file',
  'scene_get_state',
  'scene_get_capabilities',
  'scene_screenshot',
  'scene_select',
  'scene_set_camera',
  'scene_set_preview_visibility',
  'scene_measure_image_regions',
] as const;

export const APP_RUNTIME_SCENE_MCP_TOOL_NAMES = [
  'scene_get_render_stats',
  'scene_get_runtime_hierarchy',
  'scene_get_object_transform',
] as const;

const PUBLIC_SCENE_MCP_TOOL_NAME_SET = new Set<string>([
  ...SCENE_MCP_TOOL_NAMES,
  ...APP_RUNTIME_SCENE_MCP_TOOL_NAMES,
]);
const REMOVED_WORKSPACE_MCP_TOOL_NAME_SET = new Set([
  'workspace_get_state',
  'workspace_set_view',
  'workspace_open_scene',
]);

const EXPECTED_TAB_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Optional stale-state precondition. Pass the _tab object from an earlier result; the call fails if that browser tab has reloaded or changed.',
  properties: {
    id: { type: 'string', description: 'Browser tab id from result._tab.id' },
    generation: {
      type: 'number',
      minimum: 1,
      description: 'Browser tab generation from result._tab.generation',
    },
  },
  required: ['id', 'generation'],
};

const RUNTIME_TARGET_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Execution destination. Omit for the managed browser. Physical devices require headsetId, pageId and tabGeneration from runtime_list_targets.',
  properties: {
    deviceClass: { type: 'string', enum: ['managed', 'physical'] },
    headsetId: { type: 'string' },
    pageId: { type: 'string' },
    tabGeneration: { type: 'integer', minimum: 1 },
    browserEpoch: { type: 'integer', minimum: 1 },
    sessionId: { type: 'string' },
  },
  required: ['deviceClass'],
};

const CONTROL_TOOLS: McpToolDefinition[] = [
  {
    name: 'runtime_pair_headset',
    description:
      'Associate an exact headset identifier (adb serial) with this dev session. Open the returned bootstrap URL on that device, then discover its page using runtime_list_targets.',
    inputSchema: {
      type: 'object',
      properties: { headsetId: { type: 'string' } },
      required: ['headsetId'],
    },
  },
  {
    name: 'runtime_get_status',
    description:
      'Read live runtime ownership and managed browser lifecycle. Does not launch or recover a browser.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'runtime_list_targets',
    description:
      'Discover connected targets, exact identities, readiness and supported methods. Physical targets must be explicitly selected.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'runtime_wait',
    description:
      'Wait for a lifecycle revision change, without causing recovery. Returns a current snapshot on timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        afterRevision: { type: 'integer', minimum: 0 },
        timeoutMs: { type: 'integer', minimum: 0, maximum: 25000 },
      },
    },
  },
  {
    name: 'runtime_recover',
    description:
      'Explicitly retry launching the managed browser after failures. Does not replay previous commands or reset live page state.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function withExpectedTabPrecondition(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    properties: {
      ...(schema.properties ?? {}),
      expectedTab: EXPECTED_TAB_SCHEMA,
      runtimeTarget: RUNTIME_TARGET_SCHEMA,
    },
  };
}

export const RUNTIME_MCP_TOOLS: McpToolDefinition[] = [
  ...ALL_RUNTIME_MCP_TOOLS,
  ...CONTROL_TOOLS,
]
  .filter(
    (tool) =>
      (!tool.name.startsWith('scene_') ||
        PUBLIC_SCENE_MCP_TOOL_NAME_SET.has(tool.name)) &&
      !REMOVED_WORKSPACE_MCP_TOOL_NAME_SET.has(tool.name),
  )
  .map((tool) => ({
    ...tool,
    inputSchema: CONTROL_TOOLS.some((control) => control.name === tool.name)
      ? tool.inputSchema
      : withExpectedTabPrecondition(tool.inputSchema),
  }));

export const RUNTIME_TOOL_TO_METHOD: Record<string, string> = {
  xr_get_session_status: 'get_session_status',
  xr_accept_session: 'accept_session',
  xr_end_session: 'end_session',
  xr_get_transform: 'get_transform',
  xr_set_transform: 'set_transform',
  xr_look_at: 'look_at',
  xr_animate_to: 'animate_to',
  xr_set_input_mode: 'set_input_mode',
  xr_set_connected: 'set_connected',
  xr_get_select_value: 'get_select_value',
  xr_set_select_value: 'set_select_value',
  xr_select: 'select',
  xr_get_gamepad_state: 'get_gamepad_state',
  xr_set_gamepad_state: 'set_gamepad_state',
  xr_get_device_state: 'get_device_state',
  xr_set_device_state: 'set_device_state',
  xr_set_hand_pose: 'set_hand_pose',
  xr_microgesture: 'microgesture',
  xr_get_hand_state: 'get_hand_state',
  xr_run_sequence: 'run_sequence',
  xr_cancel_sequence: 'cancel_sequence',
  xr_list_targets: 'list_targets',
  browser_screenshot: 'screenshot',
  browser_snapshot: 'browser_snapshot',
  browser_interact: 'browser_interact',
  browser_profile: 'browser_profile',
  browser_get_console_logs: 'get_console_logs',
  browser_reload_page: 'reload_page',
  scene_get_render_stats: 'get_render_stats',
  scene_get_runtime_hierarchy: 'get_scene_hierarchy',
  scene_get_object_transform: 'get_object_transform',
};

const ALL_RUNTIME_CLI_PATHS: Record<string, string[]> = {
  xr_get_session_status: ['xr', 'status'],
  xr_accept_session: ['xr', 'enter'],
  xr_end_session: ['xr', 'exit'],
  xr_get_transform: ['xr', 'get-transform'],
  xr_set_transform: ['xr', 'set-transform'],
  xr_look_at: ['xr', 'look-at'],
  xr_animate_to: ['xr', 'animate-to'],
  xr_set_input_mode: ['xr', 'set-input-mode'],
  xr_set_connected: ['xr', 'set-connected'],
  xr_get_select_value: ['xr', 'get-select-value'],
  xr_set_select_value: ['xr', 'set-select-value'],
  xr_select: ['xr', 'select'],
  xr_get_gamepad_state: ['xr', 'get-gamepad-state'],
  xr_set_gamepad_state: ['xr', 'set-gamepad-state'],
  browser_screenshot: ['browser', 'screenshot'],
  browser_snapshot: ['browser', 'snapshot'],
  browser_interact: ['browser', 'interact'],
  browser_profile: ['browser', 'profile'],
  xr_get_device_state: ['xr', 'get-device-state'],
  xr_set_device_state: ['xr', 'set-device-state'],
  xr_set_hand_pose: ['xr', 'set-hand-pose'],
  xr_microgesture: ['xr', 'microgesture'],
  xr_get_hand_state: ['xr', 'get-hand-state'],
  xr_run_sequence: ['xr', 'run-sequence'],
  xr_cancel_sequence: ['xr', 'cancel-sequence'],
  xr_list_targets: ['xr', 'list-targets'],
  browser_get_console_logs: ['browser', 'logs'],
  browser_reload_page: ['browser', 'reload'],
  browser_set_muted: ['browser', 'set-muted'],
  workspace_get_state: ['workspace', 'state'],
  workspace_set_view: ['workspace', 'set-view'],
  workspace_open_scene: ['workspace', 'open-scene'],
  scene_list_files: ['scene', 'files'],
  scene_open: ['scene', 'open'],
  scene_render_file: ['scene', 'render-file'],
  scene_flatten_file: ['scene', 'flatten'],
  scene_get_state: ['scene', 'state'],
  scene_create: ['scene', 'create'],
  scene_get_capabilities: ['scene', 'capabilities'],
  scene_set_preview_visibility: ['scene', 'set-preview-visibility'],
  scene_list_assets: ['scene', 'assets'],
  scene_search_project_assets: ['scene', 'search-project-assets'],
  scene_import_project_asset: ['scene', 'import-project-asset'],
  scene_list_component_schemas: ['scene', 'component-schemas'],
  scene_get_document: ['scene', 'document'],
  scene_get_hierarchy: ['scene', 'hierarchy'],
  scene_get_selection: ['scene', 'selection'],
  scene_select: ['scene', 'select'],
  scene_add_node: ['scene', 'add-node'],
  scene_remove_node: ['scene', 'remove-node'],
  scene_duplicate_node: ['scene', 'duplicate-node'],
  scene_set_transform: ['scene', 'set-transform'],
  scene_set_framing_role: ['scene', 'set-framing-role'],
  scene_apply_patch: ['scene', 'apply-patch'],
  scene_apply_transaction: ['scene', 'apply-transaction'],
  scene_replace_document: ['scene', 'replace-document'],
  scene_look_at: ['scene', 'look-at'],
  scene_validate: ['scene', 'validate'],
  scene_save: ['scene', 'save'],
  scene_undo: ['scene', 'undo'],
  scene_redo: ['scene', 'redo'],
  scene_get_logs: ['scene', 'logs'],
  scene_set_camera: ['scene', 'set-camera'],
  scene_screenshot: ['scene', 'screenshot'],
  asset_render_preview: ['asset', 'render-preview'],
  ui_list_assets: ['ui', 'assets'],
  ui_render_preview: ['ui', 'render-preview'],
  ui_inspect: ['ui', 'inspect'],
  scene_compare_screenshots: ['scene', 'compare-screenshots'],
  scene_begin_review: ['scene', 'begin-review'],
  scene_set_review_lens: ['scene', 'set-review-lens'],
  scene_capture_review: ['scene', 'capture-review'],
  scene_measure_image_regions: ['scene', 'measure-image-regions'],
  scene_persist_review_capture: ['scene', 'persist-review-capture'],
  scene_capture_review_set: ['scene', 'capture-review-set'],
  scene_record_object_inspection: ['scene', 'record-object-inspection'],
  scene_finalize_review: ['scene', 'finalize-review'],
  scene_save_review: ['scene', 'save-review'],
  scene_list_reviews: ['scene', 'reviews'],
  scene_get_review: ['scene', 'review'],
  scene_runtime_preflight: ['scene', 'runtime-preflight'],
  scene_publish: ['scene', 'publish'],
  scene_get_render_stats: ['scene', 'render-stats'],
  scene_get_runtime_hierarchy: ['scene', 'runtime-hierarchy'],
  scene_get_object_transform: ['scene', 'transform'],
  ecs_pause: ['ecs', 'pause'],
  ecs_resume: ['ecs', 'resume'],
  ecs_step: ['ecs', 'step'],
  ecs_query_entity: ['ecs', 'query'],
  ecs_find_entities: ['ecs', 'find'],
  ecs_list_systems: ['ecs', 'systems'],
  ecs_list_components: ['ecs', 'components'],
  ecs_toggle_system: ['ecs', 'toggle-system'],
  ecs_set_component: ['ecs', 'set-component'],
  ecs_snapshot: ['ecs', 'snapshot'],
  ecs_diff: ['ecs', 'diff'],
};

const RUNTIME_MCP_TOOL_NAME_SET = new Set(
  RUNTIME_MCP_TOOLS.map((tool) => tool.name),
);

export const RUNTIME_CLI_PATHS: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALL_RUNTIME_CLI_PATHS).filter(([name]) =>
    RUNTIME_MCP_TOOL_NAME_SET.has(name),
  ),
);

export const SCENE_EDITOR_MCP_TOOL_NAMES = [
  'scene_get_capabilities',
  'scene_get_state',
  'scene_select',
  'scene_set_camera',
  'scene_screenshot',
  'scene_set_preview_visibility',
  'scene_measure_image_regions',
  'asset_render_preview',
  'ui_list_assets',
  'ui_render_preview',
] as const;

export const SCENE_FILE_MCP_TOOL_NAMES = [
  'scene_open',
  'scene_render_file',
  'scene_flatten_file',
] as const;

export const PROJECT_ASSET_MCP_TOOL_NAMES = [] as const;

export const REVIEW_EVIDENCE_MCP_TOOL_NAMES = [] as const;

export const WORKSPACE_MCP_TOOL_NAMES = [] as const;

const EDITOR_TARGET_MCP_TOOL_NAME_SET = new Set<string>([
  ...SCENE_EDITOR_MCP_TOOL_NAMES,
  ...SCENE_FILE_MCP_TOOL_NAMES,
  ...PROJECT_ASSET_MCP_TOOL_NAMES,
  ...REVIEW_EVIDENCE_MCP_TOOL_NAMES,
  ...WORKSPACE_MCP_TOOL_NAMES,
]);

const HOST_BROWSER_MCP_TOOL_NAME_SET = new Set<string>([
  'browser_screenshot',
  'browser_snapshot',
  'browser_interact',
  'browser_profile',
  'browser_get_console_logs',
  'browser_reload_page',
  'browser_set_muted',
]);

const APP_TARGET_MCP_TOOL_NAME_SET = new Set<string>([
  ...HOST_BROWSER_MCP_TOOL_NAME_SET,
  'ui_inspect',
]);

export const RUNTIME_OPERATIONS: RuntimeOperationDefinition[] =
  RUNTIME_MCP_TOOLS.map((tool) => {
    const cliPath =
      RUNTIME_CLI_PATHS[tool.name] ??
      (
        {
          runtime_get_status: ['runtime', 'status'],
          runtime_list_targets: ['runtime', 'targets'],
          runtime_wait: ['runtime', 'wait'],
          runtime_recover: ['runtime', 'recover'],
          runtime_pair_headset: ['runtime', 'pair-headset'],
        } as Record<string, string[]>
      )[tool.name];
    const target = EDITOR_TARGET_MCP_TOOL_NAME_SET.has(tool.name)
      ? ({ role: 'editor' } as const)
      : APP_TARGET_MCP_TOOL_NAME_SET.has(tool.name)
        ? ({ role: 'app' } as const)
        : undefined;
    return {
      id: cliPath ? cliPath.join('.') : tool.name,
      domain: cliPath?.[0] ?? 'misc',
      action: cliPath?.[1] ?? tool.name,
      cliPath: cliPath ?? ['misc', tool.name],
      mcpName: tool.name,
      wsMethod: RUNTIME_TOOL_TO_METHOD[tool.name] ?? tool.name,
      ...(target ? { target } : {}),
      execution: tool.name.startsWith('runtime_')
        ? 'server'
        : HOST_BROWSER_MCP_TOOL_NAME_SET.has(tool.name)
          ? 'host'
          : 'runtime',
      physical:
        !EDITOR_TARGET_MCP_TOOL_NAME_SET.has(tool.name) &&
        (!HOST_BROWSER_MCP_TOOL_NAME_SET.has(tool.name) ||
          tool.name === 'browser_reload_page'),
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  });

export function getRuntimeOperationByToolName(
  toolName: string,
): RuntimeOperationDefinition | undefined {
  return RUNTIME_OPERATIONS.find((operation) => operation.mcpName === toolName);
}

export function getRuntimeOperationByCliPath(
  domain: string,
  action: string,
): RuntimeOperationDefinition | undefined {
  return RUNTIME_OPERATIONS.find(
    (operation) => operation.domain === domain && operation.action === action,
  );
}

export function resolveRuntimeOperationRequest(
  operation: RuntimeOperationDefinition,
  params: unknown,
): { params: unknown; target?: RuntimePageTarget } {
  const required = operation.inputSchema.required ?? [];
  if (required.length > 0) {
    if (!isRecord(params)) {
      throw new Error(
        `${operation.mcpName} requires an object with parameter${required.length === 1 ? '' : 's'}: ${required.join(', ')}`,
      );
    }

    const missing = required.filter(
      (name) => !Object.prototype.hasOwnProperty.call(params, name),
    );
    if (missing.length > 0) {
      throw new Error(
        `${operation.mcpName} requires parameter${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      );
    }
  }

  const paramsRecord = isRecord(params) ? params : null;
  const expectedTab = paramsRecord?.expectedTab;
  if (
    expectedTab !== undefined &&
    (!isRecord(expectedTab) ||
      typeof expectedTab.id !== 'string' ||
      !Number.isInteger(expectedTab.generation) ||
      (expectedTab.generation as number) < 1)
  ) {
    throw new Error(
      `${operation.mcpName}.expectedTab requires the { id, generation } object returned as result._tab`,
    );
  }

  assertSchemaValue(params, operation.inputSchema, operation.mcpName);
  const commandParams =
    paramsRecord == null
      ? params
      : Object.fromEntries(
          Object.entries(paramsRecord).filter(
            ([key]) => key !== 'expectedTab' && key !== 'runtimeTarget',
          ),
        );
  const selection = paramsRecord?.runtimeTarget as
    | RuntimePageTarget
    | undefined;
  if (
    selection?.deviceClass === 'physical' &&
    (!selection.headsetId ||
      !selection.pageId ||
      !Number.isInteger(selection.tabGeneration))
  ) {
    throw new Error(
      'Physical runtimeTarget requires headsetId, pageId and tabGeneration from runtime_list_targets.',
    );
  }
  if (
    selection &&
    isRecord(expectedTab) &&
    ((selection.pageId != null && selection.pageId !== expectedTab.id) ||
      (selection.tabGeneration != null &&
        selection.tabGeneration !== expectedTab.generation))
  ) {
    throw new Error(
      'runtimeTarget and expectedTab must identify the same page generation.',
    );
  }
  const target =
    isRecord(expectedTab) &&
    typeof expectedTab.id === 'string' &&
    typeof expectedTab.generation === 'number'
      ? {
          ...(operation.target ?? {}),
          ...selection,
          pageId: expectedTab.id,
          tabGeneration: expectedTab.generation,
        }
      : selection
        ? { ...operation.target, ...selection }
        : operation.target;
  return { params: commandParams, target };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
