/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Renders the coding-agent guidance in agent-guidance/ into the project files
// an IWSDK app receives, stamped with this package's version and a content
// hash, plus a manifest that `iwsdk agents sync` and `@iwsdk/create` read.
//
//   node scripts/build-agent-guidance.mjs [outputDirectory]
//
// Output (default dist/agent-guidance/):
//   manifest.json   units, their tools and hashes, legacy hashes, and what
//                   replaces each retired unit (agent-guidance/successors.json)
//   files/          project-relative files, ready to copy into an app

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUIDANCE_FORMAT,
  blockUnitHash,
  directoryUnitHash,
  fileUnitHash,
  JUNK_FILE,
  renderBlock,
  stampedBody,
  stampText,
} from './agent-guidance-format.mjs';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const sourceRoot = path.join(packageRoot, 'agent-guidance');
const outputRoot = path.resolve(
  process.argv[2] ?? path.join(packageRoot, 'dist', 'agent-guidance'),
);
const filesRoot = path.join(outputRoot, 'files');
const { version } = JSON.parse(
  await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
);

const CLAUDE = ['claude'];
const PORTABLE_SKILL_TOOLS = ['codex', 'cursor', 'copilot', 'opencode'];
const NESTED_AGENTS_TOOLS = ['codex', 'opencode'];
const ALL_TOOLS = ['claude', 'cursor', 'copilot', 'codex', 'opencode'];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(filesRoot, { recursive: true });

const units = [];

await emitBlock(
  'AGENTS.md',
  await readFile(path.join(sourceRoot, 'common', 'AGENTS.md'), 'utf8'),
  ALL_TOOLS,
);
await writeOutput(
  'CLAUDE.md',
  await readFile(path.join(sourceRoot, 'claude', 'CLAUDE.md'), 'utf8'),
);
units.push({ kind: 'claude-import', path: 'CLAUDE.md', tools: CLAUDE });

const skillsRoot = path.join(sourceRoot, 'claude', '.claude', 'skills');
const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
for (const skillName of skillNames) {
  const files = await readTree(path.join(skillsRoot, skillName));
  if (!files.has('SKILL.md')) {
    throw new Error(`Skill ${skillName} has no SKILL.md`);
  }
  // Hash SKILL.md as the stamped file stores it, so the folder matches its stamp.
  files.set('SKILL.md', stampedBody(files.get('SKILL.md')));
  const hash = directoryUnitHash(files);
  const stamped = new Map(files);
  stamped.set(
    'SKILL.md',
    stampText(files.get('SKILL.md'), version, hash, skillName),
  );
  for (const [skillRoot, tools] of [
    ['.claude/skills', CLAUDE],
    ['.agents/skills', PORTABLE_SKILL_TOOLS],
  ]) {
    const unitPath = `${skillRoot}/${skillName}`;
    for (const [relativePath, contents] of stamped) {
      await writeOutput(`${unitPath}/${relativePath}`, contents);
    }
    units.push({
      kind: 'directory',
      path: unitPath,
      tools,
      sha256: hash,
      files: [...stamped.keys()].sort(),
    });
  }
}

const settings = JSON.parse(
  await readFile(
    path.join(sourceRoot, 'claude', '.claude', 'settings.json'),
    'utf8',
  ),
);
const skillPermissions = skillNames.map((name) => `Skill(${name})`);
settings.permissions.allow = [
  ...settings.permissions.allow.filter(
    (rule) => !/^Skill\(iwsdk-[^)]*\)$/u.test(rule),
  ),
  ...skillPermissions,
];
await writeOutput(
  '.claude/settings.json',
  `${JSON.stringify(settings, null, 2)}\n`,
);
units.push({
  kind: 'claude-settings',
  path: '.claude/settings.json',
  tools: CLAUDE,
  skills: skillNames,
});

for (const agentFile of await listMarkdown(
  path.join(sourceRoot, 'claude', '.claude', 'agents'),
)) {
  await emitFile(
    `.claude/agents/${agentFile.name}`,
    agentFile.contents,
    CLAUDE,
  );
}

const rules = await readClaudeRules(
  path.join(sourceRoot, 'claude', '.claude', 'rules'),
);
for (const rule of rules) {
  await emitFile(`.claude/rules/${rule.name}.md`, rule.source, CLAUDE);
  await emitFile(
    `.cursor/rules/${rule.name}.mdc`,
    `---\ndescription: ${JSON.stringify(rule.title)}\nglobs:\n${rule.paths
      .map((glob) => `  - ${JSON.stringify(glob)}`)
      .join(
        '\n',
      )}\nalwaysApply: false\n---\n\n${portableRuleBody(rule.body)}\n`,
    ['cursor'],
  );
  await emitFile(
    `.github/instructions/${rule.name}.instructions.md`,
    `---\napplyTo: ${JSON.stringify(rule.paths.join(','))}\n---\n\n${portableRuleBody(rule.body)}\n`,
    ['copilot'],
  );
}

const rulesByName = new Map(rules.map((rule) => [rule.name, rule]));
for (const [relativePath, ruleNames] of [
  ['public/scenes/AGENTS.md', ['scene-json']],
  ['public/ui/AGENTS.md', ['uikitml']],
  ['src/AGENTS.md', ['ecs-api', 'assets-and-manifest']],
]) {
  const bodies = ruleNames.map((name) => {
    const rule = rulesByName.get(name);
    if (rule == null) {
      throw new Error(`Missing canonical Claude rule ${name}`);
    }
    return portableRuleBody(rule.body);
  });
  await emitBlock(
    relativePath,
    `# IWSDK scoped project guidance\n\nThis file augments the repository-root \`AGENTS.md\` for files in this directory.\n\n${bodies.join('\n\n')}\n`,
    NESTED_AGENTS_TOOLS,
  );
}

const legacyPath = path.join(sourceRoot, 'legacy-hashes.json');
const legacy = existsSync(legacyPath)
  ? JSON.parse(await readFile(legacyPath, 'utf8')).units
  : {};
const successorsPath = path.join(sourceRoot, 'successors.json');
const successors = resolveSuccessors(
  existsSync(successorsPath)
    ? JSON.parse(await readFile(successorsPath, 'utf8'))
    : {},
);

await writeFile(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify(
    {
      format: GUIDANCE_FORMAT,
      package: '@iwsdk/core',
      version,
      units: units.sort((left, right) => left.path.localeCompare(right.path)),
      legacy,
      successors,
    },
    null,
    2,
  )}\n`,
);

/**
 * successors.json as retired unit path -> the paths of the units in this
 * release that replace it. Fails on a successor this release does not ship,
 * and on a unit in legacy-hashes.json (written by a release before 1.2, which
 * did not stamp guidance) that is retired without an entry. Units only
 * stamped releases wrote are not checked: retired without an entry, they are
 * kept by `iwsdk dev up`, and removed by `iwsdk agents sync` and `upgrade`.
 */
function resolveSuccessors(table) {
  const unitPaths = new Set(units.map((unit) => unit.path));
  const resolved = {};
  for (const [name, replacements] of Object.entries(table.skills ?? {})) {
    if (skillNames.includes(name)) {
      throw new Error(
        `successors.json retires skill ${name}, but this release ships it`,
      );
    }
    for (const replacement of replacements) {
      if (!skillNames.includes(replacement)) {
        throw new Error(
          `successors.json replaces skill ${name} with ${replacement}, which this release does not ship`,
        );
      }
    }
    for (const skillRoot of ['.claude/skills', '.agents/skills']) {
      resolved[`${skillRoot}/${name}`] = replacements
        .map((replacement) => `${skillRoot}/${replacement}`)
        .sort();
    }
  }
  for (const [unitPath, replacement] of Object.entries(table.files ?? {})) {
    const named = replacement.units ?? [];
    const tools = replacement.tools ?? [];
    if (unitPaths.has(unitPath)) {
      throw new Error(
        `successors.json retires ${unitPath}, but this release ships it`,
      );
    }
    for (const name of named) {
      if (!unitPaths.has(name)) {
        throw new Error(
          `successors.json replaces ${unitPath} with ${name}, which this release does not ship`,
        );
      }
    }
    for (const tool of tools) {
      if (!ALL_TOOLS.includes(tool)) {
        throw new Error(
          `successors.json replaces ${unitPath} with the guidance of unknown coding tool ${tool}`,
        );
      }
    }
    // Settings carry permissions, which follow the skills; they replace no
    // guidance.
    resolved[unitPath] = [
      ...new Set([
        ...named,
        ...units
          .filter(
            (unit) =>
              unit.kind !== 'claude-settings' &&
              unit.tools.some((tool) => tools.includes(tool)),
          )
          .map((unit) => unit.path),
      ]),
    ].sort();
  }
  for (const unitPath of Object.keys(legacy)) {
    if (!unitPaths.has(unitPath) && !(unitPath in resolved)) {
      throw new Error(
        `${unitPath} was written by a release before 1.2 (legacy-hashes.json) and this release does not ship it. Say what replaces it in agent-guidance/successors.json.`,
      );
    }
  }
  return Object.fromEntries(
    Object.entries(resolved).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

async function emitFile(relativePath, contents, tools) {
  const hash = fileUnitHash(stampedBody(contents));
  await writeOutput(
    relativePath,
    stampText(contents, version, hash, path.posix.basename(relativePath)),
  );
  units.push({ kind: 'file', path: relativePath, tools, sha256: hash });
}

async function emitBlock(relativePath, body, tools) {
  await writeOutput(relativePath, renderBlock(body, version));
  units.push({
    kind: 'block',
    path: relativePath,
    tools,
    sha256: blockUnitHash(body),
  });
}

async function writeOutput(relativePath, contents) {
  const filePath = path.join(filesRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function readTree(root, relative = '', files = new Map()) {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (JUNK_FILE.test(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      await readTree(root, childRelative, files);
    } else if (entry.isFile()) {
      const contents = await readFile(path.join(root, childRelative));
      files.set(
        childRelative,
        isText(entry.name) ? contents.toString('utf8') : contents,
      );
    } else {
      throw new Error(`Guidance entry is not a regular file: ${childRelative}`);
    }
  }
  return files;
}

function isText(name) {
  return !/\.(png|jpe?g|webp|gif|glb|mp3|ktx2)$/iu.test(name);
}

async function listMarkdown(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => ({
        name: entry.name,
        contents: await readFile(path.join(root, entry.name), 'utf8'),
      })),
  );
}

async function readClaudeRules(root) {
  const entries = await listMarkdown(root);
  return entries.map(({ name, contents: source }) => {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u);
    if (match == null) {
      throw new Error(`Claude rule ${name} is missing frontmatter`);
    }
    const paths = [];
    let readingPaths = false;
    for (const line of match[1].split(/\r?\n/u)) {
      if (/^paths:\s*$/u.test(line)) {
        readingPaths = true;
        continue;
      }
      const pathMatch = readingPaths
        ? line.match(/^\s*-\s*["']?(.+?)["']?\s*$/u)
        : null;
      if (pathMatch != null) {
        paths.push(pathMatch[1]);
        continue;
      }
      if (line.trim().length > 0) {
        readingPaths = false;
      }
    }
    if (paths.length === 0) {
      throw new Error(`Claude rule ${name} has no paths`);
    }
    const body = match[2].trim();
    const title = body.match(/^#\s+(.+)$/mu)?.[1] ?? name;
    return { body, name: name.slice(0, -3), paths, source, title };
  });
}

function portableRuleBody(body) {
  return body.replaceAll('.claude/skills/', '.agents/skills/');
}
