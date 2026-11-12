/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, realpathSync } from 'fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import semver from 'semver';
// Type-only: @iwsdk/create bundles this module, and runtime-contract is large.
import type { AiTool } from './runtime-contract.js';

/** Same list as SUPPORTED_AI_TOOLS; test/agent-guidance.test.ts checks it. */
export const GUIDANCE_TOOLS: AiTool[] = [
  'claude',
  'cursor',
  'copilot',
  'codex',
  'opencode',
];

// Hash and stamp format. Keep in sync with
// packages/core/scripts/agent-guidance-format.mjs, which renders the files;
// test/agent-guidance.test.ts checks both sides against a fresh render.
const GUIDANCE_FORMAT = 1;
const BLOCK_NAME = 'iwsdk-agent-guidance';
const STAMP_LINE =
  /^<!-- iwsdk-agent-guidance version=(\S+) sha256=([0-9a-f]{64})(?: name=(\S+))? [^\n]*-->\r?\n?/mu;
const BLOCK_PATTERN = new RegExp(
  `<!-- BEGIN ${BLOCK_NAME} version=(\\S+) sha256=([0-9a-f]{64}) -->\\n([\\s\\S]*?)<!-- END ${BLOCK_NAME} -->\\n?`,
  'u',
);
const BLOCK_BEGIN = new RegExp(`<!-- BEGIN ${BLOCK_NAME}\\b`, 'gu');
const BLOCK_END = new RegExp(`<!-- END ${BLOCK_NAME} -->`, 'gu');
// Releases before the managed block opened AGENTS.md and CLAUDE.md with this
// heading ("# IWSDK Project" in 0.4, "# IWSDK project" later).
const LEGACY_IWSDK_HEADING = /^# IWSDK (?:scoped )?project/iu;
const SKILL_PERMISSION = /^Skill\((iwsdk-[^)]*)\)$/u;
/** Files that operating systems and editors drop into folders; never hashed. */
const JUNK_FILE = /^(?:\.DS_Store|Thumbs\.db|desktop\.ini)$|\.swp$|~$/u;
// Same sentence as the top of agent-guidance/common/AGENTS.md in @iwsdk/core.
const RETIRED_SURFACES_NOTICE =
  "IWSDK changes faster than model training data. GLXF scenes, the external 0.4 scene editor and its Vite plugin, and the UIKitML-compile and glTF-optimizer Vite plugins were removed in 0.5: scenes are native `*.iwsdk.scene.json` files edited in IWSDK's built-in editor, and `@iwsdk/vite-plugin-dev` is the only IWSDK Vite plugin.";

type UnitKind =
  | 'block'
  | 'claude-import'
  | 'claude-settings'
  | 'directory'
  | 'file';

export interface GuidanceUnit {
  kind: UnitKind;
  path: string;
  tools: AiTool[];
  sha256?: string;
  files?: string[];
  skills?: string[];
}

export interface GuidanceManifest {
  format: number;
  package: string;
  version: string;
  units: GuidanceUnit[];
  legacy: Record<string, string[]>;
}

export interface GuidanceSource {
  /** Directory holding manifest.json and files/. */
  root: string;
  manifest: GuidanceManifest;
  /** Where the guidance came from, for reporting. */
  origin: 'installed-core' | 'bundled-cli' | 'explicit';
}

export type GuidanceAction =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'removed'
  | 'skipped';

export interface GuidanceUnitResult {
  path: string;
  kind: UnitKind;
  action: GuidanceAction;
  /** Why a unit was skipped, or how it was updated. */
  reason?:
    | 'modified'
    | 'unmanaged'
    | 'legacy-modified'
    | 'malformed-block'
    | 'invalid-json'
    | 'newer'
    | 'forced'
    | 'appended'
    | 'legacy';
  /** What to do about a skipped unit, when that needs more than --force. */
  detail?: string;
}

export interface GuidanceSkillSummary {
  name: string;
  description: string;
  paths: string[];
}

export interface SyncAgentGuidanceResult {
  projectRoot: string;
  version: string;
  origin: GuidanceSource['origin'];
  tools: AiTool[];
  dryRun: boolean;
  /** True when files were (or, in a dry run, would be) written or removed. */
  changed: boolean;
  results: GuidanceUnitResult[];
  skipped: GuidanceUnitResult[];
  skills: GuidanceSkillSummary[];
  agentNotice: string;
}

export interface SyncAgentGuidanceOptions {
  projectRoot: string;
  source: GuidanceSource;
  tools?: AiTool[];
  /** Replace edited or unmanaged files instead of skipping them. */
  force?: boolean;
  /** Report what would change without writing. */
  dryRun?: boolean;
}

export class GuidanceSourceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'core_not_installed'
      | 'core_without_guidance'
      | 'guidance_unavailable'
      | 'unsupported_guidance_format',
  ) {
    super(message);
    this.name = 'GuidanceSourceError';
  }
}

function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/gu, '\n');
}

function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function stripStamp(text: string): string {
  return normalizeText(text).replace(STAMP_LINE, '');
}

interface Stamp {
  version: string;
  sha256: string;
  name?: string;
}

function readStamp(text: string): Stamp | null {
  const match = normalizeText(text).match(STAMP_LINE);
  return match ? { version: match[1], sha256: match[2], name: match[3] } : null;
}

export function fileUnitHash(text: string): string {
  return sha256(stripStamp(text));
}

export function directoryUnitHash(
  files: ReadonlyMap<string, string | Buffer>,
): string {
  const hash = createHash('sha256');
  for (const [relativePath, contents] of [...files].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const digest =
      typeof contents === 'string' ? fileUnitHash(contents) : sha256(contents);
    hash.update(`${relativePath}\0${digest}\n`);
  }
  return hash.digest('hex');
}

export function blockUnitHash(body: string): string {
  return sha256(withTrailingNewline(normalizeText(body)));
}

function isTextFile(name: string): boolean {
  return !/\.(png|jpe?g|webp|gif|glb|mp3|ktx2)$/iu.test(name);
}

async function readTree(
  root: string,
  relative = '',
  files = new Map<string, string | Buffer>(),
): Promise<Map<string, string | Buffer>> {
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
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
        isTextFile(entry.name) ? contents.toString('utf8') : contents,
      );
    }
  }
  return files;
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function assertRelativeUnitPath(unitPath: string): void {
  if (
    path.isAbsolute(unitPath) ||
    unitPath
      .split(/[\\/]/u)
      .some((segment) => segment === '..' || segment === '')
  ) {
    throw new GuidanceSourceError(
      `Guidance manifest contains an unsafe path: ${unitPath}`,
      'guidance_unavailable',
    );
  }
}

export async function loadGuidanceSource(
  root: string,
  origin: GuidanceSource['origin'] = 'explicit',
): Promise<GuidanceSource> {
  const manifestPath = path.join(root, 'manifest.json');
  const raw = await readTextIfExists(manifestPath);
  if (raw == null) {
    throw new GuidanceSourceError(
      `No agent guidance manifest at ${manifestPath}`,
      'guidance_unavailable',
    );
  }
  let manifest: GuidanceManifest;
  try {
    manifest = JSON.parse(raw) as GuidanceManifest;
  } catch {
    throw new GuidanceSourceError(
      `The agent guidance manifest at ${manifestPath} is not valid JSON. Reinstall IWSDK.`,
      'guidance_unavailable',
    );
  }
  if (manifest.format !== GUIDANCE_FORMAT) {
    throw new GuidanceSourceError(
      `Agent guidance format ${manifest.format} is not supported by this @iwsdk/cli (expects ${GUIDANCE_FORMAT}). Use the @iwsdk/cli release that matches @iwsdk/core.`,
      'unsupported_guidance_format',
    );
  }
  for (const unit of manifest.units) {
    assertRelativeUnitPath(unit.path);
    for (const file of unit.files ?? []) {
      assertRelativeUnitPath(file);
    }
  }
  return { root, manifest, origin };
}

function bundledGuidanceRoot(): string {
  return fileURLToPath(new URL('./agent-guidance/', import.meta.url));
}

/** Version of `@iwsdk/core` installed for the project, or null. */
export function readInstalledCoreVersion(projectRoot: string): string | null {
  const packageJsonPath = resolveInstalledCorePackageJson(projectRoot);
  if (packageJsonPath == null) {
    return null;
  }
  try {
    return (
      (
        JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
          version?: string;
        }
      ).version ?? null
    );
  } catch {
    return null;
  }
}

/**
 * The installed `@iwsdk/core/package.json`, looked up fresh each time. Node's
 * resolver caches paths per process, so after `pnpm install` re-points
 * node_modules/@iwsdk/core it would still return the old release.
 */
export function resolveInstalledCorePackageJson(
  projectRoot: string,
): string | null {
  let current = path.resolve(projectRoot);
  while (true) {
    const candidate = path.join(
      current,
      'node_modules',
      '@iwsdk',
      'core',
      'package.json',
    );
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  // Layouts without node_modules folders (Yarn Plug'n'Play).
  try {
    return createRequire(path.join(projectRoot, 'package.json')).resolve(
      '@iwsdk/core/package.json',
    );
  } catch {
    return null;
  }
}

/**
 * Guidance for a project: the copy shipped in its installed `@iwsdk/core`, so
 * it always matches the installed release. Before `@iwsdk/core` is installed,
 * the copy bundled with this CLI is used instead.
 */
export async function resolveProjectGuidance(
  projectRoot: string,
): Promise<GuidanceSource> {
  const corePackageJson = resolveInstalledCorePackageJson(projectRoot);
  if (corePackageJson != null) {
    const root = path.join(
      path.dirname(corePackageJson),
      'dist',
      'agent-guidance',
    );
    if (!existsSync(path.join(root, 'manifest.json'))) {
      const version = readInstalledCoreVersion(projectRoot) ?? 'unknown';
      throw new GuidanceSourceError(
        `The installed @iwsdk/core ${version} predates bundled agent guidance. Upgrade IWSDK with \`npx @iwsdk/cli@latest upgrade\`.`,
        'core_without_guidance',
      );
    }
    return loadGuidanceSource(root, 'installed-core');
  }
  if (declaresCore(projectRoot)) {
    // Guidance from this CLI could belong to a different release than the
    // one the project declares; wait for the real one.
    throw new GuidanceSourceError(
      `package.json lists @iwsdk/core, but it is not installed in ${projectRoot}. Install the project's dependencies first, then run this command again.`,
      'core_not_installed',
    );
  }
  return loadGuidanceSource(bundledGuidanceRoot(), 'bundled-cli');
}

function declaresCore(projectRoot: string): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'peerDependencies'].some(
      (field) => {
        const dependencies = manifest[field];
        return (
          typeof dependencies === 'object' &&
          dependencies !== null &&
          '@iwsdk/core' in dependencies
        );
      },
    );
  } catch {
    return false;
  }
}

function selectedUnits(
  manifest: GuidanceManifest,
  tools: readonly AiTool[],
): GuidanceUnit[] {
  return manifest.units.filter((unit) =>
    unit.tools.some((tool) => tools.includes(tool)),
  );
}

interface Writer {
  dryRun: boolean;
  projectRoot: string;
  /** Write one file through a temporary sibling, so a reader never sees half. */
  write(relativePath: string, contents: string | Buffer): Promise<void>;
  /**
   * Replace a folder with exactly these files. The new folder is written next
   * to the old one and swapped in, so an interrupted sync leaves either the
   * old folder or the new one, never a mix that looks edited.
   */
  replaceDirectory(
    relativePath: string,
    files: ReadonlyArray<[string, Buffer]>,
  ): Promise<void>;
  remove(relativePath: string): Promise<void>;
}

async function resolveLink(filePath: string): Promise<string> {
  try {
    return (await lstat(filePath)).isSymbolicLink()
      ? await realpath(filePath)
      : filePath;
  } catch {
    return filePath;
  }
}

/** Both paths name the same file once every link on the way is followed. */
async function isSameFile(first: string, second: string): Promise<boolean> {
  try {
    return (await realpath(first)) === (await realpath(second));
  } catch {
    return false;
  }
}

/** Temporary siblings a sync left behind when it was killed mid-swap. */
const TEMPORARY_SIBLING = /^\..+\.iwsdk-(?:new|old)-(\d+)-(\d+)$/u;

/** A temporary sibling that a sync running right now may still need. */
function isInUse(name: string): boolean {
  const [, pid, createdAt] = TEMPORARY_SIBLING.exec(name) ?? [];
  if (Date.now() - Number(createdAt) < 10 * 60_000) {
    return true;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function temporarySibling(filePath: string, label: string): string {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.iwsdk-${label}-${process.pid}-${Date.now()}`,
  );
}

function createWriter(projectRoot: string, dryRun: boolean): Writer {
  return {
    dryRun,
    projectRoot,
    async write(relativePath, contents) {
      if (dryRun) {
        return;
      }
      // Write through a link (CLAUDE.md -> AGENTS.md is common), so the
      // rename replaces the file it points at, not the link itself.
      const filePath = await resolveLink(path.join(projectRoot, relativePath));
      await mkdir(path.dirname(filePath), { recursive: true });
      const staged = temporarySibling(filePath, 'new');
      try {
        await writeFile(staged, contents);
        await rename(staged, filePath);
      } finally {
        await rm(staged, { force: true });
      }
    },
    async replaceDirectory(relativePath, files) {
      if (dryRun) {
        return;
      }
      const target = path.join(projectRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      const staged = temporarySibling(target, 'new');
      const previous = temporarySibling(target, 'old');
      try {
        for (const [file, contents] of files) {
          const filePath = path.join(staged, file);
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, contents);
        }
        const hadPrevious = existsSync(target);
        if (hadPrevious) {
          await rename(target, previous);
        }
        try {
          await rename(staged, target);
        } catch (error) {
          if (hadPrevious) {
            await rename(previous, target);
          }
          throw error;
        }
      } finally {
        await rm(staged, { recursive: true, force: true });
        await rm(previous, { recursive: true, force: true });
      }
    },
    async remove(relativePath) {
      if (dryRun) {
        return;
      }
      await rm(path.join(projectRoot, relativePath), {
        recursive: true,
        force: true,
      });
      await removeEmptyParents(projectRoot, path.dirname(relativePath));
    },
  };
}

async function removeEmptyParents(
  projectRoot: string,
  relativeDirectory: string,
): Promise<void> {
  let current = relativeDirectory;
  while (current && current !== '.') {
    try {
      await rmdir(path.join(projectRoot, current));
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

async function readSourceFile(
  source: GuidanceSource,
  relativePath: string,
): Promise<Buffer> {
  return readFile(path.join(source.root, 'files', relativePath));
}

/** Text written back with the line endings the existing file used. */
function withLineEndings(text: string, existing: string): string {
  return existing.includes('\r\n') ? text.replace(/\r?\n/gu, '\r\n') : text;
}

type Ownership =
  | 'unchanged'
  | 'managed'
  | 'legacy'
  | 'modified'
  | 'unmanaged'
  | 'newer';

function classify(
  localHash: string,
  targetHash: string | undefined,
  stamp: Stamp | null,
  legacyHashes: readonly string[] | undefined,
  manifestVersion: string,
): Ownership {
  if (targetHash !== undefined && localHash === targetHash) {
    return 'unchanged';
  }
  if (stamp) {
    if (stamp.sha256 !== localHash) {
      return 'modified';
    }
    // Written by a newer release than this guidance: an older CLI or core
    // must not roll it back.
    return semver.valid(stamp.version) &&
      semver.valid(manifestVersion) &&
      semver.gt(stamp.version, manifestVersion)
      ? 'newer'
      : 'managed';
  }
  return legacyHashes?.includes(localHash) ? 'legacy' : 'unmanaged';
}

function replacementResult(
  unit: Pick<GuidanceUnit, 'path' | 'kind'>,
  ownership: Ownership,
  force: boolean,
): GuidanceUnitResult | null {
  if (ownership === 'managed') {
    return { path: unit.path, kind: unit.kind, action: 'updated' };
  }
  if (ownership === 'legacy') {
    return {
      path: unit.path,
      kind: unit.kind,
      action: 'updated',
      reason: 'legacy',
    };
  }
  if (ownership === 'newer') {
    return {
      path: unit.path,
      kind: unit.kind,
      action: 'skipped',
      reason: 'newer',
      detail: 'Written by a newer IWSDK release; upgrade @iwsdk/core.',
    };
  }
  if (ownership === 'modified' || ownership === 'unmanaged') {
    return force
      ? {
          path: unit.path,
          kind: unit.kind,
          action: 'updated',
          reason: 'forced',
        }
      : {
          path: unit.path,
          kind: unit.kind,
          action: 'skipped',
          reason: ownership,
        };
  }
  return null;
}

async function pathKind(
  filePath: string,
): Promise<'missing' | 'directory' | 'file' | 'other'> {
  try {
    const stat = await lstat(filePath);
    return stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }
}

async function syncDirectoryUnit(
  unit: GuidanceUnit,
  source: GuidanceSource,
  writer: Writer,
  force: boolean,
): Promise<GuidanceUnitResult> {
  const localRoot = path.join(writer.projectRoot, unit.path);
  const replace = async () => {
    const files: Array<[string, Buffer]> = [];
    for (const file of unit.files ?? []) {
      files.push([file, await readSourceFile(source, `${unit.path}/${file}`)]);
    }
    await writer.replaceDirectory(unit.path, files);
  };
  const kind = await pathKind(localRoot);
  const localFiles = kind === 'directory' ? await readTree(localRoot) : null;
  if (kind === 'missing' || localFiles?.size === 0) {
    await replace();
    return { path: unit.path, kind: unit.kind, action: 'created' };
  }
  if (localFiles == null) {
    // A file or link where the skill folder belongs.
    if (!force) {
      return {
        path: unit.path,
        kind: unit.kind,
        action: 'skipped',
        reason: 'unmanaged',
      };
    }
    await writer.remove(unit.path);
    await replace();
    return {
      path: unit.path,
      kind: unit.kind,
      action: 'updated',
      reason: 'forced',
    };
  }
  const skill = localFiles.get('SKILL.md');
  const ownership = classify(
    directoryUnitHash(localFiles),
    unit.sha256,
    typeof skill === 'string' ? readStamp(skill) : null,
    source.manifest.legacy[unit.path],
    source.manifest.version,
  );
  if (ownership === 'unchanged') {
    return { path: unit.path, kind: unit.kind, action: 'unchanged' };
  }
  const result = replacementResult(unit, ownership, force)!;
  if (result.action === 'updated') {
    await replace();
  }
  return result;
}

async function syncFileUnit(
  unit: GuidanceUnit,
  source: GuidanceSource,
  writer: Writer,
  force: boolean,
): Promise<GuidanceUnitResult> {
  const local = await readTextIfExists(
    path.join(writer.projectRoot, unit.path),
  );
  const next = await readSourceFile(source, unit.path);
  if (local == null) {
    await writer.write(unit.path, next);
    return { path: unit.path, kind: unit.kind, action: 'created' };
  }
  const ownership = classify(
    fileUnitHash(local),
    unit.sha256,
    readStamp(local),
    source.manifest.legacy[unit.path],
    source.manifest.version,
  );
  if (ownership === 'unchanged') {
    return { path: unit.path, kind: unit.kind, action: 'unchanged' };
  }
  const result = replacementResult(unit, ownership, force)!;
  if (result.action === 'updated') {
    await writer.write(unit.path, next);
  }
  return result;
}

async function syncBlockUnit(
  unit: GuidanceUnit,
  source: GuidanceSource,
  writer: Writer,
  force: boolean,
): Promise<GuidanceUnitResult> {
  const local = await readTextIfExists(
    path.join(writer.projectRoot, unit.path),
  );
  const block = (await readSourceFile(source, unit.path)).toString('utf8');
  if (local == null) {
    await writer.write(unit.path, block);
    return { path: unit.path, kind: unit.kind, action: 'created' };
  }
  const normalized = normalizeText(local);
  const begins = normalized.match(BLOCK_BEGIN)?.length ?? 0;
  const ends = normalized.match(BLOCK_END)?.length ?? 0;
  const match = normalized.match(BLOCK_PATTERN);
  if (begins > 0 || ends > 0) {
    if (begins !== 1 || ends !== 1 || !match) {
      // A lost END line or a duplicated block: neither appending nor
      // replacing can tell IWSDK's text from the developer's.
      return {
        path: unit.path,
        kind: unit.kind,
        action: 'skipped',
        reason: 'malformed-block',
        detail:
          'Its iwsdk-agent-guidance markers are broken. Keep exactly one BEGIN and one END line, or delete the block, then sync again.',
      };
    }
    const ownership = classify(
      blockUnitHash(match[3]),
      unit.sha256,
      { version: match[1], sha256: match[2] },
      undefined,
      source.manifest.version,
    );
    if (ownership === 'unchanged') {
      return { path: unit.path, kind: unit.kind, action: 'unchanged' };
    }
    const result = replacementResult(unit, ownership, force)!;
    if (result.action === 'updated') {
      await writer.write(
        unit.path,
        withLineEndings(
          normalized.replace(BLOCK_PATTERN, () => block),
          local,
        ),
      );
    }
    return result;
  }
  if (source.manifest.legacy[unit.path]?.includes(fileUnitHash(local))) {
    await writer.write(unit.path, withLineEndings(block, local));
    return {
      path: unit.path,
      kind: unit.kind,
      action: 'updated',
      reason: 'legacy',
    };
  }
  if (LEGACY_IWSDK_HEADING.test(normalized.trimStart())) {
    // An edited copy of guidance from a release before the managed block.
    // Appending would leave two contradicting versions in one file.
    if (!force) {
      return {
        path: unit.path,
        kind: unit.kind,
        action: 'skipped',
        reason: 'legacy-modified',
        detail:
          'It holds edited guidance from an IWSDK release before 1.2; --force replaces the whole file.',
      };
    }
    await writer.write(unit.path, withLineEndings(block, local));
    return {
      path: unit.path,
      kind: unit.kind,
      action: 'updated',
      reason: 'forced',
    };
  }
  await writer.write(
    unit.path,
    withLineEndings(
      `${withTrailingNewline(normalized)}${normalized.trim() ? '\n' : ''}${block}`,
      local,
    ),
  );
  return {
    path: unit.path,
    kind: unit.kind,
    action: 'updated',
    reason: 'appended',
  };
}

async function syncClaudeImport(
  unit: GuidanceUnit,
  source: GuidanceSource,
  writer: Writer,
  force: boolean,
): Promise<GuidanceUnitResult> {
  const rootFile = await readTextIfExists(
    path.join(writer.projectRoot, unit.path),
  );
  const nestedFile = await readTextIfExists(
    path.join(writer.projectRoot, '.claude', 'CLAUDE.md'),
  );
  const next = await readSourceFile(source, unit.path);
  if (rootFile == null && nestedFile == null) {
    await writer.write(unit.path, next);
    return { path: unit.path, kind: unit.kind, action: 'created' };
  }
  if (
    rootFile != null &&
    (await isSameFile(
      path.join(writer.projectRoot, unit.path),
      path.join(writer.projectRoot, 'AGENTS.md'),
    ))
  ) {
    // CLAUDE.md is a link to AGENTS.md: Claude already reads the guidance.
    return { path: unit.path, kind: unit.kind, action: 'unchanged' };
  }
  if (
    rootFile != null &&
    fileUnitHash(rootFile) !== fileUnitHash(next.toString('utf8')) &&
    source.manifest.legacy[unit.path]?.includes(fileUnitHash(rootFile))
  ) {
    // Releases before 1.0 put the full guidance in CLAUDE.md.
    await writer.write(
      unit.path,
      withLineEndings(next.toString('utf8'), rootFile),
    );
    return {
      path: unit.path,
      kind: unit.kind,
      action: 'updated',
      reason: 'legacy',
    };
  }
  if (
    rootFile != null &&
    !/^@AGENTS\.md\s*$/mu.test(rootFile) &&
    LEGACY_IWSDK_HEADING.test(normalizeText(rootFile).trimStart())
  ) {
    if (!force) {
      return {
        path: unit.path,
        kind: unit.kind,
        action: 'skipped',
        reason: 'legacy-modified',
        detail:
          'It holds edited guidance from an IWSDK release before 1.0; --force replaces the whole file with an @AGENTS.md import.',
      };
    }
    await writer.write(
      unit.path,
      withLineEndings(next.toString('utf8'), rootFile),
    );
    return {
      path: unit.path,
      kind: unit.kind,
      action: 'updated',
      reason: 'forced',
    };
  }
  if (
    (rootFile != null && /^@AGENTS\.md\s*$/mu.test(rootFile)) ||
    (nestedFile != null && /^@\.\.\/AGENTS\.md\s*$/mu.test(nestedFile))
  ) {
    return { path: unit.path, kind: unit.kind, action: 'unchanged' };
  }
  if (rootFile != null) {
    await writer.write(
      unit.path,
      withLineEndings(
        `${withTrailingNewline(rootFile)}\n@AGENTS.md\n`,
        rootFile,
      ),
    );
    return {
      path: unit.path,
      kind: unit.kind,
      action: 'updated',
      reason: 'appended',
    };
  }
  await writer.write(
    '.claude/CLAUDE.md',
    withLineEndings(
      `${withTrailingNewline(nestedFile!)}\n@../AGENTS.md\n`,
      nestedFile!,
    ),
  );
  return {
    path: '.claude/CLAUDE.md',
    kind: unit.kind,
    action: 'updated',
    reason: 'appended',
  };
}

/** Skill names IWSDK has shipped: this release's and every earlier one's. */
export function ownedSkillNames(manifest: GuidanceManifest): Set<string> {
  const names = new Set<string>();
  for (const unit of manifest.units) {
    for (const skill of unit.skills ?? []) {
      names.add(skill);
    }
  }
  for (const unitPath of Object.keys(manifest.legacy)) {
    const match = unitPath.match(/^\.(?:claude|agents)\/skills\/([^/]+)$/u);
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

async function syncClaudeSettings(
  unit: GuidanceUnit,
  source: GuidanceSource,
  writer: Writer,
  installedSkills: ReadonlySet<string>,
  retiredSkills: ReadonlySet<string>,
  force: boolean,
): Promise<GuidanceUnitResult> {
  const filePath = path.join(writer.projectRoot, unit.path);
  const raw = await readTextIfExists(filePath);
  let settings: Record<string, unknown> = {};
  if (raw != null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {
        path: unit.path,
        kind: unit.kind,
        action: 'skipped',
        reason: 'invalid-json',
        detail: `${filePath} is not a JSON object (comments and trailing commas are not supported), so its IWSDK skill permissions were not updated.`,
      };
    }
    settings = parsed as Record<string, unknown>;
  }
  const permissions =
    typeof settings.permissions === 'object' &&
    settings.permissions !== null &&
    !Array.isArray(settings.permissions)
      ? { ...(settings.permissions as Record<string, unknown>) }
      : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const shipped = new Set(unit.skills ?? []);
  const owned = new Set([
    ...ownedSkillNames(source.manifest),
    ...retiredSkills,
  ]);
  // Grant skills this sync installed (all of them for a new settings file);
  // a permission the developer removed for an untouched skill stays removed.
  // Grant every shipped skill when the file is new, when --force is given, or
  // when no IWSDK skill permission is left (after `adapter prune`, say).
  const grantAll =
    raw == null ||
    force ||
    !allow.some((rule) => {
      const name =
        typeof rule === 'string'
          ? rule.match(SKILL_PERMISSION)?.[1]
          : undefined;
      return name != null && owned.has(name);
    });
  const grant = [...shipped].filter(
    (name) => grantAll || installedSkills.has(name),
  );
  const isRetired = (rule: unknown) => {
    const name =
      typeof rule === 'string' ? rule.match(SKILL_PERMISSION)?.[1] : undefined;
    return name != null && owned.has(name) && !shipped.has(name);
  };
  const nextAllow = allow.filter((rule) => !isRetired(rule));
  for (const name of grant) {
    if (!nextAllow.includes(`Skill(${name})`)) {
      nextAllow.push(`Skill(${name})`);
    }
  }
  if (
    raw != null &&
    nextAllow.length === allow.length &&
    nextAllow.every((rule, index) => rule === allow[index])
  ) {
    return { path: unit.path, kind: unit.kind, action: 'unchanged' };
  }
  permissions.allow = nextAllow;
  const next = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    ...settings,
    permissions,
  };
  await writer.write(unit.path, `${JSON.stringify(next, null, 2)}\n`);
  return {
    path: unit.path,
    kind: unit.kind,
    action: raw == null ? 'created' : 'updated',
  };
}

/** Where retired units can be left behind, and the tools that use them. */
const PRUNE_ROOTS: Array<{
  directory: string;
  kind: 'directory' | 'file';
  match: RegExp;
  tools: AiTool[];
}> = [
  {
    directory: '.claude/skills',
    kind: 'directory',
    match: /^iwsdk-/u,
    tools: ['claude'],
  },
  {
    directory: '.agents/skills',
    kind: 'directory',
    match: /^iwsdk-/u,
    tools: ['codex', 'cursor', 'copilot', 'opencode'],
  },
  {
    directory: '.claude/rules',
    kind: 'file',
    match: /\.md$/u,
    tools: ['claude'],
  },
  {
    directory: '.claude/agents',
    kind: 'file',
    match: /\.md$/u,
    tools: ['claude'],
  },
  {
    directory: '.cursor/rules',
    kind: 'file',
    match: /\.mdc$/u,
    tools: ['cursor'],
  },
  {
    directory: '.github/instructions',
    kind: 'file',
    match: /\.instructions\.md$/u,
    tools: ['copilot'],
  },
];

function toolsForPath(unitPath: string): readonly AiTool[] {
  const root = PRUNE_ROOTS.find((candidate) =>
    unitPath.startsWith(`${candidate.directory}/`),
  );
  if (root) {
    return root.tools;
  }
  if (unitPath.startsWith('.cursor/')) {
    return ['cursor'];
  }
  if (unitPath.startsWith('.github/')) {
    return ['copilot'];
  }
  return GUIDANCE_TOOLS;
}

async function pruneRetiredUnits(
  source: GuidanceSource,
  tools: readonly AiTool[],
  writer: Writer,
): Promise<{ results: GuidanceUnitResult[]; removedSkills: Set<string> }> {
  const shipped = new Set(source.manifest.units.map((unit) => unit.path));
  const blocks = new Set(
    source.manifest.units
      .filter((unit) => unit.kind === 'block' || unit.kind === 'claude-import')
      .map((unit) => unit.path),
  );
  const candidates = new Map<string, 'directory' | 'file'>();
  for (const root of PRUNE_ROOTS) {
    if (!root.tools.some((tool) => tools.includes(tool))) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(path.join(writer.projectRoot, root.directory), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        root.match.test(entry.name) &&
        (root.kind === 'directory' ? entry.isDirectory() : entry.isFile())
      ) {
        candidates.set(`${root.directory}/${entry.name}`, root.kind);
      }
    }
  }
  // Files earlier releases wrote outside these folders, such as 0.4's
  // .github/copilot-instructions.md, are known by path from the legacy table.
  for (const unitPath of Object.keys(source.manifest.legacy)) {
    if (
      !candidates.has(unitPath) &&
      !blocks.has(unitPath) &&
      toolsForPath(unitPath).some((tool) => tools.includes(tool))
    ) {
      const kind = await pathKind(path.join(writer.projectRoot, unitPath));
      if (kind === 'directory' || kind === 'file') {
        candidates.set(unitPath, kind);
      }
    }
  }
  const results: GuidanceUnitResult[] = [];
  const removedSkills = new Set<string>();
  for (const directory of ['.', ...PRUNE_ROOTS.map((root) => root.directory)]) {
    let entries;
    try {
      entries = await readdir(path.join(writer.projectRoot, directory));
    } catch {
      continue;
    }
    for (const name of entries.filter(
      (entry) => TEMPORARY_SIBLING.test(entry) && !isInUse(entry),
    )) {
      await writer.remove(path.posix.join(directory, name));
    }
  }
  for (const [unitPath, kind] of candidates) {
    if (shipped.has(unitPath)) {
      continue;
    }
    const name = path.posix.basename(unitPath);
    let localHash: string;
    let stamp: Stamp | null;
    if (kind === 'directory') {
      const files = await readTree(path.join(writer.projectRoot, unitPath));
      const skill = files.get('SKILL.md');
      localHash = directoryUnitHash(files);
      stamp = typeof skill === 'string' ? readStamp(skill) : null;
    } else {
      const text = await readFile(
        path.join(writer.projectRoot, unitPath),
        'utf8',
      );
      localHash = fileUnitHash(text);
      stamp = readStamp(text);
    }
    if (stamp?.name != null && stamp.name !== name) {
      // A copy of an IWSDK unit the developer saved under another name.
      continue;
    }
    const ownership = classify(
      localHash,
      undefined,
      stamp,
      source.manifest.legacy[unitPath],
      source.manifest.version,
    );
    if (ownership === 'managed' || ownership === 'legacy') {
      await writer.remove(unitPath);
      results.push({ path: unitPath, kind, action: 'removed' });
      if (kind === 'directory') {
        removedSkills.add(name);
      }
    } else if (ownership === 'modified') {
      // A retired IWSDK unit the developer edited: keep it, but say so.
      results.push({
        path: unitPath,
        kind,
        action: 'skipped',
        reason: 'modified',
      });
    }
  }
  return { results, removedSkills };
}

function readSkillDescription(text: string): string {
  const frontmatter = normalizeText(text).match(/^---\n([\s\S]*?)\n---/u)?.[1];
  if (!frontmatter) {
    return '';
  }
  const lines = frontmatter.split('\n');
  const index = lines.findIndex((line) => line.startsWith('description:'));
  if (index === -1) {
    return '';
  }
  const inline = lines[index].slice('description:'.length).trim();
  if (inline && !/^[>|]-?$/u.test(inline)) {
    return inline.replace(/^['"]|['"]$/gu, '');
  }
  const folded: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (!/^\s+\S/u.test(line)) {
      break;
    }
    folded.push(line.trim());
  }
  return folded.join(' ');
}

async function summarizeSkills(
  source: GuidanceSource,
  tools: readonly AiTool[],
): Promise<GuidanceSkillSummary[]> {
  const byName = new Map<string, GuidanceSkillSummary>();
  for (const unit of selectedUnits(source.manifest, tools)) {
    if (unit.kind !== 'directory') {
      continue;
    }
    const name = unit.path.split('/').pop()!;
    const summary = byName.get(name) ?? {
      name,
      description: readSkillDescription(
        (await readSourceFile(source, `${unit.path}/SKILL.md`)).toString(
          'utf8',
        ),
      ),
      paths: [],
    };
    summary.paths.push(`${unit.path}/SKILL.md`);
    byName.set(name, summary);
  }
  for (const summary of byName.values()) {
    // Claude Code's copy first; it is the path most sessions can load.
    summary.paths.sort((left, right) =>
      left.startsWith('.claude/') === right.startsWith('.claude/')
        ? left.localeCompare(right)
        : left.startsWith('.claude/')
          ? -1
          : 1,
    );
  }
  return [...byName.values()].sort((left, right) =>
    left.name === 'iwsdk-dev'
      ? -1
      : right.name === 'iwsdk-dev'
        ? 1
        : left.name.localeCompare(right.name),
  );
}

function buildAgentNotice(
  source: GuidanceSource,
  skills: GuidanceSkillSummary[],
  dryRun: boolean,
  changedCount: number,
): string {
  const version = source.manifest.version;
  const entry = skills.find((skill) => skill.name === 'iwsdk-dev');
  return [
    dryRun
      ? `This project is checked against IWSDK ${version} agent guidance.`
      : changedCount > 0
        ? `Installed IWSDK ${version} agent guidance in this project (${changedCount} file${changedCount === 1 ? '' : 's'} or folder${changedCount === 1 ? '' : 's'} written or removed).`
        : `This project's IWSDK ${version} agent guidance is already current; nothing was written.`,
    ...(source.origin === 'bundled-cli'
      ? [
          `This project does not list @iwsdk/core yet, so this is the guidance bundled with @iwsdk/cli (IWSDK ${version}). Run this command again after installing IWSDK.`,
        ]
      : []),
    RETIRED_SURFACES_NOTICE,
    entry
      ? `Before writing IWSDK code, read the iwsdk-agent-guidance block in AGENTS.md, then ${entry.paths.join(' or ')}.`
      : 'Before writing IWSDK code, read the iwsdk-agent-guidance block in AGENTS.md.',
    'Skills installed mid-session may not be listed until the next session; read their SKILL.md files directly when the task matches:',
    ...skills.map(
      (skill) =>
        `- ${skill.name} (${skill.paths[0]}): ${skill.description.length > 220 ? `${skill.description.slice(0, 217)}...` : skill.description}`,
    ),
  ].join('\n');
}

/**
 * Write a guidance release into a project. Files IWSDK wrote and nobody edited
 * are replaced; edited files and files IWSDK does not own are reported and left
 * alone unless `force` is set; retired IWSDK files are removed.
 */
export async function syncAgentGuidance({
  projectRoot,
  source,
  tools = [...GUIDANCE_TOOLS],
  force = false,
  dryRun = false,
}: SyncAgentGuidanceOptions): Promise<SyncAgentGuidanceResult> {
  const writer = createWriter(projectRoot, dryRun);
  const pruned = await pruneRetiredUnits(source, tools, writer);
  const results: GuidanceUnitResult[] = [];
  const installedSkills = new Set<string>();
  const units = selectedUnits(source.manifest, tools);
  // Settings last: they grant the skills this run installed.
  for (const unit of [
    ...units.filter((candidate) => candidate.kind !== 'claude-settings'),
    ...units.filter((candidate) => candidate.kind === 'claude-settings'),
  ]) {
    switch (unit.kind) {
      case 'directory': {
        const result = await syncDirectoryUnit(unit, source, writer, force);
        if (
          unit.path.startsWith('.claude/') &&
          (result.action === 'created' || result.action === 'updated')
        ) {
          installedSkills.add(path.posix.basename(unit.path));
        }
        results.push(result);
        break;
      }
      case 'file':
        results.push(await syncFileUnit(unit, source, writer, force));
        break;
      case 'block':
        results.push(await syncBlockUnit(unit, source, writer, force));
        break;
      case 'claude-import':
        results.push(await syncClaudeImport(unit, source, writer, force));
        break;
      case 'claude-settings':
        results.push(
          await syncClaudeSettings(
            unit,
            source,
            writer,
            installedSkills,
            pruned.removedSkills,
            force,
          ),
        );
        break;
    }
  }
  results.push(...pruned.results);
  const skills = await summarizeSkills(source, tools);
  const changedCount = results.filter(
    (result) => result.action !== 'unchanged' && result.action !== 'skipped',
  ).length;
  return {
    projectRoot,
    version: source.manifest.version,
    origin: source.origin,
    tools: [...tools],
    dryRun,
    changed: changedCount > 0,
    results,
    skipped: results.filter((result) => result.action === 'skipped'),
    skills,
    agentNotice: buildAgentNotice(source, skills, dryRun, changedCount),
  };
}

/**
 * The project that receives guidance: the nearest directory at or above
 * `startDirectory` with a package.json. In a monorepo, run from the app's
 * directory or pass --workspace.
 */
export function findGuidanceProjectRoot(startDirectory: string): string | null {
  let current = path.resolve(startDirectory);
  while (true) {
    if (existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * The coding tools a project already has IWSDK guidance for, judged from
 * files only those tools read. Codex and OpenCode read the same files
 * (`.agents/skills` and nested `AGENTS.md`), so they count together.
 */
export async function installedGuidanceTools(
  projectRoot: string,
  source: GuidanceSource,
): Promise<AiTool[]> {
  const present = new Set<AiTool>();
  // Units several tools share (`.agents/skills`) are left for last: they
  // mean Codex/OpenCode only when no tool that shares them has its own files.
  const shared: Array<readonly AiTool[]> = [];
  const add = (tools: readonly AiTool[]) => {
    if (tools.length === 1) {
      present.add(tools[0]);
    } else {
      shared.push(tools);
    }
  };
  for (const unit of source.manifest.units) {
    // Settings and CLAUDE.md are written by MCP setup and by developers too.
    if (
      unit.tools.length < GUIDANCE_TOOLS.length &&
      (unit.kind === 'directory' ||
        unit.kind === 'file' ||
        (unit.kind === 'block' &&
          // A nested AGENTS.md counts only when it holds IWSDK's block.
          (await readTextIfExists(path.join(projectRoot, unit.path)))?.match(
            BLOCK_BEGIN,
          ) != null)) &&
      existsSync(path.join(projectRoot, unit.path))
    ) {
      add(unit.tools);
    }
  }
  // A file from an earlier release counts only when it is that release's file.
  for (const [unitPath, hashes] of Object.entries(source.manifest.legacy)) {
    const tools = toolsForPath(unitPath);
    const filePath = path.join(projectRoot, unitPath);
    if (tools.length === GUIDANCE_TOOLS.length || !existsSync(filePath)) {
      continue;
    }
    const hash =
      (await pathKind(filePath)) === 'directory'
        ? directoryUnitHash(await readTree(filePath))
        : fileUnitHash(await readFile(filePath, 'utf8'));
    if (hashes.includes(hash)) {
      add(tools);
    }
  }
  for (const tools of shared) {
    if (
      tools.includes('codex') &&
      !tools.some(
        (tool) => tool !== 'codex' && tool !== 'opencode' && present.has(tool),
      )
    ) {
      present.add('codex');
      present.add('opencode');
    }
  }
  return GUIDANCE_TOOLS.filter((tool) => present.has(tool));
}
