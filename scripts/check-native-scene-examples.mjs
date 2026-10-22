#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CORE_PROJECT_DIST = path.join(
  REPO_ROOT,
  'packages/core/dist/project/index.js',
);
const SCENE_COMPOSITION_DIST = path.join(
  REPO_ROOT,
  'packages/scene-composition/dist/index.js',
);
const EXAMPLE_ASSETS_DIST = path.join(
  REPO_ROOT,
  'packages/example-assets/dist/index.js',
);
const EXAMPLE_ASSET_CDN_BASE =
  'https://cdn.jsdelivr.net/npm/@iwsdk/example-assets@0.4.2/assets';

const EXAMPLES = [
  {
    id: 'audio',
    target: 'vr',
    scene: 'audio.iwsdk.scene.json',
    componentModule: true,
    stockAssetIds: ['environment-desk', 'robot'],
    requiredAssetIds: ['environment-desk', 'robot', 'spatial-audio-panel'],
    requiredComponents: [
      'AudioSource',
      'DomeGradient',
      'IBLGradient',
      'LocomotionEnvironment',
      'RayInteractable',
      'ScreenSpace',
      'Spinner',
    ],
  },
  {
    id: 'browser-first',
    target: 'browser',
    scene: 'browser-first.iwsdk.scene.json',
    stockAssetIds: ['environment-desk'],
    requiredAssetIds: [
      'browser-first-physics-ball',
      'browser-first-player-avatar',
      'browser-first-ray-target',
      'browser-first-welcome-panel',
      'environment-desk',
    ],
    requiredComponents: [
      'AudioSource',
      'DomeGradient',
      'IBLGradient',
      'LocomotionEnvironment',
      'OneHandGrabbable',
      'PhysicsBody',
      'PhysicsShape',
      'RayInteractable',
    ],
  },
  {
    id: 'depth-occlusion',
    target: 'ar',
    scene: 'depth-occlusion.iwsdk.scene.json',
    stockAssetIds: ['plant-sansevieria', 'robot'],
    requiredAssetIds: [
      'depth-hard-cube',
      'depth-occlusion-welcome-panel',
      'depth-reference-cylinder',
      'depth-soft-sphere',
      'plant-sansevieria',
      'robot',
    ],
    requiredComponents: [
      'DepthOccludable',
      'DistanceGrabbable',
      'IBLGradient',
      'PokeInteractable',
      'RayInteractable',
      'ScreenSpace',
      'XRAnchor',
    ],
  },
  {
    id: 'environment-raycast',
    target: 'ar',
    scene: 'environment-raycast.iwsdk.scene.json',
    stockAssetIds: ['plant-sansevieria'],
    requiredAssetIds: [
      'environment-raycast-welcome-panel',
      'plant-sansevieria',
    ],
    requiredComponents: [
      'EnvironmentRaycastTarget',
      'IBLGradient',
      'RayInteractable',
      'ScreenSpace',
    ],
  },
  {
    id: 'gaze-pinch',
    target: 'vr',
    scene: 'gaze-pinch.iwsdk.scene.json',
    stockAssetIds: ['environment-desk'],
    requiredAssetIds: [
      'environment-desk',
      'gaze-card-0',
      'gaze-card-1',
      'gaze-card-2',
      'gaze-card-3',
      'gaze-card-4',
      'gaze-card-5',
      'gaze-grab-cube',
      'gaze-welcome-panel',
    ],
    requiredComponents: [
      'DistanceGrabbable',
      'DomeGradient',
      'IBLGradient',
      'LocomotionEnvironment',
      'PokeInteractable',
      'RayInteractable',
      'ScreenSpace',
    ],
  },
  {
    id: 'grab',
    target: 'vr',
    scene: 'grab.iwsdk.scene.json',
    stockAssetIds: ['environment-desk'],
    requiredAssetIds: [
      'chichen-itza',
      'earth',
      'eiffel-tower',
      'environment-desk',
      'grab-welcome-panel',
      'opera-house',
      'pin',
      'pyramid',
    ],
    requiredComponents: [
      'DistanceGrabbable',
      'DomeGradient',
      'IBLGradient',
      'LocomotionEnvironment',
      'OneHandGrabbable',
      'RayInteractable',
      'TwoHandsGrabbable',
    ],
  },
  {
    id: 'layers',
    target: 'vr',
    scene: 'layers.iwsdk.scene.json',
    stockAssetIds: [],
    requiredAssetIds: [
      'layers-floor',
      'layers-grid',
      'layers-orb',
      'layers-pillar',
      'layers-welcome-panel',
    ],
    requiredComponents: ['DomeGradient', 'IBLGradient'],
  },
  {
    id: 'locomotion',
    target: 'vr',
    scene: 'locomotion.iwsdk.scene.json',
    componentModule: true,
    stockAssetIds: ['environment-desk'],
    requiredAssetIds: [
      'environment-desk',
      'locomotion-settings-panel',
      'locomotion-welcome-panel',
    ],
    requiredComponents: [
      'AudioSource',
      'DomeGradient',
      'Elevator',
      'IBLGradient',
      'LocomotionEnvironment',
      'LocomotionSettingsPanel',
      'PokeInteractable',
      'RayInteractable',
      'ScreenSpace',
    ],
  },
  {
    id: 'physics',
    target: 'vr',
    scene: 'physics.iwsdk.scene.json',
    stockAssetIds: ['environment-desk', 'plant-sansevieria', 'robot'],
    requiredAssetIds: [
      'environment-desk',
      'physics-dynamic-cylinder',
      'physics-dynamic-sphere',
      'physics-welcome-panel',
      'plant-sansevieria',
      'robot',
    ],
    requiredComponents: [
      'DistanceGrabbable',
      'DomeGradient',
      'IBLGradient',
      'LocomotionEnvironment',
      'OneHandGrabbable',
      'PhysicsBody',
      'PhysicsShape',
      'RayInteractable',
    ],
  },
  {
    id: 'poke',
    target: 'vr',
    scene: 'poke.iwsdk.scene.json',
    componentModule: true,
    stockAssetIds: ['environment-desk', 'robot'],
    requiredAssetIds: [
      'environment-desk',
      'poke-webxr-banner',
      'poke-welcome-panel',
      'robot',
    ],
    requiredComponents: [
      'AudioSource',
      'DomeGradient',
      'IBLGradient',
      'LocomotionEnvironment',
      'PokeInteractable',
      'RayInteractable',
      'Robot',
      'ScreenSpace',
    ],
  },
  {
    id: 'scene-understanding',
    target: 'ar',
    scene: 'scene-understanding.iwsdk.scene.json',
    stockAssetIds: [],
    requiredAssetIds: [
      'scene-understanding-anchor',
      'scene-understanding-welcome-panel',
    ],
    requiredComponents: [
      'DistanceGrabbable',
      'DomeTexture',
      'IBLTexture',
      'PokeInteractable',
      'RayInteractable',
      'ScreenSpace',
      'XRAnchor',
    ],
  },
];

const REMOVED_AUTHORED_DIR_NAME = ['meta', 'spatial'].join('');
const REMOVED_AUTHORED_DIRS = [
  `examples/audio/${REMOVED_AUTHORED_DIR_NAME}`,
  `examples/grab/${REMOVED_AUTHORED_DIR_NAME}`,
  `examples/physics/${REMOVED_AUTHORED_DIR_NAME}`,
];
const LEGACY_DUPLICATE_ASSET_DIRS = [
  'environmentDesk',
  'plantSansevieria',
  'robot',
];
const REFERENCE_SHARP_OVERRIDE = '0.35.4';

function readRelative(relativePath) {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function fileExists(relativePath) {
  return existsSync(path.join(REPO_ROOT, relativePath));
}

function flattenNodes(nodes) {
  return nodes.flatMap((node) => [
    node,
    ...flattenNodes(Array.isArray(node.children) ? node.children : []),
  ]);
}

async function loadBuiltModule(modulePath, label) {
  if (!existsSync(modulePath)) {
    throw new Error(
      `${label} build output is missing at ${modulePath}. Run the package build before this check.`,
    );
  }
  return import(pathToFileURL(modulePath).href);
}

function addValidationFailures(failures, file, validation) {
  for (const issue of validation.issues) {
    failures.push(`${file}${issue.path}: ${issue.message}`);
  }
}

function extractDefinedAssets(sourceText, file, failures) {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let declaration;
  const visit = (node) => {
    if (
      declaration == null &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineAssets' &&
      node.arguments.length === 1 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      declaration = node.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (declaration == null) {
    failures.push(
      `${file} must export its complete catalog through defineAssets({...})`,
    );
    return { ids: new Set(), localUrls: [] };
  }

  const ids = new Set();
  const localUrls = [];
  for (const property of declaration.properties) {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      failures.push(
        `${file} contains an unsupported computed/spread asset declaration`,
      );
      continue;
    }
    const id = propertyName(property.name);
    if (id == null) {
      failures.push(
        `${file} contains an asset id that is not statically readable`,
      );
      continue;
    }
    ids.add(id);
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isObjectLiteralExpression(property.initializer)
    ) {
      continue;
    }
    const urlProperty = property.initializer.properties.find(
      (candidate) =>
        ts.isPropertyAssignment(candidate) &&
        propertyName(candidate.name) === 'url',
    );
    if (
      urlProperty != null &&
      ts.isPropertyAssignment(urlProperty) &&
      (ts.isStringLiteral(urlProperty.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(urlProperty.initializer))
    ) {
      localUrls.push(urlProperty.initializer.text);
    } else if (
      urlProperty != null &&
      ts.isPropertyAssignment(urlProperty) &&
      ts.isCallExpression(urlProperty.initializer) &&
      ts.isIdentifier(urlProperty.initializer.expression) &&
      urlProperty.initializer.expression.text === 'publicAssetUrl' &&
      urlProperty.initializer.arguments.length === 1 &&
      ts.isStringLiteral(urlProperty.initializer.arguments[0])
    ) {
      localUrls.push(`./${urlProperty.initializer.arguments[0].text}`);
    }
  }
  return { ids, localUrls };
}

function propertyName(name) {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function assertLocalAssetUrls(failures, appRoot, assetsFile, urls) {
  for (const url of urls) {
    if (
      /^(?:data:|https?:)/u.test(url) ||
      (!url.startsWith('/') && !url.startsWith('./'))
    ) {
      continue;
    }
    const publicPath = path.posix.join(
      appRoot,
      'public',
      url.replace(/^\.\//u, '').replace(/^\//u, ''),
    );
    if (!fileExists(publicPath)) {
      failures.push(
        `${assetsFile} references missing local asset "${url}" (${publicPath})`,
      );
    }
  }
}

function assertExample({
  catalogById,
  example,
  failures,
  normalizeProjectWorldOptions,
  validateIwsdkProjectManifest,
  validateSceneDocument,
}) {
  const appRoot = `examples/${example.id}`;
  const configFile = `${appRoot}/iwsdk.config.json`;
  const sceneFile = `${appRoot}/public/scenes/${example.scene}`;
  const assetsFile = `${appRoot}/src/assets.ts`;
  const componentsFile = `${appRoot}/src/components.ts`;
  const packageFile = `${appRoot}/package.json`;
  const sourceFile = `${appRoot}/src/index.ts`;
  const viteFile = `${appRoot}/vite.config.ts`;
  for (const required of [
    configFile,
    sceneFile,
    assetsFile,
    packageFile,
    sourceFile,
    viteFile,
  ]) {
    if (!fileExists(required)) {
      failures.push(
        `required manifest-first example file is missing: ${required}`,
      );
      return;
    }
  }

  const packageManifest = JSON.parse(readRelative(packageFile));
  const hasReferenceDependency =
    packageManifest.dependencies?.['@iwsdk/reference'] != null ||
    packageManifest.devDependencies?.['@iwsdk/reference'] != null;
  if (
    hasReferenceDependency &&
    (packageManifest.overrides?.sharp !== REFERENCE_SHARP_OVERRIDE ||
      packageManifest.overrides?.three !== 'npm:super-three@0.185.0')
  ) {
    failures.push(
      `${packageFile} installs @iwsdk/reference without the required npm sharp ${REFERENCE_SHARP_OVERRIDE} security override`,
    );
  }
  if (
    packageManifest.dependencies?.['@iwsdk/example-assets'] != null ||
    packageManifest.devDependencies?.['@iwsdk/example-assets'] != null
  ) {
    failures.push(
      `${packageFile} installs @iwsdk/example-assets instead of using its immutable CDN files`,
    );
  }

  const manifest = JSON.parse(readRelative(configFile));
  const manifestValidation = validateIwsdkProjectManifest(manifest);
  if (!manifestValidation.valid) {
    addValidationFailures(failures, configFile, manifestValidation);
  }
  const expectedScene = `./public/scenes/${example.scene}`;
  if (manifest.scene !== expectedScene) {
    failures.push(
      `${configFile} scene must be ${JSON.stringify(expectedScene)}`,
    );
  }
  if (manifest.assets?.module !== './src/assets') {
    failures.push(
      `${configFile} must declare extensionless assets.module "./src/assets"`,
    );
  }
  if (example.componentModule) {
    if (!fileExists(componentsFile)) {
      failures.push(`custom component module is missing: ${componentsFile}`);
    }
    if (manifest.components?.module !== './src/components') {
      failures.push(
        `${configFile} must declare extensionless components.module "./src/components"`,
      );
    }
  } else if (manifest.components != null) {
    failures.push(`${configFile} declares an unnecessary components module`);
  }
  const normalized = manifestValidation.valid
    ? normalizeProjectWorldOptions(manifest)
    : undefined;
  if (normalized?.level !== `./scenes/${example.scene}`) {
    failures.push(
      `${configFile} does not normalize to the selected runtime scene`,
    );
  }
  if (
    example.target === 'browser'
      ? manifest.world?.xr !== false
      : manifest.world?.xr?.mode !== example.target
  ) {
    failures.push(
      `${configFile} does not declare the ${example.target} target`,
    );
  }

  const assetsText = readRelative(assetsFile);
  const assetDeclaration = extractDefinedAssets(
    assetsText,
    assetsFile,
    failures,
  );
  assertLocalAssetUrls(
    failures,
    appRoot,
    assetsFile,
    assetDeclaration.localUrls,
  );
  for (const assetId of example.requiredAssetIds) {
    if (!assetDeclaration.ids.has(assetId)) {
      failures.push(`${assetsFile} is missing required asset "${assetId}"`);
    }
  }
  for (const assetId of example.stockAssetIds) {
    if (!catalogById.has(assetId)) {
      failures.push(
        `${assetsFile} expects unknown shared catalog asset "${assetId}"`,
      );
    }
  }
  if (example.stockAssetIds.length > 0) {
    if (!assetsText.includes('VITE_IWSDK_EXAMPLE_ASSET_BASE_URL')) {
      failures.push(
        `${assetsFile} does not use the centralized stock-asset base override`,
      );
    }
    if (!assetsText.includes(EXAMPLE_ASSET_CDN_BASE)) {
      failures.push(
        `${assetsFile} does not use the verified exact-version stock-asset CDN`,
      );
    }
    if (assetsText.includes("publicAssetUrl('iwsdk-assets')")) {
      failures.push(
        `${assetsFile} still falls back to the retired local stock-asset bridge`,
      );
    }
  }

  const document = JSON.parse(readRelative(sceneFile));
  const sceneValidation = validateSceneDocument(document, {
    knownAssetIds: [...assetDeclaration.ids],
    validateAuthoringWorkflow: false,
  });
  if (!sceneValidation.valid) {
    addValidationFailures(failures, sceneFile, sceneValidation);
  }
  if (document.resources?.assets != null) {
    failures.push(
      `${sceneFile} still embeds obsolete resources.assets metadata`,
    );
  }
  const nodes = flattenNodes(document.nodes ?? []);
  const referencedAssetIds = new Set(
    nodes
      .filter((node) => node.content?.type === 'asset')
      .map((node) => node.content.asset),
  );
  for (const assetId of example.requiredAssetIds) {
    if (!referencedAssetIds.has(assetId)) {
      failures.push(
        `${sceneFile} does not reference required asset "${assetId}"`,
      );
    }
  }
  const componentNames = new Set(
    [
      ...Object.keys(document.components ?? {}),
      ...nodes.flatMap((node) => Object.keys(node.components ?? {})),
    ].map((componentId) => componentId.split('.').at(-1)),
  );
  for (const component of example.requiredComponents) {
    if (!componentNames.has(component)) {
      failures.push(
        `${sceneFile} is missing required component "${component}"`,
      );
    }
  }

  const sourceText = readRelative(sourceFile);
  if (!/from\s+['"]virtual:iwsdk-project['"]/u.test(sourceText)) {
    failures.push(`${sourceFile} does not import virtual:iwsdk-project`);
  }
  if (!/World\.create\([\s\S]*?projectOptions/u.test(sourceText)) {
    failures.push(`${sourceFile} does not pass projectOptions to World.create`);
  }
  if (/from\s+['"]\.\/assets\.js['"]/u.test(sourceText)) {
    failures.push(
      `${sourceFile} still imports assets directly instead of projectOptions`,
    );
  }
  if (/from\s+['"]\.\/components\.js['"]/u.test(sourceText)) {
    failures.push(
      `${sourceFile} still imports components directly instead of projectOptions`,
    );
  }

  const viteText = readRelative(viteFile);
  if (!/iwsdkDev\(\s*\)/u.test(viteText)) {
    failures.push(`${viteFile} must use manifest-first iwsdkDev()`);
  }
  for (const retired of [
    'assetManifest',
    'componentManifest',
    'workspace:',
    'ai:',
    'emulator:',
  ]) {
    if (viteText.includes(retired)) {
      failures.push(
        `${viteFile} still contains retired project/session option ${retired}`,
      );
    }
  }
  if (viteText.includes('iwsdkExampleAssets')) {
    failures.push(`${viteFile} still uses the retired stock-asset copy plugin`);
  }
}

function assertCreateSeeds(failures, validateSceneDocument) {
  const assetsFile = 'packages/create/template/common/src/assets.ts';
  const assets = extractDefinedAssets(
    readRelative(assetsFile),
    assetsFile,
    failures,
  );
  const assetsText = readRelative(assetsFile);
  if (!assetsText.includes(EXAMPLE_ASSET_CDN_BASE)) {
    failures.push(
      `${assetsFile} does not use the verified exact-version stock-asset CDN`,
    );
  }
  for (const scene of ['ar.iwsdk.scene.json', 'immersive.iwsdk.scene.json']) {
    const sceneFile = `packages/create/template/scenes/${scene}`;
    const document = JSON.parse(readRelative(sceneFile));
    const validation = validateSceneDocument(document, {
      knownAssetIds: [...assets.ids],
      validateAuthoringWorkflow: false,
    });
    if (!validation.valid) {
      addValidationFailures(failures, sceneFile, validation);
    }
    if (document.player?.camera?.transform != null) {
      failures.push(
        `${sceneFile} incorrectly stores a nonimmersive preview pose on the tracked camera`,
      );
    }
  }
  const indexText = readRelative(
    'packages/create/template/common/src/index.ts',
  );
  if (!indexText.includes("from 'virtual:iwsdk-project'")) {
    failures.push(
      'Create common source does not consume virtual:iwsdk-project',
    );
  }
  const viteText = readRelative(
    'packages/create/template/common/vite.config.ts',
  );
  if (!/iwsdkDev\(\s*\)/u.test(viteText)) {
    failures.push('Create common Vite source does not use bare iwsdkDev()');
  }
  if (viteText.includes('iwsdkExampleAssets')) {
    failures.push(
      'Create common Vite source still uses the stock-asset copy plugin',
    );
  }
}

function assertRemovedDirectories(failures) {
  for (const relativePath of REMOVED_AUTHORED_DIRS) {
    if (fileExists(relativePath)) {
      failures.push(
        `removed authored scene directory still exists: ${relativePath}`,
      );
    }
  }
  for (const example of EXAMPLES) {
    for (const assetDir of LEGACY_DUPLICATE_ASSET_DIRS) {
      const duplicatePath = `examples/${example.id}/public/gltf/${assetDir}`;
      if (fileExists(duplicatePath)) {
        failures.push(
          `duplicate public asset directory remains: ${duplicatePath}`,
        );
      }
    }
  }
}

async function main() {
  const { normalizeProjectWorldOptions, validateIwsdkProjectManifest } =
    await loadBuiltModule(CORE_PROJECT_DIST, '@iwsdk/core/project');
  const { validateSceneDocument } = await loadBuiltModule(
    SCENE_COMPOSITION_DIST,
    '@iwsdk/scene-composition',
  );
  const { EXAMPLE_ASSET_CATALOG } = await loadBuiltModule(
    EXAMPLE_ASSETS_DIST,
    '@iwsdk/example-assets',
  );
  const catalogById = new Map(
    EXAMPLE_ASSET_CATALOG.map((asset) => [asset.id, asset]),
  );
  const failures = [];

  for (const example of EXAMPLES) {
    assertExample({
      catalogById,
      example,
      failures,
      normalizeProjectWorldOptions,
      validateIwsdkProjectManifest,
      validateSceneDocument,
    });
  }
  assertCreateSeeds(failures, validateSceneDocument);
  assertRemovedDirectories(failures);

  if (failures.length > 0) {
    console.error('Native scene/project-manifest migration check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Native scene/project-manifest migration check passed: ${EXAMPLES.length} examples and 2 Create scene seeds are valid.`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 2;
});
