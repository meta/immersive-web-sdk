/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdtemp, rm } from 'fs/promises';
import { createServer, type Server } from 'http';
import os from 'os';
import path from 'path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
} from 'playwright';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';
import { getRuntimeSession } from '../../cli/src/runtime-state.js';
import { sendRuntimeCommand } from '../../cli/src/runtime-transport.js';
import { launchManagedBrowser } from '../src/headless-browser.js';
import {
  ManagedTabAudio,
  TAB_AUDIO_CHANGE_EVENT,
} from '../src/managed-browser/tab-audio.js';
import {
  createEditorTestHarness,
  type EditorTestHarness,
} from './editor-e2e-fixture.js';

// Half a second of 8-bit silence keeps media playback real but inaudible.
const SILENT_WAV = (() => {
  const samples = 4000;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples, 40);
  return `data:audio/wav;base64,${wav.toString('base64')}`;
})();

const START_STATE_SCRIPT = `<script>
  window.__mutedAtStart = window.__IWSDK_TAB_AUDIO?.muted ?? null;
  window.__changes = [];
  addEventListener(${JSON.stringify(TAB_AUDIO_CHANGE_EVENT)}, (event) => {
    window.__changes.push(event.detail.muted);
  });
</script>`;

const TOP_HTML = `<!doctype html><html><head>${START_STATE_SCRIPT}</head><body>
  <audio id="dom-audio" src="${SILENT_WAV}" loop></audio>
  <iframe id="child" src="/child"></iframe>
  <script>
    window.IWER_DEVICE = {};
    window.__IWSDK_MCP_PAGE_ID = 'tab-audio-fixture';
  </script>
</body></html>`;

const CHILD_HTML = `<!doctype html><html><head>${START_STATE_SCRIPT}</head><body>child</body></html>`;

// Registered before the controller so it sees the native audio primitives the
// controller captures: the hidden master gains and the real `muted` state.
function installAudioProbe(): void {
  const gains: GainNode[] = [];
  const createGain = BaseAudioContext.prototype.createGain;
  BaseAudioContext.prototype.createGain = function (this: BaseAudioContext) {
    const gain = createGain.call(this);
    gains.push(gain);
    return gain;
  };
  const muted = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'muted',
  )!;
  (window as any).__probe = {
    gainValues: () => gains.map((gain) => gain.gain.value),
    nativeMuted: (element: HTMLMediaElement) => muted.get!.call(element),
    setNativeMuted: (element: HTMLMediaElement, value: boolean) =>
      muted.set!.call(element, value),
  };
}

async function startFixtureServer(): Promise<{
  origin: string;
  server: Server;
}> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://fixture').pathname;
    response.setHeader('content-type', 'text/html');
    response.end(pathname === '/child' ? CHILD_HTML : TOP_HTML);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (typeof address !== 'object' || address == null) {
    throw new Error('Fixture server address is unavailable');
  }
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

async function childFrame(page: Page, origin: string): Promise<Frame> {
  await expect
    .poll(() =>
      page.frames().some((frame) => frame.url() === `${origin}/child`),
    )
    .toBe(true);
  return page.frames().find((frame) => frame.url() === `${origin}/child`)!;
}

describe('managed tab audio controller', () => {
  let browser: Browser;
  let changes: boolean[];
  let context: BrowserContext;
  let crossOrigin: { origin: string; server: Server };
  let fixture: { origin: string; server: Server };
  let page: Page;
  let tabAudio: ManagedTabAudio;

  const tabMuted = (frame: Frame | Page) =>
    frame.evaluate(() => (window as any).__IWSDK_TAB_AUDIO.muted);

  beforeAll(async () => {
    fixture = await startFixtureServer();
    crossOrigin = await startFixtureServer();
    browser = await chromium.launch({
      args: ['--autoplay-policy=no-user-gesture-required'],
      headless: true,
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    fixture?.server.close();
    crossOrigin?.server.close();
  });

  beforeEach(async () => {
    context = await browser.newContext();
    await context.addInitScript(installAudioProbe);
    page = await context.newPage();
    changes = [];
    tabAudio = await ManagedTabAudio.install(context, page, {
      muted: false,
      onMutedChange: (muted) => changes.push(muted),
    });
    await page.goto(fixture.origin);
  });

  afterEach(async () => {
    await context?.close();
  });

  test('routes speaker output through a hidden gain without changing context state', async () => {
    expect(
      await page.evaluate(() => {
        const w = window as any;
        w.context = new AudioContext();
        w.oscillator = w.context.createOscillator();
        const chained =
          w.oscillator.connect(w.context.destination) === w.context.destination;
        w.oscillator.start();
        return {
          chained,
          gains: w.__probe.gainValues(),
          state: w.context.state,
        };
      }),
    ).toEqual({ chained: true, gains: [1], state: 'running' });

    await expect(tabAudio.setMuted(true)).resolves.toBe(true);
    const muted = await page.evaluate(async () => {
      const w = window as any;
      const startedAt = w.context.currentTime;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const late = new AudioContext();
      late.createOscillator().connect(late.destination);
      const offline = new OfflineAudioContext(1, 128, 8000);
      const source = new ConstantSourceNode(offline, { offset: 0.5 });
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return {
        advanced: w.context.currentTime > startedAt,
        gains: w.__probe.gainValues(),
        offlinePeak: Math.max(...rendered.getChannelData(0)),
        state: w.context.state,
      };
    });
    expect(muted).toEqual({
      advanced: true,
      gains: [0, 0],
      offlinePeak: 0.5,
      state: 'running',
    });

    expect(
      await page.evaluate(() => {
        const w = window as any;
        w.oscillator.disconnect(w.context.destination);
        try {
          w.oscillator.disconnect(w.context.destination);
          return 'disconnected twice';
        } catch (error) {
          return (error as Error).name;
        }
      }),
    ).toBe('InvalidAccessError');

    await tabAudio.setMuted(false);
    expect(
      await page.evaluate(() => (window as any).__probe.gainValues()),
    ).toEqual([1, 1]);

    // Native disconnect() still succeeds once a context has been closed.
    expect(
      await page.evaluate(async () => {
        const context = new AudioContext();
        const source = context.createConstantSource();
        source.connect(context.destination);
        await context.close();
        // Connecting another context prunes closed ones from the gain set.
        const next = new AudioContext();
        next.createConstantSource().connect(next.destination);
        source.disconnect(context.destination);
        return 'disconnected';
      }),
    ).toBe('disconnected');
  });

  test('leaves session storage untouched until the state first changes', async () => {
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    await tabAudio.setMuted(false);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    await tabAudio.setMuted(true);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(1);
  });

  test('silences media routed into Web Audio at the gain so analysers keep their input', async () => {
    const read = () =>
      page.evaluate(() => {
        const w = window as any;
        return {
          constructed: w.__probe.nativeMuted(w.constructed),
          factory: w.__probe.nativeMuted(w.factory),
          gains: w.__probe.gainValues(),
          page: [w.constructed.muted, w.factory.muted],
        };
      });
    await page.evaluate(async (src) => {
      const w = window as any;
      w.context = new AudioContext();
      w.factory = new Audio(src);
      w.factory.loop = true;
      await w.factory.play();
      w.constructed = new Audio(src);
      w.constructed.loop = true;
      await w.constructed.play();
    }, SILENT_WAV);
    await tabAudio.setMuted(true);
    const constructorIdentity = await page.evaluate(() => {
      const w = window as any;
      // Routing an already force-muted element releases it to the gain.
      const factorySource = w.context.createMediaElementSource(w.factory);
      factorySource.connect(w.context.destination);
      new MediaElementAudioSourceNode(w.context, {
        mediaElement: w.constructed,
      }).connect(w.context.destination);
      w.constructed.muted = false;
      return factorySource.constructor === MediaElementAudioSourceNode;
    });
    expect(constructorIdentity).toBe(true);

    expect(await read()).toEqual({
      constructed: false,
      factory: false,
      gains: [0],
      page: [false, false],
    });
    await tabAudio.setMuted(false);
    expect(await read()).toEqual({
      constructed: false,
      factory: false,
      gains: [1],
      page: [false, false],
    });
  });

  test('mutes autoplay media inside shadow roots', async () => {
    await tabAudio.setMuted(true);
    await page.evaluate(async (src) => {
      const host = document.createElement('div');
      document.body.append(host);
      const root = host.attachShadow({ mode: 'closed' });
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.loop = true;
      audio.src = src;
      (window as any).shadowAudio = audio;
      await new Promise((resolve) => {
        audio.addEventListener('playing', resolve, { once: true });
        root.append(audio);
      });
    }, SILENT_WAV);

    expect(
      await page.evaluate(() => {
        const w = window as any;
        return [w.__probe.nativeMuted(w.shadowAudio), w.shadowAudio.muted];
      }),
    ).toEqual([true, false]);
  });

  test('applies the state to every page in the managed browser', async () => {
    const existing = await context.newPage();
    await existing.goto(fixture.origin);
    await tabAudio.setMuted(true);
    expect(await tabMuted(existing)).toBe(true);

    const opened = await context.newPage();
    await opened.goto(crossOrigin.origin);
    await expect.poll(() => tabMuted(opened)).toBe(true);
  });

  test('force-mutes media elements while page code keeps its own muted value', async () => {
    await page.evaluate(async (src) => {
      const w = window as any;
      w.detached = new Audio(src);
      w.detached.loop = true;
      w.quiet = new Audio(src);
      w.quiet.loop = true;
      w.quiet.muted = true;
      w.dom = document.getElementById('dom-audio');
      await Promise.all([w.detached.play(), w.quiet.play(), w.dom.play()]);
    }, SILENT_WAV);
    const read = () =>
      page.evaluate(() => {
        const w = window as any;
        return Object.fromEntries(
          ['detached', 'quiet', 'dom', 'late']
            .filter((name) => w[name] != null)
            .map((name) => [
              name,
              { native: w.__probe.nativeMuted(w[name]), page: w[name].muted },
            ]),
        );
      });

    await tabAudio.setMuted(true);
    expect(await read()).toEqual({
      detached: { native: true, page: false },
      dom: { native: true, page: false },
      quiet: { native: true, page: true },
    });

    await page.evaluate(async (src) => {
      const w = window as any;
      w.detached.muted = true;
      w.detached.muted = false;
      // Native media controls write the real state of an element directly.
      w.__probe.setNativeMuted(w.dom, false);
      w.late = new Audio(src);
      w.late.loop = true;
      await w.late.play();
    }, SILENT_WAV);
    await expect.poll(read).toEqual({
      detached: { native: true, page: false },
      dom: { native: true, page: false },
      late: { native: true, page: false },
      quiet: { native: true, page: true },
    });

    await tabAudio.setMuted(false);
    expect(await read()).toEqual({
      detached: { native: false, page: false },
      dom: { native: false, page: false },
      late: { native: false, page: false },
      quiet: { native: true, page: true },
    });
  });

  test('restores the state before page scripts run after a reload', async () => {
    await tabAudio.setMuted(true);
    await page.reload();
    const child = await childFrame(page, fixture.origin);

    expect(await page.evaluate(() => (window as any).__mutedAtStart)).toBe(
      true,
    );
    expect(await child.evaluate(() => (window as any).__mutedAtStart)).toBe(
      true,
    );
  });

  test('converges frames that commit after a change, including cross-origin frames', async () => {
    await tabAudio.setMuted(true);
    await page.evaluate((src) => {
      (document.getElementById('child') as HTMLIFrameElement).src = src;
    }, `${crossOrigin.origin}/child`);
    const child = await childFrame(page, crossOrigin.origin);

    await expect.poll(() => tabMuted(child)).toBe(true);
    expect(await tabMuted(page)).toBe(true);
  });

  test('accepts the workspace binding only from the main frame and notifies once per change', async () => {
    const setFrom = (frame: Frame | Page, muted: unknown) =>
      frame.evaluate(
        (value) => (window as any).__IWSDK_SET_TAB_AUDIO_MUTED(value),
        muted,
      );

    await expect(setFrom(page, true)).resolves.toBe(true);
    await expect(setFrom(page, true)).resolves.toBe(true);
    const child = await childFrame(page, fixture.origin);
    await expect(setFrom(child, false)).rejects.toThrow(
      'Only the managed page can change tab audio.',
    );
    await expect(setFrom(page, 'false')).rejects.toThrow(
      'muted must be a boolean.',
    );

    expect(tabAudio.isMuted()).toBe(true);
    expect(changes).toEqual([true]);
    expect(await tabMuted(child)).toBe(true);
    expect(await page.evaluate(() => (window as any).__changes)).toEqual([
      true,
    ]);
  });

  test('does not hold the command while a frame is blocked by a long task', async () => {
    await page.evaluate(() => {
      setTimeout(() => {
        const end = Date.now() + 3_500;
        while (Date.now() < end) {
          // Block the renderer's main thread.
        }
      }, 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const startedAt = Date.now();
    await expect(tabAudio.setMuted(true)).resolves.toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    await expect.poll(() => tabMuted(page), { timeout: 10_000 }).toBe(true);
  });
});

describe('managed browser launch', () => {
  let fixture: { origin: string; server: Server };
  let workspaceRoot: string;

  beforeAll(async () => {
    process.env.IWSDK_GPU = 'swiftshader';
    fixture = await startFixtureServer();
    workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'iwsdk-tab-audio-e2e-'),
    );
  });

  afterAll(async () => {
    fixture?.server.close();
    await rm(workspaceRoot, { force: true, recursive: true });
  });

  test('starts every document muted when launched with the dev-session state', async () => {
    const changes: boolean[] = [];
    const browser = await launchManagedBrowser(
      `${fixture.origin}/`,
      true,
      false,
      { height: 600, width: 800 },
      { height: 600, width: 800 },
      false,
      null,
      'iwer',
      workspaceRoot,
      false,
      undefined,
      { muted: true, onMutedChange: (muted) => changes.push(muted) },
    );
    try {
      const page = browser.page as Page;
      const child = await childFrame(page, fixture.origin);
      expect(await page.evaluate(() => (window as any).__mutedAtStart)).toBe(
        true,
      );
      expect(await child.evaluate(() => (window as any).__mutedAtStart)).toBe(
        true,
      );

      await expect(browser.setAudioMuted(false)).resolves.toBe(false);
      expect(changes).toEqual([false]);
      expect(
        await child.evaluate(() => (window as any).__IWSDK_TAB_AUDIO.muted),
      ).toBe(false);
    } finally {
      await browser.close();
    }
  }, 120_000);
});

describe('managed tab audio through the dev server', () => {
  let harness: EditorTestHarness;

  async function command(method: string, params = {}) {
    const session = await getRuntimeSession(harness.tempRoot);
    if (!session) {
      throw new Error('No runtime session');
    }
    return sendRuntimeCommand({
      port: session.port,
      method,
      params,
      runtimeSession: session,
      timeoutMs: 60_000,
    });
  }

  async function status() {
    return (await command('runtime_get_status')).result as any;
  }

  async function ready() {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const targets = (await status().catch(() => null))?.targets ?? [];
      if (
        targets.some(
          (target: any) =>
            target.role === 'app' &&
            target.deviceClass === 'managed' &&
            target.commandReady,
        )
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The managed runtime did not become command-ready');
  }

  async function withWorkspacePage<T>(
    operation: (page: Page, runtime: Frame) => Promise<T>,
  ): Promise<T> {
    const session = await getRuntimeSession(harness.tempRoot);
    const automation = await chromium.connectOverCDP(
      session!.browserAutomation!.endpoint!,
    );
    try {
      const page = automation.contexts()[0].pages()[0];
      await page.waitForFunction(
        () => (window as any).__IWSDK_SCENE_EDITOR_READY === true,
      );
      const runtime = await (await page.$(
        '#workspace-runtime-frame',
      ))!.contentFrame();
      return await operation(page, runtime!);
    } finally {
      await automation.close();
    }
  }

  beforeAll(async () => {
    process.env.IWSDK_GPU = 'swiftshader';
    process.env.IWSDK_DEV_ALLOW_BROWSER_AUTOMATION = 'true';
    process.env.IWSDK_DEV_HEADLESS = 'true';
    try {
      harness = await createEditorTestHarness('managed-tab-audio', {
        managedBrowser: true,
      });
    } finally {
      delete process.env.IWSDK_DEV_ALLOW_BROWSER_AUTOMATION;
      delete process.env.IWSDK_DEV_HEADLESS;
    }
    await ready();
  }, 90_000);

  afterAll(async () => {
    await harness?.close();
    delete process.env.IWSDK_GPU;
  });

  test('shares one state between agents, the workspace button, and relaunches', async () => {
    expect((await status()).browser.audioMuted).toBe(false);
    expect(
      (await command('browser_set_muted', { muted: true })).result,
    ).toEqual({ muted: true });
    expect((await status()).browser.audioMuted).toBe(true);

    await withWorkspacePage(async (page, runtime) => {
      const button = page.locator('[data-workspace-mute-button]');
      await expect
        .poll(() => button.getAttribute('aria-label'))
        .toBe('Unmute tab audio');
      expect(
        await runtime.evaluate(() => (window as any).__IWSDK_TAB_AUDIO.muted),
      ).toBe(true);

      await button.click();
      await expect
        .poll(async () => (await status()).browser.audioMuted)
        .toBe(false);
      await expect
        .poll(() => button.getAttribute('aria-label'))
        .toBe('Mute tab audio');
      expect(
        await runtime.evaluate(() => (window as any).__IWSDK_TAB_AUDIO.muted),
      ).toBe(false);

      await button.click();
      await expect
        .poll(async () => (await status()).browser.audioMuted)
        .toBe(true);
      await page.close();
    });

    const before = await status();
    await expect
      .poll(async () => (await status()).browser.lifecycle.state, {
        timeout: 30_000,
      })
      .toBe('failed');
    await command('runtime_recover');
    await ready();
    const after = await status();
    expect(after.browser.lifecycle.browserEpoch).toBe(
      before.browser.lifecycle.browserEpoch + 1,
    );
    expect(after.browser.audioMuted).toBe(true);

    await withWorkspacePage(async (page, runtime) => {
      await expect
        .poll(() =>
          page
            .locator('[data-workspace-mute-button]')
            .getAttribute('aria-label'),
        )
        .toBe('Unmute tab audio');
      expect(
        await runtime.evaluate(() => (window as any).__IWSDK_TAB_AUDIO.muted),
      ).toBe(true);
    });
  }, 120_000);
});
