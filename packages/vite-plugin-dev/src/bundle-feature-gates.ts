/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  lucideComponentSet,
  parse,
  resolveKitComponentSets,
  type UIKitMLAst,
  type UIKitMLNode,
} from '@drawcall/uikitml';
import type {
  ProductionBundleOptions,
  UIKitMLBundledFontName,
} from './types.js';

export const BUNDLED_FONT_MODULES: Record<
  UIKitMLBundledFontName,
  { module: string; exportName: string }
> = {
  'crimson-text': {
    module: '@pmndrs/msdfonts/crimson-text',
    exportName: 'crimsonText',
  },
  'fira-code': {
    module: '@pmndrs/msdfonts/fira-code',
    exportName: 'firaCode',
  },
  inconsolata: {
    module: '@pmndrs/msdfonts/inconsolata',
    exportName: 'inconsolata',
  },
  inter: { module: '@pmndrs/msdfonts/inter', exportName: 'inter' },
  lato: { module: '@pmndrs/msdfonts/lato', exportName: 'lato' },
  'libre-baskerville': {
    module: '@pmndrs/msdfonts/libre-baskerville',
    exportName: 'libreBaskerville',
  },
  merriweather: {
    module: '@pmndrs/msdfonts/merriweather',
    exportName: 'merriweather',
  },
  montserrat: {
    module: '@pmndrs/msdfonts/montserrat',
    exportName: 'montserrat',
  },
  nunito: { module: '@pmndrs/msdfonts/nunito', exportName: 'nunito' },
  'open-sans': {
    module: '@pmndrs/msdfonts/open-sans',
    exportName: 'openSans',
  },
  'playfair-display': {
    module: '@pmndrs/msdfonts/playfair-display',
    exportName: 'playfairDisplay',
  },
  poppins: { module: '@pmndrs/msdfonts/poppins', exportName: 'poppins' },
  raleway: { module: '@pmndrs/msdfonts/raleway', exportName: 'raleway' },
  roboto: { module: '@pmndrs/msdfonts/roboto', exportName: 'roboto' },
  'source-code-pro': {
    module: '@pmndrs/msdfonts/source-code-pro',
    exportName: 'sourceCodePro',
  },
  'space-mono': {
    module: '@pmndrs/msdfonts/space-mono',
    exportName: 'spaceMono',
  },
  'work-sans': {
    module: '@pmndrs/msdfonts/work-sans',
    exportName: 'workSans',
  },
};

const FONT_NAMES = new Set<UIKitMLBundledFontName>(
  Object.keys(BUNDLED_FONT_MODULES) as UIKitMLBundledFontName[],
);

function collectFontValue(value: unknown, result: Set<string>): void {
  if (typeof value === 'string') {
    result.add(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function collectRecordFonts(
  record: Record<string, unknown>,
  result: Set<string>,
): void {
  collectFontValue(record.fontFamily, result);
  for (const value of Object.values(record)) {
    if (isRecord(value)) {
      collectRecordFonts(value, result);
    }
  }
}

function collectNodeFonts(node: UIKitMLNode, result: Set<string>): void {
  if (node.kind === 'text') {
    return;
  }
  collectRecordFonts(node.props, result);
  if (node.kind === 'element') {
    for (const child of node.children) {
      collectNodeFonts(child, result);
    }
  }
}

function collectAstFonts(ast: UIKitMLAst): ReadonlySet<UIKitMLBundledFontName> {
  const result = new Set<string>();
  collectNodeFonts(ast.root, result);
  for (const declarations of Object.values(ast.stylesheet)) {
    collectRecordFonts(declarations, result);
  }
  // UIKitML supplies a font-family map when any family is referenced in the
  // document. Without one, UIKit falls back to its lazily loaded Inter family.
  // Unused @font-face declarations do not supply a runtime family map.
  // Compute this before removing custom faces: their map replaces UIKit's
  // built-in Inter fallback when the custom family is used.
  const usesUIKitBuiltInDefault = result.size === 0;
  for (const face of ast.fontFaces ?? []) {
    result.delete(face.fontFamily);
  }
  if (usesUIKitBuiltInDefault) {
    result.add('inter');
  }
  return new Set(
    [...result].filter((font): font is UIKitMLBundledFontName =>
      FONT_NAMES.has(font as UIKitMLBundledFontName),
    ),
  );
}

async function collectUIKitMLFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectUIKitMLFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith('.uikitml')
        ? [entryPath]
        : [];
    }),
  );
  return nested.flat();
}

export async function resolveBundledFontNames(
  publicDirectory: string | undefined,
  configured: ProductionBundleOptions['fonts'],
): Promise<ReadonlySet<UIKitMLBundledFontName>> {
  if (configured === 'all') {
    return FONT_NAMES;
  }
  const result = new Set<UIKitMLBundledFontName>();
  for (const font of configured ?? []) {
    if (!FONT_NAMES.has(font)) {
      throw new Error(
        `iwsdkDev().bundle.fonts contains unknown bundled font "${font}"`,
      );
    }
    result.add(font);
  }
  if (!publicDirectory) {
    return result;
  }

  for (const file of await collectUIKitMLFiles(publicDirectory)) {
    const parsed = parse(await readFile(file, 'utf8'), {
      componentSets: resolveKitComponentSets('horizon'),
    });
    if (!parsed.success) {
      // UIKitML validation owns the actionable syntax failure. Preserve every
      // bundled font when this independent size pass cannot safely analyze it.
      return FONT_NAMES;
    }
    for (const font of collectAstFonts(parsed.ast)) {
      result.add(font);
    }
  }
  return result;
}

const LUCIDE_ICON_NAMES: ReadonlySet<string> = new Set(
  Object.keys(lucideComponentSet),
);

function collectNodeIcons(node: UIKitMLNode, result: Set<string>): void {
  if (node.kind !== 'element') {
    return;
  }
  if (node.origin?.kit === 'lucide') {
    result.add(node.origin.name);
  }
  for (const child of node.children) {
    collectNodeIcons(child, result);
  }
}

/**
 * Lucide icons to keep in a production build: those used by static public
 * UIKitML plus `bundle.icons`, or `'all'` when that set cannot be known.
 */
export async function resolveBundledLucideIcons(
  publicDirectory: string | undefined,
  configured: ProductionBundleOptions['icons'],
): Promise<ReadonlySet<string> | 'all'> {
  if (configured === 'all') {
    return 'all';
  }
  const result = new Set<string>();
  for (const icon of configured ?? []) {
    if (!LUCIDE_ICON_NAMES.has(icon)) {
      // Icons are UIKitML component names: 'Settings', not 'settings'.
      const normalized = icon.replace(/[-_\s]/g, '').toLowerCase();
      const suggestion = [...LUCIDE_ICON_NAMES].find(
        (name) => name.toLowerCase() === normalized,
      );
      throw new Error(
        `iwsdkDev().bundle.icons contains unknown Lucide icon "${icon}"` +
          (suggestion ? `; did you mean "${suggestion}"?` : ''),
      );
    }
    result.add(icon);
  }
  if (!publicDirectory) {
    return result;
  }

  for (const file of await collectUIKitMLFiles(publicDirectory)) {
    const parsed = parse(await readFile(file, 'utf8'), {
      componentSets: resolveKitComponentSets('horizon'),
    });
    if (!parsed.success) {
      // As with fonts, keep every icon when this size pass cannot analyze a
      // document; UIKitML validation reports the actual syntax failure.
      return 'all';
    }
    collectNodeIcons(parsed.ast.root, result);
  }
  return result;
}

const UIKITML_KITS_MODULE = /[\\/]@drawcall[\\/]uikitml[\\/]dist[\\/]kits\.js$/;
const LUCIDE_NAMESPACE_IMPORT =
  /import \* as Lucide from (['"])@pmndrs\/uikit-lucide\1;/;

/**
 * UIKitML's kits module builds its Lucide component set by iterating
 * `import * as Lucide`, which keeps all ~1,600 icons in every production
 * bundle. Replace that namespace with just the retained icons. Returns null
 * for any other module.
 */
export function rewriteUIKitMLLucideKit(
  code: string,
  id: string,
  icons: ReadonlySet<string> | 'all',
): string | null {
  if (icons === 'all' || !UIKITML_KITS_MODULE.test(id.split('?')[0])) {
    return null;
  }
  if (!LUCIDE_NAMESPACE_IMPORT.test(code)) {
    throw new Error(
      '[IWSDK] @drawcall/uikitml no longer imports Lucide as a namespace; ' +
        "update rewriteUIKitMLLucideKit or set iwsdkDev({ bundle: { icons: 'all' } }).",
    );
  }
  const names = [...icons].sort();
  const imports = names.map(
    (name, index) =>
      `import { ${name} as __iwsdkLucide${index} } from "@pmndrs/uikit-lucide/dist/${name}.js";`,
  );
  const members = names.map((name, index) => `${name}: __iwsdkLucide${index}`);
  // The marker lets @iwsdk/core explain an unknown icon in dynamically loaded
  // UIKitML instead of reporting a bare unknown-component error.
  return code.replace(
    LUCIDE_NAMESPACE_IMPORT,
    () =>
      `${imports.join('\n')}
const Lucide = { ${members.join(', ')} };
globalThis.__IWSDK_LUCIDE_ICONS_TRIMMED__ = true;`,
  );
}

export function createDisabledBundledFontsModule(): string {
  const exports = Object.entries(BUNDLED_FONT_MODULES).map(
    ([font, definition]) =>
      `export const ${definition.exportName} = unavailable(${JSON.stringify(font)});`,
  );
  return `const unavailable = (font) => new Proxy({}, {
  get() {
    throw new Error('[IWSDK] Bundled font "' + font + '" was excluded from this production build. Add it to iwsdkDev({ bundle: { fonts: [...] } }) when UIKitML is loaded dynamically.');
  }
});
${exports.join('\n')}`;
}

const THREE_DECODER_LOADER =
  /[\\/]examples[\\/]jsm[\\/]loaders[\\/](?:DRACOLoader|KTX2Loader)\.js$/;
const THREE_LIBS_URL =
  /new URL\(\s*(['"])(\.\.\/libs\/[^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g;

/**
 * three r185's DRACOLoader and KTX2Loader default to the decoders next to the
 * module (`new URL('../libs/…', import.meta.url)`), so Vite emits about 1.5 MB
 * of decoder wasm/js into every production build. IWSDK points both loaders
 * at the decoders on unpkg (core's asset/loaders/gltf-loader.ts), so point
 * these defaults at the same place and nothing unused is bundled. Returns
 * null for any other module.
 */
export function rewriteThreeDecoderDefaults(
  code: string,
  id: string,
): string | null {
  const file = id.split('?')[0];
  if (!THREE_DECODER_LOADER.test(file) || !code.includes('import.meta.url')) {
    return null;
  }
  const manifest = JSON.parse(
    readFileSync(
      path.resolve(path.dirname(file), '../../../package.json'),
      'utf8',
    ),
  ) as { version: string };
  const revision = manifest.version.split('.')[1];
  const base = `https://unpkg.com/three@0.${revision}.0/examples/jsm/loaders/`;
  const rewritten = code.replace(
    THREE_LIBS_URL,
    (_match, _quote, relative: string) =>
      `new URL(${JSON.stringify(relative)}, ${JSON.stringify(base)})`,
  );
  return rewritten === code ? null : rewritten;
}
