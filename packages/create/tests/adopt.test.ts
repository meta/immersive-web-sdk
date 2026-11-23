/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { validateSceneDocument } from '@iwsdk/scene-composition';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AdoptError,
  adoptExistingProject,
  mergePackageJson,
} from '../src/adopt.js';
import { getRecommendedConfiguration } from '../src/catalog.js';
import { installDependencies } from '../src/installer.js';
import { detectPackageManager } from '../src/package-manager.js';
import { buildStarterProjectFiles } from '../src/project-files.js';
import {
  blankNonCode,
  loadsPluginStatically,
  patchViteConfig,
} from '../src/vite-config-patch.js';

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const GUIDANCE_ROOT = path.join(PACKAGE_ROOT, 'dist', 'guidance');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function existingProject(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-adopt-'));
  tempDirs.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relativePath)), {
      recursive: true,
    });
    await writeFile(path.join(root, relativePath), contents);
  }
  return root;
}

function starterFiles(language: 'ts' | 'js' = 'ts') {
  return buildStarterProjectFiles({
    appName: 'starter',
    configuration: getRecommendedConfiguration('vr'),
    language,
    packageSource: { getPackageInstallSpec: () => '9.9.9' },
    templateRoot: path.join(PACKAGE_ROOT, 'dist', 'template'),
  });
}

async function adopt(outDir: string, language: 'ts' | 'js' = 'ts') {
  return adoptExistingProject({
    outDir,
    files: await starterFiles(language),
    guidanceRoot: GUIDANCE_ROOT,
    language,
  });
}

const requireFromVitePluginDev = createRequire(
  path.join(PACKAGE_ROOT, '..', 'vite-plugin-dev', 'package.json'),
);

/**
 * Load a project's Vite config the way `vite build` does. Its imports resolve
 * from the project: Vite itself, and a stand-in for @iwsdk/vite-plugin-dev
 * that, like the real package, has only an `import` entry.
 */
async function loadViteConfig(root: string) {
  const plugin = path.join(root, 'node_modules', '@iwsdk', 'vite-plugin-dev');
  if (!existsSync(plugin)) {
    await mkdir(plugin, { recursive: true });
    await writeFile(
      path.join(plugin, 'package.json'),
      JSON.stringify({
        name: '@iwsdk/vite-plugin-dev',
        type: 'module',
        exports: { '.': { import: './index.js' } },
      }),
    );
    await writeFile(
      path.join(plugin, 'index.js'),
      "export const iwsdkDev = () => ({ name: 'iwsdk-dev' });\n",
    );
    await symlink(
      path.dirname(requireFromVitePluginDev.resolve('vite/package.json')),
      path.join(root, 'node_modules', 'vite'),
      'dir',
    );
  }
  const vite = await import(
    pathToFileURL(requireFromVitePluginDev.resolve('vite')).href
  );
  return vite.loadConfigFromFile(
    { command: 'build', mode: 'production' },
    undefined,
    root,
    'silent',
  );
}

async function snapshot(
  root: string,
  relative = '',
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [key, value] of await snapshot(root, child)) {
        files.set(key, value);
      }
    } else if (entry.isFile()) {
      files.set(child, await readFile(path.join(root, child), 'utf8'));
    }
  }
  return files;
}

/** Shaped like a `npm create vite` react-ts project with a components barrel. */
const VITE_APP = {
  'package.json': `${JSON.stringify(
    {
      name: 'my-vite-app',
      private: true,
      type: 'module',
      scripts: { dev: 'vite', build: 'tsc -b && vite build' },
      dependencies: { react: '^19.0.0', three: '^0.170.0' },
      devDependencies: { vite: '^7.1.0', typescript: '^5.8.0' },
    },
    null,
    2,
  )}\n`,
  'vite.config.ts':
    "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n",
  'index.html':
    '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>\n',
  'src/main.tsx':
    "import { Button } from './components'\nconsole.log(Button)\n",
  'src/components/index.ts': "export const Button = 'button'\n",
  'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
  'tsconfig.json':
    '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }\n',
  'AGENTS.md': '# Team rules\n\nUse tabs.\n',
  '.gitignore': 'node_modules\ndist\n',
};

/** No "type": "module", so Vite loads vite.config.js and .ts as CommonJS. */
const COMMONJS_PACKAGE =
  '{ "name": "cjs-vite-app", "devDependencies": { "vite": "^7.1.0" } }\n';
const ESM_PACKAGE =
  '{ "name": "esm-vite-app", "type": "module", "devDependencies": { "vite": "^7.1.0" } }\n';
const PLAIN_VITE_CONFIG =
  "import { defineConfig } from 'vite'\nexport default defineConfig({\n  plugins: [],\n})\n";
/** Like the Vite config 1.2.0-rc.0 wrote, whatever package.json said. */
const IWSDK_VITE_CONFIG =
  "import { iwsdkDev } from '@iwsdk/vite-plugin-dev'\nimport { defineConfig } from 'vite'\n\nexport default defineConfig({\n  plugins: [iwsdkDev()],\n})\n";

describe('mergePackageJson', () => {
  const starter = {
    scripts: { dev: 'iwsdk dev restart', typecheck: 'tsc --noEmit' },
    dependencies: { '@iwsdk/core': '1.2.0', three: 'npm:super-three@0.185.0' },
    devDependencies: {
      '@iwsdk/cli': '1.2.0',
      '@types/three': '^0.185.0',
      vite: '^7.1.4',
    },
    overrides: { three: 'npm:super-three@0.185.0', sharp: '0.35.4' },
    engines: { node: '>=20' },
  };

  it('adds what is missing, keeps the developer scripts, and reports engines', () => {
    const { packageJson, report } = mergePackageJson(
      { name: 'app', scripts: { dev: 'vite' } },
      starter,
      'npm',
    );
    expect(packageJson.scripts).toEqual({
      dev: 'vite',
      'iwsdk:dev': 'iwsdk dev restart',
      typecheck: 'tsc --noEmit',
    });
    expect(report.keptScripts).toEqual(['dev']);
    expect(report.added.some((change) => change.field === 'engines')).toBe(
      true,
    );
  });

  it('only raises versions and leaves workspace, file and catalog specs alone', () => {
    const { packageJson, report } = mergePackageJson(
      {
        dependencies: {
          '@iwsdk/core': '^2.0.0',
          '@iwsdk/cli': 'workspace:*',
          three: '^0.170.0',
        },
        devDependencies: { '@types/three': 'catalog:', vite: '^6.2.0' },
      },
      starter,
      'npm',
    );
    expect(packageJson.dependencies).toMatchObject({
      '@iwsdk/core': '^2.0.0',
      '@iwsdk/cli': 'workspace:*',
      three: 'npm:super-three@0.185.0',
    });
    expect(packageJson.devDependencies).toMatchObject({
      '@types/three': 'catalog:',
      vite: '^7.1.4',
    });
    expect(report.keptDependencies.map((entry) => entry.name).sort()).toEqual([
      '@iwsdk/cli',
      '@iwsdk/core',
      '@types/three',
    ]);
  });

  it('writes overrides where each package manager reads them', () => {
    expect(
      mergePackageJson({}, starter, 'yarn').packageJson.resolutions,
    ).toEqual(starter.overrides);
    const pnpm = mergePackageJson(
      { pnpm: { overrides: { three: '0.170.0' } } },
      starter,
      'pnpm',
    );
    expect(pnpm.packageJson.overrides).toBeUndefined();
    expect(pnpm.pnpmOverrides).toEqual(starter.overrides);
    expect((pnpm.packageJson.pnpm as any).overrides.three).toBe(
      'npm:super-three@0.185.0',
    );
    const nested = mergePackageJson(
      { overrides: { three: { '.': '0.170.0' } } },
      starter,
      'npm',
    );
    expect(nested.manualSteps.join('\n')).toContain('nested');
    expect(JSON.stringify(nested.report)).not.toContain('[object Object]');
  });

  it('reports only dependencies that are newer, not the same release', () => {
    const { packageJson, report } = mergePackageJson(
      {
        // What `npm install @iwsdk/core@1.2.0-rc.0` and friends write.
        dependencies: { '@iwsdk/core': '^1.2.0-rc.0' },
        devDependencies: {
          '@iwsdk/cli': '~1.2.0-rc.0',
          '@iwsdk/vite-plugin-dev': '^1.3.0',
          '@types/three': '0.185.0',
        },
      },
      {
        dependencies: { '@iwsdk/core': '1.2.0-rc.0' },
        devDependencies: {
          '@iwsdk/cli': '1.2.0-rc.0',
          '@iwsdk/vite-plugin-dev': '1.2.0-rc.0',
          '@types/three': '^0.185.0',
        },
      },
      'npm',
    );
    expect(report.keptDependencies).toEqual([
      {
        name: '@iwsdk/vite-plugin-dev',
        spec: '^1.3.0',
        reason: 'newer than this release',
      },
    ]);
    expect(report.changed).toEqual([]);
    expect(packageJson.dependencies).toEqual({ '@iwsdk/core': '^1.2.0-rc.0' });
  });

  it('calls a dist-tag a dist-tag', () => {
    const { report } = mergePackageJson(
      {
        dependencies: { '@iwsdk/core': 'latest' },
        devDependencies: { '@iwsdk/cli': 'workspace:*', vite: 'next' },
      },
      starter,
      'npm',
    );
    expect(report.keptDependencies).toEqual([
      {
        name: '@iwsdk/core',
        spec: 'latest',
        reason: 'a dist-tag, not a version range',
      },
      {
        name: '@iwsdk/cli',
        spec: 'workspace:*',
        reason: 'not a registry version',
      },
      {
        name: 'vite',
        spec: 'next',
        reason: 'a dist-tag; check it satisfies Vite 7',
      },
    ]);
  });

  it('uses tsc -b for a solution-style tsconfig', () => {
    expect(
      mergePackageJson({}, starter, 'npm', 'ts', true).packageJson.scripts,
    ).toMatchObject({ typecheck: 'tsc -b' });
  });
});

describe('patchViteConfig', () => {
  it('adds the plugin to the config’s top-level plugins array', () => {
    const { text, status } = patchViteConfig(VITE_APP['vite.config.ts']);
    expect(status).toBe('patched');
    expect(text).toContain('plugins: [iwsdkDev(), react()]');
    expect(text).toContain(
      "import { iwsdkDev } from '@iwsdk/vite-plugin-dev'\n",
    );
    expect(text).not.toContain("plugin-dev';");
    expect(patchViteConfig('export default { plugins: [] };\n').text).toContain(
      'plugins: [iwsdkDev()]',
    );
  });

  it('adds a plugins array to a config without one', () => {
    for (const source of [
      "import { defineConfig } from 'vite';\nexport default defineConfig({\n  base: './',\n});\n",
      "export default {\n  base: './',\n};\n",
    ]) {
      const { text, status } = patchViteConfig(source);
      expect(status).toBe('patched');
      expect(text).toContain('plugins: [iwsdkDev()],');
      expect(text).toContain("from '@iwsdk/vite-plugin-dev';");
    }
  });

  it('leaves every shape it cannot edit safely to the developer', () => {
    for (const source of [
      'module.exports = { plugins: [] };\n',
      'const plugins = [react()];\nexport default defineConfig({ plugins });\n',
      'export default defineConfig({ plugins: isProd ? [a()] : [b()] });\n',
      'export default defineConfig({ plugins: getPlugins() });\n',
      'export default defineConfig({ "plugins": [react()] });\n',
      "export default ({ mode }) => mode === 'a' ? { plugins: [] } : { plugins: [] };\n",
      'export default makeConfig();\n',
    ]) {
      expect(patchViteConfig(source).status, source).toBe('manual');
    }
  });

  it('never edits comments, strings or nested plugin arrays', () => {
    const commented = patchViteConfig(
      "// plugins: [react()]\nexport default defineConfig({ base: './' });\n",
    );
    expect(commented.text).toContain('\n// plugins: [react()]\n');
    expect(commented.text).toContain(
      "{\n  plugins: [iwsdkDev()], base: './' }",
    );

    const nested = patchViteConfig(
      'export default defineConfig({ build: { rollupOptions: { plugins: [x()] } } });\n',
    );
    expect(nested.text).toContain('rollupOptions: { plugins: [x()] }');
    expect(nested.text).toContain('plugins: [iwsdkDev()],');

    const template = patchViteConfig(
      "const banner = `\nimport x from 'y'\n`;\nexport default { plugins: [] };\n",
    );
    expect(template.text.startsWith('import { iwsdkDev }')).toBe(true);
    expect(template.text).toContain("`\nimport x from 'y'\n`");
    expect(blankNonCode("a('b') // c")).toBe("a(' ')     ");
  });

  it('leaves a config with a top-level spread to the developer', () => {
    const source =
      "import { defineConfig } from 'vite'\nimport base from './base'\nexport default defineConfig({\n  plugins: [],\n  ...base,\n})\n";
    expect(patchViteConfig(source)).toEqual({ text: source, status: 'manual' });
  });

  it('leaves plugins changed after the config is built to the developer', () => {
    for (const change of [
      'config.plugins = [react()]',
      'config.plugins.push(react())',
    ]) {
      const source = `import { defineConfig } from 'vite'\nconst config = defineConfig({\n  plugins: [],\n})\n${change}\nexport default config\n`;
      expect(patchViteConfig(source).status, change).toBe('manual');
    }
  });

  it('reads a regex literal after return', () => {
    const source =
      "import { defineConfig } from 'vite'\nconst skip = (id) => {\n  return /['{]/.test(id)\n}\nexport default defineConfig({\n  plugins: [],\n})\n";
    expect(patchViteConfig(source).status).toBe('patched');
  });

  it('reads past regex literals that contain quotes or brackets', () => {
    const source =
      "import { defineConfig } from 'vite'\nconst skip = /['\\[{]/\nexport default defineConfig({\n  plugins: [],\n  server: { watch: { ignored: [/\"\\]/] } },\n})\n";
    const { text, status } = patchViteConfig(source);
    expect(status).toBe('patched');
    expect(text).toContain('plugins: [iwsdkDev()],');
    expect(text).toContain("const skip = /['\\[{]/");
  });

  it('recognizes a config that already uses the plugin', () => {
    expect(
      patchViteConfig(
        "import { iwsdkDev } from '@iwsdk/vite-plugin-dev';\nexport default { plugins: [iwsdkDev()] };\n",
      ).status,
    ).toBe('already-configured');
  });

  it('tells a static import or require of the plugin from a dynamic import', () => {
    for (const source of [
      IWSDK_VITE_CONFIG,
      'import {\n  iwsdkDev,\n} from "@iwsdk/vite-plugin-dev";\n',
      "const { iwsdkDev } = require('@iwsdk/vite-plugin-dev')\n",
      "import iwsdk = require('@iwsdk/vite-plugin-dev')\n",
      "import '@iwsdk/vite-plugin-dev'\n",
      "export { iwsdkDev } from '@iwsdk/vite-plugin-dev/editor/session'\n",
    ]) {
      expect(loadsPluginStatically(source), source).toBe(true);
    }
    for (const source of [
      "export default async () => {\n  const { iwsdkDev } = await import('@iwsdk/vite-plugin-dev')\n  return { plugins: [iwsdkDev()] }\n}\n",
      "import type { IwsdkDevOptions } from '@iwsdk/vite-plugin-dev'\n",
      "// import { iwsdkDev } from '@iwsdk/vite-plugin-dev'\n",
      "const note = `import { iwsdkDev } from '@iwsdk/vite-plugin-dev'`\n",
      "import { iwsdkDev } from './vendor/vite-plugin-dev.js'\n",
    ]) {
      expect(loadsPluginStatically(source), source).toBe(false);
    }
  });
});

describe('detectPackageManager', () => {
  it('walks up to the monorepo lockfile and honors packageManager', async () => {
    const root = await existingProject({
      'package.json': JSON.stringify({ packageManager: 'pnpm@10.18.3' }),
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'apps/web/package.json': '{}',
      '.git/HEAD': 'ref',
    });
    expect(detectPackageManager(path.join(root, 'apps/web'))).toEqual({
      name: 'pnpm',
      root,
    });
    const lone = await existingProject({
      'package.json': '{}',
      '.git/HEAD': 'x',
    });
    expect(detectPackageManager(lone)).toEqual({ name: 'npm', root: lone });
  });

  it('ignores a stray lockfile in a folder that is not a workspace', async () => {
    const home = await existingProject({
      'package-lock.json': '{}',
      'projects/app/package.json': '{}',
    });
    const app = path.join(home, 'projects/app');
    expect(detectPackageManager(app)).toMatchObject({ name: 'npm', root: app });
    // Nor does a packageManager field there.
    await writeFile(
      path.join(home, 'package.json'),
      JSON.stringify({ packageManager: 'yarn@4.0.0' }),
    );
    expect(detectPackageManager(app)).toMatchObject({ name: 'npm', root: app });
  });

  it('ignores the single-app pnpm-workspace.yaml that generated apps carry', async () => {
    const root = await existingProject({
      'package.json': '{ "workspaces": ["apps/*"] }',
      'package-lock.json': '{}',
      'apps/web/package.json': '{}',
      'apps/web/pnpm-workspace.yaml': 'packages:\n  - .\n',
      '.git/HEAD': 'ref',
    });
    expect(detectPackageManager(path.join(root, 'apps/web'))).toEqual({
      name: 'npm',
      root,
    });
    const fresh = await existingProject({
      'package.json': '{}',
      'pnpm-workspace.yaml': "packages: ['.']\n",
      '.git/HEAD': 'ref',
    });
    expect(detectPackageManager(fresh)).toEqual({ name: 'npm', root: fresh });
    const workspace = await existingProject({
      'package.json': '{}',
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'apps/web/package.json': '{}',
      '.git/HEAD': 'ref',
    });
    expect(detectPackageManager(path.join(workspace, 'apps/web'))).toEqual({
      name: 'pnpm',
      root: workspace,
    });
  });
});

describe('adoptExistingProject', () => {
  it('never overwrites or shadows a developer file', async () => {
    const root = await existingProject(VITE_APP);
    const before = await snapshot(root);
    const report = await adopt(root);
    const after = await snapshot(root);

    for (const unchanged of [
      'index.html',
      'src/main.tsx',
      'src/components/index.ts',
      'src/vite-env.d.ts',
      'tsconfig.json',
    ]) {
      expect(after.get(unchanged), unchanged).toBe(before.get(unchanged));
    }
    // IWSDK's skeleton lives in its own folder, so `./components` still
    // resolves to the developer's barrel.
    expect(report.created).toEqual(
      expect.arrayContaining([
        'iwsdk.config.json',
        'public/scenes/main.iwsdk.scene.json',
        'src/iwsdk/assets.ts',
        'src/iwsdk/components.ts',
        'src/iwsdk/index.ts',
        'src/iwsdk/iwsdk-env.d.ts',
      ]),
    );
    expect(
      report.created.filter(
        (file) => file.startsWith('src/') && !file.startsWith('src/iwsdk/'),
      ),
    ).toEqual([]);
    const config = JSON.parse(after.get('iwsdk.config.json')!);
    expect(config.assets.module).toBe('./src/iwsdk/assets');
    expect(config.components.module).toBe('./src/iwsdk/components');
    const scene = JSON.parse(after.get('public/scenes/main.iwsdk.scene.json')!);
    expect(scene.nodes).toEqual([]);
    expect(validateSceneDocument(scene).valid).toBe(true);
    expect(after.get('src/iwsdk/iwsdk-env.d.ts')).toContain(
      '@iwsdk/vite-plugin-dev/client',
    );

    expect(after.get('vite.config.ts')).toContain(
      'plugins: [iwsdkDev(), react()]',
    );
    expect(
      after.get('AGENTS.md')!.startsWith('# Team rules\n\nUse tabs.\n'),
    ).toBe(true);
    expect(after.get('.gitignore')).toBe(
      'node_modules\ndist\n\n# IWSDK\n.iwsdk/\n.mcp.json\n.cursor/mcp.json\n.vscode/mcp.json\n.codex/config.toml\n',
    );
    const packageJson = JSON.parse(after.get('package.json')!);
    expect(packageJson.dependencies.react).toBe('^19.0.0');
    expect(packageJson.dependencies['@iwsdk/core']).toBe('9.9.9');
    expect(packageJson.scripts.build).toBe('tsc -b && vite build');
    expect(packageJson.scripts.typecheck).toBe('tsc -b');
    expect(report.manualSteps.join('\n')).toContain("import './iwsdk'");
    expect(existsSync(path.join(root, 'README.md'))).toBe(false);
  });

  it('stops before writing anything when Vite is newer than the plugin supports', async () => {
    const root = await existingProject({
      ...VITE_APP,
      'package.json': JSON.stringify({
        devDependencies: { vite: '^8.3.5', '@vitejs/plugin-react': '^6.1.2' },
      }),
    });
    const before = await snapshot(root);
    await expect(adopt(root)).rejects.toThrow(
      /vite \^8\.3\.5.*Nothing was changed/su,
    );
    expect(await snapshot(root)).toEqual(before);
  });

  it('stops before writing anything when package.json is invalid', async () => {
    const root = await existingProject({
      ...VITE_APP,
      'package.json': '{ "name": "x", }',
    });
    const before = await snapshot(root);
    await expect(adopt(root)).rejects.toBeInstanceOf(AdoptError);
    expect(await snapshot(root)).toEqual(before);
  });

  it('keeps linked files instead of failing halfway', async () => {
    const root = await existingProject(VITE_APP);
    await rm(path.join(root, 'tsconfig.json'));
    await symlink(
      path.join(root, 'AGENTS.md'),
      path.join(root, 'tsconfig.json'),
    );
    const report = await adopt(root);
    expect(report.kept).toContain('tsconfig.json');
  });

  it('preserves package.json indentation', async () => {
    const root = await existingProject({
      ...VITE_APP,
      'package.json':
        '{\n\t"name": "tabbed",\n\t"devDependencies": { "vite": "^7.0.0" }\n}\n',
    });
    await adopt(root);
    const text = await readFile(path.join(root, 'package.json'), 'utf8');
    expect(text.startsWith('{\n\t"name": "tabbed",')).toBe(true);
  });

  it('writes pnpm overrides into pnpm-workspace.yaml and keeps its packages', async () => {
    const root = await existingProject({
      ...VITE_APP,
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': '# workspace\npackages:\n  - .\n',
    });
    const report = await adopt(root);
    expect(report.packageManager).toBe('pnpm');
    expect(report.overrides).toBe('pnpm-workspace.yaml overrides');
    const yaml = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(yaml).toContain('# workspace');
    expect(yaml).toContain('packages:\n  - .');
    expect(yaml).toContain('three: npm:super-three@0.185.0');
    const packageJson = JSON.parse(
      await readFile(path.join(root, 'package.json'), 'utf8'),
    );
    expect(packageJson.overrides).toBeUndefined();
  });

  it('leaves overrides for a workspace root to the developer', async () => {
    const root = await existingProject({
      'package.json': '{ "private": true }\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      '.git/HEAD': 'ref',
      ...Object.fromEntries(
        Object.entries(VITE_APP).map(([file, text]) => [
          `apps/web/${file}`,
          text,
        ]),
      ),
    });
    const before = await readFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'utf8',
    );
    const report = await adopt(path.join(root, 'apps/web'));
    expect(report.workspaceRoot).toBe(root);
    expect(report.overrides).toBeNull();
    expect(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(
      before,
    );
    expect(existsSync(path.join(root, 'apps/web/pnpm-workspace.yaml'))).toBe(
      false,
    );
    expect(report.manualSteps.join('\n')).toContain('super-three@0.185.0');
  });

  it('leaves a pnpm-workspace.yaml it cannot read to the developer', async () => {
    for (const yaml of ['packages: [\n', 'overrides: just-text\n']) {
      const root = await existingProject({
        ...VITE_APP,
        'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
        'pnpm-workspace.yaml': yaml,
      });
      const report = await adopt(root);
      expect(
        await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8'),
      ).toBe(yaml);
      expect(report.overrides).toBeNull();
      expect(report.manualSteps.join('\n')).toContain(
        'pnpm-workspace.yaml could not be edited safely',
      );
    }
    const empty = await existingProject({
      ...VITE_APP,
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': '',
    });
    await adopt(empty);
    expect(
      await readFile(path.join(empty, 'pnpm-workspace.yaml'), 'utf8'),
    ).toContain('three: npm:super-three@0.185.0');
  });

  it('stops before writing anything when src is a link', async () => {
    const root = await existingProject(VITE_APP);
    const elsewhere = await existingProject({ 'lib/keep.ts': '' });
    await rm(path.join(root, 'src'), { recursive: true });
    await symlink(path.join(elsewhere, 'lib'), path.join(root, 'src'));
    const before = await snapshot(root);
    await expect(adopt(root)).rejects.toThrow(/src\/iwsdk/u);
    expect(await snapshot(root)).toEqual(before);
  });

  it('skips the load step when the entry module already imports the skeleton', async () => {
    const root = await existingProject({
      ...VITE_APP,
      'src/main.tsx': "import './iwsdk'\n",
    });
    const report = await adopt(root);
    expect(report.manualSteps.join('\n')).not.toContain('src/iwsdk');

    // Otherwise the step names the entry module and the import it needs.
    const rootEntry = await existingProject({
      ...VITE_APP,
      'index.html': '<script type="module" src="/main.js"></script>\n',
      'main.js': '',
    });
    const steps = (await adopt(rootEntry, 'js')).manualSteps.join('\n');
    expect(steps).toContain("`import './src/iwsdk';` to main.js");
  });

  it('adds the native build target pieces with --metavr-native, and names the manifest step it cannot write', async () => {
    const nativeFiles = () =>
      buildStarterProjectFiles({
        appName: 'starter',
        configuration: {
          ...getRecommendedConfiguration('vr'),
          nativeAlpha: true,
        },
        language: 'ts',
        packageSource: { getPackageInstallSpec: () => '9.9.9' },
        templateRoot: path.join(PACKAGE_ROOT, 'dist', 'template'),
      });
    // A plain Vite app gets the manifest with its native section, and the ignore entry.
    const fresh = await existingProject(VITE_APP);
    const freshReport = await adoptExistingProject({
      outDir: fresh,
      files: await nativeFiles(),
      guidanceRoot: GUIDANCE_ROOT,
      language: 'ts',
    });
    expect(freshReport.gitignoreAdded).toContain('dist-metavr/');
    const written = JSON.parse(
      await readFile(path.join(fresh, 'iwsdk.config.json'), 'utf8'),
    );
    expect(written.native.packageId).toBe('com.example.starter');
    expect(freshReport.manualSteps.join('\n')).not.toContain(
      'native build target',
    );

    // An IWSDK project keeps its own manifest, so the native section becomes a step.
    const existing = await existingProject(VITE_APP);
    await adopt(existing);
    const report = await adoptExistingProject({
      outDir: existing,
      files: await nativeFiles(),
      guidanceRoot: GUIDANCE_ROOT,
      language: 'ts',
    });
    expect(report.kept).toContain('iwsdk.config.json');
    expect(report.gitignoreAdded).toEqual(['dist-metavr/']);
    const step = report.manualSteps.find((line) =>
      line.includes('native build target'),
    );
    expect(step).toContain('"packageId":"com.example.starter"');
    const pkg = JSON.parse(
      await readFile(path.join(existing, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts['build:metavr']).toContain('iwer-native pack');
  });

  it('is idempotent', async () => {
    const root = await existingProject(VITE_APP);
    await adopt(root);
    const before = await snapshot(root);
    const again = await adopt(root);
    expect(again.created).toEqual([]);
    expect(again.packageJson.added).toEqual([]);
    expect(again.packageJson.changed).toEqual([]);
    expect(again.viteConfig.status).toBe('already-configured');
    expect(again.gitignoreAdded).toEqual([]);
    expect(again.guidance.changed).toBe(false);
    expect(await snapshot(root)).toEqual(before);
  });

  it('creates a Vite config that Vite can load without "type": "module"', async () => {
    for (const [packageJson, language, configFile] of [
      // `npm init -y` writes "type": "commonjs".
      [{ name: 'npm-init', type: 'commonjs' }, 'js', 'vite.config.mjs'],
      [{ name: 'no-type', private: true }, 'ts', 'vite.config.mts'],
      [{ name: 'esm', type: 'module' }, 'ts', 'vite.config.ts'],
    ] as const) {
      const root = await existingProject({
        'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
      });
      const report = await adopt(root, language);
      const loaded = await loadViteConfig(root);
      expect(loaded.config.plugins, configFile).toEqual([
        { name: 'iwsdk-dev' },
      ]);
      expect(report.viteConfig, configFile).toEqual({
        file: configFile,
        status: 'created',
      });
      // A second run finds the config it wrote.
      expect((await adopt(root, language)).viteConfig.status).toBe(
        'already-configured',
      );
    }
  });

  it('leaves a Vite config that loads as CommonJS working and lists the rename', async () => {
    for (const [packageJson, file, config, renamed] of [
      [
        COMMONJS_PACKAGE,
        'vite.config.js',
        PLAIN_VITE_CONFIG,
        'vite.config.mjs',
      ],
      [
        COMMONJS_PACKAGE,
        'vite.config.ts',
        PLAIN_VITE_CONFIG,
        'vite.config.mts',
      ],
      // .cts and .cjs load as CommonJS whatever package.json says.
      [ESM_PACKAGE, 'vite.config.cts', PLAIN_VITE_CONFIG, 'vite.config.mts'],
      [
        ESM_PACKAGE,
        'vite.config.cjs',
        'module.exports = { plugins: [] }\n',
        'vite.config.mjs',
      ],
    ] as const) {
      const root = await existingProject({
        'package.json': packageJson,
        [file]: config,
      });
      const report = await adopt(root);
      expect((await loadViteConfig(root)).config.plugins, file).toEqual([]);
      expect(await readFile(path.join(root, file), 'utf8'), file).toBe(config);
      expect(report.viteConfig, file).toEqual({ file, status: 'manual' });
      const steps = report.manualSteps.join('\n');
      expect(steps).toContain(
        `Vite loads ${file} as CommonJS and the IWSDK plugin is ESM-only: rename it to ${renamed} (ES module syntax) and update what refers to ${file}, such as \`include\` in tsconfig.node.json or \`--config ${file}\` in package.json scripts. Add the IWSDK plugin to ${renamed}: `,
      );
      // The dedupe step names the file the plugin goes in.
      expect(steps).toContain(`packages in ${renamed} (`);
      expect(steps).not.toContain(`packages in ${file} (`);
    }
  });

  it('lists the rename for a CommonJS config that already imports the plugin', async () => {
    for (const [packageJson, file, config, renamed] of [
      // What 1.2.0-rc.0 left in every project without "type": "module".
      [
        COMMONJS_PACKAGE,
        'vite.config.ts',
        IWSDK_VITE_CONFIG,
        'vite.config.mts',
      ],
      [
        COMMONJS_PACKAGE,
        'vite.config.js',
        IWSDK_VITE_CONFIG,
        'vite.config.mjs',
      ],
      [ESM_PACKAGE, 'vite.config.cts', IWSDK_VITE_CONFIG, 'vite.config.mts'],
      [
        ESM_PACKAGE,
        'vite.config.cjs',
        "const { iwsdkDev } = require('@iwsdk/vite-plugin-dev')\nmodule.exports = { plugins: [iwsdkDev()] }\n",
        'vite.config.mjs',
      ],
    ] as const) {
      const root = await existingProject({
        'package.json': packageJson,
        [file]: config,
      });
      await expect(loadViteConfig(root), file).rejects.toThrow(/ESM only/u);
      const report = await adopt(root);
      expect(await readFile(path.join(root, file), 'utf8'), file).toBe(config);
      expect(report.viteConfig, file).toEqual({ file, status: 'manual' });
      const steps = report.manualSteps.join('\n');
      expect(steps).toContain(
        `Vite loads ${file} as CommonJS and the IWSDK plugin is ESM-only: rename it to ${renamed} (ES module syntax)`,
      );
      // The plugin is there already, and so is the dedupe if Create wrote it.
      expect(steps, file).not.toContain('Add the IWSDK plugin');
      expect(steps, file).not.toContain('dedupe');
    }

    // Renaming it as the step says is all it takes.
    const root = await existingProject({
      'package.json': COMMONJS_PACKAGE,
      'vite.config.ts': IWSDK_VITE_CONFIG,
    });
    await adopt(root);
    await rename(
      path.join(root, 'vite.config.ts'),
      path.join(root, 'vite.config.mts'),
    );
    expect((await loadViteConfig(root)).config.plugins).toEqual([
      { name: 'iwsdk-dev' },
    ]);
    expect((await adopt(root)).viteConfig).toEqual({
      file: 'vite.config.mts',
      status: 'already-configured',
    });
  });

  it('leaves a CommonJS config that imports the plugin dynamically alone', async () => {
    const config =
      "module.exports = async () => {\n  const { iwsdkDev } = await import('@iwsdk/vite-plugin-dev')\n  return { plugins: [iwsdkDev()] }\n}\n";
    const root = await existingProject({
      'package.json': COMMONJS_PACKAGE,
      'vite.config.js': config,
    });
    const report = await adopt(root);
    expect(report.viteConfig).toEqual({
      file: 'vite.config.js',
      status: 'already-configured',
    });
    expect((await loadViteConfig(root)).config.plugins).toEqual([
      { name: 'iwsdk-dev' },
    ]);
    expect(report.manualSteps.join('\n')).not.toContain('CommonJS');
  });

  it('still adds the plugin to a .mjs or .mts config in a CommonJS package', async () => {
    for (const file of ['vite.config.mjs', 'vite.config.mts']) {
      const root = await existingProject({
        'package.json': COMMONJS_PACKAGE,
        [file]: PLAIN_VITE_CONFIG,
      });
      const report = await adopt(root);
      expect(report.viteConfig, file).toEqual({ file, status: 'patched' });
      expect((await loadViteConfig(root)).config.plugins, file).toEqual([
        { name: 'iwsdk-dev' },
      ]);
      expect(report.manualSteps.join('\n'), file).not.toContain('CommonJS');
    }
  });

  it('names the config Vite loads when there are several, and edits none', async () => {
    // As when tsc emits vite.config.js next to vite.config.ts.
    const root = await existingProject({
      'package.json': ESM_PACKAGE,
      'vite.config.ts': PLAIN_VITE_CONFIG,
      'vite.config.js': PLAIN_VITE_CONFIG,
    });
    const report = await adopt(root);
    const loaded = await loadViteConfig(root);
    expect(report.viteConfig).toEqual({
      file: path.basename(loaded.path),
      status: 'manual',
    });
    expect(report.viteConfig.file).toBe('vite.config.js');
    for (const file of ['vite.config.js', 'vite.config.ts']) {
      expect(await readFile(path.join(root, file), 'utf8'), file).toBe(
        PLAIN_VITE_CONFIG,
      );
    }
    expect(report.manualSteps.join('\n')).toContain(
      'Vite loads vite.config.js and ignores vite.config.ts, so Create edited none of them. Add the IWSDK plugin to vite.config.js: ',
    );
    // The next tsc build would replace an edit to its output.
    expect(report.manualSteps.join('\n')).toContain(
      '`plugins` array. If vite.config.js is compiled from vite.config.ts, delete it and add the plugin to vite.config.ts instead.',
    );
  });

  it('points at the TypeScript config a compiled one comes from', async () => {
    for (const [packageJson, files, hint] of [
      [
        ESM_PACKAGE,
        ['vite.config.mjs', 'vite.config.mts'],
        'If vite.config.mjs is compiled from vite.config.mts, delete it and add the plugin to vite.config.mts instead.',
      ],
      // The TypeScript source loads as CommonJS too, so it needs the rename.
      [
        COMMONJS_PACKAGE,
        ['vite.config.js', 'vite.config.ts'],
        'If vite.config.js is compiled from vite.config.ts, delete it and make those changes to vite.config.ts instead, renaming it to vite.config.mts.',
      ],
      [
        ESM_PACKAGE,
        ['vite.config.cjs', 'vite.config.cts'],
        'If vite.config.cjs is compiled from vite.config.cts, delete it and make those changes to vite.config.cts instead, renaming it to vite.config.mts.',
      ],
      [
        COMMONJS_PACKAGE,
        ['vite.config.js', 'vite.config.ts', 'vite.config.mts'],
        'If vite.config.js is compiled from vite.config.ts, delete it and make those changes to vite.config.ts instead, merging it into vite.config.mts (which already exists).',
      ],
      // tsc compiles .mts to .mjs, not .js, and compiles nothing to a .ts.
      [ESM_PACKAGE, ['vite.config.js', 'vite.config.mts'], null],
      [ESM_PACKAGE, ['vite.config.ts', 'vite.config.mts'], null],
    ] as const) {
      const root = await existingProject({
        'package.json': packageJson,
        ...Object.fromEntries(
          files.map((file) => [
            file,
            file.endsWith('.cjs')
              ? 'module.exports = { plugins: [] }\n'
              : PLAIN_VITE_CONFIG,
          ]),
        ),
      });
      const report = await adopt(root);
      expect(report.viteConfig, files.join()).toEqual({
        file: files[0],
        status: 'manual',
      });
      const steps = report.manualSteps.join('\n');
      if (hint) {
        expect(steps).toContain(hint);
      } else {
        expect(steps, files.join()).not.toContain('compiled from');
      }
    }
  });

  it('lists a merge, not a rename, when the ES module config exists', async () => {
    for (const [file, config, existing] of [
      ['vite.config.ts', PLAIN_VITE_CONFIG, 'vite.config.mts'],
      ['vite.config.js', PLAIN_VITE_CONFIG, 'vite.config.mjs'],
      ['vite.config.ts', IWSDK_VITE_CONFIG, 'vite.config.mts'],
    ] as const) {
      const root = await existingProject({
        'package.json': COMMONJS_PACKAGE,
        [file]: config,
        [existing]: PLAIN_VITE_CONFIG,
      });
      const report = await adopt(root);
      expect(report.viteConfig, file).toEqual({ file, status: 'manual' });
      expect(await readFile(path.join(root, file), 'utf8'), file).toBe(config);
      expect(await readFile(path.join(root, existing), 'utf8'), existing).toBe(
        PLAIN_VITE_CONFIG,
      );
      const steps = report.manualSteps.join('\n');
      expect(steps).toContain(
        `Vite loads ${file} as CommonJS and the IWSDK plugin is ESM-only: merge it into ${existing} (which already exists) and delete ${file}, then update what refers to ${file}, such as \`include\` in tsconfig.node.json or \`--config ${file}\` in package.json scripts.`,
      );
      // Renaming onto the developer's config would overwrite it.
      expect(steps, file).not.toContain(`rename it to ${existing}`);
      expect(
        steps.includes(`Add the IWSDK plugin to ${existing}: `),
        file,
      ).toBe(config === PLAIN_VITE_CONFIG);
    }

    // Merged as the step says, the config loads with the plugin.
    const root = await existingProject({
      'package.json': COMMONJS_PACKAGE,
      'vite.config.ts': IWSDK_VITE_CONFIG,
      'vite.config.mts': PLAIN_VITE_CONFIG,
    });
    await adopt(root);
    await writeFile(path.join(root, 'vite.config.mts'), IWSDK_VITE_CONFIG);
    await rm(path.join(root, 'vite.config.ts'));
    expect((await loadViteConfig(root)).config.plugins).toEqual([
      { name: 'iwsdk-dev' },
    ]);
    expect((await adopt(root)).viteConfig).toEqual({
      file: 'vite.config.mts',
      status: 'already-configured',
    });
  });

  it('lists the floor that locomotion left on by an earlier run needs', async () => {
    // What 1.2.0-rc.0 wrote: locomotion on over an empty scene.
    const scene = {
      version: 'iwsdk.scene.v1',
      units: 'meters',
      resources: {},
      nodes: [],
    };
    const root = await existingProject({
      'package.json': ESM_PACKAGE,
      'iwsdk.config.json': `${JSON.stringify({
        version: 'iwsdk.project.v1',
        scene: './public/scenes/main.iwsdk.scene.json',
        world: {
          xr: { mode: 'vr', offer: 'always', features: {} },
          features: { locomotion: { useWorker: true }, grabbing: true },
        },
      })}\n`,
      'public/scenes/main.iwsdk.scene.json': JSON.stringify(scene),
    });
    const report = await adopt(root);
    expect(report.kept).toEqual(
      expect.arrayContaining([
        'iwsdk.config.json',
        'public/scenes/main.iwsdk.scene.json',
      ]),
    );
    expect(report.manualSteps.join('\n')).toContain(
      'Locomotion is on in iwsdk.config.json, but public/scenes/main.iwsdk.scene.json has no `LocomotionEnvironment`: add it to the floor the player walks on, or set `world.features.locomotion` to `false`.',
    );
    expect(report.locomotionOff).toBeNull();

    // A floor anywhere in the scene settles it, keyed with or without the
    // prefix that core strips from native scene component ids.
    for (const key of [
      'LocomotionEnvironment',
      'com.iwsdk.components.LocomotionEnvironment',
    ]) {
      await writeFile(
        path.join(root, 'public/scenes/main.iwsdk.scene.json'),
        JSON.stringify({
          ...scene,
          nodes: [
            {
              id: 'level',
              children: [{ id: 'floor', components: { [key]: {} } }],
            },
          ],
        }),
      );
      expect((await adopt(root)).manualSteps.join('\n'), key).not.toContain(
        'LocomotionEnvironment',
      );
    }
  });

  it('writes a JavaScript skeleton for --language js', async () => {
    const root = await existingProject({
      'package.json': '{ "name": "js-app" }\n',
    });
    const report = await adopt(root, 'js');
    expect(report.created).toEqual(
      expect.arrayContaining(['src/iwsdk/index.js', 'index.html']),
    );
    expect(report.created).not.toContain('src/iwsdk/iwsdk-env.d.ts');
    expect(await readFile(path.join(root, 'index.html'), 'utf8')).toContain(
      '/src/iwsdk/index.js',
    );
  });
});

describe('installing', () => {
  it('reports a package manager that is not installed instead of crashing', async () => {
    const root = await existingProject({ 'package.json': '{}' });
    await expect(
      installDependencies(root, 'definitely-not-a-package-manager' as never),
    ).rejects.toThrow('could not start');
  });
});

describe('create CLI in an existing project', () => {
  it('adopts instead of overwriting, even with --force', async () => {
    const root = await existingProject(VITE_APP);
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        path.join(PACKAGE_ROOT, 'dist', 'cli.js'),
        '.',
        '--yes',
        '--force',
        '--target',
        'vr',
        '--no-install',
      ],
      { cwd: root, env: { ...process.env, NO_COLOR: '1' } },
    );
    expect(stderr).toContain('--force is ignored for existing projects');
    expect(stdout).toContain('Added IWSDK to the existing project.');
    expect(stdout).toContain(
      'Dependencies were not installed. Run `npm install`',
    );
    expect(stdout).toContain('.claude/skills/iwsdk-dev/SKILL.md');
    expect(await readFile(path.join(root, 'index.html'), 'utf8')).toBe(
      VITE_APP['index.html'],
    );
    expect(existsSync(path.join(root, '.git'))).toBe(false);
  }, 60_000);

  it('writes a JavaScript skeleton into a JavaScript project by default', async () => {
    const root = await existingProject({
      'package.json':
        '{ "name": "js-app", "type": "module", "devDependencies": { "vite": "^7.1.0" } }\n',
      'index.html': '<script type="module" src="/main.js"></script>\n',
      'main.js': "console.log('hi')\n",
    });
    await execFileAsync(
      process.execPath,
      [
        path.join(PACKAGE_ROOT, 'dist', 'cli.js'),
        '.',
        '--yes',
        '--target',
        'vr',
        '--no-install',
      ],
      { cwd: root, env: { ...process.env, NO_COLOR: '1' } },
    );
    expect(existsSync(path.join(root, 'src/iwsdk/index.js'))).toBe(true);
    expect(existsSync(path.join(root, 'src/iwsdk/index.ts'))).toBe(false);
    expect(existsSync(path.join(root, 'tsconfig.json'))).toBe(false);
  }, 60_000);

  it('leaves locomotion off, since the empty scene has nothing to stand on', async () => {
    for (const target of ['vr', 'browser']) {
      const root = await existingProject({
        'package.json': '{ "name": "web-app" }\n',
      });
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          path.join(PACKAGE_ROOT, 'dist', 'cli.js'),
          '.',
          '--yes',
          '--target',
          target,
          '--no-install',
        ],
        { cwd: root, env: { ...process.env, NO_COLOR: '1' } },
      );
      const config = JSON.parse(
        await readFile(path.join(root, 'iwsdk.config.json'), 'utf8'),
      );
      expect(config.world.features.locomotion, target).toBe(false);
      expect(config.world.features.grabbing, target).toBe(true);
      expect(stdout).toContain('SDK features: Grabbing\n');
      expect(stdout).toContain(
        '  Locomotion: left off, because the new scene has no floor to stand on.',
      );
      expect(stdout).not.toContain('Locomotion is on');
      // Desktop 3D movement needs browserControls, which defaults to false.
      expect(stdout, target).toContain(
        target === 'browser'
          ? 'then set `world.features.locomotion` in iwsdk.config.json to `{ "browserControls": true }`: browser keyboard and gamepad controls are off by default.'
          : 'then enable `world.features.locomotion` in iwsdk.config.json.',
      );
    }
  }, 60_000);

  it('does not give the floor as the reason for --no-locomotion', async () => {
    for (const target of ['vr', 'browser']) {
      const root = await existingProject({
        'package.json': '{ "name": "web-app" }\n',
      });
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          path.join(PACKAGE_ROOT, 'dist', 'cli.js'),
          '.',
          '--yes',
          '--target',
          target,
          '--no-locomotion',
          '--no-install',
        ],
        { cwd: root, env: { ...process.env, NO_COLOR: '1' } },
      );
      const config = JSON.parse(
        await readFile(path.join(root, 'iwsdk.config.json'), 'utf8'),
      );
      expect(config.world.features.locomotion, target).toBe(false);
      expect(stdout, target).toContain(
        '  Locomotion: off. To turn it on, give your floor a `LocomotionEnvironment` component, then ',
      );
      expect(stdout, target).not.toContain('left off');
    }
  }, 60_000);

  it('still turns locomotion on for a new project', async () => {
    const workspace = await existingProject({});
    for (const target of ['vr', 'browser']) {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          path.join(PACKAGE_ROOT, 'dist', 'cli.js'),
          `${target}-app`,
          '--yes',
          '--target',
          target,
          '--no-install',
          '--no-git',
        ],
        { cwd: workspace, env: { ...process.env, NO_COLOR: '1' } },
      );
      const config = JSON.parse(
        await readFile(
          path.join(workspace, `${target}-app`, 'iwsdk.config.json'),
          'utf8',
        ),
      );
      expect(config.world.features.locomotion, target).toMatchObject({
        useWorker: true,
      });
      expect(stdout).toContain('SDK features: Locomotion, ');
      expect(stdout).not.toContain('Added IWSDK to the existing project.');
    }
  }, 60_000);

  it('reports what a 1.2.0-rc.0 adoption left broken when run again', async () => {
    const root = await existingProject({
      'package.json': COMMONJS_PACKAGE,
      'vite.config.ts': IWSDK_VITE_CONFIG,
      'iwsdk.config.json': `${JSON.stringify({
        version: 'iwsdk.project.v1',
        scene: './public/scenes/main.iwsdk.scene.json',
        world: {
          xr: { mode: 'vr', offer: 'always', features: {} },
          features: { locomotion: { useWorker: true } },
        },
      })}\n`,
      'public/scenes/main.iwsdk.scene.json':
        '{ "version": "iwsdk.scene.v1", "resources": {}, "nodes": [] }\n',
    });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        path.join(PACKAGE_ROOT, 'dist', 'cli.js'),
        '.',
        '--yes',
        '--target',
        'vr',
        '--no-install',
      ],
      { cwd: root, env: { ...process.env, NO_COLOR: '1' } },
    );
    expect(stdout).toContain(
      '  Vite config: left vite.config.ts unchanged; see "To finish"',
    );
    expect(stdout).toContain(
      '  - Vite loads vite.config.ts as CommonJS and the IWSDK plugin is ESM-only: rename it to vite.config.mts',
    );
    expect(stdout).toContain(
      '  - Locomotion is on in iwsdk.config.json, but public/scenes/main.iwsdk.scene.json has no `LocomotionEnvironment`',
    );
    expect(stdout).not.toContain('Locomotion: left off');
  }, 60_000);

  it('keeps --locomotion and lists the walkable floor it needs', async () => {
    const root = await existingProject({
      'package.json': '{ "name": "web-app" }\n',
    });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        path.join(PACKAGE_ROOT, 'dist', 'cli.js'),
        '.',
        '--yes',
        '--target',
        'vr',
        '--locomotion',
        '--no-install',
      ],
      { cwd: root, env: { ...process.env, NO_COLOR: '1' } },
    );
    const config = JSON.parse(
      await readFile(path.join(root, 'iwsdk.config.json'), 'utf8'),
    );
    expect(config.world.features.locomotion).toEqual({ useWorker: true });
    expect(stdout).toContain(
      'Locomotion is on in iwsdk.config.json, but public/scenes/main.iwsdk.scene.json has no `LocomotionEnvironment`: add it to the floor the player walks on',
    );
    expect(stdout).not.toContain('Locomotion: left off');
  }, 60_000);

  it('refuses --canary for an existing project before changing anything', async () => {
    const root = await existingProject(VITE_APP);
    const before = await snapshot(root);
    await expect(
      execFileAsync(
        process.execPath,
        [
          path.join(PACKAGE_ROOT, 'dist', 'cli.js'),
          '.',
          '--yes',
          '--canary',
          '--no-install',
        ],
        { cwd: root, env: { ...process.env, NO_COLOR: '1' } },
      ),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('--canary') });
    expect(await snapshot(root)).toEqual(before);
  }, 60_000);
});
