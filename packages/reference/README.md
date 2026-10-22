# `@iwsdk/reference`

Local semantic search and API reference tooling for Immersive Web SDK projects.
The package supplies the `iwsdk-reference` MCP server and is normally invoked
through `@iwsdk/cli` rather than called directly.

## Setup

Create-generated projects install this package as a development dependency.
Warm the pinned corpus and embedding model once before using reference queries:

```bash
npx @iwsdk/cli reference warmup
npx @iwsdk/cli reference status
```

The package intentionally does not embed the large reference corpus or model.
Warmup stores project state under `.iwsdk/reference` and reuses the shared model
and corpus caches. Internal or offline deployments can host the corpus payload
themselves and set `IWSDK_REFERENCE_ASSETS_BASE_URL`; the pinned model URLs must
also be reachable or already present in the shared cache.

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

## Sharp security override

The currently supported `@huggingface/transformers` release still declares
Sharp `^0.34.x`, while the patched Sharp line begins at 0.35. Create-generated
projects pin the compatible patched release for both npm and pnpm. For npm, use
the root package manifest:

```json
{
  "overrides": {
    "sharp": "0.35.4",
    "three": "npm:super-three@0.185.0"
  }
}
```

Create-generated pnpm projects keep resolution and lifecycle policy in
`pnpm-workspace.yaml` instead of a `pnpm` field in `package.json`:

```yaml
packages:
  - '.'
overrides:
  sharp: 0.35.4
  three: npm:super-three@0.185.0
onlyBuiltDependencies:
  - esbuild
  - protobufjs
  - sharp
ignoredBuiltDependencies:
  - '@meta-quest/metavr'
  - onnxruntime-node
allowBuilds:
  esbuild: true
  protobufjs: true
  sharp: true
  '@meta-quest/metavr': false
  onnxruntime-node: false
```

Add the matching root override for your package manager when installing
`@iwsdk/reference` manually. Generated pnpm projects include both lifecycle-policy
forms: the explicit allow and ignore lists support pnpm 10.18, while the unified
`allowBuilds` map supports package managers that prefer the newer form. This lets
both versions allow the required native helpers while intentionally
disabling the optional MetaVR and onnxruntime-node install scripts. Bundle-based
projects also receive local tarball entries in `overrides`. IWSDK uses Transformers
for text feature extraction; its test and release matrices exercise that path with
Sharp 0.35.4.

## License

MIT © Meta Platforms, Inc.
