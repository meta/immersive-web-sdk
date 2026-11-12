#!/usr/bin/env bash
# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

# Build a distributable SDK bundle containing:
#   - packages/  → all workspace packages as .tgz tarballs, grouped by package name
#   - docs/      → prebuilt static docs with a tiny local server script
#
# This is intended for sharing an early build of the SDK without publishing to npm.
# Consumers can:
#   - run the bundled @iwsdk/create tarball to scaffold an app
#   - cd docs && npm run serve (serves the static docs)

set -euo pipefail

echo "🚀 Building SDK bundle..."

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGES_DIR="$BASE_DIR/packages"
BUNDLE_ROOT="$BASE_DIR/sdk-bundle"
BUNDLE_PKGS="$BUNDLE_ROOT/packages"
BUNDLE_DOCS="$BUNDLE_ROOT/docs"

# Start fresh: delete previous bundle if it exists
rm -rf "$BUNDLE_ROOT"
mkdir -p "$BUNDLE_PKGS"

##############################################
# 1) Build .tgz tarballs for all packages
##############################################
"$BASE_DIR/scripts/build-tgz.sh"

echo "📦 Staging tarballs into $BUNDLE_PKGS ..."
# Collect all produced tgz files under packages/*/*.tgz
TGZS=$(find "$PACKAGES_DIR" -maxdepth 2 -type f -name "*.tgz" | sort || true)
if [ -z "$TGZS" ]; then
  echo "⚠️  No tgz files found under packages/. Did builds succeed?" >&2
  exit 1
fi
OLDIFS=$IFS; IFS=$'\n'
for TGZ in $TGZS; do
  REL=${TGZ#${PACKAGES_DIR}/}
  PKG_DIR=${REL%%/*}
  mkdir -p "$BUNDLE_PKGS/$PKG_DIR"
  cp -f "$TGZ" "$BUNDLE_PKGS/$PKG_DIR/"
  echo "   ➕ $(basename "$TGZ") → sdk-bundle/packages/$PKG_DIR/"
done
IFS=$OLDIFS

##############################################
# 2) (No offline starter/CLI) — Use TGZ via npx
##############################################
echo "🛠️  Skipping offline starter and CLI binary; use the create tgz via npx."

##############################################
# 3) Build docs site and add local server
##############################################
echo "📚 Building docs static site..."
set +e
pnpm -s docs:build
DOC_BUILD_STATUS=$?
set -e

SRC_DOCS_DIST="$BASE_DIR/docs/.vitepress/dist"
if [ $DOC_BUILD_STATUS -eq 0 ] && [ -d "$SRC_DOCS_DIST" ]; then
  echo "📁 Copying built docs → $BUNDLE_DOCS ..."
  mkdir -p "$BUNDLE_DOCS"
  cp -R "$SRC_DOCS_DIST/"* "$BUNDLE_DOCS/"
else
  echo "⚠️  Built docs not found; copying raw docs/ instead." >&2
  cp -R "$BASE_DIR/docs" "$BUNDLE_DOCS"
fi

# Add a tiny static file server (no external deps) for the docs folder
cat > "$BUNDLE_DOCS/server.mjs" << 'SRV'
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = process.cwd();
const PORT = process.env.PORT || 8082;

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url || '/');
  let pathname = decodeURIComponent(parsed.pathname || '/');
  const filePath = path.join(ROOT, pathname);
  const candidates = [];
  const hasExt = path.extname(filePath) !== '';
  if (pathname.endsWith('/')) {
    candidates.push(path.join(ROOT, pathname, 'index.html'));
  }
  candidates.push(filePath);
  if (!hasExt) {
    candidates.push(filePath + '.html');
    candidates.push(path.join(filePath, 'index.html'));
  }
  candidates.push(path.join(ROOT, 'index.html')); // SPA-style fallback

  (function tryNext(i) {
    if (i >= candidates.length) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const f = candidates[i];
    fs.readFile(f, (err, data) => {
      if (err) return tryNext(i + 1);
      const ext = path.extname(f).toLowerCase();
      const mime = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
      }[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.end(data);
    });
  })(0);
});

server.listen(PORT, () => {
  console.log(`Docs server running at http://localhost:${PORT}`);
});
SRV

cat > "$BUNDLE_DOCS/package.json" << 'PKG'
{
  "name": "iwsdk-docs-offline",
  "private": true,
  "type": "module",
  "scripts": {
    "serve": "node server.mjs"
  }
}
PKG

##############################################
# 4) Write a bundle README with quick instructions
##############################################
cat > "$BUNDLE_ROOT/README.md" << 'README'
# Immersive Web SDK – Local Bundle

This folder contains an SDK bundle for local evaluation.

Structure:
- packages/ – .tgz packages of the SDK (including @iwsdk/create)
- docs/     – prebuilt static documentation site with a local server

Use the Create CLI (from bundle root):
- npx --yes --package=./packages/create/iwsdk-create.tgz create-iwsdk

Serve the Docs (independent of CLI):
- cd docs && npm run serve → open http://localhost:8082

Notes:
- The generated starter apps will install dependencies from the tarballs in ./packages via local `file:` paths.
- `@iwsdk/reference` bundles its corpus and works offline once installed.
README

echo "🎁 Bundle ready at: $BUNDLE_ROOT"
echo "📦 Packages:   $BUNDLE_PKGS"
echo "📚 Docs:       $BUNDLE_DOCS (run: npm run serve)"
