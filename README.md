<h1 align="center">Immersive Web SDK</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@iwsdk/core"><img src="https://badgen.net/npm/v/@iwsdk/core/?icon=npm&color=orange" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@iwsdk/core"><img src="https://badgen.net/npm/dt/@iwsdk/core" alt="npm download" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://badgen.net/badge/icon/typescript/?icon=typescript&label=lang" alt="language" /></a>
    <a href="https://raw.githubusercontent.com/facebook/immersive-web-sdk/main/LICENSE"><img src="https://badgen.net/github/license/facebook/immersive-web-sdk/" alt="license" /></a>
</p>

<p align="center"><strong>Where every webpage can become a world.</strong></p>

The **Immersive Web SDK** makes building immersive web experiences as approachable as traditional web development. It's a complete collection of frameworks and tools built on **Three.js** with a high-performance **Entity Component System**, **developer-first workflow** with one-command setup and built-in emulation, and **production-ready systems** for grab interactions, locomotion, spatial audio, physics, and scene understanding.

**Same code, two experiences**: Run immersively in VR/AR headsets and automatically provide mouse-and-keyboard emulation on desktop browsers. No browser extensions, no special setup—anyone with a laptop can develop for the immersive web.

## Getting Started

Create a new project with a single command:

```bash
npm create @iwsdk@latest
```

Or install into an existing project:

```bash
npm install @iwsdk/core three@npm:super-three@0.185.0
```

Keep the exact `three` alias at the application root and override transitive
resolutions so the app and IWSDK share one runtime. npm reads the override from
`package.json`:

```json
{
  "dependencies": {
    "@iwsdk/core": "^1.0.0",
    "three": "npm:super-three@0.185.0"
  },
  "overrides": {
    "three": "npm:super-three@0.185.0"
  }
}
```

pnpm 10 and 11 read root overrides from `pnpm-workspace.yaml`:

```yaml
packages:
  - '.'
overrides:
  three: npm:super-three@0.185.0
```

## Documentation

For guides, concepts, and API reference, visit: **[https://iwsdk.dev](https://iwsdk.dev)**

## Packages

| Package                                              | Description                                       |
| ---------------------------------------------------- | ------------------------------------------------- |
| [@iwsdk/core](./packages/core)                       | Core SDK with ECS, systems, and WebXR integration |
| [@iwsdk/create](./packages/create)                   | CLI for scaffolding new projects                  |
| [@iwsdk/locomotor](./packages/locomotor)             | Locomotion engine for Three.js WebXR              |
| [@iwsdk/xr-input](./packages/xr-input)               | WebXR input system for Three.js                   |
| [@iwsdk/vite-plugin-dev](./packages/vite-plugin-dev) | XR emulation, AI agent tooling, and dev browser   |

## Development

```bash
# Use the pinned Node major, install dependencies, and build runtime/tooling packages
nvm use
corepack pnpm@10.18.3 run bootstrap

# Build every workspace package, including the generated reference corpus
corepack pnpm@10.18.3 run build:all

# Build all packages as tgz files (for examples to consume)
npm run build:tgz

# Type-check every example as a fresh consumer of locally built tgz packages
corepack pnpm@10.18.3 run typecheck:examples

# Run an example (fresh install from local tgz packages)
cd examples/locomotion && npm run fresh:dev

# Lint and format
corepack pnpm@10.18.3 run lint
corepack pnpm@10.18.3 run format

# Build a specific package
corepack pnpm@10.18.3 --filter @iwsdk/core build
```

`bootstrap` is also the repair command for a partial or stale source build. It
uses the lockfile, builds runtime and tooling packages in dependency order, and
generates WebXR input profiles from the pinned npm asset package instead of
making a separate CDN request. It deliberately leaves out the private
`@iwsdk/reference-assets` producer, so `@iwsdk/reference` has no corpus until
you run `build:all`, which first runs that offline ingest (about a minute). Run `corepack pnpm@10.18.3 run doctor` for environment, proxy, and
generated-output checks.

For a network-restricted checkout whose pnpm store is already warm, use
`corepack pnpm@10.18.3 run bootstrap:offline`. Initial dependency installation
still needs registry access (and honors standard npm/pnpm proxy configuration),
but subsequent profile generation and builds are offline-safe. A directory-linked
`@iwsdk/cli` now keeps a stable launcher; if its `dist` is missing, it prints the
exact package build command instead of leaving a broken executable link.

### Development Workflow

The examples use `file:` dependencies pointing to `.tgz` files built from local packages. This simulates how end-users will consume the packages from npm.

1. **`npm run build:tgz`** - Builds all packages in dependency order and creates `.tgz` archives
2. **`npm run fresh:dev`** (in example) - Cleans `node_modules`, reinstalls from tgz files, and starts dev server

This ensures examples always test against the latest local build.
`typecheck:examples` applies the same boundary to every TypeScript example: it
rebuilds development tarballs, removes each example's ignored install state,
installs from those tarballs, and invokes that example's local TypeScript binary.

## License

IWSDK is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Contributing

Contributions are welcome! Please review our [Contributing Guidelines](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md) before submitting issues or pull requests.

## Developer Terms

- [Open Source Terms of Use](https://opensource.fb.com/legal/terms)
- [Open Source Privacy Policy](https://opensource.fb.com/legal/privacy)
