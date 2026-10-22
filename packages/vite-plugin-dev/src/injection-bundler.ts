/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { access, readdir, readFile, stat } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { ProcessedDevOptions, InjectionBundleResult } from './types.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Module id prefix of the pre-built runtime (dist/injection/) and its lazy
 * chunks (GLTS, rooms). The plugin resolves and loads these ids itself, so
 * Vite serves them in development and bundles them (dynamic imports becoming
 * lazy chunks) in production builds.
 */
export const INJECTION_RUNTIME_ID_PREFIX = 'virtual:iwsdk-dev-runtime/';
const RESOLVED_RUNTIME_ID_PREFIX = '\0' + INJECTION_RUNTIME_ID_PREFIX;

/**
 * Locate the pre-built emulator runtime (an ES module with lazy chunks) and
 * capture the configuration it starts with.
 */
export async function buildInjectionBundle(
  options: ProcessedDevOptions,
): Promise<InjectionBundleResult> {
  try {
    if (options.verbose) {
      console.log('🔄 Loading pre-built IWSDK injection bundle...');
    }

    // Source-mode tests import this file from `src/`, while published builds
    // import it from `dist/`.
    const entryPath = await resolveInjectionEntryPath();
    const directory = path.dirname(entryPath);
    const config = {
      device: options.device,
      activation:
        options.activation instanceof RegExp
          ? `/${options.activation.source}/`
          : options.activation,
      verbose: options.verbose,
      sem: options.sem || null,
      ai: options.ai || null,
      workspace: options.workspace || null,
      userAgentException:
        options.userAgentException instanceof RegExp
          ? `/${options.userAgentException.source}/`
          : options.userAgentException,
      iwer: options.iwer,
      nativeXRControl: options.nativeXRControl,
      targetDevicePreview: options.targetDevicePreview,
    };

    const size = await staticImportSize(entryPath);
    const lazySize =
      (await directorySize(path.join(directory, 'chunks'))) -
      (size - (await stat(entryPath)).size);

    if (options.verbose) {
      console.log(
        `✅ IWSDK injection bundle ready (${(size / 1024).toFixed(1)}KB, plus ${(lazySize / 1024).toFixed(1)}KB loaded on demand)`,
      );
    }

    return {
      entryPath,
      directory,
      config: JSON.stringify(config, null, 2),
      size,
    };
  } catch (error) {
    console.error('❌ Failed to load IWSDK injection bundle:', error);
    console.error(
      'Make sure to run "pnpm build:injection" first to create the pre-built bundle.',
    );
    throw error;
  }
}

/**
 * Source of the module the plugin injects into the page: it imports the
 * runtime and starts it with the configuration.
 */
export function createInjectionModuleSource(
  bundle: InjectionBundleResult,
): string {
  return `import { startIwsdkDevRuntime } from ${JSON.stringify(
    INJECTION_RUNTIME_ID_PREFIX + path.basename(bundle.entryPath),
  )};
startIwsdkDevRuntime(${bundle.config});`;
}

/**
 * Resolves a runtime module id (or a relative import from one) to its
 * resolved id, or returns null for anything else.
 */
export function resolveInjectionRuntimeId(
  id: string,
  importer: string | undefined,
): string | null {
  if (id.startsWith(INJECTION_RUNTIME_ID_PREFIX)) {
    return '\0' + id;
  }
  if (importer?.startsWith(RESOLVED_RUNTIME_ID_PREFIX) && /^\.\.?\//.test(id)) {
    const from = path.posix.dirname(
      importer.slice(RESOLVED_RUNTIME_ID_PREFIX.length),
    );
    return RESOLVED_RUNTIME_ID_PREFIX + path.posix.join(from, id);
  }
  return null;
}

/**
 * The runtime file a resolved runtime module id refers to, or null if the id
 * is not one or points outside the runtime folder.
 */
export function resolveInjectionRuntimeFile(
  bundle: InjectionBundleResult,
  resolvedId: string,
): string | null {
  if (!resolvedId.startsWith(RESOLVED_RUNTIME_ID_PREFIX)) {
    return null;
  }
  const relative = resolvedId.slice(RESOLVED_RUNTIME_ID_PREFIX.length);
  const file = path.resolve(bundle.directory, relative);
  const fromDirectory = path.relative(bundle.directory, file);
  if (
    !relative.endsWith('.js') ||
    fromDirectory.startsWith('..') ||
    path.isAbsolute(fromDirectory)
  ) {
    return null;
  }
  return file;
}

// Bytes the page loads up front: a file plus everything it imports statically
// (the lazy chunks are dynamic imports).
async function staticImportSize(
  file: string,
  seen = new Set<string>(),
): Promise<number> {
  if (seen.has(file)) {
    return 0;
  }
  seen.add(file);
  const code = await readFile(file, 'utf8');
  let size = Buffer.byteLength(code);
  for (const match of code.matchAll(
    /(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g,
  )) {
    size += await staticImportSize(
      path.resolve(path.dirname(file), match[1]),
      seen,
    );
  }
  return size;
}

async function directorySize(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const sizes = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(
          async (entry) => (await stat(path.join(directory, entry.name))).size,
        ),
    );
    return sizes.reduce((sum, size) => sum + size, 0);
  } catch {
    return 0;
  }
}

async function resolveInjectionEntryPath(): Promise<string> {
  const candidates = [
    path.resolve(__dirname, 'injection', 'runtime.js'),
    path.resolve(__dirname, '..', 'dist', 'injection', 'runtime.js'),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next source/build layout.
    }
  }

  return candidates[0];
}
