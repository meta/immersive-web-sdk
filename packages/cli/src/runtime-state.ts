/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync, readFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import {
  isRuntimeBrowserCommandReady,
  IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
  IWSDK_RUNTIME_LAUNCH_PATH,
  IWSDK_RUNTIME_LOGS_DIR,
  IWSDK_RUNTIME_SESSION_PATH,
  IWSDK_RUNTIME_STATE_SCHEMA_VERSION,
  type LaunchMetadata,
  type RuntimeCommandCredential,
  type RuntimeSession,
  type WorkspaceRuntimeState,
} from './runtime-contract.js';
import {
  getRuntimeFilePath,
  getRuntimeProcessStart,
  isRuntimeProcessAlive,
  normalizeWorkspaceRoot,
  readRuntimeJson,
  removeRuntimeFile,
  withRuntimeFileLock,
  writeRuntimeJson,
} from './runtime-files.js';
import { inspectRuntimeOwner, runtimeOwnerEndpoint } from './runtime-owner.js';

export { normalizeWorkspaceRoot } from './runtime-files.js';

const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
  'vite.config.cts',
  'vite.config.cjs',
];
const IWSDK_PROJECT_CONFIG_NAME = 'iwsdk.config.json';

const IWSDK_APP_PACKAGE_NAMES = [
  '@iwsdk/cli',
  '@iwsdk/core',
  '@iwsdk/vite-plugin-dev',
] as const;

interface PackageJsonManifest {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

export interface SetLaunchMetadataInput {
  claimId?: string;
  phase?: LaunchMetadata['phase'];
  workspaceRoot: string;
  pid: number;
  launcherPid?: number;
  processGroupId?: number;
  command: string;
  args?: string[];
  logPath?: string | null;
  scriptName?: string;
  port?: number | null;
  openBrowser?: boolean;
}

export interface ResolveWorkspaceRootOptions {
  cwd?: string;
  workspace?: string;
  requireRunning?: boolean;
}

function readPackageManifest(dirPath: string): PackageJsonManifest | null {
  try {
    const raw = readFileSync(path.join(dirPath, 'package.json'), 'utf8');
    return JSON.parse(raw) as PackageJsonManifest;
  } catch {
    return null;
  }
}

function hasIwsdkDependency(manifest: PackageJsonManifest | null): boolean {
  if (!manifest) {
    return false;
  }

  const dependencyBuckets = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
  ];

  return dependencyBuckets.some((dependencies) =>
    IWSDK_APP_PACKAGE_NAMES.some(
      (packageName) => typeof dependencies?.[packageName] === 'string',
    ),
  );
}

export function getRuntimeSessionFilePath(workspaceRoot: string): string {
  return getRuntimeFilePath(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH);
}

export function getRuntimeLaunchFilePath(workspaceRoot: string): string {
  return getRuntimeFilePath(workspaceRoot, IWSDK_RUNTIME_LAUNCH_PATH);
}

export function getRuntimeCommandCredentialFilePath(
  workspaceRoot: string,
): string {
  return getRuntimeFilePath(
    workspaceRoot,
    IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
  );
}

/**
 * Reads the command credential the dev server wrote for this session. A
 * credential left by another session is never sent. Without one (an older dev
 * server writes none), commands go out without a credential. The read is
 * synchronous so a command starts connecting without an extra turn.
 */
export function getRuntimeCommandToken(
  session: Pick<RuntimeSession, 'sessionId' | 'workspaceRoot'>,
): string | undefined {
  let credential: Partial<RuntimeCommandCredential> | null;
  try {
    credential = JSON.parse(
      readFileSync(
        getRuntimeCommandCredentialFilePath(session.workspaceRoot),
        'utf8',
      ),
    );
  } catch {
    return undefined;
  }
  return credential?.sessionId === session.sessionId &&
    typeof credential.commandToken === 'string' &&
    credential.commandToken.length > 0
    ? credential.commandToken
    : undefined;
}

export function getRuntimeLogsDir(workspaceRoot: string): string {
  return path.join(
    normalizeWorkspaceRoot(workspaceRoot),
    IWSDK_RUNTIME_LOGS_DIR,
  );
}

export async function ensureRuntimeLogsDir(
  workspaceRoot: string,
): Promise<string> {
  const logsDir = getRuntimeLogsDir(workspaceRoot);
  await mkdir(logsDir, { recursive: true });
  return logsDir;
}

export const isProcessAlive = isRuntimeProcessAlive;

export function isIwsdkAppRoot(dirPath: string): boolean {
  const normalizedDir = normalizeWorkspaceRoot(dirPath);
  if (!existsSync(path.join(normalizedDir, 'package.json'))) {
    return false;
  }

  const hasProjectConfig = existsSync(
    path.join(normalizedDir, IWSDK_PROJECT_CONFIG_NAME),
  );
  const hasViteConfig = VITE_CONFIG_NAMES.some((name) =>
    existsSync(path.join(normalizedDir, name)),
  );
  if (!hasProjectConfig && !hasViteConfig) {
    return false;
  }

  return hasIwsdkDependency(readPackageManifest(normalizedDir));
}

export function findNearestIwsdkAppRoot(
  startDir = process.cwd(),
): string | null {
  let current = normalizeWorkspaceRoot(startDir);

  while (true) {
    if (isIwsdkAppRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function getRuntimeSession(
  workspaceRoot: string,
): Promise<RuntimeSession | null> {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const filePath = getRuntimeSessionFilePath(normalizedWorkspaceRoot);
  const session = await withRuntimeFileLock(filePath, () =>
    readRuntimeJson<RuntimeSession>(filePath),
  );
  if (!session) {
    return null;
  }
  if (isProcessAlive(session.pid) && session.browser?.lifecycle) {
    const endpoint = runtimeOwnerEndpoint(normalizedWorkspaceRoot);
    const observation = await inspectRuntimeOwner(endpoint);
    if (observation.state === 'unknown') {
      throw new Error(
        `Runtime ownership is unknown at ${endpoint}: ${observation.reason}. Inspect the runtime process before retrying; no PID-only action was taken.`,
      );
    }
    if (observation.state === 'live') {
      if (
        observation.owner.sessionId === session.sessionId &&
        observation.owner.pid === session.pid &&
        observation.owner.workspaceRoot === normalizedWorkspaceRoot
      ) {
        return session;
      }
    } else if (session.processStart != null) {
      const birth = getRuntimeProcessStart(session.pid);
      if (birth == null || birth === session.processStart) {
        throw new Error(
          `Runtime ${session.sessionId} (pid ${session.pid}) has lost its owner endpoint at ${endpoint}, but its process may still be alive. Stop that dev process before retrying.`,
        );
      }
    }
  } else if (isProcessAlive(session.pid)) {
    return session;
  }
  // Never hold the file lock across IPC: a runtime publishing state may need
  // that lock before it can respond, especially with slower Windows probes.
  return withRuntimeFileLock(filePath, async () => {
    const current = await readRuntimeJson<RuntimeSession>(filePath);
    if (
      current?.sessionId === session.sessionId &&
      current.pid === session.pid &&
      current.processStart === session.processStart
    ) {
      await removeRuntimeFile(filePath);
    }
    return null;
  });
}

function createLaunchMetadata(
  input: SetLaunchMetadataInput,
  createdAt = new Date().toISOString(),
): LaunchMetadata {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  return {
    schemaVersion: IWSDK_RUNTIME_STATE_SCHEMA_VERSION,
    ...(input.claimId == null ? {} : { claimId: input.claimId }),
    ...(input.phase == null ? {} : { phase: input.phase }),
    workspaceRoot,
    pid: input.pid,
    processStart: getRuntimeProcessStart(input.pid),
    ...(input.launcherPid == null ? {} : { launcherPid: input.launcherPid }),
    ...(input.processGroupId == null
      ? {}
      : { processGroupId: input.processGroupId }),
    command: input.command,
    args: input.args ?? [],
    logPath: input.logPath ?? null,
    scriptName: input.scriptName ?? 'dev:runtime',
    port: input.port ?? null,
    openBrowser: input.openBrowser ?? false,
    createdAt,
  };
}

export async function claimLaunchMetadata(
  input: SetLaunchMetadataInput & { claimId: string },
): Promise<{ acquired: boolean; metadata: LaunchMetadata }> {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const filePath = getRuntimeLaunchFilePath(workspaceRoot);
  const metadata = createLaunchMetadata({
    ...input,
    phase: 'starting',
    workspaceRoot,
  });
  return withRuntimeFileLock(filePath, async () => {
    const existing = await readRuntimeJson<LaunchMetadata>(filePath);
    if (existing != null && isLaunchProcessAlive(existing)) {
      return { acquired: false, metadata: existing };
    }
    await writeRuntimeJson(filePath, metadata);
    return { acquired: true, metadata };
  });
}

export async function setLaunchMetadata(
  input: SetLaunchMetadataInput,
  expectedClaimId?: string,
): Promise<LaunchMetadata | null> {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const filePath = getRuntimeLaunchFilePath(workspaceRoot);
  return withRuntimeFileLock(filePath, async () => {
    const existing = await readRuntimeJson<LaunchMetadata>(filePath);
    if (expectedClaimId != null && existing?.claimId !== expectedClaimId) {
      return null;
    }
    const metadata = createLaunchMetadata(
      { ...input, workspaceRoot },
      existing != null && existing.claimId === input.claimId
        ? existing.createdAt
        : new Date().toISOString(),
    );
    await writeRuntimeJson(filePath, metadata);
    return metadata;
  });
}

export async function clearLaunchMetadata(
  workspaceRoot: string,
  expectedClaimId?: string,
  expectedPhase?: LaunchMetadata['phase'],
): Promise<boolean> {
  const filePath = getRuntimeLaunchFilePath(workspaceRoot);
  return withRuntimeFileLock(filePath, async () => {
    const existing = await readRuntimeJson<LaunchMetadata>(filePath);
    if (
      (expectedClaimId == null || existing?.claimId === expectedClaimId) &&
      (expectedPhase == null || existing?.phase === expectedPhase)
    ) {
      await removeRuntimeFile(filePath);
      return true;
    }
    return false;
  });
}

export async function getLaunchMetadata(
  workspaceRoot: string,
): Promise<LaunchMetadata | null> {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const filePath = getRuntimeLaunchFilePath(normalizedWorkspaceRoot);
  return withRuntimeFileLock(filePath, async () => {
    const metadata = await readRuntimeJson<LaunchMetadata>(filePath);
    if (!metadata) {
      return null;
    }
    if (!isLaunchProcessAlive(metadata)) {
      await removeRuntimeFile(filePath);
      return null;
    }
    return metadata;
  });
}

function isLaunchProcessAlive(metadata: LaunchMetadata): boolean {
  if (!isProcessAlive(metadata.pid)) {
    return false;
  }
  const birth =
    metadata.processStart == null ? null : getRuntimeProcessStart(metadata.pid);
  return birth == null || birth === metadata.processStart;
}

export async function getWorkspaceRuntimeState(
  workspaceRoot: string,
): Promise<WorkspaceRuntimeState> {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const [session, launch] = await Promise.all([
    getRuntimeSession(normalizedWorkspaceRoot),
    getLaunchMetadata(normalizedWorkspaceRoot),
  ]);

  return {
    workspaceRoot: normalizedWorkspaceRoot,
    running: Boolean(session),
    starting: !session && Boolean(launch),
    browserConnected: Boolean(session?.browser?.connected),
    browserCommandReady: isRuntimeBrowserCommandReady(session),
    ...(session?.browser?.lastError == null
      ? {}
      : { browserIssue: session.browser.lastError }),
    session,
    launch,
  };
}

export function getRuntimeUrls(session: RuntimeSession | null): {
  local: string | null;
  network: string[];
} {
  return {
    local: session?.localUrl ?? null,
    network: session?.networkUrls ?? [],
  };
}

/** Thrown when a command finds no IWSDK app, or no runtime running for it. */
export class WorkspaceResolutionError extends Error {
  constructor(
    message: string,
    readonly reason: 'no_app' | 'no_runtime',
  ) {
    super(message);
    this.name = 'WorkspaceResolutionError';
  }
}

export function formatMissingRuntimeMessage(workspaceRoot: string): string {
  return `No running IWSDK runtime found for ${workspaceRoot}. Start the dev server with "iwsdk dev up".`;
}

export async function resolveWorkspaceRoot({
  cwd = process.cwd(),
  workspace,
  requireRunning = true,
}: ResolveWorkspaceRootOptions = {}): Promise<string> {
  const basePath = workspace ?? cwd;
  const workspaceRoot = findNearestIwsdkAppRoot(basePath);
  if (!workspaceRoot) {
    throw new WorkspaceResolutionError(
      `No IWSDK app found at or above: ${workspace ?? cwd}. Run this command inside an IWSDK app.`,
      'no_app',
    );
  }

  if (!requireRunning) {
    return workspaceRoot;
  }

  const session = await getRuntimeSession(workspaceRoot);
  if (!session) {
    throw new WorkspaceResolutionError(
      formatMissingRuntimeMessage(workspaceRoot),
      'no_runtime',
    );
  }

  return workspaceRoot;
}
