/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { rmSync } from 'fs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const OUTPUT_DIR = 'dist/injection';

// The emulator runtime is an ES module with code-split chunks: the entry
// (IWER, DevUI, SEM) loads with the page, while GLTS and each built-in room
// are separate chunks that load only when a room is shown.
// The plugin serves dist/injection/ in development and lets Vite bundle it
// for production builds with injectOnBuild.

// IWSDK surfaces only SEM's built-in GLTS rooms. The legacy capture rooms
// (about 4.7 MB of JSON) are left out of the runtime entirely.
const LEGACY_CAPTURE_ID = '\0iwsdk-legacy-capture';
const omitLegacyCaptures = {
  name: 'iwsdk-omit-legacy-captures',
  resolveId(source, importer) {
    if (
      importer?.includes('@iwer/sem') &&
      /\/captures\/[^/]+\.json$/.test(source)
    ) {
      return LEGACY_CAPTURE_ID;
    }
    return null;
  },
  load(id) {
    if (id === LEGACY_CAPTURE_ID) {
      return 'throw new Error("[IWSDK Dev] The legacy capture rooms are not part of IWSDK. Use one of the built-in rooms.");';
    }
    return null;
  },
};

// Hashed chunk names change with every build, so start from an empty folder.
const cleanOutput = {
  name: 'iwsdk-clean-injection-output',
  buildStart() {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
    rmSync('dist/injection-bundle.js', { force: true });
  },
};

export default {
  input: { runtime: 'src/injection-template.ts' },
  output: {
    dir: OUTPUT_DIR,
    format: 'es',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    plugins: [
      terser({
        compress: {
          drop_console: false, // Keep console.log for debugging
        },
        // Keep bundler hints such as GLTS's `import(/* @vite-ignore */ url)`,
        // so Vite doesn't warn when it serves or bundles the runtime chunks.
        format: { comments: /@vite-ignore|webpackIgnore/ },
      }),
    ],
  },
  plugins: [
    cleanOutput,
    omitLegacyCaptures,
    typescript({
      tsconfig: './tsconfig.json',
      outDir: OUTPUT_DIR,
      declaration: false,
      declarationMap: false,
    }),
    json(), // Handle JSON imports
    nodeResolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    replace({
      'process.env.NODE_ENV': JSON.stringify('production'),
      // SEM's ES path: rooms and GLTS are lazy imports (code-split above).
      __IS_UMD__: 'false',
      preventAssignment: true,
    }),
    replace({
      'window.__THREE__': 'window.__THREE__IWER__',
      preventAssignment: false,
    }),
    // Offset the @pmndrs/pointer-events pointer ID counter so the injection
    // bundle's copy doesn't collide with the app's copy — both share the
    // global registry `globalThis.pointerEventspointerMap`.
    replace({
      'let pointerIdCounter = 23412': 'let pointerIdCounter = 99412',
      delimiters: ['', ''],
      preventAssignment: false,
    }),
  ],
  external: [], // Bundle everything; dynamic imports become chunks
};
