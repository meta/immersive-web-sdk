/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Regenerates agent-guidance/legacy-hashes.json: the hash of every guidance
// unit that a released IWSDK wrote into apps before guidance carried stamps.
// `iwsdk agents sync` replaces an unstamped file only when its hash is listed
// here, so apps created by older releases upgrade cleanly while anything a
// developer edited is left alone.
//
//   node scripts/gen-legacy-guidance-hashes.mjs [--registry <url>]
//   node scripts/gen-legacy-guidance-hashes.mjs --label <source> <guidance dir>...
//
// Without directory arguments it downloads every published release that wrote
// guidance:
// - @iwsdk/create 0.5+ ships it in dist/guidance/<group>/<project path>;
// - before 0.5, create applied @iwsdk/starter-assets recipes, whose edits hold
//   each file as `lines` (written joined with "\n").
// A directory argument is a `dist/guidance` tree in the 0.5+ layout, for
// unreleased builds.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { directoryUnitHash, fileUnitHash } from './agent-guidance-format.mjs';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputPath = path.join(
  packageRoot,
  'agent-guidance',
  'legacy-hashes.json',
);

/** Project paths a release wrote as guidance; JSON and TOML are merged instead. */
const GUIDANCE_PATH =
  /^(?:(?:.*\/)?AGENTS\.md|CLAUDE\.md|\.claude\/(?:skills|rules|agents)\/.+|\.agents\/skills\/.+|\.cursor\/rules\/.+|\.github\/(?:copilot-instructions\.md|instructions\/.+))$/u;

const args = process.argv.slice(2);
const registryIndex = args.indexOf('--registry');
const registry =
  registryIndex === -1 ? undefined : args.splice(registryIndex, 2)[1];
const npmRegistryArgs = registry ? ['--registry', registry] : [];
const labelIndex = args.indexOf('--label');
const label = labelIndex === -1 ? undefined : args.splice(labelIndex, 2)[1];

const existing = existsSync(outputPath)
  ? JSON.parse(await readFile(outputPath, 'utf8'))
  : { sources: [], units: {} };
const units = new Map(
  Object.entries(existing.units).map(([unitPath, hashes]) => [
    unitPath,
    new Set(hashes),
  ]),
);
const sources = new Set(existing.sources);

const scratch = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-legacy-guidance-'));
try {
  if (args.length > 0) {
    for (const directory of args) {
      if ((await addGuidanceTree(path.resolve(directory))) > 0) {
        sources.add(label ?? `directory:${path.resolve(directory)}`);
      }
    }
  } else {
    for (const version of publishedVersions('@iwsdk/create')) {
      const root = packAndExtract('@iwsdk/create', version);
      const guidanceRoot = path.join(root, 'package', 'dist', 'guidance');
      if (
        existsSync(guidanceRoot) &&
        (await addGuidanceTree(guidanceRoot)) > 0
      ) {
        sources.add(`@iwsdk/create@${version}`);
      }
    }
    for (const version of publishedVersions('@iwsdk/starter-assets')) {
      const root = packAndExtract('@iwsdk/starter-assets', version);
      const recipesRoot = path.join(root, 'package', 'dist', 'recipes');
      if (existsSync(recipesRoot) && (await addRecipes(recipesRoot)) > 0) {
        sources.add(`@iwsdk/starter-assets@${version}`);
      }
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      description:
        'Hashes of guidance files written by IWSDK releases before guidance was stamped. Regenerate with scripts/gen-legacy-guidance-hashes.mjs.',
      sources: [...sources].sort(),
      units: Object.fromEntries(
        [...units.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([unitPath, hashes]) => [unitPath, [...hashes].sort()]),
      ),
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Wrote ${units.size} units to ${path.relative(process.cwd(), outputPath)}`,
);

function publishedVersions(name) {
  return JSON.parse(
    execFileSync(
      'npm',
      ['view', name, 'versions', '--json', ...npmRegistryArgs],
      {
        encoding: 'utf8',
      },
    ),
  );
}

function packAndExtract(name, version) {
  const extractRoot = path.join(
    scratch,
    `${name.replace('/', '__')}@${version}`,
  );
  execFileSync('mkdir', ['-p', extractRoot]);
  const tarball = execFileSync(
    'npm',
    [
      'pack',
      `${name}@${version}`,
      '--silent',
      '--pack-destination',
      extractRoot,
      ...npmRegistryArgs,
    ],
    { encoding: 'utf8' },
  ).trim();
  execFileSync('tar', [
    'xzf',
    path.join(extractRoot, tarball),
    '-C',
    extractRoot,
  ]);
  return extractRoot;
}

/**
 * Record every guidance unit in a map of project path to contents. Returns
 * how many units the release wrote, so it is credited even when an earlier
 * release had the same hashes.
 */
function addProjectFiles(files) {
  let recorded = 0;
  const skills = new Map();
  for (const [relativePath, contents] of files) {
    if (!GUIDANCE_PATH.test(relativePath)) {
      continue;
    }
    const skill = relativePath.match(
      /^(\.(?:claude|agents)\/skills\/[^/]+)\/(.+)$/u,
    );
    if (skill) {
      const skillFiles = skills.get(skill[1]) ?? new Map();
      skillFiles.set(skill[2], contents);
      skills.set(skill[1], skillFiles);
    } else if (typeof contents === 'string') {
      recorded += record(relativePath, fileUnitHash(contents));
    }
  }
  for (const [unitPath, skillFiles] of skills) {
    recorded += record(unitPath, directoryUnitHash(skillFiles));
  }
  return recorded;
}

async function addGuidanceTree(guidanceRoot) {
  let recorded = 0;
  for (const group of await readdir(guidanceRoot, { withFileTypes: true })) {
    if (group.isDirectory()) {
      recorded += addProjectFiles(
        await readTree(path.join(guidanceRoot, group.name)),
      );
    }
  }
  return recorded;
}

async function addRecipes(recipesRoot) {
  const files = new Map();
  for (const entry of await readdir(recipesRoot)) {
    if (!entry.endsWith('.recipe.json')) {
      continue;
    }
    const recipe = JSON.parse(
      await readFile(path.join(recipesRoot, entry), 'utf8'),
    );
    for (const [relativePath, edit] of Object.entries(recipe.edits ?? {})) {
      if (Array.isArray(edit?.lines)) {
        files.set(relativePath, edit.lines.join('\n'));
      }
    }
  }
  // Create joined the lines without a final newline; an editor that adds one
  // on save must not turn the file into an edited one.
  return (
    addProjectFiles(files) +
    addProjectFiles(
      new Map(
        [...files].map(([relativePath, text]) => [relativePath, `${text}\n`]),
      ),
    )
  );
}

function record(unitPath, hash) {
  const hashes = units.get(unitPath) ?? new Set();
  hashes.add(hash);
  units.set(unitPath, hashes);
  return 1;
}

async function readTree(root, relative = '', files = new Map()) {
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await readTree(root, childRelative, files);
    } else if (entry.isFile()) {
      const contents = await readFile(path.join(root, childRelative));
      files.set(
        childRelative,
        /\.(png|jpe?g|webp|gif|glb|mp3|ktx2)$/iu.test(entry.name)
          ? contents
          : contents.toString('utf8'),
      );
    }
  }
  return files;
}
