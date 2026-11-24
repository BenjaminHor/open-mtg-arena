#!/bin/bash
# Translates the engine (odingen translate-report) into <dir>, type-checks the result, and stubs every procedure
# the Odin type check rejects, until it checks cleanly. Usage: translate-loop.sh <odingen> <types-dir> [filter]
# Prints the report of the final round; <types-dir>/deny.txt lists the rejected procedures.
set -u
ODINGEN=$1; DIR=$2; FILTER=${3:-src/}
ODIN=${ODIN:-odin}
: > "$DIR/deny.txt"
for round in $(seq 1 30); do
  if ! ODINGEN_DENY="$DIR/deny.txt" "$ODINGEN" translate-report crates "$DIR" "$FILTER" > "$DIR/report.txt" 2>&1; then
    echo "odingen failed (see $DIR/report.txt)"; tail -3 "$DIR/report.txt"; exit 1
  fi
  out=$("$ODIN" check "$DIR" -no-entry-point -no-escape-analysis -max-error-count:100000 2>&1)
  status=$?
  # 0 is clean and 1 is type errors; anything else (killed for memory, a compiler assertion) checked nothing, and
  # its silence must not read as clean.
  if [ "$status" -gt 1 ]; then
    echo "odin check failed with status $status:"; echo "$out" | tail -5; exit 1
  fi
  errs=$(echo "$out" | grep -E "^/.*translated\.odin\([0-9]+:" | sed -E 's/.*translated\.odin\(([0-9]+):.*/\1/' | sort -un)
  other=$(echo "$out" | grep -E "Error" | grep -vc "translated\.odin" || true)
  if [ -z "$errs" ]; then
    echo "round $round: clean (errors outside translated.odin: $other)"
    break
  fi
  # The procedure each failing line belongs to: the nearest preceding `name :: proc` line.
  for l in $errs; do
    head -n "$l" "$DIR/translated.odin" | grep -E "^[A-Za-z_0-9]+ :: proc" | tail -1 | sed -E 's/ :: proc.*//'
  done | sort -u >> "$DIR/deny.txt"
  sort -u -o "$DIR/deny.txt" "$DIR/deny.txt"
  echo "round $round: $(echo "$errs" | wc -l) failing lines, $(wc -l < "$DIR/deny.txt") procedures denied"
done
grep -v "with adapter\|^  hand:" "$DIR/report.txt" | sed -n '/^functions/,+25p'
