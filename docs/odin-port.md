# Odin port plan

Status: approved in shape, 2026-11-24 (D-179): the parser stays Rust, the RNG is bit-exact, the AI is ported later. The owner's goal (D-178): "iterate safely on porting this
from rust to Odin as efficiently and quickly as possible", as its own milestones, with two agreed ideas: **safely**, by
recorded reference games from the Rust engine that ported pieces must reproduce; **quickly**, by vertical slices behind
the client's existing interface.

## What we're porting (survey, 2026-11-24)

| Part | Production lines (approx.) | Port? |
| --- | --- | --- |
| Engine (`crates/engine`: game/, types/, analysis/, database/, ai_support/) | ~723k (plus ~868k inline tests, ~1.4M in tests/) | Yes, in slices |
| AST types (`crates/phase-ast`): Effect ~241 variants, TriggerMode 176, Keyword 200, StaticMode 125 | ~68k | Yes, first (the data model) |
| AI (`crates/phase-ai`) | ~84k | Later, or a new AI |
| Card-text parser (`crates/phase-parser`) | ~329k | **No, not at first** (see below) |
| WASM bindings (`crates/engine-wasm`): ~94 exports | ~3.2k | Re-made in Odin, same JSON |
| Draft (`draft-core`, `draft-wasm`) | ~40k incl. tests | Later |

Facts that shape the plan:

- **The engine runs parsed data, not card text.** `oracle-gen` (a Rust binary) parses MTGJSON's Oracle text into the
  AST and writes it into `card-data.json`; at runtime `load_card_database` only deserializes it. So the Rust parser can
  stay as an offline build tool and the Odin engine reads the same `card-data.json`. A few runtime paths still call the
  parser (dungeon rooms, token rules text, deck copy limits, an exert header); those inputs are fixed strings that can be
  parsed ahead of time into data.
- **The client talks JSON.** Every export takes and returns JSON shaped by the Rust serde attributes (`WaitingFor` is
  `{"type": ..., "data": ...}`); the client's 453 TS types (`client/src/adapter/types.ts`) are hand-written to match. An
  Odin engine that speaks the same JSON plugs in behind `engine-worker.ts` with no client change. A vs-AI match uses a
  small set of calls: `load_card_database`, `initialize_game`, `submit_action`, `get_game_state`,
  `get_legal_actions_for_viewer_js`, the interaction/preview calls, the AI proposal calls, save/restore and replay.
- **Games are deterministic and replayable.** `GameRng` is ChaCha20 seeded from a u64; a replay is a header (formats,
  seed, decks) plus the action list (`types/replay.rs`). Headless AI-vs-AI games run reproducibly from a seed
  (`ai-duel` in measurement mode). There is no corpus of recorded games yet.
- **The tests are Rust-shaped.** ~35,000 engine tests, mostly `GameScenario` builders that parse Oracle text at test time.
  They can't be run against Odin directly, but their runs can be recorded (below).
- **Dependencies to replace:** serde/serde_json (Odin's `core:encoding/json` plus hand-written mappings), `im`
  persistent collections (cheap state clones for AI search; Odin: plain arrays with explicit copies, arenas), rand 0.9 +
  rand_chacha (must be reproduced bit for bit for seeds to replay: ChaCha20, `shuffle`, `random_range`, `choose`,
  `random_bool`), strum, sha2, smallvec, petgraph (2 files), nom (engine side small once the parser stays Rust).

## The approach

1. **One reference, recorded once.** The Rust engine records games and test runs as language-neutral JSON: the start
   (seed, decks, formats, or a full starting state), each action, and after each action a normalized *checkpoint* (zones
   and their order, life, counters, the stack, `waiting_for`, legal actions, the RNG position). The Odin engine replays
   the same actions and must produce the same checkpoints. This is the safety net: a ported piece is done when its
   recordings match, and a regression shows the exact action where the two engines part.
2. **Two sources of recordings.** (a) Games: seeded AI-vs-AI games from `ai-duel` across formats and the bundled decks,
   thousands of them, cheap to make more. (b) Tests: instrument `GameScenario`/`GameRunner` so each of the ~20,000
   integration tests also dumps its starting state, actions and final checkpoint: rules edge cases the AI games rarely
   reach, in the same format.
3. **Slices by cards, not by files.** The Odin engine grows by mechanics. A slice is "these effects, triggers, statics and
   keywords work", proven by the recordings that use only cards those cover. A card counts as Odin-ready when every node
   of its AST is ported; the share of ready cards (per format) is the progress measure, ordered by how many cards each
   AST node unlocks (counted from `card-data.json`).
4. **Shadow first, then switch.** In the client (behind a developer flag) the Odin engine runs alongside the Rust one on
   the same action stream and reports the first divergence; the owner keeps playing on Rust. When a deck is fully
   Odin-ready, the client can run that game on Odin for real. The Rust engine is removed only when Odin covers what it
   does.
5. **The AI waits.** The AI searches by simulating the engine, so it follows the engine. Until the AI is ported (or a new
   one is written in Odin), Odin-run games use a simple Odin AI or stay in shadow mode.

## Milestones

- **O-0 Spike (go / no-go).** Odin toolchain pinned in the container and CI; an Odin module compiled to wasm and loaded by
  the engine worker; parse a slice of `card-data.json` (the AST) in Odin; ChaCha20 and rand 0.9's `shuffle` and
  `random_range` reproduced bit for bit against Rust test vectors; measure build time and wasm size. Decision point: if
  Odin's wasm target or JSON handling falls short, we learn it here, cheaply.
- **O-1 Reference recorder.** The checkpoint format and its normalizer (Rust side); `ai-duel` writes recordings; the
  integration tests dump theirs; a corpus committed (or generated in CI) with a size budget.
- **O-2 Harness.** An Odin command-line runner that replays recordings and reports the first divergence; the shadow mode
  in the client worker; CI runs the Odin engine over the corpus and reports the pass count per slice.
- **O-3 Core slice.** State, zones, turn structure, priority and passing, mulligans, land drops, mana and costs, vanilla
  creatures, declare attackers/blockers, combat damage, state-based actions, game end. Pass: AI-vs-AI recordings with
  vanilla-creature-and-land decks.
- **O-4 onward, mechanic slices.** In the order that unlocks the most cards: damage/destroy/draw and simple targets, the
  stack and responses, triggered abilities, keywords, static abilities and layers, replacement effects, then the long
  tail. Each slice: its recordings pass, the Odin-ready card share goes up, status.md records it.
- **Later:** the AI (port or new), the per-game switch to Odin, drafting, then removing the Rust engine. Porting the
  parser is a separate, optional decision at the end.

## Decided (D-179)

1. The Rust card-text parser stays as an offline build tool; only the engine is ported.
2. Bit-exact RNG: seeds, recordings and saved replays carry over between engines.
3. The existing AI is ported later.
4. Open: how often the owner play-checks a slice (default: whenever a slice changes what a player can see or play).

## Honest scale

Roughly 875k lines of production Rust (excluding the parser) is a very large port, even with most of it written by
Claude. Expect it in many slices over months. O-0 to O-2 make every later slice measurable and safe, so they come first
and are worth doing even before committing to the whole port.
