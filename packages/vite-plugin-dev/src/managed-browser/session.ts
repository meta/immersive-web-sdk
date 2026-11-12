/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  DEFAULT_BROWSER_OPERATION_TIMEOUT_MS,
  getApplicationMetadata,
  reloadApplicationFrame,
  WORKSPACE_RESTORE_RESERVE_MS,
  type BrowserApplicationMetadata,
} from './application-surface.js';
import {
  EVIDENCE_COMMAND_TIMEOUT_MS,
  ManagedBrowserCommandCoordinator,
} from './command-lock.js';
import {
  ManagedBrowserConsole,
  type CapturedLog,
  type LogQuery,
} from './console-capture.js';
import {
  ManagedInteractionSurface,
  type BrowserInteractionRequest,
  type BrowserInteractionResult,
  type BrowserScreenshotOptions,
  type BrowserSnapshotRequest,
  type BrowserSnapshotResult,
} from './interaction.js';
import {
  createManagedBrowserBootstrap,
  navigateAndVerifyManagedPage,
  openManagedChromium,
  type ManagedBrowserAccess,
  type ManagedBrowserReadiness,
} from './launch.js';
import {
  BrowserProfiler,
  type BrowserProfileRequest,
  type BrowserProfileResult,
} from './profiling.js';
import { resolveManagedRenderMode } from './render-mode.js';
import {
  collectRuntimePreflightEvidence,
  collectRuntimePublishEvidence,
  type ManagedRuntimePreflightEvidence,
  type ManagedRuntimePreflightRequest,
  type ManagedRuntimePublishEvidence,
  type ManagedRuntimePublishRequest,
} from './runtime-evidence.js';
import { ManagedTabAudio, type ManagedTabAudioOptions } from './tab-audio.js';

export { describeElements, summarizeFrameTimes } from './page-probes.js';
export type { BrowserEnvironmentDescriptor } from './page-probes.js';
export type { BrowserApplicationMetadata } from './application-surface.js';
export type {
  BrowserEventKind,
  CapturedLog,
  LogLevel,
  LogQuery,
} from './console-capture.js';
export type {
  BrowserProfileRequest,
  BrowserProfileResult,
} from './profiling.js';
export type {
  BrowserInteractionPoint,
  BrowserInteractionRequest,
  BrowserInteractionResult,
  BrowserInteractionStep,
  BrowserInteractionStepResult,
  BrowserScreenshotOptions,
  BrowserSemanticLocator,
  BrowserSnapshotElement,
  BrowserSnapshotRequest,
  BrowserSnapshotResult,
} from './interaction.js';
export { MANAGED_WORKSPACE_QUERY } from './access-protocol.js';
export type {
  ManagedBrowserAccess,
  ManagedBrowserReadiness,
} from './launch.js';
export type { ManagedTabAudioOptions } from './tab-audio.js';
export {
  collectRuntimePreflightEvidence,
  collectRuntimePublishEvidence,
} from './runtime-evidence.js';
export type {
  ManagedHostPerformanceMeasurement,
  ManagedRuntimeNodeEvidence,
  ManagedRuntimePreflightEvidence,
  ManagedRuntimePreflightRequest,
  ManagedRuntimePublishEvidence,
  ManagedRuntimePublishRequest,
} from './runtime-evidence.js';

export interface ManagedBrowser {
  close(): Promise<void>;
  page: unknown; // playwright.Page
  /** Serialize a caller-owned validation + operation with browser commands. */
  runCommandExclusive<T>(
    operation: () => Promise<T>,
    options?: { queueTimeoutMs?: number; timeoutMs?: number },
  ): Promise<T>;
  /** Switch to the application runtime when needed, then capture it. */
  captureRuntimeScreenshot(options?: BrowserScreenshotOptions): Promise<{
    bytes: Buffer;
    metadata: BrowserApplicationMetadata & {
      downscaled: boolean;
      height: number;
      mimeType: 'image/jpeg' | 'image/png';
      width: number;
    };
  }>;
  /** Return a bounded semantic snapshot of the current application. */
  snapshotApplication(
    request?: BrowserSnapshotRequest,
  ): Promise<BrowserSnapshotResult>;
  /** Execute a bounded batch of trusted Playwright interactions. */
  interactApplication(
    request: BrowserInteractionRequest,
  ): Promise<BrowserInteractionResult>;
  /** Start, stop, or inspect a bounded desktop-browser performance profile. */
  profileApplication(
    request: BrowserProfileRequest,
  ): Promise<BrowserProfileResult>;
  /** Mute or unmute every frame in the managed tab, across reloads. */
  setAudioMuted(muted: boolean): Promise<boolean>;
  /** Reload only the managed application surface. */
  reloadApplication(): Promise<{
    id: string | null;
    generation: number | null;
    url: string;
  }>;
  /** Return the opt-in loopback CDP endpoint for the CLI runner. */
  getAutomationEndpoint(): string | null;
  /** Return the verified CDP endpoint and exact managed-page target. */
  getAutomationTarget(): { endpoint: string; targetId: string } | null;
  /** Query captured console logs. */
  queryLogs(options?: LogQuery): CapturedLog[];
  /** Read the managed browser tab identity used by MCP metadata. */
  getTabMetadata(): Promise<{ id: string | null; generation: number | null }>;
  /** Reload the saved editor and workspace runtime, then collect publish evidence. */
  collectRuntimePublishEvidence(
    request: ManagedRuntimePublishRequest,
  ): Promise<ManagedRuntimePublishEvidence>;
  /** Inspect live scene binding, presentation, and host performance without formal review. */
  collectRuntimePreflightEvidence(
    request: ManagedRuntimePreflightRequest,
  ): Promise<ManagedRuntimePreflightEvidence>;
  /** Register a callback invoked when the page/browser closes unexpectedly. */
  onClose(callback: () => void): void;
  /** Whether the underlying Playwright page has been closed. */
  isClosed(): boolean;
}

export async function launchManagedBrowser(
  url: string,
  headless: boolean,
  verbose: boolean,
  viewport: { width: number; height: number } | null = null,
  screenshotSize: { width: number; height: number } = {
    width: 800,
    height: 800,
  },
  traceMcp = false,
  managedAccess: ManagedBrowserAccess | null = null,
  readiness: ManagedBrowserReadiness = 'iwer',
  workspaceRoot: string = process.cwd(),
  browserAutomation = false,
  signal?: AbortSignal,
  tabAudioOptions: ManagedTabAudioOptions = { muted: false },
): Promise<ManagedBrowser> {
  const launchUrl = new URL(url);
  if (launchUrl.protocol !== 'http:' && launchUrl.protocol !== 'https:') {
    throw new Error('Managed browser URL must use HTTP or HTTPS');
  }
  if (managedAccess != null) {
    if (!/^[A-Za-z0-9-]+$/.test(managedAccess.headerName)) {
      throw new Error('Managed access header name is invalid');
    }
    if (
      managedAccess.token.length === 0 ||
      /[\r\n]/.test(managedAccess.token)
    ) {
      throw new Error('Managed access token is invalid');
    }
  }
  const bootstrap = createManagedBrowserBootstrap(launchUrl, managedAccess);
  const { browser, browserAutomationEndpoint, context, dispose, page } =
    await openManagedChromium({
      browserAutomation,
      workspaceRoot,
      headless,
      launchUrl,
      managedAccess,
      signal,
      viewport,
    });
  let browserAutomationTarget: { endpoint: string; targetId: string } | null;

  const browserConsole = new ManagedBrowserConsole(page, verbose, [
    managedAccess?.token,
    browserAutomationEndpoint,
  ]);
  const commandCoordinator = new ManagedBrowserCommandCoordinator(dispose, () =>
    fireCloseCallback(),
  );
  const profiler = new BrowserProfiler(
    page,
    context,
    workspaceRoot,
    commandCoordinator,
    (value) => browserConsole.sanitize(value),
  );
  browserConsole.attach(profiler);

  let tabAudio: ManagedTabAudio;
  try {
    tabAudio = await ManagedTabAudio.install(context, page, tabAudioOptions);
    browserAutomationTarget = await navigateAndVerifyManagedPage({
      browserAutomationEndpoint,
      context,
      managedWorkspaceToken: bootstrap.token,
      page,
      readiness,
      renderMode: resolveManagedRenderMode(headless),
      waitForRuntime: managedAccess?.runtimeIdentity == null,
      signal,
      traceMcp,
      url: bootstrap.url,
    });
  } catch (error) {
    await dispose();
    throw error;
  }

  if (verbose) {
    console.log(
      headless
        ? '🖥️  IWSDK: Headless browser launched'
        : '🖥️  IWSDK: Browser launched',
    );
  }

  let unexpectedCloseState:
    | 'awaiting-listener'
    | 'intentional'
    | 'unexpected'
    | (() => void) = 'awaiting-listener';

  const fireCloseCallback = () => {
    if (
      unexpectedCloseState === 'intentional' ||
      unexpectedCloseState === 'unexpected'
    ) {
      return;
    }
    const callback =
      typeof unexpectedCloseState === 'function' ? unexpectedCloseState : null;
    unexpectedCloseState = 'unexpected';
    void dispose().catch(() => {});
    profiler.handleBrowserClose();
    callback?.();
  };

  page.on('close', fireCloseCallback);
  browser.on('disconnected', fireCloseCallback);
  const getRemainingOperationTimeMs = (
    operation: string,
    maximumMs = DEFAULT_BROWSER_OPERATION_TIMEOUT_MS,
    exhausted: 'throw' | 'zero' = 'throw',
  ): number => {
    const availableMs =
      commandCoordinator.getRemainingActiveTimeMs() -
      WORKSPACE_RESTORE_RESERVE_MS;
    if (availableMs < 100) {
      if (exhausted === 'zero') {
        return 0;
      }
      throw Object.assign(
        new Error(
          `${operation} ran out of active command time before it could continue`,
        ),
        { retryable: true },
      );
    }
    return Math.min(maximumMs, availableMs);
  };
  const interactionSurface = new ManagedInteractionSurface({
    getRemainingOperationTimeMs,
    onRestoreError: (operation, error) =>
      browserConsole.warnRestoreFailure(operation, error),
    page,
    profiler,
    screenshotSize,
  });

  return {
    captureRuntimeScreenshot: (options = {}) =>
      commandCoordinator.runExclusive(() =>
        interactionSurface.captureRuntimeScreenshot(options),
      ),
    snapshotApplication: (request = {}) =>
      commandCoordinator.runExclusive(() =>
        interactionSurface.snapshotApplication(request),
      ),
    interactApplication: (request) =>
      commandCoordinator.runExclusive(() =>
        interactionSurface.interactApplication(request),
      ),
    profileApplication: (request) =>
      commandCoordinator.runExclusive(async () => {
        if (request.action === 'start') {
          return profiler.start(request);
        }
        if (request.action === 'stop') {
          return profiler.stop(request.profileId);
        }
        if (request.action === 'status') {
          return profiler.status();
        }
        throw new Error(
          `Unsupported browser profile action: ${request.action}`,
        );
      }),
    collectRuntimePublishEvidence: (request) =>
      commandCoordinator.runExclusive(
        () =>
          collectRuntimePublishEvidence(
            page,
            request,
            managedAccess?.token ?? null,
          ),
        EVIDENCE_COMMAND_TIMEOUT_MS,
        EVIDENCE_COMMAND_TIMEOUT_MS,
      ),
    collectRuntimePreflightEvidence: (request) =>
      commandCoordinator.runExclusive(
        () => collectRuntimePreflightEvidence(page, request),
        EVIDENCE_COMMAND_TIMEOUT_MS,
        EVIDENCE_COMMAND_TIMEOUT_MS,
      ),
    close: async () => {
      unexpectedCloseState = 'intentional';
      profiler.handleBrowserClose();
      await commandCoordinator.shutdown();
    },
    page,
    queryLogs: (options?: LogQuery) => browserConsole.query(options),
    getTabMetadata: async () => {
      const metadata = await getApplicationMetadata(page);
      return { id: metadata.id, generation: metadata.generation };
    },
    getAutomationEndpoint: () => browserAutomationTarget?.endpoint ?? null,
    getAutomationTarget: () => browserAutomationTarget,
    runCommandExclusive: (operation, options) =>
      commandCoordinator.runExclusive(
        operation,
        options?.timeoutMs,
        options?.queueTimeoutMs,
      ),
    // Agent requests queue in the plugin's command runner for their tab
    // preconditions. The workspace button calls the page binding instead, so
    // it never waits behind a long browser command.
    setAudioMuted: (muted) => tabAudio.setMuted(muted),
    reloadApplication: () =>
      commandCoordinator.runExclusive(async () => {
        await profiler.stopIfActive('reload');
        return reloadApplicationFrame(
          page,
          getRemainingOperationTimeMs('browser_reload_page', 20_000),
        );
      }),
    onClose: (callback: () => void) => {
      if (unexpectedCloseState === 'unexpected') {
        callback();
      } else if (unexpectedCloseState !== 'intentional') {
        unexpectedCloseState = callback;
      }
    },
    isClosed: () => page.isClosed(),
  };
}
