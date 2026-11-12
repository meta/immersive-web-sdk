/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAllowedContentPath,
  isIntentionalMigrationReference,
} from './check-native-scene-release-artifacts.mjs';

test('allows exact built migration documentation artifacts', () => {
  assert.equal(
    isAllowedContentPath(
      'docs',
      'docs/.vitepress/dist/public/skills/iwsdk-migrate-0-5/SKILL.html',
    ),
    true,
  );
  assert.equal(
    isAllowedContentPath(
      'docs',
      'docs/.vitepress/dist/skills/iwsdk-migrate-0-5/SKILL.md',
    ),
    true,
  );
  assert.equal(
    isAllowedContentPath(
      'docs',
      'docs/.vitepress/dist/assets/public_skills_iwsdk-migrate-0-5_SKILL.md.hash.lean.js',
    ),
    true,
  );
  assert.equal(
    isAllowedContentPath(
      'docs',
      'docs/.vitepress/dist/public/skills/iwsdk-ui/SKILL.html',
    ),
    false,
  );
});

test('allows retired-surface names only in exact packaged migration resources', () => {
  assert.equal(
    isIntentionalMigrationReference(
      'tarball',
      'package/dist/guidance/files/.claude/skills/iwsdk-migrate-0-5/SKILL.md',
      '@iwsdk/vite-plugin-metaspatial',
    ),
    true,
  );
  assert.equal(
    isIntentionalMigrationReference(
      'tarball',
      'package/dist/agent-guidance/files/.agents/skills/iwsdk-migrate-0-5/SKILL.md',
      'Meta Spatial Editor',
    ),
    true,
  );
  assert.equal(
    isIntentionalMigrationReference(
      'tarball',
      'package/dist/guidance/files/CLAUDE.md',
      '- Replacing GLXF or Meta Spatial Editor with native IWSDK scenes',
    ),
    true,
  );

  assert.equal(
    isIntentionalMigrationReference(
      'tarball',
      'package/dist/guidance/files/CLAUDE.md',
      'Install @iwsdk/vite-plugin-metaspatial',
    ),
    false,
  );
  assert.equal(
    isIntentionalMigrationReference(
      'tarball',
      'package/dist/guidance/files/.claude/skills/iwsdk-ui/SKILL.md',
      'Use Meta Spatial Editor',
    ),
    false,
  );
  assert.equal(
    isIntentionalMigrationReference(
      'docs',
      'package/dist/guidance/files/.claude/skills/iwsdk-migrate-0-5/SKILL.md',
      'Meta Spatial Editor',
    ),
    false,
  );
});
