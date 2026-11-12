/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Frame } from 'playwright';
import sharp from 'sharp';

export interface BrowserFilmstripOptions {
  count?: number;
  every?: number;
  format?: 'jpeg' | 'png';
}

export interface NormalizedFilmstripOptions {
  count: number;
  every: number;
  format: 'jpeg' | 'png';
}

export const FILMSTRIP_DEFAULT_COUNT = 6;
export const FILMSTRIP_DEFAULT_EVERY = 5;
export const FILMSTRIP_MAX_COUNT = 12;
export const FILMSTRIP_MAX_EVERY = 120;
export const FILMSTRIP_MAX_COLUMNS = 4;

export function normalizeFilmstripOptions(
  options: BrowserFilmstripOptions = {},
): NormalizedFilmstripOptions {
  const integer = (
    name: string,
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) => {
    if (value == null) {
      return fallback;
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      throw Object.assign(
        new Error(
          `browser_filmstrip ${name} must be an integer from ${min} to ${max}`,
        ),
        { retryable: false },
      );
    }
    return value;
  };
  const format = options.format ?? 'png';
  if (format !== 'png' && format !== 'jpeg') {
    throw Object.assign(
      new Error('browser_filmstrip format must be png or jpeg'),
      { retryable: false },
    );
  }
  return {
    count: integer(
      'count',
      options.count,
      FILMSTRIP_DEFAULT_COUNT,
      2,
      FILMSTRIP_MAX_COUNT,
    ),
    every: integer(
      'every',
      options.every,
      FILMSTRIP_DEFAULT_EVERY,
      1,
      FILMSTRIP_MAX_EVERY,
    ),
    format,
  };
}

/** The page-side ECS controls a filmstrip needs. */
export interface FilmstripEcsControl {
  /** Whether ECS was paused before the filmstrip; `null` if unknown. */
  isPaused(): Promise<boolean | null>;
  pause(): Promise<void>;
  step(frames: number): Promise<void>;
  resume(): Promise<void>;
}

/**
 * Remaining active command time in milliseconds. Throws the managed browser's
 * "ran out of active command time" error once the budget is spent.
 */
export type FilmstripBudget = () => number;

/**
 * `ecs_step` advances one simulation step per animation frame, and the managed
 * browser animates at most 60 frames per second, so a filmstrip needs at least
 * this long however fast the app renders.
 */
export function filmstripMinimumDurationMs(
  options: NormalizedFilmstripOptions,
): number {
  return Math.ceil((((options.count - 1) * options.every) / 60) * 1000);
}

function filmstripOutOfTime(detail: string): Error {
  return Object.assign(
    new Error(
      `browser_filmstrip ran out of active command time before it could continue (${detail})`,
    ),
    { retryable: false },
  );
}

/** Settle with `work`, or reject once `budgetMs` passes. */
async function withinBudget<T>(
  work: Promise<T>,
  budgetMs: number,
  detail: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(filmstripOutOfTime(detail)),
          Math.max(0, budgetMs),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pause, capture the current frame, then step and capture until `count`
 * frames are taken. The caller's pause state is restored however this ends:
 * ECS resumes only if this call paused it.
 *
 * Every step and capture runs against the remaining command budget, so a
 * sequence that cannot finish fails with a clear error before the managed
 * browser's command coordinator would time the whole browser out.
 */
export async function runFilmstrip<T>(
  ecs: FilmstripEcsControl,
  options: NormalizedFilmstripOptions,
  capture: (offset: number) => Promise<T>,
  budget: FilmstripBudget,
): Promise<Array<{ offset: number; capture: T }>> {
  const minimumMs = filmstripMinimumDurationMs(options);
  if (minimumMs > budget()) {
    throw Object.assign(
      new Error(
        `browser_filmstrip needs at least ${(minimumMs / 1000).toFixed(1)} s ` +
          `to step ${(options.count - 1) * options.every} frames at 60 fps, more than one ` +
          'command allows. Lower count or every.',
      ),
      { retryable: false },
    );
  }
  const wasPaused = await ecs.isPaused();
  if (wasPaused === null) {
    // Guessing would risk resuming an ECS the user paused on purpose.
    throw Object.assign(
      new Error(
        'browser_filmstrip needs an @iwsdk/core that reports ECS pause state ' +
          '(MCPRuntime.ecsPaused). Update @iwsdk/core to match @iwsdk/vite-plugin-dev.',
      ),
      { retryable: false },
    );
  }
  // Set before pausing, so a pause that takes effect and then rejects is
  // still undone.
  const pausedHere = !wasPaused;
  let failure: unknown;
  try {
    if (pausedHere) {
      // Read the budget first: it throws once spent, and must do so before
      // the next ECS command starts.
      const pauseBudgetMs = budget();
      await withinBudget(ecs.pause(), pauseBudgetMs, 'pausing ECS');
    }
    const frames: Array<{ offset: number; capture: T }> = [];
    for (let index = 0; index < options.count; index++) {
      const offset = index * options.every;
      if (index > 0) {
        const stepBudgetMs = budget();
        await withinBudget(
          ecs.step(options.every),
          stepBudgetMs,
          `stepping to frame +${offset}`,
        );
      }
      frames.push({ offset, capture: await capture(offset) });
    }
    return frames;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (pausedHere) {
      try {
        await ecs.resume();
      } catch (resumeError) {
        if (failure === undefined) {
          throw Object.assign(
            new Error(
              `browser_filmstrip captured every frame but could not resume ECS: ${errorText(resumeError)}`,
            ),
            { cause: resumeError, retryable: false },
          );
        }
        // Keep the original failure; record that ECS may still be paused.
        if (failure instanceof Error) {
          failure.message += ` (ECS may still be paused: resume failed with ${errorText(resumeError)})`;
          (failure as Error & { resumeError?: unknown }).resumeError =
            resumeError;
        }
      }
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** ECS controls through the page runtime's MCP dispatch. */
export function pageFilmstripEcsControl(frame: Frame): FilmstripEcsControl {
  const dispatch = (method: string, params: Record<string, unknown> = {}) =>
    frame.evaluate(
      async ({ method, params }) => {
        const runtime = (window as any).FRAMEWORK_MCP_RUNTIME;
        if (typeof runtime?.dispatch !== 'function') {
          throw new Error(
            'browser_filmstrip needs an IWSDK app runtime (FRAMEWORK_MCP_RUNTIME)',
          );
        }
        return runtime.dispatch(method, params);
      },
      { method, params },
    );
  return {
    isPaused: () =>
      frame.evaluate(() => {
        const paused = (window as any).FRAMEWORK_MCP_RUNTIME?.ecsPaused;
        return typeof paused === 'boolean' ? paused : null;
      }),
    pause: async () => {
      await dispatch('ecs_pause');
    },
    step: async (frames) => {
      await dispatch('ecs_step', { count: frames });
    },
    resume: async () => {
      await dispatch('ecs_resume');
    },
  };
}

export interface ContactSheetLayout {
  columns: number;
  rows: number;
  panelWidth: number;
  panelHeight: number;
  width: number;
  height: number;
}

/**
 * Lay `count` panels of `source` aspect out in at most four columns, balanced
 * across rows (6 panels make 3×2, not 4+2), scaled down so the whole sheet
 * fits `bounds`.
 */
export function contactSheetLayout(
  count: number,
  source: { width: number; height: number },
  bounds: { width: number; height: number },
): ContactSheetLayout {
  const rows = Math.ceil(count / FILMSTRIP_MAX_COLUMNS);
  const columns = Math.ceil(count / rows);
  const scale = Math.min(
    1,
    bounds.width / (columns * source.width),
    bounds.height / (rows * source.height),
  );
  const panelWidth = Math.max(1, Math.floor(source.width * scale));
  const panelHeight = Math.max(1, Math.floor(source.height * scale));
  return {
    columns,
    rows,
    panelWidth,
    panelHeight,
    width: columns * panelWidth,
    height: rows * panelHeight,
  };
}

function offsetLabel(offset: number, panelHeight: number): Buffer {
  const fontSize = Math.max(12, Math.round(panelHeight * 0.06));
  const padding = Math.round(fontSize * 0.45);
  const text = `+${offset}`;
  const width = Math.round(text.length * fontSize * 0.62 + padding * 2);
  const height = Math.round(fontSize + padding * 1.6);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" rx="${Math.round(padding * 0.8)}" fill="#000000" fill-opacity="0.72"/>` +
      `<text x="${padding}" y="${Math.round(padding * 0.8 + fontSize * 0.85)}" font-family="DejaVu Sans Mono, monospace" font-size="${fontSize}" font-weight="700" fill="#ffffff">${text}</text>` +
      `</svg>`,
  );
}

/**
 * Stitch captures into one contact sheet, each panel labeled with its
 * simulation frame offset (`+0`, `+5`, ...).
 */
export async function composeContactSheet(
  panels: Array<{ offset: number; bytes: Buffer }>,
  bounds: { width: number; height: number },
  format: 'jpeg' | 'png',
): Promise<{ bytes: Buffer; layout: ContactSheetLayout }> {
  const first = await sharp(panels[0].bytes).metadata();
  const layout = contactSheetLayout(
    panels.length,
    { width: first.width ?? 1, height: first.height ?? 1 },
    bounds,
  );
  const layers = await Promise.all(
    panels.map(async ({ offset, bytes }, index) => {
      const left = (index % layout.columns) * layout.panelWidth;
      const top = Math.floor(index / layout.columns) * layout.panelHeight;
      const resized = await sharp(bytes)
        .resize(layout.panelWidth, layout.panelHeight, { fit: 'fill' })
        .png()
        .toBuffer();
      const margin = Math.max(4, Math.round(layout.panelHeight * 0.02));
      return [
        { input: resized, left, top },
        {
          input: offsetLabel(offset, layout.panelHeight),
          left: left + margin,
          top: top + margin,
        },
      ];
    }),
  );
  const sheet = sharp({
    create: {
      background: { alpha: 1, b: 0, g: 0, r: 0 },
      channels: 4,
      height: layout.height,
      width: layout.width,
    },
  }).composite(layers.flat());
  const bytes = await (format === 'jpeg'
    ? sheet.jpeg({ quality: 90 }).toBuffer()
    : sheet.png().toBuffer());
  return { bytes, layout };
}
