/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { TOUCH_DEFAULTS } from '@iwsdk/xr-input';
import { Component } from '@pmndrs/uikit';
import type { World } from '../ecs/world.js';
import { Box3, Matrix3, Matrix4, Vector3 } from '../runtime/index.js';
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

interface TargetBounds {
  /** Axis-aligned, in the XR origin. */
  box: Box3;
  /**
   * Along the target's own axes, with the matrix that maps it into the XR
   * origin. Absent for UIKit elements and targets scaled to (nearly) nothing.
   */
  own?: { box: Box3; toOrigin: Matrix4 };
}

const UP = new Vector3(0, 1, 0);
const IDENTITY = new Matrix4();
/**
 * How much of a UIKit element, in metres, has to show along an axis its
 * scroll or overflow containers cut; with less it counts as scrolled out of
 * view. (An element smaller than that counts while none of it is cut.) UIKit
 * still draws a row that only touches the edge of its list, and a press on
 * that edge goes to the neighbouring row. The touch pointer goes down on the
 * closest element within its down radius (2 cm) and clicks only if it comes
 * up on the same one, so the fingertip has to stay over the part that shows
 * while it is that close. Half the down radius, 1 cm, keeps the press point
 * (the middle of what shows) 5 mm from the edges of what shows: past IWER's
 * 2 mm aim jitter, with 3 mm to spare, enough for a reach up to 8° off the
 * normal across those 2 cm.
 */
const MIN_SHOWN_SPAN = TOUCH_DEFAULTS.downRadius / 2;
/** The unit square a UIKit component's world matrix maps onto it, in order. */
const QUAD = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
] as const;

/**
 * Turns the target names of IWER `run_sequence` steps into points on live
 * scene objects (IWER's `TargetResolver` contract), so an agent can press
 * `counter-button` or pick up `Map Pin 1` by name.
 *
 * Targets are the entities with an interaction or grab component, by
 * Object3D name, and the UIKit elements with an `id` inside them. `resolve`
 * also accepts any scene node id, Object3D name or uuid in the scene, except a
 * UIKit element that is not listed because UIKit doesn't draw it or less than
 * MIN_SHOWN_SPAN of it shows.
 *
 * @category Runtime
 */
export class SceneTargetResolver {
  private readonly toOrigin = new Matrix4();
  private readonly matrix = new Matrix4();
  private readonly partBox = new Box3();
  private readonly point = new Vector3();
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
    if (candidate.element && candidate.object instanceof Component) {
      // An element UIKit doesn't draw (hidden or scrolled out of view), or
      // cuts to a sliver, has no point to press. By its id it is not listed
      // (collectElements); by its uuid it resolved to the middle of where it
      // is laid out, which can lie on a neighbouring element. Measuring it
      // needs a current world matrix (see bounds()).
      const element = candidate.object;
      element.updateWorldMatrix(true, false);
      if (
        element.isVisible?.value === false ||
        visibleQuad(element).length === 0
      ) {
        return null;
      }
    }
    this.updateOrigin();
    const bounds = this.bounds(candidate, !candidate.element);
    const { box } = bounds;
    const center = box.getCenter(new Vector3());
    const from = context.from
      ? new Vector3(context.from.x, context.from.y, context.from.z)
      : this.world.camera
          .getWorldPosition(new Vector3())
          .applyMatrix4(this.toOrigin);
    const face = typeof target === 'string' ? undefined : target.face;
    const { position, normal } = candidate.element
      ? this.elementFace(candidate.object, center, from, face)
      : objectFace(
          bounds,
          from,
          face ?? defaultFace(context.intent),
          context.intent === 'place',
        );
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
      const { box } = this.bounds(candidate);
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

  /**
   * The candidate's axis-aligned box in the XR origin and, with `withOwn`,
   * its box along its own axes, from one walk over what it draws.
   */
  private bounds(candidate: TargetCandidate, withOwn = false): TargetBounds {
    const { object } = candidate;
    object.updateWorldMatrix(true, true);
    const frames = [this.toOrigin];
    let ownToOrigin: Matrix4 | undefined;
    if (withOwn) {
      // Scaled to (nearly) nothing, it has no frame of its own: the inverse
      // is all zeros, or overflows.
      const toObject = new Matrix4().copy(object.matrixWorld).invert();
      if (
        toObject.determinant() !== 0 &&
        toObject.elements.every(Number.isFinite)
      ) {
        frames.push(toObject);
        ownToOrigin = new Matrix4().multiplyMatrices(
          this.toOrigin,
          object.matrixWorld,
        );
      }
    }
    const boxes = frames.map(() => new Box3());
    const addPoint = (point: Vector3) => {
      frames.forEach((frame, index) => {
        boxes[index].expandByPoint(this.point.copy(point).applyMatrix4(frame));
      });
    };
    if (candidate.element && object instanceof Component) {
      visibleQuad(object).forEach(addPoint);
    } else {
      // Inside a UIKit tree only the components' own quads count: its
      // instanced panel and glyph meshes keep unused instances at the origin.
      // Runtime-only meshes (a ContactShadow blob) are not part of the target.
      const stack: Array<[Object3D, boolean]> = [[object, false]];
      let traversed = 0;
      while (stack.length > 0 && traversed < MAX_TRAVERSED_OBJECTS) {
        const [current, inUikit] = stack.pop()!;
        traversed += 1;
        if (
          (current !== object &&
            typeof current.entityIdx === 'number' &&
            current.entityIdx !== candidate.entityIndex) ||
          current.userData?.iwsdkRuntimeOnly === true
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
        if (isComponent) {
          // UIKit refreshes a child component's matrixWorld only when a
          // pointer casts against it: until then it is stale, or the identity
          // (at the origin) for one no pointer has come near.
          current.updateWorldMatrix(false, false);
          // UIKit hides renderless layout components (`visible`), but keeps a
          // container with an icon or image visible even when it is hidden
          // or scrolled out of view (`isVisible`) and draws nothing. Either
          // way its children still count.
          if (current.visible && current.isVisible?.value !== false) {
            visibleQuad(current).forEach(addPoint);
          }
        } else if (!inUikit) {
          const local = localBounds(current);
          if (local) {
            frames.forEach((frame, index) => {
              this.matrix.multiplyMatrices(frame, current.matrixWorld);
              boxes[index].union(
                this.partBox.copy(local).applyMatrix4(this.matrix),
              );
            });
          }
        }
        for (const child of current.children) {
          stack.push([child, inUikit || isComponent]);
        }
      }
    }
    if (boxes[0].isEmpty()) {
      addPoint(new Vector3().setFromMatrixPosition(object.matrixWorld));
    }
    return {
      box: boxes[0],
      own: ownToOrigin && { box: boxes[1], toOrigin: ownToOrigin },
    };
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
 * A face of a target that is not a UIKit element, on the tighter of its own
 * and its axis-aligned box: a turned key's axis-aligned box is wider than the
 * key, and the own box of an entity whose mesh is turned back is wider than
 * the mesh. The point always lies on the axis-aligned box, which holds the
 * whole target: on an L-shaped target, its own box's face on the open side of
 * the L is in the air.
 */
function objectFace(
  { box, own }: TargetBounds,
  from: Vector3,
  face: TargetFace | null,
  placing: boolean,
): { position: Vector3; normal: Vector3 } {
  let result =
    own && extent(own.box, own.toOrigin) < extent(box, IDENTITY) * (1 - 1e-6)
      ? boxFace(own.box, own.toOrigin, from, face)
      : undefined;
  if (
    !result ||
    !box.clone().expandByScalar(1e-6).containsPoint(result.position)
  ) {
    result = boxFace(box, IDENTITY, from, face);
  }
  if (placing && face === 'top') {
    // IWER carries a held object upright and lowers it along this normal by
    // the height it is held above its base, so a tilted normal would set it
    // down downhill of the middle of the face. Straight down, it lands on the
    // middle at any tilt.
    result.normal.copy(UP);
  }
  return result;
}

/** The summed edge lengths of `box` once `toOrigin` maps it into the XR origin. */
function extent(box: Box3, toOrigin: Matrix4): number {
  const size = box.getSize(new Vector3());
  const edge = new Vector3();
  let sum = 0;
  for (let index = 0; index < 3; index += 1) {
    edge.setFromMatrixColumn(toOrigin, index);
    sum += size.getComponent(index) * edge.length();
  }
  return sum;
}

/**
 * A face of `box`, which `toOrigin` maps into the XR origin: the face whose
 * normal points most nearly up (top) or down (bottom), or as seen from
 * `from` (front faces it). `null` is the box centre, with the front's normal.
 */
function boxFace(
  box: Box3,
  toOrigin: Matrix4,
  from: Vector3,
  face: TargetFace | null,
): { position: Vector3; normal: Vector3 } {
  const center = box.getCenter(new Vector3());
  const centerInOrigin = center.clone().applyMatrix4(toOrigin);
  let direction: Vector3;
  if (face === 'top' || face === 'bottom') {
    direction = new Vector3(0, face === 'top' ? 1 : -1, 0);
  } else {
    // Looking from `from` toward the box, on the floor plane.
    const facing = centerInOrigin.clone().sub(from).setY(0);
    if (facing.lengthSq() < 1e-8) {
      facing.set(0, 0, -1);
    }
    const right = facing.clone().cross(UP);
    direction =
      face === 'back'
        ? facing
        : face === 'right'
          ? right
          : face === 'left'
            ? right.negate()
            : facing.negate();
  }
  const normalMatrix = new Matrix3().getNormalMatrix(toOrigin);
  const normal = new Vector3();
  let axis = 0;
  let side = 1;
  let best = -Infinity;
  for (let index = 0; index < 3; index += 1) {
    for (const sign of [1, -1]) {
      const faceNormal = new Vector3()
        .setComponent(index, sign)
        .applyMatrix3(normalMatrix)
        .normalize();
      const score = faceNormal.dot(direction);
      if (score > best) {
        best = score;
        axis = index;
        side = sign;
        normal.copy(faceNormal);
      }
    }
  }
  if (face === null) {
    return { position: centerInOrigin, normal };
  }
  center.setComponent(
    axis,
    side > 0 ? box.max.getComponent(axis) : box.min.getComponent(axis),
  );
  return { position: center.applyMatrix4(toOrigin), normal };
}

/**
 * The corners of a UIKit component's quad in world space (its world matrix
 * must be current), cut to the part its overflow (scroll) containers leave in
 * view. None before it is laid out, or when they leave less than
 * MIN_SHOWN_SPAN of an axis they cut, such as a row that only touches the
 * edge of its list.
 */
function visibleQuad(
  component: Pick<
    Component,
    'globalPanelMatrix' | 'matrixWorld' | 'parentContainer'
  >,
): Vector3[] {
  const panelMatrix = component.globalPanelMatrix?.peek();
  if (panelMatrix == null) {
    return [];
  }
  // UIKit clips in the space of its root ("global"); each corner's place on
  // the quad and its world point are carried along.
  let polygon = QUAD.map(([x, y]) => ({
    quad: new Vector3(x, y, 0),
    root: new Vector3(x, y, 0).applyMatrix4(panelMatrix),
    world: new Vector3(x, y, 0).applyMatrix4(component.matrixWorld),
  }));
  const planes =
    component.parentContainer?.peek()?.clippingRect?.peek()?.planes ?? [];
  for (const plane of planes) {
    const kept: typeof polygon = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const corner = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const here = plane.distanceToPoint(corner.root);
      const there = plane.distanceToPoint(next.root);
      const inside = here >= 0;
      if (inside) {
        kept.push(corner);
      }
      if (inside !== there >= 0) {
        const t = here / (here - there);
        kept.push({
          quad: corner.quad.clone().lerp(next.quad, t),
          root: corner.root.clone().lerp(next.root, t),
          world: corner.world.clone().lerp(next.world, t),
        });
      }
    }
    polygon = kept;
  }
  // What shows of each axis of the quad, which is one unit along each; the
  // world matrix's column for an axis is that unit in metres. Below one
  // unit (beyond rounding), the containers cut that axis.
  const axis = new Vector3();
  for (let index = 0; index < 2; index += 1) {
    const along = polygon.map(({ quad }) => quad.getComponent(index));
    const shown =
      along.length > 0 ? Math.max(...along) - Math.min(...along) : 0;
    const metres = axis
      .setFromMatrixColumn(component.matrixWorld, index)
      .length();
    if (shown < 1 - 1e-9 && shown * metres < MIN_SHOWN_SPAN) {
      return [];
    }
  }
  return polygon.map(({ world }) => world);
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
        // A row that only touches the edge of its list, or shows only a
        // sliver, is drawn but a press on it lands on the next row: it
        // counts as scrolled out of view (MIN_SHOWN_SPAN). Measuring it
        // needs a current matrixWorld, which UIKit leaves stale (see
        // bounds()).
        object.updateWorldMatrix(true, false);
        if (visibleQuad(object).length > 0) {
          candidates.push({
            name: id,
            aliases: [object.uuid],
            object,
            element: true,
            owner,
          });
        }
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
