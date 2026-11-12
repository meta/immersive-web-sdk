/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  isRuntimeBrowserCommandReady,
  RUNTIME_MCP_TOOLS,
  RUNTIME_OPERATIONS,
  resolveRuntimeOperationRequest,
  type RuntimeSession,
} from './runtime-contract.js';
import {
  getRuntimeFailureReason,
  startRuntimeOperationTelemetry,
} from './runtime-telemetry.js';
import {
  RuntimeCommandExecutionError,
  sendRuntimeCommand,
  type RuntimeCommandResponse,
} from './runtime-transport.js';
import { isScreenshotResult, saveScreenshot } from './screenshot-output.js';
import { CLI_VERSION } from './version.js';

type JsonObject = Record<string, unknown>;
type McpTextContent = { type: 'text'; text: string };
type McpImageContent = { type: 'image'; data: string; mimeType: string };

export interface StartRuntimeMcpStdioServerOptions {
  serverName?: string;
  version?: string;
  resolveSession: () => Promise<RuntimeSession | null>;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAX_ASSET_PREVIEW_MCP_NAMED_PARTS = 40;
const MAX_ASSET_PREVIEW_MCP_WARNINGS = 24;
const MAX_ASSET_PREVIEW_MCP_WARNINGS_PER_CODE = 3;

function compactAssetPreviewMetadata(metadata: JsonObject): JsonObject {
  if (!isRecord(metadata.diagnostics)) {
    return metadata;
  }
  const diagnostics = metadata.diagnostics;
  const namedPartRecords = Array.isArray(diagnostics.namedParts)
    ? diagnostics.namedParts.filter(isRecord)
    : null;
  const namedParts = (namedPartRecords ?? [])
    .slice(0, MAX_ASSET_PREVIEW_MCP_NAMED_PARTS)
    .map((part) => ({
      ...(typeof part.name === 'string' ? { name: part.name } : {}),
      ...(typeof part.path === 'string' ? { path: part.path } : {}),
      ...(typeof part.type === 'string' ? { type: part.type } : {}),
    }));
  const namedPartCount =
    typeof diagnostics.namedPartCount === 'number'
      ? diagnostics.namedPartCount
      : namedPartRecords?.length;
  const warningRecords = Array.isArray(diagnostics.warnings)
    ? diagnostics.warnings.filter(isRecord)
    : null;
  const warningCodeCounts = new Map<string, number>();
  const warningSampleCounts = new Map<string, number>();
  const warnings: JsonObject[] = [];
  for (const warning of warningRecords ?? []) {
    const code =
      typeof warning.code === 'string' ? warning.code : 'unknown_warning';
    warningCodeCounts.set(code, (warningCodeCounts.get(code) ?? 0) + 1);
    const sampledForCode = warningSampleCounts.get(code) ?? 0;
    if (
      warnings.length >= MAX_ASSET_PREVIEW_MCP_WARNINGS ||
      sampledForCode >= MAX_ASSET_PREVIEW_MCP_WARNINGS_PER_CODE
    ) {
      continue;
    }
    warningSampleCounts.set(code, sampledForCode + 1);
    warnings.push({
      code,
      ...(typeof warning.message === 'string'
        ? { message: warning.message }
        : {}),
      ...(typeof warning.path === 'string' ? { path: warning.path } : {}),
    });
  }

  return {
    ...metadata,
    diagnostics: {
      ...diagnostics,
      ...(namedPartRecords == null
        ? {}
        : {
            namedPartsTruncated:
              diagnostics.namedPartsTruncated === true ||
              (namedPartCount ?? namedPartRecords.length) > namedParts.length,
            namedPartCount: namedPartCount ?? namedPartRecords.length,
            namedParts,
          }),
      ...(warningRecords == null
        ? {}
        : {
            warningCodeCounts: Object.fromEntries(warningCodeCounts),
            warningCount: warningRecords.length,
            warnings,
            warningsTruncated: warningRecords.length > warnings.length,
          }),
    },
  };
}

function createTabMetadataText(
  tabId: string,
  tabGeneration?: number,
): McpTextContent {
  return {
    type: 'text',
    text: JSON.stringify(
      { _tab: { id: tabId, generation: tabGeneration } },
      null,
      2,
    ),
  };
}

function createTabTracker() {
  let lastTabId: string | null = null;
  let lastTabGeneration: number | null = null;

  return {
    processResponse(rawResponse: RuntimeCommandResponse) {
      const result = rawResponse.result ?? rawResponse;
      const tabId = rawResponse._tabId;
      const tabGeneration = rawResponse._tabGeneration;
      const previousTabId = lastTabId;
      const previousTabGeneration = lastTabGeneration;
      const tabChanged =
        previousTabId !== null && tabId != null && tabId !== previousTabId;
      const tabReloaded =
        previousTabId !== null &&
        previousTabId === tabId &&
        previousTabGeneration !== null &&
        typeof tabGeneration === 'number' &&
        tabGeneration !== previousTabGeneration;

      if (tabId) {
        lastTabId = tabId;
        lastTabGeneration =
          typeof tabGeneration === 'number' ? tabGeneration : null;
      }

      const content: McpTextContent[] = [];
      if (tabChanged || tabReloaded) {
        content.push({
          type: 'text',
          text: `WARNING: ${
            tabChanged
              ? `Active browser tab changed (previous: ${previousTabId}, current: ${tabId})`
              : `Active browser tab reloaded (tab: ${tabId}, generation: ${previousTabGeneration} -> ${tabGeneration})`
          }. All previously cached state (device positions, scene hierarchy, ECS snapshots) is now invalid. Re-query any state you need before proceeding.`,
        });
      }

      const normalizedResult = Array.isArray(result)
        ? result
        : isRecord(result)
          ? result
          : { value: result };

      if (Array.isArray(normalizedResult)) {
        content.push({
          type: 'text',
          text: JSON.stringify(normalizedResult, null, 2),
        });
        if (tabId) {
          content.push(createTabMetadataText(tabId, tabGeneration));
        }
        return { content };
      }

      content.push({
        type: 'text',
        text: JSON.stringify(
          {
            ...normalizedResult,
            ...(tabId
              ? { _tab: { id: tabId, generation: tabGeneration } }
              : {}),
          },
          null,
          2,
        ),
      });

      return { content };
    },
  };
}

function withBrowserStatus(
  result: unknown,
  session: RuntimeSession,
): JsonObject {
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

function createErrorContent(
  message: string,
  options: {
    cause?: string;
    browser?: RuntimeSession['browser'] | null;
    details?: Record<string, unknown>;
  } = {},
): McpTextContent[] {
  const payload = {
    message,
    ...(options.details ?? {}),
    ...(options.cause ? { cause: options.cause } : {}),
    ...(options.browser !== undefined ? { browser: options.browser } : {}),
  };

  return [{ type: 'text', text: JSON.stringify(payload, null, 2) }];
}

export async function startRuntimeMcpStdioServer({
  serverName = 'iwsdk',
  version = CLI_VERSION,
  resolveSession,
}: StartRuntimeMcpStdioServerOptions): Promise<void> {
  const tabTracker = createTabTracker();
  const server = new Server(
    {
      name: serverName,
      version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: RUNTIME_MCP_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const operation = RUNTIME_OPERATIONS.find(
      (entry) => entry.mcpName === name,
    );

    if (!operation) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const telemetry = startRuntimeOperationTelemetry(operation);
    // Validate before looking up the runtime, as the CLI does, so invalid
    // input fails the same way whether or not a runtime is running.
    let command: ReturnType<typeof resolveRuntimeOperationRequest>;
    try {
      command = resolveRuntimeOperationRequest(operation, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      telemetry.fail('invalid_input');
      return {
        content: createErrorContent(message),
        isError: true,
      };
    }

    let session: RuntimeSession | null;
    try {
      session = await resolveSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      telemetry.fail(getRuntimeFailureReason(error));
      return {
        content: [
          { type: 'text', text: `Failed to resolve IWSDK runtime: ${message}` },
        ],
        isError: true,
      };
    }

    if (!session) {
      telemetry.fail('no_runtime');
      return {
        content: [
          {
            type: 'text',
            text: 'No active IWSDK runtime found. Start the dev server with "iwsdk dev up" or use "iwsdk dev status" to inspect the current workspace.',
          },
        ],
        isError: true,
      };
    }

    telemetry.attachSession(session);
    try {
      const rawResponse = await sendRuntimeCommand({
        port: session.port,
        method: operation.wsMethod,
        params: command.params,
        target: command.target,
        runtimeSession: session,
      });
      telemetry.succeed();

      // Managed browser status would misdescribe a headset's session.
      const normalizedResponse =
        name === 'xr_get_session_status' &&
        command.target?.deviceClass !== 'physical'
          ? {
              ...rawResponse,
              result: withBrowserStatus(
                rawResponse.result ?? rawResponse,
                session,
              ),
            }
          : rawResponse;
      const result = normalizedResponse.result ?? normalizedResponse;
      if (
        (name === 'browser_screenshot' ||
          name === 'browser_filmstrip' ||
          name === 'scene_screenshot' ||
          name === 'scene_render_file' ||
          name === 'asset_render_preview' ||
          name === 'ui_render_preview') &&
        isScreenshotResult(result)
      ) {
        const screenshotPath = await saveScreenshot(result);
        const { imageData: _imageData, ...metadata } = result;
        const responseMetadata =
          name === 'asset_render_preview'
            ? compactAssetPreviewMetadata(metadata)
            : metadata;
        return tabTracker.processResponse({
          ...normalizedResponse,
          result: { ...responseMetadata, screenshotPath },
        });
      }

      if (
        name === 'browser_interact' &&
        isRecord(result) &&
        isRecord(result.failure) &&
        isRecord(result.failure.screenshot) &&
        typeof result.failure.screenshot.imageData === 'string'
      ) {
        const screenshot = result.failure.screenshot as {
          imageData: string;
          mimeType?: unknown;
        };
        const mimeType =
          typeof screenshot.mimeType === 'string'
            ? screenshot.mimeType
            : 'image/png';
        const sanitizedResult = {
          ...result,
          failure: {
            ...result.failure,
            screenshot: {
              captured: true,
              mimeType,
            },
          },
        };
        const content: Array<McpTextContent | McpImageContent> = [
          { type: 'text', text: JSON.stringify(sanitizedResult, null, 2) },
          {
            type: 'image',
            data: screenshot.imageData,
            mimeType,
          },
        ];
        if (normalizedResponse._tabId != null) {
          content.push(
            createTabMetadataText(
              normalizedResponse._tabId,
              normalizedResponse._tabGeneration,
            ),
          );
        }
        return { content };
      }

      return tabTracker.processResponse(normalizedResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      telemetry.fail(getRuntimeFailureReason(error));
      if (error instanceof RuntimeCommandExecutionError) {
        return {
          content: createErrorContent(message, {
            cause: error.issueCause,
            browser: error.browser ?? null,
            details: error.details,
          }),
          isError: true,
        };
      }
      return {
        content: createErrorContent(message),
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
