/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const coreRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
// In-memory only: never written to disk.
const probePath = path.join(coreRoot, 'src', '__set-value-probe.ts');
const probe = `import { createComponent, Types } from './ecs/component.js';
import type { Entity } from './ecs/entity.js';
const Probe = createComponent('SetValueProbe', {
  speed: { type: Types.Float32, default: 0 },
  label: { type: Types.String, default: '' },
  tint: { type: Types.Color, default: [1, 1, 1, 1] },
});
declare const entity: Entity;
entity.setValue(Probe, 'speed', 2);
entity.setValue(Probe, 'label', 'robot');
entity.setValue(Probe, 'tint', '#ff8000');
entity.setValue(Probe, 'tint', [1, 0.5, 0]);
entity.setValue(Probe, 'tint', 0xff8000);
// @ts-expect-error a number field rejects strings
entity.setValue(Probe, 'speed', 'fast');
// @ts-expect-error a string field rejects colors
entity.setValue(Probe, 'label', [1, 0, 0]);
// @ts-expect-error unknown keys are rejected
entity.setValue(Probe, 'missing', 1);
entity.setValue(Probe, '`;

function createProbeService() {
  const configPath = path.join(coreRoot, 'tsconfig.json');
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    coreRoot,
  );
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [probePath],
    getScriptVersion: () => '1',
    getScriptSnapshot: (file) => {
      if (file === probePath) {
        return ts.ScriptSnapshot.fromString(probe);
      }
      return fs.existsSync(file)
        ? ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8'))
        : undefined;
    },
    getCurrentDirectory: () => coreRoot,
    getCompilationSettings: () => config.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (file) => file === probePath || ts.sys.fileExists(file),
    readFile: (file) => (file === probePath ? probe : ts.sys.readFile(file)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  return ts.createLanguageService(host);
}

describe('Entity.setValue typing (#61)', () => {
  const service = createProbeService();

  it('completes every schema key, not only Color keys', () => {
    const completions = service.getCompletionsAtPosition(
      probePath,
      probe.length,
      {},
    );
    expect(completions?.entries.map((entry) => entry.name).sort()).toEqual([
      'label',
      'speed',
      'tint',
    ]);
  }, 60_000);

  it('accepts color inputs and still rejects wrong values and keys', () => {
    // The trailing incomplete call is the completion probe.
    const lastLine = probe.split('\n').length;
    const diagnostics = service
      .getSemanticDiagnostics(probePath)
      .filter((d) => probe.slice(0, d.start).split('\n').length !== lastLine)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(diagnostics).toEqual([]);
  }, 60_000);
});
