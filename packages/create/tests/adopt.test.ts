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
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { blankNonCode, patchViteConfig } from '../src/vite-config-patch.js';

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
