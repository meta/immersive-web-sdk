/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { expect, test } from 'vitest';

const templateUrl = new URL(
  '../../core/agent-guidance/claude/.claude/skills/iwsdk-build-model/assets/hardsurface.ts.template',
  import.meta.url,
);

type GeometryLike = {
  getAttribute(name: string): {
    count: number;
    getX(index: number): number;
    getY(index: number): number;
    getZ(index: number): number;
  };
  getIndex(): {
    count: number;
    getX(index: number): number;
  } | null;
};

function signedVolume(geometry: GeometryLike): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triangleCount = Math.floor((index?.count ?? position.count) / 3);
  let volume = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const a = index?.getX(offset) ?? offset;
    const b = index?.getX(offset + 1) ?? offset + 1;
    const c = index?.getX(offset + 2) ?? offset + 2;
    volume +=
      position.getX(a) *
        (position.getY(b) * position.getZ(c) -
          position.getZ(b) * position.getY(c)) +
      position.getY(a) *
        (position.getZ(b) * position.getX(c) -
          position.getX(b) * position.getZ(c)) +
      position.getZ(a) *
        (position.getX(b) * position.getY(c) -
          position.getY(b) * position.getX(c));
  }
  return volume / 6;
}

test('mirrors non-indexed hard-surface geometry without reversing winding', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'iwsdk-hardsurface-'));
  try {
    const requireFromCore = createRequire(
      new URL('../../core/package.json', import.meta.url),
    );
    const threeUrl = pathToFileURL(requireFromCore.resolve('three')).href;
    const template = await readFile(templateUrl, 'utf8');
    const source = template.replace(
      "from '@iwsdk/core';",
      `from '${threeUrl}';`,
    );
    const modulePath = path.join(directory, 'hardsurface.mjs');
    await writeFile(
      modulePath,
      transpileModule(source, {
        compilerOptions: {
          module: ModuleKind.ESNext,
          target: ScriptTarget.ES2022,
        },
      }).outputText,
    );
    const module = (await import(pathToFileURL(modulePath).href)) as {
      bevelBox(width: number, height: number, depth: number): GeometryLike;
      mirrorGeometryX(geometry: GeometryLike): GeometryLike;
    };
    const original = module.bevelBox(2, 3, 4);
    const mirrored = module.mirrorGeometryX(original);

    expect(original.getIndex()).toBeNull();
    expect(mirrored.getIndex()).toBeNull();
    expect(Math.abs(signedVolume(original))).toBeGreaterThan(1);
    expect(Math.sign(signedVolume(mirrored))).toBe(
      Math.sign(signedVolume(original)),
    );
    expect(Math.abs(signedVolume(mirrored))).toBeCloseTo(
      Math.abs(signedVolume(original)),
      5,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
