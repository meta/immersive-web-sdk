/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Pointer, createRayPointer } from '@pmndrs/pointer-events';
import {
  Color,
  CylinderGeometry,
  Intersection,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  ShaderMaterial,
} from 'three';
import { XROrigin } from '../rig/xr-origin.js';
import { isObjectTreeVisible } from './visibility.js';

const { lerp } = MathUtils;

const vertexShader = `
  varying float vPosition;
  void main() {
    vPosition = (position.z + 1.0) / 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float endValue;
  uniform float opacity;
  uniform vec3 color;
  varying float vPosition;
  void main() {
    float alpha = vPosition < endValue ? smoothstep(endValue-0.05, endValue, vPosition) :
               vPosition < 0.97 ? 1.0 :
               1.0 - smoothstep(0.97, 1.0, vPosition);
    gl_FragColor = vec4(color, alpha * opacity);
  }
`;

const rayPressedColor = new Color(0x3383e6);
const rayDefaultColor = new Color(0xffffff);

export enum RayDisplayMode {
  Visible = 1,
  VisibleOnIntersection = 2,
  Invisible = 3,
}

export class RayPointer {
  public pointer: Pointer;
  public ray: Mesh<CylinderGeometry, ShaderMaterial>;
  public enabled = true;
  public rayIntersection: Intersection | undefined;
  public rayDisplayMode: RayDisplayMode = RayDisplayMode.VisibleOnIntersection;

  constructor(
    camera: PerspectiveCamera,
    xrOrigin: XROrigin,
    handedness: 'left' | 'right',
  ) {
    this.pointer = createRayPointer(
      () => camera,
      { current: xrOrigin.raySpaces[handedness] },
      {},
      {
        filter: isObjectTreeVisible,
        // XR trigger presses are commonly longer than a mouse click, especially
        // through controller emulation. Match the poke pointer's forgiving
        // activation window so a normal select gesture reaches child UI clicks.
        clickThresholdMs: 800,
        // Disable contextmenu on button 2 (squeeze) to avoid spurious events
        contextMenuButton: -1,
      },
    );

    // Optimize raycaster for BVH acceleration - only get first hit for better performance
    const raycaster = (this.pointer.intersector as any).raycaster;
    if (raycaster) {
      raycaster.firstHitOnly = true;
      // Sprite.raycast needs the viewing camera, and the XR ray intersector
      // never sets one (the screen intersector does, via setFromCamera).
      raycaster.camera = camera;
    }
    this.ray = new Mesh(
      new CylinderGeometry(0.001, 0.001, 1, 6, 1, true)
        .translate(0, 0.5, 0)
        .rotateX(-Math.PI / 2),
      new ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          endValue: { value: 0.75 },
          color: { value: new Color().copy(rayDefaultColor) },
          opacity: { value: 0 },
        },
      }),
    );
    this.ray.visible = false;
    this.ray.renderOrder = 0;
    xrOrigin.raySpaces[handedness].add(this.ray);
  }

  update(
    connected: boolean,
    delta: number,
    _time: number,
    selectStart: boolean,
    selectEnd: boolean,
    policy?: { forceHideRay?: boolean },
  ) {
    // CombinedPointer is responsible for moving/enabling; we only render visuals
    // CombinedPointer controls actual pointer enablement; reflect that in visuals
    const pointerEnabled = this.pointer.getEnabled();
    const active = pointerEnabled && connected && this.enabled;
    this.ray.visible = active && !policy?.forceHideRay;

    if (active) {
      if (pointerEnabled && selectStart) {
        this.ray.material.uniforms.color.value.copy(rayPressedColor);
      } else if (pointerEnabled && selectEnd) {
        this.ray.material.uniforms.color.value.copy(rayDefaultColor);
      }
      // Movement is handled by the owning CombinedPointer aggregator
    }
    this.updatePointerRendering(active, delta);
  }

  private updatePointerRendering(pointerActive: boolean, delta = 1) {
    let rayOpacityTarget = 0;
    if (pointerActive) {
      const intersection = this.pointer.getIntersection();
      const intersectionValid = !!(
        intersection && !intersection.object.isVoidObject
      );
      this.rayIntersection = intersectionValid ? intersection : undefined;
      switch (this.rayDisplayMode) {
        case RayDisplayMode.Visible:
          rayOpacityTarget = 1;
          break;
        case RayDisplayMode.Invisible:
          rayOpacityTarget = 0;
          break;
        default:
          rayOpacityTarget = intersectionValid ? 1 : 0;
      }
      if (intersectionValid) {
        this.ray.material.uniforms.endValue.value =
          1.05 - Math.min(0.3, intersection.distance);
      }
    } else {
      this.rayIntersection = undefined;
    }
    this.ray.material.uniforms.opacity.value = lerp(
      this.ray.material.uniforms.opacity.value,
      rayOpacityTarget,
      delta * 10,
    );
  }

  get busy() {
    return !!this.rayIntersection;
  }

  /**
   * Dispose of ray pointer resources.
   */
  dispose(): void {
    this.ray.geometry.dispose();
    this.ray.material.dispose();
    this.ray.removeFromParent();
  }
}
