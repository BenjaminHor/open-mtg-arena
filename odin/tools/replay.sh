#!/bin/bash
# O-2's replay end to end (docs/odin-port.md, "Replaying recorded games"): translate the engine, build the replay
# harness against the translation, record a game with the Rust engine, and step it through the Odin engine.
# Usage: replay.sh <odingen> <work-dir> [matchup] [seed] [max-steps] [-- replay options]
# Needs client/public/card-data.json (scripts/gen-card-data.sh) and the record-games binary, built if missing
# (cargo build --profile tool -p phase-ai --bin record-games). Run from the repository root.
# RECORDING=<file> replays an existing recording instead of recording one (matchup, seed and steps are then unused).
set -eu
ODINGEN=$(realpath "$1"); WORK=$(realpath -m "$2"); shift 2
MATCHUP=red-vs-green; SEED=1; STEPS=400
[ $# -gt 0 ] && [ "$1" != "--" ] && { MATCHUP=$1; shift; }
[ $# -gt 0 ] && [ "$1" != "--" ] && { SEED=$1; shift; }
[ $# -gt 0 ] && [ "$1" != "--" ] && { STEPS=$1; shift; }
[ $# -gt 0 ] && [ "$1" = "--" ] && shift
ODIN=${ODIN:-odin}
TARGET=${CARGO_TARGET_DIR:-target}
mkdir -p "$WORK/tx/engine"
rm -rf "$WORK/tx/engine/json" "$WORK/tx/engine/rng" "$WORK/tx/engine/types"
cp -r odin/engine/json odin/engine/rng odin/engine/types "$WORK/tx/engine/"

# 1. Translate (stubbing what Odin rejects).
ODIN=$ODIN bash odin/tools/translate-loop.sh "$ODINGEN" "$WORK/tx/engine/types" src/ | grep -E "^round|^functions"

# 2. The harness, built so a stub reports itself and returns a zero value instead of panicking.
"$ODIN" build odin/tools/replay -collection:eng="$WORK/tx/engine" -define:VECTOR=true -no-escape-analysis -out:"$WORK/replay"

# 3. A fresh recording from the Rust engine.
if [ -n "${RECORDING:-}" ]; then
  REC=$RECORDING
else
  [ -x "$TARGET/tool/record-games" ] || cargo build --locked --profile tool -p phase-ai --bin record-games
  mkdir -p "$WORK/rec"
  "$TARGET/tool/record-games" client/public/card-data.json "$WORK/rec" "$MATCHUP" "$SEED" 1 "$STEPS"
  REC="$WORK/rec/$MATCHUP-$SEED.jsonl"
fi

# 4. The report.
"$WORK/replay" "$REC" "$@"
