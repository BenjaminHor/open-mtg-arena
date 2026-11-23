# CLAUDE.md

This repo is a free, non-commercial fan project: Open MTG Arena, a Magic: The Gathering game in the browser in the
spirit of MTG Arena. Its rules engine (Rust, compiled to WebAssembly) and its React/TypeScript client began as a copy
of phase.rs at v0.131.0 (D-177, NOTICE); the repo diverges freely from it. Everything runs in the browser, offline
once loaded. There is no server, no online multiplayer and no desktop app (the owner's choice, D-177). The next goals
are an LLM-powered opponent and a single-player RPG or roguelike on the same engine (docs/roadmap.md).

The project owner sets requirements, playtests and judges rulings. Claude Code does most of the design and
implementation.

## Read before working

1. `docs/status.md`: what's done, what's in progress, what's next. Read it first, every session.
2. `docs/decisions.md`: decisions already made (D-177 is the move to this codebase). Don't reverse one without
   asking the owner. Record new ones there.
3. `docs/engine/`: the engine and client's own docs, as they came with the code (some still describe parts since
   removed: multiplayer, servers, the desktop app).
4. `docs/phase-rs-evaluation.md`: what this codebase is, its size, its strengths and its known problems.

Read these when the task touches their area: `docs/vision.md` (product goals), `docs/ui.md` (the "Feel" targets:
Arena-level polish, touch, the folded and unfolded phone; much of it was written for our earlier client and is
being re-checked against this one), `docs/data-sources.md` (the CR, Scryfall, MTGJSON and their terms),
`docs/llm-opponent.md` (the LLM opponent's design).

## The rules are the spec

The Comprehensive Rules (CR) are in `rules/`, one small file per section (see `rules/README.md`). **Never implement
a rule from memory.** Look it up, then cite it as `CR 601.2c` in code comments and tests.

- `node tools/rules/rule.mjs 601.2` prints a rule and its subrules.
- `node tools/rules/rule.mjs --search "phased out"` finds rules by phrase.
- `node tools/rules/rule.mjs --glossary trample` prints a glossary entry.

**The CR wins over every other spec** (D-020). If the CR seems ambiguous about a card, read the card's rulings, then
search for how players and judges read it (D-080); ask the owner only if that doesn't settle it, and record what you
found. Every rules change has a test that would catch it coming back.

## The engine

- Rust, in `crates/` (the engine, its card-text parser and syntax tree, the AI, the LLM opponent, the WASM
  bindings). The state is a pure reducer's: actions in, state and events out; seeded randomness; anything that waits
  for a player is a pending decision (`WaitingFor`) in state. Keep it that way.
- Cards come from MTGJSON's Oracle text, parsed into effects. A card the parser can't fully handle is marked
  unsupported, never guessed at.
- The engine is large and was written mostly by LLM agents; the owner accepted it isn't readable end to end (D-177).
  So before changing an area, read the code around it and its tests, and change the smallest thing that's right.
  New code should still be plain and well named, with comments that explain why and cite the CR.
- The shipped AI's search sees hidden cards at every difficulty (`determinization_samples = 0`); fair play
  (information parity, D-137) is a planned change, not yet made.

## Commands

Toolchain: the pinned nightly Rust in `rust-toolchain.toml` (with the wasm32 target), wasm-bindgen-cli at the
version in `Cargo.lock`, Node and pnpm as in `client/package.json`.

- `./scripts/build-wasm.sh release`: the engine and draft WASM for shipping. Full LTO at opt-level z needs more than
  15 GB of memory (CI's 16 GB runner); in a smaller container use `wasm-dev` and strip the `.debug_*` sections before
  wasm-bindgen (docs/status.md has the details).
- `./scripts/gen-card-data.sh`: card data from MTGJSON into `client/public/` (about 15 minutes cold). Never commit
  `card-data.json` (98 MB) or the other generated files.
- `cargo check -p <crate>`, `cargo test -p <crate>`: prefer one crate and a filter over the whole workspace (the
  engine crate alone takes about 20 minutes to build from scratch).
- In `client/`: `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm build`, `pnpm type-check`, `pnpm test`.

## Durable project memory

Session context gets compacted, and compaction loses information. **Anything important that isn't written to a file
in this repo should be treated as already lost.** Write it down when it happens, not at the end of the session:

| What | Where |
| --- | --- |
| A decision (technical or product), and why | `docs/decisions.md` |
| A requirement or preference the owner states | the relevant spec, with a decision entry if it changes direction |
| Task progress, what's next, handoff notes | `docs/status.md` |
| A question waiting on the owner | `docs/status.md` → Open questions |
| A bug or "this feels off" from the owner | `docs/status.md` → Known issues, then a test |

- If the owner says something that matters to the project, record it before replying with anything else.
- Before a long task, write the plan into `docs/status.md`.
- After a compaction (a hook reminds you), re-read `CLAUDE.md`, `docs/status.md` and the current spec, and trust
  them over the conversation summary.
- If a doc and the code disagree, find out which is right, then fix the other one.

## How to work

1. Pick a task from `docs/status.md` (or the owner's request). One task at a time.
2. Plan briefly: which CR sections apply, which files change, which tests prove it.
3. Write or update the tests first, then implement until they pass.
4. Check the behaviour yourself in the running app (and with Playwright screenshots for UI work), not only in tests.
5. For engine or rules changes, ask the `rules-judge` agent; for any non-trivial change, the `code-reviewer` agent;
   for match UI changes, the `ux-reviewer` agent, and look at the screenshots yourself.
6. Update `docs/status.md`, and `docs/decisions.md` for any design choice.
7. Commit on a feature branch, push, open a pull request. Changes reach `main` only through a pull request with CI
   green. Never push to `main` directly or force-push shared branches. Claude Code may merge its own PR once it
   checks out (D-027).

When the owner reports a bug in plain language, use the `fix-bug` skill: reproduce it as a failing test first.

## Don'ts

- No phase.rs branding anywhere the app or the docs present the project (names, logos, domains, links, contacts):
  the owner's rule (D-177). Its copyright line stays in LICENSE-MIT and NOTICE, as its license requires.
- No server, telemetry, cloud sync or analytics. The app calls only Scryfall (card images) and, for the LLM
  opponent, the provider the player chooses with their own key.
- Don't edit `rules/**` (except `rules/README.md`); it's generated from the CR.
- Don't commit MTGJSON or Scryfall downloads, card images, or generated card data.
- Don't weaken a test to make it pass. If a test is wrong, explain why in the commit.
- Don't add features outside the current milestone without asking.
