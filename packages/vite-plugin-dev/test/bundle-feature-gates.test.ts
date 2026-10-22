/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUNDLED_FONT_MODULES,
  createDisabledBundledFontsModule,
  resolveBundledFontNames,
  resolveBundledLucideIcons,
  rewriteUIKitMLLucideKit,
} from '../src/bundle-feature-gates.js';
import { iwsdkDev } from '../src/index.js';
import type { ProductionBundleOptions } from '../src/types.js';

const tempDirectories: string[] = [];
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function buildFixture(
  source: string,
  bundle?: ProductionBundleOptions,
): Promise<{ output: Array<{ fileName: string; code?: string }> }> {
  const root = await mkdtemp(path.join(PACKAGE_ROOT, '.bundle-gate-'));
  tempDirectories.push(root);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'public', 'scenes'), { recursive: true });
  await mkdir(path.join(root, 'public', 'ui'), { recursive: true });
  await writeFile(
    path.join(root, 'index.html'),
    '<script type="module" src="/src/main.ts"></script>',
  );
  await writeFile(
    path.join(root, 'src', 'main.ts'),
    `import { PhysicsSystem, loadUIKitMLComponent } from '@iwsdk/core';
console.log(PhysicsSystem, loadUIKitMLComponent);`,
  );
  await writeFile(
    path.join(root, 'public', 'scenes', 'main.iwsdk.scene.json'),
    '{}\n',
  );
  await writeFile(path.join(root, 'public', 'ui', 'panel.uikitml'), source);
  await writeFile(
    path.join(root, 'iwsdk.config.json'),
    `${JSON.stringify({
      version: 'iwsdk.project.v1',
      scene: './public/scenes/main.iwsdk.scene.json',
      world: {
        xr: false,
        features: { physics: false, spatialUI: true },
      },
      dev: { emulator: { iwer: false } },
    })}\n`,
  );

  return (await build({
    configFile: false,
    root,
    publicDir: 'public',
    logLevel: 'silent',
    plugins: [iwsdkDev({ https: false, bundle })],
    build: { write: false, target: 'esnext' },
  })) as { output: Array<{ fileName: string; code?: string }> };
}

describe('production bundle feature gates', () => {
  it.each([
    '<div><h1>Score</h1><button>Putt</button></div>',
    '<style>@font-face { font-family: inter; src: url("./custom.ttf"); font-weight: 400; }</style><div>Default</div>',
  ])(
    'retains UIKit default Inter when no family is referenced: %s',
    async (source) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-default-font-'));
      tempDirectories.push(root);
      await writeFile(path.join(root, 'panel.uikitml'), source);

      await expect(resolveBundledFontNames(root, undefined)).resolves.toEqual(
        new Set(['inter']),
      );
    },
  );

  it('retains static and explicitly configured bundled fonts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-font-bundle-'));
    tempDirectories.push(root);
    await mkdir(path.join(root, 'ui'));
    await writeFile(
      path.join(root, 'ui', 'panel.uikitml'),
      `<style>
        @font-face { font-family: "Brand"; src: url("./brand.ttf"); font-weight: 400; }
        .copy { font-family: roboto; }
        .brand { font-family: "Brand"; }
      </style><div class="copy">Copy</div>`,
    );

    await expect(resolveBundledFontNames(root, ['inter'])).resolves.toEqual(
      new Set(['inter', 'roboto']),
    );
  });

  it('resolves custom-face exclusions before merging fonts across files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-font-bundle-'));
    tempDirectories.push(root);
    await mkdir(path.join(root, 'ui'));
    await writeFile(
      path.join(root, 'ui', 'first.uikitml'),
      `<style>
        @font-face { font-family: inter; src: url("./inter.ttf"); font-weight: 400; }
        .copy { font-family: roboto; }
      </style><div class="copy">Roboto</div>`,
    );
    await writeFile(
      path.join(root, 'ui', 'second.uikitml'),
      `<style>
        @font-face { font-family: roboto; src: url("./roboto.ttf"); font-weight: 400; }
        .copy { font-family: inter; }
      </style><div class="copy">Inter</div>`,
    );

    await expect(resolveBundledFontNames(root, undefined)).resolves.toEqual(
      new Set(['inter', 'roboto']),
    );
  });

  it('retains fonts declared in nested UIKitML style sections', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-font-bundle-'));
    tempDirectories.push(root);
    await mkdir(path.join(root, 'ui'));
    await writeFile(
      path.join(root, 'ui', 'panel.uikitml'),
      `<style>
        .copy:hover { font-family: roboto; }
        .copy:dark { font-family: inter; }
        .copy:md { font-family: poppins; }
      </style><div class="copy">Responsive copy</div>`,
    );

    await expect(resolveBundledFontNames(root, undefined)).resolves.toEqual(
      new Set(['inter', 'poppins', 'roboto']),
    );
  });

  it('keeps every font when analysis cannot safely parse an asset', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-font-bundle-'));
    tempDirectories.push(root);
    await writeFile(path.join(root, 'broken.uikitml'), '<Unknown />');

    const fonts = await resolveBundledFontNames(root, undefined);

    expect(fonts.size).toBe(Object.keys(BUNDLED_FONT_MODULES).length);
  });

  it('emits all named exports from one diagnostic fallback module', () => {
    const source = createDisabledBundledFontsModule();
    expect(source).toContain('export const roboto = unavailable("roboto")');
    expect(source).toContain(
      'export const openSans = unavailable("open-sans")',
    );
    expect(source).toContain('iwsdkDev({ bundle: { fonts: [...] } })');
  });

  it.each([
    {
      name: 'custom font only',
      source: `<style>
  @font-face { font-family: "Brand"; src: url("./brand.ttf"); font-weight: 400; }
  .copy { font-family: "Brand"; }
</style><div><div class="copy">Copy</div><div>Unstyled custom default</div></div>`,
      retainsInter: false,
    },
    {
      name: 'implicit UIKit default font',
      source: '<div><h1>Score</h1><button>Putt</button></div>',
      retainsInter: true,
    },
  ])(
    'omits Havok and retains only needed font atlases: $name',
    { timeout: 20000 },
    async ({ source, retainsInter }) => {
      const buildResult = await buildFixture(source);
      const fileNames = buildResult.output.map((entry) => entry.fileName);
      const emittedCode = buildResult.output
        .map((entry) => entry.code ?? '')
        .join('\n');

      expect(emittedCode).toContain(
        'Physics was excluded from this production build',
      );
      expect(emittedCode).not.toContain('HavokPhysics');
      expect(fileNames).toContainEqual(
        expect.stringContaining('_virtual_iwsdk-disabled-bundled-fonts'),
      );
      expect(fileNames.some((name) => /HavokPhysics|\.wasm$/i.test(name))).toBe(
        false,
      );
      expect(
        fileNames.some((name) =>
          Object.values(BUNDLED_FONT_MODULES).some(({ exportName }) =>
            name.toLowerCase().includes(exportName.toLowerCase()),
          ),
        ),
      ).toBe(retainsInter);
      expect(fileNames.some((name) => /(?:^|\/)inter-/.test(name))).toBe(
        retainsInter,
      );
    },
  );

  it('retains Lucide icons used by static UIKitML and listed in bundle.icons', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-icon-bundle-'));
    tempDirectories.push(root);
    await mkdir(path.join(root, 'ui'));
    await writeFile(
      path.join(root, 'ui', 'panel.uikitml'),
      '<Panel><div><LogIn width="16" /><Button><RectangleGoggles /></Button></div></Panel>',
    );
    await writeFile(path.join(root, 'ui', 'plain.uikitml'), '<div>Text</div>');

    await expect(
      resolveBundledLucideIcons(root, ['Settings']),
    ).resolves.toEqual(new Set(['LogIn', 'RectangleGoggles', 'Settings']));
  });

  it('keeps every Lucide icon when asked or when a document cannot be analyzed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-icon-bundle-'));
    tempDirectories.push(root);
    await writeFile(path.join(root, 'broken.uikitml'), '<Unknown />');

    await expect(resolveBundledLucideIcons(root, undefined)).resolves.toBe(
      'all',
    );
    await expect(resolveBundledLucideIcons(undefined, 'all')).resolves.toBe(
      'all',
    );
  });

  it('rejects unknown icons in bundle.icons', async () => {
    await expect(
      resolveBundledLucideIcons(undefined, ['NotALucideIcon']),
    ).rejects.toThrow('unknown Lucide icon "NotALucideIcon"');
    await expect(
      resolveBundledLucideIcons(undefined, ['circle-help']),
    ).rejects.toThrow('did you mean "CircleHelp"?');
  });

  it('rewrites only the UIKitML kits module', () => {
    const code =
      'import * as Horizon from "@pmndrs/uikit-horizon";\nimport * as Lucide from "@pmndrs/uikit-lucide";\nObject.entries(Lucide);';
    const kitsId = '/app/node_modules/@drawcall/uikitml/dist/kits.js?v=1234';
    const rewritten = rewriteUIKitMLLucideKit(
      code,
      kitsId,
      new Set(['Settings', 'LogIn']),
    );

    expect(rewritten).toContain(
      'import { LogIn as __iwsdkLucide0 } from "@pmndrs/uikit-lucide/dist/LogIn.js";',
    );
    expect(rewritten).toContain(
      'const Lucide = { LogIn: __iwsdkLucide0, Settings: __iwsdkLucide1 };',
    );
    expect(rewritten).toContain('__IWSDK_LUCIDE_ICONS_TRIMMED__ = true');
    expect(rewritten).not.toContain('import * as Lucide');
    expect(rewritten).toContain('import * as Horizon');
    expect(rewriteUIKitMLLucideKit(code, kitsId, 'all')).toBeNull();
    expect(
      rewriteUIKitMLLucideKit(code, '/app/src/kits.js', new Set(['LogIn'])),
    ).toBeNull();
    expect(() =>
      rewriteUIKitMLLucideKit('export {};', kitsId, new Set(['LogIn'])),
    ).toThrow('no longer imports Lucide as a namespace');
  });

  it.each([
    // Horizon's Checkbox and Select import Check and ChevronDown directly.
    {
      name: 'static icons only',
      bundle: undefined,
      icons: ['check', 'chevron-down', 'log-in'],
    },
    {
      name: 'static and configured icons',
      bundle: { icons: ['Settings'] },
      icons: ['check', 'chevron-down', 'log-in', 'settings'],
    },
  ])(
    'bundles only the retained Lucide icons: $name',
    { timeout: 20000 },
    async ({ bundle, icons }) => {
      const buildResult = await buildFixture(
        '<Panel><Button><LogIn /></Button></Panel>',
        bundle,
      );
      const emittedCode = buildResult.output
        .map((entry) => entry.code ?? '')
        .join('\n');
      const bundledIcons = [
        ...emittedCode.matchAll(/class="lucide lucide-([a-z0-9-]+)"/g),
      ]
        .map((match) => match[1])
        .sort();

      expect(bundledIcons).toEqual(icons);
    },
  );
});
