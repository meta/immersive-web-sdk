/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import {
  createProgram,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
} from 'typescript';
import { afterEach, expect, test } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const ASSETS = path.join(
  PACKAGE_ROOT,
  'guidance/claude/.claude/skills/iwsdk-offline/assets',
);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'iwsdk-offline-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function capture(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (match == null) {
    throw new Error(`${pattern} matched nothing`);
  }
  return match[1];
}

type Release = {
  release: string;
  files: Record<string, string>;
  onRequest: Record<string, string>;
};

test('writes a deterministic worker that leaves out source maps and agent guidance', async () => {
  const directory = await makeTempDir();
  const scriptPath = path.join(directory, 'write-service-worker.mjs');
  await copyFile(
    path.join(ASSETS, 'write-service-worker.mjs.template'),
    scriptPath,
  );
  const { writeServiceWorker } = (await import(
    pathToFileURL(scriptPath).href
  )) as { writeServiceWorker(dist: string, template: string): Release };

  const dist = path.join(directory, 'dist');
  const outputs: Record<string, string> = {
    'index.html': '<!doctype html>',
    'assets/index-3f9a2c.js': 'console.log(1);',
    'assets/index-3f9a2c.js.map': '{}',
    'fonts/ja-sans.woff2': 'font',
    'robots.txt': 'User-agent: *',
    'scenes/AGENTS.md': '# Scenes',
    'ui/AGENTS.md': '# UI',
  };
  for (const [file, content] of Object.entries(outputs)) {
    await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
    await writeFile(path.join(dist, file), content);
  }
  const template = path.join(ASSETS, 'sw.js.template');

  const first = writeServiceWorker(dist, template);
  const worker = await readFile(path.join(dist, 'sw.js'), 'utf8');
  // The second run sees the first run's sw.js, which is left out, so nothing changes.
  const second = writeServiceWorker(dist, template);

  expect(Object.keys(first.files)).toEqual([
    'assets/index-3f9a2c.js',
    'index.html',
  ]);
  expect(first.files['index.html']).toBe(
    createHash('sha256').update('<!doctype html>').digest('hex'),
  );
  expect(Object.keys(first.onRequest)).toEqual(['fonts/ja-sans.woff2']);
  expect(first.release).toMatch(/^[0-9a-f]{16}$/);
  expect(worker).toContain(`const RELEASE = "${first.release}";`);
  expect(worker).not.toMatch(/__RELEASE__|__FILES__|__ON_REQUEST__/);
  expect(() => new Script(worker)).not.toThrow();
  expect(second).toEqual(first);
  expect(await readFile(path.join(dist, 'sw.js'), 'utf8')).toBe(worker);
});

test('type-checks the page module under the scaffold strict settings', async () => {
  const directory = await makeTempDir();
  const modulePath = path.join(directory, 'offline.ts');
  await copyFile(path.join(ASSETS, 'offline.ts.template'), modulePath);

  const program = createProgram([modulePath], {
    strict: true,
    noEmit: true,
    isolatedModules: true,
    skipLibCheck: true,
    target: ScriptTarget.ES2020,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.Bundler,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    types: [],
  });

  expect(
    getPreEmitDiagnostics(program).map((diagnostic) =>
      flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    ),
  ).toEqual([]);
});

test('pins the third-party paths IWSDK fetches at runtime', async () => {
  const worker = await readFile(path.join(ASSETS, 'sw.js.template'), 'utf8');
  const pinned = new RegExp(capture(worker, /const PINNED =\s*\/(.+)\/;/));
  const profilesPath = capture(
    await readFile(
      path.join(
        WORKSPACE_ROOT,
        'packages/xr-input/src/gamepad/input-profiles.ts',
      ),
      'utf8',
    ),
    /DEFAULT_PROFILES_PATH =\s*'([^']+)'/,
  );
  // New projects install this three.js release, and IWSDK fetches the decoders for its revision.
  const revision = capture(
    await readFile(path.join(PACKAGE_ROOT, 'src/project-files.ts'), 'utf8'),
    /three: 'npm:super-three@0\.(\d+)\.\d+'/,
  );

  expect(pinned.test(`${profilesPath}/meta-quest-touch-plus/left.glb`)).toBe(
    true,
  );
  expect(
    pinned.test(
      `https://unpkg.com/three@0.${revision}.0/examples/jsm/libs/draco/gltf/draco_decoder.wasm`,
    ),
  ).toBe(true);
  expect(
    pinned.test(
      'https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.js',
    ),
  ).toBe(false);
});
