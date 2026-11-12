/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DevUI } from '@iwer/devui';
import { SyntheticEnvironmentModule } from '@iwer/sem';
import {
  getNativeOverrideSupport,
  installNativeOverride,
  XRDevice,
  metaQuest2,
  metaQuest3,
  metaQuestPro,
  metaVRGlasses,
  oculusQuest1,
} from 'iwer';
import {
  connectFrameworkTargetResolver,
  initMCPBridge,
  initMCPClient,
} from './mcp/ws-client.js';
import {
  configureOnDemandEmulator,
  type OnDemandEmulatorWindow,
} from './on-demand-emulator.js';
import type { ProcessedDevOptions } from './types.js';

type XRDeviceConfig = ConstructorParameters<typeof XRDevice>[0];

// IWER's Meta VR Glasses profile leaves gaze off until the WebXR feature name
// is final. IWSDK lists the current descriptors here so both the desktop
// emulator and the on-headset gaze preview expose a gaze input source.
const GAZE_SESSION_FEATURES = ['gaze-tracking', 'eye-tracking'] as const;
const META_VR_GLASSES_WITH_GAZE: XRDeviceConfig = {
  ...metaVRGlasses,
  supportedFeatures: [
    ...metaVRGlasses.supportedFeatures,
    ...GAZE_SESSION_FEATURES,
  ],
};

// Device configuration mapping
const DEVICE_CONFIGS = {
  metaQuest2,
  metaQuest3,
  metaQuestPro,
  metaVRGlasses: META_VR_GLASSES_WITH_GAZE,
  oculusQuest1,
} as const;

// IWSDK offers SEM's built-in GLTS rooms (plus environments added at runtime),
// not the legacy capture rooms, so they are left out of the list the DevUI
// environment menu shows. Their data is not in the runtime either.
class IWSDKSyntheticEnvironmentModule extends SyntheticEnvironmentModule {
  get environments(): string[] {
    return super.environments.filter(
      (id) => this.environmentInfo(id)?.kind !== 'legacy-scan',
    );
  }
}

// Activation check function
function shouldActivate(
  activationMode: ProcessedDevOptions['activation'],
  userAgentException?: ProcessedDevOptions['userAgentException'],
  iwer?: ProcessedDevOptions['iwer'],
): boolean {
  // IWER is opt-out. `false` should never reach here (the plugin skips bundle
  // generation entirely when iwer is false), but guard defensively.
  if (iwer === false) {
    return false;
  }

  // UA exception: if provided and matches current UA, block activation
  if (userAgentException) {
    const ua = navigator.userAgent || '';

    if (userAgentException instanceof RegExp) {
      if (userAgentException.test(ua)) {
        return false;
      }
    } else if (
      typeof userAgentException === 'string' &&
      userAgentException.startsWith('/') &&
      userAgentException.endsWith('/')
    ) {
      const pattern = userAgentException.slice(1, -1);
      try {
        const regex = new RegExp(pattern);
        if (regex.test(ua)) {
          return false;
        }
      } catch {
        // ignore invalid pattern; fail open to activation checks
      }
    }
  }

  if (activationMode === 'always') {
    return true;
  }

  if (activationMode === 'localhost') {
    return (
      location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    );
  }

  // If activationMode is a RegExp object, test it directly
  if (activationMode instanceof RegExp) {
    return activationMode.test(location.hostname);
  }

  // If activationMode is a regex pattern (as a string), test it
  if (typeof activationMode === 'string') {
    if (
      (activationMode as string).startsWith('/') &&
      (activationMode as string).endsWith('/')
    ) {
      const pattern = (activationMode as string).slice(1, -1); // Remove leading and trailing slashes
      const regex = new RegExp(pattern);
      return regex.test(location.hostname);
    }
  }

  return false;
}

// Main injection function
function initDevRuntime(config: ProcessedDevOptions): void {
  console.log('[IWSDK Dev] Configuration:', config);

  const hostEnvironment = (window as any).__IWSDK_HOST_BROWSER_ENVIRONMENT ?? {
    platform:
      (navigator as any).userAgentData?.platform || navigator.platform || null,
    userAgent: navigator.userAgent,
  };
  (window as any).__IWSDK_HOST_BROWSER_ENVIRONMENT = hostEnvironment;
  (window as any).__IWSDK_EMULATION_PROFILE = {
    active: false,
    device: null,
    runtime: null,
  };
  (window as any).__IWSDK_TARGET_DEVICE_PREVIEW__ = {
    active: false,
    gazeSimulation: false,
  };

  const isManagedTab = (window as any).__IWER_MCP_MANAGED === true;
  const isQuestBrowser = /OculusBrowser/i.test(navigator.userAgent || '');
  const nativeOverrideRequested = config.nativeXRControl;
  const targetPreviewActive =
    !nativeOverrideRequested &&
    isQuestBrowser &&
    config.targetDevicePreview?.gazeSimulation === 'head';
  const hasHeadsetPairing =
    new URL(location.href).searchParams.has('__iwsdk_headset') ||
    sessionStorage.getItem('iwsdk:headset-token') != null;

  // Native control is deliberately scoped to Meta Quest Browser. Never fall
  // through to force-installing desktop emulation when the caller explicitly
  // requested native ownership on an unsupported browser.
  if (nativeOverrideRequested && !isQuestBrowser) {
    console.error(
      '[IWSDK Dev] Native XR control requires Meta Quest Browser; refusing ' +
        "to replace this browser's native navigator.xr with desktop emulation.",
    );
    return;
  }

  if (
    config.workspace &&
    isQuestBrowser &&
    hasHeadsetPairing &&
    !nativeOverrideRequested &&
    !targetPreviewActive
  ) {
    (window as any).IWER_MCP = initMCPBridge({
      deviceClass: 'physical',
      verbose: config.verbose,
    });
    return;
  }

  // The native command surface does not depend on WebXR emulation.
  // Browser-first starters intentionally keep IWER disabled; connect both the
  // managed editor and its managed app frame while leaving normal tabs alone.
  if (config.workspace && config.iwer === false && isManagedTab) {
    (window as any).IWER_MCP = initMCPBridge({ verbose: config.verbose });
  }

  const shouldActivateResult =
    nativeOverrideRequested || targetPreviewActive
      ? config.iwer !== false
      : shouldActivate(
          config.activation,
          config.userAgentException,
          config.iwer,
        );

  if (!shouldActivateResult) {
    if (config.verbose) {
      const reason =
        config.iwer === false
          ? 'IWER disabled (iwer: false)'
          : 'activation conditions not met (localhost / user-agent)';
      console.log(`[IWSDK Dev] Skipping activation - ${reason}`);
    }
    return;
  }

  if (config.verbose) {
    console.log('[IWSDK Dev] 🎯 Activating IWER runtime...');
  }

  try {
    // Create and configure XR device with the specified device config
    const deviceConfig =
      DEVICE_CONFIGS[config.device as keyof typeof DEVICE_CONFIGS];

    if (!deviceConfig) {
      const availableDevices = Object.keys(DEVICE_CONFIGS).join(', ');
      console.error(
        `[IWSDK Dev] ❌ Invalid device configuration: "${config.device}"\n` +
          `Available devices: ${availableDevices}\n` +
          `Falling back to default device: metaQuest3`,
      );
    }

    // The on-headset preview keeps the browser's native session and only adds
    // head-directed gaze, so it always previews the gaze-capable target.
    const finalDeviceConfig = targetPreviewActive
      ? META_VR_GLASSES_WITH_GAZE
      : deviceConfig || metaQuest3;
    const xrDevice = new XRDevice(finalDeviceConfig);

    // Managed sessions can render on demand: keep drawn frames on the
    // emulator's canvas and draw the AR room only when the app draws.
    configureOnDemandEmulator(
      xrDevice,
      window as OnDemandEmulatorWindow,
      config.verbose ? (message) => console.log(message) : undefined,
    );

    if (config.verbose) {
      console.log(
        '[IWSDK Dev] 📱 Using device configuration:',
        targetPreviewActive
          ? 'metaVRGlasses (gaze preview)'
          : deviceConfig
            ? config.device
            : 'metaQuest3 (fallback)',
      );
    }

    if (nativeOverrideRequested || targetPreviewActive) {
      const label = targetPreviewActive ? 'Gaze preview' : 'Native XR control';
      const support = getNativeOverrideSupport();
      if (!support.supported) {
        console.error(
          `[IWSDK Dev] ${label} is unavailable:`,
          support.notes.join(' '),
        );
        return;
      }
      // `gaze-only` keeps the browser's native viewer, hands, and controllers
      // and adds a head-directed gaze source when the app requests gaze.
      const nativeOverride = installNativeOverride(xrDevice, {
        mode: targetPreviewActive ? 'gaze-only' : 'full',
        onUnsupported: 'warn',
      });
      if (!nativeOverride.installed) {
        console.error(
          `[IWSDK Dev] ${label} could not patch this browser:`,
          nativeOverride.capabilities.notes.join(' '),
        );
        return;
      }
      if (targetPreviewActive) {
        (window as any).__IWSDK_TARGET_DEVICE_PREVIEW__ = {
          active: true,
          gazeSimulation: 'head',
        };
      }
      (window as any).IWER_NATIVE_OVERRIDE = nativeOverride;
    } else {
      // The desktop emulator must own navigator.xr even when Chrome exposes a
      // native-but-unusable WebXR surface in headless mode.
      xrDevice.installRuntime({ forceInstall: true });
    }
    (window as any).__IWSDK_EMULATION_PROFILE = {
      active: true,
      device: targetPreviewActive ? 'metaVRGlasses' : config.device,
      runtime: nativeOverrideRequested
        ? 'IWER-native-override'
        : targetPreviewActive
          ? 'IWER-native-gaze'
          : 'IWER',
    };

    // DevUI visibility per session:
    // - Normal browser tabs (not Playwright-managed): always show DevUI
    // - Playwright-managed tabs: follow the mode's devUI setting
    if (
      !nativeOverrideRequested &&
      !targetPreviewActive &&
      (!config.ai || !isManagedTab || config.ai.devUI)
    ) {
      xrDevice.installDevUI(DevUI);
    }

    // Configure SEM if provided
    if (config.sem && !nativeOverrideRequested && !targetPreviewActive) {
      if (config.verbose) {
        console.log(
          '[IWSDK Dev] 🌐 Installing SEM with scene:',
          config.sem.defaultScene,
        );
      }

      xrDevice.installSEM(IWSDKSyntheticEnvironmentModule);

      if (config.verbose) {
        console.log(
          '[IWSDK Dev] 📍 Loading environment:',
          config.sem.defaultScene,
        );
      }

      // The room and GLTS load lazily, as separate runtime chunks.
      const defaultScene = config.sem.defaultScene;
      xrDevice.sem
        ?.loadDefaultEnvironment(defaultScene)
        .catch((error: unknown) =>
          console.error(
            `[IWSDK Dev] ❌ Failed to load environment ${defaultScene}:`,
            error,
          ),
        );
    }

    // Hand sequences resolve target names through the IWSDK world.
    connectFrameworkTargetResolver(xrDevice);

    // Managed desktop tabs and the explicitly enabled physical headset expose
    // the same command surface. A paired target-device preview also owns an
    // IWER gaze device, so publish that richer control surface instead of the
    // device-less headset bridge used by ordinary native sessions.
    const pairedTargetPreview = targetPreviewActive && hasHeadsetPairing;
    if (
      config.workspace &&
      (isManagedTab || nativeOverrideRequested || pairedTargetPreview)
    ) {
      if (config.verbose) {
        console.log('[IWSDK Dev] 🔌 Initializing MCP client...');
      }

      const mcpClient = initMCPClient(xrDevice, {
        deviceClass:
          nativeOverrideRequested || pairedTargetPreview
            ? 'physical'
            : 'managed',
        verbose: config.verbose,
      });

      // Expose MCP client for debugging
      (window as any).IWER_MCP = mcpClient;

      if (config.verbose) {
        console.log('[IWSDK Dev] ✅ MCP client initialized');
      }
    }

    if (config.verbose) {
      console.log('[IWSDK Dev] ✅ Runtime activated successfully!');
    }

    // Expose for debugging
    (window as any).IWER_DEVICE = xrDevice;
  } catch (error) {
    console.error('[IWSDK Dev] ❌ Failed to activate runtime:', error);
  }
}

/** Starts the emulator runtime; the plugin's injected module passes the config. */
export function startIwsdkDevRuntime(config: ProcessedDevOptions): void {
  initDevRuntime(config);
}
