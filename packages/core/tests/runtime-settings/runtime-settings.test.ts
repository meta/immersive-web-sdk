/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { IWSDK_BUILTIN_COMPONENTS } from '../../src/ecs/builtin-components.js';
import { getComponentEditorMetadata } from '../../src/ecs/component-editor-metadata.js';
import { World } from '../../src/ecs/world.js';
import {
  ecsFindEntities,
  ecsSetComponent,
} from '../../src/mcp/ecs-debug-tools.js';
import {
  RuntimeSettings,
  RuntimeSettingsSystem,
} from '../../src/runtime-settings/index.js';

// world.ts -> @iwsdk/xr-input -> cursor-visual.ts touches `document` at module
// load; provide a minimal canvas stub before importing.
vi.hoisted(() => {
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => ({
        arc: () => {},
        beginPath: () => {},
        clearRect: () => {},
        fill: () => {},
        fillStyle: '',
        lineWidth: 0,
        stroke: () => {},
        strokeStyle: '',
      }),
      height: 0,
      width: 0,
    }),
  };
});

function setup(initialMode: 'continuous' | 'on-demand' = 'continuous') {
  const world = new World();
  world.renderMode = initialMode;
  world
    .registerComponent(RuntimeSettings)
    .registerSystem(RuntimeSettingsSystem);
  const system = world.getSystem(RuntimeSettingsSystem)!;
  const entity = (system as any).settingsEntity;
  const field = () => entity.getValue(RuntimeSettings, 'renderMode');
  return { world, system, entity, field };
}

describe('RuntimeSettings', () => {
  it('creates one settings entity carrying the current render mode', () => {
    const { entity, field } = setup('on-demand');
    expect(entity.hasComponent(RuntimeSettings)).toBe(true);
    expect(field()).toBe('on-demand');
  });

  it('applies a render mode set through ECS on the next sync', () => {
    const { world, system, entity } = setup('on-demand');
    entity.setValue(RuntimeSettings, 'renderMode', 'continuous');
    expect(world.renderMode).toBe('on-demand');
    system.sync();
    expect(world.renderMode).toBe('continuous');
  });

  it('reflects code that sets world.renderMode back into the component', () => {
    const { world, system, field } = setup('continuous');
    world.renderMode = 'on-demand';
    system.sync();
    expect(field()).toBe('on-demand');
    // Stable afterwards: no flip-flopping between the two sources.
    system.sync();
    expect(world.renderMode).toBe('on-demand');
    expect(field()).toBe('on-demand');
  });

  it('rejects values outside the enum', () => {
    const { entity } = setup();
    expect(() =>
      entity.setValue(RuntimeSettings, 'renderMode', 'sometimes'),
    ).toThrow();
  });

  it('is left out of the built-in component catalog and hidden from authoring UI', () => {
    expect(IWSDK_BUILTIN_COMPONENTS).not.toContain(RuntimeSettings);
    expect(getComponentEditorMetadata(RuntimeSettings)).toEqual({
      hidden: true,
      intrinsic: true,
    });
  });

  it('restores the last valid mode when code writes an invalid one, warning once', () => {
    const { world, system, field } = setup('on-demand');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (world as { renderMode: string }).renderMode = 'sometimes';
    expect(() => system.sync()).not.toThrow();
    expect(world.renderMode).toBe('on-demand');
    expect(field()).toBe('on-demand');
    (world as { renderMode: string }).renderMode = 'never';
    system.sync();
    expect(world.renderMode).toBe('on-demand');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('starts continuous when world.renderMode is invalid at init', () => {
    const { world, field } = setup('sometimes' as never);
    expect(field()).toBe('continuous');
    expect(world.getSystem(RuntimeSettingsSystem)).toBeDefined();
  });

  it('applies a mode set through the agent ECS tools', async () => {
    const { world, system } = setup('on-demand');
    const found = (await ecsFindEntities(world, {
      withComponents: ['RuntimeSettings'],
    })) as { entities: Array<{ entityIndex: number }> };
    expect(found.entities).toHaveLength(1);
    await ecsSetComponent(world, {
      entityIndex: found.entities[0].entityIndex,
      componentId: 'RuntimeSettings',
      field: 'renderMode',
      value: 'continuous',
    });
    system.sync();
    expect(world.renderMode).toBe('continuous');
  });
});
