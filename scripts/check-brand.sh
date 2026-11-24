#!/usr/bin/env bash
# Fails if the name of the project this one was copied from appears in what the app ships (D-177: no phase.rs
# branding wherever the app or the docs present the project). Usage: scripts/check-brand.sh <dir-or-file>...
#
# CI runs it over the client's sources (ci.yml) and Pages over the whole built site, WASM included, before
# publishing (pages.yml). Only explicit tokens are matched, never the bare word "phase": phases and phasing are
# Magic rules, and the engine has a source file named phase.rs (types/phase.rs), so a "phase.rs" that follows a
# path separator or a word character is a file name, not the brand.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <dir-or-file>..." >&2
  exit 2
fi

# Case-sensitive ("Phasers" is a card). phase-rs (the GitHub org and the domain phase-rs.dev), phase.rs as a name, phaseRs/PhaseRs identifiers, and
# the upstream's donation and chat links.
PATTERN='[Pp]hase-rs|PHASE-RS|(^|[^/A-Za-z0-9_.-])[Pp]hase\.rs([^A-Za-z0-9_]|$)|[pP]haseRs\b|ko-fi\.com|discord\.gg'

# -a reads binaries (the WASM, images' metadata) as text; -I would skip them.
if hits=$(grep -rEano --exclude-dir=node_modules -e "$PATTERN" "$@" 2>/dev/null); then
  echo "Brand check failed: the upstream project's name or links are still in:" >&2
  # One line per file, with the first few matches, so a 98 MB JSON doesn't flood the log.
  echo "$hits" | awk -F: '{ f=$1; if (count[f]++ < 3) print f ": " substr($0, length(f) + 2, 160) }' | sort -u >&2
  echo "($(echo "$hits" | cut -d: -f1 | sort -u | wc -l) files)" >&2
  exit 1
fi
echo "Brand check passed: $*"
