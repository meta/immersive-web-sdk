/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { SceneEnvironment } from '@iwsdk/scene-composition';
import {
  ACESFilmicToneMapping,
  BasicShadowMap,
  CineonToneMapping,
  Fog,
  FogExp2,
  LinearToneMapping,
  NoToneMapping,
  PCFShadowMap,
  ReinhardToneMapping,
  Scene,
  WebGLRenderer,
} from '../runtime/index.js';

export interface SceneEnvironmentState {
  fog: Scene['fog'];
  shadows: boolean;
  shadowMapType: WebGLRenderer['shadowMap']['type'];
  toneMapping: WebGLRenderer['toneMapping'];
  toneMappingExposure: number;
  userDataEnvironment: unknown;
}

/** Capture every renderer-global value changed by applySceneEnvironment. */
export function captureSceneEnvironment(
  scene: Scene,
  renderer: WebGLRenderer,
): SceneEnvironmentState {
  return {
    fog: scene.fog,
    shadows: renderer.shadowMap.enabled,
    shadowMapType: renderer.shadowMap.type,
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
    userDataEnvironment: scene.userData.iwsdkSceneEnvironment,
  };
}

/**
 * Atomically apply scene environment fields and return the exact prior state.
 *
 * A supplied base state supplies values for omitted fields, allowing a level swap
 * to replace the active authored environment without first detaching it.
 */
export function applySceneEnvironment(
  scene: Scene,
  renderer: WebGLRenderer,
  environment: SceneEnvironment | undefined,
  baseState?: SceneEnvironmentState,
): SceneEnvironmentState {
  const previous = captureSceneEnvironment(scene, renderer);
  if (environment == null && baseState == null) {
    return previous;
  }
  const prepared = prepareSceneEnvironment(environment, baseState ?? previous);
  try {
    installSceneEnvironmentState(scene, renderer, prepared);
  } catch (error) {
    installSceneEnvironmentState(scene, renderer, previous);
    throw error;
  }
  return previous;
}

/** Restore a state captured before a staged or committed scene was applied. */
export function restoreSceneEnvironment(
  scene: Scene,
  renderer: WebGLRenderer,
  state: SceneEnvironmentState,
): void {
  const current = captureSceneEnvironment(scene, renderer);
  try {
    installSceneEnvironmentState(scene, renderer, state);
  } catch (error) {
    installSceneEnvironmentState(scene, renderer, current);
    throw error;
  }
}

function prepareSceneEnvironment(
  environment: SceneEnvironment | undefined,
  base: SceneEnvironmentState,
): SceneEnvironmentState {
  const state: SceneEnvironmentState = {
    ...base,
    userDataEnvironment:
      environment == null ? base.userDataEnvironment : cloneJson(environment),
  };
  if (environment?.fog?.type === 'linear') {
    state.fog = new Fog(
      environment.fog.color ?? '#000000',
      environment.fog.near,
      environment.fog.far,
    );
  } else if (environment?.fog?.type === 'exponential') {
    state.fog = new FogExp2(
      environment.fog.color ?? '#000000',
      environment.fog.density,
    );
  }
  if (environment?.toneMapping != null) {
    state.toneMapping = resolveToneMapping(environment.toneMapping);
  }
  if (environment?.exposure != null) {
    state.toneMappingExposure = environment.exposure;
  }
  if (environment?.shadows != null) {
    state.shadows = environment.shadows;
  }
  if (environment?.shadowMapType != null) {
    state.shadowMapType = resolveShadowMapType(environment.shadowMapType);
  }
  return state;
}

function installSceneEnvironmentState(
  scene: Scene,
  renderer: WebGLRenderer,
  state: SceneEnvironmentState,
): void {
  scene.fog = state.fog;
  renderer.shadowMap.enabled = state.shadows;
  renderer.shadowMap.type = state.shadowMapType;
  renderer.toneMapping = state.toneMapping;
  renderer.toneMappingExposure = state.toneMappingExposure;
  if (state.userDataEnvironment === undefined) {
    delete scene.userData.iwsdkSceneEnvironment;
  } else {
    scene.userData.iwsdkSceneEnvironment = state.userDataEnvironment;
  }
}

function resolveShadowMapType(
  type: NonNullable<SceneEnvironment['shadowMapType']>,
) {
  switch (type) {
    case 'basic':
      return BasicShadowMap;
    case 'pcf':
      return PCFShadowMap;
    // PCFShadowMap is soft since three r182, which deprecated PCFSoftShadowMap.
    case 'pcf-soft':
      return PCFShadowMap;
  }
}

function resolveToneMapping(
  mode: NonNullable<SceneEnvironment['toneMapping']>,
) {
  switch (mode) {
    case 'none':
      return NoToneMapping;
    case 'linear':
      return LinearToneMapping;
    case 'reinhard':
      return ReinhardToneMapping;
    case 'cineon':
      return CineonToneMapping;
    case 'aces':
      return ACESFilmicToneMapping;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
