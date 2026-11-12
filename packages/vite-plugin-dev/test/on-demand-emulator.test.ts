/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, test, vi } from 'vitest';
import {
  configureOnDemandEmulator,
  type OnDemandEmulatorWindow,
} from '../src/on-demand-emulator.js';

/** An iwer 2.8 device: both settings at their defaults. */
function iwer28Device() {
  return {
    frameClearEnabled: true,
    shouldDrawEnvironment: null as (() => boolean) | null,
  };
}

describe('configureOnDemandEmulator', () => {
  test.each(['on-demand', 'continuous'])(
    'sets up the emulator in every managed session (%s at launch)',
    (mode) => {
      const device = iwer28Device();
      const win: OnDemandEmulatorWindow = { __IWSDK_RENDER_MODE: mode };
      const log = vi.fn();
      expect(configureOnDemandEmulator(device, win, log)).toEqual({
        keepsDrawnFrames: true,
        drawsEnvironmentWithApp: true,
      });
      expect(device.frameClearEnabled).toBe(false);
      expect(device.shouldDrawEnvironment).toBeTypeOf('function');
      expect(win.__IWSDK_KEEPS_DRAWN_FRAMES).toBe(true);
      expect(log).toHaveBeenCalledOnce();
    },
  );

  test('leaves pages outside a managed session alone', () => {
    for (const mode of [undefined, 'On-Demand', 'off']) {
      const device = iwer28Device();
      const win: OnDemandEmulatorWindow = { __IWSDK_RENDER_MODE: mode };
      expect(configureOnDemandEmulator(device, win)).toEqual({
        keepsDrawnFrames: false,
        drawsEnvironmentWithApp: false,
      });
      expect(device).toEqual(iwer28Device());
      expect(win.__IWSDK_KEEPS_DRAWN_FRAMES).toBeUndefined();
    }
  });

  test('leaves an older emulator without the settings alone', () => {
    const device = {};
    const win: OnDemandEmulatorWindow = { __IWSDK_RENDER_MODE: 'on-demand' };
    const log = vi.fn();
    expect(configureOnDemandEmulator(device, win, log)).toEqual({
      keepsDrawnFrames: false,
      drawsEnvironmentWithApp: false,
    });
    expect(device).toEqual({});
    expect(win.__IWSDK_KEEPS_DRAWN_FRAMES).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  test('draws the AR environment exactly on frames the app drew', () => {
    const device = iwer28Device();
    const runtime = { drawnFrames: 0 };
    const win: OnDemandEmulatorWindow = {
      __IWSDK_RENDER_MODE: 'on-demand',
      FRAMEWORK_MCP_RUNTIME: runtime,
    };
    configureOnDemandEmulator(device, win);
    const shouldDraw = device.shouldDrawEnvironment!;

    // One call per emulated AR frame, after the app's callbacks.
    expect(shouldDraw()).toBe(true); // first frame: nothing drawn yet
    expect(shouldDraw()).toBe(false); // idle on-demand frame
    runtime.drawnFrames = 1; // a requested frame
    expect(shouldDraw()).toBe(true);
    expect(shouldDraw()).toBe(false);
    runtime.drawnFrames = 2; // a hold or continuous rendering
    expect(shouldDraw()).toBe(true);
    runtime.drawnFrames = 3;
    expect(shouldDraw()).toBe(true);
  });

  test('follows a runtime replaced by a reload or a new world', () => {
    const device = iwer28Device();
    const win: OnDemandEmulatorWindow = {
      __IWSDK_RENDER_MODE: 'on-demand',
      FRAMEWORK_MCP_RUNTIME: { drawnFrames: 5 },
    };
    configureOnDemandEmulator(device, win);
    const shouldDraw = device.shouldDrawEnvironment!;
    expect(shouldDraw()).toBe(true);
    expect(shouldDraw()).toBe(false);
    // The new world counts from zero; its first draw shows.
    win.FRAMEWORK_MCP_RUNTIME = { drawnFrames: 0 };
    expect(shouldDraw()).toBe(true);
    expect(shouldDraw()).toBe(false);
  });

  test('draws the environment every frame when the app does not report drawn frames', () => {
    const device = iwer28Device();
    const win: OnDemandEmulatorWindow = { __IWSDK_RENDER_MODE: 'on-demand' };
    configureOnDemandEmulator(device, win);
    const shouldDraw = device.shouldDrawEnvironment!;
    // Before the app boots, and with an older @iwsdk/core.
    expect([shouldDraw(), shouldDraw()]).toEqual([true, true]);
    win.FRAMEWORK_MCP_RUNTIME = {};
    expect([shouldDraw(), shouldDraw()]).toEqual([true, true]);
  });

  test('sets up whichever setting the emulator has', () => {
    const clearOnly = { frameClearEnabled: true };
    expect(
      configureOnDemandEmulator(clearOnly, {
        __IWSDK_RENDER_MODE: 'on-demand',
      }),
    ).toEqual({ keepsDrawnFrames: true, drawsEnvironmentWithApp: false });
    expect(clearOnly.frameClearEnabled).toBe(false);

    const gateOnly = { shouldDrawEnvironment: null };
    const win: OnDemandEmulatorWindow = { __IWSDK_RENDER_MODE: 'continuous' };
    expect(configureOnDemandEmulator(gateOnly, win)).toEqual({
      keepsDrawnFrames: false,
      drawsEnvironmentWithApp: true,
    });
    expect(win.__IWSDK_KEEPS_DRAWN_FRAMES).toBeUndefined();
  });
});
