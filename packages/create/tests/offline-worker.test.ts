/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Runs the iwsdk-offline skill's service worker in a VM against fake caches, clients and network,
// so its install, take-over and third-party rules are checked without a browser.

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
import { runInNewContext } from 'node:vm';
import { afterEach, expect, test } from 'vitest';

const ASSETS = fileURLToPath(
  new URL(
    '../../core/agent-guidance/claude/.claude/skills/iwsdk-offline/assets',
    import.meta.url,
  ),
);
const SCOPE = 'https://app.test/game/';
const PROFILES =
  'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/meta-quest-touch-plus';
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

type Listener = (event: unknown) => void;

class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(key: string | { url: string }) {
    const held = this.entries.get(typeof key === 'string' ? key : key.url);
    return held?.clone();
  }
  async put(key: string | { url: string }, response: Response) {
    this.entries.set(typeof key === 'string' ? key : key.url, response);
  }
}

class FakeCaches {
  readonly named = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.named.has(name)) {
      this.named.set(name, new FakeCache());
    }
    return this.named.get(name)!;
  }
  async keys() {
    return [...this.named.keys()];
  }
  async delete(name: string) {
    return this.named.delete(name);
  }
}

// Builds dist/ from `files`, writes sw.js with the kit's build script, and starts it in a VM.
async function startWorker(
  files: Record<string, string>,
  server: Record<string, string>,
  pages: string[] = [],
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'iwsdk-offline-sw-'));
  tempDirs.push(directory);
  const script = path.join(directory, 'write-service-worker.mjs');
  await copyFile(
    path.join(ASSETS, 'write-service-worker.mjs.template'),
    script,
  );
  const { writeServiceWorker } = (await import(pathToFileURL(script).href)) as {
    writeServiceWorker(dist: string, template: string): { release: string };
  };
  const dist = path.join(directory, 'dist');
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
    await writeFile(path.join(dist, file), body);
  }
  const { release } = writeServiceWorker(
    dist,
    path.join(ASSETS, 'sw.js.template'),
  );
  const code = await readFile(path.join(dist, 'sw.js'), 'utf8');

  const listeners = new Map<string, Listener>();
  const caches = new FakeCaches();
  const fetched: string[] = [];
  const state = { skippedWaiting: 0 };
  const fetch = async (input: string | { url: string }) => {
    const url = typeof input === 'string' ? input : input.url;
    fetched.push(url);
    const body = server[url];
    return body == null
      ? new Response('missing', { status: 404 })
      : new Response(body, { status: 200 });
  };
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: async () => {
      state.skippedWaiting += 1;
    },
    clients: {
      claim: async () => {},
      // A waiting worker controls no page, so it sees open pages only with includeUncontrolled.
      matchAll: async (options?: { includeUncontrolled?: boolean }) =>
        options?.includeUncontrolled ? pages.map((url) => ({ url })) : [],
    },
  };
  runInNewContext(code, {
    self,
    caches,
    fetch,
    crypto: globalThis.crypto,
    Response,
    Headers,
    URL,
    console,
  });

  async function dispatch(type: string, fields: object) {
    const pending: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    listeners.get(type)!({
      ...fields,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      respondWith: (promise: Promise<Response>) => {
        answer = promise;
      },
    });
    const response = await answer;
    // Settle work started while answering, such as keeping a file.
    while (pending.length > 0) {
      await Promise.all(pending.splice(0));
    }
    return response;
  }

  return {
    release,
    caches,
    fetched,
    state,
    install: () => dispatch('install', {}),
    activate: () => dispatch('activate', {}),
    message: (data: unknown) => dispatch('message', { data }),
    request: (url: string) =>
      dispatch('fetch', { request: { url, method: 'GET', mode: 'cors' } }),
  };
}

test('install takes unchanged files from the earlier release and downloads only the changed one', async () => {
  const worker = await startWorker(
    { 'index.html': '<!doctype html>', 'assets/app-2.js': 'two' },
    {
      [`${SCOPE}index.html`]: '<!doctype html>',
      [`${SCOPE}assets/app-2.js`]: 'two',
    },
  );
  const earlier = await worker.caches.open('myapp-release-earlier');
  await earlier.put(
    `${SCOPE}index.html`,
    new Response('<!doctype html>', {
      headers: { 'x-content-sha256': sha256('<!doctype html>') },
    }),
  );

  await worker.install();

  expect(worker.fetched).toEqual([`${SCOPE}assets/app-2.js`]);
  const release = worker.caches.named.get(`myapp-release-${worker.release}`)!;
  expect([...release.entries.keys()].sort()).toEqual([
    `${SCOPE}assets/app-2.js`,
    `${SCOPE}index.html`,
  ]);
  await worker.activate();
  expect(await worker.caches.keys()).toEqual([
    `myapp-release-${worker.release}`,
  ]);
});

test('install fails when the server keeps sending other bytes than the release lists', async () => {
  const worker = await startWorker(
    { 'index.html': 'new' },
    { [`${SCOPE}index.html`]: 'stale' },
  );
  await expect(worker.install()).rejects.toThrow(/no copy with sha256/);
  // Asked once from the HTTP cache, once revalidated.
  expect(worker.fetched).toEqual([`${SCOPE}index.html`, `${SCOPE}index.html`]);
});

test('takes over when the asking page is the only page of the app open', async () => {
  const worker = await startWorker({ 'index.html': 'a' }, {}, [
    `${SCOPE}`,
    'https://app.test/admin/', // outside the scope: another app on the origin
  ]);
  await worker.message('take-over');
  expect(worker.state.skippedWaiting).toBe(1);
});

test('waits while another page of the app is open, so neither page changes release', async () => {
  const worker = await startWorker({ 'index.html': 'a' }, {}, [
    `${SCOPE}`,
    `${SCOPE}?source=pwa`,
  ]);
  await worker.message('take-over');
  expect(worker.state.skippedWaiting).toBe(0);
});

test('keeps both hands of a controller model when one is fetched through the worker', async () => {
  const worker = await startWorker(
    { 'index.html': 'a' },
    { [`${PROFILES}/right.glb`]: 'R', [`${PROFILES}/left.glb`]: 'L' },
  );

  const response = await worker.request(`${PROFILES}/right.glb`);
  expect(await response!.text()).toBe('R');
  const kept = worker.caches.named.get('myapp-third-party')!;
  expect([...kept.entries.keys()].sort()).toEqual([
    `${PROFILES}/left.glb`,
    `${PROFILES}/right.glb`,
  ]);

  worker.fetched.length = 0;
  expect(await (await worker.request(`${PROFILES}/left.glb`))!.text()).toBe(
    'L',
  );
  expect(worker.fetched).toEqual([]);
});

test('keeps both hands of a controller model the page fetched before the worker existed', async () => {
  const worker = await startWorker(
    { 'index.html': 'a' },
    { [`${PROFILES}/left.glb`]: 'L', [`${PROFILES}/right.glb`]: 'R' },
  );
  await worker.message({ fetched: [`${PROFILES}/left.glb`] });
  const kept = worker.caches.named.get('myapp-third-party')!;
  expect([...kept.entries.keys()].sort()).toEqual([
    `${PROFILES}/left.glb`,
    `${PROFILES}/right.glb`,
  ]);
});

test('keeps the starter stock models from the CDN', async () => {
  const assets = await readFile(
    fileURLToPath(new URL('../template/common/src/assets.ts', import.meta.url)),
    'utf8',
  );
  const base = /DEFAULT_STOCK_ASSET_BASE =\s*'([^']+)'/.exec(assets)![1];
  const model = `${base}/robot/robot.glb`;
  const worker = await startWorker({ 'index.html': 'a' }, { [model]: 'M' });

  await worker.request(model);
  expect([
    ...worker.caches.named.get('myapp-third-party')!.entries.keys(),
  ]).toEqual([model]);
});
