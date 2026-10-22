/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export { MCPRuntime } from './mcp-runtime.js';
export { SceneTargetResolver } from './target-resolver.js';
export type {
  ResolvedTarget,
  TargetFace,
  TargetIntent,
  TargetReference,
  TargetResolveContext,
  TargetSummary,
  TargetVector,
} from './target-resolver.js';
export type { HierarchyNode, ObjectTransform } from './scene-tools.js';
export type {
  EcsPauseResult,
  EcsResumeResult,
  EcsStepParams,
  EcsStepResult,
  EcsQueryEntityParams,
  EcsQueryEntityResult,
  ComponentData,
  EcsFindEntitiesParams,
  EcsFindEntitiesResult,
  EntitySummary,
  SystemInfo,
  EcsListSystemsResult,
  ComponentInfo,
  EcsListComponentsResult,
  EcsToggleSystemParams,
  EcsToggleSystemResult,
  EcsSetComponentParams,
  EcsSetComponentResult,
  EcsSnapshot,
  EcsSnapshotParams,
  EcsSnapshotResult,
  EcsDiffParams,
  EcsDiffResult,
} from './ecs-debug-tools.js';
export type {
  UiElementInspection,
  UiInspectParams,
  UiInspectResult,
} from './ui-debug-tools.js';
