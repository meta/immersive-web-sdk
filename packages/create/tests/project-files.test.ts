/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSceneDocument } from '@iwsdk/scene-composition';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { getRecommendedConfiguration } from '../src/catalog.js';
import { buildStarterProjectFiles } from '../src/project-files.js';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const TEMPLATE_ROOT = path.join(PACKAGE_ROOT, 'dist', 'template');
const npmSource = { getPackageInstallSpec: () => undefined };

async function listUIKitMLFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listUIKitMLFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.uikitml')) {
      files.push(entryPath);
    }
  }
  return files;
}

describe('common starter project files', () => {
  it('uses byte-identical TypeScript application source for every target', async () => {
    const outputs = await Promise.all(
      (['vr', 'ar', 'browser'] as const).map((target) =>
        buildStarterProjectFiles({
          appName: 'starter-app',
          configuration: getRecommendedConfiguration(target),
          language: 'ts',
          packageSource: npmSource,
          templateRoot: TEMPLATE_ROOT,
        }),
      ),
    );
    const expectedSourcePaths = [
      'src/AGENTS.md',
      'src/assets.ts',
      'src/components.ts',
      'src/index.ts',
      'src/panel.ts',
      'src/robot-component.ts',
      'src/robot.ts',
      'src/vite-env.d.ts',
    ];
    for (const files of outputs) {
      expect(
        files
          .map((file) => file.path)
          .filter((filePath) => filePath.startsWith('src/')),
      ).toEqual(expectedSourcePaths);
    }
    const commonPaths = [
      ...expectedSourcePaths,
      'vite.config.ts',
      'public/ui/welcome.uikitml',
    ];
    for (const filePath of commonPaths) {
      const [first, ...rest] = outputs.map((files) =>
        textFile(files, filePath),
      );
      expect(rest).toEqual([first, first]);
      expect(first).not.toMatch(/@template:|@chef:|@session-mode/u);
    }

    expect(outputs[0].some((file) => file.path.includes('mouselook'))).toBe(
      false,
    );

    expect(textFile(outputs[0], 'iwsdk.config.json')).toContain('"mode": "vr"');
    expect(textFile(outputs[1], 'iwsdk.config.json')).toContain('"mode": "ar"');
    expect(textFile(outputs[2], 'iwsdk.config.json')).toContain('"xr": false');
    expect(
      JSON.parse(textFile(outputs[0], 'iwsdk.config.json')).world.features
        .spatialUI,
    ).toEqual({ kit: 'horizon' });
    expect(textFile(outputs[0], 'vite.config.ts')).toContain('iwsdkDev()');
    expect(textFile(outputs[0], 'vite.config.ts')).toContain('dedupe:');
    expect(textFile(outputs[0], 'vite.config.ts')).toContain('@pmndrs/uikit');
    expect(textFile(outputs[0], 'vite.config.ts')).toContain(
      '@drawcall/uikitml',
    );
    const viteConfig = textFile(outputs[0], 'vite.config.ts');
    expect(viteConfig).toContain("include: [\n      'three',");
    expect(viteConfig.match(/^[ \t]*'three',$/gmu)).toHaveLength(2);
    expect(textFile(outputs[0], 'src/assets.ts')).toContain(
      'VITE_IWSDK_EXAMPLE_ASSET_BASE_URL',
    );
    expect(textFile(outputs[0], 'src/assets.ts')).toContain(
      'https://cdn.jsdelivr.net/npm/@iwsdk/example-assets@0.4.2/assets',
    );
    expect(textFile(outputs[0], 'src/assets.ts')).toContain(
      'import.meta.env.BASE_URL',
    );
    expect(textFile(outputs[0], 'src/assets.ts')).not.toContain(
      "url: '/iwsdk-assets/",
    );
  });

  it('demonstrates the bundled Horizon kit and Lucide icons without network fonts', async () => {
    const files = await buildStarterProjectFiles({
      appName: 'uikit-app',
      configuration: getRecommendedConfiguration('vr'),
      language: 'ts',
      packageSource: npmSource,
      templateRoot: TEMPLATE_ROOT,
    });
    const panel = textFile(files, 'public/ui/welcome.uikitml');

    expect(panel).not.toContain('@font-face');
    expect(panel).not.toContain('font-family: "DM Sans"');
    expect(panel).not.toContain('fonts.gstatic.com');
    expect(panel).toContain('<Panel class="panel-root">');
    expect(panel).toContain('<Button id="xr-button"');
    expect(panel).toContain('<RectangleGoggles>');
    expect(panel).toContain('<LogIn>');
  });

  it('keeps canonical UIKitML panels free of network-required fonts', async () => {
    const panels = await listUIKitMLFiles(
      path.join(REPOSITORY_ROOT, 'examples'),
    );
    expect(panels.length).toBeGreaterThan(0);
    for (const panelPath of panels) {
      const panel = await readFile(panelPath, 'utf8');
      expect(panel).not.toContain('fonts.gstatic.com');
    }
  });

  it('uses build-time mechanical JavaScript output with no TypeScript files', async () => {
    const files = await buildStarterProjectFiles({
      appName: 'starter-js',
      configuration: getRecommendedConfiguration('vr'),
      language: 'js',
      packageSource: npmSource,
      templateRoot: TEMPLATE_ROOT,
    });

    expect(files.some((file) => file.path.endsWith('.ts'))).toBe(false);
    expect(textFile(files, 'src/index.js')).not.toContain('as HTMLDivElement');
    expect(textFile(files, 'index.html')).toContain('/src/index.js');
    expect(files.some((file) => file.path === 'tsconfig.json')).toBe(false);
  });

  it('generates package metadata and package-safe dotfiles locally', async () => {
    const files = await buildStarterProjectFiles({
      appName: 'thin-app',
      configuration: getRecommendedConfiguration('browser'),
      language: 'ts',
      packageSource: npmSource,
      templateRoot: TEMPLATE_ROOT,
    });
    const packageJson = JSON.parse(textFile(files, 'package.json'));
    const pnpmWorkspaceYaml = textFile(files, 'pnpm-workspace.yaml');
    const pnpmWorkspace = parse(pnpmWorkspaceYaml);

    expect(files.some((file) => file.path === '.gitignore')).toBe(true);
    expect(files.some((file) => file.path === '.nvmrc')).toBe(true);
    expect(packageJson.dependencies['@iwsdk/core']).toMatch(/^\d+\.\d+\.\d+/u);
    expect(packageJson.dependencies['@pmndrs/uikit']).toBe('^1.0.74');
    expect(packageJson.dependencies['@pmndrs/uikit-horizon']).toBe('^1.0.74');
    expect(packageJson.dependencies['@pmndrs/uikit-lucide']).toBe('^1.0.74');
    expect(packageJson.dependencies.three).toBe('npm:super-three@0.185.0');
    expect(
      packageJson.devDependencies['@iwsdk/example-assets'],
    ).toBeUndefined();
    expect(packageJson.devDependencies['@meta-quest/metavr']).toBe('^1.8.1');
    expect(packageJson.devDependencies['@meta-quest/hzdb']).toBeUndefined();
    expect(packageJson.devDependencies['@types/three']).toBe('^0.185.0');
    expect(packageJson.overrides).toEqual({
      sharp: '0.35.4',
      three: 'npm:super-three@0.185.0',
    });
    expect(pnpmWorkspace).toEqual({
      packages: ['.'],
      overrides: {
        sharp: '0.35.4',
        three: 'npm:super-three@0.185.0',
      },
      onlyBuiltDependencies: ['esbuild', 'protobufjs', 'sharp'],
      ignoredBuiltDependencies: ['@meta-quest/metavr', 'onnxruntime-node'],
      allowBuilds: {
        esbuild: true,
        protobufjs: true,
        sharp: true,
        '@meta-quest/metavr': false,
        'onnxruntime-node': false,
      },
    });
    expect(packageJson.scripts.typecheck).toBe('tsc --noEmit');
    expect(JSON.stringify(packageJson)).not.toContain('@latest');
    expect(JSON.stringify(packageJson)).not.toContain('@pmndrs/chef');
  });

  it.each(['vr', 'ar', 'browser'] as const)(
    'emits a structurally valid %s scene whose assets exist in the common catalog',
    async (target) => {
      const files = await buildStarterProjectFiles({
        appName: 'scene-app',
        configuration: getRecommendedConfiguration(target),
        language: 'ts',
        packageSource: npmSource,
        templateRoot: TEMPLATE_ROOT,
      });
      const scene = JSON.parse(
        textFile(files, 'public/scenes/main.iwsdk.scene.json'),
      );

      expect(scene.player).toBeUndefined();

      expect(
        validateSceneDocument(scene, {
          knownAssetIds: [
            'environment-desk',
            'plant-sansevieria',
            'robot',
            'welcome-panel',
            'webxr-banner',
          ],
          validateAuthoringWorkflow: false,
        }),
      ).toEqual({ valid: true, issues: [] });
      const welcomePanel = scene.nodes.find(
        (node: { id?: string }) => node.id === 'welcome-panel',
      );
      expect(welcomePanel).toMatchObject({
        name: 'Welcome Panel',
        content: { asset: 'welcome-panel', type: 'asset' },
      });
      expect(welcomePanel?.components).not.toHaveProperty('PanelDocument');

      expect(
        scene.nodes.find((node: { id?: string }) => node.id === 'webxr-banner'),
      ).toMatchObject({
        content: { asset: 'webxr-banner', type: 'asset' },
        transform: { position: [0, 1, 1.8], rotationDeg: [0, 180, 0] },
      });
    },
  );

  it('lights AR scene content without covering passthrough', async () => {
    const files = await buildStarterProjectFiles({
      appName: 'lit-ar-app',
      configuration: getRecommendedConfiguration('ar'),
      language: 'ts',
      packageSource: npmSource,
      templateRoot: TEMPLATE_ROOT,
    });
    const scene = JSON.parse(
      textFile(files, 'public/scenes/main.iwsdk.scene.json'),
    );

    expect(scene.components).toHaveProperty('com.iwsdk.components.IBLGradient');
    expect(scene.components).not.toHaveProperty(
      'com.iwsdk.components.DomeGradient',
    );
  });

  it('keeps static starter composition out of the application entry point', async () => {
    const files = await buildStarterProjectFiles({
      appName: 'scene-owned-composition',
      configuration: getRecommendedConfiguration('vr'),
      language: 'ts',
      packageSource: npmSource,
      templateRoot: TEMPLATE_ROOT,
    });
    const index = textFile(files, 'src/index.ts');

    expect(index).not.toContain('createTransformEntity');
    expect(index).not.toContain('PlaneGeometry');
    expect(textFile(files, 'src/assets.ts')).toContain("'webxr-banner'");
  });

  it('always adapts canonical guidance to every supported coding harness', async () => {
    const files = await buildStarterProjectFiles({
      appName: 'all-harness-app',
      configuration: getRecommendedConfiguration('vr'),
      language: 'ts',
      packageSource: npmSource,
      templateRoot: TEMPLATE_ROOT,
    });
    const paths = files.map((file) => file.path);

    expect(paths).toContain('AGENTS.md');
    expect(paths).toContain('CLAUDE.md');
    expect(paths).toContain('.claude/settings.json');
    expect(paths).toContain('.claude/skills/iwsdk-debug/SKILL.md');
    expect(paths).toContain('.claude/skills/iwsdk-dev/SKILL.md');
    expect(paths).toContain('.claude/skills/iwsdk-native-xr-test/SKILL.md');
    expect(paths).toContain('.claude/skills/iwsdk-build-model/SKILL.md');
    expect(paths).toContain(
      '.claude/skills/iwsdk-build-model/assets/hardsurface.ts.template',
    );
    expect(paths).toContain('.claude/skills/iwsdk-compose-scene/SKILL.md');
    expect(paths).toContain(
      '.claude/skills/iwsdk-compose-scene/references/extended-workflow.md',
    );
    expect(paths).toContain('.agents/skills/iwsdk-debug/SKILL.md');
    expect(paths).toContain('.agents/skills/iwsdk-dev/SKILL.md');
    expect(paths).toContain('.agents/skills/iwsdk-native-xr-test/SKILL.md');
    expect(paths).toContain('.agents/skills/iwsdk-dev/references/planner.md');
    expect(paths).toContain('.agents/skills/iwsdk-dev/references/iterate.md');
    expect(paths).toContain('.agents/skills/iwsdk-build-model/SKILL.md');
    expect(paths).toContain(
      '.agents/skills/iwsdk-build-model/assets/hardsurface.ts.template',
    );
    const claudeModelKit = textFile(
      files,
      '.claude/skills/iwsdk-build-model/assets/hardsurface.ts.template',
    );
    const agentModelKit = textFile(
      files,
      '.agents/skills/iwsdk-build-model/assets/hardsurface.ts.template',
    );
    expect(claudeModelKit).toContain('frameToward(');
    expect(claudeModelKit).toContain('mirrorSurfaceFrameX(');
    expect(agentModelKit).toBe(claudeModelKit);
    expect(paths).toContain('.agents/skills/iwsdk-compose-scene/SKILL.md');
    expect(paths).toContain(
      '.agents/skills/iwsdk-compose-scene/references/extended-workflow.md',
    );
    expect(paths.some((file) => file.includes('/skills/iwsdk-planner/'))).toBe(
      false,
    );
    expect(paths.some((file) => file.includes('/skills/iwsdk-iterate/'))).toBe(
      false,
    );
    expect(
      paths.some((file) => file.includes('/skills/iwsdk-scene-composer/')),
    ).toBe(false);
    expect(paths).toContain('.codex/config.toml');
    expect(paths).toContain('.cursor/rules/scene-json.mdc');
    expect(paths).toContain('.github/instructions/scene-json.instructions.md');
    expect(paths).toContain('src/AGENTS.md');
    expect(paths).toContain('public/scenes/AGENTS.md');
    expect(paths).toContain('public/ui/AGENTS.md');
    expect(paths).not.toContain('.agents/skills/iwsdk-migrate-0-5/SKILL.md');
    expect(
      files.filter((file) => file.path === '.agents/skills/iwsdk-ui/SKILL.md'),
    ).toHaveLength(1);
    for (const skillPath of [
      '.claude/skills/iwsdk-ui/SKILL.md',
      '.agents/skills/iwsdk-ui/SKILL.md',
    ]) {
      const uiSkill = textFile(files, skillPath);
      expect(uiSkill).toContain(
        `npx @iwsdk/cli ecs find --input-json '{"namePattern":"^Welcome Panel$"}'`,
      );
      expect(uiSkill).toContain('npx @iwsdk/cli ui inspect');
      expect(uiSkill).not.toContain(`"withComponents":["PanelDocument"]`);
    }
    expect(textFile(files, 'AGENTS.md')).toContain('# IWSDK');
    expect(textFile(files, 'CLAUDE.md')).toContain('# IWSDK project');
    const emittedPathSet = new Set(paths);
    for (const file of files.filter(
      ({ path: filePath }) =>
        filePath.startsWith('.claude/') && filePath.endsWith('.md'),
    )) {
      const contents =
        typeof file.contents === 'string'
          ? file.contents
          : Buffer.from(file.contents).toString('utf8');
      for (const match of contents.matchAll(/`(\.claude\/[^`\n]+)`/gu)) {
        expect(emittedPathSet).toContain(match[1]);
      }
    }
    const configuredSkills = JSON.parse(
      textFile(files, '.claude/settings.json'),
    )
      .permissions.allow.filter((entry: string) => entry.startsWith('Skill('))
      .map((entry: string) => entry.slice('Skill('.length, -1))
      .sort();
    const emittedSkills = [
      ...new Set(
        paths
          .filter((filePath) => filePath.startsWith('.claude/skills/'))
          .map((filePath) => filePath.split('/')[2]),
      ),
    ].sort();
    expect(configuredSkills).toEqual(emittedSkills);
    for (const sharedGuidance of [
      'Explain immersive terms in plain language',
      'The developer owns whether that managed window is headed or headless',
      'immersive interaction claims require an',
      'data.runtimeUrls.network',
    ]) {
      expect(textFile(files, 'AGENTS.md')).toContain(sharedGuidance);
    }
    expect(textFile(files, 'CLAUDE.md')).toContain('@AGENTS.md');
    expect(files.some((file) => file.path.startsWith('.claude/rules/'))).toBe(
      true,
    );
    expect(
      files.some((file) => file.path === '.claude/skills/iwsdk-debug/SKILL.md'),
    ).toBe(true);
    expect(files.some((file) => file.path.startsWith('.agents/skills/'))).toBe(
      true,
    );
    expect(files.some((file) => file.path.includes('iwsdk-migrate-0-5'))).toBe(
      false,
    );
  });

  it('teaches explicit physical headset targeting in the native XR skill', async () => {
    const files = await buildStarterProjectFiles({
      appName: 'native-xr-app',
      configuration: getRecommendedConfiguration('vr'),
      language: 'ts',
      packageSource: npmSource,
      templateRoot: TEMPLATE_ROOT,
    });
    const skill = textFile(
      files,
      '.claude/skills/iwsdk-native-xr-test/SKILL.md',
    );
    expect(
      textFile(files, '.agents/skills/iwsdk-native-xr-test/SKILL.md'),
    ).toBe(skill);
    const prose = skill.replace(/\s+/gu, ' ');
    for (const guidance of [
      'A command without `runtimeTarget` always routes to the managed host browser, never to a headset, even when a paired headset page is the only connected page.',
      'Discover connected targets with `npx @iwsdk/cli runtime targets --raw`.',
      'A headset page qualifies only when its entry has `deviceClass: "physical"`, `role: "app"`, `commandReady: true`, and a `headsetId` equal to the explicit serial.',
      "Copy the qualifying entry's complete `runtimeTarget` unchanged: `deviceClass`, `headsetId`, `pageId`, `tabGeneration`, and any returned `sessionId` or `browserEpoch`. Never rebuild it from separate fields, drop or edit a field, or pass the surrounding entry instead.",
      'With several connected devices, require the user to name the serial to test; never choose one yourself. Pass `-s <serial>` to every ADB command and use the same serial as the IWSDK `headsetId`.',
      "Send each command with the `runtimeTarget` of the headset it is meant for; never reuse one headset's `runtimeTarget` for another.",
      'Never select a headset page with `expectedTab` alone.',
      'Never guess between candidates.',
      'or a command returns `ambiguous_target`, ask the user to close the extra app tabs in the headset, then rediscover. Do not fall back to list order, the newest entry, another headset, or an untargeted command.',
      '`outcome_unknown` means the command may have executed. Never replay it.',
      'if it returns `outcome_unknown`, check `xr status` instead of repeating the exit.',
    ]) {
      expect(prose).toContain(guidance);
    }
    expect(skill).toContain(
      `npx @iwsdk/cli runtime pair-headset --input-json '{"headsetId":"<serial>"}' --raw`,
    );
    expect(skill).toContain('-e uri "ovrweb://vr?uri=<encoded-pairing-url>"');
    expect(skill.match(/expectedTab/gu)).toHaveLength(1);
    expect(skill).not.toContain('Continue only with one device');

    // Join shell continuations so each command is checked as one line.
    const pageCommands = skill
      .replace(/\\\n\s*/gu, '')
      .split('\n')
      .filter(
        (line) =>
          /^npx @iwsdk\/cli (?:xr|ecs|scene|browser|ui) /u.test(line) &&
          !line.endsWith(' --help'),
      );
    expect(pageCommands).toContain(
      `npx @iwsdk/cli xr status --input-json '{"runtimeTarget":<runtimeTarget>}' --raw`,
    );
    expect(pageCommands).toContain(
      `npx @iwsdk/cli xr exit --input-json '{"runtimeTarget":<runtimeTarget>}' --raw`,
    );
    for (const command of pageCommands) {
      expect(command).toContain('"runtimeTarget":<runtimeTarget>');
    }
  });
});

function textFile(
  files: Awaited<ReturnType<typeof buildStarterProjectFiles>>,
  filePath: string,
): string {
  const file = files.find((candidate) => candidate.path === filePath);
  if (file == null) {
    throw new Error(`Missing generated file ${filePath}`);
  }
  return typeof file.contents === 'string'
    ? file.contents
    : Buffer.from(file.contents).toString('utf8');
}
