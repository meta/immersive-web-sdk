/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

interface QuadLayerInitInput {
  transform: XRRigidTransform;
  width: number;
  height: number;
  space: XRSpace;
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * Convert a quad's full size in meters to the values an XRQuadLayer takes.
 *
 * Quest Browser, and the WebXR Layers polyfill that IWER installs, size a quad
 * layer from its center: `width` and `height` are half-extents, so a 1 m x 1 m
 * quad needs `{ width: 0.5, height: 0.5 }`. Passing the full size draws the
 * layer at twice the size of its fallback mesh.
 */
export function toNativeQuadLayerSize(
  width: number,
  height: number,
): { width: number; height: number } {
  return { width: width / 2, height: height / 2 };
}

export function createQuadLayerInit({
  transform,
  width,
  height,
  space,
  pixelWidth,
  pixelHeight,
}: QuadLayerInitInput): XRQuadLayerInit & { clearOnAccess: false } {
  return {
    transform,
    ...toNativeQuadLayerSize(width, height),
    space,
    viewPixelWidth: pixelWidth,
    viewPixelHeight: pixelHeight,
    clearOnAccess: false,
  };
}
