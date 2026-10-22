/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createInjectionModuleSource,
  resolveInjectionRuntimeFile,
  resolveInjectionRuntimeId,
} from '../src/injection-bundler.js';
import type { InjectionBundleResult } from '../src/types.js';

const directory = path.resolve('/plugin/dist/injection');
const bundle: InjectionBundleResult = {
  entryPath: path.join(directory, 'runtime.js'),
  directory,
  config: '{ "iwer": true }',
  size: 1,
};

describe('injection runtime', () => {
  it('imports the runtime and starts it with the configuration', () => {
    expect(createInjectionModuleSource(bundle)).toBe(
      'import { startIwsdkDevRuntime } from "virtual:iwsdk-dev-runtime/runtime.js";\nstartIwsdkDevRuntime({ "iwer": true });',
    );
  });

  it('resolves runtime ids and relative imports between its chunks', () => {
    expect(
      resolveInjectionRuntimeId(
        'virtual:iwsdk-dev-runtime/runtime.js',
        '/app/x',
      ),
    ).toBe('\0virtual:iwsdk-dev-runtime/runtime.js');
    expect(
      resolveInjectionRuntimeId(
        './chunks/kitchen-abc.js',
        '\0virtual:iwsdk-dev-runtime/runtime.js',
      ),
    ).toBe('\0virtual:iwsdk-dev-runtime/chunks/kitchen-abc.js');
    expect(
      resolveInjectionRuntimeId(
        './index-abc.js',
        '\0virtual:iwsdk-dev-runtime/chunks/kitchen-abc.js',
      ),
    ).toBe('\0virtual:iwsdk-dev-runtime/chunks/index-abc.js');
    expect(resolveInjectionRuntimeId('./other.js', '/app/main.ts')).toBeNull();
    expect(resolveInjectionRuntimeId('three', undefined)).toBeNull();
  });

  it('loads only files inside the runtime folder', () => {
    expect(
      resolveInjectionRuntimeFile(
        bundle,
        '\0virtual:iwsdk-dev-runtime/runtime.js',
      ),
    ).toBe(bundle.entryPath);
    expect(
      resolveInjectionRuntimeFile(
        bundle,
        '\0virtual:iwsdk-dev-runtime/chunks/kitchen-abc.js',
      ),
    ).toBe(path.join(directory, 'chunks', 'kitchen-abc.js'));
    expect(
      resolveInjectionRuntimeFile(
        bundle,
        '\0virtual:iwsdk-dev-runtime/../index.js',
      ),
    ).toBeNull();
    expect(
      resolveInjectionRuntimeFile(
        bundle,
        '\0virtual:iwsdk-dev-runtime/notes.txt',
      ),
    ).toBeNull();
    expect(resolveInjectionRuntimeFile(bundle, '/app/main.ts')).toBeNull();
  });
});
