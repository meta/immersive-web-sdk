/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { setComponentEditorMetadata } from '../ecs/component-editor-metadata.js';
import { Types, createComponent } from '../ecs/component.js';
import type { Entity } from '../ecs/entity.js';
import { createSystem } from '../ecs/system.js';
import type { RenderMode } from '../ecs/world.js';

/**
 * Values of {@link RuntimeSettings}' `renderMode` field.
 * @category Runtime
 */
export const RenderModes = {
  Continuous: 'continuous',
  OnDemand: 'on-demand',
} as const satisfies Record<string, RenderMode>;

/**
 * Runtime switches for the running world, exposed as ECS data so development
 * tools can read and change them with the generic component commands
 * (`ecs find`, `ecs query`, `ecs set-component`, snapshots) instead of a
 * dedicated command per switch.
 *
 * @remarks
 * - One instance lives on its own entity, created by
 *   {@link RuntimeSettingsSystem}. It is runtime state: it is left out of the
 *   built-in component catalog, so scenes cannot author it, and scene saving
 *   writes scene documents, never this entity. The hidden/intrinsic editor
 *   metadata keeps it out of generic authoring UI should a catalog include it.
 * - `renderMode` mirrors {@link World.renderMode} in both directions: setting
 *   the field switches the render loop on the next frame, and code that sets
 *   `world.renderMode` is reflected back into the field.
 *
 * @example
 * ```bash
 * npx @iwsdk/cli ecs find --input-json '{"withComponents":["RuntimeSettings"]}'
 * npx @iwsdk/cli ecs set-component --input-json \
 *   '{"entityIndex":<index>,"componentId":"RuntimeSettings","field":"renderMode","value":"continuous"}'
 * ```
 *
 * @category Runtime
 */
export const RuntimeSettings = setComponentEditorMetadata(
  createComponent(
    'RuntimeSettings',
    {
      renderMode: {
        type: Types.Enum,
        enum: RenderModes,
        default: RenderModes.Continuous,
      },
    },
    'Runtime switches for the running world (render mode). Not authorable; never saved.',
  ),
  { hidden: true, intrinsic: true },
);

/**
 * Creates the {@link RuntimeSettings} entity and keeps it in sync with the
 * world. The render loop calls {@link RuntimeSettingsSystem.sync} at the start
 * of every frame, before deciding whether to draw, so a switch made through
 * ECS applies on the next frame even while ECS updates are paused for
 * debugging.
 *
 * @category Runtime
 */
export class RuntimeSettingsSystem extends createSystem({}) {
  private settingsEntity?: Entity;
  /** The render mode last agreed between the component and the world. */
  private syncedRenderMode: RenderMode = RenderModes.Continuous;
  private warnedInvalidRenderMode = false;

  init(): void {
    if (isRenderMode(this.world.renderMode)) {
      this.syncedRenderMode = this.world.renderMode;
    }
    this.settingsEntity = this.world.createEntity();
    this.settingsEntity.addComponent(RuntimeSettings, {
      renderMode: this.syncedRenderMode,
    });
  }

  /**
   * Reconcile the component and the world. Called by the render loop, so it
   * never throws: an exception there would stop the loop for good.
   */
  sync(): void {
    const entity = this.settingsEntity;
    if (!entity?.active) {
      return;
    }
    const fromComponent = entity.getValue(
      RuntimeSettings,
      'renderMode',
    ) as RenderMode;
    if (fromComponent !== this.syncedRenderMode) {
      // A tool changed the field (the enum guarantees a valid value): it wins.
      this.world.renderMode = fromComponent;
    } else if (this.world.renderMode !== this.syncedRenderMode) {
      if (isRenderMode(this.world.renderMode)) {
        // Code changed world.renderMode (for example the dev harness at boot).
        entity.setValue(RuntimeSettings, 'renderMode', this.world.renderMode);
      } else {
        if (!this.warnedInvalidRenderMode) {
          this.warnedInvalidRenderMode = true;
          console.warn(
            `[IWSDK] Ignoring invalid world.renderMode ${JSON.stringify(this.world.renderMode)}; expected 'continuous' or 'on-demand'.`,
          );
        }
        this.world.renderMode = this.syncedRenderMode;
      }
    }
    this.syncedRenderMode = this.world.renderMode;
  }
}

function isRenderMode(value: unknown): value is RenderMode {
  return value === RenderModes.Continuous || value === RenderModes.OnDemand;
}
