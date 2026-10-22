/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Component } from '@pmndrs/uikit';
import type { World } from '../ecs/world.js';
import { Box3, Matrix4, Vector3 } from '../runtime/index.js';
import type { BufferGeometry, Object3D } from '../runtime/index.js';

/** A point or direction relative to the XR origin (`world.player`), in metres. */
export interface TargetVector {
  x: number;
  y: number;
  z: number;
}

/** Which face of a target to touch; the default is the face toward the body. */
export type TargetFace = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';

/**
 * Why a hand sequence step wants a target: `press` the face to press, `grasp`
 * the part to pinch, `place` the surface to set a held object down on.
 */
export type TargetIntent = 'press' | 'grasp' | 'place' | 'touch';

/** A target name, optionally with the face to use. */
export type TargetReference = string | { name: string; face?: TargetFace };

export interface TargetResolveContext {
  device?: string;
  anchor?: string;
  intent?: TargetIntent;
  /** The acting shoulder (XR origin): "front" is the face toward it. */
  from?: TargetVector;
}

/** A surface point on a live target, everything XR-origin relative. */
export interface ResolvedTarget {
  name: string;
  /** Where the hand's anchor should go. */
  position: TargetVector;
  /** Outward unit normal of the face `position` is on. */
  normal: TargetVector;
  size: TargetVector;
  box: { min: TargetVector; max: TargetVector };
}

export interface TargetSummary {
  name: string;
  /** Centre of the target's box. */
  position: TargetVector;
  size: TargetVector;
}

// Entities with these components are what hands interact with.
const INTERACTION_COMPONENT_IDS = new Set([
  'PokeInteractable',
  'RayInteractable',
  'OneHandGrabbable',
  'TwoHandsGrabbable',
  'DistanceGrabbable',
]);
const MAX_TRAVERSED_OBJECTS = 20_000;

interface TargetCandidate {
  name: string;
  /** Other names it answers to: the scene node id and the Object3D uuid. */
  aliases: string[];
  object: Object3D;
  /** The owning entity; its bounds stop at nested entities. */
  entityIndex?: number;
  /** A UIKit element: a flat quad, touched on its face. */
  element: boolean;
  /** The entity an element belongs to, used to tell same-named ones apart. */
  owner?: TargetCandidate;
  /** The name it shares with other targets, before it was given its own. */
  sharedName?: string;
}

const UP = new Vector3(0, 1, 0);

/**
 * Turns the target names of IWER `run_sequence` steps into points on live
 * scene objects (IWER's `TargetResolver` contract), so an agent can press
 * `counter-button` or pick up `Map Pin 1` by name.
 *
 * Targets are the entities with an interaction or grab component, by
 * Object3D name, and the UIKit elements with an `id` inside them. `resolve`
 * also accepts any scene node id, Object3D name or uuid in the scene.
 *
 * @category Runtime
 */
export class SceneTargetResolver {
  private readonly toOrigin = new Matrix4();
  private readonly matrix = new Matrix4();
  private readonly partBox = new Box3();
  private warnedTruncated = false;

  constructor(
    private readonly world: Pick<
      World,
      'camera' | 'entityManager' | 'player' | 'scene'
    >,
  ) {}

  resolve(
    target: TargetReference,
    context: TargetResolveContext = {},
  ): ResolvedTarget | null {
    const name = typeof target === 'string' ? target : target?.name;
    if (typeof name !== 'string' || name.length === 0) {
      return null;
    }
    const candidates = this.collect();
    const candidate =
      candidates.find(
        (entry) => entry.name === name || entry.aliases.includes(name),
      ) ??
      // A name several targets share is unknown; IWER then lists theirs.
      (candidates.some((entry) => entry.sharedName === name)
        ? undefined
        : this.findSceneObject(name));
    if (!candidate) {
      return null;
    }
    this.updateOrigin();
    const box = this.bounds(candidate);
    const center = box.getCenter(new Vector3());
    const from = context.from
      ? new Vector3(context.from.x, context.from.y, context.from.z)
      : this.world.camera
          .getWorldPosition(new Vector3())
          .applyMatrix4(this.toOrigin);
    const face = typeof target === 'string' ? undefined : target.face;
    const { position, normal } = candidate.element
      ? this.elementFace(candidate.object, center, from, face)
      : boxFace(box, center, from, face ?? defaultFace(context.intent));
    return {
      name: candidate.name,
      position: toVector(position),
      normal: toVector(normal),
      size: toVector(box.getSize(new Vector3())),
      box: { min: toVector(box.min), max: toVector(box.max) },
    };
  }

  list(): TargetSummary[] {
    this.updateOrigin();
    return this.collect().map((candidate) => {
      const box = this.bounds(candidate);
      return {
        name: candidate.name,
        position: toVector(box.getCenter(new Vector3())),
        size: toVector(box.getSize(new Vector3())),
      };
    });
  }

  /** Interactable entities and the identified UIKit elements inside them. */
  private collect(): TargetCandidate[] {
    const candidates: TargetCandidate[] = [];
    let traversed = 0;
    let truncated = false;
    const stack: Object3D[] = [this.world.scene];
    while (stack.length > 0 && traversed < MAX_TRAVERSED_OBJECTS) {
      const object = stack.pop()!;
      traversed += 1;
      const entity = interactableEntityOf(this.world, object);
      if (entity != null && isShown(object)) {
        const nodeId = sceneNodeIdOf(object);
        const owner: TargetCandidate = {
          name: object.name || nodeId || `entity-${entity}`,
          aliases: [nodeId, object.uuid].filter(isString),
          object,
          entityIndex: entity,
          element: false,
        };
        candidates.push(owner);
        truncated = collectElements(object, owner, candidates) || truncated;
      }
      for (let index = object.children.length - 1; index >= 0; index -= 1) {
        stack.push(object.children[index]);
      }
    }
    if ((truncated || stack.length > 0) && !this.warnedTruncated) {
      this.warnedTruncated = true;
      console.warn(
        `[SceneTargetResolver] Stopped after ${MAX_TRAVERSED_OBJECTS} scene objects; some hand targets may be missing from xr_list_targets. A step can still name any scene node id or Object3D name.`,
      );
    }
    return disambiguate(candidates);
  }

  private findSceneObject(name: string): TargetCandidate | undefined {
    let found: Object3D | undefined;
    this.world.scene.traverse((object) => {
      if (
        !found &&
        (object.name === name ||
          sceneNodeIdOf(object) === name ||
          object.uuid === name)
      ) {
        found = object;
      }
    });
    if (!found) {
      return undefined;
    }
    return {
      name,
      aliases: [],
      object: found,
      entityIndex: found.entityIdx,
      element: found instanceof Component,
    };
  }

  private updateOrigin(): void {
    const player = this.world.player;
    if (player) {
      player.updateWorldMatrix(true, false);
      this.toOrigin.copy(player.matrixWorld).invert();
    } else {
      this.toOrigin.identity();
    }
  }

  /** The candidate's axis-aligned box in the XR origin. */
  private bounds(candidate: TargetCandidate): Box3 {
    const box = new Box3();
    const { object } = candidate;
    object.updateWorldMatrix(true, true);
    if (candidate.element) {
      // A UIKit element's world matrix maps the unit square onto it.
      this.matrix.multiplyMatrices(this.toOrigin, object.matrixWorld);
      for (const [x, y] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ]) {
        box.expandByPoint(new Vector3(x, y, 0).applyMatrix4(this.matrix));
      }
      return box;
    }
    // Inside a UIKit tree only the components' own quads count: its
    // instanced panel and glyph meshes keep unused instances at the origin.
    const stack: Array<[Object3D, boolean]> = [[object, false]];
    let traversed = 0;
    while (stack.length > 0 && traversed < MAX_TRAVERSED_OBJECTS) {
      const [current, inUikit] = stack.pop()!;
      traversed += 1;
      if (
        current !== object &&
        typeof current.entityIdx === 'number' &&
        current.entityIdx !== candidate.entityIndex
      ) {
        continue;
      }
      const isComponent = current instanceof Component;
      if (
        !isShown(current) ||
        (isComponent && current.displayed?.value === false)
      ) {
        continue;
      }
      const local = inUikit && !isComponent ? null : localBounds(current);
      if (local) {
        this.matrix.multiplyMatrices(this.toOrigin, current.matrixWorld);
        box.union(this.partBox.copy(local).applyMatrix4(this.matrix));
      }
      for (const child of current.children) {
        stack.push([child, inUikit || isComponent]);
      }
    }
    if (box.isEmpty()) {
      box.expandByPoint(
        new Vector3().setFromMatrixPosition(object.matrixWorld),
      );
      box.applyMatrix4(this.toOrigin);
    }
    return box;
  }

  /** A flat element is touched at its centre, on the side facing `from`. */
  private elementFace(
    object: Object3D,
    center: Vector3,
    from: Vector3,
    face: TargetFace | undefined,
  ): { position: Vector3; normal: Vector3 } {
    this.matrix.multiplyMatrices(this.toOrigin, object.matrixWorld);
    const normal = new Vector3()
      .setFromMatrixColumn(this.matrix, 2)
      .normalize();
    const facesFrom = normal.dot(from.clone().sub(center)) >= 0;
    if (facesFrom === (face === 'back')) {
      normal.negate();
    }
    return { position: center.clone(), normal };
  }
}

function defaultFace(intent: TargetIntent | undefined): TargetFace | null {
  switch (intent) {
    case 'place':
      return 'top';
    case 'grasp':
      // Pinch the middle of the object, approaching from the body.
      return null;
    default:
      return 'front';
  }
}

/**
 * A face of an axis-aligned box: top and bottom by height, the others as
 * seen from `from` (front faces it). `null` is the box centre, with the
 * front's normal.
 */
function boxFace(
  box: Box3,
  center: Vector3,
  from: Vector3,
  face: TargetFace | null,
): { position: Vector3; normal: Vector3 } {
  if (face === 'top' || face === 'bottom') {
    const sign = face === 'top' ? 1 : -1;
    return {
      position: new Vector3(
        center.x,
        face === 'top' ? box.max.y : box.min.y,
        center.z,
      ),
      normal: new Vector3(0, sign, 0),
    };
  }
  // Looking from `from` toward the box, on the floor plane.
  const facing = center.clone().sub(from).setY(0);
  if (facing.lengthSq() < 1e-8) {
    facing.set(0, 0, -1);
  }
  const right = facing.clone().cross(UP);
  const direction =
    face === 'back'
      ? facing
      : face === 'right'
        ? right
        : face === 'left'
          ? right.negate()
          : facing.negate();
  const normal = snapToAxis(direction);
  if (face === null) {
    return { position: center.clone(), normal };
  }
  const half = box.getSize(new Vector3()).multiplyScalar(0.5);
  return {
    position: center
      .clone()
      .add(new Vector3(normal.x * half.x, 0, normal.z * half.z)),
    normal,
  };
}

/** The horizontal box face normal closest to a direction. */
function snapToAxis(direction: Vector3): Vector3 {
  return Math.abs(direction.x) >= Math.abs(direction.z)
    ? new Vector3(Math.sign(direction.x) || 1, 0, 0)
    : new Vector3(0, 0, Math.sign(direction.z) || 1);
}

/** Adds the identified UIKit elements under an entity; true if cut short. */
function collectElements(
  root: Object3D,
  owner: TargetCandidate,
  candidates: TargetCandidate[],
): boolean {
  const entityIndex = owner.entityIndex;
  const stack: Object3D[] = [...root.children];
  let traversed = 0;
  while (stack.length > 0 && traversed < MAX_TRAVERSED_OBJECTS) {
    const object = stack.pop()!;
    traversed += 1;
    if (
      typeof object.entityIdx === 'number' &&
      object.entityIdx !== entityIndex
    ) {
      continue;
    }
    if (object instanceof Component) {
      if (object.displayed?.value === false) {
        continue;
      }
      const id = (
        object.properties?.peek() as Record<string, unknown> | undefined
      )?.id;
      if (
        typeof id === 'string' &&
        id.length > 0 &&
        object.isVisible?.value !== false
      ) {
        candidates.push({
          name: id,
          aliases: [object.uuid],
          object,
          element: true,
          owner,
        });
      }
    } else if (!object.visible) {
      continue;
    }
    for (let index = object.children.length - 1; index >= 0; index -= 1) {
      stack.push(object.children[index]);
    }
  }
  return stack.length > 0;
}

/** Gives targets that share a name a distinguishing one. */
function disambiguate(candidates: TargetCandidate[]): TargetCandidate[] {
  const counts = new Map<string, number>();
  for (const { name } of candidates) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // An entity comes before its elements, so they take its final name.
  const finalNames = new Map<TargetCandidate, string>();
  const named = candidates.map((candidate) => {
    if (counts.get(candidate.name) === 1) {
      finalNames.set(candidate, candidate.name);
      return candidate;
    }
    const name = candidate.element
      ? `${finalNames.get(candidate.owner!) ?? candidate.owner!.name}/${candidate.name}`
      : (candidate.aliases.find((alias) => alias !== candidate.object.uuid) ??
        `${candidate.name}#${candidate.entityIndex}`);
    finalNames.set(candidate, name);
    return { ...candidate, name, sharedName: candidate.name };
  });
  // Still shared (one id twice in a panel): number the repeats.
  const seen = new Map<string, number>();
  return named.map((candidate) => {
    const count = (seen.get(candidate.name) ?? 0) + 1;
    seen.set(candidate.name, count);
    return count === 1
      ? candidate
      : {
          ...candidate,
          name: `${candidate.name}#${count}`,
          sharedName: candidate.sharedName ?? candidate.name,
        };
  });
}

function interactableEntityOf(
  world: Pick<World, 'entityManager'>,
  object: Object3D,
): number | null {
  if (typeof object.entityIdx !== 'number') {
    return null;
  }
  const entity = world.entityManager.getEntityByIndex(object.entityIdx);
  if (!entity || !entity.active || entity.object3D !== object) {
    return null;
  }
  return entity
    .getComponents()
    .some((component) => INTERACTION_COMPONENT_IDS.has(component.id))
    ? object.entityIdx
    : null;
}

/** False when the object or an ordinary ancestor is hidden. */
function isShown(object: Object3D): boolean {
  for (
    let current: Object3D | null = object;
    current;
    current = current.parent
  ) {
    if (!(current instanceof Component) && current.visible === false) {
      return false;
    }
  }
  return true;
}

/** Local bounds as Box3.setFromObject reads them, null without geometry. */
function localBounds(object: Object3D): Box3 | null {
  if (object instanceof Component && object.visible === false) {
    // UIKit hides renderless layout components; their children still count.
    return null;
  }
  const mesh = object as Object3D & {
    isMesh?: boolean;
    isPoints?: boolean;
    isLine?: boolean;
    isInstancedMesh?: boolean;
    isBatchedMesh?: boolean;
    isSkinnedMesh?: boolean;
    geometry?: BufferGeometry;
    boundingBox?: Box3 | null;
    computeBoundingBox?: () => void;
  };
  if (!(mesh.isMesh || mesh.isPoints || mesh.isLine) || !mesh.geometry) {
    return null;
  }
  // Instanced, batched and skinned meshes carry bounds covering what they
  // draw. (UIKit icons have a `boundingBox` too, but it is a signal.)
  if (mesh.isInstancedMesh || mesh.isBatchedMesh || mesh.isSkinnedMesh) {
    if (mesh.boundingBox == null) {
      mesh.computeBoundingBox?.();
    }
    return mesh.boundingBox ?? null;
  }
  if (mesh.geometry.boundingBox === null) {
    mesh.geometry.computeBoundingBox();
  }
  return mesh.geometry.boundingBox;
}

function sceneNodeIdOf(object: Object3D): string | undefined {
  const id = object.userData?.iwsdkSceneNodeId;
  return typeof id === 'string' ? id : undefined;
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function toVector(vector: Vector3): TargetVector {
  return { x: vector.x, y: vector.y, z: vector.z };
}
