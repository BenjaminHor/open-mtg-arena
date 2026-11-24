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
- **O-1 Data model and recorder.** Generate the Odin types and JSON codecs from the Rust types (above), proven by a
  byte-equal round trip of `card-data.json` and of saved game states. Then the checkpoint format and its normalizer (Rust side); `ai-duel` writes recordings; the
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

## O-0 spike results (2026-11-24): go

Everything in `odin/spike/`, Odin `dev-2026-11a` built from source (the release downloads are blocked in this container;
`git clone` of the tag plus `apt-get install llvm-18-dev`, then `./build_odin.sh release`, 76 s).

| Question | Result |
| --- | --- |
| Toolchain | Builds here from the pinned tag in 76 s (LLVM 18). CI can do the same or cache the binary. |
| RNG bit for bit | **Identical.** `odin/spike/rng` (ChaCha20 seeded via PCG32, the 4-block buffer, `next_u32`/`next_u64` across the buffer edge, `shuffle` with `IncreasingUniform`, `random_range` for u32/usize/i32/u8/u64, `random_bool`, `choose`) prints the same 90 lines as `odin/spike/rng-vectors` (the exact Rust crates) over six seeds. Ranges over `usize` sample through u32 on both 32- and 64-bit targets, so native recordings match the browser. Still to add: `get/set_word_pos` (saves restore the RNG by word position). |
| WASM boundary | `-target:js_wasm32 -no-entry-point`: a 243 KB module whose only imports are `odin_env.write` and `odin_env.rand_bytes` (hash-map seeding), so a 10-line JS shim replaces Odin's browser glue. JSON bytes in through an exported `alloc_bytes`, JSON bytes out through `result_ptr/len`, as the worker needs. |
| Card data | All 36,406 cards from the 98 MB `card-data.json`: natively 0.47 s typed (a field subset) and 1.3 s as a generic tree; in wasm (Node) 0.94 s typed, 156 MB of wasm memory. |
| Build time | 2.6 s for the spike at `-o:speed`, native or wasm (the Rust engine: ~20-25 min). Engine-sized code will be slower, to measure as it grows. |

**The one real cost found:** `core:encoding/json` doesn't decode serde's tagged enums (`{"type": "Cost", ...}`,
`{"type": ..., "data": ...}`) on its own, and the AST has hundreds of them (Effect ~241 variants, TriggerMode 176,
Keyword 200, StaticMode 125). Writing those types and their decoders by hand would be slow and error-prone, so the data
model should be **generated from the Rust type definitions**: a Rust tool reads `phase-ast` and the engine's state and
action types (with `syn`, already a dev-dependency, or serde reflection) and emits Odin types plus their JSON
decode/encode. That becomes part of O-1, and a generated round trip (Rust JSON → Odin → JSON, byte-equal over the whole
card file) is its test.

## O-1 data model design (2026-11-24)

`odin/tools/odingen` (Rust, `syn`; temporary, removed with the Rust engine) reads `crates/phase-ast/src` and
`crates/engine/src`. First report: 1,714 serde types (824 structs, 890 enums with 5,989 variants), 74 aliases, 62 types
with hand-written serde impls (among them `GameState`, `AbilityDefinition`, `Keyword`, `TriggerMode`, `QuantityExpr`,
`CounterType`), 2 generic types, 5 float fields. The generator emits, per type, an Odin type plus a decode and an encode
procedure; the 62 hand-written ones get hand-written Odin codecs that the generated code calls.

| Rust | Odin |
| --- | --- |
| struct with named fields | struct, same field names (Odin keywords get a trailing `_`, JSON name kept) |
| newtype struct (`ObjectId(u64)`) | `distinct` of the inner type |
| enum with only unit variants | `enum` |
| enum with data | `union` of one struct per variant, `<Enum>_<Variant>` (unit variants are empty structs) |
| `Box<T>`, `Arc<T>` | `^T` (`Option<Box<T>>` is a nil-able `^T`) |
| `Option<T>` | `Maybe(T)` |
| `Vec`, `im::Vector`, `SmallVec`, `VecDeque`, sets | `[dynamic]T` (sets keep the sorted order serde writes) |
| maps with simple keys | `map[K]V`; other keys, and `IndexMap` (insertion order), `[dynamic]` of key/value pairs |
| tuples | small generic pair/triple structs |

- **JSON**: our own small reader (`odin/engine/json`), not `core:encoding/json`. It keeps numbers as their source text,
  because u64 values (seeds, hashes) don't fit the i64 that `core:encoding/json` parses into, and keeps strings as
  slices of the input unless they contain escapes (fewer copies when loading the 98 MB card file).
- **serde shapes** handled by the generator: externally, internally (`tag`) and adjacently (`tag` + `content`) tagged
  enums, `untagged` (variants tried in order), `transparent`, `flatten`, `rename`/`rename_all`/`alias`, `default`
  (with the ~30 named default functions translated in a table), `skip`, and `skip_serializing_if` (a table of the ~30
  predicates in use). Sets and maps written sorted (`deterministic_serde`) are sorted by a generated comparison that
  mirrors Rust's derived `Ord` (declaration order).
- **Test**: decode then encode every card of `card-data.json` and compare with the original as JSON values (object key
  order ignored, array order kept); the same for saved game states once the recorder exists.
- **Known performance question for later**: the Rust engine clones `GameState` cheaply (persistent `im` collections),
  which the AI's search relies on. Plain Odin arrays and maps make a clone a deep copy, so the engine's state layout
  (arenas, copy-on-write, or undo logs instead of clones) is decided when the AI is ported, measured against Rust.

## Toolchain note: a compiler patch (2026-11-24)

The pinned Odin (dev-2026-11a) is built with `odin/toolchain/0001-memoize-nested-size-align.patch`, which memoizes
struct and union sizes/alignments inside the compiler's recursion. Without it the 469-type card model took 31 s just to
type-check its declarations (exponential re-walking of nested by-value types); with it, 6 s. To offer upstream; until
then every build of the toolchain (here, CI) applies it.

## How the engine logic gets ported: a translator (2026-11-24)

The engine is ~723k lines of production Rust (plus the AI's ~84k). Rewriting that by hand with "near zero
regressions" (D-180) isn't realistic, so the port is driven by a **Rust-to-Odin translator** grown inside odingen
(`syn`), for the subset of Rust this engine actually uses, with hand-written Odin where a construct isn't worth
automating. The recordings judge the output, so the translator can be extended pattern by pattern with every function
it translates checked against Rust behaviour. It starts small: the ~150 default functions and skip predicates the
serde attributes name (bodies like `QuantityExpr::Fixed { value: 1 }`, `vec![...]`, `matches!(x, Enum::Variant)`),
then pure methods on the types, then the engine's modules in dependency order. Progress is measured as the share of
functions translated and the share of recordings passing.

## Decided (D-179)

1. The Rust card-text parser stays as an offline build tool; only the engine is ported.
2. Bit-exact RNG: seeds, recordings and saved replays carry over between engines.
3. The existing AI is ported later.
4. Open: how often the owner play-checks a slice (default: whenever a slice changes what a player can see or play).

## Honest scale

Roughly 875k lines of production Rust (excluding the parser) is a very large port, even with most of it written by
Claude. Expect it in many slices over months. O-0 to O-2 make every later slice measurable and safe, so they come first
and are worth doing even before committing to the whole port.
