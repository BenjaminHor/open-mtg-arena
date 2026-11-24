#!/usr/bin/env bash
# Builds the Odin engine for the client (D-187) into client/src/wasm-odin/: the WebAssembly module and the generated
# glue that serves the client's existing engine interface. Run the app on it with `cd client && ENGINE=odin pnpm dev`.
# Usage: build-odin-engine.sh [dev|release]   (dev: -o:minimal, a few seconds; release: -o:speed)
set -euo pipefail
MODE=${1:-dev}
ODIN=${ODIN:-odin}
OUT=client/src/wasm-odin
case "$MODE" in
  dev) OPT=minimal ;;
  release) OPT=speed ;;
  *) echo "usage: build-odin-engine.sh [dev|release]" >&2; exit 2 ;;
esac
mkdir -p "$OUT"
start=$(date +%s%N)
# A 16 MB stack, as the Rust engine's wasm has (.cargo/config.toml): decoding the card AST recurses deeply.
"$ODIN" build odin/engine-wasm -target:js_wasm32 -no-entry-point -o:"$OPT" \
  -extra-linker-flags:"-z stack-size=16777216" -out:"$OUT/engine_odin.wasm"
# Both of the client's engine modules (the game engine and the draft engine) are served by the one Odin module.
node odin/engine-wasm/gen-glue.mjs client/src/wasm/engine_wasm.d.ts engine_odin.wasm "$OUT/engine_wasm.js" >/dev/null
node odin/engine-wasm/gen-glue.mjs client/src/wasm/draft_wasm.d.ts engine_odin.wasm "$OUT/draft_wasm.js" >/dev/null
cp client/src/wasm/engine_wasm.d.ts client/src/wasm/draft_wasm.d.ts "$OUT/"
echo "Odin engine ($MODE) built in $(( ($(date +%s%N) - start) / 1000000 )) ms: $OUT"
