/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * File service for reading source files
 */

import path from 'path';
import { loadReferenceCorpus } from './corpus.js';

export class FileService {
  /**
   * Find a file by searching across all source directories
   */
  private normalizeDependencyPath(relativePath: string): string[] {
    const trimmed = relativePath.replace(/^\/+/, '').replace(/^deps\/+/, '');
    const normalized = trimmed.replace(/\\/g, '/');
    const searchPaths: string[] = [];

    const candidates = [normalized];
    if (normalized.includes('/node_modules/')) {
      candidates.push(normalized.split('/node_modules/').pop() ?? normalized);
    }

    const packagePrefixes = [
      '@types/three/',
      '@types/webxr/',
      '@pmndrs/pointer-events/',
      '@pmndrs/uikit/',
      '@drawcall/uikitml/',
      '@preact/signals-core/',
      '@babylonjs/havok/',
      'elics/',
    ];

    for (const candidate of candidates) {
      for (const prefix of packagePrefixes) {
        const index = candidate.indexOf(prefix);
        if (index !== -1) {
          searchPaths.push(candidate.slice(index));
        }
      }
    }

    if (!searchPaths.includes(normalized)) {
      searchPaths.push(normalized);
    }

    return Array.from(new Set(searchPaths));
  }

  private async findFile(
    relativePath: string,
    source: string,
  ): Promise<string | null> {
    const { files } = loadReferenceCorpus();
    const keys: string[] = [];

    if (source === 'iwsdk') {
      keys.push(path.posix.join('iwsdk', relativePath.replace(/\\/g, '/')));
    } else if (source === 'deps') {
      for (const candidate of this.normalizeDependencyPath(relativePath)) {
        keys.push(path.posix.join('deps', candidate));
      }
    }

    return (
      keys.find((key) => Object.prototype.hasOwnProperty.call(files, key)) ??
      null
    );
  }

  /**
   * Read a file with optional line range
   */
  async readFile(
    relativePath: string,
    source: string,
    options?: {
      startLine?: number;
      endLine?: number;
    },
  ): Promise<string | null> {
    const key = await this.findFile(relativePath, source);
    if (!key) {
      return null;
    }

    const content = loadReferenceCorpus().files[key];
    if (options?.startLine !== undefined || options?.endLine !== undefined) {
      const lines = content.split('\n');
      const start = (options.startLine ?? 1) - 1; // Convert to 0-indexed
      const end = options.endLine ?? lines.length;
      return lines.slice(start, end).join('\n');
    }

    return content;
  }

  /**
   * Check if a file exists
   */
  async fileExists(relativePath: string, source: string): Promise<boolean> {
    return (await this.findFile(relativePath, source)) !== null;
  }
}
