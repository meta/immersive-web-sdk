/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { expect, test } from 'vitest';
import { buildRuntimeCommandHelp } from '../src/help.js';
import {
  getRuntimeOperationByCliPath,
  resolveRuntimeOperationRequest,
} from '../src/runtime-contract.js';

test('prints fields nested inside array items in runtime help', () => {
  const help = buildRuntimeCommandHelp('browser', 'interact').join('\n');

  expect(help).toContain('steps[].action (required) [enum]');
  expect(help).toContain('keyDown');
  expect(help).toContain('keyUp');
  expect(help).toContain('steps[].durationMs [integer]');
  expect(help).toContain('steps[].locator.role [string]');
  expect(help).toContain('scoped to this batch');
});

test('shows a working hand sequence example, not an empty step', () => {
  const help = buildRuntimeCommandHelp('xr', 'run-sequence').join('\n');
  for (const action of ['run-sequence', 'set-hand-pose']) {
    const example = buildRuntimeCommandHelp('xr', action)
      .join('\n')
      .match(/--input-json '(.+)'/)![1];
    expect(() =>
      resolveRuntimeOperationRequest(
        getRuntimeOperationByCliPath('xr', action)!,
        JSON.parse(example),
      ),
    ).not.toThrow();
  }

  expect(help).toContain(
    `iwsdk xr run-sequence --input-json '{"device":"hand-right","steps":[{"label":"press","target":"counter-button","press":{}}]}'`,
  );
  expect(help).not.toContain('"steps":[{}]');
  expect(buildRuntimeCommandHelp('xr', 'set-hand-pose').join('\n')).toContain(
    `--input-json '{"device":"hand-right","poseId":"point"}'`,
  );
});
