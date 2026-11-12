#!/usr/bin/env bash

set -euo pipefail

readonly IWSDK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly NODE_VERSION="24.22.1"
readonly NPM_VERSION="10.9.0"
readonly PNPM_VERSION="10.18.3"
readonly XR_INPUT_PROFILES_VERSION="1.0.20"

export CI=1
export COREPACK_HOME="${COREPACK_HOME:-${DISK_TEMP:-/tmp}/iwsdk-corepack}"
export HUSKY=0
export NPM_CONFIG_UPDATE_NOTIFIER=false
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PNPM_STORE_DIR="${PNPM_STORE_DIR:-${DISK_TEMP:-/tmp}/iwsdk-pnpm-store}"

if [[ -n "${SANDCASTLE_INSTANCE_ID:-}" ]]; then
  export HTTP_PROXY="${HTTP_PROXY:-http://fwdproxy:8080}"
  export HTTPS_PROXY="${HTTPS_PROXY:-http://fwdproxy:8080}"
  export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,.facebook.com,.fb.com,.fbinfra.net,.tfbnw.net},.facebook.net"
  export npm_config_registry="${npm_config_registry:-https://registry.x2p.facebook.net/}"
else
  export npm_config_registry="${npm_config_registry:-https://registry.npmjs.org}"
fi

export npm_config_https_proxy="${npm_config_https_proxy:-${HTTPS_PROXY:-}}"
export npm_config_proxy="${npm_config_proxy:-${HTTP_PROXY:-}}"
export npm_config_noproxy="${npm_config_noproxy:-${NO_PROXY:-}}"

if [[ -z "${npm_config_cafile:-}" && -f /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem ]]; then
  export npm_config_cafile=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
  export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$npm_config_cafile}"
fi

bootstrap_toolchain() {
  local node_arch
  case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64) node_arch=arm64 ;;
    *)
      echo "Unsupported Sandcastle architecture: $(uname -m)" >&2
      return 1
      ;;
  esac

  local toolchain_root
  toolchain_root="${DISK_TEMP:-/tmp}/iwsdk-toolchain-node-${NODE_VERSION}-npm-${NPM_VERSION}-pnpm-${PNPM_VERSION}-${node_arch}"

  if [[ ! -x "$toolchain_root/node_modules/.bin/node" || ! -x "$toolchain_root/node_modules/.bin/npm" || ! -x "$toolchain_root/node_modules/.bin/pnpm" ]]; then
    local bootstrap_npm
    if [[ -x /usr/bin/npm ]]; then
      bootstrap_npm=/usr/bin/npm
    else
      bootstrap_npm="$(command -v npm)"
    fi

    local bootstrap_node=""
    local -a bootstrap_packages=(
      "node-linux-${node_arch}@${NODE_VERSION}"
      "npm@${NPM_VERSION}"
      "pnpm@${PNPM_VERSION}"
    )
    if [[ -n "${SANDCASTLE_INSTANCE_ID:-}" ]]; then
      # Sandcastle blocks executable npm packages. Use its trusted Jellyfish
      # Node runtime and fetch the package managers from Meta's npm mirror.
      bootstrap_node="/usr/local/jellyfish/node-linux-${node_arch}"
      if [[ ! -f "$bootstrap_node" || ! -x "$bootstrap_node" ]]; then
        echo "Trusted Node.js binary is unavailable: $bootstrap_node" >&2
        return 1
      fi
      local actual_node_version
      if ! actual_node_version="$("$bootstrap_node" --version 2>/dev/null)"; then
        echo "Trusted Node.js binary could not run: $bootstrap_node" >&2
        return 1
      fi
      if [[ "$actual_node_version" != "v${NODE_VERSION}" ]]; then
        echo "Sandcastle requires Jellyfish Node.js v${NODE_VERSION}; found ${actual_node_version} at ${bootstrap_node}" >&2
        echo "Update NODE_VERSION or the Sandcastle Jellyfish installation before retrying." >&2
        return 1
      fi
      bootstrap_packages=("npm@${NPM_VERSION}" "pnpm@${PNPM_VERSION}")
    fi

    local temp_root="${toolchain_root}.tmp.$$"
    rm -rf "$temp_root"
    mkdir -p "$temp_root"
    trap 'rm -rf "$temp_root"' RETURN
    PATH="$(dirname "$bootstrap_npm"):/usr/bin:/bin:$PATH" \
      "$bootstrap_npm" install \
      --prefix "$temp_root" \
      --no-save \
      --ignore-scripts \
      --no-audit \
      --no-fund \
      "${bootstrap_packages[@]}"
    if [[ -n "$bootstrap_node" ]]; then
      install -m 0755 "$bootstrap_node" "$temp_root/node_modules/.bin/node"
    fi
    rm -rf "$toolchain_root"
    mv "$temp_root" "$toolchain_root"
    trap - RETURN
  fi

  cat >"$toolchain_root/node_modules/.bin/corepack" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

readonly bin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  pnpm|pnpm@*)
    shift
    exec "$bin_dir/pnpm" "$@"
    ;;
  --version|-v)
    echo "IWSDK pinned pnpm shim"
    ;;
  *)
    echo "Unsupported Corepack command: ${1:-}" >&2
    exit 2
    ;;
esac
EOF
  chmod +x "$toolchain_root/node_modules/.bin/corepack"

  export PATH="$toolchain_root/node_modules/.bin:$PATH"
  hash -r
}

bootstrap_toolchain

cd "$IWSDK_ROOT"

prepare_xr_input_profiles() {
  local output_file="packages/xr-input/src/gamepad/generated-profiles.ts"
  if [[ -f "$output_file" ]]; then
    return
  fi

  local assets_root
  assets_root="${DISK_TEMP:-/tmp}/iwsdk-xr-input-profiles-${XR_INPUT_PROFILES_VERSION}"
  local profiles_dir="$assets_root/node_modules/@webxr-input-profiles/assets/dist/profiles"
  if [[ ! -f "$profiles_dir/profilesList.json" ]]; then
    local temp_root="${assets_root}.tmp.$$"
    rm -rf "$temp_root"
    mkdir -p "$temp_root"
    trap 'rm -rf "$temp_root"' RETURN
    npm install \
      --prefix "$temp_root" \
      --no-save \
      --ignore-scripts \
      --no-audit \
      --no-fund \
      "@webxr-input-profiles/assets@${XR_INPUT_PROFILES_VERSION}"
    rm -rf "$assets_root"
    mv "$temp_root" "$assets_root"
    trap - RETURN
  fi

  node packages/xr-input/scripts/generate-input-profiles.js \
    --assets-dir "$profiles_dir"
}

case "${1:-}" in
  all)
    for check in preflight install lint format build typecheck unit; do
      echo "=== IWSDK quality: $check ==="
      bash "$IWSDK_ROOT/ci/sandcastle/run-check.sh" "$check"
    done
    ;;
  preflight)
    node --version
    node -e '
      const [major, minor] = process.versions.node.split(".").map(Number);
      const supported =
        (major === 20 && minor >= 19) ||
        (major === 22 && minor >= 12) ||
        major >= 24;
      if (!supported) {
        console.error(
          `Unsupported Node.js ${process.versions.node}; IWSDK requires ` +
            ">=20.19 <21, >=22.12 <23, or >=24",
        );
        process.exit(1);
      }
    '
    npm --version
    pnpm --version
    ;;
  install)
    pnpm install --frozen-lockfile --store-dir "$PNPM_STORE_DIR"
    ;;
  lint)
    pnpm lint
    ;;
  format)
    pnpm format:check
    ;;
  build)
    prepare_xr_input_profiles
    pnpm build:tgz:dev
    ;;
  typecheck)
    bash scripts/typecheck-examples.sh
    pnpm engines:audit
    pnpm three:check
    ;;
  bundle-size)
    node scripts/check-starter-bundle-size.mjs
    ;;
  unit)
    unit_status=0
    pnpm --filter './packages/**' --filter '!@iwsdk/vite-plugin-dev' \
      -r --no-bail --if-present run test || unit_status=$?
    pnpm --filter @iwsdk/vite-plugin-dev exec vitest run \
      --exclude='test/**/*.e2e.test.ts' \
      --exclude='test/editor-e2e.test.ts' \
      --exclude='test/editor-routing-e2e.test.ts' || unit_status=$?
    exit "$unit_status"
    ;;
  *)
    echo "Usage: $0 {all|preflight|install|lint|format|build|typecheck|bundle-size|unit}" >&2
    exit 2
    ;;
esac
