/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Intersection as PointerIntersection } from '@pmndrs/pointer-events';
import {
  BoxGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { GazeCandidateContext } from '../src/pointer/gaze-candidate-provider.js';
import { GazeConecaster } from '../src/pointer/gaze-conecaster.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;

/** A 0.4 m cube at `position`, world matrices flushed. */
function card(position: Vector3): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(0.4, 0.4, 0.4),
    new MeshBasicMaterial(),
  );
  mesh.position.copy(position);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function context(
  candidates: Object3D[],
  direction = new Vector3(0, 0, -1),
): GazeCandidateContext {
  const origin = new Vector3(0, 0, 0);
  const raycaster = new Raycaster();
  const inverse = new Matrix4();
  const quaternion = new Quaternion();
  return {
    origin,
    direction: direction.clone().normalize(),
    candidates,
    intersectCandidate(candidate: Object3D, rayDirection: Vector3) {
      raycaster.set(origin, rayDirection);
      const hit = raycaster.intersectObject(candidate, true)[0];
      if (!hit) {
        return null;
      }
      quaternion.setFromUnitVectors(new Vector3(0, 0, -1), rayDirection);
      hit.object.updateWorldMatrix(true, false);
      return {
        ...hit,
        details: { type: 'ray' },
        pointerPosition: origin.clone(),
        pointerQuaternion: quaternion.clone(),
        pointOnFace: hit.point.clone(),
        localPoint: hit.point
          .clone()
          .applyMatrix4(inverse.copy(hit.object.matrixWorld).invert()),
      } as PointerIntersection;
    },
  };
}

/** Run `frames` frames at 60 Hz starting at `t0`, returning the last winner. */
function run(
  caster: GazeConecaster,
  ctx: GazeCandidateContext,
  frames: number,
  t0 = 0,
) {
  let winner = null;
  for (let i = 0; i < frames; i++) {
    winner = caster.update(t0 + i * DT, DT, ctx);
  }
  return winner;
}

describe('GazeConecaster membership', () => {
  it('hits a card straight ahead and reports a real surface point', () => {
    const caster = new GazeConecaster({ dwellWindowSeconds: 0 });
    const target = card(new Vector3(0, 0, -3));

    const hit = caster.update(0, DT, context([target]));

    expect(hit).not.toBeNull();
    expect(hit!.object).toBe(target);
    // Front face of a 0.4 m cube centered at z = -3.
    expect(hit!.intersection.point.z).toBeCloseTo(-2.8, 3);
    expect(hit!.intersection.distance).toBeCloseTo(2.8, 3);
    expect(hit!.angularDistance).toBeCloseTo(0, 5);
  });

  it('rejects a card outside the cone half-angle', () => {
    // 5° cone at 3 m subtends ~0.26 m; the card's near edge sits at 0.8 m off
    // axis (~15°), well outside.
    const caster = new GazeConecaster({
      coneAngle: 5 * DEG,
      dwellWindowSeconds: 0,
    });
    const target = card(new Vector3(1, 0, -3));

    expect(caster.update(0, DT, context([target]))).toBeNull();
  });

  it('admits that same card once the cone is widened', () => {
    const caster = new GazeConecaster({
      coneAngle: 25 * DEG,
      dwellWindowSeconds: 0,
    });
    const target = card(new Vector3(1, 0, -3));

    const hit = caster.update(0, DT, context([target]));

    expect(hit?.object).toBe(target);
    expect(hit!.angularDistance).toBeGreaterThan(0);
  });

  it('keeps an assisted hit near a flat target edge', () => {
    const caster = new GazeConecaster({
      coneAngle: 5 * DEG,
      dwellWindowSeconds: 0,
    });
    const target = new Mesh(
      new PlaneGeometry(0.4, 0.4),
      new MeshBasicMaterial(),
    );
    // Put the left edge a fraction past the raw gaze ray. Three's triangle
    // raycast can reject a ray aimed at that exact edge, so the conecaster
    // must not jump all the way to the target center as its next fallback.
    target.position.set(0.2000001, 0, -3);
    target.updateMatrixWorld(true);

    const hit = caster.update(0, DT, context([target]));

    expect(hit).not.toBeNull();
    expect(hit!.intersection.point.x).toBeGreaterThanOrEqual(0);
    expect(hit!.intersection.point.x).toBeLessThan(0.001);
  });

  it('leaves runtime-only meshes out of the candidate bounds', () => {
    // IWSDK marks ground-shadow planes runtime-only. This 3 m one under the
    // off-axis card reaches the gaze axis.
    const caster = new GazeConecaster({
      coneAngle: 5 * DEG,
      dwellWindowSeconds: 0,
    });
    const target = card(new Vector3(1, 0, -3));
    const blob = new Mesh(new PlaneGeometry(3, 3), new MeshBasicMaterial());
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = -0.2;
    blob.userData.iwsdkRuntimeOnly = true;
    blob.raycast = () => {};
    target.add(blob);
    target.updateMatrixWorld(true);

    expect(caster.update(0, DT, context([target]))).toBeNull();
  });

  it('rejects a card beyond the cone length', () => {
    const caster = new GazeConecaster({
      coneLength: 2,
      dwellWindowSeconds: 0,
    });

    expect(caster.update(0, DT, context([card(new Vector3(0, 0, -5))]))).toBe(
      null,
    );
  });

  it('skips invisible candidates', () => {
    const caster = new GazeConecaster({ dwellWindowSeconds: 0 });
    const target = card(new Vector3(0, 0, -3));
    target.visible = false;

    expect(caster.update(0, DT, context([target]))).toBeNull();
  });

  it('skips candidates beneath an invisible ancestor', () => {
    const caster = new GazeConecaster({ dwellWindowSeconds: 0 });
    const parent = new Object3D();
    const target = card(new Vector3(0, 0, -3));
    parent.add(target);
    parent.visible = false;
    parent.updateMatrixWorld(true);

    expect(caster.update(0, DT, context([target]))).toBeNull();
  });

  it('refreshes ancestor transforms before testing a candidate', () => {
    const caster = new GazeConecaster({ dwellWindowSeconds: 0 });
    const parent = new Object3D();
    const target = card(new Vector3(0, 0, -3));
    parent.add(target);
    parent.updateMatrixWorld(true);

    // Move only the parent and deliberately leave matrixWorld stale. The
    // conecaster owns the world-matrix refresh for its candidate snapshot.
    parent.position.x = 2;

    expect(caster.update(0, DT, context([target]))).toBeNull();
  });

  it('keeps angular distance finite for a non-finite candidate transform', () => {
    const caster = new GazeConecaster({
      coneAngle: 10 * DEG,
      dwellWindowSeconds: 0,
    });
    const target = new Object3D();
    target.matrixWorld.makeTranslation(0.1, 0, -3);
    target.matrixWorld.elements[0] = Number.NaN;
    target.matrixWorldAutoUpdate = false;
    const origin = new Vector3();
    const direction = new Vector3(0, 0, -1);
    const ctx: GazeCandidateContext = {
      origin,
      direction,
      candidates: [target],
      intersectCandidate(_candidate, rayDirection) {
        // Force resolution through the cone's bent-ray fallback so the
        // computed OBB angular distance is observable.
        return rayDirection === direction
          ? null
          : ({ distance: 3 } as PointerIntersection);
      },
    };

    const hit = caster.update(0, DT, ctx);

    expect(hit?.object).toBe(target);
    expect(Number.isFinite(hit!.angularDistance)).toBe(true);
  });

  it('prefers the candidate closest to the gaze axis', () => {
    const caster = new GazeConecaster({
      coneAngle: 25 * DEG,
      dwellWindowSeconds: 0,
    });
    const onAxis = card(new Vector3(0, 0, -3));
    const offAxis = card(new Vector3(0.8, 0, -3));

    const hit = caster.update(0, DT, context([offAxis, onAxis]));

    expect(hit?.object).toBe(onAxis);
  });
});

describe('GazeConecaster ranking', () => {
  it('falls back to distance when angle and tiebreaker both tie', () => {
    const caster = new GazeConecaster({
      coneAngle: 45 * DEG,
      dwellWindowSeconds: 0,
    });
    const near = card(new Vector3(0, 0, -2));
    const far = card(new Vector3(0, 0, -6));

    expect(caster.update(0, DT, context([far, near]))?.object).toBe(near);
  });
});

describe('GazeConecaster dwell consensus', () => {
  it('holds the dwelt winner through a brief glance at a neighbour', () => {
    const caster = new GazeConecaster({
      coneAngle: 25 * DEG,
      dwellWindowSeconds: 0.15,
    });
    const dwelt = card(new Vector3(0, 0, -3));
    const glanced = card(new Vector3(0.8, 0, -3));

    // ~130 ms accumulated on `dwelt`.
    run(caster, context([dwelt, glanced]), 8);
    expect(caster.getDwellWinner()?.object).toBe(dwelt);

    // Two frames (~33 ms) on the neighbour isn't enough to flip the vote.
    const winner = run(
      caster,
      context([dwelt, glanced], new Vector3(0.8, 0, -3)),
      2,
      8 * DT,
    );
    expect(winner?.object).toBe(dwelt);
  });

  it('flips once the new target accumulates more time in the window', () => {
    const caster = new GazeConecaster({
      coneAngle: 25 * DEG,
      dwellWindowSeconds: 0.15,
    });
    const first = card(new Vector3(0, 0, -3));
    const second = card(new Vector3(0.8, 0, -3));

    run(caster, context([first, second]), 8);
    const winner = run(
      caster,
      context([first, second], new Vector3(0.8, 0, -3)),
      8,
      8 * DT,
    );

    expect(winner?.object).toBe(second);
  });

  it('reports the frame winner immediately when dwell is disabled', () => {
    const caster = new GazeConecaster({
      coneAngle: 25 * DEG,
      dwellWindowSeconds: 0,
    });
    const first = card(new Vector3(0, 0, -3));
    const second = card(new Vector3(0.8, 0, -3));

    run(caster, context([first, second]), 8);
    expect(
      caster.update(
        8 * DT,
        DT,
        context([first, second], new Vector3(0.8, 0, -3)),
      )?.object,
    ).toBe(second);
  });

  it('drops the winner once the window empties with nothing in view', () => {
    const caster = new GazeConecaster({ dwellWindowSeconds: 0.15 });
    run(caster, context([card(new Vector3(0, 0, -3))]), 8);

    // Look away for longer than the dwell window.
    const winner = run(caster, context([]), 20, 8 * DT);

    expect(winner).toBeNull();
    expect(caster.getDwellWinner()).toBeNull();
  });

  it('clears dwell history on reset', () => {
    const caster = new GazeConecaster({ dwellWindowSeconds: 0.15 });
    const target = card(new Vector3(0, 0, -3));
    run(caster, context([target]), 8);
    expect(caster.getDwellWinner()?.object).toBe(target);

    const ring = (caster as any).dwellRing as Array<{
      object: Object3D | null;
    }>;
    caster.reset();

    expect(caster.getDwellWinner()).toBeNull();
    expect(ring.every((sample) => sample.object === null)).toBe(true);
  });

  it("refreshes the dwell winner's surface hit after the target moves", () => {
    const caster = new GazeConecaster({ dwellWindowSeconds: 0.15 });
    const target = card(new Vector3(0, 0, -3));
    run(caster, context([target]), 8);

    target.position.z = -4;
    target.updateMatrixWorld(true);
    const refreshed = caster.update(8 * DT, DT, context([target]));

    expect(refreshed?.intersection.point.z).toBeCloseTo(-3.8, 3);
  });

  it('invalidates a dwell winner beneath a hidden ancestor immediately', () => {
    const caster = new GazeConecaster({ dwellWindowSeconds: 0.15 });
    const target = card(new Vector3(0, 0, -3));
    const parent = new Object3D();
    parent.add(target);
    parent.updateMatrixWorld(true);
    run(caster, context([target]), 8);

    parent.visible = false;

    expect(caster.update(8 * DT, DT, context([target]))).toBeNull();
    expect(caster.getDwellWinner()).toBeNull();
    expect(
      ((caster as any).dwellRing as Array<{ object: Object3D | null }>).some(
        (sample) => sample.object === target,
      ),
    ).toBe(false);
  });
});
