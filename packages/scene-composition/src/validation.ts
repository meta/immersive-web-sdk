/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  collectSceneRuntimeNodeIds,
  getScenePatternRequestedCount,
} from './expansion.js';
import { getSceneCompositionSourceHashes } from './provenance.js';
import {
  SCENE_DOCUMENT_JSON_SCHEMA,
  SCENE_REVIEW_JSON_SCHEMA,
} from './schema.js';
import { SCENE_IMPORT_ID_PATTERN } from './types.js';
import type {
  SceneComponentFieldSchema,
  SceneComponentCatalog,
  SceneComponentSchema,
  SceneDocument,
  SceneFeature,
  SceneFeatureAcceptance,
  SceneImport,
  SceneNode,
  ScenePatternDistribution,
  ScenePrefabNodeOverride,
  SceneReview,
  ValidationIssue,
  ValidationResult,
} from './types.js';
import {
  isFiniteNumber,
  isJsonValue,
  isPlainObject,
  isVec2,
  isVec3,
} from './utils.js';

export const MAX_SCENE_COORDINATE = 1_000_000;
export const MAX_SCENE_NODES = 10_000;
export const MAX_SCENE_RESOURCES = 4_096;
export const MAX_SCENE_PATTERN_EXPANSION = 10_000;
export const MAX_SCENE_MODEL_PAYLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_SCENE_TOTAL_MODEL_PAYLOAD_BYTES = 256 * 1024 * 1024;

type JsonSchema = boolean | Record<string, unknown>;

export interface SceneDocumentValidationOptions {
  /** Runtime component definitions used to validate component property maps. */
  componentCatalog?: SceneComponentCatalog;
  /**
   * Asset IDs declared by the application's complete asset manifest. Omit to
   * disable asset-reference validation; an empty catalog rejects every asset
   * reference.
   */
  knownAssetIds?: ReadonlySet<string> | readonly string[];
  /**
   * Validate composition contracts, review bindings, and other authoring-only
   * semantics. Disable this for runtime/editor document-integrity checks.
   */
  validateAuthoringWorkflow?: boolean;
  /** Validate required file and entity links. Runtime loading may allow drafts. */
  validateComponentLinks?: boolean;
}

export function validateSceneDocument(
  value: unknown,
  options: SceneDocumentValidationOptions = {},
): ValidationResult {
  const issues = validateSchema(value, SCENE_DOCUMENT_JSON_SCHEMA);
  if (issues.length === 0) {
    validateSceneSemantics(
      value as SceneDocument,
      issues,
      options.componentCatalog,
      options.validateAuthoringWorkflow !== false,
      options.validateComponentLinks !== false,
      options.knownAssetIds == null
        ? undefined
        : new Set(options.knownAssetIds),
    );
  }
  return { valid: issues.length === 0, issues };
}

export function validateSceneReview(value: unknown): ValidationResult {
  const issues = validateSchema(value, SCENE_REVIEW_JSON_SCHEMA);
  if (issues.length === 0) {
    validateReviewSemantics(value as SceneReview, issues);
  }
  return { valid: issues.length === 0, issues };
}

export function assertValidSceneDocument(
  value: unknown,
  options: SceneDocumentValidationOptions = {},
): asserts value is SceneDocument {
  assertValidationResult(
    'IWSDK scene document',
    validateSceneDocument(value, options),
  );
}

export function assertValidSceneReview(
  value: unknown,
): asserts value is SceneReview {
  assertValidationResult('IWSDK scene review', validateSceneReview(value));
}

function assertValidationResult(label: string, result: ValidationResult) {
  if (!result.valid) {
    const details = result.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid ${label}:\n${details}`);
  }
}

/** Validates the Draft 2020-12 subset used by the exported closed schemas. */
function validateSchema(value: unknown, rootSchemaValue: unknown) {
  const issues: ValidationIssue[] = [];
  const rootSchema = rootSchemaValue as JsonSchema;
  validateSchemaValue(value, rootSchema, rootSchema, '$', issues);
  return issues;
}

function validateSchemaValue(
  value: unknown,
  schema: JsonSchema,
  rootSchema: JsonSchema,
  path: string,
  issues: ValidationIssue[],
) {
  if (schema === true) {
    return;
  }
  if (schema === false) {
    addIssue(issues, path, 'value is not allowed', 'schema');
    return;
  }

  const reference = schema.$ref;
  if (typeof reference === 'string') {
    const resolved = resolveSchemaReference(reference, rootSchema);
    if (resolved == null) {
      addIssue(
        issues,
        path,
        `unresolved schema reference "${reference}"`,
        'schema',
      );
      return;
    }
    validateSchemaValue(value, resolved, rootSchema, path, issues);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      validateSchemaValue(
        value,
        branch as JsonSchema,
        rootSchema,
        path,
        issues,
      );
    }
  }
  if (Array.isArray(schema.anyOf)) {
    if (
      !schema.anyOf.some((branch) =>
        schemaMatches(value, branch as JsonSchema, rootSchema),
      )
    ) {
      addIssue(
        issues,
        path,
        'value must match at least one allowed schema',
        'schema',
      );
      return;
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const discriminator = selectDiscriminatedBranch(value, schema.oneOf);
    if (discriminator != null) {
      validateSchemaValue(value, discriminator, rootSchema, path, issues);
      return;
    }
    const matches = schema.oneOf.filter((branch) =>
      schemaMatches(value, branch as JsonSchema, rootSchema),
    );
    if (matches.length !== 1) {
      const branchIssues = schema.oneOf.map((branch) => {
        const candidate: ValidationIssue[] = [];
        validateSchemaValue(
          value,
          branch as JsonSchema,
          rootSchema,
          path,
          candidate,
        );
        return candidate;
      });
      const closest = branchIssues.sort(
        (left, right) => left.length - right.length,
      )[0];
      if (closest != null && closest.length > 0) {
        issues.push(...closest);
      } else {
        addIssue(
          issues,
          path,
          'value must match exactly one allowed schema',
          'schema',
        );
      }
      return;
    }
    return;
  }
  if (
    schema.not != null &&
    schemaMatches(value, schema.not as JsonSchema, rootSchema)
  ) {
    addIssue(issues, path, 'value matches a prohibited schema', 'schema');
    return;
  }

  if ('const' in schema && !jsonEqual(value, schema.const)) {
    addIssue(
      issues,
      path,
      `value must equal ${JSON.stringify(schema.const)}`,
      'schema',
    );
    return;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((entry) => jsonEqual(value, entry))
  ) {
    addIssue(issues, path, 'value is not one of the allowed values', 'schema');
    return;
  }

  if (!validateSchemaType(value, schema.type, path, issues)) {
    return;
  }

  if (typeof value === 'string') {
    validateStringSchema(value, schema, path, issues);
  } else if (typeof value === 'number') {
    validateNumberSchema(value, schema, path, issues);
  } else if (Array.isArray(value)) {
    validateArraySchema(value, schema, rootSchema, path, issues);
  } else if (isPlainObject(value)) {
    validateObjectSchema(value, schema, rootSchema, path, issues);
  }

  if (isPlainObject(schema.if)) {
    const branch = schemaMatches(value, schema.if, rootSchema)
      ? schema.then
      : schema.else;
    if (branch != null) {
      validateSchemaValue(
        value,
        branch as JsonSchema,
        rootSchema,
        path,
        issues,
      );
    }
  }
}

function validateSchemaType(
  value: unknown,
  type: unknown,
  path: string,
  issues: ValidationIssue[],
) {
  if (type == null) {
    return true;
  }
  const types = Array.isArray(type) ? type : [type];
  const matches = types.some((candidate) => {
    switch (candidate) {
      case 'null':
        return value === null;
      case 'boolean':
        return typeof value === 'boolean';
      case 'string':
        return typeof value === 'string';
      case 'number':
        return isFiniteNumber(value);
      case 'integer':
        return isFiniteNumber(value) && Number.isInteger(value);
      case 'array':
        return Array.isArray(value);
      case 'object':
        return isPlainObject(value);
      default:
        return false;
    }
  });
  if (!matches) {
    addIssue(issues, path, `value must be ${types.join(' or ')}`, 'schema');
  }
  return matches;
}

function validateStringSchema(
  value: string,
  schema: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
) {
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    addIssue(
      issues,
      path,
      `string must contain at least ${schema.minLength} characters`,
      'schema',
    );
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    addIssue(
      issues,
      path,
      `string must contain at most ${schema.maxLength} characters`,
      'schema',
    );
  }
  if (
    typeof schema.pattern === 'string' &&
    !new RegExp(schema.pattern, 'u').test(value)
  ) {
    addIssue(issues, path, `string must match ${schema.pattern}`, 'schema');
  }
}

function validateNumberSchema(
  value: number,
  schema: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
) {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    addIssue(
      issues,
      path,
      `number must be at least ${schema.minimum}`,
      'schema',
    );
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    addIssue(
      issues,
      path,
      `number must be at most ${schema.maximum}`,
      'schema',
    );
  }
  if (
    typeof schema.exclusiveMinimum === 'number' &&
    value <= schema.exclusiveMinimum
  ) {
    addIssue(
      issues,
      path,
      `number must be above ${schema.exclusiveMinimum}`,
      'schema',
    );
  }
  if (
    typeof schema.exclusiveMaximum === 'number' &&
    value >= schema.exclusiveMaximum
  ) {
    addIssue(
      issues,
      path,
      `number must be below ${schema.exclusiveMaximum}`,
      'schema',
    );
  }
}

function validateArraySchema(
  value: unknown[],
  schema: Record<string, unknown>,
  rootSchema: JsonSchema,
  path: string,
  issues: ValidationIssue[],
) {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    addIssue(
      issues,
      path,
      `array must contain at least ${schema.minItems} items`,
      'schema',
    );
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    addIssue(
      issues,
      path,
      `array must contain at most ${schema.maxItems} items`,
      'schema',
    );
  }
  if (schema.uniqueItems === true) {
    const seen = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
      const key = JSON.stringify(value[index]);
      if (seen.has(key)) {
        addIssue(
          issues,
          `${path}[${index}]`,
          'array items must be unique',
          'schema',
        );
      }
      seen.add(key);
    }
  }
  if (Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((itemSchema, index) => {
      if (index < value.length) {
        validateSchemaValue(
          value[index],
          itemSchema as JsonSchema,
          rootSchema,
          `${path}[${index}]`,
          issues,
        );
      }
    });
  }
  if (schema.items != null && !Array.isArray(schema.items)) {
    const start = Array.isArray(schema.prefixItems)
      ? schema.prefixItems.length
      : 0;
    for (let index = start; index < value.length; index += 1) {
      validateSchemaValue(
        value[index],
        schema.items as JsonSchema,
        rootSchema,
        `${path}[${index}]`,
        issues,
      );
    }
  }
}

function validateObjectSchema(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  rootSchema: JsonSchema,
  path: string,
  issues: ValidationIssue[],
) {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  if (isPlainObject(schema.propertyNames)) {
    for (const key of Object.keys(value)) {
      validateSchemaValue(
        key,
        schema.propertyNames,
        rootSchema,
        childPath(path, key),
        issues,
      );
    }
  }
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key === 'string' && !(key in value)) {
        addIssue(
          issues,
          childPath(path, key),
          'required property is missing',
          'schema',
        );
      }
    }
  }
  if (
    typeof schema.minProperties === 'number' &&
    Object.keys(value).length < schema.minProperties
  ) {
    addIssue(
      issues,
      path,
      `object must contain at least ${schema.minProperties} properties`,
      'schema',
    );
  }
  if (
    typeof schema.maxProperties === 'number' &&
    Object.keys(value).length > schema.maxProperties
  ) {
    addIssue(
      issues,
      path,
      `object must contain at most ${schema.maxProperties} properties`,
      'schema',
    );
  }

  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema != null) {
      validateSchemaValue(
        entry,
        propertySchema as JsonSchema,
        rootSchema,
        childPath(path, key),
        issues,
      );
      continue;
    }
    if (schema.additionalProperties === false) {
      addIssue(
        issues,
        childPath(path, key),
        'property is not allowed',
        'schema',
      );
    } else if (
      isPlainObject(schema.additionalProperties) ||
      typeof schema.additionalProperties === 'boolean'
    ) {
      validateSchemaValue(
        entry,
        schema.additionalProperties as JsonSchema,
        rootSchema,
        childPath(path, key),
        issues,
      );
    }
  }
}

function resolveSchemaReference(
  reference: string,
  rootSchema: JsonSchema,
): JsonSchema | undefined {
  if (!reference.startsWith('#/') || typeof rootSchema === 'boolean') {
    return undefined;
  }
  let current: unknown = rootSchema;
  for (const rawSegment of reference.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === 'boolean' || isPlainObject(current)
    ? current
    : undefined;
}

function selectDiscriminatedBranch(
  value: unknown,
  branches: unknown[],
): JsonSchema | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  for (const discriminator of ['type', 'model', 'kind', 'projection']) {
    const discriminant = value[discriminator];
    if (discriminant == null) {
      continue;
    }
    const matching = branches.filter((branch) => {
      if (!isPlainObject(branch) || !isPlainObject(branch.properties)) {
        return false;
      }
      const property = branch.properties[discriminator];
      return isPlainObject(property) && property.const === discriminant;
    });
    if (matching.length === 1) {
      return matching[0] as JsonSchema;
    }
  }
  return undefined;
}

function schemaMatches(
  value: unknown,
  schema: JsonSchema,
  rootSchema: JsonSchema,
) {
  const issues: ValidationIssue[] = [];
  validateSchemaValue(value, schema, rootSchema, '$', issues);
  return issues.length === 0;
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function childPath(path: string, key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function validateSceneSemantics(
  document: SceneDocument,
  issues: ValidationIssue[],
  componentCatalog: SceneComponentCatalog | undefined,
  validateAuthoringWorkflow: boolean,
  validateLinkedComponentFields: boolean,
  knownAssetIds: ReadonlySet<string> | undefined,
) {
  validateSceneImports(document.imports ?? [], issues);
  validateMetadataNamespaces(document.metadata, '$.metadata', issues);
  const resourceIds = new Map<string, string>();
  const prefabIds = new Set<string>();
  const resources = document.resources;
  const resourceCount = resources.prefabs?.length ?? 0;
  if (resourceCount > MAX_SCENE_RESOURCES) {
    addIssue(
      issues,
      '$.resources',
      `resource count exceeds ${MAX_SCENE_RESOURCES}`,
      'limit',
    );
  }

  const registerResource = (id: string, path: string, kind: string) => {
    const previous = resourceIds.get(id);
    if (previous != null) {
      addIssue(
        issues,
        path,
        `duplicate resource id "${id}" (already used by ${previous})`,
        'duplicate-id',
      );
    } else {
      resourceIds.set(id, kind);
    }
  };
  resources.prefabs?.forEach((prefab, index) => {
    registerResource(prefab.id, `$.resources.prefabs[${index}].id`, 'prefab');
    prefabIds.add(prefab.id);
  });

  const schemas = validateComponentCatalog(componentCatalog, issues);
  const mainNodeIds = collectNodeIdsStrict(document.nodes, '$.nodes', issues);
  validateComponents(
    document.components,
    '$.components',
    schemas,
    componentCatalog != null,
    issues,
  );
  validateRootComponents(document.components, issues);
  validatePlayerComponents(document, schemas, componentCatalog != null, issues);
  if (componentCatalog != null && validateLinkedComponentFields) {
    validateComponentLinks(document, schemas, mainNodeIds, issues);
  }
  let totalNodes = mainNodeIds.size;
  const prefabNodeIds = new Map<string, Set<string>>();
  resources.prefabs?.forEach((prefab, index) => {
    const path = `$.resources.prefabs[${index}].root`;
    const localIds = collectNodeIdsStrict([prefab.root], path, issues);
    prefabNodeIds.set(prefab.id, localIds);
    totalNodes += localIds.size;
  });
  resources.prefabs?.forEach((prefab, index) => {
    const path = `$.resources.prefabs[${index}].root`;
    validateNodes(
      [prefab.root],
      path,
      prefabIds,
      prefabNodeIds,
      schemas,
      componentCatalog != null,
      knownAssetIds,
      issues,
      false,
    );
  });
  if (totalNodes > MAX_SCENE_NODES) {
    addIssue(
      issues,
      '$.nodes',
      `node count exceeds ${MAX_SCENE_NODES}`,
      'limit',
    );
  }
  validateNodes(
    document.nodes,
    '$.nodes',
    prefabIds,
    prefabNodeIds,
    schemas,
    componentCatalog != null,
    knownAssetIds,
    issues,
    true,
  );
  validatePrefabCycles(document, prefabIds, issues);
  if (
    !issues.some((issue) =>
      ['cycle', 'duplicate-id', 'limit', 'reference'].includes(
        issue.code ?? '',
      ),
    )
  ) {
    validateRuntimeNodeIds(document, issues);
  }
  if (validateAuthoringWorkflow) {
    validateAuthoring(document, mainNodeIds, issues);
  }

  if (
    document.environment?.fog?.type === 'linear' &&
    document.environment.fog.near >= document.environment.fog.far
  ) {
    addIssue(
      issues,
      '$.environment.fog',
      'linear fog near must be below far',
      'range',
    );
  }
}

function validateSceneImports(
  imports: SceneImport[],
  issues: ValidationIssue[],
) {
  const ids = new Set<string>();
  const safeId = new RegExp(SCENE_IMPORT_ID_PATTERN, 'u');
  imports.forEach((sceneImport, index) => {
    const path = `$.imports[${index}]`;
    if (!safeId.test(sceneImport.id)) {
      addIssue(
        issues,
        `${path}.id`,
        'import id must start with an ASCII letter and contain only ASCII letters, digits, "_", or "-"',
        'unsafe-id',
      );
    }
    if (ids.has(sceneImport.id)) {
      addIssue(
        issues,
        `${path}.id`,
        `duplicate import id "${sceneImport.id}"`,
        'duplicate-id',
      );
    }
    ids.add(sceneImport.id);
    if (sceneImport.src.trim().length === 0) {
      addIssue(
        issues,
        `${path}.src`,
        'import source must not be blank',
        'unsafe-uri',
      );
    }
  });
}

function validateRuntimeNodeIds(
  document: SceneDocument,
  issues: ValidationIssue[],
) {
  let entries;
  try {
    entries = collectSceneRuntimeNodeIds(document, MAX_SCENE_PATTERN_EXPANSION);
  } catch (error) {
    addIssue(
      issues,
      '$.nodes',
      error instanceof Error ? error.message : String(error),
      'limit',
    );
    return;
  }

  const seen = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    const previous = seen.get(entry.id);
    if (previous == null) {
      seen.set(entry.id, entry);
      continue;
    }
    if (!entry.derived && !previous.derived) {
      continue;
    }
    addIssue(
      issues,
      `${entry.sourcePath}.id`,
      `derived runtime node id "${entry.id}" collides with ${previous.sourcePath}`,
      'duplicate-id',
    );
  }
}

function validateNodes(
  nodes: SceneNode[],
  path: string,
  prefabIds: Set<string>,
  prefabNodeIds: Map<string, Set<string>>,
  schemas: Map<string, SceneComponentSchema>,
  validateComponentFields: boolean,
  knownAssetIds: ReadonlySet<string> | undefined,
  issues: ValidationIssue[],
  allowPlayerParent: boolean,
) {
  nodes.forEach((node, index) => {
    const nodePath =
      nodes.length === 1 && path.endsWith('.root') ? path : `${path}[${index}]`;
    validateTransformCoordinates(
      node.transform,
      `${nodePath}.transform`,
      issues,
    );
    if (node.parent != null && !allowPlayerParent) {
      addIssue(
        issues,
        `${nodePath}.parent`,
        'player-space parents are only valid on top-level scene nodes',
        'conflict',
      );
    }
    validateMetadataNamespaces(node.metadata, `${nodePath}.metadata`, issues);
    const content = node.content;
    if (
      content?.type === 'asset' &&
      knownAssetIds != null &&
      !knownAssetIds.has(content.asset)
    ) {
      addIssue(
        issues,
        `${nodePath}.content.asset`,
        `asset "${content.asset}" is not declared in the project asset catalog; add "${content.asset}" to the asset manifest or replace this reference with a declared asset id`,
        'reference',
      );
    }
    if (content?.type === 'instance' || content?.type === 'pattern') {
      if (!prefabIds.has(content.prefab)) {
        addIssue(
          issues,
          `${nodePath}.content.prefab`,
          `unknown prefab "${content.prefab}"`,
          'reference',
        );
      }
      if (content.type === 'pattern') {
        validatePatternExpansion(
          content.distribution,
          `${nodePath}.content.distribution`,
          issues,
        );
      }
    }

    if (content?.type === 'instance' || content?.type === 'pattern') {
      validatePrefabOverrides(
        content.overrides,
        content.prefab,
        nodePath,
        prefabNodeIds,
        schemas,
        validateComponentFields,
        issues,
      );
    }
    validateComponents(
      node.components,
      `${nodePath}.components`,
      schemas,
      validateComponentFields,
      issues,
    );
    validateNodes(
      node.children ?? [],
      `${nodePath}.children`,
      prefabIds,
      prefabNodeIds,
      schemas,
      validateComponentFields,
      knownAssetIds,
      issues,
      false,
    );
  });
}

function collectNodeIdsStrict(
  nodes: SceneNode[],
  path: string,
  issues: ValidationIssue[],
) {
  const ids = new Set<string>();
  const visit = (entries: SceneNode[], entryPath: string) => {
    entries.forEach((node, index) => {
      const nodePath =
        entries.length === 1 && entryPath.endsWith('.root')
          ? entryPath
          : `${entryPath}[${index}]`;
      if (ids.has(node.id)) {
        addIssue(
          issues,
          `${nodePath}.id`,
          `duplicate node id "${node.id}"`,
          'duplicate-id',
        );
      }
      ids.add(node.id);
      visit(node.children ?? [], `${nodePath}.children`);
    });
  };
  visit(nodes, path);
  return ids;
}

function validatePrefabCycles(
  document: SceneDocument,
  prefabIds: Set<string>,
  issues: ValidationIssue[],
) {
  const graph = new Map<string, Set<string>>();
  document.resources.prefabs?.forEach((prefab) => {
    const dependencies = new Set<string>();
    walkNodes([prefab.root], '$', (node) => {
      if (
        (node.content?.type === 'instance' ||
          node.content?.type === 'pattern') &&
        prefabIds.has(node.content.prefab)
      ) {
        dependencies.add(node.content.prefab);
      }
    });
    graph.set(prefab.id, dependencies);
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: string[]) => {
    if (visiting.has(id)) {
      addIssue(
        issues,
        '$.resources.prefabs',
        `prefab recursion: ${[...trail, id].join(' -> ')}`,
        'cycle',
      );
      return;
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) {
      visit(dependency, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) {
    visit(id, []);
  }
}

function validateAuthoring(
  document: SceneDocument,
  nodeIds: Set<string>,
  issues: ValidationIssue[],
) {
  const authoring = document.authoring;
  if (authoring == null) {
    return;
  }
  const viewIds = new Set<string>();
  const viewsById = new Map<string, { role: string }>();
  authoring.views?.forEach((view, index) => {
    if (viewIds.has(view.id)) {
      addIssue(
        issues,
        `$.authoring.views[${index}].id`,
        `duplicate view id "${view.id}"`,
        'duplicate-id',
      );
    }
    viewIds.add(view.id);
    viewsById.set(view.id, view);
  });
  const composition = authoring.composition;
  const referenceIds = new Set<string>();
  composition?.input.references?.forEach((reference, index) => {
    if (referenceIds.has(reference.id)) {
      addIssue(
        issues,
        `$.authoring.composition.input.references[${index}].id`,
        `duplicate reference id "${reference.id}"`,
        'duplicate-id',
      );
    }
    referenceIds.add(reference.id);
    validateSafeUri(
      reference.uri,
      `$.authoring.composition.input.references[${index}].uri`,
      issues,
    );
  });
  if (composition != null) {
    if (
      (composition.input.kind === 'text' ||
        composition.input.kind === 'hybrid') &&
      !nonEmpty(composition.input.prompt)
    ) {
      addIssue(
        issues,
        '$.authoring.composition.input.prompt',
        `${composition.input.kind} input requires a prompt`,
        'required',
      );
    }
    if (
      (composition.input.kind === 'image' ||
        composition.input.kind === 'hybrid') &&
      (composition.input.references?.length ?? 0) === 0
    ) {
      addIssue(
        issues,
        '$.authoring.composition.input.references',
        `${composition.input.kind} input requires references`,
        'required',
      );
    }
    if (composition.feasibility.status === 'blocked') {
      addIssue(
        issues,
        '$.authoring.composition.feasibility.status',
        'blocked composition cannot be materialized',
        'state',
      );
    }
    if (
      composition.feasibility.status === 'conditional' &&
      (composition.representationPolicy.acceptedApproximations?.length ?? 0) ===
        0
    ) {
      addIssue(
        issues,
        '$.authoring.composition.representationPolicy.acceptedApproximations',
        'conditional composition requires an accepted approximation',
        'required',
      );
    }
    const provenanceInputs = new Set(
      composition.provenance.inputHashes.map((hash) => hash.toLowerCase()),
    );
    const declaredInputHashes = new Set(
      getSceneCompositionSourceHashes(composition.input).map((hash) =>
        hash.toLowerCase(),
      ),
    );
    declaredInputHashes.forEach((expected) => {
      if (!provenanceInputs.has(expected)) {
        addIssue(
          issues,
          '$.authoring.composition.provenance.inputHashes',
          `declared input hash "${expected}" is missing from compilation provenance`,
          'reference',
        );
      }
    });
    provenanceInputs.forEach((actual) => {
      if (!declaredInputHashes.has(actual)) {
        addIssue(
          issues,
          '$.authoring.composition.provenance.inputHashes',
          `compilation provenance hash "${actual}" does not identify a declared prompt or reference`,
          'reference',
        );
      }
    });
    validateCompositionPolicies(document, composition, issues);
    const featureIds = new Set<string>();
    composition.features.forEach((feature, featureIndex) => {
      const featurePath = `$.authoring.composition.features[${featureIndex}]`;
      if (featureIds.has(feature.id)) {
        addIssue(
          issues,
          `${featurePath}.id`,
          `duplicate feature id "${feature.id}"`,
          'duplicate-id',
        );
      }
      featureIds.add(feature.id);
      if (feature.priority === 'required' && feature.acceptance.length === 0) {
        addIssue(
          issues,
          `${featurePath}.acceptance`,
          'required feature must declare acceptance criteria',
          'required',
        );
      }
      validateNodeReferences(
        feature.nodeRefs,
        `${featurePath}.nodeRefs`,
        nodeIds,
        issues,
      );
      validateObjectInspection(
        document,
        feature,
        featurePath,
        nodeIds,
        viewIds,
        new Set([
          composition.review.heroView,
          ...composition.review.requiredViews,
        ]),
        issues,
      );
      const criterionIds = new Set<string>();
      const acceptanceCoveredBindings = new Set<string>();
      feature.acceptance.forEach((criterion, criterionIndex) => {
        const criterionPath = `${featurePath}.acceptance[${criterionIndex}]`;
        if (criterionIds.has(criterion.id)) {
          addIssue(
            issues,
            `${criterionPath}.id`,
            `duplicate criterion id "${criterion.id}"`,
            'duplicate-id',
          );
        }
        criterionIds.add(criterion.id);
        validateAcceptance(
          criterion,
          criterionPath,
          document,
          nodeIds,
          viewIds,
          referenceIds,
          issues,
        );
        acceptanceSubjectNodeReferences(criterion).forEach((subject) => {
          if (!nodeIds.has(subject.nodeId)) {
            return;
          }
          const coveringBindings = feature.nodeRefs.filter((binding) =>
            isNodeSameOrDescendant(document.nodes, subject.nodeId, binding),
          );
          if (coveringBindings.length === 0) {
            addIssue(
              issues,
              `${criterionPath}.${subject.path}`,
              `criterion subject node "${subject.nodeId}" is outside feature "${feature.id}" node bindings`,
              'reference',
            );
            return;
          }
          coveringBindings.forEach((binding) =>
            acceptanceCoveredBindings.add(binding),
          );
        });
      });
      if (feature.priority === 'required') {
        feature.nodeRefs.forEach((nodeRef, nodeRefIndex) => {
          if (nodeIds.has(nodeRef) && !acceptanceCoveredBindings.has(nodeRef)) {
            addIssue(
              issues,
              `${featurePath}.nodeRefs[${nodeRefIndex}]`,
              `required feature binding "${nodeRef}" is not covered by an acceptance criterion subject`,
              'required',
            );
          }
        });
      }
      feature.evidence?.forEach((evidence, evidenceIndex) => {
        if (!referenceIds.has(evidence.reference)) {
          addIssue(
            issues,
            `${featurePath}.evidence[${evidenceIndex}].reference`,
            `unknown reference "${evidence.reference}"`,
            'reference',
          );
        }
        if (evidence.region != null) {
          validateNormalizedRegion(
            evidence.region,
            `${featurePath}.evidence[${evidenceIndex}].region`,
            issues,
          );
        }
      });
    });
    const reviewPath = '$.authoring.composition.review';
    if (!viewIds.has(composition.review.heroView)) {
      addIssue(
        issues,
        `${reviewPath}.heroView`,
        `unknown view "${composition.review.heroView}"`,
        'reference',
      );
    }
    if (viewsById.get(composition.review.heroView)?.role !== 'hero') {
      addIssue(
        issues,
        `${reviewPath}.heroView`,
        'heroView must reference a hero-role view',
        'reference',
      );
    }
    composition.review.requiredViews.forEach((view, index) => {
      if (!viewIds.has(view)) {
        addIssue(
          issues,
          `${reviewPath}.requiredViews[${index}]`,
          `unknown view "${view}"`,
          'reference',
        );
      }
    });
    composition.representationPolicy.acceptedApproximations?.forEach(
      (approximation, index) => {
        if (!featureIds.has(approximation.feature)) {
          addIssue(
            issues,
            `$.authoring.composition.representationPolicy.acceptedApproximations[${index}].feature`,
            `unknown feature "${approximation.feature}"`,
            'reference',
          );
        }
      },
    );
    const assumptionIds = new Set<string>();
    composition.assumptions?.forEach((assumption, index) => {
      if (assumptionIds.has(assumption.id)) {
        addIssue(
          issues,
          `$.authoring.composition.assumptions[${index}].id`,
          `duplicate assumption id "${assumption.id}"`,
          'duplicate-id',
        );
      }
      assumptionIds.add(assumption.id);
    });
  }
  authoring.nodeAnnotations?.forEach((annotation, index) => {
    if (!nodeIds.has(annotation.node)) {
      addIssue(
        issues,
        `$.authoring.nodeAnnotations[${index}].node`,
        `unknown node "${annotation.node}"`,
        'reference',
      );
    }
    annotation.featureRefs?.forEach((feature, featureIndex) => {
      if (!composition?.features.some((entry) => entry.id === feature)) {
        addIssue(
          issues,
          `$.authoring.nodeAnnotations[${index}].featureRefs[${featureIndex}]`,
          `unknown feature "${feature}"`,
          'reference',
        );
      }
    });
  });
  validateLayoutReviewVisibility(document, issues);
}

type SceneReviewLayer = 'layout' | 'geometry' | 'final';

function validateLayoutReviewVisibility(
  document: SceneDocument,
  issues: ValidationIssue[],
) {
  const annotations = document.authoring?.nodeAnnotations ?? [];
  const layoutAnnotations = annotations
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => annotation.reviewLayer === 'layout');
  if (layoutAnnotations.length === 0) {
    return;
  }

  const annotationByNode = new Map(
    annotations.map((annotation) => [annotation.node, annotation]),
  );
  const nodeById = new Map<string, SceneNode>();
  const effectiveLayerByNode = new Map<string, SceneReviewLayer>();
  const collectEffectiveLayers = (
    nodes: readonly SceneNode[],
    inheritedLayer: SceneReviewLayer,
  ) => {
    nodes.forEach((node) => {
      nodeById.set(node.id, node);
      const effectiveLayer =
        annotationByNode.get(node.id)?.reviewLayer ?? inheritedLayer;
      effectiveLayerByNode.set(node.id, effectiveLayer);
      collectEffectiveLayers(node.children ?? [], effectiveLayer);
    });
  };
  collectEffectiveLayers(document.nodes, 'layout');

  const prefabById = new Map(
    (document.resources.prefabs ?? []).map((prefab) => [prefab.id, prefab]),
  );
  const subtreeHasLayoutRenderable = (
    node: SceneNode,
    inheritedLayer: SceneReviewLayer,
    authoredNode: boolean,
    prefabStack: readonly string[] = [],
    prefabOverrides?: Record<string, ScenePrefabNodeOverride>,
    ancestorVisible = true,
  ): boolean => {
    const effectivelyVisible =
      ancestorVisible && (prefabOverrides?.[node.id]?.visible ?? true);
    if (!effectivelyVisible) {
      return false;
    }
    const effectiveLayer = authoredNode
      ? (effectiveLayerByNode.get(node.id) ?? inheritedLayer)
      : inheritedLayer;
    if (effectiveLayer === 'layout' && node.content?.type === 'asset') {
      return true;
    }

    const content = node.content;
    if (
      (content?.type === 'instance' || content?.type === 'pattern') &&
      (content.type !== 'pattern' ||
        getScenePatternRequestedCount(content.distribution) > 0)
    ) {
      const prefab = prefabById.get(content.prefab);
      if (prefab != null && !prefabStack.includes(prefab.id)) {
        if (
          subtreeHasLayoutRenderable(
            prefab.root,
            effectiveLayer,
            false,
            [...prefabStack, prefab.id],
            content.overrides,
            effectivelyVisible,
          )
        ) {
          return true;
        }
      }
    }

    return (node.children ?? []).some((child) =>
      subtreeHasLayoutRenderable(
        child,
        effectiveLayer,
        authoredNode,
        prefabStack,
        prefabOverrides,
        effectivelyVisible,
      ),
    );
  };

  layoutAnnotations.forEach(({ annotation, index }) => {
    const node = nodeById.get(annotation.node);
    if (node != null && !subtreeHasLayoutRenderable(node, 'layout', true)) {
      addIssue(
        issues,
        `$.authoring.nodeAnnotations[${index}]`,
        `layout annotation for node "${annotation.node}" has no effectively layout-visible renderable`,
        'review-visibility',
      );
    }
  });

  const layoutFeatureIds = new Set(
    layoutAnnotations.flatMap(({ annotation }) => annotation.featureRefs ?? []),
  );
  document.authoring?.composition?.features.forEach((feature, index) => {
    if (!layoutFeatureIds.has(feature.id)) {
      return;
    }
    const hasLayoutRenderable = feature.nodeRefs.some((nodeId) => {
      const node = nodeById.get(nodeId);
      return node != null && subtreeHasLayoutRenderable(node, 'layout', true);
    });
    if (!hasLayoutRenderable) {
      addIssue(
        issues,
        `$.authoring.composition.features[${index}].nodeRefs`,
        `layout feature "${feature.id}" has no effectively layout-visible renderable`,
        'review-visibility',
      );
    }
  });
}

function validateCompositionPolicies(
  document: SceneDocument,
  composition: NonNullable<
    NonNullable<SceneDocument['authoring']>['composition']
  >,
  issues: ValidationIssue[],
) {
  const allowed = new Set(composition.representationPolicy.allowed);
  if (!allowed.has('prefab') && (document.resources.prefabs?.length ?? 0) > 0) {
    addIssue(
      issues,
      '$.resources.prefabs',
      'representationPolicy does not allow prefab resources',
      'policy',
    );
  }

  const validateNode = (node: SceneNode, path: string) => {
    const contentType = node.content?.type;
    if (contentType == null || contentType === 'group') {
      return;
    }
    const representation = contentType === 'instance' ? 'prefab' : contentType;
    if (!allowed.has(representation)) {
      addIssue(
        issues,
        `${path}.content.type`,
        `representationPolicy does not allow ${representation} content`,
        'policy',
      );
    }
  };
  walkNodes(document.nodes, '$.nodes', validateNode);
  document.resources.prefabs?.forEach((prefab, index) => {
    walkNodes(
      [prefab.root],
      `$.resources.prefabs[${index}].root`,
      validateNode,
    );
  });
}

function validateAcceptance(
  criterion: SceneFeatureAcceptance,
  path: string,
  document: SceneDocument,
  nodeIds: Set<string>,
  viewIds: Set<string>,
  referenceIds: Set<string>,
  issues: ValidationIssue[],
) {
  if ('nodeRefs' in criterion && criterion.nodeRefs != null) {
    validateNodeReferences(
      criterion.nodeRefs,
      `${path}.nodeRefs`,
      nodeIds,
      issues,
    );
  }
  if (
    'view' in criterion &&
    criterion.view != null &&
    !viewIds.has(criterion.view)
  ) {
    addIssue(
      issues,
      `${path}.view`,
      `unknown view "${criterion.view}"`,
      'reference',
    );
  }
  if (criterion.kind === 'count') {
    const limits = [
      criterion.equals,
      criterion.minimum,
      criterion.maximum,
    ].filter((entry) => entry != null);
    if (limits.length === 0) {
      addIssue(
        issues,
        path,
        'count criterion requires equals, minimum, or maximum',
        'required',
      );
    }
    if ((criterion.nodeRefs?.length ?? 0) === 0 && criterion.pattern == null) {
      addIssue(
        issues,
        path,
        'count criterion requires nodeRefs or pattern',
        'required',
      );
    }
    if (criterion.pattern != null) {
      const pattern = findNodeById(document.nodes, criterion.pattern);
      if (pattern?.content?.type !== 'pattern') {
        addIssue(
          issues,
          `${path}.pattern`,
          `unknown pattern node "${criterion.pattern}"`,
          'reference',
        );
      }
    }
    if (
      criterion.minimum != null &&
      criterion.maximum != null &&
      criterion.minimum > criterion.maximum
    ) {
      addIssue(issues, path, 'count minimum must not exceed maximum', 'range');
    }
    if (
      criterion.equals != null &&
      ((criterion.minimum != null && criterion.equals < criterion.minimum) ||
        (criterion.maximum != null && criterion.equals > criterion.maximum))
    ) {
      addIssue(
        issues,
        path,
        'count equals must satisfy minimum and maximum',
        'range',
      );
    }
  } else if (criterion.kind === 'projected-region') {
    if (!referenceIds.has(criterion.reference)) {
      addIssue(
        issues,
        `${path}.reference`,
        `unknown reference "${criterion.reference}"`,
        'reference',
      );
    }
    validateNormalizedRegion(criterion.region, `${path}.region`, issues);
  } else if (
    criterion.kind === 'spatial-relation' &&
    !nodeIds.has(criterion.target)
  ) {
    addIssue(
      issues,
      `${path}.target`,
      `unknown target node "${criterion.target}"`,
      'reference',
    );
  }
}

function acceptanceSubjectNodeReferences(
  criterion: SceneFeatureAcceptance,
): Array<{ nodeId: string; path: string }> {
  if (criterion.kind === 'count' && criterion.pattern != null) {
    return [{ nodeId: criterion.pattern, path: 'pattern' }];
  }
  if (!('nodeRefs' in criterion) || criterion.nodeRefs == null) {
    return [];
  }
  return criterion.nodeRefs.map((nodeId, index) => ({
    nodeId,
    path: `nodeRefs[${index}]`,
  }));
}

function validateObjectInspection(
  document: SceneDocument,
  feature: SceneFeature,
  featurePath: string,
  nodeIds: Set<string>,
  viewIds: Set<string>,
  reviewViewIds: Set<string>,
  issues: ValidationIssue[],
) {
  const inspection = feature.objectInspection;
  if (feature.identityCritical === true && inspection == null) {
    addIssue(
      issues,
      `${featurePath}.objectInspection`,
      'identity-critical feature must declare an object inspection spec',
      'required',
    );
    return;
  }
  if (inspection == null) {
    return;
  }
  if (feature.identityCritical !== true) {
    addIssue(
      issues,
      `${featurePath}.identityCritical`,
      'object inspection requires identityCritical to be true',
      'required',
    );
  }

  const validateInspectionSubjects = (refs: string[], path: string) => {
    validateNodeReferences(refs, path, nodeIds, issues);
    refs.forEach((nodeRef, index) => {
      if (
        nodeIds.has(nodeRef) &&
        !feature.nodeRefs.some(
          (binding) =>
            nodeIds.has(binding) &&
            isNodeSameOrDescendant(document.nodes, nodeRef, binding),
        )
      ) {
        addIssue(
          issues,
          `${path}[${index}]`,
          `inspection subject node "${nodeRef}" is outside feature "${feature.id}" node bindings`,
          'reference',
        );
      }
    });
  };

  const partIds = new Set<string>();
  inspection.parts.forEach((part, index) => {
    const partPath = `${featurePath}.objectInspection.parts[${index}]`;
    if (partIds.has(part.id)) {
      addIssue(
        issues,
        `${partPath}.id`,
        `duplicate inspection part id "${part.id}"`,
        'duplicate-id',
      );
    }
    partIds.add(part.id);
    validateInspectionSubjects(part.nodeRefs, `${partPath}.nodeRefs`);
  });

  const contactIds = new Set<string>();
  inspection.contacts.forEach((contact, index) => {
    const contactPath = `${featurePath}.objectInspection.contacts[${index}]`;
    if (contactIds.has(contact.id)) {
      addIssue(
        issues,
        `${contactPath}.id`,
        `duplicate inspection contact id "${contact.id}"`,
        'duplicate-id',
      );
    }
    contactIds.add(contact.id);
    validateInspectionSubjects(contact.nodeRefs, `${contactPath}.nodeRefs`);
    validateNodeReferences(
      contact.targetNodeRefs,
      `${contactPath}.targetNodeRefs`,
      nodeIds,
      issues,
    );
  });

  if (inspection.context.includeNodeRefs != null) {
    validateNodeReferences(
      inspection.context.includeNodeRefs,
      `${featurePath}.objectInspection.context.includeNodeRefs`,
      nodeIds,
      issues,
    );
  }
  inspection.requiredViews.forEach((viewId, index) => {
    const viewPath = `${featurePath}.objectInspection.requiredViews[${index}]`;
    if (!viewIds.has(viewId)) {
      addIssue(issues, viewPath, `unknown view "${viewId}"`, 'reference');
    } else if (!reviewViewIds.has(viewId)) {
      addIssue(
        issues,
        viewPath,
        `inspection view "${viewId}" is not required by composition review`,
        'required',
      );
    }
  });
}

function isNodeSameOrDescendant(
  nodes: SceneNode[],
  nodeId: string,
  possibleAncestorId: string,
) {
  const possibleAncestor = findNodeById(nodes, possibleAncestorId);
  return (
    possibleAncestor != null && findNodeById([possibleAncestor], nodeId) != null
  );
}

function validateNormalizedRegion(
  region: [number, number, number, number],
  path: string,
  issues: ValidationIssue[],
) {
  if (
    region.some((entry) => entry < 0 || entry > 1) ||
    region[0] + region[2] > 1 ||
    region[1] + region[3] > 1
  ) {
    addIssue(
      issues,
      path,
      'region must fit within normalized image coordinates',
      'range',
    );
  }
}

function validateReviewSemantics(
  review: SceneReview,
  issues: ValidationIssue[],
) {
  if (review.round === 0 && review.previousReview != null) {
    addIssue(
      issues,
      '$.previousReview',
      'initial review round 0 cannot declare prior review lineage',
      'state',
    );
  }
  const lensIds = new Set<string>();
  const captureIds = new Set<string>();
  review.lenses.forEach((lens, lensIndex) => {
    if (lensIds.has(lens.id)) {
      addIssue(
        issues,
        `$.lenses[${lensIndex}].id`,
        `duplicate lens id "${lens.id}"`,
        'duplicate-id',
      );
    }
    lensIds.add(lens.id);
    lens.captures.forEach((capture, captureIndex) => {
      const path = `$.lenses[${lensIndex}].captures[${captureIndex}]`;
      if (captureIds.has(capture.id)) {
        addIssue(
          issues,
          `${path}.id`,
          `duplicate capture id "${capture.id}"`,
          'duplicate-id',
        );
      }
      captureIds.add(capture.id);
      if (
        capture.camera.projection === 'perspective' &&
        capture.camera.fov == null
      ) {
        addIssue(
          issues,
          `${path}.camera.fov`,
          'perspective camera requires fov',
          'required',
        );
      }
      if (
        capture.camera.projection === 'orthographic' &&
        capture.camera.height == null
      ) {
        addIssue(
          issues,
          `${path}.camera.height`,
          'orthographic camera requires height',
          'required',
        );
      }
    });
  });
  const results = new Map<string, string>();
  review.featureResults.forEach((result, index) => {
    const path = `$.featureResults[${index}]`;
    const key = `${result.feature}\u0000${result.criterion}`;
    if (results.has(key)) {
      addIssue(
        issues,
        path,
        'feature criterion result is duplicated',
        'duplicate-id',
      );
    }
    results.set(key, result.status);
    result.evidenceRefs.forEach((reference, evidenceIndex) => {
      if (!captureIds.has(reference)) {
        addIssue(
          issues,
          `${path}.evidenceRefs[${evidenceIndex}]`,
          `unknown capture "${reference}"`,
          'reference',
        );
      }
    });
  });
  const waived = new Set<string>();
  review.waivers.forEach((waiver, index) => {
    const key = `${waiver.feature}\u0000${waiver.criterion}`;
    const status = results.get(key);
    if (status == null) {
      addIssue(
        issues,
        `$.waivers[${index}]`,
        'waiver does not name a feature result',
        'reference',
      );
    } else if (status === 'pass') {
      addIssue(
        issues,
        `$.waivers[${index}]`,
        'passing criterion cannot be waived',
        'state',
      );
    }
    waived.add(key);
  });
  if (review.result === 'pass') {
    if (
      review.lenses.some((lens) => lens.status !== 'pass') ||
      review.featureResults.some((result) => result.status !== 'pass')
    ) {
      addIssue(
        issues,
        '$.result',
        'pass requires every lens and feature criterion to pass',
        'state',
      );
    }
    if (review.waivers.length > 0) {
      addIssue(issues, '$.waivers', 'pass cannot include waivers', 'state');
    }
  } else if (review.result === 'accepted-with-gaps') {
    review.featureResults.forEach((result) => {
      const key = `${result.feature}\u0000${result.criterion}`;
      if (result.status !== 'pass' && !waived.has(key)) {
        addIssue(
          issues,
          '$.waivers',
          `non-passing criterion "${result.criterion}" requires a waiver`,
          'state',
        );
      }
    });
  }
  if (review.stop.reason === 'success' && review.result === 'fail') {
    addIssue(
      issues,
      '$.stop.reason',
      'failed review cannot stop for success',
      'state',
    );
  }
  if (review.stop.reason === 'continue-refining' && review.result !== 'fail') {
    addIssue(
      issues,
      '$.stop.reason',
      'continue-refining is valid only for a failed review',
      'state',
    );
  }
}

function validatePatternExpansion(
  distribution: ScenePatternDistribution,
  path: string,
  issues: ValidationIssue[],
) {
  const count = getScenePatternRequestedCount(distribution);
  if (count > MAX_SCENE_PATTERN_EXPANSION) {
    addIssue(
      issues,
      path,
      `pattern expands to ${count} instances; maximum is ${MAX_SCENE_PATTERN_EXPANSION}`,
      'limit',
    );
  }
  validateCoordinatesInValue(distribution, path, issues);
}

function validateTransformCoordinates(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
) {
  if (value != null) {
    validateCoordinatesInValue(value, path, issues);
  }
}

function validateCoordinatesInValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
) {
  const visit = (entry: unknown, entryPath: string) => {
    if (isFiniteNumber(entry)) {
      if (Math.abs(entry) > MAX_SCENE_COORDINATE) {
        addIssue(
          issues,
          entryPath,
          `absolute value exceeds ${MAX_SCENE_COORDINATE}`,
          'limit',
        );
      }
    } else if (Array.isArray(entry)) {
      entry.forEach((child, index) => visit(child, `${entryPath}[${index}]`));
    } else if (isPlainObject(entry)) {
      Object.entries(entry).forEach(([key, child]) =>
        visit(child, childPath(entryPath, key)),
      );
    }
  };
  visit(value, path);
}

function validatePrefabOverrides(
  overrides: Record<string, ScenePrefabNodeOverride> | undefined,
  prefabId: string,
  nodePath: string,
  prefabNodeIds: Map<string, Set<string>>,
  schemas: Map<string, SceneComponentSchema>,
  validateComponentFields: boolean,
  issues: ValidationIssue[],
) {
  if (overrides == null) {
    return;
  }
  for (const [nodeId, override] of Object.entries(overrides)) {
    if (!prefabNodeIds.get(prefabId)?.has(nodeId)) {
      addIssue(
        issues,
        `${nodePath}.content.overrides[${JSON.stringify(nodeId)}]`,
        `unknown node "${nodeId}" in prefab "${prefabId}"`,
        'reference',
      );
    }
    validateComponents(
      override.components,
      `${nodePath}.content.overrides[${JSON.stringify(nodeId)}].components`,
      schemas,
      validateComponentFields,
      issues,
    );
  }
}

function validateComponentCatalog(
  catalog: SceneComponentCatalog | undefined,
  issues: ValidationIssue[],
) {
  const byId = new Map<string, SceneComponentSchema>();
  Object.entries(catalog ?? {}).forEach(([catalogId, schema]) => {
    const schemaPath = `$componentCatalog[${JSON.stringify(catalogId)}]`;
    if (catalogId !== schema.id) {
      addIssue(
        issues,
        `${schemaPath}.id`,
        `catalog key must match component schema id "${schema.id}"`,
        'reference',
      );
    }
    byId.set(schema.id, schema);
    Object.entries(schema.fields).forEach(([name, field]) => {
      const fieldPath = `${schemaPath}.fields[${JSON.stringify(name)}]`;
      if (field.min != null && field.max != null && field.min > field.max) {
        addIssue(issues, fieldPath, 'field min must not exceed max', 'range');
      }
      if (
        field.default !== undefined &&
        !matchesComponentField(field.default, field)
      ) {
        addIssue(
          issues,
          `${fieldPath}.default`,
          `default does not match ${field.type}`,
          'type',
        );
      }
      if (field.type === 'Enum' && field.enum == null) {
        addIssue(
          issues,
          `${fieldPath}.enum`,
          'Enum field requires enum values',
          'required',
        );
      }
    });
  });
  return byId;
}

function validateComponents(
  components: Record<string, unknown> | undefined,
  path: string,
  schemas: Map<string, SceneComponentSchema>,
  validateComponentFields: boolean,
  issues: ValidationIssue[],
) {
  if (components == null) {
    return;
  }
  for (const [name, value] of Object.entries(components)) {
    const componentPath = childPath(path, name);
    if (!isPlainObject(value) || !isJsonValue(value)) {
      addIssue(
        issues,
        componentPath,
        'component payload must be a JSON object',
        'type',
      );
      continue;
    }
    if (!validateComponentFields) {
      continue;
    }
    const componentId = stripComponentPrefix(name);
    const schema = schemas.get(componentId) ?? schemas.get(name);
    if (schema == null) {
      addIssue(
        issues,
        componentPath,
        `component "${componentId}" is not present in the active component catalog`,
        'reference',
      );
      continue;
    }
    for (const [fieldName, fieldValue] of Object.entries(value)) {
      const field = schema.fields[fieldName];
      if (field == null) {
        addIssue(
          issues,
          childPath(componentPath, fieldName),
          'component field is not declared',
          'property',
        );
      } else if (!matchesComponentField(fieldValue, field)) {
        addIssue(
          issues,
          childPath(componentPath, fieldName),
          `value does not match ${field.type}`,
          'type',
        );
      }
    }
    if (['ContactShadow', 'ShadowCatcher'].includes(componentId)) {
      const size = value.size ?? schema.fields.size?.default;
      if (isVec2(size) && (size[0] <= 0 || size[1] <= 0)) {
        addIssue(
          issues,
          childPath(componentPath, 'size'),
          'size must be positive',
          'range',
        );
      }
    }
    if (['DirectionalLight', 'PointLight', 'SpotLight'].includes(componentId)) {
      const near =
        value.shadowCameraNear ?? schema.fields.shadowCameraNear?.default;
      const far =
        value.shadowCameraFar ?? schema.fields.shadowCameraFar?.default;
      if (isFiniteNumber(near) && isFiniteNumber(far) && near >= far) {
        addIssue(
          issues,
          componentPath,
          'shadow camera near must be less than shadow camera far',
          'range',
        );
      }
    }
    if (componentId === 'DomeFade') {
      const start = value.start ?? schema.fields.start?.default;
      const end = value.end ?? schema.fields.end?.default;
      if (isFiniteNumber(start) && isFiniteNumber(end) && start >= end) {
        addIssue(
          issues,
          componentPath,
          'fade start must be less than fade end',
          'range',
        );
      }
    }
  }
}

function validateRootComponents(
  components: Record<string, unknown> | undefined,
  issues: ValidationIssue[],
) {
  const intrinsic = new Set(['LevelRoot', 'LevelTag', 'Transform']);
  for (const name of Object.keys(components ?? {})) {
    if (intrinsic.has(stripComponentPrefix(name))) {
      addIssue(
        issues,
        childPath('$.components', name),
        `component "${name}" is owned by the runtime level root`,
        'conflict',
      );
    }
  }
}

function validatePlayerComponents(
  document: SceneDocument,
  schemas: Map<string, SceneComponentSchema>,
  validateComponentFields: boolean,
  issues: ValidationIssue[],
) {
  const targets = [
    ['player', document.player],
    ['camera', document.player?.camera],
    ['head', document.player?.head],
    ['leftTargetRay', document.player?.leftTargetRay],
    ['rightTargetRay', document.player?.rightTargetRay],
    ['leftGrip', document.player?.leftGrip],
    ['rightGrip', document.player?.rightGrip],
  ] as const;
  const intrinsic = new Set(['LevelRoot', 'LevelTag', 'Transform']);
  for (const [target, descriptor] of targets) {
    const descriptorPath =
      target === 'player' ? '$.player' : `$.player.${target}`;
    const path = `${descriptorPath}.components`;
    validateTransformCoordinates(
      descriptor?.transform,
      `${descriptorPath}.transform`,
      issues,
    );
    validateComponents(
      descriptor?.components,
      path,
      schemas,
      validateComponentFields,
      issues,
    );
    for (const name of Object.keys(descriptor?.components ?? {})) {
      if (intrinsic.has(stripComponentPrefix(name))) {
        addIssue(
          issues,
          childPath(path, name),
          `component "${name}" is owned by the runtime player rig`,
          'conflict',
        );
      }
    }
  }
}

function matchesComponentField(
  value: unknown,
  field: SceneComponentFieldSchema,
) {
  let matches: boolean;
  switch (field.type) {
    case 'Int8':
    case 'Int16':
    case 'Int32':
      matches = Number.isInteger(value);
      break;
    case 'Entity':
      matches =
        value === null ||
        Number.isInteger(value) ||
        isSceneEntityReference(value);
      break;
    case 'Float32':
    case 'Float64':
      matches = isFiniteNumber(value);
      break;
    case 'Boolean':
      matches = typeof value === 'boolean';
      break;
    case 'String':
    case 'FilePath':
      matches = typeof value === 'string';
      break;
    case 'Object':
      matches = isJsonValue(value);
      break;
    case 'Vec2':
      matches = isVec2(value);
      break;
    case 'Vec3':
      matches = isVec3(value);
      break;
    case 'Vec4':
      matches =
        Array.isArray(value) &&
        value.length === 4 &&
        value.every(isFiniteNumber);
      break;
    case 'Color':
      matches =
        Array.isArray(value) &&
        value.length === 4 &&
        value.every(
          (entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1,
        );
      break;
    case 'Enum':
      matches =
        typeof value === 'string' &&
        (field.enum == null || Object.values(field.enum).includes(value));
      break;
  }
  if (matches && isFiniteNumber(value)) {
    matches =
      (field.min == null || value >= field.min) &&
      (field.max == null || value <= field.max);
  }
  return matches;
}

function validateComponentLinks(
  document: SceneDocument,
  schemas: Map<string, SceneComponentSchema>,
  nodeIds: Set<string>,
  issues: ValidationIssue[],
) {
  validateComponentLinkMap(
    document.components,
    '$.components',
    schemas,
    nodeIds,
    issues,
  );
  const playerTargets = [
    ['player', document.player],
    ['camera', document.player?.camera],
    ['head', document.player?.head],
    ['leftTargetRay', document.player?.leftTargetRay],
    ['rightTargetRay', document.player?.rightTargetRay],
    ['leftGrip', document.player?.leftGrip],
    ['rightGrip', document.player?.rightGrip],
  ] as const;
  for (const [target, descriptor] of playerTargets) {
    const descriptorPath =
      target === 'player' ? '$.player' : `$.player.${target}`;
    validateComponentLinkMap(
      descriptor?.components,
      `${descriptorPath}.components`,
      schemas,
      nodeIds,
      issues,
    );
  }
  const visit = (nodes: SceneNode[], path: string) => {
    nodes.forEach((node, index) => {
      const nodePath =
        nodes.length === 1 && path.endsWith('.root')
          ? path
          : `${path}[${index}]`;
      validateComponentLinkMap(
        node.components,
        `${nodePath}.components`,
        schemas,
        nodeIds,
        issues,
      );
      visit(node.children ?? [], `${nodePath}.children`);
    });
  };
  visit(document.nodes, '$.nodes');
}

function validateComponentLinkMap(
  components: Record<string, unknown> | undefined,
  path: string,
  schemas: Map<string, SceneComponentSchema>,
  nodeIds: Set<string>,
  issues: ValidationIssue[],
) {
  for (const [name, payload] of Object.entries(components ?? {})) {
    if (!isPlainObject(payload)) {
      continue;
    }
    const schema = schemas.get(stripComponentPrefix(name)) ?? schemas.get(name);
    if (schema == null) {
      continue;
    }
    const componentPath = childPath(path, name);
    for (const [fieldName, field] of Object.entries(schema.fields)) {
      if (field.hidden === true) {
        continue;
      }
      const fieldPath = childPath(componentPath, fieldName);
      const value = payload[fieldName] ?? field.default;
      if (
        field.type === 'FilePath' &&
        (typeof value !== 'string' || value.trim().length === 0)
      ) {
        addIssue(issues, fieldPath, 'file path is not selected', 'required');
        continue;
      }
      const isEntityField =
        field.type === 'Entity' || field.widget === 'entity';
      if (!isEntityField) {
        if (field.required === true && (value == null || value === '')) {
          addIssue(issues, fieldPath, 'field is required', 'required');
        }
        continue;
      }
      if (value == null) {
        if (field.required === true) {
          addIssue(
            issues,
            fieldPath,
            'entity reference is not linked',
            'required',
          );
        }
        continue;
      }
      if (isSceneNodeReference(value) && !nodeIds.has(value.id)) {
        addIssue(
          issues,
          fieldPath,
          `referenced scene entity "${value.id}" does not exist`,
          'reference',
        );
      } else if (!Number.isInteger(value) && !isSceneEntityReference(value)) {
        addIssue(
          issues,
          fieldPath,
          'value is not a scene entity reference',
          'type',
        );
      }
    }
  }
}

function isSceneNodeReference(
  value: unknown,
): value is { type: 'node'; id: string } {
  return (
    isPlainObject(value) &&
    value.type === 'node' &&
    typeof value.id === 'string' &&
    value.id.length > 0
  );
}

function isSceneEntityReference(value: unknown) {
  return (
    isSceneNodeReference(value) ||
    (isPlainObject(value) &&
      value.type === 'level-root' &&
      Object.keys(value).length === 1) ||
    (isPlainObject(value) &&
      value.type === 'player-space' &&
      [
        'player',
        'camera',
        'head',
        'left-target-ray',
        'right-target-ray',
        'left-grip',
        'right-grip',
      ].includes(String(value.target)))
  );
}

function stripComponentPrefix(name: string) {
  const prefix = 'com.iwsdk.components.';
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function validateSafeUri(uri: string, path: string, issues: ValidationIssue[]) {
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(uri)?.[1]?.toLowerCase();
  if (scheme != null && scheme !== 'http' && scheme !== 'https') {
    addIssue(
      issues,
      path,
      `URI scheme "${scheme}" is not allowed`,
      'unsafe-uri',
    );
  }
}

function validateMetadataNamespaces(
  metadata: Record<string, unknown> | undefined,
  path: string,
  issues: ValidationIssue[],
) {
  if (metadata == null) {
    return;
  }
  for (const key of Object.keys(metadata)) {
    if (!/^[^.:/]+[.:/].+$/u.test(key)) {
      addIssue(
        issues,
        childPath(path, key),
        'metadata extension key must be namespaced',
        'namespace',
      );
    }
  }
}

function validateNodeReferences(
  refs: string[],
  path: string,
  ids: Set<string>,
  issues: ValidationIssue[],
) {
  refs.forEach((reference, index) => {
    if (!ids.has(reference)) {
      addIssue(
        issues,
        `${path}[${index}]`,
        `unknown node "${reference}"`,
        'reference',
      );
    }
  });
}

function walkNodes(
  nodes: SceneNode[],
  path: string,
  visitor: (node: SceneNode, path: string) => void,
) {
  nodes.forEach((node, index) => {
    const nodePath =
      nodes.length === 1 && path.endsWith('.root') ? path : `${path}[${index}]`;
    visitor(node, nodePath);
    walkNodes(node.children ?? [], `${nodePath}.children`, visitor);
  });
}

function findNodeById(nodes: SceneNode[], id: string): SceneNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const nested = findNodeById(node.children ?? [], id);
    if (nested != null) {
      return nested;
    }
  }
  return undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function addIssue(
  issues: ValidationIssue[],
  path: string,
  message: string,
  code: string,
) {
  issues.push({ path, message, code });
}
