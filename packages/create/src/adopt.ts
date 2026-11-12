/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import {
  loadGuidanceSource,
  syncAgentGuidance,
  type SyncAgentGuidanceResult,
} from '@iwsdk/cli/agent-guidance';
import semver from 'semver';
import { isMap, parseDocument } from 'yaml';
import {
  detectPackageManager,
  runScriptCommand,
  type PackageManager,
} from './package-manager.js';
import type { ProjectFileInput } from './scaffold.js';
import { patchViteConfig, type VitePatchStatus } from './vite-config-patch.js';

// Adopting IWSDK into an existing project. Everything is checked before the
// first write, and nothing the developer wrote is overwritten: IWSDK's files
// go into their own src/iwsdk/ folder, package.json and the other shared
// files are merged in their own format, and agent guidance goes through the
// same sync as `iwsdk agents sync`, which keeps the developer's AGENTS.md text.

export type { PackageManager };

export interface PackageJsonChange {
  field: string;
  name: string;
  from?: string;
  to: string;
}

export interface AdoptReport {
  packageManager: PackageManager;
  /** Where the lockfile or workspace lives, when it is not the project. */
  workspaceRoot: string | null;
  created: string[];
  kept: string[];
  packageJson: {
    added: PackageJsonChange[];
    changed: PackageJsonChange[];
    /** Dependencies left as the developer declared them, with why. */
    keptDependencies: Array<{ name: string; spec: string; reason: string }>;
    keptScripts: string[];
  };
  overrides: string | null;
  viteConfig: {
    file: string | null;
    status: 'created' | VitePatchStatus;
  };
  gitignoreAdded: string[];
  guidance: SyncAgentGuidanceResult;
  manualSteps: string[];
}

export interface AdoptExistingProjectOptions {
  outDir: string;
  files: readonly ProjectFileInput[];
  /** Directory holding the rendered guidance (manifest.json and files/). */
  guidanceRoot: string;
  language: 'ts' | 'js';
}

/** A reason to stop before anything is written. */
export class AdoptError extends Error {
  constructor(message: string) {
    super(`${message} Nothing was changed.`);
    this.name = 'AdoptError';
  }
}

const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cts',
  'vite.config.cjs',
];
/** @iwsdk/vite-plugin-dev's peer range. */
const VITE_PEER_RANGE = '^7.0.0';
const SKELETON_DIRECTORY = 'src/iwsdk';
/** IWSDK's own .gitignore entries: runtime state and generated MCP configs. */
const GITIGNORE_ENTRIES = [
  '.iwsdk/',
  '.mcp.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  '.codex/config.toml',
];

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
}

/** A spec that names a registry version, as opposed to a path or protocol. */
function isRegistrySpec(spec: string): boolean {
  return semver.validRange(spec) != null;
}

/** True when `spec` asks for an older release than `wanted`. */
function isOlder(spec: string, wanted: string): boolean {
  const current = semver.minVersion(spec);
  const target = semver.minVersion(wanted);
  return current != null && target != null && semver.lt(current, target);
}

function textContents(file: ProjectFileInput): string {
  return typeof file.contents === 'string'
    ? file.contents
    : Buffer.from(file.contents).toString('utf8');
}

/** Indent and line ending of a JSON file, so it is written back the same way. */
function jsonStyle(raw: string): {
  indent: string;
  eol: string;
  final: string;
} {
  const indent = raw.match(/^[{[]\r?\n([ \t]+)\S/u)?.[1] ?? '  ';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { indent, eol, final: /\r?\n$/u.test(raw) ? eol : '' };
}

function formatJson(value: unknown, raw: string): string {
  const { indent, eol, final } = jsonStyle(raw);
  return `${JSON.stringify(value, null, indent).replace(/\n/gu, eol)}${final}`;
}

const ENTRY_SOURCE = `import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

// IWSDK entry point, added by @iwsdk/create. iwsdk.config.json configures the
// world; register your systems on it once worldReady resolves.
function sceneContainer()__RETURN_TYPE__ {
  const existing = document.getElementById('scene-container');
  if (existing instanceof HTMLDivElement) {
    return existing;
  }
  const container = document.createElement('div');
  container.id = 'scene-container';
  document.body.append(container);
  return container;
}

export const worldReady = World.create(sceneContainer(), projectOptions);
`;

/**
 * What an existing project receives: the minimum an IWSDK project needs, in
 * its own folder so it can never shadow the project's modules, plus the
 * starter's project-level files where the project has none.
 */
function skeletonFiles(
  files: readonly ProjectFileInput[],
  language: 'ts' | 'js',
): ProjectFileInput[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const extension = language === 'ts' ? 'ts' : 'js';
  const entry = `${SKELETON_DIRECTORY}/index.${extension}`;
  const skeleton: ProjectFileInput[] = [
    {
      path: entry,
      contents: ENTRY_SOURCE.replace(
        '__RETURN_TYPE__',
        language === 'ts' ? ': HTMLDivElement' : '',
      ),
    },
    {
      path: `${SKELETON_DIRECTORY}/assets.${extension}`,
      contents:
        "import { defineAssets } from '@iwsdk/core';\n\n// Register glTF, texture, audio and UIKitML assets by id.\nexport default defineAssets({});\n",
    },
    {
      path: `${SKELETON_DIRECTORY}/components.${extension}`,
      contents:
        "import { defineComponents } from '@iwsdk/core';\n\n// List components here so scenes and the editor can use them.\nexport default defineComponents([]);\n",
    },
  ];
  if (language === 'ts') {
    skeleton.push({
      path: `${SKELETON_DIRECTORY}/iwsdk-env.d.ts`,
      contents:
        '/// <reference types="vite/client" />\n/// <reference types="@iwsdk/vite-plugin-dev/client" />\n',
    });
  }
  const manifest = byPath.get('iwsdk.config.json');
  if (manifest) {
    const config = JSON.parse(textContents(manifest)) as JsonObject;
    config.assets = { module: `./${SKELETON_DIRECTORY}/assets` };
    config.components = { module: `./${SKELETON_DIRECTORY}/components` };
    skeleton.push({
      path: 'iwsdk.config.json',
      contents: `${JSON.stringify(config, null, 2)}\n`,
    });
  }
  const scene = byPath.get('public/scenes/main.iwsdk.scene.json');
  if (scene) {
    // Keep the starter's sky, lighting and renderer settings; drop its demo.
    const document = JSON.parse(textContents(scene)) as JsonObject;
    skeleton.push({
      path: scene.path,
      contents: `${JSON.stringify({ ...document, resources: {}, nodes: [] }, null, 2)}\n`,
    });
  }
  const indexHtml = byPath.get('index.html');
  if (indexHtml) {
    skeleton.push({
      path: 'index.html',
      contents: textContents(indexHtml).replace(
        /\/src\/index\.(?:ts|js)/u,
        `/${entry}`,
      ),
    });
  }
  for (const name of [
    'vite.config.ts',
    'vite.config.js',
    'tsconfig.json',
    '.codex/config.toml',
  ]) {
    const file = byPath.get(name);
    if (file) {
      skeleton.push(file);
    }
  }
  return skeleton;
}

/**
 * Whether a path can be written: 'missing' when nothing is there, 'file' for a
 * regular file, and 'blocked' when it or a parent is a link or not a folder.
 */
async function writeTarget(
  outDir: string,
  relativePath: string,
): Promise<'missing' | 'file' | 'blocked'> {
  let current = outDir;
  const parts = relativePath.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 'missing';
      }
      throw error;
    }
    const isLast = index === parts.length - 1;
    if (
      stat.isSymbolicLink() ||
      (isLast ? !stat.isFile() : !stat.isDirectory())
    ) {
      return 'blocked';
    }
  }
  return 'file';
}

interface MergePlan {
  packageJson: JsonObject;
  report: AdoptReport['packageJson'];
  pnpmOverrides: Record<string, string>;
  manualSteps: string[];
}

/**
 * Merge the starter package.json into the developer's. Versions are only
 * raised, never lowered; specs that are not registry versions (workspace:,
 * file:, catalog:, links) are left as they are and reported.
 */
export function mergePackageJson(
  existing: JsonObject,
  starter: JsonObject,
  packageManager: PackageManager,
  language: 'ts' | 'js' = 'ts',
  solutionTsconfig = false,
  /** The enclosing workspace, when the project is one package of several. */
  workspaceRoot: string | null = null,
): MergePlan {
  const packageJson: JsonObject = { ...existing };
  const report: AdoptReport['packageJson'] = {
    added: [],
    changed: [],
    keptDependencies: [],
    keptScripts: [],
  };
  const manualSteps: string[] = [];
  const dependencyFields = ['dependencies', 'devDependencies'] as const;
  const records = {
    dependencies: stringRecord(existing.dependencies),
    devDependencies: stringRecord(existing.devDependencies),
  };
  for (const field of dependencyFields) {
    for (const [name, spec] of Object.entries(stringRecord(starter[field]))) {
      // A package the developer declared in either field stays in that field.
      const declaredIn = dependencyFields.find(
        (other) => name in records[other],
      );
      if (declaredIn == null) {
        records[field][name] = spec;
        report.added.push({ field, name, to: spec });
        continue;
      }
      const current = records[declaredIn][name];
      if (current === spec) {
        continue;
      }
      const keep = (reason: string) =>
        report.keptDependencies.push({ name, spec: current, reason });
      if (name === 'three') {
        // IWSDK needs its own Three.js build; anything else means two copies.
        if (/^(?:catalog|workspace|file|link):/u.test(current)) {
          keep(`IWSDK needs three as ${spec}`);
          manualSteps.push(
            `Point three at ${spec} wherever ${current} is defined, so the app and IWSDK share one Three.js.`,
          );
          continue;
        }
      } else if (name === 'vite') {
        if (!isRegistrySpec(current)) {
          keep('not a registry version; check it satisfies Vite 7');
          continue;
        }
        if (semver.subset(semver.validRange(current)!, VITE_PEER_RANGE)) {
          continue;
        }
      } else if (!name.startsWith('@iwsdk/') && name !== '@types/three') {
        continue;
      } else if (!isRegistrySpec(current)) {
        keep('not a registry version');
        continue;
      } else if (!isOlder(current, spec)) {
        keep('newer than this release');
        continue;
      }
      report.changed.push({ field: declaredIn, name, from: current, to: spec });
      records[declaredIn][name] = spec;
    }
  }
  for (const field of dependencyFields) {
    if (Object.keys(records[field]).length > 0) {
      packageJson[field] = records[field];
    }
  }

  // Overrides keep one Three.js and a known sharp; each tool reads its own.
  const wanted = stringRecord(starter.overrides);
  const pnpmOverrides: Record<string, string> = {};
  if (workspaceRoot != null) {
    // Package managers read overrides only at the workspace root, where they
    // apply to every package; that is the developer's decision.
    manualSteps.push(
      `This project is part of the workspace at ${workspaceRoot}. Overrides only work there and apply to every package in it: if the workspace can share them, add ${Object.entries(
        wanted,
      )
        .map(([name, spec]) => `${name} -> ${spec}`)
        .join(', ')} to its ${
        packageManager === 'pnpm'
          ? 'pnpm-workspace.yaml overrides'
          : packageManager === 'yarn'
            ? 'package.json resolutions'
            : 'package.json overrides'
      }. Without the three override, a dependency can load a second copy of Three.js.`,
    );
  } else if (packageManager === 'pnpm') {
    Object.assign(pnpmOverrides, wanted);
    const pnpmField = isRecord(existing.pnpm) ? existing.pnpm : null;
    const existingThree = isRecord(pnpmField?.overrides)
      ? pnpmField.overrides.three
      : undefined;
    if (typeof existingThree === 'string' && existingThree !== wanted.three) {
      // package.json's pnpm.overrides wins over pnpm-workspace.yaml.
      packageJson.pnpm = {
        ...pnpmField,
        overrides: {
          ...(pnpmField!.overrides as JsonObject),
          three: wanted.three,
        },
      };
      report.changed.push({
        field: 'pnpm.overrides',
        name: 'three',
        from: existingThree,
        to: wanted.three,
      });
    }
  } else {
    const field = packageManager === 'yarn' ? 'resolutions' : 'overrides';
    const current = isRecord(existing[field]) ? { ...existing[field] } : {};
    for (const [name, spec] of Object.entries(wanted)) {
      if (!(name in current)) {
        current[name] = spec;
        report.added.push({ field, name, to: spec });
      } else if (typeof current[name] !== 'string') {
        manualSteps.push(
          `Your ${field} entry for ${name} is nested; make it resolve ${name} to ${spec}.`,
        );
      } else if (name === 'three' && current[name] !== spec) {
        report.changed.push({
          field,
          name,
          from: current[name] as string,
          to: spec,
        });
        current[name] = spec;
      }
    }
    packageJson[field] = current;
  }

  const scripts = stringRecord(existing.scripts);
  const mergedScripts: Record<string, string> = { ...scripts };
  const starterScripts = stringRecord(starter.scripts);
  if (language === 'ts' && solutionTsconfig && starterScripts.typecheck) {
    // `tsc --noEmit` checks nothing with a solution-style tsconfig.
    starterScripts.typecheck = 'tsc -b';
  }
  for (const [name, command] of Object.entries(starterScripts)) {
    if (!(name in scripts)) {
      mergedScripts[name] = command;
      report.added.push({ field: 'scripts', name, to: command });
    } else if (scripts[name] !== command) {
      report.keptScripts.push(name);
      const alias = `iwsdk:${name}`;
      if (name === 'dev' && !(alias in scripts)) {
        mergedScripts[alias] = command;
        report.added.push({ field: 'scripts', name: alias, to: command });
      }
    }
  }
  packageJson.scripts = mergedScripts;

  if (packageJson.engines == null && starter.engines != null) {
    packageJson.engines = starter.engines;
    report.added.push({
      field: 'engines',
      name: 'node',
      to: String((starter.engines as JsonObject).node),
    });
  }
  return { packageJson, report, pnpmOverrides, manualSteps };
}

/**
 * Add overrides to a project's own pnpm-workspace.yaml without touching
 * anything else. Null when the file cannot be edited safely.
 */
function mergePnpmOverrides(
  raw: string,
  overrides: Record<string, string>,
): { text: string; added: string[]; replaced: string | null } | null {
  const document = parseDocument(raw);
  if (document.errors.length > 0) {
    return null;
  }
  const existing = document.get('overrides');
  if (existing != null && !isMap(existing)) {
    return null;
  }
  const added: string[] = [];
  let replaced: string | null = null;
  for (const [name, spec] of Object.entries(overrides)) {
    const current =
      existing == null ? undefined : document.getIn(['overrides', name]);
    if (current == null) {
      added.push(name);
    } else if (name === 'three' && current !== spec) {
      replaced = String(current);
      added.push(name);
    } else {
      continue;
    }
    if (document.get('overrides') == null) {
      document.set('overrides', document.createNode({ [name]: spec }));
    } else {
      document.setIn(['overrides', name], spec);
    }
  }
  return { text: document.toString(), added, replaced };
}

export async function adoptExistingProject({
  outDir,
  files,
  guidanceRoot,
  language,
}: AdoptExistingProjectOptions): Promise<AdoptReport> {
  // 1. Check everything; write nothing yet.
  const packageJsonPath = path.join(outDir, 'package.json');
  if ((await writeTarget(outDir, 'package.json')) !== 'file') {
    throw new AdoptError('package.json is a link or not a regular file.');
  }
  const rawPackageJson = await fsp.readFile(packageJsonPath, 'utf8');
  let existingPackageJson: unknown;
  try {
    existingPackageJson = JSON.parse(rawPackageJson);
  } catch (error) {
    throw new AdoptError(
      `package.json is not valid JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!isRecord(existingPackageJson)) {
    throw new AdoptError('package.json must contain a JSON object.');
  }
  const viteSpec =
    stringRecord(existingPackageJson.dependencies).vite ??
    stringRecord(existingPackageJson.devDependencies).vite;
  if (viteSpec && isRegistrySpec(viteSpec)) {
    const lowest = semver.minVersion(viteSpec);
    if (lowest && lowest.major > semver.minVersion(VITE_PEER_RANGE)!.major) {
      throw new AdoptError(
        `This project uses vite ${viteSpec}, and IWSDK's Vite plugin supports Vite ${VITE_PEER_RANGE.slice(1).split('.')[0]}. Ask the user whether to move the project to Vite ${VITE_PEER_RANGE.slice(1).split('.')[0]} first or wait for an IWSDK release that supports it.`,
      );
    }
  }
  const packageManagerInfo = detectPackageManager(outDir);
  const packageManager = packageManagerInfo.name;
  const inWorkspace = packageManagerInfo.root !== path.resolve(outDir);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const existingViteConfig =
    VITE_CONFIG_NAMES.find((name) => existsSync(path.join(outDir, name))) ??
    null;
  const planned = skeletonFiles(files, language).filter(
    (file) =>
      !(file.path.startsWith('vite.config.') && existingViteConfig != null),
  );
  const targets = new Map<string, 'missing' | 'file' | 'blocked'>();
  for (const file of planned) {
    const target = await writeTarget(outDir, file.path);
    if (
      target === 'blocked' &&
      file.path.startsWith(`${SKELETON_DIRECTORY}/`)
    ) {
      // iwsdk.config.json would point at modules that cannot be written.
      throw new AdoptError(
        `${file.path} cannot be written: a link or a file is in the way.`,
      );
    }
    targets.set(file.path, target);
  }
  const tsconfigRaw = existsSync(path.join(outDir, 'tsconfig.json'))
    ? await fsp.readFile(path.join(outDir, 'tsconfig.json'), 'utf8')
    : '';
  const merge = mergePackageJson(
    existingPackageJson,
    JSON.parse(textContents(byPath.get('package.json')!)) as JsonObject,
    packageManager,
    language,
    /"references"\s*:/u.test(tsconfigRaw),
    inWorkspace ? packageManagerInfo.root : null,
  );
  const manualSteps = [...merge.manualSteps];
  // A project's own pnpm-workspace.yaml is checked before anything is written.
  const workspaceYamlPath = path.join(outDir, 'pnpm-workspace.yaml');
  let workspaceYaml: ReturnType<typeof mergePnpmOverrides> | undefined;
  if (
    packageManager === 'pnpm' &&
    !inWorkspace &&
    existsSync(workspaceYamlPath)
  ) {
    workspaceYaml =
      (await writeTarget(outDir, 'pnpm-workspace.yaml')) === 'file'
        ? mergePnpmOverrides(
            await fsp.readFile(workspaceYamlPath, 'utf8'),
            merge.pnpmOverrides,
          )
        : null;
    if (workspaceYaml == null) {
      manualSteps.push(
        `pnpm-workspace.yaml could not be edited safely: add ${Object.entries(
          merge.pnpmOverrides,
        )
          .map(([name, spec]) => `${name}: ${spec}`)
          .join(', ')} under its overrides.`,
      );
    }
  }

  // 2. Write.
  const created: string[] = [];
  const kept: string[] = [];
  for (const file of planned) {
    if (targets.get(file.path) !== 'missing') {
      kept.push(file.path);
      continue;
    }
    const filePath = path.join(outDir, file.path);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, file.contents, { flag: 'wx' });
    created.push(file.path);
  }

  await fsp.writeFile(
    packageJsonPath,
    formatJson(merge.packageJson, rawPackageJson),
  );

  let overrides: string | null =
    packageManager === 'pnpm'
      ? null
      : packageManager === 'yarn'
        ? 'package.json resolutions'
        : 'package.json overrides';
  if (inWorkspace) {
    overrides = null;
  } else if (packageManager === 'pnpm') {
    if (workspaceYaml) {
      if (workspaceYaml.added.length > 0) {
        await fsp.writeFile(workspaceYamlPath, workspaceYaml.text);
      }
      if (workspaceYaml.replaced) {
        merge.report.changed.push({
          field: 'pnpm-workspace.yaml overrides',
          name: 'three',
          from: workspaceYaml.replaced,
          to: merge.pnpmOverrides.three,
        });
      }
      overrides = 'pnpm-workspace.yaml overrides';
    } else if (workspaceYaml === null) {
      overrides = null;
    } else {
      const starterWorkspace = byPath.get('pnpm-workspace.yaml');
      if (starterWorkspace) {
        await fsp.writeFile(workspaceYamlPath, starterWorkspace.contents, {
          flag: 'wx',
        });
        created.push('pnpm-workspace.yaml');
        overrides = 'pnpm-workspace.yaml overrides';
      }
    }
  }

  let viteConfig: AdoptReport['viteConfig'];
  if (existingViteConfig == null) {
    const createdConfig = created.find((file) =>
      file.startsWith('vite.config.'),
    );
    viteConfig = { file: createdConfig ?? null, status: 'created' };
  } else if ((await writeTarget(outDir, existingViteConfig)) !== 'file') {
    viteConfig = { file: existingViteConfig, status: 'manual' };
  } else {
    const configPath = path.join(outDir, existingViteConfig);
    const patched = patchViteConfig(await fsp.readFile(configPath, 'utf8'));
    if (patched.status === 'patched') {
      await fsp.writeFile(configPath, patched.text);
    }
    viteConfig = { file: existingViteConfig, status: patched.status };
  }
  if (viteConfig.status === 'manual') {
    manualSteps.push(
      `Add the IWSDK plugin to ${viteConfig.file}: \`import { iwsdkDev } from '@iwsdk/vite-plugin-dev'\` and put \`iwsdkDev()\` in the config's top-level \`plugins\` array.`,
    );
  }
  if (
    existingViteConfig != null &&
    viteConfig.status !== 'already-configured'
  ) {
    manualSteps.push(
      `If the app renders UIKitML panels, also dedupe \`three\` and the \`@pmndrs/uikit*\` packages in ${existingViteConfig} (\`resolve.dedupe\`, \`optimizeDeps.include\`), as the IWSDK starter's Vite config does.`,
    );
  }

  const gitignoreAdded: string[] = [];
  if ((await writeTarget(outDir, '.gitignore')) !== 'blocked') {
    const gitignorePath = path.join(outDir, '.gitignore');
    const current = existsSync(gitignorePath)
      ? await fsp.readFile(gitignorePath, 'utf8')
      : '';
    const present = new Set(current.split(/\r?\n/u).map((line) => line.trim()));
    gitignoreAdded.push(
      ...GITIGNORE_ENTRIES.filter((line) => !present.has(line)),
    );
    if (gitignoreAdded.length > 0) {
      const eol = current.includes('\r\n') ? '\r\n' : '\n';
      await fsp.writeFile(
        gitignorePath,
        `${current}${current && !/\r?\n$/u.test(current) ? eol : ''}${current ? eol : ''}# IWSDK${eol}${gitignoreAdded.join(eol)}${eol}`,
      );
    }
  }

  const entry = planned.find((file) =>
    /^src\/iwsdk\/index\.(?:ts|js)$/u.test(file.path),
  )!.path;
  if (kept.includes('index.html')) {
    const html = await fsp.readFile(path.join(outDir, 'index.html'), 'utf8');
    const entryModule = html.match(
      /<script[^>]*type=["']module["'][^>]*src=["']\/?([^"']+)["']/u,
    )?.[1];
    const entrySource =
      entryModule && existsSync(path.join(outDir, entryModule))
        ? await fsp.readFile(path.join(outDir, entryModule), 'utf8')
        : '';
    const entryFile = entryModule ?? `src/main.${language}`;
    // The skeleton as the entry module imports it: './iwsdk' from src/.
    const relative = path.posix.relative(
      path.posix.dirname(entryFile),
      SKELETON_DIRECTORY,
    );
    const importSpec = relative.startsWith('.') ? relative : `./${relative}`;
    const escaped = importSpec.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
    const importsSkeleton = new RegExp(
      `(?:from|import)\\s*\\(?\\s*['"]${escaped}(?:/index(?:\\.[jt]s)?)?['"]`,
      'u',
    );
    if (
      !html.includes(`/${SKELETON_DIRECTORY}/`) &&
      !importsSkeleton.test(entrySource)
    ) {
      manualSteps.push(
        `Load IWSDK from your app: add \`import '${importSpec}';\` to ${entryFile}, or add \`<script type="module" src="/${entry}"></script>\` to index.html. It calls World.create, which adds the 3D canvas.`,
      );
    }
  }
  if (merge.report.keptScripts.includes('dev')) {
    manualSteps.push(
      `Your \`dev\` script was kept. Start the IWSDK-managed runtime with \`${runScriptCommand(packageManager, 'iwsdk:dev')}\` or \`npx @iwsdk/cli dev up\`.`,
    );
  }

  const guidance = await syncAgentGuidance({
    projectRoot: outDir,
    source: await loadGuidanceSource(guidanceRoot),
  });
  for (const entry of guidance.skipped) {
    manualSteps.push(
      `Agent guidance left ${entry.path} alone: ${entry.detail ?? 'it was edited or is not IWSDK’s'} (\`npx @iwsdk/cli@latest agents sync --force\` replaces edited files).`,
    );
  }

  return {
    packageManager,
    workspaceRoot:
      packageManagerInfo.root === path.resolve(outDir)
        ? null
        : packageManagerInfo.root,
    created: created.sort(),
    kept: kept.sort(),
    packageJson: merge.report,
    overrides,
    viteConfig,
    gitignoreAdded,
    guidance,
    manualSteps,
  };
}

function list(items: string[], limit = 12): string {
  return items.length <= limit
    ? items.join(', ')
    : `${items.slice(0, limit).join(', ')} and ${items.length - limit} more`;
}

export interface AdoptOutcome {
  installed: boolean;
  installError?: string;
  adaptersSynced: boolean;
}

/** Plain-text report; coding agents read this to finish the integration. */
export function printAdoptReport(
  report: AdoptReport,
  outcome: AdoptOutcome,
): void {
  const lines = ['', 'Added IWSDK to the existing project.'];
  if (report.created.length > 0) {
    lines.push(`  Created: ${list(report.created)}`);
  }
  if (report.kept.length > 0) {
    lines.push(`  Kept your existing: ${list(report.kept)}`);
  }
  const { added, changed, keptDependencies, keptScripts } = report.packageJson;
  lines.push(
    `  package.json: added ${[...new Set(added.map((change) => change.name))].join(', ') || 'nothing'}${
      changed.length > 0
        ? `; changed ${changed
            .map((change) => `${change.name} ${change.from} -> ${change.to}`)
            .join(', ')} (required by IWSDK)`
        : ''
    }${keptScripts.length > 0 ? `; kept your scripts: ${keptScripts.join(', ')}` : ''}`,
  );
  for (const dependency of keptDependencies) {
    lines.push(
      `  Left ${dependency.name} at ${dependency.spec}: ${dependency.reason}.`,
    );
  }
  if (report.overrides) {
    lines.push(`  Overrides for three and sharp: ${report.overrides}`);
  }
  lines.push(
    `  Vite config: ${
      {
        created: `created ${report.viteConfig.file}`,
        patched: `added iwsdkDev() to ${report.viteConfig.file}`,
        'already-configured': `${report.viteConfig.file} already uses iwsdkDev()`,
        manual: `could not edit ${report.viteConfig.file} safely`,
      }[report.viteConfig.status]
    }`,
  );
  if (report.gitignoreAdded.length > 0) {
    lines.push(`  .gitignore: added ${report.gitignoreAdded.join(', ')}`);
  }
  const install = `${report.packageManager} install`;
  if (outcome.installError) {
    lines.push(
      `  Dependencies were NOT installed: ${outcome.installError}`,
      `  Fix that, then run \`${install}\`${report.workspaceRoot ? ` (workspace root: ${report.workspaceRoot})` : ''} and \`npx @iwsdk/cli adapter sync\`.`,
    );
  } else if (!outcome.installed) {
    lines.push(
      `  Dependencies were not installed. Run \`${install}\`, then \`npx @iwsdk/cli adapter sync\` to configure coding-tool MCP servers.`,
    );
  } else if (outcome.adaptersSynced) {
    lines.push(
      '  Installed dependencies and wrote coding-tool MCP configs (.mcp.json, .cursor/mcp.json, .vscode/mcp.json, .codex/config.toml, opencode.json).',
    );
  }
  if (report.manualSteps.length > 0) {
    lines.push('', 'To finish:');
    lines.push(...report.manualSteps.map((step) => `  - ${step}`));
  }
  lines.push('', report.guidance.agentNotice, '');
  console.log(lines.join('\n'));
}
