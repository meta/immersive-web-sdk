/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box3, Matrix4, Object3D, Sphere, Vector3 } from 'three';
import type {
  GazeCandidateContext,
  GazeCandidateProvider,
  GazeHit,
} from './gaze-candidate-provider.js';
import { isObjectTreeVisible } from './visibility.js';

/**
 * Comparator over two `GazeHit` candidates. Return < 0 if `a` wins, > 0 if `b`
 * wins, 0 for unchanged. The conecaster keeps the running best by comparing
 * each new candidate against the current winner.
 */
export type GazeComparer = (a: GazeHit, b: GazeHit) => number;

const ANGLE_EPSILON = 0.5 * (Math.PI / 180); // 0.5°
// Rays aimed at an exact triangle/quad edge are numerically ambiguous. Move a
// cone-assisted aim point a visually negligible distance inside the OBB before
// falling back to its center, so boundary jitter cannot make the reticle jump.
const OBB_EDGE_INSET_FRACTION = 1e-3;

/**
 * Default comparer: closer-by-angle wins, then closer-by-distance.
 */
export const defaultGazeComparer: GazeComparer = (a, b) => {
  const dAngle = a.angularDistance - b.angularDistance;
  if (Math.abs(dAngle) > ANGLE_EPSILON) {
    return dAngle;
  }
  return a.intersection.distance - b.intersection.distance;
};

export interface GazeConecasterOptions {
  /** Cone half-angle in radians. */
  coneAngle?: number;
  /** Cone length in meters. */
  coneLength?: number;
  /** Dwell-consensus window in seconds. */
  dwellWindowSeconds?: number;
  /** Custom comparer; defaults to {@link defaultGazeComparer}. */
  comparer?: GazeComparer;
}

interface DwellSample {
  object: Object3D | null;
  time: number;
  dt: number;
}

/**
 * Default candidate provider: cone-membership filter + pointer-compatible
 * surface resolution + time-weighted dwell consensus.
 *
 * @remarks
 * - **Membership**: a coarse sphere distance reject prunes far candidates,
 *   then a precise OBB closest-point test admits the candidate iff the angle
 *   from the gaze direction to the closest point on its oriented bounding
 *   box (its local AABB transformed by `matrixWorld`) is within `coneAngle`.
 *   This avoids the bounding-sphere overestimation that would let large flat
 *   panels register hover from far past their visible silhouette.
 * - **Geometry**: survivors are resolved by the callback supplied in
 *   {@link GazeCandidateContext}, so the exact same pointer-event eligibility
 *   and ordering rules are used for acquisition and dispatch.
 * - **Comparer**: per-frame best is chosen by `comparer` (default angle ->
 *   distance).
 * - **Dwell**: per-frame winners are appended to a ring buffer; samples older
 *   than `dwellWindowSeconds` are dropped; the object with the largest
 *   cumulative dt inside the window wins.
 *
 * @category Pointer
 */
export class GazeConecaster implements GazeCandidateProvider {
  public coneAngle: number;
  public coneLength: number;
  public dwellWindowSeconds: number;
  public comparer: GazeComparer;

  private readonly sphere = new Sphere();
  private readonly box = new Box3();
  private readonly localBox = new Box3();
  private readonly invWorld = new Matrix4();
  private readonly tmpMat = new Matrix4();
  private readonly tmpBox = new Box3();
  private readonly toCandidate = new Vector3();
  private readonly sphereCenter = new Vector3();
  private readonly localOrigin = new Vector3();
  private readonly localDirection = new Vector3();
  private readonly localBoxClosest = new Vector3();
  private readonly localRayClosest = new Vector3();
  private readonly worldBoxClosest = new Vector3();
  private readonly worldBoxCenter = new Vector3();
  private readonly localBoxCenter = new Vector3();
  private pointBoundsFallback = false;

  /** Ring of dwell samples (reused). */
  private readonly dwellRing: DwellSample[] = [];
  private dwellHead = 0;
  private dwellSize = 0;
  private readonly dwellCapacity: number;

  /** Last reported dwell winner for the public `getDwellWinner()`. */
  private currentDwellWinner: GazeHit | null = null;

  constructor(opts: GazeConecasterOptions = {}) {
    this.coneAngle = opts.coneAngle ?? 5 * (Math.PI / 180);
    this.coneLength = opts.coneLength ?? 30;
    this.dwellWindowSeconds = opts.dwellWindowSeconds ?? 0.15;
    this.comparer = opts.comparer ?? defaultGazeComparer;

    // Preallocate ring capacity for ~120 Hz over ~1 second of dwell history.
    // Window-based pruning keeps the *used* size small; this is just an upper
    // bound to avoid reallocation.
    this.dwellCapacity = 256;
    for (let i = 0; i < this.dwellCapacity; i++) {
      this.dwellRing.push({
        object: null,
        time: 0,
        dt: 0,
      });
    }
  }

  update(time: number, dt: number, ctx: GazeCandidateContext): GazeHit | null {
    const frameBest = this.findFrameBest(ctx);
    if (frameBest) {
      this.recordDwell(frameBest.object, time, dt);
    }
    this.pruneDwell(time);
    this.currentDwellWinner = this.resolveDwellWinner(ctx);
    return this.currentDwellWinner;
  }

  reset(): void {
    for (let i = 0; i < this.dwellSize; i++) {
      this.clearDwellSlot((this.dwellHead + i) % this.dwellCapacity);
    }
    this.dwellHead = 0;
    this.dwellSize = 0;
    this.currentDwellWinner = null;
  }

  /** Internal: scan all candidates and return the best in-cone hit, or null. */
  private findFrameBest(ctx: GazeCandidateContext): GazeHit | null {
    const { origin, direction, candidates } = ctx;
    const cosCone = Math.cos(this.coneAngle);
    let bestHit: GazeHit | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const obj = candidates[i];
      if (!obj || !isObjectTreeVisible(obj)) {
        continue;
      }

      this.computeBounds(obj);
      if (this.sphere.radius < 0) {
        continue;
      }

      // Coarse distance reject (sphere radius is the only cheap upper bound).
      this.sphereCenter.copy(this.sphere.center);
      this.toCandidate.copy(this.sphereCenter).sub(origin);
      const distToCenter = this.toCandidate.length();
      if (distToCenter <= 1e-6) {
        continue;
      }
      if (distToCenter - this.sphere.radius > this.coneLength) {
        continue;
      }

      // Precise cone-membership test against the candidate's OBB instead of
      // its enclosing sphere. A 0.5 m UIKit panel has a sphere radius of
      // ~0.35 m and so would qualify ~16° off-axis even at arm's length —
      // the panel ended up "dominating" gaze from far past where it's
      // actually being looked at. OBB closest-point gives the true angular
      // distance from the gaze axis to the object's silhouette (~0 when the
      // ray passes through the panel area, growing with off-axis offset).
      this.closestPointOnObb(obj, origin, direction, this.worldBoxClosest);
      this.toCandidate.copy(this.worldBoxClosest).sub(origin);
      const distToObb = this.toCandidate.length();
      if (distToObb <= 1e-6) {
        // Gaze origin sits inside the OBB — treat as fully on-axis.
        this.toCandidate.copy(direction);
      } else {
        this.toCandidate.divideScalar(distToObb);
      }
      const cosObbAngle = this.toCandidate.dot(direction);
      if (cosObbAngle < cosCone) {
        continue;
      }
      const obbAngle = Math.acos(Math.max(-1, Math.min(1, cosObbAngle)));

      const hit = this.resolveSurface(obj, ctx, obbAngle);
      if (hit && (!bestHit || this.comparer(hit, bestHit) < 0)) {
        bestHit = hit;
      }
    }

    return bestHit;
  }

  /**
   * Resolve a real pointer-events intersection for one in-cone target. The raw
   * gaze ray wins when it already hits. Otherwise the ray bends first just
   * inside the closest point on the candidate OBB, then tries the exact point,
   * and finally its center.
   */
  private resolveSurface(
    object: Object3D,
    ctx: GazeCandidateContext,
    angularDistance: number,
  ): GazeHit | null {
    let intersection = ctx.intersectCandidate(object, ctx.direction);
    if (intersection && intersection.distance <= this.coneLength) {
      return { object, intersection, angularDistance: 0 };
    }

    this.localBox.getCenter(this.localBoxCenter);
    this.worldBoxCenter
      .copy(this.localBoxCenter)
      .applyMatrix4(object.matrixWorld);

    // The closest point commonly lies exactly on a flat target's edge. A
    // triangle raycast can accept or reject that boundary across adjacent
    // floating-point poses, which previously alternated between the edge hit
    // and the center fallback. Try a sub-pixel inset first so the assisted
    // intersection remains close to the gaze while landing inside the face.
    this.toCandidate
      .copy(this.worldBoxClosest)
      .lerp(this.worldBoxCenter, OBB_EDGE_INSET_FRACTION)
      .sub(ctx.origin);
    if (this.toCandidate.lengthSq() > 1e-12) {
      this.toCandidate.normalize();
      intersection = ctx.intersectCandidate(object, this.toCandidate);
      if (intersection && intersection.distance <= this.coneLength) {
        return { object, intersection, angularDistance };
      }
    }

    this.toCandidate.copy(this.worldBoxClosest).sub(ctx.origin);
    if (this.toCandidate.lengthSq() > 1e-12) {
      this.toCandidate.normalize();
      intersection = ctx.intersectCandidate(object, this.toCandidate);
      if (intersection && intersection.distance <= this.coneLength) {
        return { object, intersection, angularDistance };
      }
    }

    this.toCandidate.copy(this.worldBoxCenter).sub(ctx.origin);
    if (this.toCandidate.lengthSq() <= 1e-12) {
      return null;
    }
    this.toCandidate.normalize();
    intersection = ctx.intersectCandidate(object, this.toCandidate);
    return intersection && intersection.distance <= this.coneLength
      ? { object, intersection, angularDistance }
      : null;
  }

  /**
   * Build both the world-space enclosing sphere (used for cone-membership)
   * and a candidate-local AABB (used by the OBB fallback) in a single subtree
   * walk. The local AABB is tighter than the world AABB for rotated objects:
   * the cone-ring + OBB fallback uses it to produce a much better silhouette
   * point than a sphere when the on-axis raycast misses.
   *
   * Results land on `this.sphere` and `this.localBox`. The local AABB is
   * meaningful in `obj`'s local frame and must be transformed by
   * `obj.matrixWorld` to land in world space.
   */
  private computeBounds(obj: Object3D): void {
    this.box.makeEmpty();
    this.localBox.makeEmpty();
    this.pointBoundsFallback = false;
    obj.updateWorldMatrix(true, true);
    const determinant = obj.matrixWorld.determinant();
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
      // A singular candidate transform cannot be inverted into candidate-local
      // space. Treat it as a tiny point at its world origin instead of letting
      // NaNs make cone ordering non-deterministic.
      this.invWorld.identity();
      obj.getWorldPosition(this.sphereCenter);
      if (
        !Number.isFinite(this.sphereCenter.x) ||
        !Number.isFinite(this.sphereCenter.y) ||
        !Number.isFinite(this.sphereCenter.z)
      ) {
        this.sphere.makeEmpty();
        return;
      }
      this.sphere.center.copy(this.sphereCenter);
      this.sphere.radius = 0.001;
      this.localBox.min.setScalar(-0.0005);
      this.localBox.max.setScalar(0.0005);
      this.pointBoundsFallback = true;
      return;
    }
    this.invWorld.copy(obj.matrixWorld).invert();
    this.expandSafely(obj, this.box, this.localBox);
    if (this.box.isEmpty()) {
      // Last-resort fallback: treat the candidate as a point sphere at its
      // world origin so the conecaster still considers it for hover. Mirror
      // the empty-box guard with a tiny local AABB centered on the origin.
      obj.getWorldPosition(this.sphereCenter);
      this.sphere.center.copy(this.sphereCenter);
      this.sphere.radius = 0.001;
      this.localBox.min.setScalar(-0.0005);
      this.localBox.max.setScalar(0.0005);
      return;
    }
    this.box.getBoundingSphere(this.sphere);
  }

  /**
   * Manual `expandByObject` that swallows per-node failures (missing
   * position attribute, null bounding box, etc.) instead of letting one bad
   * descendant abort the whole subtree. Accumulates BOTH the world-space
   * AABB (for cone-membership) and the candidate-local AABB (for the OBB
   * fallback) in the same traversal.
   */
  private expandSafely(obj: Object3D, worldBox: Box3, localBox: Box3): void {
    // IWSDK runtime-only meshes (ContactShadow and ShadowCatcher planes) take
    // no pointer hits, so they must not widen the candidate either.
    if (obj.userData?.iwsdkRuntimeOnly === true) {
      return;
    }
    const candidate = obj as Object3D & {
      geometry?: {
        boundingBox: Box3 | null;
        getAttribute?: (name: string) => unknown;
        computeBoundingBox?: () => void;
      };
    };
    const geometry = candidate.geometry;
    if (geometry) {
      try {
        if (
          geometry.getAttribute &&
          geometry.getAttribute('position') !== undefined
        ) {
          if (geometry.boundingBox === null && geometry.computeBoundingBox) {
            geometry.computeBoundingBox();
          }
          if (geometry.boundingBox) {
            // World AABB: geometry-local -> world via the leaf's own matrix.
            this.tmpBox.copy(geometry.boundingBox);
            this.tmpBox.applyMatrix4(obj.matrixWorld);
            worldBox.union(this.tmpBox);
            // Candidate-local AABB: geometry-local -> world -> candidate-local.
            this.tmpMat.copy(this.invWorld).multiply(obj.matrixWorld);
            this.tmpBox.copy(geometry.boundingBox).applyMatrix4(this.tmpMat);
            localBox.union(this.tmpBox);
          }
        }
      } catch {
        // ignore: degenerate geometry shouldn't disqualify the candidate
      }
    }
    const children = obj.children;
    for (let i = 0; i < children.length; i++) {
      this.expandSafely(children[i], worldBox, localBox);
    }
  }

  /**
   * Closest point on the candidate's oriented bounding box (its local AABB
   * transformed by `obj.matrixWorld`) to the gaze ray, in world space.
   *
   * Works in local space to avoid building 12 oriented edges in world: bring
   * the ray into the candidate's frame, run iterative AABB-vs-line refinement
   * (a few passes is plenty — it converges quadratically), then map the point
   * back to world.
   */
  private closestPointOnObb(
    obj: Object3D,
    origin: Vector3,
    direction: Vector3,
    out: Vector3,
  ): void {
    if (this.pointBoundsFallback) {
      out.copy(this.sphere.center);
      return;
    }
    // Ray -> local space. invWorld was just refreshed in `computeBounds`.
    this.localOrigin.copy(origin).applyMatrix4(this.invWorld);
    // transformDirection normalizes and ignores translation; preserves
    // rotation. Scale baked into the world matrix is lost — that's fine for a
    // closest-point query (we re-measure in world afterwards).
    this.localDirection.copy(direction).transformDirection(this.invWorld);

    // Seed with the box center, projected onto the ray.
    this.localBox.getCenter(this.localBoxCenter);
    this.localBoxClosest.copy(this.localBoxCenter);
    for (let iter = 0; iter < 3; iter++) {
      // Closest point on ray to current box-point estimate (t clamped to >= 0
      // so we never march behind the gaze origin).
      const t = Math.max(
        0,
        this.localRayClosest
          .copy(this.localBoxClosest)
          .sub(this.localOrigin)
          .dot(this.localDirection),
      );
      this.localRayClosest
        .copy(this.localDirection)
        .multiplyScalar(t)
        .add(this.localOrigin);
      // Closest point on box to that ray point.
      this.localBoxClosest
        .copy(this.localRayClosest)
        .clamp(this.localBox.min, this.localBox.max);
    }
    out.copy(this.localBoxClosest).applyMatrix4(obj.matrixWorld);
  }

  private recordDwell(object: Object3D, time: number, dt: number): void {
    const slot =
      this.dwellRing[(this.dwellHead + this.dwellSize) % this.dwellCapacity];
    slot.object = object;
    slot.time = time;
    slot.dt = dt;
    if (this.dwellSize < this.dwellCapacity) {
      this.dwellSize++;
    } else {
      // Ring full — advance head and overwrite the oldest slot in-place.
      this.dwellHead = (this.dwellHead + 1) % this.dwellCapacity;
    }
  }

  private pruneDwell(now: number): void {
    const cutoff = now - this.dwellWindowSeconds;
    while (this.dwellSize > 0) {
      const head = this.dwellRing[this.dwellHead];
      if (head.time >= cutoff) {
        break;
      }
      this.clearDwellSlot(this.dwellHead);
      this.dwellHead = (this.dwellHead + 1) % this.dwellCapacity;
      this.dwellSize--;
    }
  }

  private electDwellWinner(): Object3D | null {
    if (this.dwellSize === 0) {
      return null;
    }

    // Find max-cumulative-dt object. Ring is short (~9 at 60 Hz), so
    // O(N^2) over the window stays cheap and avoids a Map allocation.
    let bestObject: Object3D | null = null;
    let bestDt = -1;
    for (let i = 0; i < this.dwellSize; i++) {
      const idx = (this.dwellHead + i) % this.dwellCapacity;
      const sample = this.dwellRing[idx];
      const obj = sample.object;
      if (!obj) {
        continue;
      }

      let sumDt = 0;
      for (let j = i; j < this.dwellSize; j++) {
        const jIdx = (this.dwellHead + j) % this.dwellCapacity;
        const s = this.dwellRing[jIdx];
        if (s.object === obj) {
          sumDt += s.dt;
        }
      }

      if (sumDt > bestDt) {
        bestDt = sumDt;
        bestObject = obj;
      }
    }
    return bestObject;
  }

  /** Resolve the elected object against the current pose, never a stale hit. */
  private resolveDwellWinner(ctx: GazeCandidateContext): GazeHit | null {
    while (this.dwellSize > 0) {
      const object = this.electDwellWinner();
      if (!object) {
        return null;
      }
      if (isObjectTreeVisible(object) && ctx.candidates.includes(object)) {
        this.computeBounds(object);
        if (this.sphere.radius >= 0) {
          this.closestPointOnObb(
            object,
            ctx.origin,
            ctx.direction,
            this.worldBoxClosest,
          );
          this.toCandidate.copy(this.worldBoxClosest).sub(ctx.origin);
          const distance = this.toCandidate.length();
          const angularDistance =
            distance <= 1e-6
              ? 0
              : Math.acos(
                  Math.max(
                    -1,
                    Math.min(
                      1,
                      this.toCandidate
                        .divideScalar(distance)
                        .dot(ctx.direction),
                    ),
                  ),
                );
          const hit = this.resolveSurface(object, ctx, angularDistance);
          if (hit) {
            return hit;
          }
        }
      }
      this.removeDwellObject(object);
    }
    return null;
  }

  private removeDwellObject(object: Object3D): void {
    const previousSize = this.dwellSize;
    let write = 0;
    for (let read = 0; read < this.dwellSize; read++) {
      const readIndex = (this.dwellHead + read) % this.dwellCapacity;
      const sample = this.dwellRing[readIndex];
      if (sample.object === object) {
        continue;
      }
      const writeIndex = (this.dwellHead + write) % this.dwellCapacity;
      if (writeIndex !== readIndex) {
        const destination = this.dwellRing[writeIndex];
        destination.object = sample.object;
        destination.time = sample.time;
        destination.dt = sample.dt;
      }
      write++;
    }
    for (let i = write; i < previousSize; i++) {
      this.clearDwellSlot((this.dwellHead + i) % this.dwellCapacity);
    }
    this.dwellSize = write;
  }

  private clearDwellSlot(index: number): void {
    const slot = this.dwellRing[index];
    slot.object = null;
    slot.time = 0;
    slot.dt = 0;
  }

  /** Current dwell winner, or null. */
  getDwellWinner(): GazeHit | null {
    return this.currentDwellWinner;
  }
}
