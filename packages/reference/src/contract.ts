/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: string[];
  oneOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export type ReferenceOperationId =
  | 'search'
  | 'relationship'
  | 'api'
  | 'file'
  | 'components'
  | 'systems'
  | 'dependents'
  | 'examples';

export type ReferenceHandlerId =
  | 'searchCode'
  | 'findByRelationship'
  | 'getApiReference'
  | 'getFileContent'
  | 'listEcsComponents'
  | 'listEcsSystems'
  | 'findDependents'
  | 'findUsageExamples';

export interface ReferenceOperationDefinition {
  id: ReferenceOperationId;
  cliName: string;
  handlerId: ReferenceHandlerId;
  mcpName: string;
  description: string;
  inputSchema: JsonSchema;
  requiresSearchService: boolean;
}

export const REFERENCE_OPERATIONS: ReferenceOperationDefinition[] = [
  {
    id: 'search',
    cliName: 'search',
    handlerId: 'searchCode',
    mcpName: 'search_code',
    description:
      'Semantic search across IWSDK and dependency code. Best for finding relevant code by description, use case, or functionality. Returns code chunks ranked by relevance.',
    requiresSearchService: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Natural language search query (e.g., "how to create a VR session", "XR controller input handling")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
          default: 10,
        },
        source: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter by source: ["iwsdk", "deps"]. Omit to search all sources.',
        },
        min_score: {
          type: 'number',
          description: 'Minimum similarity score (0.0-1.0, default: 0.0)',
          default: 0.0,
        },
        verbosity: {
          type: 'number',
          description:
            'Content verbosity level: 0=metadata only, 1=first 10 lines, 2=first 30 lines, 3=full content (default: 3)',
          default: 3,
        },
      },
      required: ['query'],
    },
  },
  {
    id: 'relationship',
    cliName: 'relationship',
    handlerId: 'findByRelationship',
    mcpName: 'find_by_relationship',
    description:
      'Find code by structural relationships. Use this to find all classes that extend/implement something, code that imports/calls specific functions, or uses WebXR APIs.',
    requiresSearchService: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['extends', 'implements', 'imports', 'calls', 'uses_webxr_api'],
          description: 'Relationship type to search for',
        },
        target: {
          type: 'string',
          description:
            'The target to search for (e.g., "Component" for extends, "XRSession" for uses_webxr_api)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 20)',
          default: 20,
        },
      },
      required: ['type', 'target'],
    },
  },
  {
    id: 'api',
    cliName: 'api',
    handlerId: 'getApiReference',
    mcpName: 'get_api_reference',
    description:
      'Quick lookup of API by name. Use this when you know the class/function/interface name and want to see its implementation and documentation. Exact matches come first, then members (Class.member), then prefix and substring matches.',
    requiresSearchService: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Name of the class, function, interface, or type to look up',
        },
        type: {
          type: 'string',
          enum: ['class', 'function', 'interface', 'type'],
          description: 'Filter by chunk type (optional)',
        },
        source: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter by source: ["iwsdk", "deps"]. Omit to search all sources.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matches to return (default: 8)',
          default: 8,
        },
      },
      required: ['name'],
    },
  },
  {
    id: 'file',
    cliName: 'file',
    handlerId: 'getFileContent',
    mcpName: 'get_file_content',
    description:
      'Read the full content of a source file. Useful for seeing complete file context beyond code snippets.',
    requiresSearchService: false,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description:
            'Relative path to the file (e.g., "packages/core/src/index.ts" or "@types/three/index.d.ts")',
        },
        source: {
          type: 'string',
          enum: ['iwsdk', 'deps'],
          description: 'Source of the file',
        },
        start_line: {
          type: 'number',
          description: 'Optional starting line number (1-indexed)',
        },
        end_line: {
          type: 'number',
          description: 'Optional ending line number',
        },
      },
      required: ['file_path', 'source'],
    },
  },
  {
    id: 'components',
    cliName: 'components',
    handlerId: 'listEcsComponents',
    mcpName: 'list_ecs_components',
    description:
      'List all ECS (Entity Component System) components in the codebase.',
    requiresSearchService: true,
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by source: ["iwsdk"]. Omit to list all.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of components to return (default: 100)',
          default: 100,
        },
      },
    },
  },
  {
    id: 'systems',
    cliName: 'systems',
    handlerId: 'listEcsSystems',
    mcpName: 'list_ecs_systems',
    description:
      'List all ECS (Entity Component System) systems in the codebase.',
    requiresSearchService: true,
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by source: ["iwsdk"]. Omit to list all.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of systems to return (default: 100)',
          default: 100,
        },
      },
    },
  },
  {
    id: 'dependents',
    cliName: 'dependents',
    handlerId: 'findDependents',
    mcpName: 'find_dependents',
    description:
      'Find code that depends on a given API (reverse dependency lookup). Answers "what uses this API?"',
    requiresSearchService: true,
    inputSchema: {
      type: 'object',
      properties: {
        api_name: {
          type: 'string',
          description: 'Name of the API to find dependents for',
        },
        dependency_type: {
          type: 'string',
          enum: ['imports', 'calls', 'extends', 'implements', 'any'],
          description: 'Type of dependency to search for (default: "any")',
          default: 'any',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of dependents to return (default: 20)',
          default: 20,
        },
      },
      required: ['api_name'],
    },
  },
  {
    id: 'examples',
    cliName: 'examples',
    handlerId: 'findUsageExamples',
    mcpName: 'find_usage_examples',
    description:
      'Find real-world usage examples of an API. Prioritizes code that actually imports and uses the API, not just type definitions. Perfect for understanding how to use a specific API.',
    requiresSearchService: true,
    inputSchema: {
      type: 'object',
      properties: {
        api_name: {
          type: 'string',
          description:
            'Name of the API to find usage examples for (e.g., "Component", "createComponent", "XRSession")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of examples to return (default: 10)',
          default: 10,
        },
      },
      required: ['api_name'],
    },
  },
];

export const REFERENCE_MCP_TOOLS: McpToolDefinition[] =
  REFERENCE_OPERATIONS.map(({ mcpName, description, inputSchema }) => ({
    name: mcpName,
    description,
    inputSchema,
  }));

export function getReferenceOperationByCliName(
  cliName: string,
): ReferenceOperationDefinition | undefined {
  return REFERENCE_OPERATIONS.find(
    (operation) => operation.cliName === cliName,
  );
}

export function getReferenceOperationById(
  id: string,
): ReferenceOperationDefinition | undefined {
  return REFERENCE_OPERATIONS.find((operation) => operation.id === id);
}

export function getReferenceOperationByMcpName(
  mcpName: string,
): ReferenceOperationDefinition | undefined {
  return REFERENCE_OPERATIONS.find(
    (operation) => operation.mcpName === mcpName,
  );
}
