/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync, rmSync } from 'fs';
import {
  IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
  IWSDK_RUNTIME_SESSION_PATH,
  IWSDK_RUNTIME_STATE_SCHEMA_VERSION,
  type RuntimeBrowserState,
  type RuntimeCommandCredential,
  type RuntimeSession,
} from '@iwsdk/cli/contract';
import {
  getRuntimeFilePath,
  getRuntimeProcessStart,
  isRuntimeProcessAlive,
  normalizeWorkspaceRoot,
  readRuntimeJson,
  removeRuntimeFile,
  withRuntimeFileLock,
  tryRuntimeFileLockSync,
  writeRuntimeJson,
} from '@iwsdk/cli/runtime-files';

interface RegisterRuntimeSessionInput {
  sessionId: string;
  workspaceRoot: string;
  pid: number;
  port: number;
  localUrl: string;
  networkUrls?: string[];
  aiMode?: string;
  browser?: RuntimeBrowserState;
  browserAutomation?: RuntimeSession['browserAutomation'];
  ownerSessionId?: string;
  /** Authorizes runtime commands; written apart from the session record. */
  commandToken: string;
}

export class RuntimeSessionOwnershipError extends Error {
  readonly code = 'runtime_session_owned';

  constructor(readonly owner: Pick<RuntimeSession, 'pid' | 'sessionId'>) {
    super(
      `Another IWSDK dev server already owns this workspace (pid ${owner.pid}, session ${owner.sessionId})`,
    );
    this.name = 'RuntimeSessionOwnershipError';
  }
}

function isTraceEnabled(): boolean {
  return process.env.IWSDK_RUNTIME_TRACE === '1';
}

function traceRuntimeSession(
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!isTraceEnabled()) {
    return;
  }
  console.error(
    `[IWSDK-RUNTIME-TRACE][session] ${event} ${JSON.stringify(details)}`,
  );
}

function getRuntimeSessionFilePath(workspaceRoot: string): string {
  return getRuntimeFilePath(workspaceRoot, IWSDK_RUNTIME_SESSION_PATH);
}

function getRuntimeCommandCredentialFilePath(workspaceRoot: string): string {
  return getRuntimeFilePath(
    workspaceRoot,
    IWSDK_RUNTIME_COMMAND_CREDENTIAL_PATH,
  );
}

async function enqueueSessionMutation<T>(
  workspaceRoot: string,
  mutate: (normalizedWorkspaceRoot: string) => Promise<T>,
): Promise<T> {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  return withRuntimeFileLock(
    getRuntimeSessionFilePath(normalizedWorkspaceRoot),
    () => mutate(normalizedWorkspaceRoot),
  );
}

async function readRuntimeSession(
  filePath: string,
): Promise<RuntimeSession | null> {
  return readRuntimeJson<RuntimeSession>(filePath);
}

async function writeRuntimeSession(
  workspaceRoot: string,
  session: RuntimeSession,
): Promise<RuntimeSession> {
  const filePath = getRuntimeSessionFilePath(workspaceRoot);
  await writeRuntimeJson(filePath, session);
  return session;
}

export async function registerRuntimeSession(
  input: RegisterRuntimeSessionInput,
): Promise<RuntimeSession> {
  return enqueueSessionMutation(
    input.workspaceRoot,
    async (workspaceRoot): Promise<RuntimeSession> => {
      const existing = await readRuntimeSession(
        getRuntimeSessionFilePath(workspaceRoot),
      );
      if (
        existing != null &&
        existing.sessionId !== input.sessionId &&
        existing.pid !== input.pid &&
        isRuntimeProcessAlive(existing.pid) &&
        !(
          existing.browser?.lifecycle &&
          input.ownerSessionId === input.sessionId
        )
      ) {
        throw new RuntimeSessionOwnershipError(existing);
      }
      // Under the session lock and before the session is published, so a
      // client that discovers this session always finds its credential.
      // writeRuntimeJson creates the file with mode 0600.
      await writeRuntimeJson(
        getRuntimeCommandCredentialFilePath(workspaceRoot),
        {
          schemaVersion: IWSDK_RUNTIME_STATE_SCHEMA_VERSION,
          sessionId: input.sessionId,
          commandToken: input.commandToken,
        } satisfies RuntimeCommandCredential,
      );
      const now = new Date().toISOString();
      const hasBrowserInput = Object.prototype.hasOwnProperty.call(
        input,
        'browser',
      );
      const session: RuntimeSession = {
        schemaVersion: IWSDK_RUNTIME_STATE_SCHEMA_VERSION,
        sessionId: input.sessionId,
        workspaceRoot,
        pid: input.pid,
        processStart: getRuntimeProcessStart(input.pid),
        port: input.port,
        localUrl: input.localUrl,
        networkUrls: input.networkUrls ?? [],
        aiMode: input.aiMode,
        browser: hasBrowserInput ? input.browser : existing?.browser,
        browserAutomation:
          input.browserAutomation ?? existing?.browserAutomation,
        registeredAt:
          existing?.sessionId === input.sessionId ? existing.registeredAt : now,
        updatedAt: now,
      };
      traceRuntimeSession('register', {
        workspaceRoot,
        port: input.port,
        browserStatus: session.browser?.status ?? null,
        bridgeConnected: session.browser?.connected ?? false,
        commandReady: session.browser?.commandReady ?? false,
      });
      return writeRuntimeSession(workspaceRoot, session);
    },
  );
}

export async function setRuntimeSessionBrowserAutomation(
  workspaceRoot: string,
  sessionId: string,
  browserAutomation: NonNullable<RuntimeSession['browserAutomation']>,
): Promise<RuntimeSession | null> {
  return enqueueSessionMutation(
    workspaceRoot,
    async (normalizedWorkspaceRoot): Promise<RuntimeSession | null> => {
      const existing = await readRuntimeSession(
        getRuntimeSessionFilePath(normalizedWorkspaceRoot),
      );
      if (!existing || existing.sessionId !== sessionId) {
        return null;
      }
      return writeRuntimeSession(normalizedWorkspaceRoot, {
        ...existing,
        browserAutomation,
        updatedAt: new Date().toISOString(),
      });
    },
  );
}

export async function setRuntimeSessionBrowserState(
  workspaceRoot: string,
  sessionId: string,
  browser: RuntimeBrowserState,
): Promise<RuntimeSession | null> {
  return enqueueSessionMutation(
    workspaceRoot,
    async (normalizedWorkspaceRoot): Promise<RuntimeSession | null> => {
      const existing = await readRuntimeSession(
        getRuntimeSessionFilePath(normalizedWorkspaceRoot),
      );
      if (!existing || existing.sessionId !== sessionId) {
        return null;
      }

      const session: RuntimeSession = {
        ...existing,
        browser,
        updatedAt: new Date().toISOString(),
      };
      traceRuntimeSession('set_browser_state', {
        workspaceRoot: normalizedWorkspaceRoot,
        browserStatus: browser.status,
        bridgeConnected: browser.connected,
        commandReady: browser.commandReady,
        connectedClientCount: browser.connectedClientCount,
        lastError: browser.lastError ?? null,
      });
      return writeRuntimeSession(normalizedWorkspaceRoot, session);
    },
  );
}

export async function unregisterRuntimeSession(
  workspaceRoot: string,
  sessionId: string,
): Promise<void> {
  await enqueueSessionMutation(
    workspaceRoot,
    async (normalizedWorkspaceRoot) => {
      // Each record is removed only while it still names this session.
      const credentialPath = getRuntimeCommandCredentialFilePath(
        normalizedWorkspaceRoot,
      );
      const credential =
        await readRuntimeJson<RuntimeCommandCredential>(credentialPath);
      if (credential?.sessionId === sessionId) {
        await removeRuntimeFile(credentialPath);
      }
      const filePath = getRuntimeSessionFilePath(normalizedWorkspaceRoot);
      const existing = await readRuntimeSession(filePath);
      if (existing?.sessionId !== sessionId) {
        return;
      }
      traceRuntimeSession('unregister', {
        sessionId,
        workspaceRoot: normalizedWorkspaceRoot,
      });
      await removeRuntimeFile(filePath);
    },
  );
}

/** Best-effort owned cleanup for process.exit, where async work is forbidden. */
export function unregisterRuntimeSessionSync(
  workspaceRoot: string,
  sessionId: string,
): void {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const filePath = getRuntimeSessionFilePath(normalizedWorkspaceRoot);
  const release = tryRuntimeFileLockSync(filePath);
  if (!release) {
    return;
  }
  try {
    for (const recordPath of [
      getRuntimeCommandCredentialFilePath(normalizedWorkspaceRoot),
      filePath,
    ]) {
      let existing: { sessionId?: unknown } | null = null;
      try {
        existing = JSON.parse(readFileSync(recordPath, 'utf8'));
      } catch {}
      if (existing?.sessionId === sessionId) {
        rmSync(recordPath, { force: true });
      }
    }
  } finally {
    release();
  }
}
