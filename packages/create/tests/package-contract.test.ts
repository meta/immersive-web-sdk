/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const DEV_FILES = [
  'SKILL.md',
  'references/api-reference.md',
  'references/iterate.md',
  'references/planner.md',
] as const;
const PORTABLE_SKILL_NAMES = [
  'iwsdk-build-model',
  'iwsdk-compose-scene',
  'iwsdk-debug',
  'iwsdk-depth-occlusion',
  'iwsdk-glasses-test',
  'iwsdk-grab',
  'iwsdk-physics',
  'iwsdk-dev',
  'iwsdk-ray',
  'iwsdk-ui',
] as const;

describe('@iwsdk/create packed contract', () => {
  it('accepts publication after the immutable asset CDN migration', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as {
      files?: string[];
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.yaml).toBe('2.8.3');
    expect(packageJson.files).toContain('scripts/verify-release-ready.mjs');
    expect(packageJson.scripts?.prepublishOnly).toContain(
      'verify:release-ready',
    );
    await expect(
      execFileAsync(process.execPath, ['scripts/verify-release-ready.mjs'], {
        cwd: PACKAGE_ROOT,
      }),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining('@iwsdk/create release contract passed.'),
    });
  });

  it('keeps the documented npm package manifest parseable', async () => {
    const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const fence = String.fromCharCode(96).repeat(3);
    const sectionStart = readme.indexOf('npm reads the override from');
    const blockStart = readme.indexOf(fence + 'json\n', sectionStart);
    const jsonStart = blockStart + fence.length + 'json\n'.length;
    const jsonEnd = readme.indexOf('\n' + fence, jsonStart);

    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(blockStart).toBeGreaterThanOrEqual(0);
    expect(jsonEnd).toBeGreaterThan(jsonStart);
    expect(JSON.parse(readme.slice(jsonStart, jsonEnd))).toMatchObject({
      dependencies: {
        '@iwsdk/core': '^1.0.0',
        three: 'npm:super-three@0.185.0',
      },
      overrides: { three: 'npm:super-three@0.185.0' },
    });
  });

  it('ships common TS/JS templates, scenes, dotfile aliases, and guidance', async () => {
    const { stdout } = await execFileAsync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts'],
      { cwd: PACKAGE_ROOT, maxBuffer: 10 * 1024 * 1024 },
    );
    const [pack] = JSON.parse(stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = new Set(pack.files.map((file) => file.path));

    for (const required of [
      'dist/cli.js',
      'dist/template/common/src/index.ts',
      'dist/template/common-js/src/index.js',
      'dist/template/common/gitignore.template',
      'dist/template/common/nvmrc.template',
      'dist/template/common/public/audio/chime.mp3',
      'dist/template/common/public/ui/welcome.uikitml',
      'dist/template/common/public/ui/label-grab.uikitml',
      'dist/template/common/public/ui/label-select.uikitml',
      'dist/template/common/public/ui/label-spin.uikitml',
      'dist/template/common/src/scene-assets/studio.scene-asset.ts',
      'dist/template/common-js/src/scene-assets/studio.scene-asset.js',
      'dist/template/common/src/scene-assets/decor.scene-asset.ts',
      'dist/template/common-js/src/scene-assets/decor.scene-asset.js',
      'dist/template/scenes/ar.iwsdk.scene.json',
      'dist/template/scenes/immersive.iwsdk.scene.json',
      'dist/guidance/manifest.json',
      'dist/guidance/files/AGENTS.md',
      'dist/guidance/files/.agents/skills/iwsdk-debug/SKILL.md',
      'dist/guidance/files/.agents/skills/iwsdk-dev/SKILL.md',
      'dist/guidance/files/.agents/skills/iwsdk-dev/references/iterate.md',
      'dist/guidance/files/.agents/skills/iwsdk-dev/references/planner.md',
      'dist/guidance/files/.agents/skills/iwsdk-native-xr-test/SKILL.md',
      'dist/guidance/files/.agents/skills/iwsdk-glasses-test/SKILL.md',
      'dist/guidance/files/.agents/skills/iwsdk-ui/SKILL.md',
      'dist/guidance/files/CLAUDE.md',
      'dist/guidance/files/.claude/skills/iwsdk-native-xr-test/SKILL.md',
      'dist/guidance/files/.claude/skills/iwsdk-glasses-test/SKILL.md',
      'dist/guidance/files/.claude/rules/scene-json.md',
      'dist/guidance/files/.cursor/rules/scene-json.mdc',
      'dist/guidance/files/.github/instructions/scene-json.instructions.md',
      'dist/guidance/files/public/scenes/AGENTS.md',
      'scripts/verify-release-ready.mjs',
    ]) {
      expect(files, required).toContain(required);
    }
    expect([...files].some((file) => file.includes('iwsdk-planner'))).toBe(
      false,
    );
    expect([...files].some((file) => file.includes('iwsdk-iterate'))).toBe(
      false,
    );
    expect([...files].some((file) => file.includes('iwsdk-migrate-0-5'))).toBe(
      false,
    );
  }, 15_000);

  it.each(PORTABLE_SKILL_NAMES)(
    'derives the portable %s skill from the canonical Claude skill bytes',
    async (skillName) => {
      const [claudeSkill, codexSkill] = await Promise.all([
        readFile(
          path.join(
            PACKAGE_ROOT,
            'dist',
            'guidance',
            'files',
            '.claude',
            'skills',
            skillName,
            'SKILL.md',
          ),
        ),
        readFile(
          path.join(
            PACKAGE_ROOT,
            'dist',
            'guidance',
            'files',
            '.agents',
            'skills',
            skillName,
            'SKILL.md',
          ),
        ),
      ]);

      expect(codexSkill).toEqual(claudeSkill);
    },
  );

  it('keeps every portable skill file byte-identical to the canonical Claude tree', async () => {
    const claudeRoot = path.join(
      PACKAGE_ROOT,
      'dist',
      'guidance',
      'files',
      '.claude',
      'skills',
    );
    const portableRoot = path.join(
      PACKAGE_ROOT,
      'dist',
      'guidance',
      'files',
      '.agents',
      'skills',
    );
    const [claudeFiles, portableFiles] = await Promise.all([
      listRelativeFiles(claudeRoot),
      listRelativeFiles(portableRoot),
    ]);
    expect(portableFiles).toEqual(claudeFiles);
    for (const relativePath of claudeFiles) {
      const [claudeFile, portableFile] = await Promise.all([
        readFile(path.join(claudeRoot, relativePath)),
        readFile(path.join(portableRoot, relativePath)),
      ]);
      expect(portableFile, relativePath).toEqual(claudeFile);
    }
  });

  it('keeps root instructions below the Codex limit and emits native scoped rules', async () => {
    const agents = await readFile(
      path.join(PACKAGE_ROOT, 'dist', 'guidance', 'files', 'AGENTS.md'),
      'utf8',
    );
    expect(Buffer.byteLength(agents)).toBeLessThan(32 * 1024);
    expect(agents).toContain('browser_not_launched');
    expect(agents).toContain('npx @iwsdk/cli scene flatten');

    const cursorRule = await readFile(
      path.join(
        PACKAGE_ROOT,
        'dist',
        'guidance',
        'files',
        '.cursor',
        'rules',
        'scene-json.mdc',
      ),
      'utf8',
    );
    const copilotRule = await readFile(
      path.join(
        PACKAGE_ROOT,
        'dist',
        'guidance',
        'files',
        '.github',
        'instructions',
        'scene-json.instructions.md',
      ),
      'utf8',
    );
    const cursorEcsRule = await readFile(
      path.join(
        PACKAGE_ROOT,
        'dist',
        'guidance',
        'files',
        '.cursor',
        'rules',
        'ecs-api.mdc',
      ),
      'utf8',
    );
    expect(cursorRule).toContain('globs:');
    expect(cursorRule).toContain('public/scenes/**');
    expect(cursorEcsRule).toContain('src/**/*.ts');
    expect(cursorEcsRule).toContain('src/**/*.js');
    expect(copilotRule).toContain('applyTo: "public/scenes/**"');
  });

  it.each(DEV_FILES)(
    'keeps repository and starter development guidance synchronized: %s',
    async (relativePath) => {
      const [repositoryCopy, starterCopy] = await Promise.all([
        readFile(
          path.join(REPO_ROOT, '.claude', 'skills', 'iwsdk-dev', relativePath),
          'utf8',
        ),
        readFile(
          path.join(
            REPO_ROOT,
            'packages',
            'core',
            'agent-guidance',
            'claude',
            '.claude',
            'skills',
            'iwsdk-dev',
            relativePath,
          ),
          'utf8',
        ),
      ]);

      expect(repositoryCopy.trimEnd()).toBe(starterCopy.trimEnd());
    },
  );
});

async function listRelativeFiles(
  root: string,
  relative = '',
): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(root, child)));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}
