#!/bin/bash
# O-2's replay end to end (docs/odin-port.md, "Replaying recorded games"): translate the engine, build the replay
# harness against the translation, record a game with the Rust engine, and step it through the Odin engine.
# Usage: replay.sh <odingen> <work-dir> [matchup] [seed] [max-steps] [-- replay options]
# Needs client/public/card-data.json (scripts/gen-card-data.sh). Run from the repository root.
#
# By default the game is recorded by a scratch copy of the engine patched to log each function's first use inside
# the reducer (odingen trace-patch), so the report lists every untranslated function the game needs, by first use.
# That is one more engine build (memory-hungry: run nothing else heavy alongside it).
# TRACE=0 skips it: the game is recorded by target/tool/record-games (built if missing), or RECORDING=<file> replays
# an existing recording, and the report ranks only the first stub of each step.
set -euo pipefail
ODINGEN=$(realpath "$1"); WORK=$(realpath -m "$2"); shift 2
MATCHUP=red-vs-green; SEED=1; STEPS=400
[ $# -gt 0 ] && [ "$1" != "--" ] && { MATCHUP=$1; shift; }
[ $# -gt 0 ] && [ "$1" != "--" ] && { SEED=$1; shift; }
[ $# -gt 0 ] && [ "$1" != "--" ] && { STEPS=$1; shift; }
[ $# -gt 0 ] && [ "$1" = "--" ] && shift
ODIN=${ODIN:-odin}
TRACE=${TRACE:-1}
ROOT=$(pwd)
mkdir -p "$WORK/tx/engine" "$WORK/rec"
rm -rf "$WORK/tx/engine/json" "$WORK/tx/engine/rng" "$WORK/tx/engine/types"
cp -r odin/engine/json odin/engine/rng odin/engine/types "$WORK/tx/engine/"

# 1. Translate (stubbing what Odin rejects).
ODIN=$ODIN bash odin/tools/translate-loop.sh "$ODINGEN" "$WORK/tx/engine/types" src/ | grep -E "^round|^functions"

# 2. The harness, built so a stub reports itself and returns a zero value instead of panicking.
"$ODIN" build odin/tools/replay -collection:eng="$WORK/tx/engine" -define:VECTOR=true -no-escape-analysis -out:"$WORK/replay"

# 3. A fresh recording from the Rust engine.
NEEDS=()
if [ "$TRACE" = 1 ]; then
  rm -rf "$WORK/ws" && mkdir -p "$WORK/ws"
  cp Cargo.toml Cargo.lock rust-toolchain.toml "$WORK/ws/" && cp -r crates "$WORK/ws/"
  for d in client data scripts rules; do ln -s "$ROOT/$d" "$WORK/ws/$d"; done
  "$ODINGEN" trace-patch "$WORK/ws/crates"
  (cd "$WORK/ws" && CARGO_INCREMENTAL=0 CARGO_PROFILE_TOOL_DEBUG=0 CARGO_TARGET_DIR="$WORK/target" \
    cargo build -q --locked --profile tool -p phase-ai --bin record-games)
  FIRST_USE_LOG="$WORK/rec/first-use.tsv" \
    "$WORK/target/tool/record-games" client/public/card-data.json "$WORK/rec" "$MATCHUP" "$SEED" 1 "$STEPS"
  REC="$WORK/rec/$MATCHUP-$SEED.jsonl"
  NEEDS=("-needs:$WORK/rec/first-use.tsv" "-out:$WORK/needs.tsv")
elif [ -n "${RECORDING:-}" ]; then
  REC=$RECORDING
else
  TARGET=${CARGO_TARGET_DIR:-target}
  [ -x "$TARGET/tool/record-games" ] || cargo build --locked --profile tool -p phase-ai --bin record-games
  "$TARGET/tool/record-games" client/public/card-data.json "$WORK/rec" "$MATCHUP" "$SEED" 1 "$STEPS"
  REC="$WORK/rec/$MATCHUP-$SEED.jsonl"
fi

# 4. The harness checks itself on the first 50 steps (recorded results through its restore and comparison), then the
#    report.
"$WORK/replay" "$REC" -self-check -steps:50 | sed -n 2p | sed 's/^ */self-check: /'
"$WORK/replay" "$REC" "-translation:$WORK/tx/engine/types/translated.odin" "${NEEDS[@]}" "$@"
if [ "$TRACE" = 1 ]; then echo "the whole list: $WORK/needs.tsv"; fi
