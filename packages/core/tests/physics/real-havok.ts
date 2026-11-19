/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { World } from 'elics';
import { Grabbed } from '../../src/grab/grabbed.js';
import { PhysicsSystem } from '../../src/physics/physics-system.js';
import { PhysicsBody } from '../../src/physics/physicsBody.js';
import { PhysicsShape } from '../../src/physics/physicsShape.js';
import type { Object3D } from '../../src/runtime/three.js';

/**
 * Real-Havok test support. Node can't `fetch` the Havok WASM the way a
 * browser does, so test files mock `@babylonjs/havok` with
 * {@link withLocalHavokWasm}, which hands the engine its binary directly:
 *
 * ```ts
 * vi.mock('@babylonjs/havok', async (importOriginal) =>
 *   (await import('./real-havok.js')).withLocalHavokWasm(await importOriginal()),
 * );
 * ```
 */
export function withLocalHavokWasm(module: any): any {
  const require = createRequire(import.meta.url);
  // The package doesn't export package.json; its entry lives in lib/umd/.
  const entry = require.resolve('@babylonjs/havok');
  const wasmBinary = readFileSync(
    join(dirname(entry), '..', 'esm', 'HavokPhysics.wasm'),
  );
  return { ...module, default: () => module.default({ wasmBinary }) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export interface RealHavokWorld {
  world: World;
  system: PhysicsSystem;
  addBody(
    object3D: Object3D,
    shape: Record<string, unknown>,
    body: Record<string, unknown>,
  ): ReturnType<World['createEntity']>;
  /** Runs `frames` render frames of `delta` seconds, letting each exchange settle. */
  run(
    frames: number,
    delta: number,
    beforeFrame?: (frame: number) => void,
  ): Promise<void>;
}

/** Creates a PhysicsSystem backed by the real Havok engine on the main thread. */
export async function createRealHavokWorld(
  config: { updateFrequency?: number } = {},
): Promise<RealHavokWorld> {
  const world = new World();
  world.registerComponent(Grabbed);
  const queries = Object.fromEntries(
    Object.entries((PhysicsSystem as any).queries).map(([name, query]) => [
      name,
      world.queryManager.registerQuery(query as any),
    ]),
  );
  const system = new PhysicsSystem(
    {} as any,
    world.queryManager as any,
    0,
  ) as any;
  system.queries = queries;
  system.cleanupFuncs ??= [];
  system.config = {
    gravity: { value: [0, -9.81, 0] },
    useWorker: { value: false },
    updateFrequency: { value: config.updateFrequency ?? 60 },
    interpolation: { value: false },
  };
  system.init();
  for (let i = 0; i < 500 && !system.transportReady; i++) {
    await tick();
  }
  if (!system.transportReady) {
    throw new Error('Real Havok runtime did not become ready');
  }

  return {
    world,
    system,
    addBody(object3D, shape, body) {
      const entity = world.createEntity();
      entity.object3D = object3D;
      entity.addComponent(PhysicsShape, shape);
      entity.addComponent(PhysicsBody, body);
      return entity;
    },
    async run(frames, delta, beforeFrame) {
      for (let frame = 0; frame < frames; frame++) {
        beforeFrame?.(frame);
        system.update(delta);
        await tick();
        await tick();
      }
    },
  };
}
