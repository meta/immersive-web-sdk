/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, test } from 'vitest';
import {
  APP_RUNTIME_SCENE_MCP_TOOL_NAMES,
  RUNTIME_MCP_TOOLS,
  SCENE_MCP_TOOL_NAMES,
  getDefaultRuntimeCommandTimeoutMs,
  getRuntimeOperationByToolName,
  resolveRuntimeOperationRequest,
} from '../src/runtime-contract.js';

describe('explicit runtime destination contract', () => {
  const target = {
    deviceClass: 'physical',
    headsetId: 'quest-serial',
    pageId: 'native-page',
    tabGeneration: 3,
  };

  test('preserves an XR position target separately from its execution destination', () => {
    const operation = getRuntimeOperationByToolName('xr_look_at')!;
    const position = { x: 1, y: 2, z: -3 };
    expect(
      resolveRuntimeOperationRequest(operation, {
        device: 'headset',
        target: position,
        runtimeTarget: target,
      }),
    ).toEqual({ params: { device: 'headset', target: position }, target });
  });

  test('rejects incomplete physical identities and contradictory legacy preconditions', () => {
    const operation = getRuntimeOperationByToolName('browser_reload_page')!;
    for (const key of ['headsetId', 'pageId', 'tabGeneration']) {
      const incomplete = { ...target } as Record<string, unknown>;
      delete incomplete[key];
      expect(() =>
        resolveRuntimeOperationRequest(operation, {
          runtimeTarget: incomplete,
        }),
      ).toThrow('Physical runtimeTarget requires');
    }
    expect(() =>
      resolveRuntimeOperationRequest(operation, {
        runtimeTarget: target,
        expectedTab: { id: target.pageId, generation: 2 },
      }),
    ).toThrow('must identify the same page generation');
  });

  test('does not let a selector change an operation role', () => {
    const operation = getRuntimeOperationByToolName('ecs_list_systems')!;
    expect(() =>
      resolveRuntimeOperationRequest(operation, {
        runtimeTarget: { deviceClass: 'managed', role: 'editor' },
      }),
    ).toThrow();
  });
});

test('allows isolated UI rendering extra time for editor resource settling', () => {
  expect(getDefaultRuntimeCommandTimeoutMs('asset_render_preview')).toBe(
    120_000,
  );
  expect(getDefaultRuntimeCommandTimeoutMs('ui_render_preview')).toBe(60_000);
  expect(getDefaultRuntimeCommandTimeoutMs('ecs_find_entities')).toBe(30_000);
});

test('allows managed browser host operations time to queue and execute', () => {
  for (const method of [
    'browser_interact',
    'browser_profile',
    'browser_set_muted',
    'browser_snapshot',
    'get_console_logs',
    'reload_page',
    'screenshot',
  ]) {
    expect(getDefaultRuntimeCommandTimeoutMs(method)).toBe(60_000);
  }
});

describe('runtime contract scene tools', () => {
  test('exposes the file-first and app-runtime inspection surfaces', () => {
    const sceneTools = RUNTIME_MCP_TOOLS.map((tool) => tool.name).filter(
      (name) => name.startsWith('scene_'),
    );

    expect(new Set(sceneTools)).toEqual(
      new Set([...SCENE_MCP_TOOL_NAMES, ...APP_RUNTIME_SCENE_MCP_TOOL_NAMES]),
    );
    expect(sceneTools).toHaveLength(13);
    expect(
      RUNTIME_MCP_TOOLS.some((tool) => tool.name.startsWith('workspace_')),
    ).toBe(false);
  });

  test('routes every scene tool to the managed editor page', () => {
    for (const toolName of SCENE_MCP_TOOL_NAMES) {
      expect(getRuntimeOperationByToolName(toolName)).toMatchObject({
        mcpName: toolName,
        target: { role: 'editor' },
        wsMethod: toolName,
      });
    }
  });

  test('routes isolated model previews to the managed editor page', () => {
    const preview = getRuntimeOperationByToolName('asset_render_preview');

    expect(preview).toMatchObject({
      cliPath: ['asset', 'render-preview'],
      target: { role: 'editor' },
      wsMethod: 'asset_render_preview',
    });
    expect(preview?.inputSchema.required).toEqual(['assetId']);
    expect(preview?.inputSchema.properties?.mode).toMatchObject({
      enum: ['material', 'clay'],
    });
    expect(preview?.inputSchema.properties?.focus).toMatchObject({
      maxLength: 512,
    });
    expect(() =>
      resolveRuntimeOperationRequest(preview!, {
        assetId: 'ship',
        focus: 'x'.repeat(512),
      }),
    ).not.toThrow();
    expect(() =>
      resolveRuntimeOperationRequest(preview!, {
        assetId: 'ship',
        focus: 'x'.repeat(513),
      }),
    ).toThrow('asset_render_preview.focus allows at most 512 characters');
    expect(preview?.inputSchema.properties?.width).toMatchObject({
      description: expect.stringContaining('use focus rather than more pixels'),
    });
    expect(preview?.inputSchema.properties?.height).toMatchObject({
      description: expect.stringContaining('use focus rather than more pixels'),
    });
  });

  test('routes runtime inspection tools to the application page', () => {
    expect(
      getRuntimeOperationByToolName('scene_get_render_stats'),
    ).toMatchObject({
      cliPath: ['scene', 'render-stats'],
      wsMethod: 'get_render_stats',
    });
    expect(
      getRuntimeOperationByToolName('scene_get_runtime_hierarchy'),
    ).toMatchObject({
      cliPath: ['scene', 'runtime-hierarchy'],
      wsMethod: 'get_scene_hierarchy',
    });
    expect(
      getRuntimeOperationByToolName('scene_get_object_transform'),
    ).toMatchObject({
      cliPath: ['scene', 'transform'],
      wsMethod: 'get_object_transform',
    });
    for (const toolName of APP_RUNTIME_SCENE_MCP_TOOL_NAMES) {
      expect(getRuntimeOperationByToolName(toolName)?.target).toBeUndefined();
    }
  });

  test('makes render-file the validate, compose, and PNG operation', () => {
    const render = getRuntimeOperationByToolName('scene_render_file');

    expect(render).toMatchObject({
      cliPath: ['scene', 'render-file'],
      target: { role: 'editor' },
      wsMethod: 'scene_render_file',
    });
    expect(render?.inputSchema.required).toEqual(['path']);
    expect(render?.description).toContain('Invalid files');
    expect(render?.description).toContain('PNG');
    expect(render?.inputSchema.properties?.width).toMatchObject({
      description: expect.stringContaining('512 or smaller'),
    });
    expect(render?.inputSchema.properties?.height).toMatchObject({
      description: expect.stringContaining('384 or smaller'),
    });
  });

  test('exposes one-way hash-verified scene flattening', () => {
    const flatten = getRuntimeOperationByToolName('scene_flatten_file');
    expect(flatten).toMatchObject({
      cliPath: ['scene', 'flatten'],
      target: { role: 'editor' },
      wsMethod: 'scene_flatten_file',
    });
    expect(flatten?.inputSchema.required).toEqual(['path']);
    expect(flatten?.description).toContain('runtime-loadable');
  });

  test('describes the consolidated live scene state', () => {
    const state = getRuntimeOperationByToolName('scene_get_state');

    expect(state).toMatchObject({
      cliPath: ['scene', 'state'],
      target: { role: 'editor' },
      wsMethod: 'scene_get_state',
    });
    expect(state?.description).toContain('source/composed/runtime hashes');
    expect(state?.description).toContain('conflict');
  });

  test('retains deterministic camera and screenshot controls', () => {
    const screenshot = getRuntimeOperationByToolName('scene_screenshot');
    const camera = getRuntimeOperationByToolName('scene_set_camera');

    expect(screenshot?.inputSchema.properties?.orbitStep).toMatchObject({
      type: 'number',
    });
    expect(camera?.inputSchema.properties?.viewId).toMatchObject({
      type: 'string',
    });
    expect(screenshot?.inputSchema.properties?.captureMode).toMatchObject({
      enum: ['render', 'editor'],
    });
  });

  test('exposes exactly the application-focused browser surface', () => {
    const browserTools = RUNTIME_MCP_TOOLS.map((tool) => tool.name).filter(
      (name) => name.startsWith('browser_'),
    );
    expect(browserTools).toEqual([
      'browser_screenshot',
      'browser_snapshot',
      'browser_interact',
      'browser_profile',
      'browser_get_console_logs',
      'browser_reload_page',
      'browser_set_muted',
    ]);
    for (const toolName of browserTools) {
      expect(getRuntimeOperationByToolName(toolName)).toMatchObject({
        target: { role: 'app' },
      });
    }

    const mute = getRuntimeOperationByToolName('browser_set_muted')!;
    expect(mute).toMatchObject({
      cliPath: ['browser', 'set-muted'],
      execution: 'host',
      physical: false,
      wsMethod: 'browser_set_muted',
    });
    expect(resolveRuntimeOperationRequest(mute, { muted: true })).toEqual({
      params: { muted: true },
      target: { role: 'app' },
    });
    expect(() => resolveRuntimeOperationRequest(mute, {})).toThrow(
      'browser_set_muted requires parameter: muted',
    );
    expect(() =>
      resolveRuntimeOperationRequest(mute, { muted: 'true' }),
    ).toThrow();

    const screenshot = getRuntimeOperationByToolName('browser_screenshot')!;
    expect(
      resolveRuntimeOperationRequest(screenshot, { format: 'jpeg' }),
    ).toEqual({
      params: { format: 'jpeg' },
      target: { role: 'app' },
    });
    expect(() =>
      resolveRuntimeOperationRequest(screenshot, { target: 'editor' }),
    ).toThrow(/unknown parameter "target"/);

    const interact = getRuntimeOperationByToolName('browser_interact')!;
    expect(() =>
      resolveRuntimeOperationRequest(interact, { steps: [] }),
    ).toThrow(/requires at least 1 items/);
    expect(
      resolveRuntimeOperationRequest(interact, {
        steps: [{ action: 'click', ref: 'e1' }],
      }),
    ).toEqual({
      params: { steps: [{ action: 'click', ref: 'e1' }] },
      target: { role: 'app' },
    });
    const heldKeyBatch = {
      steps: [
        { action: 'keyDown', key: 'KeyW' },
        { action: 'wait', durationMs: 250 },
        { action: 'keyUp', key: 'KeyW' },
      ],
    };
    expect(resolveRuntimeOperationRequest(interact, heldKeyBatch)).toEqual({
      params: heldKeyBatch,
      target: { role: 'app' },
    });
    expect(() =>
      resolveRuntimeOperationRequest(interact, {
        steps: [{ action: 'wait', durationMs: -1 }],
      }),
    ).toThrow('browser_interact.steps[0].durationMs must be at least 0');
    expect(() =>
      resolveRuntimeOperationRequest(interact, {
        steps: [{ action: 'wait', durationMs: 12_001 }],
      }),
    ).toThrow('browser_interact.steps[0].durationMs must be at most 12000');
    expect(() =>
      resolveRuntimeOperationRequest(interact, {
        steps: [{ action: 'keyDown', key: 'x'.repeat(101) }],
      }),
    ).toThrow('browser_interact.steps[0].key allows at most 100 characters');
  });

  test('turns result._tab into a strict routing precondition', () => {
    const operation = getRuntimeOperationByToolName('scene_get_state')!;
    expect(
      resolveRuntimeOperationRequest(operation, {
        expectedTab: { id: 'tab-1', generation: 7 },
      }),
    ).toEqual({
      params: {},
      target: { role: 'editor', pageId: 'tab-1', tabGeneration: 7 },
    });
    expect(() =>
      resolveRuntimeOperationRequest(operation, {
        expectedTab: { id: 'tab-1', generation: 0 },
      }),
    ).toThrow(/expectedTab requires/);
  });

  test('rejects runtime requests that omit required parameters', () => {
    const operation = getRuntimeOperationByToolName('xr_set_gamepad_state');

    expect(() =>
      resolveRuntimeOperationRequest(operation!, {
        handedness: 'right',
        buttonIndex: 3,
      }),
    ).toThrow('xr_set_gamepad_state requires parameter: device');
    expect(() => resolveRuntimeOperationRequest(operation!, [])).toThrow(
      'xr_set_gamepad_state requires an object with parameter: device',
    );
    expect(
      resolveRuntimeOperationRequest(operation!, {
        device: 'controller-right',
        buttons: [{ index: 3, value: 1 }],
      }),
    ).toEqual({
      params: {
        device: 'controller-right',
        buttons: [{ index: 3, value: 1 }],
      },
      target: undefined,
    });
  });

  test('rejects unknown keys and invalid schema values before transport', () => {
    const step = getRuntimeOperationByToolName('ecs_step')!;
    const input = getRuntimeOperationByToolName('xr_set_input_mode')!;

    expect(() => resolveRuntimeOperationRequest(step, { frames: 3 })).toThrow(
      'ecs_step has unknown parameter "frames"',
    );
    expect(() => resolveRuntimeOperationRequest(step, { count: '3' })).toThrow(
      'ecs_step.count must be number',
    );
    expect(() =>
      resolveRuntimeOperationRequest(input, {
        mode: 'not-a-mode',
      }),
    ).toThrow(/must be one of/);
  });

  test('exposes gaze only on pose, connection, and snapshot operations', () => {
    for (const toolName of [
      'xr_get_transform',
      'xr_set_transform',
      'xr_look_at',
      'xr_animate_to',
    ]) {
      const operation = getRuntimeOperationByToolName(toolName)!;
      expect(operation.inputSchema.properties?.device?.enum).toContain('gaze');
    }

    expect(
      getRuntimeOperationByToolName('xr_set_connected')?.inputSchema.properties
        ?.device?.enum,
    ).toContain('gaze');

    for (const toolName of [
      'xr_get_select_value',
      'xr_set_select_value',
      'xr_select',
      'xr_get_gamepad_state',
      'xr_set_gamepad_state',
    ]) {
      const operation = getRuntimeOperationByToolName(toolName)!;
      expect(operation.inputSchema.properties?.device?.enum).not.toContain(
        'gaze',
      );
    }

    expect(
      resolveRuntimeOperationRequest(
        getRuntimeOperationByToolName('xr_set_device_state')!,
        {
          state: {
            gaze: {
              connected: true,
              orientation: { x: 0, y: 0, z: 0, w: 1 },
            },
          },
        },
      ),
    ).toMatchObject({
      params: { state: { gaze: { connected: true } } },
    });
    expect(() =>
      resolveRuntimeOperationRequest(
        getRuntimeOperationByToolName('xr_set_device_state')!,
        {
          state: { gaze: { position: { x: 0, y: 0, z: 0 } } },
        },
      ),
    ).toThrow(/unknown parameter/i);
  });

  test('exposes isolated UIKitML rendering as an editor-targeted image tool', () => {
    const assets = getRuntimeOperationByToolName('ui_list_assets');
    const operation = getRuntimeOperationByToolName('ui_render_preview');
    expect(assets).toMatchObject({
      cliPath: ['ui', 'assets'],
      target: { role: 'editor' },
      wsMethod: 'ui_list_assets',
    });
    expect(operation).toMatchObject({
      cliPath: ['ui', 'render-preview'],
      target: { role: 'editor' },
      wsMethod: 'ui_render_preview',
    });
    expect(operation?.inputSchema.required).toEqual(['assetId']);
  });
  test('exposes bounded live UIKit inspection on the application page', () => {
    const operation = getRuntimeOperationByToolName('ui_inspect');

    expect(operation).toMatchObject({
      cliPath: ['ui', 'inspect'],
      execution: 'runtime',
      physical: true,
      target: { role: 'app' },
      wsMethod: 'ui_inspect',
    });
    expect(operation?.inputSchema.required).toEqual(['entityIndex']);
    expect(operation?.inputSchema.properties?.selector).toMatchObject({
      maxLength: 512,
    });
    expect(operation?.inputSchema.properties?.properties).toMatchObject({
      maxItems: 20,
      minItems: 1,
    });
    expect(operation?.inputSchema.properties?.limit).toMatchObject({
      maximum: 50,
      minimum: 1,
      type: 'integer',
    });
    expect(
      resolveRuntimeOperationRequest(operation!, {
        entityIndex: 14,
        selector: '#counter-button',
        properties: ['text', 'disabled'],
        limit: 1,
      }),
    ).toEqual({
      params: {
        entityIndex: 14,
        selector: '#counter-button',
        properties: ['text', 'disabled'],
        limit: 1,
      },
      target: { role: 'app' },
    });
    expect(() =>
      resolveRuntimeOperationRequest(operation!, {
        entityIndex: 14,
        selector: 'x'.repeat(513),
      }),
    ).toThrow('ui_inspect.selector allows at most 512 characters');
    expect(() =>
      resolveRuntimeOperationRequest(operation!, {
        entityIndex: 14,
        properties: ['__proto__'],
      }),
    ).toThrow('ui_inspect.properties[0] must match');
    expect(() =>
      resolveRuntimeOperationRequest(operation!, {
        entityIndex: 14,
        limit: 51,
      }),
    ).toThrow('ui_inspect.limit must be at most 50');
  });
});
