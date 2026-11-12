# `@iwsdk/reference-assets`

Private producer of the reference corpus that `@iwsdk/reference` bundles. It is
not published.

`pnpm --filter @iwsdk/reference-assets run build` ingests the monorepo's SDK
source, examples, guides and selected dependency type declarations into
`dist/corpus.json.gz`. It reads only local files and `node_modules`, and takes
about a minute. The `@iwsdk/reference` build copies that file into its own
`dist/`.
