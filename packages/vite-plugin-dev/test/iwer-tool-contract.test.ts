/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { RUNTIME_OPERATIONS, XR_HAND_POSE_GLOSS } from '@iwsdk/cli/contract';
import { BUILTIN_HAND_POSE_IDS } from 'iwer';
import { REMOTE_METHOD_SCHEMAS } from 'iwer/lib/remote/catalog.js';
import { describe, expect, test } from 'vitest';

type Schema = Record<string, any>;

// IWER's SEM world queries have no IWSDK tool; IWSDK's scene tools cover it.
const UNEXPOSED_IWER_METHODS = ['get_world_state', 'get_objects'];
// Added by IWSDK to every runtime tool, not IWER parameters.
const IWSDK_ROUTING_PARAMETERS = ['expectedTab', 'runtimeTarget'];

/**
 * What a schema accepts, reduced to what both catalogs state: types, enums,
 * keys, required keys, strictness, bounds and union members.
 */
function shape(schema: Schema): unknown {
  if (schema.anyOf || schema.oneOf) {
    // A union nested in a union adds nothing.
    const members = (schema.anyOf ?? schema.oneOf).flatMap(
      (member: Schema) => member.anyOf ?? [member],
    );
    return { anyOf: members.map(shape) };
  }
  const result: Schema = {};
  if (schema.type) {
    result.type = schema.type === 'integer' ? 'number' : schema.type;
  }
  if (schema.enum) {
    result.enum = schema.enum;
  }
  if (schema.properties) {
    result.properties = Object.fromEntries(
      Object.keys(schema.properties)
        .filter((key) => !IWSDK_ROUTING_PARAMETERS.includes(key))
        .sort()
        .map((key) => [key, shape(schema.properties[key])]),
    );
    result.required = [...(schema.required ?? [])].sort();
  }
  if (schema.additionalProperties === false) {
    result.strict = true;
  }
  // IWER writes a tuple as prefixItems; IWSDK as items with a fixed length.
  const items = schema.items ?? schema.prefixItems?.[0];
  if (items) {
    result.items = shape(items);
  }
  for (const bound of [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'minItems',
    'maxItems',
  ]) {
    if (schema[bound] != null) {
      result[bound] = schema[bound];
    }
  }
  return result;
}

const xrOperations = RUNTIME_OPERATIONS.filter((operation) =>
  operation.mcpName.startsWith('xr_'),
);

describe('IWSDK xr tools mirror the installed IWER', () => {
  test('every IWER device method has an xr tool', () => {
    expect(xrOperations.map((operation) => operation.wsMethod).sort()).toEqual(
      Object.keys(REMOTE_METHOD_SCHEMAS)
        .filter((method) => !UNEXPOSED_IWER_METHODS.includes(method))
        .sort(),
    );
  });

  test.each(xrOperations.map((operation) => [operation.mcpName, operation]))(
    '%s accepts what IWER accepts',
    (_, operation) => {
      const iwer = REMOTE_METHOD_SCHEMAS[operation.wsMethod] as Schema;
      // Loose IWER methods (older than catalog version 3) ignore unknown keys;
      // IWSDK has always rejected them.
      const iwerShape = shape(iwer) as Schema;
      const iwsdkShape = shape(operation.inputSchema) as Schema;
      if (!iwerShape.strict) {
        delete iwsdkShape.strict;
      }
      expect(iwsdkShape).toEqual(iwerShape);
    },
  );

  test('glosses exactly the built-in hand poses', () => {
    expect(Object.keys(XR_HAND_POSE_GLOSS).sort()).toEqual(
      [...BUILTIN_HAND_POSE_IDS].sort(),
    );
  });
});
