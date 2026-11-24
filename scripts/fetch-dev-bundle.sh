#!/usr/bin/env bash
# Fetches the prebuilt engine WebAssembly and generated card data that the live site was built with
# (scripts/make-dev-bundle.sh, published by the Pages deploy of main), so the client runs without building Rust or
# generating card data. Then `cd client && pnpm dev`, and client changes show in the browser at once.
#
# The bundle fits only a checkout whose engine source (crates/, Cargo.lock) is main's as published: after an engine
# change, build the engine instead (scripts/build-wasm.sh wasm-dev). --force fetches regardless (for example to get
# the card data while building your own engine).
# Usage: fetch-dev-bundle.sh [--force]   (run from the repository root)
set -euo pipefail
BASE=${DEV_BUNDLE_URL:-https://benjaminhor.github.io/open-mtg-arena/dev-bundle}
FORCE=${1:-}

manifest=$(curl -fsSL "$BASE/manifest.json") || {
  echo "fetch-dev-bundle: no bundle at $BASE (has main been deployed since the bundle was added?)" >&2
  exit 1
}
field() { echo "$manifest" | sed -n "s/.*\"$1\": *\"\\([^\"]*\\)\".*/\\1/p"; }

local_crates=$(git rev-parse HEAD:crates)
local_lock=$(git rev-parse HEAD:Cargo.lock)
dirty=""
git diff --quiet HEAD -- crates Cargo.lock || dirty="yes"
if [ "$FORCE" != "--force" ]; then
  if [ "$(field crates_tree)" != "$local_crates" ] || [ "$(field cargo_lock)" != "$local_lock" ] || [ -n "$dirty" ]; then
    echo "fetch-dev-bundle: this checkout's engine differs from the published build ($(field commit | cut -c1-8))." >&2
    echo "  Build it instead: ./scripts/build-wasm.sh wasm-dev   (or pass --force to fetch anyway)" >&2
    exit 2
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
start=$(date +%s)
curl -fsSL "$BASE/dev-bundle.tar.gz" -o "$tmp/dev-bundle.tar.gz"
tar -xzf "$tmp/dev-bundle.tar.gz"
echo "fetched the engine and card data built from $(field commit | cut -c1-8) in $(( $(date +%s) - start )) s"
