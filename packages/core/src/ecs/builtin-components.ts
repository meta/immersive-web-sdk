/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AudioSource } from '../audio/audio.js';
import { CameraSource } from '../camera/camera-source.js';
import { DepthOccludable } from '../depth/depth-occludable.js';
import { DomeFade } from '../environment/dome-fade.js';
import { DomeGradient } from '../environment/dome-gradient.js';
import { DomeTexture } from '../environment/dome-texture.js';
import { ContactShadow, ShadowCatcher } from '../environment/ground-shadows.js';
import { IBLGradient } from '../environment/ibl-gradient.js';
import { IBLTexture } from '../environment/ibl-texture.js';
import { EnvironmentRaycastTarget } from '../environment-raycast/raycast-target.js';
import { DistanceGrabbable } from '../grab/distance-grabbable.js';
import { Grabbed } from '../grab/grabbed.js';
import { Handle } from '../grab/handles.js';
import { OneHandGrabbable } from '../grab/one-hand-grabbable.js';
import { TwoHandsGrabbable } from '../grab/two-hands-grabbable.js';
import {
  Hovered,
  PokeInteractable,
  Pressed,
  RayInteractable,
} from '../input/state-tags.js';
import { XRCylinderLayer } from '../layers/xr-cylinder-layer.js';
import { XRLayerState } from '../layers/xr-layer-state.js';
import { XRQuadLayer } from '../layers/xr-quad-layer.js';
import { LevelRoot } from '../level/level-root.js';
import { LevelTag } from '../level/level-tag.js';
import {
  AmbientLightComponent,
  DirectionalLightComponent,
  HemisphereLightComponent,
  PointLightComponent,
  RectAreaLightComponent,
  SpotLightComponent,
} from '../lighting/light-components.js';
import { LocomotionEnvironment } from '../locomotion/locomotion-environment.js';
import { PhysicsBody } from '../physics/physicsBody.js';
import { PhysicsManipulation } from '../physics/physicsManipulation.js';
import { PhysicsShape } from '../physics/physicsShape.js';
import { XRAnchor } from '../scene-understanding/anchor.js';
import { XRMesh } from '../scene-understanding/mesh.js';
import { XRPlane } from '../scene-understanding/plane.js';
import { Transform } from '../transform/transform-component.js';
import { Follower } from '../ui/follow-component.js';
import { PanelDocument, PanelUI } from '../ui/panel-components.js';
import { ScreenSpace } from '../ui/screenspace-component.js';
import { Visibility } from '../visibility/visibility-component.js';
import { defineComponents } from './component-manifest.js';

/** Complete editor-visible IWSDK component catalog in deterministic order. */
export const IWSDK_BUILTIN_COMPONENTS = defineComponents([
  AudioSource,
  AmbientLightComponent,
  CameraSource,
  ContactShadow,
  DepthOccludable,
  DistanceGrabbable,
  DirectionalLightComponent,
  DomeFade,
  DomeGradient,
  DomeTexture,
  EnvironmentRaycastTarget,
  Follower,
  Grabbed,
  Handle,
  Hovered,
  HemisphereLightComponent,
  IBLGradient,
  IBLTexture,
  LevelRoot,
  LevelTag,
  LocomotionEnvironment,
  OneHandGrabbable,
  PanelDocument,
  PanelUI,
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PointLightComponent,
  PokeInteractable,
  Pressed,
  RayInteractable,
  RectAreaLightComponent,
  ScreenSpace,
  ShadowCatcher,
  SpotLightComponent,
  Transform,
  TwoHandsGrabbable,
  Visibility,
  XRAnchor,
  XRCylinderLayer,
  XRLayerState,
  XRMesh,
  XRPlane,
  XRQuadLayer,
] as const);
