/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBatchedBoundsTree,
  computeBoundsTree,
  disposeBatchedBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;
THREE.BatchedMesh.prototype.raycast = acceleratedRaycast;

// super-three's multiview mode (Quest in XR) `#define`s viewMatrix as
// viewMatrices[VIEW_ID]. r185's transform*ByInverseViewMatrix helpers in the
// common chunk take a parameter named viewMatrix, which that define turns into
// an array of non-constant size, so every shader fails to compile in XR.
// Rename the parameter; callers still pass viewMatrix.
THREE.ShaderChunk.common = THREE.ShaderChunk.common.replace(
  /(vec3 transform(?:Normal|Direction)ByInverseViewMatrix\(\s*in vec3 \w+,\s*in mat4 )viewMatrix(\s*\)\s*\{[^}]*?)viewMatrix/g,
  '$1inverseView$2inverseView',
);

export * from 'three';

// export * as Addons from 'three/examples/jsm/Addons.js';
