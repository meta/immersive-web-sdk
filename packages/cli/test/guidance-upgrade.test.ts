/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
  loadGuidanceSource,
  syncAgentGuidance,
  type GuidanceSource,
} from '../src/agent-guidance.js';
import { RELEASED_PACKAGES, handleUpgrade } from '../src/commands/upgrade.js';
import {
  readLockedCoreVersion,
  refreshAgentGuidanceForDev,
} from '../src/guidance-refresh.js';
import {
  MIGRATION_GUIDES,
  materializeMigrations,
  migrationsBetween,
} from '../src/migrations.js';
import { findPackageManager } from '../src/package-manager.js';
import { releaseNotesBetween, type ReleaseNote } from '../src/release-notes.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(TEST_DIR, '..', 'dist', 'cli.js');
const CORE_ROOT = path.resolve(TEST_DIR, '..', '..', 'core');
const DOCS_SKILLS = path.resolve(
  TEST_DIR,
  '..',
  '..',
  '..',
  'docs',
  'public',
  'skills',
);
const tempDirs: string[] = [];
let shared = 0;
let v1: GuidanceSource;
let v2: GuidanceSource;

async function tempDir(prefix: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

/** Render @iwsdk/core's guidance as `version`, with an optional skill edit. */
async function render(version: string, extraLine?: string) {
  const fakeCore = await tempDir('iwsdk-upgrade-core-');
  await cp(path.join(CORE_ROOT, 'scripts'), path.join(fakeCore, 'scripts'), {
    recursive: true,
  });
  await cp(
    path.join(CORE_ROOT, 'agent-guidance'),
    path.join(fakeCore, 'agent-guidance'),
    { recursive: true },
  );
  if (extraLine) {
    const skill = path.join(
      fakeCore,
      'agent-guidance/claude/.claude/skills/iwsdk-grab/SKILL.md',
    );
    await writeFile(skill, `${await readFile(skill, 'utf8')}\n${extraLine}\n`);
  }
  await writeFile(
    path.join(fakeCore, 'package.json'),
    JSON.stringify({ name: '@iwsdk/core', version }),
  );
  const output = path.join(fakeCore, 'dist', 'agent-guidance');
  execFileSync(process.execPath, [
    path.join(fakeCore, 'scripts', 'build-agent-guidance.mjs'),
    output,
  ]);
  return loadGuidanceSource(output);
}

/** A project whose node_modules holds @iwsdk/core at `version`. */
async function projectWithCore(
  version: string,
  guidance: GuidanceSource,
  packageJson: Record<string, unknown> = {},
) {
  const projectRoot = await tempDir('iwsdk-upgrade-project-');
  // A repository root, so package-manager lookup stops here.
  await mkdir(path.join(projectRoot, '.git'));
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'app',
      dependencies: { '@iwsdk/core': version },
      ...packageJson,
    }),
  );
  await installCore(projectRoot, version, guidance);
  return projectRoot;
}

async function installCore(
  projectRoot: string,
  version: string,
  guidance: GuidanceSource,
  three = 'npm:super-three@0.185.0',
) {
  const coreRoot = path.join(projectRoot, 'node_modules/@iwsdk/core');
  await rm(coreRoot, { recursive: true, force: true });
  await mkdir(coreRoot, { recursive: true });
  await writeFile(
    path.join(coreRoot, 'package.json'),
    JSON.stringify({
      name: '@iwsdk/core',
      version,
      dependencies: { three },
      exports: { './package.json': './package.json' },
    }),
  );
  await cp(guidance.root, path.join(coreRoot, 'dist/agent-guidance'), {
    recursive: true,
  });
}

beforeAll(async () => {
  v1 = await render('9.0.0');
  v2 = await render('9.1.0', 'New in 9.1.');
  shared = tempDirs.length;
}, 60_000);

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(shared)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('refreshAgentGuidanceForDev', () => {
  test('does nothing when the guidance matches the installed core', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
  });

  test('refreshes unedited guidance after the core is upgraded', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const ui = path.join(projectRoot, '.claude/skills/iwsdk-ui/SKILL.md');
    await writeFile(ui, `${await readFile(ui, 'utf8')}\nTeam note.\n`);
    await installCore(projectRoot, '9.1.0', v2);

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(report?.action).toBe('refreshed');
    expect(report?.previousVersion).toBe('9.0.0');
    expect(report?.version).toBe('9.1.0');
    expect(report?.changed.map((entry) => entry.path).sort()).toEqual([
      '.agents/skills/iwsdk-grab',
      '.claude/skills/iwsdk-grab',
    ]);
    expect(report?.notice).toContain('from 9.0.0 to the installed IWSDK 9.1.0');
    expect(
      await readFile(
        path.join(projectRoot, '.claude/skills/iwsdk-grab/SKILL.md'),
        'utf8',
      ),
    ).toContain('New in 9.1.');
    // AGENTS.md did not change between the releases, so it keeps its stamp.
    expect(report?.changed.some((entry) => entry.path === 'AGENTS.md')).toBe(
      false,
    );
    expect(await readFile(ui, 'utf8')).toContain('Team note.');
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
  }, 30_000);

  test('refreshes only the coding tools the project already has guidance for', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1, tools: ['claude'] });
    await installCore(projectRoot, '9.1.0', v2);
    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(report?.action).toBe('refreshed');
    expect(report?.changed.map((entry) => entry.path)).toEqual([
      '.claude/skills/iwsdk-grab',
    ]);
    for (const absent of ['.agents', '.cursor', '.github', 'src']) {
      expect(existsSync(path.join(projectRoot, absent)), absent).toBe(false);
    }
  }, 30_000);

  test('keeps a codex-only project free of Cursor and Copilot files', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1, tools: ['codex'] });
    await installCore(projectRoot, '9.1.0', v2);
    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(report?.action).toBe('refreshed');
    expect(report?.changed.map((entry) => entry.path)).toEqual([
      '.agents/skills/iwsdk-grab',
    ]);
    for (const absent of ['.claude', '.cursor', '.github']) {
      expect(existsSync(path.join(projectRoot, absent)), absent).toBe(false);
    }
  }, 30_000);

  test('keeps Cursor-only and Copilot-only projects free of Codex files', async () => {
    for (const tool of ['cursor', 'copilot'] as const) {
      const projectRoot = await projectWithCore('9.0.0', v1);
      await syncAgentGuidance({ projectRoot, source: v1, tools: [tool] });
      await installCore(projectRoot, '9.1.0', v2);
      const report = await refreshAgentGuidanceForDev(projectRoot, {});
      expect(report?.action, tool).toBe('refreshed');
      for (const absent of ['.claude', 'public', 'src']) {
        expect(existsSync(path.join(projectRoot, absent)), absent).toBe(false);
      }
    }
  }, 30_000);

  test('dev up reports the refresh even when startup fails', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1, tools: ['claude'] });
    await installCore(projectRoot, '9.1.0', v2);
    await writeFile(path.join(projectRoot, 'vite.config.ts'), '');
    // No dev:runtime script, so startup throws after the refresh.
    const run = spawnSync(
      process.execPath,
      [CLI_PATH, 'dev', 'up', '--workspace', projectRoot],
      {
        encoding: 'utf8',
        env: { ...process.env, CI: '', IWSDK_AGENT_GUIDANCE: '' },
      },
    );
    expect(run.status).toBe(1);
    const failure = JSON.parse(run.stderr);
    expect(failure.ok).toBe(false);
    expect(failure.error.details.agentGuidance).toMatchObject({
      action: 'refreshed',
      version: '9.1.0',
    });
    expect(
      await readFile(
        path.join(projectRoot, '.claude/skills/iwsdk-grab/SKILL.md'),
        'utf8',
      ),
    ).toContain('New in 9.1.');
  }, 30_000);

  test('reads a monorepo lockfile at the workspace root', async () => {
    const workspace = await tempDir('iwsdk-monorepo-');
    await mkdir(path.join(workspace, '.git'));
    await writeFile(
      path.join(workspace, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n',
    );
    await writeFile(
      path.join(workspace, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\n  apps/xr:\n    dependencies:\n      '@iwsdk/core':\n        specifier: 9.0.0\n        version: 9.0.0(three@0.185.0)\n",
    );
    const app = path.join(workspace, 'apps/xr');
    await mkdir(app, { recursive: true });
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ dependencies: { '@iwsdk/core': '9.0.0' } }),
    );
    expect(readLockedCoreVersion(app)).toBe('9.0.0');
    await installCore(app, '9.0.0', v1);
    await syncAgentGuidance({ projectRoot: app, source: v1 });
    // node_modules moved on without an install: refuse to write.
    await installCore(app, '9.1.0', v2);
    const report = await refreshAgentGuidanceForDev(app, {});
    expect(report).toMatchObject({
      action: 'stale',
      reason: 'lockfile-mismatch',
    });
  }, 30_000);

  test('only reports in CI, in warn mode, and when node_modules disagrees with the lockfile', async () => {
    for (const setup of [
      { env: { CI: 'true' }, reason: 'ci' },
      { env: { IWSDK_AGENT_GUIDANCE: 'warn' }, reason: 'mode-warn' },
      { env: {}, reason: 'mode-warn', manifestMode: 'warn' },
      { env: {}, reason: 'lockfile-mismatch', lockedVersion: '9.0.0' },
    ] as const) {
      const projectRoot = await projectWithCore('9.0.0', v1);
      await syncAgentGuidance({ projectRoot, source: v1 });
      await installCore(projectRoot, '9.1.0', v2);
      if ('manifestMode' in setup) {
        await writeFile(
          path.join(projectRoot, 'iwsdk.config.json'),
          JSON.stringify({ dev: { agentGuidance: setup.manifestMode } }),
        );
      }
      if ('lockedVersion' in setup) {
        await writeFile(
          path.join(projectRoot, 'package-lock.json'),
          JSON.stringify({
            packages: {
              'node_modules/@iwsdk/core': { version: setup.lockedVersion },
            },
          }),
        );
      }
      const before = await readFile(
        path.join(projectRoot, '.claude/skills/iwsdk-grab/SKILL.md'),
        'utf8',
      );
      const report = await refreshAgentGuidanceForDev(projectRoot, setup.env);
      expect(report?.action, setup.reason).toBe('stale');
      expect(report?.reason).toBe(setup.reason);
      expect(
        await readFile(
          path.join(projectRoot, '.claude/skills/iwsdk-grab/SKILL.md'),
          'utf8',
        ),
      ).toBe(before);
    }
  }, 60_000);

  test('is silent when turned off, and never installs guidance on its own', async () => {
    const off = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot: off, source: v1 });
    await installCore(off, '9.1.0', v2);
    expect(
      await refreshAgentGuidanceForDev(off, { IWSDK_AGENT_GUIDANCE: 'off' }),
    ).toBeNull();

    const fresh = await projectWithCore('9.0.0', v1);
    const report = await refreshAgentGuidanceForDev(fresh, {});
    expect(report?.action).toBe('missing');
    expect(report?.notice).toContain('npx @iwsdk/cli@latest agents sync');
    expect(await readdir(fresh)).toEqual([
      '.git',
      'node_modules',
      'package.json',
    ]);
  });

  test('writes the migration guide when the refresh crosses a migration release', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const agentsPath = path.join(projectRoot, 'AGENTS.md');
    // Guidance written by a 0.4 release; the block's own hash still matches.
    await writeFile(
      agentsPath,
      (await readFile(agentsPath, 'utf8')).replace(
        'version=9.0.0',
        'version=0.4.2',
      ),
    );
    await installCore(projectRoot, '9.1.0', v2);
    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(report?.migrations.map((migration) => migration.id)).toEqual([
      'iwsdk-migrate-0-5',
    ]);
    expect(
      existsSync(
        path.join(projectRoot, '.iwsdk/migrations/iwsdk-migrate-0-5/SKILL.md'),
      ),
    ).toBe(true);
    expect(report?.notice).toContain(
      '.iwsdk/migrations/iwsdk-migrate-0-5/SKILL.md',
    );
    expect(await readFile(path.join(projectRoot, '.gitignore'), 'utf8')).toBe(
      '.iwsdk/\n',
    );
  }, 30_000);
});

describe('findPackageManager', () => {
  test('ignores the single-app pnpm-workspace.yaml that generated apps carry', async () => {
    const workspace = await tempDir('iwsdk-npm-workspace-');
    await mkdir(path.join(workspace, '.git'));
    await mkdir(path.join(workspace, 'apps/web'), { recursive: true });
    await writeFile(path.join(workspace, 'package-lock.json'), '{}');
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*'] }),
    );
    await writeFile(
      path.join(workspace, 'apps/web/pnpm-workspace.yaml'),
      "packages:\n  - '.'\n",
    );
    expect(findPackageManager(path.join(workspace, 'apps/web'))).toEqual({
      name: 'npm',
      root: workspace,
      lockfile: path.join(workspace, 'package-lock.json'),
    });

    // A stray lockfile above a project that is not in a workspace.
    const home = await tempDir('iwsdk-stray-lockfile-');
    await writeFile(path.join(home, 'package-lock.json'), '{}');
    await mkdir(path.join(home, 'app'));
    expect(findPackageManager(path.join(home, 'app'))).toMatchObject({
      name: 'npm',
      root: path.join(home, 'app'),
      lockfile: null,
    });
    // Nor does a packageManager field there.
    await writeFile(
      path.join(home, 'package.json'),
      JSON.stringify({ packageManager: 'yarn@4.0.0' }),
    );
    expect(findPackageManager(path.join(home, 'app'))).toMatchObject({
      name: 'npm',
    });

    const fresh = await tempDir('iwsdk-no-lockfile-');
    await mkdir(path.join(fresh, '.git'));
    await writeFile(
      path.join(fresh, 'pnpm-workspace.yaml'),
      "packages: ['.']\n",
    );
    expect(findPackageManager(fresh)).toEqual({
      name: 'npm',
      root: fresh,
      lockfile: null,
    });

    const pnpmWorkspace = await tempDir('iwsdk-pnpm-workspace-');
    await mkdir(path.join(pnpmWorkspace, '.git'));
    await mkdir(path.join(pnpmWorkspace, 'apps/web'), { recursive: true });
    await writeFile(
      path.join(pnpmWorkspace, 'pnpm-workspace.yaml'),
      'packages:\n  # apps\n  - apps/*\n',
    );
    expect(findPackageManager(path.join(pnpmWorkspace, 'apps/web'))).toEqual({
      name: 'pnpm',
      root: pnpmWorkspace,
      lockfile: null,
    });
  });
});

describe('lockfile versions', () => {
  test('reads @iwsdk/core from npm, pnpm and yarn lockfiles', async () => {
    const npm = await tempDir('iwsdk-lock-');
    await writeFile(
      path.join(npm, 'package-lock.json'),
      JSON.stringify({
        packages: { 'node_modules/@iwsdk/core': { version: '1.2.3' } },
      }),
    );
    expect(readLockedCoreVersion(npm)).toBe('1.2.3');

    const pnpm = await tempDir('iwsdk-lock-');
    await writeFile(
      path.join(pnpm, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      '@iwsdk/core':\n        specifier: 1.2.3\n        version: 1.2.3(three@0.185.0)\n",
    );
    expect(readLockedCoreVersion(pnpm)).toBe('1.2.3');

    const yarn = await tempDir('iwsdk-lock-');
    await writeFile(
      path.join(yarn, 'yarn.lock'),
      '"@iwsdk/core@1.2.3":\n  version "1.2.3"\n',
    );
    expect(readLockedCoreVersion(yarn)).toBe('1.2.3');

    expect(readLockedCoreVersion(await tempDir('iwsdk-lock-'))).toBeNull();
  });
});

describe('release notes', () => {
  const notes: ReleaseNote[] = [
    { version: '1.1.0', kind: 'minor', packages: ['@iwsdk/core'], text: 'B' },
    { version: '1.0.0', kind: 'major', packages: ['@iwsdk/core'], text: 'A' },
    {
      version: '1.1.0-rc.1',
      kind: 'patch',
      packages: ['@iwsdk/cli'],
      text: 'R',
    },
    { version: '1.2.0', kind: 'patch', packages: ['@iwsdk/cli'], text: 'C' },
  ];

  test('lists the entries after the old version up to the new one, oldest first', () => {
    expect(
      releaseNotesBetween('0.5.3', '1.1.0', notes).map((note) => note.text),
    ).toEqual(['A', 'R', 'B']);
    expect(
      releaseNotesBetween('1.1.0-rc.1', '1.1.0', notes).map(
        (note) => note.text,
      ),
    ).toEqual(['B']);
    expect(releaseNotesBetween(null, '1.1.0', notes)).toEqual([]);
    // A stable release that repeats its prerelease's entry lists it once.
    expect(
      releaseNotesBetween('1.0.0', '1.1.0', [
        ...notes,
        {
          version: '1.1.0',
          kind: 'patch',
          packages: ['@iwsdk/cli'],
          text: 'R',
        },
      ]).map((note) => note.text),
    ).toEqual(['R', 'B']);
    expect(releaseNotesBetween('1.2.0', '1.2.0', notes)).toEqual([]);
  });

  test('the build collects every release-group changelog without dependency noise', async () => {
    const built = path.resolve(TEST_DIR, '..', 'dist', 'release-notes.json');
    if (!existsSync(built)) {
      return; // `npm test` builds first.
    }
    const { entries } = JSON.parse(await readFile(built, 'utf8')) as {
      entries: ReleaseNote[];
    };
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.some((entry) => entry.kind === 'major')).toBe(true);
    for (const entry of entries) {
      expect(entry.text).not.toMatch(/^Updated dependencies/u);
      expect(entry.text).not.toMatch(/^@iwsdk\/[\w-]+@\S+$/u);
      expect(entry.text).not.toMatch(/^[0-9a-f]{7,40}: /u);
      expect(entry.text).not.toMatch(/^\s*- @iwsdk\/[\w-]+@\S+\s*$/mu);
    }
  });
});

describe('migrations', () => {
  test('lists the guides for each crossed release, oldest first', () => {
    expect(
      migrationsBetween('0.4.2', '1.1.0').map((guide) => guide.id),
    ).toEqual(['iwsdk-migrate-0-5']);
    expect(migrationsBetween('0.5.0', '1.1.0')).toEqual([]);
    expect(migrationsBetween('0.4.2', '0.4.9')).toEqual([]);
    expect(migrationsBetween('0.4.2', '1.1.0-rc.1')).toHaveLength(1);
    expect(migrationsBetween(null, '1.1.0')).toEqual([]);
  });

  test('every listed guide is published on iwsdk.dev and ships with the CLI', async () => {
    const published = (await readdir(DOCS_SKILLS)).filter((name) =>
      name.startsWith('iwsdk-migrate-'),
    );
    expect(MIGRATION_GUIDES.map((guide) => guide.id).sort()).toEqual(
      published.sort(),
    );
    const built = path.resolve(TEST_DIR, '..', 'dist', 'migrations');
    if (existsSync(built)) {
      expect((await readdir(built)).sort()).toEqual(published.sort());
    }
  });

  test('keeps an existing .iwsdk ignore rule', async () => {
    const projectRoot = await tempDir('iwsdk-migrations-');
    await writeFile(path.join(projectRoot, '.gitignore'), 'dist/\n.iwsdk/\n');
    if (!existsSync(path.resolve(TEST_DIR, '..', 'dist', 'migrations'))) {
      return; // `npm test` builds first.
    }
    await materializeMigrations(projectRoot, MIGRATION_GUIDES);
    expect(await readFile(path.join(projectRoot, '.gitignore'), 'utf8')).toBe(
      'dist/\n.iwsdk/\n',
    );
  });
});

describe('iwsdk upgrade', () => {
  const io = (cwd: string) => {
    const stderr: string[] = [];
    return {
      stderr,
      io: {
        cwd,
        stdout: process.stdout,
        stderr: {
          write: (chunk: string) => {
            stderr.push(chunk);
            return true;
          },
        } as unknown as NodeJS.WritableStream,
      },
    };
  };

  test('a dry run reports the plan and writes nothing', async () => {
    const projectRoot = await projectWithCore('0.4.2', v1, {
      devDependencies: {
        '@iwsdk/cli': '0.4.2',
        '@iwsdk/vite-plugin-dev': '0.4.2',
      },
    });
    const before = await readFile(
      path.join(projectRoot, 'package.json'),
      'utf8',
    );
    const { io: context } = io(projectRoot);
    const result = await handleUpgrade({ dryRun: true, to: '9.1.0' }, context);
    expect(result.data.from).toBe('0.4.2');
    expect(result.data.packages.map((bump) => bump.name).sort()).toEqual([
      '@iwsdk/cli',
      '@iwsdk/core',
      '@iwsdk/vite-plugin-dev',
    ]);
    expect(result.data.migrations).toEqual([
      { id: 'iwsdk-migrate-0-5', introducedIn: '0.5.0' },
    ]);
    expect(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).toBe(
      before,
    );
  });

  test('installs, aligns three, refreshes guidance, and writes migration guides', async () => {
    const projectRoot = await projectWithCore('0.4.2', v1, {
      packageManager: 'pnpm@10.0.0',
      dependencies: {
        '@iwsdk/core': '0.4.2',
        three: 'npm:super-three@0.170.0',
      },
      devDependencies: { '@types/three': '^0.170.0' },
      overrides: { three: 'npm:super-three@0.170.0' },
    });
    await syncAgentGuidance({ projectRoot, source: v1 });
    // pnpm's layout: node_modules/@iwsdk/core links into a versioned store
    // folder, and an install re-points the link and keeps the old folder.
    const linked = path.join(projectRoot, 'node_modules/@iwsdk/core');
    const oldStore = path.join(
      projectRoot,
      'node_modules/.pnpm/core@0.4.2/node_modules/@iwsdk/core',
    );
    await mkdir(path.dirname(oldStore), { recursive: true });
    await rename(linked, oldStore);
    await symlink(oldStore, linked);
    // A stand-in package manager: "installs" the version package.json asks
    // for, from guidance rendered for 9.1.0.
    const bin = await tempDir('iwsdk-fakepm-');
    const fakepm = path.join(bin, 'pnpm');
    await writeFile(
      fakepm,
      `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.dependencies['@iwsdk/core'];
const link = path.join('node_modules', '@iwsdk', 'core');
const core = path.resolve('node_modules', '.pnpm', 'core@' + version, 'node_modules', '@iwsdk', 'core');
fs.rmSync(core, { recursive: true, force: true });
fs.mkdirSync(core, { recursive: true });
// unlink, not rmSync: Node 24.10's rmSync follows a link to a directory (EISDIR).
try { fs.unlinkSync(link); } catch {}
fs.symlinkSync(core, link);
fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: '@iwsdk/core', version: pkg.dependencies['@iwsdk/core'], dependencies: { three: 'npm:super-three@0.186.0', '@types/three': '^0.186.0' }, exports: { './package.json': './package.json' } }));
fs.cpSync(process.env.FAKE_GUIDANCE, path.join(core, 'dist', 'agent-guidance'), { recursive: true });
fs.appendFileSync('installs.log', 'install\\n');
`,
    );
    await chmod(fakepm, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    process.env.FAKE_GUIDANCE = v2.root;
    try {
      const { io: context, stderr } = io(projectRoot);
      const result = await handleUpgrade({ to: '9.1.0' }, context);
      const packageJson = JSON.parse(
        await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
      );
      expect(packageJson.dependencies['@iwsdk/core']).toBe('9.1.0');
      expect(packageJson.dependencies.three).toBe('npm:super-three@0.186.0');
      expect(packageJson.overrides.three).toBe('npm:super-three@0.186.0');
      // Typings follow core's, or tsc sees two Three.js type trees.
      expect(packageJson.devDependencies['@types/three']).toBe('^0.186.0');
      expect(
        (await readFile(path.join(projectRoot, 'installs.log'), 'utf8'))
          .trim()
          .split('\n'),
      ).toHaveLength(2);
      expect(result.data.guidance).toMatchObject({
        status: 'synced',
        version: '9.1.0',
      });
      expect(
        await readFile(
          path.join(projectRoot, '.claude/skills/iwsdk-grab/SKILL.md'),
          'utf8',
        ),
      ).toContain('New in 9.1.');
      expect(result.data.migrations[0].path).toBe(
        '.iwsdk/migrations/iwsdk-migrate-0-5/SKILL.md',
      );
      const notice = stderr.join('');
      expect(notice).toContain('Upgraded 0.4.2 -> 9.1.0');
      expect(notice).toContain('.iwsdk/migrations/iwsdk-migrate-0-5/SKILL.md');
      expect(notice).toContain('.claude/skills/iwsdk-dev/SKILL.md');
      if (
        existsSync(path.resolve(TEST_DIR, '..', 'dist', 'release-notes.json'))
      ) {
        expect(result.data.releaseNotes.path).toBe(
          '.iwsdk/migrations/release-notes.md',
        );
        const notes = await readFile(
          path.join(projectRoot, '.iwsdk/migrations/release-notes.md'),
          'utf8',
        );
        expect(notes).toMatch(/^# IWSDK release notes: 0\.4\.2 -> 9\.1\.0/u);
        expect(notes).toContain('## 1.0.0');
        expect(notes).not.toContain('## 0.4.2\n');
        expect(notice).toContain('.iwsdk/migrations/release-notes.md');
      }
    } finally {
      process.env.PATH = previousPath;
      delete process.env.FAKE_GUIDANCE;
    }
  }, 60_000);

  test('leaves retired packages alone and points at the migration guide', async () => {
    const projectRoot = await projectWithCore('0.4.2', v1, {
      devDependencies: {
        '@iwsdk/vite-plugin-dev': '^0.4.2',
        '@iwsdk/vite-plugin-gltf-optimizer': '^0.4.2',
      },
    });
    const result = await handleUpgrade(
      { to: '9.1.0', noInstall: true },
      io(projectRoot).io,
    );
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    );
    expect(packageJson.devDependencies).toEqual({
      '@iwsdk/vite-plugin-dev': '^9.1.0',
      '@iwsdk/vite-plugin-gltf-optimizer': '^0.4.2',
    });
    expect(result.data.manualSteps[0]).toContain(
      '@iwsdk/vite-plugin-gltf-optimizer@^0.4.2 is not part of the IWSDK release',
    );
    expect(result.data.migrations[0].path).toBe(
      '.iwsdk/migrations/iwsdk-migrate-0-5/SKILL.md',
    );
  });

  test('a failed install still leaves the migration guide and names it', async () => {
    const projectRoot = await projectWithCore('0.4.2', v1, {
      packageManager: 'pnpm@10.0.0',
    });
    const bin = await tempDir('iwsdk-failpm-');
    await writeFile(
      path.join(bin, 'pnpm'),
      `#!${process.execPath}\nconsole.error('ERESOLVE could not resolve');\nprocess.exit(1);\n`,
    );
    await chmod(path.join(bin, 'pnpm'), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    try {
      await expect(
        handleUpgrade({ to: '9.1.0' }, io(projectRoot).io),
      ).rejects.toThrow('.iwsdk/migrations/iwsdk-migrate-0-5/SKILL.md');
    } finally {
      process.env.PATH = previousPath;
    }
    expect(
      existsSync(
        path.join(projectRoot, '.iwsdk/migrations/iwsdk-migrate-0-5/SKILL.md'),
      ),
    ).toBe(true);
  });

  test('lists iwsdk.config.json settings the new release rejects', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1, {
      packageManager: 'pnpm@10.0.0',
    });
    await writeFile(
      path.join(projectRoot, 'iwsdk.config.json'),
      JSON.stringify({ world: { render: { fov: 'wide' } } }),
    );
    // A stand-in package manager that installs a core whose project
    // validator rejects a string fov, like a release that changed a setting.
    const bin = await tempDir('iwsdk-validpm-');
    await writeFile(
      path.join(bin, 'pnpm'),
      `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const core = path.join('node_modules', '@iwsdk', 'core');
fs.mkdirSync(path.join(core, 'dist', 'project'), { recursive: true });
fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: '@iwsdk/core', version: '9.1.0', exports: { './package.json': './package.json', './project': { import: './dist/project/index.js' } } }));
fs.writeFileSync(path.join(core, 'dist', 'project', 'index.js'), "export function validateIwsdkProjectManifest(value) { return { valid: false, issues: typeof value.world.render.fov === 'number' ? [] : [{ path: '$.world.render.fov', code: 'type', message: 'expected a finite number' }] }; }\\n");
fs.cpSync(process.env.FAKE_GUIDANCE, path.join(core, 'dist', 'agent-guidance'), { recursive: true });
`,
    );
    await chmod(path.join(bin, 'pnpm'), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    process.env.FAKE_GUIDANCE = v2.root;
    try {
      const result = await handleUpgrade({ to: '9.1.0' }, io(projectRoot).io);
      expect(result.data.configIssues).toEqual([
        { path: '$.world.render.fov', message: 'expected a finite number' },
      ]);
      expect(result.data.manualSteps.join('\n')).toContain(
        'iwsdk.config.json does not validate against IWSDK 9.1.0: $.world.render.fov expected a finite number',
      );
    } finally {
      process.env.PATH = previousPath;
      delete process.env.FAKE_GUIDANCE;
    }
  }, 60_000);

  test('keeps the developer’s specs and formatting, and writes nothing when nothing changes', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    const raw =
      '{\n\t"name": "app",\n\t"dependencies": {\n\t\t"@iwsdk/core": "^9.0.0",\n\t\t"@iwsdk/cli": "workspace:*",\n\t\t"@iwsdk/example-assets": "^0.4.2"\n\t}\n}\n';
    await writeFile(path.join(projectRoot, 'package.json'), raw);
    const result = await handleUpgrade(
      { to: '9.1.0', noInstall: true },
      io(projectRoot).io,
    );
    const text = await readFile(path.join(projectRoot, 'package.json'), 'utf8');
    expect(text).toBe(raw.replace('"^9.0.0"', '"^9.1.0"'));
    expect(result.data.manualSteps.join('\n')).toContain(
      'Left @iwsdk/cli@workspace:* as declared',
    );
    expect(result.data.manualSteps.join('\n')).toContain(
      '@iwsdk/example-assets@^0.4.2 is not part of the IWSDK release',
    );
    expect(result.data.manualSteps.join('\n')).not.toContain('retired');

    const current = await projectWithCore('9.1.0', v2, {
      dependencies: { '@iwsdk/core': '9.1.0' },
    });
    const before = await readFile(path.join(current, 'package.json'), 'utf8');
    const same = await handleUpgrade(
      { to: '9.1.0', noInstall: true },
      io(current).io,
    );
    expect(same.data.packages).toEqual([]);
    expect(await readFile(path.join(current, 'package.json'), 'utf8')).toBe(
      before,
    );
  });

  test('refreshes only existing guidance, and never adds it to a project without any', async () => {
    const bin = await tempDir('iwsdk-quietpm-');
    await writeFile(
      path.join(bin, 'pnpm'),
      `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const core = path.join('node_modules', '@iwsdk', 'core');
fs.rmSync(core, { recursive: true, force: true });
fs.mkdirSync(core, { recursive: true });
fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: '@iwsdk/core', version: '9.1.0', exports: { './package.json': './package.json' } }));
fs.cpSync(process.env.FAKE_GUIDANCE, path.join(core, 'dist', 'agent-guidance'), { recursive: true });
`,
    );
    await chmod(path.join(bin, 'pnpm'), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    process.env.FAKE_GUIDANCE = v2.root;
    try {
      const claudeOnly = await projectWithCore('9.0.0', v1, {
        packageManager: 'pnpm@10.0.0',
      });
      await syncAgentGuidance({
        projectRoot: claudeOnly,
        source: v1,
        tools: ['claude'],
      });
      const claude = await handleUpgrade({ to: '9.1.0' }, io(claudeOnly).io);
      expect(claude.data.guidance).toMatchObject({ status: 'synced' });
      for (const absent of ['.agents', '.cursor', '.github']) {
        expect(existsSync(path.join(claudeOnly, absent)), absent).toBe(false);
      }

      const bare = await projectWithCore('9.0.0', v1, {
        packageManager: 'pnpm@10.0.0',
      });
      const none = await handleUpgrade({ to: '9.1.0' }, io(bare).io);
      expect(none.data.guidance).toMatchObject({ status: 'none' });
      expect(existsSync(path.join(bare, 'AGENTS.md'))).toBe(false);
    } finally {
      process.env.PATH = previousPath;
      delete process.env.FAKE_GUIDANCE;
    }
  }, 60_000);

  test('a dry run with an explicit false value still upgrades nothing it should not', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    const before = await readFile(
      path.join(projectRoot, 'package.json'),
      'utf8',
    );
    const result = await handleUpgrade(
      { to: '9.1.0', dryRun: 'yes' },
      io(projectRoot).io,
    );
    expect(result.data.dryRun).toBe(true);
    expect(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).toBe(
      before,
    );
  });

  test('releases the same packages as the changeset fixed group', async () => {
    const config = JSON.parse(
      await readFile(
        path.resolve(TEST_DIR, '..', '..', '..', '.changeset', 'config.json'),
        'utf8',
      ),
    );
    expect([...RELEASED_PACKAGES].sort()).toEqual([...config.fixed[0]].sort());
  });

  test('refuses projects without IWSDK and targets older than the project', async () => {
    const plain = await tempDir('iwsdk-upgrade-plain-');
    await writeFile(path.join(plain, 'package.json'), '{"name":"plain"}');
    await expect(handleUpgrade({}, io(plain).io)).rejects.toThrow(
      '@iwsdk/create@latest',
    );
    const newer = await projectWithCore('9.1.0', v2);
    await expect(handleUpgrade({ to: '9.0.0' }, io(newer).io)).rejects.toThrow(
      'newer than 9.0.0',
    );
  });
});
