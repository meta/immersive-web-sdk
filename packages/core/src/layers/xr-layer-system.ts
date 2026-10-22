/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Entity } from '../ecs/entity.js';
import { createSystem } from '../ecs/system.js';
import {
  BackSide,
  Color,
  CylinderGeometry,
  DepthFormat,
  DepthStencilFormat,
  DepthTexture,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  Matrix4,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  UnsignedInt248Type,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
} from '../runtime/index.js';
import { XRCylinderLayer } from './xr-cylinder-layer.js';
import { createQuadLayerInit, toNativeQuadLayerSize } from './xr-layer-init.js';
import { XRLayerState } from './xr-layer-state.js';
import {
  isValidCylinderLayerAngle,
  resolveCylinderLayerDimensions,
  resolveLayerReferencePose,
  resolveQuadLayerDimensions,
} from './xr-layer-transform.js';
import { XRQuadLayer } from './xr-quad-layer.js';

export { XRLayerState } from './xr-layer-state.js';

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _configuration = new Vector3();
const _relativeMatrix = new Matrix4();
const _clearColor = new Color();

interface CachedTransform {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  configuration: Vector3;
}

interface UnsupportedLayerState {
  relativeMatrix: Matrix4;
  configuration: Vector3;
}

interface RetiredLayerResources {
  xrLayer: any;
  mesh: Mesh;
  fallbackMaterial: MeshBasicMaterial;
  renderTarget: WebGLRenderTarget;
}

function toRigidTransform(pos: Vector3, quat: Quaternion): XRRigidTransform {
  return new XRRigidTransform(
    { x: pos.x, y: pos.y, z: pos.z },
    { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
  );
}

function isObjectTreeVisible(object: Object3D): boolean {
  for (
    let current: Object3D | null = object;
    current;
    current = current.parent
  ) {
    if (!current.visible) {
      return false;
    }
  }
  return true;
}

function sameNumber(first: number, second: number): boolean {
  return first === second || (Number.isNaN(first) && Number.isNaN(second));
}

function sameVector(first: Vector3, second: Vector3): boolean {
  return (
    sameNumber(first.x, second.x) &&
    sameNumber(first.y, second.y) &&
    sameNumber(first.z, second.z)
  );
}

/**
 * Show layer content on the fallback mesh the way the compositor presents it.
 * Content is rendered with WebGL's bottom-left origin, which the compositor
 * also uses, so a plane samples it unflipped. A cylinder is seen from inside,
 * where CylinderGeometry's u runs right to left: mirror u only.
 */
function orientFallbackMap(map: Texture, isQuad: boolean): void {
  map.offset.set(isQuad ? 0 : 1, 0);
  map.repeat.set(isQuad ? 1 : -1, 1);
}

/**
 * XRLayerSystem manages WebXR quad and cylinder composition layers.
 *
 * For each entity with an {@link XRQuadLayer} or {@link XRCylinderLayer}
 * component, the system:
 * - Creates a mesh (plane or cylinder) as a child of the entity's object3D
 * - Renders layer content via the component's `renderCallback` while its
 *   render surface is visible and active
 * - In XR sessions with layer support, creates native XR composition layers,
 *   which the compositor draws over the projection layer, and stops drawing
 *   the mesh so the scene stays visible through transparent layer content
 * - Falls back to rendering the content onto a textured mesh outside XR
 *
 * @category Layers
 */
export class XRLayerSystem extends createSystem({
  quadLayers: { required: [XRQuadLayer] },
  cylinderLayers: { required: [XRCylinderLayer] },
  activeLayers: { required: [XRLayerState] },
}) {
  private sessionUsesLayers = false;
  private sessionLayerInitializationPending = false;
  private unsupportedLayerStates = new Map<number, UnsupportedLayerState>();
  private pendingNativeLayerRemovals = new Set<number>();
  private retiredLayers: RetiredLayerResources[] = [];
  private layerVisibility = new Map<number, boolean>();
  private layerConfigurations = new Map<number, Vector3>();

  init() {
    const onSessionStart = () => this.handleSessionStart();
    const onSessionEnd = () => this.handleSessionEnd();
    this.xrManager.addEventListener('sessionstart', onSessionStart);
    this.xrManager.addEventListener('sessionend', onSessionEnd);

    this.cleanupFuncs.push(
      () => this.xrManager.removeEventListener('sessionstart', onSessionStart),
      () => this.xrManager.removeEventListener('sessionend', onSessionEnd),
    );

    // Register the query subscriptions on cleanupFuncs so they're released on
    // system teardown (matching the xr listeners above).
    this.cleanupFuncs.push(
      this.queries.quadLayers.subscribe('qualify', (entity: Entity) =>
        this.setupLayer(entity, 'quad'),
      ),
      this.queries.quadLayers.subscribe('disqualify', (entity: Entity) =>
        this.teardownLayer(entity),
      ),
      this.queries.cylinderLayers.subscribe('qualify', (entity: Entity) =>
        this.setupLayer(entity, 'cylinder'),
      ),
      this.queries.cylinderLayers.subscribe('disqualify', (entity: Entity) =>
        this.teardownLayer(entity),
      ),
    );

    // Query disqualify does not run merely because the system itself is being
    // destroyed. Release every live compositor and GPU resource explicitly.
    this.cleanupFuncs.push(() => {
      for (const entity of [...this.queries.activeLayers.entities]) {
        this.teardownLayer(entity);
      }
      this.disposeRetiredLayers();
      this.unsupportedLayerStates.clear();
      this.pendingNativeLayerRemovals.clear();
      this.layerVisibility.clear();
      this.layerConfigurations.clear();
    });
  }

  update() {
    if (this.sessionLayerInitializationPending) {
      this.tryInitializeSessionLayers();
    }
    if (
      this.queries.activeLayers.entities.size === 0 &&
      this.retiredLayers.length === 0
    ) {
      return;
    }
    this.renderLayers();
  }

  // ---------------------------------------------------------------------------
  // Layer setup / teardown
  // ---------------------------------------------------------------------------

  private setupLayer(entity: Entity, type: 'quad' | 'cylinder') {
    const isQuad = type === 'quad';
    const component = isQuad ? XRQuadLayer : XRCylinderLayer;

    const pixelWidth = entity.getValue(component, 'pixelWidth') as number;
    const pixelHeight = entity.getValue(component, 'pixelHeight') as number;
    const stencil = entity.getValue(component, 'stencil') as boolean;

    const geometry = this.createFallbackGeometry(entity, isQuad);
    const side = isQuad ? FrontSide : BackSide;

    const renderTarget = this.createRenderTarget(
      pixelWidth,
      pixelHeight,
      stencil,
    );

    const fallbackMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      side,
      transparent: true,
    });
    fallbackMaterial.map = renderTarget.texture;
    orientFallbackMap(fallbackMaterial.map, isQuad);

    const mesh = new Mesh(geometry, fallbackMaterial);
    entity.object3D?.add(mesh);

    entity.addComponent(XRLayerState, {
      isQuad,
      mesh,
      renderTarget,
      fallbackMaterial,
      pixelWidth,
      pixelHeight,
      stencil,
    });
    this.readLayerConfiguration(entity, isQuad, _configuration);
    this.layerConfigurations.set(entity.index, _configuration.clone());

    if (this.sessionUsesLayers) {
      this.activateNativeLayer(entity);
      this.updateSessionLayers();
    }
  }

  private teardownLayer(entity: Entity) {
    const mesh = XRLayerState.data.mesh[entity.index] as Mesh | null;
    if (!mesh) {
      return;
    }

    const resources: RetiredLayerResources = {
      xrLayer: XRLayerState.data.xrLayer[entity.index],
      mesh,
      fallbackMaterial: XRLayerState.data.fallbackMaterial[
        entity.index
      ] as MeshBasicMaterial,
      renderTarget: XRLayerState.data.renderTarget[
        entity.index
      ] as WebGLRenderTarget,
    };
    const nativeLayerIsActive = (
      this.xrManager.getSession()?.renderState.layers as
        | readonly unknown[]
        | undefined
    )?.includes(resources.xrLayer);

    if (resources.xrLayer && this.sessionUsesLayers) {
      this.updateSessionLayers(entity);
    }
    mesh.removeFromParent();

    if (entity.active) {
      entity.removeComponent(XRLayerState);
    }
    this.unsupportedLayerStates.delete(entity.index);
    this.pendingNativeLayerRemovals.delete(entity.index);
    this.layerVisibility.delete(entity.index);
    this.layerConfigurations.delete(entity.index);

    if (resources.xrLayer && this.sessionUsesLayers && nativeLayerIsActive) {
      this.retiredLayers.push(resources);
    } else {
      this.disposeLayerResources(resources);
    }
  }

  // ---------------------------------------------------------------------------
  // XR session lifecycle
  // ---------------------------------------------------------------------------

  private handleSessionStart() {
    this.sessionUsesLayers = false;
    this.sessionLayerInitializationPending = true;
    this.tryInitializeSessionLayers();
  }

  private handleSessionEnd() {
    for (const entity of this.queries.activeLayers.entities) {
      this.deactivateNativeLayer(entity);
    }
    this.disposeRetiredLayers();
    this.unsupportedLayerStates.clear();
    this.pendingNativeLayerRemovals.clear();
    this.layerVisibility.clear();
    this.sessionUsesLayers = false;
    this.sessionLayerInitializationPending = false;
  }

  /**
   * Enable composition layers once the projection layer is active.
   *
   * super-three queues its projection-layer render state before dispatching
   * `sessionstart`, so `renderState.layers` can legitimately be empty during
   * that event. Keep rendering the mesh fallback and retry on subsequent
   * frames instead of permanently classifying the session as unsupported.
   */
  private tryInitializeSessionLayers(): boolean {
    const session = this.xrManager.getSession();
    const binding = this.xrManager.getBinding();
    const renderState = session?.renderState as XRRenderState | undefined;

    if (!session || !binding || !renderState || renderState.baseLayer) {
      this.sessionLayerInitializationPending = false;
      return false;
    }

    if (!renderState.layers?.[0]) {
      return false;
    }

    this.sessionLayerInitializationPending = false;
    this.sessionUsesLayers = true;
    for (const entity of this.queries.activeLayers.entities) {
      this.activateNativeLayer(entity);
    }
    this.updateSessionLayers();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Native layer management
  // ---------------------------------------------------------------------------

  private activateNativeLayer(entity: Entity): boolean {
    const binding = this.xrManager.getBinding() as any;
    const session = this.xrManager.getSession();
    if (!binding || !session) {
      return false;
    }

    const isQuad = !!XRLayerState.data.isQuad[entity.index];
    const mesh = XRLayerState.data.mesh[entity.index] as Mesh;
    const pixelWidth = XRLayerState.data.pixelWidth[entity.index] as number;
    const pixelHeight = XRLayerState.data.pixelHeight[entity.index] as number;

    const refSpace = this.xrManager.getReferenceSpace();
    if (!refSpace) {
      return false;
    }
    this.readLayerConfiguration(entity, isQuad, _configuration);
    const hasSupportedTransform = resolveLayerReferencePose(
      mesh,
      this.player,
      _position,
      _quaternion,
      _scale,
      _relativeMatrix,
    );

    let xrLayer;
    if (isQuad) {
      const dimensions = hasSupportedTransform
        ? resolveQuadLayerDimensions(_configuration.x, _configuration.y, _scale)
        : null;
      if (!dimensions) {
        this.rememberUnsupportedLayer(entity, 'quad');
        return false;
      }

      xrLayer = binding.createQuadLayer(
        createQuadLayerInit({
          transform: toRigidTransform(_position, _quaternion),
          width: dimensions.width,
          height: dimensions.height,
          space: refSpace,
          pixelWidth,
          pixelHeight,
        }),
      );
    } else {
      const dimensions = hasSupportedTransform
        ? resolveCylinderLayerDimensions(
            _configuration.x,
            _configuration.y,
            _scale,
          )
        : null;
      if (!dimensions || !isValidCylinderLayerAngle(_configuration.z)) {
        this.rememberUnsupportedLayer(entity, 'cylinder');
        return false;
      }

      xrLayer = binding.createCylinderLayer({
        transform: toRigidTransform(_position, _quaternion),
        radius: dimensions.radius,
        centralAngle: _configuration.z,
        aspectRatio: dimensions.aspectRatio,
        space: refSpace,
        viewPixelWidth: pixelWidth,
        viewPixelHeight: pixelHeight,
        clearOnAccess: false,
      });
    }

    this.unsupportedLayerStates.delete(entity.index);
    entity.setValue(XRLayerState, 'xrLayer', xrLayer);

    entity.setValue(XRLayerState, 'cachedTransform', {
      position: _position.clone(),
      quaternion: _quaternion.clone(),
      scale: _scale.clone(),
      configuration: _configuration.clone(),
    } satisfies CachedTransform);
    return true;
  }

  private deactivateNativeLayer(entity: Entity) {
    const mesh = XRLayerState.data.mesh[entity.index] as Mesh;
    const xrLayer = XRLayerState.data.xrLayer[entity.index] as any;
    if (!xrLayer) {
      entity.setValue(XRLayerState, 'cachedTransform', null);
      this.pendingNativeLayerRemovals.delete(entity.index);
      return;
    }
    xrLayer.destroy?.();
    this.useFallbackSurface(entity, mesh);

    entity.setValue(XRLayerState, 'xrLayer', null);
    entity.setValue(XRLayerState, 'cachedTransform', null);
    this.pendingNativeLayerRemovals.delete(entity.index);
  }

  /**
   * Switch from the internal fallback texture only after the compositor layer
   * is active, so the content never disappears while updateRenderState() is
   * still pending.
   */
  private useNativeSurface(entity: Entity, mesh: Mesh): void {
    const fallbackMaterial = XRLayerState.data.fallbackMaterial[
      entity.index
    ] as MeshBasicMaterial;
    if (mesh.material !== fallbackMaterial) {
      return;
    }

    // The compositor draws content layers over the projection layer
    // (renderState.layers is [projection, ...content]). Keep the mesh for
    // visibility and raycasts but stop drawing it: a punch-through hole in the
    // projection layer shows through every transparent texel of the layer as
    // a black box, and hides the scene behind the layer.
    const side = XRLayerState.data.isQuad[entity.index] ? FrontSide : BackSide;
    mesh.material = new MeshBasicMaterial({ side, visible: false });

    const xrLayer = XRLayerState.data.xrLayer[entity.index] as any;
    xrLayer.blendTextureSourceAlpha = true;

    const renderTarget = XRLayerState.data.renderTarget[
      entity.index
    ] as WebGLRenderTarget;
    (renderTarget as any).isXRRenderTarget = true;
    renderTarget.texture.colorSpace = SRGBColorSpace;
  }

  /** Restore a fresh internal target after an external XR texture was bound. */
  private useFallbackSurface(entity: Entity, mesh: Mesh): void {
    const fallbackMaterial = XRLayerState.data.fallbackMaterial[
      entity.index
    ] as MeshBasicMaterial;
    if (mesh.material === fallbackMaterial) {
      return;
    }

    (mesh.material as MeshBasicMaterial).dispose();
    const oldRenderTarget = XRLayerState.data.renderTarget[
      entity.index
    ] as WebGLRenderTarget;
    oldRenderTarget.dispose();

    const newRenderTarget = this.createRenderTarget(
      XRLayerState.data.pixelWidth[entity.index] as number,
      XRLayerState.data.pixelHeight[entity.index] as number,
      !!XRLayerState.data.stencil[entity.index],
    );
    entity.setValue(XRLayerState, 'renderTarget', newRenderTarget);
    fallbackMaterial.map = newRenderTarget.texture;
    orientFallbackMap(
      fallbackMaterial.map,
      !!XRLayerState.data.isQuad[entity.index],
    );
    mesh.material = fallbackMaterial;
  }

  private disposeLayerResources(resources: RetiredLayerResources): void {
    resources.xrLayer?.destroy?.();
    resources.mesh.geometry.dispose();
    resources.fallbackMaterial.dispose();
    if (resources.mesh.material !== resources.fallbackMaterial) {
      (resources.mesh.material as MeshBasicMaterial).dispose();
    }
    resources.renderTarget.dispose();
  }

  private disposeRetiredLayers(): void {
    for (const resources of this.retiredLayers) {
      this.disposeLayerResources(resources);
    }
    this.retiredLayers.length = 0;
  }

  /**
   * Keep removed layers alive until the queued render state no longer
   * references them. While removal is pending, clear their native textures so
   * the compositor cannot present stale content from the detached entity.
   */
  private renderRetiredLayers(renderer: any): void {
    if (this.retiredLayers.length === 0) {
      return;
    }

    const activeLayers = this.xrManager.getSession()?.renderState.layers as
      | readonly unknown[]
      | undefined;
    if (!activeLayers) {
      this.disposeRetiredLayers();
      return;
    }

    const retained: RetiredLayerResources[] = [];
    const released: RetiredLayerResources[] = [];
    for (const resources of this.retiredLayers) {
      if (activeLayers.includes(resources.xrLayer)) {
        retained.push(resources);
      } else {
        released.push(resources);
      }
    }

    // Commit the classification before disposal or compositor access. If a
    // later getSubImage() throws, already-released entries cannot be disposed
    // again, while every still-active entry remains tracked for retry.
    this.retiredLayers = retained;
    for (const resources of released) {
      this.disposeLayerResources(resources);
    }

    const binding = this.xrManager.getBinding() as any;
    const frame = this.xrFrame;
    for (const resources of retained) {
      if (!binding || !frame) {
        continue;
      }

      resources.xrLayer.blendTextureSourceAlpha = true;
      (resources.renderTarget as any).isXRRenderTarget = true;
      resources.renderTarget.texture.colorSpace = SRGBColorSpace;
      const subImage = binding.getSubImage(resources.xrLayer, frame);
      renderer.setRenderTargetTextures(
        resources.renderTarget,
        subImage.colorTexture,
        undefined,
      );
      renderer.setRenderTarget(resources.renderTarget);
      renderer.clear(true, true, true);
    }
  }

  /**
   * Rebuild the session's render state layers array.
   * Keeps the projection layer at index 0, then appends content layers.
   */
  private updateSessionLayers(excludedEntity?: Entity) {
    const session = this.xrManager.getSession();
    if (!session?.renderState.layers) {
      return;
    }

    // Projection layer is always the first entry
    const projLayer = session.renderState.layers[0];
    if (!projLayer) {
      return;
    }
    const layers: any[] = [projLayer];

    for (const entity of this.queries.activeLayers.entities) {
      if (entity === excludedEntity) {
        continue;
      }
      const xrLayer = XRLayerState.data.xrLayer[entity.index];
      const mesh = XRLayerState.data.mesh[entity.index] as Mesh | null;
      const visible = mesh != null && isObjectTreeVisible(mesh);
      this.layerVisibility.set(entity.index, visible);
      if (
        xrLayer &&
        visible &&
        !this.pendingNativeLayerRemovals.has(entity.index)
      ) {
        layers.push(xrLayer);
      }
    }

    session.updateRenderState({ layers });
  }

  // ---------------------------------------------------------------------------
  // Per-frame rendering
  // ---------------------------------------------------------------------------

  private renderLayers() {
    if (this.sessionLayerInitializationPending) {
      this.tryInitializeSessionLayers();
    }

    const renderer = this.renderer as any;
    const savedRenderTarget = renderer.getRenderTarget();

    const savedXrEnabled = renderer.xr.enabled;

    // Save clear color so we can clear layers to transparent.
    renderer.getClearColor(_clearColor);
    const savedClearAlpha = renderer.getClearAlpha();

    try {
      // Disable XR so renderer.render() uses the layer-specific camera instead of
      // the headset-tracked XR cameras.
      renderer.xr.enabled = false;
      renderer.setClearColor(0x000000, 0);

      this.renderRetiredLayers(renderer);

      for (const entity of this.queries.activeLayers.entities) {
        const isQuad = !!XRLayerState.data.isQuad[entity.index];
        const component = isQuad ? XRQuadLayer : XRCylinderLayer;
        let xrLayer = XRLayerState.data.xrLayer[entity.index];
        const mesh = XRLayerState.data.mesh[entity.index] as Mesh;
        this.syncLayerGeometry(entity, mesh, isQuad);

        const visible = isObjectTreeVisible(mesh);
        if (this.layerVisibility.get(entity.index) !== visible) {
          this.layerVisibility.set(entity.index, visible);
          if (this.sessionUsesLayers && xrLayer) {
            this.updateSessionLayers();
          }
        }

        if (this.sessionUsesLayers && xrLayer) {
          // An unsupported live transform queues removal. Keep the old native
          // surface valid until that pending render state becomes active.
          this.syncLayerTransform(xrLayer, mesh, entity);
        }

        if (
          this.sessionUsesLayers &&
          !xrLayer &&
          this.shouldRetryNativeLayer(entity, mesh, isQuad) &&
          this.activateNativeLayer(entity)
        ) {
          xrLayer = XRLayerState.data.xrLayer[entity.index];
          this.updateSessionLayers();
        }

        let nativeActive =
          this.sessionUsesLayers &&
          xrLayer != null &&
          (
            this.xrManager.getSession()?.renderState.layers as
              | readonly unknown[]
              | undefined
          )?.includes(xrLayer);

        if (
          xrLayer &&
          this.pendingNativeLayerRemovals.has(entity.index) &&
          !nativeActive
        ) {
          this.deactivateNativeLayer(entity);
          xrLayer = null;
          nativeActive = false;
        }

        if (nativeActive && xrLayer) {
          this.useNativeSurface(entity, mesh);
        } else {
          this.useFallbackSurface(entity, mesh);
        }

        const callback = entity.getValue(component, 'renderCallback') as
          | (() => void)
          | null;
        if (!visible && !nativeActive) {
          continue;
        }

        const renderTarget = XRLayerState.data.renderTarget[
          entity.index
        ] as WebGLRenderTarget;

        if (nativeActive && xrLayer) {
          const binding = this.xrManager.getBinding() as any;
          const frame = this.xrFrame;
          if (!binding || !frame) {
            continue;
          }
          const subImage = binding.getSubImage(xrLayer, frame);
          renderer.setRenderTargetTextures(
            renderTarget,
            subImage.colorTexture,
            undefined,
          );
          renderer.setRenderTarget(renderTarget);

          if (!visible) {
            // A hidden layer remains in the current render state until the next
            // XR frame. Clear it now so that pending removal cannot expose the
            // previous frame's stale content.
            renderer.clear(true, true, true);
            continue;
          }
        } else {
          renderer.setRenderTarget(renderTarget);
        }

        callback?.();
      }
    } finally {
      // Never leak layer-rendering state into the application render, even
      // when a binding or user render callback throws.
      renderer.setClearColor(_clearColor, savedClearAlpha);
      renderer.xr.enabled = savedXrEnabled;
      renderer.setRenderTarget(savedRenderTarget);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Update the native XR layer's transform only when the mesh has moved,
   * avoiding per-frame XRRigidTransform allocations for static layers.
   */
  private syncLayerTransform(
    xrLayer: any,
    mesh: Mesh,
    entity: Entity,
  ): boolean {
    const hasSupportedTransform = resolveLayerReferencePose(
      mesh,
      this.player,
      _position,
      _quaternion,
      _scale,
      _relativeMatrix,
    );

    const isQuad = !!XRLayerState.data.isQuad[entity.index];
    this.readLayerConfiguration(entity, isQuad, _configuration);

    const cached = XRLayerState.data.cachedTransform[
      entity.index
    ] as CachedTransform | null;

    if (
      hasSupportedTransform &&
      cached?.position.equals(_position) &&
      cached.quaternion.equals(_quaternion) &&
      cached.scale.equals(_scale) &&
      sameVector(cached.configuration, _configuration)
    ) {
      this.restorePendingNativeLayer(entity);
      return true;
    }

    if (isQuad) {
      const dimensions = hasSupportedTransform
        ? resolveQuadLayerDimensions(_configuration.x, _configuration.y, _scale)
        : null;
      if (!dimensions) {
        this.rememberUnsupportedLayer(entity, 'quad');
        this.requestNativeLayerRemoval(entity);
        return false;
      }
      const nativeSize = toNativeQuadLayerSize(
        dimensions.width,
        dimensions.height,
      );
      xrLayer.width = nativeSize.width;
      xrLayer.height = nativeSize.height;
    } else {
      const dimensions = hasSupportedTransform
        ? resolveCylinderLayerDimensions(
            _configuration.x,
            _configuration.y,
            _scale,
          )
        : null;
      if (!dimensions || !isValidCylinderLayerAngle(_configuration.z)) {
        this.rememberUnsupportedLayer(entity, 'cylinder');
        this.requestNativeLayerRemoval(entity);
        return false;
      }
      xrLayer.radius = dimensions.radius;
      xrLayer.aspectRatio = dimensions.aspectRatio;
      xrLayer.centralAngle = _configuration.z;
    }

    this.restorePendingNativeLayer(entity);
    xrLayer.transform = toRigidTransform(_position, _quaternion);

    if (cached) {
      cached.position.copy(_position);
      cached.quaternion.copy(_quaternion);
      cached.scale.copy(_scale);
      cached.configuration.copy(_configuration);
    } else {
      entity.setValue(XRLayerState, 'cachedTransform', {
        position: _position.clone(),
        quaternion: _quaternion.clone(),
        scale: _scale.clone(),
        configuration: _configuration.clone(),
      } satisfies CachedTransform);
    }
    return true;
  }

  private requestNativeLayerRemoval(entity: Entity): void {
    if (this.pendingNativeLayerRemovals.has(entity.index)) {
      return;
    }
    this.pendingNativeLayerRemovals.add(entity.index);
    this.updateSessionLayers();
  }

  private restorePendingNativeLayer(entity: Entity): void {
    this.unsupportedLayerStates.delete(entity.index);
    if (!this.pendingNativeLayerRemovals.delete(entity.index)) {
      return;
    }
    this.updateSessionLayers();
  }

  private readLayerConfiguration(
    entity: Entity,
    isQuad: boolean,
    target: Vector3,
  ): void {
    if (isQuad) {
      target.set(
        entity.getValue(XRQuadLayer, 'width') as number,
        entity.getValue(XRQuadLayer, 'height') as number,
        0,
      );
      return;
    }
    target.set(
      entity.getValue(XRCylinderLayer, 'radius') as number,
      entity.getValue(XRCylinderLayer, 'aspectRatio') as number,
      entity.getValue(XRCylinderLayer, 'centralAngle') as number,
    );
  }

  private syncLayerGeometry(entity: Entity, mesh: Mesh, isQuad: boolean): void {
    this.readLayerConfiguration(entity, isQuad, _configuration);
    const cached = this.layerConfigurations.get(entity.index);
    if (cached && sameVector(cached, _configuration)) {
      return;
    }
    this.layerConfigurations.set(entity.index, _configuration.clone());

    // The fallback must reflect every live configuration, including values
    // that a native composition layer cannot represent. Collapse non-finite
    // dimensions to a safe degenerate geometry instead of leaving the last
    // valid (and therefore misleading) shape on screen.
    const geometry = this.createFallbackGeometry(entity, isQuad);

    const oldGeometry = mesh.geometry;
    mesh.geometry = geometry;
    oldGeometry.dispose();
  }

  private createFallbackGeometry(entity: Entity, isQuad: boolean) {
    this.readLayerConfiguration(entity, isQuad, _configuration);
    if (isQuad) {
      const width = Number.isFinite(_configuration.x) ? _configuration.x : 0;
      const height = Number.isFinite(_configuration.y) ? _configuration.y : 0;
      return new PlaneGeometry(width, height);
    }

    const radius = Number.isFinite(_configuration.x) ? _configuration.x : 0;
    const centralAngle = Number.isFinite(_configuration.z)
      ? _configuration.z
      : 0;
    const rawHeight = (_configuration.x * _configuration.z) / _configuration.y;
    const height = Number.isFinite(rawHeight) ? rawHeight : 0;
    return new CylinderGeometry(
      radius,
      radius,
      height,
      64,
      64,
      true,
      Math.PI - centralAngle / 2,
      centralAngle,
    );
  }

  private shouldRetryNativeLayer(
    entity: Entity,
    mesh: Mesh,
    isQuad: boolean,
  ): boolean {
    const unsupported = this.unsupportedLayerStates.get(entity.index);
    if (!unsupported) {
      return true;
    }

    const hasSupportedTransform = resolveLayerReferencePose(
      mesh,
      this.player,
      _position,
      _quaternion,
      _scale,
      _relativeMatrix,
    );
    this.readLayerConfiguration(entity, isQuad, _configuration);
    const hasSupportedConfiguration = isQuad
      ? resolveQuadLayerDimensions(
          _configuration.x,
          _configuration.y,
          _scale,
        ) != null
      : resolveCylinderLayerDimensions(
          _configuration.x,
          _configuration.y,
          _scale,
        ) != null && isValidCylinderLayerAngle(_configuration.z);

    // Approximate cache equality suppresses repeated work while a layer stays
    // unsupported. Never let that tolerance hide a boundary crossing back to
    // a representable native layer.
    if (hasSupportedTransform && hasSupportedConfiguration) {
      return true;
    }
    return (
      !sameVector(unsupported.configuration, _configuration) ||
      this.hasLayerShapeChanged(unsupported.relativeMatrix, _relativeMatrix)
    );
  }

  private hasLayerShapeChanged(previous: Matrix4, current: Matrix4): boolean {
    const previousElements = previous.elements;
    const currentElements = current.elements;
    const previousFinite = previousElements.every(Number.isFinite);
    const currentFinite = currentElements.every(Number.isFinite);
    if (!previousFinite || !currentFinite) {
      return previousElements.some(
        (value, index) => !sameNumber(value, currentElements[index]),
      );
    }

    const gram = (elements: number[]) => {
      const xx = elements[0] ** 2 + elements[1] ** 2 + elements[2] ** 2;
      const yy = elements[4] ** 2 + elements[5] ** 2 + elements[6] ** 2;
      const zz = elements[8] ** 2 + elements[9] ** 2 + elements[10] ** 2;
      const normalizeDot = (dot: number, first: number, second: number) => {
        const denominator = Math.sqrt(first * second);
        return denominator === 0 ? dot : dot / denominator;
      };
      return [
        xx,
        yy,
        zz,
        normalizeDot(
          elements[0] * elements[4] +
            elements[1] * elements[5] +
            elements[2] * elements[6],
          xx,
          yy,
        ),
        normalizeDot(
          elements[0] * elements[8] +
            elements[1] * elements[9] +
            elements[2] * elements[10],
          xx,
          zz,
        ),
        normalizeDot(
          elements[4] * elements[8] +
            elements[5] * elements[9] +
            elements[6] * elements[10],
          yy,
          zz,
        ),
      ];
    };
    const previousGram = gram(previousElements);
    const currentGram = gram(currentElements);
    const nearlyEqual = (a: number, b: number, index: number) => {
      const tolerance =
        index < 3
          ? 1e-10 * Math.max(Number.EPSILON, Math.abs(a), Math.abs(b))
          : 1e-10;
      return Math.abs(a - b) <= tolerance;
    };

    return (
      previousGram.some(
        (value, index) => !nearlyEqual(value, currentGram[index], index),
      ) ||
      Math.sign(previous.determinant()) !== Math.sign(current.determinant())
    );
  }

  private rememberUnsupportedLayer(
    entity: Entity,
    type: 'quad' | 'cylinder',
  ): void {
    if (!this.unsupportedLayerStates.has(entity.index)) {
      console.warn(
        `[XRLayerSystem] ${type} layer ${entity.index} has unsupported dimensions or a non-finite, reflected, or sheared transform; using projection fallback.`,
      );
    }
    this.unsupportedLayerStates.set(entity.index, {
      relativeMatrix: _relativeMatrix.clone(),
      configuration: _configuration.clone(),
    });
  }

  private createRenderTarget(
    width: number,
    height: number,
    stencil: boolean,
  ): WebGLRenderTarget {
    return new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      type: UnsignedByteType,
      depthTexture: new DepthTexture(
        width,
        height,
        stencil ? UnsignedInt248Type : UnsignedIntType,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        stencil ? DepthStencilFormat : DepthFormat,
      ),
      samples: 4,
      stencilBuffer: stencil,
      // The compositor never reads layer depth. With the default (true),
      // setRenderTargetTextures disables multisampled-render-to-texture on a
      // target initialised with it, and setRenderTarget then binds a missing
      // multisampled framebuffer: Quest Browser throws on the first XR frame.
      resolveDepthBuffer: false,
    });
  }
}
