/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { World } from '../../src/ecs/world.js';
import { setupRenderLoop } from '../../src/init/world-initializer.js';
import {
  ecsPause,
  ecsResume,
  installDebugHook,
} from '../../src/mcp/ecs-debug-tools.js';
import { PerspectiveCamera, Scene } from '../../src/runtime/index.js';
import {
  RuntimeSettings,
  RuntimeSettingsSystem,
} from '../../src/runtime-settings/index.js';

// world.ts -> @iwsdk/xr-input -> cursor-visual.ts touches `document` at module
// load; provide a minimal canvas stub before importing.
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

function setup() {
  (globalThis as any).window = { __IWSDK_RENDER_MODE: 'on-demand' };
  const world = new World();
  world.scene = new Scene();
  world.camera = new PerspectiveCamera();
  world
    .registerComponent(RuntimeSettings)
    .registerSystem(RuntimeSettingsSystem);
  const renderer = {
    loop: null as null | (() => void),
    render: vi.fn(),
    setAnimationLoop(fn: null | (() => void)) {
      renderer.loop = fn;
    },
    xr: {
      enabled: false,
      isPresenting: false,
      cameraAutoUpdate: true,
      getFrame: () => null,
      updateCamera: vi.fn(),
    },
  };
  setupRenderLoop(world, renderer as any);
  const entity = (world.getSystem(RuntimeSettingsSystem) as any).settingsEntity;
  return { world, renderer, entity, tick: () => renderer.loop!() };
}

afterEach(() => {
  delete (globalThis as any).window;
});

describe('RuntimeSettings in the render loop', () => {
  it('reflects the harness boot mode into the component on the first tick', () => {
    const { entity, tick } = setup();
    tick();
    expect(entity.getValue(RuntimeSettings, 'renderMode')).toBe('on-demand');
  });

  it('applies a component change before the draw decision of the next tick', () => {
    const { world, renderer, entity, tick } = setup();
    tick();
    expect(renderer.render).not.toHaveBeenCalled();
    entity.setValue(RuntimeSettings, 'renderMode', 'continuous');
    tick();
    expect(world.renderMode).toBe('continuous');
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it('applies a change while ECS updates are paused for debugging', () => {
    const { world, renderer, entity, tick } = setup();
    installDebugHook(world);
    ecsPause(world);
    try {
      tick();
      entity.setValue(RuntimeSettings, 'renderMode', 'continuous');
      tick();
      expect(world.renderMode).toBe('continuous');
      expect(renderer.render).toHaveBeenCalledTimes(1);
    } finally {
      ecsResume(world);
    }
  });
});
