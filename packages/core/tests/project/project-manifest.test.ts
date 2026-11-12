/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import type { WorldOptions } from '../../src/init/world-initializer.js';
import {
  IWSDK_PROJECT_MANIFEST_VERSION,
  ProjectManifestValidationError,
  assertValidIwsdkProjectManifest,
  normalizeProjectDevOptions,
  normalizeProjectWorldOptions,
  validateIwsdkProjectManifest,
  LEGACY_EMULATOR_ENVIRONMENT_ROOMS,
  PROJECT_EMULATOR_ROOMS,
  resolveProjectEmulatorRoom,
  type IwsdkProjectManifestV1,
} from '../../src/project/index.js';

const vrManifest = {
  $schema:
    './node_modules/@iwsdk/core/dist/schemas/iwsdk-project.v1.schema.json',
  version: IWSDK_PROJECT_MANIFEST_VERSION,
  scene: './public/scenes/main.iwsdk.scene.json',
  assets: { module: './src/assets' },
  components: { module: './src/components' },
  world: {
    xr: {
      mode: 'vr',
      offer: 'always',
      referenceSpace: {
        type: 'local-floor',
        required: false,
        fallbackOrder: ['local', 'viewer'],
      },
      restoreCameraOnExit: true,
      launchOnSessionGranted: true,
      features: {
        handTracking: { required: true },
        anchors: false,
        hitTest: true,
        planeDetection: false,
        meshDetection: false,
        layers: true,
        unbounded: false,
      },
    },
    input: {
      canvasPointerEvents: { enabled: true, activeDuringXR: false },
    },
    render: {
      fov: 50,
      near: 0.001,
      far: 300,
      stencil: true,
      camera: {
        position: [0, 1.6, 3],
        rotation: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        lookAt: [0, 1, 0],
      },
    },
    features: {
      locomotion: {
        useWorker: true,
        initialPlayerPosition: [-4, 0, -6],
        comfortAssistLevel: 0.5,
        turningMethod: 'snap',
        enableJumping: true,
        browserControls: {
          keyboard: true,
          gamepad: true,
        },
      },
      grabbing: { useHandPinchForGrab: true },
      gaze: {
        coneAngle: 7,
        maxRayLength: 12,
        dwellWindowSeconds: 0.2,
        filterMinCutoff: 2,
        filterBeta: 0.1,
        trackingLossGraceSeconds: 3,
        suppressWhenDirectPointerActive: false,
        pointerTransformFollowsHand: false,
        logDiagnostics: false,
        showDebugReticle: true,
      },
      physics: { useWorker: false, updateFrequency: 60, interpolation: true },
      sceneUnderstanding: { showWireFrame: false },
      environmentRaycast: false,
      camera: false,
      spatialUI: {
        forwardHtmlEvents: true,
        kit: 'horizon',
        preferredColorScheme: 'dark',
      },
    },
  },
  dev: {
    emulator: {
      device: 'metaVRGlasses',
      iwer: true,
      activation: 'always',
      injectOnBuild: true,
      userAgentException: { source: 'OculusBrowser', flags: 'i' },
    },
    targetDevicePreview: {
      gazeSimulation: 'head',
    },
  },
} as const satisfies IwsdkProjectManifestV1;

describe('iwsdk.project.v1 validation and normalization', () => {
  it('accepts the built-in rooms and still accepts legacy capture room ids', () => {
    const withEnvironment = (environment: string) => ({
      ...vrManifest,
      dev: { emulator: { environment } },
    });
    for (const id of [
      ...PROJECT_EMULATOR_ROOMS,
      ...Object.keys(LEGACY_EMULATOR_ENVIRONMENT_ROOMS),
    ]) {
      expect(validateIwsdkProjectManifest(withEnvironment(id)).valid).toBe(
        true,
      );
    }
    const invalid = validateIwsdkProjectManifest(withEnvironment('garage'));
    expect(invalid.valid).toBe(false);
    expect(invalid.issues[0]?.message).toBe(
      'expected one of the built-in rooms: "sunlit_living_room", "home_office", "conference_room", "open_office", "kitchen", "bedroom", "music_studio", "open_studio"',
    );

    expect(resolveProjectEmulatorRoom('kitchen')).toBe('kitchen');
    expect(resolveProjectEmulatorRoom('living_room')).toBe(
      'sunlit_living_room',
    );
    expect(resolveProjectEmulatorRoom('office_small')).toBe('home_office');
  });

  it('normalizes a complete VR manifest to the existing WorldOptions shape', () => {
    expect(validateIwsdkProjectManifest(vrManifest)).toEqual({
      valid: true,
      issues: [],
    });

    const normalized = normalizeProjectWorldOptions(vrManifest);
    const worldOptions: WorldOptions = normalized;

    expect(worldOptions).toEqual({
      level: './scenes/main.iwsdk.scene.json',
      xr: {
        sessionMode: 'immersive-vr',
        offer: 'always',
        referenceSpace: {
          type: 'local-floor',
          required: false,
          fallbackOrder: ['local', 'viewer'],
        },
        restoreCameraOnExit: true,
        launchOnSessionGranted: true,
        features: {
          handTracking: { required: true },
          anchors: false,
          hitTest: true,
          planeDetection: false,
          meshDetection: false,
          layers: true,
          unbounded: false,
        },
      },
      input: {
        canvasPointerEvents: { enabled: true, activeDuringXR: false },
      },
      render: {
        fov: 50,
        near: 0.001,
        far: 300,
        stencil: true,
        camera: {
          position: [0, 1.6, 3],
          rotation: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          lookAt: [0, 1, 0],
        },
      },
      features: {
        locomotion: {
          useWorker: true,
          initialPlayerPosition: [-4, 0, -6],
          comfortAssistLevel: 0.5,
          turningMethod: 1,
          enableJumping: true,
          browserControls: {
            keyboard: true,
            gamepad: true,
          },
        },
        grabbing: { useHandPinchForGrab: true },
        gaze: {
          coneAngle: 7,
          maxRayLength: 12,
          dwellWindowSeconds: 0.2,
          filterMinCutoff: 2,
          filterBeta: 0.1,
          trackingLossGraceSeconds: 3,
          suppressWhenDirectPointerActive: false,
          pointerTransformFollowsHand: false,
          logDiagnostics: false,
          showDebugReticle: true,
        },
        physics: { useWorker: false, updateFrequency: 60, interpolation: true },
        sceneUnderstanding: { showWireFrame: false },
        environmentRaycast: false,
        camera: false,
        spatialUI: {
          forwardHtmlEvents: true,
          kit: 'horizon',
          preferredColorScheme: 'dark',
        },
      },
    });
    expect(normalizeProjectDevOptions(vrManifest)).toEqual({
      emulator: {
        device: 'metaVRGlasses',
        iwer: true,
        activation: 'always',
        injectOnBuild: true,
        userAgentException: /OculusBrowser/i,
      },
      targetDevicePreview: {
        gazeSimulation: 'head',
      },
    });
  });

  it('preserves boolean physics enablement for existing manifests', () => {
    const manifest = structuredClone(vrManifest) as any;
    manifest.world.features.physics = true;

    expect(validateIwsdkProjectManifest(manifest)).toEqual({
      valid: true,
      issues: [],
    });
    expect(normalizeProjectWorldOptions(manifest).features?.physics).toBe(true);
  });

  it('preserves structured AR depth-sensing and required feature flags', () => {
    const manifest = {
      version: IWSDK_PROJECT_MANIFEST_VERSION,
      scene: './public/scenes/main.iwsdk.scene.json',
      world: {
        xr: {
          mode: 'ar',
          offer: 'once',
          referenceSpace: 'unbounded',
          features: {
            depthSensing: {
              required: true,
              usage: 'gpu-optimized',
              format: 'float32',
            },
            hitTest: { required: true },
            anchors: { required: true },
            planeDetection: { required: true },
            meshDetection: { required: true },
            unbounded: { required: true },
          },
        },
        features: {
          locomotion: false,
          grabbing: true,
          sceneUnderstanding: true,
          environmentRaycast: true,
          camera: true,
        },
      },
      dev: {
        emulator: {
          environment: 'sunlit_living_room',
          activation: { source: '^(localhost|127\\.0\\.0\\.1)$', flags: 'i' },
          injectOnBuild: false,
        },
      },
    } as const satisfies IwsdkProjectManifestV1;

    expect(validateIwsdkProjectManifest(manifest).valid).toBe(true);
    expect(normalizeProjectWorldOptions(manifest)).toMatchObject({
      xr: {
        sessionMode: 'immersive-ar',
        referenceSpace: 'unbounded',
        features: {
          depthSensing: {
            required: true,
            usage: 'gpu-optimized',
            format: 'float32',
          },
        },
      },
    });
    const dev = normalizeProjectDevOptions(manifest);
    expect(dev.emulator?.activation).toBeInstanceOf(RegExp);
    expect((dev.emulator?.activation as RegExp).flags).toContain('i');
    expect((dev.emulator?.activation as RegExp).test('LOCALHOST')).toBe(true);
  });

  it('normalizes Desktop XR false and readable smooth turning', () => {
    const manifest = {
      version: IWSDK_PROJECT_MANIFEST_VERSION,
      scene: 'public/scenes/main.iwsdk.scene.json',
      world: {
        xr: false,
        input: { canvasPointerEvents: true },
        render: {
          camera: { position: [0, 1.6, 0], lookAt: [0, 1.55, -1] },
        },
        features: {
          locomotion: {
            turningMethod: 'smooth',
            browserControls: true,
          },
        },
      },
      dev: {
        emulator: { iwer: false, activation: 'localhost' },
      },
    } as const satisfies IwsdkProjectManifestV1;

    expect(normalizeProjectWorldOptions(manifest)).toEqual({
      level: './scenes/main.iwsdk.scene.json',
      xr: false,
      input: { canvasPointerEvents: true },
      render: {
        camera: { position: [0, 1.6, 0], lookAt: [0, 1.55, -1] },
      },
      features: {
        locomotion: { turningMethod: 2, browserControls: true },
      },
    });
    expect(normalizeProjectDevOptions(manifest)).toEqual({
      emulator: { iwer: false, activation: 'localhost' },
    });
  });

  it('reports unknown keys and unsupported executable spatial UI values at JSON paths', () => {
    const invalid = structuredClone(vrManifest) as unknown as Record<
      string,
      any
    >;
    invalid.extra = true;
    invalid.world.xr.features.unrecognized = true;
    invalid.world.features.spatialUI.componentSets = [];
    invalid.world.features.locomotion.browserControls.pointerLock = false;
    invalid.world.features.physics.extra = true;
    invalid.world.features.gaze.coneAngleDeg = 5;
    invalid.dev.emulator.verbose = true;
    invalid.dev.targetDevicePreview.fovMask = true;
    invalid.dev.targetDevicePreview.gazeSimulation = 'cursor';

    const issues = validateIwsdkProjectManifest(invalid).issues;
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '$.extra', code: 'unknown-key' }),
        expect.objectContaining({
          path: '$.world.features.gaze.coneAngleDeg',
          code: 'unknown-key',
        }),
        expect.objectContaining({
          path: '$.world.xr.features.unrecognized',
          code: 'unknown-key',
        }),
        expect.objectContaining({
          path: '$.world.features.spatialUI.componentSets',
          code: 'unknown-key',
        }),
        expect.objectContaining({
          path: '$.world.features.locomotion.browserControls.pointerLock',
          code: 'unknown-key',
        }),
        expect.objectContaining({
          path: '$.world.features.physics.extra',
          code: 'unknown-key',
        }),
        expect.objectContaining({
          path: '$.dev.emulator.verbose',
          code: 'unknown-key',
        }),
        expect.objectContaining({
          path: '$.dev.targetDevicePreview.fovMask',
          code: 'unknown-key',
        }),
        expect.objectContaining({
          path: '$.dev.targetDevicePreview.gazeSimulation',
          code: 'enum',
        }),
      ]),
    );
  });

  it('reports missing fields, invalid versions, types, enums, tuples, and regexes together', () => {
    const invalid = {
      version: 'iwsdk.project.v2',
      scene: './public/scenes/main.json',
      assets: {},
      world: {
        xr: {
          offer: 'sometimes',
          features: {
            depthSensing: {
              usage: 'fastest',
              format: 'rgba8',
            },
          },
        },
        render: { camera: { position: [0, Number.NaN] } },
        features: {
          locomotion: { turningMethod: 'continuous' },
          physics: {
            useWorker: 'yes',
            updateFrequency: 0,
            interpolation: 'yes',
          },
        },
      },
      dev: {
        emulator: {
          activation: { source: '[', flags: 'ii' },
          userAgentException: { source: '' },
        },
        workspace: { enabled: true },
      },
    };

    const issues = validateIwsdkProjectManifest(invalid).issues;
    for (const path of [
      '$.version',
      '$.scene',
      '$.assets.module',
      '$.world.xr.mode',
      '$.world.xr.offer',
      '$.world.xr.features.depthSensing.usage',
      '$.world.xr.features.depthSensing.format',
      '$.world.render.camera.position',
      '$.world.features.locomotion.turningMethod',
      '$.world.features.physics.useWorker',
      '$.world.features.physics.updateFrequency',
      '$.world.features.physics.interpolation',
      '$.dev.emulator.activation',
      '$.dev.emulator.userAgentException.source',
      '$.dev.workspace',
    ]) {
      expect(issues, path).toEqual(
        expect.arrayContaining([expect.objectContaining({ path })]),
      );
    }
  });

  it('accepts the dev agent-guidance modes and rejects others', () => {
    for (const mode of ['auto', 'warn', 'off']) {
      const manifest = structuredClone(vrManifest) as unknown as Record<
        string,
        any
      >;
      manifest.dev = { agentGuidance: mode };
      expect(validateIwsdkProjectManifest(manifest).valid).toBe(true);
    }
    const invalid = structuredClone(vrManifest) as unknown as Record<
      string,
      any
    >;
    invalid.dev = { agentGuidance: 'always' };
    expect(validateIwsdkProjectManifest(invalid).issues).toEqual([
      expect.objectContaining({ path: '$.dev.agentGuidance', code: 'enum' }),
    ]);
  });

  it('rejects non-boolean, non-object physics configuration', () => {
    const invalid = structuredClone(vrManifest) as unknown as Record<
      string,
      any
    >;
    invalid.world.features.physics = 'yes';

    expect(validateIwsdkProjectManifest(invalid).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.world.features.physics',
          code: 'type',
        }),
      ]),
    );
  });

  it.each([
    ['coneAngle', 0, 'expected a number greater than 0 and less than 180'],
    ['coneAngle', 180, 'expected a number greater than 0 and less than 180'],
    ['maxRayLength', -1, 'expected a positive number'],
    ['dwellWindowSeconds', -0.1, 'expected a non-negative number'],
    ['filterMinCutoff', 0, 'expected a positive number'],
    ['filterBeta', -0.1, 'expected a non-negative number'],
    ['trackingLossGraceSeconds', -1, 'expected a non-negative number'],
  ] as const)(
    'rejects an out-of-range gaze %s',
    (key, value, expectedMessage) => {
      const invalid = structuredClone(vrManifest) as unknown as Record<
        string,
        any
      >;
      invalid.world.features.gaze[key] = value;

      expect(validateIwsdkProjectManifest(invalid).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `$.world.features.gaze.${key}`,
            code: 'range',
            message: expectedMessage,
          }),
        ]),
      );
    },
  );

  it('throws a path-rich aggregate error before normalization', () => {
    expect(() => assertValidIwsdkProjectManifest({ version: 'wrong' })).toThrow(
      ProjectManifestValidationError,
    );
    expect(() => normalizeProjectWorldOptions({ version: 'wrong' })).toThrow(
      /\$\.scene: required property is missing/u,
    );
  });
});
