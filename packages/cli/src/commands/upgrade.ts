/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFile, spawnSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
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
  usesYarnBerry,
  type PackageManagerInfo,
} from '../package-manager.js';
import {
  formatReleaseNotesNotice,
  releaseNotesBetween,
  writeReleaseNotes,
} from '../release-notes.js';
import { CLI_VERSION } from '../version.js';

type JsonObject = Record<string, unknown>;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'] as const;
/** Packages published together (the fixed group in .changeset/config.json, minus private @iwsdk/reference-assets). */
export const RELEASED_PACKAGES = [
  '@iwsdk/cli',
  '@iwsdk/core',
  '@iwsdk/create',
  '@iwsdk/locomotor',
  '@iwsdk/reference',
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
 * Thrown when the upgrade stops before writing anything; `code` becomes the
 * error code of the CLI's JSON failure.
 */
export class UpgradeError extends Error {
  constructor(
    message: string,
    readonly code: 'release_not_on_registry',
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'UpgradeError';
  }
}

/**
 * How to start a package manager. On Windows npm, pnpm and yarn are .cmd
 * shims, which Node starts only through a shell, so they get one command
 * line: a shell plus an argument list is deprecated (DEP0190). Callers pass
 * arguments that need no quoting.
 */
function commandLine(
  command: string,
  args: string[],
): { file: string; args: string[]; shell: boolean } {
  return process.platform === 'win32'
    ? { file: [command, ...args].join(' '), args: [], shell: true }
    : { file: command, args, shell: false };
}

/**
 * Install with the project's package manager. Output streams to stderr so
 * stdout stays a single JSON result.
 */
function runInstall(packageManager: string, projectRoot: string): void {
  const command = commandLine(packageManager, ['install']);
  const result = spawnSync(command.file, command.args, {
    cwd: projectRoot,
    stdio: ['ignore', 2, 2],
    shell: command.shell,
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

const execFileAsync = promisify(execFile);

/**
 * How long one registry command may run (the lookups run in parallel) before
 * the upgrade goes on without the check.
 */
const REGISTRY_TIMEOUT_MS = 20_000;
/**
 * One retry, a second later, a 10 s response timeout and no check for a newer
 * npm. npm's defaults retry twice, 10 and 60 s apart, and wait 5 minutes for
 * a response, so a lookup without a network took over a minute to fail.
 */
const NPM_FETCH_FLAGS = [
  '--fetch-retries=1',
  '--fetch-retry-mintimeout=1000',
  '--fetch-retry-maxtimeout=2000',
  '--fetch-timeout=10000',
  '--no-update-notifier',
];
/** The same bounds for Yarn, which reads them from the environment. */
const YARN_FETCH_ENV = { YARN_HTTP_RETRY: '1', YARN_HTTP_TIMEOUT: '10000' };

/** Yarn in Yarn 2+ projects, which ignore .npmrc; npm everywhere else. */
export type RegistryClient = 'npm' | 'yarn';

/** How to ask the registry the install uses; see `registryLookup`. */
export interface RegistryLookup {
  client: RegistryClient;
  /** Where the client runs. */
  cwd: string;
  /** Flags for every npm call. */
  npmArgs?: string[];
  /**
   * npm_config_* variables for every npm call: the registry and auth
   * settings of an app's own .npmrc, which pnpm and Yarn 1 merge over the
   * workspace root's.
   */
  env?: Record<string, string>;
  /** A Yarn 1 project: Yarn, run here, names its registry; npm asks it. */
  yarnClassicCwd?: string;
}

/** The fields of a published package.json that the upgrade reads. */
interface PublishedManifest {
  version?: string;
  dependencies?: Record<string, string>;
  /** Every published version (npm is asked for it for core only). */
  versions?: string[];
}

export type ReleaseCheck =
  | { status: 'found'; registry: string; core?: PublishedManifest }
  | {
      status: 'missing';
      registry: string;
      /** Each package the registry does not have at the version. */
      missing: Array<{
        /** `<name>@<version>`. */
        spec: string;
        /** npm's or Yarn's error. */
        reason: string;
        /** No such package, which a registry also answers when you may not access it. */
        packageNotFound: boolean;
      }>;
      /** The registry is the one set for the @iwsdk scope. */
      scoped: boolean;
    }
  | { status: 'unavailable'; registry: string | null; reason: string };

/** Names a registry npm asks but would not print. */
const UNNAMED_NPM_REGISTRY = "npm's configured registry";

async function runRegistryClient(
  client: RegistryClient,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string> = {},
): Promise<string> {
  const command = commandLine(client, args);
  const overrides: Record<string, string> = {
    // Corepack would ask before downloading a pinned version; nobody answers.
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ...(client === 'yarn' ? YARN_FETCH_ENV : {}),
    ...env,
  };
  // npm reads NPM_CONFIG_CACHE and npm_config_cache alike: an override
  // replaces every spelling of its name.
  const replaced = new Set(
    Object.keys(overrides).map((name) => name.toLowerCase()),
  );
  const { stdout } = await execFileAsync(command.file, command.args, {
    cwd,
    shell: command.shell,
    timeout: timeoutMs,
    encoding: 'utf8',
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !replaced.has(name.toLowerCase()),
        ),
      ),
      ...overrides,
    },
  });
  return stdout;
}

/** The JSON value npm printed, or each JSON line Yarn printed. */
function jsonOutput(client: RegistryClient, stdout: string): unknown[] {
  return (client === 'npm' ? [stdout] : stdout.split(/\r?\n/u)).flatMap(
    (chunk) => {
      try {
        return [JSON.parse(chunk) as unknown];
      } catch {
        return [];
      }
    },
  );
}

/**
 * Hides the credentials a registry URL can carry, as npm does in its logs: up
 * to the last @ before the host, since a password can hold an unencoded @.
 */
function redactUrls(text: string): string {
  return text.replace(/\b([a-z][a-z\d+.-]*:\/\/)[^/\s]*@/giu, '$1***@');
}

/**
 * Why a registry command failed, and whether it means the registry does not
 * have the package: `version` when it has the package but not that version,
 * `package` when it has no such package (registries answer that too when you
 * may not access it). A missing npm, a network error or a timeout says
 * nothing about the release.
 */
function registryFailure(
  client: RegistryClient,
  error: unknown,
  timeoutMs: number,
): { notFound: 'version' | 'package' | null; reason: string } {
  const failure = error as {
    syscall?: string;
    killed?: boolean;
    message?: string;
    stdout?: string;
    stderr?: string;
  };
  if (failure.syscall?.startsWith('spawn')) {
    return {
      notFound: null,
      reason: `${client} could not start: ${failure.message}`,
    };
  }
  if (failure.killed) {
    return {
      notFound: null,
      reason: `${client} did not answer within ${timeoutMs / 1000} s`,
    };
  }
  const stdout = failure.stdout ?? '';
  const stderr = failure.stderr ?? '';
  // npm: {"error":{"code","summary"}}. Yarn: a {"type":"error","data"} line
  // per message, the first line of each data the gist.
  const messages = jsonOutput(client, stdout).flatMap((value) =>
    isRecord(value) && isRecord(value.error)
      ? [`${String(value.error.code)}: ${String(value.error.summary)}`]
      : isRecord(value) && value.type === 'error'
        ? [String(value.data).split('\n')[0].trim()]
        : [],
  );
  const output = `${stdout}\n${stderr}`;
  return {
    notFound:
      /\bETARGET\b|No match found for version|No matching version found/u.test(
        output,
      )
        ? 'version'
        : /\bE404\b|Response Code: 404\b/u.test(output)
          ? 'package'
          : null,
    reason: redactUrls(
      messages.slice(0, 2).join('; ') ||
        stderr
          .split(/\r?\n/u)
          .find((line) => line.trim() !== '')
          ?.trim() ||
        (failure.message ?? String(error)),
    ),
  };
}

interface ConfiguredRegistry {
  /** The registry URL, or null for one npm asks but would not print. */
  url: string | null;
  /** Set for the @iwsdk scope, not as the default registry. */
  scoped: boolean;
}

/** `name<separator>value` lines as a map; the first line for a name wins. */
function settingLines(
  text: string,
  line: RegExp,
  decode: (value: string) => unknown = (value) => value,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of text.split(/\r?\n/u).map((entry) => entry.match(line))) {
    if (match && !values.has(match[1])) {
      try {
        const value = decode(match[2].trim());
        if (typeof value === 'string') {
          values.set(match[1], value);
        }
      } catch {
        // Not a value.
      }
    }
  }
  return values;
}

/**
 * The registry npm takes @iwsdk packages from, run with `npmArgs` and the
 * variables in `env` in `cwd`.
 */
async function npmRegistry(
  cwd: string,
  npmArgs: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<ConfiguredRegistry> {
  const npm = (args: string[]) =>
    runRegistryClient(
      'npm',
      [...args, '--no-update-notifier', ...npmArgs],
      cwd,
      timeoutMs,
      env,
    );
  let output: string;
  try {
    output = await npm(['config', 'get', '@iwsdk:registry', 'registry']);
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    if (/\bENOWORKSPACES\b/u.test(stderr)) {
      // `npm config` does not run in an npm workspace package. `npm view`
      // does, with the workspace root's settings, as `npm install` there.
      return { url: null, scoped: false };
    }
    if (!/option is protected/u.test(stderr)) {
      throw error;
    }
    // npm 10 and 11 do not print a registry URL that has a password in it,
    // and npm view still uses it. `npm config ls` prints it with the
    // password hidden: the first uncommented line for a setting holds the
    // value in effect (publishConfig values follow).
    const shown = settingLines(
      await npm(['config', 'ls']).catch(() => ''),
      /^(\S+) = (".*")$/u,
      (value) => JSON.parse(value) as unknown,
    );
    const scoped = shown.get('@iwsdk:registry');
    return scoped
      ? { url: scoped, scoped: true }
      : { url: shown.get('registry') ?? null, scoped: false };
  }
  // key=value lines; @iwsdk:registry=undefined without a scope registry.
  const values = settingLines(output, /^([^=]+)=(.*)$/u);
  const scoped = values.get('@iwsdk:registry');
  return scoped && scoped !== 'undefined'
    ? { url: scoped, scoped: true }
    : { url: values.get('registry') ?? '', scoped: false };
}

/**
 * The registry Yarn 1 installs @iwsdk packages from, configured in `cwd`.
 * Yarn 1 reads .npmrc and .yarnrc files (the project's, the user's, and those
 * above the project) and npm_config_* and yarn_* variables, and takes an npm
 * setting over a Yarn one: the @iwsdk scope's registry, then the default
 * registry, then registry.yarnpkg.com. `yarn config get registry` prefers the
 * Yarn setting, so it can name another registry than the one Yarn installs
 * from.
 */
async function yarnClassicRegistry(
  cwd: string,
  timeoutMs: number,
): Promise<ConfiguredRegistry> {
  // {"type":"info","data":"yarn config"}, then {"type":"inspect","data":{…}};
  // the same for "npm config".
  const configs = new Map<string, JsonObject>();
  let name = '';
  for (const value of jsonOutput(
    'yarn',
    await runRegistryClient(
      'yarn',
      ['config', 'list', '--json'],
      cwd,
      timeoutMs,
    ),
  )) {
    if (isRecord(value) && value.type === 'info') {
      name = String(value.data);
    } else if (
      isRecord(value) &&
      value.type === 'inspect' &&
      isRecord(value.data)
    ) {
      configs.set(name, value.data);
    }
  }
  const yarn = configs.get('yarn config');
  if (!yarn) {
    throw new Error('yarn config list printed no Yarn settings');
  }
  const npm = configs.get('npm config') ?? {};
  const setting = (config: JsonObject, key: string) =>
    typeof config[key] === 'string' && config[key] !== ''
      ? (config[key] as string)
      : undefined;
  const scoped =
    setting(npm, '@iwsdk:registry') ?? setting(yarn, '@iwsdk:registry');
  return scoped
    ? { url: scoped, scoped: true }
    : {
        url:
          setting(npm, 'registry') ??
          setting(yarn, 'registry') ??
          'https://registry.yarnpkg.com',
        scoped: false,
      };
}

/** The registry Yarn 2+ takes @iwsdk packages from, configured in `cwd`. */
async function yarnBerryRegistry(
  cwd: string,
  timeoutMs: number,
): Promise<ConfiguredRegistry> {
  const [scopes, server] = await Promise.all([
    runRegistryClient(
      'yarn',
      ['config', 'get', 'npmScopes', '--json'],
      cwd,
      timeoutMs,
    ),
    runRegistryClient(
      'yarn',
      ['config', 'get', 'npmRegistryServer'],
      cwd,
      timeoutMs,
    ),
  ]);
  const scoped = jsonOutput('npm', scopes).map((value) =>
    isRecord(value) && isRecord(value.iwsdk)
      ? value.iwsdk.npmRegistryServer
      : undefined,
  )[0];
  return typeof scoped === 'string' && scoped !== ''
    ? { url: scoped, scoped: true }
    : { url: server.trim(), scoped: false };
}

/** One package at `version`, from the registry; Yarn prints every field. */
async function viewRelease(
  { client, cwd, npmArgs = [] }: RegistryLookup,
  name: string,
  version: string,
  fields: string[],
  timeoutMs: number,
  env: Record<string, string>,
): Promise<
  | { kind: 'found'; manifest: PublishedManifest }
  | { kind: 'missing'; reason: string; packageNotFound: boolean }
  | { kind: 'failed'; reason: string }
> {
  let stdout: string;
  try {
    stdout = await runRegistryClient(
      client,
      client === 'npm'
        ? [
            'view',
            `${name}@${version}`,
            ...fields,
            '--json',
            ...NPM_FETCH_FLAGS,
            ...npmArgs,
          ]
        : ['npm', 'info', `${name}@${version}`, '--json'],
      cwd,
      timeoutMs,
      env,
    );
  } catch (error) {
    const failure = registryFailure(client, error, timeoutMs);
    return failure.notFound
      ? {
          kind: 'missing',
          reason: failure.reason,
          packageNotFound: failure.notFound === 'package',
        }
      : { kind: 'failed', reason: failure.reason };
  }
  // npm prints the bare value when only one field has one. Yarn prints a
  // line per package and, for a version it does not have, the latest one.
  const manifest = jsonOutput(client, stdout)
    .map((value): PublishedManifest | null =>
      typeof value === 'string'
        ? { version: value }
        : isRecord(value) && (client === 'npm' || value.name === name)
          ? (value as PublishedManifest)
          : null,
    )
    .find((value) => value != null);
  return manifest?.version === version
    ? { kind: 'found', manifest }
    : {
        kind: 'missing',
        reason: `No match found for version ${version}`,
        packageNotFound: false,
      };
}

/**
 * Removal of a temporary npm cache retries for up to 3 s: on Windows, an npm
 * that a timeout left running (it stops only the cmd.exe that started npm)
 * can keep the folder busy.
 */
const CACHE_REMOVAL = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
} as const;

/**
 * Runs `run` with a new, empty npm cache folder, removed afterwards or, if it
 * is still busy then, when the CLI exits. Until then, an interrupt removes it
 * too: SIGINT and SIGTERM are handled only when nothing else handles them,
 * and raised again, so they still end the CLI. Rejects when no folder can be
 * made.
 */
async function withEmptyNpmCache<T>(
  run: (cache: string) => Promise<T>,
): Promise<T> {
  const cache = await mkdtemp(path.join(os.tmpdir(), 'iwsdk-npm-cache-'));
  const removeNow = () => {
    try {
      rmSync(cache, { recursive: true, force: true });
    } catch {
      // Left to the system's temporary-file cleanup.
    }
  };
  const interrupted = (signal: NodeJS.Signals) => {
    removeNow();
    process.kill(process.pid, signal);
  };
  const signals = (['SIGINT', 'SIGTERM'] as const).filter(
    (signal) => process.listenerCount(signal) === 0,
  );
  process.once('exit', removeNow);
  for (const signal of signals) {
    process.once(signal, interrupted);
  }
  try {
    return await run(cache);
  } finally {
    const removed = await rm(cache, CACHE_REMOVAL).then(
      () => true,
      () => false,
    );
    for (const signal of signals) {
      process.off(signal, interrupted);
    }
    if (removed) {
      process.off('exit', removeNow);
    }
  }
}

/**
 * Ask the registry for every package at `version` before anything is
 * written, the way the install will ask it (see `registryLookup`). Says which
 * registry it asks on `stderr`.
 */
export async function checkRegistry({
  names,
  version,
  stderr,
  timeoutMs = REGISTRY_TIMEOUT_MS,
  ...lookup
}: RegistryLookup & {
  names: string[];
  version: string;
  stderr: NodeJS.WritableStream;
  timeoutMs?: number;
}): Promise<ReleaseCheck> {
  // Which client names the registry: Yarn in any Yarn project.
  const namedBy: RegistryClient = lookup.yarnClassicCwd
    ? 'yarn'
    : lookup.client;
  let configured: ConfiguredRegistry;
  try {
    configured =
      lookup.client === 'yarn'
        ? await yarnBerryRegistry(lookup.cwd, timeoutMs)
        : lookup.yarnClassicCwd
          ? await yarnClassicRegistry(lookup.yarnClassicCwd, timeoutMs)
          : await npmRegistry(
              lookup.cwd,
              lookup.npmArgs ?? [],
              lookup.env ?? {},
              timeoutMs,
            );
  } catch (error) {
    return {
      status: 'unavailable',
      registry: null,
      reason: registryFailure(namedBy, error, timeoutMs).reason,
    };
  }
  if (configured.url != null && !/^https?:\/\//iu.test(configured.url)) {
    // Yarn 1 answers "undefined" for Yarn 2+ settings.
    return {
      status: 'unavailable',
      registry: null,
      reason: `${namedBy} reported no registry URL ("${redactUrls(configured.url)}")`,
    };
  }
  const registry =
    configured.url == null ? UNNAMED_NPM_REGISTRY : redactUrls(configured.url);
  // In a Yarn 1 project, npm asks the registry Yarn installs from.
  const env: Record<string, string> = {
    ...lookup.env,
    ...(lookup.yarnClassicCwd && configured.url
      ? { npm_config_registry: configured.url }
      : {}),
  };
  stderr.write(`[IWSDK] Checking ${registry} for IWSDK ${version} ...\n`);
  const view = (name: string, cache?: string) =>
    viewRelease(
      lookup,
      name,
      version,
      name === '@iwsdk/core'
        ? ['version', 'dependencies', 'versions']
        : ['version'],
      timeoutMs,
      cache ? { ...env, npm_config_cache: cache } : env,
    );
  let results = await Promise.all(names.map((name) => view(name)));
  if (
    lookup.client === 'npm' &&
    results.some((result) => result.kind === 'missing')
  ) {
    // Without a network, npm answers from its cache, and a package cached
    // before the release was published says the release does not exist. A
    // published version never changes, so a cached answer that has it stands;
    // one without it is asked again with an empty cache, which only the
    // registry can answer. Without an empty cache, it stays unchecked.
    const cached = results;
    results = await withEmptyNpmCache((cache) =>
      Promise.all(
        cached.map((result, index) =>
          result.kind === 'missing' ? view(names[index], cache) : result,
        ),
      ),
    ).catch((error: unknown) =>
      cached.map((result) =>
        result.kind === 'missing'
          ? {
              kind: 'failed' as const,
              reason: `${result.reason}, maybe from npm's cache, and no empty cache could be created to ask the registry: ${error instanceof Error ? error.message : String(error)}`,
            }
          : result,
      ),
    );
  }
  const missing: Extract<ReleaseCheck, { status: 'missing' }>['missing'] = [];
  let failure: string | null = null;
  let core: PublishedManifest | undefined;
  results.forEach((result, index) => {
    if (result.kind === 'found') {
      core = names[index] === '@iwsdk/core' ? result.manifest : core;
    } else if (result.kind === 'missing') {
      missing.push({
        spec: `${names[index]}@${version}`,
        reason: result.reason,
        packageNotFound: result.packageNotFound,
      });
    } else {
      failure ??= result.reason;
    }
  });
  if (missing.length > 0) {
    return { status: 'missing', registry, missing, scoped: configured.scoped };
  }
  if (failure != null) {
    return { status: 'unavailable', registry, reason: failure };
  }
  return { status: 'found', registry, core };
}

/** A .npmrc value as npm's ini parser reads it. */
function iniValue(raw: string): string {
  const value = raw.trim();
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value;
    }
  }
  // Up to a ; or # comment; a backslash escapes either.
  return (value.match(/^(?:\\.?|[^\\;#])*/su)?.[0] ?? '')
    .replace(/\\([\\;#])/gu, '$1')
    .trim();
}

/**
 * The settings in the .npmrc in `directory` that pick the registry of @iwsdk
 * packages or authenticate with one: `registry`, `@iwsdk:registry` and the
 * `//<registry>/:<setting>` keys. Lines after a [section] hold no settings.
 */
function npmrcRegistrySettings(directory: string): Map<string, string> {
  const settings = new Map<string, string>();
  let text: string;
  try {
    text = readFileSync(path.join(directory, '.npmrc'), 'utf8');
  } catch {
    return settings;
  }
  for (const line of text.split(/[\r\n]+/u)) {
    if (/^\s*\[/u.test(line)) {
      break;
    }
    const match = line.match(/^\s*([^\s;#=][^=]*)=(.*)$/u);
    const key = match?.[1].trim() ?? '';
    if (
      key === 'registry' ||
      key === '@iwsdk:registry' ||
      key.startsWith('//')
    ) {
      settings.set(key, iniValue(match![2]));
    }
  }
  return settings;
}

/** The settings npm_config_* variables set, under npm's names for them. */
function environmentSettings(): Set<string> {
  return new Set(
    Object.entries(process.env)
      .filter(([name, value]) => /^npm_config_./iu.test(name) && value !== '')
      .map(([name]) => {
        const key = name.slice('npm_config_'.length);
        return key.startsWith('//')
          ? key
          : key.replace(/(?!^)_/gu, '-').toLowerCase();
      }),
  );
}

/**
 * How to ask the registry the install will use. The install runs in the
 * project directory.
 * - npm installs there with the workspace root's .npmrc and ignores the
 *   project's own, so npm runs in the workspace root.
 * - pnpm and Yarn 1 merge the project's own .npmrc over the workspace root's,
 *   setting by setting: a scope registry or a token only the root sets still
 *   applies. When both set the registry or auth, npm runs in the workspace
 *   root and gets the project's registry and auth settings as npm_config_*
 *   variables, which npm takes over any .npmrc (unless the environment
 *   already sets them, as pnpm and Yarn 1 then do too). Otherwise npm runs in
 *   whichever directory sets them, the root when neither does. npm gets
 *   --no-workspaces, so that it reads the .npmrc there and not that of a root
 *   whose package.json declares workspaces.
 * - Yarn 1 also takes the registry from .yarnrc, so Yarn names it.
 * - Yarn 2+ reads only .yarnrc.yml, and is asked itself.
 */
export function registryLookup(
  projectRoot: string,
  info: PackageManagerInfo,
): RegistryLookup {
  if (usesYarnBerry(projectRoot, info)) {
    return { client: 'yarn', cwd: info.root };
  }
  if (info.name !== 'pnpm' && info.name !== 'yarn') {
    return { client: 'npm', cwd: info.root };
  }
  const project = path.resolve(projectRoot);
  const own = npmrcRegistrySettings(project);
  const root =
    path.resolve(info.root) === project
      ? new Map<string, string>()
      : npmrcRegistrySettings(info.root);
  const merge = own.size > 0 && root.size > 0;
  const inEnvironment = merge ? environmentSettings() : new Set<string>();
  return {
    client: 'npm',
    cwd: own.size > 0 && !merge ? project : info.root,
    npmArgs: ['--no-workspaces'],
    ...(merge
      ? {
          env: Object.fromEntries(
            [...own]
              .filter(([key]) => !inEnvironment.has(key))
              .map(([key, value]) => [`npm_config_${key}`, value]),
          ),
        }
      : {}),
    ...(info.name === 'yarn' ? { yarnClassicCwd: project } : {}),
  };
}

/** The dependencies of the @iwsdk/core installed in the project. */
function installedCoreDependencies(
  projectRoot: string,
): Record<string, string> | undefined {
  const corePackageJson = resolveInstalledCorePackageJson(projectRoot);
  return corePackageJson
    ? (
        JSON.parse(readFileSync(corePackageJson, 'utf8')) as {
          dependencies?: Record<string, string>;
        }
      ).dependencies
    : undefined;
}

/**
 * Align the app's Three.js alias with the one core uses, wherever the
 * package manager reads it, and the app's `@types/three` with core's, so the
 * app type-checks against one Three.js. Returns what changed and what the
 * developer has to change by hand; `write: false` only plans.
 */
async function alignThree(
  projectRoot: string,
  packageJson: JsonObject,
  packageManagerRoot: string,
  coreDependencies: Record<string, string> | undefined,
  write: boolean,
): Promise<{ bumps: PackageBump[]; manualSteps: string[] }> {
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
        if (write) {
          await writeFile(
            workspaceFile,
            text.replace(
              match[0],
              match[0].replace(/three:[ \t]*\S+/u, `three: ${coreThree}`),
            ),
          );
        }
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
  const requested = typeof options.to === 'string' ? options.to : CLI_VERSION;
  // Normalized: v1.2.0 and 1.2.0 name the same release.
  const to = semver.valid(requested);
  if (to == null) {
    throw new Error(`--to must be an exact IWSDK version, got "${requested}".`);
  }
  const packages: PackageBump[] = [];
  const keptSpecs: string[] = [];
  const outsideRelease: string[] = [];
  const fromRegistry = new Set<string>();
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
      } else {
        fromRegistry.add(name);
        if (bumpedSpec(spec, to) !== spec) {
          packages.push({ field, name, from: spec, to: bumpedSpec(spec, to) });
        }
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

  // Before anything is written: a registry without the release (a mirror
  // that has not synced it) stops the upgrade here, not with package.json
  // half changed, and three follows the new core's even when nothing gets
  // installed. A registry that cannot be asked does not stop it; three is
  // then aligned with the core the install brings.
  const lookup = registryLookup(root, packageManagerInfo);
  const release =
    fromRegistry.size > 0
      ? await checkRegistry({
          names: [...fromRegistry],
          version: to,
          ...lookup,
          stderr: io.stderr,
        })
      : null;
  if (release?.status === 'missing') {
    // Packages missing at that version, then packages missing altogether,
    // which a registry also answers for packages you may not access.
    const specs = (entries: Array<{ spec: string }>) =>
      entries.map((entry) => entry.spec).join(', ');
    const noVersion = release.missing.filter((entry) => !entry.packageNotFound);
    const noPackage = release.missing.filter((entry) => entry.packageNotFound);
    const absent = [
      noVersion.length > 0
        ? `${specs(noVersion)} (${noVersion[0].reason})`
        : '',
      noPackage.length > 0
        ? `${specs(noPackage)}, or you do not have permission to access ${noPackage.length === 1 ? 'it' : 'them'} (${noPackage[0].reason})`
        : '',
    ]
      .filter(Boolean)
      .join(', and does not have ');
    // npm, pnpm and Yarn 1 take the variable over .npmrc and .yarnrc; it does
    // not replace a registry set for the @iwsdk scope.
    const override =
      lookup.client === 'npm' && packageManager !== 'bun' && !release.scoped
        ? ' (the npm_config_registry environment variable overrides the configured one)'
        : '';
    throw new UpgradeError(
      `${release.registry} does not have ${absent}. Nothing was changed. A registry mirror can lag behind a release: upgrade once it has IWSDK ${to}, or point the project at a registry that does${override}.`,
      'release_not_on_registry',
      {
        registry: release.registry,
        version: to,
        missing: release.missing.map((entry) => entry.spec),
      },
    );
  }
  for (const bump of packages) {
    (packageJson[bump.field] as JsonObject)[bump.name] = bump.to;
  }
  const publishedCore = release?.status === 'found' ? release.core : undefined;
  const three = await alignThree(
    root,
    packageJson,
    packageManagerInfo.root,
    publishedCore?.dependencies,
    !dryRun,
  );
  packages.push(...three.bumps);
  manualSteps.push(...three.manualSteps);
  // True until three is aligned with the core the install brings.
  let threePending = false;
  if (release?.status === 'unavailable') {
    const unchecked = `Could not check ${release.registry ?? 'the registry'} for IWSDK ${to} (${release.reason})`;
    if (dryRun) {
      manualSteps.push(
        `${unchecked}: three alignment will be decided after install.`,
      );
    } else {
      io.stderr.write(`[IWSDK] ${unchecked}; upgrading without it.\n`);
      threePending = true;
      if (!install) {
        manualSteps.push(
          `${unchecked}, so three was left as declared: run \`npx @iwsdk/cli@latest upgrade --to ${to}\` again, without --no-install, to align it with the new @iwsdk/core.`,
        );
      }
    }
  }
  // three now follows core `to`. Without an install, nothing re-checks it
  // when a ^ or ~ range brings in a newer core instead.
  const coreSpec = DEPENDENCY_FIELDS.map((field) =>
    isRecord(packageJson[field])
      ? (packageJson[field] as JsonObject)['@iwsdk/core']
      : undefined,
  ).find((spec): spec is string => typeof spec === 'string');
  const newerCore =
    !install &&
    publishedCore?.dependencies?.three &&
    Array.isArray(publishedCore.versions) &&
    coreSpec &&
    /^[\^~]/u.test(coreSpec.trim())
      ? semver.maxSatisfying(publishedCore.versions, coreSpec)
      : null;
  if (newerCore && semver.gt(newerCore, to)) {
    manualSteps.push(
      `@iwsdk/core ${coreSpec} also matches ${newerCore}, which an install can pick instead of ${to}, and three was aligned with ${to}. Pin @iwsdk/core to ${to}, or if ${newerCore} is installed, run \`npx @iwsdk/cli@latest upgrade --to ${newerCore}\`.`,
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
          threePending
            ? `package.json already lists IWSDK ${to}. Fix the error, then run \`npx @iwsdk/cli@latest upgrade --to ${to}\` again: three still has to be aligned with the new @iwsdk/core.`
            : `package.json already lists IWSDK ${to}. Fix the error, run \`${packageManager} install\`${packageManagerInfo.root !== root ? ` (workspace root: ${packageManagerInfo.root})` : ''}, then \`npx @iwsdk/cli@latest agents sync\`.`,
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
    // The installed core can still differ from the registry's: a file: or
    // workspace: core, or a ^ range that resolved past the target. And when
    // the registry could not be checked, this is the only alignment.
    const installedThree = await alignThree(
      root,
      packageJson,
      packageManagerInfo.root,
      installedCoreDependencies(root),
      true,
    );
    threePending = false;
    manualSteps.push(
      ...installedThree.manualSteps.filter(
        (step) => !manualSteps.includes(step),
      ),
    );
    if (installedThree.bumps.length > 0) {
      packages.push(...installedThree.bumps);
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
  } else if (threePending) {
    // The step that says to run upgrade again, which installs, aligns three
    // and syncs the guidance, stands for "install, then agents sync": that
    // would leave three as declared.
    guidance = {
      status: 'pending',
      message: 'Dependencies were not installed.',
    };
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
