/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { SceneDocument } from '@iwsdk/scene-composition';
import type { SceneComponentCatalog } from '@iwsdk/scene-composition';
import { XROrigin } from '@iwsdk/xr-input';
import type { PointerEventsMap } from '@pmndrs/pointer-events';
import { Signal, signal } from '@preact/signals-core';
import { AnyComponent, World as ElicsWorld } from 'elics';
import { AssetManager, RenderableAssetRegistry } from '../asset/index.js';
// Environment is driven by components/systems; no world helpers
// NOTE: import `launchXR` and types directly from submodules — not the
// `../init/index.js` barrel — so loading this file does not pull in
// `init/world-initializer.js`. That would create a value-level cycle with
// audio-system.ts (and other systems that import the ecs barrel), causing
// the bundler to emit System classes before their referenced Component
// constants, producing `undefined.bitmask` crashes at QueryManager.registerQuery.
// `initializeWorld` is loaded lazily inside `World.create` for the same reason.
import { armSessionGrantCaptureForOptions } from '../init/session-grant.js';
import type { WorldOptions } from '../init/world-initializer.js';
import { launchXR } from '../init/xr.js';
import type { XROptions } from '../init/xr.js';
import type { InputManager } from '../input/index.js';
// Import LevelTag from its leaf module — not '../level/index.js' — so that
// loading ecs/world.ts does not transitively pull in level-system.ts (which
// would re-enter '../ecs/index.js' and form a cycle, leading to TDZ
// undefined.bitmask crashes for any component captured in System.queries).
import { LevelTag } from '../level/level-tag.js';
import type { MCPRuntime } from '../mcp/index.js';
import type { Object3DEventMap } from '../runtime/index.js';
import {
  Material,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from '../runtime/index.js';
// See note above on LevelTag — import Transform directly from its leaf
// module to avoid cycling back through '../ecs/index.js' via the transform
// barrel.
import { Transform } from '../transform/transform.js';
import { Visibility } from '../visibility/visibility-component.js';
import { Entity } from './entity.js';

export enum VisibilityState {
  NonImmersive = 'non-immersive',
  Hidden = 'hidden',
  Visible = 'visible',
  VisibleBlurred = 'visible-blurred',
}

export type GradientColors = {
  sky: number;
  equator: number;
  ground: number;
};

/**
 * Callback invoked once per render-loop tick while an XR session is active,
 * registered via {@link World.onXRFrame}.
 *
 * @param frame The live {@link XRFrame} for this tick. Only valid synchronously
 *   inside the callback — do not retain it across ticks.
 * @param delta Seconds since the previous frame.
 * @param time  Accumulated render-loop time in seconds (monotonic within a session).
 * @category XR Runtime
 */
export type OnXRFrameCallback = (
  frame: XRFrame,
  delta: number,
  time: number,
) => void;

/**
 * Render loop drawing policy. See {@link World.renderMode}.
 * @category Runtime
 */
export type RenderMode = 'continuous' | 'on-demand';

/**
 * World is the root ECS container, Three.js scene/renderer owner, and XR session gateway.
 *
 * @remarks
 * - Construct a world with {@link World.create} (recommended) which wires the renderer, scene, default systems
 *   (Input, UI, Audio, Level) and starts the render loop.
 * - The world exposes convenience handles like {@link World.input | input},
 *   {@link World.player | player} (the persistent player/XR origin), and {@link World.assetManager}.
 * - Feature systems (Grabbing, Locomotion) are opt‑in via {@link WorldOptions.features}.
 *
 * @category Runtime
 * @example
 * ```ts
 * import { World, SessionMode } from '@iwsdk/core';
 *
 * const container = document.getElementById('scene-container') as HTMLElement;
 * const world = await World.create(container, {
 *   xr: { sessionMode: SessionMode.ImmersiveVR },
 *   features: { enableLocomotion: true, enableGrabbing: true },
 *   level: '/scenes/main.iwsdk.scene.json'
 * });
 * ```
 */
export class World extends ElicsWorld {
  public input!: InputManager;
  public player!: XROrigin;
  public assetManager!: typeof AssetManager;
  /** Renderable assets registered by the application manifest. */
  public assets!: RenderableAssetRegistry;
  /** Component definitions shared by scene validation and editor tooling. */
  public componentCatalog!: SceneComponentCatalog;
  public scene!: Scene;
  public sceneEntity!: Entity;
  public activeLevel!: Signal<Entity>;
  public activeLevelId: string = 'level:default';
  public camera!: PerspectiveCamera;
  public cameraEntity!: Entity;
  public renderer!: WebGLRenderer;
  public session: XRSession | undefined;
  public visibilityState = signal(VisibilityState.NonImmersive);
  /** Whether this world was created with XR support enabled. */
  public xrEnabled = true;
  /** Whether an explicit XR session request is currently settling. @internal */
  public sessionRequestPending = false;
  public requestedLevelUrl: string | undefined;
  public requestedLevelDocument: SceneDocument | undefined;
  public _resolveLevelLoad: (() => void) | undefined;
  public _rejectLevelLoad: ((reason: unknown) => void) | undefined;
  /** Default XR options used when calling {@link World.launchXR} without overrides. */
  public xrDefaults: import('../init/xr.js').XROptions | undefined;
  /** MCP runtime for framework-specific tools. Set automatically during World.create(). */
  public mcpRuntime?: MCPRuntime;

  /** Teardown callbacks run by {@link World.destroy} (render loop, global listeners). */
  private worldCleanupFuncs: Array<() => void> = [];
  /** Guards {@link World.destroy} so a second call is a no-op. */
  private destroyed = false;
  private authoredPlayerPosition?: Vector3;
  private authoredPlayerPositionListeners = new Set<
    (position: Vector3) => void
  >();
  /** Per-frame XR callbacks registered via {@link World.onXRFrame}. */
  private xrFrameCallbacks = new Set<OnXRFrameCallback>();

  /**
   * How the render loop draws.
   *
   * - `'continuous'` (default): draw every frame.
   * - `'on-demand'`: run systems every frame but only draw frames requested
   *   through {@link World.requestRender} or {@link World.holdRender}. Scene
   *   matrices, skinned-mesh bones and the XR camera still update every frame,
   *   so raycasts, grabbing, physics, UI and MCP tooling behave as in
   *   continuous mode. Intended for headless automation on machines without a
   *   GPU, where every draw is software-rasterized.
   *
   * @category Runtime
   */
  public renderMode: RenderMode = 'continuous';
  /** Frames still to draw for pending {@link World.requestRender} calls. */
  private requestedRenderFrames = 0;
  /** Open {@link World.holdRender} holds; any open hold draws every frame. */
  private renderHolds = 0;
  /** Resolvers waiting for the requested frames to be drawn and presented. */
  private renderWaiters: Array<() => void> = [];
  /** Resolvers to release on the tick after the last requested draw. */
  private presentedRenderWaiters: Array<() => void> = [];
  private drawnFrameCount = 0;

  /** Entity wrapping the XROrigin Group (persistent, survives level changes). */
  public playerEntity!: Entity;
  /** Entity wrapping the player head Group (persistent). */
  public playerHeadEntity!: Entity;
  /** Entities for all XR input space Groups under the player rig (all persistent). */
  public playerSpaceEntities!: {
    head: Entity;
    raySpaces: { left: Entity; right: Entity };
    gripSpaces: { left: Entity; right: Entity };
    indexTipSpaces: { left: Entity; right: Entity };
  };

  constructor() {
    super();
    const originalReleaseFunc = this.entityManager.releaseEntityInstance.bind(
      this.entityManager,
    );
    this.entityManager.releaseEntityInstance = (entity: Entity) => {
      originalReleaseFunc(entity);
      const obj = entity.object3D;
      if (obj) {
        const disposeAsset = obj.userData.iwsdkDisposeAsset;
        if (typeof disposeAsset === 'function') {
          obj.userData.iwsdkDisposeAsset = null;
          disposeAsset();
        }
        // Check if entity was marked for resource disposal
        if ((entity as any)._disposeResources) {
          this.disposeObject3DResources(obj);
          delete (entity as any)._disposeResources;
        }
        obj.removeFromParent();
        delete entity.object3D;
      }
    };
  }

  /**
   * Dispose of an Object3D's GPU resources (geometry, materials, textures).
   * Traverses all descendants and cleans up disposable resources.
   *
   * @remarks
   * This is called automatically when an entity is destroyed with `disposeResources: true`.
   * Use with caution when resources may be shared across multiple entities.
   */
  private disposeObject3DResources(object: Object3D): void {
    object.traverse((child: any) => {
      // Runtime-only meshes (ContactShadow, ShadowCatcher) use resources their
      // system shares and disposes.
      if (child.userData?.iwsdkRuntimeOnly === true) {
        return;
      }

      // Dispose geometry
      if (child.geometry) {
        child.geometry.dispose();
      }

      // Dispose materials (can be single or array)
      if (child.material) {
        const materials: Material[] = Array.isArray(child.material)
          ? child.material
          : [child.material];

        for (const material of materials) {
          // Dispose textures attached to the material
          for (const key of Object.keys(material)) {
            const value = (material as any)[key];
            if (value && typeof value.dispose === 'function') {
              // Check if it's a texture (has isTexture property)
              if (value.isTexture) {
                value.dispose();
              }
            }
          }
          material.dispose();
        }
      }
    });
  }

  createEntity(): Entity {
    return super.createEntity() as Entity;
  }

  /** @internal Publish scene-authored player placement to locomotion owners. */
  setAuthoredPlayerPosition(position: Vector3): void {
    this.authoredPlayerPosition ??= new Vector3();
    this.authoredPlayerPosition.copy(position);
    for (const listener of this.authoredPlayerPositionListeners) {
      listener(this.authoredPlayerPosition);
    }
  }

  /** @internal Reconcile a locomotion owner with scene-authored placement. */
  onAuthoredPlayerPosition(listener: (position: Vector3) => void): () => void {
    this.authoredPlayerPositionListeners.add(listener);
    if (this.authoredPlayerPosition != null) {
      listener(this.authoredPlayerPosition);
    }
    return () => this.authoredPlayerPositionListeners.delete(listener);
  }

  createTransformEntity(
    object?: Object3D,
    parentOrOptions?: Entity | { parent?: Entity; persistent?: boolean },
  ): Entity {
    const entity = super.createEntity() as Entity;
    const obj = object ?? new Object3D();
    const initialVisible = obj.visible;
    // Cast to pointer-events-capable Object3D event map for downstream typing
    entity.object3D = obj as unknown as Object3D<
      Object3DEventMap & PointerEventsMap
    >;

    let parent: Entity | undefined = undefined;
    let persistent = false;

    if (parentOrOptions) {
      if (typeof (parentOrOptions as any).index === 'number') {
        parent = parentOrOptions as Entity;
      } else {
        const opts = parentOrOptions as {
          parent?: Entity;
          persistent?: boolean;
        };
        parent = opts.parent;
        persistent = !!opts.persistent;
      }
    }

    if (!parent) {
      // Avoid self-parenting for the Scene root
      const isSceneObject = (obj: Object3D) => (obj as any).isScene === true;
      if (object && isSceneObject(object)) {
        parent = undefined;
        persistent = true;
      } else {
        parent = persistent
          ? this.sceneEntity
          : (this.activeLevel?.value ?? this.sceneEntity);
      }
    }

    const parentObject = parent?.object3D;
    if (parentObject && parentObject !== obj && obj.parent !== parentObject) {
      parentObject.add(obj);
    }

    entity.addComponent(Transform, { parent });
    entity.addComponent(Visibility, { isVisible: initialVisible });

    // Tag entity with current level, unless persistent
    if (!persistent) {
      entity.addComponent(LevelTag, { id: this.activeLevelId });
    }
    return entity;
  }

  /** Find an authored scene object by its stable scene node id. */
  getSceneObject<T extends Object3D = Object3D>(nodeId: string): T | undefined {
    let result: Object3D | undefined;
    for (const root of [
      this.activeLevel?.value?.object3D,
      this.playerEntity?.object3D,
    ]) {
      if (root == null) {
        continue;
      }
      root.traverse((object) => {
        if (
          !result &&
          object.userData.iwsdkSceneNodeId === nodeId &&
          (object.userData.iwsdkSceneLevelId == null ||
            object.userData.iwsdkSceneLevelId === this.activeLevelId)
        ) {
          result = object;
        }
      });
    }
    return result as T | undefined;
  }

  /** Find an authored scene object or throw a node-oriented lookup error. */
  requireSceneObject<T extends Object3D = Object3D>(nodeId: string): T {
    const object = this.getSceneObject<T>(nodeId);
    if (!object) {
      throw new Error(
        `Scene object "${nodeId}" was not found in the active level`,
      );
    }
    return object;
  }

  /** Find the ECS entity that owns an authored scene node. */
  getSceneEntity(nodeId: string): Entity | undefined {
    const index = this.getSceneObject(nodeId)?.entityIdx;
    return typeof index === 'number'
      ? (this.entityManager.getEntityByIndex(index) as Entity | undefined)
      : undefined;
  }

  /** Find the ECS entity for an authored scene node or throw. */
  requireSceneEntity(nodeId: string): Entity {
    const entity = this.getSceneEntity(nodeId);
    if (!entity) {
      throw new Error(
        `Scene entity "${nodeId}" was not found in the active level`,
      );
    }
    return entity;
  }

  launchXR(xrOptions?: Partial<XROptions>) {
    launchXR(this, xrOptions);
  }

  /** Request a native scene JSON level change; LevelSystem performs the work and resolves. */
  async loadLevel(url?: string): Promise<void> {
    this.rejectPendingLevelLoad();
    this.requestedLevelDocument = undefined;
    this.requestedLevelUrl = url ?? '';
    return new Promise<void>((resolve, reject) => {
      this._resolveLevelLoad = resolve;
      this._rejectLevelLoad = reject;
    });
  }

  /** Request an in-memory native scene document level load; LevelSystem performs the work and resolves. */
  async loadSceneDocument(document: SceneDocument): Promise<void> {
    this.rejectPendingLevelLoad();
    this.requestedLevelUrl = undefined;
    this.requestedLevelDocument = document;
    return new Promise<void>((resolve, reject) => {
      this._resolveLevelLoad = resolve;
      this._rejectLevelLoad = reject;
    });
  }

  exitXR() {
    this.session?.end();
  }

  private rejectPendingLevelLoad(): void {
    if (this._resolveLevelLoad == null && this._rejectLevelLoad == null) {
      return;
    }
    const reject = this._rejectLevelLoad;
    this._resolveLevelLoad = undefined;
    this._rejectLevelLoad = undefined;
    reject?.(new Error('Level load was superseded by a newer request'));
  }

  /**
   * The active {@link XRSession}, or `undefined` outside XR. Alias of
   * {@link World.session}, exposed for discoverability alongside
   * {@link World.xrFrame} and {@link World.xrReferenceSpace}.
   *
   * @remarks
   * Enable WebXR features your app needs (e.g. hit-test, depth sensing) via
   * `World.create(container, { xr: { features: { hitTest: true, depthSensing: true } } })`.
   * Once granted, they appear in `world.xrSession.enabledFeatures`.
   * @category XR Runtime
   */
  get xrSession(): XRSession | undefined {
    return this.session;
  }

  /**
   * The current {@link XRFrame} for this animation-loop tick, or `null` outside
   * XR. Use it for raw WebXR access such as `frame.getViewerPose(...)`,
   * `frame.getHitTestResults(...)`, or `frame.getDepthInformation(...)`.
   *
   * @remarks
   * Read this synchronously inside an {@link World.onXRFrame} callback or a
   * System `update()` — the frame object is only valid for the current tick and
   * must not be retained across frames.
   * @category XR Runtime
   */
  get xrFrame(): XRFrame | null {
    return this.renderer?.xr.getFrame() ?? null;
  }

  /**
   * The active {@link XRReferenceSpace} that IWSDK resolved for the session, or
   * `null` outside XR. Pass it to `XRHitTestResult.getPose(space)` or
   * `XRFrame.getViewerPose(space)` to obtain poses in the world's tracking space.
   * @category XR Runtime
   */
  get xrReferenceSpace(): XRReferenceSpace | null {
    return this.renderer?.xr.getReferenceSpace() ?? null;
  }

  /**
   * Register a callback that runs once per render-loop tick with the live
   * {@link XRFrame}, without having to author a System. Useful for per-pixel
   * world alignment, hit-test queries, depth sampling, and object-anchored
   * overlays.
   *
   * @param callback Invoked with `(frame, delta, time)` while an XR session is active.
   * @returns An unsubscribe function; call it to stop receiving frames.
   * @category XR Runtime
   * @example
   * ```ts
   * const source = await world.requestHitTestSource({ space: world.xrReferenceSpace! });
   * const stop = world.onXRFrame((frame) => {
   *   if (!source) return;
   *   const [hit] = world.getHitTestResults(source);
   *   const pose = hit?.getPose(world.xrReferenceSpace!);
   *   // place a world-locked label at pose.transform.position ...
   * });
   * ```
   */
  onXRFrame(callback: OnXRFrameCallback): () => void {
    this.xrFrameCallbacks.add(callback);
    return () => {
      this.xrFrameCallbacks.delete(callback);
    };
  }

  /**
   * Invoke all callbacks registered via {@link World.onXRFrame}. Called by the
   * render loop after systems update and before rendering.
   * @internal
   */
  runXRFrameCallbacks(frame: XRFrame, delta: number, time: number): void {
    if (this.xrFrameCallbacks.size === 0) {
      return;
    }
    for (const callback of this.xrFrameCallbacks) {
      try {
        callback(frame, delta, time);
      } catch (error) {
        console.error('[World] onXRFrame callback failed:', error);
      }
    }
  }

  /**
   * Request an {@link XRHitTestSource} on the active session. Requires the
   * `hit-test` feature (enable via
   * `World.create(container, { xr: { features: { hitTest: true } } })`).
   *
   * @returns The hit-test source, or `undefined` if there is no active session
   *   or the request is unavailable/unsupported. The underlying
   *   `XRSession.requestHitTestSource` rejects when the `hit-test` feature was
   *   not granted; that rejection is caught and surfaced as `undefined` (logged
   *   as a warning) so callers can `await` without their own `try/catch`.
   * @category XR Runtime
   */
  async requestHitTestSource(
    options: XRHitTestOptionsInit,
  ): Promise<XRHitTestSource | undefined> {
    const session = this.session;
    if (!session?.requestHitTestSource) {
      return undefined;
    }
    try {
      return await session.requestHitTestSource(options);
    } catch (error) {
      console.warn(
        "[World] requestHitTestSource failed (is the 'hit-test' feature enabled?):",
        error,
      );
      return undefined;
    }
  }

  /**
   * Request an {@link XRTransientInputHitTestSource} (e.g. for screen taps or
   * transient controllers). Requires the `hit-test` feature.
   *
   * @returns The transient hit-test source, or `undefined` if unavailable. As
   *   with {@link World.requestHitTestSource}, a rejection from the underlying
   *   WebXR call (e.g. feature not granted) is caught and surfaced as
   *   `undefined`.
   * @category XR Runtime
   */
  async requestHitTestSourceForTransientInput(
    options: XRTransientInputHitTestOptionsInit,
  ): Promise<XRTransientInputHitTestSource | undefined> {
    const session = this.session;
    if (!session?.requestHitTestSourceForTransientInput) {
      return undefined;
    }
    try {
      return await session.requestHitTestSourceForTransientInput(options);
    } catch (error) {
      console.warn(
        "[World] requestHitTestSourceForTransientInput failed (is the 'hit-test' feature enabled?):",
        error,
      );
      return undefined;
    }
  }

  /**
   * Read the hit-test results for a source from the current {@link XRFrame}.
   * Returns an empty array when there is no active frame.
   * @category XR Runtime
   */
  getHitTestResults(source: XRHitTestSource): XRHitTestResult[] {
    const frame = this.xrFrame;
    if (!frame) {
      return [];
    }
    return frame.getHitTestResults(source);
  }

  /**
   * Draw the next `frames` frames even in `'on-demand'` render mode.
   *
   * Resolves once the last requested frame has been drawn and the browser has
   * started the following frame, so the drawn image has been handed to the
   * compositor. A page screenshot taken then shows it, unless something
   * clears the canvas every frame: IWER's immersive sessions do by default
   * (see its `XRDevice.frameClearEnabled`), so under that emulator hold
   * rendering with {@link World.holdRender} for the length of the capture.
   * In `'continuous'` mode this simply waits for the next `frames` frames.
   *
   * @param frames Number of frames to draw. Defaults to 1; values that are
   * not finite or are below 1 draw one frame.
   * @category Runtime
   */
  requestRender(frames = 1): Promise<void> {
    const count = Number.isFinite(frames) ? Math.max(1, Math.floor(frames)) : 1;
    this.requestedRenderFrames = Math.max(this.requestedRenderFrames, count);
    return new Promise((resolve) => {
      this.renderWaiters.push(resolve);
    });
  }

  /**
   * Draw every frame until the returned function is called, whatever
   * {@link World.renderMode} says. Holds are counted, so overlapping holds
   * (two captures, a capture during a profile) cannot end each other early.
   * The returned function is idempotent.
   *
   * @category Runtime
   */
  holdRender(): () => void {
    this.renderHolds++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.renderHolds--;
      }
    };
  }

  /**
   * Called by the render loop at the start of each tick. Returns whether this
   * tick should draw, and releases {@link World.requestRender} callers whose
   * frames were drawn on the previous tick.
   * @internal
   */
  beginRenderTick(): boolean {
    if (this.presentedRenderWaiters.length > 0) {
      const waiters = this.presentedRenderWaiters.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
    }
    let draw: boolean;
    if (this.requestedRenderFrames > 0) {
      this.requestedRenderFrames--;
      if (this.requestedRenderFrames === 0) {
        this.presentedRenderWaiters.push(...this.renderWaiters.splice(0));
      }
      draw = true;
    } else {
      // Only an explicit on-demand mode skips drawing; anything else draws.
      draw = this.renderHolds > 0 || this.renderMode !== 'on-demand';
    }
    if (draw) {
      this.drawnFrameCount++;
    }
    return draw;
  }

  /**
   * How many frames the render loop has drawn, counting the current tick
   * once it has decided to draw. Development tooling compares it across a
   * frame to tell whether the app drew that frame, for example to draw the
   * emulator's synthetic AR environment only when the app draws.
   *
   * @category Runtime
   */
  get drawnFrames(): number {
    return this.drawnFrameCount;
  }

  /**
   * Register a teardown callback to run on {@link World.destroy}. Used by the
   * initializer to undo global side effects such as the render loop and the
   * window `resize` listener.
   *
   * @internal
   */
  addCleanup(fn: () => void): void {
    this.worldCleanupFuncs.push(fn);
  }

  /**
   * Tear down the world: destroy all registered systems (running their
   * `cleanupFuncs`), then run world-level teardown callbacks (stop the render
   * loop, remove the window `resize` listener). After calling this the world
   * instance should be discarded.
   *
   * @remarks
   * Not invoked during normal single-world app usage (where the world lives for
   * the page lifetime); provided so tests, hot-reload, and multi-world hosts can
   * release the render loop, listeners, and per-system subscriptions instead of
   * leaking them. Individual failures are caught so one bad teardown does not
   * block the rest.
   */
  destroy(): void {
    // Idempotent: getSystems() keeps returning the same systems, so without
    // this guard a second destroy() would re-run every system's destroy().
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const system of this.getSystems()) {
      try {
        (system as { destroy?: () => void }).destroy?.();
      } catch (error) {
        console.error('[World] system destroy failed:', error);
      }
    }
    const fns = this.worldCleanupFuncs.splice(0);
    for (const fn of fns) {
      try {
        fn();
      } catch (error) {
        console.error('[World] cleanup failed:', error);
      }
    }
  }

  update(delta: number, time: number): void {
    super.update(delta, time);
  }

  registerComponent(component: AnyComponent): this {
    return super.registerComponent(component);
  }

  // Level root helpers
  getActiveRoot(): Object3D {
    return this.activeLevel?.value?.object3D ?? this.scene;
  }

  getPersistentRoot(): Object3D {
    return this.scene;
  }

  /**
   * Initialize a new WebXR world with all required systems and setup
   *
   * @param sceneContainer - HTML container for the renderer canvas
   * @param assets - Asset manifest for preloading
   * @param options - Configuration options for the world
   * @returns Promise that resolves to the initialized World instance
   */
  /**
   * Initialize a new WebXR world with renderer, scene, default systems, and optional level.
   *
   * @param container HTML container to which the renderer canvas will be appended.
   * @param options Runtime configuration, see {@link WorldOptions}.
   * @returns A promise that resolves to the initialized {@link World}.
   *
   * @remarks
   * - This call enables the Input, UI and Audio systems by default.
   * - Use {@link WorldOptions.features} to enable Locomotion or Grabbing.
   * - If {@link WorldOptions.level} is provided, the LevelSystem will load it after assets are preloaded.
   * @see /getting-started/01-hello-xr
   */
  static async create(
    container: HTMLElement,
    options?: WorldOptions,
  ): Promise<World> {
    armSessionGrantCaptureForOptions(options?.xr);
    const { initializeWorld } = await import('../init/world-initializer.js');
    return initializeWorld(container, options);
  }
}
