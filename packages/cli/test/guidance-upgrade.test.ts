/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
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
  directoryUnitHash,
  fileUnitHash,
  loadGuidanceSource,
  syncAgentGuidance,
  type GuidanceSource,
  type GuidanceUnitResult,
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
