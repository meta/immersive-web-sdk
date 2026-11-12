#!/usr/bin/env bash
# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

# Build an SDK bundle directory ready for distribution (e.g., S3 upload).
# The output can be used with `npx @iwsdk/create my-app --canary`
# (uses the default CDN URL) or `--canary https://my-cdn.example.com/sdk-bundle/`.
# The reference corpus ships inside the @iwsdk/reference tarball.
#
# Output structure:
#   sdk-bundle/
#     bundle.json                    ← manifest
#     packages/
#       core/iwsdk-core.tgz
#       locomotor/iwsdk-locomotor.tgz
#       ...
#
# Starter source is embedded in @iwsdk/create and is intentionally absent from
# this dependency bundle.

set -euo pipefail

echo "📦 Building SDK bundle for distribution..."

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGES_DIR="$BASE_DIR/packages"
OUTPUT_DIR="$BASE_DIR/sdk-bundle"

# Start fresh
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/packages"

##############################################
# 1) Build all SDK packages
##############################################
echo "🔨 Building SDK packages..."
"$BASE_DIR/scripts/build-tgz.sh"

##############################################
# 2) Collect @iwsdk/* tgz files into packages/
##############################################
echo "📥 Collecting @iwsdk/* tgz files..."

for TGZ in "$PACKAGES_DIR"/*/*.tgz; do
  if [ -f "$TGZ" ]; then
    BASENAME=$(basename "$TGZ")
    # Derive the monorepo subdirectory name (e.g. core, xr-input, locomotor)
    SUBDIR=$(basename "$(dirname "$TGZ")")

    # Skip @iwsdk/create — it's the CLI tool, not a project dependency
    if [ "$SUBDIR" = "create" ]; then
      echo "   ⏭️  skipping packages/$SUBDIR/$BASENAME (CLI tool)"
      continue
    fi

    mkdir -p "$OUTPUT_DIR/packages/$SUBDIR"
    cp -f "$TGZ" "$OUTPUT_DIR/packages/$SUBDIR/$BASENAME"
    echo "   ➕ packages/$SUBDIR/$BASENAME"
  fi
done

##############################################
# 3) Generate bundle.json manifest
##############################################
echo "📝 Generating bundle.json manifest..."

# Use Node.js to scan the packages/ subdirectories and produce bundle.json.
# This avoids bash associative arrays which require bash 4+ (macOS ships 3.x).
node -e "
const fs = require('fs');
const path = require('path');
const outputDir = '$OUTPUT_DIR';
const packagesDir = path.join(outputDir, 'packages');
const sdkVersion = JSON.parse(
  fs.readFileSync('$PACKAGES_DIR/core/package.json', 'utf8')
).version;

const packages = {};
for (const subdir of fs.readdirSync(packagesDir)) {
  const subdirPath = path.join(packagesDir, subdir);
  if (!fs.statSync(subdirPath).isDirectory()) continue;
  for (const file of fs.readdirSync(subdirPath)) {
    if (!file.endsWith('.tgz')) continue;
    // iwsdk-core.tgz -> core, iwsdk-vite-plugin-iwer.tgz -> vite-plugin-iwer
    const stem = file.replace(/\.tgz$/, '').replace(/^iwsdk-/, '');
    packages['@iwsdk/' + stem] = 'packages/' + subdir + '/' + file;
  }
}

const manifest = {
  schemaVersion: 1,
  sdkVersion,
  packages,
};
fs.writeFileSync(
  path.join(outputDir, 'bundle.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log('   ➕ bundle.json (sdkVersion: ' + sdkVersion + ')');
"

##############################################
# Done
##############################################
echo ""
echo "🎉 SDK bundle ready at: $OUTPUT_DIR"
echo ""
echo "📋 Contents:"
ls -la "$OUTPUT_DIR"/packages/*/*.tgz 2>/dev/null || echo "   (No tgz files found)"
echo ""
echo "💡 Usage:"
echo "   Canary: npx @iwsdk/create my-app --canary"
echo "   Remote: Upload sdk-bundle/ to S3, then:"
echo "           npx @iwsdk/create my-app --canary https://my-cdn.example.com/sdk-bundle/"
echo "   Local:  npx serve ./sdk-bundle -l 3456"
echo "           npx @iwsdk/create my-app --canary http://localhost:3456"
