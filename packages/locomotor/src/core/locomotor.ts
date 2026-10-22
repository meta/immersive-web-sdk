/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EnvironmentType } from '../types/environment-types.js';
import { MessageType } from '../types/message-types.js';
import { LocomotionEngine } from './engine.js';

export { EnvironmentType };

const UNIT_SCALE = new Vector3(1, 1, 1);

export interface LocomotorConfig {
  initialPlayerPosition?: Vector3;
  updateFrequency?: number;
  rayGravity?: number;
  maxDropDistance?: number;
  jumpHeight?: number;
  jumpCooldown?: number;
  useWorker?: boolean;
}

export interface PositionUpdate {
  position: Vector3;
  isGrounded: boolean;
}

export interface RaycastResult {
  hit: boolean;
  point?: Vector3;
  normal?: Vector3;
  distance?: number;
}

/**
 * Main thread interface for locomotion physics engine
 * Supports both web worker mode (default) and inline mode
 *
 * - Worker mode: Runs physics engine in a separate thread for better performance
 * - Inline mode: Runs physics engine in the same thread for snappier controls
 *
 * Use LocomotorConfig.useWorker to control the mode (default: true)
 */
export class Locomotor {
  public hitTestTarget: Object3D;
  public hitTestNormal = new Vector3();
  public isGrounded = false;
  public position = new Vector3();

  private worker?: Worker;
  // Private inline engine (used when useWorker is false)
  private engine?: LocomotionEngine;
  private useWorker: boolean;
  private initialized = false;
  private config: LocomotorConfig;

  // Environment handle tracking - split by type for easier usage
  private staticEnvs = new Map<number, Object3D>();
  private kinematicEnvs = new Map<number, Object3D>();
  private nextEnvironmentHandle = 1;

  private targetPosition = new Vector3();

  private tempVec1 = new Vector3();
  private tempVec2 = new Vector3();
  private tempQuat = new Quaternion();
  private tempMatrix = new Matrix4();
  private tempMatrix2 = new Matrix4();
  private requestArr = new Array(7);
  private kinematicUpdateArr = new Array(18);

  constructor(config: LocomotorConfig = {}) {
    this.config = {
      initialPlayerPosition: new Vector3(0, 2, 0),
      updateFrequency: 60,
      rayGravity: -0.4,
      maxDropDistance: 5.0,
      jumpHeight: 1.5,
      jumpCooldown: 0.1,
      useWorker: true,
      ...config,
    };

    this.useWorker = this.config.useWorker!;

    this.hitTestTarget = new Object3D();
    this.hitTestTarget.visible = false;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.position.copy(this.config.initialPlayerPosition!);
    this.targetPosition.copy(this.config.initialPlayerPosition!);

    if (this.useWorker) {
      // Create worker using lazy loading pattern (await will be handled by plugin)
      this.worker = new Worker(new URL('../worker/worker.js', import.meta.url));

      this.worker.postMessage({
        type: MessageType.Init,
        payload: {
          initialPlayerPosition: this.config.initialPlayerPosition!.toArray(),
        },
      });

      this.worker.onmessage = (e) => {
        this.handleWorkerMessage(e);
      };

      this.updateConfig(this.config);
    } else {
      this.engine = new LocomotionEngine(this.config.initialPlayerPosition!);

      this.applyConfigToEngine(this.config);

      this.isGrounded = this.engine.isGrounded;
    }

    this.initialized = true;
  }

  terminate(): void {
    if (this.useWorker && this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    } else if (!this.useWorker) {
      this.engine = undefined;
    }
    this.initialized = false;
    this.staticEnvs.clear();
    this.kinematicEnvs.clear();
  }

  updateConfig(config: Partial<LocomotorConfig>): void {
    Object.assign(this.config, config);

    if (this.useWorker && this.worker) {
      this.worker.postMessage({
        type: MessageType.Config,
        payload: {
          updateFrequency: this.config.updateFrequency,
          rayGravity: this.config.rayGravity,
          maxDropDistance: this.config.maxDropDistance,
          jumpHeight: this.config.jumpHeight,
          jumpCooldown: this.config.jumpCooldown,
        },
      });
    } else if (!this.useWorker && this.engine) {
      this.applyConfigToEngine(this.config);
    }
  }

  private applyConfigToEngine(config: LocomotorConfig): void {
    if (!this.engine) {
      return;
    }

    if (config.rayGravity !== undefined) {
      this.engine.rayGravity = config.rayGravity;
    }
    if (config.maxDropDistance !== undefined) {
      this.engine.setMaxDropDistance(config.maxDropDistance);
    }
    if (config.jumpHeight !== undefined) {
      this.engine.jumpHeight = config.jumpHeight;
    }
    if (config.jumpCooldown !== undefined) {
      this.engine.jumpCooldown = config.jumpCooldown;
    }
  }

  /**
   * Update method for inline mode (when useWorker is false)
   * This method must be called every frame when using inline mode.
   * In worker mode, this method does nothing as updates are handled automatically.
   *
   * @param delta Time in seconds since last update
   */
  update(delta: number): void {
    if (!this.initialized) {
      return;
    }

    if (this.useWorker && this.worker) {
      // lerp alpha must stay within [0, 1] — an alpha > 1 makes each frame's
      // positional error multiply by |1 - alpha|, diverging exponentially
      // when a stalled frame produces a large delta.
      this.position.lerp(this.targetPosition, Math.min(delta * 10, 1));
    } else if (!this.useWorker && this.engine) {
      this.engine.update(delta);
      this.position.copy(this.engine.playerPosition);
      this.isGrounded = this.engine.isGrounded;
    }
  }

  addEnvironment(
    object3D: Object3D,
    type: string = EnvironmentType.STATIC,
  ): number {
    if (!this.initialized || !object3D?.isObject3D) {
      throw new Error('Locomotor not initialized or invalid Object3D');
    }

    const envHandle = this.nextEnvironmentHandle++;

    const { positions, indices, worldMatrix } =
      this.processEnvironment(object3D);

    if (type === EnvironmentType.KINEMATIC) {
      this.kinematicEnvs.set(envHandle, object3D);
    } else {
      this.staticEnvs.set(envHandle, object3D);
    }

    if (this.useWorker && this.worker) {
      this.worker.postMessage({
        type: MessageType.AddEnvironment,
        payload: {
          handle: envHandle,
          positions,
          indices,
          type,
          worldMatrix: worldMatrix.elements,
        },
      });
    } else if (!this.useWorker && this.engine) {
      this.engine.addEnvironment(
        envHandle,
        positions,
        indices,
        type,
        worldMatrix,
      );
    }

    return envHandle;
  }

  removeEnvironment(envHandle: number): void {
    if (!this.initialized) {
      return;
    }

    const isKinematic = this.kinematicEnvs.has(envHandle);
    const isStatic = this.staticEnvs.has(envHandle);

    if (!isKinematic && !isStatic) {
      return;
    }

    if (isKinematic) {
      this.kinematicEnvs.delete(envHandle);
    } else {
      this.staticEnvs.delete(envHandle);
    }

    if (this.useWorker && this.worker) {
      this.worker.postMessage({
        type: MessageType.RemoveEnvironment,
        payload: { handle: envHandle },
      });
    } else if (!this.useWorker && this.engine) {
      this.engine.removeEnvironment(envHandle);
    }
  }

  updateKinematicEnvironments(envHandles?: number[]): void {
    if (!this.initialized) {
      return;
    }

    const handlesToUpdate = envHandles || Array.from(this.kinematicEnvs.keys());

    for (const envHandle of handlesToUpdate) {
      const object3D = this.kinematicEnvs.get(envHandle);
      if (!object3D?.isObject3D) {
        continue;
      }

      object3D.updateMatrixWorld(true);

      this.tempMatrix.copy(object3D.matrixWorld);
      this.tempMatrix.decompose(this.tempVec1, this.tempQuat, this.tempVec2);
      this.tempMatrix.compose(this.tempVec1, this.tempQuat, UNIT_SCALE);

      if (this.useWorker && this.worker) {
        this.kinematicUpdateArr[0] = MessageType.UpdateKinematicEnvironment;
        this.kinematicUpdateArr[1] = envHandle;
        for (let i = 0; i < 16; i++) {
          this.kinematicUpdateArr[i + 2] = this.tempMatrix.elements[i];
        }

        this.worker.postMessage(this.kinematicUpdateArr);
      } else if (!this.useWorker && this.engine) {
        this.engine.updateKinematicPlatform(envHandle, this.tempMatrix);
      }
    }
  }

  slide(direction: Vector3): void {
    if (!this.initialized) {
      return;
    }

    if (this.useWorker && this.worker) {
      this.requestArr[0] = MessageType.Slide;
      direction.toArray(this.requestArr, 1);
      this.worker.postMessage(this.requestArr);
    } else if (!this.useWorker && this.engine) {
      this.engine.slide(direction);
    }
  }

  teleport(position: Vector3): void {
    if (!this.initialized) {
      return;
    }

    // Keep the public pose authoritative immediately. Worker responses arrive
    // asynchronously; without this, consumers can render one or more frames at
    // the pre-teleport position after an authored player placement is applied.
    this.position.copy(position);
    this.targetPosition.copy(position);

    if (this.useWorker && this.worker) {
      this.requestArr[0] = MessageType.Teleport;
      position.toArray(this.requestArr, 1);
      this.worker.postMessage(this.requestArr);
    } else if (!this.useWorker && this.engine) {
      this.engine.teleport(position);
    }
  }

  requestHitTest(origin: Vector3, direction: Vector3): void {
    if (!this.initialized) {
      return;
    }

    if (this.useWorker && this.worker) {
      this.requestArr[0] = MessageType.ParabolicRaycast;
      origin.toArray(this.requestArr, 1);
      direction.toArray(this.requestArr, 4);
      this.worker.postMessage(this.requestArr);
    } else if (!this.useWorker && this.engine) {
      const intersect = this.engine.parabolicRaycast(origin, direction);

      const data = new Array(7).fill(NaN);
      data[0] = MessageType.RaycastUpdate;
      if (intersect) {
        intersect.point.toArray(data, 1);
        if (intersect.face) {
          intersect.face.normal.toArray(data, 4);
        }
      }
      this.handleHitTestResult(data);
    }
  }

  jump(): void {
    if (!this.initialized) {
      return;
    }

    if (this.useWorker && this.worker) {
      this.worker.postMessage([MessageType.Jump]);
    } else if (!this.useWorker && this.engine) {
      this.engine.jump();
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private processEnvironment(object3D: Object3D): {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array;
    worldMatrix: Matrix4;
  } {
    object3D.updateMatrixWorld(true);

    this.tempMatrix.copy(object3D.matrixWorld);

    this.tempMatrix.decompose(this.tempVec1, this.tempQuat, this.tempVec2);
    this.tempMatrix.compose(this.tempVec1, this.tempQuat, UNIT_SCALE);

    const geometries: BufferGeometry[] = [];
    object3D.traverse((child) => {
      const mesh = child as Mesh;
      // IWSDK runtime-only meshes (ContactShadow and ShadowCatcher planes) are
      // visuals, not walkable surfaces.
      if (!mesh.isMesh || mesh.userData?.iwsdkRuntimeOnly === true) {
        return;
      }
      const position = mesh.geometry?.getAttribute('position');
      const sourceIndex = mesh.geometry?.getIndex();
      const elementCount = sourceIndex?.count ?? position?.count ?? 0;
      if (!position || position.count === 0 || elementCount === 0) {
        return;
      }

      if (position.itemSize !== 3 || elementCount % 3 !== 0) {
        throw new Error(
          `Locomotor environment mesh "${mesh.name || mesh.uuid}" does not contain complete triangle position data.`,
        );
      }

      // Collision uses only positions and triangle indices. Normalizing to a
      // fresh position buffer accepts interleaved glTF attributes and prevents
      // unrelated normals, UVs, or colors from making geometry merging fail.
      const positions = new Float32Array(position.count * 3);
      for (let i = 0, offset = 0; i < position.count; i++, offset += 3) {
        positions[offset] = position.getX(i);
        positions[offset + 1] = position.getY(i);
        positions[offset + 2] = position.getZ(i);
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      if (sourceIndex) {
        geometry.setIndex(sourceIndex.clone());
      } else {
        const IndexArray = position.count > 65536 ? Uint32Array : Uint16Array;
        const indices = new IndexArray(position.count);
        for (let i = 0; i < position.count; i++) {
          indices[i] = i;
        }
        geometry.setIndex(new BufferAttribute(indices, 1));
      }
      geometry.applyMatrix4(child.matrixWorld);
      geometries.push(geometry);
    });
    if (geometries.length === 0) {
      throw new Error(
        'Locomotor environment has no usable triangle mesh geometry; add at least one Mesh with vertex positions to the environment Object3D hierarchy.',
      );
    }
    const mergedGeometry = mergeGeometries(geometries);
    if (
      !mergedGeometry?.index ||
      mergedGeometry.index.count === 0 ||
      !mergedGeometry.getAttribute('position')?.count
    ) {
      throw new Error(
        'Locomotor could not merge the environment meshes into a collision mesh; ensure every environment Mesh contains valid triangle positions and indices.',
      );
    }
    this.tempMatrix2.copy(this.tempMatrix).invert();
    mergedGeometry.applyMatrix4(this.tempMatrix2);

    object3D.matrixWorld.copy(this.tempMatrix);

    return {
      positions: mergedGeometry.attributes.position.array as Float32Array,
      indices: mergedGeometry.index.array as Uint16Array | Uint32Array,
      worldMatrix: this.tempMatrix.clone(),
    };
  }

  private handleWorkerMessage(e: MessageEvent): void {
    if (e.data instanceof Array) {
      const messageType = e.data[0];

      if (messageType === MessageType.PositionUpdate) {
        this.targetPosition.fromArray(e.data, 1);
        this.isGrounded = e.data[5] === 1;
      } else if (messageType === MessageType.RaycastUpdate) {
        this.handleHitTestResult(e.data);
      }
    }
  }

  private handleHitTestResult(data: number[]): void {
    const hit = !isNaN(data[1]) && !isNaN(data[2]) && !isNaN(data[3]);

    if (hit) {
      this.tempVec1.fromArray(data, 1);
      this.tempVec2.fromArray(data, 4);

      this.hitTestTarget.position.copy(this.tempVec1);
      this.hitTestTarget.lookAt(this.tempVec1.add(this.tempVec2));
      this.hitTestNormal.copy(this.tempVec2);
      this.hitTestTarget.visible = true;
    } else {
      this.hitTestTarget.visible = false;
    }
  }
}
