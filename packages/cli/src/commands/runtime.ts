/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { parseIntegerOption, safeJsonParse } from '../argv.js';
import { createRawOutput, createSuccess } from '../cli-results.js';
import type {
  CliOptions,
  CliRawOutput,
  CliSuccess,
  ResolvedCliIo,
} from '../cli-types.js';
import {
  getDefaultRuntimeCommandTimeoutMs,
  isRuntimeBrowserCommandReady,
  RUNTIME_OPERATIONS,
  getRuntimeOperationByCliPath,
  resolveRuntimeOperationRequest,
  type RuntimeOperationDefinition,
  type RuntimeSession,
} from '../runtime-contract.js';
import {
  formatMissingRuntimeMessage,
  getRuntimeSession,
  resolveWorkspaceRoot,
} from '../runtime-state.js';
import {
  getRuntimeFailureReason,
  startRuntimeOperationTelemetry,
  type RuntimeOperationTelemetry,
} from '../runtime-telemetry.js';
import {
  RuntimeCommandExecutionError,
  sendRuntimeCommand,
} from '../runtime-transport.js';
import { isScreenshotResult, saveScreenshot } from '../screenshot-output.js';

const COMMON_RUNTIME_OPTIONS = new Set([
  'help',
  'inputJson',
  'raw',
  'timeout',
  'workspace',
]);
type DirectOptionType = 'boolean' | 'number' | 'string' | 'levels';

const DIRECT_OPTION_ALIASES: Record<
  string,
  Record<string, { parameter: string; type: DirectOptionType }>
> = {
  browser_get_console_logs: {
    count: { parameter: 'count', type: 'number' },
    level: { parameter: 'level', type: 'levels' },
    pattern: { parameter: 'pattern', type: 'string' },
    since: { parameter: 'since', type: 'number' },
  },
  browser_set_muted: {
    muted: { parameter: 'muted', type: 'boolean' },
  },
  ecs_step: {
    count: { parameter: 'count', type: 'number' },
    frames: { parameter: 'count', type: 'number' },
    delta: { parameter: 'delta', type: 'number' },
  },
};

function parseDirectValue(
  value: string | boolean,
  option: string,
  type: DirectOptionType,
): unknown {
  if (type === 'boolean') {
    if (value === true || value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    throw new Error(`--${option} must be true or false`);
  }
  if (typeof value !== 'string') {
    throw new Error(`--${option} requires a value`);
  }
  if (type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`--${option} must be a number`);
    }
    return parsed;
  }
  if (type === 'levels') {
    const levels = value.split(',').map((entry) => entry.trim());
    return levels.length === 1 ? levels[0] : levels;
  }
  return value;
}

function resolveRuntimeParams(
  operationName: string,
  options: CliOptions,
): unknown {
  const aliases = DIRECT_OPTION_ALIASES[operationName] ?? {};
  const allowed = new Set([...COMMON_RUNTIME_OPTIONS, ...Object.keys(aliases)]);
  if (
    operationName === 'browser_screenshot' ||
    operationName === 'scene_screenshot' ||
    operationName === 'scene_render_file' ||
    operationName === 'asset_render_preview' ||
    operationName === 'ui_render_preview'
  ) {
    allowed.add('outputFile');
  }
  const unknown = Object.keys(options).filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    const flag = unknown[0].replace(
      /[A-Z]/g,
      (letter) => `-${letter.toLowerCase()}`,
    );
    throw new Error(
      `Unknown option --${flag}. Runtime parameters must be passed through --input-json; run this command with --help for its schema.`,
    );
  }

  const directEntries = Object.entries(aliases).filter(
    ([name]) => options[name] !== undefined,
  );
  if (typeof options.inputJson === 'string' && directEntries.length > 0) {
    throw new Error(
      `Do not combine --input-json with direct parameter aliases: ${directEntries.map(([name]) => `--${name}`).join(', ')}`,
    );
  }
  if (typeof options.inputJson === 'string') {
    return safeJsonParse(options.inputJson, '--input-json');
  }
  return Object.fromEntries(
    directEntries.map(([name, alias]) => [
      alias.parameter,
      parseDirectValue(options[name]!, name, alias.type),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withBrowserStatus(
  result: unknown,
  session: RuntimeSession,
): Record<string, unknown> {
  const browser = session.browser ?? null;
  const browserConnected = Boolean(session.browser?.connected);
  const browserCommandReady = isRuntimeBrowserCommandReady(session);

  if (isRecord(result)) {
    return {
      ...result,
      browser,
      browserConnected,
      browserCommandReady,
    };
  }

  return {
    value: result,
    browser,
    browserConnected,
    browserCommandReady,
  };
}

async function normalizeInteractionFailureScreenshot(
  result: unknown,
): Promise<unknown> {
  if (!isRecord(result) || !isRecord(result.failure)) {
    return result;
  }
  const screenshot = result.failure.screenshot;
  if (!isScreenshotResult(screenshot)) {
    return result;
  }
  const screenshotPath = await saveScreenshot(screenshot);
  return {
    ...result,
    failure: {
      ...result.failure,
      screenshot: {
        captured: true,
        mimeType: screenshot.mimeType ?? 'image/png',
        screenshotPath,
      },
    },
  };
}
export async function handleRuntimeOperation(
  domain: string,
  action: string | undefined,
  options: CliOptions,
  io: ResolvedCliIo,
): Promise<CliSuccess<unknown> | CliRawOutput> {
  const operation = action
    ? getRuntimeOperationByCliPath(domain, action)
    : undefined;
  if (!operation) {
    const available = RUNTIME_OPERATIONS.filter(
      (entry) => entry.domain === domain,
    ).map((entry) => entry.action);
    throw new Error(
      `Unknown ${domain} command "${action}". Available: ${available.join(', ')}`,
    );
  }

  const telemetry = startRuntimeOperationTelemetry(operation);
  try {
    return await runRuntimeOperation(operation, options, io, telemetry);
  } catch (error) {
    telemetry.fail(getRuntimeFailureReason(error));
    throw error;
  }
}

async function runRuntimeOperation(
  operation: RuntimeOperationDefinition,
  options: CliOptions,
  io: ResolvedCliIo,
  telemetry: RuntimeOperationTelemetry,
): Promise<CliSuccess<unknown> | CliRawOutput> {
  let command: ReturnType<typeof resolveRuntimeOperationRequest>;
  let timeoutMs: number;
  try {
    const parsedParams = resolveRuntimeParams(operation.mcpName, options);
    command = resolveRuntimeOperationRequest(operation, parsedParams);
    timeoutMs = parseIntegerOption(
      options.timeout,
      '--timeout',
      getDefaultRuntimeCommandTimeoutMs(operation.wsMethod, command.params),
    );
  } catch (error) {
    telemetry.fail('invalid_input');
    throw error;
  }

  const workspaceRoot = await resolveWorkspaceRoot({
    cwd: io.cwd,
    workspace:
      typeof options.workspace === 'string' ? options.workspace : undefined,
    requireRunning: true,
  });
  const session = await getRuntimeSession(workspaceRoot);
  if (!session) {
    telemetry.fail('no_runtime');
    throw new Error(formatMissingRuntimeMessage(workspaceRoot));
  }
  telemetry.attachSession(session);

  const sendOptions = {
    port: session.port,
    method: operation.wsMethod,
    params: command.params,
    target: command.target,
    timeoutMs,
    runtimeSession: session,
  };
  let rawResult;
  try {
    rawResult = await sendRuntimeCommand(sendOptions);
  } catch (error) {
    telemetry.fail(getRuntimeFailureReason(error));
    if (
      operation.mcpName === 'xr_accept_session' &&
      error instanceof RuntimeCommandExecutionError
    ) {
      error.message = `${error.message} Configure world.xr.offer as "once" or "always" before running iwsdk xr enter.`;
    }
    throw error;
  }
  telemetry.succeed();

  // Managed browser status would misdescribe a headset's session.
  let result: unknown =
    operation.mcpName === 'xr_get_session_status' &&
    command.target?.deviceClass !== 'physical'
      ? withBrowserStatus(rawResult.result ?? rawResult, session)
      : (rawResult.result ?? rawResult);
  if (operation.mcpName === 'browser_interact') {
    result = await normalizeInteractionFailureScreenshot(result);
  }

  const isScreenshotOperation =
    operation.mcpName === 'browser_screenshot' ||
    operation.mcpName === 'scene_screenshot' ||
    operation.mcpName === 'scene_render_file' ||
    operation.mcpName === 'asset_render_preview' ||
    operation.mcpName === 'ui_render_preview';
  const hasExplicitScreenshotPath = typeof options.outputFile === 'string';
  if (options.outputFile === true) {
    throw new Error('--output-file requires a path');
  }

  // An explicit output path is an instruction to persist the PNG. Honor it
  // even when --raw is also present, instead of silently printing base64 and
  if (
    isScreenshotOperation &&
    isScreenshotResult(result) &&
    (hasExplicitScreenshotPath || !options.raw)
  ) {
    const screenshotPath = await saveScreenshot(
      result,
      typeof options.outputFile === 'string' ? options.outputFile : undefined,
    );
    const { imageData: _imageData, ...metadata } = result;
    return createSuccess({
      workspaceRoot,
      operation: operation.id,
      ...(Object.keys(metadata).length > 0 ? { result: metadata } : {}),
      screenshotPath,
    });
  }

  if (options.raw) {
    return createRawOutput(result);
  }

  return createSuccess({
    workspaceRoot,
    operation: operation.id,
    result,
  });
}
