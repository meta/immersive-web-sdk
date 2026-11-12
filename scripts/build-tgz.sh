#!/bin/bash
# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

# Build script to create standalone tgz files for all packages.
# Fails fast when any package build, pack, or artifact validation step fails.

set -euo pipefail

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-reference-assets)
            # Accepted for older callers; the corpus is always built and bundled.
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
    shift
done

echo "🚀 Building standalone tgz packages..."

if command -v corepack >/dev/null 2>&1; then
    COREPACK_PNPM_VERSION="${COREPACK_PNPM_VERSION:-pnpm@10.18.3}"
    PNPM_CMD=(corepack "$COREPACK_PNPM_VERSION" --config.confirmModulesPurge=false)
elif command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm --config.confirmModulesPurge=false)
else
    echo "❌ pnpm is required. Install pnpm or enable corepack." >&2
    exit 1
fi

# Detect CI environment and set pnpm install flags
PNPM_INSTALL_FLAGS=""
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "🔍 CI environment detected, using --no-frozen-lockfile"
    PNPM_INSTALL_FLAGS="--no-frozen-lockfile"
fi

if [ ! -t 0 ]; then
    echo "🔍 Non-interactive shell detected, disabling pnpm module purge confirmation"
    PNPM_INSTALL_FLAGS="${PNPM_INSTALL_FLAGS:+$PNPM_INSTALL_FLAGS }--config.confirmModulesPurge=false"
fi

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNAME=$(uname)
if [[ "$UNAME" == CYGWIN* || "$UNAME" == MINGW* ]]; then
    # In windows, change base directory from '/c/Users/...' to 'C:/Users/...'
    BASE_DIR="${BASE_DIR:1:1}:${BASE_DIR:2}"
    BASE_DIR="${BASE_DIR^}"
    echo "Detected running on Windows, using $BASE_DIR as base directory"
fi
PACKAGES_DIR="$BASE_DIR/packages"
EXAMPLES_DIR="$BASE_DIR/examples"
LOCKFILE_BACKUP="$BASE_DIR/pnpm-lock.yaml.build-tgz.backup"
WORKSPACE_BACKUP="$BASE_DIR/pnpm-workspace.yaml.build-tgz.backup"

# A source checkout may not have workspace dependencies installed yet. The
# package build scripts run before the temporary packed-dependency installs
# below, so make the initial source build self-bootstrapping instead of failing
# with an indirect `rollup: command not found` error.
if [ ! -x "$BASE_DIR/node_modules/.bin/rollup" ]; then
    echo "📥 Workspace dependencies are missing; installing from the lockfile..."
    cd "$BASE_DIR"
    if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
        "${PNPM_CMD[@]}" install --no-frozen-lockfile
    else
        "${PNPM_CMD[@]}" install --frozen-lockfile
    fi
fi

# Package build order (dependencies first)
LEAF_PACKAGES=("scene-composition" "xr-input" "locomotor" "example-assets" "cli" "create" "reference-assets" "reference")
ROOT_PACKAGES=("core" "vite-plugin-dev")

# Function to backup package.json
backup_package_json() {
    local package_dir="$1"
    cp "$package_dir/package.json" "$package_dir/package.json.backup"
}

# Function to restore package.json
restore_package_json() {
    local package_dir="$1"
    if [ -f "$package_dir/package.json.backup" ]; then
        mv "$package_dir/package.json.backup" "$package_dir/package.json"
    fi
}

backup_workspace_state() {
    if [ -f "$BASE_DIR/pnpm-lock.yaml" ] && [ ! -f "$LOCKFILE_BACKUP" ]; then
        cp "$BASE_DIR/pnpm-lock.yaml" "$LOCKFILE_BACKUP"
    fi
    if [ -f "$BASE_DIR/pnpm-workspace.yaml" ] && [ ! -f "$WORKSPACE_BACKUP" ]; then
        cp "$BASE_DIR/pnpm-workspace.yaml" "$WORKSPACE_BACKUP"
    fi
}

restore_workspace_state() {
    if [ -f "$LOCKFILE_BACKUP" ]; then
        mv "$LOCKFILE_BACKUP" "$BASE_DIR/pnpm-lock.yaml"
    fi
    if [ -f "$WORKSPACE_BACKUP" ]; then
        mv "$WORKSPACE_BACKUP" "$BASE_DIR/pnpm-workspace.yaml"
    fi
}

# Create a versionless alias for a packed tarball (keeps the original too)
alias_tarball() {
    local tarball="$1"
    local dir="$(dirname "$tarball")"
    local base="$(basename "$tarball")"
    # Strip the trailing -<version>.tgz, including prerelease suffixes such as
    # -1.0.0-rc.0.tgz
    local alias_name="$(printf '%s' "$base" | sed -E 's/-[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]*)?\.tgz$/.tgz/')"
    local alias_path="$dir/$alias_name"
    if [ "$alias_path" != "$tarball" ]; then
        mv -f "$tarball" "$alias_path"
        echo "$alias_path"
    else
        echo "$tarball"
    fi
}

validate_declared_entrypoints() {
    local package_dir="$1"
    node - "$package_dir/package.json" <<'NODE'
const fs = require('fs');
const pkgPath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const path = require('path');
const root = path.dirname(pkgPath);
const missing = [];
for (const field of ['main', 'module', 'types', 'typings']) {
  const value = pkg[field];
  if (typeof value === 'string' && !fs.existsSync(path.join(root, value))) {
    missing.push(`${field}: ${value}`);
  }
}
if (typeof pkg.bin === 'string' && !fs.existsSync(path.join(root, pkg.bin))) {
  missing.push(`bin: ${pkg.bin}`);
}
if (pkg.bin && typeof pkg.bin === 'object') {
  for (const [name, value] of Object.entries(pkg.bin)) {
    if (typeof value === 'string' && !fs.existsSync(path.join(root, value))) {
      missing.push(`bin.${name}: ${value}`);
    }
  }
}
if (missing.length > 0) {
  console.error(`Missing declared package entrypoints for ${pkg.name}:`);
  for (const entry of missing) {
    console.error(`  - ${entry}`);
  }
  process.exit(1);
}
NODE
}

validate_tarball() {
    local package_dir="$1"
    local tarball="$2"
    local package_name="$3"

    if [ ! -s "$tarball" ]; then
        echo "❌ Empty or missing tarball for $package_name: $tarball" >&2
        exit 1
    fi


    node - "$package_dir/package.json" "$tarball" <<'NODE'
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const pkgPath = process.argv[2];
const tarball = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((entry) => entry.replace(/^\.\//, '').replace(/^package\//, ''));
const missing = [];
function expectEntry(label, value) {
  if (typeof value !== 'string') return;
  const normalized = value.replaceAll('\\', '/');
  if (!entries.includes(normalized)) {
    missing.push(`${label}: ${value}`);
  }
}
for (const field of ['main', 'module', 'types', 'typings']) {
  expectEntry(field, pkg[field]);
}
if (typeof pkg.bin === 'string') {
  expectEntry('bin', pkg.bin);
}
if (pkg.bin && typeof pkg.bin === 'object') {
  for (const [name, value] of Object.entries(pkg.bin)) {
    expectEntry(`bin.${name}`, value);
  }
}
if (missing.length > 0) {
  console.error(`Tarball for ${pkg.name} is missing declared entrypoints:`);
  for (const entry of missing) {
    console.error(`  - ${entry}`);
  }
  process.exit(1);
}
NODE
}

build_and_pack_package() {
    local package_dir="$1"
    local build_script="$2"
    local package_name="$3"

    cd "$package_dir"

    # Clean previous builds
    rm -rf lib dist build *.tgz

    if ! "${PNPM_CMD[@]}" run "$build_script"; then
        echo "❌ Build failed for $package_name (script: $build_script)" >&2
        exit 1
    fi
    echo "     ✅ Build completed"

    validate_declared_entrypoints "$package_dir"

    local pack_output
    if ! pack_output=$("${PNPM_CMD[@]}" pack); then
        echo "❌ Pack failed for $package_name" >&2
        exit 1
    fi
    printf '%s\n' "$pack_output"

    local tarball
    tarball=$(printf '%s\n' "$pack_output" | tail -n1)
    if [ -z "$tarball" ]; then
        echo "❌ Could not determine packed tarball for $package_name" >&2
        exit 1
    fi

    validate_tarball "$package_dir" "$tarball" "$package_name"

    echo "     📦 Packed:  $tarball"
    local alias_path
    alias_path=$(alias_tarball "$tarball")
    validate_tarball "$package_dir" "$alias_path" "$package_name"
    if [ -n "$alias_path" ]; then
        echo "     🔁 Renamed: $alias_path"
    fi
}

# Function to build and pack leaf packages (no workspace dependencies)
build_leaf_packages() {
    echo "📦 Building leaf packages (no workspace dependencies)..."

    for package in "${LEAF_PACKAGES[@]}"; do
        local package_dir="$PACKAGES_DIR/$package"

        if [ ! -d "$package_dir" ]; then
            echo "❌ Package directory not found: $package_dir" >&2
            exit 1
        fi

        echo "   Building $package..."

        if [ "$package" = "reference-assets" ]; then
            # Private producer: build the corpus that @iwsdk/reference bundles.
            cd "$package_dir"
            rm -rf dist
            if ! "${PNPM_CMD[@]}" run build; then
                echo "❌ Build failed for $package" >&2
                exit 1
            fi
            echo "     ✅ Corpus built"
            continue
        fi

        build_and_pack_package "$package_dir" "build" "$package"
    done
}

# Function to replace workspace dependencies with file dependencies
replace_workspace_deps() {
    local package_dir="$1"
    local package_json="$package_dir/package.json"

    echo "   🔄 Replacing workspace: dependencies with file: dependencies..."

    # Use Node.js to replace workspace dependencies
    node -e "
    const fs = require('fs');
    const path = require('path');
    const pkgPath = '$package_json';
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    function repl(deps){
      if (!deps) return;
      for (const [name, ver] of Object.entries(deps)){
        if (!name.startsWith('@iwsdk/')) continue;
        const short = name.replace('@iwsdk/', '');
        const versionedRe = new RegExp('^file:\\\\.{2}\\/' + short + '\\/iwsdk-' + short + '-.*\\\\.tgz$');
        const isWorkspace = String(ver).startsWith('workspace:');
        const isVersionedFile = versionedRe.test(String(ver));
        if (!(isWorkspace || isVersionedFile)) continue;
        const rel = path.join('..', short, 'iwsdk-' + short + '.tgz');
        deps[name] = 'file:' + rel;
        console.log('     Replaced', name, '→', deps[name]);
      }
    }
    repl(pkg.dependencies); repl(pkg.devDependencies); repl(pkg.peerDependencies);
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    "
}

# Function to build root packages (with workspace dependencies)
build_root_packages() {
    echo "📦 Building root packages (with workspace dependencies)..."

    for package in "${ROOT_PACKAGES[@]}"; do
        local package_dir="$PACKAGES_DIR/$package"

        if [ ! -d "$package_dir" ]; then
            echo "❌ Package directory not found: $package_dir" >&2
            exit 1
        fi

        echo "   Building $package..."
        cd "$package_dir"

        # Backup original package.json and workspace install state because the
        # temporary file: dependencies should never leak into the lockfile.
        backup_package_json "$package_dir"
        backup_workspace_state

        # Replace workspace dependencies with file dependencies
        replace_workspace_deps "$package_dir"

        # Keep the installed workspace links for the build. The rewritten
        # manifest is consumed by `pnpm pack`; generated-app tests validate the
        # resulting tarballs with their file: dependencies installed.
        build_and_pack_package "$package_dir" "build" "$package"

        # Restore the original workspace manifest and lockfile.
        echo "   🔄 Restoring workspace dependencies..."
        restore_package_json "$package_dir"
        restore_workspace_state
    done
}

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up backup files and temporary changes..."
    for package in "${ROOT_PACKAGES[@]}"; do
        local package_dir="$PACKAGES_DIR/$package"
        if [ -f "$package_dir/package.json.backup" ]; then
            restore_package_json "$package_dir"
            restore_workspace_state
        fi
    done
    find "$PACKAGES_DIR" -name "package.json.backup" -delete
}

# Trap cleanup on exit (success or failure)
trap cleanup EXIT

# Main execution
main() {
    echo "Building standalone tgz packages for examples..."
    echo ""

    # Remove artifacts from packages that may have been deleted since the
    # previous build so they cannot leak into listings or SDK bundles.
    find "$PACKAGES_DIR" -mindepth 2 -maxdepth 2 -type f -name 'iwsdk-*.tgz' -delete

    # Step 1: Build packages without workspace dependencies
    build_leaf_packages
    echo ""

    # Step 2: Build packages with workspace dependencies (with temporary changes)
    build_root_packages
    echo ""

    echo "🎉 All packages built!"
    echo ""
    echo "📋 Available tgz files:"
    find "$PACKAGES_DIR" -maxdepth 2 -name 'iwsdk-*.tgz' -print | sort
    echo ""
    echo "💡 Examples can install the package tarballs from their package directories, for example:"
    echo "   npm install ../../packages/core/iwsdk-core.tgz"
    echo "   npm install ../../packages/cli/iwsdk-cli.tgz --save-dev"
}

main
