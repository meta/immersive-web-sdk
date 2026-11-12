/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { GuidanceSourceError } from './agent-guidance.js';
import { parseArgv } from './argv.js';
import {
  createFailure,
  isCliFailure,
  isCliRawOutput,
  writeJson,
} from './cli-results.js';
import type { CliCommandResult, CliIo, ResolvedCliIo } from './cli-types.js';
import {
  handleAdapterPrompt,
  handleAdapterPrune,
  handleAdapterStatus,
  handleAdapterSync,
} from './commands/adapter.js';
import { handleAgentsCheck, handleAgentsSync } from './commands/agents.js';
import { handleBrowserRun } from './commands/browser.js';
import {
  handleDevDown,
  handleDevLogs,
  handleDevOpen,
  handleDevRestart,
  handleDevStatus,
  handleDevUp,
} from './commands/dev.js';
import { handleMcpInspect, handleMcpStdio } from './commands/mcp.js';
import {
  handleReferenceInspect,
  handleReferenceQuery,
  handleReferenceStatus,
  handleReferenceWarmup,
} from './commands/reference.js';
import { handleRuntimeOperation } from './commands/runtime.js';
import { handleStatus } from './commands/status.js';
import { handleUpgrade } from './commands/upgrade.js';
import {
  buildAgentsCommandHelp,
  buildUpgradeCommandHelp,
  buildBrowserRunHelp,
  buildDevCommandHelp,
  buildMcpInspectHelp,
  buildReferenceCommandHelp,
  buildRuntimeCommandHelp,
  buildRuntimeDomainHelp,
  usageLines,
} from './help.js';
import { RuntimeOwnerError } from './runtime-owner.js';
import {
  RuntimeCommandExecutionError,
  sendRuntimeCommand,
} from './runtime-transport.js';

export type { CliIo } from './cli-types.js';
export { RuntimeCommandExecutionError, sendRuntimeCommand };

export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();
  const parsed = parseArgv(argv);
  const [command, subcommand, argument] = parsed.positionals;
  const context: ResolvedCliIo = { stdout, stderr, cwd };

  try {
    let result: CliCommandResult;

    if (!command || command === 'help') {
      stdout.write(`${usageLines().join('\n')}\n`);
      return 0;
    }

    if (parsed.options.help) {
      if (command === 'dev') {
        stdout.write(`${buildDevCommandHelp(subcommand).join('\n')}\n`);
        return 0;
      }

      if (command === 'mcp' && subcommand === 'inspect') {
        stdout.write(`${buildMcpInspectHelp().join('\n')}\n`);
        return 0;
      }

      if (command === 'upgrade') {
        stdout.write(`${buildUpgradeCommandHelp().join('\n')}\n`);
        return 0;
      }

      if (command === 'agents') {
        stdout.write(`${buildAgentsCommandHelp().join('\n')}\n`);
        return 0;
      }

      if (command === 'reference') {
        stdout.write(`${buildReferenceCommandHelp(subcommand).join('\n')}\n`);
        return 0;
      }

      if (
        command === 'xr' ||
        command === 'browser' ||
        command === 'asset' ||
        command === 'scene' ||
        command === 'ui' ||
        command === 'ecs' ||
        command === 'runtime'
      ) {
        if (command === 'browser' && subcommand === 'run') {
          stdout.write(`${buildBrowserRunHelp().join('\n')}\n`);
          return 0;
        }
        stdout.write(
          `${(subcommand
            ? buildRuntimeCommandHelp(command, subcommand)
            : buildRuntimeDomainHelp(command)
          ).join('\n')}\n`,
        );
        return 0;
      }

      stdout.write(`${usageLines().join('\n')}\n`);
      return 0;
    }

    switch (command) {
      case 'status':
        result = await handleStatus(parsed.options, context);
        break;
      case 'dev':
        if (subcommand === 'up') {
          result = await handleDevUp(parsed.options, context);
        } else if (subcommand === 'down') {
          result = await handleDevDown(parsed.options, context);
        } else if (subcommand === 'restart') {
          result = await handleDevRestart(parsed.options, context);
        } else if (subcommand === 'logs') {
          result = await handleDevLogs(parsed.options, context);
        } else if (subcommand === 'open') {
          result = await handleDevOpen(parsed.options, context);
        } else if (subcommand === 'status') {
          result = await handleDevStatus(parsed.options, context);
        } else {
          throw new Error('Usage: iwsdk dev up|down|restart|logs|open|status');
        }
        break;
      case 'adapter':
        if (subcommand === 'sync') {
          result = await handleAdapterSync(parsed.options, context);
        } else if (subcommand === 'prune') {
          result = await handleAdapterPrune(parsed.options, context);
        } else if (subcommand === 'status') {
          result = await handleAdapterStatus(parsed.options, context);
        } else if (subcommand === 'prompt') {
          result = await handleAdapterPrompt(parsed.options, context);
        } else {
          throw new Error('Usage: iwsdk adapter sync|status|prune|prompt');
        }
        break;
      case 'upgrade':
        result = await handleUpgrade(parsed.options, context);
        break;
      case 'agents':
        if (subcommand === 'sync') {
          result = await handleAgentsSync(parsed.options, context);
        } else if (subcommand === 'check') {
          result = await handleAgentsCheck(parsed.options, context);
        } else {
          throw new Error(buildAgentsCommandHelp().join('\n'));
        }
        break;
      case 'reference':
        if (subcommand === 'status') {
          result = await handleReferenceStatus(parsed.options, context);
        } else if (subcommand === 'warmup') {
          result = await handleReferenceWarmup(parsed.options, context);
        } else if (subcommand === 'inspect') {
          result = await handleReferenceInspect(parsed.options, context);
        } else if (subcommand) {
          result = await handleReferenceQuery(
            subcommand,
            parsed.options,
            context,
          );
        } else {
          throw new Error(
            'Usage: iwsdk reference status|warmup|inspect|search|relationship|api|file|components|systems|dependents|examples',
          );
        }
        break;
      case 'mcp':
        if (subcommand === 'stdio') {
          return handleMcpStdio(parsed.options, context).then(() => 0);
        }
        if (subcommand === 'inspect') {
          result = await handleMcpInspect(parsed.options, context);
          break;
        }
        throw new Error('Usage: iwsdk mcp stdio|inspect');
      case 'xr':
      case 'browser':
      case 'asset':
      case 'scene':
      case 'ui':
      case 'ecs':
      case 'runtime':
        if (command === 'browser' && subcommand === 'run') {
          result = await handleBrowserRun(argument, parsed.options, context);
          break;
        }
        if (!subcommand) {
          throw new Error(buildRuntimeDomainHelp(command).join('\n'));
        }
        result = await handleRuntimeOperation(
          command,
          subcommand,
          parsed.options,
          context,
        );
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }

    if (typeof result === 'number') {
      return result;
    }
    if (result) {
      if (isCliRawOutput(result)) {
        writeJson(stdout, result.value);
        return 0;
      }
      if (isCliFailure(result)) {
        writeJson(stderr, result);
        return 1;
      }
      writeJson(stdout, result);
    }
    return 0;
  } catch (error) {
    const failure =
      error instanceof RuntimeCommandExecutionError
        ? createFailure(error.message, 'runtime_command_failed', {
            ...(error.details ?? {}),
            cause: error.issueCause,
            browser: error.browser ?? null,
          })
        : error instanceof RuntimeOwnerError
          ? createFailure(error.message, error.code, {
              owner: error.owner,
            })
          : error instanceof GuidanceSourceError
            ? createFailure(error.message, error.code)
            : createFailure(
                error instanceof Error ? error.message : String(error),
              );
    // Set by `dev up` when the guidance refresh ran before startup threw.
    const agentGuidance = (error as { agentGuidance?: unknown } | null)
      ?.agentGuidance;
    if (agentGuidance) {
      failure.error.details = {
        ...((failure.error.details as Record<string, unknown>) ?? {}),
        agentGuidance,
      };
    }
    writeJson(stderr, failure);
    return 1;
  }
}
