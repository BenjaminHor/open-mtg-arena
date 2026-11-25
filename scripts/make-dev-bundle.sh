#!/usr/bin/env bash
# Packs the generated files a checkout needs to run the client (the engine and draft WebAssembly from
# build-wasm.sh, the card data and image indexes under client/public) into one archive, with a manifest naming the
# engine source they were built from. The Pages deploy publishes it, so a fresh checkout fetches it in seconds
# (scripts/fetch-dev-bundle.sh) instead of building Rust and generating card data (about 35 minutes).
# Usage: make-dev-bundle.sh <out-dir>   (run from the repository root, after build-wasm.sh and gen-card-data.sh)
set -euo pipefail
OUT=${1:?usage: make-dev-bundle.sh <out-dir>}
mkdir -p "$OUT"

# Every generated file the client reads: what git ignores under client/public and client/src/wasm.
FILES=$(git status --ignored --porcelain client/public client/src/wasm | sed -n 's/^!! //p')
if ! echo "$FILES" | grep -q 'client/src/wasm/engine_wasm_bg.wasm'; then
  echo "make-dev-bundle: no engine build in client/src/wasm (run scripts/build-wasm.sh first)" >&2
  exit 1
fi
if ! echo "$FILES" | grep -q 'client/public/card-data.json'; then
  echo "make-dev-bundle: no card data in client/public (run scripts/gen-card-data.sh first)" >&2
  exit 1
fi
# shellcheck disable=SC2086
tar -czf "$OUT/dev-bundle.tar.gz" $FILES

# The engine source the build came from: the git tree of crates/ and of Cargo.lock (fetch-dev-bundle.sh compares
# them with the checkout's, since a different engine needs its own build).
cat > "$OUT/manifest.json" <<EOF
{
  "commit": "$(git rev-parse HEAD)",
  "crates_tree": "$(git rev-parse HEAD:crates)",
  "cargo_lock": "$(git rev-parse HEAD:Cargo.lock)",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bytes": $(stat -c %s "$OUT/dev-bundle.tar.gz")
}
EOF
echo "dev bundle: $(du -h "$OUT/dev-bundle.tar.gz" | cut -f1), $(echo "$FILES" | wc -l) files"
