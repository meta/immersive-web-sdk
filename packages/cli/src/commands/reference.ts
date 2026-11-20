/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawn, type ChildProcess } from 'child_process';
import {
  createFailure,
  createRawOutput,
  createSuccess,
} from '../cli-results.js';
import type { CliCommandResult, ResolvedCliIo } from '../cli-types.js';
import {
  getReferenceEntrypoint,
  getReferencePackageRoot,
  hasReferenceInstalled,
  resolveReferenceWorkspaceRoot,
} from '../reference-runtime.js';

interface ReferenceCommandEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

async function runReferenceCommand<T>(
  entrypoint: string,
  args: string[],
  workspaceRoot: string,
  context: ResolvedCliIo,
  pipeStderr: boolean,
): Promise<ReferenceCommandEnvelope<T>> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn('node', [entrypoint, ...args], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (pipeStderr) {
        context.stderr.write(text);
      }
    });

    child.on('error', (error) => {
      resolve({
        ok: false,
        error: {
          code: 'reference_command_error',
          message: error.message,
        },
      });
    });

    child.on('close', (exitCode) => {
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        try {
          resolve(JSON.parse(trimmed) as ReferenceCommandEnvelope<T>);
          return;
        } catch {}
      }

      resolve({
        ok: false,
        error: {
          code:
            exitCode === 0
              ? 'invalid_reference_response'
              : 'reference_command_failed',
          message:
            stderr.trim() ||
            stdout.trim() ||
            `Reference command exited with code ${exitCode ?? 1}.`,
        },
      });
    });
  });
}

export async function handleReferenceStatus(
  options: Record<string, unknown>,
  context: ResolvedCliIo,
): Promise<CliCommandResult> {
  const workspaceRoot = await resolveReferenceWorkspaceRoot(options, context);
  if (!hasReferenceInstalled(workspaceRoot)) {
    return createSuccess({
      installed: false,
      workspaceRoot,
      packageRoot: null,
      initState: null,
      warmupRequired: false,
    });
  }

  const packageRoot = getReferencePackageRoot(workspaceRoot);
  const result = await runReferenceCommand<Record<string, unknown>>(
    getReferenceEntrypoint(workspaceRoot),
    ['--status-json'],
    workspaceRoot,
    context,
    false,
  );

  if (!result.ok) {
    return createFailure(
      result.error?.message ?? 'Unable to read reference status.',
      result.error?.code ?? 'reference_status_failed',
    );
  }

  return createSuccess({
    installed: true,
    workspaceRoot,
    packageRoot,
    ...(result.data ?? {}),
  });
}

export async function handleReferenceInspect(
  options: Record<string, unknown>,
  context: ResolvedCliIo,
): Promise<CliCommandResult> {
  const workspaceRoot = await resolveReferenceWorkspaceRoot(options, context);
  if (!hasReferenceInstalled(workspaceRoot)) {
    return createFailure(
      '@iwsdk/reference is not installed. Run: pnpm add -D @iwsdk/reference',
      'not_installed',
    );
  }

  const args = ['--inspect-json'];
  if (typeof options.tool === 'string') {
    args.push('--tool', options.tool);
  }

  const result = await runReferenceCommand<Record<string, unknown>>(
    getReferenceEntrypoint(workspaceRoot),
    args,
    workspaceRoot,
    context,
    false,
  );
  if (!result.ok) {
    return createFailure(
      result.error?.message ?? 'Unable to inspect reference tools.',
      result.error?.code ?? 'reference_inspect_failed',
    );
  }

  if (options.raw) {
    return createRawOutput(result.data ?? null);
  }

  return createSuccess({
    workspaceRoot,
    packageRoot: getReferencePackageRoot(workspaceRoot),
    operation: 'inspect',
    result: result.data ?? null,
  });
}

/**
 * The input field a query subcommand fills from its positional text, so
 * `iwsdk reference search "grab a box"` works without `--input-json`.
 */
export const REFERENCE_POSITIONAL_FIELDS: Readonly<Record<string, string>> = {
  search: 'query',
  api: 'name',
  file: 'file_path',
  dependents: 'api_name',
  examples: 'api_name',
};

/**
 * Builds the `--input-json` payload for a reference query from the
 * subcommand's positional text and `--input-json`. Fields given in
 * `--input-json` win. Returns an error message when the input can't be used.
 */
export function buildReferenceQueryInput(
  subcommand: string,
  positional: string,
  inputJson: unknown,
): { input?: string; error?: string } {
  const text = positional.trim();
  if (text.length === 0) {
    return typeof inputJson === 'string' ? { input: inputJson } : {};
  }
  const field = REFERENCE_POSITIONAL_FIELDS[subcommand];
  if (!field) {
    return {
      error: `iwsdk reference ${subcommand} takes no positional argument; pass its input with --input-json.`,
    };
  }
  let input: Record<string, unknown> = {};
  if (typeof inputJson === 'string') {
    try {
      const parsed: unknown = JSON.parse(inputJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch (error) {
      return { error: `--input-json must be valid JSON: ${String(error)}` };
    }
  }
  const merged: Record<string, unknown> = { [field]: text, ...input };
  if (subcommand === 'file' && merged.source === undefined) {
    merged.source = 'iwsdk';
  }
  return { input: JSON.stringify(merged) };
}

export async function handleReferenceQuery(
  subcommand: string,
  options: Record<string, unknown>,
  context: ResolvedCliIo,
  positional = '',
): Promise<CliCommandResult> {
  const workspaceRoot = await resolveReferenceWorkspaceRoot(options, context);
  if (!hasReferenceInstalled(workspaceRoot)) {
    return createFailure(
      '@iwsdk/reference is not installed. Run: pnpm add -D @iwsdk/reference',
      'not_installed',
    );
  }

  const query = buildReferenceQueryInput(
    subcommand,
    positional,
    options.inputJson,
  );
  if (query.error) {
    return createFailure(query.error, 'invalid_reference_input');
  }
  const args = ['--cli-operation', subcommand];
  if (query.input !== undefined) {
    args.push('--input-json', query.input);
  }

  const result = await runReferenceCommand<Record<string, unknown>>(
    getReferenceEntrypoint(workspaceRoot),
    args,
    workspaceRoot,
    context,
    false,
  );

  if (!result.ok) {
    return createFailure(
      result.error?.message ?? `Reference query "${subcommand}" failed.`,
      result.error?.code ?? 'reference_query_failed',
    );
  }

  if (options.raw) {
    return createRawOutput(result.data ?? null);
  }

  const payload =
    result.data && typeof result.data === 'object' ? result.data : {};
  return createSuccess({
    workspaceRoot,
    packageRoot: getReferencePackageRoot(workspaceRoot),
    operation:
      typeof payload.operation === 'string' ? payload.operation : subcommand,
    result: 'result' in payload ? payload.result : payload,
  });
}

export async function handleReferenceWarmup(
  options: Record<string, unknown>,
  context: ResolvedCliIo,
): Promise<CliCommandResult> {
  const workspaceRoot = await resolveReferenceWorkspaceRoot(options, context);

  if (!hasReferenceInstalled(workspaceRoot)) {
    return createFailure(
      '@iwsdk/reference is not installed. Run: pnpm add -D @iwsdk/reference',
      'not_installed',
    );
  }

  const result = await runReferenceCommand<Record<string, unknown>>(
    getReferenceEntrypoint(workspaceRoot),
    ['--warmup'],
    workspaceRoot,
    context,
    true,
  );

  if (!result.ok) {
    return createFailure(
      result.error?.message ?? 'Reference warmup failed.',
      result.error?.code ?? 'warmup_failed',
    );
  }

  return createSuccess({
    workspaceRoot,
    packageRoot: getReferencePackageRoot(workspaceRoot),
    ...(result.data ?? {}),
  });
}
