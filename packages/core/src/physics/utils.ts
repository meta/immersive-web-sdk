/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  Vector3,
  Mesh,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  PlaneGeometry,
  BufferGeometry,
  Box3,
  Object3D,
  Matrix4,
  Quaternion,
} from '../runtime/index.js';
import { PhysicsShapeType } from './physicsShape';

const tempVec1 = new Vector3();
const tempVec2 = new Vector3();
const tempQuat = new Quaternion();
const tempMatrix = new Matrix4();
const tempMatrix2 = new Matrix4();
const tempBox = new Box3();

const UNIT_SCALE = new Vector3(1, 1, 1);

/**
 * Build a sequential index buffer (`0, 1, 2, ...`) for a non-indexed geometry.
 *
 * Three.js `BufferGeometry.index` is `null` for non-indexed geometry, where the
 * position attribute already lists vertices in triangle order. Tri-mesh
 * colliders need an explicit index list, so synthesize the implicit one.
 *
 * @param vertexCount Number of vertices (i.e. `geometry.attributes.position.count`).
 */
export function sequentialIndices(vertexCount: number): Uint32Array {
  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    indices[i] = i;
  }
  return indices;
}

export interface ShapeDetectionResult {
  shapeType: string;
  dimensions: [number, number, number] | null;
}

/**
 * Automatically detects the best physics shape type and calculates dimensions based on the entity's Three.js geometry
 */
export function detectShapeFromGeometry(
  object3D: Object3D,
): ShapeDetectionResult {
  // When object3D is not a Mesh we build a merged geometry purely to inspect
  // it; it must be disposed before returning so shape auto-detection doesn't
  // leak one merged geometry per call. A Mesh's own geometry stays in use and
  // is never owned here. The try/finally guarantees disposal on every return.
  const ownsGeometry = !(object3D instanceof Mesh);
  const geometry =
    object3D instanceof Mesh
      ? object3D.geometry
      : generateMergedGeometry(object3D);

  try {
    // Check for specific geometry types and calculate their dimensions
    if (geometry instanceof SphereGeometry) {
      const radius = geometry.parameters.radius ?? 1;
      return {
        shapeType: PhysicsShapeType.Sphere,
        dimensions: [radius, 0, 0], // Only radius is needed for sphere
      };
    }

    if (geometry instanceof BoxGeometry) {
      const width = geometry.parameters.width ?? 1;
      const height = geometry.parameters.height ?? 1;
      const depth = geometry.parameters.depth ?? 1;
      return {
        shapeType: PhysicsShapeType.Box,
        dimensions: [width, height, depth],
      };
    }

    if (geometry instanceof PlaneGeometry) {
      const width = geometry.parameters.width ?? 1;
      const height = geometry.parameters.height ?? 1;
      const thickness = 0.01; // Thin plane
      return {
        shapeType: PhysicsShapeType.Box,
        dimensions: [width, height, thickness],
      };
    }

    if (geometry instanceof CylinderGeometry) {
      const radiusTop = geometry.parameters.radiusTop ?? 1;
      const radiusBottom = geometry.parameters.radiusBottom ?? 1;
      if (radiusTop !== radiusBottom) {
        console.warn(
          'PhysicsSystem: detected cylinder with different radiusTop and radiusBottom. Using average radius for the physics shape.',
        );
      }
      const height = geometry.parameters.height ?? 1;
      const avgRadius = (radiusTop + radiusBottom) / 2;
      return {
        shapeType: PhysicsShapeType.Cylinder,
        dimensions: [avgRadius, height, 0], // Approximate bounding dimensions
      };
    }

    // For generic BufferGeometry, fall back to the default ConvexHull shape type for better perf
    if (geometry instanceof BufferGeometry) {
      console.log(
        `PhysicsSystem: BufferGeometry detected for object ${object3D}, using ConvexHull.`,
      );
      return {
        shapeType: PhysicsShapeType.ConvexHull,
        dimensions: null,
      };
    }

    // Fallback for unknown geometry types
    console.warn(
      `PhysicsSystem: Unknown geometry type for object ${object3D}, falling back to Box`,
    );
    return {
      shapeType: PhysicsShapeType.Box,
      dimensions: calculateObject3DBounds(object3D),
    };
  } finally {
    if (ownsGeometry) {
      geometry.dispose();
    }
  }
}

/**
 * IWSDK runtime-only meshes (ContactShadow and ShadowCatcher planes) are
 * visuals owned by their system, not part of the body's shape.
 */
function isRuntimeOnly(object: Object3D): boolean {
  return object.userData?.iwsdkRuntimeOnly === true;
}

/** Box3.expandByObject for one object, without its children. */
function expandByOwnBounds(box: Box3, object: Object3D): void {
  const bounded = object as Object3D & {
    boundingBox?: Box3 | null;
    computeBoundingBox?: () => void;
    geometry?: BufferGeometry;
  };
  if (bounded.geometry === undefined) {
    return;
  }
  if (bounded.boundingBox !== undefined) {
    if (bounded.boundingBox === null) {
      bounded.computeBoundingBox?.();
    }
    tempBox.copy(bounded.boundingBox!);
  } else {
    if (bounded.geometry.boundingBox === null) {
      bounded.geometry.computeBoundingBox();
    }
    tempBox.copy(bounded.geometry.boundingBox!);
  }
  box.union(tempBox.applyMatrix4(object.matrixWorld));
}

/**
 * Calculates bounding box dimensions from Object3D for fallback cases
 */
export function calculateObject3DBounds(
  object3D: Object3D,
): [number, number, number] {
  try {
    // Create a bounding box for the object
    const box = new Box3();
    object3D.updateWorldMatrix(false, true);
    object3D.traverse((child) => {
      if (!isRuntimeOnly(child)) {
        expandByOwnBounds(box, child);
      }
    });

    if (!box.isEmpty()) {
      const size = new Vector3();
      box.getSize(size);

      // Convert to half-extents and ensure minimum size
      const dimensions: [number, number, number] = [
        Math.max(size.x, 0.01),
        Math.max(size.y, 0.01),
        Math.max(size.z, 0.01),
      ];

      console.log(
        `PhysicsSystem: Calculated Object3D bounds: [${dimensions.join(', ')}]`,
      );
      return dimensions;
    } else {
      console.warn(
        'PhysicsSystem: Object3D bounding box is empty, using default dimensions',
      );
    }
  } catch (error) {
    console.warn('PhysicsSystem: Failed to calculate Object3D bounds:', error);
  }

  // Final fallback if bounding box calculation fails
  return [1, 1, 1];
}

export function generateMergedGeometry(object3D: Object3D): BufferGeometry {
  object3D.updateMatrixWorld(true);

  tempMatrix.copy(object3D.matrixWorld);

  tempMatrix.decompose(tempVec1, tempQuat, tempVec2);
  tempMatrix.compose(tempVec1, tempQuat, UNIT_SCALE);

  const geometries: BufferGeometry[] = [];
  object3D.traverse((child) => {
    if (
      (child as Mesh).isMesh &&
      (child as Mesh).geometry &&
      !isRuntimeOnly(child)
    ) {
      const geometry = (child as Mesh).geometry.clone();
      geometry.applyMatrix4(child.matrixWorld);
      geometries.push(geometry);
    }
  });
  const mergedGeometry = mergeGeometries(geometries);
  // The per-child clones were only working copies for the merge; their data is
  // now copied into mergedGeometry, so free them to avoid leaking a clone of
  // every child geometry each time a merged collider is built.
  for (const geometry of geometries) {
    geometry.dispose();
  }
  tempMatrix2.copy(tempMatrix).invert();
  mergedGeometry.applyMatrix4(tempMatrix2);

  object3D.matrixWorld.copy(tempMatrix);

  return mergedGeometry;
}
