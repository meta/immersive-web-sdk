/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Monkeypatch @pmndrs/pointer-events RayIntersector to skip expensive UV recomputation
// during pointer capture. This keeps grabbing performant on dense meshes.

import {
  Plane,
  Vector3,
  Quaternion,
  Object3D,
  Sphere,
  Matrix4,
  InstancedMesh,
  Mesh,
} from '../runtime/index.js';

type PointerCapture = { intersection: any; object: Object3D };

const planeHelper = new Plane();
const helperSphere: Sphere = new Sphere();

const rayDirectionHelperMap = new Map<any, Vector3>();
const pointerPositionHelperMap = new Map<any, Vector3>();
const pointerQuaternionHelperMap = new Map<any, Quaternion>();

const oldInputDevicePointOffset = new Vector3();
const inputDeviceQuaternionOffset = new Quaternion();

const vectorHelper = new Vector3();
const matrixHelper = new Matrix4();
const boxSizeHelper = new Vector3();
const boxCenterHelper = new Vector3();
const vec0_0001 = new Vector3(0.0001, 0.0001, 0.0001);
const invertedMatrixHelper = new Matrix4();

/**
 * One sphere-pointer traversal (from `startIntersection` to the end of the
 * scene walk) tests many objects that share ancestors. `updateWorldMatrix(true,
 * false)` per object recomposed the whole ancestor chain every time; within a
 * pass the scene does not change, so each object's world matrix is brought up
 * to date once.
 */
let intersectionPass = 0;
const worldMatrixPass = new WeakMap<Object3D, number>();

/** Start a new sphere-intersection pass. Called from `startIntersection`. */
export function beginSphereIntersectionPass(): void {
  intersectionPass++;
}

/** `object.updateWorldMatrix(true, false)`, once per pass per object. */
function updateWorldMatrixOncePerPass(object: Object3D): void {
  if (worldMatrixPass.get(object) === intersectionPass) {
    return;
  }
  if (object.parent != null) {
    updateWorldMatrixOncePerPass(object.parent);
  }
  object.updateWorldMatrix(false, false);
  worldMatrixPass.set(object, intersectionPass);
}

export function patchedIntersectRayPointerCapture(
  this: any,
  { intersection, object }: PointerCapture,
) {
  const details = intersection.details;
  if (details.type !== 'ray') {
    throw new Error(
      `unable to process a pointer capture of type "${details.type}" with a ray intersector`,
    );
  }
  if (!this.prepareTransformation()) {
    return intersection;
  }

  object.updateWorldMatrix(true, false);

  // Recompute the plane in world space using the stored localPoint and normal/face
  const normal = intersection.normal ?? intersection.face?.normal;
  if (normal != null && intersection.localPoint != null) {
    planeHelper.setFromNormalAndCoplanarPoint(normal, intersection.localPoint);
    planeHelper.applyMatrix4(object.matrixWorld);
  } else {
    // Fallback: face-on plane at previous world point
    planeHelper.setFromNormalAndCoplanarPoint(
      new Vector3(0, 0, 1),
      intersection.point,
    );
  }

  const { ray } = this.raycaster;
  const pointOnFace =
    ray.intersectPlane(planeHelper, new Vector3()) ?? intersection.point;

  let rayDirectionHelper = rayDirectionHelperMap.get(this);
  if (!rayDirectionHelper) {
    rayDirectionHelper = new Vector3();
    rayDirectionHelperMap.set(this, rayDirectionHelper);
  }

  let pointerPositionHelper = pointerPositionHelperMap.get(this);
  if (!pointerPositionHelper) {
    pointerPositionHelper = new Vector3();
    pointerPositionHelperMap.set(this, pointerPositionHelper);
  }

  let pointerQuaternionHelper = pointerQuaternionHelperMap.get(this);
  if (!pointerQuaternionHelper) {
    pointerQuaternionHelper = new Quaternion();
    pointerQuaternionHelperMap.set(this, pointerQuaternionHelper);
  }

  // Preserve distance along the ray from previous intersection
  const distanceAlongRay = intersection.pointerPosition.distanceTo(
    intersection.point,
  );
  const point = rayDirectionHelper
    .copy(ray.direction)
    .multiplyScalar(distanceAlongRay)
    .add(ray.origin);

  // NOTE: We intentionally skip UV recomputation here for performance.
  return {
    ...intersection,
    object,
    pointOnFace,
    point,
    pointerPosition: pointerPositionHelper.copy(ray.origin),
    pointerQuaternion: pointerQuaternionHelper.copy(this.raycasterQuaternion),
  };
}

export function patchedIntersectSpherePointerCapture(
  this: any,
  { intersection, object }: PointerCapture,
) {
  const details = intersection.details;
  if (details.type !== 'sphere') {
    throw new Error(
      `unable to process a pointer capture of type "${details.type}" with a ray intersector`,
    );
  }
  if (!this.prepareTransformation()) {
    return intersection;
  }

  //compute old inputDevicePosition-point offset
  oldInputDevicePointOffset
    .copy(intersection.point)
    .sub(intersection.pointerPosition);
  //compute oldInputDeviceQuaternion-newInputDeviceQuaternion offset
  inputDeviceQuaternionOffset
    .copy(intersection.pointerQuaternion)
    .invert()
    .multiply(this.fromQuaternion);

  //apply quaternion offset to old inputDevicePosition-point offset and add to new inputDevicePosition
  const point = oldInputDevicePointOffset
    .clone()
    .applyQuaternion(inputDeviceQuaternionOffset)
    .add(this.fromPosition);
  object.updateWorldMatrix(true, false);
  // Recompute the plane in world space using the stored localPoint and normal/face
  const normal = intersection.normal ?? intersection.face?.normal;
  if (normal != null && intersection.localPoint != null) {
    planeHelper.setFromNormalAndCoplanarPoint(normal, intersection.localPoint);
    planeHelper.applyMatrix4(object.matrixWorld);
  } else {
    // Fallback: face-on plane at previous world point
    planeHelper.setFromNormalAndCoplanarPoint(
      new Vector3(0, 0, 1),
      intersection.point,
    );
  }
  const pointOnFace = planeHelper.projectPoint(
    this.fromPosition,
    new Vector3(),
  );

  let pointerPositionHelper = pointerPositionHelperMap.get(this);
  if (!pointerPositionHelper) {
    pointerPositionHelper = new Vector3();
    pointerPositionHelperMap.set(this, pointerPositionHelper);
  }

  let pointerQuaternionHelper = pointerQuaternionHelperMap.get(this);
  if (!pointerQuaternionHelper) {
    pointerQuaternionHelper = new Quaternion();
    pointerQuaternionHelperMap.set(this, pointerQuaternionHelper);
  }

  // NOTE: We intentionally skip UV recomputation here for performance.
  return {
    details: {
      type: 'sphere',
    },
    distance: point.distanceTo(pointOnFace),
    pointerPosition: pointerPositionHelper.copy(this.fromPosition),
    pointerQuaternion: pointerQuaternionHelper.copy(this.fromQuaternion),
    object,
    point,
    pointOnFace,
    face: intersection.face,
    localPoint: intersection.localPoint,
  };
}

function maximizeAxisVector(vec: Vector3) {
  const absX = Math.abs(vec.x);
  const absY = Math.abs(vec.y);
  const absZ = Math.abs(vec.z);
  if (absX >= absY && absX >= absZ) {
    //x biggest
    vec.set(vec.x < 0 ? -1 : 1, 0, 0);
    return;
  }
  if (absY >= absX && absY >= absZ) {
    //y biggest
    vec.set(0, vec.y < 0 ? -1 : 1, 0);
    return;
  }
  //z biggest
  vec.set(0, 0, vec.z < 0 ? -1 : 1);
}

function patchedIsSphereIntersectingMesh(
  pointerSphere: any,
  { geometry }: Mesh,
  meshMatrixWorld: Matrix4,
) {
  if (geometry.boundingSphere == null) {
    geometry.computeBoundingSphere();
  }
  helperSphere
    .copy(geometry.boundingSphere ?? new Sphere())
    .applyMatrix4(meshMatrixWorld);
  return (
    helperSphere.center.distanceToSquared(pointerSphere.center) <
    (pointerSphere.radius + helperSphere.radius) ** 2
  );
}

function patchedIntersectSphereWithObject(
  pointerSphere: any,
  object: Object3D,
  target: any,
) {
  // Groups and other non-mesh nodes have nothing to test; their children
  // update their ancestors' matrices when they need them.
  if (object.spherecast == null && !(object instanceof Mesh)) {
    return;
  }
  updateWorldMatrixOncePerPass(object);
  if (object.spherecast != null) {
    object.spherecast(pointerSphere, target);
    return;
  }
  if (object instanceof InstancedMesh) {
    if (object.geometry.boundingSphere == null) {
      object.geometry.computeBoundingSphere();
    }
    if (object.geometry.boundingBox == null) {
      object.geometry.computeBoundingBox();
    }
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrixHelper);
      matrixHelper.premultiply(object.matrixWorld);
      if (
        !patchedIsSphereIntersectingMesh(pointerSphere, object, matrixHelper)
      ) {
        continue;
      }
      const intersection = patchedIntersectSphereMesh(
        pointerSphere,
        object,
        matrixHelper,
        i,
      );
      if (intersection == null) {
        continue;
      }
      target.push(intersection);
    }
  }
  if (!(object instanceof Mesh)) {
    return;
  }
  if (
    !patchedIsSphereIntersectingMesh(pointerSphere, object, object.matrixWorld)
  ) {
    return;
  }
  const intersection = patchedIntersectSphereMesh(
    pointerSphere,
    object,
    object.matrixWorld,
  );
  if (intersection == null) {
    return;
  }
  target.push(intersection);
}

function patchedIntersectSphereMesh(
  pointerSphere: any,
  mesh: Mesh,
  meshMatrixWorld: Matrix4,
  instanceId?: number,
) {
  invertedMatrixHelper.copy(meshMatrixWorld).invert();
  helperSphere.copy(pointerSphere).applyMatrix4(invertedMatrixHelper);
  const { geometry } = mesh;
  if (geometry.boundingBox == null) {
    geometry.computeBoundingBox();
  }
  geometry.boundingBox?.getSize(boxSizeHelper);
  geometry.boundingBox?.getCenter(boxCenterHelper);
  geometry.boundingBox?.clampPoint(helperSphere.center, vectorHelper);
  vectorHelper.applyMatrix4(meshMatrixWorld); //world coordinates
  const distanceToSphereCenterSquared = vectorHelper.distanceToSquared(
    pointerSphere.center,
  );
  if (
    distanceToSphereCenterSquared >
    pointerSphere.radius * pointerSphere.radius
  ) {
    return undefined;
  }
  boxSizeHelper.max(vec0_0001);
  const normal = helperSphere.center.clone().sub(boxCenterHelper);
  normal.divide(boxSizeHelper);
  maximizeAxisVector(normal);
  const point = vectorHelper.clone();

  return {
    distance: Math.sqrt(distanceToSphereCenterSquared),
    face: {
      a: 0,
      b: 0,
      c: 0,
      materialIndex: 0,
      normal,
    },
    normal,
    point,
    instanceId,
    object: mesh,
  };
}

export function patchedExecuteIntersection(this: any, object: Object3D) {
  if (!this.isReady()) {
    return;
  }
  patchedIntersectSphereWithObject(
    this.collisionSphere,
    object,
    this.intersects,
  );
}
