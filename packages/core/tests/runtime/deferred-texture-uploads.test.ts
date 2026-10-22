/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureDeferredTextureUploads,
  createWebGLRenderer,
} from '../../src/runtime/deferred-texture-uploads.js';
import {
  ArrayCamera,
  DataTexture,
  PerspectiveCamera,
  Scene,
  Vector4,
  WebGLRenderer,
} from '../../src/runtime/index.js';

const HOOK = 'setDeferTextureUploads';

const hasHook = () =>
  Object.prototype.hasOwnProperty.call(Object.prototype, HOOK);

/**
 * Just enough of a WebGL2 context for super-three's WebGLRenderer to
 * construct, render an empty scene and upload a DataTexture. Records every
 * call so tests can compare what two renderers send to the GPU.
 */
function createFakeGL(calls: string[] = []) {
  const constants = new Map<string, number>();
  const names = new Map<number, string>();
  const constant = (name: string) => {
    if (!constants.has(name)) {
      constants.set(name, 0x10000 + constants.size);
      names.set(constants.get(name)!, name);
    }
    return constants.get(name)!;
  };
  const getParameter = (pname: number) => {
    const name = names.get(pname) ?? '';
    if (name === 'VERSION') {
      return 'WebGL 2.0';
    }
    if (name === 'SHADING_LANGUAGE_VERSION') {
      return 'WebGL GLSL ES 3.00';
    }
    if (name === 'VIEWPORT' || name === 'SCISSOR_BOX') {
      return new Int32Array([0, 0, 1, 1]);
    }
    return name.startsWith('MAX_') ? 16 : 0;
  };
  const methods: Record<string, (...args: any[]) => unknown> = {
    getContextAttributes: () => ({ alpha: false, antialias: false }),
    getExtension: () => null,
    getParameter,
    getShaderPrecisionFormat: () => ({
      precision: 23,
      rangeMin: 127,
      rangeMax: 127,
    }),
    getError: () => 0,
    isContextLost: () => false,
  };
  const target: Record<string, unknown> = {
    drawingBufferWidth: 1,
    drawingBufferHeight: 1,
  };
  return new Proxy(target, {
    get(object, key) {
      if (typeof key !== 'string') {
        return undefined;
      }
      if (key in object) {
        return object[key];
      }
      if (/^[A-Z0-9_]+$/.test(key)) {
        return constant(key);
      }
      return (...args: unknown[]) => {
        calls.push(key);
        if (key in methods) {
          return methods[key](...args);
        }
        return key.startsWith('create') ? {} : undefined;
      };
    },
  }) as unknown as WebGL2RenderingContext;
}

/**
 * A canvas whose events, like a browser's, run capture listeners on the
 * target before the others (Node's EventTarget uses registration order).
 */
function createFakeCanvas() {
  const listeners: { type: string; listener: any; capture: boolean }[] = [];
  const isCapture = (options?: boolean | AddEventListenerOptions) =>
    typeof options === 'boolean' ? options : !!options?.capture;
  const canvas = {
    width: 1,
    height: 1,
    style: {},
    getContext: () => null,
    addEventListener(type: string, listener: any, options?: any) {
      listeners.push({ type, listener, capture: isCapture(options) });
    },
    removeEventListener(type: string, listener: any, options?: any) {
      const index = listeners.findIndex(
        (entry) =>
          entry.type === type &&
          entry.listener === listener &&
          entry.capture === isCapture(options),
      );
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    dispatchEvent(event: Event) {
      for (const capture of [true, false]) {
        for (const entry of [...listeners]) {
          if (entry.type === event.type && entry.capture === capture) {
            entry.listener(event);
          }
        }
      }
      return true;
    },
  };
  return canvas as unknown as HTMLCanvasElement;
}

const createPlainRenderer = (parameters: object) =>
  new WebGLRenderer(parameters);

function createRenderer(
  create: (parameters: object) => WebGLRenderer = createWebGLRenderer,
  calls?: string[],
) {
  return create({ canvas: createFakeCanvas(), context: createFakeGL(calls) });
}

/** Take super-three's multiview branch in render() without an XR session. */
function enableMultiview(renderer: WebGLRenderer) {
  renderer.xr.enabled = true;
  (renderer.xr as unknown as { isMultiview: boolean }).isMultiview = true;
  const eye = new PerspectiveCamera();
  eye.viewport = new Vector4(0, 0, 1, 1);
  return new ArrayCamera([eye, eye.clone()]);
}

function createTexture() {
  const texture = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

const isPending = (texture: DataTexture) =>
  (texture as DataTexture & { isPendingDeferredUpload?: boolean })
    .isPendingDeferredUpload === true;

const isUploaded = (renderer: WebGLRenderer, texture: DataTexture) =>
  (renderer.properties.get(texture) as { __webglTexture?: unknown })
    .__webglTexture !== undefined;

describe('super-three multiview deferred texture uploads (GitHub #55)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uploads a texture first used during a multiview frame by the end of that frame', () => {
    const renderer = createRenderer();
    const camera = enableMultiview(renderer);
    const scene = new Scene();
    const texture = createTexture();
    let pendingDuringFrame: boolean | undefined;
    scene.onAfterRender = () => {
      renderer.initTexture(texture);
      pendingDuringFrame = isPending(texture);
    };

    renderer.render(scene, camera);

    // super-three deferred it, so this goes through the real deferral path.
    expect(pendingDuringFrame).toBe(true);
    expect(isUploaded(renderer, texture)).toBe(true);
    expect(isPending(texture)).toBe(false);
  });

  it('turns deferral off after the multiview frame', () => {
    const renderer = createRenderer();
    renderer.render(new Scene(), enableMultiview(renderer));

    // For example a texture first shown in the 2D view after the session ends.
    const texture = createTexture();
    renderer.initTexture(texture);

    expect(isPending(texture)).toBe(false);
    expect(isUploaded(renderer, texture)).toBe(true);
  });

  it('flushes after nested renders but keeps deferring until the outer multiview render ends', () => {
    const renderer = createRenderer();
    const camera = enableMultiview(renderer);
    const scene = new Scene();
    const nested = createTexture();
    const later = createTexture();
    let nestedUploaded: boolean | undefined;
    let laterPending: boolean | undefined;
    scene.onAfterRender = () => {
      const inner = new Scene();
      inner.onAfterRender = () => renderer.initTexture(nested);
      renderer.render(inner, new PerspectiveCamera());
      nestedUploaded = isUploaded(renderer, nested);
      renderer.initTexture(later);
      laterPending = isPending(later);
    };

    renderer.render(scene, camera);

    expect(nestedUploaded).toBe(true);
    expect(laterPending).toBe(true);
    expect(isUploaded(renderer, later)).toBe(true);
  });

  it('sends the same GL calls as a plain renderer when nothing is deferred', () => {
    const plainCalls: string[] = [];
    const patchedCalls: string[] = [];
    for (const [create, calls] of [
      [createPlainRenderer, plainCalls],
      [createWebGLRenderer, patchedCalls],
    ] as const) {
      const renderer = createRenderer(create, calls);
      const scene = new Scene();
      const texture = createTexture();
      scene.onAfterRender = () => renderer.initTexture(texture);
      renderer.render(scene, new PerspectiveCamera());
      renderer.render(scene, new PerspectiveCamera());
    }

    expect(patchedCalls).toContain('texImage2D');
    expect(patchedCalls).toEqual(plainCalls);
  });

  it('is still needed: a plain super-three renderer never uploads the texture', () => {
    // If this fails, super-three flushes deferred uploads itself and
    // createWebGLRenderer() can be removed.
    const renderer = createRenderer(createPlainRenderer);
    const camera = enableMultiview(renderer);
    const scene = new Scene();
    const texture = createTexture();
    scene.onAfterRender = () => renderer.initTexture(texture);
    renderer.render(scene, camera);
    scene.onAfterRender = () => {};
    renderer.render(scene, camera);

    expect(isPending(texture)).toBe(true);
    expect(isUploaded(renderer, texture)).toBe(false);
  });

  it('keeps flushing after the WebGL context is restored', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const canvas = createFakeCanvas();
    const renderer = createWebGLRenderer({ canvas, context: createFakeGL() });
    const camera = enableMultiview(renderer);
    renderer.render(new Scene(), camera);

    // The renderer's own listener builds a new WebGLTextures.
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(hasHook()).toBe(false);

    const scene = new Scene();
    const texture = createTexture();
    scene.onAfterRender = () => renderer.initTexture(texture);
    renderer.render(scene, camera);

    expect(isUploaded(renderer, texture)).toBe(true);
  });

  it('removes the Object.prototype hook once the renderer exists', () => {
    createRenderer();

    expect(hasHook()).toBe(false);
  });

  it('removes the hook when the renderer cannot be created', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => createWebGLRenderer({ canvas: createFakeCanvas() })).toThrow(
      'Error creating WebGL context',
    );
    expect(hasHook()).toBe(false);
  });

  it('removes the hook after a restore event that builds no WebGLTextures', () => {
    vi.useFakeTimers();
    const canvas = createFakeCanvas();
    const renderer = createWebGLRenderer({ canvas, context: createFakeGL() });
    // dispose() removes the renderer's own restore listener.
    renderer.dispose();

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    vi.runAllTimers();

    expect(hasHook()).toBe(false);
  });
});

describe('captureDeferredTextureUploads', () => {
  function Textures(this: Record<string, unknown>) {
    this.runDeferredUploads = () => {};
    this.setDeferTextureUploads = () => {};
  }

  it('captures the instance and leaves it as a plain assignment would', () => {
    const onCapture = vi.fn();
    const release = captureDeferredTextureUploads(onCapture);
    const textures = new (Textures as any)();
    release();

    expect(onCapture).toHaveBeenCalledWith(textures);
    expect(Object.getOwnPropertyDescriptor(textures, HOOK)).toMatchObject({
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(Object.keys(textures)).toEqual([
      'runDeferredUploads',
      'setDeferTextureUploads',
    ]);
    expect(hasHook()).toBe(false);
  });

  it('ignores an object that does not look like WebGLTextures', () => {
    const onCapture = vi.fn();
    const release = captureDeferredTextureUploads(onCapture);
    const other: Record<string, unknown> = {};
    other[HOOK] = () => {};
    release();

    expect(onCapture).not.toHaveBeenCalled();
    expect(typeof other[HOOK]).toBe('function');
    expect(hasHook()).toBe(false);
  });

  it('does nothing if Object.prototype already has a property of that name', () => {
    const existing = () => {};
    Object.defineProperty(Object.prototype, HOOK, {
      value: existing,
      writable: true,
      configurable: true,
    });
    try {
      const onCapture = vi.fn();
      const release = captureDeferredTextureUploads(onCapture);
      new (Textures as any)();
      release();

      expect(onCapture).not.toHaveBeenCalled();
      expect((Object.prototype as Record<string, unknown>)[HOOK]).toBe(
        existing,
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>)[HOOK];
    }
  });
});
