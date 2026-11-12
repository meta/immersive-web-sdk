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
  changed: GuidanceUnitResult[];
  skipped: GuidanceUnitResult[];
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
    const agents = readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8');
    return (
      agents.match(/<!-- BEGIN iwsdk-agent-guidance version=(\S+) /u)?.[1] ??
      null
    );
  } catch {
    return null;
  }
}

// Kept here for callers and tests that import it with the refresh.
export { readLockedCoreVersion };

/**
 * Called by `iwsdk dev up`/`restart`. When the installed @iwsdk/core ships
 * different guidance than the project has, refresh the files nobody edited,
 * or report it when refreshing is not safe. Never throws.
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
        migrations: [],
        notice: `[IWSDK] This project has no IWSDK ${version} coding-agent guidance. Run \`npx @iwsdk/cli@latest agents sync\` to install it.`,
      };
    }
    const plan = await syncAgentGuidance({
      projectRoot,
      source,
      tools,
      dryRun: true,
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
    const changed = plan.results.filter(
      (result) => result.action !== 'unchanged' && result.action !== 'skipped',
    );
    if (reason) {
      return {
        action: 'stale',
        previousVersion,
        version,
        reason,
        changed,
        skipped: plan.skipped,
        migrations: [],
        notice:
          reason === 'lockfile-mismatch'
            ? `[IWSDK] node_modules has @iwsdk/core ${installed} but the lockfile resolves ${locked}; agent guidance was not refreshed. Run your package manager's install.`
            : `[IWSDK] Coding-agent guidance differs from the installed IWSDK ${version} in ${changed.length} place(s). Run \`npx @iwsdk/cli@latest agents sync\`.`,
      };
    }
    const result = await syncAgentGuidance({ projectRoot, source, tools });
    const applied = result.results.filter(
      (entry) => entry.action !== 'unchanged' && entry.action !== 'skipped',
    );
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
    return {
      action: 'refreshed',
      previousVersion,
      version,
      changed: applied,
      skipped: result.skipped,
      migrations,
      notice: [
        `[IWSDK] Updated coding-agent guidance${previousVersion ? ` from ${previousVersion}` : ''} to the installed IWSDK ${version}: ${applied
          .map((entry) => entry.path)
          .join(', ')}.`,
        'Agents: re-read the iwsdk-agent-guidance block in AGENTS.md and any changed skill before continuing.',
        ...(result.skipped.length > 0
          ? [
              `Left edited files alone: ${result.skipped.map((entry) => entry.path).join(', ')} (\`npx @iwsdk/cli@latest agents sync --force\` replaces them).`,
            ]
          : []),
        ...(migrationNotice ? [migrationNotice] : []),
      ].join('\n'),
    };
  } catch {
    // Guidance upkeep must never stop the dev server from starting.
    return null;
  }
}
