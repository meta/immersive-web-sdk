/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Container } from '@pmndrs/uikit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheManager } from '../../src/asset/cache-manager.js';
import { SceneTargetResolver } from '../../src/mcp/target-resolver.js';
import {
  Box3,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from '../../src/runtime/index.js';
import { loadUIKitMLAsset } from '../../src/ui/uikitml.js';

const PANEL_SOURCE = `
<style>.action {}</style>
<Panel id="panel-root">
  <Button id="save-button" class="action">Save</Button>
  <Button id="cancel-button" class="action" style="display: none">Cancel</Button>
</Panel>
`;

interface FakeEntity {
  active: boolean;
  index: number;
  object3D: Object3D;
  getComponents(): Array<{ id: string }>;
}

function createWorld() {
  const scene = new Scene();
  const player = new Group();
  const camera = new PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  player.add(camera);
  scene.add(player);
  const entities: FakeEntity[] = [];
  const world = {
    scene,
    player,
    camera,
    entityManager: {
      getEntityByIndex: (index: number) => entities[index] ?? null,
    },
  };
  /** Adds an entity whose Object3D is `object`, with these component ids. */
  const addEntity = (
    object: Object3D,
    components: string[],
    parent: Object3D = scene,
  ) => {
    const entity: FakeEntity = {
      active: true,
      index: entities.length,
      object3D: object,
      getComponents: () => components.map((id) => ({ id })),
    };
    entities.push(entity);
    object.entityIdx = entity.index;
    parent.add(object);
    return entity;
  };
  return {
    addEntity,
    player,
    resolver: new SceneTargetResolver(world as any),
    scene,
  };
}

function box(
  name: string,
  position: [number, number, number],
  size: [number, number, number],
): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(...position);
  return mesh;
}

function expectVector(
  actual: { x: number; y: number; z: number },
  expected: [number, number, number],
) {
  expect(actual.x).toBeCloseTo(expected[0], 5);
  expect(actual.y).toBeCloseTo(expected[1], 5);
  expect(actual.z).toBeCloseTo(expected[2], 5);
}

const SHOULDER = { x: 0, y: 1.4, z: 0 };
const DEG = Math.PI / 180;
/** One UIKit pixel of a panel from `addPanel`, in metres. */
const PX = 0.002;
const vec = ({ x, y, z }: { x: number; y: number; z: number }) =>
  new Vector3(x, y, z);
const ICON_BUTTON = (id: string, style = '') =>
  `<Button id="${id}" style="${style}"><ButtonIcon><LogIn></LogIn></ButtonIcon><ButtonLabel>${id}</ButtonLabel></Button>`;
/** `count` rows 50px (10 cm) tall, `row-0` and on. */
const ROWS = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      `<div id="row-${index}" style="height: 50px; flex-shrink: 0"></div>`,
  ).join('');

/** Adds a laid-out UIKitML panel entity at (0, 1.5, -1.2), 1px = PX. */
async function addPanel(
  addEntity: ReturnType<typeof createWorld>['addEntity'],
  name: string,
  source: string,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(source, { status: 200 })),
  );
  const panel = await loadUIKitMLAsset(`/ui/${name}.uikitml`);
  panel.name = name;
  panel.position.set(0, 1.5, -1.2);
  panel.scale.setScalar(0.2);
  addEntity(panel, ['PokeInteractable']);
  const root = panel.document.rootElement;
  await vi.waitFor(() => {
    root.update(0.016);
    expect(root.size.value).toBeDefined();
  });
  return panel;
}

afterEach(() => {
  CacheManager.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SceneTargetResolver', () => {
  it('lists the shown interactable entities with their boxes', () => {
    const { addEntity, resolver, scene } = createWorld();
    addEntity(box('Map Pin 1', [0.3, 1, -0.5], [0.1, 0.1, 0.1]), [
      'OneHandGrabbable',
      'RayInteractable',
    ]);
    addEntity(box('Table', [0, 0.4, -0.6], [1, 0.8, 0.6]), []);
    const hidden = box('Hidden Pin', [0, 1, -1], [0.1, 0.1, 0.1]);
    hidden.visible = false;
    addEntity(hidden, ['OneHandGrabbable']);
    scene.add(box('Loose Mesh', [0, 1, -1], [0.1, 0.1, 0.1]));

    const targets = resolver.list();

    expect(targets.map((target) => target.name)).toEqual(['Map Pin 1']);
    expectVector(targets[0].position, [0.3, 1, -0.5]);
    expectVector(targets[0].size, [0.1, 0.1, 0.1]);
  });

  it('reads three bounds only, not the signals UIKit icons call boundingBox', () => {
    const { addEntity, resolver } = createWorld();
    const panel = box('Panel', [0, 1.5, -1], [0.4, 0.3, 0.01]);
    const icon = box('', [0, 0, 0.01], [0.05, 0.05, 0.001]);
    Object.assign(icon, { boundingBox: { value: undefined } });
    panel.add(icon);
    addEntity(panel, ['PokeInteractable']);

    const [target] = resolver.list();

    expect(target.name).toBe('Panel');
    expectVector(target.size, [0.4, 0.3, 0.0155]);
  });

  it('presses the face toward the shoulder, grasps the middle and places on top', () => {
    const { addEntity, resolver } = createWorld();
    addEntity(box('Map Pin 1', [0.3, 1, -0.5], [0.1, 0.1, 0.1]), [
      'OneHandGrabbable',
    ]);
    const at = (target: Parameters<typeof resolver.resolve>[0], intent: any) =>
      resolver.resolve(target, { intent, from: SHOULDER })!;

    const press = at('Map Pin 1', 'press');
    expectVector(press.position, [0.3, 1, -0.45]);
    expectVector(press.normal, [0, 0, 1]);
    expectVector(press.box.min, [0.25, 0.95, -0.55]);
    expectVector(press.box.max, [0.35, 1.05, -0.45]);
    expect(press.name).toBe('Map Pin 1');

    const grasp = at('Map Pin 1', 'grasp');
    expectVector(grasp.position, [0.3, 1, -0.5]);
    expectVector(grasp.normal, [0, 0, 1]);

    const place = at('Map Pin 1', 'place');
    expectVector(place.position, [0.3, 1.05, -0.5]);
    expectVector(place.normal, [0, 1, 0]);

    // Faces are named as seen from the shoulder.
    for (const [face, position, normal] of [
      ['left', [0.25, 1, -0.5], [-1, 0, 0]],
      ['right', [0.35, 1, -0.5], [1, 0, 0]],
      ['back', [0.3, 1, -0.55], [0, 0, -1]],
      ['bottom', [0.3, 0.95, -0.5], [0, -1, 0]],
    ] as const) {
      const resolved = at({ name: 'Map Pin 1', face }, 'touch');
      expectVector(resolved.position, position as [number, number, number]);
      expectVector(resolved.normal, normal as [number, number, number]);
    }
  });

  it('answers to scene node ids, uuids and other named scene objects', () => {
    const { addEntity, resolver } = createWorld();
    const pin = box('Map Pin 1', [0.3, 1, -0.5], [0.1, 0.1, 0.1]);
    pin.userData.iwsdkSceneNodeId = 'pin-1';
    addEntity(pin, ['OneHandGrabbable']);
    addEntity(box('Table', [0, 0.4, -0.6], [1, 0.8, 0.6]), []);

    expect(resolver.resolve('pin-1', { from: SHOULDER })?.name).toBe(
      'Map Pin 1',
    );
    expect(resolver.resolve(pin.uuid, { from: SHOULDER })?.name).toBe(
      'Map Pin 1',
    );
    const table = resolver.resolve('Table', {
      intent: 'place',
      from: SHOULDER,
    })!;
    expectVector(table.position, [0, 0.8, -0.6]);
    expectVector(table.normal, [0, 1, 0]);
    expect(resolver.resolve('Map Pin 9', { from: SHOULDER })).toBeNull();
  });

  it('measures everything from the XR origin, not the world', () => {
    const { addEntity, player, resolver } = createWorld();
    player.position.set(1, 0, 2);
    player.rotation.y = Math.PI / 2;
    addEntity(box('Pawn', [1, 1, 1], [0.2, 0.1, 0.4]), ['OneHandGrabbable']);

    const [pawn] = resolver.list();
    expectVector(pawn.position, [1, 1, 0]);
    expectVector(pawn.size, [0.4, 0.1, 0.2]);

    // Without a shoulder, "front" faces the headset (at the origin).
    const press = resolver.resolve('Pawn', { intent: 'press' })!;
    expectVector(press.normal, [-1, 0, 0]);
    expectVector(press.position, [0.8, 1, 0]);
  });

  it('presses a turned target on its own face, not on its axis-aligned box', () => {
    const { addEntity, resolver, scene } = createWorld();
    // A row of keys turned 25 degrees: a key's axis-aligned box is wider than
    // the key, and its front face lies in front of the neighbouring key.
    const row = new Group();
    row.position.set(0, 0.9, -0.45);
    row.rotation.y = (25 * Math.PI) / 180;
    scene.add(row);
    const keys = [0, 1, 2].map(
      (index) =>
        addEntity(
          box(
            `Key ${index}`,
            [(index - 1) * 0.048, -0.011, 0],
            [0.045, 0.022, 0.16],
          ),
          ['PokeInteractable'],
          row,
        ).object3D,
    );

    const press = resolver.resolve('Key 2', {
      intent: 'press',
      from: SHOULDER,
    })!;

    const { x, y, z } = press.position;
    expectVector(keys[2].worldToLocal(new Vector3(x, y, z)), [0, 0, 0.08]);
    expectVector(press.normal, [
      Math.sin((25 * Math.PI) / 180),
      0,
      Math.cos((25 * Math.PI) / 180),
    ]);
    // The reported size and box stay the axis-aligned ones.
    const [cos, sin] = [Math.cos(25 * DEG), Math.sin(25 * DEG)];
    const size: [number, number, number] = [
      0.045 * cos + 0.16 * sin,
      0.022,
      0.045 * sin + 0.16 * cos,
    ];
    const center = keys[2].getWorldPosition(new Vector3());
    expectVector(press.size, size);
    expectVector(
      press.box.min,
      center
        .clone()
        .addScaledVector(new Vector3(...size), -0.5)
        .toArray(),
    );
    expectVector(
      press.box.max,
      center
        .clone()
        .addScaledVector(new Vector3(...size), 0.5)
        .toArray(),
    );
    // Placing still uses the face that points up.
    const place = resolver.resolve('Key 2', {
      intent: 'place',
      from: SHOULDER,
    })!;
    expectVector(place.normal, [0, 1, 0]);
    expect(place.position.y).toBeCloseTo(0.9, 5);

    // A key scaled to nothing, or so nearly that inverting its matrix
    // overflows, is pressed where it is, with a unit normal.
    for (const scale of [0, 1e-105]) {
      keys[0].scale.setScalar(scale);
      const { position, normal } = resolver.resolve('Key 0', {
        intent: 'press',
        from: SHOULDER,
      })!;
      expectVector(position, keys[0].getWorldPosition(new Vector3()).toArray());
      expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 5);
    }
  });

  it('presses on the axis-aligned box when it is tighter than the own one', () => {
    const { addEntity, resolver } = createWorld();
    // An entity turned 25 degrees whose key mesh is turned back: the key is
    // square to the room, and the box along the entity's axes is the loose one.
    const holder = new Group();
    holder.name = 'Key';
    holder.position.set(0, 0.9, -0.45);
    holder.rotation.y = 25 * DEG;
    const key = box('', [0, -0.011, 0], [0.045, 0.022, 0.16]);
    key.rotation.y = -25 * DEG;
    holder.add(key);
    addEntity(holder, ['PokeInteractable']);
    // Unturned targets keep the faces of their (identical) axis-aligned box.
    addEntity(box('Plain Key', [0.2, 0.889, -0.45], [0.045, 0.022, 0.16]), [
      'PokeInteractable',
    ]);
    const at = (name: string, intent: 'press' | 'place' | 'grasp') =>
      resolver.resolve(name, { intent, from: SHOULDER })!;

    const press = at('Key', 'press');
    expectVector(press.position, [0, 0.889, -0.37]);
    expectVector(press.normal, [0, 0, 1]);

    for (const [intent, position, normal] of [
      ['press', [0.2, 0.889, -0.37], [0, 0, 1]],
      ['place', [0.2, 0.9, -0.45], [0, 1, 0]],
      ['grasp', [0.2, 0.889, -0.45], [0, 0, 1]],
    ] as const) {
      const plain = at('Plain Key', intent);
      expectVector(plain.position, position as [number, number, number]);
      expectVector(plain.normal, normal as [number, number, number]);
    }
  });

  it('keeps the press point of an L-shaped target on its reported box', () => {
    const { addEntity, resolver } = createWorld();
    // Two bars meeting at a corner, turned so the open side of the L faces
    // the body: the face of its own box on that side is in the air, 7 cm in
    // front of its axis-aligned box.
    const corner = new Group();
    corner.name = 'Corner';
    corner.position.set(0, 1, -0.6);
    corner.rotation.y = -45 * DEG;
    corner.add(
      box('', [0.125, 0, 0], [0.3, 0.05, 0.05]),
      box('', [0, 0, 0.125], [0.05, 0.05, 0.3]),
    );
    addEntity(corner, ['PokeInteractable']);

    const press = resolver.resolve('Corner', {
      intent: 'press',
      from: SHOULDER,
    })!;

    expect(
      new Box3(vec(press.box.min), vec(press.box.max))
        .expandByScalar(1e-6)
        .containsPoint(vec(press.position)),
    ).toBe(true);
    expectVector(press.position, [0, 1, -0.6 + 0.3 * Math.SQRT1_2]);
    expectVector(press.normal, [0, 0, 1]);
  });

  it('places on a tilted top face straight down, onto its middle', () => {
    const { addEntity, resolver } = createWorld();
    const slab = (name: string, x: number, tiltDegrees: number) => {
      const mesh = box(name, [x, 0.8, -0.6], [0.4, 0.04, 0.3]);
      mesh.rotation.x = tiltDegrees * DEG;
      addEntity(mesh, ['RayInteractable']);
      return mesh;
    };
    const topOf = (mesh: Mesh) =>
      mesh.localToWorld(new Vector3(0, 0.02, 0)).toArray();

    // IWER lowers a held object along the normal by its grasp height, so at
    // every tilt (and on either side of 10 degrees alike) it comes straight
    // down onto the middle of the face.
    const slabs = [5, 9.999, 10.001, 30].map((tilt, index) =>
      slab(`Slab ${tilt}`, index * 0.5 - 0.75, tilt),
    );
    for (const mesh of slabs) {
      const place = resolver.resolve(mesh.name, {
        intent: 'place',
        from: SHOULDER,
      })!;
      expectVector(place.normal, [0, 1, 0]);
      expectVector(place.position, topOf(mesh));
    }
    // Pressing a tilted top face still goes in square to it.
    const press = resolver.resolve(
      { name: 'Slab 30', face: 'top' },
      { intent: 'press', from: SHOULDER },
    )!;
    expectVector(press.normal, [0, Math.cos(30 * DEG), Math.sin(30 * DEG)]);
    expectVector(press.position, topOf(slabs[3]));
  });

  it('presses stretched and mirrored targets on their own faces', () => {
    const { addEntity, resolver } = createWorld();
    const cabinet = box('Cabinet', [0.1, 1, -0.6], [1, 1, 1]);
    cabinet.scale.set(0.3, 0.2, -0.1);
    cabinet.rotation.y = 30 * DEG;
    addEntity(cabinet, ['PokeInteractable']);

    const press = resolver.resolve('Cabinet', {
      intent: 'press',
      from: SHOULDER,
    })!;

    // The middle of the face toward the shoulder, which the mirrored z axis
    // puts at local -z.
    expectVector(cabinet.worldToLocal(vec(press.position)), [0, 0, -0.5]);
    // Its outward unit normal: square to that face, toward the shoulder.
    const normal = vec(press.normal);
    expect(normal.length()).toBeCloseTo(1, 5);
    for (const column of [0, 1]) {
      expect(
        normal.dot(
          new Vector3().setFromMatrixColumn(cabinet.matrixWorld, column),
        ),
      ).toBeCloseTo(0, 5);
    }
    expect(
      normal.dot(vec(SHOULDER).sub(cabinet.getWorldPosition(new Vector3()))),
    ).toBeGreaterThan(0);
  });

  it('keeps nested entities out of a parent box and lists both', () => {
    const { addEntity, resolver } = createWorld();
    const earth = box('Earth', [0, 1, -1], [0.2, 0.2, 0.2]);
    addEntity(earth, ['DistanceGrabbable']);
    addEntity(
      box('Tower', [1, 0, 0], [0.1, 0.3, 0.1]),
      ['DistanceGrabbable'],
      earth,
    );

    const targets = resolver.list();

    expect(targets.map((target) => target.name)).toEqual(['Earth', 'Tower']);
    expectVector(targets[0].size, [0.2, 0.2, 0.2]);
    expectVector(targets[1].position, [1, 1, -1]);
  });

  it('leaves runtime-only meshes such as a contact shadow out of the box', () => {
    const { addEntity, resolver } = createWorld();
    const plinth = box('Plinth', [0, 0.1, -1], [0.6, 0.2, 0.6]);
    const blob = box('ContactShadow', [0, -0.098, 0], [1.2, 0.001, 1.2]);
    blob.userData.iwsdkRuntimeOnly = true;
    plinth.add(blob);
    addEntity(plinth, ['RayInteractable']);

    const [target] = resolver.list();

    expectVector(target.position, [0, 0.1, -1]);
    expectVector(target.size, [0.6, 0.2, 0.6]);
  });

  it('gives targets that share a name their own and rejects the shared one', () => {
    const { addEntity, resolver } = createWorld();
    for (const [id, x] of [
      ['pin-a', 0],
      ['pin-b', 0.2],
      [undefined, 0.4],
    ] as const) {
      const pin = box('Pin', [x, 1, -0.5], [0.05, 0.05, 0.05]);
      if (id) {
        pin.userData.iwsdkSceneNodeId = id;
      }
      addEntity(pin, ['OneHandGrabbable']);
    }

    expect(resolver.list().map((target) => target.name)).toEqual([
      'pin-a',
      'pin-b',
      'Pin#2',
    ]);
    expect(resolver.resolve('Pin', { from: SHOULDER })).toBeNull();
    expectVector(
      resolver.resolve('pin-b', { from: SHOULDER })!.box.min,
      [0.175, 0.975, -0.525],
    );
  });

  it('names the elements of same-named panels after each panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () => new Response(PANEL_SOURCE, { status: 200 }),
        ),
    );
    const { addEntity, resolver } = createWorld();
    const panels: Awaited<ReturnType<typeof loadUIKitMLAsset>>[] = [];
    for (const [nodeId, x] of [
      ['welcome-left', -0.5],
      [undefined, 0.5],
    ] as const) {
      const panel = await loadUIKitMLAsset('/ui/panel.uikitml');
      panel.name = 'Welcome Panel';
      if (nodeId) {
        panel.userData.iwsdkSceneNodeId = nodeId;
      }
      panel.position.set(x, 1.5, -1.2);
      panel.scale.setScalar(0.2);
      addEntity(panel, ['PokeInteractable']);
      panels.push(panel);
    }
    await vi.waitFor(() => {
      for (const panel of panels) {
        panel.document.rootElement.update(0.016);
        expect(
          panel.requireElementById('save-button').size.value,
        ).toBeDefined();
      }
    });

    expect(resolver.list().map((target) => target.name)).toEqual([
      'welcome-left',
      'welcome-left/panel-root',
      'welcome-left/save-button',
      'Welcome Panel#1',
      'Welcome Panel#1/panel-root',
      'Welcome Panel#1/save-button',
    ]);
    const at = (name: string) =>
      resolver.resolve(name, { intent: 'press', from: SHOULDER })!.position.x;
    expect(at('welcome-left/save-button')).toBeLessThan(0);
    expect(at('Welcome Panel#1/save-button')).toBeGreaterThan(0);
    expect(resolver.resolve('save-button', { from: SHOULDER })).toBeNull();

    for (const panel of panels) {
      panel.dispose();
    }
  });

  it('numbers an id used twice in one panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          `<Panel id="toolbar">
            <Button id="tool">Draw</Button>
            <Button id="tool">Erase</Button>
          </Panel>`,
          { status: 200 },
        ),
      ),
    );
    const { addEntity, resolver } = createWorld();
    const panel = await loadUIKitMLAsset('/ui/toolbar.uikitml');
    panel.name = 'Toolbar';
    panel.position.set(0, 1.5, -1.2);
    panel.scale.setScalar(0.2);
    addEntity(panel, ['PokeInteractable']);
    await vi.waitFor(() => {
      panel.document.rootElement.update(0.016);
      expect(resolver.list()[2]?.size.x).toBeGreaterThan(0);
    });

    const targets = resolver.list();
    expect(targets.map((target) => target.name)).toEqual([
      'Toolbar',
      'toolbar',
      'Toolbar/tool',
      'Toolbar/tool#2',
    ]);
    expect(targets[2].position.x).not.toBeCloseTo(targets[3].position.x, 3);
    expect(resolver.resolve('tool', { from: SHOULDER })).toBeNull();
    expect(
      resolver.resolve('Toolbar/tool#2', { from: SHOULDER })!.position.x,
    ).toBeCloseTo(targets[3].position.x, 5);

    panel.dispose();
  });

  it('warns once when the scene is too large to list every target', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { addEntity, resolver, scene } = createWorld();
    for (let index = 0; index < 20_000; index += 1) {
      scene.add(new Object3D());
    }
    addEntity(box('Map Pin 1', [0.3, 1, -0.5], [0.1, 0.1, 0.1]), [
      'OneHandGrabbable',
    ]);

    expect(resolver.list()).toEqual([]);
    resolver.list();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('may be missing');
    // A step can still name it.
    expect(resolver.resolve('Map Pin 1', { from: SHOULDER })?.name).toBe(
      'Map Pin 1',
    );
  });

  it('measures UIKit components where they are laid out, not at the origin', async () => {
    // The stock welcome panel: a button with an icon draws, so it counts.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          `<Panel id="panel-root">
            <Button id="exit-button"><ButtonIcon><LogIn></LogIn></ButtonIcon><ButtonLabel>Exit</ButtonLabel></Button>
          </Panel>`,
          { status: 200 },
        ),
      ),
    );
    const { addEntity, resolver } = createWorld();
    const panel = await loadUIKitMLAsset('/ui/welcome.uikitml');
    panel.name = 'Welcome Panel';
    panel.position.set(0, 1.5, -1.2);
    panel.scale.setScalar(0.2);
    addEntity(panel, ['RayInteractable']);
    const button = panel.requireElementById('exit-button');
    await vi.waitFor(() => {
      panel.document.rootElement.update(0.016);
      expect(button.size.value).toBeDefined();
    });
    // No pointer has cast against the button, so UIKit has not computed its
    // matrixWorld: it is still the identity.
    expect(button.matrixWorld.equals(new Matrix4())).toBe(true);

    const { box: panelBox, size } = resolver.resolve('Welcome Panel', {
      from: SHOULDER,
    })!;
    expect(size.z).toBeCloseTo(0, 5);
    expect(panelBox.min.z).toBeCloseTo(-1.2, 5);
    expect(panelBox.min.y).toBeGreaterThan(1.4);
    expect(panelBox.max.y).toBeLessThan(1.6);
    const buttonBox = resolver.resolve('exit-button', { from: SHOULDER })!.box;
    for (const axis of ['x', 'y'] as const) {
      expect(buttonBox.min[axis]).toBeGreaterThanOrEqual(
        panelBox.min[axis] - 1e-6,
      );
      expect(buttonBox.max[axis]).toBeLessThanOrEqual(
        panelBox.max[axis] + 1e-6,
      );
    }

    panel.dispose();
  });

  it('cuts UIKit content scrolled out of view out of the boxes', async () => {
    // A 0.6 x 0.4 m list of 30 icon buttons, 44px tall with 4px gaps: rows
    // 0-3 show, row 4 shows its top 8px, the rest are scrolled out of view.
    // Their buttons draw (UIKit keeps them `visible`) only inside the list.
    const world = createWorld();
    const rows = Array.from({ length: 30 }, (_, index) =>
      ICON_BUTTON(`item-${index}`),
    ).join('');
    const panel = await addPanel(
      world.addEntity,
      'List',
      `<Panel style="width: 300px; height: 200px; overflow: scroll; flex-direction: column; gap: 4px">${rows}</Panel>`,
    );
    const { resolver } = world;
    const expectListBox = () => {
      const { box } = resolver.resolve('List', { from: SHOULDER })!;
      expectVector(box.min, [-0.3, 1.3, -1.2]);
      expectVector(box.max, [0.3, 1.7, -1.2]);
    };

    expectListBox();
    // The partly shown row is pressed on the part that shows.
    const row = resolver.resolve('item-4', {
      intent: 'press',
      from: SHOULDER,
    })!;
    expectVector(row.box.min, [-0.3, 1.3, -1.2]);
    expectVector(row.box.max, [0.3, 1.7 - 192 * PX, -1.2]);
    expectVector(row.position, [0, 1.7 - 196 * PX, -1.2]);
    expect(resolver.list().map((target) => target.name)).not.toContain(
      'item-5',
    );

    // Scrolled to the middle (rows 12-16 show), rows above the view are cut
    // off as well.
    (panel.document.rootElement as Container).scrollPosition.value = [0, 600];
    expectListBox();
    expect(
      resolver.list().filter((target) => target.name.startsWith('item-')),
    ).toHaveLength(5);

    panel.dispose();
  });

  it('leaves out a row that only touches the edge of its list', async () => {
    // UIKit draws the row after a list that ends between rows, though none
    // of it shows; its box was the list's edge, where a press clicked the
    // row before it. Horizon icon buttons, 44px with 4px gaps, in a list four
    // of them tall, and 50px rows in a list 200px tall:
    const world = createWorld();
    const icons = await addPanel(
      world.addEntity,
      'Icons',
      `<Panel style="width: 300px; height: 192px; overflow: scroll; flex-direction: column; gap: 4px">${Array.from(
        { length: 8 },
        (_, index) => ICON_BUTTON(`icon-${index}`),
      ).join('')}</Panel>`,
    );
    const rows = await addPanel(
      world.addEntity,
      'Rows',
      `<Panel style="width: 300px; height: 200px; overflow: scroll; flex-direction: column">${ROWS(8)}</Panel>`,
    );
    const { resolver } = world;
    const press = (name: string) =>
      resolver.resolve(name, { intent: 'press', from: SHOULDER });

    const names = resolver.list().map((target) => target.name);
    for (const kind of ['icon', 'row']) {
      expect(names.filter((name) => name.startsWith(`${kind}-`))).toEqual(
        [0, 1, 2, 3].map((index) => `${kind}-${index}`),
      );
      expect(press(`${kind}-4`)).toBeNull();
    }
    // The last rows that show are pressed on their own middles.
    expectVector(press('icon-3')!.position, [0, 1.692 - 166 * PX, -1.2]);
    expectVector(press('row-3')!.position, [0, 1.7 - 175 * PX, -1.2]);
    expectVector(press('row-3')!.size, [0.6, 50 * PX, 0]);

    icons.dispose();
    rows.dispose();
  });

  it('presses a row scrolled partly out of view while 1 cm of it shows', async () => {
    // 50px rows in a list 200px tall; 1 cm is 5px.
    const world = createWorld();
    const panel = await addPanel(
      world.addEntity,
      'Rows',
      `<Panel style="width: 300px; height: 200px; overflow: scroll; flex-direction: column">${ROWS(8)}</Panel>`,
    );
    const { resolver } = world;
    const list = panel.document.rootElement as Container;
    const listed = () =>
      resolver
        .list()
        .map((target) => target.name)
        .filter((name) => name.startsWith('row-'));
    const press = (name: string) =>
      resolver.resolve(name, { intent: 'press', from: SHOULDER });

    // Scrolled 4px, row 4 shows 8 mm; scrolled half a pixel, 1 mm. (Asked
    // first, its matrixWorld is still the identity UIKit leaves it at.)
    for (const scroll of [4, 0.5]) {
      list.scrollPosition.value = [0, scroll];
      expect(press('row-4')).toBeNull();
      expect(listed()).toEqual(['row-0', 'row-1', 'row-2', 'row-3']);
    }
    // Scrolled 6px, it shows 12 mm, and row 0 44px: each is pressed on the
    // middle of what shows.
    list.scrollPosition.value = [0, 6];
    expect(listed()).toEqual(['row-0', 'row-1', 'row-2', 'row-3', 'row-4']);
    expectVector(press('row-4')!.position, [0, 1.7 - 197 * PX, -1.2]);
    expectVector(press('row-4')!.size, [0.6, 6 * PX, 0]);
    expectVector(press('row-0')!.position, [0, 1.7 - 22 * PX, -1.2]);

    panel.dispose();
  });

  it('resolves a UIKit element by its uuid only while it is listed by its id', async () => {
    // 50px rows in a list 200px tall, with a footer under the list, where
    // the rows after the last one that shows are laid out. A hidden badge
    // is laid out beside the panel. The panel is 250px tall, so its top is
    // at y = 1.75 m.
    const world = createWorld();
    const panel = await addPanel(
      world.addEntity,
      'Inbox',
      `<Panel style="width: 300px; height: 250px; flex-direction: column">
        <div id="list" style="height: 200px; flex-shrink: 0; overflow: scroll; flex-direction: column">${ROWS(8)}</div>
        <div id="footer" style="height: 50px; flex-shrink: 0"></div>
        <div id="badge" style="visibility: hidden; position-type: absolute; position-left: 400px; width: 20px; height: 20px"></div>
      </Panel>`,
    );
    const { resolver } = world;
    const press = (name: string) =>
      resolver.resolve(name, { intent: 'press', from: SHOULDER });
    const uuid = (id: string) => panel.requireElementById(id).uuid;

    // A row that shows answers to its uuid as it does to its id.
    expectVector(press(uuid('row-3'))!.position, [0, 1.75 - 175 * PX, -1.2]);
    // Row 4 only touches the list's edge. The middle of where it is laid out
    // is the footer's, where a press on its uuid used to go.
    expectVector(press('footer')!.position, [0, 1.75 - 225 * PX, -1.2]);
    expect(press('row-4')).toBeNull();
    expect(press(uuid('row-4'))).toBeNull();
    // Scrolled 4px, 8 mm of row 4 shows, still under 1 cm; row 7 is wholly
    // out of view.
    (panel.requireElementById('list') as Container).scrollPosition.value = [
      0, 4,
    ];
    expect(press(uuid('row-4'))).toBeNull();
    expect(press(uuid('row-7'))).toBeNull();
    // Hidden, the badge is not pressed where it is laid out either.
    expect(press('badge')).toBeNull();
    expect(press(uuid('badge'))).toBeNull();

    panel.dispose();
  });

  it('measures what shows of a nested list along the turned panel', async () => {
    // A list 150px tall under a 100px header, in a panel 200px tall that
    // cuts it at 100px; the panel is turned and rolled, so even a sliver of
    // a row spans centimetres along every world axis. The header holds a
    // 4px (8 mm) tick.
    const world = createWorld();
    const panel = await addPanel(
      world.addEntity,
      'Inbox',
      `<Panel style="width: 300px; height: 200px; overflow: hidden; flex-direction: column">
        <div style="height: 100px; flex-shrink: 0"><div id="tick" style="width: 4px; height: 4px"></div></div>
        <div id="inbox" style="height: 150px; flex-shrink: 0; overflow: scroll; flex-direction: column">${ROWS(6)}</div>
      </Panel>`,
    );
    panel.rotation.set(-6 * DEG, 25 * DEG, 40 * DEG);
    const { resolver } = world;
    const list = panel.requireElementById('inbox') as Container;
    const listed = () =>
      resolver
        .list()
        .map((target) => target.name)
        .filter((name) => name.startsWith('row-'));
    const press = (name: string) =>
      resolver.resolve(name, { intent: 'press', from: SHOULDER });
    /** Where `name` is pressed, in px from the panel's top left corner. */
    const pressedAt = (name: string) => {
      const local = panel.worldToLocal(vec(press(name)!.position));
      expect(local.z).toBeCloseTo(0, 5);
      // The panel spans (-1.5, -1) to (1.5, 1) in its own space, 1px = 0.01.
      return [(local.x + 1.5) * 100, (1 - local.y) * 100];
    };
    const expectPx = (actual: number[], expected: [number, number]) => {
      expect(actual[0]).toBeCloseTo(expected[0], 3);
      expect(actual[1]).toBeCloseTo(expected[1], 3);
    };

    // Row 2 lies inside the list but only touches the panel's edge.
    expect(listed()).toEqual(['row-0', 'row-1']);
    expect(press('row-2')).toBeNull();
    expectPx(pressedAt('row-1'), [150, 175]);
    // Under 1 cm but not cut, the tick counts.
    expectPx(pressedAt('tick'), [2, 2]);

    // Scrolled 44px: row 0 shows 6px (12 mm) under the header, row 2 shows
    // 44px above the panel's edge.
    list.scrollPosition.value = [0, 44];
    expect(listed()).toEqual(['row-0', 'row-1', 'row-2']);
    expectPx(pressedAt('row-0'), [150, 103]);
    expectPx(pressedAt('row-2'), [150, 178]);

    // Scrolled 47px: row 0 shows 3px (6 mm).
    list.scrollPosition.value = [0, 47];
    expect(listed()).toEqual(['row-1', 'row-2']);
    expect(press('row-0')).toBeNull();

    panel.dispose();
  });

  it('leaves hidden UIKit content out of a panel box but not its shown children', async () => {
    // Both icon buttons draw (UIKit keeps them `visible`) only when shown: a
    // hidden tip beside the panel, and a hidden menu below it with one button
    // pinned visible.
    const world = createWorld();
    const panel = await addPanel(
      world.addEntity,
      'Card',
      `<Panel style="width: 300px; height: 200px">
        ${ICON_BUTTON('tip', 'visibility: hidden; position-type: absolute; position-left: 400px')}
        <div style="visibility: hidden; position-type: absolute; position-top: 400px; width: 300px; height: 150px; flex-direction: column">
          ${ICON_BUTTON('pinned', 'visibility: visible')}
        </div>
      </Panel>`,
    );
    const { resolver } = world;
    const pinned = panel.requireElementById('pinned');
    await vi.waitFor(() => {
      panel.document.rootElement.update(0.016);
      expect(pinned.size.value).toBeDefined();
    });
    const cardBox = () => resolver.resolve('Card', { from: SHOULDER })!.box;

    // The pinned button (44px at the menu's top) counts; the menu around it
    // (150px) and the tip do not.
    expectVector(cardBox().min, [-0.3, 1.7 - (400 + 44) * PX, -1.2]);
    expectVector(cardBox().max, [0.3, 1.7, -1.2]);
    expect(resolver.list().map((target) => target.name)).not.toContain('tip');

    // Shown, the tip counts.
    panel.requireElementById('tip').setProperties({ visibility: 'visible' });
    expect(cardBox().max.x).toBeGreaterThan(0.45);

    panel.dispose();
  });

  it('presses a turned UIKit panel, and its buttons, on the panel', async () => {
    const world = createWorld();
    const panel = await addPanel(
      world.addEntity,
      'Welcome Panel',
      `<Panel style="width: 300px; height: 200px; padding: 20px; flex-direction: column; justify-content: flex-end">${ICON_BUTTON('exit-button')}</Panel>`,
    );
    // Tilted back like the starter's welcome panel, and turned.
    panel.rotation.set(-6 * DEG, 25 * DEG, 0);
    panel.updateMatrixWorld(true);
    const { resolver } = world;
    const facing = new Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    const corners = [-1.5, 1.5].flatMap((x) =>
      [-1, 1].map((y) => panel.localToWorld(new Vector3(x, y, 0))),
    );
    const expectOnPanel = (point: { x: number; y: number; z: number }) => {
      const local = panel.worldToLocal(vec(point));
      expect(local.z).toBeCloseTo(0, 5);
      expect(Math.abs(local.x)).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(Math.abs(local.y)).toBeLessThanOrEqual(1 + 1e-6);
    };

    const press = resolver.resolve('Welcome Panel', {
      intent: 'press',
      from: SHOULDER,
    })!;
    expectOnPanel(press.position);
    expectVector(press.normal, facing.toArray());
    // Its reported box is the axis-aligned box of the turned panel.
    const aligned = new Box3().setFromPoints(corners);
    expectVector(press.box.min, aligned.min.toArray());
    expectVector(press.box.max, aligned.max.toArray());

    const button = resolver.resolve('exit-button', {
      intent: 'press',
      from: SHOULDER,
    })!;
    expectOnPanel(button.position);
    expect(panel.worldToLocal(vec(button.position)).y).toBeLessThan(0);
    expectVector(button.normal, facing.toArray());

    panel.dispose();
  });

  it('presses an identified UIKit element on the face toward the shoulder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(PANEL_SOURCE, { status: 200 })),
    );
    const { addEntity, resolver } = createWorld();
    const panel = await loadUIKitMLAsset('/ui/panel.uikitml');
    panel.name = 'Welcome Panel';
    panel.position.set(0, 1.5, -1.2);
    panel.scale.setScalar(0.2);
    addEntity(panel, ['PokeInteractable', 'RayInteractable']);
    const button = panel.requireElementById('save-button');
    await vi.waitFor(() => {
      panel.document.rootElement.update(0.016);
      expect(button.size.value).toBeDefined();
    });

    expect(resolver.list().map((target) => target.name)).toEqual([
      'Welcome Panel',
      'panel-root',
      'save-button',
    ]);
    const press = resolver.resolve('save-button', {
      intent: 'press',
      from: SHOULDER,
    })!;
    expectVector(press.normal, [0, 0, 1]);
    expect(press.position.z).toBeCloseTo(-1.2, 2);
    expect(press.size.x).toBeGreaterThan(0);
    expect(press.size.z).toBeCloseTo(0, 5);
    const panelBox = resolver.resolve('Welcome Panel', { from: SHOULDER })!.box;
    expect(press.position.x).toBeGreaterThan(panelBox.min.x);
    expect(press.position.x).toBeLessThan(panelBox.max.x);
    expect(press.position.y).toBeGreaterThan(panelBox.min.y);
    expect(press.position.y).toBeLessThan(panelBox.max.y);

    // Instanced panel and glyph meshes inside the UIKit tree do not count.
    const before = resolver.resolve('Welcome Panel', { from: SHOULDER })!.size;
    // UIKit attaches them internally; Component.add only takes components.
    const instanced = new Mesh(
      new BoxGeometry(10, 10, 10),
      new MeshBasicMaterial(),
    );
    instanced.parent = button;
    button.children.push(instanced);
    expectVector(resolver.resolve('Welcome Panel', { from: SHOULDER })!.size, [
      before.x,
      before.y,
      before.z,
    ]);

    const fromBehind = resolver.resolve('save-button', {
      intent: 'press',
      from: { x: 0, y: 1.4, z: -3 },
    })!;
    expectVector(fromBehind.normal, [0, 0, -1]);
    expect(
      resolver.resolve(
        { name: 'save-button', face: 'back' },
        { from: SHOULDER },
      )!.normal.z,
    ).toBeCloseTo(-1, 5);

    panel.dispose();
  });
});
