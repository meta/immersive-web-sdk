/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Hard-surface construction library.
 *
 * Pure geometry and math only: no materials, no `World`, no DOM, no timers and
 * no randomness that is not explicitly seeded. The asset manifest is evaluated
 * once by the application runtime and once by the editor in a separate JS
 * realm, so everything here must be deterministic.
 *
 * Conventions used by every model built on top of this file:
 *   - meters
 *   - model forward is -Z, up is +Y, starboard is +X
 *   - closed lofts are watertight and get their winding corrected by signed
 *     volume, so callers never have to reason about ring order
 *   - surface detail is placed from an explicit surface frame, never from a
 *     guessed Euler triple
 */

import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InterleavedBufferAttribute,
  Matrix4,
  Object3D,
  Shape,
  Vector3,
} from '@iwsdk/core';

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-randomness
 * ------------------------------------------------------------------ */

/** Seeded LCG. Never use `Math.random()` in a manifest-evaluated module. */
export function makeRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Surface frames
 * ------------------------------------------------------------------ */

export interface SurfaceFrame {
  origin: Vector3;
  normal: Vector3;
  tangent: Vector3;
  bitangent: Vector3;
}

/**
 * Build an orthonormal frame on a surface. `tangentHint` is projected into the
 * surface plane, so callers can ask for "along the hull" or "spanwise" without
 * knowing the local curvature.
 */
export function surfaceFrame(
  origin: Vector3,
  normal: Vector3,
  tangentHint: Vector3,
): SurfaceFrame {
  const n = normal.clone().normalize();
  const t = tangentHint.clone().addScaledVector(n, -tangentHint.dot(n));
  if (t.lengthSq() < 1e-10) {
    t.copy(Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
    t.addScaledVector(n, -t.dot(n));
  }
  t.normalize();
  const b = n.clone().cross(t).normalize();
  t.copy(b).cross(n).normalize();
  return { origin: origin.clone(), normal: n, tangent: t, bitangent: b };
}

/**
 * Seat an object on a surface frame. Detail authored with local X/Y in the
 * plane and local +Z as thickness lands flush against the surface.
 */
export function placeOnSurface(
  object: Object3D,
  frame: SurfaceFrame,
  normalOffset = 0,
): void {
  object.position.copy(frame.origin).addScaledVector(frame.normal, normalOffset);
  object.quaternion.setFromRotationMatrix(
    new Matrix4().makeBasis(frame.tangent, frame.bitangent, frame.normal),
  );
}

/** Mirror a surface frame across the YZ plane while keeping a right-handed basis. */
export function mirrorSurfaceFrameX(frame: SurfaceFrame): SurfaceFrame {
  const reflect = (value: Vector3): Vector3 =>
    new Vector3(-value.x, value.y, value.z);
  return {
    origin: reflect(frame.origin),
    normal: reflect(frame.normal),
    tangent: reflect(frame.tangent).negate(),
    bitangent: reflect(frame.bitangent),
  };
}

/** Orient an object from an explicit basis instead of Euler angles. */
export function orientBasis(
  object: Object3D,
  xDir: Vector3,
  yDir: Vector3,
): void {
  const x = xDir.clone().normalize();
  const y = yDir.clone().addScaledVector(x, -yDir.dot(x)).normalize();
  const z = x.clone().cross(y).normalize();
  object.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/**
 * Position and orient a Y-up primitive (cylinder, capsule) so it spans `a` to
 * `b`. Returns the span length so the caller can size the geometry.
 */
export function alignSpan(
  object: Object3D,
  a: Vector3,
  b: Vector3,
  upHint = new Vector3(0, 0, 1),
): number {
  const dir = b.clone().sub(a);
  const length = dir.length();
  if (length < 1e-6) {return 0;}
  const y = dir.clone().normalize();
  const hint =
    Math.abs(upHint.dot(y)) > 0.98 ? new Vector3(1, 0, 0) : upHint.clone();
  const x = hint.clone().cross(y).normalize();
  const z = x.clone().cross(y).normalize();
  object.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  object.position.copy(a).addScaledVector(dir, 0.5);
  return length;
}

/* ------------------------------------------------------------------ *
 * Winding / mirroring
 * ------------------------------------------------------------------ */

function flipWinding(geometry: BufferGeometry): void {
  const index = geometry.getIndex();
  if (index) {
    const array = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < array.length; i += 3) {
      const swap = array[i + 1];
      array[i + 1] = array[i + 2];
      array[i + 2] = swap;
    }
    index.needsUpdate = true;
    return;
  }

  const attributes: Array<BufferAttribute | InterleavedBufferAttribute> = [
    ...Object.values(geometry.attributes),
    ...Object.values(geometry.morphAttributes).flat(),
  ];
  for (const attribute of attributes) {
    for (let triangle = 0; triangle + 2 < attribute.count; triangle += 3) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        const swap = attribute.getComponent(triangle + 1, component);
        attribute.setComponent(
          triangle + 1,
          component,
          attribute.getComponent(triangle + 2, component),
        );
        attribute.setComponent(triangle + 2, component, swap);
      }
    }
    attribute.needsUpdate = true;
  }
}

/**
 * Correct the winding of a closed loft using its signed volume, which is
 * origin-independent for a watertight mesh. This removes the whole class of
 * "the hull renders inside out" defects without resorting to DoubleSide.
 */
export function ensureOutwardWinding(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!index || !position) {return geometry;}
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const cross = new Vector3();
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    volume += a.dot(cross.copy(b).cross(c));
  }
  if (volume < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Mirror a chiral geometry across X, preserving outward-facing winding. */
export function mirrorGeometryX(geometry: BufferGeometry): BufferGeometry {
  const mirrored = geometry.clone();
  mirrored.scale(-1, 1, 1);
  flipWinding(mirrored);
  mirrored.computeVertexNormals();
  return mirrored;
}

/* ------------------------------------------------------------------ *
 * Bevelled box — the hard-surface workhorse
 * ------------------------------------------------------------------ */

function roundedRectShape(width: number, height: number, radius: number): Shape {
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.max(0, Math.min(radius, hw - 1e-5, hh - 1e-5));
  const shape = new Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  if (r > 0) {shape.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);}
  shape.lineTo(hw, hh - r);
  if (r > 0) {shape.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);}
  shape.lineTo(-hw + r, hh);
  if (r > 0) {shape.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);}
  shape.lineTo(-hw, -hh + r);
  if (r > 0) {shape.absarc(-hw + r, -hh + r, r, Math.PI, 1.5 * Math.PI, false);}
  return shape;
}

/**
 * A bevelled, optionally round-cornered box centred on the origin, extruded
 * along local +Z. Sized so the finished solid measures exactly w x h x d.
 */
export function bevelBox(
  width: number,
  height: number,
  depth: number,
  bevel = 0.01,
  cornerRadius?: number,
  curveSegments = 2,
): BufferGeometry {
  const b = Math.max(
    1e-4,
    Math.min(bevel, width * 0.24, height * 0.24, depth * 0.45),
  );
  const shapeW = Math.max(2e-4, width - 2 * b);
  const shapeH = Math.max(2e-4, height - 2 * b);
  const radius = Math.max(
    0,
    Math.min(cornerRadius ?? b * 1.5, shapeW / 2 - 1e-5, shapeH / 2 - 1e-5),
  );
  const extrudeDepth = Math.max(1e-4, depth - 2 * b);
  const geometry = new ExtrudeGeometry(
    roundedRectShape(shapeW, shapeH, radius),
    {
      depth: extrudeDepth,
      bevelEnabled: true,
      bevelThickness: b,
      bevelSize: b,
      bevelOffset: 0,
      bevelSegments: 1,
      curveSegments,
      steps: 1,
    },
  );
  geometry.translate(0, 0, -extrudeDepth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A trapezoidal plate lying in local XY with thickness along +Z: the standard
 * armour-panel form. Widths are given per edge so plates can follow a taper.
 */
export function taperPlate(
  lengthX: number,
  widthYFront: number,
  widthYBack: number,
  thickness: number,
  bevel = 0.006,
): BufferGeometry {
  const hx = lengthX / 2;
  const shape = new Shape();
  shape.moveTo(-hx, -widthYBack / 2);
  shape.lineTo(hx, -widthYFront / 2);
  shape.lineTo(hx, widthYFront / 2);
  shape.lineTo(-hx, widthYBack / 2);
  shape.closePath();
  const b = Math.max(1e-4, Math.min(bevel, thickness * 0.45));
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, thickness - 2 * b),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: 0,
    bevelSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -(thickness - 2 * b) / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/* ------------------------------------------------------------------ *
 * Lofted surfaces
 * ------------------------------------------------------------------ */

function superellipse(value: number, exponent: number): number {
  const magnitude = Math.abs(value);
  const scaled = magnitude === 0 ? 0 : Math.pow(magnitude, exponent);
  return value < 0 ? -scaled : scaled;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** One cross-section of a tube swept along +Z. */
export interface TubeSection {
  z: number;
  /** lateral centre offset */
  cx?: number;
  /** vertical centre offset */
  cy?: number;
  halfW: number;
  hUp: number;
  /** defaults to `hUp` */
  hDown?: number;
  /** 2 = ellipse, 4 = nearly square. Higher reads as machined. */
  power?: number;
}

/** One spanwise station of a blade swept along +X. */
export interface BladeStation {
  x: number;
  /** vertical centre of the section */
  y?: number;
  leadZ: number;
  trailZ: number;
  thickUp: number;
  thickDown?: number;
  power?: number;
}

interface ResolvedSection {
  cx: number;
  cy: number;
  a: number;
  up: number;
  down: number;
  power: number;
}

function interpolate(
  along: number,
  keys: number[],
  resolve: (i: number) => ResolvedSection,
): ResolvedSection {
  const last = keys.length - 1;
  if (along <= keys[0]) {return resolve(0);}
  if (along >= keys[last]) {return resolve(last);}
  let i = 0;
  while (i < last && keys[i + 1] < along) {i += 1;}
  const t = (along - keys[i]) / (keys[i + 1] - keys[i]);
  const lo = resolve(i);
  const hi = resolve(i + 1);
  return {
    cx: lerp(lo.cx, hi.cx, t),
    cy: lerp(lo.cy, hi.cy, t),
    a: lerp(lo.a, hi.a, t),
    up: lerp(lo.up, hi.up, t),
    down: lerp(lo.down, hi.down, t),
    power: lerp(lo.power, hi.power, t),
  };
}

/**
 * A swept superelliptical surface that can be both tessellated into a closed
 * loft and queried for surface frames. Detail placement uses the same
 * evaluator as the geometry, so attached parts cannot drift off the hull.
 */
export class LoftSurface {
  readonly range: [number, number];

  private constructor(
    private readonly evaluate: (along: number, theta: number) => Vector3,
    private readonly centre: (along: number) => Vector3,
    range: [number, number],
  ) {
    this.range = range;
  }

  /** Sweep along +Z: fuselages, nacelles, canopies. */
  static tube(sections: TubeSection[]): LoftSurface {
    const sorted = [...sections].sort((l, r) => l.z - r.z);
    const keys = sorted.map((s) => s.z);
    const resolve = (i: number): ResolvedSection => {
      const s = sorted[i];
      return {
        cx: s.cx ?? 0,
        cy: s.cy ?? 0,
        a: s.halfW,
        up: s.hUp,
        down: s.hDown ?? s.hUp,
        power: s.power ?? 2.6,
      };
    };
    const evaluate = (z: number, theta: number): Vector3 => {
      const s = interpolate(z, keys, resolve);
      const exponent = 2 / s.power;
      const sin = Math.sin(theta);
      return new Vector3(
        s.cx + s.a * superellipse(Math.cos(theta), exponent),
        s.cy + (sin >= 0 ? s.up : s.down) * superellipse(sin, exponent),
        z,
      );
    };
    const centre = (z: number): Vector3 => {
      const s = interpolate(z, keys, resolve);
      return new Vector3(s.cx, s.cy, z);
    };
    return new LoftSurface(evaluate, centre, [keys[0], keys[keys.length - 1]]);
  }

  /**
   * Sweep along +X: wings and, once reoriented by an explicit basis, fins.
   * theta = 0 is the trailing edge, theta = pi/2 the upper surface.
   */
  static blade(stations: BladeStation[]): LoftSurface {
    const sorted = [...stations].sort((l, r) => l.x - r.x);
    const keys = sorted.map((s) => s.x);
    const resolve = (i: number): ResolvedSection => {
      const s = sorted[i];
      return {
        cx: (s.leadZ + s.trailZ) / 2,
        cy: s.y ?? 0,
        a: (s.trailZ - s.leadZ) / 2,
        up: s.thickUp,
        down: s.thickDown ?? s.thickUp,
        power: s.power ?? 1.9,
      };
    };
    const evaluate = (x: number, theta: number): Vector3 => {
      const s = interpolate(x, keys, resolve);
      const exponent = 2 / s.power;
      const sin = Math.sin(theta);
      return new Vector3(
        x,
        s.cy + (sin >= 0 ? s.up : s.down) * superellipse(sin, exponent),
        s.cx + s.a * superellipse(Math.cos(theta), exponent),
      );
    };
    const centre = (x: number): Vector3 => {
      const s = interpolate(x, keys, resolve);
      return new Vector3(x, s.cy, s.cx);
    };
    return new LoftSurface(evaluate, centre, [keys[0], keys[keys.length - 1]]);
  }

  point(along: number, theta: number): Vector3 {
    return this.evaluate(along, theta);
  }

  /** Outward-facing frame; local X follows the sweep, local +Z is the normal. */
  frame(along: number, theta: number): SurfaceFrame {
    const [lo, hi] = this.range;
    const step = Math.max(1e-4, (hi - lo) * 1e-3);
    const forward = Math.min(hi, along + step);
    const back = Math.max(lo, along - step);
    const point = this.evaluate(along, theta);
    const sweep = this.evaluate(forward, theta)
      .sub(this.evaluate(back, theta))
      .normalize();
    const around = this.evaluate(along, theta + 1e-3).sub(point);
    let normal = around.clone().cross(sweep);
    if (normal.lengthSq() < 1e-14) {
      normal = point.clone().sub(this.centre(along));
    }
    normal.normalize();
    if (normal.dot(point.clone().sub(this.centre(along))) < 0) {normal.negate();}
    return surfaceFrame(point, normal, sweep);
  }

  /**
   * Find the surface frame whose normal most closely faces `outwardDirection`.
   * This lets callers ask for an outboard, upward, or downward attachment point
   * without rediscovering the loft's angular convention.
   */
  frameToward(
    along: number,
    outwardDirection: Vector3,
    samples = 72,
  ): SurfaceFrame {
    const wanted = outwardDirection.clone();
    if (wanted.lengthSq() < 1e-12) {
      return this.frame(along, 0);
    }
    wanted.normalize();
    const count = Math.max(8, Math.floor(samples));
    let best = this.frame(along, 0);
    let bestScore = best.normal.dot(wanted);
    for (let i = 1; i < count; i += 1) {
      const candidate = this.frame(along, (i / count) * Math.PI * 2);
      const score = candidate.normal.dot(wanted);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  ring(along: number, segments: number): Vector3[] {
    const points: Vector3[] = [];
    for (let i = 0; i < segments; i += 1) {
      points.push(this.evaluate(along, (i / segments) * Math.PI * 2));
    }
    return points;
  }

  /**
   * Tessellate into a closed, watertight loft. End caps get their own vertices
   * so the cap-to-body transition stays crisp instead of smearing.
   */
  build(
    alongs: number[],
    segments = 32,
    caps: boolean | { start?: boolean; end?: boolean } = {
      start: true,
      end: true,
    },
  ): BufferGeometry {
    const resolvedCaps = typeof caps === 'boolean' ? { start: caps, end: caps } : caps;
    const rings = alongs.map((a) => this.ring(a, segments));
    const positions: number[] = [];
    const indices: number[] = [];

    for (const ring of rings) {
      for (const p of ring) {positions.push(p.x, p.y, p.z);}
    }
    for (let r = 0; r < rings.length - 1; r += 1) {
      const base = r * segments;
      const next = (r + 1) * segments;
      for (let j = 0; j < segments; j += 1) {
        const j2 = (j + 1) % segments;
        indices.push(base + j, base + j2, next + j);
        indices.push(base + j2, next + j2, next + j);
      }
    }

    const addCap = (ringIndex: number, along: number, reverse: boolean) => {
      const ring = rings[ringIndex];
      const centre = this.centre(along);
      const centreIndex = positions.length / 3;
      positions.push(centre.x, centre.y, centre.z);
      const first = positions.length / 3;
      for (const p of ring) {positions.push(p.x, p.y, p.z);}
      for (let j = 0; j < segments; j += 1) {
        const a = first + j;
        const b = first + ((j + 1) % segments);
        if (reverse) {indices.push(centreIndex, b, a);}
        else {indices.push(centreIndex, a, b);}
      }
    };
    if (resolvedCaps.start !== false) {addCap(0, alongs[0], true);}
    if (resolvedCaps.end !== false) {
      addCap(rings.length - 1, alongs[alongs.length - 1], false);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return ensureOutwardWinding(geometry);
  }
}

/** Even sample positions across a loft's sweep range, inclusive of both ends. */
export function sampleRange(
  from: number,
  to: number,
  count: number,
): number[] {
  if (count <= 1) {return [from];}
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(from + ((to - from) * i) / (count - 1));
  }
  return out;
}
