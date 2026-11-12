/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Frame } from 'playwright';

/**
 * Render loop policy for the managed application. Headless sessions default to
 * `'on-demand'`: systems run every frame but nothing is drawn until a tool
 * needs pixels, so a GPU-less host does not software-rasterize every frame.
 */
export type ManagedRenderMode = 'continuous' | 'on-demand';

const warnedRenderModeOverrides = new Set<string>();

/**
 * Resolve the render mode for a managed browser session. Headed sessions are
 * always continuous because a person is watching them. `IWSDK_DEV_RENDER_MODE`
 * (`continuous` or `on-demand`, case-insensitive) overrides the headless
 * default; any other value is reported once and ignored.
 */
export function resolveManagedRenderMode(
  headless: boolean,
  override: string | undefined = process.env.IWSDK_DEV_RENDER_MODE,
  warn: (message: string) => void = console.warn,
): ManagedRenderMode {
  if (!headless) {
    return 'continuous';
  }
  const normalized = override?.trim().toLowerCase();
  if (!normalized) {
    return 'on-demand';
  }
  if (normalized === 'continuous' || normalized === 'on-demand') {
    return normalized;
  }
  if (!warnedRenderModeOverrides.has(normalized)) {
    warnedRenderModeOverrides.add(normalized);
    warn(
      `[IWSDK Dev] Ignoring IWSDK_DEV_RENDER_MODE=${JSON.stringify(override)}: expected "continuous" or "on-demand". Headless sessions render on demand.`,
    );
  }
  return 'on-demand';
}

/**
 * Draw `frames` fresh frames in the application frame and wait until they have
 * been handed to the compositor. Apps that do not expose `requestRender`
 * (non-IWSDK runtimes, older @iwsdk/core) are left alone.
 */
export async function requestApplicationRender(
  frame: Frame,
  frames = 1,
  timeoutMs = 10000,
): Promise<void> {
  await frame.evaluate(
    ({ frames, timeoutMs }) => {
      const runtime = (window as any).FRAMEWORK_MCP_RUNTIME;
      if (typeof runtime?.requestRender !== 'function') {
        return;
      }
      return Promise.race([
        runtime.requestRender(frames),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
    { frames, timeoutMs },
  );
}

/**
 * Whether a frame the application draws stays on its canvas until the next
 * draw. False under the emulator's default per-frame clear in immersive
 * sessions; the injected runtime turns that clear off for on-demand sessions
 * and sets `__IWSDK_KEEPS_DRAWN_FRAMES`.
 */
export async function applicationKeepsDrawnFrames(
  frame: Frame,
): Promise<boolean> {
  return frame
    .evaluate(() => (window as any).__IWSDK_KEEPS_DRAWN_FRAMES === true)
    .catch(() => false);
}

/**
 * Start drawing every frame in the application until the returned function is
 * called. Holds are counted by the runtime, so overlapping holds (a capture
 * during a profile) cannot end each other early. Returns `null` when the app
 * does not support render holds (non-IWSDK runtimes, older @iwsdk/core); such
 * apps draw continuously anyway.
 */
export async function acquireApplicationRenderHold(
  frame: Frame,
): Promise<string | null> {
  return frame.evaluate(() => {
    const runtime = (window as any).FRAMEWORK_MCP_RUNTIME;
    return typeof runtime?.acquireRenderHold === 'function'
      ? (runtime.acquireRenderHold() as string)
      : null;
  });
}

/**
 * Release a hold from {@link acquireApplicationRenderHold}. A reload drops
 * every hold with the page, so a missing runtime is not an error.
 */
export async function releaseApplicationRenderHold(
  frame: Frame,
  id: string | null,
): Promise<void> {
  if (id == null) {
    return;
  }
  await frame
    .evaluate((id) => {
      (window as any).FRAMEWORK_MCP_RUNTIME?.releaseRenderHold?.(id);
    }, id)
    .catch(() => {});
}

/**
 * Run `fn` with the application drawing every frame. Profiling, runtime
 * evidence and pixel captures under the emulator's per-frame clear need real
 * frames, which on-demand rendering would otherwise skip.
 */
export async function withApplicationRenderHold<T>(
  frame: Frame,
  fn: () => Promise<T>,
): Promise<T> {
  const id = await acquireApplicationRenderHold(frame);
  try {
    return await fn();
  } finally {
    await releaseApplicationRenderHold(frame, id);
  }
}

/** The application's render mode, or `null` when it does not report one. */
export async function readApplicationRenderMode(
  frame: Frame,
): Promise<ManagedRenderMode | null> {
  return frame
    .evaluate(() => {
      const mode = (window as any).FRAMEWORK_MCP_RUNTIME?.renderMode;
      return mode === 'continuous' || mode === 'on-demand' ? mode : null;
    })
    .catch(() => null);
}

/** Longest a capture waits for its fresh frame before capturing anyway. */
const MAX_RENDER_REQUEST_MS = 10_000;

/**
 * Capture pixels from an application that may render on demand. When drawn
 * frames persist, one fresh frame is requested and captured. Otherwise (the
 * emulator clears the canvas every immersive frame) rendering is held for the
 * whole capture so the frame on screen is always current. The render request
 * gets a bounded share of `timeoutMs`; `capture` receives what is left.
 */
export async function captureFreshApplicationFrame<T>(
  frame: Frame,
  timeoutMs: number,
  capture: (remainingMs: number) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const renderBudgetMs = Math.max(
    1,
    Math.min(timeoutMs, MAX_RENDER_REQUEST_MS),
  );
  const remaining = () => Math.max(1, timeoutMs - (Date.now() - startedAt));
  if (await applicationKeepsDrawnFrames(frame)) {
    await requestApplicationRender(frame, 1, renderBudgetMs);
    return capture(remaining());
  }
  return withApplicationRenderHold(frame, async () => {
    await requestApplicationRender(frame, 1, renderBudgetMs);
    return capture(remaining());
  });
}

/** Tracks one render hold across a page that may reload. */
export interface RenderHoldTracker {
  /**
   * Make sure `frame` holds rendering. Retries while the runtime is not ready
   * (no hold yet), and takes a new hold when the frame object changes.
   */
  ensure(frame: Frame): Promise<void>;
  /** Release the current hold, if any. Never throws. */
  release(): Promise<void>;
}

/**
 * Create a {@link RenderHoldTracker}. Evidence collection waits for a
 * reloaded runtime to appear; a hold requested before it exists comes back
 * `null` and must be requested again once it does.
 */
export function createRenderHoldTracker(): RenderHoldTracker {
  let current: { frame: Frame; id: string | null } | null = null;
  return {
    async ensure(frame) {
      if (current?.frame === frame && current.id != null) {
        return;
      }
      if (current != null && current.frame !== frame) {
        await releaseApplicationRenderHold(current.frame, current.id);
      }
      const id = await acquireApplicationRenderHold(frame).catch(() => null);
      current = { frame, id };
    },
    async release() {
      if (current == null) {
        return;
      }
      const { frame, id } = current;
      current = null;
      await releaseApplicationRenderHold(frame, id);
    },
  };
}
