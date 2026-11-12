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
  getRuntimeOperationByCliPath,
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
    'browser_filmstrip',
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

test('browser_filmstrip is a host browser operation with bounded parameters', () => {
  const filmstrip = getRuntimeOperationByToolName('browser_filmstrip')!;
  expect(filmstrip).toMatchObject({
    cliPath: ['browser', 'filmstrip'],
    execution: 'host',
    wsMethod: 'browser_filmstrip',
  });
  expect(
    resolveRuntimeOperationRequest(filmstrip, {
      count: 6,
      every: 5,
      format: 'png',
    }).params,
  ).toEqual({ count: 6, every: 5, format: 'png' });
  expect(resolveRuntimeOperationRequest(filmstrip, {}).params).toEqual({});
  for (const [params, message] of [
    [{ count: 1 }, 'browser_filmstrip.count must be at least 2'],
    [{ count: 13 }, 'browser_filmstrip.count must be at most 12'],
    [{ count: 2.5 }, 'browser_filmstrip.count must be integer'],
    [{ every: 0 }, 'browser_filmstrip.every must be at least 1'],
    [{ every: 121 }, 'browser_filmstrip.every must be at most 120'],
    [{ format: 'gif' }, 'browser_filmstrip.format must be one of'],
    [{ frames: 3 }, 'browser_filmstrip has unknown parameter "frames"'],
  ] as const) {
    expect(() => resolveRuntimeOperationRequest(filmstrip, params)).toThrow(
      message,
    );
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
      'browser_filmstrip',
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

describe('runtime contract hand tools', () => {
  const resolve = (toolName: string, params: unknown) =>
    resolveRuntimeOperationRequest(
      getRuntimeOperationByToolName(toolName)!,
      params,
    );

  test('exposes the IWER hand tools as application-page xr commands', () => {
    for (const [toolName, method, action] of [
      ['xr_set_hand_pose', 'set_hand_pose', 'set-hand-pose'],
      ['xr_microgesture', 'microgesture', 'microgesture'],
      ['xr_get_hand_state', 'get_hand_state', 'get-hand-state'],
      ['xr_run_sequence', 'run_sequence', 'run-sequence'],
      ['xr_cancel_sequence', 'cancel_sequence', 'cancel-sequence'],
      ['xr_list_targets', 'list_targets', 'list-targets'],
    ]) {
      const operation = getRuntimeOperationByToolName(toolName);
      expect(operation, toolName).toMatchObject({
        cliPath: ['xr', action],
        execution: 'runtime',
        physical: true,
        wsMethod: method,
      });
      expect(operation?.target).toBeUndefined();
      expect(getRuntimeOperationByCliPath('xr', action)?.mcpName).toBe(
        toolName,
      );
      expect(operation?.inputSchema.properties).toHaveProperty('expectedTab');
    }
  });

  test('lets a hand sequence outlast its own 28 s deadline', () => {
    expect(getDefaultRuntimeCommandTimeoutMs('run_sequence')).toBe(40_000);
    for (const method of ['microgesture', 'set_hand_pose', 'list_targets']) {
      expect(getDefaultRuntimeCommandTimeoutMs(method)).toBe(30_000);
    }
  });

  test('waits out the duration of a fade, ramp or animation', () => {
    for (const method of [
      'set_hand_pose',
      'set_select_value',
      'animate_to',
      'select',
    ]) {
      expect(getDefaultRuntimeCommandTimeoutMs(method, { duration: 45 })).toBe(
        75_000,
      );
      expect(
        getDefaultRuntimeCommandTimeoutMs(method, { duration: 0.25 }),
      ).toBe(30_250);
      expect(getDefaultRuntimeCommandTimeoutMs(method, { duration: 0 })).toBe(
        30_000,
      );
      expect(getDefaultRuntimeCommandTimeoutMs(method, {})).toBe(30_000);
    }
    // Bounded, so a runaway duration cannot overflow a timer.
    expect(
      getDefaultRuntimeCommandTimeoutMs('set_hand_pose', { duration: 1e12 }),
    ).toBe(30_000 + 3_600_000);
    expect(
      getDefaultRuntimeCommandTimeoutMs('set_transform', { duration: 45 }),
    ).toBe(30_000);
    expect(
      getDefaultRuntimeCommandTimeoutMs('run_sequence', { duration: 45 }),
    ).toBe(40_000);
  });

  test('accepts the example in the run_sequence description unchanged', () => {
    const operation = getRuntimeOperationByToolName('xr_run_sequence')!;
    const example = JSON.parse(
      operation.description.slice(
        operation.description.indexOf('Example: ') + 'Example: '.length,
      ),
    );
    expect(example.steps).toHaveLength(6);
    expect(resolve('xr_run_sequence', example)).toEqual({
      params: example,
      target: undefined,
    });
    expect(
      resolve('xr_run_sequence', {
        device: 'hand-left',
        dryRun: true,
        body: 'fixed',
        gaze: 'fixed',
        idleHand: 'keep',
        steps: [
          { target: { name: 'Map Pin 1', face: 'top' }, duration: 'auto' },
          { position: [0.1, 1.2, -0.4], offset: { normal: 0.01 } },
          {
            position: { x: 0, y: 1, z: -0.5, normal: [0, 0, 1] },
            poseId: { value: 'open', start: 0.2, end: 0.8 },
            fingers: { index: { poseId: 'point', weight: 0.5 } },
            pinch: { value: 0.4, easing: 'linear' },
            orientation: { fingers: { x: 0, y: 0, z: -1 }, palm: 'down' },
          },
          { body: { stepTo: 'Map Pin 2', facing: 'forward' } },
          { microgesture: 'tap', label: 'confirm' },
        ],
      }).params,
    ).toMatchObject({ dryRun: true, steps: { length: 5 } });
  });

  test('takes hand placement, ramps and hand state on the existing tools', () => {
    expect(
      resolve('xr_set_transform', {
        device: 'hand-right',
        anchor: 'wrist',
        position: { x: 0.12, y: 1.2, z: -0.3 },
        orientation: { fingers: [0, -0.6, -0.8], palm: 'left' },
      }).params,
    ).toMatchObject({ anchor: 'wrist' });
    expect(
      resolve('xr_animate_to', {
        device: 'hand-right',
        anchor: 'index-tip',
        position: { x: 0.1, y: 1.05, z: -0.45 },
        orientation: 'auto',
        duration: 0.6,
        easing: 'minimum-jerk',
      }).params,
    ).toMatchObject({ easing: 'minimum-jerk', orientation: 'auto' });
    expect(
      resolve('xr_set_select_value', {
        device: 'hand-right',
        value: 1,
        duration: 0.15,
        easing: 'linear',
      }).params,
    ).toMatchObject({ duration: 0.15 });
    expect(
      resolve('xr_set_device_state', {
        state: {
          hands: { right: { poseId: 'point', pinchValue: 0.5 } },
          controllers: { left: { orientation: { yaw: 90 } } },
        },
      }).params,
    ).toMatchObject({ state: { hands: { right: { poseId: 'point' } } } });
    // Quaternions and euler angles still set any device as before.
    expect(
      resolve('xr_set_transform', {
        device: 'headset',
        position: { x: 0, y: 1.6, z: 0 },
        orientation: { pitch: -10, yaw: 45 },
      }).params,
    ).toMatchObject({ orientation: { pitch: -10, yaw: 45 } });
  });

  test('rejects misspelt keys and out-of-range values at every level, naming them', () => {
    for (const [toolName, params, message] of [
      [
        'xr_set_transform',
        {
          device: 'hand-right',
          orientation: { fingers: 'forward', thum: 'up' },
        },
        'xr_set_transform.orientation has unknown parameter "thum"; allowed: fingers, palm, thumb',
      ],
      [
        'xr_set_transform',
        { device: 'headset', orientation: { x: 0, y: 0, z: 0 } },
        'xr_set_transform.orientation.w is required',
      ],
      [
        'xr_set_transform',
        { device: 'hand-right', orientation: 'automatic' },
        'xr_set_transform.orientation must be one of: auto',
      ],
      [
        'xr_animate_to',
        { device: 'hand-right', anchr: 'grasp' },
        'xr_animate_to has unknown parameter "anchr"',
      ],
      [
        'xr_animate_to',
        { device: 'headset', position: { x: 0, y: 1.6 } },
        'xr_animate_to.position.z is required',
      ],
      [
        'xr_run_sequence',
        { device: 'hand-right', steps: [{ target: 'button', pres: {} }] },
        'xr_run_sequence.steps[0] has unknown parameter "pres"',
      ],
      [
        'xr_run_sequence',
        { device: 'hand-right', steps: [{ press: { depth: 0.02 } }] },
        'xr_run_sequence.steps[0].press.depth must be at most 0.015',
      ],
      [
        'xr_run_sequence',
        {
          device: 'hand-right',
          steps: [{ target: 'pin', pinch: { value: 1, at: 'arival' } }],
        },
        'xr_run_sequence.steps[0].pinch.at must be one of: arrival',
      ],
      [
        'xr_run_sequence',
        { device: 'hand-right', steps: [] },
        'xr_run_sequence.steps requires at least 1 items',
      ],
      [
        'xr_run_sequence',
        { device: 'controller-right', steps: [{ duration: 1 }] },
        'xr_run_sequence.device must be one of: hand-left, hand-right',
      ],
      [
        'xr_set_hand_pose',
        {
          device: 'hand-left',
          poseId: 'open',
          fingers: { index: { poseId: 'fist', weight: 2 } },
        },
        'xr_set_hand_pose.fingers.index.weight must be at most 1',
      ],
      [
        'xr_microgesture',
        { device: 'hand-right', gesture: 'swipe-up' },
        'xr_microgesture.gesture must be one of:',
      ],
      [
        'xr_get_hand_state',
        { device: 'hand-right', joints: 'some' },
        'xr_get_hand_state.joints must be one of: key, all',
      ],
      [
        'xr_set_device_state',
        { state: { hands: { left: { pinchValue: 2 } } } },
        'xr_set_device_state.state.hands.left.pinchValue must be at most 1',
      ],
      [
        'xr_cancel_sequence',
        { device: 'hand-right' },
        'xr_cancel_sequence has unknown parameter "device"',
      ],
      [
        'xr_list_targets',
        { resolver: true },
        'xr_list_targets has unknown parameter "resolver"',
      ],
    ] as const) {
      expect(() => resolve(toolName, params), toolName).toThrow(message);
    }
    expect(() => resolve('xr_microgesture', { device: 'hand-right' })).toThrow(
      'xr_microgesture requires parameter: gesture',
    );
  });

  test('glosses every built-in pose in the set_hand_pose description', () => {
    const { description } = getRuntimeOperationByToolName('xr_set_hand_pose')!;
    for (const pose of ['default', 'point', 'thumbs-up', 'microgesture']) {
      expect(description).toContain(`${pose} (`);
    }
  });
});
