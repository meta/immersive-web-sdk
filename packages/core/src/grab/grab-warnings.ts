/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Entity } from '../ecs/entity.js';
import { Mesh, Object3D } from '../runtime/index.js';

type GrabComponentName =
  | 'DistanceGrabbable'
  | 'OneHandGrabbable'
  | 'TwoHandsGrabbable';

let warnedNoRaycastableMesh = new WeakMap<Object3D, Set<GrabComponentName>>();

function shouldEmitDevWarning(): boolean {
  return (import.meta as any).env?.DEV !== false;
}

export function hasRaycastableMesh(object: Object3D): boolean {
  let found = false;

  object.traverse((child) => {
    if (found) {
      return;
    }

    const mesh = child as Mesh;
    // Runtime-only meshes, such as ground shadows, never take grab hits.
    found =
      mesh.isMesh === true &&
      Boolean(mesh.geometry) &&
      typeof mesh.raycast === 'function' &&
      mesh.userData.iwsdkRuntimeOnly !== true;
  });

  return found;
}

export function warnIfNoRaycastableMesh(
  entity: Pick<Entity, 'index' | 'object3D'>,
  componentName: GrabComponentName,
): void {
  const object = entity.object3D;
  if (!(object instanceof Object3D)) {
    return;
  }

  if (!shouldEmitDevWarning() || hasRaycastableMesh(object)) {
    return;
  }

  let warnedComponents = warnedNoRaycastableMesh.get(object);
  if (!warnedComponents) {
    warnedComponents = new Set();
    warnedNoRaycastableMesh.set(object, warnedComponents);
  }

  if (warnedComponents.has(componentName)) {
    return;
  }

  warnedComponents.add(componentName);

  const entityLabel = object.name
    ? `"${object.name}" (index ${entity.index})`
    : `#${entity.index}`;

  console.warn(
    `[IWSDK] Entity ${entityLabel} has ${componentName} but no raycastable mesh in its Object3D subtree. Grab will not work. Attach a Mesh as a child or to the entity's root Object3D.`,
  );
}

export function resetGrabWarningStateForTests(): void {
  warnedNoRaycastableMesh = new WeakMap();
}
