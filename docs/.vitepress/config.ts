/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitepress';

function loadTypedocSidebar() {
  try {
    const p = path.resolve(__dirname, '../api/typedoc-sidebar.json');
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function loadVersion() {
  const p = path.resolve(__dirname, '../../packages/core/package.json');
  if (!fs.existsSync(p)) {
    throw new Error(`Failed to load version: ${p} does not exist`);
  }
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!pkg.version) {
    throw new Error(`Failed to load version: no version field in ${p}`);
  }
  return `v${pkg.version}`;
}

export default defineConfig({
  // Build static site even if some cross-package API links are unresolved in early builds
  ignoreDeadLinks: true,
  srcExclude: ['plans/**'],
  lang: 'en-US',
  title: 'Immersive Web SDK',
  description:
    'WebXR framework with ECS, input, locomotion, spatial UI, and tools.',

  head: [
    [
      'script',
      {
        async: '',
        src: 'https://www.googletagmanager.com/gtag/js?id=G-V03QDNGKY3',
      },
    ],
    [
      'script',
      {},
      `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-V03QDNGKY3');`,
    ],
  ],

  themeConfig: {
    // Temorarily hiding the logo while working on the design.
    // logo: {
    //   light: '/logo-light.svg',
    //   dark: '/logo-dark.svg',
    // },

    nav: [
      { text: 'AI', link: '/ai/' },
      { text: 'Guides', link: '/guides/01-project-setup' },
      { text: 'Concepts', link: '/concepts/' },
      { text: 'API', link: '/api/' },
      { text: 'Examples', link: '/examples/' },
      {
        text: loadVersion(),
        items: [
          { text: 'NPM', link: 'https://www.npmjs.com/package/@iwsdk/core' },
          {
            text: 'License',
            link: 'https://github.com/facebook/immersive-web-sdk/blob/main/LICENSE',
          },
        ],
      },
    ],

    sidebar: {
      '/ai/': [
        {
          text: 'AI-Native Development',
          items: [
            { text: 'Overview', link: '/ai/' },
            { text: 'Getting Started', link: '/ai/getting-started' },
            { text: 'Modes', link: '/ai/modes' },
            { text: 'MCP Tools Reference', link: '/ai/mcp-tools' },
            { text: 'Workflows', link: '/ai/workflows' },
          ],
        },
      ],
      '/guides/': [
        {
          text: 'Getting Started',
          items: [
            {
              text: 'Overview',
              link: '/guides/overview',
            },
            {
              text: '01 · Project Setup',
              link: '/guides/01-project-setup',
            },
            {
              text: '01a · Project Manifest',
              link: '/guides/01a-project-manifest',
            },
            {
              text: '01b · Minimal Scene',
              link: '/guides/01b-minimal-scene',
            },
            {
              text: '02 · Testing Experience',
              link: '/guides/02-testing-experience',
            },
            {
              text: '03 · Working in 3D',
              link: '/guides/03-working-in-3d',
            },
            {
              text: '04 · External Assets',
              link: '/guides/04-external-assets',
            },
            {
              text: '05 · Environment & Lighting',
              link: '/guides/05-environment-lighting',
            },
            {
              text: '06 · Built-in Interactions',
              link: '/guides/06-built-in-interactions',
            },
            {
              text: '07 · Custom Systems',
              link: '/guides/07-custom-systems',
            },
            {
              text: '08 · Build & Deploy',
              link: '/guides/08-build-deploy',
            },
            {
              text: '08a · Host Your Web Experience',
              link: '/guides/08a-web-hosting',
            },
          ],
        },
        {
          text: 'Advanced Guides',
          items: [
            {
              text: '09 · Native Scene Editor',
              link: '/guides/09-native-scene-editor',
            },
            {
              text: '09a · Native Scene Migration',
              link: '/guides/09-native-scene-migration',
            },
            {
              text: '10 · Spatial UI with UIKitML',
              link: '/guides/10-spatial-ui-uikitml',
            },
            {
              text: '11 · Scene Understanding',
              link: '/guides/11-scene-understanding',
            },
            {
              text: '12 · Physics',
              link: '/guides/12-physics',
            },
            {
              text: '13 · Camera Access',
              link: '/guides/13-camera-access',
            },
            {
              text: '14 Environment Raycast',
              link: '/guides/14-environment-raycast',
            },
            {
              text: '15 Depth Occlusion',
              link: '/guides/15-depth-occlusion',
            },
            {
              text: '16 Browser-First Systems',
              link: '/guides/16-browser-first-systems',
            },
            {
              text: '17 React and Preact 2D UI',
              link: '/guides/17-react-preact-2d-ui',
            },
            {
              text: '18 Platform Services and Backends',
              link: '/guides/18-platform-services',
            },
            {
              text: '19 Upgrading IWSDK',
              link: '/guides/19-upgrading',
            },
          ],
        },
      ],
      '/concepts/': [
        {
          text: 'ECS',
          link: '/concepts/ecs/',
          items: [
            { text: 'World', link: '/concepts/ecs/world' },
            { text: 'Entity', link: '/concepts/ecs/entity' },
            { text: 'Component', link: '/concepts/ecs/components' },
            { text: 'System', link: '/concepts/ecs/systems' },
            { text: 'Queries', link: '/concepts/ecs/queries' },
            { text: 'Lifecycle', link: '/concepts/ecs/lifecycle' },
            { text: 'Patterns & Tips', link: '/concepts/ecs/patterns' },
            { text: 'Architecture', link: '/concepts/ecs/architecture' },
          ],
        },
        {
          text: 'Three.js Basics',
          link: '/concepts/three-basics/',
          items: [
            {
              text: 'Interop: ECS ↔ Three.js',
              link: '/concepts/three-basics/interop-ecs-three',
            },
            {
              text: 'Transforms & 3D Math',
              link: '/concepts/three-basics/transforms-math',
            },
            {
              text: 'Meshes, Geometry & Materials',
              link: '/concepts/three-basics/meshes-geometry-materials',
            },
          ],
        },
        {
          text: 'XR Input',
          link: '/concepts/xr-input/',
          items: [
            { text: 'Input Visuals', link: '/concepts/xr-input/input-visuals' },
            { text: 'Input Actions', link: '/concepts/xr-input/actions' },
            { text: 'Pointers', link: '/concepts/xr-input/pointers' },
            { text: 'Gaze and Pinch', link: '/concepts/xr-input/gaze' },
            {
              text: 'Stateful Gamepad',
              link: '/concepts/xr-input/stateful-gamepad',
            },
            { text: 'XR Origin', link: '/concepts/xr-input/xr-origin' },
          ],
        },
        {
          text: 'Spatial UI',
          link: '/concepts/spatial-ui/',
          items: [
            { text: 'UIKit', link: '/concepts/spatial-ui/uikit' },
            { text: 'UIKitML', link: '/concepts/spatial-ui/uikitml' },
            {
              text: 'UIKitDocument',
              link: '/concepts/spatial-ui/uikit-document',
            },
            { text: 'HUD Placement', link: '/concepts/spatial-ui/hud' },
            { text: 'Flow', link: '/concepts/spatial-ui/flow' },
          ],
        },
        {
          text: 'Locomotion',
          link: '/concepts/locomotion/',
          items: [
            { text: 'Slide', link: '/concepts/locomotion/slide' },
            { text: 'Teleport', link: '/concepts/locomotion/teleport' },
            { text: 'Turn', link: '/concepts/locomotion/turn' },
            { text: 'Performance', link: '/concepts/locomotion/performance' },
          ],
        },
        {
          text: 'Grabbing',
          link: '/concepts/grabbing/',
          items: [
            {
              text: 'Interaction Types',
              link: '/concepts/grabbing/interaction-types',
            },
            {
              text: 'Distance Grabbing',
              link: '/concepts/grabbing/distance-grabbing',
            },
          ],
        },
      ],
      '/api/': loadTypedocSidebar(),
      '/examples/': [
        {
          text: 'Examples',
          items: [
            {
              text: 'Minimal Scene Walkthrough',
              link: '/guides/01b-minimal-scene',
            },
            { text: 'Audio', link: '/examples/#audio' },
            {
              text: 'Environment Raycast',
              link: '/examples/#environment-raycast',
            },
            { text: 'Gaze + Pinch', link: '/examples/#gaze-pinch' },
            { text: 'Grab Interactions', link: '/examples/#grab' },
            { text: 'Locomotion', link: '/examples/#locomotion' },
            { text: 'Physics', link: '/examples/#physics' },
            {
              text: 'Scene Understanding',
              link: '/examples/#scene-understanding',
            },
            { text: 'Depth Occlusion', link: '/examples/#depth-occlusion' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/facebook/immersive-web-sdk' },
    ],

    footer: {
      message:
        '<a href="https://opensource.fb.com/legal/privacy/">Privacy</a> | <a href="https://opensource.fb.com/legal/terms/">Terms</a> ',
      copyright: 'MIT License | Copyright © Meta Platforms, Inc',
    },
  },
});
