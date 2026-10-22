/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Mesh,
  MeshMatcapMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { FlexBatchedMesh } from '../utils/flex-batched-mesh.js';
import { BaseControllerVisual } from './base-impl.js';

export class AnimatedController extends BaseControllerVisual {
  static assetKeyPrefix = 'controller-';
  static useSimpleMaterial = false;
  private animatedComponents: Array<{
    isButton: boolean;
    gamepadIndex: number;
    node: Object3D;
    transformRange: {
      min: {
        position: Vector3;
        quaternion: Quaternion;
      };
      max: {
        position: Vector3;
        quaternion: Quaternion;
      };
    };
  }> = [];

  init() {
    if (AnimatedController.useSimpleMaterial) {
      const simpleMaterials = new Map<
        MeshStandardMaterial,
        MeshMatcapMaterial
      >();
      this.model.traverse((node) => {
        const mesh = node as Mesh;
        if (mesh.isMesh) {
          const originalMat = mesh.material as MeshStandardMaterial;
          let simpleMat = simpleMaterials.get(originalMat);
          if (!simpleMat) {
            simpleMat = new MeshMatcapMaterial({
              color: originalMat.color,
              map: originalMat.map,
              normalMap: originalMat.normalMap,
            });
            simpleMaterials.set(originalMat, simpleMat);
          }
          mesh.material = simpleMat;
        }
      });
    }

    Object.values(this.layout.components).forEach((config) => {
      Object.values(config.visualResponses).forEach((animConfig) => {
        const type = animConfig.componentProperty;
        if (type === 'button' || type === 'xAxis' || type === 'yAxis') {
          const gamepadIndex = config.gamepadIndices[type];
          const isButton = type === 'button';
          const node = this.model.getObjectByName(animConfig.valueNodeName);
          const minNode = animConfig.minNodeName
            ? this.model.getObjectByName(animConfig.minNodeName)
            : undefined;
          const maxNode = animConfig.maxNodeName
            ? this.model.getObjectByName(animConfig.maxNodeName)
            : undefined;
          if (gamepadIndex === undefined || !node || !minNode || !maxNode) {
            return;
          }
          this.animatedComponents.push({
            isButton,
            gamepadIndex,
            node,
            transformRange: {
              min: {
                position: minNode.position.clone(),
                quaternion: minNode.quaternion.clone(),
              },
              max: {
                position: maxNode.position.clone(),
                quaternion: maxNode.quaternion.clone(),
              },
            },
          });
          minNode.removeFromParent();
          maxNode.removeFromParent();
        }
      });
    });

    this.model = new FlexBatchedMesh(this.model);
  }

  update() {
    if (this.enabled && this.gamepad) {
      this.animatedComponents.forEach((animComponent) => {
        const { isButton, node, gamepadIndex, transformRange } = animComponent;
        // Some devices report fewer buttons or axes than their input profile
        // maps (e.g. Samsung Galaxy XR); leave those components at rest.
        const value = isButton
          ? this.gamepad!.buttons[gamepadIndex]?.value
          : this.gamepad!.axes[gamepadIndex];
        if (value === undefined) {
          return;
        }
        const alpha = isButton ? value : (value + 1) / 2;
        node.position.lerpVectors(
          transformRange.min.position,
          transformRange.max.position,
          alpha,
        );
        node.quaternion.slerpQuaternions(
          transformRange.min.quaternion,
          transformRange.max.quaternion,
          alpha,
        );
      });
    }
  }
}
