/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const templateRoot = path.join(packageRoot, 'template');
const outputRoot = path.join(packageRoot, 'dist', 'template');
const guidanceOutputRoot = path.join(packageRoot, 'dist', 'guidance');

await rm(outputRoot, { recursive: true, force: true });
await rm(guidanceOutputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(path.join(templateRoot, 'common'), path.join(outputRoot, 'common'), {
  recursive: true,
});
await cp(path.join(templateRoot, 'scenes'), path.join(outputRoot, 'scenes'), {
  recursive: true,
});
// Agent guidance is rendered from @iwsdk/core's sources, so a new app gets the
// same stamped files that `iwsdk agents sync` installs from @iwsdk/core.
execFileSync(
  process.execPath,
  [
    path.join(packageRoot, '..', 'core', 'scripts', 'build-agent-guidance.mjs'),
    guidanceOutputRoot,
  ],
  { stdio: 'inherit' },
);
await emitJavaScriptTemplate(
  path.join(templateRoot, 'common'),
  path.join(outputRoot, 'common-js'),
);

async function emitJavaScriptTemplate(
  sourceRoot,
  destinationRoot,
  relative = '',
) {
  const sourceDirectory = path.join(sourceRoot, relative);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await emitJavaScriptTemplate(sourceRoot, destinationRoot, childRelative);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Template entry is not a regular file: ${childRelative}`);
    }
    if (entry.name === 'tsconfig.json' || entry.name.endsWith('.d.ts')) {
      continue;
    }
    const sourcePath = path.join(sourceRoot, childRelative);
    const isTypeScript = entry.name.endsWith('.ts');
    const outputRelative = isTypeScript
      ? childRelative.slice(0, -3) + '.js'
      : childRelative;
    const outputPath = path.join(destinationRoot, outputRelative);
    await mkdir(path.dirname(outputPath), { recursive: true });
    if (isTypeScript) {
      const source = await readFile(sourcePath, 'utf8');
      const result = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2021,
          importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        },
        fileName: childRelative,
        reportDiagnostics: true,
      });
      const errors = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      if (errors.length > 0) {
        throw new Error(
          `Failed to transpile starter template ${childRelative}: ${errors
            .map((diagnostic) =>
              ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            )
            .join('; ')}`,
        );
      }
      await writeFile(outputPath, result.outputText, 'utf8');
      continue;
    }
    if (entry.name === 'index.html') {
      const source = await readFile(sourcePath, 'utf8');
      await writeFile(
        outputPath,
        source.replace('/src/index.ts', '/src/index.js'),
        'utf8',
      );
      continue;
    }
    await cp(sourcePath, outputPath);
  }
}
