# Brief for Odin engine coverage agents

You are growing the Odin rules engine (`odin/engine/game/`, package `game`) of Open MTG Arena so it fully supports
more cards of the 15,772-card pool (Scryfall `game:arena in:paper`). It is written from the Magic Comprehensive Rules
(CR), not translated from the Rust engine in `crates/` (D-187). Read `CLAUDE.md`, then skim `docs/status.md` from
"## Current goal: the new Odin engine" to the end, and `docs/decisions.md` D-187 to D-191.

## Rules you must follow
- **The CR is the spec.** Never implement a rule from memory. `node tools/rules/rule.mjs 601.2` prints a rule;
  `--search "phrase"`; `--glossary word`. Cite rules as `CR 601.2c` in comments and tests. If a card's rulings
  matter, they are in the card data (`rulings`).
- **Refuse, never guess.** A card is "supported" only if every part of it is carried out correctly. If the parsed
  data has lost words from the Oracle text (compare them!), add the card to `MISPARSED_CARDS` in `spells.odin` with
  a comment saying what was lost. If a shape is only partly right, make the support check refuse it.
- **No card that is supported now may be lost**, unless you find it was wrong (then say so in your report). Diff the
  supported-name sets before and after.
- Every behaviour you add gets a test in a NEW test file of your own under `odin/tests/game/` (package `game_test`;
  copy helpers from an existing test file as `@(private = "file")` procs rather than editing shared ones). Each test
  names a real card, cites the CR, and has a negative case. Don't weaken existing tests; if one is wrong, explain why.
- Keep the engine a pure reducer: anything waiting for a player is a `WaitingFor` prompt in the state. If you add a
  prompt, add it to `legal_actions`, `acting_player`, and make the AI (`ai.odin`) answer it.
- Don't edit `rules/**`, `odin/engine/types/generated_types.odin` (generated), or docs. Don't commit or push: leave
  your changes uncommitted in your worktree. Don't touch the main checkout at `/home/user/open-mtg-arena` (other
  agents and the lead work there and in sibling worktrees).
- Keep edits outside your family small and say what they are; other agents are changing the engine in parallel, so
  prefer new files for new code.
- New code is plain and well named, with comments that explain why and cite the CR.

## Tools (run from your worktree root, which I'll call $W)
- Odin compiler: `/home/user/odin-lang/odin/odin`. Type-check: `cd odin/engine/game && $ODIN check . -no-entry-point`.
- Build the WASM: `ODIN=/home/user/odin-lang/odin/odin ./scripts/build-odin-engine.sh dev` (writes
  `client/src/wasm-odin/`, untracked).
- Card data: `client/public/card-data.json` is generated and untracked; symlink it into your worktree:
  `ln -s /home/user/open-mtg-arena/client/public/card-data.json $W/client/public/card-data.json` (check first).
- Coverage: `node odin/engine-wasm/coverage.mjs` (first line: how many pool cards Odin fully supports), and
  `node odin/engine-wasm/coverage.mjs --examples "<gap name>"` for cards blocked by one gap. These read paths
  relative to the script's checkout, so run your worktree's copy. Node is at `/opt/node26/bin` if not on PATH.
- Support of named cards: `node odin/engine-wasm/sup.mjs "Card Name" ...` (reads its own checkout). It calls
  `odin_supported_cards`, the authoritative verdict.
- Tests: build `odin build odin/tests/game -build-mode:test -o:minimal -define:ODIN_TEST_TRACK_MEMORY=false
  -define:ODIN_TEST_THREADS=2 -out:<scratch>/gt` (add `-define:ODIN_TEST_NAMES=game_test.name1,game_test.name2` for a
  subset), run with `(ulimit -v 6000000; timeout -s KILL 300 <scratch>/gt)`. Delete test binaries after use: the
  disk is small (about 12 GB free, shared).
- Scratch files: only under your own folder
  `<the session scratchpad>/<your-family>/`. Don't
  overwrite other files in the scratchpad.
- Memory: keep at most 2 test threads and the ulimit above; four agents share 15 GB.

## Report (your final message)
Plain and short: coverage before → after (and that no card was lost, or which and why); what you built, with CR
citations; cards you refused as misparsed and what was lost; shapes still refused and why; problems you found in
cards that were already supported; edits outside your family; new prompts (the client must handle them: name the
`WaitingFor` kinds); your test file and test names. Say where your worktree is.
