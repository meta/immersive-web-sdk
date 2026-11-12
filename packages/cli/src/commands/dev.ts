/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { closeSync, existsSync, openSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import {
  parseIntegerOption,
  parseOptionalPositiveIntegerOption,
  safeJsonParse,
} from '../argv.js';
import { createFailure, createSuccess } from '../cli-results.js';
import type {
  CliFailure,
  CliOptions,
  CliSuccess,
  ResolvedCliIo,
} from '../cli-types.js';
import { refreshAgentGuidanceForDev } from '../guidance-refresh.js';
import { findPackageManager } from '../package-manager.js';
import {
  hasRuntimeBrowserCommandReadyContract,
  INTERNAL_BROWSER_PROBE_METHOD,
  INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV,
  INTERNAL_RUNTIME_SHUTDOWN_METHOD,
  isRuntimeBrowserCommandReady,
  type RuntimeBrowserState,
  type RuntimeBrowserProbeResult,
  type RuntimeIssueInfo,
  type RuntimeSession,
} from '../runtime-contract.js';
import {
  inspectRuntimeOwner,
  runtimeOwnerEndpoint,
  stopRuntimeOwner,
} from '../runtime-owner.js';
import {
  claimLaunchMetadata,
  clearLaunchMetadata,
  ensureRuntimeLogsDir,
  formatMissingRuntimeMessage,
  getLaunchMetadata,
  getRuntimeSession,
  getWorkspaceRuntimeState,
  resolveWorkspaceRoot,
  setLaunchMetadata,
} from '../runtime-state.js';
import {
  RuntimeCommandExecutionError,
  sendRuntimeCommand,
} from '../runtime-transport.js';
import { readAdapterStatus } from './adapter.js';
import { handleStatus } from './status.js';

interface PackageJsonManifest {
  packageManager?: string;
  scripts?: Record<string, string>;
}

export type DevAiMode = 'agent' | 'collaborate';

export interface ResolvedDevSessionOptions {
  allowBrowserAutomation: boolean;
  aiMode?: DevAiMode;
  headless: boolean;
  open: boolean;
  nativeXRControl: boolean;
  screenshotWidth?: number;
  screenshotHeight?: number;
}

const DEV_SESSION_ENV_NAMES = {
  allowBrowserAutomation: 'IWSDK_DEV_ALLOW_BROWSER_AUTOMATION',
  aiMode: 'IWSDK_DEV_AI_MODE',
  headless: 'IWSDK_DEV_HEADLESS',
  open: 'IWSDK_DEV_OPEN',
  nativeXRControl: 'IWSDK_DEV_NATIVE_XR_CONTROL',
  screenshotHeight: 'IWSDK_DEV_SCREENSHOT_HEIGHT',
  screenshotWidth: 'IWSDK_DEV_SCREENSHOT_WIDTH',
} as const;

export interface ProcessExitResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * A child process exited cleanly only when it reported exit code 0 and was not
 * terminated by a signal. A signal kill reports `exitCode === null` (with
 * `signal` set), so a plain `exit.exitCode !== 0` check silently treats
 * signal-terminated processes as success — hiding crashes from the CLI caller.
 */
export function isAbnormalChildExit(exit: ProcessExitResult): boolean {
  return !(exit.exitCode === 0 && exit.signal === null);
}

/** Human-readable reason for an abnormal child exit (code vs. signal). */
export function describeChildExit(exit: ProcessExitResult): string {
  if (exit.signal !== null) {
    return `Dev server terminated by signal ${exit.signal}`;
  }
  if (exit.exitCode !== null) {
    return `Dev server exited with code ${exit.exitCode}`;
  }
  return 'Dev server exited abnormally';
}

/** Names the port a fail-closed startup could not bind, from its launch log. */
export async function describeStartupExit(
  logPath: string | null,
): Promise<string> {
  const log = logPath ? await readFile(logPath, 'utf8').catch(() => '') : '';
  const port = /Port (\d+) is already in use/.exec(log.slice(-16_384))?.[1];
  return port
    ? `Port ${port} is already in use. The runtime keeps its configured port instead of moving; stop the process using it or change server.port.`
    : 'Dev server exited before registering a runtime session';
}

interface WaitForRuntimeSessionResult {
  session: RuntimeSession | null;
  exit: ProcessExitResult | null;
  browserReady: boolean;
  browserIssue?: RuntimeIssueInfo;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wasWorkspaceStoppedExternally(
  workspaceRoot: string,
  timeoutMs = 1000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await getWorkspaceRuntimeState(workspaceRoot);
    if (!state.session && !state.launch) {
      return true;
    }
    await sleep(50);
  } while (Date.now() < deadline);
  return false;
}

function isTraceEnabled(): boolean {
  return process.env.IWSDK_RUNTIME_TRACE === '1';
}

function traceDev(event: string, details: Record<string, unknown> = {}): void {
  if (!isTraceEnabled()) {
    return;
  }
  console.error(
    `[IWSDK-RUNTIME-TRACE][dev] ${event} ${JSON.stringify(details)}`,
  );
}

function isBrowserProbeResult(
  value: unknown,
): value is RuntimeBrowserProbeResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as RuntimeBrowserProbeResult).bridgeConnected === 'boolean' &&
    typeof (value as RuntimeBrowserProbeResult).commandReady === 'boolean' &&
    typeof (value as RuntimeBrowserProbeResult).waitedForBridgeMs ===
      'number' &&
    typeof (value as RuntimeBrowserProbeResult).browser === 'object'
  );
}

async function probeBrowserCommandReady(
  session: RuntimeSession,
  timeoutMs: number,
): Promise<{
  ready: boolean;
  browser?: RuntimeBrowserState;
  browserIssue?: RuntimeIssueInfo;
}> {
  if (!session.browser) {
    return { ready: true };
  }
  const usesCommandReadyContract =
    hasRuntimeBrowserCommandReadyContract(session);
  const browserReady = isRuntimeBrowserCommandReady(session);

  traceDev('probe_start', {
    port: session.port,
    timeoutMs,
    browserStatus: session.browser.status,
    bridgeConnected: session.browser.connected,
    commandReady: browserReady,
    usesCommandReadyContract,
  });

  if (!usesCommandReadyContract) {
    return { ready: browserReady };
  }

  try {
    const response = await sendRuntimeCommand({
      port: session.port,
      method: INTERNAL_BROWSER_PROBE_METHOD,
      timeoutMs,
      runtimeSession: session,
    });
    const result = isBrowserProbeResult(response.result)
      ? response.result
      : undefined;
    const ready = result?.commandReady ?? false;
    traceDev('probe_result', {
      port: session.port,
      ready,
      result: result ?? null,
    });
    return { ready, ...(result == null ? {} : { browser: result.browser }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof RuntimeCommandExecutionError
        ? error.issueCause
        : session.browser.lastError?.cause;
    traceDev('probe_error', {
      port: session.port,
      message,
      cause: cause ?? null,
    });
    return {
      ready: false,
      browserIssue: {
        cause: cause ?? 'browser_not_ready',
        message,
        at: new Date().toISOString(),
      },
    };
  }
}

async function readPackageManifest(
  workspaceRoot: string,
): Promise<PackageJsonManifest> {
  return safeJsonParse<PackageJsonManifest>(
    await readFile(path.join(workspaceRoot, 'package.json'), 'utf8'),
    'package.json',
  );
}

export async function detectPackageManager(
  workspaceRoot: string,
): Promise<string> {
  const packageJson = await readPackageManifest(workspaceRoot);

  if (typeof packageJson.packageManager === 'string') {
    return packageJson.packageManager.split('@')[0];
  }
  // The nearest lockfile, so an app inside a monorepo uses its tool.
  return findPackageManager(workspaceRoot).name;
}

async function resolveDevRuntimeScript(workspaceRoot: string): Promise<string> {
  const packageJson = await readPackageManifest(workspaceRoot);
  const scripts = packageJson.scripts ?? {};
  if (typeof scripts['dev:runtime'] === 'string') {
    return 'dev:runtime';
  }
  throw new Error(
    'Missing required "dev:runtime" script. This workspace must define an internal runtime script for "iwsdk dev up".',
  );
}

function readBooleanFlag(
  value: CliOptions[string] | undefined,
  label: string,
): boolean {
  if (value == null || value === false) {
    return false;
  }
  if (value !== true) {
    throw new Error(`${label} does not take a value`);
  }
  return true;
}

function readAiMode(
  value: CliOptions[string] | undefined,
): DevAiMode | undefined {
  if (value == null) {
    return undefined;
  }
  if (value === 'agent' || value === 'collaborate') {
    return value;
  }
  throw new Error('--ai-mode must be either "agent" or "collaborate"');
}

/** Parse and validate launch-time choices owned by the dev command. */
export function resolveDevSessionOptions(
  options: CliOptions,
): ResolvedDevSessionOptions {
  const aiMode = readAiMode(options.aiMode);
  const headlessRequested = readBooleanFlag(options.headless, '--headless');
  const headedRequested = readBooleanFlag(options.headed, '--headed');
  const openRequested = readBooleanFlag(options.open, '--open');
  const noOpenRequested = readBooleanFlag(options.noOpen, '--no-open');
  const allowBrowserAutomation = readBooleanFlag(
    options.allowBrowserAutomation,
    '--allow-browser-automation',
  );
  const nativeXRControl = readBooleanFlag(
    options.nativeXrControl,
    '--native-xr-control',
  );

  if (headlessRequested && headedRequested) {
    throw new Error('--headless and --headed cannot be used together');
  }
  if (openRequested && noOpenRequested) {
    throw new Error('--open and --no-open cannot be used together');
  }
  if (aiMode === 'agent' && headedRequested) {
    throw new Error('--ai-mode agent is headless and cannot use --headed');
  }
  if (aiMode === 'collaborate' && headlessRequested) {
    throw new Error(
      '--ai-mode collaborate is headed and cannot use --headless',
    );
  }

  const screenshotWidth = parseOptionalPositiveIntegerOption(
    options.screenshotWidth,
    '--screenshot-width',
  );
  const screenshotHeight = parseOptionalPositiveIntegerOption(
    options.screenshotHeight,
    '--screenshot-height',
  );

  return {
    allowBrowserAutomation,
    ...(aiMode == null ? {} : { aiMode }),
    headless: headlessRequested || aiMode === 'agent',
    open: !noOpenRequested,
    nativeXRControl,
    ...(screenshotWidth == null ? {} : { screenshotWidth }),
    ...(screenshotHeight == null ? {} : { screenshotHeight }),
  };
}

/** Build the child environment without retaining stale session overrides. */
export function buildDevRuntimeEnvironment(
  options: CliOptions,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const session = resolveDevSessionOptions(options);
  const environment = { ...baseEnvironment };
  for (const name of Object.values(DEV_SESSION_ENV_NAMES)) {
    delete environment[name];
  }

  environment[DEV_SESSION_ENV_NAMES.headless] = String(session.headless);
  environment[DEV_SESSION_ENV_NAMES.open] = String(session.open);
  environment[DEV_SESSION_ENV_NAMES.allowBrowserAutomation] = String(
    session.allowBrowserAutomation,
  );
  environment[DEV_SESSION_ENV_NAMES.nativeXRControl] = String(
    session.nativeXRControl,
  );
  if (session.aiMode != null) {
    environment[DEV_SESSION_ENV_NAMES.aiMode] = session.aiMode;
  }
  if (session.screenshotWidth != null) {
    environment[DEV_SESSION_ENV_NAMES.screenshotWidth] = String(
      session.screenshotWidth,
    );
  }
  if (session.screenshotHeight != null) {
    environment[DEV_SESSION_ENV_NAMES.screenshotHeight] = String(
      session.screenshotHeight,
    );
  }
  return environment;
}

export function shouldOpenExternalBrowser(
  openRequested: boolean,
  session: Pick<RuntimeSession, 'browser'>,
): boolean {
  return openRequested && session.browser == null;
}

function isForegroundLaunch(options: CliOptions): boolean {
  return options.foreground === true;
}

function getRunScriptArgs(
  packageManager: string,
  scriptName: string,
): string[] {
  switch (packageManager) {
    case 'yarn':
      return [scriptName];
    case 'bun':
      return ['run', scriptName];
    case 'pnpm':
    case 'npm':
    default:
      return ['run', scriptName];
  }
}

async function ensureLogPath(workspaceRoot: string): Promise<string> {
  const logsDir = await ensureRuntimeLogsDir(workspaceRoot);
  return path.join(logsDir, `dev-${Date.now()}.log`);
}

async function waitForRuntimeSession(
  workspaceRoot: string,
  timeoutMs: number,
  getChildExit?: () => ProcessExitResult | null,
  attachingToOwner?: string,
): Promise<WaitForRuntimeSessionResult> {
  const deadline = Date.now() + timeoutMs;
  let lastSession: RuntimeSession | null = null;
  let lastBrowserIssue: RuntimeIssueInfo | undefined;

  while (Date.now() < deadline) {
    const session = await getRuntimeSession(workspaceRoot);
    if (
      !session &&
      attachingToOwner != null &&
      (await inspectRuntimeOwner(runtimeOwnerEndpoint(workspaceRoot))).state ===
        'absent'
    ) {
      throw new Error(
        'The runtime stopped while this command was attaching. Retry iwsdk dev up to start a new runtime.',
      );
    }
    if (session) {
      lastSession = session;
      if (session.browser?.lifecycle) {
        return {
          session,
          exit: null,
          browserReady: isRuntimeBrowserCommandReady(session),
          browserIssue: session.browser.lastError,
        };
      }
      if (!session.browser || isRuntimeBrowserCommandReady(session)) {
        return { session, exit: null, browserReady: true };
      }
      if (session.browser.status === 'not_launched') {
        return {
          session,
          exit: null,
          // The server is ready; browser-dependent commands remain explicitly
          // unavailable by operator choice.
          browserReady: true,
          browserIssue: session.browser.lastError,
        };
      }
      if (session.browser.status === 'launch_failed') {
        return {
          session,
          exit: null,
          browserReady: false,
          browserIssue: session.browser.lastError ?? {
            cause: 'browser_launch_failed',
            message: 'Managed browser launch failed.',
            at: session.browser.lastTransitionAt,
          },
        };
      }

      if (session.browser) {
        const remainingMs = Math.max(deadline - Date.now(), 1);
        const probe = await probeBrowserCommandReady(
          session,
          Math.min(remainingMs, 2500),
        );
        if (probe.ready) {
          const refreshedSession = await getRuntimeSession(workspaceRoot);
          const resolvedSession = refreshedSession ?? session;
          return {
            session:
              isRuntimeBrowserCommandReady(resolvedSession) || !probe.browser
                ? resolvedSession
                : {
                    ...resolvedSession,
                    browser: probe.browser,
                    updatedAt: new Date().toISOString(),
                  },
            exit: null,
            browserReady: true,
          };
        }
        if (probe.browserIssue) {
          lastBrowserIssue = probe.browserIssue;
        }
      }
    }

    const exit = getChildExit?.() ?? null;
    if (exit) {
      return {
        session: lastSession,
        exit,
        browserReady: false,
        browserIssue: lastBrowserIssue ?? lastSession?.browser?.lastError,
      };
    }
    await sleep(250);
  }

  return {
    session: lastSession,
    exit: null,
    browserReady: Boolean(
      lastSession && isRuntimeBrowserCommandReady(lastSession),
    ),
    browserIssue:
      lastBrowserIssue ??
      (lastSession?.browser
        ? (lastSession.browser.lastError ?? {
            cause:
              lastSession.browser.status === 'disconnected'
                ? 'connection_lost'
                : 'browser_not_ready',
            message:
              lastSession.browser.status === 'disconnected'
                ? 'Managed browser runtime disconnected before becoming ready.'
                : lastSession.browser.connected
                  ? 'Managed browser bridge connected, but the command path did not finish warming up before the timeout elapsed.'
                  : 'Managed browser did not finish connecting before the timeout elapsed.',
            at: lastSession.browser.lastTransitionAt,
          })
        : undefined),
  };
}

async function attachToRuntime(
  workspaceRoot: string,
  timeoutMs: number,
  foreground: boolean,
  openBrowser: boolean,
  io: ResolvedCliIo,
  attachingToOwner?: string,
): Promise<CliSuccess<unknown> | CliFailure | null> {
  const waitResult = await waitForRuntimeSession(
    workspaceRoot,
    timeoutMs,
    undefined,
    attachingToOwner,
  );
  const launch = await getLaunchMetadata(workspaceRoot);
  if (!waitResult.session) {
    const owner = await inspectRuntimeOwner(
      runtimeOwnerEndpoint(workspaceRoot),
    );
    if (owner.state === 'live') {
      return createFailure(
        `Runtime ${owner.owner.sessionId} owns the workspace but has not registered a session; it may be starting or finishing cleanup. Retry shortly, or stop it with iwsdk dev down. No second runtime was started.`,
        'runtime_owner_unregistered',
        { workspaceRoot, owner: owner.owner },
      );
    }
    return createFailure(
      launch == null
        ? formatMissingRuntimeMessage(workspaceRoot)
        : `Dev server did not register a runtime session within ${timeoutMs}ms`,
      launch == null ? 'dev_up_missing_runtime' : 'dev_up_timeout',
      { workspaceRoot, launch },
    );
  }

  if (shouldOpenExternalBrowser(openBrowser, waitResult.session)) {
    await openUrl(waitResult.session.localUrl);
  }
  const adapters = await readAdapterStatus(workspaceRoot);
  if (foreground) {
    io.stdout.write(
      `[IWSDK] Runtime already running at ${waitResult.session.localUrl}\n`,
    );
    io.stdout.write(
      waitResult.browserReady
        ? '[IWSDK] Managed browser command path is ready.\n'
        : `[IWSDK] Managed browser command path is not ready${waitResult.browserIssue?.cause ? ` (${waitResult.browserIssue.cause})` : ''}. ${waitResult.session.browser?.lifecycle?.nextAction ?? 'Run "iwsdk dev status" and wait for browserCommandReady before issuing browser-backed commands.'}\n`,
    );
    return null;
  }
  return createSuccess({
    action: 'attached',
    workspaceRoot,
    session: waitResult.session,
    launch,
    adapters,
    browserCommandReady: waitResult.browserReady,
    ...(waitResult.browserReady
      ? {}
      : {
          browserIssue: waitResult.browserIssue ?? null,
          browserNextAction:
            waitResult.session.browser?.lifecycle?.nextAction ??
            'Run "iwsdk dev status" and wait for browserCommandReady before issuing browser-backed commands.',
        }),
  });
}

function waitForChildExit(child: ChildProcess): Promise<ProcessExitResult> {
  return new Promise((resolve) => {
    child.once('error', () => {
      resolve({ exitCode: 1, signal: null });
    });
    child.once('exit', (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

function getOpenCommand(url: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [url] };
  }
  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] };
  }
  return { command: 'xdg-open', args: [url] };
}

async function openUrl(url: string): Promise<void> {
  const command = getOpenCommand(url);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: 'ignore',
    });

    child.once('error', (error) => {
      reject(new Error(`Failed to open browser URL ${url}: ${error.message}`));
    });
    child.once('spawn', () => {
      resolve();
    });

    child.unref();
  });
}

async function terminateWindowsProcessTree(
  pid: number,
  force: boolean,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(
      'taskkill',
      ['/pid', String(pid), '/T', ...(force ? ['/F'] : [])],
      { stdio: 'ignore', windowsHide: true },
    );
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish();
    }, 5_000);
    child.once('error', finish);
    child.once('close', finish);
  });
}

function isPosixProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForSpawnedDevProcessExit(
  child: ChildProcess,
  childExitPromise: Promise<ProcessExitResult>,
  processGroupId: number | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (
      process.platform === 'win32'
        ? child.exitCode != null || child.signalCode != null
        : processGroupId != null
          ? !isPosixProcessGroupAlive(processGroupId)
          : child.exitCode != null || child.signalCode != null
    ) {
      return true;
    }
    await Promise.race([childExitPromise, sleep(50)]);
  } while (Date.now() < deadline);

  return process.platform === 'win32'
    ? child.exitCode != null || child.signalCode != null
    : processGroupId != null
      ? !isPosixProcessGroupAlive(processGroupId)
      : child.exitCode != null || child.signalCode != null;
}

async function terminateSpawnedDevProcess(
  child: ChildProcess,
  childExitPromise: Promise<ProcessExitResult>,
  processGroupId: number | undefined,
): Promise<boolean> {
  if (typeof child.pid !== 'number') {
    return true;
  }

  if (process.platform === 'win32') {
    await terminateWindowsProcessTree(child.pid, false);
  } else if (processGroupId != null) {
    try {
      process.kill(-processGroupId, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return true;
      }
    }
  } else {
    child.kill('SIGTERM');
  }

  if (
    await waitForSpawnedDevProcessExit(
      child,
      childExitPromise,
      processGroupId,
      2_000,
    )
  ) {
    return true;
  }

  if (process.platform === 'win32') {
    await terminateWindowsProcessTree(child.pid, true);
  } else if (processGroupId != null) {
    try {
      process.kill(-processGroupId, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return true;
      }
    }
  } else {
    child.kill('SIGKILL');
  }

  return waitForSpawnedDevProcessExit(
    child,
    childExitPromise,
    processGroupId,
    2_000,
  );
}

async function requestRuntimeShutdown(
  session: RuntimeSession | null,
  claimId: string | undefined,
): Promise<boolean> {
  if (session == null || (claimId == null && !session.browser?.lifecycle)) {
    return false;
  }
  try {
    await sendRuntimeCommand({
      port: session.port,
      method: INTERNAL_RUNTIME_SHUTDOWN_METHOD,
      params: { claimId, sessionId: session.sessionId },
      timeoutMs: 3_000,
      runtimeSession: session,
    });
    return true;
  } catch {
    return false;
  }
}

async function terminateRuntimeWorkspace(
  workspaceRoot: string,
): Promise<unknown> {
  let state = await getWorkspaceRuntimeState(workspaceRoot);
  const launchClaimId = state.launch?.claimId;
  const observation = await inspectRuntimeOwner(
    runtimeOwnerEndpoint(workspaceRoot),
  );
  if (observation.state === 'unknown') {
    throw new Error(
      `Runtime ownership is unknown: ${observation.reason}. Inspect the dev process before retrying; no PID-only termination was attempted.`,
    );
  }
  if (observation.state === 'live') {
    const owner = observation.owner;
    const session = state.session;
    if (
      owner.workspaceRoot !== workspaceRoot ||
      (session != null &&
        (owner.sessionId !== session.sessionId || owner.pid !== session.pid))
    ) {
      throw new Error(
        'The runtime owner changed during shutdown. Retry iwsdk dev down.',
      );
    }
    // Startup and incomplete browser cleanup can retain the owner without a
    // session record. The verified IPC identity still authorizes stopping it.
    await stopRuntimeOwner(owner, () =>
      requestRuntimeShutdown(session, launchClaimId),
    );
    if (launchClaimId) {
      await clearLaunchMetadata(workspaceRoot, launchClaimId);
    }
    return { stopped: true, workspaceRoot, sessionId: owner.sessionId };
  }
  if (
    state.session == null &&
    state.launch?.phase === 'starting' &&
    launchClaimId != null
  ) {
    const cancelled = await clearLaunchMetadata(
      workspaceRoot,
      launchClaimId,
      'starting',
    );
    if (cancelled) {
      return {
        stopped: true,
        workspaceRoot,
        cancelledStartup: true,
      };
    }
    state = await getWorkspaceRuntimeState(workspaceRoot);
  }
  if (state.session != null || state.launch != null) {
    throw new Error(
      'A live legacy runtime has no verifiable owner endpoint. Stop that dev process from its original terminal; no PID-only termination was attempted.',
    );
  }
  return {
    stopped: false,
    workspaceRoot,
  };
}

export async function handleDevUp(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown> | CliFailure | number | null> {
  const workspaceRoot = await resolveWorkspaceRoot({
    cwd: io.cwd,
    workspace:
      typeof options.workspace === 'string' ? options.workspace : undefined,
    requireRunning: false,
  });
  // Coding agents start the dev server right after upgrading IWSDK; this is
  // where guidance from the previous release gets noticed and refreshed.
  // Foreground output is plain text; otherwise the report joins the JSON.
  const agentGuidance = await refreshAgentGuidanceForDev(workspaceRoot);
  if (agentGuidance && isForegroundLaunch(options)) {
    io.stdout.write(`${agentGuidance.notice}\n`);
  }
  let result: Awaited<ReturnType<typeof startOrAttachDevRuntime>>;
  try {
    result = await startOrAttachDevRuntime(options, io, workspaceRoot);
  } catch (error) {
    // The CLI turns this into the failure JSON; carry the report along.
    if (agentGuidance && error instanceof Error) {
      Object.assign(error, { agentGuidance });
    }
    throw error;
  }
  if (agentGuidance && result && typeof result === 'object') {
    if (result.ok) {
      return createSuccess({
        ...(result.data as Record<string, unknown>),
        agentGuidance,
      });
    }
    // The refresh already ran; say so even though the server did not start.
    return {
      ...result,
      error: {
        ...result.error,
        details: {
          ...((result.error.details as Record<string, unknown>) ?? {}),
          agentGuidance,
        },
      },
    };
  }
  return result;
}

async function startOrAttachDevRuntime(
  options: CliOptions,
  io: ResolvedCliIo,
  workspaceRoot: string,
): Promise<CliSuccess<unknown> | CliFailure | number | null> {
  const devSessionOptions = resolveDevSessionOptions(options);

  const timeoutMs = parseIntegerOption(options.timeout, '--timeout', 60000);
  const foreground = isForegroundLaunch(options);
  const openBrowser = devSessionOptions.open;

  const [existingSession, existingLaunch] = await Promise.all([
    getRuntimeSession(workspaceRoot),
    getLaunchMetadata(workspaceRoot),
  ]);
  const observation = await inspectRuntimeOwner(
    runtimeOwnerEndpoint(workspaceRoot),
  );
  if (observation.state === 'unknown') {
    throw new Error(
      `Runtime ownership is unknown: ${observation.reason}. Inspect the dev process before retrying; no second runtime was started.`,
    );
  }
  if (existingSession || existingLaunch || observation.state === 'live') {
    return attachToRuntime(
      workspaceRoot,
      timeoutMs,
      foreground,
      openBrowser,
      io,
      observation.state === 'live' ? observation.owner.sessionId : undefined,
    );
  }

  const packageManager = await detectPackageManager(workspaceRoot);
  const scriptName = await resolveDevRuntimeScript(workspaceRoot);
  const logPath = foreground ? null : await ensureLogPath(workspaceRoot);
  const spawnArgs = getRunScriptArgs(packageManager, scriptName);
  const claimId = randomUUID();
  const claim = await claimLaunchMetadata({
    claimId,
    workspaceRoot,
    pid: process.pid,
    command: packageManager,
    args: spawnArgs,
    logPath,
    scriptName,
    port: null,
    openBrowser,
  });
  if (!claim.acquired) {
    return attachToRuntime(
      workspaceRoot,
      timeoutMs,
      foreground,
      openBrowser,
      io,
    );
  }

  const stdoutFd = logPath ? openSync(logPath, 'a') : -1;
  const childEnvironment = buildDevRuntimeEnvironment(options);
  childEnvironment[INTERNAL_RUNTIME_LAUNCH_CLAIM_ENV] = claimId;
  let child: ChildProcess;
  try {
    child = spawn(packageManager, spawnArgs, {
      cwd: workspaceRoot,
      // A separate POSIX process group lets the CLI forward Ctrl-C to the
      // package manager and every descendant without signaling itself.
      detached: process.platform !== 'win32' || !foreground,
      stdio: foreground ? 'inherit' : ['ignore', stdoutFd, stdoutFd],
      env: childEnvironment,
      // npm/pnpm/yarn are .cmd shims on Windows; Node cannot spawn them without a shell.
      shell: process.platform === 'win32',
    });
  } catch (error) {
    if (stdoutFd >= 0) {
      closeSync(stdoutFd);
    }
    await clearLaunchMetadata(workspaceRoot, claimId);
    throw error;
  }
  const childExitPromise = waitForChildExit(child);
  let childExit: ProcessExitResult | null = null;
  void childExitPromise.then((result) => {
    childExit = result;
  });

  if (!foreground) {
    closeSync(stdoutFd);
    child.unref();
  }

  if (typeof child.pid !== 'number') {
    await clearLaunchMetadata(workspaceRoot, claimId);
    throw new Error('Failed to start the dev process');
  }

  const processGroupId = process.platform !== 'win32' ? child.pid : undefined;
  const claimedLaunch = await setLaunchMetadata(
    {
      claimId,
      phase: 'running',
      workspaceRoot,
      pid: child.pid,
      launcherPid: child.pid,
      processGroupId,
      command: packageManager,
      args: spawnArgs,
      logPath,
      scriptName,
      port: null,
      openBrowser,
    },
    claimId,
  );
  if (claimedLaunch == null) {
    if (process.platform === 'win32') {
      await terminateWindowsProcessTree(child.pid, true);
    } else if (processGroupId != null) {
      try {
        process.kill(-processGroupId, 'SIGTERM');
      } catch {}
    } else {
      child.kill('SIGTERM');
    }
    throw new Error('Lost ownership of the IWSDK dev startup claim');
  }

  let receivedForegroundSignal: NodeJS.Signals | null = null;
  let foregroundSignalExitCode: number | null = null;
  let foregroundSignalCount = 0;
  const handleForegroundSignal = (signal: NodeJS.Signals): void => {
    foregroundSignalCount += 1;
    receivedForegroundSignal = signal;
    foregroundSignalExitCode =
      signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143;
    if (child.exitCode == null && child.signalCode == null) {
      if (process.platform === 'win32' && child.pid != null) {
        if (foregroundSignalCount > 1) {
          void terminateWindowsProcessTree(child.pid, true);
        } else {
          void getRuntimeSession(workspaceRoot)
            .then((session) => requestRuntimeShutdown(session, claimId))
            .catch(() => {});
        }
      } else {
        try {
          process.kill(
            -child.pid!,
            foregroundSignalCount > 1 ? 'SIGKILL' : signal,
          );
        } catch {}
      }
    }
  };
  const removeForegroundSignalHandlers = () => {
    if (!foreground) {
      return;
    }
    process.off('SIGINT', handleForegroundSignal);
    process.off('SIGHUP', handleForegroundSignal);
    process.off('SIGTERM', handleForegroundSignal);
  };
  if (foreground) {
    process.on('SIGINT', handleForegroundSignal);
    process.on('SIGHUP', handleForegroundSignal);
    process.on('SIGTERM', handleForegroundSignal);
  }

  try {
    const waitResult = await waitForRuntimeSession(
      workspaceRoot,
      timeoutMs,
      () => childExit,
    );

    // Ctrl-C can arrive while browser readiness is still being probed. The
    // resulting transport disconnect is expected shutdown, not startup
    // failure, so let the finally block finish bounded process cleanup.
    if (foreground && receivedForegroundSignal != null) {
      return foregroundSignalExitCode ?? 1;
    }

    if (!waitResult.session) {
      if (waitResult.exit) {
        await clearLaunchMetadata(workspaceRoot, claimId);
        return createFailure(
          await describeStartupExit(logPath),
          'dev_up_exit',
          {
            workspaceRoot,
            logPath,
            exitCode: waitResult.exit.exitCode,
            signal: waitResult.exit.signal,
            scriptName,
          },
        );
      }

      const cleanupConfirmed = await terminateSpawnedDevProcess(
        child,
        childExitPromise,
        processGroupId,
      );
      if (cleanupConfirmed) {
        await clearLaunchMetadata(workspaceRoot, claimId);
      }

      return createFailure(
        cleanupConfirmed
          ? `Dev server did not register a runtime session within ${timeoutMs}ms and the timed-out process was stopped`
          : `Dev server did not register a runtime session within ${timeoutMs}ms, and process cleanup could not be confirmed. Run "iwsdk dev down" before retrying.`,
        'dev_up_timeout',
        {
          workspaceRoot,
          logPath,
          scriptName,
          launcherPid: child.pid,
          processGroupId,
          cleanupConfirmed,
        },
      );
    }

    await setLaunchMetadata(
      {
        claimId,
        workspaceRoot,
        pid: waitResult.session.pid,
        launcherPid: child.pid,
        processGroupId,
        command: packageManager,
        args: spawnArgs,
        logPath,
        scriptName,
        port: waitResult.session.port,
        openBrowser,
      },
      claimId,
    );

    const launch = await getLaunchMetadata(workspaceRoot);
    const adapters = await readAdapterStatus(workspaceRoot);

    if (shouldOpenExternalBrowser(openBrowser, waitResult.session)) {
      await openUrl(waitResult.session.localUrl);
    }

    if (foreground) {
      io.stdout.write(
        `[IWSDK] Runtime ready at ${waitResult.session.localUrl}\n`,
      );
      io.stdout.write(
        waitResult.browserReady
          ? '[IWSDK] Managed browser command path is ready.\n'
          : `[IWSDK] Managed browser command path is not ready${waitResult.browserIssue?.cause ? ` (${waitResult.browserIssue.cause})` : ''}. ${waitResult.session.browser?.lifecycle?.nextAction ?? 'Run "iwsdk dev status" and wait for browserCommandReady before issuing browser-backed commands.'}\n`,
      );
      const exit = await childExitPromise;
      if (receivedForegroundSignal != null) {
        await clearLaunchMetadata(workspaceRoot, claimId).catch(() => {});
        return foregroundSignalExitCode ?? 1;
      }
      await clearLaunchMetadata(workspaceRoot, claimId);
      if (
        isAbnormalChildExit(exit) &&
        !(await wasWorkspaceStoppedExternally(workspaceRoot))
      ) {
        return createFailure(describeChildExit(exit), 'dev_up_exit', {
          workspaceRoot,
          session: waitResult.session,
          exitCode: exit.exitCode,
          signal: exit.signal,
          scriptName,
        });
      }
      return null;
    }

    return createSuccess({
      action: 'started',
      workspaceRoot,
      session: waitResult.session,
      launch,
      logPath,
      adapters,
      browserCommandReady: waitResult.browserReady,
      ...(waitResult.browserReady
        ? {}
        : {
            browserIssue: waitResult.browserIssue ?? null,
            browserNextAction:
              waitResult.session.browser?.lifecycle?.nextAction ??
              'Run "iwsdk dev status" and wait for browserCommandReady before issuing browser-backed commands.',
          }),
    });
  } finally {
    removeForegroundSignalHandlers();
    if (foreground && child.exitCode == null && child.signalCode == null) {
      if (process.platform === 'win32' && child.pid != null) {
        const session = await getRuntimeSession(workspaceRoot).catch(
          () => null,
        );
        await requestRuntimeShutdown(session, claimId);
      }
      await terminateSpawnedDevProcess(child, childExitPromise, processGroupId);
    }
    if (foreground && (child.exitCode != null || child.signalCode != null)) {
      await clearLaunchMetadata(workspaceRoot, claimId).catch(() => {});
    }
  }
}

export async function handleDevDown(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown>> {
  const workspaceRoot = await resolveWorkspaceRoot({
    cwd: io.cwd,
    workspace:
      typeof options.workspace === 'string' ? options.workspace : undefined,
    requireRunning: false,
  });
  return createSuccess(await terminateRuntimeWorkspace(workspaceRoot));
}

export async function handleDevRestart(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown> | CliFailure | number | null> {
  const workspaceRoot = await resolveWorkspaceRoot({
    cwd: io.cwd,
    workspace:
      typeof options.workspace === 'string' ? options.workspace : undefined,
    requireRunning: false,
  });

  await terminateRuntimeWorkspace(workspaceRoot);
  return handleDevUp({ ...options, workspace: workspaceRoot }, io);
}

export async function handleDevLogs(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown>> {
  const workspaceRoot = await resolveWorkspaceRoot({
    cwd: io.cwd,
    workspace:
      typeof options.workspace === 'string' ? options.workspace : undefined,
    requireRunning: false,
  });
  const launch = await getLaunchMetadata(workspaceRoot);
  if (!launch?.logPath || !existsSync(launch.logPath)) {
    return createSuccess({
      workspaceRoot,
      logPath: launch?.logPath ?? null,
      available: false,
    });
  }

  const tailLines = parseIntegerOption(options.tail, '--tail', 200);
  const content = await readFile(launch.logPath, 'utf8');
  const lines = content.trimEnd().split('\n');
  return createSuccess({
    workspaceRoot,
    logPath: launch.logPath,
    available: true,
    tail: lines.slice(-tailLines).join('\n'),
  });
}

export async function handleDevOpen(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown>> {
  const workspaceRoot = await resolveWorkspaceRoot({
    cwd: io.cwd,
    workspace:
      typeof options.workspace === 'string' ? options.workspace : undefined,
    requireRunning: true,
  });
  const session = await getRuntimeSession(workspaceRoot);
  if (!session) {
    throw new Error(formatMissingRuntimeMessage(workspaceRoot));
  }

  const openedExternally = shouldOpenExternalBrowser(true, session);
  if (openedExternally) {
    await openUrl(session.localUrl);
  }

  return createSuccess({
    workspaceRoot,
    opened: openedExternally ? session.localUrl : null,
    managedBrowser: session.browser != null,
    browserConnected: Boolean(session.browser?.connected),
    browserCommandReady: isRuntimeBrowserCommandReady(session),
    browser: session.browser ?? null,
    ...(session.browser?.status === 'not_launched'
      ? {
          actionRequired:
            'Run "iwsdk dev restart --open" to launch the managed browser.',
        }
      : {}),
  });
}

export async function handleDevStatus(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown>> {
  return handleStatus(options, io);
}
