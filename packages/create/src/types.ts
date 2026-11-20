/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export type ExperienceTarget = 'vr' | 'ar' | 'browser';
export type XRMode = Exclude<ExperienceTarget, 'browser'>;
export type Language = 'ts' | 'js';
export type TriState = 'no' | 'optional' | 'required';

export type FeatureFlags = {
  locomotionEnabled: boolean;
  locomotionUseWorker?: boolean;
  locomotionBrowserControls?: boolean;
  grabbingEnabled: boolean;
  physicsEnabled: boolean;
  sceneUnderstandingEnabled: boolean;
  environmentRaycastEnabled: boolean;
};

export type ActionItem = {
  message: string;
  level?: 'info' | 'warning' | 'important';
};

export type PromptResult = {
  name: string;
  installNow: boolean;
  target: ExperienceTarget;
  xrEnabled: boolean;
  mode?: XRMode;
  language: Language;
  featureFlags: FeatureFlags;
  /** Features set by a flag or a setup prompt, not by the recommended defaults. */
  featureOverrides?: Partial<FeatureFlags>;
  gitInit: boolean;
  xrFeatureStates: Record<string, TriState>;
  actionItems?: ActionItem[];
  prerequisites?: ActionItem[];
};
