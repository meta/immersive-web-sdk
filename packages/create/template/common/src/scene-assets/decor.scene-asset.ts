/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  createSceneMaterial,
  createScenePrimitiveObject,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  type SceneProceduralMeshDescriptor,
  SRGBColorSpace,
  TorusGeometry,
  UnsignedByteType,
} from '@iwsdk/core';

/**
 * Background furniture for the VR and Desktop 3D starters, built in code so
 * the starter downloads no extra models. Everything here is light on purpose:
 * dark graphite is kept for things you can interact with. It is safe to
 * delete this file together with the gallery-set and sideboard-set entries in
 * src/assets.ts and their scene nodes.
 */

// Small seeded random generator (mulberry32), so the marble comes out the
// same on every load.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = [number, number];

/** One canvas-style stroke along a polyline, in 1024 px drawing units. */
interface Stroke {
  run: Point[];
  width: number;
  alpha: number;
}

/**
 * The marble as drawing steps: faint gray clouds, then veins that wander
 * diagonally and now and then split off a thinner branch. Every vein run is
 * a pair of strokes, a faint wide halo and then a thin line.
 */
function marbleDrawing(seed: number, size: number) {
  const random = seededRandom(seed);
  const clouds: { x: number; y: number; radius: number }[] = [];
  for (let index = 0; index < 12; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = size * (0.15 + random() * 0.3);
    clouds.push({ x, y, radius });
  }

  const strokes: Stroke[] = [];
  const step = size / 200;
  const vein = (
    x: number,
    y: number,
    heading: number,
    length: number,
    width: number,
    alpha: number,
  ): void => {
    const points: Point[] = [[x, y]];
    let angle = heading;
    for (let travelled = 0; travelled < length; travelled += step) {
      // Wander, but keep drifting back toward the heading.
      angle += (random() - 0.5) * 0.45 + (heading - angle) * 0.1;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      points.push([x, y]);
      if (width > 0.9 && random() < 0.025) {
        const side = random() < 0.5 ? -1 : 1;
        vein(
          x,
          y,
          angle + side * (0.35 + random() * 0.5),
          length * (0.12 + random() * 0.25),
          width * 0.6,
          alpha * 0.85,
        );
      }
    }
    // Short runs of varying width, each a faint halo under a thin line.
    for (let index = 0; index < points.length - 1; index += 6) {
      const run = points.slice(index, index + 7);
      const runWidth = width * (0.35 + random());
      strokes.push({ run, width: runWidth * 6, alpha: alpha * 0.07 });
      strokes.push({ run, width: runWidth, alpha });
    }
  };

  // Main veins start on a line across the flow, spaced to cover the slab.
  const heading = 0.55;
  const [dx, dy] = [Math.cos(heading), Math.sin(heading)];
  for (let index = 0; index < 4; index += 1) {
    const offset = ((index + 0.2 + 0.6 * random()) / 4 - 0.5) * 1.5 * size;
    vein(
      size / 2 - dx * 0.8 * size - dy * offset,
      size / 2 - dy * 0.8 * size + dx * offset,
      heading + (random() - 0.5) * 0.4,
      size * 1.6,
      2.2,
      0.45,
    );
  }
  // Hairline veins.
  for (let index = 0; index < 12; index += 1) {
    vein(
      (random() * 1.2 - 0.2) * size,
      (random() * 1.2 - 0.2) * size,
      heading + (random() - 0.5) * 1.2,
      size * (0.3 + random() * 0.6),
      0.8,
      0.22,
    );
  }
  return { clouds, strokes };
}

/** A square sRGB paint buffer (0..1, interleaved RGB) in drawing units. */
interface Canvas {
  rgb: Float32Array;
  size: number;
  /** Texels per drawing unit. */
  scale: number;
}

/** Blend `color` over one texel at `alpha`, in sRGB as a 2D canvas does. */
function blend(
  canvas: Canvas,
  texel: number,
  color: number[],
  alpha: number,
): void {
  const { rgb } = canvas;
  const index = texel * 3;
  rgb[index] += (color[0] - rgb[index]) * alpha;
  rgb[index + 1] += (color[1] - rgb[index + 1]) * alpha;
  rgb[index + 2] += (color[2] - rgb[index + 2]) * alpha;
}

function clampTexel(canvas: Canvas, value: number): number {
  return Math.min(canvas.size - 1, Math.max(0, Math.floor(value)));
}

/** A radial cloud that fades out linearly from `alpha` to its rim. */
function paintCloud(
  canvas: Canvas,
  cloud: { x: number; y: number; radius: number },
  color: number[],
  alpha: number,
): void {
  const { size, scale } = canvas;
  const x = cloud.x * scale;
  const y = cloud.y * scale;
  const radius = cloud.radius * scale;
  const bottom = clampTexel(canvas, y + radius + 1);
  for (let py = clampTexel(canvas, y - radius); py <= bottom; py += 1) {
    const dy = py + 0.5 - y;
    if (Math.abs(dy) >= radius) {
      continue;
    }
    const half = Math.sqrt(radius * radius - dy * dy);
    const right = clampTexel(canvas, x + half + 0.5);
    for (let px = clampTexel(canvas, x - half - 0.5); px <= right; px += 1) {
      const dx = px + 0.5 - x;
      const t = Math.sqrt(dx * dx + dy * dy) / radius;
      if (t < 1) {
        blend(canvas, py * size + px, color, alpha * (1 - t));
      }
    }
  }
}

/**
 * A halo and a line stroked along the same run, with round caps and joins
 * like a canvas path. A texel's coverage comes from its distance to the run,
 * with a one-texel antialiased edge, and each segment only measures the
 * texels it can reach.
 */
function paintStrokePair(
  canvas: Canvas,
  halo: Stroke,
  line: Stroke,
  color: number[],
): void {
  const { size, scale } = canvas;
  const run = halo.run.map(([x, y]) => [x * scale, y * scale]);
  const haloRadius = (halo.width * scale) / 2;
  const lineRadius = (line.width * scale) / 2;
  const reach = haloRadius + 1;
  const xs = run.map(([x]) => x);
  const ys = run.map(([, y]) => y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  if (
    maxX + reach < 0 ||
    maxY + reach < 0 ||
    minX - reach >= size ||
    minY - reach >= size
  ) {
    return;
  }
  const left = clampTexel(canvas, minX - reach);
  const top = clampTexel(canvas, minY - reach);
  const width = clampTexel(canvas, maxX + reach) - left + 1;
  const height = clampTexel(canvas, maxY + reach) - top + 1;
  const nearest = new Float32Array(width * height).fill(Infinity);
  for (let point = 0; point < run.length - 1; point += 1) {
    const [ax, ay] = run[point];
    const [bx, by] = run[point + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const lengthSq = ex * ex + ey * ey;
    const x0 = clampTexel(canvas, Math.min(ax, bx) - reach);
    const x1 = clampTexel(canvas, Math.max(ax, bx) + reach);
    const y0 = clampTexel(canvas, Math.min(ay, by) - reach);
    const y1 = clampTexel(canvas, Math.max(ay, by) + reach);
    for (let py = y0; py <= y1; py += 1) {
      const qy = py + 0.5;
      for (let px = x0; px <= x1; px += 1) {
        const qx = px + 0.5;
        let along =
          lengthSq > 0 ? ((qx - ax) * ex + (qy - ay) * ey) / lengthSq : 0;
        along = along < 0 ? 0 : along > 1 ? 1 : along;
        const fx = ax + ex * along - qx;
        const fy = ay + ey * along - qy;
        const slot = (py - top) * width + (px - left);
        nearest[slot] = Math.min(nearest[slot], fx * fx + fy * fy);
      }
    }
  }
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const distance = Math.sqrt(nearest[row * width + column]);
      const texel = (top + row) * size + left + column;
      const haloCover = haloRadius + 0.5 - distance;
      if (haloCover > 0) {
        blend(canvas, texel, color, halo.alpha * Math.min(1, haloCover));
      }
      const lineCover = lineRadius + 0.5 - distance;
      if (lineCover > 0) {
        blend(canvas, texel, color, line.alpha * Math.min(1, lineCover));
      }
    }
  }
}

/** Canvas rows run top down; texture rows run bottom up. */
function toTexturePixels({ rgb, size }: Canvas): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 3;
      const target = ((size - 1 - y) * size + x) * 4;
      pixels[target] = Math.round(rgb[source] * 255);
      pixels[target + 1] = Math.round(rgb[source + 1] * 255);
      pixels[target + 2] = Math.round(rgb[source + 2] * 255);
      pixels[target + 3] = 255;
    }
  }
  return pixels;
}

/**
 * White marble painted once into a pixel buffer, blending each step over the
 * last as a 2D canvas does, so it needs no DOM. It is drawn on a 1024 px
 * canvas and painted at `size`: 512 px keeps the load time down and looks the
 * same at viewing distance, where the block samples small mips.
 */
function createMarbleTexture(seed = 9, size = 512): DataTexture {
  const { clouds, strokes } = marbleDrawing(seed, 1024);
  const canvas: Canvas = {
    rgb: new Float32Array(size * size * 3),
    size,
    scale: size / 1024,
  };
  const background = [0xf2 / 255, 0xf1 / 255, 0xee / 255];
  for (let index = 0; index < canvas.rgb.length; index += 1) {
    canvas.rgb[index] = background[index % 3];
  }
  const cloudColor = [208 / 255, 210 / 255, 217 / 255];
  for (const cloud of clouds) {
    paintCloud(canvas, cloud, cloudColor, 0.2);
  }
  const veinColor = [128 / 255, 132 / 255, 142 / 255];
  for (let index = 0; index < strokes.length; index += 2) {
    paintStrokePair(canvas, strokes[index], strokes[index + 1], veinColor);
  }
  const texture = new DataTexture(
    toTexturePixels(canvas),
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

const marble = new MeshStandardMaterial({
  map: createMarbleTexture(),
  roughness: 0.3,
});

const wood = createSceneMaterial({
  id: 'decor-wood',
  model: 'standard',
  roughness: 0.7,
  textures: {
    albedo: {
      type: 'procedural',
      algorithm: 'periodic-fbm-v1',
      resolution: [128, 512],
      seed: 5,
      bands: [
        { frequency: [2, 36], amplitude: 0.7 },
        { frequency: [4, 90], amplitude: 0.3 },
      ],
      ramp: [
        { at: 0, color: '#DCCBAF' },
        { at: 1, color: '#ECDFC8' },
      ],
    },
  },
});

const sandClay = createSceneMaterial({
  id: 'decor-sand-clay',
  model: 'physical',
  roughness: 0.86,
  sheen: 0.35,
  sheenColor: '#FFFFFF',
  sheenRoughness: 0.8,
  textures: {
    albedo: {
      type: 'procedural',
      algorithm: 'periodic-fbm-v1',
      resolution: [256, 256],
      seed: 21,
      bands: [
        { frequency: [6, 6], amplitude: 0.6 },
        { frequency: [28, 28], amplitude: 0.4 },
      ],
      ramp: [
        { at: 0, color: '#C4AD8A' },
        { at: 1, color: '#DCC8A8' },
      ],
    },
    bump: {
      type: 'procedural',
      algorithm: 'periodic-fbm-v1',
      resolution: [256, 256],
      seed: 11,
      bands: [
        { frequency: [24, 24], amplitude: 0.6 },
        { frequency: [64, 64], amplitude: 0.4 },
      ],
      scale: 0.3,
    },
  },
});

const brass = createSceneMaterial({
  id: 'decor-brass',
  model: 'standard',
  baseColor: '#C9A46A',
  metalness: 0.85,
  roughness: 0.32,
});

const porcelain = createSceneMaterial({
  id: 'decor-porcelain',
  model: 'physical',
  baseColor: '#F4F2EE',
  roughness: 0.25,
  clearcoat: 0.5,
  clearcoatRoughness: 0.1,
  // Open-ended shapes show their glazed inside.
  side: 'double',
});

const linen = createSceneMaterial({
  id: 'decor-linen',
  model: 'standard',
  baseColor: '#F3EEE6',
  roughness: 0.95,
  emissive: '#FFF4E2',
  emissiveIntensity: 0.12,
  side: 'double',
});

const paper = createSceneMaterial({
  id: 'decor-paper',
  model: 'standard',
  baseColor: '#F3EFE7',
  roughness: 0.9,
});

const glaze = (id: string, color: `#${string}`) =>
  createSceneMaterial({
    id,
    model: 'physical',
    baseColor: color,
    roughness: 0.35,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  });

const cover = (id: string, color: `#${string}`) =>
  createSceneMaterial({
    id,
    model: 'standard',
    baseColor: color,
    roughness: 0.8,
  });

function part(
  geometry: SceneProceduralMeshDescriptor['geometry'],
  material: Material,
  x = 0,
  y = 0,
  z = 0,
): Mesh {
  const mesh = createScenePrimitiveObject({ geometry }, material);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Horn-like crescent for the sculpture. It rises from a thin tip at y = 0,
 * curls over and ends in a thick, rounded end that hangs in the air.
 */
function horn(radius: number, tube: number, material: Material): Group {
  const lift = radius * 0.6;
  // The tip dips just below y = 0; the free end hangs a little above the
  // center of the curl.
  const start = -Math.asin(0.6) - 0.06;
  const end = Math.PI - 0.15;
  const segments = 72;
  const geometry = new TorusGeometry(radius, tube, 16, segments, end - start);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    // Vertices run along the arc in rows of segments + 1.
    const along = (index % (segments + 1)) / segments;
    const angle = along * (end - start);
    const centerX = radius * Math.cos(angle);
    const centerY = radius * Math.sin(angle);
    const taper = 0.1 + 0.9 * along ** 0.6;
    position.setXYZ(
      index,
      centerX + (position.getX(index) - centerX) * taper,
      centerY + (position.getY(index) - centerY) * taper,
      position.getZ(index) * taper,
    );
  }
  const body = new Mesh(geometry, material);
  body.rotation.z = start;
  body.position.y = lift;
  const cap = createScenePrimitiveObject(
    { geometry: { type: 'sphere', radius: tube, segments: 24 } },
    material,
  );
  cap.position.set(radius * Math.cos(end), lift + radius * Math.sin(end), 0);
  const result = new Group();
  result.add(body, cap);
  return result;
}

/** Tall glazed floor vase, about 0.55 m. */
function floorVase(material: Material): Mesh {
  return part(
    {
      type: 'lathe',
      profile: [
        [0.001, 0],
        [0.085, 0],
        [0.1, 0.012],
        [0.135, 0.1],
        [0.15, 0.2],
        [0.14, 0.3],
        [0.1, 0.4],
        [0.064, 0.46],
        [0.057, 0.5],
        [0.066, 0.54],
        [0.07, 0.55],
        [0.06, 0.55],
        [0.048, 0.5],
        [0.001, 0.48],
      ],
      segments: 64,
    },
    material,
  );
}

/** One closed book lying flat, spine toward -x. */
function book(size: [number, number, number], coverMaterial: Material): Group {
  const [width, thickness, depth] = size;
  const board = 0.003;
  const result = new Group();
  result.add(
    part(
      {
        type: 'box',
        size: [width - 0.008, thickness - board * 2, depth - 0.008],
      },
      paper,
      0.004,
    ),
    part(
      { type: 'box', size: [width, board, depth] },
      coverMaterial,
      0,
      (thickness - board) / 2,
    ),
    part(
      { type: 'box', size: [width, board, depth] },
      coverMaterial,
      0,
      -(thickness - board) / 2,
    ),
    part(
      { type: 'box', size: [board * 1.5, thickness, depth] },
      coverMaterial,
      -width / 2 + board * 0.75,
    ),
  );
  return result;
}

function bookStack(): Group {
  const stack = new Group();
  const books: [[number, number, number], Material, number][] = [
    [[0.27, 0.034, 0.2], cover('decor-cover-sand', '#D8CBB8'), 0.06],
    [[0.25, 0.026, 0.18], cover('decor-cover-sage', '#BFC8BC'), -0.1],
    [[0.23, 0.03, 0.17], cover('decor-cover-bone', '#E7E2D8'), 0.14],
  ];
  let y = 0;
  for (const [size, material, turn] of books) {
    const next = book(size, material);
    next.position.y = y + size[1] / 2;
    next.rotation.y = turn;
    stack.add(next);
    y += size[1];
  }
  return stack;
}

function floorLamp(): Group {
  const lamp = new Group();
  const shadeBottom = 1.33;
  const shadeHeight = 0.27;
  // An open frustum: the linen is double-sided, so its inside shows too.
  const shade = part(
    {
      type: 'lathe',
      profile: [
        [0.21, 0],
        [0.19, shadeHeight],
      ],
      segments: 48,
    },
    linen,
    0,
    shadeBottom,
  );
  const trims = [0.19, 0.21].map((radius, index) => {
    const trim = part(
      {
        type: 'torus',
        radius,
        tube: 0.004,
        radialSegments: 6,
        tubularSegments: 64,
      },
      brass,
      0,
      shadeBottom + shadeHeight * (1 - index),
    );
    trim.rotation.x = Math.PI / 2;
    return trim;
  });
  lamp.add(
    part(
      {
        type: 'lathe',
        profile: [
          [0.001, 0],
          [0.15, 0],
          [0.155, 0.006],
          [0.15, 0.016],
          [0.02, 0.024],
          [0.001, 0.024],
        ],
        segments: 48,
      },
      brass,
    ),
    part(
      { type: 'cylinder', radius: 0.009, height: 1.42, segments: 12 },
      brass,
      0,
      0.734,
    ),
    shade,
    ...trims,
  );
  return lamp;
}

/** Marble block with a sand clay sculpture of two horns, and a floor vase. */
export function createGallerySet(): Group {
  const set = new Group();
  const height = 0.84;
  const block = part(
    {
      type: 'roundedBox',
      size: [1.2, height, 0.56],
      radius: 0.012,
      segments: 3,
    },
    marble,
    0,
    height / 2,
  );
  block.name = 'marble-block';
  set.add(block);
  // Two mirrored horns whose tips cross over the middle of the block.
  for (const side of [-1, 1]) {
    const next = horn(0.21, 0.05, sandClay);
    next.name = side < 0 ? 'horn-left' : 'horn-right';
    next.position.set(side * 0.087, height, 0);
    next.rotation.y = side < 0 ? 0.3 : Math.PI - 0.3;
    set.add(next);
  }
  const vase = floorVase(glaze('decor-glaze-rose', '#CDA893'));
  vase.name = 'vase';
  vase.position.set(-0.95, 0, -0.15);
  vase.scale.setScalar(1.25);
  set.add(vase);
  return set;
}

/**
 * Pale wood sideboard with brass pulls, a porcelain vase and books on top,
 * and a floor lamp at its right.
 */
export function createSideboardSet(): Group {
  const set = new Group();
  const legHeight = 0.22;
  const width = 1.8;
  const depth = 0.45;
  const top = 0.84;
  const front = depth / 2 + 0.008;
  const cabinet = part(
    {
      type: 'roundedBox',
      size: [width, top - legHeight, depth],
      radius: 0.012,
      segments: 3,
    },
    wood,
    0,
    (top + legHeight) / 2,
  );
  cabinet.name = 'cabinet';
  set.add(cabinet);
  for (const side of [-1, 1]) {
    const x = side * 0.4475;
    set.add(
      // Drawer, door and their pulls.
      part(
        {
          type: 'roundedBox',
          size: [0.885, 0.15, 0.016],
          radius: 0.004,
          segments: 2,
        },
        wood,
        x,
        top - 0.087,
        front,
      ),
      part(
        {
          type: 'roundedBox',
          size: [0.885, 0.43, 0.016],
          radius: 0.004,
          segments: 2,
        },
        wood,
        x,
        legHeight + 0.227,
        front,
      ),
    );
    const drawerPull = part(
      { type: 'cylinder', radius: 0.0055, height: 0.2, segments: 10 },
      brass,
      x,
      top - 0.05,
      front + 0.014,
    );
    drawerPull.rotation.z = Math.PI / 2;
    set.add(
      drawerPull,
      part(
        { type: 'cylinder', radius: 0.0055, height: 0.2, segments: 10 },
        brass,
        side * 0.045,
        legHeight + 0.3,
        front + 0.014,
      ),
    );
    for (const end of [-1, 1]) {
      const leg = part(
        {
          type: 'cylinder',
          radiusTop: 0.02,
          radiusBottom: 0.011,
          height: 0.25,
          segments: 12,
        },
        wood,
        side * 0.8,
        legHeight - 0.115,
        end * 0.16,
      );
      // Splay each leg out from its corner.
      leg.rotation.set(-end * 0.08, 0, side * 0.12);
      set.add(leg);
    }
  }

  // A half-ring turned upside down makes a U-shaped vase.
  const vase = part(
    {
      type: 'torus',
      radius: 0.075,
      tube: 0.04,
      radialSegments: 20,
      tubularSegments: 48,
      arcDeg: 180,
    },
    porcelain,
  );
  vase.name = 'vase';
  vase.rotation.z = Math.PI;
  vase.position.set(-0.45, top + 0.11, 0);
  const books = bookStack();
  books.name = 'books';
  books.position.set(0.42, top, 0.02);
  const lamp = floorLamp();
  lamp.name = 'floor-lamp';
  lamp.position.set(1.1, 0, -0.08);
  set.add(vase, books, lamp);
  return set;
}
