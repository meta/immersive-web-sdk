/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { WebGLRenderer, type WebGLRendererParameters } from './three.js';

/**
 * @internal
 * The private `WebGLTextures` methods behind super-three's multiview texture
 * upload deferral.
 */
export interface DeferredTextureUploads {
  runDeferredUploads(): void;
  setDeferTextureUploads(defer: boolean): void;
}

const HOOK = 'setDeferTextureUploads';

/**
 * @internal
 * Create a `WebGLRenderer` that flushes the texture uploads super-three
 * 0.185.0 defers during the multiview pass (GitHub #55).
 *
 * In XR on Quest, `render()` calls `textures.setDeferTextureUploads(true)`
 * before the single multiview `renderScene()` and never turns it off, and
 * nothing calls `textures.runDeferredUploads()` (0.181 did, right after
 * `scene.onAfterRender`). Every texture first used after the first multiview
 * frame stays queued and never reaches the GPU.
 *
 * After each `render()` that turned deferral on, this flushes the queue as
 * 0.181 did, and the outermost `render()` also turns deferral off so uploads
 * outside the multiview pass (including after the session ends) happen
 * immediately. Renders that never defer are untouched. If super-three starts
 * flushing itself, the extra flush finds an empty queue. If `WebGLTextures`
 * changes shape, nothing is captured and the renderer is returned unmodified.
 */
export function createWebGLRenderer(
  parameters?: WebGLRendererParameters & { multiviewStereo?: boolean },
): WebGLRenderer {
  let textures: DeferredTextureUploads | undefined;
  const release = captureDeferredTextureUploads((captured) => {
    textures = captured;
  });
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer(parameters);
  } finally {
    release();
  }
  if (textures) {
    flushDeferredTextureUploads(renderer, textures);
  }
  return renderer;
}

/**
 * @internal
 * Capture the next `WebGLTextures` constructed, so the caller can reach the
 * renderer's private instance. Returns a function that removes the hook if it
 * has not fired; call it as soon as construction is over.
 *
 * `WebGLTextures` assigns its methods as own properties (`this.x = x`), and
 * assigns `setDeferTextureUploads` right after `runDeferredUploads`. A
 * temporary setter for that name on `Object.prototype` is therefore called with
 * the instance as `this` once both exist. It removes itself on its first call
 * and completes the assignment with the same own data property a plain
 * assignment creates, so the instance ends up exactly as without the hook. It
 * is non-enumerable, has no getter (reads still see `undefined`), and is not
 * installed if `Object.prototype` already has a property of that name.
 */
export function captureDeferredTextureUploads(
  onCapture: (textures: DeferredTextureUploads) => void,
): () => void {
  const prototype = Object.prototype as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(prototype, HOOK)) {
    return () => {};
  }
  const release = () => {
    if (Object.getOwnPropertyDescriptor(prototype, HOOK)?.set === set) {
      delete prototype[HOOK];
    }
  };
  function set(this: Record<string, unknown>, value: unknown) {
    release();
    Object.defineProperty(this, HOOK, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    if (
      typeof value === 'function' &&
      typeof this.runDeferredUploads === 'function'
    ) {
      onCapture(this as unknown as DeferredTextureUploads);
    }
  }
  Object.defineProperty(prototype, HOOK, { set, configurable: true });
  return release;
}

function flushDeferredTextureUploads(
  renderer: WebGLRenderer,
  initial: DeferredTextureUploads,
) {
  let textures: DeferredTextureUploads;
  // Whether deferral was turned on since the last outermost render().
  let deferred = false;
  const track = (captured: DeferredTextureUploads) => {
    textures = captured;
    deferred = false;
    const setDefer = captured.setDeferTextureUploads;
    captured.setDeferTextureUploads = (defer) => {
      deferred ||= defer;
      setDefer(defer);
    };
  };
  track(initial);

  // render() may be called from a callback inside another render(). Flush
  // after each one, as 0.181 did (runDeferredUploads keeps the flag), but only
  // turn deferral off once the outermost multiview pass is over.
  let depth = 0;
  const render = renderer.render;
  renderer.render = function (scene, camera) {
    depth++;
    try {
      render.call(this, scene, camera);
    } finally {
      depth--;
    }
    if (deferred) {
      textures.runDeferredUploads();
      if (depth === 0) {
        textures.setDeferTextureUploads(false);
        deferred = false;
      }
    }
  };

  // On context restore the renderer's own listener builds a new
  // WebGLTextures. Capture listeners on the canvas run before it. The timeout
  // removes the hook if nothing was built.
  renderer.domElement.addEventListener(
    'webglcontextrestored',
    () => {
      const release = captureDeferredTextureUploads(track);
      setTimeout(release);
    },
    { capture: true },
  );
}
