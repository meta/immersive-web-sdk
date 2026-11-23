/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(
  readFileSync(
    new URL('../../schemas/iwsdk-project.v1.schema.json', import.meta.url),
    'utf8',
  ),
) as Record<string, any>;

describe('published project JSON Schema source', () => {
  it('is a closed, versioned schema aligned with the runtime contract', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe(
      'https://iwsdk.dev/schemas/iwsdk-project.v1.schema.json',
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['version', 'scene', 'world']);
    expect(schema.properties.version).toEqual({
      const: 'iwsdk.project.v1',
    });
    expect(schema.$defs.world.required).toEqual(['xr']);
    expect(schema.$defs.xr.oneOf[1].required).toEqual(['mode']);
  });

  it('bounds gaze tuning values that cannot be negative or zero', () => {
    const gaze = schema.$defs.gaze.properties;
    expect(gaze.coneAngle).toEqual({
      type: 'number',
      exclusiveMinimum: 0,
      exclusiveMaximum: 180,
    });
    expect(gaze.maxRayLength).toEqual({
      type: 'number',
      exclusiveMinimum: 0,
    });
    expect(gaze.filterMinCutoff).toEqual({
      type: 'number',
      exclusiveMinimum: 0,
    });
    for (const key of [
      'dwellWindowSeconds',
      'filterBeta',
      'trackingLossGraceSeconds',
    ]) {
      expect(gaze[key]).toEqual({ type: 'number', minimum: 0 });
    }
  });

  it('keeps executable and operator-only plugin values out of the schema', () => {
    const source = JSON.stringify(schema);
    expect(source).not.toContain('componentSets');
    expect(source).not.toContain('pointerLock');
    expect(source).not.toContain('verbose');
    expect(source).not.toContain('workspace');
    expect(schema.$defs.emulator.properties).not.toHaveProperty('https');
    expect(schema.$defs.dev.properties).not.toHaveProperty('https');
    expect(schema.$defs.emulator.properties).toHaveProperty('activation');
    expect(schema.$defs.emulator.properties).toHaveProperty('injectOnBuild');
    expect(schema.$defs.emulator.properties).toHaveProperty(
      'userAgentException',
    );
    // Alpha native target: an object whose keys @iwer/native owns.
    expect(schema.properties.native.type).toBe('object');
    expect(schema.properties.native).not.toHaveProperty('properties');
  });

  it('rejects path traversal in schema-level source path patterns', () => {
    const scenePattern = new RegExp(schema.properties.scene.pattern);
    const modulePattern = new RegExp(
      schema.$defs.moduleDeclaration.properties.module.pattern,
    );

    expect(scenePattern.test('./public/scenes/main.iwsdk.scene.json')).toBe(
      true,
    );
    expect(scenePattern.test('./public/scenes/../main.iwsdk.scene.json')).toBe(
      false,
    );
    expect(modulePattern.test('./src/assets')).toBe(true);
    expect(modulePattern.test('./src/../assets')).toBe(false);
    expect(modulePattern.test(' ./src/assets')).toBe(false);
    expect(modulePattern.test('./src/assets ')).toBe(false);
  });

  it('keeps JSON-safe regular-expression flags aligned with RegExp', () => {
    const flagsPattern = new RegExp(
      schema.$defs.regex.properties.flags.pattern,
    );

    expect(flagsPattern.test('gims')).toBe(true);
    expect(flagsPattern.test('ii')).toBe(false);
    expect(flagsPattern.test('uv')).toBe(false);
  });
});
