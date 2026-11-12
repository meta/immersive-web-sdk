/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
} from 'playwright';
import { MANAGED_WORKSPACE_QUERY } from './access-protocol.js';
import {
  DEFAULT_BROWSER_OPERATION_TIMEOUT_MS,
  resolveApplicationFrame,
} from './application-surface.js';
import { errorMessage, parseUrl } from './internals.js';
import type { ManagedRenderMode } from './render-mode.js';

const MANAGED_BROWSER_STARTUP_TIMEOUT_MS = 45_000;

const AUTOMATION_ENDPOINT_TIMEOUT_MS = 10_000;

// Chromium ignores --app=about:blank and opens a normal tabbed window with an
// omnibox. An inert data: page keeps app mode without loading the app before
// the managed-access route is installed; page.goto then loads the managed URL.
const MANAGED_APP_START_URL = 'data:text/html,';

const requireFromPlugin = createRequire(import.meta.url);

function resolvePlaywrightCliPath(): string {
  const packageJsonPath = requireFromPlugin.resolve('playwright/package.json');
  return path.join(path.dirname(packageJsonPath), 'cli.js');
}

const PROFILE_CLEANUP_SCRIPT = String.raw`
const fs = require('node:fs');
const target = process.argv[1];
let attempts = 0;
const remove = () => {
  try {
    fs.rmSync(target, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
    process.exit(0);
  } catch {
    if (++attempts >= 50) process.exit(1);
    setTimeout(remove, 100);
  }
};
setTimeout(remove, 5000);
`;

function browserLaunchAbortError(): Error {
  return Object.assign(new Error('Managed browser launch was cancelled'), {
    code: 'browser_launch_cancelled',
  });
}

function throwIfLaunchAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw browserLaunchAbortError();
  }
}

function scrubManagedWorkspaceReferrer(value: string, token: string): string {
  const referrer = parseUrl(value);
  if (referrer != null) {
    if (referrer.searchParams.get(MANAGED_WORKSPACE_QUERY) === token) {
      referrer.searchParams.delete(MANAGED_WORKSPACE_QUERY);
    }
    return referrer.href.split(token).join('');
  }
  return value.split(token).join('');
}

async function readDevToolsActivePort(
  userDataDir: string,
  signal?: AbortSignal,
  previousContents?: string,
): Promise<{ endpoint: string; websocketPath: string }> {
  const activePortPath = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + AUTOMATION_ENDPOINT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    throwIfLaunchAborted(signal);
    try {
      const contents = fs.readFileSync(activePortPath, 'utf8');
      const [rawPort, websocketPath] = contents.trim().split(/\r?\n/);
      const port = Number(rawPort);
      if (
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65_535 &&
        contents !== previousContents &&
        websocketPath?.startsWith('/devtools/browser/')
      ) {
        return {
          endpoint: `http://127.0.0.1:${port}`,
          websocketPath,
        };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Browser automation endpoint did not become ready');
}

async function verifyAutomationTarget(
  endpoint: string,
  context: BrowserContext,
  page: Page,
  signal?: AbortSignal,
): Promise<string> {
  throwIfLaunchAborted(signal);
  const cdp = await context.newCDPSession(page);
  let targetId: string;
  try {
    const response = (await cdp.send('Target.getTargetInfo')) as {
      targetInfo?: { targetId?: string };
    };
    targetId = response.targetInfo?.targetId ?? '';
  } finally {
    await cdp.detach().catch(() => {});
  }
  if (!targetId) {
    throw new Error('Managed browser automation target ID is unavailable');
  }
  const managedMarker = await page
    .evaluate(() => (window as any).__IWSDK_MANAGED_BROWSER_TARGET === true)
    .catch(() => false);
  if (!managedMarker) {
    throw new Error('Managed browser automation page marker is unavailable');
  }
  const response = await fetch(`${endpoint}/json/list`, {
    signal:
      signal == null
        ? AbortSignal.timeout(AUTOMATION_ENDPOINT_TIMEOUT_MS)
        : AbortSignal.any([
            signal,
            AbortSignal.timeout(AUTOMATION_ENDPOINT_TIMEOUT_MS),
          ]),
  });
  if (!response.ok) {
    throw new Error(
      `Browser automation endpoint returned HTTP ${response.status}`,
    );
  }
  const targets = (await response.json()) as Array<{
    id?: string;
    type?: string;
  }>;
  const target = targets.find(
    (candidate) => candidate.id === targetId && candidate.type === 'page',
  );
  if (target == null) {
    throw new Error('Browser automation endpoint does not match managed page');
  }
  return targetId;
}

export interface ManagedBrowserAccess {
  headerName: string;
  pathnames: readonly string[];
  topLevelPathnames?: readonly string[];
  token: string;
  runtimeIdentity?: { sessionId: string; browserEpoch: number };
}

export function createManagedBrowserBootstrap(
  launchUrl: URL,
  managedAccess: ManagedBrowserAccess | null,
): { token: string | null; url: string } {
  const bootstrapUrl = new URL(launchUrl);
  if (
    managedAccess == null ||
    managedAccess.topLevelPathnames?.includes(bootstrapUrl.pathname) !== true
  ) {
    return { token: null, url: bootstrapUrl.href };
  }
  bootstrapUrl.searchParams.set(MANAGED_WORKSPACE_QUERY, managedAccess.token);
  return { token: managedAccess.token, url: bootstrapUrl.href };
}

export type ManagedBrowserReadiness = 'iwer' | 'workspace';

let chromiumInstalled = false;

let installation: {
  promise: Promise<void>;
  child?: ChildProcess;
  consumers: number;
} | null = null;

/**
 * Verify the Chromium binary exists and install it automatically if missing.
 * Uses a Promise guard so concurrent callers share one install attempt.
 * On install failure the flag stays unset so the next retry can try again.
 */
export async function ensureChromiumInstalled(
  signal?: AbortSignal,
): Promise<void> {
  throwIfLaunchAborted(signal);
  if (chromiumInstalled) {
    return;
  }
  if (installation == null && fs.existsSync(chromium.executablePath())) {
    chromiumInstalled = true;
    return;
  }

  if (installation == null) {
    const job = {
      promise: Promise.resolve(),
      consumers: 0,
      child: undefined as ChildProcess | undefined,
    };
    job.promise = doChromiumInstall((child) => {
      job.child = child;
    }).finally(() => {
      installation = null;
    });
    installation = job;
  }
  const job = installation;
  job.consumers += 1;
  job.child?.ref();
  try {
    await new Promise<void>((resolve, reject) => {
      const cancelled = () => reject(browserLaunchAbortError());
      signal?.addEventListener('abort', cancelled, { once: true });
      if (signal?.aborted) {
        cancelled();
      }
      void job.promise.then(resolve, reject).finally(() => {
        signal?.removeEventListener('abort', cancelled);
      });
    });
  } finally {
    job.consumers -= 1;
    if (job.consumers === 0) {
      job.child?.unref();
    }
  }
}

async function doChromiumInstall(
  onSpawn: (child: ChildProcess) => void,
): Promise<void> {
  console.log(
    '\n🔧 IWSDK: Chromium browser not found. Installing (first time only)...\n',
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [resolvePlaywrightCliPath(), 'install', 'chromium'],
      {
        // Process-scoped: a Vite generation's cancellation only detaches its
        // waiter. A replacement generation shares the in-progress download.
        signal: AbortSignal.timeout(600000),
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
      },
    );
    onSpawn(child);
    const stopOnExit = () => {
      child.kill();
    };
    process.once('exit', stopOnExit);
    let installError: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    child.on('close', (code) => {
      process.off('exit', stopOnExit);
      clearTimeout(killTimer);
      if (code === 0 && !installError) {
        chromiumInstalled = true;
        console.log('\n✅ IWSDK: Chromium installed successfully.\n');
        resolve();
      } else {
        reject(
          new Error(
            `Chromium installation failed (exit code ${code}). ` +
              `${installError ? installError.message + '. ' : ''}Run the installed Playwright CLI with "install chromium", then use runtime_recover.`,
          ),
        );
      }
    });

    child.on('error', (err) => {
      installError = err;
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
    });
  });
}

/**
 * Check whether a GPU device is available. On macOS/Windows this always
 * returns true (Metal/D3D11 require a GPU by definition). On Linux it
 * probes /dev/dri/ for render nodes, which works in Docker, VMs, and
 * bare-metal environments without requiring external tools.
 */
function hasGpuDevice(): boolean {
  if (os.platform() !== 'linux') {
    return true;
  }
  try {
    const entries = fs.readdirSync('/dev/dri');
    return entries.some((e) => e.startsWith('renderD') || e.startsWith('card'));
  } catch {
    return false;
  }
}

type GpuBackend = {
  kind: 'hardware' | 'swiftshader';
  useGl: string;
  useAngle: string;
  reason: 'env-override' | 'auto';
};

const VALID_GPU_VALUES = ['auto', 'gpu', 'swiftshader'];

/**
 * Resolve the GPU / ANGLE backend for Chromium.
 *
 * Override with IWSDK_GPU env var:
 *   - "auto"        (default) auto-detect; hardware GL when a GPU is present,
 *                    SwiftShader otherwise
 *   - "gpu"         force hardware GL (fails if no GPU)
 *   - "swiftshader" force CPU-based SwiftShader rendering
 */
function resolveGpuBackend(): GpuBackend {
  const envOverride = process.env.IWSDK_GPU?.toLowerCase();

  if (envOverride !== undefined && !VALID_GPU_VALUES.includes(envOverride)) {
    console.warn(
      `⚠️  IWSDK: Unknown IWSDK_GPU value "${process.env.IWSDK_GPU}". ` +
        'Valid values: auto, gpu, swiftshader. Falling back to auto-detect.',
    );
  }

  if (envOverride === 'swiftshader') {
    return {
      kind: 'swiftshader',
      useGl: 'angle',
      useAngle: 'swiftshader',
      reason: 'env-override',
    };
  }

  const platform = os.platform();
  if (platform === 'darwin') {
    return {
      kind: 'hardware',
      useGl: 'angle',
      useAngle: 'metal',
      reason: 'auto',
    };
  }
  if (platform === 'win32') {
    return {
      kind: 'hardware',
      useGl: 'angle',
      useAngle: 'd3d11',
      reason: 'auto',
    };
  }

  // Linux: honour explicit "gpu" override, otherwise auto-detect
  if (envOverride === 'gpu') {
    return {
      kind: 'hardware',
      useGl: 'angle',
      useAngle: 'gl',
      reason: 'env-override',
    };
  }

  if (hasGpuDevice()) {
    return { kind: 'hardware', useGl: 'angle', useAngle: 'gl', reason: 'auto' };
  }

  return {
    kind: 'swiftshader',
    useGl: 'angle',
    useAngle: 'swiftshader',
    reason: 'auto',
  };
}

/** Persistent, private profile identity shared by every runtime generation. */
export function managedBrowserProfilePath(workspaceRoot: string): string {
  return path.join(
    os.tmpdir(),
    `.iwsdk-browser-${process.getuid?.() ?? 'user'}`,
    createHash('sha256').update(fs.realpathSync(workspaceRoot)).digest('hex'),
  );
}

export async function openManagedChromium({
  browserAutomation,
  headless,
  launchUrl,
  managedAccess,
  signal,
  viewport,
  workspaceRoot,
}: {
  workspaceRoot?: string;
  browserAutomation: boolean;
  headless: boolean;
  launchUrl: URL;
  managedAccess: ManagedBrowserAccess | null;
  signal?: AbortSignal;
  viewport: { height: number; width: number } | null;
}) {
  await ensureChromiumInstalled(signal);
  throwIfLaunchAborted(signal);

  const backend = resolveGpuBackend();

  console.log(
    backend.kind === 'swiftshader'
      ? backend.reason === 'env-override'
        ? '🖥️  IWSDK: Using SwiftShader (software rendering) — IWSDK_GPU=swiftshader'
        : '🖥️  IWSDK: Using SwiftShader (software rendering) — no GPU detected'
      : `🖥️  IWSDK: Using hardware GPU (${backend.useAngle})`,
  );

  // Chromium's own profile singleton is the last fence after abrupt owner
  // death. Never delete this profile/lock to force an orphan out of the way.
  const profileRoot = path.join(
    os.tmpdir(),
    `.iwsdk-browser-${process.getuid?.() ?? 'user'}`,
  );
  const ownedProfile =
    workspaceRoot && managedAccess?.runtimeIdentity
      ? managedBrowserProfilePath(workspaceRoot)
      : null;
  if (ownedProfile) {
    fs.mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
    const info = fs.lstatSync(profileRoot);
    if (
      !info.isDirectory() ||
      (process.platform !== 'win32' &&
        (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))
    ) {
      throw new Error(
        `Managed browser profile directory is not private: ${profileRoot}`,
      );
    }
    fs.mkdirSync(ownedProfile, { recursive: true, mode: 0o700 });
  }
  const browserAutomationUserDataDir =
    ownedProfile ??
    (browserAutomation
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'iwsdk-managed-browser-'))
      : null);
  let previousActivePort: string | undefined;
  if (browserAutomationUserDataDir != null) {
    try {
      previousActivePort = fs.readFileSync(
        path.join(browserAutomationUserDataDir, 'DevToolsActivePort'),
        'utf8',
      );
    } catch {}
  }
  let browserAutomationUserDataDirRemoved = false;
  let browserAutomationCleanupScheduled = false;
  let processExitCleanup: (() => void) | null = null;
  let processSignalCleanup: (() => void) | null = null;
  const removeProcessCleanupListeners = () => {
    if (processExitCleanup != null) {
      process.off('exit', processExitCleanup);
      processExitCleanup = null;
    }
    if (processSignalCleanup != null) {
      process.off('SIGHUP', processSignalCleanup);
      process.off('SIGINT', processSignalCleanup);
      process.off('SIGTERM', processSignalCleanup);
      processSignalCleanup = null;
    }
  };
  const scheduleBrowserAutomationCleanup = () => {
    if (
      ownedProfile != null ||
      browserAutomationUserDataDir == null ||
      browserAutomationCleanupScheduled
    ) {
      return;
    }
    browserAutomationCleanupScheduled = true;
    try {
      const cleanup = spawn(
        process.execPath,
        ['-e', PROFILE_CLEANUP_SCRIPT, browserAutomationUserDataDir],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      cleanup.unref();
    } catch {}
  };
  const removeBrowserAutomationUserDataDir = () => {
    if (
      ownedProfile != null ||
      browserAutomationUserDataDir == null ||
      browserAutomationUserDataDirRemoved
    ) {
      return;
    }
    try {
      fs.rmSync(browserAutomationUserDataDir, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 50,
      });
      browserAutomationUserDataDirRemoved = true;
      removeProcessCleanupListeners();
    } catch {
      // Chromium can still be flushing the profile while signal handlers run.
      // A detached, bounded helper survives the parent exit and retries after
      // Playwright has reaped the browser process.
      scheduleBrowserAutomationCleanup();
      removeProcessCleanupListeners();
    }
  };
  if (browserAutomationUserDataDir != null && ownedProfile == null) {
    processExitCleanup = removeBrowserAutomationUserDataDir;
    processSignalCleanup = scheduleBrowserAutomationCleanup;
    process.once('exit', processExitCleanup);
    process.prependOnceListener('SIGHUP', processSignalCleanup);
    process.prependOnceListener('SIGINT', processSignalCleanup);
    process.prependOnceListener('SIGTERM', processSignalCleanup);
  }
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let disposePromise: Promise<void> | null = null;
  let abortRequested = signal?.aborted ?? false;
  let handleAbort: (() => void) | null = null;
  const dispose = () =>
    (disposePromise ??= (async () => {
      if (handleAbort != null) {
        signal?.removeEventListener('abort', handleAbort);
        handleAbort = null;
      }
      const contextBrowser = (() => {
        try {
          return context?.browser() ?? null;
        } catch {
          return null;
        }
      })();
      let contextCloseConfirmed = context == null;
      let browserCloseConfirmed = contextBrowser == null && browser == null;
      try {
        await context?.close();
        contextCloseConfirmed = true;
      } catch {}
      const cleanupBrowser = browser ?? contextBrowser;
      try {
        await cleanupBrowser?.close();
        browserCloseConfirmed = true;
      } catch {}
      const browserStillConnected = cleanupBrowser?.isConnected?.();
      if (
        browserStillConnected === true ||
        (browserStillConnected == null && !browserCloseConfirmed) ||
        (!contextCloseConfirmed && cleanupBrowser == null)
      ) {
        throw Object.assign(
          new Error('Managed Chromium cleanup is unconfirmed.'),
          { cleanupConfirmed: false },
        );
      }
      removeBrowserAutomationUserDataDir();
    })());
  handleAbort = () => {
    abortRequested = true;
    if (browser != null || context != null) {
      void dispose();
    }
  };
  signal?.addEventListener('abort', handleAbort, { once: true });
  const disposeIfAborted = async () => {
    if (!abortRequested && !signal?.aborted) {
      return;
    }
    await dispose();
    throw browserLaunchAbortError();
  };
  const browserArgs = [
    '--enable-webgl',
    // This dedicated browser only visits the local managed workspace. Keep
    // HTTPS enabled while accepting IWSDK's intentionally untrusted dev cert.
    '--ignore-certificate-errors',
    `--use-gl=${backend.useGl}`,
    `--use-angle=${backend.useAngle}`,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    ...(!browserAutomation
      ? []
      : ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0']),
  ];
  if (headless && browserAutomationUserDataDir == null) {
    const browserLaunchOptions: LaunchOptions = {
      args: browserArgs,
      // Keep Playwright's process-signal reaper as a last line of defense for
      // the detached Chromium process tree. The plugin installs synchronous
      // owned-session cleanup before launching, so Playwright may exit without
      // leaving stale workspace state.
      handleSIGHUP: true,
      handleSIGINT: true,
      handleSIGTERM: true,
      headless: true,
    };
    browser = await chromium.launch(browserLaunchOptions);
    await disposeIfAborted();
    context = await browser
      .newContext({
        ignoreHTTPSErrors: true,
        viewport,
      })
      .catch(async (error) => {
        await dispose();
        throw error;
      });
    await disposeIfAborted();
  } else {
    context = await chromium
      .launchPersistentContext(browserAutomationUserDataDir ?? '', {
        // Full Chromium implements the profile singleton in headless mode too.
        // Playwright's default headless-shell binary does not provide that fence.
        ...(ownedProfile ? { channel: 'chromium' } : {}),
        args: headless
          ? browserArgs
          : [...browserArgs, `--app=${MANAGED_APP_START_URL}`],
        handleSIGHUP: true,
        handleSIGINT: true,
        handleSIGTERM: true,
        headless,
        ...(headless ? {} : { ignoreDefaultArgs: ['about:blank'] }),
        ignoreHTTPSErrors: true,
        viewport,
      })
      .catch(async (error) => {
        await dispose();
        throw error;
      });
    await disposeIfAborted();
    const persistentBrowser = context.browser();
    if (persistentBrowser == null) {
      await dispose();
      throw new Error('Playwright app-mode browser is unavailable');
    }
    browser = persistentBrowser;
  }
  const browserAutomationEndpoint =
    !browserAutomation || browserAutomationUserDataDir == null
      ? null
      : (
          await readDevToolsActivePort(
            browserAutomationUserDataDir,
            signal,
            previousActivePort,
          ).catch(async (error) => {
            await dispose();
            throw error;
          })
        ).endpoint;
  await disposeIfAborted();
  try {
    let managedPageForAccess: Page | null = null;
    let managedTopLevelAuthorized = false;
    if (managedAccess) {
      const managedOrigin = launchUrl.origin;
      const normalizedAccessHeader = managedAccess.headerName.toLowerCase();
      await context.route('**/*', async (route) => {
        try {
          const request = route.request();
          const requestHeaders = request.headers();
          const requestUrl = parseUrl(request.url());
          let headersChanged = false;
          const headersWithoutAccess = Object.fromEntries(
            Object.entries(requestHeaders).flatMap(([name, value]) => {
              const normalizedName = name.toLowerCase();
              if (normalizedName === normalizedAccessHeader) {
                headersChanged = true;
                return [];
              }
              if (
                normalizedName === 'referer' &&
                requestUrl != null &&
                requestUrl.origin !== managedOrigin
              ) {
                const sanitized = scrubManagedWorkspaceReferrer(
                  value,
                  managedAccess.token,
                );
                headersChanged ||= sanitized !== value;
                return [[name, sanitized]];
              }
              return [[name, value]];
            }),
          );
          const continueWithoutAccess = async (url?: string) => {
            if (url != null) {
              await route.continue(
                headersChanged
                  ? { headers: headersWithoutAccess, url }
                  : { url },
              );
              return;
            }
            if (headersChanged) {
              await route.continue({ headers: headersWithoutAccess });
            } else {
              await route.continue();
            }
          };
          if (requestUrl == null) {
            await continueWithoutAccess();
            return;
          }
          const requestFrame = (() => {
            try {
              return request.frame();
            } catch {
              return null;
            }
          })();
          const frameUrl = requestFrame?.url() ?? '';
          const frameOrigin = parseUrl(frameUrl)?.origin ?? null;
          const parentFrameOrigin = (() => {
            try {
              return (
                parseUrl(requestFrame?.parentFrame()?.url() ?? '')?.origin ??
                null
              );
            } catch {
              return null;
            }
          })();
          const trustedInitiator =
            frameOrigin === managedOrigin ||
            (frameUrl === 'about:blank' && parentFrameOrigin === managedOrigin);
          if (request.isNavigationRequest()) {
            const isManagedTopLevelPage =
              requestFrame?.parentFrame() == null &&
              requestFrame?.page() === managedPageForAccess;
            const isManagedTopLevelNavigation =
              isManagedTopLevelPage &&
              requestUrl.origin === managedOrigin &&
              managedAccess.topLevelPathnames?.includes(requestUrl.pathname) ===
                true;
            const hasBootstrapToken =
              requestUrl.searchParams.get(MANAGED_WORKSPACE_QUERY) ===
              managedAccess.token;
            const canAuthorizeNavigation =
              isManagedTopLevelNavigation &&
              (hasBootstrapToken ||
                (managedTopLevelAuthorized && frameOrigin === managedOrigin));
            if (isManagedTopLevelPage) {
              managedTopLevelAuthorized = canAuthorizeNavigation;
            }
            if (canAuthorizeNavigation && !hasBootstrapToken) {
              const authorizedUrl = new URL(requestUrl);
              authorizedUrl.searchParams.set(
                MANAGED_WORKSPACE_QUERY,
                managedAccess.token,
              );
              await continueWithoutAccess(authorizedUrl.href);
              return;
            }
            await continueWithoutAccess();
            return;
          }
          const isProtectedPath =
            requestUrl.origin === managedOrigin &&
            managedAccess.pathnames.includes(requestUrl.pathname);
          const needsAccess = trustedInitiator && isProtectedPath;
          if (!needsAccess) {
            await continueWithoutAccess();
            return;
          }
          const headers = {
            ...headersWithoutAccess,
            [managedAccess.headerName]: managedAccess.token,
          };
          const response = await route.fetch({ headers, maxRedirects: 0 });
          await route.fulfill({ response });
        } catch {
          // Never fall back to the original request after a privileged fetch
          // fails: it may still carry the managed-access header. Abort it so the
          // route always settles without leaking authority.
          await route.abort('failed').catch(() => {});
        }
      });
    }
    const page =
      context.pages().find((candidate) => !candidate.isClosed()) ??
      (await context.newPage());
    if (managedAccess?.runtimeIdentity) {
      await context.addInitScript((identity) => {
        (window as any).__IWSDK_RUNTIME_IDENTITY = identity;
      }, managedAccess.runtimeIdentity);
    }
    page.setDefaultTimeout(DEFAULT_BROWSER_OPERATION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(DEFAULT_BROWSER_OPERATION_TIMEOUT_MS);
    managedPageForAccess = page;
    return {
      browser,
      browserAutomationEndpoint,
      context,
      dispose,
      page,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export async function navigateAndVerifyManagedPage({
  browserAutomationEndpoint,
  context,
  managedWorkspaceToken,
  page,
  readiness,
  renderMode = 'continuous',
  waitForRuntime = true,
  signal,
  traceMcp,
  url,
}: {
  browserAutomationEndpoint: string | null;
  context: BrowserContext;
  managedWorkspaceToken: string | null;
  page: Page;
  readiness: ManagedBrowserReadiness;
  renderMode?: ManagedRenderMode;
  waitForRuntime?: boolean;
  signal?: AbortSignal;
  traceMcp: boolean;
  url: string;
}): Promise<{ endpoint: string; targetId: string } | null> {
  throwIfLaunchAborted(signal);
  if (managedWorkspaceToken != null) {
    await page.addInitScript((queryName) => {
      if (window.top !== window) {
        return;
      }
      const currentUrl = new URL(window.location.href);
      if (!currentUrl.searchParams.has(queryName)) {
        return;
      }
      currentUrl.searchParams.delete(queryName);
      history.replaceState(
        history.state,
        '',
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );
    }, MANAGED_WORKSPACE_QUERY);
  }
  // Re-emit unhandled promise rejections through the console capture listener.
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const text =
        reason instanceof Error
          ? reason.stack || `${reason.name}: ${reason.message}`
          : String(reason);
      console.error(`[unhandledrejection] ${text}`);
    });
  });
  await page.addInitScript(
    ({ renderMode, traceEnabled }) => {
      (window as any).__IWER_MCP_MANAGED = true;
      (window as any).__IWSDK_MCP_TRACE = traceEnabled;
      (window as any).__IWSDK_MANAGED_BROWSER_TARGET = true;
      (window as any).__IWSDK_RENDER_MODE = renderMode;
    },
    { renderMode, traceEnabled: traceMcp },
  );
  try {
    await page.goto(url, { waitUntil: 'commit' });
  } catch (error) {
    throwIfLaunchAborted(signal);
    throw error;
  }
  const readinessDeadline = Date.now() + MANAGED_BROWSER_STARTUP_TIMEOUT_MS;
  let lastReadinessError: unknown = null;
  while (waitForRuntime && Date.now() < readinessDeadline) {
    throwIfLaunchAborted(signal);
    try {
      const readinessFrame =
        readiness === 'iwer'
          ? await resolveApplicationFrame(page)
          : page.mainFrame();
      await readinessFrame.waitForFunction(
        (target: ManagedBrowserReadiness) =>
          target === 'iwer'
            ? (window as any).IWER_DEVICE !== undefined
            : (window as any).__IWSDK_SCENE_EDITOR_READY === true,
        readiness,
        { timeout: Math.max(100, readinessDeadline - Date.now()) },
      );
      lastReadinessError = null;
      break;
    } catch (error) {
      throwIfLaunchAborted(signal);
      lastReadinessError = error;
      const retryableReload =
        /execution context was destroyed|frame was detached|navigation|application frame is unavailable/i.test(
          errorMessage(error),
        );
      if (!retryableReload || page.isClosed()) {
        throw error;
      }
      await page.waitForTimeout(
        Math.min(100, Math.max(1, readinessDeadline - Date.now())),
      );
    }
  }
  if (lastReadinessError != null) {
    throw new Error(
      `Managed browser did not become ${readiness}-ready within ${MANAGED_BROWSER_STARTUP_TIMEOUT_MS}ms: ${errorMessage(
        lastReadinessError,
      )}`,
    );
  }
  throwIfLaunchAborted(signal);
  return browserAutomationEndpoint == null
    ? null
    : {
        endpoint: browserAutomationEndpoint,
        targetId: await verifyAutomationTarget(
          browserAutomationEndpoint,
          context,
          page,
          signal,
        ),
      };
}
