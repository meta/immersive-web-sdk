/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { RenderMode, World } from '../ecs/world.js';
import {
  DEBUG_SYNC_TIMEOUT_MS,
  installDebugHook,
  ecsPause,
  ecsResume,
  ecsStep,
  ecsQueryEntity,
  ecsFindEntities,
  ecsListSystems,
  ecsListComponents,
  ecsToggleSystem,
  ecsSetComponent,
  ecsSnapshot,
  ecsDiff,
} from './ecs-debug-tools.js';
import {
  getObjectTransform,
  getRenderStats,
  getSceneHierarchy,
} from './scene-tools.js';
import { SceneTargetResolver } from './target-resolver.js';
import { uiInspect } from './ui-debug-tools.js';

const SUPPORTED_METHODS = [
  'get_scene_hierarchy',
  'get_object_transform',
  'get_render_stats',
  'ecs_pause',
  'ecs_resume',
  'ecs_step',
  'ecs_query_entity',
  'ecs_find_entities',
  'ecs_list_systems',
  'ecs_list_components',
  'ecs_toggle_system',
  'ecs_set_component',
  'ecs_snapshot',
  'ecs_diff',
  'ui_inspect',
] as const;
type SupportedMethod = (typeof SUPPORTED_METHODS)[number];

/**
 * MCP Runtime for IWSDK that provides framework-specific tools.
 * This is set on window.FRAMEWORK_MCP_RUNTIME during World.create()
 * for the vite-plugin-dev to route requests to.
 *
 * @category Runtime
 */
export class MCPRuntime {
  /**
   * Resolves the target names of emulated hand sequences to scene objects.
   * vite-plugin-dev registers it with IWER (`remote.setTargetResolver`).
   */
  readonly targetResolver: SceneTargetResolver;

  private renderHolds = new Map<string, () => void>();
  private nextRenderHoldId = 0;

  constructor(private world: World) {
    installDebugHook(world);
    this.targetResolver = new SceneTargetResolver(world);
  }

  /**
   * Draw fresh frames before the development bridge captures pixels. Needed
   * in `'on-demand'` render mode, where the canvas otherwise holds whatever
   * was last drawn; harmless in continuous mode.
   */
  requestRender(frames = 1): Promise<void> {
    return this.world.requestRender(frames);
  }

  /**
   * Frames the render loop has drawn so far. The development bridge reads it
   * after each emulated XR frame to draw the emulator's synthetic environment
   * only on frames the app drew.
   */
  get drawnFrames(): number {
    return this.world.drawnFrames;
  }

  /** The world's current render mode, for development status reports. */
  get renderMode(): RenderMode {
    return this.world.renderMode;
  }

  /**
   * Draw every frame until {@link MCPRuntime.releaseRenderHold} is called with
   * the returned id. The development bridge holds rendering across several
   * page evaluations (a profile, publish evidence), so holds are addressed by
   * id rather than by closure.
   */
  acquireRenderHold(): string {
    const id = `render-hold-${++this.nextRenderHoldId}`;
    this.renderHolds.set(id, this.world.holdRender());
    return id;
  }

  /** Release a hold from {@link MCPRuntime.acquireRenderHold}. */
  releaseRenderHold(id: string): boolean {
    const release = this.renderHolds.get(id);
    if (!release) {
      return false;
    }
    this.renderHolds.delete(id);
    release();
    return true;
  }

  /** Draw one frame for fresh render stats, bounded like ecs_step. */
  private drawFrameForStats(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      this.world.requestRender(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Render stats timed out after ${DEBUG_SYNC_TIMEOUT_MS}ms waiting for a frame to be drawn — the render loop may not be running. ` +
                  `Ensure the browser tab is visible.`,
              ),
            ),
          DEBUG_SYNC_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }

  /** Release native XR before the development bridge navigates this page. */
  async prepareForReload(): Promise<void> {
    // Three adopts the session before World finishes reference-space setup.
    // Reload can arrive during that interval as well as after full adoption.
    const session = this.world.session ?? this.world.renderer.xr.getSession();
    if (!session) {
      return;
    }
    // Quest resolves end() before delivering the end event. Navigation must
    // wait for that event so the renderer and compositor can release XR.
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        session.removeEventListener('end', ended);
        if (error !== undefined) {
          reject(error);
        } else {
          resolve();
        }
      };
      const ended = () => finish();
      const timer = setTimeout(
        () =>
          finish(new Error('Native XR did not finish ending before reload.')),
        10000,
      );
      session.addEventListener('end', ended, { once: true });
      void Promise.resolve()
        .then(() => session.end())
        .catch((error) => {
          // The app, device UI, or another command may already be ending XR.
          // Chromium rejects a second end(); the pending end event remains
          // the teardown boundary, with the same deadline as the first call.
          if (error?.name !== 'InvalidStateError') {
            finish(error ?? new Error('Native XR rejected session teardown.'));
          }
        });
    });
  }

  /**
   * Returns true if this runtime handles the given method.
   * Used by vite-plugin-dev to route requests appropriately.
   */
  handles(method: string): boolean {
    return SUPPORTED_METHODS.includes(method as SupportedMethod);
  }

  /**
   * Dispatch a method call. Returns result or throws an error.
   * @param method - The MCP tool name (e.g., 'get_scene_hierarchy')
   * @param params - Parameters passed to the tool
   * @returns Promise resolving to the tool result
   */
  async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case 'get_scene_hierarchy':
        return getSceneHierarchy(this.world, params);
      case 'get_object_transform':
        return getObjectTransform(this.world, params);
      case 'get_render_stats':
        // renderer.info describes the last drawn frame.
        if (this.world.renderMode === 'on-demand') {
          await this.drawFrameForStats();
        }
        return getRenderStats(this.world);
      case 'ecs_pause':
        return ecsPause(this.world);
      case 'ecs_resume':
        return ecsResume(this.world);
      case 'ecs_step':
        return ecsStep(this.world, params);
      case 'ecs_query_entity':
        return ecsQueryEntity(this.world, params);
      case 'ecs_find_entities':
        return ecsFindEntities(this.world, params);
      case 'ecs_list_systems':
        return ecsListSystems(this.world);
      case 'ecs_list_components':
        return ecsListComponents();
      case 'ecs_toggle_system':
        return ecsToggleSystem(this.world, params);
      case 'ecs_set_component':
        return ecsSetComponent(this.world, params);
      case 'ecs_snapshot':
        return ecsSnapshot(this.world, params);
      case 'ecs_diff':
        return ecsDiff(this.world, params);
      case 'ui_inspect':
        return uiInspect(this.world, params);
      default:
        throw new Error(
          `Unknown IWSDK method '${method}'. Available methods: ${SUPPORTED_METHODS.join(', ')}`,
        );
    }
  }
}
