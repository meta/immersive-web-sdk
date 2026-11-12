/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import {
  cp,
  lstat,
  symlink,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { syncAgentAdapters } from '../src/agent-adapters.js';
import {
  blockUnitHash,
  directoryUnitHash,
  fileUnitHash,
  findGuidanceProjectRoot,
  GuidanceSourceError,
  installedGuidanceTools,
  loadGuidanceSource,
  resolveProjectGuidance,
  syncAgentGuidance,
  type GuidanceSource,
  type SyncAgentGuidanceResult,
} from '../src/agent-guidance.js';

const CORE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
);

const CLI_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../dist/cli.js',
);

/**
 * Run the built CLI without the NODE_PATH pnpm gives the test runner, which
 * would resolve this workspace's @iwsdk/core from any directory.
 */
function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '' },
  });
}

const tempDirs: string[] = [];
let sharedTempDirs = 0;
let source: GuidanceSource;

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

/** Render a copy of @iwsdk/core's guidance, optionally edited first. */
async function renderGuidance({
  version,
  edit,
}: {
  version?: string;
  edit?: (guidanceRoot: string) => Promise<void>;
} = {}): Promise<GuidanceSource> {
  const fakeCore = await tempDir('iwsdk-fake-core-');
  await cp(path.join(CORE_ROOT, 'scripts'), path.join(fakeCore, 'scripts'), {
    recursive: true,
  });
  await cp(
    path.join(CORE_ROOT, 'agent-guidance'),
    path.join(fakeCore, 'agent-guidance'),
    { recursive: true },
  );
  const packageJson = JSON.parse(
    await readFile(path.join(CORE_ROOT, 'package.json'), 'utf8'),
  );
  if (version) {
    packageJson.version = version;
  }
  await writeFile(
    path.join(fakeCore, 'package.json'),
    JSON.stringify(packageJson),
  );
  await edit?.(path.join(fakeCore, 'agent-guidance'));
  const output = path.join(fakeCore, 'dist', 'agent-guidance');
  execFileSync(process.execPath, [
    path.join(fakeCore, 'scripts', 'build-agent-guidance.mjs'),
    output,
  ]);
  return loadGuidanceSource(output);
}

async function projectFixture(packageJson: object = { name: 'app' }) {
  const projectRoot = await tempDir('iwsdk-guidance-project-');
  await writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  return projectRoot;
}

function actions(result: SyncAgentGuidanceResult): Record<string, string> {
  return Object.fromEntries(
    result.results.map((entry) => [
      entry.path,
      entry.reason ? `${entry.action}:${entry.reason}` : entry.action,
    ]),
  );
}

async function readTree(
  root: string,
  relative = '',
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [key, value] of await readTree(root, childRelative)) {
        files.set(key, value);
      }
    } else {
      files.set(
        childRelative,
        await readFile(path.join(root, childRelative), 'utf8'),
      );
    }
  }
  return files;
}

beforeAll(async () => {
  source = await renderGuidance();
  sharedTempDirs = tempDirs.length;
}, 30_000);

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(sharedTempDirs)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('rendered guidance format', () => {
  test('the CLI computes the same hashes the core renderer stamped', async () => {
    const files = path.join(source.root, 'files');
    for (const unit of source.manifest.units) {
      if (unit.kind === 'directory') {
        const tree = await readTree(path.join(files, unit.path));
        expect(directoryUnitHash(tree), unit.path).toBe(unit.sha256);
        expect(tree.get('SKILL.md'), unit.path).toContain(
          `sha256=${unit.sha256}`,
        );
      } else if (unit.kind === 'file') {
        const text = await readFile(path.join(files, unit.path), 'utf8');
        expect(fileUnitHash(text), unit.path).toBe(unit.sha256);
        expect(text, unit.path).toContain(`sha256=${unit.sha256}`);
      } else if (unit.kind === 'block') {
        const text = await readFile(path.join(files, unit.path), 'utf8');
        const body = text.split('\n').slice(1, -2).join('\n');
        expect(blockUnitHash(body), unit.path).toBe(unit.sha256);
      }
    }
  });

  test('ships each skill to Claude Code and the portable tree with identical bytes', async () => {
    const skills = source.manifest.units.filter(
      (unit) => unit.kind === 'directory',
    );
    const claude = skills.filter((unit) => unit.path.startsWith('.claude/'));
    const portable = skills.filter((unit) => unit.path.startsWith('.agents/'));
    expect(claude.length).toBeGreaterThan(10);
    expect(portable.map((unit) => unit.path.slice('.agents/'.length))).toEqual(
      claude.map((unit) => unit.path.slice('.claude/'.length)),
    );
    for (const unit of claude) {
      const twin = portable.find(
        (candidate) =>
          candidate.path === unit.path.replace('.claude/', '.agents/'),
      )!;
      expect(twin.sha256).toBe(unit.sha256);
    }
  });

  test('the root block warns about surfaces that were removed in 0.5', async () => {
    const agents = await readFile(
      path.join(source.root, 'files', 'AGENTS.md'),
      'utf8',
    );
    expect(agents).toMatch(/^<!-- BEGIN iwsdk-agent-guidance version=/u);
    expect(agents).toContain('GLXF scenes, the external 0.4');
    expect(agents.trimEnd().endsWith('<!-- END iwsdk-agent-guidance -->')).toBe(
      true,
    );
  });
});

describe('syncAgentGuidance', () => {
  test('installs everything into an empty project, then reports it current', async () => {
    const projectRoot = await projectFixture();
    const first = await syncAgentGuidance({ projectRoot, source });
    expect(first.changed).toBe(true);
    expect(first.skipped).toEqual([]);
    expect(first.results.every((entry) => entry.action === 'created')).toBe(
      true,
    );
    expect(
      existsSync(path.join(projectRoot, '.claude/skills/iwsdk-dev/SKILL.md')),
    ).toBe(true);
    expect(
      existsSync(path.join(projectRoot, '.agents/skills/iwsdk-dev/SKILL.md')),
    ).toBe(true);
    expect(existsSync(path.join(projectRoot, 'src/AGENTS.md'))).toBe(true);
    expect(
      await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8'),
    ).toContain('@AGENTS.md');

    expect(first.agentNotice).toMatch(/^Installed IWSDK \S+ agent guidance/u);

    const second = await syncAgentGuidance({ projectRoot, source });
    expect(second.changed).toBe(false);
    expect(second.agentNotice).toContain(
      'already current; nothing was written',
    );
    expect(second.results.every((entry) => entry.action === 'unchanged')).toBe(
      true,
    );
  });

  test('the agent notice names the entry skill and lists every skill with its path', async () => {
    const projectRoot = await projectFixture();
    const result = await syncAgentGuidance({ projectRoot, source });
    expect(result.skills[0].name).toBe('iwsdk-dev');
    expect(result.skills[0].paths[0]).toBe('.claude/skills/iwsdk-dev/SKILL.md');
    expect(result.agentNotice).toContain('.claude/skills/iwsdk-dev/SKILL.md');
    expect(result.agentNotice).toContain('removed in 0.5');
    for (const skill of result.skills) {
      expect(skill.description.length, skill.name).toBeGreaterThan(20);
      expect(result.agentNotice).toContain(`- ${skill.name} (`);
    }
  });

  test('a dry run reports the same plan without writing', async () => {
    const projectRoot = await projectFixture();
    const plan = await syncAgentGuidance({ projectRoot, source, dryRun: true });
    expect(plan.changed).toBe(true);
    expect(await readdir(projectRoot)).toEqual(['package.json']);
  });

  test('adds a managed block to an existing AGENTS.md and keeps the developer text', async () => {
    const projectRoot = await projectFixture();
    await writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      '# Team rules\n\nUse tabs.\n',
    );
    const first = await syncAgentGuidance({ projectRoot, source });
    expect(actions(first)['AGENTS.md']).toBe('updated:appended');
    const agents = await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith('# Team rules\n\nUse tabs.\n\n<!-- BEGIN')).toBe(
      true,
    );

    // Text outside the block is the developer's; changing it is not drift.
    await writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      agents.replace('Use tabs.', 'Use spaces.'),
    );
    expect(
      actions(await syncAgentGuidance({ projectRoot, source }))['AGENTS.md'],
    ).toBe('unchanged');

    // Editing inside the block hands it to the developer.
    const edited = (
      await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')
    ).replace('## Layout', '## Layout (ours)');
    await writeFile(path.join(projectRoot, 'AGENTS.md'), edited);
    expect(
      actions(await syncAgentGuidance({ projectRoot, source }))['AGENTS.md'],
    ).toBe('skipped:modified');
    expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe(
      edited,
    );

    const forced = await syncAgentGuidance({
      projectRoot,
      source,
      force: true,
    });
    expect(actions(forced)['AGENTS.md']).toBe('updated:forced');
    const restored = await readFile(
      path.join(projectRoot, 'AGENTS.md'),
      'utf8',
    );
    expect(restored).toContain('Use spaces.');
    expect(restored).not.toContain('## Layout (ours)');
  });

  test('appends the AGENTS.md import to an existing CLAUDE.md', async () => {
    const projectRoot = await projectFixture();
    await writeFile(path.join(projectRoot, 'CLAUDE.md'), '# Notes\n');
    const result = await syncAgentGuidance({ projectRoot, source });
    expect(actions(result)['CLAUDE.md']).toBe('updated:appended');
    expect(await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe(
      '# Notes\n\n@AGENTS.md\n',
    );
  });

  test('leaves an edited skill alone until forced', async () => {
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source });
    const skillPath = path.join(
      projectRoot,
      '.claude/skills/iwsdk-ui/SKILL.md',
    );
    const edited = `${await readFile(skillPath, 'utf8')}\nOur house style: dark panels.\n`;
    await writeFile(skillPath, edited);

    const result = await syncAgentGuidance({ projectRoot, source });
    expect(actions(result)['.claude/skills/iwsdk-ui']).toBe('skipped:modified');
    expect(result.skipped.map((entry) => entry.path)).toEqual([
      '.claude/skills/iwsdk-ui',
    ]);
    expect(await readFile(skillPath, 'utf8')).toBe(edited);

    await syncAgentGuidance({ projectRoot, source, force: true });
    expect(await readFile(skillPath, 'utf8')).not.toContain('house style');
  });

  test('does not touch a same-named file that IWSDK did not write', async () => {
    const projectRoot = await projectFixture();
    await mkdir(path.join(projectRoot, '.claude/rules'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.claude/rules/ecs-api.md'),
      '# Our own ECS notes\n',
    );
    const result = await syncAgentGuidance({ projectRoot, source });
    expect(actions(result)['.claude/rules/ecs-api.md']).toBe(
      'skipped:unmanaged',
    );
  });

  test('upgrades guidance written by a release before stamps', async () => {
    const projectRoot = await projectFixture();
    const [skillUnit] = source.manifest.units.filter(
      (unit) => unit.path === '.claude/skills/iwsdk-debug',
    );
    const oldSkill = '---\nname: iwsdk-debug\ndescription: old\n---\n\nOld.\n';
    await mkdir(path.join(projectRoot, skillUnit.path), { recursive: true });
    await writeFile(
      path.join(projectRoot, skillUnit.path, 'SKILL.md'),
      oldSkill,
    );
    const oldAgents = '# IWSDK project\n\nOld guidance.\n';
    await writeFile(path.join(projectRoot, 'AGENTS.md'), oldAgents);
    const legacySource: GuidanceSource = {
      ...source,
      manifest: {
        ...source.manifest,
        legacy: {
          ...source.manifest.legacy,
          [skillUnit.path]: [
            directoryUnitHash(new Map([['SKILL.md', oldSkill]])),
          ],
          'AGENTS.md': [fileUnitHash(oldAgents)],
        },
      },
    };
    const result = await syncAgentGuidance({
      projectRoot,
      source: legacySource,
    });
    expect(actions(result)[skillUnit.path]).toBe('updated:legacy');
    expect(actions(result)['AGENTS.md']).toBe('updated:legacy');
    expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toMatch(
      /^<!-- BEGIN iwsdk-agent-guidance/u,
    );
  });

  test('keeps an edited pre-block IWSDK AGENTS.md instead of appending a second copy', async () => {
    const projectRoot = await projectFixture();
    await writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      '# IWSDK project\n\nOur edited copy of the old guidance.\n',
    );
    const result = await syncAgentGuidance({ projectRoot, source });
    expect(actions(result)['AGENTS.md']).toBe('skipped:legacy-modified');
  });

  test('replaces a released CLAUDE.md that carried the full guidance', async () => {
    const projectRoot = await projectFixture();
    const oldClaude = '# IWSDK project\n\nOld Claude guidance.\n';
    await writeFile(path.join(projectRoot, 'CLAUDE.md'), oldClaude);
    const result = await syncAgentGuidance({
      projectRoot,
      source: {
        ...source,
        manifest: {
          ...source.manifest,
          legacy: {
            ...source.manifest.legacy,
            'CLAUDE.md': [fileUnitHash(oldClaude)],
          },
        },
      },
    });
    expect(actions(result)['CLAUDE.md']).toBe('updated:legacy');
    expect(
      await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8'),
    ).toContain('@AGENTS.md');

    const editedProject = await projectFixture();
    await writeFile(
      path.join(editedProject, 'CLAUDE.md'),
      '# IWSDK project\n\nEdited old guidance.\n',
    );
    expect(
      actions(await syncAgentGuidance({ projectRoot: editedProject, source }))[
        'CLAUDE.md'
      ],
    ).toBe('skipped:legacy-modified');
  });

  test('the shipped legacy table covers files from released starters', () => {
    expect(source.manifest.legacy['AGENTS.md']?.length).toBeGreaterThan(0);
    expect(
      source.manifest.legacy['.claude/skills/iwsdk-planner']?.length,
    ).toBeGreaterThan(0);
  });

  test('upgrading replaces changed units, keeps edits, and removes retired skills', async () => {
    const v1 = await renderGuidance({
      version: '9.0.0',
      edit: async (root) => {
        await mkdir(path.join(root, 'claude/.claude/skills/iwsdk-retired'), {
          recursive: true,
        });
        await writeFile(
          path.join(root, 'claude/.claude/skills/iwsdk-retired/SKILL.md'),
          '---\nname: iwsdk-retired\ndescription: Retired in 9.1 and removed by sync.\n---\n\nRetired.\n',
        );
      },
    });
    const v2 = await renderGuidance({
      version: '9.1.0',
      edit: async (root) => {
        const skill = path.join(
          root,
          'claude/.claude/skills/iwsdk-grab/SKILL.md',
        );
        await writeFile(
          skill,
          `${await readFile(skill, 'utf8')}\nNew in 9.1.\n`,
        );
        const ui = path.join(root, 'claude/.claude/skills/iwsdk-ui/SKILL.md');
        await writeFile(
          ui,
          `${await readFile(ui, 'utf8')}\nAlso new in 9.1.\n`,
        );
      },
    });
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source: v1 });
    const uiPath = path.join(projectRoot, '.claude/skills/iwsdk-ui/SKILL.md');
    const editedUi = `${await readFile(uiPath, 'utf8')}\nTeam addition.\n`;
    await writeFile(uiPath, editedUi);
    const settingsBefore = JSON.parse(
      await readFile(path.join(projectRoot, '.claude/settings.json'), 'utf8'),
    );
    expect(settingsBefore.permissions.allow).toContain('Skill(iwsdk-retired)');

    const result = await syncAgentGuidance({ projectRoot, source: v2 });
    const byPath = actions(result);
    expect(byPath['.claude/skills/iwsdk-grab']).toBe('updated');
    expect(byPath['.agents/skills/iwsdk-grab']).toBe('updated');
    expect(byPath['.claude/skills/iwsdk-ui']).toBe('skipped:modified');
    expect(byPath['.agents/skills/iwsdk-ui']).toBe('updated');
    expect(byPath['.claude/skills/iwsdk-retired']).toBe('removed');
    expect(byPath['.agents/skills/iwsdk-retired']).toBe('removed');
    expect(byPath['.claude/skills/iwsdk-dev']).toBe('unchanged');
    expect(byPath['AGENTS.md']).toBe('unchanged');
    expect(
      await readFile(
        path.join(projectRoot, '.claude/skills/iwsdk-grab/SKILL.md'),
        'utf8',
      ),
    ).toContain('New in 9.1.');
    expect(await readFile(uiPath, 'utf8')).toBe(editedUi);
    expect(
      existsSync(path.join(projectRoot, '.claude/skills/iwsdk-retired')),
    ).toBe(false);
    const settingsAfter = JSON.parse(
      await readFile(path.join(projectRoot, '.claude/settings.json'), 'utf8'),
    );
    expect(settingsAfter.permissions.allow).not.toContain(
      'Skill(iwsdk-retired)',
    );
    expect(settingsAfter.permissions.allow).toContain('Skill(iwsdk-grab)');
  }, 30_000);

  test('an edited retired skill is kept and reported', async () => {
    const v1 = await renderGuidance({
      edit: async (root) => {
        await mkdir(path.join(root, 'claude/.claude/skills/iwsdk-retired'), {
          recursive: true,
        });
        await writeFile(
          path.join(root, 'claude/.claude/skills/iwsdk-retired/SKILL.md'),
          '---\nname: iwsdk-retired\ndescription: Retired.\n---\n\nRetired.\n',
        );
      },
    });
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source: v1 });
    const retired = path.join(
      projectRoot,
      '.claude/skills/iwsdk-retired/SKILL.md',
    );
    await writeFile(
      retired,
      `${await readFile(retired, 'utf8')}\nStill ours.\n`,
    );
    const result = await syncAgentGuidance({ projectRoot, source });
    expect(actions(result)['.claude/skills/iwsdk-retired']).toBe(
      'skipped:modified',
    );
    expect(existsSync(retired)).toBe(true);
  }, 30_000);

  test('only writes the selected tools, plus the shared AGENTS.md', async () => {
    const projectRoot = await projectFixture();
    const result = await syncAgentGuidance({
      projectRoot,
      source,
      tools: ['claude'],
    });
    expect(
      Object.keys(actions(result)).some((p) => p.startsWith('.agents/')),
    ).toBe(false);
    expect(existsSync(path.join(projectRoot, '.cursor'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'src/AGENTS.md'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.claude/skills/iwsdk-dev'))).toBe(
      true,
    );
  });

  test('merges skill permissions into existing Claude settings', async () => {
    const projectRoot = await projectFixture();
    await mkdir(path.join(projectRoot, '.claude'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.claude/settings.json'),
      JSON.stringify({
        model: 'opus',
        permissions: {
          allow: [
            'Bash(npm test)',
            'Skill(iwsdk-planner)',
            'Skill(iwsdk-mine)',
          ],
        },
      }),
    );
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    const settingsPath = path.join(projectRoot, '.claude/settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(settings.model).toBe('opus');
    expect(settings.permissions.allow).toContain('Bash(npm test)');
    expect(settings.permissions.allow).toContain('Skill(iwsdk-dev)');
    // A skill IWSDK retired loses its permission; the developer's own keeps it.
    expect(settings.permissions.allow).not.toContain('Skill(iwsdk-planner)');
    expect(settings.permissions.allow).toContain('Skill(iwsdk-mine)');

    // A permission the developer removed for an untouched skill stays removed.
    settings.permissions.allow = settings.permissions.allow.filter(
      (rule: string) => rule !== 'Skill(iwsdk-ui)',
    );
    await writeFile(settingsPath, JSON.stringify(settings));
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    expect(
      JSON.parse(await readFile(settingsPath, 'utf8')).permissions.allow,
    ).not.toContain('Skill(iwsdk-ui)');
  });

  test('skips settings that are not plain JSON and still writes everything else', async () => {
    const projectRoot = await projectFixture();
    await mkdir(path.join(projectRoot, '.claude'), { recursive: true });
    const jsonc = '{\n  // ours\n  "model": "opus"\n}\n';
    await writeFile(path.join(projectRoot, '.claude/settings.json'), jsonc);
    const result = await syncAgentGuidance({ projectRoot, source });
    const settings = result.results.find(
      (entry) => entry.path === '.claude/settings.json',
    );
    expect(settings).toMatchObject({
      action: 'skipped',
      reason: 'invalid-json',
    });
    expect(settings?.detail).toContain('.claude/settings.json');
    expect(
      await readFile(path.join(projectRoot, '.claude/settings.json'), 'utf8'),
    ).toBe(jsonc);
    expect(existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(
      existsSync(path.join(projectRoot, '.claude/skills/iwsdk-dev/SKILL.md')),
    ).toBe(true);
  });

  test('never touches broken guidance markers, even with --force', async () => {
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source });
    const agentsPath = path.join(projectRoot, 'AGENTS.md');
    const block = await readFile(agentsPath, 'utf8');
    const missingEnd = `${block.replace(/<!-- END iwsdk-agent-guidance -->\n/u, '')}\n# My notes\nkeep me\n`;
    for (const contents of [missingEnd, `${block}\n${block}`]) {
      await writeFile(agentsPath, contents);
      for (const force of [false, true]) {
        const result = await syncAgentGuidance({
          projectRoot,
          source,
          force,
          tools: ['claude'],
        });
        expect(
          result.results.find((entry) => entry.path === 'AGENTS.md'),
        ).toMatchObject({ action: 'skipped', reason: 'malformed-block' });
        expect(await readFile(agentsPath, 'utf8')).toBe(contents);
      }
    }
  });

  test('keeps CRLF line endings when it adds the block', async () => {
    const projectRoot = await projectFixture();
    await writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      '# Team rules\r\n\r\nUse tabs.\r\n',
    );
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    const agents = await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('<!-- BEGIN iwsdk-agent-guidance');
    expect(agents.replace(/\r\n/gu, '')).not.toContain('\n');
    expect(
      actions(
        await syncAgentGuidance({ projectRoot, source, tools: ['claude'] }),
      )['AGENTS.md'],
    ).toBe('unchanged');
  });

  test('adds the import to a nested .claude/CLAUDE.md', async () => {
    const projectRoot = await projectFixture();
    await mkdir(path.join(projectRoot, '.claude'), { recursive: true });
    await writeFile(path.join(projectRoot, '.claude/CLAUDE.md'), '# Notes\n');
    const result = await syncAgentGuidance({
      projectRoot,
      source,
      tools: ['claude'],
    });
    expect(actions(result)['.claude/CLAUDE.md']).toBe('updated:appended');
    expect(existsSync(path.join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(
      await readFile(path.join(projectRoot, '.claude/CLAUDE.md'), 'utf8'),
    ).toBe('# Notes\n\n@../AGENTS.md\n');
  });

  test('ignores operating-system junk files inside a skill folder', async () => {
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    await writeFile(
      path.join(projectRoot, '.claude/skills/iwsdk-dev/.DS_Store'),
      'junk',
    );
    expect(
      actions(
        await syncAgentGuidance({ projectRoot, source, tools: ['claude'] }),
      )['.claude/skills/iwsdk-dev'],
    ).toBe('unchanged');
  });

  test('replaces skill folders whole and leaves no temporary folders', async () => {
    const v2 = await renderGuidance({
      version: '99.0.0',
      edit: async (root) => {
        const skill = path.join(
          root,
          'claude/.claude/skills/iwsdk-dev/SKILL.md',
        );
        await writeFile(skill, `${await readFile(skill, 'utf8')}\nNew.\n`);
      },
    });
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    const result = await syncAgentGuidance({
      projectRoot,
      source: v2,
      tools: ['claude'],
    });
    expect(actions(result)['.claude/skills/iwsdk-dev']).toBe('updated');
    expect(
      (await readdir(path.join(projectRoot, '.claude/skills'))).filter((name) =>
        name.includes('.iwsdk-'),
      ),
    ).toEqual([]);
  }, 30_000);

  test('handles a file where a skill folder belongs, and an empty skill folder', async () => {
    const projectRoot = await projectFixture();
    await mkdir(path.join(projectRoot, '.claude/skills/iwsdk-ui'), {
      recursive: true,
    });
    await writeFile(path.join(projectRoot, '.claude/skills/iwsdk-dev'), 'x');
    const result = await syncAgentGuidance({
      projectRoot,
      source,
      tools: ['claude'],
    });
    expect(actions(result)['.claude/skills/iwsdk-dev']).toBe(
      'skipped:unmanaged',
    );
    expect(actions(result)['.claude/skills/iwsdk-ui']).toBe('created');
  });

  test('never rolls back guidance a newer release wrote', async () => {
    const newer = await renderGuidance({
      version: '99.0.0',
      edit: async (root) => {
        const skill = path.join(
          root,
          'claude/.claude/skills/iwsdk-grab/SKILL.md',
        );
        await writeFile(skill, `${await readFile(skill, 'utf8')}\nNewer.\n`);
      },
    });
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source: newer, tools: ['claude'] });
    const result = await syncAgentGuidance({
      projectRoot,
      source,
      tools: ['claude'],
    });
    expect(actions(result)['.claude/skills/iwsdk-grab']).toBe('skipped:newer');
    expect(
      await readFile(
        path.join(projectRoot, '.claude/skills/iwsdk-grab/SKILL.md'),
        'utf8',
      ),
    ).toContain('Newer.');
  }, 30_000);

  test('does not prune a copy of an IWSDK file saved under another name', async () => {
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    await cp(
      path.join(projectRoot, '.claude/rules/ecs-api.md'),
      path.join(projectRoot, '.claude/rules/my-ecs.md'),
    );
    const result = await syncAgentGuidance({
      projectRoot,
      source,
      tools: ['claude'],
    });
    expect(actions(result)['.claude/rules/my-ecs.md']).toBeUndefined();
    expect(existsSync(path.join(projectRoot, '.claude/rules/my-ecs.md'))).toBe(
      true,
    );
  });

  test('recognizes guidance from 0.4 starters: any heading case, and files outside the prune folders', async () => {
    const projectRoot = await projectFixture();
    await writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      '# IWSDK Project\n\nOur edited 0.4 guidance.\n',
    );
    const oldInstructions = '# IWSDK Copilot instructions\n\nOld.';
    await mkdir(path.join(projectRoot, '.github'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.github/copilot-instructions.md'),
      oldInstructions,
    );
    const result = await syncAgentGuidance({
      projectRoot,
      source: {
        ...source,
        manifest: {
          ...source.manifest,
          legacy: {
            ...source.manifest.legacy,
            '.github/copilot-instructions.md': [fileUnitHash(oldInstructions)],
          },
        },
      },
    });
    expect(actions(result)['AGENTS.md']).toBe('skipped:legacy-modified');
    expect(actions(result)['.github/copilot-instructions.md']).toBe('removed');
  });

  test('the shipped legacy table covers the 0.4 starter files', () => {
    for (const unitPath of [
      '.claude/skills/iwsdk-planner',
      '.claude/agents/iwsdk-project-code-reviewer.md',
      '.cursor/rules/iwsdk.mdc',
      '.github/copilot-instructions.md',
      'AGENTS.md',
      'CLAUDE.md',
    ]) {
      expect(
        source.manifest.legacy[unitPath]?.length,
        unitPath,
      ).toBeGreaterThan(0);
    }
  });

  test('infers the coding tools a project already has guidance for', async () => {
    const claudeOnly = await projectFixture();
    await syncAgentGuidance({
      projectRoot: claudeOnly,
      source,
      tools: ['claude'],
    });
    expect(await installedGuidanceTools(claudeOnly, source)).toEqual([
      'claude',
    ]);

    const codexOnly = await projectFixture();
    await syncAgentGuidance({
      projectRoot: codexOnly,
      source,
      tools: ['codex'],
    });
    expect(await installedGuidanceTools(codexOnly, source)).toEqual([
      'codex',
      'opencode',
    ]);

    // Cursor and Copilot share .agents/skills with Codex but are not Codex.
    for (const tool of ['cursor', 'copilot'] as const) {
      const only = await projectFixture();
      await syncAgentGuidance({ projectRoot: only, source, tools: [tool] });
      expect(await installedGuidanceTools(only, source)).toEqual([tool]);
    }

    expect(
      await installedGuidanceTools(await projectFixture(), source),
    ).toEqual([]);
  });

  test('writes through links instead of replacing them', async () => {
    const projectRoot = await projectFixture();
    await mkdir(path.join(projectRoot, 'docs'));
    await writeFile(path.join(projectRoot, 'docs/agents.md'), '# Ours\n');
    await symlink('docs/agents.md', path.join(projectRoot, 'AGENTS.md'));
    await symlink('AGENTS.md', path.join(projectRoot, 'CLAUDE.md'));
    const result = await syncAgentGuidance({
      projectRoot,
      source,
      tools: ['claude'],
    });
    expect(actions(result)['CLAUDE.md']).toBe('unchanged');
    expect(
      (await lstat(path.join(projectRoot, 'AGENTS.md'))).isSymbolicLink(),
    ).toBe(true);
    expect(
      (await lstat(path.join(projectRoot, 'CLAUDE.md'))).isSymbolicLink(),
    ).toBe(true);
    const docs = await readFile(
      path.join(projectRoot, 'docs/agents.md'),
      'utf8',
    );
    expect(docs.startsWith('# Ours\n')).toBe(true);
    expect(docs).toContain('<!-- BEGIN iwsdk-agent-guidance');
  });

  test('restores skill permissions once none are left, and on --force', async () => {
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    const settingsPath = path.join(projectRoot, '.claude/settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    const skillRules = (rules: string[]) =>
      rules.filter((rule) => rule.startsWith('Skill(iwsdk-'));
    const full = skillRules(settings.permissions.allow).length;
    settings.permissions.allow = ['Bash(ls)'];
    await writeFile(settingsPath, JSON.stringify(settings));
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    expect(
      skillRules(
        JSON.parse(await readFile(settingsPath, 'utf8')).permissions.allow,
      ),
    ).toHaveLength(full);
  });

  test('cleans up temporary folders a killed sync left behind', async () => {
    const projectRoot = await projectFixture();
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    // A process id above any pid_max, so the process is gone.
    const leftover = path.join(
      projectRoot,
      '.claude/skills/.iwsdk-dev.iwsdk-old-999999999-456',
    );
    await mkdir(leftover);
    // Another sync that is still running owns this one.
    const inUse = path.join(
      projectRoot,
      `.claude/skills/.iwsdk-ui.iwsdk-new-${process.pid}-${Date.now()}`,
    );
    await mkdir(inUse);
    await syncAgentGuidance({ projectRoot, source, tools: ['claude'] });
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(inUse)).toBe(true);
  });

  test('recognizes a CLAUDE.md link when the project path goes through a link', async () => {
    const projectRoot = await projectFixture();
    await symlink('AGENTS.md', path.join(projectRoot, 'CLAUDE.md'));
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Ours\n');
    const alias = path.join(await tempDir('iwsdk-alias-'), 'app');
    await symlink(projectRoot, alias);
    const result = await syncAgentGuidance({
      projectRoot: alias,
      source,
      tools: ['claude'],
    });
    expect(actions(result)['CLAUDE.md']).toBe('unchanged');
    expect(
      await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8'),
    ).not.toContain('@AGENTS.md');
  });

  test('counts only IWSDK’s own files when inferring tools', async () => {
    const projectRoot = await projectFixture();
    await mkdir(path.join(projectRoot, '.github'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.github/copilot-instructions.md'),
      '# Our own Copilot rules\n',
    );
    await mkdir(path.join(projectRoot, '.claude'));
    await writeFile(path.join(projectRoot, '.claude/settings.json'), '{}');
    await mkdir(path.join(projectRoot, 'src'));
    await writeFile(path.join(projectRoot, 'src/AGENTS.md'), '# Ours\n');
    expect(await installedGuidanceTools(projectRoot, source)).toEqual([]);
  });

  test('rejects a manifest with unsafe paths', async () => {
    const root = await tempDir('iwsdk-unsafe-manifest-');
    await writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        format: 1,
        package: '@iwsdk/core',
        version: '1.0.0',
        units: [{ kind: 'file', path: '../escape.md', tools: ['claude'] }],
        legacy: {},
      }),
    );
    await expect(loadGuidanceSource(root)).rejects.toBeInstanceOf(
      GuidanceSourceError,
    );
    await writeFile(path.join(root, 'manifest.json'), '{ not json');
    await expect(loadGuidanceSource(root)).rejects.toBeInstanceOf(
      GuidanceSourceError,
    );
  });
});

describe('guidance resolution', () => {
  test('prefers the guidance shipped in the installed @iwsdk/core', async () => {
    const projectRoot = await projectFixture({
      name: 'app',
      dependencies: { '@iwsdk/core': '9.0.0' },
    });
    const coreRoot = path.join(projectRoot, 'node_modules/@iwsdk/core');
    await mkdir(coreRoot, { recursive: true });
    await writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({
        name: '@iwsdk/core',
        version: '9.0.0',
        exports: { './package.json': './package.json' },
      }),
    );
    await expect(resolveProjectGuidance(projectRoot)).rejects.toMatchObject({
      code: 'core_without_guidance',
    });

    await cp(source.root, path.join(coreRoot, 'dist/agent-guidance'), {
      recursive: true,
    });
    const resolved = await resolveProjectGuidance(projectRoot);
    expect(resolved.origin).toBe('installed-core');
    expect(resolved.root).toBe(path.join(coreRoot, 'dist/agent-guidance'));
  });

  test.skipIf(!existsSync(CLI_PATH))(
    'refuses to guess when @iwsdk/core is declared but not installed, and checks the --workspace path',
    async () => {
      const declared = await projectFixture({
        name: 'app',
        dependencies: { '@iwsdk/core': '^1.0.0' },
      });
      const sync = runCli(['agents', 'sync', '--workspace', declared]);
      expect(sync.status).toBe(1);
      expect(JSON.parse(sync.stderr).error).toMatchObject({
        code: 'core_not_installed',
        message: expect.stringContaining('Install the project'),
      });
      expect(await readdir(declared)).toEqual(['package.json']);

      const missing = runCli([
        'agents',
        'sync',
        '--workspace',
        path.join(declared, 'nope'),
      ]);
      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stderr).error.message).toContain(
        'has no package.json',
      );
    },
  );

  test.skipIf(!existsSync(CLI_PATH))(
    'check exits 1 with the drift it found',
    async () => {
      const projectRoot = await projectFixture();
      const check = runCli(['agents', 'check', '--workspace', projectRoot]);
      expect(check.status).toBe(1);
      const failure = JSON.parse(check.stderr);
      expect(failure.error.code).toBe('agent_guidance_drift');
      expect(failure.error.details.drift.length).toBeGreaterThan(10);
    },
  );

  test.skipIf(!existsSync(CLI_PATH))(
    'falls back to the guidance bundled with the CLI before @iwsdk/core is installed',
    async () => {
      const cliPath = CLI_PATH;
      // A child process without the NODE_PATH pnpm gives the test runner, which
      // would resolve this workspace's @iwsdk/core from any directory.
      const env = { ...process.env, NODE_PATH: '' };
      const projectRoot = await projectFixture();
      const output = execFileSync(
        process.execPath,
        [cliPath, 'agents', 'sync', '--workspace', projectRoot],
        { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const result = JSON.parse(output);
      expect(result.data.origin).toBe('bundled-cli');
      expect(
        existsSync(path.join(projectRoot, '.claude/skills/iwsdk-dev/SKILL.md')),
      ).toBe(true);
      const check = execFileSync(
        process.execPath,
        [cliPath, 'agents', 'check', '--workspace', projectRoot],
        { encoding: 'utf8', env },
      );
      expect(JSON.parse(check).ok).toBe(true);
    },
  );

  test('uses the nearest package.json as the project', async () => {
    const root = await projectFixture({
      name: 'mono',
      private: true,
    });
    const app = path.join(root, 'apps', 'xr');
    await mkdir(path.join(app, 'src'), { recursive: true });
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({ devDependencies: { '@iwsdk/cli': '1.0.0' } }),
    );
    expect(findGuidanceProjectRoot(path.join(app, 'src'))).toBe(app);
    expect(findGuidanceProjectRoot(root)).toBe(root);
  });

  test('adapter sync installs the guidance and reports it', async () => {
    const projectRoot = await projectFixture({
      name: 'app',
      devDependencies: { '@iwsdk/vite-plugin-dev': '1.0.0' },
    });
    await writeFile(
      path.join(projectRoot, 'vite.config.ts'),
      'export default {}\n',
    );
    const coreRoot = path.join(projectRoot, 'node_modules/@iwsdk/core');
    await mkdir(coreRoot, { recursive: true });
    await writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({
        name: '@iwsdk/core',
        version: source.manifest.version,
        exports: { './package.json': './package.json' },
      }),
    );
    await cp(source.root, path.join(coreRoot, 'dist/agent-guidance'), {
      recursive: true,
    });
    const result = await syncAgentAdapters({ workspaceRoot: projectRoot });
    // MCP setup writes .claude/settings.json first; guidance still covers
    // every tool in a project that had none.
    expect(existsSync(path.join(projectRoot, '.agents/skills/iwsdk-dev'))).toBe(
      true,
    );
    expect(existsSync(path.join(projectRoot, '.cursor/rules'))).toBe(true);
    expect(result.guidance).toMatchObject({
      status: 'synced',
      changed: true,
      origin: 'installed-core',
    });
    expect(
      existsSync(path.join(projectRoot, '.claude/skills/iwsdk-dev/SKILL.md')),
    ).toBe(true);
  });
});
