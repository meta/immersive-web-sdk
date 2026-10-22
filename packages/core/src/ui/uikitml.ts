/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  instantiate,
  parse,
  resolveKitComponentSets,
  type ComponentSet,
  type KitName,
  type UIKitMLAst,
  type UIKitMLError,
} from '@drawcall/uikitml';
import {
  reversePainterSortStable,
  StyleSheet,
  type Component,
  type PreferredColorScheme,
} from '@pmndrs/uikit';
import { AssetManager } from '../asset/asset-manager.js';
import { CacheManager } from '../asset/cache-manager.js';
import type { WebGLRenderer } from '../runtime/index.js';
import { UIKitDocument } from './document.js';
import { UIKitMLAsset } from './uikitml-asset.js';

/** Built-in UIKitML component collection used by a panel. */
export type UIKitMLKit = KitName;

/** Additional component definitions accepted by the UIKitML parser. */
export type UIKitMLComponentSet = ComponentSet;

export interface UIKitMLLoadOptions {
  /** Built-in component collection. @defaultValue `'horizon'` */
  kit?: UIKitMLKit;
  /** Additional application-defined UIKitML components. */
  componentSets?: UIKitMLComponentSet[];
  /** Color scheme supplied to the instantiated UIKit tree. */
  preferredColorScheme?: PreferredColorScheme;
  /** Bypass the cached source text, primarily for editor preview refreshes. */
  forceReload?: boolean;
}

/** Default component collection for IWSDK panels. */
export const DEFAULT_UIKITML_KIT: UIKitMLKit = 'horizon';

/** Configure a renderer for UIKit clipping and transparent painter order. */
export function configureUIKitRenderer(renderer: WebGLRenderer): void {
  renderer.setTransparentSort(reversePainterSortStable);
  renderer.localClippingEnabled = true;
}

function formatParseError(error: UIKitMLError): string {
  const position = error.range?.start;
  const location = position ? ` at ${position.line}:${position.column}` : '';
  // @iwsdk/vite-plugin-dev sets this marker when a production build keeps
  // only the Lucide icons used by the project's static UIKitML files.
  const trimmedIcon =
    error.code === 'unknown-component' &&
    (globalThis as { __IWSDK_LUCIDE_ICONS_TRIMMED__?: boolean })
      .__IWSDK_LUCIDE_ICONS_TRIMMED__ === true
      ? (/<([^>\s]+)>/.exec(error.message)?.[1] ?? 'Name')
      : null;
  if (!trimmedIcon) {
    return `${error.message}${location}`;
  }
  return `${error.message.replace(/\.$/u, '')}${location}. If <${trimmedIcon}> is a Lucide icon, it was excluded from this production build; add it to iwsdkDev({ bundle: { icons: ['${trimmedIcon}'] } }) when UIKitML is loaded dynamically.`;
}

function resolveFontFaceURLs(ast: UIKitMLAst, sourceURL?: string): void {
  if (!sourceURL || !ast.fontFaces) {
    return;
  }

  for (const fontFace of ast.fontFaces) {
    try {
      fontFace.src = new URL(fontFace.src, sourceURL).href;
    } catch {
      // Preserve values such as application-owned URL schemes that the
      // platform loader may still understand.
    }
  }
}

function getComponentSets(options: UIKitMLLoadOptions): UIKitMLComponentSet[] {
  return [
    ...resolveKitComponentSets(options.kit ?? DEFAULT_UIKITML_KIT),
    ...(options.componentSets ?? []),
  ];
}

async function preloadTTFFonts(
  root: Component,
  ast: UIKitMLAst,
): Promise<void> {
  // UIKit does not expose its resolved font loaders until the component is
  // attached, but UIKitML installs them on the root's constructor input.
  const fontFamilies = (
    root as unknown as { inputProperties?: { fontFamilies?: unknown } }
  ).inputProperties?.fontFamilies;
  if (
    !fontFamilies ||
    typeof fontFamilies !== 'object' ||
    Array.isArray(fontFamilies)
  ) {
    return;
  }

  // UIKitML's font loaders share their generated atlas cache. Resolve the
  // declared faces serially before the first render so text cannot disappear
  // from an initial runtime frame or editor preview capture.
  for (const fontFace of ast.fontFaces ?? []) {
    const family = (fontFamilies as Record<string, unknown>)[
      fontFace.fontFamily
    ];
    if (!family || typeof family !== 'object' || Array.isArray(family)) {
      continue;
    }
    const load = (family as Record<string, unknown>)[fontFace.fontWeight];
    if (typeof load === 'function') {
      await (load as () => Promise<unknown>)();
    }
  }
}

/**
 * Parse UIKitML source and resolve its relative TTF declarations.
 *
 * @param source UIKitML markup.
 * @param sourceURL URL of the UIKitML document, used as the base for font URLs.
 * @param options Parser and component-set options.
 */
export function parseUIKitMLSource(
  source: string,
  sourceURL?: string,
  options: UIKitMLLoadOptions = {},
): UIKitMLAst {
  const componentSets = getComponentSets(options);
  const result = parse(source, { componentSets });

  if (!result.success) {
    throw new Error(result.errors.map(formatParseError).join('\n'));
  }

  resolveFontFaceURLs(result.ast, sourceURL);
  return result.ast;
}

/** Fetch, parse, and instantiate a UIKitML document. */
export async function loadUIKitMLComponent(
  configURL: string,
  options: UIKitMLLoadOptions = {},
): Promise<Component> {
  const source = await AssetManager.loadUIKitML(
    configURL,
    undefined,
    options.forceReload,
  );
  const resolvedURL = CacheManager.resolveUrl(configURL);
  const sourceURL =
    typeof document === 'undefined'
      ? resolvedURL
      : new URL(resolvedURL, document.baseURI).href;
  const componentSets = getComponentSets(options);
  let ast: UIKitMLAst;
  try {
    ast = parseUIKitMLSource(source, sourceURL, options);
  } catch (error) {
    throw new Error(
      `Failed to parse UIKitML ${configURL}:\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // UIKit resolves class names through its shared stylesheet registry.
  Object.assign(StyleSheet, ast.stylesheet);

  const root = instantiate(ast, {
    componentSets,
    preferredColorScheme: options.preferredColorScheme,
  });
  await preloadTTFFonts(root, ast);
  return root;
}

/** Fetch, parse, and instantiate a UIKitML file as a placeable scene asset. */
export async function loadUIKitMLAsset(
  assetIdOrURL: string,
  options: UIKitMLLoadOptions = {},
): Promise<UIKitMLAsset> {
  const root = await loadUIKitMLComponent(assetIdOrURL, options);
  return new UIKitMLAsset(assetIdOrURL, new UIKitDocument(root));
}
