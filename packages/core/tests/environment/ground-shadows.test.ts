/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  CURRENT_SCENE_VERSION,
  validateSceneDocument,
} from '@iwsdk/scene-composition';
import { describe, expect, it, vi } from 'vitest';
import { IWSDK_BUILTIN_COMPONENTS } from '../../src/ecs/builtin-components.js';
import { componentCatalogFromComponents } from '../../src/ecs/component-manifest.js';
import { World } from '../../src/ecs/world.js';
import {
  ContactShadow,
  ContactShadowBinding,
  GroundShadowSystem,
  ShadowCatcher,
  ShadowCatcherBinding,
  createGroundShadowResources,
  groundShadowSpecFromComponentValue,
  type ContactShadowSpec,
} from '../../src/environment/index.js';
import {
  BoxGeometry,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  Vector3,
} from '../../src/runtime/index.js';
import { Transform } from '../../src/transform/index.js';

const BLOB: ContactShadowSpec = {
  color: [0.3765, 0.3922, 0.4549, 1],
  height: 0.002,
  opacity: 0.72,
  size: [1, 1],
};

function alphaAt(data: Uint8Array, x: number, y: number): number {
  return data[(y * 256 + x) * 4 + 3];
}

function hitsFromAbove(object: Object3D): number {
  object.updateMatrixWorld(true);
  const raycaster = new Raycaster(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
  return raycaster.intersectObject(object, true).length;
}

function createGroundShadowWorld() {
  const world = new World();
  world.scene = new Scene();
  world
    .registerComponent(Transform)
    .registerComponent(ContactShadow)
    .registerComponent(ShadowCatcher);
  world.sceneEntity = world.createTransformEntity(world.scene);
  world.registerSystem(GroundShadowSystem);
  return world;
}

describe('ground shadow components', () => {
  const catalog = componentCatalogFromComponents(IWSDK_BUILTIN_COMPONENTS, {
    source: 'iwsdk',
  });

  it('publishes labelled, limited fields in the built-in catalog', () => {
    expect(catalog.ContactShadow).toMatchObject({
      description: expect.stringContaining('does not follow grabbed objects'),
      fields: {
        color: { default: [0.3765, 0.3922, 0.4549, 1], widget: 'color' },
        height: { default: 0.002, label: 'Lift (m)', min: 0, step: 0.001 },
        opacity: { default: 0.72, help: expect.any(String), max: 1, min: 0 },
        size: { default: [1, 1], label: 'Size (m)', type: 'Vec2' },
      },
    });
    expect(catalog.ShadowCatcher).toMatchObject({
      description: expect.stringContaining('environment.shadows'),
      fields: {
        color: { default: [0, 0, 0, 1], label: 'Shadow color' },
        opacity: { default: 0.25, label: 'Shadow opacity', max: 1, min: 0 },
        size: { default: [6, 6], type: 'Vec2' },
      },
    });
    for (const schema of [catalog.ContactShadow, catalog.ShadowCatcher]) {
      for (const field of Object.values(schema.fields)) {
        expect(field.label).toEqual(expect.any(String));
        expect(field.help).toEqual(expect.any(String));
      }
    }
  });

  it('validates scene payloads against the live catalog', () => {
    const scene = (components: Record<string, unknown>) => ({
      version: CURRENT_SCENE_VERSION,
      units: 'meters' as const,
      resources: {},
      nodes: [{ id: 'plinth', components }],
    });
    expect(
      validateSceneDocument(
        scene({
          'com.iwsdk.components.ContactShadow': { size: [1.2, 0.8] },
          'com.iwsdk.components.ShadowCatcher': {},
        }),
        { componentCatalog: catalog },
      ).valid,
    ).toBe(true);
    expect(
      validateSceneDocument(
        scene({
          'com.iwsdk.components.ContactShadow': { opacity: 1.5, size: [0, 1] },
        }),
        { componentCatalog: catalog },
      ).issues,
    ).toEqual([
      expect.objectContaining({
        code: 'type',
        path: expect.stringMatching(/opacity$/),
      }),
      expect.objectContaining({
        code: 'range',
        message: 'size must be positive',
      }),
    ]);
  });
});

describe('createGroundShadowResources', () => {
  it('paints the starter blob ramp into a mipmapped sRGB texture', () => {
    const resources = createGroundShadowResources();
    const texture = resources.contactTexture;
    const data = texture.image.data as Uint8Array;

    expect(texture.image.width).toBe(256);
    expect(texture.image.height).toBe(256);
    // Pixel centres nearest r = 0, r = 0.35 and r = 1 (ramp 1, 0.5 and 0).
    expect(alphaAt(data, 128, 128)).toBe(253);
    expect(alphaAt(data, 127, 127)).toBe(253);
    expect(alphaAt(data, 172, 128)).toBe(128);
    expect(alphaAt(data, 255, 128)).toBe(1);
    expect(alphaAt(data, 0, 0)).toBe(0);
    expect(alphaAt(data, 220, 220)).toBe(0);
    let maxAlpha = 0;
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 256; x += 1) {
        const offset = (y * 256 + x) * 4;
        expect([data[offset], data[offset + 1], data[offset + 2]]).toEqual([
          255, 255, 255,
        ]);
        const r = Math.hypot(x + 0.5 - 128, y + 0.5 - 128) / 128;
        const ramp =
          r <= 0.35
            ? 1 - (0.5 * r) / 0.35
            : r >= 1
              ? 0
              : (0.5 * (1 - r)) / 0.65;
        expect(data[offset + 3]).toBe(Math.round(255 * ramp));
        maxAlpha = Math.max(maxAlpha, data[offset + 3]);
      }
    }
    expect(maxAlpha).toBe(253);
    expect(texture).toMatchObject({
      anisotropy: 8,
      colorSpace: SRGBColorSpace,
      generateMipmaps: true,
      magFilter: LinearFilter,
      minFilter: LinearMipmapLinearFilter,
    });
    expect(texture.version).toBeGreaterThan(0);
    expect(resources.plane).toBeInstanceOf(PlaneGeometry);
    expect(resources.plane.parameters).toMatchObject({ height: 1, width: 1 });
  });
});

describe('ContactShadowBinding', () => {
  it('adds a runtime-only blob under its parent that never takes pointer hits', () => {
    const resources = createGroundShadowResources();
    const parent = new Object3D();
    const binding = new ContactShadowBinding(parent, resources, BLOB);
    const { mesh } = binding;

    expect(mesh.parent).toBe(parent);
    expect(mesh.name).toBe('ContactShadow');
    expect(mesh.userData).toMatchObject({
      iwsdkContactShadow: true,
      iwsdkRuntimeOnly: true,
    });
    expect(mesh.geometry).toBe(resources.plane);
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
    expect(mesh.material).toMatchObject({
      depthWrite: false,
      map: resources.contactTexture,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      transparent: true,
    });
    expect(hitsFromAbove(parent)).toBe(0);
    // The same plane without the override is hit, so the ray does reach it.
    const control = new Mesh(resources.plane, new MeshBasicMaterial());
    control.rotation.x = -Math.PI / 2;
    expect(hitsFromAbove(control)).toBeGreaterThan(0);
  });

  it('maps size, lift, opacity and sRGB color onto the mesh', () => {
    const resources = createGroundShadowResources();
    const parent = new Object3D();
    const binding = new ContactShadowBinding(parent, resources, BLOB);

    binding.update({
      color: [1, 0.5, 0, 1],
      height: 0.01,
      opacity: 0.4,
      size: [2, 0.5],
    });

    expect(binding.mesh.scale.toArray()).toEqual([2, 0.5, 1]);
    expect(binding.mesh.position.y).toBe(0.01);
    expect(binding.mesh.material.opacity).toBe(0.4);
    expect(binding.mesh.material.color.getHexString()).toBe(
      new Color().setRGB(1, 0.5, 0, SRGBColorSpace).getHexString(),
    );
    // Width runs along the parent's X and depth along its Z.
    parent.updateMatrixWorld(true);
    const corner = new Vector3(0.5, 0.5, 0).applyMatrix4(
      binding.mesh.matrixWorld,
    );
    expect(corner.x).toBeCloseTo(1);
    expect(corner.z).toBeCloseTo(-0.25);

    binding.update({ ...BLOB, size: [0, -1] });
    expect(binding.mesh.scale.toArray()).toEqual([1e-4, 1e-4, 1]);
  });

  it('turns shadow flags back off after a traverse turns them on', () => {
    const resources = createGroundShadowResources();
    const parent = new Object3D();
    const binding = new ContactShadowBinding(parent, resources, BLOB);
    parent.traverse((object) => {
      object.castShadow = true;
      object.receiveShadow = true;
    });

    binding.update(BLOB);

    expect(binding.mesh.castShadow).toBe(false);
    expect(binding.mesh.receiveShadow).toBe(false);
  });

  it('disposes its material on removal but not the shared plane or texture', () => {
    const resources = createGroundShadowResources();
    const parent = new Object3D();
    const binding = new ContactShadowBinding(parent, resources, BLOB);
    const material = vi.fn();
    const plane = vi.fn();
    const texture = vi.fn();
    binding.mesh.material.addEventListener('dispose', material);
    resources.plane.addEventListener('dispose', plane);
    resources.contactTexture.addEventListener('dispose', texture);

    binding.dispose();
    binding.dispose();

    expect(binding.mesh.parent).toBeNull();
    expect(parent.children).toEqual([]);
    expect(material).toHaveBeenCalledTimes(1);
    expect(plane).not.toHaveBeenCalled();
    expect(texture).not.toHaveBeenCalled();
    expect(() => binding.update(BLOB)).toThrow(/disposed/);
  });
});

describe('ShadowCatcherBinding', () => {
  it('adds a runtime-only shadow-only plane that receives shadows', () => {
    const resources = createGroundShadowResources();
    const parent = new Object3D();
    const binding = new ShadowCatcherBinding(parent, resources, {
      color: [0.2, 0.1, 0, 1],
      opacity: 0.3,
      size: [4, 3],
    });
    const { mesh } = binding;

    expect(mesh.parent).toBe(parent);
    expect(mesh.name).toBe('ShadowCatcher');
    expect(mesh.userData).toMatchObject({
      iwsdkRuntimeOnly: true,
      iwsdkShadowCatcher: true,
    });
    expect(mesh.geometry).toBe(resources.plane);
    expect(mesh.material).toBeInstanceOf(ShadowMaterial);
    expect(mesh.material.opacity).toBe(0.3);
    expect(mesh.material.color.getHexString()).toBe(
      new Color().setRGB(0.2, 0.1, 0, SRGBColorSpace).getHexString(),
    );
    expect(mesh.scale.toArray()).toEqual([4, 3, 1]);
    expect(mesh.position.y).toBe(0);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(true);
    expect(hitsFromAbove(parent)).toBe(0);

    mesh.castShadow = true;
    mesh.receiveShadow = false;
    binding.update({ color: [0, 0, 0, 1], opacity: 0.25, size: [6, 6] });
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(true);

    const material = vi.fn();
    mesh.material.addEventListener('dispose', material);
    binding.dispose();
    expect(mesh.parent).toBeNull();
    expect(material).toHaveBeenCalledTimes(1);
  });
});

describe('groundShadowSpecFromComponentValue', () => {
  it('fills omitted fields from the component defaults', () => {
    expect(
      groundShadowSpecFromComponentValue('com.iwsdk.components.ContactShadow', {
        size: [1.2, 0.8],
      }),
    ).toEqual({
      kind: 'contact-shadow',
      spec: {
        color: [0.3765, 0.3922, 0.4549, 1],
        height: 0.002,
        opacity: 0.72,
        size: [1.2, 0.8],
      },
    });
    expect(
      groundShadowSpecFromComponentValue('ShadowCatcher', { opacity: 0.4 }),
    ).toEqual({
      kind: 'shadow-catcher',
      spec: { color: [0, 0, 0, 1], opacity: 0.4, size: [6, 6] },
    });
    expect(
      groundShadowSpecFromComponentValue('DirectionalLight', {}),
    ).toBeUndefined();
  });
});

describe('GroundShadowSystem', () => {
  it('builds, updates and removes ground shadows for node entities', () => {
    const world = createGroundShadowWorld();
    const plinth = world.createTransformEntity(undefined, {
      parent: world.sceneEntity,
    });
    plinth.addComponent(ContactShadow, { size: [1.2, 0.9] });
    const blob = plinth.object3D!.children.find(
      (child) => child.userData.iwsdkContactShadow === true,
    ) as Mesh<PlaneGeometry, MeshBasicMaterial>;

    expect(blob).toBeDefined();
    expect(blob.scale.toArray()).toEqual([
      expect.closeTo(1.2, 6),
      expect.closeTo(0.9, 6),
      1,
    ]);
    expect(blob.material.opacity).toBeCloseTo(0.72, 6);

    plinth.setValue(ContactShadow, 'opacity', 0.5);
    plinth.getVectorView(ContactShadow, 'size').set([2, 3]);
    blob.castShadow = true;
    world.update(0, 0);
    expect(blob.material.opacity).toBeCloseTo(0.5, 6);
    expect(blob.scale.toArray()).toEqual([2, 3, 1]);
    expect(blob.castShadow).toBe(false);

    const floor = world.createTransformEntity(undefined, {
      parent: world.sceneEntity,
    });
    floor.addComponent(ShadowCatcher);
    const catcher = floor.object3D!.children.find(
      (child) => child.userData.iwsdkShadowCatcher === true,
    ) as Mesh<PlaneGeometry, ShadowMaterial>;
    expect(catcher.receiveShadow).toBe(true);
    expect(catcher.geometry).toBe(blob.geometry);

    const blobMaterial = vi.fn();
    blob.material.addEventListener('dispose', blobMaterial);
    plinth.removeComponent(ContactShadow);
    expect(blob.parent).toBeNull();
    expect(blobMaterial).toHaveBeenCalledTimes(1);
    world.update(0, 0);

    const catcherMaterial = vi.fn();
    catcher.material.addEventListener('dispose', catcherMaterial);
    floor.destroy();
    expect(catcher.parent).toBeNull();
    expect(catcherMaterial).toHaveBeenCalledTimes(1);
  });

  it('creates the shared resources with the first binding', () => {
    const world = createGroundShadowWorld();
    const system = world.getSystem(GroundShadowSystem)! as any;
    world.update(0, 0);
    expect(system.resources).toBeUndefined();

    world
      .createTransformEntity(undefined, { parent: world.sceneEntity })
      .addComponent(ShadowCatcher);

    expect(system.resources).toBeDefined();
  });

  it('leaves ground-shadow resources to the system when a node is disposed', () => {
    const world = createGroundShadowWorld();
    const plinth = world.createTransformEntity(
      new Mesh(new BoxGeometry(), new MeshBasicMaterial()),
      { parent: world.sceneEntity },
    );
    plinth.addComponent(ContactShadow);
    const contact = world.createTransformEntity(undefined, { parent: plinth });
    contact.addComponent(ContactShadow);
    const [plinthBlob, contactBlob] = [plinth, contact].map(
      (entity) =>
        entity.object3D!.children.find(
          (child) => child.userData.iwsdkContactShadow === true,
        ) as Mesh<PlaneGeometry, MeshBasicMaterial>,
    );
    const plane = vi.fn();
    const texture = vi.fn();
    const plinthMaterial = vi.fn();
    const contactMaterial = vi.fn();
    plinthBlob.geometry.addEventListener('dispose', plane);
    plinthBlob.material.map!.addEventListener('dispose', texture);
    plinthBlob.material.addEventListener('dispose', plinthMaterial);
    contactBlob.material.addEventListener('dispose', contactMaterial);

    plinth.dispose();

    expect(plane).not.toHaveBeenCalled();
    expect(texture).not.toHaveBeenCalled();
    // The plinth's binding frees its own material; the child node still lives.
    expect(plinthMaterial).toHaveBeenCalledTimes(1);
    expect(contactMaterial).not.toHaveBeenCalled();
    contact.destroy();
    expect(contactMaterial).toHaveBeenCalledTimes(1);
  });

  it('disposes its bindings and shared resources on cleanup', () => {
    const world = createGroundShadowWorld();
    const entity = world.createTransformEntity(undefined, {
      parent: world.sceneEntity,
    });
    entity.addComponent(ContactShadow);
    const blob = entity.object3D!.children[0] as Mesh<
      PlaneGeometry,
      MeshBasicMaterial
    >;
    const plane = vi.fn();
    const texture = vi.fn();
    blob.geometry.addEventListener('dispose', plane);
    blob.material.map!.addEventListener('dispose', texture);

    world.unregisterSystem(GroundShadowSystem);

    expect(blob.parent).toBeNull();
    expect(plane).toHaveBeenCalledTimes(1);
    expect(texture).toHaveBeenCalledTimes(1);
  });
});
