#!/usr/bin/env bash
# Captures the Rust engine's integration tests as language-neutral test files for the Odin engine (D-187, step 1):
# every action a scenario test applies is written, with its starting state and result, to
# <out>/<test name>.jsonl.gz (crates/engine/src/game/scenario_capture.rs). Then the Rust engine replays them
# (odin/engine-wasm/run-captured.mjs rust <out>) to check the files, and the Odin engine is measured against them.
# The corpus is generated, never committed (about 25 times smaller than raw JSON, still large).
# Usage: capture-rust-tests.sh <out dir> [test name filter]
set -euo pipefail
OUT=${1:?usage: capture-rust-tests.sh <out dir> [filter]}
FILTER=${2:-}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
for shard in integration integration_2 integration_3 integration_4; do
  echo "== $shard"
  # A failing Rust test still leaves its captured steps; the replay decides which files are usable.
  ENGINE_CAPTURE_DIR="$OUT" CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-3} \
    cargo test -q -p phase-engine --test "$shard" -- $FILTER 2>&1 | grep -E "^test result|^error" || true
done
echo "captured $(ls "$OUT" | wc -l) tests, $(du -sh "$OUT" | cut -f1)"
