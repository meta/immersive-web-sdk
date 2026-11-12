/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  composeContactSheet,
  contactSheetLayout,
  filmstripMinimumDurationMs,
  normalizeFilmstripOptions,
  pageFilmstripEcsControl,
  runFilmstrip,
  type FilmstripEcsControl,
} from '../src/managed-browser/filmstrip.js';

/** A generous budget that never runs out. */
const plenty = () => 20_000;

function recordingEcs(initiallyPaused: boolean | null) {
  const calls: string[] = [];
  const ecs: FilmstripEcsControl = {
    isPaused: async () => {
      calls.push('isPaused');
      return initiallyPaused;
    },
    pause: async () => {
      calls.push('pause');
    },
    step: async (frames) => {
      calls.push(`step:${frames}`);
    },
    resume: async () => {
      calls.push('resume');
    },
  };
  return { calls, ecs };
}

describe('normalizeFilmstripOptions', () => {
  test('defaults to six frames, five apart, as PNG', () => {
    expect(normalizeFilmstripOptions()).toEqual({
      count: 6,
      every: 5,
      format: 'png',
    });
  });

  test('rejects values outside the contract', () => {
    expect(() => normalizeFilmstripOptions({ count: 1 })).toThrow(
      'count must be an integer from 2 to 12',
    );
    expect(() => normalizeFilmstripOptions({ every: 121 })).toThrow(
      'every must be an integer from 1 to 120',
    );
    expect(() => normalizeFilmstripOptions({ format: 'gif' as 'png' })).toThrow(
      'format must be png or jpeg',
    );
  });
});

describe('runFilmstrip', () => {
  test('pauses, captures, steps between captures, then resumes', async () => {
    const { calls, ecs } = recordingEcs(false);
    const frames = await runFilmstrip(
      ecs,
      { count: 3, every: 4, format: 'png' },
      async (offset) => {
        calls.push(`capture:${offset}`);
        return offset;
      },
      plenty,
    );
    expect(calls).toEqual([
      'isPaused',
      'pause',
      'capture:0',
      'step:4',
      'capture:4',
      'step:4',
      'capture:8',
      'resume',
    ]);
    expect(frames.map(({ offset }) => offset)).toEqual([0, 4, 8]);
  });

  test('leaves an already paused ECS paused', async () => {
    const { calls, ecs } = recordingEcs(true);
    await runFilmstrip(
      ecs,
      { count: 2, every: 1, format: 'png' },
      async () => Buffer.alloc(0),
      plenty,
    );
    expect(calls).toEqual(['isPaused', 'step:1']);
  });

  test('restores a running ECS when a capture fails', async () => {
    const { calls, ecs } = recordingEcs(false);
    await expect(
      runFilmstrip(
        ecs,
        { count: 3, every: 2, format: 'png' },
        async (offset) => {
          if (offset > 0) {
            throw new Error('capture failed');
          }
          return offset;
        },
        plenty,
      ),
    ).rejects.toThrow('capture failed');
    expect(calls.at(-1)).toBe('resume');
  });

  test('restores a running ECS when a step fails, and captures nothing more', async () => {
    const { calls, ecs } = recordingEcs(false);
    ecs.step = async () => {
      calls.push('step');
      throw new Error('step failed');
    };
    await expect(
      runFilmstrip(
        ecs,
        { count: 3, every: 2, format: 'png' },
        async (offset) => {
          calls.push(`capture:${offset}`);
          return offset;
        },
        plenty,
      ),
    ).rejects.toThrow('step failed');
    expect(calls).toEqual(['isPaused', 'pause', 'capture:0', 'step', 'resume']);
  });

  test('undoes a pause that rejects after taking effect', async () => {
    const { calls, ecs } = recordingEcs(false);
    ecs.pause = async () => {
      calls.push('pause');
      throw new Error('pause failed');
    };
    await expect(
      runFilmstrip(
        ecs,
        { count: 2, every: 1, format: 'png' },
        async () => 0,
        plenty,
      ),
    ).rejects.toThrow('pause failed');
    expect(calls).toEqual(['isPaused', 'pause', 'resume']);
  });

  test('refuses to run when the pause state is unknown (older @iwsdk/core)', async () => {
    const { calls, ecs } = recordingEcs(null);
    await expect(
      runFilmstrip(
        ecs,
        { count: 2, every: 1, format: 'png' },
        async () => 0,
        plenty,
      ),
    ).rejects.toThrow('Update @iwsdk/core');
    // Nothing paused or resumed: the user's ECS state is untouched.
    expect(calls).toEqual(['isPaused']);
  });

  test('keeps the capture error when resume also fails', async () => {
    const { ecs } = recordingEcs(false);
    ecs.resume = async () => {
      throw new Error('resume failed');
    };
    const failure = Object.assign(new Error('capture failed'), {
      retryable: true,
    });
    const rejection = await runFilmstrip(
      ecs,
      { count: 2, every: 1, format: 'png' },
      async () => {
        throw failure;
      },
      plenty,
    ).catch((error) => error);
    expect(rejection).toBe(failure);
    expect(rejection.retryable).toBe(true);
    expect(rejection.message).toContain('capture failed');
    expect(rejection.message).toContain('ECS may still be paused');
    expect(rejection.resumeError.message).toBe('resume failed');
  });

  test('reports a resume failure after a successful filmstrip', async () => {
    const { ecs } = recordingEcs(false);
    ecs.resume = async () => {
      throw new Error('resume failed');
    };
    await expect(
      runFilmstrip(
        ecs,
        { count: 2, every: 1, format: 'png' },
        async () => 0,
        plenty,
      ),
    ).rejects.toThrow('captured every frame but could not resume ECS');
  });

  test('rejects up front a filmstrip that cannot step in the remaining budget', async () => {
    const { calls, ecs } = recordingEcs(false);
    const options = { count: 12, every: 120, format: 'png' } as const;
    expect(filmstripMinimumDurationMs(options)).toBe(22_000);
    await expect(
      runFilmstrip(
        ecs,
        options,
        async () => 0,
        () => 20_000,
      ),
    ).rejects.toThrow('needs at least 22.0 s');
    expect(calls).toEqual([]);
  });

  test('times out a step that outlasts the budget and still resumes', async () => {
    vi.useFakeTimers();
    try {
      const { calls, ecs } = recordingEcs(false);
      ecs.step = () => {
        calls.push('step');
        return new Promise<void>(() => {}); // the page never answers
      };
      const run = runFilmstrip(
        ecs,
        { count: 2, every: 5, format: 'png' },
        async () => 0,
        () => 1_000,
      );
      const assertion = expect(run).rejects.toThrow(
        'ran out of active command time before it could continue (stepping to frame +5)',
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
      expect(calls.at(-1)).toBe('resume');
    } finally {
      vi.useRealTimers();
    }
  });

  test('stops with the budget error once the budget is spent', async () => {
    const { calls, ecs } = recordingEcs(false);
    let remaining = 5_000;
    const budget = () => {
      if (remaining < 100) {
        throw Object.assign(
          new Error(
            'browser_filmstrip ran out of active command time before it could continue',
          ),
          { retryable: true },
        );
      }
      return remaining;
    };
    await expect(
      runFilmstrip(
        ecs,
        { count: 4, every: 1, format: 'png' },
        async (offset) => {
          calls.push(`capture:${offset}`);
          remaining = offset === 0 ? 0 : remaining;
          return offset;
        },
        budget,
      ),
    ).rejects.toThrow('ran out of active command time');
    expect(calls).toEqual(['isPaused', 'pause', 'capture:0', 'resume']);
  });
});

describe('pageFilmstripEcsControl', () => {
  const previousWindow = (globalThis as any).window;
  afterEach(() => {
    (globalThis as any).window = previousWindow;
  });

  /** A Playwright-like frame that runs page functions against `pageWindow`. */
  function fakeFrame(pageWindow: Record<string, unknown>) {
    return {
      evaluate: vi.fn(async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
        (globalThis as any).window = pageWindow;
        return fn(arg);
      }),
    } as any;
  }

  test('steps through the ecs_step dispatch with a count key', async () => {
    const dispatch = vi.fn(async () => ({ framesAdvanced: 5 }));
    const ecs = pageFilmstripEcsControl(
      fakeFrame({ FRAMEWORK_MCP_RUNTIME: { dispatch, ecsPaused: false } }),
    );
    await ecs.pause();
    await ecs.step(5);
    await ecs.resume();
    expect(dispatch.mock.calls).toEqual([
      ['ecs_pause', {}],
      ['ecs_step', { count: 5 }],
      ['ecs_resume', {}],
    ]);
  });

  test('reads the pause state from ecsPaused, and null when it is missing', async () => {
    const dispatch = vi.fn();
    expect(
      await pageFilmstripEcsControl(
        fakeFrame({ FRAMEWORK_MCP_RUNTIME: { dispatch, ecsPaused: true } }),
      ).isPaused(),
    ).toBe(true);
    expect(
      await pageFilmstripEcsControl(
        fakeFrame({ FRAMEWORK_MCP_RUNTIME: { dispatch } }),
      ).isPaused(),
    ).toBeNull();
  });

  test('fails clearly without an IWSDK app runtime', async () => {
    await expect(
      pageFilmstripEcsControl(fakeFrame({})).pause(),
    ).rejects.toThrow('needs an IWSDK app runtime');
  });
});

describe('contact sheet', () => {
  test('balances at most four columns across rows and fits the bounds', () => {
    expect(
      contactSheetLayout(
        6,
        { width: 800, height: 800 },
        { width: 1600, height: 1600 },
      ),
    ).toEqual({
      columns: 3,
      rows: 2,
      panelWidth: 533,
      panelHeight: 533,
      width: 1599,
      height: 1066,
    });
    expect(
      contactSheetLayout(
        8,
        { width: 800, height: 800 },
        { width: 1600, height: 1600 },
      ),
    ).toMatchObject({ columns: 4, rows: 2, panelWidth: 400 });
    expect(
      contactSheetLayout(
        5,
        { width: 800, height: 800 },
        { width: 1600, height: 1600 },
      ),
    ).toMatchObject({ columns: 3, rows: 2 });
    expect(
      contactSheetLayout(
        2,
        { width: 400, height: 300 },
        { width: 1600, height: 1600 },
      ),
    ).toMatchObject({ columns: 2, rows: 1, panelWidth: 400, panelHeight: 300 });
    const twelve = contactSheetLayout(
      12,
      { width: 800, height: 600 },
      { width: 1600, height: 1600 },
    );
    expect(twelve).toMatchObject({ columns: 4, rows: 3 });
    expect(twelve.width).toBeLessThanOrEqual(1600);
    expect(twelve.height).toBeLessThanOrEqual(1600);
  });

  test('stitches labeled panels into one image', async () => {
    const panel = (r: number) =>
      sharp({
        create: {
          background: { alpha: 1, b: 0, g: 0, r },
          channels: 4,
          height: 200,
          width: 200,
        },
      })
        .png()
        .toBuffer();
    const { bytes, layout } = await composeContactSheet(
      [
        { offset: 0, bytes: await panel(255) },
        { offset: 5, bytes: await panel(0) },
        { offset: 10, bytes: await panel(128) },
      ],
      { width: 1600, height: 1600 },
      'png',
    );
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe('png');
    expect([metadata.width, metadata.height]).toEqual([600, 200]);
    expect(layout).toMatchObject({ columns: 3, rows: 1 });
    // The bottom-right corner of each panel keeps its own color; the label
    // background darkens the top-left corner.
    const { data, info } = await sharp(bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const red = (x: number, y: number) => data[(y * info.width + x) * 4];
    expect(red(190, 190)).toBe(255);
    expect(red(390, 190)).toBe(0);
    expect(red(590, 190)).toBe(128);
    expect(red(16, 22)).toBeLessThan(200);
  });

  test('lays out JPEG sheets over several rows within the bounds', async () => {
    const colors = [0, 50, 100, 150, 200, 250];
    const panels = await Promise.all(
      colors.map(async (r, index) => ({
        offset: index * 5,
        bytes: await sharp({
          create: {
            background: { alpha: 1, b: 0, g: 0, r },
            channels: 4,
            height: 200,
            width: 200,
          },
        })
          .png()
          .toBuffer(),
      })),
    );
    const { bytes, layout } = await composeContactSheet(
      panels,
      { width: 400, height: 400 },
      'jpeg',
    );
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(layout).toMatchObject({ columns: 3, rows: 2 });
    expect(metadata.width).toBeLessThanOrEqual(400);
    expect(metadata.height).toBeLessThanOrEqual(400);
    const { data, info } = await sharp(bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const red = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels];
    // Panel 4 sits in row 1, column 1: check near its bottom-right corner.
    const x = 2 * layout.panelWidth - 6;
    const y = 2 * layout.panelHeight - 6;
    expect(Math.abs(red(x, y) - colors[4])).toBeLessThan(12);
  });
});
