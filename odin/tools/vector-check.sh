#!/bin/bash
# The vector check end to end (docs/odin-port.md, "Verifying translated code"): translate the engine, patch a scratch
# copy of it to log the calls of the procedures the harness covers, record a game with it, and replay the log against
# the translation. Usage: vector-check.sh <odingen> <work-dir> [matchup] [seed] [max-steps]
# Needs client/public/card-data.json (scripts/gen-card-data.sh). Run from the repository root. The patched engine build
# is memory-hungry: run nothing else heavy alongside it.
set -eu
ODINGEN=$(realpath "$1"); WORK=$(realpath -m "$2"); MATCHUP=${3:-red-vs-green}; SEED=${4:-1}; STEPS=${5:-400}
ODIN=${ODIN:-odin}
ROOT=$(pwd)
mkdir -p "$WORK/tx/engine"
cp -r odin/engine/json odin/engine/rng odin/engine/types "$WORK/tx/engine/" 2>/dev/null || true

# 1. Translate (stubbing what Odin rejects); writes translated.odin and vector_harness.odin.
ODIN=$ODIN bash odin/tools/translate-loop.sh "$ODINGEN" "$WORK/tx/engine/types" src/ | grep -E "^round|^functions"
grep -o '^	case "[^"]*"' "$WORK/tx/engine/types/vector_harness.odin" | sed 's/.*case "//; s/"$//' > "$WORK/vector_procs.txt"

# 2. A scratch copy of the workspace with those procedures wrapped to log their calls.
rm -rf "$WORK/ws" && mkdir -p "$WORK/ws"
cp Cargo.toml Cargo.lock rust-toolchain.toml "$WORK/ws/" && cp -r crates "$WORK/ws/"
for d in client data scripts rules; do ln -s "$ROOT/$d" "$WORK/ws/$d"; done
"$ODINGEN" vector-patch "$WORK/ws/crates" "$WORK/vector_procs.txt"
(cd "$WORK/ws" && CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2 CARGO_PROFILE_TOOL_DEBUG=0 CARGO_TARGET_DIR="$WORK/target" \
  cargo build -q --profile tool -p phase-ai --bin record-games)

# 3. Record one game with the log on.
mkdir -p "$WORK/rec"
VECTOR_LOG="$WORK/vec.jsonl" "$WORK/target/tool/record-games" client/public/card-data.json "$WORK/rec" "$MATCHUP" "$SEED" 1 "$STEPS"

# 4. Replay it against the translation.
"$ODIN" build odin/tools/vector_check -collection:eng="$WORK/tx/engine" -define:VECTOR=true -out:"$WORK/vector_check"
"$WORK/vector_check" "$WORK/vec.jsonl"
