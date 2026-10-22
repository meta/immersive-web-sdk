/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent } from '../ecs/component.js';
import type { Entity } from '../ecs/entity.js';
import { createSystem } from '../ecs/system.js';
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  ShadowMaterial,
  UnsignedByteType,
} from '../runtime/index.js';

const SIZE_HELP =
  "Width (X) and depth (Z) in this node's local space; scales with the node.";

/**
 * Soft round blob shadow under a node.
 *
 * @remarks
 * - {@link GroundShadowSystem} parents a flat, runtime-only mesh to the node, so
 *   it moves and scales with the node; it does not follow grabbed objects.
 * - Never casts or receives shadows and never takes pointer hits.
 *
 * @category Environment & Lighting
 */
export const ContactShadow = createComponent(
  'ContactShadow',
  {
    size: {
      type: Types.Vec2,
      default: [1, 1],
      label: 'Size (m)',
      help: SIZE_HELP,
    },
    opacity: {
      type: Types.Float32,
      default: 0.72,
      label: 'Opacity',
      help: 'Darkness at the center; fades to zero at the edge.',
      max: 1,
      min: 0,
      step: 0.01,
    },
    color: {
      type: Types.Color,
      default: [0.3765, 0.3922, 0.4549, 1],
      label: 'Color',
      help: 'Shadow tint (sRGB).',
      widget: 'color',
    },
    height: {
      type: Types.Float32,
      default: 0.002,
      label: 'Lift (m)',
      help: "Height above this node's origin, to avoid z-fighting with the surface below.",
      min: 0,
      step: 0.001,
    },
  },
  'Soft round blob shadow on the ground under this node. Put it on the node that stands on the surface, or on a separate node under a loose object; it does not follow grabbed objects.',
);

/**
 * Invisible floor that shows only the shadows it receives.
 *
 * @remarks
 * - Grounds content over AR passthrough. Shadows need `environment.shadows`
 *   and a light with `castShadow`.
 * - The plane lies flat at the node's origin and never takes pointer hits.
 *
 * @category Environment & Lighting
 */
export const ShadowCatcher = createComponent(
  'ShadowCatcher',
  {
    size: {
      type: Types.Vec2,
      default: [6, 6],
      label: 'Size (m)',
      help: SIZE_HELP,
    },
    opacity: {
      type: Types.Float32,
      default: 0.25,
      label: 'Shadow opacity',
      help: 'Darkness of the shadows this floor receives.',
      max: 1,
      min: 0,
      step: 0.01,
    },
    color: {
      type: Types.Color,
      default: [0, 0, 0, 1],
      label: 'Shadow color',
      help: 'Color of the received shadows (sRGB).',
      widget: 'color',
    },
  },
  'Invisible floor that shows only the shadows it receives, so content stays grounded over AR passthrough. Needs environment.shadows and a light with castShadow.',
);

/** @internal Values a {@link ContactShadowBinding} renders. */
export interface ContactShadowSpec {
  color: ArrayLike<number>;
  height: number;
  opacity: number;
  size: ArrayLike<number>;
}

/** @internal Values a {@link ShadowCatcherBinding} renders. */
export interface ShadowCatcherSpec {
  color: ArrayLike<number>;
  opacity: number;
  size: ArrayLike<number>;
}

/** @internal */
export type GroundShadowSpec =
  | { kind: 'contact-shadow'; spec: ContactShadowSpec }
  | { kind: 'shadow-catcher'; spec: ShadowCatcherSpec };

/** @internal Geometry and texture shared by every binding of one owner. */
export interface GroundShadowResources {
  readonly contactTexture: DataTexture;
  readonly plane: PlaneGeometry;
  dispose(): void;
}

const CONTACT_TEXTURE_SIZE = 256;

/** Blob alpha: 1 at the center, 0.5 at r = 0.35, 0 at the edge and beyond. */
function contactShadowRamp(r: number): number {
  if (r <= 0.35) {
    return 1 - (0.5 * r) / 0.35;
  }
  return r >= 1 ? 0 : (0.5 * (1 - r)) / 0.65;
}

/**
 * @internal
 * Create the unit plane and radial blob texture the ground-shadow bindings
 * share. The owner disposes them after its last binding.
 */
export function createGroundShadowResources(): GroundShadowResources {
  const size = CONTACT_TEXTURE_SIZE;
  const half = size / 2;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(255 * contactShadowRamp(r));
    }
  }
  const contactTexture = new DataTexture(
    data,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  contactTexture.name = 'ContactShadow';
  contactTexture.colorSpace = SRGBColorSpace;
  contactTexture.magFilter = LinearFilter;
  contactTexture.minFilter = LinearMipmapLinearFilter;
  contactTexture.generateMipmaps = true;
  contactTexture.anisotropy = 8;
  contactTexture.needsUpdate = true;
  const plane = new PlaneGeometry(1, 1);
  return {
    contactTexture,
    plane,
    dispose() {
      plane.dispose();
      contactTexture.dispose();
    },
  };
}

function markGroundShadowMesh(mesh: Mesh, name: string, marker: string): void {
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.userData.iwsdkRuntimeOnly = true;
  mesh.userData[marker] = true;
  // A blob on an interactable node must never take its pointer hits: ray, grab
  // and touch pointers skip `pointerEvents: 'none'`, and plain raycasters (the
  // editor, MCP) hit the no-op `raycast`.
  mesh.pointerEvents = 'none';
  mesh.raycast = () => {};
}

function applyGroundShadowLook(
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial | ShadowMaterial>,
  spec: ShadowCatcherSpec,
): void {
  const { color, size } = spec;
  mesh.scale.set(Math.max(size[0], 1e-4), Math.max(size[1], 1e-4), 1);
  mesh.material.opacity = spec.opacity;
  mesh.material.color.setRGB(color[0], color[1], color[2], SRGBColorSpace);
}

/**
 * @internal
 * Owns one ContactShadow mesh, shared by GroundShadowSystem and the editor
 * viewport like LightBinding.
 */
export class ContactShadowBinding {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private disposed = false;

  constructor(
    readonly parent: Object3D,
    resources: GroundShadowResources,
    spec: ContactShadowSpec,
  ) {
    this.mesh = new Mesh(
      resources.plane,
      new MeshBasicMaterial({
        map: resources.contactTexture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    markGroundShadowMesh(this.mesh, 'ContactShadow', 'iwsdkContactShadow');
    parent.add(this.mesh);
    this.update(spec);
  }

  update(spec: ContactShadowSpec): void {
    this.assertActive();
    applyGroundShadowLook(this.mesh, spec);
    this.mesh.position.y = spec.height;
    // Asset loading copies the node's shadow flags onto every mesh under it.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.material.dispose();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Cannot update a disposed ContactShadowBinding');
    }
  }
}

/**
 * @internal
 * Owns one ShadowCatcher mesh, shared by GroundShadowSystem and the editor
 * viewport like LightBinding.
 */
export class ShadowCatcherBinding {
  readonly mesh: Mesh<PlaneGeometry, ShadowMaterial>;
  private disposed = false;

  constructor(
    readonly parent: Object3D,
    resources: GroundShadowResources,
    spec: ShadowCatcherSpec,
  ) {
    this.mesh = new Mesh(resources.plane, new ShadowMaterial());
    markGroundShadowMesh(this.mesh, 'ShadowCatcher', 'iwsdkShadowCatcher');
    parent.add(this.mesh);
    this.update(spec);
  }

  update(spec: ShadowCatcherSpec): void {
    this.assertActive();
    applyGroundShadowLook(this.mesh, spec);
    // Asset loading copies the node's shadow flags onto every mesh under it.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.material.dispose();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Cannot update a disposed ShadowCatcherBinding');
    }
  }
}

/**
 * Builds and updates {@link ContactShadow} and {@link ShadowCatcher} meshes.
 *
 * @remarks
 * - Each mesh is parented to its entity's `object3D` and marked
 *   `userData.iwsdkRuntimeOnly`, so bounds, physics shapes, locomotion
 *   collision, editor lenses, raycasts and pointers ignore it.
 * - Field edits apply on the next update; removing the component or
 *   destroying the entity removes the mesh.
 * - Both stay visible during AR sessions.
 *
 * @category Environment & Lighting
 */
export class GroundShadowSystem extends createSystem({
  contactShadows: { required: [ContactShadow] },
  shadowCatchers: { required: [ShadowCatcher] },
}) {
  // Created with the first binding, so apps without ground shadows never build
  // the blob texture.
  private resources: GroundShadowResources | undefined;
  private readonly contactShadowBindings = new Map<
    Entity,
    { binding: ContactShadowBinding; spec: ContactShadowSpec }
  >();
  private readonly shadowCatcherBindings = new Map<
    Entity,
    { binding: ShadowCatcherBinding; spec: ShadowCatcherSpec }
  >();

  init(): void {
    this.cleanupFuncs.push(
      this.queries.contactShadows.subscribe(
        'qualify',
        (entity) => this.attachContactShadow(entity as Entity),
        true,
      ),
      this.queries.contactShadows.subscribe('disqualify', (entity) =>
        detachBinding(this.contactShadowBindings, entity as Entity),
      ),
      this.queries.shadowCatchers.subscribe(
        'qualify',
        (entity) => this.attachShadowCatcher(entity as Entity),
        true,
      ),
      this.queries.shadowCatchers.subscribe('disqualify', (entity) =>
        detachBinding(this.shadowCatcherBindings, entity as Entity),
      ),
      () => {
        for (const entity of [...this.contactShadowBindings.keys()]) {
          detachBinding(this.contactShadowBindings, entity);
        }
        for (const entity of [...this.shadowCatcherBindings.keys()]) {
          detachBinding(this.shadowCatcherBindings, entity);
        }
        this.resources?.dispose();
        this.resources = undefined;
      },
    );
  }

  update(): void {
    for (const [entity, entry] of this.contactShadowBindings) {
      entry.binding.update(readContactShadowSpec(entity, entry.spec));
    }
    for (const [entity, entry] of this.shadowCatcherBindings) {
      entry.binding.update(readShadowCatcherSpec(entity, entry.spec));
    }
  }

  private sharedResources(): GroundShadowResources {
    return (this.resources ??= createGroundShadowResources());
  }

  private attachContactShadow(entity: Entity): void {
    if (entity.object3D == null || this.contactShadowBindings.has(entity)) {
      return;
    }
    const spec = readContactShadowSpec(entity);
    this.contactShadowBindings.set(entity, {
      binding: new ContactShadowBinding(
        entity.object3D,
        this.sharedResources(),
        spec,
      ),
      spec,
    });
  }

  private attachShadowCatcher(entity: Entity): void {
    if (entity.object3D == null || this.shadowCatcherBindings.has(entity)) {
      return;
    }
    const spec = readShadowCatcherSpec(entity);
    this.shadowCatcherBindings.set(entity, {
      binding: new ShadowCatcherBinding(
        entity.object3D,
        this.sharedResources(),
        spec,
      ),
      spec,
    });
  }
}

function detachBinding(
  bindings: Map<Entity, { binding: { dispose(): void } }>,
  entity: Entity,
): void {
  bindings.get(entity)?.binding.dispose();
  bindings.delete(entity);
}

// Vector views are live and cached per entity, so refreshing a spec in place
// allocates nothing per frame.
function readContactShadowSpec(
  entity: Entity,
  out = {} as ContactShadowSpec,
): ContactShadowSpec {
  out.color = entity.getVectorView(ContactShadow, 'color');
  out.height = Number(entity.getValue(ContactShadow, 'height'));
  out.opacity = Number(entity.getValue(ContactShadow, 'opacity'));
  out.size = entity.getVectorView(ContactShadow, 'size');
  return out;
}

function readShadowCatcherSpec(
  entity: Entity,
  out = {} as ShadowCatcherSpec,
): ShadowCatcherSpec {
  out.color = entity.getVectorView(ShadowCatcher, 'color');
  out.opacity = Number(entity.getValue(ShadowCatcher, 'opacity'));
  out.size = entity.getVectorView(ShadowCatcher, 'size');
  return out;
}

/** @internal Convert one serialized component payload to a ground-shadow spec. */
export function groundShadowSpecFromComponentValue(
  componentName: string,
  value: unknown,
): GroundShadowSpec | undefined {
  const componentId = componentName.startsWith('com.iwsdk.components.')
    ? componentName.slice('com.iwsdk.components.'.length)
    : componentName;
  const component =
    componentId === ContactShadow.id
      ? ContactShadow
      : componentId === ShadowCatcher.id
        ? ShadowCatcher
        : undefined;
  if (component == null) {
    return undefined;
  }
  const payload =
    value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const field = (name: string) =>
    payload[name] ??
    (component.schema as Record<string, { default?: unknown }>)[name]?.default;
  const numeric = (name: string) => Number(field(name));
  const vector = (name: string) => field(name) as ArrayLike<number>;
  if (component === ContactShadow) {
    return {
      kind: 'contact-shadow',
      spec: {
        color: vector('color'),
        height: numeric('height'),
        opacity: numeric('opacity'),
        size: vector('size'),
      },
    };
  }
  return {
    kind: 'shadow-catcher',
    spec: {
      color: vector('color'),
      opacity: numeric('opacity'),
      size: vector('size'),
    },
  };
}
