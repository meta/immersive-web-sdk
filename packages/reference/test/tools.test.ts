/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { findDependents, listEcsSystems } from '../src/tools.js';
import type { Chunk } from '../src/types.js';

function makeChunk(
  name: string,
  content: string,
  overrides: Partial<Chunk['metadata']> = {},
): Chunk {
  return {
    id: name,
    content,
    metadata: {
      source: 'iwsdk',
      file_path: `examples/${name}.ts`,
      chunk_type: 'const',
      name,
      start_line: 1,
      end_line: 20,
      imports: [],
      calls: [],
      extends: [],
      implements: [],
      ...overrides,
    },
  };
}

describe('tool ranking', () => {
  it('prioritizes chunks that directly mention the dependent API', async () => {
    const searchService = {
      getAllChunks() {
        return [
          makeChunk('assets', 'const assets = {};', {
            imports: ['import { AudioSource } from "./audio.js";'],
            file_path: 'examples/assets.ts',
          }),
          makeChunk(
            'settingsPanel',
            'entity.addComponent(AudioSource, { src: "audio/switch.mp3" });',
            {
              imports: ['import { AudioSource } from "./audio.js";'],
              chunk_type: 'function',
              file_path: 'examples/settings.ts',
            },
          ),
        ];
      },
    } as any;

    const result = await findDependents(searchService, {
      api_name: 'AudioSource',
      dependency_type: 'any',
      limit: 1,
    });

    expect(result.isError).not.toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('## settingsPanel');
    expect(text).not.toContain('## assets');
  });

  it('prioritizes core ECS systems over Create template systems', async () => {
    const searchService = {
      getAllChunks() {
        return [
          makeChunk('RobotSystem', 'export class RobotSystem {}', {
            chunk_type: 'system',
            ecs_system: true,
            file_path: 'packages/create/template/common/src/robot.ts',
          }),
          makeChunk('LevelSystem', 'export class LevelSystem {}', {
            chunk_type: 'system',
            ecs_system: true,
            file_path: 'packages/core/src/level/level-system.ts',
          }),
          makeChunk('TeleportSystem', 'export class TeleportSystem {}', {
            chunk_type: 'system',
            ecs_system: true,
            file_path: 'packages/core/src/locomotion/teleport.ts',
          }),
        ];
      },
    } as any;

    const result = await listEcsSystems(searchService, { limit: 2 });
    expect(result.isError).not.toBe(true);

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('## LevelSystem');
    expect(text).toContain('## TeleportSystem');
    expect(text).not.toContain('## RobotSystem');
  });
});
