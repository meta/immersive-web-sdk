/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { randomUUID } from 'crypto';
import type { Frame, Locator, Page } from 'playwright';
import sharp from 'sharp';
import {
  applicationIdentityChanged,
  DEFAULT_BROWSER_OPERATION_TIMEOUT_MS,
  getApplicationMetadata,
  getApplicationState,
  resolveApplicationFrame,
  withRuntimeView,
  type BrowserApplicationMetadata,
} from './application-surface.js';
import { errorMessage, parseUrl } from './internals.js';
import { describeElements, readApplicationIdentity } from './page-probes.js';
import { captureFreshApplicationFrame } from './render-mode.js';

const MAX_SNAPSHOT_RECIPES = 2_000;

const MAX_SNAPSHOT_BYTES = 256 * 1024;

const MAX_SNAPSHOT_CANDIDATES = 4_000;

interface ScreenshotClip {
  height: number;
  width: number;
  x: number;
  y: number;
}

function requireVisibleScreenshotClip(
  clip: ScreenshotClip | null,
  label: string,
): ScreenshotClip {
  if (
    clip == null ||
    ![clip.x, clip.y, clip.width, clip.height].every(Number.isFinite) ||
    clip.width <= 0 ||
    clip.height <= 0
  ) {
    throw Object.assign(new Error(`${label} is not visible`), {
      retryable: true,
    });
  }
  return clip;
}

function intersectScreenshotClips(
  target: ScreenshotClip,
  boundary: ScreenshotClip,
  label: string,
): ScreenshotClip {
  const x = Math.max(target.x, boundary.x);
  const y = Math.max(target.y, boundary.y);
  return requireVisibleScreenshotClip(
    {
      x,
      y,
      width: Math.min(target.x + target.width, boundary.x + boundary.width) - x,
      height:
        Math.min(target.y + target.height, boundary.y + boundary.height) - y,
    },
    label,
  );
}

const MAX_FULL_PAGE_PIXELS = 32_000_000;
const MAX_FULL_PAGE_TILES = 64;
const KEY_RELEASE_CLEANUP_TIMEOUT_MS = 250;
const KEY_RELEASE_FOCUS_TIMEOUT_MS = 100;
const WORKSPACE_SCREENSHOT_STYLE =
  'html[data-iwsdk-workspace-view] .workspace-view-switcher { visibility: hidden !important; }';

interface ScreenshotScroll {
  x: number;
  y: number;
}

async function restoreScreenshotScroll(
  frame: Frame,
  scroll: ScreenshotScroll,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      frame.evaluate(
        ({ x, y }) => window.scrollTo({ behavior: 'instant', left: x, top: y }),
        scroll,
      ),
      new Promise<void>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out restoring screenshot scroll')),
          1_000,
        );
      }),
    ]);
  } finally {
    if (timer != null) {
      clearTimeout(timer);
    }
  }
}

async function withRestoredScroll<T>(
  frames: Frame[],
  operation: () => Promise<T>,
  onRestoreError: (error: unknown) => void,
): Promise<T> {
  const positions = await Promise.all(
    frames.map(async (frame) => ({
      frame,
      ...(await frame.evaluate(() => ({ x: scrollX, y: scrollY }))),
    })),
  );
  try {
    return await operation();
  } finally {
    for (const { frame, x, y } of positions.reverse()) {
      await restoreScreenshotScroll(frame, { x, y }).catch(onRestoreError);
    }
  }
}

async function scrollFramedApplicationIntoView(
  frame: Frame,
): Promise<ScreenshotClip> {
  const element = await frame.frameElement();
  try {
    await element.evaluate((node) =>
      (node as Element).scrollIntoView({
        behavior: 'instant',
        block: 'start',
        inline: 'start',
      }),
    );
    return requireVisibleScreenshotClip(
      await element.boundingBox(),
      'IWSDK workspace application frame',
    );
  } finally {
    await element.dispose().catch(() => {});
  }
}

async function resolveFramedApplicationContentClip(
  frame: Frame,
  viewport: {
    height: number;
    innerHeight: number;
    innerWidth: number;
    width: number;
  },
): Promise<ScreenshotClip> {
  const element = await frame.frameElement();
  try {
    await element.evaluate((node) =>
      (node as Element).scrollIntoView({
        behavior: 'instant',
        block: 'start',
        inline: 'start',
      }),
    );
    const borderBox = requireVisibleScreenshotClip(
      await element.boundingBox(),
      'IWSDK workspace application frame',
    );
    const elementMetrics = await element.evaluate((node) => {
      const element = node as HTMLElement;
      return {
        clientHeight: element.clientHeight,
        clientLeft: element.clientLeft,
        clientTop: element.clientTop,
        clientWidth: element.clientWidth,
        offsetHeight: element.offsetHeight,
        offsetWidth: element.offsetWidth,
      };
    });
    if (
      ![
        elementMetrics.clientHeight,
        elementMetrics.clientWidth,
        elementMetrics.offsetHeight,
        elementMetrics.offsetWidth,
        viewport.height,
        viewport.innerHeight,
        viewport.innerWidth,
        viewport.width,
      ].every((value) => Number.isFinite(value) && value > 0)
    ) {
      throw Object.assign(
        new Error('Application frame has invalid screenshot dimensions'),
        { retryable: true },
      );
    }

    const borderScaleX = borderBox.width / elementMetrics.offsetWidth;
    const borderScaleY = borderBox.height / elementMetrics.offsetHeight;
    const contentScaleX =
      (elementMetrics.clientWidth * borderScaleX) / viewport.innerWidth;
    const contentScaleY =
      (elementMetrics.clientHeight * borderScaleY) / viewport.innerHeight;
    return requireVisibleScreenshotClip(
      {
        x: borderBox.x + elementMetrics.clientLeft * borderScaleX,
        y: borderBox.y + elementMetrics.clientTop * borderScaleY,
        width: viewport.width * contentScaleX,
        height: viewport.height * contentScaleY,
      },
      'IWSDK workspace application content',
    );
  } finally {
    await element.dispose().catch(() => {});
  }
}

function tileOffsets(total: number, viewport: number): number[] {
  const maximum = Math.max(0, total - viewport);
  return Array.from(
    { length: Math.max(1, Math.ceil(total / viewport)) },
    (_, index) => Math.min(index * viewport, maximum),
  );
}

async function normalizeScreenshotTile(
  bytes: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  // With viewport:null (the default headed workspace), Chromium returns clip
  // pixels at the host display scale even when Playwright receives scale:'css'.
  // Stitching uses CSS-pixel coordinates, so normalize every tile at that
  // boundary instead of relying on a context deviceScaleFactor that cannot be
  // configured for a native viewport.
  const metadata = await sharp(bytes).metadata();
  if (metadata.width === width && metadata.height === height) {
    return bytes;
  }
  return sharp(bytes)
    .resize(width, height, { fit: 'fill', kernel: 'nearest' })
    .png()
    .toBuffer();
}

async function captureFramedFullPage(
  page: Page,
  frame: Frame,
  format: 'jpeg' | 'png',
  quality: number,
  timeoutMs: number,
  onRestoreError: (error: unknown) => void,
): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    const value = Math.floor(deadline - Date.now());
    if (value <= 0) {
      throw Object.assign(new Error('browser_screenshot timed out'), {
        retryable: true,
      });
    }
    return value;
  };
  remaining();
  const metrics = await frame.evaluate(() => {
    const body = document.body;
    const root = document.documentElement;
    return {
      height: Math.max(
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
        root.scrollHeight,
        root.offsetHeight,
        root.clientHeight,
        innerHeight,
      ),
      scroll: { x: scrollX, y: scrollY },
      innerHeight,
      innerWidth,
      viewportHeight: root.clientHeight,
      viewportWidth: root.clientWidth,
      width: Math.max(
        body?.scrollWidth ?? 0,
        body?.offsetWidth ?? 0,
        root.scrollWidth,
        root.offsetWidth,
        root.clientWidth,
        innerWidth,
      ),
    };
  });
  remaining();
  if (
    ![
      metrics.height,
      metrics.viewportHeight,
      metrics.viewportWidth,
      metrics.width,
    ].every((value) => Number.isFinite(value) && value > 0)
  ) {
    throw Object.assign(
      new Error('Application document has invalid screenshot dimensions'),
      { retryable: true },
    );
  }
  const xOffsets = tileOffsets(metrics.width, metrics.viewportWidth);
  const yOffsets = tileOffsets(metrics.height, metrics.viewportHeight);
  if (
    metrics.width * metrics.height > MAX_FULL_PAGE_PIXELS ||
    xOffsets.length * yOffsets.length > MAX_FULL_PAGE_TILES
  ) {
    throw Object.assign(
      new Error('Application document exceeds full-page screenshot limits'),
      { code: 'browser_screenshot_too_large', retryable: false },
    );
  }

  try {
    const desiredClip = await resolveFramedApplicationContentClip(frame, {
      height: metrics.viewportHeight,
      innerHeight: metrics.innerHeight,
      innerWidth: metrics.innerWidth,
      width: metrics.viewportWidth,
    });
    remaining();
    const viewport = await page.evaluate(() => ({
      height: document.documentElement.clientHeight,
      width: document.documentElement.clientWidth,
    }));
    remaining();
    const clip = intersectScreenshotClips(
      desiredClip,
      { height: viewport.height, width: viewport.width, x: 0, y: 0 },
      'IWSDK workspace application content',
    );
    if (
      [
        clip.x - desiredClip.x,
        clip.y - desiredClip.y,
        clip.width - desiredClip.width,
        clip.height - desiredClip.height,
      ].some((difference) => Math.abs(difference) > 1)
    ) {
      throw Object.assign(
        new Error('IWSDK workspace application frame is partially obscured'),
        { retryable: true },
      );
    }

    // All placement happens in the normalized output-pixel coordinate system.
    // Ceil the tile dimensions and floor absolute offsets so adjacent tiles can
    // overlap by at most one pixel but can never leave an unpainted seam.
    const tileWidth = Math.max(1, Math.ceil(clip.width));
    const tileHeight = Math.max(1, Math.ceil(clip.height));
    const scaleX = tileWidth / metrics.viewportWidth;
    const scaleY = tileHeight / metrics.viewportHeight;
    const width = Math.max(tileWidth, Math.ceil(metrics.width * scaleX));
    const height = Math.max(tileHeight, Math.ceil(metrics.height * scaleY));
    if (width * height > MAX_FULL_PAGE_PIXELS) {
      throw Object.assign(
        new Error('Application document exceeds full-page screenshot limits'),
        { code: 'browser_screenshot_too_large', retryable: false },
      );
    }

    const layers: Array<{ input: Buffer; left: number; top: number }> = [];
    const seen = new Set<string>();
    for (const y of yOffsets) {
      for (const x of xOffsets) {
        const actual = await frame.evaluate(
          (point) => {
            scrollTo({ behavior: 'instant', left: point.x, top: point.y });
            return { x: scrollX, y: scrollY };
          },
          { x, y },
        );
        remaining();
        const key = `${actual.x}:${actual.y}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const tile = Buffer.from(
          await page.screenshot({
            clip,
            scale: 'css',
            style: WORKSPACE_SCREENSHOT_STYLE,
            timeout: remaining(),
            type: 'png',
          }),
        );
        remaining();
        const normalizedTile = await normalizeScreenshotTile(
          tile,
          tileWidth,
          tileHeight,
        );
        remaining();
        layers.push({
          input: normalizedTile,
          left: Math.min(
            Math.floor(actual.x * scaleX),
            Math.max(0, width - tileWidth),
          ),
          top: Math.min(
            Math.floor(actual.y * scaleY),
            Math.max(0, height - tileHeight),
          ),
        });
      }
    }
    const stitched = sharp({
      create: {
        background: { alpha: 1, b: 255, g: 255, r: 255 },
        channels: 4,
        height,
        width,
      },
    }).composite(layers);
    remaining();
    const output = await (format === 'jpeg'
      ? stitched.jpeg({ quality }).toBuffer()
      : stitched.png().toBuffer());
    remaining();
    return output;
  } finally {
    await restoreScreenshotScroll(frame, metrics.scroll).catch(onRestoreError);
  }
}

export const MAX_BROWSER_INTERACTION_TIMEOUT_MS = 12_000;

export interface BrowserScreenshotOptions {
  format?: 'jpeg' | 'png';
  fullPage?: boolean;
  quality?: number;
  ref?: string;
}

export interface BrowserSnapshotRequest {
  maxNodes?: number;
  maxTextLength?: number;
  rootRef?: string;
}

export interface BrowserSnapshotElement {
  bounds: { height: number; width: number; x: number; y: number } | null;
  checked?: boolean;
  disabled: boolean;
  expanded?: boolean;
  focused: boolean;
  name: string;
  ref: string;
  role: string;
  selected?: boolean;
  tag: string;
  text: string;
  visible: boolean;
}

export interface BrowserSnapshotResult {
  application: BrowserApplicationMetadata;
  elements: BrowserSnapshotElement[];
  snapshotId: string;
  truncated: boolean;
}

export interface BrowserSemanticLocator {
  name?: string;
  role?: string;
  testId?: string;
  text?: string;
}

export interface BrowserInteractionPoint {
  canvasRef?: string;
  x: number;
  y: number;
}

export interface BrowserInteractionStep {
  action: string;
  durationMs?: number;
  button?: 'left' | 'middle' | 'right';
  deltaX?: number;
  deltaY?: number;
  key?: string;
  loadState?: 'domcontentloaded' | 'load' | 'networkidle';
  locator?: BrowserSemanticLocator;
  path?: string;
  point?: BrowserInteractionPoint;
  ref?: string;
  state?:
    | 'attached'
    | 'checked'
    | 'detached'
    | 'disabled'
    | 'editable'
    | 'enabled'
    | 'focused'
    | 'hidden'
    | 'unchecked'
    | 'visible';
  targetLocator?: BrowserSemanticLocator;
  targetPoint?: BrowserInteractionPoint;
  targetRef?: string;
  text?: string;
  timeoutMs?: number;
  value?: string;
  values?: string[];
}

export interface BrowserInteractionRequest {
  steps: BrowserInteractionStep[];
  timeoutMs?: number;
}

export interface BrowserInteractionStepResult {
  action: string;
  durationMs: number;
  index: number;
}

export interface BrowserInteractionResult {
  application: BrowserApplicationMetadata;
  completed: BrowserInteractionStepResult[];
  failure?: {
    action: string;
    index: number;
    message: string;
    recovery: string;
    retryable: boolean;
    screenshot: { imageData: string; mimeType: 'image/png' } | null;
    snapshot: BrowserSnapshotResult | null;
  };
  success: boolean;
}

export interface BrowserScreenshotCapture {
  bytes: Buffer;
  metadata: BrowserApplicationMetadata & {
    downscaled: boolean;
    height: number;
    mimeType: 'image/jpeg' | 'image/png';
    width: number;
  };
}

interface BrowserSnapshotRecipe {
  applicationId: string | null;
  documentTimeOrigin: number;
  fingerprint: { name: string; role: string; tag: string };
  generation: number | null;
  frameOrigin: string;
  maxTextLength: number;
  selector: string | null;
  snapshotId: string;
}

interface InteractionProfiler {
  readonly activeDeadline: number | null;
  markInteractionStep(
    frame: Frame,
    index: number,
    action: string,
  ): Promise<void>;
}

interface ManagedInteractionSurfaceOptions {
  getRemainingOperationTimeMs(
    operation: string,
    maximumMs?: number,
    exhausted?: 'throw' | 'zero',
  ): number;
  onRestoreError(operation: string, error: unknown): void;
  page: Page;
  profiler: InteractionProfiler;
  screenshotSize: { width: number; height: number };
}

/** Owns snapshot references and every operation that can consume them. */
export class ManagedInteractionSurface {
  private readonly snapshotRecipes = new Map<string, BrowserSnapshotRecipe>();

  constructor(private readonly options: ManagedInteractionSurfaceOptions) {}

  captureRuntimeScreenshot(
    options: BrowserScreenshotOptions = {},
  ): Promise<BrowserScreenshotCapture> {
    return withRuntimeView(
      this.options.page,
      () =>
        this.captureApplicationImage(
          options,
          this.options.getRemainingOperationTimeMs('browser_screenshot'),
        ),
      (error) => this.options.onRestoreError('browser_screenshot', error),
    );
  }

  snapshotApplication(
    request: BrowserSnapshotRequest = {},
  ): Promise<BrowserSnapshotResult> {
    return collectApplicationSnapshot(
      this.options.page,
      this.snapshotRecipes,
      request,
      this.options.getRemainingOperationTimeMs('browser_snapshot'),
    );
  }

  async interactApplication(
    request: BrowserInteractionRequest,
  ): Promise<BrowserInteractionResult> {
    if (
      request == null ||
      typeof request !== 'object' ||
      !Array.isArray(request.steps) ||
      request.steps.length === 0
    ) {
      throw new Error('browser_interact requires at least one step');
    }
    if (request.steps.length > 10) {
      throw new Error('browser_interact accepts at most 10 steps');
    }
    return withRuntimeView(
      this.options.page,
      () => this.runInteractionBatch(request),
      (error) => this.options.onRestoreError('browser_interact', error),
    );
  }

  private async captureApplicationImage(
    options: BrowserScreenshotOptions,
    timeoutMs: number,
  ): Promise<BrowserScreenshotCapture> {
    const frame = await resolveApplicationFrame(this.options.page);
    // An on-demand app has nothing current on its canvas: draw a fresh frame
    // (holding rendering where the emulator would clear it) before capturing.
    return captureFreshApplicationFrame(frame, timeoutMs, (remainingMs) =>
      this.captureRenderedApplicationImage(frame, options, remainingMs),
    );
  }

  private async captureRenderedApplicationImage(
    frame: Frame,
    options: BrowserScreenshotOptions,
    timeoutMs: number,
  ): Promise<BrowserScreenshotCapture> {
    const { page, screenshotSize } = this.options;
    const format = options.format ?? 'png';
    const quality = Math.min(100, Math.max(20, options.quality ?? 90));
    const screenshotOptions =
      format === 'jpeg'
        ? ({ quality, timeout: timeoutMs, type: 'jpeg' } as const)
        : ({ timeout: timeoutMs, type: 'png' } as const);
    const mainFrame = page.mainFrame();
    const restoreError = (error: unknown) =>
      this.options.onRestoreError('browser_screenshot scroll', error);
    let raw: Buffer;
    if (options.ref) {
      const locator = await resolveRefLocator(
        frame,
        this.snapshotRecipes,
        options.ref,
      );
      raw = await withRestoredScroll(
        frame === mainFrame ? [mainFrame] : [mainFrame, frame],
        async () => {
          await locator.evaluate((element) =>
            element.scrollIntoView({
              behavior: 'instant',
              block: 'nearest',
              inline: 'nearest',
            }),
          );
          let frameClip: ScreenshotClip | null = null;
          if (frame !== mainFrame) {
            frameClip = await scrollFramedApplicationIntoView(frame);
          }
          let clip = requireVisibleScreenshotClip(
            await locator.boundingBox(),
            `Browser ref ${options.ref}`,
          );
          const boundary =
            frameClip ??
            (await page.evaluate(() => ({
              height: document.documentElement.clientHeight,
              width: document.documentElement.clientWidth,
              x: 0,
              y: 0,
            })));
          const visibleClip = intersectScreenshotClips(
            clip,
            boundary,
            `Browser ref ${options.ref}`,
          );
          if (
            [
              visibleClip.x - clip.x,
              visibleClip.y - clip.y,
              visibleClip.width - clip.width,
              visibleClip.height - clip.height,
            ].some((difference) => Math.abs(difference) > 1)
          ) {
            const targetIsTooLarge =
              clip.width > boundary.width + 1 ||
              clip.height > boundary.height + 1;
            throw Object.assign(
              new Error(
                targetIsTooLarge
                  ? `Browser ref ${options.ref} exceeds the visible application viewport`
                  : `Browser ref ${options.ref} is partially obscured`,
              ),
              targetIsTooLarge
                ? {
                    code: 'browser_screenshot_target_too_large',
                    retryable: false,
                  }
                : { retryable: true },
            );
          }
          clip = visibleClip;
          return Buffer.from(
            await page.screenshot({
              ...screenshotOptions,
              clip,
              style: WORKSPACE_SCREENSHOT_STYLE,
            }),
          );
        },
        restoreError,
      );
    } else if (frame !== mainFrame) {
      raw = await withRestoredScroll(
        [mainFrame],
        async () => {
          if (options.fullPage) {
            return captureFramedFullPage(
              page,
              frame,
              format,
              quality,
              timeoutMs,
              restoreError,
            );
          }
          // Element screenshots wait for stable animation frames. Capture the
          // visible frame rectangle directly instead.
          const clip = await scrollFramedApplicationIntoView(frame);
          return Buffer.from(
            await page.screenshot({
              ...screenshotOptions,
              clip,
              style: WORKSPACE_SCREENSHOT_STYLE,
            }),
          );
        },
        restoreError,
      );
    } else {
      raw = Buffer.from(
        await page.screenshot({
          ...screenshotOptions,
          fullPage: options.fullPage ?? false,
        }),
      );
    }

    const rawMetadata = await sharp(raw).metadata();
    const downscaled =
      (rawMetadata.width ?? 0) > screenshotSize.width ||
      (rawMetadata.height ?? 0) > screenshotSize.height;
    const bytes = downscaled
      ? await (() => {
          const resized = sharp(raw).resize(
            screenshotSize.width,
            screenshotSize.height,
            {
              fit: 'inside',
              withoutEnlargement: true,
            },
          );
          return format === 'jpeg'
            ? resized.jpeg({ quality }).toBuffer()
            : resized.png().toBuffer();
        })()
      : raw;
    const imageMetadata = downscaled
      ? await sharp(bytes).metadata()
      : rawMetadata;
    return {
      bytes,
      metadata: {
        ...(await getApplicationMetadata(page)),
        downscaled,
        height: imageMetadata.height ?? 0,
        mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        width: imageMetadata.width ?? 0,
      },
    };
  }

  private async runInteractionBatch(
    request: BrowserInteractionRequest,
  ): Promise<BrowserInteractionResult> {
    const { getRemainingOperationTimeMs, page, profiler } = this.options;
    const completed: BrowserInteractionStepResult[] = [];
    const pressedKeys = new Set<string>();
    const frame = await resolveApplicationFrame(page);
    const releasePressedKeys = () =>
      releaseInteractionKeys(
        page,
        frame,
        pressedKeys,
        KEY_RELEASE_CLEANUP_TIMEOUT_MS,
      );
    const initialState = await getApplicationState(page, frame);
    const buildFailure = async (
      error: unknown,
      index: number,
      action: BrowserInteractionStep['action'],
    ): Promise<BrowserInteractionResult> => {
      await releasePressedKeys();
      const message = errorMessage(error);
      const retryable = isRetryableInteractionError(error);
      const nextEvidenceTimeout = () =>
        getRemainingOperationTimeMs(
          'browser_interact failure evidence',
          2_000,
          'zero',
        );
      const snapshotTimeoutMs = nextEvidenceTimeout();
      const snapshot =
        snapshotTimeoutMs < 100
          ? null
          : await collectApplicationSnapshot(
              page,
              this.snapshotRecipes,
              { maxNodes: 100 },
              snapshotTimeoutMs,
            ).catch(() => null);
      const screenshotTimeoutMs = nextEvidenceTimeout();
      const screenshot =
        screenshotTimeoutMs < 100
          ? null
          : await this.captureApplicationImage(
              { format: 'png' },
              screenshotTimeoutMs,
            )
              .then((capture) => ({
                imageData: capture.bytes.toString('base64'),
                mimeType: 'image/png' as const,
              }))
              .catch(() => null);
      return {
        application: initialState.application,
        completed,
        failure: {
          action,
          index,
          message,
          recovery: retryable
            ? 'Capture a fresh browser_snapshot and retry the failed step.'
            : 'Correct the failed action parameters or application state before retrying.',
          retryable,
          screenshot,
          snapshot,
        },
        success: false,
      };
    };
    for (const [index, step] of request.steps.entries()) {
      try {
        validateInteractionStep(step);
      } catch (error) {
        return buildFailure(
          error,
          index,
          step != null &&
            typeof step === 'object' &&
            typeof step.action === 'string'
            ? step.action
            : '<invalid>',
        );
      }
    }
    const remainingInteractionTimeMs = getRemainingOperationTimeMs(
      'browser_interact',
      MAX_BROWSER_INTERACTION_TIMEOUT_MS,
      'zero',
    );
    if (remainingInteractionTimeMs < 100) {
      return buildFailure(
        Object.assign(
          new Error(
            'browser_interact ran out of active command time before it could continue',
          ),
          { retryable: true },
        ),
        0,
        (request.steps[0] as BrowserInteractionStep | null | undefined)
          ?.action ?? '<invalid>',
      );
    }
    const batchTimeoutMs = Math.min(
      MAX_BROWSER_INTERACTION_TIMEOUT_MS,
      Math.max(100, request.timeoutMs ?? 10_000),
      remainingInteractionTimeMs,
    );
    const batchDeadline = Date.now() + batchTimeoutMs;
    try {
      for (const [index, step] of request.steps.entries()) {
        const startedAt = Date.now();
        const action =
          step != null &&
          typeof step === 'object' &&
          typeof step.action === 'string'
            ? step.action
            : '<invalid>';
        try {
          if (step == null || typeof step !== 'object') {
            throw new Error('browser_interact steps must be objects');
          }
          const profileDeadline = profiler.activeDeadline;
          const remainingBatchTimeoutMs = Math.min(
            batchDeadline - startedAt,
            getRemainingOperationTimeMs(
              'browser_interact',
              Number.POSITIVE_INFINITY,
              'zero',
            ),
            profileDeadline == null
              ? Number.POSITIVE_INFINITY
              : profileDeadline - startedAt,
          );
          if (remainingBatchTimeoutMs < 100) {
            throw new Error(
              `browser_interact batch timed out after ${batchTimeoutMs}ms`,
            );
          }
          await profiler.markInteractionStep(frame, index, step.action);
          await executeInteractionStep(
            page,
            frame,
            this.snapshotRecipes,
            step,
            remainingBatchTimeoutMs,
            pressedKeys,
          );
          const currentFrame = await resolveApplicationFrame(page);
          const currentState = await getApplicationState(page, currentFrame);
          if (
            applicationIdentityChanged(
              {
                documentTimeOrigin: initialState.documentTimeOrigin,
                generation: initialState.application.generation,
                id: initialState.application.id,
              },
              {
                documentTimeOrigin: currentState.documentTimeOrigin,
                generation: currentState.application.generation,
                id: currentState.application.id,
              },
            )
          ) {
            throw Object.assign(
              new Error(
                'The current application reloaded or changed while browser_interact was running',
              ),
              { retryable: true },
            );
          }
          completed.push({
            action: step.action,
            durationMs: Date.now() - startedAt,
            index,
          });
        } catch (error) {
          return await buildFailure(error, index, action);
        }
      }
      await releasePressedKeys();
      return {
        application: await getApplicationMetadata(page).catch(
          () => initialState.application,
        ),
        completed,
        success: true,
      };
    } finally {
      await releasePressedKeys();
    }
  }
}

async function collectApplicationSnapshot(
  page: Page,
  recipes: Map<string, BrowserSnapshotRecipe>,
  request: BrowserSnapshotRequest = {},
  timeoutMs = DEFAULT_BROWSER_OPERATION_TIMEOUT_MS,
): Promise<BrowserSnapshotResult> {
  const frame = await resolveApplicationFrame(page);
  const state = await getApplicationState(page, frame);
  const application = state.application;
  const frameOrigin = new URL(frame.url()).origin;
  const documentTimeOrigin = state.documentTimeOrigin;
  const maxNodes = Math.min(1000, Math.max(1, request.maxNodes ?? 200));
  const maxTextLength = Math.min(
    1000,
    Math.max(16, request.maxTextLength ?? 200),
  );
  const rootLocator =
    request.rootRef == null
      ? frame.locator('body')
      : await resolveRefLocator(frame, recipes, request.rootRef);
  // Locator/ElementHandle evaluation has no independent execution timeout.
  // Bound the asynchronous locator-resolution phase explicitly; the
  // evaluation below is synchronous and its DOM traversal is candidate-capped.
  await rootLocator.waitFor({ state: 'attached', timeout: timeoutMs });
  const snapshotId = randomUUID();
  const raw = await rootLocator.evaluate(describeElements, {
    maxCandidates: Math.min(
      MAX_SNAPSHOT_CANDIDATES,
      Math.max(maxNodes, maxNodes * 4),
    ),
    maxNodes,
    maxTextLength,
  });
  const elements: BrowserSnapshotElement[] = [];
  let serializedElementBytes = 0;
  for (const entry of raw.elements) {
    const ref = `s${snapshotId.slice(0, 8)}e${elements.length + 1}`;
    const { selector: _selector, ...elementWithoutSelector } = entry;
    const element = { ...elementWithoutSelector, ref };
    const elementBytes = Buffer.byteLength(JSON.stringify(element), 'utf8');
    if (serializedElementBytes + elementBytes > MAX_SNAPSHOT_BYTES - 8 * 1024) {
      break;
    }
    recipes.set(ref, {
      applicationId: application.id,
      documentTimeOrigin,
      fingerprint: { name: entry.name, role: entry.role, tag: entry.tag },
      generation: application.generation,
      frameOrigin,
      maxTextLength,
      selector: entry.selector,
      snapshotId,
    });
    elements.push(element);
    serializedElementBytes += elementBytes;
  }
  while (recipes.size > MAX_SNAPSHOT_RECIPES) {
    const oldestRef = recipes.keys().next().value;
    if (oldestRef == null) {
      break;
    }
    recipes.delete(oldestRef);
  }
  return {
    application,
    elements,
    snapshotId,
    truncated: raw.truncated || elements.length < raw.elements.length,
  };
}

function semanticLocator(frame: Frame, value: BrowserSemanticLocator): Locator {
  if (value.testId) {
    return frame.getByTestId(value.testId);
  }
  if (value.role) {
    return frame.getByRole(value.role as never, {
      ...(value.name == null ? {} : { name: value.name }),
    });
  }
  if (value.text) {
    return frame.getByText(value.text, { exact: true });
  }
  throw new Error('Interaction locator requires testId, role, or text');
}

async function resolveRefLocator(
  frame: Frame,
  recipes: Map<string, BrowserSnapshotRecipe>,
  ref: string,
): Promise<Locator> {
  const recipe = recipes.get(ref);
  const currentIdentity = await frame
    .evaluate(readApplicationIdentity)
    .catch(() => ({
      documentTimeOrigin: Number.NaN,
      generation: null,
      id: null,
    }));
  const frameOrigin = parseUrl(frame.url())?.origin ?? '';
  if (
    recipe == null ||
    recipe.frameOrigin !== frameOrigin ||
    applicationIdentityChanged(
      {
        documentTimeOrigin: recipe.documentTimeOrigin,
        generation: recipe.generation,
        id: recipe.applicationId,
      },
      currentIdentity,
    )
  ) {
    throw Object.assign(new Error(`Unknown or stale browser ref: ${ref}`), {
      retryable: true,
    });
  }
  const candidates: Locator[] = [];
  if (recipe.selector != null) {
    candidates.push(frame.locator(recipe.selector));
  }
  if (recipe.fingerprint.role) {
    candidates.push(
      frame.getByRole(recipe.fingerprint.role as never, {
        ...(recipe.fingerprint.name ? { name: recipe.fingerprint.name } : {}),
      }),
    );
  }
  if (recipe.fingerprint.name) {
    candidates.push(frame.getByText(recipe.fingerprint.name, { exact: true }));
  }
  if (candidates.length === 0) {
    throw Object.assign(
      new Error(`Browser ref ${ref} has no stable locator recipe`),
      { retryable: true },
    );
  }
  let locator = candidates[0]!;
  let count = await locator.count();
  for (const candidate of candidates.slice(1)) {
    if (count === 1) {
      break;
    }
    const candidateCount = await candidate.count();
    if (candidateCount === 1) {
      locator = candidate;
      count = candidateCount;
      break;
    }
    count = candidateCount;
  }
  if (count !== 1) {
    throw Object.assign(
      new Error(`Browser ref ${ref} resolved to ${count} elements`),
      { retryable: true },
    );
  }
  const [fingerprint] = (
    await locator.evaluate(describeElements, {
      maxCandidates: 1,
      maxNodes: 1,
      maxTextLength: recipe.maxTextLength,
      rootOnly: true,
    })
  ).elements;
  if (
    fingerprint == null ||
    fingerprint.tag !== recipe.fingerprint.tag ||
    fingerprint.role !== recipe.fingerprint.role ||
    (recipe.fingerprint.name && fingerprint.name !== recipe.fingerprint.name)
  ) {
    throw Object.assign(
      new Error(`Browser ref ${ref} no longer matches its snapshot element`),
      { retryable: true },
    );
  }
  recipes.delete(ref);
  recipes.set(ref, recipe);
  return locator;
}

async function resolveStepLocator(
  frame: Frame,
  recipes: Map<string, BrowserSnapshotRecipe>,
  step: BrowserInteractionStep,
  target = false,
): Promise<Locator> {
  const ref = target ? step.targetRef : step.ref;
  const locator = target ? step.targetLocator : step.locator;
  if (ref) {
    return resolveRefLocator(frame, recipes, ref);
  }
  if (locator) {
    return semanticLocator(frame, locator);
  }
  throw new Error(`${step.action} requires a ref or semantic locator`);
}

async function resolvePagePoint(
  page: Page,
  frame: Frame,
  recipes: Map<string, BrowserSnapshotRecipe>,
  point: BrowserInteractionPoint,
): Promise<{ x: number; y: number }> {
  let x = point.x;
  let y = point.y;
  if (point.canvasRef) {
    const canvas = await resolveRefLocator(frame, recipes, point.canvasRef);
    const box = await canvas.boundingBox();
    if (box == null) {
      throw Object.assign(
        new Error(`Canvas ref ${point.canvasRef} is not visible`),
        { retryable: true },
      );
    }
    return { x: box.x + x, y: box.y + y };
  }
  if (frame !== page.mainFrame()) {
    const frameElement = await frame.frameElement();
    try {
      const frameBox = await frameElement.boundingBox();
      if (frameBox == null) {
        throw new Error('Application frame is not visible');
      }
      x += frameBox.x;
      y += frameBox.y;
    } finally {
      await frameElement.dispose().catch(() => {});
    }
  }
  return { x, y };
}

async function waitForLocatorState(
  page: Page,
  locator: Locator,
  state: NonNullable<BrowserInteractionStep['state']>,
  timeout: number,
): Promise<void> {
  if (
    state === 'attached' ||
    state === 'detached' ||
    state === 'hidden' ||
    state === 'visible'
  ) {
    await locator.waitFor({ state, timeout });
    return;
  }
  const predicate: () => Promise<boolean> = {
    checked: () => locator.isChecked().catch(() => false),
    disabled: () => locator.isDisabled().catch(() => false),
    editable: () => locator.isEditable().catch(() => false),
    enabled: () => locator.isEnabled().catch(() => false),
    focused: () =>
      locator
        .evaluate((element) => document.activeElement === element)
        .catch(() => false),
    unchecked: () =>
      locator
        .isChecked()
        .then((value) => !value)
        .catch(() => false),
  }[state];
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }
    await page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${state} state`);
}

async function releaseInteractionKeys(
  page: Page,
  frame: Frame,
  pressedKeys: Set<string>,
  timeoutMs: number,
): Promise<void> {
  const keys = [...pressedKeys].reverse();
  pressedKeys.clear();
  if (keys.length === 0) {
    return;
  }
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const remaining = () => Math.max(1, deadline - Date.now());
  try {
    await focusApplicationFrameForKeyboard(
      page,
      frame,
      Math.min(KEY_RELEASE_FOCUS_TIMEOUT_MS, remaining()),
    );
  } catch {
    // The application frame may have closed. Continue best-effort cleanup.
  }
  for (const key of keys) {
    if (Date.now() >= deadline) {
      break;
    }
    try {
      await runWithInteractionTimeout(
        () => page.keyboard.up(key),
        remaining(),
        `Timed out releasing ${key}`,
      );
    } catch {
      // The page may have closed or navigated. Continue releasing other keys.
    }
  }
}

async function runWithInteractionTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error(message), { retryable: true })),
          Math.max(1, timeoutMs),
        );
      }),
    ]);
  } finally {
    if (timer != null) {
      clearTimeout(timer);
    }
  }
}

async function focusApplicationFrameForKeyboard(
  page: Page,
  frame: Frame,
  timeoutMs: number,
): Promise<void> {
  if (frame === page.mainFrame()) {
    return;
  }
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const remaining = () => Math.max(1, deadline - Date.now());
  const frameElement = await runWithInteractionTimeout(
    () => frame.frameElement(),
    remaining(),
    'Timed out resolving the application frame for keyboard input',
  );
  try {
    await runWithInteractionTimeout(
      () => frameElement.focus(),
      remaining(),
      'Timed out focusing the application frame element for keyboard input',
    );
    await runWithInteractionTimeout(
      () => frame.evaluate(() => window.focus()),
      remaining(),
      'Timed out focusing the application frame for keyboard input',
    );
  } finally {
    await frameElement.dispose().catch(() => {});
  }
}

async function focusKeyboardTarget(
  page: Page,
  frame: Frame,
  locator: Locator,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const remaining = () => Math.max(1, deadline - Date.now());
  await focusApplicationFrameForKeyboard(page, frame, remaining());
  await locator.waitFor({ state: 'attached', timeout: remaining() });
  const focused = await runWithInteractionTimeout(
    () =>
      locator.evaluate((element) => {
        (element as HTMLElement).focus?.({ preventScroll: true });
        const activeElement = document.activeElement;
        return (
          activeElement === element ||
          (activeElement != null && element.contains(activeElement))
        );
      }),
    remaining(),
    'Timed out focusing the keyboard target',
  );
  if (!focused) {
    await focusApplicationFrameForKeyboard(page, frame, remaining());
  }
}

const SUPPORTED_INTERACTION_ACTIONS = new Set([
  'check',
  'clear',
  'click',
  'doubleClick',
  'drag',
  'fill',
  'hover',
  'keyDown',
  'keyUp',
  'pointerDown',
  'pointerMove',
  'pointerUp',
  'press',
  'scroll',
  'select',
  'type',
  'uncheck',
  'wait',
  'wheel',
]);

function validateInteractionStep(
  step: unknown,
): asserts step is BrowserInteractionStep {
  if (step == null || typeof step !== 'object') {
    throw new Error('browser_interact steps must be objects');
  }
  const candidate = step as BrowserInteractionStep;
  if (!SUPPORTED_INTERACTION_ACTIONS.has(candidate.action)) {
    throw new Error(
      `Unsupported browser interaction action: ${candidate.action}`,
    );
  }
  if (candidate.durationMs != null && candidate.action !== 'wait') {
    throw new Error('durationMs is supported only for wait actions');
  }
  if (candidate.action !== 'wait' || candidate.durationMs == null) {
    return;
  }
  if (
    !Number.isInteger(candidate.durationMs) ||
    candidate.durationMs < 0 ||
    candidate.durationMs > MAX_BROWSER_INTERACTION_TIMEOUT_MS
  ) {
    throw new Error(
      `wait durationMs must be an integer between 0 and ${MAX_BROWSER_INTERACTION_TIMEOUT_MS}`,
    );
  }
  if (
    candidate.state != null ||
    candidate.text != null ||
    candidate.path != null ||
    candidate.loadState != null ||
    candidate.ref != null ||
    candidate.locator != null ||
    candidate.point != null ||
    candidate.targetRef != null ||
    candidate.targetLocator != null ||
    candidate.targetPoint != null
  ) {
    throw new Error(
      'wait durationMs cannot be combined with a wait condition or target',
    );
  }
}

async function executeInteractionStep(
  page: Page,
  frame: Frame,
  recipes: Map<string, BrowserSnapshotRecipe>,
  step: BrowserInteractionStep,
  remainingBatchTimeoutMs: number,
  pressedKeys: Set<string>,
): Promise<void> {
  if (step.durationMs != null && step.action !== 'wait') {
    throw new Error('durationMs is supported only for wait actions');
  }

  const timeout = Math.min(
    MAX_BROWSER_INTERACTION_TIMEOUT_MS,
    Math.max(
      100,
      Math.min(
        step.timeoutMs ?? remainingBatchTimeoutMs,
        remainingBatchTimeoutMs,
      ),
    ),
  );
  const stepDeadline = Date.now() + timeout;
  const remainingStepTimeout = () => Math.max(1, stepDeadline - Date.now());
  const button = step.button ?? 'left';
  let stepLocator: Locator | null = null;
  const locator = async () =>
    (stepLocator ??= await resolveStepLocator(frame, recipes, step));
  switch (step.action) {
    case 'click':
    case 'doubleClick':
    case 'hover': {
      if (step.point) {
        const point = await resolvePagePoint(page, frame, recipes, step.point);
        if (step.action === 'hover') {
          await page.mouse.move(point.x, point.y);
        } else {
          await page.mouse.click(point.x, point.y, {
            button,
            clickCount: step.action === 'doubleClick' ? 2 : 1,
          });
        }
        return;
      }
      const resolved = await locator();
      if (step.action === 'hover') {
        await resolved.hover({ timeout });
      } else if (step.action === 'doubleClick') {
        await resolved.dblclick({ button, timeout });
      } else {
        await resolved.click({ button, timeout });
      }
      return;
    }
    case 'pointerMove': {
      if (!step.point) {
        throw new Error('pointerMove requires point');
      }
      const point = await resolvePagePoint(page, frame, recipes, step.point);
      await page.mouse.move(point.x, point.y);
      return;
    }
    case 'pointerDown':
      await page.mouse.down({ button });
      return;
    case 'pointerUp':
      await page.mouse.up({ button });
      return;
    case 'wheel':
      await page.mouse.wheel(step.deltaX ?? 0, step.deltaY ?? 0);
      return;
    case 'fill': {
      if (step.value == null) {
        throw new Error('fill requires value');
      }
      await (
        await locator()
      ).fill(step.value, {
        timeout,
      });
      return;
    }
    case 'type': {
      if (step.value == null) {
        throw new Error('type requires value');
      }
      await (await locator()).pressSequentially(step.value, { timeout });
      return;
    }
    case 'clear':
      await (await locator()).clear({ timeout });
      return;
    case 'press': {
      if (!step.key) {
        throw new Error('press requires key');
      }
      if (step.ref || step.locator) {
        await focusKeyboardTarget(
          page,
          frame,
          await locator(),
          remainingStepTimeout(),
        );
        await runWithInteractionTimeout(
          () => page.keyboard.press(step.key!),
          remainingStepTimeout(),
          'press timed out',
        );
      } else {
        await focusApplicationFrameForKeyboard(
          page,
          frame,
          remainingStepTimeout(),
        );
        await runWithInteractionTimeout(
          () => page.keyboard.press(step.key!),
          remainingStepTimeout(),
          'press timed out',
        );
      }
      return;
    }
    case 'keyDown': {
      if (!step.key) {
        throw new Error('keyDown requires key');
      }
      if (step.ref || step.locator) {
        await focusKeyboardTarget(
          page,
          frame,
          await locator(),
          remainingStepTimeout(),
        );
      } else {
        await focusApplicationFrameForKeyboard(
          page,
          frame,
          remainingStepTimeout(),
        );
      }
      await runWithInteractionTimeout(
        () => page.keyboard.down(step.key!),
        remainingStepTimeout(),
        'keyDown timed out',
      );
      pressedKeys.add(step.key);
      return;
    }
    case 'keyUp': {
      if (!step.key) {
        throw new Error('keyUp requires key');
      }
      if (step.ref || step.locator) {
        await focusKeyboardTarget(
          page,
          frame,
          await locator(),
          remainingStepTimeout(),
        );
      } else {
        await focusApplicationFrameForKeyboard(
          page,
          frame,
          remainingStepTimeout(),
        );
      }
      await runWithInteractionTimeout(
        () => page.keyboard.up(step.key!),
        remainingStepTimeout(),
        'keyUp timed out',
      );
      pressedKeys.delete(step.key);
      return;
    }
    case 'check':
      await (await locator()).check({ timeout });
      return;
    case 'uncheck':
      await (await locator()).uncheck({ timeout });
      return;
    case 'select': {
      const values = step.values ?? (step.value == null ? [] : [step.value]);
      if (values.length === 0) {
        throw new Error('select requires value or values');
      }
      await (
        await locator()
      ).selectOption(values, {
        timeout,
      });
      return;
    }
    case 'scroll': {
      if (step.ref || step.locator) {
        await (await locator()).hover({ timeout });
      } else if (step.point) {
        const point = await resolvePagePoint(page, frame, recipes, step.point);
        await page.mouse.move(point.x, point.y);
      }
      await page.mouse.wheel(step.deltaX ?? 0, step.deltaY ?? 0);
      return;
    }
    case 'drag': {
      if (step.point && step.targetPoint) {
        const from = await resolvePagePoint(page, frame, recipes, step.point);
        const to = await resolvePagePoint(
          page,
          frame,
          recipes,
          step.targetPoint,
        );
        await page.mouse.move(from.x, from.y);
        await page.mouse.down({ button });
        await page.mouse.move(to.x, to.y, { steps: 10 });
        await page.mouse.up({ button });
        return;
      }
      const source = await locator();
      const target = await resolveStepLocator(frame, recipes, step, true);
      await source.dragTo(target, { timeout });
      return;
    }
    case 'wait': {
      if (step.durationMs != null) {
        if (
          !Number.isInteger(step.durationMs) ||
          step.durationMs < 0 ||
          step.durationMs > MAX_BROWSER_INTERACTION_TIMEOUT_MS
        ) {
          throw new Error(
            `wait durationMs must be an integer between 0 and ${MAX_BROWSER_INTERACTION_TIMEOUT_MS}`,
          );
        }
        if (
          step.state != null ||
          step.text != null ||
          step.path != null ||
          step.loadState != null ||
          step.ref != null ||
          step.locator != null ||
          step.point != null ||
          step.targetRef != null ||
          step.targetLocator != null ||
          step.targetPoint != null
        ) {
          throw new Error(
            'wait durationMs cannot be combined with a wait condition or target',
          );
        }
        if (step.durationMs > remainingBatchTimeoutMs) {
          throw new Error('wait durationMs exceeds the remaining batch budget');
        }
        await page.waitForTimeout(step.durationMs);
        return;
      }
      if (step.state) {
        await waitForLocatorState(page, await locator(), step.state, timeout);
        return;
      }
      if (step.text != null) {
        await frame.getByText(step.text, { exact: false }).first().waitFor({
          state: 'visible',
          timeout,
        });
        return;
      }
      if (step.path != null) {
        await frame.waitForFunction(
          (expectedPath) =>
            `${window.location.pathname}${window.location.search}${window.location.hash}` ===
            expectedPath,
          step.path,
          { timeout },
        );
        return;
      }
      await frame.waitForLoadState(step.loadState ?? 'domcontentloaded', {
        timeout,
      });
      return;
    }
    default:
      throw new Error(`Unsupported browser interaction action: ${step.action}`);
  }
}

export function isRetryableInteractionError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error != null &&
    'retryable' in error &&
    error.retryable === true
  ) {
    return true;
  }
  const message = errorMessage(error);
  return /timeout|timed out|not visible|not stable|detached|intercepts pointer|outside of the viewport/i.test(
    message,
  );
}
