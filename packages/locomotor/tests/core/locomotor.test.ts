/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Locomotor } from '../../src/core/locomotor.js';
import { MessageType } from '../../src/types/message-types.js';

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  postedMessages: unknown[] = [];

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  terminate(): void {}
}

describe('Locomotor initialization', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes the configured initial position in worker mode', async () => {
    const initialPlayerPosition = new Vector3(4, 3, -2);
    const locomotor = new Locomotor({ initialPlayerPosition, useWorker: true });

    await locomotor.initialize();

    expect(locomotor.position).toEqual(initialPlayerPosition);
    expect(MockWorker.instances[0].postedMessages[0]).toEqual({
      type: MessageType.Init,
      payload: { initialPlayerPosition: [4, 3, -2] },
    });

    locomotor.update(1 / 60);

    expect(locomotor.position).toEqual(initialPlayerPosition);
  });

  it('exposes the configured initial position in inline mode', async () => {
    const initialPlayerPosition = new Vector3(-3, 5, 7);
    const locomotor = new Locomotor({
      initialPlayerPosition,
      useWorker: false,
    });

    await locomotor.initialize();
    locomotor.update(1 / 60);

    expect(locomotor.position).toEqual(initialPlayerPosition);
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('exposes teleports immediately while the worker catches up', async () => {
    const locomotor = new Locomotor({ useWorker: true });
    await locomotor.initialize();

    locomotor.teleport(new Vector3(7, 0, -4));

    expect(locomotor.position.toArray()).toEqual([7, 0, -4]);
    expect(
      Array.from(
        MockWorker.instances[0].postedMessages.at(-1) as ArrayLike<number>,
      ).slice(0, 4),
    ).toEqual([MessageType.Teleport, 7, 0, -4]);
    locomotor.update(1 / 60);
    expect(locomotor.position.toArray()).toEqual([7, 0, -4]);
  });

  it('forwards jump requests to the worker', async () => {
    const locomotor = new Locomotor({ useWorker: true });
    await locomotor.initialize();

    locomotor.jump();

    expect(MockWorker.instances[0].postedMessages.at(-1)).toEqual([
      MessageType.Jump,
    ]);
  });
});

interface AddEnvironmentPayload {
  positions: Float32Array;
  indices: ArrayLike<number>;
  worldMatrix: number[];
}

function floorGeometry(size: number): PlaneGeometry {
  return new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
}

function nonIndexedInterleavedFloor(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new InterleavedBufferAttribute(
      new InterleavedBuffer(
        new Float32Array([
          -1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0,
          1, 0, 1, 0, -1, 0, 1, 0, -1, 0, -1, 0, 1, 0,
        ]),
        6,
      ),
      3,
      0,
    ),
  );
  return geometry;
}

function scaledEnvironment(...meshes: Mesh[]): Group {
  const root = new Group().add(...meshes);
  root.position.set(1, 2, 3);
  root.rotation.set(0, Math.PI / 4, 0);
  root.scale.setScalar(2);
  return root;
}

// World-space triangle corners of every mesh under root, in traversal order.
function meshTriangleCorners(root: Object3D): number[] {
  root.updateMatrixWorld(true);
  const corners: number[] = [];
  const corner = new Vector3();
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const { index, attributes } = mesh.geometry;
    const count = index ? index.count : attributes.position.count;
    for (let i = 0; i < count; i++) {
      corner
        .fromBufferAttribute(attributes.position, index ? index.getX(i) : i)
        .applyMatrix4(mesh.matrixWorld);
      corners.push(corner.x, corner.y, corner.z);
    }
  });
  return corners;
}

// World-space triangle corners of the collision mesh sent to the worker.
function payloadTriangleCorners(payload: AddEnvironmentPayload): number[] {
  const worldMatrix = new Matrix4().fromArray(payload.worldMatrix);
  const corners: number[] = [];
  const corner = new Vector3();
  for (const i of Array.from(payload.indices)) {
    corner.fromArray(payload.positions, i * 3).applyMatrix4(worldMatrix);
    corners.push(corner.x, corner.y, corner.z);
  }
  return corners;
}

describe('Locomotor environment geometry', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function addWorkerEnvironment(
    root: Object3D,
  ): Promise<AddEnvironmentPayload> {
    const locomotor = new Locomotor({ useWorker: true });
    await locomotor.initialize();
    locomotor.addEnvironment(root);
    const message = MockWorker.instances[0].postedMessages.at(-1) as {
      type: MessageType;
      payload: AddEnvironmentPayload;
    };
    expect(message.type).toBe(MessageType.AddEnvironment);
    return message.payload;
  }

  it('grounds the player on a non-indexed floor', async () => {
    const locomotor = new Locomotor({
      initialPlayerPosition: new Vector3(),
      useWorker: false,
    });
    await locomotor.initialize();

    locomotor.addEnvironment(new Mesh(floorGeometry(20).toNonIndexed()));
    locomotor.update(1 / 60);

    expect(locomotor.isGrounded).toBe(true);
  });

  it('indexes non-indexed geometry without moving its triangles', async () => {
    const box = new Mesh(new BoxGeometry().toNonIndexed());
    box.position.set(0.5, 0.5, -1);
    box.rotation.set(0.3, 0, 0.2);
    const root = scaledEnvironment(
      new Mesh(floorGeometry(4).toNonIndexed()),
      box,
    );
    const expected = meshTriangleCorners(root);

    const payload = await addWorkerEnvironment(root);

    expect(payloadTriangleCorners(payload)).toEqual(
      expected.map((value) => expect.closeTo(value, 4)),
    );
  });

  it('merges indexed and non-indexed geometry', async () => {
    const box = new Mesh(new BoxGeometry());
    box.position.set(0.5, 0.5, -1);
    const root = scaledEnvironment(
      box,
      new Mesh(floorGeometry(4).toNonIndexed()),
    );
    const expected = meshTriangleCorners(root);

    const payload = await addWorkerEnvironment(root);

    expect(payloadTriangleCorners(payload)).toEqual(
      expected.map((value) => expect.closeTo(value, 4)),
    );
  });

  it('normalizes non-indexed interleaved geometry', async () => {
    const root = scaledEnvironment(
      new Mesh(nonIndexedInterleavedFloor()),
      new Mesh(floorGeometry(2)),
    );
    const expected = meshTriangleCorners(root);

    const payload = await addWorkerEnvironment(root);

    expect(payloadTriangleCorners(payload)).toEqual(
      expected.map((value) => expect.closeTo(value, 4)),
    );
  });

  it('keeps indexed interleaved geometry mergeable', async () => {
    // glTF buffer views with a byteStride load as interleaved attributes.
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new InterleavedBufferAttribute(
        new InterleavedBuffer(
          new Float32Array([
            -1, 0, 1, 0, 1, 0, 1, 0, 1, 0, -1, 0, -1, 0, -1, 0,
          ]),
          4,
        ),
        3,
        0,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const root = scaledEnvironment(
      new Mesh(geometry),
      new Mesh(floorGeometry(2)),
    );
    const expected = meshTriangleCorners(root);

    const payload = await addWorkerEnvironment(root);

    expect(payloadTriangleCorners(payload)).toEqual(
      expected.map((value) => expect.closeTo(value, 4)),
    );
  });

  it('ignores non-position attribute differences', async () => {
    const root = scaledEnvironment(
      new Mesh(floorGeometry(4)),
      new Mesh(new BoxGeometry().deleteAttribute('uv').toNonIndexed()),
    );
    const expected = meshTriangleCorners(root);

    const payload = await addWorkerEnvironment(root);

    expect(payloadTriangleCorners(payload)).toEqual(
      expected.map((value) => expect.closeTo(value, 4)),
    );
  });

  it('does not weld distinct nearby vertices', async () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([0, 0, 0, 0.00001, 0, 0, 0, 1, 0]),
        3,
      ),
    );

    const payload = await addWorkerEnvironment(new Mesh(geometry));

    expect(Array.from(payload.indices)).toEqual([0, 1, 2]);
    expect(payload.positions[3]).toBeCloseTo(0.00001, 8);
  });

  it('ignores empty meshes when usable geometry remains', async () => {
    const empty = new BufferGeometry();
    empty.setAttribute('position', new BufferAttribute(new Float32Array(), 3));
    const root = new Group().add(
      new Mesh(empty),
      new Mesh(floorGeometry(4).toNonIndexed()),
    );

    const payload = await addWorkerEnvironment(root);

    expect(payload.indices).toHaveLength(6);
  });

  it('ignores non-mesh nodes with geometry-like properties', async () => {
    const nonMesh = Object.assign(new Object3D(), {
      geometry: {
        getAttribute: () => {
          throw new Error('non-mesh geometry must not be inspected');
        },
      },
    });
    const root = new Group().add(
      nonMesh,
      new Mesh(floorGeometry(4).toNonIndexed()),
    );

    const payload = await addWorkerEnvironment(root);

    expect(payload.indices).toHaveLength(6);
  });

  it('ignores IWSDK runtime-only meshes such as shadow catchers', async () => {
    const floor = new Mesh(floorGeometry(4));
    const catcher = new Mesh(floorGeometry(6));
    catcher.userData.iwsdkRuntimeOnly = true;
    const root = scaledEnvironment(floor, catcher);
    const expected = meshTriangleCorners(scaledEnvironment(floor.clone()));

    const payload = await addWorkerEnvironment(root);

    expect(payloadTriangleCorners(payload)).toEqual(
      expected.map((value) => expect.closeTo(value, 4)),
    );
  });

  it('uses 32-bit indices when a sequential index exceeds 16 bits', async () => {
    const vertexCount = 65538;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(vertexCount * 3), 3),
    );

    const payload = await addWorkerEnvironment(new Mesh(geometry));

    expect(payload.indices).toBeInstanceOf(Uint32Array);
    expect(payload.indices[vertexCount - 1]).toBe(vertexCount - 1);
  });

  it('reports environments without mesh geometry clearly', async () => {
    const locomotor = new Locomotor({ useWorker: true });
    await locomotor.initialize();
    const emptyPositions = new BufferGeometry();
    emptyPositions.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(), 3),
    );
    const emptyIndices = floorGeometry(1);
    emptyIndices.setIndex([]);
    const root = new Group().add(
      new Object3D(),
      new Mesh(),
      new Mesh(emptyPositions),
      new Mesh(emptyIndices),
    );

    expect(() => locomotor.addEnvironment(root)).toThrow(
      /no usable triangle mesh geometry/,
    );
    expect(MockWorker.instances[0].postedMessages).not.toContainEqual(
      expect.objectContaining({ type: MessageType.AddEnvironment }),
    );
  });
});
