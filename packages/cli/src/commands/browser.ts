/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { randomUUID } from 'crypto';
import { existsSync, realpathSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseIntegerOption } from '../argv.js';
import { acquireBrowserLease } from '../browser-lease.js';
import { createSuccess } from '../cli-results.js';
import type { CliOptions, CliSuccess, ResolvedCliIo } from '../cli-types.js';
import { getRuntimeSession, resolveWorkspaceRoot } from '../runtime-state.js';
import { RuntimeCommandExecutionError } from '../runtime-transport.js';

interface BrowserRunnerContext {
  browser: any;
  context: any;
  page: any;
  frame: any;
  cdp: any;
  signal: AbortSignal;
  workspaceRoot: string;
}

const MAX_RUNNER_RESULT_BYTES = 1024 * 1024;

async function getPageTargetId(context: any, page: any): Promise<string> {
  const cdp = await context.newCDPSession(page);
  try {
    const response = await cdp.send('Target.getTargetInfo');
    const targetId = response?.targetInfo?.targetId;
    return typeof targetId === 'string' ? targetId : '';
  } finally {
    await cdp.detach().catch(() => {});
  }
}

export async function selectManagedBrowserPage(
  browser: any,
  managedOrigin: string,
  expectedTargetId: string,
): Promise<{ context: any; page: any }> {
  const originCandidates = browser
    .contexts()
    .flatMap((candidateContext: any) =>
      candidateContext.pages().map((candidatePage: any) => ({
        context: candidateContext,
        page: candidatePage,
      })),
    )
    .filter(({ page: candidatePage }: any) => {
      try {
        return new URL(candidatePage.url()).origin === managedOrigin;
      } catch {
        return false;
      }
    });
  const managedCandidates = [];
  for (const candidate of originCandidates) {
    const opener =
      typeof candidate.page.opener === 'function'
        ? await candidate.page.opener().catch(() => null)
        : null;
    if (opener != null) {
      continue;
    }
    const [targetId, marked] = await Promise.all([
      getPageTargetId(candidate.context, candidate.page).catch(() => ''),
      candidate.page
        .evaluate(
          () => (globalThis as any).__IWSDK_MANAGED_BROWSER_TARGET === true,
        )
        .catch(() => false),
    ]);
    if (targetId === expectedTargetId && marked) {
      managedCandidates.push(candidate);
    }
  }
  if (managedCandidates.length !== 1) {
    throw new Error(
      `Expected exactly one verified managed application page; found ${managedCandidates.length}`,
    );
  }
  return managedCandidates[0]!;
}

function validateAutomationEndpoint(endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Managed browser automation endpoint is invalid');
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (
    parsed.protocol !== 'http:' ||
    !loopbackHosts.has(parsed.hostname) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      'Managed browser automation endpoint must use loopback HTTP',
    );
  }
  return parsed.href;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error(`browser run timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer != null) {
      clearTimeout(timer);
    }
  });
}

const DESTRUCTIVE_CDP_METHODS = new Set([
  'Browser.close',
  'Page.close',
  'Target.closeTarget',
  'Target.disposeBrowserContext',
]);

function protectCdpOwnership(cdp: any): void {
  const send = cdp.send.bind(cdp);
  cdp.send = async (method: string, params?: unknown) => {
    if (DESTRUCTIVE_CDP_METHODS.has(method)) {
      throw new Error(
        `Direct CDP method ${method} is blocked for IWSDK-owned browser resources`,
      );
    }
    return send(method, params);
  };
}

export function protectManagedOwnership(
  browser: any,
  context: any,
  page: any,
  cdp: any,
): void {
  const deny = () => {
    throw new Error(
      'The managed browser, context, and application page are owned by IWSDK; direct close operations are blocked in browser run scripts.',
    );
  };
  browser.close = deny;
  context.close = deny;
  page.close = deny;
  protectCdpOwnership(cdp);

  const newContextCdp = context.newCDPSession?.bind(context);
  if (newContextCdp) {
    context.newCDPSession = async (...args: unknown[]) => {
      const session = await newContextCdp(...args);
      protectCdpOwnership(session);
      return session;
    };
  }

  const newBrowserCdp = browser.newBrowserCDPSession?.bind(browser);
  if (newBrowserCdp) {
    browser.newBrowserCDPSession = async (...args: unknown[]) => {
      const session = await newBrowserCdp(...args);
      protectCdpOwnership(session);
      return session;
    };
  }
}

function serializeRunnerResult(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('browser run result must be JSON-serializable');
  }
  if (serialized == null) {
    throw new Error('browser run result must be JSON-serializable');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RUNNER_RESULT_BYTES) {
    throw new Error(
      `browser run result exceeds ${MAX_RUNNER_RESULT_BYTES} bytes`,
    );
  }
  return JSON.parse(serialized);
}

/** The part of a Playwright frame {@link withRenderHold} needs. */
interface RenderHoldFrame {
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

/**
 * Run `fn` with the managed app drawing every frame, then release the hold,
 * also when `fn` throws. Apps without render holds (non-IWSDK runtimes, older
 * @iwsdk/core) always draw continuously, so `fn` simply runs.
 */
export async function withRenderHold<T>(
  frame: RenderHoldFrame,
  fn: () => Promise<T>,
): Promise<T> {
  const id = await frame
    .evaluate(() => {
      const runtime = (globalThis as any).FRAMEWORK_MCP_RUNTIME;
      return typeof runtime?.acquireRenderHold === 'function'
        ? (runtime.acquireRenderHold() as string)
        : null;
    }, undefined)
    .catch(() => null);
  try {
    return await fn();
  } finally {
    if (id != null) {
      await frame
        .evaluate((holdId: string) => {
          (globalThis as any).FRAMEWORK_MCP_RUNTIME?.releaseRenderHold?.(
            holdId,
          );
        }, id)
        .catch(() => {});
    }
  }
}

export async function handleBrowserRun(
  scriptArgument: string | undefined,
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown>> {
  if (!scriptArgument) {
    throw new Error('Usage: iwsdk browser run <workspace-script.mjs>');
  }
  const workspaceRoot = await resolveWorkspaceRoot({
    cwd: io.cwd,
    workspace:
      typeof options.workspace === 'string' ? options.workspace : undefined,
    requireRunning: true,
  });
  const requestedScriptPath = path.resolve(io.cwd, scriptArgument);
  const requestedDirectory = path.dirname(requestedScriptPath);
  // Workspace discovery canonicalizes directory aliases (for example macOS
  // /var -> /private/var). Compare paths in the same namespace, while leaving
  // a symlink on the script itself for the separate containment check below.
  const scriptPath = path.join(
    existsSync(requestedDirectory)
      ? realpathSync.native(requestedDirectory)
      : requestedDirectory,
    path.basename(requestedScriptPath),
  );
  const relativeScriptPath = path.relative(workspaceRoot, scriptPath);
  if (
    relativeScriptPath === '..' ||
    relativeScriptPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeScriptPath)
  ) {
    throw new Error('browser run script must stay inside the IWSDK workspace');
  }
  if (!existsSync(scriptPath)) {
    throw new Error(`browser run script does not exist: ${relativeScriptPath}`);
  }
  const realWorkspaceRoot = realpathSync(workspaceRoot);
  const realScriptPath = realpathSync(scriptPath);
  const realRelativeScriptPath = path.relative(
    realWorkspaceRoot,
    realScriptPath,
  );
  if (
    realRelativeScriptPath === '..' ||
    realRelativeScriptPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelativeScriptPath)
  ) {
    throw new Error(
      'browser run script symlinks must stay inside the IWSDK workspace',
    );
  }
  const session = await getRuntimeSession(workspaceRoot);
  if (!session) {
    throw new Error('Managed browser runtime session is unavailable');
  }
  const automation = session.browserAutomation;
  const automationConfigured =
    automation?.configured ?? automation?.enabled ?? false;
  if (!automationConfigured) {
    throw new Error(
      'Managed browser automation is disabled. Start with "iwsdk dev up --allow-browser-automation" or restart with "iwsdk dev restart --allow-browser-automation".',
    );
  }
  const endpoint = automation?.endpoint;
  const expectedTargetId = automation?.targetId;
  if (!automation?.enabled || !endpoint || !expectedTargetId) {
    throw new Error(
      'Managed browser automation is configured, but the managed browser is not running. Retry after the browser relaunches or restart the dev session.',
    );
  }
  if (automation.protocol !== 'cdp') {
    throw new Error('Managed browser automation protocol is unsupported');
  }
  const automationEndpoint = validateAutomationEndpoint(endpoint);
  const timeoutMs = parseIntegerOption(options.timeout, '--timeout', 60_000);

  const requireFromWorkspace = createRequire(
    path.join(workspaceRoot, 'package.json'),
  );
  let playwright: any;
  try {
    playwright = requireFromWorkspace('playwright');
  } catch {
    try {
      let requireFromPlugin: NodeRequire;
      try {
        const pluginEntry = requireFromWorkspace.resolve(
          '@iwsdk/vite-plugin-dev',
        );
        requireFromPlugin = createRequire(pluginEntry);
      } catch {
        // The package exports only an ESM entry, so CommonJS resolution can
        // reject the package root even though the dependency is installed.
        requireFromPlugin = createRequire(
          path.join(
            workspaceRoot,
            'node_modules',
            '@iwsdk',
            'vite-plugin-dev',
            'package.json',
          ),
        );
      }
      playwright = requireFromPlugin('playwright');
    } catch {
      throw new Error(
        'The workspace does not expose Playwright through @iwsdk/vite-plugin-dev. Reinstall the IWSDK development dependencies.',
      );
    }
  }

  if (session.browser?.lifecycle && timeoutMs > 110000) {
    throw new Error(
      'Managed browser scripts are limited to 110000ms per lease.',
    );
  }
  const browser = await playwright.chromium.connectOverCDP(automationEndpoint, {
    timeout: Math.min(timeoutMs, 30_000),
  });
  // For a connectOverCDP browser, Playwright's close implementation disconnects
  // the secondary CDP transport. Capture it before scripts receive protected
  // wrappers; closing the shared client connection can tear down the owner.
  const disconnectBrowser = browser.close.bind(browser);
  let lease: Awaited<ReturnType<typeof acquireBrowserLease>> | null = null;
  try {
    // Connecting is read-only. Acquire exclusive ownership immediately after
    // connection so the complete lease budget remains available to the script.
    lease = session.browser?.lifecycle
      ? await acquireBrowserLease(session, timeoutMs + 5000)
      : null;
  } catch (error) {
    await disconnectBrowser().catch(() => {});
    throw error;
  }
  let cdp: any = null;
  const cleanup: { detachCdp: (() => Promise<void>) | null } = {
    detachCdp: null,
  };
  const abortController = new AbortController();
  let runnerSettled = false;
  try {
    const runnerOperation = (async () => {
      try {
        const managedOrigin = new URL(session.localUrl).origin;
        const selected = await selectManagedBrowserPage(
          browser,
          managedOrigin,
          expectedTargetId,
        );
        const { context, page } = selected;
        const pageUrl = new URL(page.url());
        // Keep this small DOM-boundary resolver local to the CLI runner. The
        // plugin's resolver owns a live Playwright Page and is intentionally
        // private; exporting it would couple the CLI to plugin internals while
        // still requiring separate serialization across the CDP connection.
        const workspacePath =
          pageUrl.pathname === '/__iwsdk/workspace' ||
          pageUrl.pathname.startsWith('/__iwsdk/workspace/');
        const workspaceDataset = workspacePath
          ? false
          : await page.evaluate(
              () =>
                (globalThis as any).document.documentElement.dataset
                  .iwsdkWorkspaceView != null,
            );
        const hasWorkspaceMarker = workspacePath || workspaceDataset;
        const frameElement = hasWorkspaceMarker
          ? await page.$('#workspace-runtime-frame')
          : null;
        const frame = await frameElement?.contentFrame();
        if (hasWorkspaceMarker && !frame) {
          throw new Error('IWSDK workspace application frame is unavailable');
        }
        cdp = await context.newCDPSession(page);
        cleanup.detachCdp = cdp.detach.bind(cdp);
        protectManagedOwnership(browser, context, page, cdp);

        const moduleUrl = `${pathToFileURL(realScriptPath).href}?iwsdk_run=${randomUUID()}`;
        const scriptModule = (await import(moduleUrl)) as {
          default?: (input: BrowserRunnerContext) => unknown | Promise<unknown>;
          run?: (input: BrowserRunnerContext) => unknown | Promise<unknown>;
        };
        const run = scriptModule.default ?? scriptModule.run;
        if (typeof run !== 'function') {
          throw new Error(
            'browser run script must export a default async function or named run function',
          );
        }
        // Scripts may capture pixels themselves (page.screenshot), which the
        // managed session's on-demand rendering would leave stale.
        const appFrame = frame ?? page.mainFrame();
        const result = await withRenderHold(appFrame, async () =>
          run({
            browser,
            cdp,
            context,
            frame: appFrame,
            page,
            signal: abortController.signal,
            workspaceRoot,
          }),
        );
        return createSuccess({
          operation: 'browser.run',
          result: serializeRunnerResult(result),
          script: realRelativeScriptPath.split(path.sep).join('/'),
          workspaceRoot,
        });
      } finally {
        // A settled script (success or rejection) no longer owns awaited CDP
        // work and may release normally. A timeout or lost lease leaves this
        // false until the abandoned operation actually settles, so the server
        // retires the browser instead of admitting overlapping commands.
        runnerSettled = true;
      }
    })();
    const execution = withTimeout(runnerOperation, timeoutMs, () =>
      abortController.abort(),
    );
    try {
      return await (lease ? Promise.race([execution, lease.lost]) : execution);
    } catch (error) {
      abortController.abort();
      if (error instanceof RuntimeCommandExecutionError) {
        throw error;
      }
      throw new RuntimeCommandExecutionError(
        error instanceof Error ? error.message : String(error),
        {
          details: {
            code: 'browser_run_failed',
            outcome: 'outcome_unknown',
          },
        },
      );
    }
  } finally {
    if (cleanup.detachCdp != null) {
      try {
        await cleanup.detachCdp();
      } catch {}
    }
    try {
      await disconnectBrowser();
    } catch {}
    if (runnerSettled) {
      lease?.release();
    } else {
      lease?.abandon();
    }
  }
}
