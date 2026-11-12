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
  Bone,
  BufferGeometry,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Skeleton,
  SkinnedMesh,
} from '../../src/runtime/index.js';

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

function fakeRenderer(presenting = false) {
  const renderer = {
    loop: null as null | (() => void),
    render: vi.fn(),
    setAnimationLoop(fn: null | (() => void)) {
      renderer.loop = fn;
    },
    xr: {
      enabled: true,
      isPresenting: presenting,
      cameraAutoUpdate: true,
      getFrame: () => null,
      updateCamera: vi.fn(),
    },
  };
  return renderer;
}

function setup(mode?: unknown, presenting = false) {
  (globalThis as any).window =
    mode === undefined ? {} : { __IWSDK_RENDER_MODE: mode };
  const world = new World();
  world.scene = new Scene();
  world.camera = new PerspectiveCamera();
  const renderer = fakeRenderer(presenting);
  setupRenderLoop(world, renderer as any);
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      renderer.loop!();
    }
  };
  return { world, renderer, tick };
}

afterEach(() => {
  delete (globalThis as any).window;
  vi.restoreAllMocks();
});

describe('render loop', () => {
  it('draws every frame by default', () => {
    const { world, renderer, tick } = setup();
    expect(world.renderMode).toBe('continuous');
    tick(3);
    expect(renderer.render).toHaveBeenCalledTimes(3);
  });

  it('ignores an unknown harness render mode', () => {
    const { world, renderer, tick } = setup('sometimes');
    expect(world.renderMode).toBe('continuous');
    tick(2);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it('honours the harness on-demand opt-in and still updates CPU state', () => {
    const { world, renderer, tick } = setup('on-demand');
    expect(world.renderMode).toBe('on-demand');
    const matrices = vi.spyOn(world.scene, 'updateMatrixWorld');
    const update = vi.spyOn(world, 'update');
    tick(3);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(3);
    expect(matrices).toHaveBeenCalledTimes(3);
    // Not presenting: the XR camera is left alone, as render() would.
    expect(renderer.xr.updateCamera).not.toHaveBeenCalled();
  });

  it('updates the XR camera on skipped frames while presenting', () => {
    const { world, renderer, tick } = setup('on-demand', true);
    tick(2);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.xr.updateCamera).toHaveBeenCalledTimes(2);
    expect(renderer.xr.updateCamera).toHaveBeenCalledWith(world.camera);
  });

  it('updates each visible skeleton once per skipped frame', () => {
    const { world, tick } = setup('on-demand');
    const shared = new Skeleton([new Bone()]);
    const other = new Skeleton([new Bone()]);
    const hidden = new Skeleton([new Bone()]);
    const mesh = (skeleton: Skeleton) => {
      const m = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
      m.bind(skeleton);
      world.scene.add(m);
      return m;
    };
    mesh(shared);
    mesh(shared);
    mesh(other);
    mesh(hidden).visible = false;
    const sharedUpdate = vi.spyOn(shared, 'update');
    const otherUpdate = vi.spyOn(other, 'update');
    const hiddenUpdate = vi.spyOn(hidden, 'update');
    tick(2);
    expect(sharedUpdate).toHaveBeenCalledTimes(2);
    expect(otherUpdate).toHaveBeenCalledTimes(2);
    expect(hiddenUpdate).not.toHaveBeenCalled();
  });

  it('draws requested frames in on-demand mode and stops on destroy', () => {
    const { world, renderer, tick } = setup('on-demand');
    void world.requestRender(2);
    tick(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    world.destroy();
    expect(renderer.loop).toBeNull();
  });
});
