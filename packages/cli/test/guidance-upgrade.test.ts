/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFileSync, spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, realpathSync } from 'fs';
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
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
  directoryUnitHash,
  fileUnitHash,
  loadGuidanceSource,
  syncAgentGuidance,
  type GuidanceSource,
  type GuidanceUnitResult,
} from '../src/agent-guidance.js';
import type { CliOptions } from '../src/cli-types.js';
import {
  RELEASED_PACKAGES,
  checkRegistry,
  handleUpgrade,
} from '../src/commands/upgrade.js';
import {
  readLockedCoreVersion,
  refreshAgentGuidanceForDev,
} from '../src/guidance-refresh.js';
import {
  MIGRATION_GUIDES,
  materializeMigrations,
  migrationsBetween,
} from '../src/migrations.js';
import { findPackageManager, usesYarnBerry } from '../src/package-manager.js';
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

/**
 * Render @iwsdk/core's guidance as `version`, with an optional skill edit and
 * any other change to the guidance sources.
 */
async function render(
  version: string,
  extraLine?: string,
  edit?: (guidanceRoot: string) => Promise<void>,
) {
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
  await edit?.(path.join(fakeCore, 'agent-guidance'));
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

/** Every file in the project outside node_modules and .git, by content hash. */
async function projectFiles(
  projectRoot: string,
  relative = '',
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(path.join(projectRoot, relative), {
    withFileTypes: true,
  })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (child === 'node_modules' || child === '.git') {
      continue;
    }
    if (entry.isDirectory()) {
      Object.assign(files, await projectFiles(projectRoot, child));
    } else {
      files[child] = createHash('sha256')
        .update(await readFile(path.join(projectRoot, child)))
        .digest('hex')
        .slice(0, 12);
    }
  }
  return files;
}

const SKILL_ROOTS = ['.claude/skills', '.agents/skills'];
const GRAB_SKILLS = ['.agents/skills/iwsdk-grab', '.claude/skills/iwsdk-grab'];

function paths(entries: Array<{ path: string }> | undefined): string[] {
  return (entries ?? []).map((entry) => entry.path).sort();
}

/** Each entry as `action` or `action:reason`, by path. */
function actions(
  entries: GuidanceUnitResult[] | undefined,
): Record<string, string> {
  return Object.fromEntries(
    (entries ?? []).map((entry) => [
      entry.path,
      entry.reason ? `${entry.action}:${entry.reason}` : entry.action,
    ]),
  );
}

async function skillsIn(projectRoot: string, root: string): Promise<string[]> {
  return existsSync(path.join(projectRoot, root))
    ? (await readdir(path.join(projectRoot, root))).sort()
    : [];
}

async function allowedRules(projectRoot: string): Promise<string[]> {
  return JSON.parse(
    await readFile(path.join(projectRoot, '.claude/settings.json'), 'utf8'),
  ).permissions.allow.sort();
}

/** What `iwsdk adapter prune --tools claude` leaves: no skill permissions. */
async function removeSkillPermissions(projectRoot: string) {
  const settingsPath = path.join(projectRoot, '.claude/settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  settings.permissions.allow = settings.permissions.allow.filter(
    (rule: string) => !rule.startsWith('Skill('),
  );
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

/** `guidance`, as if releases before stamps had also written these units. */
async function withLegacy(
  guidance: GuidanceSource,
  legacy: Record<string, string[]>,
): Promise<GuidanceSource> {
  const root = await tempDir('iwsdk-upgrade-legacy-core-');
  await cp(guidance.root, root, { recursive: true });
  const merged = { ...guidance.manifest.legacy };
  for (const [unitPath, hashes] of Object.entries(legacy)) {
    merged[unitPath] = [...(merged[unitPath] ?? []), ...hashes];
  }
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({ ...guidance.manifest, legacy: merged }),
  );
  return loadGuidanceSource(root);
}

/**
 * Write guidance the way a release before stamps did, and return the hashes
 * that let IWSDK recognize it. Settings are merged, not hashed.
 */
async function writeLegacyGuidance(
  projectRoot: string,
  files: Record<string, string>,
): Promise<Record<string, string[]>> {
  const legacy: Record<string, string[]> = {};
  const skills = new Map<string, Map<string, string>>();
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
    const skill = relativePath.match(
      /^(\.(?:claude|agents)\/skills\/[^/]+)\/(.+)$/u,
    );
    if (skill) {
      const skillFiles = skills.get(skill[1]) ?? new Map<string, string>();
      skillFiles.set(skill[2], contents);
      skills.set(skill[1], skillFiles);
    } else if (!relativePath.endsWith('.json')) {
      legacy[relativePath] = [fileUnitHash(contents)];
    }
  }
  for (const [unitPath, skillFiles] of skills) {
    legacy[unitPath] = [directoryUnitHash(skillFiles)];
  }
  return legacy;
}

/** A skill folder in each of `roots`, as a release before stamps wrote it. */
function legacySkill(
  name: string,
  roots: string[] = SKILL_ROOTS,
): Record<string, string> {
  return Object.fromEntries(
    roots.flatMap((root) => [
      [
        `${root}/${name}/SKILL.md`,
        `---\nname: ${name}\ndescription: ${name} as an early release wrote it.\n---\n\nEarly ${name}.\n`,
      ],
      [`${root}/${name}/references/notes.md`, `Notes for ${name}.\n`],
    ]),
  );
}

function legacySettings(skills: string[]): string {
  return `${JSON.stringify(
    {
      permissions: {
        allow: [
          'mcp__iwsdk-runtime__browser_screenshot',
          ...skills.map((name) => `Skill(${name})`),
        ],
      },
      enableAllProjectMcpServers: true,
    },
    null,
    2,
  )}\n`;
}

async function renderedFile(guidance: GuidanceSource, unitPath: string) {
  return readFile(path.join(guidance.root, 'files', unitPath), 'utf8');
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

  test('leaves guidance the developer removed alone at the same release', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const settingsPath = path.join(projectRoot, '.claude/settings.json');
    expect(await readFile(settingsPath, 'utf8')).toContain('Skill(iwsdk-');
    for (const skills of SKILL_ROOTS) {
      expect(existsSync(path.join(projectRoot, skills, 'iwsdk-dev'))).toBe(
        true,
      );
      await rm(path.join(projectRoot, skills), { recursive: true });
    }
    await writeFile(settingsPath, '{}\n');

    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
    for (const skills of SKILL_ROOTS) {
      expect(existsSync(path.join(projectRoot, skills)), skills).toBe(false);
    }
    expect(await readFile(settingsPath, 'utf8')).toBe('{}\n');
  });

  test('keeps guidance removed after an upgrade that left the AGENTS.md block as it was', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    await installCore(projectRoot, '9.1.0', v2);
    expect((await refreshAgentGuidanceForDev(projectRoot, {}))?.action).toBe(
      'refreshed',
    );
    // 9.1.0 did not change the root block, so it still names 9.0.0.
    expect(
      await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8'),
    ).toContain('<!-- BEGIN iwsdk-agent-guidance version=9.0.0 ');
    const settingsPath = path.join(projectRoot, '.claude/settings.json');
    expect(await readFile(settingsPath, 'utf8')).toContain('Skill(iwsdk-');
    for (const skills of SKILL_ROOTS) {
      expect(existsSync(path.join(projectRoot, skills, 'iwsdk-dev'))).toBe(
        true,
      );
      await rm(path.join(projectRoot, skills), { recursive: true });
    }
    await writeFile(settingsPath, '{}\n');

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    for (const skills of SKILL_ROOTS) {
      expect(existsSync(path.join(projectRoot, skills)), skills).toBe(false);
    }
    expect(await readFile(settingsPath, 'utf8')).toBe('{}\n');
    expect(report).toBeNull();
  }, 30_000);

  test('leaves a replaced AGENTS.md and CLAUDE.md and deleted skills alone', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const lean = '# Lean guidance\n\nKeep changes small.\n';
    expect(
      await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8'),
    ).toContain('<!-- BEGIN iwsdk-agent-guidance');
    expect(
      await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8'),
    ).toContain('@AGENTS.md');
    await writeFile(path.join(projectRoot, 'AGENTS.md'), lean);
    await writeFile(path.join(projectRoot, 'CLAUDE.md'), lean);
    for (const skills of SKILL_ROOTS) {
      expect(existsSync(path.join(projectRoot, skills, 'iwsdk-dev'))).toBe(
        true,
      );
      await rm(path.join(projectRoot, skills), { recursive: true });
    }
    const before = await projectFiles(projectRoot);

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(await projectFiles(projectRoot)).toEqual(before);
    expect(report).toBeNull();
    // Nothing that is left changed in 9.1.0, so the upgrade adds nothing either.
    await installCore(projectRoot, '9.1.0', v2);
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
    expect(await projectFiles(projectRoot)).toEqual(before);
  }, 30_000);

  test('in a LEAN project, refreshes the rules it kept and leaves its own AGENTS.md and CLAUDE.md alone', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const lean = '# Lean guidance\n\nKeep changes small.\n';
    await writeFile(path.join(projectRoot, 'AGENTS.md'), lean);
    await writeFile(path.join(projectRoot, 'CLAUDE.md'), lean);
    for (const skills of SKILL_ROOTS) {
      await rm(path.join(projectRoot, skills), { recursive: true });
    }
    await removeSkillPermissions(projectRoot);
    const before = await projectFiles(projectRoot);
    // 9.2.0 changes the root block and the ECS rule.
    const v3 = await render('9.2.0', 'New in 9.1.', async (root) => {
      for (const file of [
        'common/AGENTS.md',
        'claude/.claude/rules/ecs-api.md',
      ]) {
        const filePath = path.join(root, file);
        await writeFile(
          filePath,
          `${await readFile(filePath, 'utf8')}\nChanged in 9.2.\n`,
        );
      }
    });
    await installCore(projectRoot, '9.2.0', v3);

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(report?.action).toBe('refreshed');
    // The ECS rule in every tool's form, and the nested block that carries it.
    const rule = [
      '.claude/rules/ecs-api.md',
      '.cursor/rules/ecs-api.mdc',
      '.github/instructions/ecs-api.instructions.md',
      'src/AGENTS.md',
    ];
    expect(paths(report?.changed)).toEqual(rule);
    const after = await projectFiles(projectRoot);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const file of Object.keys(before)) {
      expect(after[file] === before[file], file).toBe(!rule.includes(file));
    }
    expect(
      await readFile(path.join(projectRoot, 'src/AGENTS.md'), 'utf8'),
    ).toContain('Changed in 9.2.');
    expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe(
      lean,
    );
    expect(await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe(
      lean,
    );
    const skills = v3.manifest.units
      .filter((unit) => unit.kind === 'directory')
      .map((unit) => unit.path);
    expect(paths(report?.missing)).toEqual(
      [...skills, 'AGENTS.md', 'CLAUDE.md'].sort(),
    );
    expect(report?.notice).toContain(
      'AGENTS.md (no iwsdk-agent-guidance block)',
    );
    expect(report?.notice).toContain('CLAUDE.md (no @AGENTS.md import)');
    expect(report?.notice).toContain(
      'Agents: re-read the changed guidance before continuing.',
    );
    expect(report?.notice).not.toContain('block in AGENTS.md');
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
  }, 30_000);

  test('does not re-create a deleted AGENTS.md, before or after an upgrade', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const agentsPath = path.join(projectRoot, 'AGENTS.md');
    expect(await readFile(agentsPath, 'utf8')).toContain(
      '<!-- BEGIN iwsdk-agent-guidance',
    );
    await rm(agentsPath);

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(existsSync(agentsPath)).toBe(false);
    expect(report).toBeNull();

    await installCore(projectRoot, '9.1.0', v2);
    const upgraded = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(existsSync(agentsPath)).toBe(false);
    expect(upgraded?.action).toBe('refreshed');
    expect(paths(upgraded?.changed)).toEqual(GRAB_SKILLS);
    expect(paths(upgraded?.missing)).toEqual(['AGENTS.md']);
    expect(upgraded?.notice).toContain(
      'Not added: 1 part of the IWSDK 9.1.0 guidance that this project does not have (removed or replaced here, or new in this release): AGENTS.md. `npx @iwsdk/cli@latest agents sync` adds it.',
    );
    // There is no block to re-read.
    expect(upgraded?.notice).toContain(
      'Agents: re-read the changed guidance before continuing.',
    );
  }, 30_000);

  test('refreshes what is left after an upgrade and lists what was removed', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const settingsPath = path.join(projectRoot, '.claude/settings.json');
    const settings = await readFile(settingsPath, 'utf8');
    expect(settings).toContain('Skill(iwsdk-grab)');
    expect(
      existsSync(path.join(projectRoot, '.claude/skills/iwsdk-grab')),
    ).toBe(true);
    await rm(path.join(projectRoot, '.claude/skills'), { recursive: true });
    await installCore(projectRoot, '9.1.0', v2);

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(existsSync(path.join(projectRoot, '.claude/skills'))).toBe(false);
    expect(report?.action).toBe('refreshed');
    expect(paths(report?.changed)).toEqual(['.agents/skills/iwsdk-grab']);
    expect(
      await readFile(
        path.join(projectRoot, '.agents/skills/iwsdk-grab/SKILL.md'),
        'utf8',
      ),
    ).toContain('New in 9.1.');
    const claudeSkills = v2.manifest.units
      .filter((unit) => unit.path.startsWith('.claude/skills/'))
      .map((unit) => unit.path);
    expect(claudeSkills.length).toBeGreaterThan(10);
    expect(paths(report?.missing)).toEqual(claudeSkills.sort());
    expect(paths(report?.skipped)).toEqual([]);
    expect(report?.notice).toContain(
      `Not added: ${claudeSkills.length} parts of the IWSDK 9.1.0 guidance that this project does not have`,
    );
    expect(await readFile(settingsPath, 'utf8')).toBe(settings);
  }, 30_000);

  test('names skills a newer release adds instead of adding them', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const withSkill = await render('9.1.0', 'New in 9.1.', async (root) => {
      const skill = path.join(root, 'claude/.claude/skills/iwsdk-new');
      await mkdir(skill, { recursive: true });
      await writeFile(
        path.join(skill, 'SKILL.md'),
        '---\nname: iwsdk-new\ndescription: Added in 9.1 to show how dev up announces new skills.\n---\n\nNew.\n',
      );
    });
    await installCore(projectRoot, '9.1.0', withSkill);
    const settingsPath = path.join(projectRoot, '.claude/settings.json');
    const settings = await readFile(settingsPath, 'utf8');
    const added = ['.agents/skills/iwsdk-new', '.claude/skills/iwsdk-new'];

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    for (const skill of added) {
      expect(existsSync(path.join(projectRoot, skill)), skill).toBe(false);
    }
    expect(await readFile(settingsPath, 'utf8')).toBe(settings);
    expect(report?.action).toBe('refreshed');
    expect(paths(report?.changed)).toEqual(GRAB_SKILLS);
    expect(paths(report?.missing)).toEqual(added);
    expect(report?.notice).toContain(
      'Not added: 2 parts of the IWSDK 9.1.0 guidance that this project does not have',
    );
    expect(report?.notice).toContain('.claude/skills/iwsdk-new');
    // Announced with the refresh, not on every start.
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();

    // `iwsdk agents sync` adds them.
    const synced = await syncAgentGuidance({ projectRoot, source: withSkill });
    expect(
      paths(synced.results.filter((entry) => entry.action === 'created')),
    ).toEqual(added);
    expect(await readFile(settingsPath, 'utf8')).toContain('Skill(iwsdk-new)');
  }, 30_000);

  test('asks agents to re-read nothing when only skill permissions change', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    // The permission of a retired skill whose folder is already gone.
    const settingsPath = path.join(projectRoot, '.claude/settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    settings.permissions.allow.push('Skill(iwsdk-planner)');
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(actions(report?.changed)).toEqual({
      '.claude/settings.json': 'updated',
    });
    expect(await allowedRules(projectRoot)).not.toContain(
      'Skill(iwsdk-planner)',
    );
    expect(report?.notice).toContain(
      'Updated coding-agent guidance to the installed IWSDK 9.0.0: .claude/settings.json.',
    );
    expect(report?.notice).not.toContain('re-read');
  });

  test('refreshes guidance that changed without a version change', async () => {
    // A file:, workspace: or canary @iwsdk/core keeps its version number.
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    const rebuilt = await render('9.0.0', 'Rebuilt at 9.0.0.');
    await installCore(projectRoot, '9.0.0', rebuilt);

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(report?.action).toBe('refreshed');
    expect(paths(report?.changed)).toEqual(GRAB_SKILLS);
    expect(report?.notice).toContain(
      'Updated coding-agent guidance to the installed IWSDK 9.0.0:',
    );
    expect(
      await readFile(
        path.join(projectRoot, '.claude/skills/iwsdk-grab/SKILL.md'),
        'utf8',
      ),
    ).toContain('Rebuilt at 9.0.0.');
  }, 30_000);

  test('finishes a refresh that stopped part-way', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    await syncAgentGuidance({ projectRoot, source: v1 });
    await installCore(projectRoot, '9.1.0', v2);
    // As if a refresh was killed after it wrote AGENTS.md, before the skills.
    const agentsPath = path.join(projectRoot, 'AGENTS.md');
    await writeFile(
      agentsPath,
      (await readFile(agentsPath, 'utf8')).replace(
        'version=9.0.0',
        'version=9.1.0',
      ),
    );

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(report?.action).toBe('refreshed');
    expect(paths(report?.changed)).toEqual(GRAB_SKILLS);
  }, 30_000);

  test('never rolls guidance back to an older installed core', async () => {
    const projectRoot = await projectWithCore('9.1.0', v2);
    await syncAgentGuidance({ projectRoot, source: v2 });
    const before = await projectFiles(projectRoot);
    await installCore(projectRoot, '9.0.0', v1);
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
    expect(await projectFiles(projectRoot)).toEqual(before);
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
    expect(report?.missing).toEqual([]);
    expect(report?.notice).not.toContain('Not added');
    expect(report?.notice).not.toContain('Removed');
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

describe('refreshAgentGuidanceForDev replaces retired guidance whole', () => {
  test('a skill renamed between releases moves to its new name, with its permission', async () => {
    const renamed = await render('9.1.0', undefined, async (root) => {
      const from = path.join(root, 'claude/.claude/skills/iwsdk-ui');
      const to = path.join(root, 'claude/.claude/skills/iwsdk-ui-kit');
      await rename(from, to);
      const skill = path.join(to, 'SKILL.md');
      await writeFile(
        skill,
        (await readFile(skill, 'utf8')).replace(
          /^name: iwsdk-ui$/mu,
          'name: iwsdk-ui-kit',
        ),
      );
      const successors = path.join(root, 'successors.json');
      const table = JSON.parse(await readFile(successors, 'utf8'));
      table.skills['iwsdk-ui'] = ['iwsdk-ui-kit'];
      await writeFile(successors, JSON.stringify(table));
    });
    const project = async (change?: (projectRoot: string) => Promise<void>) => {
      const projectRoot = await projectWithCore('9.0.0', v1);
      await syncAgentGuidance({ projectRoot, source: v1 });
      await change?.(projectRoot);
      await installCore(projectRoot, '9.1.0', renamed);
      return projectRoot;
    };
    const exists = (projectRoot: string, unitPath: string) =>
      existsSync(path.join(projectRoot, unitPath));

    const projectRoot = await project();
    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(actions(report?.changed)).toEqual({
      '.agents/skills/iwsdk-ui-kit': 'created',
      '.claude/skills/iwsdk-ui-kit': 'created',
      '.claude/settings.json': 'updated',
      '.agents/skills/iwsdk-ui': 'removed',
      '.claude/skills/iwsdk-ui': 'removed',
    });
    for (const root of SKILL_ROOTS) {
      expect(exists(projectRoot, `${root}/iwsdk-ui`), root).toBe(false);
      expect(exists(projectRoot, `${root}/iwsdk-ui-kit/SKILL.md`), root).toBe(
        true,
      );
      expect(
        report?.changed.find((entry) => entry.path === `${root}/iwsdk-ui`)
          ?.replacedBy,
      ).toEqual([`${root}/iwsdk-ui-kit`]);
    }
    const allow = await allowedRules(projectRoot);
    expect(allow).toContain('Skill(iwsdk-ui-kit)');
    expect(allow).not.toContain('Skill(iwsdk-ui)');
    expect(report?.missing).toEqual([]);
    expect(report?.notice).toContain(
      'Removed retired guidance: .claude/skills/iwsdk-ui (replaced by .claude/skills/iwsdk-ui-kit), .agents/skills/iwsdk-ui (replaced by .agents/skills/iwsdk-ui-kit).',
    );
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();

    // Without the old skill's permission, the new one gets none.
    const withoutPermission = await project(async (root) => {
      const settingsPath = path.join(root, '.claude/settings.json');
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
      settings.permissions.allow = settings.permissions.allow.filter(
        (rule: string) => rule !== 'Skill(iwsdk-ui)',
      );
      await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    });
    await refreshAgentGuidanceForDev(withoutPermission, {});
    expect(exists(withoutPermission, '.claude/skills/iwsdk-ui-kit')).toBe(true);
    expect(await allowedRules(withoutPermission)).not.toContain(
      'Skill(iwsdk-ui-kit)',
    );

    // A deleted skill does not come back under its new name.
    const deleted = await project(async (root) => {
      for (const skills of SKILL_ROOTS) {
        await rm(path.join(root, skills, 'iwsdk-ui'), { recursive: true });
      }
    });
    const deletedReport = await refreshAgentGuidanceForDev(deleted, {});
    for (const root of SKILL_ROOTS) {
      expect(exists(deleted, `${root}/iwsdk-ui-kit`), root).toBe(false);
    }
    expect(paths(deletedReport?.missing)).toEqual([
      '.agents/skills/iwsdk-ui-kit',
      '.claude/skills/iwsdk-ui-kit',
    ]);
    expect(await allowedRules(deleted)).not.toContain('Skill(iwsdk-ui-kit)');

    // An edited copy stays, with its permission, and is not replaced.
    const edited = await project(async (root) => {
      const skill = path.join(root, '.claude/skills/iwsdk-ui/SKILL.md');
      await writeFile(skill, `${await readFile(skill, 'utf8')}\nOur panels.\n`);
    });
    const editedReport = await refreshAgentGuidanceForDev(edited, {});
    expect(actions(editedReport?.skipped)['.claude/skills/iwsdk-ui']).toBe(
      'skipped:modified',
    );
    expect(exists(edited, '.claude/skills/iwsdk-ui-kit')).toBe(false);
    expect(await allowedRules(edited)).toContain('Skill(iwsdk-ui)');
    expect(await allowedRules(edited)).not.toContain('Skill(iwsdk-ui-kit)');
  }, 60_000);

  test('keeps a retired skill when the release does not name what replaces it', async () => {
    const withExtra = await render('9.0.0', undefined, async (root) => {
      const skill = path.join(root, 'claude/.claude/skills/iwsdk-extra');
      await mkdir(skill, { recursive: true });
      await writeFile(
        path.join(skill, 'SKILL.md'),
        '---\nname: iwsdk-extra\ndescription: Shipped in 9.0 and retired in 9.1 without a successor entry.\n---\n\nExtra.\n',
      );
    });
    const projectRoot = await projectWithCore('9.0.0', withExtra);
    await syncAgentGuidance({ projectRoot, source: withExtra });
    await installCore(projectRoot, '9.1.0', v2);
    const extra = SKILL_ROOTS.map((root) => `${root}/iwsdk-extra`);

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(paths(report?.changed)).toEqual(GRAB_SKILLS);
    for (const unitPath of extra) {
      expect(existsSync(path.join(projectRoot, unitPath)), unitPath).toBe(true);
      expect(actions(report?.skipped)[unitPath]).toBe('skipped:retired');
      expect(report?.notice).toContain(
        `Kept retired guidance ${unitPath}: IWSDK 9.1.0 no longer ships it and does not name a replacement; \`npx @iwsdk/cli@latest agents sync\` removes it.`,
      );
    }
    expect(await allowedRules(projectRoot)).toContain('Skill(iwsdk-extra)');

    // `agents sync` removes it, and its permission.
    const synced = await syncAgentGuidance({ projectRoot, source: v2 });
    for (const unitPath of extra) {
      expect(actions(synced.results)[unitPath]).toBe('removed');
    }
    expect(await allowedRules(projectRoot)).not.toContain('Skill(iwsdk-extra)');
  }, 30_000);

  test('an unedited 0.5 app gets the skills that replaced its retired ones', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    const legacy = await writeLegacyGuidance(projectRoot, {
      'AGENTS.md':
        '# IWSDK project\n\nGuidance for every agent from 0.5. Plan with iwsdk-planner.\n',
      'CLAUDE.md':
        '# IWSDK project\n\nThe same guidance for Claude Code, from 0.5.\n',
      ...legacySkill('iwsdk-planner'),
      ...legacySkill('iwsdk-scene-composer'),
      ...legacySkill('iwsdk-debug'),
      '.claude/settings.json': legacySettings([
        'iwsdk-debug',
        'iwsdk-planner',
        'iwsdk-scene-composer',
      ]),
    });
    await installCore(projectRoot, '9.0.0', await withLegacy(v1, legacy));

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(report?.action).toBe('refreshed');
    const replacedBy = {
      'iwsdk-planner': ['iwsdk-dev'],
      'iwsdk-scene-composer': ['iwsdk-build-model', 'iwsdk-compose-scene'],
    };
    for (const root of SKILL_ROOTS) {
      expect(await skillsIn(projectRoot, root), root).toEqual([
        'iwsdk-build-model',
        'iwsdk-compose-scene',
        'iwsdk-debug',
        'iwsdk-dev',
      ]);
      for (const [retired, successors] of Object.entries(replacedBy)) {
        expect(report?.changed).toContainEqual({
          path: `${root}/${retired}`,
          kind: 'directory',
          action: 'removed',
          replacedBy: successors.map((name) => `${root}/${name}`),
        });
      }
      expect(actions(report?.changed)[`${root}/iwsdk-debug`]).toBe(
        'updated:legacy',
      );
    }
    // Each successor gets the permission of the skill it replaces.
    expect(await allowedRules(projectRoot)).toEqual(
      [
        'mcp__iwsdk-runtime__browser_screenshot',
        'Skill(iwsdk-build-model)',
        'Skill(iwsdk-compose-scene)',
        'Skill(iwsdk-debug)',
        'Skill(iwsdk-dev)',
      ].sort(),
    );
    // The new block routes to iwsdk-dev, which is now there.
    expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe(
      await renderedFile(v1, 'AGENTS.md'),
    );
    expect(await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe(
      await renderedFile(v1, 'CLAUDE.md'),
    );
    // Skills 0.5 never had are left out, and listed.
    expect(paths(report?.missing)).toContain('.claude/skills/iwsdk-upgrade');
    expect(paths(report?.missing)).not.toContain('.claude/skills/iwsdk-dev');
    expect(report?.notice).toContain(
      '.claude/skills/iwsdk-planner (replaced by .claude/skills/iwsdk-dev)',
    );
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
  }, 30_000);

  test('a 0.4 Cursor or Copilot app gets the whole guidance of its tool for its single file', async () => {
    for (const [tool, file] of [
      ['cursor', '.cursor/rules/iwsdk.mdc'],
      ['copilot', '.github/copilot-instructions.md'],
    ] as const) {
      const projectRoot = await projectWithCore('9.0.0', v1);
      const legacy = await writeLegacyGuidance(projectRoot, {
        [file]: `---\ndescription: IWSDK project conventions\nalwaysApply: true\n---\n\n# IWSDK Project\n\nAll of the 0.4 guidance for ${tool}.`,
      });
      await installCore(projectRoot, '9.0.0', await withLegacy(v1, legacy));
      const successors = v1.manifest.successors?.[file];
      expect(successors).toEqual(
        v1.manifest.units
          .filter((unit) => unit.tools.includes(tool))
          .map((unit) => unit.path)
          .sort(),
      );

      const report = await refreshAgentGuidanceForDev(projectRoot, {});
      expect(paths(report?.changed), tool).toEqual(
        [...successors!, file].sort(),
      );
      expect(
        report?.changed.find((entry) => entry.path === file),
      ).toMatchObject({ action: 'removed', replacedBy: successors });
      expect(existsSync(path.join(projectRoot, file)), file).toBe(false);
      for (const unitPath of successors!) {
        expect(existsSync(path.join(projectRoot, unitPath)), unitPath).toBe(
          true,
        );
      }
      for (const absent of ['.claude', 'CLAUDE.md', 'src']) {
        expect(existsSync(path.join(projectRoot, absent)), absent).toBe(false);
      }
      expect(report?.missing).toEqual([]);
      expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
    }
  }, 60_000);

  test('a 0.4 Claude Code app moves the guidance in its CLAUDE.md into a new AGENTS.md', async () => {
    // 0.4 wrote the full guidance to CLAUDE.md, and AGENTS.md only for Codex.
    const projectRoot = await projectWithCore('9.0.0', v1);
    const legacy = await writeLegacyGuidance(projectRoot, {
      'CLAUDE.md':
        '# IWSDK Project - Claude Code Configuration\n\nAll of the 0.4 guidance. Plan with iwsdk-planner.',
      ...legacySkill('iwsdk-planner', ['.claude/skills']),
      ...legacySkill('iwsdk-debug', ['.claude/skills']),
      '.claude/settings.json': legacySettings(['iwsdk-debug', 'iwsdk-planner']),
    });
    await installCore(projectRoot, '9.0.0', await withLegacy(v1, legacy));

    const report = await refreshAgentGuidanceForDev(projectRoot, {});
    expect(actions(report?.changed)).toEqual({
      'AGENTS.md': 'created',
      'CLAUDE.md': 'updated:legacy',
      '.claude/skills/iwsdk-debug': 'updated:legacy',
      '.claude/skills/iwsdk-dev': 'created',
      '.claude/settings.json': 'updated',
      '.claude/skills/iwsdk-planner': 'removed',
    });
    expect(await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe(
      await renderedFile(v1, 'CLAUDE.md'),
    );
    expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe(
      await renderedFile(v1, 'AGENTS.md'),
    );
    expect(await allowedRules(projectRoot)).toEqual(
      [
        'mcp__iwsdk-runtime__browser_screenshot',
        'Skill(iwsdk-debug)',
        'Skill(iwsdk-dev)',
      ].sort(),
    );
    expect(existsSync(path.join(projectRoot, '.agents'))).toBe(false);
    expect(report?.notice).toContain(
      'Agents: re-read the iwsdk-agent-guidance block in AGENTS.md and the other changed guidance before continuing.',
    );
    expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
  }, 30_000);

  test('a 0.5 app without AGENTS.md moves the guidance in its CLAUDE.md into AGENTS.md', async () => {
    const claude = '# IWSDK project\n\nThe 0.5 guidance for Claude Code.\n';
    const setup = async (agents?: string, editClaude = false) => {
      // A Claude Code user deleted AGENTS.md, the copy for other agents.
      const projectRoot = await projectWithCore('9.0.0', v1);
      const legacy = await writeLegacyGuidance(projectRoot, {
        'CLAUDE.md': claude,
        ...legacySkill('iwsdk-debug', ['.claude/skills']),
      });
      if (agents != null) {
        await writeFile(path.join(projectRoot, 'AGENTS.md'), agents);
      }
      if (editClaude) {
        await writeFile(
          path.join(projectRoot, 'CLAUDE.md'),
          `${claude}\nOur notes.\n`,
        );
      }
      await installCore(projectRoot, '9.0.0', await withLegacy(v1, legacy));
      return projectRoot;
    };

    const deleted = await setup();
    const report = await refreshAgentGuidanceForDev(deleted, {});
    expect(actions(report?.changed)).toMatchObject({
      'AGENTS.md': 'created',
      'CLAUDE.md': 'updated:legacy',
    });
    expect(await readFile(path.join(deleted, 'AGENTS.md'), 'utf8')).toBe(
      await renderedFile(v1, 'AGENTS.md'),
    );
    expect(await readFile(path.join(deleted, 'CLAUDE.md'), 'utf8')).toBe(
      await renderedFile(v1, 'CLAUDE.md'),
    );

    // An AGENTS.md of the developer's own gets the block added to it.
    const own = await setup('# Team rules\n\nUse tabs.\n');
    const ownReport = await refreshAgentGuidanceForDev(own, {});
    expect(actions(ownReport?.changed)).toMatchObject({
      'AGENTS.md': 'updated:appended',
      'CLAUDE.md': 'updated:legacy',
    });
    expect(
      (await readFile(path.join(own, 'AGENTS.md'), 'utf8')).startsWith(
        '# Team rules\n\nUse tabs.\n\n<!-- BEGIN iwsdk-agent-guidance',
      ),
    ).toBe(true);

    // An edited CLAUDE.md is the developer's guidance now: nothing moves.
    const edited = await setup(undefined, true);
    const editedReport = await refreshAgentGuidanceForDev(edited, {});
    expect(actions(editedReport?.skipped)['CLAUDE.md']).toBe(
      'skipped:legacy-modified',
    );
    expect(paths(editedReport?.missing)).toContain('AGENTS.md');
    expect(existsSync(path.join(edited, 'AGENTS.md'))).toBe(false);
    expect(await readFile(path.join(edited, 'CLAUDE.md'), 'utf8')).toBe(
      `${claude}\nOur notes.\n`,
    );
  }, 60_000);

  test('a 0.5 app keeps the guidance in its CLAUDE.md while its AGENTS.md cannot take the block', async () => {
    const claude = '# IWSDK project\n\nThe 0.5 guidance for Claude Code.\n';
    for (const [agents, reason] of [
      // The developer edited the AGENTS.md 0.5 wrote.
      [
        '# IWSDK project\n\nThe 0.5 guidance for every agent.\n\nOur notes.\n',
        'legacy-modified',
      ],
      // Its block lost the END line.
      [
        `# Team rules\n\n<!-- BEGIN iwsdk-agent-guidance version=9.0.0 sha256=${'0'.repeat(64)} -->\nHalf a block.\n`,
        'malformed-block',
      ],
    ]) {
      const projectRoot = await projectWithCore('9.0.0', v1);
      const legacy = await writeLegacyGuidance(projectRoot, {
        'CLAUDE.md': claude,
        ...legacySkill('iwsdk-debug', ['.claude/skills']),
      });
      await writeFile(path.join(projectRoot, 'AGENTS.md'), agents);
      await installCore(projectRoot, '9.0.0', await withLegacy(v1, legacy));

      const report = await refreshAgentGuidanceForDev(projectRoot, {});
      expect(actions(report?.changed)['.claude/skills/iwsdk-debug']).toBe(
        'updated:legacy',
      );
      // An import of this AGENTS.md would not give Claude Code the guidance.
      expect(actions(report?.skipped)).toMatchObject({
        'AGENTS.md': `skipped:${reason}`,
        'CLAUDE.md': 'skipped:retired',
      });
      expect(
        await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8'),
        reason,
      ).toBe(claude);
      expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe(
        agents,
      );
      expect(report?.notice).toContain(
        'Kept retired guidance CLAUDE.md: It holds the full guidance of an IWSDK release before 1.0, and becomes an @AGENTS.md import once AGENTS.md has the iwsdk-agent-guidance block.',
      );
      expect(await refreshAgentGuidanceForDev(projectRoot, {})).toBeNull();
    }
  }, 60_000);
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

  test('tells Yarn 2+ projects, which ignore .npmrc, from Yarn 1 ones', async () => {
    const project = async (files: Record<string, string>) => {
      const projectRoot = await tempDir('iwsdk-yarn-');
      await mkdir(path.join(projectRoot, '.git'));
      for (const [name, text] of Object.entries(files)) {
        await writeFile(path.join(projectRoot, name), text);
      }
      return projectRoot;
    };
    const berryLockfile =
      '# This file is generated by running "yarn install" inside your project.\n\n__metadata:\n  version: 8\n';
    for (const [files, berry] of [
      [{ 'package.json': '{"packageManager":"yarn@4.9.2"}' }, true],
      [{ 'package.json': '{}', 'yarn.lock': '', '.yarnrc.yml': '' }, true],
      [{ 'package.json': '{}', 'yarn.lock': berryLockfile }, true],
      [{ 'package.json': '{}', 'yarn.lock': '# yarn lockfile v1\n' }, false],
      [
        {
          'package.json': '{"packageManager":"yarn@1.22.22"}',
          '.yarnrc.yml': '',
        },
        false,
      ],
      [
        {
          'package.json': '{"packageManager":"pnpm@10.0.0"}',
          '.yarnrc.yml': '',
        },
        false,
      ],
    ] as const) {
      expect(usesYarnBerry(await project(files)), JSON.stringify(files)).toBe(
        berry,
      );
    }
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
  // A stand-in npm for `npm config get`, `npm config ls` and `npm view`. Like
  // npm, it takes its settings from the .npmrc next to the nearest
  // package.json, or, unless --no-workspaces, next to the package.json of a
  // workspace root that lists that one, where `npm config` refuses to run
  // (ENOWORKSPACES); npm_config_* variables (registry, @iwsdk:registry and
  // //<registry>/: keys) override it. Like npm 10 and 11, `npm config get`
  // refuses a URL with a password in it ("option is protected") and
  // `npm config ls` prints it with the password hidden.
  // The registry has every package at every version except the specs in
  // FAKE_NPM_MISSING, the packages in FAKE_NPM_UNKNOWN, any version on the
  // registries in FAKE_NPM_BEHIND, and any package on the registries in
  // FAKE_NPM_PRIVATE without the //<registry>/:_authToken setting; its core
  // needs three 0.186.0 (or FAKE_NPM_CORE_DEPENDENCIES) and lists
  // FAKE_NPM_NEWER as later versions.
  // FAKE_NPM_OFFLINE fails every lookup like a machine without a network,
  // except that, like npm, it answers from its cache when FAKE_NPM_CACHED
  // lists the versions a package cached earlier has, unless npm_config_cache
  // names another (empty) cache. FAKE_NPM_HANG never answers a lookup
  // ("cache": one with npm_config_cache). With npm_config_cache,
  // FAKE_NPM_BUSY_CACHE leaves a process writing into that cache for that
  // many milliseconds, and FAKE_NPM_LOCK_CACHE puts a read-only folder with a
  // file in it. FAKE_NPM_LOG records each call.
  let fakeNpmBin: string;
  let pathWithoutFakeNpm: string | undefined;
  let inheritedNpmConfig: Record<string, string | undefined>;
  beforeAll(async () => {
    // Set by npm scripts and CI; the tests set them where they need them.
    inheritedNpmConfig = Object.fromEntries(
      Object.keys(process.env)
        .filter((name) => /^npm_config_(registry|cache)$/iu.test(name))
        .map((name) => [name, process.env[name]]),
    );
    for (const name of Object.keys(inheritedNpmConfig)) {
      delete process.env[name];
    }
    fakeNpmBin = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-fakenpm-'));
    await writeFile(
      path.join(fakeNpmBin, 'npm'),
      `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
let prefix = process.cwd();
while (!fs.existsSync(path.join(prefix, 'package.json')) && path.dirname(prefix) !== prefix) {
  prefix = path.dirname(prefix);
}
let member = false;
for (let dir = path.dirname(prefix); !args.includes('--no-workspaces') && !member && dir !== path.dirname(dir); dir = path.dirname(dir)) {
  let workspaces = [];
  try {
    workspaces = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).workspaces ?? [];
  } catch {}
  if (workspaces.some((glob) => glob.endsWith('/*') ? path.join(dir, glob.slice(0, -2)) === path.dirname(prefix) : path.join(dir, glob) === prefix)) {
    prefix = dir;
    member = true;
  }
}
const npmrc = path.join(prefix, '.npmrc');
// Like npm's ini parser: quotes and ; or # comments are not part of a value,
// and a [section] ends the settings.
const lines = (fs.existsSync(npmrc) ? fs.readFileSync(npmrc, 'utf8') : '').split(/[\\r\\n]+/);
const section = lines.findIndex((line) => /^\\s*\\[/.test(line));
const project = Object.fromEntries(lines.slice(0, section === -1 ? lines.length : section).flatMap((line) => {
  const match = line.match(/^\\s*([^\\s;#=][^=]*)=(.*)$/);
  const value = match?.[2].trim();
  return match ? [[match[1].trim(), /^(["']).*\\1$/.test(value) ? value.slice(1, -1) : value.replace(/[;#].*$/, '').trim()]] : [];
}));
const environment = Object.fromEntries(Object.entries(process.env).flatMap(([name, value]) => {
  const key = name.slice('npm_config_'.length);
  const setting = key.startsWith('//') ? key : key.replace(/(?!^)_/g, '-').toLowerCase();
  return /^npm_config_/i.test(name) && value !== '' && (setting === 'registry' || setting === '@iwsdk:registry' || setting.startsWith('//')) ? [[setting, value]] : [];
}));
const settings = { registry: 'https://registry.npmjs.org/', ...project, ...environment };
const registry = settings['@iwsdk:registry'] ?? settings.registry;
const token = settings[registry.replace(/^[a-z]+:/, '') + ':_authToken'] ?? null;
const cache = process.env.npm_config_cache;
if (process.env.FAKE_NPM_LOG) {
  fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ cwd: process.cwd(), pid: process.pid, args, registry, token, cache: cache ? { path: cache, empty: fs.readdirSync(cache).length === 0 } : null }) + '\\n');
}
if (args[0] === 'config') {
  if (member) {
    console.error('npm error code ENOWORKSPACES\\nnpm error This command does not support workspaces.');
    process.exit(1);
  }
  const hide = (value) => value.replace(/\\/\\/([^:/@\\s]+):[^/\\s]*@/, '//$1:***@');
  if (args[1] === 'get') {
    const keys = args.slice(2).filter((arg) => !arg.startsWith('-'));
    const secret = keys.find((key) => settings[key] && hide(settings[key]) !== settings[key]);
    if (secret) {
      console.error('npm error The ' + secret + ' option is protected, and can not be retrieved in this way');
      process.exit(1);
    }
    console.log(keys.map((key) => key + '=' + (settings[key] ?? 'undefined')).join('\\n'));
    process.exit(0);
  }
  if (args[1] !== 'ls' || process.env.FAKE_NPM_CONFIG_LS_FAILS) {
    process.exit(1);
  }
  const show = (key, value) => key + ' = ' + JSON.stringify(hide(value));
  // A value a later source overrides is commented out.
  const overridden = (key, value, by) => '; ' + show(key, value) + ' ; overridden by ' + by;
  const { publishConfig } = JSON.parse(fs.readFileSync(path.join(prefix, 'package.json'), 'utf8'));
  console.log([
    '; "user" config from ' + path.join(require('os').homedir(), '.npmrc'),
    '',
    ...(environment.registry || project.registry ? [overridden('registry', 'https://registry.npmjs.org/', environment.registry ? 'env' : 'project'), ''] : []),
    '; "project" config from ' + npmrc,
    '',
    ...Object.entries(project).map(([key, value]) => (key in environment ? overridden(key, value, 'env') : show(key, value))),
    '',
    ...(Object.keys(environment).length > 0 ? ['; "env" config from environment', '', ...Object.entries(environment).map(([key, value]) => show(key, value)), ''] : []),
    ...(publishConfig ? ['; "publishConfig" from ' + path.join(prefix, 'package.json'), '; This set of config values will be used at publish-time.', '', ...Object.entries(publishConfig).map(([key, value]) => show(key, value)), ''] : []),
    '; npm version = 11.6.1',
  ].join('\\n'));
  process.exit(0);
}
if (args[0] !== 'view') {
  console.error('unexpected npm ' + args[0]);
  process.exit(2);
}
const spec = args[1];
const name = spec.slice(0, spec.lastIndexOf('@'));
const version = spec.slice(spec.lastIndexOf('@') + 1);
const list = (variable) => (process.env[variable] ?? '').split(',').filter(Boolean);
const fail = (error) => {
  console.log(JSON.stringify({ error }, null, 2));
  process.exit(1);
};
const noMatch = { code: 'E404', summary: 'No match found for version ' + version, detail: "The requested resource 'undefined@" + version + "' could not be found or you do not have permission to access it." };
if (cache && process.env.FAKE_NPM_LOCK_CACHE) {
  fs.mkdirSync(path.join(cache, 'locked'));
  fs.writeFileSync(path.join(cache, 'locked', 'file'), '');
  fs.chmodSync(path.join(cache, 'locked'), 0o555);
}
if (cache && process.env.FAKE_NPM_BUSY_CACHE) {
  require('child_process').spawn(process.execPath, [path.join(__dirname, 'busy-writer.js'), cache, process.env.FAKE_NPM_BUSY_CACHE], { detached: true, stdio: 'ignore' }).unref();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (const end = Date.now() + 5000; fs.readdirSync(cache).length === 0 && Date.now() < end; ) {
    Atomics.wait(pause, 0, 0, 5);
  }
}
if (process.env.FAKE_NPM_HANG && (process.env.FAKE_NPM_HANG !== 'cache' || cache)) {
  setInterval(() => {}, 1000);
} else if (process.env.FAKE_NPM_OFFLINE && (cache || !process.env.FAKE_NPM_CACHED)) {
  fail({ code: 'ENOTFOUND', summary: 'request to ' + registry + ' failed, reason: getaddrinfo ENOTFOUND' });
} else if (process.env.FAKE_NPM_OFFLINE && !list('FAKE_NPM_CACHED').includes(version)) {
  fail(noMatch);
} else if (list('FAKE_NPM_UNKNOWN').includes(name) || (list('FAKE_NPM_PRIVATE').includes(registry) && !token)) {
  fail({ code: 'E404', summary: 'Not Found - GET ' + registry + name.replace('/', '%2f') + ' - Not found', detail: "The requested resource '" + spec + "' could not be found or you do not have permission to access it." });
} else if (list('FAKE_NPM_MISSING').includes(spec) || list('FAKE_NPM_BEHIND').includes(registry)) {
  fail(noMatch);
} else {
  const manifest = name === '@iwsdk/core'
    ? { version, dependencies: JSON.parse(process.env.FAKE_NPM_CORE_DEPENDENCIES ?? '{"three":"npm:super-three@0.186.0","@types/three":"^0.186.0"}'), versions: ['9.0.0', version, ...list('FAKE_NPM_NEWER')] }
    : { version };
  const values = args.slice(2).filter((arg) => !arg.startsWith('-') && arg in manifest).map((field) => [field, manifest[field]]);
  // Like npm, the bare value when only one field has one.
  console.log(JSON.stringify(values.length === 1 ? values[0][1] : Object.fromEntries(values), null, 2));
}
`,
    );
    await chmod(path.join(fakeNpmBin, 'npm'), 0o755);
    // Like an npm that a timeout left running: it adds a file to the folder
    // every 50 µs for that many milliseconds.
    await writeFile(
      path.join(fakeNpmBin, 'busy-writer.js'),
      `const fs = require('fs');
const path = require('path');
const [folder, duration] = process.argv.slice(2);
const end = Date.now() + Number(duration);
for (let index = 0; Date.now() < end; index++) {
  try {
    fs.writeFileSync(path.join(folder, String(index)), '');
  } catch {}
  for (const start = process.hrtime.bigint(); process.hrtime.bigint() - start < 50000n; );
}
`,
    );
    pathWithoutFakeNpm = process.env.PATH;
    process.env.PATH = `${fakeNpmBin}${path.delimiter}${pathWithoutFakeNpm}`;
  });
  afterAll(async () => {
    process.env.PATH = pathWithoutFakeNpm;
    Object.assign(process.env, inheritedNpmConfig);
    await rm(fakeNpmBin, { recursive: true, force: true });
  });

  /** Runs with these variables set (undefined unsets one), then restores them. */
  async function withEnv<T>(
    env: Record<string, string | undefined>,
    run: () => Promise<T>,
  ): Promise<T> {
    const apply = (values: Record<string, string | undefined>) => {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    };
    const previous = Object.fromEntries(
      Object.keys(env).map((key) => [key, process.env[key]]),
    );
    apply(env);
    try {
      return await run();
    } finally {
      apply(previous);
    }
  }

  /** The calls FAKE_NPM_LOG (or a stand-in yarn's log) recorded. */
  async function loggedCalls(log: string) {
    return existsSync(log)
      ? (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .map(
            (line) =>
              JSON.parse(line) as {
                cwd: string;
                pid?: number;
                args: string[];
                /** The registry the stand-in npm asked. */
                registry?: string;
                /** The token it had for that registry. */
                token?: string | null;
                /** The cache npm_config_cache named, and if it was empty. */
                cache?: { path: string; empty: boolean } | null;
              },
          )
      : [];
  }

  /**
   * A bin folder with only a stand-in `pnpm`, which installs the
   * @iwsdk/core package.json asks for, needing three 0.186.0, and logs it.
   */
  async function installingPnpmBin() {
    const bin = await tempDir('iwsdk-installpm-');
    await writeFile(
      path.join(bin, 'pnpm'),
      `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const core = path.join('node_modules', '@iwsdk', 'core');
fs.rmSync(core, { recursive: true, force: true });
fs.mkdirSync(core, { recursive: true });
fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: '@iwsdk/core', version: pkg.dependencies['@iwsdk/core'], dependencies: { three: 'npm:super-three@0.186.0', '@types/three': '^0.186.0' }, exports: { './package.json': './package.json' } }));
fs.appendFileSync('installs.log', 'install\\n');
`,
    );
    await chmod(path.join(bin, 'pnpm'), 0o755);
    return bin;
  }

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
      dependencies: {
        '@iwsdk/core': '0.4.2',
        three: 'npm:super-three@0.170.0',
      },
      devDependencies: {
        '@iwsdk/cli': '0.4.2',
        '@iwsdk/vite-plugin-dev': '0.4.2',
        '@types/three': '^0.170.0',
      },
    });
    const workspace =
      'packages:\n  - .\noverrides:\n  three: npm:super-three@0.170.0\n';
    await writeFile(path.join(projectRoot, 'pnpm-workspace.yaml'), workspace);
    const before = await readFile(
      path.join(projectRoot, 'package.json'),
      'utf8',
    );
    const { io: context } = io(projectRoot);
    const result = await handleUpgrade({ dryRun: true, to: '9.1.0' }, context);
    expect(result.data.from).toBe('0.4.2');
    expect(
      result.data.packages
        .map((bump) => `${bump.field} ${bump.name} ${bump.to}`)
        .sort(),
    ).toEqual([
      'dependencies @iwsdk/core 9.1.0',
      'dependencies three npm:super-three@0.186.0',
      'devDependencies @iwsdk/cli 9.1.0',
      'devDependencies @iwsdk/vite-plugin-dev 9.1.0',
      'devDependencies @types/three ^0.186.0',
      'pnpm-workspace.yaml overrides three npm:super-three@0.186.0',
    ]);
    expect(result.data.migrations).toEqual([
      { id: 'iwsdk-migrate-0-5', introducedIn: '0.5.0' },
    ]);
    expect(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).toBe(
      before,
    );
    expect(
      await readFile(path.join(projectRoot, 'pnpm-workspace.yaml'), 'utf8'),
    ).toBe(workspace);
  });

  test('aligns three before installing, so --no-install and a failed install leave one Three.js', async () => {
    const threeDependencies = {
      dependencies: {
        '@iwsdk/core': '9.0.0',
        three: 'npm:super-three@0.170.0',
      },
      devDependencies: { '@types/three': '^0.170.0' },
      overrides: { three: 'npm:super-three@0.170.0' },
    };
    const workspace =
      'packages:\n  - .\noverrides:\n  three: npm:super-three@0.170.0\n';
    const expectAligned = async (projectRoot: string) => {
      const packageJson = JSON.parse(
        await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
      );
      expect(packageJson.dependencies).toEqual({
        '@iwsdk/core': '9.1.0',
        three: 'npm:super-three@0.186.0',
      });
      expect(packageJson.overrides.three).toBe('npm:super-three@0.186.0');
      expect(packageJson.devDependencies['@types/three']).toBe('^0.186.0');
      expect(
        await readFile(path.join(projectRoot, 'pnpm-workspace.yaml'), 'utf8'),
      ).toBe(workspace.replace('0.170.0', '0.186.0'));
    };

    const notInstalled = await projectWithCore('9.0.0', v1, threeDependencies);
    await writeFile(path.join(notInstalled, 'pnpm-workspace.yaml'), workspace);
    const result = await handleUpgrade(
      { to: '9.1.0', noInstall: true },
      io(notInstalled).io,
    );
    await expectAligned(notInstalled);
    expect(result.data.packages).toContainEqual({
      field: 'overrides',
      name: 'three',
      from: 'npm:super-three@0.170.0',
      to: 'npm:super-three@0.186.0',
    });

    const failed = await projectWithCore('9.0.0', v1, {
      packageManager: 'pnpm@10.0.0',
      ...threeDependencies,
    });
    await writeFile(path.join(failed, 'pnpm-workspace.yaml'), workspace);
    const bin = await tempDir('iwsdk-failpm-');
    await writeFile(
      path.join(bin, 'pnpm'),
      `#!${process.execPath}\nconsole.error('ERR_PNPM_FETCH_404');\nprocess.exit(1);\n`,
    );
    await chmod(path.join(bin, 'pnpm'), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    try {
      await expect(
        handleUpgrade({ to: '9.1.0' }, io(failed).io),
      ).rejects.toThrow('pnpm install failed');
    } finally {
      process.env.PATH = previousPath;
    }
    await expectAligned(failed);
  });

  test('checks that the registry has the release before writing anything', async () => {
    const projectRoot = await projectWithCore('0.4.2', v1, {
      packageManager: 'pnpm@10.0.0',
      dependencies: {
        '@iwsdk/core': '0.4.2',
        three: 'npm:super-three@0.170.0',
      },
      devDependencies: {
        '@iwsdk/cli': '0.4.2',
        '@iwsdk/vite-plugin-dev': '0.4.2',
      },
    });
    const before = await readFile(
      path.join(projectRoot, 'package.json'),
      'utf8',
    );
    const bin = await tempDir('iwsdk-recordpm-');
    await writeFile(
      path.join(bin, 'pnpm'),
      `#!${process.execPath}\nrequire('fs').writeFileSync('installed', '');\n`,
    );
    await chmod(path.join(bin, 'pnpm'), 0o755);
    // Like a registry mirror that has not synced the release yet: the error
    // names every missing package and the registry, under its own code.
    const notOnRegistry = {
      code: 'release_not_on_registry',
      message: expect.stringMatching(
        /^https:\/\/registry\.npmjs\.org\/ does not have @iwsdk\/core@9\.1\.0, @iwsdk\/cli@9\.1\.0 \(E404: No match found for version 9\.1\.0\)\. Nothing was changed\./u,
      ),
      details: {
        registry: 'https://registry.npmjs.org/',
        version: '9.1.0',
        missing: ['@iwsdk/core@9.1.0', '@iwsdk/cli@9.1.0'],
      },
    };
    await withEnv(
      {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        FAKE_NPM_MISSING: '@iwsdk/cli@9.1.0,@iwsdk/core@9.1.0',
      },
      async () => {
        const modes: CliOptions[] = [{}, { noInstall: true }, { dryRun: true }];
        for (const options of modes) {
          await expect(
            handleUpgrade({ to: '9.1.0', ...options }, io(projectRoot).io),
          ).rejects.toMatchObject(notOnRegistry);
        }
        const run = spawnSync(
          process.execPath,
          [CLI_PATH, 'upgrade', '--to', '9.1.0', '--workspace', projectRoot],
          { encoding: 'utf8' },
        );
        expect(run.status).toBe(1);
        expect(run.stderr).toContain(
          '[IWSDK] Checking https://registry.npmjs.org/ for IWSDK 9.1.0 ...',
        );
        expect(
          JSON.parse(run.stderr.slice(run.stderr.indexOf('{'))),
        ).toMatchObject({ ok: false, error: notOnRegistry });
        // No such package, which a registry also answers when you may not
        // access it: the message keeps that possibility, as npm does.
        await expect(
          withEnv(
            {
              FAKE_NPM_MISSING: undefined,
              FAKE_NPM_UNKNOWN: '@iwsdk/vite-plugin-dev',
            },
            () =>
              handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
          ),
        ).rejects.toMatchObject({
          code: 'release_not_on_registry',
          message: expect.stringContaining(
            'https://registry.npmjs.org/ does not have @iwsdk/vite-plugin-dev@9.1.0, or you do not have permission to access it (E404: Not Found - GET https://registry.npmjs.org/@iwsdk%2fvite-plugin-dev - Not found). Nothing was changed. A registry mirror can lag behind a release: upgrade once it has IWSDK 9.1.0, or point the project at a registry that does (the npm_config_registry environment variable overrides the configured one).',
          ),
        });
        // Only that package gets the note, not one missing only the version.
        await expect(
          withEnv(
            {
              FAKE_NPM_MISSING: '@iwsdk/core@9.1.0',
              FAKE_NPM_UNKNOWN: '@iwsdk/vite-plugin-dev',
            },
            () =>
              handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
          ),
        ).rejects.toMatchObject({
          code: 'release_not_on_registry',
          message: expect.stringContaining(
            'https://registry.npmjs.org/ does not have @iwsdk/core@9.1.0 (E404: No match found for version 9.1.0), and does not have @iwsdk/vite-plugin-dev@9.1.0, or you do not have permission to access it (E404: Not Found - GET https://registry.npmjs.org/@iwsdk%2fvite-plugin-dev - Not found). Nothing was changed.',
          ),
          details: {
            missing: ['@iwsdk/core@9.1.0', '@iwsdk/vite-plugin-dev@9.1.0'],
          },
        });
      },
    );
    expect(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).toBe(
      before,
    );
    expect(existsSync(path.join(projectRoot, '.iwsdk'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'installed'))).toBe(false);
  });

  test('a dry run reports the plan when the registry cannot be asked', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1, {
      dependencies: {
        '@iwsdk/core': '9.0.0',
        three: 'npm:super-three@0.170.0',
      },
    });
    const before = await readFile(
      path.join(projectRoot, 'package.json'),
      'utf8',
    );
    // Offline: npm answers with a network error.
    const offline = io(projectRoot);
    const withoutNetwork = await withEnv({ FAKE_NPM_OFFLINE: '1' }, () =>
      handleUpgrade({ to: '9.1.0', dryRun: true }, offline.io),
    );
    expect(withoutNetwork.data.packages).toEqual([
      {
        field: 'dependencies',
        name: '@iwsdk/core',
        from: '9.0.0',
        to: '9.1.0',
      },
    ]);
    expect(offline.stderr.join('')).toContain(
      '[IWSDK] Checking https://registry.npmjs.org/ for IWSDK 9.1.0 ...',
    );
    expect(withoutNetwork.data.manualSteps).toContain(
      'Could not check https://registry.npmjs.org/ for IWSDK 9.1.0 (ENOTFOUND: request to https://registry.npmjs.org/ failed, reason: getaddrinfo ENOTFOUND): three alignment will be decided after install.',
    );
    // No npm at all, as with only Bun or a standalone pnpm.
    const withoutNpm = await withEnv(
      { PATH: await tempDir('iwsdk-nonpm-') },
      () => handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
    );
    expect(withoutNpm.data.packages).toEqual(withoutNetwork.data.packages);
    expect(withoutNpm.data.manualSteps).toContain(
      'Could not check the registry for IWSDK 9.1.0 (npm could not start: spawn npm ENOENT): three alignment will be decided after install.',
    );
    expect(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).toBe(
      before,
    );
  });

  test('trusts a release npm has cached, and lets only the registry say one is missing', async () => {
    const declared = {
      dependencies: {
        '@iwsdk/core': '9.0.0',
        three: 'npm:super-three@0.170.0',
      },
    };
    const views = async (log: string) =>
      (await loggedCalls(log)).filter((call) => call.args[0] === 'view');
    // Offline, with @iwsdk/core cached before 9.1.0 was published: npm
    // answers from its cache that 9.1.0 does not exist. Asked again with an
    // empty cache, npm cannot reach the registry, so nothing is known about
    // the release, and the upgrade goes on as without a network.
    const modes: CliOptions[] = [{ dryRun: true }, { noInstall: true }];
    for (const options of modes) {
      const projectRoot = await projectWithCore('9.0.0', v1, declared);
      const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
      const result = await withEnv(
        { FAKE_NPM_OFFLINE: '1', FAKE_NPM_CACHED: '9.0.0', FAKE_NPM_LOG: log },
        () => handleUpgrade({ to: '9.1.0', ...options }, io(projectRoot).io),
      );
      expect(result.data.manualSteps.join('\n')).toContain(
        'Could not check https://registry.npmjs.org/ for IWSDK 9.1.0 (ENOTFOUND: request to https://registry.npmjs.org/ failed, reason: getaddrinfo ENOTFOUND)',
      );
      // The second lookup had an empty cache of its own, removed after it.
      const calls = await views(log);
      expect(calls.map((call) => call.cache?.empty ?? null)).toEqual([
        null,
        true,
      ]);
      expect(existsSync(calls[1].cache!.path)).toBe(false);
    }

    // A release in npm's cache stands: published versions never change.
    const projectRoot = await projectWithCore('9.0.0', v1, declared);
    const cachedLog = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
    const cached = await withEnv(
      {
        FAKE_NPM_OFFLINE: '1',
        FAKE_NPM_CACHED: '9.0.0,9.1.0',
        FAKE_NPM_LOG: cachedLog,
      },
      () => handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
    );
    expect(cached.data.packages).toContainEqual({
      field: 'dependencies',
      name: 'three',
      from: 'npm:super-three@0.170.0',
      to: 'npm:super-three@0.186.0',
    });
    expect((await views(cachedLog)).map((call) => call.cache)).toEqual([null]);

    // Online, the registry itself confirms a missing release.
    const onlineLog = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
    await expect(
      withEnv(
        { FAKE_NPM_MISSING: '@iwsdk/core@9.1.0', FAKE_NPM_LOG: onlineLog },
        () => handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
      ),
    ).rejects.toMatchObject({ code: 'release_not_on_registry' });
    expect(
      (await views(onlineLog)).map((call) => call.cache?.empty ?? null),
    ).toEqual([null, true]);
  });

  /** The empty caches the stand-in npm was asked to use. */
  async function loggedCaches(log: string) {
    return (await loggedCalls(log)).flatMap((call) =>
      call.cache ? [call.cache.path] : [],
    );
  }

  test('goes on unchecked when it cannot create an empty npm cache', async () => {
    // Offline, npm's cache says that 9.1.0 does not exist. Without an empty
    // cache to ask the registry with, that answer proves nothing.
    const noTemp = path.join(await tempDir('iwsdk-notmp-'), 'missing');
    const modes: CliOptions[] = [{ dryRun: true }, { noInstall: true }];
    for (const options of modes) {
      const projectRoot = await projectWithCore('9.0.0', v1, {
        dependencies: {
          '@iwsdk/core': '9.0.0',
          three: 'npm:super-three@0.170.0',
        },
      });
      const result = await withEnv(
        {
          FAKE_NPM_OFFLINE: '1',
          FAKE_NPM_CACHED: '9.0.0',
          TMPDIR: noTemp,
          TMP: noTemp,
          TEMP: noTemp,
        },
        () => handleUpgrade({ to: '9.1.0', ...options }, io(projectRoot).io),
      );
      expect(result.data.manualSteps.join('\n')).toContain(
        "Could not check https://registry.npmjs.org/ for IWSDK 9.1.0 (E404: No match found for version 9.1.0, maybe from npm's cache, and no empty cache could be created to ask the registry: ENOENT",
      );
    }
  });

  test('removes the empty npm cache while an npm left running writes to it', async () => {
    // On Windows a timeout stops only the cmd.exe that started npm, which can
    // keep using the cache; here a process writes into it for 300 ms more.
    const projectRoot = await projectWithCore('9.0.0', v1);
    const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
    const result = await withEnv(
      {
        FAKE_NPM_OFFLINE: '1',
        FAKE_NPM_CACHED: '9.0.0',
        FAKE_NPM_BUSY_CACHE: '300',
        FAKE_NPM_LOG: log,
      },
      () => handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
    );
    expect(result.data.manualSteps.join('\n')).toContain(
      'Could not check https://registry.npmjs.org/ for IWSDK 9.1.0',
    );
    const [cache] = await loggedCaches(log);
    try {
      expect(existsSync(cache)).toBe(false);
    } finally {
      await rm(cache, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  });

  test.skipIf(process.platform === 'win32')(
    'removes the empty npm cache when the CLI is interrupted',
    async () => {
      // Ctrl+C while npm asks again with the empty cache: the terminal
      // signals the CLI and npm, its process group, alike.
      const projectRoot = await projectWithCore('9.0.0', v1);
      const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
      const caches: string[] = [];
      const child = spawn(
        process.execPath,
        [
          CLI_PATH,
          'upgrade',
          '--to',
          '9.1.0',
          '--dry-run',
          '--workspace',
          projectRoot,
        ],
        {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            FAKE_NPM_MISSING: '@iwsdk/core@9.1.0',
            FAKE_NPM_HANG: 'cache',
            FAKE_NPM_LOG: log,
          },
        },
      );
      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.on('close', (code, signal) => resolve({ code, signal })),
      );
      try {
        for (
          const deadline = Date.now() + 10_000;
          caches.length === 0 && Date.now() < deadline;

        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          caches.push(...(await loggedCaches(log)));
        }
        process.kill(-child.pid!, 'SIGINT');
        // Still ended by the signal, as without the cleanup.
        expect(await exited).toEqual({ code: null, signal: 'SIGINT' });
        expect(caches).toHaveLength(1);
        expect(existsSync(caches[0])).toBe(false);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          process.kill(-child.pid!, 'SIGKILL');
        }
        for (const cache of caches) {
          await rm(cache, { recursive: true, force: true });
        }
      }
    },
  );

  test.skipIf(process.platform === 'win32')(
    'removes an npm cache it could not remove yet when the CLI exits',
    async () => {
      // npm made a folder in the cache read-only, and the install (a
      // stand-in pnpm) makes it writable again.
      const projectRoot = await projectWithCore('9.0.0', v1, {
        packageManager: 'pnpm@10.0.0',
        dependencies: {
          '@iwsdk/core': '9.0.0',
          three: 'npm:super-three@0.170.0',
        },
      });
      const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
      const bin = await tempDir('iwsdk-unlockpm-');
      await writeFile(
        path.join(bin, 'pnpm'),
        `#!${process.execPath}
const fs = require('fs');
const path = require('path');
for (const line of fs.readFileSync(process.env.FAKE_NPM_LOG, 'utf8').trim().split('\\n')) {
  const { cache } = JSON.parse(line);
  try {
    if (cache) fs.chmodSync(path.join(cache.path, 'locked'), 0o755);
  } catch {}
}
`,
      );
      await chmod(path.join(bin, 'pnpm'), 0o755);
      const run = spawnSync(
        process.execPath,
        [CLI_PATH, 'upgrade', '--to', '9.1.0', '--workspace', projectRoot],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            FAKE_NPM_OFFLINE: '1',
            FAKE_NPM_CACHED: '9.0.0',
            FAKE_NPM_LOCK_CACHE: '1',
            FAKE_NPM_LOG: log,
          },
        },
      );
      const caches = await loggedCaches(log);
      try {
        expect(run.status).toBe(0);
        expect(caches).toHaveLength(1);
        expect(existsSync(caches[0])).toBe(false);
      } finally {
        for (const cache of caches) {
          await chmod(path.join(cache, 'locked'), 0o755).catch(() => {});
          await rm(cache, { recursive: true, force: true });
        }
      }
    },
  );

  test('when the registry cannot be asked, three follows the core the install brings', async () => {
    const declared = {
      packageManager: 'pnpm@10.0.0',
      dependencies: {
        '@iwsdk/core': '9.0.0',
        three: 'npm:super-three@0.170.0',
      },
      overrides: { three: 'npm:super-three@0.170.0' },
    };
    const readPackageJson = async (projectRoot: string) =>
      JSON.parse(
        await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
      ) as {
        dependencies: Record<string, string>;
        overrides: { three: string };
      };
    const installer = await installingPnpmBin();
    // No npm, then no network: the upgrade goes on, as it did before the
    // registry check, and aligns three with the core it installed.
    for (const env of [
      { PATH: installer },
      {
        PATH: `${installer}${path.delimiter}${process.env.PATH}`,
        FAKE_NPM_OFFLINE: '1',
      },
    ]) {
      const projectRoot = await projectWithCore('9.0.0', v1, declared);
      const context = io(projectRoot);
      const result = await withEnv(env, () =>
        handleUpgrade({ to: '9.1.0' }, context.io),
      );
      const packageJson = await readPackageJson(projectRoot);
      expect(packageJson.dependencies).toEqual({
        '@iwsdk/core': '9.1.0',
        three: 'npm:super-three@0.186.0',
      });
      expect(packageJson.overrides.three).toBe('npm:super-three@0.186.0');
      expect(
        (await readFile(path.join(projectRoot, 'installs.log'), 'utf8'))
          .trim()
          .split('\n'),
      ).toHaveLength(2);
      expect(context.stderr.join('')).toMatch(
        /\[IWSDK\] Could not check .+ for IWSDK 9\.1\.0 \(.+\); upgrading without it\./u,
      );
      expect(result.data.manualSteps.join('\n')).not.toContain(
        'Could not check',
      );
    }

    // Without an install, three waits, and the upgrade says how to finish.
    const notInstalled = await projectWithCore('9.0.0', v1, declared);
    const notInstalledIo = io(notInstalled);
    const result = await withEnv({ PATH: await tempDir('iwsdk-nonpm-') }, () =>
      handleUpgrade({ to: '9.1.0', noInstall: true }, notInstalledIo.io),
    );
    expect((await readPackageJson(notInstalled)).dependencies).toEqual({
      '@iwsdk/core': '9.1.0',
      three: 'npm:super-three@0.170.0',
    });
    expect(result.data.manualSteps).toEqual([
      'Could not check the registry for IWSDK 9.1.0 (npm could not start: spawn npm ENOENT), so three was left as declared: run `npx @iwsdk/cli@latest upgrade --to 9.1.0` again, without --no-install, to align it with the new @iwsdk/core.',
    ]);
    // Not also "install, then agents sync", which leaves three as declared.
    expect(result.data.guidance).toEqual({
      status: 'pending',
      message: 'Dependencies were not installed.',
    });
    expect(notInstalledIo.stderr.join('')).not.toContain('agents sync');

    // A failed install points at upgrade again, which still aligns three.
    const failing = await projectWithCore('9.0.0', v1, declared);
    const failBin = await tempDir('iwsdk-failpm-');
    await writeFile(
      path.join(failBin, 'pnpm'),
      `#!${process.execPath}\nprocess.exit(1);\n`,
    );
    await chmod(path.join(failBin, 'pnpm'), 0o755);
    await withEnv(
      {
        PATH: `${failBin}${path.delimiter}${process.env.PATH}`,
        FAKE_NPM_OFFLINE: '1',
      },
      () =>
        expect(handleUpgrade({ to: '9.1.0' }, io(failing).io)).rejects.toThrow(
          'Fix the error, then run `npx @iwsdk/cli@latest upgrade --to 9.1.0` again: three still has to be aligned with the new @iwsdk/core.',
        ),
    );
  }, 30_000);

  test('does not ask the registry when no release package comes from it', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1, {
      dependencies: {
        '@iwsdk/core': 'file:../iwsdk-core.tgz',
        three: 'npm:super-three@0.170.0',
      },
      devDependencies: { '@iwsdk/cli': 'workspace:*' },
    });
    const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
    const context = io(projectRoot);
    const result = await withEnv({ FAKE_NPM_LOG: log }, () =>
      handleUpgrade({ to: '9.1.0', dryRun: true }, context.io),
    );
    expect(await loggedCalls(log)).toEqual([]);
    expect(context.stderr.join('')).not.toContain('Checking');
    expect(result.data.packages).toEqual([]);
    expect(result.data.manualSteps[0]).toContain(
      'Left @iwsdk/core@file:../iwsdk-core.tgz, @iwsdk/cli@workspace:* as declared',
    );
  });

  test('asks the registry the workspace root configures, as the install does', async () => {
    // A pnpm monorepo whose root .npmrc points at a mirror; the app has none.
    const workspace = await tempDir('iwsdk-npmrc-workspace-');
    await mkdir(path.join(workspace, '.git'));
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'monorepo', private: true }),
    );
    await writeFile(
      path.join(workspace, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n',
    );
    await writeFile(
      path.join(workspace, '.npmrc'),
      'registry=http://mirror.test/\n',
    );
    const app = path.join(workspace, 'apps/xr');
    await mkdir(app, { recursive: true });
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ name: 'xr', dependencies: { '@iwsdk/core': '9.0.0' } }),
    );
    await installCore(app, '9.0.0', v1);
    const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
    const context = io(app);
    await withEnv({ FAKE_NPM_LOG: log }, () =>
      handleUpgrade({ to: '9.1.0', dryRun: true }, context.io),
    );
    expect(context.stderr.join('')).toContain(
      '[IWSDK] Checking http://mirror.test/ for IWSDK 9.1.0 ...',
    );
    const calls = await loggedCalls(log);
    expect(calls.map((call) => call.args[0])).toEqual(['config', 'view']);
    for (const call of calls) {
      expect(call.cwd).toBe(realpathSync(workspace));
    }
  });

  test('asks the registry an app’s own .npmrc sets, as pnpm does', async () => {
    // A pnpm monorepo whose root .npmrc points at a mirror. Its package.json
    // also declares workspaces, which npm would follow up from the app.
    const workspace = await tempDir('iwsdk-app-npmrc-');
    await mkdir(path.join(workspace, '.git'));
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        name: 'monorepo',
        private: true,
        workspaces: ['apps/*'],
      }),
    );
    await writeFile(
      path.join(workspace, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n',
    );
    await writeFile(
      path.join(workspace, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\n",
    );
    await writeFile(
      path.join(workspace, '.npmrc'),
      'registry=http://root-mirror.test/\n',
    );
    const app = path.join(workspace, 'apps/xr');
    await mkdir(app, { recursive: true });
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ name: 'xr', dependencies: { '@iwsdk/core': '9.0.0' } }),
    );
    await installCore(app, '9.0.0', v1);
    const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');

    // pnpm installs with the root's registry when the app's .npmrc sets
    // other things.
    await writeFile(path.join(app, '.npmrc'), 'auto-install-peers=true\n');
    const other = io(app);
    await withEnv({ FAKE_NPM_LOG: log }, () =>
      handleUpgrade({ to: '9.1.0', dryRun: true }, other.io),
    );
    expect(other.stderr.join('')).toContain(
      '[IWSDK] Checking http://root-mirror.test/ for IWSDK 9.1.0 ...',
    );
    expect(new Set((await loggedCalls(log)).map((call) => call.cwd))).toEqual(
      new Set([realpathSync(workspace)]),
    );

    // It installs from the app's own registry when that sets one, so a
    // release missing there stops the upgrade, though the root's has it.
    // npm runs in the root, which sets a registry too, and gets the app's.
    await rm(log);
    await writeFile(
      path.join(app, '.npmrc'),
      'registry=http://app-mirror.test/\n',
    );
    await expect(
      withEnv(
        { FAKE_NPM_LOG: log, FAKE_NPM_BEHIND: 'http://app-mirror.test/' },
        () => handleUpgrade({ to: '9.1.0', dryRun: true }, io(app).io),
      ),
    ).rejects.toMatchObject({
      code: 'release_not_on_registry',
      message: expect.stringMatching(
        /^http:\/\/app-mirror\.test\/ does not have @iwsdk\/core@9\.1\.0 \(E404: No match found for version 9\.1\.0\)\./u,
      ),
    });
    const calls = await loggedCalls(log);
    expect(calls.map((call) => call.args[0])).toEqual([
      'config',
      'view',
      'view',
    ]);
    for (const call of calls) {
      expect(call.cwd).toBe(realpathSync(workspace));
      expect(call.args).toContain('--no-workspaces');
      expect(call.registry).toBe('http://app-mirror.test/');
    }
    // With no registry in the root's .npmrc, npm runs in the app.
    await rm(log);
    await writeFile(path.join(workspace, '.npmrc'), 'shamefully-hoist=true\n');
    await expect(
      withEnv(
        { FAKE_NPM_LOG: log, FAKE_NPM_BEHIND: 'http://app-mirror.test/' },
        () => handleUpgrade({ to: '9.1.0', dryRun: true }, io(app).io),
      ),
    ).rejects.toMatchObject({ code: 'release_not_on_registry' });
    for (const call of await loggedCalls(log)) {
      expect(call.cwd).toBe(realpathSync(app));
      expect(call.args).toContain('--no-workspaces');
    }
  });

  /**
   * A pnpm monorepo app whose upgrade, a dry run, runs with these root and
   * app .npmrc files and variables, and finds the release.
   */
  async function upgradeWithNpmrcs() {
    const workspace = await tempDir('iwsdk-merged-npmrc-');
    await mkdir(path.join(workspace, '.git'));
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'monorepo', private: true }),
    );
    await writeFile(
      path.join(workspace, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n',
    );
    await writeFile(
      path.join(workspace, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\n",
    );
    const app = path.join(workspace, 'apps/xr');
    await mkdir(app, { recursive: true });
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({
        name: 'xr',
        dependencies: {
          '@iwsdk/core': '9.0.0',
          three: 'npm:super-three@0.170.0',
        },
      }),
    );
    await installCore(app, '9.0.0', v1);
    return async (
      rootNpmrc: string,
      appNpmrc: string,
      env: Record<string, string>,
    ) => {
      await writeFile(path.join(workspace, '.npmrc'), rootNpmrc);
      await writeFile(path.join(app, '.npmrc'), appNpmrc);
      const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
      const context = io(app);
      const result = await withEnv({ ...env, FAKE_NPM_LOG: log }, () =>
        handleUpgrade({ to: '9.1.0', dryRun: true }, context.io),
      );
      expect(result.data.packages).toContainEqual({
        field: 'dependencies',
        name: 'three',
        from: 'npm:super-three@0.170.0',
        to: 'npm:super-three@0.186.0',
      });
      return {
        stderr: context.stderr.join(''),
        views: (await loggedCalls(log)).filter(
          (call) => call.args[0] === 'view',
        ),
      };
    };
  }

  test('takes the @iwsdk registry a workspace root’s .npmrc sets over an app’s registry, as pnpm does', async () => {
    // pnpm merges the app's .npmrc over the root's setting by setting: the
    // app's registry, which lacks the release, serves other packages only.
    const upgrade = await upgradeWithNpmrcs();
    const scoped = await upgrade(
      '@iwsdk:registry=http://root-mirror.test/\n',
      'registry=http://app-mirror.test/\n',
      { FAKE_NPM_BEHIND: 'http://app-mirror.test/' },
    );
    expect(scoped.stderr).toContain(
      '[IWSDK] Checking http://root-mirror.test/ for IWSDK 9.1.0 ...',
    );
    expect(scoped.views.map((call) => call.registry)).toEqual([
      'http://root-mirror.test/',
    ]);
  });

  test('uses the tokens of a workspace root’s .npmrc and an app’s own, as pnpm does', async () => {
    // A registry that shows its packages only to those with a token. The
    // root holds the token for the registry the app sets.
    const upgrade = await upgradeWithNpmrcs();
    const rootToken = await upgrade(
      '//app-mirror.test/:_authToken=root-token\n',
      'registry=http://app-mirror.test/\n',
      { FAKE_NPM_PRIVATE: 'http://app-mirror.test/' },
    );
    expect(rootToken.views.map((call) => [call.registry, call.token])).toEqual([
      ['http://app-mirror.test/', 'root-token'],
    ]);

    // The app sets the scope's registry (quoted) and its token (with a
    // comment), then a [section], which holds no settings; the root sets a
    // default registry and a token for that.
    const appToken = await upgrade(
      'registry=http://root-mirror.test/\n//root-mirror.test/:_authToken=root-token\n',
      '@iwsdk:registry = "http://app-mirror.test/"\n//app-mirror.test/:_authToken=app-token ; for CI\n[section]\nregistry=http://section.test/\n',
      { FAKE_NPM_PRIVATE: 'http://app-mirror.test/,http://root-mirror.test/' },
    );
    expect(appToken.stderr).toContain(
      '[IWSDK] Checking http://app-mirror.test/ for IWSDK 9.1.0 ...',
    );
    expect(appToken.views.map((call) => [call.registry, call.token])).toEqual([
      ['http://app-mirror.test/', 'app-token'],
    ]);
    expect(appToken.stderr).not.toContain('app-token');

    // npm_config_registry still wins over the app's registry, as with pnpm.
    const fromEnvironment = await upgrade(
      '//env-mirror.test/:_authToken=root-token\n',
      'registry=http://app-mirror.test/\n',
      {
        npm_config_registry: 'http://env-mirror.test/',
        FAKE_NPM_PRIVATE: 'http://env-mirror.test/',
      },
    );
    expect(fromEnvironment.stderr).toContain(
      '[IWSDK] Checking http://env-mirror.test/ for IWSDK 9.1.0 ...',
    );
    expect(
      fromEnvironment.views.map((call) => [call.registry, call.token]),
    ).toEqual([['http://env-mirror.test/', 'root-token']]);
  });

  test('asks an npm workspace’s root registry, as npm install does', async () => {
    // npm installs a workspace package with the workspace root's .npmrc and
    // ignores the package's own.
    const workspace = await tempDir('iwsdk-npm-workspace-');
    await mkdir(path.join(workspace, '.git'));
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        name: 'monorepo',
        private: true,
        workspaces: ['apps/*'],
      }),
    );
    await writeFile(
      path.join(workspace, '.npmrc'),
      'registry=http://root-mirror.test/\n',
    );
    const app = path.join(workspace, 'apps/xr');
    await mkdir(app, { recursive: true });
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({
        name: 'xr',
        dependencies: {
          '@iwsdk/core': '9.0.0',
          three: 'npm:super-three@0.170.0',
        },
      }),
    );
    await writeFile(
      path.join(app, '.npmrc'),
      'registry=http://app-mirror.test/\n',
    );
    await installCore(app, '9.0.0', v1);
    const check = async () => {
      const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
      const context = io(app);
      const result = await withEnv({ FAKE_NPM_LOG: log }, () =>
        handleUpgrade({ to: '9.1.0', dryRun: true }, context.io),
      );
      return {
        result,
        stderr: context.stderr.join(''),
        calls: await loggedCalls(log),
      };
    };
    // With the lockfile at the root, npm runs there.
    await writeFile(path.join(workspace, 'package-lock.json'), '{}');
    const locked = await check();
    expect(locked.stderr).toContain(
      '[IWSDK] Checking http://root-mirror.test/ for IWSDK 9.1.0 ...',
    );
    for (const call of locked.calls) {
      expect(call.cwd).toBe(realpathSync(workspace));
    }
    // Without one, npm runs in the app, where `npm config` refuses to
    // (ENOWORKSPACES). npm view still asks the root's registry, as npm
    // install there does, without naming it.
    await rm(path.join(workspace, 'package-lock.json'));
    const unlocked = await check();
    expect(unlocked.stderr).toContain(
      "[IWSDK] Checking npm's configured registry for IWSDK 9.1.0 ...",
    );
    expect(
      unlocked.calls
        .filter((call) => call.args[0] === 'view')
        .map((call) => call.registry),
    ).toEqual(['http://root-mirror.test/']);
    expect(unlocked.result.data.packages).toContainEqual({
      field: 'dependencies',
      name: 'three',
      from: 'npm:super-three@0.170.0',
      to: 'npm:super-three@0.186.0',
    });
  });

  test('asks Yarn, with its own registry settings, in a Yarn 2+ project', async () => {
    // A stand-in yarn for `yarn config get` and `yarn npm info`, reading
    // npmRegistryServer from .yarnrc.yml. Like Yarn, it answers with the
    // latest version when the registry does not have the one asked for.
    const bin = await tempDir('iwsdk-fakeyarn-');
    await writeFile(
      path.join(bin, 'yarn'),
      `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_YARN_LOG, JSON.stringify({ cwd: process.cwd(), args, retry: process.env.YARN_HTTP_RETRY }) + '\\n');
// Yarn 1 answers "undefined" for settings it does not have.
const registry = fs.readFileSync('.yarnrc.yml', 'utf8').match(/^npmRegistryServer: "(.*)"$/m)?.[1] ?? 'undefined';
if (args[0] === 'config') {
  console.log(args[2] === 'npmScopes' ? 'undefined' : registry);
} else {
  const spec = args[2];
  const name = spec.slice(0, spec.lastIndexOf('@'));
  const version = (process.env.FAKE_YARN_MISSING ?? '').split(',').includes(spec) ? '9.0.0' : spec.slice(spec.lastIndexOf('@') + 1);
  console.log(JSON.stringify({ name, 'dist-tags': { latest: '9.0.0' }, versions: ['9.0.0', version], version, dependencies: { three: 'npm:super-three@0.187.0', '@types/three': '^0.187.0' } }));
}
`,
    );
    await chmod(path.join(bin, 'yarn'), 0o755);
    const projectRoot = await projectWithCore('9.0.0', v1, {
      packageManager: 'yarn@4.9.2',
      dependencies: {
        '@iwsdk/core': '9.0.0',
        three: 'npm:super-three@0.170.0',
      },
    });
    await writeFile(
      path.join(projectRoot, '.yarnrc.yml'),
      'npmRegistryServer: "https://yarn-mirror.test"\n',
    );
    const npmLog = path.join(bin, 'npm.log');
    const yarnLog = path.join(bin, 'yarn.log');
    await withEnv(
      {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        FAKE_NPM_LOG: npmLog,
        FAKE_YARN_LOG: yarnLog,
        FAKE_YARN_MISSING: undefined,
      },
      async () => {
        const context = io(projectRoot);
        const result = await handleUpgrade(
          { to: '9.1.0', dryRun: true },
          context.io,
        );
        expect(result.data.packages).toContainEqual({
          field: 'dependencies',
          name: 'three',
          from: 'npm:super-three@0.170.0',
          to: 'npm:super-three@0.187.0',
        });
        expect(context.stderr.join('')).toContain(
          '[IWSDK] Checking https://yarn-mirror.test for IWSDK 9.1.0 ...',
        );
        expect(await loggedCalls(npmLog)).toEqual([]);
        expect(await loggedCalls(yarnLog)).toContainEqual({
          cwd: realpathSync(projectRoot),
          args: ['npm', 'info', '@iwsdk/core@9.1.0', '--json'],
          retry: '1',
        });
        process.env.FAKE_YARN_MISSING = '@iwsdk/core@9.1.0';
        await expect(
          handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
        ).rejects.toMatchObject({
          code: 'release_not_on_registry',
          message: expect.stringContaining(
            'https://yarn-mirror.test does not have @iwsdk/core@9.1.0 (No match found for version 9.1.0). Nothing was changed.',
          ),
        });
        // A Yarn that names no registry is not asked.
        await writeFile(path.join(projectRoot, '.yarnrc.yml'), '');
        const unnamed = await handleUpgrade(
          { to: '9.1.0', dryRun: true },
          io(projectRoot).io,
        );
        expect(unnamed.data.manualSteps).toContain(
          'Could not check the registry for IWSDK 9.1.0 (yarn reported no registry URL ("undefined")): three alignment will be decided after install.',
        );
      },
    );
  });

  test('asks the registry Yarn 1 installs from, which .yarnrc can set', async () => {
    // A stand-in Yarn 1 for `yarn config list --json`: Yarn's settings (its
    // defaults and .yarnrc), then npm's (.npmrc), as Yarn 1 prints them.
    const bin = await tempDir('iwsdk-fakeyarn1-');
    await writeFile(
      path.join(bin, 'yarn'),
      `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_YARN_LOG, JSON.stringify({ cwd: process.cwd(), args }) + '\\n');
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const yarnRegistry = read('.yarnrc').match(/^registry "(.*)"$/m)?.[1];
const npmRegistry = read('.npmrc').match(/^registry=(.*)$/m)?.[1];
if (args.join(' ') !== 'config list --json') {
  process.exit(2);
}
for (const line of [
  { type: 'warning', data: 'package.json: No license field' },
  { type: 'info', data: 'yarn config' },
  { type: 'inspect', data: { 'version-tag-prefix': 'v', registry: yarnRegistry ?? 'https://registry.yarnpkg.com' } },
  { type: 'info', data: 'npm config' },
  { type: 'inspect', data: npmRegistry ? { registry: npmRegistry } : {} },
]) {
  console.log(JSON.stringify(line));
}
`,
    );
    await chmod(path.join(bin, 'yarn'), 0o755);
    const projectRoot = await projectWithCore('9.0.0', v1, {
      packageManager: 'yarn@1.22.22',
      dependencies: {
        '@iwsdk/core': '9.0.0',
        three: 'npm:super-three@0.170.0',
      },
    });
    await writeFile(
      path.join(projectRoot, 'yarn.lock'),
      '# yarn lockfile v1\n',
    );
    await writeFile(
      path.join(projectRoot, '.yarnrc'),
      'registry "https://yarn1-mirror.test/"\n',
    );
    const npmLog = path.join(bin, 'npm.log');
    const yarnLog = path.join(bin, 'yarn.log');
    await withEnv(
      {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        FAKE_NPM_LOG: npmLog,
        FAKE_YARN_LOG: yarnLog,
      },
      async () => {
        // The mirror .yarnrc names lacks the release; npm's default has it.
        await expect(
          withEnv({ FAKE_NPM_BEHIND: 'https://yarn1-mirror.test/' }, () =>
            handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
          ),
        ).rejects.toMatchObject({
          code: 'release_not_on_registry',
          message: expect.stringContaining(
            'https://yarn1-mirror.test/ does not have @iwsdk/core@9.1.0 (E404: No match found for version 9.1.0). Nothing was changed. A registry mirror can lag behind a release: upgrade once it has IWSDK 9.1.0, or point the project at a registry that does (the npm_config_registry environment variable overrides the configured one).',
          ),
        });
        expect(await loggedCalls(yarnLog)).toEqual([
          {
            cwd: realpathSync(projectRoot),
            args: ['config', 'list', '--json'],
          },
        ]);
        const views = (await loggedCalls(npmLog)).filter(
          (call) => call.args[0] === 'view',
        );
        expect(views.map((call) => call.registry)).toEqual([
          'https://yarn1-mirror.test/',
          'https://yarn1-mirror.test/',
        ]);
        // Yarn 1 takes an .npmrc registry over the .yarnrc one, and without
        // either, its own default.
        await writeFile(
          path.join(projectRoot, '.npmrc'),
          'registry=https://npm-mirror.test/\n',
        );
        const fromNpmrc = io(projectRoot);
        await handleUpgrade({ to: '9.1.0', dryRun: true }, fromNpmrc.io);
        expect(fromNpmrc.stderr.join('')).toContain(
          '[IWSDK] Checking https://npm-mirror.test/ for IWSDK 9.1.0 ...',
        );
        await rm(path.join(projectRoot, '.npmrc'));
        await rm(path.join(projectRoot, '.yarnrc'));
        const unset = io(projectRoot);
        await handleUpgrade({ to: '9.1.0', dryRun: true }, unset.io);
        expect(unset.stderr.join('')).toContain(
          '[IWSDK] Checking https://registry.yarnpkg.com for IWSDK 9.1.0 ...',
        );
      },
    );
  });

  test('asks a registry whose URL carries credentials, without printing them', async () => {
    // npm will not print this URL with `npm config get` ("option is
    // protected"); `npm config ls` prints it with the password hidden, before
    // the publishConfig registry. The password holds an unencoded @.
    const projectRoot = await projectWithCore('9.0.0', v1, {
      publishConfig: { registry: 'https://publish.test/' },
    });
    await writeFile(
      path.join(projectRoot, '.npmrc'),
      'registry=https://ci:s3@cret@mirror.test/\n',
    );
    const missing = io(projectRoot);
    await expect(
      withEnv({ FAKE_NPM_MISSING: '@iwsdk/core@9.1.0' }, () =>
        handleUpgrade({ to: '9.1.0', dryRun: true }, missing.io),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^https:\/\/\*\*\*@mirror\.test\/ /u),
      details: { registry: 'https://***@mirror.test/' },
    });
    expect(missing.stderr.join('')).toContain(
      '[IWSDK] Checking https://***@mirror.test/ for IWSDK 9.1.0 ...',
    );
    const offline = await withEnv({ FAKE_NPM_OFFLINE: '1' }, () =>
      handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
    );
    expect(offline.data.manualSteps.join('\n')).toContain(
      'request to https://***@mirror.test/ failed',
    );
    // When npm names no registry at all, npm view still asks the one it uses.
    const unnamed = io(projectRoot);
    await expect(
      withEnv(
        {
          FAKE_NPM_MISSING: '@iwsdk/core@9.1.0',
          FAKE_NPM_CONFIG_LS_FAILS: '1',
        },
        () => handleUpgrade({ to: '9.1.0', dryRun: true }, unnamed.io),
      ),
    ).rejects.toMatchObject({
      code: 'release_not_on_registry',
      message: expect.stringMatching(
        /^npm's configured registry does not have @iwsdk\/core@9\.1\.0 /u,
      ),
    });
    expect(unnamed.stderr.join('')).toContain(
      "[IWSDK] Checking npm's configured registry for IWSDK 9.1.0 ...",
    );
    const printed = `${missing.stderr.join('')}${unnamed.stderr.join('')}${offline.data.manualSteps.join('\n')}`;
    expect(printed).not.toContain('s3@');
    expect(printed).not.toContain('cret');
  });

  test('leaves three alone when the new core does not depend on it', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1, {
      dependencies: {
        '@iwsdk/core': '9.0.0',
        three: 'npm:super-three@0.170.0',
      },
      devDependencies: { '@types/three': '^0.170.0' },
    });
    const result = await withEnv(
      { FAKE_NPM_CORE_DEPENDENCIES: '{"elics":"^3.4.1"}' },
      () => handleUpgrade({ to: '9.1.0', noInstall: true }, io(projectRoot).io),
    );
    expect(result.data.packages.map((bump) => bump.name)).toEqual([
      '@iwsdk/core',
    ]);
    expect(
      JSON.parse(
        await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
      ),
    ).toMatchObject({
      dependencies: { three: 'npm:super-three@0.170.0' },
      devDependencies: { '@types/three': '^0.170.0' },
    });
  });

  test('bounds the registry lookup and goes on without an answer', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1);
    const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
    await withEnv({ FAKE_NPM_LOG: log }, () =>
      handleUpgrade({ to: '9.1.0', dryRun: true }, io(projectRoot).io),
    );
    expect(
      (await loggedCalls(log)).find((call) => call.args[0] === 'view')?.args,
    ).toEqual(
      expect.arrayContaining(['--fetch-retries=1', '--fetch-timeout=10000']),
    );
    // An npm that never answers is stopped, and the upgrade goes on.
    const started = Date.now();
    const check = await withEnv({ FAKE_NPM_HANG: '1' }, () =>
      checkRegistry({
        names: ['@iwsdk/core'],
        version: '9.1.0',
        client: 'npm',
        cwd: projectRoot,
        stderr: io(projectRoot).io.stderr,
        timeoutMs: 500,
      }),
    );
    expect(check).toEqual({
      status: 'unavailable',
      registry: 'https://registry.npmjs.org/',
      reason: 'npm did not answer within 0.5 s',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('takes --to v9.1.0 as 9.1.0', async () => {
    const projectRoot = await projectWithCore('9.0.0', v1, {
      dependencies: { '@iwsdk/core': '^9.0.0' },
    });
    const log = path.join(await tempDir('iwsdk-npmlog-'), 'npm.log');
    const result = await withEnv({ FAKE_NPM_LOG: log }, () =>
      handleUpgrade({ to: 'v9.1.0', noInstall: true }, io(projectRoot).io),
    );
    expect(result.data.to).toBe('9.1.0');
    expect(
      JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
        .dependencies['@iwsdk/core'],
    ).toBe('^9.1.0');
    expect((await loggedCalls(log)).map((call) => call.args[1])).toContain(
      '@iwsdk/core@9.1.0',
    );
  });

  test('warns when a ^ range can install a newer core than three was aligned with', async () => {
    const upgrade = async (spec: string, options: CliOptions) => {
      const projectRoot = await projectWithCore('9.0.0', v1, {
        dependencies: {
          '@iwsdk/core': spec,
          three: 'npm:super-three@0.170.0',
        },
      });
      const result = await withEnv({ FAKE_NPM_NEWER: '9.2.0,9.3.0-rc.0' }, () =>
        handleUpgrade({ to: '9.1.0', ...options }, io(projectRoot).io),
      );
      return result.data.manualSteps.join('\n');
    };
    const warning =
      '@iwsdk/core ^9.1.0 also matches 9.2.0, which an install can pick instead of 9.1.0, and three was aligned with 9.1.0. Pin @iwsdk/core to 9.1.0, or if 9.2.0 is installed, run `npx @iwsdk/cli@latest upgrade --to 9.2.0`.';
    expect(await upgrade('^9.0.0', { noInstall: true })).toContain(warning);
    expect(
      await upgrade('^9.0.0', { noInstall: true, dryRun: true }),
    ).toContain(warning);
    // A pinned core cannot move; an install aligns three with what it brings.
    expect(await upgrade('9.0.0', { noInstall: true })).not.toContain(
      'also matches',
    );
    expect(await upgrade('^9.0.0', { dryRun: true })).not.toContain(
      'also matches',
    );
  });

  test.skipIf(process.platform === 'win32')(
    'runs npm on Windows as one command line, without DEP0190',
    async () => {
      const projectRoot = await projectWithCore('9.0.0', v1, {
        dependencies: {
          '@iwsdk/core': '9.0.0',
          three: 'npm:super-three@0.170.0',
        },
      });
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
      const warnings: string[] = [];
      const onWarning = (warning: Error & { code?: string }) => {
        warnings.push(warning.code ?? warning.message);
      };
      process.on('warning', onWarning);
      try {
        // Node runs a Windows shell command with %ComSpec%; /bin/sh stands
        // in for cmd.exe.
        const result = await withEnv({ comspec: '/bin/sh' }, async () => {
          Object.defineProperty(process, 'platform', {
            ...platform,
            value: 'win32',
          });
          try {
            return await handleUpgrade(
              { to: '9.1.0', dryRun: true },
              io(projectRoot).io,
            );
          } finally {
            Object.defineProperty(process, 'platform', platform);
          }
        });
        expect(result.data.packages).toContainEqual({
          field: 'dependencies',
          name: 'three',
          from: 'npm:super-three@0.170.0',
          to: 'npm:super-three@0.186.0',
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(warnings).not.toContain('DEP0190');
      } finally {
        process.off('warning', onWarning);
      }
    },
  );

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
    // Unlike dev up, upgrade installs the full set, so a removed skill returns.
    const uiSkill = path.join(projectRoot, '.claude/skills/iwsdk-ui/SKILL.md');
    expect(existsSync(uiSkill)).toBe(true);
    await rm(path.dirname(uiSkill), { recursive: true });
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
      // three came from the registry's core before the install, so the
      // installed core asks for no second one.
      expect(
        (await readFile(path.join(projectRoot, 'installs.log'), 'utf8'))
          .trim()
          .split('\n'),
      ).toHaveLength(1);
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
      expect(existsSync(uiSkill)).toBe(true);
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

  test('releases the published packages of the changeset fixed group', async () => {
    const root = path.resolve(TEST_DIR, '..', '..', '..');
    const config = JSON.parse(
      await readFile(path.join(root, '.changeset', 'config.json'), 'utf8'),
    );
    const published: string[] = [];
    for (const name of config.fixed[0] as string[]) {
      const manifest = JSON.parse(
        await readFile(
          path.join(
            root,
            'packages',
            name.replace('@iwsdk/', ''),
            'package.json',
          ),
          'utf8',
        ),
      );
      // Private packages (reference-assets) are never on npm, so upgrade
      // must not point a project at them.
      if (!manifest.private) {
        published.push(name);
      }
    }
    expect([...RELEASED_PACKAGES].sort()).toEqual(published.sort());
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
