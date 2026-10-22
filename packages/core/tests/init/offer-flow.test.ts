/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manageOfferFlow } from '../../src/init/world-initializer.js';
import { SessionMode } from '../../src/init/xr.js';

// xr.ts -> runtime barrel -> xr-input cursor-visual.ts touches `document` at
// module load; provide a minimal canvas stub before importing.
vi.hoisted(() => {
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => ({
        arc: () => {},
        beginPath: () => {},
        clearRect: () => {},
        fill: () => {},
        fillStyle: '',
        lineWidth: 0,
        stroke: () => {},
        strokeStyle: '',
      }),
      height: 0,
      width: 0,
    }),
  };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createWorld() {
  return {
    camera: {},
    renderer: {
      xr: {
        enabled: false,
        getDepthSensingMesh: () => null,
        setReferenceSpaceType: () => {},
        setSession: vi.fn(async () => {}),
      },
    },
    scene: { userData: {} },
    session: undefined,
    sessionRequestPending: false,
    xrDefaults: {
      sessionMode: SessionMode.ImmersiveVR,
      features: { layers: { required: true } },
      restoreCameraOnExit: false,
    },
  } as any;
}

function createSession() {
  const session = new EventTarget() as EventTarget & {
    end: ReturnType<typeof vi.fn>;
    requestReferenceSpace: ReturnType<typeof vi.fn>;
  };
  session.end = vi.fn().mockResolvedValue(undefined);
  session.requestReferenceSpace = vi.fn().mockResolvedValue({});
  return session as unknown as XRSession;
}

function installOfferSession(offerSession: ReturnType<typeof vi.fn>) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { xr: { offerSession } },
  });
}

describe('manageOfferFlow', () => {
  let savedNavigator: PropertyDescriptor | undefined;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedNavigator) {
      Object.defineProperty(globalThis, 'navigator', savedNavigator);
    } else {
      delete (globalThis as any).navigator;
    }
    consoleError.mockRestore();
  });

  it('handles a rejected offerSession instead of leaving an unhandled rejection', async () => {
    // IWER rejects an offered session whose required features the emulated
    // device lacks (e.g. WebXR Layers).
    const error = new Error(
      'One or more required features are not supported by the device.',
    );
    const offerSession = vi.fn().mockRejectedValue(error);
    installOfferSession(offerSession);
    const world = createWorld();

    expect(() => manageOfferFlow(world, 'always')).not.toThrow();
    await flush();
    await flush();

    expect(offerSession).toHaveBeenCalledTimes(1);
    expect(offerSession).toHaveBeenCalledWith(
      SessionMode.ImmersiveVR,
      expect.objectContaining({ requiredFeatures: ['layers'] }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[XR] Failed to start offered XR session:',
      error,
    );
    expect(world.session).toBeUndefined();
  });

  it('adopts an accepted offer and re-offers after it ends in always mode', async () => {
    const session = createSession();
    const offerSession = vi
      .fn()
      .mockResolvedValueOnce(session)
      .mockResolvedValue(undefined);
    installOfferSession(offerSession);
    const world = createWorld();

    manageOfferFlow(world, 'always');
    await flush();

    expect(world.session).toBe(session);
    expect(offerSession).toHaveBeenCalledTimes(1);

    (session as unknown as EventTarget).dispatchEvent(new Event('end'));
    await flush();

    expect(world.session).toBeUndefined();
    expect(offerSession).toHaveBeenCalledTimes(2);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
