/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { StyleSheet, TTFLoader } from '@pmndrs/uikit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheManager } from '../../src/asset/cache-manager.js';
import { UIKitMLAsset } from '../../src/ui/uikitml-asset.js';
import {
  loadUIKitMLAsset,
  loadUIKitMLComponent,
  parseUIKitMLSource,
} from '../../src/ui/uikitml.js';

const FONT_SOURCE = `
<style>
  @font-face {
    font-family: "Brand Sans";
    src: url("./fonts/BrandSans-Bold.ttf");
    font-weight: 700;
  }

  .title {
    font-family: "Brand Sans";
    font-weight: 700;
  }
</style>
<div class="title">Runtime UIKitML</div>
`;

describe('runtime UIKitML loading', () => {
  afterEach(() => {
    CacheManager.clear();
    delete StyleSheet.title;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('parses TTF metadata and resolves it relative to the UIKitML file', () => {
    const ast = parseUIKitMLSource(
      FONT_SOURCE,
      'https://example.test/ui/panel.uikitml',
    );

    expect(ast.fontFaces).toEqual([
      {
        fontFamily: 'Brand Sans',
        fontWeight: '700',
        src: 'https://example.test/ui/fonts/BrandSans-Bold.ttf',
      },
    ]);
  });

  it('fetches source text and instantiates its stylesheet and TTF loader', async () => {
    const loadedFont = { name: 'Brand Sans Bold' };
    const ttfLoader = vi
      .spyOn(TTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({
        'Brand Sans': { '700': loadedFont },
      } as never);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(FONT_SOURCE, {
        headers: { 'content-type': 'application/xml' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const root = await loadUIKitMLComponent(
      'https://example.test/ui/panel.uikitml',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/ui/panel.uikitml',
    );
    expect(StyleSheet.title).toMatchObject({
      fontFamily: 'Brand Sans',
      fontWeight: '700',
    });
    expect(root.inputProperties.fontFamilies).toMatchObject({
      'Brand Sans': { '700': expect.any(Function) },
    });
    expect(ttfLoader).toHaveBeenCalledWith(
      'https://example.test/ui/fonts/BrandSans-Bold.ttf',
    );
    const fontLoader = (root.inputProperties.fontFamilies as any)['Brand Sans'][
      '700'
    ];
    await expect(fontLoader()).resolves.toBe(loadedFont);
    expect(ttfLoader).toHaveBeenCalledTimes(1);
  });

  it('reports parser errors with their source location', () => {
    expect(() => parseUIKitMLSource('<Unknown />')).toThrow(
      /Unknown component <Unknown>.*0:1/,
    );
    expect(() => parseUIKitMLSource('<Unknown />')).not.toThrow(/Lucide/);
  });

  it('explains unknown components when production trimmed Lucide icons', () => {
    vi.stubGlobal('__IWSDK_LUCIDE_ICONS_TRIMMED__', true);

    expect(() => parseUIKitMLSource('<Unknown />')).toThrow(
      /^Unknown component <Unknown> at 0:1\. If <Unknown> is a Lucide icon, it was excluded from this production build; add it to iwsdkDev\(\{ bundle: \{ icons: \['Unknown'\] \} \}\)/,
    );
  });

  it('rejects an HTML fallback response with the requested UIKitML URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html><body>App</body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
        }),
      ),
    );

    await expect(
      loadUIKitMLComponent('/ui/missing-panel.uikitml'),
    ).rejects.toThrow(
      '/ui/missing-panel.uikitml returned HTML (content-type: text/html; charset=utf-8)',
    );
  });

  it('loads a manifest UIKitML key and reuses its cached source', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('<div>Manifest panel</div>', { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    CacheManager.setKeyToUrl('main-menu', '/ui/main-menu.uikitml');

    await loadUIKitMLComponent('main-menu');
    await loadUIKitMLComponent('main-menu');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/ui/main-menu.uikitml');
  });

  it('can reload edited UIKitML source without changing its manifest URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<div>Before edit</div>', { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response('<div>After edit</div>', { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    CacheManager.setKeyToUrl('control-panel', '/ui/control-panel.uikitml');

    await loadUIKitMLComponent('control-panel');
    await loadUIKitMLComponent('control-panel');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await loadUIKitMLComponent('control-panel', { forceReload: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/ui/control-panel.uikitml', {
      cache: 'no-store',
    });
    expect(CacheManager.getAsset<string>('/ui/control-panel.uikitml')).toBe(
      '<div>After edit</div>',
    );
  });

  it('lets a forced reload supersede an older in-flight source request', async () => {
    let resolveInitial!: (response: Response) => void;
    let resolveReload!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveReload = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const initial = loadUIKitMLComponent('/ui/live-panel.uikitml');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const reload = loadUIKitMLComponent('/ui/live-panel.uikitml', {
      forceReload: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resolveReload(new Response('<div>Current</div>', { status: 200 }));
    await reload;
    resolveInitial(new Response('<div>Stale</div>', { status: 200 }));
    await initial;

    expect(CacheManager.getAsset<string>('/ui/live-panel.uikitml')).toBe(
      '<div>Current</div>',
    );
  });

  it('produces a disposable scene asset with direct element lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<div id="status">Ready</div>', { status: 200 }),
        ),
    );

    const asset = await loadUIKitMLAsset('/ui/status.uikitml');

    expect(asset).toBeInstanceOf(UIKitMLAsset);
    expect(asset.assetId).toBe('/ui/status.uikitml');
    expect(asset.document.parent).toBe(asset);
    expect(asset.requireElementById('status')).toBe(
      asset.document.getElementById('status'),
    );
    expect(() => asset.requireElementById('missing')).toThrow(
      'UIKitML element "#missing" was not found',
    );

    asset.dispose();
    asset.dispose();
    expect(asset.document.disposed).toBe(true);
    expect(asset.document.parent).toBeNull();
  });
});
