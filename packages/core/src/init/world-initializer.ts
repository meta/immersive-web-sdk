/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mergeSceneComponentCatalogs } from '@iwsdk/scene-composition';
import { XRInputManager } from '@iwsdk/xr-input';
import { signal } from '@preact/signals-core';
import {
  AssetManager,
  AssetManifest,
  RenderableAssetRegistry,
} from '../asset/index.js';
import { AudioSource, AudioSystem } from '../audio/index.js';
import { CameraSource, CameraSystem } from '../camera/index.js';
import {
  ComponentRegistry,
  IWSDK_BUILTIN_COMPONENTS,
  componentCatalogFromComponents,
  type ComponentManifest,
} from '../ecs/index.js';
import { World, VisibilityState } from '../ecs/world.js';
import {
  DomeTexture,
  DomeGradient,
  DomeFade,
  IBLTexture,
  IBLGradient,
  EnvironmentSystem,
} from '../environment/index.js';
import {
  EnvironmentRaycastSystem,
  EnvironmentRaycastTarget,
} from '../environment-raycast/index.js';
import { GazeSystem } from '../gaze/index.js';
import { GrabSystem } from '../grab/index.js';
import {
  CanvasPointerEventsOption,
  CanvasPointerSystem,
  RayInteractable,
  PokeInteractable,
  Hovered,
  InputManager,
  Pressed,
} from '../input/index.js';
import { InputSystem } from '../input/index.js';
import {
  XRQuadLayer,
  XRCylinderLayer,
  XRLayerState,
  XRLayerSystem,
} from '../layers/index.js';
import { LevelTag, LevelRoot } from '../level/index.js';
import { LevelSystem } from '../level/index.js';
import {
  AmbientLightComponent,
  DirectionalLightComponent,
  HemisphereLightComponent,
  LightSystem,
  PointLightComponent,
  RectAreaLightComponent,
  SpotLightComponent,
} from '../lighting/index.js';
import {
  type BrowserLocomotionControls,
  LocomotionSystem,
  TurningMethod,
} from '../locomotion/index.js';
import { MCPRuntime } from '../mcp/index.js';
// The physics module pulls in `@babylonjs/havok` (~2 MB WASM + engine JS) at
// the static-graph level. Load it lazily in `registerFeatureSystems` only
// when `features.physics` is enabled so non-physics projects don't pay the
// bundle-size tax.
import { createWebGLRenderer } from '../runtime/deferred-texture-uploads.js';
import {
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Timer,
  WebGLRenderer,
} from '../runtime/index.js';
import {
  SceneUnderstandingSystem,
  XRAnchor,
  XRMesh,
  XRPlane,
} from '../scene-understanding/index.js';
import { Transform, TransformSystem } from '../transform/index.js';
import {
  FollowSystem,
  Follower,
  ScreenSpace,
  ScreenSpaceUISystem,
  PanelUI,
  PanelUISystem,
  ColorScheme,
  UIKitMLComponentSet,
  UIKitMLKit,
  loadUIKitMLAsset,
} from '../ui/index.js';
import { Visibility, VisibilitySystem } from '../visibility/index.js';
import { attachCameraToPlayer } from './player-camera.js';
import {
  armSessionGrantCaptureForOptions,
  onSessionGrant,
} from './session-grant.js';
import {
  ReferenceSpaceType,
  SessionMode,
  XROptions,
  adoptXRSession,
  buildSessionInit,
} from './xr.js';

/** Options for {@link initializeWorld} / {@link World.create}.
 *
 * @category Runtime
 * @remarks
 * Defaults are tuned for VR; camera and renderer behavior can be customized through {@link WorldOptions.render}.
 */
export type WorldOptions = {
  /** Asset manifest to preload before the first frame. */
  assets?: AssetManifest;

  /** Application components registered before the initial level is loaded. */
  components?: ComponentManifest;

  /** Native scene JSON level to load after initialization. Accepts a URL string or an object with a `url` field. */
  level?: { url?: string } | string;

  /**
   * XR session options and offer behavior. Set to `false` for browser-only
   * worlds. Set `launchOnSessionGranted` to handle immersive browser entry
   * that grants a session before or after asynchronous world initialization.
   */
  xr?: false | (XROptions & { offer?: 'none' | 'once' | 'always' });

  /** Renderer & camera configuration. */
  render?: {
    /** Camera field of view in degrees. @defaultValue 50 */
    fov?: number;
    /** Near clipping plane. @defaultValue 0.1 */
    near?: number;
    /** Far clipping plane. @defaultValue 200 */
    far?: number;
    /** Enable stencil buffer. @defaultValue false */
    stencil?: boolean;
    /** Initial local camera pose under `world.player`. */
    camera?: {
      position?: [number, number, number];
      rotation?: [number, number, number];
      quaternion?: [number, number, number, number];
      lookAt?: [number, number, number];
    };
  };

  /** Browser input and pointer interaction configuration. */
  input?: {
    /**
     * Forward DOM pointer events from the renderer canvas into the Three scene.
     * @defaultValue true
     */
    canvasPointerEvents?: CanvasPointerEventsOption;
  };

  /** Opt‑in feature systems. */
  features?: {
    /** Locomotion (teleport/slide/turn). Boolean or config. @defaultValue false */
    locomotion?:
      | boolean
      | {
          useWorker?: boolean;
          initialPlayerPosition?: [number, number, number];
          comfortAssistLevel?: number;
          turningMethod?: TurningMethod;
          /** Whether jumping is enabled. @defaultValue true */
          enableJumping?: boolean;
          /**
           * Opt into browser-first locomotion bindings such as WASD, Space,
           * and standard browser gamepad movement. Camera ownership remains
           * app-controlled: rotate `world.camera` yourself for pointer-lock,
           * orbit, touch-look, or follow cameras. Locomotion moves
           * `world.player` along the camera's forward direction.
           * @defaultValue false
           */
          browserControls?: BrowserLocomotionControls;
        };
    /** Grabbing (one/two‑hand, distance). @defaultValue false */
    grabbing?: boolean | { useHandPinchForGrab?: boolean };
    /**
     * Tuning for gaze + pinch input. `GazeSystem` registration is driven by the
     * `xr.features.gazeTracking` session feature, not by this entry — this only
     * overrides the system's defaults when gaze is already active.
     */
    gaze?: {
      /** Half-angle of the gaze selection cone, in degrees. @defaultValue 5 */
      coneAngle?: number;
      /** Maximum gaze cone distance in meters. @defaultValue 30 */
      maxRayLength?: number;
      /** Dwell consensus window in seconds; `0` disables it. @defaultValue 0.15 */
      dwellWindowSeconds?: number;
      /** 1€ filter min cutoff. @defaultValue 1.5 */
      filterMinCutoff?: number;
      /** 1€ filter beta. @defaultValue 0.05 */
      filterBeta?: number;
      /** Yield to near touch/grab pointers when they're active. @defaultValue true */
      suppressWhenDirectPointerActive?: boolean;
      /** Drag from the pinching hand's ray space once selected. @defaultValue true */
      pointerTransformFollowsHand?: boolean;
      /** Emit `[iwsdk][gaze]` console diagnostics. @defaultValue true */
      logDiagnostics?: boolean;
      /** Show a developer-only gaze hit reticle. @defaultValue false */
      showDebugReticle?: boolean;
      /** Keep gaze mode active briefly after tracking becomes invalid. @defaultValue 5 */
      trackingLossGraceSeconds?: number;
    };
    /** Physics simulation (Havok). Boolean or config. @defaultValue false */
    physics?:
      | boolean
      | {
          /** Run the physics engine in a Web Worker. @defaultValue true */
          useWorker?: boolean;
          /** Fixed simulation rate in updates per second (maximum 240). @defaultValue 60 */
          updateFrequency?: number;
          /** Smooth render transforms between physics snapshots. @defaultValue true */
          interpolation?: boolean;
        };
    /** Scene Understanding (planes/meshes/anchors). Boolean or config. @defaultValue false */
    sceneUnderstanding?: boolean | { showWireFrame?: boolean };
    /** Environment Raycast (hit-test against real-world surfaces). @defaultValue false */
    environmentRaycast?: boolean;
    /** Camera access for video streaming. @defaultValue false */
    camera?: boolean;
    /** Spatial UI systems (PanelUI/ScreenSpace/Follow). Boolean or config. @defaultValue true */
    spatialUI?:
      | boolean
      | {
          /** @deprecated Use `input.canvasPointerEvents` instead. */
          forwardHtmlEvents?: boolean;
          /** Built-in UIKitML component collection. @defaultValue 'horizon' */
          kit?: UIKitMLKit;
          /** Additional application-defined UIKitML component definitions. */
          componentSets?: UIKitMLComponentSet[];
          preferredColorScheme?: ColorScheme;
        };
  };
};

type CameraPoseOptions = NonNullable<
  NonNullable<WorldOptions['render']>['camera']
>;

/**
 * Initialize a new WebXR world with all required systems and setup
 *
 * @param sceneContainer - HTML container for the renderer canvas
 * @param assets - Asset manifest for preloading
 * @param options - Configuration options for the world
 * @returns Promise that resolves to the initialized World instance
 */
/**
 * Initialize a new WebXR world with all required systems and setup.
 *
 * @param sceneContainer HTML container for the renderer canvas.
 * @param options Configuration options for the world.
 * @returns Promise that resolves to the initialized {@link World} instance.
 *
 * @remarks
 * This function powers {@link World.create}. Prefer using that static helper.
 */
export async function initializeWorld(
  container: HTMLElement,
  options: WorldOptions = {},
): Promise<World> {
  // This public entry point can be called without World.create(). Capture a
  // browser-delivered grant before any asynchronous initialization can yield.
  armSessionGrantCaptureForOptions(options.xr);

  // Create and configure world instance
  const world = createWorldInstance();
  registerApplicationComponents(world, options.components);
  world.componentCatalog = componentCatalogFromComponents(
    IWSDK_BUILTIN_COMPONENTS,
    { source: 'iwsdk' },
  );
  world.componentCatalog = mergeSceneComponentCatalogs(
    world.componentCatalog,
    componentCatalogFromComponents(options.components ?? [], { source: 'app' }),
  );

  // Extract configuration options
  const config = extractConfiguration(options);

  // Setup core rendering components
  const { camera, renderer, scene } = setupRendering(container, config);
  assignRenderingToWorld(world, camera, renderer, scene);

  // Setup input management
  setupInputManagement(world, config.input);

  // Store XR defaults for later explicit launch/offer calls
  world.xrDefaults = {
    sessionMode: config.xr.sessionMode,
    referenceSpace: config.xr.referenceSpace,
    features: config.xr.features,
    restoreCameraOnExit: config.xr.restoreCameraOnExit,
    launchOnSessionGranted: config.xr.launchOnSessionGranted,
  };
  world.xrEnabled = config.xr.enabled;

  // Register core systems
  registerCoreSystems(world);

  // Initialize asset manager
  initializeAssetManager(renderer, world);

  // Register additional systems (UI + Audio on by default)
  registerAdditionalSystems(world);

  // Register input and feature systems with explicit priorities.
  // Awaited because the physics branch dynamically imports its module so
  // `@babylonjs/havok` stays out of the static graph for non-physics builds.
  await registerFeatureSystems(world, config);

  // Setup render loop
  setupRenderLoop(world, renderer);

  // Setup resize handling
  setupResizeHandling(world, camera, renderer);

  // Setup MCP runtime for framework-specific tools (dev only).
  // In production Vite builds, import.meta.env.DEV is false and this entire
  // code path is tree-shaken. In Node.js/tests, import.meta.env is undefined
  // so the check defaults to enabled.
  if ((import.meta as any).env?.DEV !== false) {
    setupMCPRuntime(world);
  }

  // Return promise that resolves after asset preloading
  return finalizeInitialization(world, options.assets, config).then(
    async (w) => {
      // Load initial level or create empty level
      const levelUrl =
        typeof options.level === 'string' ? options.level : options.level?.url;
      if (levelUrl) {
        await w.loadLevel(levelUrl);
      } else {
        await w.loadLevel();
      }
      if (config.xr.launchOnSessionGranted) {
        const unsubscribe = onSessionGrant(
          () => {
            if (w.xrEnabled && w.session == null && !w.sessionRequestPending) {
              w.launchXR();
            }
          },
          { persistent: true },
        );
        w.addCleanup(unsubscribe);
      }
      if (config.xr.offer && config.xr.offer !== 'none') {
        manageOfferFlow(w, config.xr.offer);
      }
      return w;
    },
  );
}

/**
 * Create a new World instance with basic ECS setup
 */
function createWorldInstance(): World {
  const world = new World();
  world
    .registerComponent(Transform)
    .registerComponent(Visibility)
    .registerComponent(LevelTag)
    .registerSystem(TransformSystem)
    .registerSystem(VisibilitySystem);
  return world;
}

function registerApplicationComponents(
  world: World,
  components: ComponentManifest | undefined,
) {
  if (components == null) {
    return;
  }
  if (components.componentRegistry !== ComponentRegistry) {
    throw new Error(
      'The component manifest was created by a different Elics module instance. Ensure @iwsdk/core and elics resolve to one copy.',
    );
  }
  for (const component of components) {
    world.registerComponent(component);
  }
}

/**
 * Extract and normalize configuration options
 */
/** @internal Exported for focused policy tests; not part of the package barrel. */
export function extractConfiguration(options: WorldOptions) {
  const xrOptions = options.xr === false ? undefined : options.xr;
  const spatialUI = options.features?.spatialUI;
  const legacyForwardHtmlEvents =
    typeof spatialUI === 'object' && spatialUI
      ? spatialUI.forwardHtmlEvents
      : undefined;
  const canvasPointerEvents =
    options.input?.canvasPointerEvents ?? legacyForwardHtmlEvents;

  return {
    cameraFov: options.render?.fov ?? 50,
    cameraNear: options.render?.near ?? 0.1,
    cameraFar: options.render?.far ?? 200,
    cameraPose: options.render?.camera,
    stencil: options.render?.stencil ?? false,
    xr: {
      enabled: options.xr !== false,
      sessionMode: xrOptions?.sessionMode ?? SessionMode.ImmersiveVR,
      referenceSpace:
        xrOptions?.referenceSpace ?? ReferenceSpaceType.LocalFloor,
      features: xrOptions?.features,
      offer:
        options.xr === false || xrOptions?.launchOnSessionGranted === true
          ? 'none'
          : (xrOptions?.offer ?? 'always'),
      restoreCameraOnExit: xrOptions?.restoreCameraOnExit ?? true,
      launchOnSessionGranted: xrOptions?.launchOnSessionGranted ?? false,
    },
    input: {
      canvasPointerEvents,
    },
    features: {
      locomotion: options.features?.locomotion ?? false,
      grabbing: options.features?.grabbing ?? false,
      gaze: options.features?.gaze,
      physics: options.features?.physics ?? false,
      sceneUnderstanding: options.features?.sceneUnderstanding ?? false,
      environmentRaycast: options.features?.environmentRaycast ?? false,
      camera: options.features?.camera ?? false,
      spatialUI: options.features?.spatialUI ?? true,
    },
  } as const;
}

/**
 * Setup camera, renderer, and scene
 */
function setupRendering(sceneContainer: HTMLElement, config: any) {
  // Camera Setup
  const camera = new PerspectiveCamera(
    config.cameraFov,
    window.innerWidth / window.innerHeight,
    config.cameraNear,
    config.cameraFar,
  );
  camera.position.set(0, 1.7, 0);
  if (config.cameraPose) {
    applyCameraPose(camera, config.cameraPose);
  }

  // Renderer Setup
  const renderer = createWebGLRenderer({
    antialias: true,
    alpha:
      config.xr.enabled && config.xr.sessionMode === SessionMode.ImmersiveAR,
    multiviewStereo: true,
    stencil: config.stencil,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.xr.enabled = config.xr.enabled;
  sceneContainer.appendChild(renderer.domElement);

  // Scene Setup
  const scene = new Scene();

  return { camera, renderer, scene };
}

function applyCameraPose(
  camera: PerspectiveCamera,
  pose: CameraPoseOptions,
): void {
  if (pose.position) {
    camera.position.fromArray(pose.position);
  }
  if (pose.rotation) {
    camera.rotation.fromArray(pose.rotation);
  }
  if (pose.quaternion) {
    camera.quaternion.fromArray(pose.quaternion);
  }
  if (pose.lookAt) {
    camera.lookAt(...pose.lookAt);
  }
}

/**
 * Assign rendering components to world instance
 */
function assignRenderingToWorld(
  world: World,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
  scene: Scene,
) {
  world.scene = scene;
  world.camera = camera;
  world.renderer = renderer;
  // Scene entity (wrap Scene in an entity for parenting convenience)
  world.sceneEntity = world.createTransformEntity(scene);
  // Create a default level root so activeLevel is always defined
  const levelRootEntity = world.createTransformEntity(undefined, {
    parent: world.sceneEntity,
  });
  levelRootEntity.object3D!.name = 'LevelRoot';
  // @ts-ignore init signal now; LevelSystem will enforce identity each frame
  world.activeLevel = signal(levelRootEntity);
}

/**
 * Setup XR input management
 */
function setupInputManagement(
  world: World,
  config: ReturnType<typeof extractConfiguration>['input'],
): XRInputManager {
  const xrInputManager = new XRInputManager({
    camera: world.camera,
    scene: world.scene,
    assetLoader: AssetManager,
  });
  world.scene.add(xrInputManager.xrOrigin);
  attachCameraToPlayer(xrInputManager.xrOrigin, world.camera);
  world.player = xrInputManager.xrOrigin;
  world.input = new InputManager(xrInputManager, {
    canvasPointerEvents: config.canvasPointerEvents,
  });

  const xrOrigin = xrInputManager.xrOrigin;

  const playerEntity = world.createTransformEntity(xrOrigin, {
    parent: world.sceneEntity,
    persistent: true,
  });
  world.cameraEntity = world.createTransformEntity(world.camera, {
    parent: playerEntity,
    persistent: true,
  });

  const headEntity = world.createTransformEntity(xrOrigin.head, {
    parent: playerEntity,
    persistent: true,
  });

  const rayLeftEntity = world.createTransformEntity(xrOrigin.raySpaces.left, {
    parent: playerEntity,
    persistent: true,
  });
  const rayRightEntity = world.createTransformEntity(xrOrigin.raySpaces.right, {
    parent: playerEntity,
    persistent: true,
  });

  const gripLeftEntity = world.createTransformEntity(xrOrigin.gripSpaces.left, {
    parent: playerEntity,
    persistent: true,
  });
  const gripRightEntity = world.createTransformEntity(
    xrOrigin.gripSpaces.right,
    { parent: playerEntity, persistent: true },
  );

  const indexTipLeftEntity = world.createTransformEntity(
    xrOrigin.indexTipSpaces.left,
    { parent: playerEntity, persistent: true },
  );
  const indexTipRightEntity = world.createTransformEntity(
    xrOrigin.indexTipSpaces.right,
    { parent: playerEntity, persistent: true },
  );

  world.playerEntity = playerEntity;
  world.playerHeadEntity = headEntity;
  world.playerSpaceEntities = {
    head: headEntity,
    raySpaces: { left: rayLeftEntity, right: rayRightEntity },
    gripSpaces: { left: gripLeftEntity, right: gripRightEntity },
    indexTipSpaces: { left: indexTipLeftEntity, right: indexTipRightEntity },
  };

  return xrInputManager;
}

/**
 * Manage offering XR sessions according to the configured offer policy.
 * - 'once': offer after init; no re-offer on end
 * - 'always': offer after init and re-offer whenever the session ends
 *
 * @internal Exported for focused policy tests; not part of the package barrel.
 */
export function manageOfferFlow(world: World, mode: 'once' | 'always') {
  let offering = false;
  const offer = async () => {
    if (offering || world.session) {
      return;
    }
    offering = true;
    try {
      const opts = world.xrDefaults ?? {
        sessionMode: SessionMode.ImmersiveVR,
      };
      const sessionInit = buildSessionInit(opts as XROptions);

      const session = await navigator.xr?.offerSession?.(
        opts.sessionMode ?? SessionMode.ImmersiveVR,
        // if the dynamic import failed, rebuild via launchXR path by calling request, but we only want offer
        sessionInit as XRSessionInit,
      );
      if (!session) {
        return;
      }
      await adoptXRSession(world, session, opts as XROptions, onEnd);
    } catch (error) {
      // offerSession rejects when the runtime cannot grant the offered
      // session, e.g. the device (or IWER's emulated device) lacks a required
      // feature. Don't re-offer: an immediate rejection would spin.
      console.error('[XR] Failed to start offered XR session:', error);
    } finally {
      offering = false;
    }
  };

  const onEnd = () => {
    if (mode === 'always') {
      // Adoption can end before offer() clears its single-flight guard. Start
      // the replacement offer in the next task so that path can recover too.
      setTimeout(() => void offer(), 0);
    }
  };

  // initial offer once world is ready
  offer();
}

/**
 * Register core interaction systems
 */
function registerCoreSystems(world: World) {
  world
    .registerComponent(RayInteractable)
    .registerComponent(PokeInteractable)
    .registerComponent(Hovered)
    .registerComponent(Pressed)
    .registerComponent(LevelRoot)
    // New split components
    .registerComponent(DomeTexture)
    .registerComponent(DomeGradient)
    .registerComponent(DomeFade)
    .registerComponent(IBLTexture)
    .registerComponent(IBLGradient)
    .registerComponent(AmbientLightComponent)
    .registerComponent(HemisphereLightComponent)
    .registerComponent(DirectionalLightComponent)
    .registerComponent(PointLightComponent)
    .registerComponent(SpotLightComponent)
    .registerComponent(RectAreaLightComponent)
    // Unified environment system (background + IBL)
    .registerSystem(EnvironmentSystem)
    .registerSystem(LightSystem)
    .registerSystem(LevelSystem);
}

/**
 * Initialize the asset manager
 */
function initializeAssetManager(renderer: WebGLRenderer, world: World) {
  AssetManager.init(renderer, world);
  world.assetManager = AssetManager;
}

/**
 * Register optional systems based on configuration
 */
function registerAdditionalSystems(world: World) {
  // Audio system remains always-on
  world.registerComponent(AudioSource).registerSystem(AudioSystem);
}

async function registerFeatureSystems(
  world: World,
  config: ReturnType<typeof extractConfiguration>,
) {
  const locomotion = config.features.locomotion as
    | boolean
    | {
        useWorker?: boolean;
        initialPlayerPosition?: [number, number, number];
        comfortAssistLevel?: number;
        turningMethod?: TurningMethod;
        enableJumping?: boolean;
        browserControls?: BrowserLocomotionControls;
      };
  const locomotionEnabled = !!locomotion;
  const grabbing = config.features.grabbing as
    | boolean
    | { useHandPinchForGrab?: boolean };
  const grabbingEnabled = !!grabbing;
  const physics = config.features.physics as
    | boolean
    | {
        useWorker?: boolean;
        updateFrequency?: number;
        interpolation?: boolean;
      };
  const physicsEnabled = !!physics;
  const sceneUnderstanding = config.features.sceneUnderstanding as
    | boolean
    | { showWireFrame?: boolean };
  const sceneUnderstandingEnabled = !!sceneUnderstanding;
  const environmentRaycastEnabled = !!config.features.environmentRaycast;
  const cameraEnabled = !!config.features.camera;

  const spatialUI = config.features.spatialUI as
    | boolean
    | {
        forwardHtmlEvents?: boolean;
        kit?: UIKitMLKit;
        componentSets?: UIKitMLComponentSet[];
        preferredColorScheme?: ColorScheme;
      };
  const spatialUIEnabled = !!spatialUI;

  if (locomotionEnabled) {
    const locOpts =
      typeof locomotion === 'object' && locomotion
        ? Object.fromEntries(
            Object.entries({
              useWorker: locomotion.useWorker,
              initialPlayerPosition: locomotion.initialPlayerPosition,
              comfortAssist: locomotion.comfortAssistLevel,
              turningMethod: locomotion.turningMethod,
              enableJumping: locomotion.enableJumping,
              browserControls: locomotion.browserControls,
            }).filter(([, v]) => v !== undefined),
          )
        : undefined;
    world.registerSystem(LocomotionSystem, {
      priority: -5,
      configData: locOpts,
    });
  }
  world.registerSystem(InputSystem, {
    priority: -4,
    configData: {
      maintainScenePointers: world.input.canvasPointerEvents.enabled,
    },
  });
  if (world.input.canvasPointerEvents.enabled) {
    world.registerSystem(CanvasPointerSystem, {
      priority: -3.5,
      configData: world.input.canvasPointerEvents,
    });
  }
  // GazeSystem activates when the gazeTracking feature flag is set (or its
  // deprecated eyeTracking alias). Far rays remain active until tracked gaze
  // is usable. Gating
  // registration keeps the runtime cost out of apps that don't need gaze UI.
  if (config.xr.features?.gazeTracking || config.xr.features?.eyeTracking) {
    const gaze = config.features.gaze as
      | Record<string, number | boolean | undefined>
      | undefined;
    const gazeOpts = gaze
      ? Object.fromEntries(
          Object.entries(gaze).filter(([, v]) => v !== undefined),
        )
      : undefined;
    world.registerSystem(GazeSystem, { priority: -4, configData: gazeOpts });
  }
  if (grabbingEnabled) {
    const grabOpts =
      typeof grabbing === 'object' && grabbing
        ? Object.fromEntries(
            Object.entries({
              useHandPinchForGrab: grabbing.useHandPinchForGrab,
            }).filter(([, v]) => v !== undefined),
          )
        : undefined;
    world.registerSystem(GrabSystem, { priority: -3, configData: grabOpts });
  }

  // Physics runs after Grab so it can respect Pressed overrides.
  // Dynamically imported so the physics module (and its ~2 MB Havok WASM)
  // stays out of the static module graph for non-physics projects.
  if (physicsEnabled) {
    const { PhysicsBody, PhysicsManipulation, PhysicsShape, PhysicsSystem } =
      await import('../physics/index.js');
    const physicsOpts =
      typeof physics === 'object' && physics
        ? Object.fromEntries(
            Object.entries({
              useWorker: physics.useWorker,
              updateFrequency: physics.updateFrequency,
              interpolation: physics.interpolation,
            }).filter(([, value]) => value !== undefined),
          )
        : undefined;
    world
      .registerComponent(PhysicsBody)
      .registerComponent(PhysicsShape)
      .registerComponent(PhysicsManipulation)
      .registerSystem(PhysicsSystem, {
        priority: -2,
        configData: physicsOpts,
      });
  }

  // Scene Understanding updates plane/mesh/anchor debug after input/physics
  if (sceneUnderstandingEnabled) {
    const sceneOpts =
      typeof sceneUnderstanding === 'object' && sceneUnderstanding
        ? Object.fromEntries(
            Object.entries({
              showWireFrame: sceneUnderstanding.showWireFrame,
            }).filter(([, v]) => v !== undefined),
          )
        : undefined;
    world
      .registerComponent(XRPlane)
      .registerComponent(XRMesh)
      .registerComponent(XRAnchor)
      .registerSystem(SceneUnderstandingSystem, {
        priority: -1,
        configData: sceneOpts,
      });
  }

  // Environment Raycast system - requires hit-test feature
  if (environmentRaycastEnabled) {
    world
      .registerComponent(EnvironmentRaycastTarget)
      .registerSystem(EnvironmentRaycastSystem, {
        priority: -1,
      });
  }

  // Camera system for video streaming
  if (cameraEnabled) {
    world.registerComponent(CameraSource).registerSystem(CameraSystem);
  }

  // WebXR composition layers (quad/cylinder)
  if (config.xr.enabled && config.xr.features?.layers) {
    world
      .registerComponent(XRQuadLayer)
      .registerComponent(XRCylinderLayer)
      .registerComponent(XRLayerState)
      .registerSystem(XRLayerSystem, { priority: 1 });
  }

  // Spatial UI systems (Panel, ScreenSpace, Follow)
  if (spatialUIEnabled) {
    const kit =
      typeof spatialUI === 'object' && spatialUI ? spatialUI.kit : undefined;
    const componentSets =
      typeof spatialUI === 'object' && spatialUI
        ? spatialUI.componentSets
        : undefined;
    const preferredColorScheme =
      typeof spatialUI === 'object' && spatialUI
        ? spatialUI.preferredColorScheme
        : undefined;

    world
      .registerComponent(PanelUI)
      .registerComponent(ScreenSpace)
      .registerComponent(Follower)
      .registerSystem(PanelUISystem, {
        // Keep UIKit document updates ahead of screen-space layout publishing.
        priority: -3.8,
        configData: {
          ...(kit ? { kit } : {}),
          ...(componentSets ? { componentSets } : {}),
          ...(preferredColorScheme !== undefined
            ? { preferredColorScheme }
            : {}),
        },
      })
      .registerSystem(ScreenSpaceUISystem, {
        // Publish camera-local UI descendants after PanelUISystem updates
        // documents and before CanvasPointerSystem forwards DOM pointer events.
        priority: -3.75,
      })
      .registerSystem(FollowSystem);
  }
}

/**
 * Setup the main render loop
 */
function setupRenderLoop(world: World, renderer: WebGLRenderer) {
  // Timer replaces Clock (deprecated in three r183). Without a timestamp,
  // update() uses performance.now(), as Clock did.
  const timer = new Timer();

  const render = () => {
    timer.update();
    const delta = timer.getDelta();
    const elapsedTime = timer.getElapsed();
    world.visibilityState.value = (world.session?.visibilityState ??
      VisibilityState.NonImmersive) as VisibilityState;
    // Run ECS systems in priority order (InputSystem => LocomotionSystem => GrabSystem)
    world.update(delta, elapsedTime);
    // Fan out the live XRFrame to userland callbacks (world.onXRFrame) after
    // systems update and before rendering. Guarded so non-XR ticks and worlds
    // with no subscribers pay nothing.
    const xrFrame = renderer.xr.getFrame?.();
    if (xrFrame) {
      world.runXRFrameCallbacks(xrFrame, delta, elapsedTime);
    }
    renderer.render(world.scene, world.camera);
  };

  renderer.setAnimationLoop(render);
  // Allow World.destroy() to stop the loop (otherwise it keeps the world,
  // renderer, scene and camera alive forever via the render closure).
  world.addCleanup(() => renderer.setAnimationLoop(null));

  // No explicit sessionend handling required on r177; WebXRManager handles
  // render target and canvas sizing restoration internally.
}

/**
 * Setup window resize handling
 */
function setupResizeHandling(
  world: World,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
) {
  const onWindowResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  window.addEventListener('resize', onWindowResize, false);
  // Allow World.destroy() to remove this listener (otherwise it fires forever
  // and pins the camera/renderer captured in the closure).
  world.addCleanup(() =>
    window.removeEventListener('resize', onWindowResize, false),
  );
}

/**
 * Finalize initialization with asset preloading
 */
function finalizeInitialization(
  world: World,
  assets?: AssetManifest,
  config?: ReturnType<typeof extractConfiguration>,
): Promise<World> {
  const spatialUI = config?.features.spatialUI;
  world.assets = new RenderableAssetRegistry(assets, {
    ...(spatialUI
      ? {
          instantiateUIKitML: async (assetId: string) => {
            const options = typeof spatialUI === 'object' ? spatialUI : {};
            const asset = await loadUIKitMLAsset(assetId, {
              ...(options.kit ? { kit: options.kit } : {}),
              ...(options.componentSets
                ? { componentSets: options.componentSets }
                : {}),
              ...(options.preferredColorScheme !== undefined
                ? { preferredColorScheme: options.preferredColorScheme }
                : {}),
            });
            asset.userData.iwsdkDisposeAsset = () => asset.dispose();
            return asset;
          },
        }
      : {}),
  });
  return world.assets.preload().then(() => world);
}

/**
 * Setup MCP runtime for framework-specific tools.
 * This creates the MCPRuntime and exposes it on window.FRAMEWORK_MCP_RUNTIME
 * for vite-plugin-dev to route framework-specific tool calls.
 */
function setupMCPRuntime(world: World) {
  world.mcpRuntime = new MCPRuntime(world);

  // Expose globally for vite-plugin discovery
  // This allows the vite plugin to route framework-specific MCP tools
  // without having a direct dependency on @iwsdk/core
  if (typeof window !== 'undefined') {
    (window as any).FRAMEWORK_MCP_RUNTIME = world.mcpRuntime;
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('iwsdk:mcp-runtime-ready'));
    }
  }
}
