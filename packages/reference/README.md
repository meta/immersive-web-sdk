# `@iwsdk/reference`

Local code search and API reference tooling for Immersive Web SDK projects.
The package supplies the `iwsdk-reference` MCP server and is normally invoked
through `@iwsdk/cli` rather than called directly.

## Setup

Create-generated projects install this package as a development dependency.
The search corpus (SDK source, examples, guides and dependency types) ships
inside the package as `dist/corpus.json.gz`, so queries work offline right after
install. There is no model, download or cache to warm up:

```bash
npx @iwsdk/cli reference status
```

`npx @iwsdk/cli reference warmup` remains for compatibility; it only checks that
the bundled corpus loads. Set `IWSDK_REFERENCE_CORPUS` to use another corpus
file.

## Queries

```bash
npx @iwsdk/cli reference search --input-json \
  '{"query":"create a grabbable object","limit":5}'
npx @iwsdk/cli reference api --input-json '{"name":"World.create"}'
npx @iwsdk/cli reference components
npx @iwsdk/cli reference systems
```

Run `npx @iwsdk/cli reference --help` for the complete command surface. When this
package is installed, `@iwsdk/cli` also registers its MCP adapter automatically.

## Building from the monorepo

The private `@iwsdk/reference-assets` package produces the corpus. Build it
before building or packing this package; `prepack` fails without it:

```bash
pnpm --filter @iwsdk/reference-assets run build
pnpm --filter @iwsdk/reference run build
```

## License

MIT © Meta Platforms, Inc.
