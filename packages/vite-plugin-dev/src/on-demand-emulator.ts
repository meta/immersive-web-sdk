/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** The page globals the managed session and the injected runtime share. */
export interface OnDemandEmulatorWindow {
  __IWSDK_RENDER_MODE?: unknown;
  __IWSDK_KEEPS_DRAWN_FRAMES?: boolean;
  FRAMEWORK_MCP_RUNTIME?: { drawnFrames?: unknown };
}

/** What {@link configureOnDemandEmulator} changed on the emulator. */
export interface OnDemandEmulatorSetup {
  /** The per-frame clear was turned off (`frameClearEnabled = false`). */
  keepsDrawnFrames: boolean;
  /** The synthetic AR environment draws only when the app draws. */
  drawsEnvironmentWithApp: boolean;
}

/**
 * Configure the XR emulator so the app can render on demand.
 *
 * Managed sessions can render on demand: systems run every frame but the app
 * draws only when a tool needs pixels. Headless sessions start that way, and
 * any managed session can switch at runtime (`RuntimeSettings`), so the
 * emulator is set up the same way in every managed session, whatever mode it
 * starts in; the app's render mode stays the single switch.
 *
 * - IWER's per-frame clear would only wipe the last drawn frame, at the cost
 *   of a full-canvas software clear every frame. It is turned off, and the
 *   managed browser is told that one requested frame is enough for a
 *   capture. three.js clears before each frame it draws, so continuous
 *   rendering looks the same.
 * - In emulated AR, IWER draws its synthetic room behind the app every frame.
 *   It now draws only on frames the app drew (the runtime's `drawnFrames`
 *   changed), so the room and the app always match and an idle on-demand
 *   session draws neither. When the app does not report drawn frames, the
 *   room draws every frame as before.
 *
 * Pages outside a managed session (a person's own browser) are left alone.
 * `frameClearEnabled` and `shouldDrawEnvironment` were added in iwer 2.8;
 * an older emulator is left alone too, and the managed browser draws
 * continuously during captures instead.
 */
export function configureOnDemandEmulator(
  device: object,
  win: OnDemandEmulatorWindow,
  log?: (message: string) => void,
): OnDemandEmulatorSetup {
  const setup: OnDemandEmulatorSetup = {
    keepsDrawnFrames: false,
    drawsEnvironmentWithApp: false,
  };
  const mode = win.__IWSDK_RENDER_MODE;
  if (mode !== 'on-demand' && mode !== 'continuous') {
    return setup;
  }
  if ('frameClearEnabled' in device) {
    (device as { frameClearEnabled: boolean }).frameClearEnabled = false;
    win.__IWSDK_KEEPS_DRAWN_FRAMES = true;
    setup.keepsDrawnFrames = true;
  }
  if ('shouldDrawEnvironment' in device) {
    let lastDrawnFrames: number | undefined;
    // IWER calls this once per AR frame, after the app's frame callbacks.
    (
      device as { shouldDrawEnvironment: (() => boolean) | null }
    ).shouldDrawEnvironment = () => {
      const drawnFrames = win.FRAMEWORK_MCP_RUNTIME?.drawnFrames;
      if (typeof drawnFrames !== 'number') {
        return true;
      }
      const appDrew = drawnFrames !== lastDrawnFrames;
      lastDrawnFrames = drawnFrames;
      return appDrew;
    };
    setup.drawsEnvironmentWithApp = true;
  }
  if (setup.keepsDrawnFrames || setup.drawsEnvironmentWithApp) {
    log?.(
      `[IWSDK Dev] On-demand rendering: IWER keeps drawn frames (${setup.keepsDrawnFrames}) and draws its AR environment with the app (${setup.drawsEnvironmentWithApp})`,
    );
  }
  return setup;
}
