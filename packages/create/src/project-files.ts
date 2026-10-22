/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScaffoldConfiguration } from './catalog.js';
import { createPnpmWorkspaceYaml } from './pnpm-workspace.js';
import { createProjectManifest } from './project-manifest.js';
import type { ProjectFileInput } from './scaffold.js';
import type { Language } from './types.js';
import { VERSION } from './version.js';

export interface ProjectPackageSource {
  getPackageInstallSpec(name: string): string | undefined;
}

export interface BuildStarterProjectOptions {
  appName: string;
  configuration: ScaffoldConfiguration;
  language: Language;
  packageSource: ProjectPackageSource;
  templateRoot?: string;
}

/** Materialize one target/language output from the packaged common source. */
export async function buildStarterProjectFiles({
  appName,
  configuration,
  language,
  packageSource,
  templateRoot = resolvePackagedTemplateRoot(),
}: BuildStarterProjectOptions): Promise<ProjectFileInput[]> {
  const sourceDirectory = path.join(
    templateRoot,
    language === 'ts' ? 'common' : 'common-js',
  );
  const files = await readDirectoryFiles(sourceDirectory);
  for (const guidanceGroup of GUIDANCE_GROUPS) {
    files.push(
      ...(await readDirectoryFiles(
        path.join(templateRoot, '..', 'guidance', guidanceGroup),
      )),
    );
  }
  const sceneSource = path.join(
    templateRoot,
    'scenes',
    configuration.target === 'ar'
      ? 'ar.iwsdk.scene.json'
      : 'immersive.iwsdk.scene.json',
  );
  files.push({
    path: 'public/scenes/main.iwsdk.scene.json',
    contents: await readFile(sceneSource),
  });
  files.push({
    path: 'iwsdk.config.json',
    contents: `${JSON.stringify(createProjectManifest(configuration), null, 2)}\n`,
  });
  files.push({
    path: 'package.json',
    contents: `${JSON.stringify(
      createProjectPackageJson(appName, language, packageSource),
      null,
      2,
    )}\n`,
  });
  files.push({
    path: 'pnpm-workspace.yaml',
    contents: createPnpmWorkspaceYaml(),
  });

  const index = files.find((file) => file.path === 'index.html');
  if (index != null && typeof index.contents === 'string') {
    index.contents = index.contents.replace(
      '<title>IWSDK App</title>',
      `<title>${escapeHtml(appName)}</title>`,
    );
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function createProjectPackageJson(
  appName: string,
  language: Language,
  source: ProjectPackageSource,
): Record<string, unknown> {
  const packageSpec = (name: string) =>
    source.getPackageInstallSpec(name) ?? VERSION;
  return {
    name: appName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'iwsdk dev restart --open --foreground',
      'dev:runtime': 'vite',
      'dev:down': 'iwsdk dev down',
      'dev:status': 'iwsdk dev status',
      'reference:status': 'iwsdk reference status',
      'reference:warmup': 'iwsdk reference warmup',
      ...(language === 'ts' ? { typecheck: 'tsc --noEmit' } : {}),
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: {
      '@iwsdk/core': packageSpec('@iwsdk/core'),
      // Declared so Vite resolve.dedupe / optimizeDeps.include can resolve from
      // the app root under pnpm (transitive-only installs break `vite build`).
      '@pmndrs/uikit': '^1.0.74',
      '@pmndrs/uikit-horizon': '^1.0.74',
      '@pmndrs/uikit-lucide': '^1.0.74',
      three: 'npm:super-three@0.185.0',
    },
    devDependencies: {
      '@iwsdk/reference': packageSpec('@iwsdk/reference'),
      '@iwsdk/cli': packageSpec('@iwsdk/cli'),
      '@iwsdk/vite-plugin-dev': packageSpec('@iwsdk/vite-plugin-dev'),
      '@meta-quest/metavr': '^1.8.1',
      ...(language === 'ts'
        ? { '@types/three': '^0.185.0', typescript: '^5.5.0' }
        : {}),
      vite: '^7.1.4',
    },
    overrides: {
      sharp: '0.35.4',
      three: 'npm:super-three@0.185.0',
    },
    engines: {
      node: '>=20.19.0 <21.0.0-0 || >=22.12.0 <23.0.0-0 || >=24.0.0',
    },
  };
}

async function readDirectoryFiles(
  root: string,
  relative = '',
): Promise<ProjectFileInput[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: ProjectFileInput[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readDirectoryFiles(root, childRelative)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Template entry is not a regular file: ${childRelative}`);
    }
    const outputPath = templateOutputPath(childRelative);
    const contents = await readFile(path.join(root, childRelative));
    files.push({
      path: outputPath,
      contents: isTextTemplate(outputPath)
        ? contents.toString('utf8')
        : contents,
    });
  }
  return files;
}

function templateOutputPath(relativePath: string): string {
  if (relativePath === 'gitignore.template') {
    return '.gitignore';
  }
  if (relativePath === 'nvmrc.template') {
    return '.nvmrc';
  }
  return relativePath;
}

function isTextTemplate(filePath: string): boolean {
  return !filePath.endsWith('.mp3') && !filePath.endsWith('.png');
}

const GUIDANCE_GROUPS = [
  'common',
  'claude',
  'agents',
  'codex',
  'cursor',
  'copilot',
  'scoped-agents',
] as const;

function resolvePackagedTemplateRoot(): string {
  const adjacent = fileURLToPath(new URL('./template/', import.meta.url));
  if (existsSync(adjacent)) {
    return adjacent;
  }
  const source = fileURLToPath(new URL('../template/', import.meta.url));
  if (existsSync(path.join(source, 'common-js'))) {
    return source;
  }
  const builtFromSource = fileURLToPath(
    new URL('../dist/template/', import.meta.url),
  );
  if (existsSync(builtFromSource)) {
    return builtFromSource;
  }
  throw new Error(
    'The @iwsdk/create package is missing its packaged starter templates.',
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
