/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFileSync } from 'fs';
import path from 'path';
import {
  installedGuidanceTools,
  readGuidanceBlockVersion,
  readInstalledCoreVersion,
  resolveProjectGuidance,
  syncAgentGuidance,
  type GuidanceUnitResult,
} from './agent-guidance.js';
import {
  formatMigrationNotice,
  materializeMigrations,
  migrationsBetween,
  type MaterializedMigration,
} from './migrations.js';
import { readLockedCoreVersion } from './package-manager.js';
import {
  formatReleaseNotesNotice,
  writeReleaseNotes,
} from './release-notes.js';

export type AgentGuidanceMode = 'auto' | 'warn' | 'off';

export interface GuidanceRefreshReport {
  action: 'refreshed' | 'stale' | 'missing';
  /** Release the guidance in the project was written by, when stamped. */
  previousVersion: string | null;
  version: string;
  /** Why a stale project was not refreshed automatically. */
  reason?: 'mode-warn' | 'ci' | 'lockfile-mismatch';
  /** Units written or removed (or, when stale, that would be). */
  changed: GuidanceUnitResult[];
  /**
   * Units left alone: edited or not written by IWSDK, written by a newer
   * release, or retired but kept (reason `retired`).
   */
  skipped: GuidanceUnitResult[];
  /**
   * Units the installed release ships that the project does not have: the
   * developer removed them (or a block or import from their file), or they
   * are new in the release. The refresh adds only units that replace retired
   * guidance it removes; `agents sync` adds these.
   */
  missing: GuidanceUnitResult[];
  migrations: MaterializedMigration[];
  notice: string;
}

function readManifestMode(projectRoot: string): AgentGuidanceMode | null {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(projectRoot, 'iwsdk.config.json'), 'utf8'),
    ) as { dev?: { agentGuidance?: unknown } };
    const mode = manifest.dev?.agentGuidance;
    return mode === 'auto' || mode === 'warn' || mode === 'off' ? mode : null;
  } catch {
    return null;
  }
}

export function resolveAgentGuidanceMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentGuidanceMode {
  const fromEnv = env.IWSDK_AGENT_GUIDANCE;
  if (fromEnv === 'auto' || fromEnv === 'warn' || fromEnv === 'off') {
    return fromEnv;
  }
  return readManifestMode(projectRoot) ?? 'auto';
}

/** The release recorded in the project's AGENTS.md guidance block. */
export function readGuidanceVersion(projectRoot: string): string | null {
  try {
    return readGuidanceBlockVersion(
      readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'),
    );
  } catch {
    return null;
  }
}

// Kept here for callers and tests that import it with the refresh.
export { readLockedCoreVersion };

function isChange(entry: GuidanceUnitResult): boolean {
  return entry.action !== 'unchanged' && entry.action !== 'skipped';
}

function isMissing(entry: GuidanceUnitResult): boolean {
  return entry.reason === 'missing';
}

function formatList(items: string[], limit: number): string {
  const more = items.length - limit;
  return `${items.slice(0, limit).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function formatMissingNotice(
  version: string,
  missing: GuidanceUnitResult[],
): string {
  if (missing.length === 0) {
    return '';
  }
  const one = missing.length === 1;
  // Files first: a missing block or import matters more than one more skill.
  const ordered = [...missing].sort(
    (left, right) =>
      Number(left.kind === 'directory') - Number(right.kind === 'directory'),
  );
  return `Not added: ${missing.length} part${one ? '' : 's'} of the IWSDK ${version} guidance that this project does not have (removed or replaced here, or new in this release): ${formatList(
    ordered.map((entry) =>
      entry.detail ? `${entry.path} (${entry.detail})` : entry.path,
    ),
    6,
  )}. \`npx @iwsdk/cli@latest agents sync\` adds ${one ? 'it' : 'them'}.`;
}

/** The notice for a refresh that wrote `applied` and left `skipped` alone. */
function formatRefreshNotice(
  previousVersion: string | null,
  version: string,
  applied: GuidanceUnitResult[],
  skipped: GuidanceUnitResult[],
): string[] {
  const written = applied.filter((entry) => entry.action !== 'removed');
  const removed = applied.filter((entry) => entry.action === 'removed');
  const edited = skipped.filter((entry) => entry.reason !== 'retired');
  const kept = skipped.filter((entry) => entry.reason === 'retired');
  // What agents read: skill permissions in settings are not guidance.
  const reread = applied.filter((entry) => entry.kind !== 'claude-settings');
  const rootBlock = written.some((entry) => entry.path === 'AGENTS.md');
  const others = reread.length > (rootBlock ? 1 : 0);
  return [
    `[IWSDK] Updated coding-agent guidance${previousVersion && previousVersion !== version ? ` from ${previousVersion}` : ''} to the installed IWSDK ${version}${written.length > 0 ? `: ${written.map((entry) => entry.path).join(', ')}` : ''}.`,
    ...(removed.length > 0
      ? [
          `Removed retired guidance: ${removed
            .map((entry) =>
              entry.replacedBy?.length
                ? `${entry.path} (replaced by ${formatList(entry.replacedBy, 3)})`
                : entry.path,
            )
            .join(', ')}.`,
        ]
      : []),
    ...(reread.length > 0
      ? [
          `Agents: re-read ${rootBlock ? `the iwsdk-agent-guidance block in AGENTS.md${others ? ' and the other changed guidance' : ''}` : 'the changed guidance'} before continuing.`,
        ]
      : []),
    ...(edited.length > 0
      ? [
          `Left edited files alone: ${edited.map((entry) => entry.path).join(', ')} (\`npx @iwsdk/cli@latest agents sync --force\` replaces them).`,
        ]
      : []),
    ...kept.map(
      (entry) => `Kept retired guidance ${entry.path}: ${entry.detail}`,
    ),
  ];
}

/**
 * Called by `iwsdk dev up`/`restart`. Brings the guidance a project already
 * has up to the installed @iwsdk/core: files IWSDK wrote and nobody edited are
 * updated. A retired unit is replaced whole: removed, with its successors
 * written in the same run when the release names them (and kept otherwise),
 * so a refresh never leaves less guidance than it found. Apart from those
 * successors it never adds a skill, file, AGENTS.md block, CLAUDE.md import
 * or skill permission the project lacks, since the developer may have
 * removed it on purpose; units new in the release are not added either. A
 * refresh lists them, and `iwsdk agents sync` adds them. In CI, in warn mode,
 * or when node_modules disagrees with the lockfile it only reports. Returns
 * null when nothing needs refreshing; never throws.
 */
export async function refreshAgentGuidanceForDev(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GuidanceRefreshReport | null> {
  try {
    const mode = resolveAgentGuidanceMode(projectRoot, env);
    if (mode === 'off') {
      return null;
    }
    const source = await resolveProjectGuidance(projectRoot);
    if (source.origin !== 'installed-core') {
      return null;
    }
    const version = source.manifest.version;
    const previousVersion = readGuidanceVersion(projectRoot);
    // Refresh only the coding tools this project already has guidance for:
    // a project synced with `--tools claude` must not gain Cursor rules.
    const tools = await installedGuidanceTools(projectRoot, source);
    if (tools.length === 0) {
      // Guidance was never installed here; adding it is the developer's call.
      return {
        action: 'missing',
        previousVersion,
        version,
        changed: [],
        skipped: [],
        missing: [],
        migrations: [],
        notice: `[IWSDK] This project has no IWSDK ${version} coding-agent guidance. Run \`npx @iwsdk/cli@latest agents sync\` to install it.`,
      };
    }
    const plan = await syncAgentGuidance({
      projectRoot,
      source,
      tools,
      dryRun: true,
      onlyExisting: true,
    });
    if (!plan.changed) {
      return null;
    }
    const locked = readLockedCoreVersion(projectRoot);
    const installed = readInstalledCoreVersion(projectRoot);
    const reason: GuidanceRefreshReport['reason'] =
      mode === 'warn'
        ? 'mode-warn'
        : env.CI
          ? 'ci'
          : locked != null && installed != null && locked !== installed
            ? 'lockfile-mismatch'
            : undefined;
    const changed = plan.results.filter(isChange);
    if (reason) {
      const missing = plan.skipped.filter(isMissing);
      return {
        action: 'stale',
        previousVersion,
        version,
        reason,
        changed,
        skipped: plan.skipped.filter((entry) => !isMissing(entry)),
        missing,
        migrations: [],
        notice:
          reason === 'lockfile-mismatch'
            ? `[IWSDK] node_modules has @iwsdk/core ${installed} but the lockfile resolves ${locked}; agent guidance was not refreshed. Run your package manager's install.`
            : [
                `[IWSDK] Coding-agent guidance differs from the installed IWSDK ${version} in ${changed.length} place(s). Run \`npx @iwsdk/cli@latest agents sync\`.`,
                formatMissingNotice(version, missing),
              ]
                .filter(Boolean)
                .join('\n'),
      };
    }
    const result = await syncAgentGuidance({
      projectRoot,
      source,
      tools,
      onlyExisting: true,
    });
    const applied = result.results.filter(isChange);
    const skipped = result.skipped.filter((entry) => !isMissing(entry));
    const missing = result.skipped.filter(isMissing);
    const migrations = await materializeMigrations(
      projectRoot,
      migrationsBetween(previousVersion, version),
    );
    const releaseNotes =
      previousVersion && previousVersion !== version
        ? await writeReleaseNotes(projectRoot, previousVersion, version)
        : null;
    const migrationNotice = [
      formatMigrationNotice(previousVersion, version, migrations),
      formatReleaseNotesNotice(previousVersion, version, releaseNotes),
    ]
      .filter(Boolean)
      .join('\n');
    const missingNotice = formatMissingNotice(version, missing);
    return {
      action: 'refreshed',
      previousVersion,
      version,
      changed: applied,
      skipped,
      missing,
      migrations,
      notice: [
        ...formatRefreshNotice(previousVersion, version, applied, skipped),
        ...(missingNotice ? [missingNotice] : []),
        ...(migrationNotice ? [migrationNotice] : []),
      ].join('\n'),
    };
  } catch {
    // Guidance upkeep must never stop the dev server from starting.
    return null;
  }
}
