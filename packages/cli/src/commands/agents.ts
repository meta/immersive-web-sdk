/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import path from 'path';
import {
  findGuidanceProjectRoot,
  installedGuidanceTools,
  resolveProjectGuidance,
  syncAgentGuidance,
  type SyncAgentGuidanceResult,
} from '../agent-guidance.js';
import { createFailure, createSuccess } from '../cli-results.js';
import type {
  CliFailure,
  CliOptions,
  CliSuccess,
  ResolvedCliIo,
} from '../cli-types.js';
import { resolveAdapterTools } from './adapter.js';

function resolveProjectRoot(options: CliOptions, io: ResolvedCliIo): string {
  if (typeof options.workspace === 'string') {
    // An explicit project is used as given; walking up from a mistyped path
    // would write into whatever package encloses it.
    const workspace = path.resolve(io.cwd, options.workspace);
    if (!existsSync(path.join(workspace, 'package.json'))) {
      throw new Error(
        `--workspace ${options.workspace} has no package.json. Pass the directory of the project that uses IWSDK.`,
      );
    }
    return workspace;
  }
  const start = io.cwd;
  const projectRoot = findGuidanceProjectRoot(start);
  if (projectRoot == null) {
    throw new Error(
      `No package.json found at or above ${start}. Run this command inside the project that uses IWSDK.`,
    );
  }
  return projectRoot;
}

async function runGuidanceSync(
  options: CliOptions,
  io: ResolvedCliIo,
  dryRun: boolean,
): Promise<SyncAgentGuidanceResult> {
  const projectRoot = resolveProjectRoot(options, io);
  const source = await resolveProjectGuidance(projectRoot);
  // Without --tools, keep the coding tools the project already has guidance
  // for; a project without any gets all of them.
  const installed =
    typeof options.tools === 'string'
      ? []
      : await installedGuidanceTools(projectRoot, source);
  return syncAgentGuidance({
    projectRoot,
    source,
    tools: installed.length > 0 ? installed : resolveAdapterTools(options),
    // check reports drift; it never counts edited files as fixable.
    force: !dryRun && options.force === true,
    dryRun,
  });
}

function skippedHint(result: SyncAgentGuidanceResult): string[] {
  if (result.skipped.length === 0) {
    return [];
  }
  return [
    '',
    `Left ${result.skipped.length} file(s) alone:`,
    ...result.skipped.map(
      (entry) =>
        `- ${entry.path}: ${entry.detail ?? (entry.reason === 'unmanaged' ? 'not written by IWSDK.' : 'edited since IWSDK wrote it.')}`,
    ),
    'Review them against this release. `npx @iwsdk/cli@latest agents sync --force` replaces edited and unmanaged files.',
  ];
}

export async function handleAgentsSync(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<SyncAgentGuidanceResult>> {
  const result = await runGuidanceSync(options, io, false);
  // Coding agents read stderr too; this is the one channel that reaches the
  // session that just installed the guidance.
  io.stderr.write(
    `${[result.agentNotice, ...skippedHint(result)].join('\n')}\n`,
  );
  return createSuccess(result);
}

export async function handleAgentsCheck(
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<SyncAgentGuidanceResult> | CliFailure> {
  const result = await runGuidanceSync(options, io, true);
  // Edited files are the developer's choice; only fail on what sync would fix.
  const drift = result.results.filter(
    (entry) => entry.action !== 'unchanged' && entry.action !== 'skipped',
  );
  if (drift.length === 0) {
    return createSuccess(result);
  }
  return createFailure(
    `Agent guidance differs from IWSDK ${result.version} in ${drift.length} place(s). Run \`npx @iwsdk/cli agents sync\`.`,
    'agent_guidance_drift',
    { projectRoot: result.projectRoot, version: result.version, drift },
  );
}
