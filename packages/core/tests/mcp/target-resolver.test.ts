/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheManager } from '../../src/asset/cache-manager.js';
import { SceneTargetResolver } from '../../src/mcp/target-resolver.js';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
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
    const panels = [];
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
