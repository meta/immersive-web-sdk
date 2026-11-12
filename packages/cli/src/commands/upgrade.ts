/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import semver from 'semver';
import {
  GuidanceSourceError,
  findGuidanceProjectRoot,
  installedGuidanceTools,
  readInstalledCoreVersion,
  resolveInstalledCorePackageJson,
  resolveProjectGuidance,
  syncAgentGuidance,
  type SyncAgentGuidanceResult,
} from '../agent-guidance.js';
import { createSuccess } from '../cli-results.js';
import type { CliOptions, CliSuccess, ResolvedCliIo } from '../cli-types.js';
import {
  formatMigrationNotice,
  materializeMigrations,
  migrationsBetween,
  type MaterializedMigration,
} from '../migrations.js';
import {
  findPackageManager,
  readLockedCoreVersion,
} from '../package-manager.js';
import {
  formatReleaseNotesNotice,
  releaseNotesBetween,
  writeReleaseNotes,
} from '../release-notes.js';
import { CLI_VERSION } from '../version.js';

type JsonObject = Record<string, unknown>;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'] as const;
/** Packages released together; the fixed group in .changeset/config.json. */
export const RELEASED_PACKAGES = [
  '@iwsdk/cli',
  '@iwsdk/core',
  '@iwsdk/create',
  '@iwsdk/locomotor',
  '@iwsdk/reference',
  '@iwsdk/reference-assets',
  '@iwsdk/scene-composition',
  '@iwsdk/vite-plugin-dev',
  '@iwsdk/xr-input',
];

interface PackageBump {
  field: string;
  name: string;
  from: string;
  to: string;
}

export interface UpgradeResult {
  projectRoot: string;
  from: string | null;
  to: string;
  dryRun: boolean;
  packageManager: string;
  installed: boolean;
  packages: PackageBump[];
  migrations: Array<{ id: string; introducedIn: string; path?: string }>;
  releaseNotes: { count: number; path?: string; notable?: number };
  configIssues: Array<{ path: string; message: string }>;
  guidance:
    | {
        status: 'synced';
        version: string;
        changed: string[];
        skipped: string[];
      }
    | { status: 'pending' | 'unavailable' | 'none'; message: string };
  manualSteps: string[];
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Indent and line ending of a JSON file, so it is written back the same way. */
function formatJson(value: unknown, raw: string): string {
  const indent = raw.match(/^[{[]\r?\n([ \t]+)\S/u)?.[1] ?? '  ';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const final = /\r?\n$/u.test(raw) ? eol : '';
  return `${JSON.stringify(value, null, indent).replace(/\n/gu, eol)}${final}`;
}

function declaredVersion(packageJson: JsonObject, name: string): string | null {
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson[field];
    if (isRecord(dependencies) && typeof dependencies[name] === 'string') {
      const range = semver.validRange(dependencies[name] as string);
      return range ? (semver.minVersion(range)?.version ?? null) : null;
    }
  }
  return null;
}

/** The new spec in the developer's style: ^ and ~ ranges stay ranges. */
function bumpedSpec(current: string, to: string): string {
  const operator = current.trim().match(/^[\^~]/u)?.[0] ?? '';
  return `${operator}${to}`;
}

/**
 * Install with the project's package manager. Output streams to stderr so
 * stdout stays a single JSON result.
 */
function runInstall(packageManager: string, projectRoot: string): void {
  const result = spawnSync(packageManager, ['install'], {
    cwd: projectRoot,
    stdio: ['ignore', 2, 2],
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw new Error(
      `${packageManager} could not start (${result.error.message}). Install ${packageManager} or enable it with Corepack.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${packageManager} install failed (exit ${result.status ?? result.signal}).`,
    );
  }
}

/**
 * Align the app's Three.js alias with the one the installed core uses,
 * wherever the package manager reads it, and the app's `@types/three` with
 * core's, so the app type-checks against one Three.js. Returns what changed
 * and what the developer has to change by hand.
 */
async function alignThree(
  projectRoot: string,
  packageJson: JsonObject,
  packageManagerRoot: string,
): Promise<{ bumps: PackageBump[]; manualSteps: string[] }> {
  const corePackageJson = resolveInstalledCorePackageJson(projectRoot);
  const coreDependencies = corePackageJson
    ? (
        JSON.parse(readFileSync(corePackageJson, 'utf8')) as {
          dependencies?: Record<string, string>;
        }
      ).dependencies
    : undefined;
  const coreThree = coreDependencies?.three;
  if (!coreThree) {
    return { bumps: [], manualSteps: [] };
  }
  const coreThreeTypes = coreDependencies?.['@types/three'];
  const bumps: PackageBump[] = [];
  const manualSteps: string[] = [];
  const setThree = (record: JsonObject, field: string) => {
    if (typeof record.three === 'string' && record.three !== coreThree) {
      bumps.push({ field, name: 'three', from: record.three, to: coreThree });
      record.three = coreThree;
    }
  };
  // Only where the app already declares it: a mismatched copy makes tsc see
  // two Three.js type trees (core resolves its own).
  const setThreeTypes = (record: JsonObject, field: string) => {
    const current = record['@types/three'];
    if (
      coreThreeTypes &&
      typeof current === 'string' &&
      current !== coreThreeTypes
    ) {
      bumps.push({
        field,
        name: '@types/three',
        from: current,
        to: coreThreeTypes,
      });
      record['@types/three'] = coreThreeTypes;
    }
  };
  for (const field of [
    ...DEPENDENCY_FIELDS,
    'overrides',
    'resolutions',
  ] as const) {
    if (isRecord(packageJson[field])) {
      setThree(packageJson[field] as JsonObject, field);
      setThreeTypes(packageJson[field] as JsonObject, field);
    }
  }
  if (isRecord(packageJson.pnpm) && isRecord(packageJson.pnpm.overrides)) {
    setThree(packageJson.pnpm.overrides, 'pnpm.overrides');
  }
  const workspaceFile = path.join(packageManagerRoot, 'pnpm-workspace.yaml');
  if (existsSync(workspaceFile)) {
    const text = await readFile(workspaceFile, 'utf8');
    const match = text.match(
      /^overrides:\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+three:[ \t]*(\S+)[ \t]*$/mu,
    );
    const current = match?.[1]?.replace(/^['"]|['"]$/gu, '');
    if (match && current && current !== coreThree) {
      if (path.resolve(packageManagerRoot) === path.resolve(projectRoot)) {
        await writeFile(
          workspaceFile,
          text.replace(
            match[0],
            match[0].replace(/three:[ \t]*\S+/u, `three: ${coreThree}`),
          ),
        );
        bumps.push({
          field: 'pnpm-workspace.yaml overrides',
          name: 'three',
          from: current,
          to: coreThree,
        });
      } else {
        manualSteps.push(
          `${path.relative(projectRoot, workspaceFile)} overrides three to ${current}; IWSDK now needs ${coreThree}. Change it once every package in the workspace can move.`,
        );
      }
    }
  }
  return { bumps, manualSteps };
}

interface ConfigIssue {
  path: string;
  message: string;
}

/**
 * Validate iwsdk.config.json with the validator of the @iwsdk/core now
 * installed, so settings the new release renamed or removed show up here
 * instead of as a dev-server error. Null when it could not be checked.
 */
async function validateProjectConfig(
  projectRoot: string,
): Promise<ConfigIssue[] | null> {
  const configPath = path.join(projectRoot, 'iwsdk.config.json');
  if (!existsSync(configPath)) {
    return [];
  }
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    const corePackageJson = resolveInstalledCorePackageJson(projectRoot);
    const projectEntry = corePackageJson
      ? (
          JSON.parse(readFileSync(corePackageJson, 'utf8')) as {
            exports?: Record<string, { import?: string }>;
          }
        ).exports?.['./project']?.import
      : undefined;
    if (!corePackageJson || !projectEntry) {
      return null;
    }
    const projectModule = (await import(
      pathToFileURL(path.join(path.dirname(corePackageJson), projectEntry)).href
    )) as {
      validateIwsdkProjectManifest?: (value: unknown) => {
        issues: ConfigIssue[];
      };
    };
    if (!projectModule.validateIwsdkProjectManifest) {
      return null;
    }
    return projectModule
      .validateIwsdkProjectManifest(config)
      .issues.map(({ path: issuePath, message }) => ({
        path: issuePath,
        message,
      }));
  } catch {
    return null;
  }
}

export async function handleUpgrade(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<UpgradeResult>> {
  let projectRoot: string | null;
  if (typeof options.workspace === 'string') {
    projectRoot = path.resolve(io.cwd, options.workspace);
    if (!existsSync(path.join(projectRoot, 'package.json'))) {
      throw new Error(`--workspace ${options.workspace} has no package.json.`);
    }
  } else {
    projectRoot = findGuidanceProjectRoot(io.cwd);
  }
  if (projectRoot == null) {
    throw new Error(`No package.json found at or above ${io.cwd}.`);
  }
  const root: string = projectRoot;
  const packageJsonPath = path.join(root, 'package.json');
  const rawPackageJson = await readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(rawPackageJson) as unknown;
  if (!isRecord(packageJson)) {
    throw new Error('package.json must contain a JSON object.');
  }
  const to = typeof options.to === 'string' ? options.to : CLI_VERSION;
  if (semver.valid(to) == null) {
    throw new Error(`--to must be an exact IWSDK version, got "${to}".`);
  }
  const packages: PackageBump[] = [];
  const keptSpecs: string[] = [];
  const outsideRelease: string[] = [];
  let declaresIwsdk = false;
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson[field];
    if (!isRecord(dependencies)) {
      continue;
    }
    for (const [name, spec] of Object.entries(dependencies)) {
      if (!name.startsWith('@iwsdk/') || typeof spec !== 'string') {
        continue;
      }
      declaresIwsdk = true;
      if (!RELEASED_PACKAGES.includes(name)) {
        outsideRelease.push(`${name}@${spec}`);
      } else if (semver.validRange(spec) == null) {
        // workspace:, file:, link:, catalog:, git and npm: aliases.
        keptSpecs.push(`${name}@${spec}`);
      } else if (bumpedSpec(spec, to) !== spec) {
        packages.push({ field, name, from: spec, to: bumpedSpec(spec, to) });
      }
    }
  }
  if (!declaresIwsdk) {
    throw new Error(
      `${packageJsonPath} has no @iwsdk/* dependencies. To add IWSDK to this project, run \`npx @iwsdk/create@latest . --yes --target vr\`.`,
    );
  }

  const from =
    readInstalledCoreVersion(root) ??
    readLockedCoreVersion(root) ??
    declaredVersion(packageJson, '@iwsdk/core');
  if (from != null && semver.valid(from) && semver.gt(from, to)) {
    throw new Error(
      `The project already uses IWSDK ${from}, newer than ${to}. Run the matching CLI: npx @iwsdk/cli@${from} upgrade, or pass --to.`,
    );
  }
  const packageManagerInfo = findPackageManager(root);
  const packageManager = packageManagerInfo.name;
  const guides = migrationsBetween(from, to);
  const dryRun =
    options.dryRun !== undefined &&
    options.dryRun !== false &&
    options.dryRun !== 'false';
  const install = options.install !== false && options.noInstall !== true;
  const manualSteps: string[] = [];
  if (keptSpecs.length > 0) {
    manualSteps.push(
      `Left ${keptSpecs.join(', ')} as declared (not registry versions); point them at IWSDK ${to} yourself.`,
    );
  }
  if (outsideRelease.length > 0) {
    manualSteps.push(
      `${outsideRelease.join(', ')} ${outsideRelease.length === 1 ? 'is' : 'are'} not part of the IWSDK release and ${outsideRelease.length === 1 ? 'was' : 'were'} left as declared.${guides.length > 0 ? ' If a migration guide lists one as retired, remove it as the guide says.' : ''}`,
    );
  }

  if (dryRun) {
    return createSuccess({
      projectRoot: root,
      from,
      to,
      dryRun,
      packageManager,
      installed: false,
      packages,
      migrations: guides.map(({ id, introducedIn }) => ({ id, introducedIn })),
      releaseNotes: { count: releaseNotesBetween(from, to).length },
      configIssues: [],
      guidance: {
        status: 'pending',
        message: 'Dry run: nothing was written.',
      },
      manualSteps,
    });
  }

  for (const bump of packages) {
    (packageJson[bump.field] as JsonObject)[bump.name] = bump.to;
  }
  if (packages.length > 0) {
    await writeFile(packageJsonPath, formatJson(packageJson, rawPackageJson));
  }

  // Written before installing: an install that fails on a retired package
  // is exactly when the agent needs the migration guide.
  const migrations: MaterializedMigration[] = await materializeMigrations(
    root,
    guides,
  );
  const releaseNotes = await writeReleaseNotes(root, from, to);
  const migrationNotice = [
    formatMigrationNotice(from, to, migrations),
    formatReleaseNotesNotice(from, to, releaseNotes),
  ]
    .filter(Boolean)
    .join('\n');
  const installOrExplain = () => {
    io.stderr.write(`[IWSDK] Running ${packageManager} install ...\n`);
    try {
      runInstall(packageManager, root);
    } catch (error) {
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `package.json already lists IWSDK ${to}. Fix the error, run \`${packageManager} install\`${packageManagerInfo.root !== root ? ` (workspace root: ${packageManagerInfo.root})` : ''}, then \`npx @iwsdk/cli@latest agents sync\`.`,
          migrationNotice,
          ...manualSteps,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  };

  let guidance: UpgradeResult['guidance'];
  let guidanceResult: SyncAgentGuidanceResult | null = null;
  let configIssues: ConfigIssue[] = [];
  if (install) {
    installOrExplain();
    const three = await alignThree(root, packageJson, packageManagerInfo.root);
    manualSteps.push(...three.manualSteps);
    if (three.bumps.length > 0) {
      packages.push(...three.bumps);
      await writeFile(packageJsonPath, formatJson(packageJson, rawPackageJson));
      installOrExplain();
    }
    try {
      const source = await resolveProjectGuidance(root);
      // Refresh the coding tools the project already has guidance for; one
      // without any is the developer's call.
      const tools = await installedGuidanceTools(root, source);
      if (tools.length === 0) {
        guidance = {
          status: 'none',
          message:
            'This project has no IWSDK agent guidance; `npx @iwsdk/cli@latest agents sync` adds it.',
        };
      } else {
        guidanceResult = await syncAgentGuidance({
          projectRoot: root,
          source,
          tools,
        });
        guidance = {
          status: 'synced',
          version: guidanceResult.version,
          changed: guidanceResult.results
            .filter(
              (entry) =>
                entry.action !== 'unchanged' && entry.action !== 'skipped',
            )
            .map((entry) => entry.path),
          skipped: guidanceResult.skipped.map((entry) => entry.path),
        };
      }
    } catch (error) {
      if (!(error instanceof GuidanceSourceError)) {
        throw error;
      }
      guidance = { status: 'unavailable', message: error.message };
    }
    const issues = await validateProjectConfig(root);
    if (issues == null) {
      manualSteps.push(
        `Could not check iwsdk.config.json against IWSDK ${to}; the dev server reports settings it rejects.`,
      );
    } else if (issues.length > 0) {
      configIssues = issues;
      manualSteps.push(
        `iwsdk.config.json does not validate against IWSDK ${to}: ${issues
          .map((issue) => `${issue.path} ${issue.message}`)
          .join(
            '; ',
          )}. The migration guides and release notes say what replaced each setting.`,
      );
    }
  } else {
    guidance = {
      status: 'pending',
      message: `Dependencies were not installed. Run \`${packageManager} install\`, then \`npx @iwsdk/cli@latest agents sync\`.`,
    };
    manualSteps.push(guidance.message);
  }

  const notice = [
    `[IWSDK] Upgraded ${from ?? 'IWSDK'} -> ${to}.`,
    migrationNotice,
    guidanceResult?.agentNotice ??
      (guidance.status !== 'synced' ? guidance.message : ''),
    ...(guidanceResult && guidanceResult.skipped.length > 0
      ? [
          `Left edited guidance files alone: ${guidanceResult.skipped.map((entry) => entry.path).join(', ')} (\`npx @iwsdk/cli@latest agents sync --force\` replaces them).`,
        ]
      : []),
    ...manualSteps.filter(
      (step) => guidance.status === 'synced' || step !== guidance.message,
    ),
  ]
    .filter(Boolean)
    .join('\n');
  io.stderr.write(`${notice}\n`);

  return createSuccess({
    projectRoot: root,
    from,
    to,
    dryRun,
    packageManager,
    installed: install,
    packages,
    migrations: migrations.map(({ id, introducedIn, path: guidePath }) => ({
      id,
      introducedIn,
      path: guidePath,
    })),
    releaseNotes: releaseNotes ?? { count: 0 },
    configIssues,
    guidance,
    manualSteps,
  });
}
