/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { parse, stringify } from 'yaml';

const BASE_OVERRIDES = {
  sharp: '0.35.4',
  three: 'npm:super-three@0.185.0',
} as const;

const ONLY_BUILT_DEPENDENCIES = ['esbuild', 'protobufjs', 'sharp'] as const;
const IGNORED_BUILT_DEPENDENCIES = ['@meta-quest/metavr'] as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function readStringRecord(
  value: unknown,
  field: string,
): Record<string, string> {
  if (value == null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`pnpm-workspace.yaml ${field} must be a mapping.`);
  }
  const entries = Object.entries(value);
  for (const [key, entry] of entries) {
    if (typeof entry !== 'string') {
      throw new Error(`pnpm-workspace.yaml ${field}.${key} must be a string.`);
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/** Build the pnpm 10/11 policy used by every generated application. */
export function createPnpmWorkspaceYaml(): string {
  return mergePnpmWorkspaceYaml('', {});
}

/**
 * Merge bundle tarball resolutions into the generated pnpm workspace policy.
 * Parsing and serializing the document prevents package names from becoming
 * YAML syntax, and sorting overrides makes repeated bundle configuration
 * byte-for-byte deterministic.
 */
export function mergePnpmWorkspaceYaml(
  existingYaml: string,
  packageSpecs: Readonly<Record<string, string>>,
): string {
  const parsed = existingYaml.trim() === '' ? {} : parse(existingYaml);
  if (!isRecord(parsed)) {
    throw new Error('pnpm-workspace.yaml must contain a mapping.');
  }

  const {
    packages: _packages,
    overrides: existingOverrides,
    onlyBuiltDependencies: _onlyBuiltDependencies,
    ignoredBuiltDependencies: _ignoredBuiltDependencies,
    allowBuilds: _allowBuilds,
    ...otherConfiguration
  } = parsed;
  const overrides = sortedRecord({
    ...readStringRecord(existingOverrides, 'overrides'),
    ...BASE_OVERRIDES,
    ...packageSpecs,
  });

  return stringify(
    {
      packages: ['.'],
      overrides,
      // pnpm 10 reads these two lists.
      onlyBuiltDependencies: [...ONLY_BUILT_DEPENDENCIES],
      ignoredBuiltDependencies: [...IGNORED_BUILT_DEPENDENCIES],
      // pnpm 11 replaced the two lists with one explicit decision map.
      allowBuilds: {
        esbuild: true,
        protobufjs: true,
        sharp: true,
        '@meta-quest/metavr': false,
      },
      ...sortedRecord(otherConfiguration),
    },
    { lineWidth: 0 },
  );
}
