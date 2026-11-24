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
  order ignored, array order kept); the same for recorded game states (`odin/tools/gamestate_roundtrip`).
- **Game-state model (2026-11-24)**: roots GameState, GameAction, WaitingFor, GameEvent, ReplayLog and the card data:
  1,414 types, 1,304 serialized, 13 with hand-written codecs (hand_codecs.odin, each citing the Rust impl it mirrors).
  Rules the generator follows, each checked against its Rust:
  - A hand-written codec declares the generated codecs it calls (`hand_deps` in odingen's main.rs); a hand type's
    other fields are runtime state and get no codecs (ManaPool's slot index, the journal's index).
  - `from`/`into` wire types: ManaPool is modeled as its wire form (the units in pool order); ResolvedRulesJournal
    encodes through ResolvedRulesJournalWire (the runtime `index` is rebuilt by logic, later). Types with only `from`
    write the derived form, so the generated decoder reads that (the legacy forms their `From` also accepts aren't
    read). Types with `into` get hand codecs.
  - `Box<T>` read as absent holds `T`'s default (Box::default()); a shared collection (`Arc<Vec<T>>`) read as absent
    stays nil, which codecs and skip tests treat as empty.
  - An internally tagged enum holding another with the same tag key writes the key twice
    (`{"type": "Modification", "type": "Increase"}`); the payload reads the second. Our JSON reader keeps repeated
    keys and `json.equal` pairs them by occurrence. (serde_json::Value keeps only the last, so the recorder writes
    lines straight from the typed values.)
  - Fields written but never read (`skip_deserializing`: available_mana_pips, allows_cancel_cast, ... 13 names, listed
    in `WRITE_ONLY_FIELDS`) are values the engine derives. The model doesn't read them, and the round trips leave them
    out of the comparison, like `is_mana_ability`, until the logic that derives them is ported.
  - Not ported yet, failing loudly when met: a payment recovery checkpoint's nested state (`persisted_checkpoint_state`,
    written through the versioned ResolutionStateWire).
  - Map adapters write entries in model order where Rust sorts them; value comparison ignores member order. Byte-
    identical output would sort there.
  - Reviewed against the Rust impls (2026-11-24): every form Rust writes today matches. Fixed from the review, each
    case kept in `odin/tools/hand_codecs_test`: counter maps merge by counter value, the double " counter" trim,
    Rust's strict integer parsing (no `_` separators), keys that parse equal collapse (last wins), a trailing comma
    in a grant chain, SacrificeCost's absent count. Left for the logic port: PendingCoinFlip's
    `validate_incoming_pins` on reading (Rust refuses a parked flip whose incoming references lack pins).
- **Result (2026-11-24)**: six recorded AI-vs-AI games (2,134 steps, six matchups; `record-games`, seeds 1-6) round-trip
  every state (2,140) and action (2,134) with 0 failures and 0 mismatches; decode 7.7 ms and encode+compare 6.5 ms per
  state (debug build, ~440 KB of JSON each). The card data still round-trips (36,406 cards).
- **State layout, decided before the logic (corrected 2026-11-24)**: the Rust engine clones `GameState` about 55
  times per action even without the AI (rollback snapshots, cost and casting simulations) and writes objects
  copy-on-write 5.5M times in nine games. Plain Odin arrays and maps would make each clone a deep copy, so the
  Odin state needs cheap snapshots (persistent or copy-on-write collections, or undo logs) before logic is
  translated; measured against Rust (status.md, "Plan before the logic port").

## State layout: mirror Rust's sharing (proposal, 2026-11-24)

Measured: ~55 full `GameState` clones per action, 5.5M copy-on-write object writes in nine games. Where Rust's clone
is cheap and where it isn't, field by field:
- **Shared** (`Arc<T>`): every object in `objects` (`Arc<GameObject>`), each object's ability, trigger, static and
  replacement lists (`Arc<Vec<…>>`, the parsed card AST), the deck lists inside `deck_pools` (≈165 KB of JSON), a
  few other large parts. A clone bumps a count; a write goes through `Arc::make_mut` (copy only if shared).
- **Copied** (everything else): plain fields, `Vec`s and maps, and the `im` collections, which are persistent in Rust
  (O(1) clone) but small apart from `objects` and the rules journal (up to ~1k entries).
- No interior mutability inside the state (no `OnceLock`/`RefCell`/`Mutex`/atomics in its types), so the sharing rule
  is mechanical.

Proposal: the Odin model mirrors that exactly, and the translator follows it mechanically.
1. `Arc<T>` becomes a reference-counted shared pointer (`Shared(T)`: pointer + count); `Box<T>` stays an owned `^T`.
   The model currently maps both to `^T`; odingen tells them apart.
2. odingen generates `clone_<T>` for every model type: copies owned data, shares `Shared` pointers (count + 1).
   `.clone()` translates to it; `Arc::make_mut(&mut x)` to `make_mut(&x)` (copy if count > 1).
3. ObjectMap is an array of (id, `Shared(GameObject)`) kept in D-182's order; its clone copies ~100–300 pointers.
4. Memory: everything a game action allocates comes from a per-action arena. A state that outlives the action (the
   new current state) is deep-copied once into the next generation's arena, then the old arena is freed whole: one
   ~0.5 MB copy per action instead of tracking every drop, which Odin has no RAII for. Counts only decide whether a
   write must copy; a state clone the translator can see die at scope end (`let mut sim = state.clone()`, the 55 per
   action) releases its counts there, so counts stay exact on the hot path. Elsewhere a stale count only causes an
   extra copy, never a wrong result.
5. Checked before the translator depends on it, against numbers taken from Rust first. Rust (`clone-bench`, release,
   49 recorded states of three games, ~120 objects each, 2026-11-24): clone + drop 18.8–20.4 µs; clone, write one
   object (copy-on-write), drop 21.9–23.6 µs; lookup by id 6–6.5 ns. So ~1.1 ms of cloning per action, and the
   Odin bar is a clone at or under ~40 µs and lookups near 10 ns:
   - a benchmark shaped like both uses: per action (clone, write, discard, ~55 times) and like search (one parent,
     many clone → write → discard), plus lookups by id (Rust's own profile puts hashing and lookup at 35% of
     resolution CPU, so the map is indexed by id and keeps D-182's order beside it); within 2x of Rust or the
     design changes;
   - an oracle mode where `make_mut` always copies: recordings must come out identical with and without it (a
     count that under-counts would let a write reach shared data, which only this catches);
   - escaping snapshots traced before scope-end releases are generated (`engine.rs` wraps one in an `Arc` and
     keeps another for rollback);
   - the per-action copy into the next generation keeps sharing (each object's ability lists are copied once per
     generation, not once per holder), and states that outlive an action (nested simulations, the AI's search
     tree) get their own generations rather than the per-action rule.

**First Odin measurement (2026-11-24).** odingen now generates `clone_<T>` for every model type
(`generated_clone.odin`): `Arc` fields share (a count stored before the value, `shared_new`/`shared_retain`/
`make_mut` in codec_runtime.odin), everything else is copied. A clone of a recorded state encodes to the same JSON
as its original (`odin/tools/clone_bench`, all states checked). Speed, `-o:speed`, clones in an arena: 87–159 µs
per clone against Rust's 19–20 µs, so 4–8x slower; lookups 3.4 ns (Rust 6 ns, Odin's map against im's trie). The
bar is 2x, so the layout isn't settled. Where the time goes (same day):
- Half the gap was the benchmark's arena (`core:mem/virtual` takes a mutex per allocation and unmaps and zeroes on
  reset). With a preallocated `core:mem` arena reset each clone: 32–66 µs per clone (1.6–3.3x Rust), copying
  185–353 KB in 265–442 allocations.
- By field: the rules journal (`im::Vector`s) is over half of it, then `zone_changes_this_turn`,
  `spells_cast_this_game_by_player`, `sacrificed_permanents_this_turn`, `transient_continuous_effects`,
  `attribution` (all `im::Vector`/`im::HashMap`, O(1) to clone in Rust), then `objects` (an Odin map rebuilt).
- Odin's types are fat where Rust boxes: GameState 19.8 KB, GameObject 8.9 KB, ZoneChangeRecord 2.9 KB, a journal
  entry 432 B (a tagged union is as large as its largest variant). Rust's (clone-bench): 16.2 KB, 5.8 KB, 2.0 KB,
  288 B, so Odin's are 1.2–1.5x; the gap is in what gets copied, not mainly in size.
- Object ids are dense: ids 1..N with a few gaps (next_object_id at most ~15 past the count in the recordings).
Next design step, from these: carry the collection kind in odingen's shapes (`Vec`, `im::Vector`, `im::HashMap`,
ordered maps; also the ordered-map follow-up), give the `im` collections their own Odin types behind a small API so
translated code never touches `[dynamic]` directly (copy-on-write of the whole collection at first, a chunked
persistent vector where appends dominate, chosen per collection from what the executed code does to them), and
make ObjectMap an array indexed by id with D-182's order kept beside it. Then re-measure, including a parent
written after many discarded clones (stale counts copy more).

**Step 1 done (2026-11-24): `im` collections shared.** odingen models `im::Vector`/`HashMap`/`HashSet`/`OrdMap`/
`OrdSet` as shared collections (like `Arc<Vec<T>>`: cloning shares them, the first write after a clone copies).
All round trips still pass. Clone: 4–5 µs with a plain arena, 10.7–15 µs with `core:mem/virtual`'s, against Rust's
19–20 µs. But the stale-count pattern (a clone discarded without release, then the parent written) costs 345 µs a
round: each append to the journal copies the whole journal deeply, where Rust's `im::Vector` copies only the
64-entry chunk it writes. So step 2: the `im` collections get a chunked persistent representation (a write copies
one chunk), and scope-end release for the clones the translator can see die; then the same benchmark again.

**Step 2, first half done (2026-11-24): `im::Vector` is a PVec** (`odin/engine/types/pvec.odin`): values in
shared 64-entry chunks, so a clone copies the chunk list and a write copies one chunk, as `im::Vector` does. All
round trips pass. Clone 5.7 µs (plain arena) / 11–16 µs (virtual arena) against Rust's 19–20 µs; the stale-count
pattern (discard a clone, append to the parent's journal, write one object) 33 µs a round, down from 345 µs. Left:
`im::HashMap`/`HashSet`/`OrdMap` are still whole-collection copy-on-write (the same stale-count cost on writes,
smaller collections); ObjectMap as an id-indexed array; scope-end release; then the advisor's oracle (a mode where
every write copies, recordings must not change) once logic exists to run it on.

## Review follow-ups (2026-11-24, not yet done)

From the review of odingen, the recorder and the workflow (the fixes made are in PR #117's history):
- Ordered maps (`BTreeMap`, `IndexMap`, `OrdMap`) become plain Odin maps: their JSON is written in hash order
  where Rust sorts, and ported code iterating them would see hash order (D-182's hazard). Carry `ordered` in the
  shape; encode sorted; give ported code an ordered type.
- Serde attributes odingen ignores silently in some positions (variant-level `untagged`/`with`, tuple-field
  attributes, `rename(serialize, deserialize)` pairs, container `default = "path"`, `cfg(not(test))`, unknown
  `deserialize_with`, Repr fields dropped by `merge`): none occurs today, but one should fail generation, not pass.
- Data-enum encoders write nothing for a nil union; they should panic, as serde errors.
- Translator: `Default::default()` and `..Default::default()` take zero values where a type's Default isn't zero.
- Determinism hardening: sort the source walk; refuse two serde types with one name reachable from the roots.
- Coverage hooks are added to generated text by string matching; emit them where the case lines are written.
- GameState's Deserialize is hand-written (GameStateDecode: migrations, then `rehydrate_rng`); the Odin decoder
  reads today's form and leaves the RNG at `default_rng` until the replay harness rehydrates it from
  `rng_seed` and the recorded `rng_word_pos`.

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

### The translator's next layer: whole function bodies (plan, 2026-11-24)

Census (`odingen census crates`, 15,955 functions read: top-level and inherent methods of phase-ast and engine; trait
impls and inline modules not yet counted): Rust's syntax alone (paths, calls, struct literals, `match`, fields, `&`,
`?`, closures, loops, `let else`, ...) completes about 20% of the functions; with `matches!`/`vec!`/`format!` 25%; the
rest need library methods (std, `im`, iterators). The refined census lists those methods in the order that completes
the most functions (the engine's own methods only need their callee translated). The translator grows in that order:
1. Statements and control flow: `let` (typed from the initializer), `if`/`if let`/`let else`, `match` on enums
   (an Odin `switch` on the union, bindings per variant), `for` over ranges and collections, `while`, `loop`,
   `return`, `break`/`continue`, `?` (early return of the error or None).
2. Signatures: `&T` parameters by value (Odin passes large values by reference), `&mut T` as `^T`, `Option<T>` as
   `Maybe(T)`, `Result<T, E>` as two results `(T, Maybe(E))`, references returned as pointers.
3. Library methods by table, the census order: `clone` (→ `clone_<T>`), `is_empty`/`len`/`push`/`contains` (per
   collection kind: `[dynamic]`, `PVec`, maps, shared collections through `make_mut` on writes), `Option` helpers
   (`is_some`, `as_ref`, `is_some_and`, `map`, `unwrap_or`, ...), `to_string`.
4. Iterator chains as loops: `iter().filter(..).map(..).collect()`, `any`/`all`/`find`/`position`/`count`/`sum`/
   `max_by_key`, with the closures inlined into the loop body.
5. Closures passed to engine functions (higher-order code) and traits: counted separately before choosing between
   monomorphizing per call site and Odin procedure values with explicit context.
Each translated batch is checked before whole games can run: odingen also generates a Rust printer that calls the
same functions on inputs taken from the card data and recorded states and prints the results, and an Odin checker
that compares (the O-0 vector pattern, per batch). Functions the translator can't handle stay listed, with the
construct that stopped them.

**Whole-function translator, first version (2026-11-24).** `odin/tools/odingen/src/body.rs` translates a function
to an Odin procedure: signatures (`&mut T` as `^T`, `Self`), `let` (typed from the initializer), `if`/`if let Some`,
`match` on enums (bindings per variant), `for` over ranges and `Vec`s, `while`/`loop`, `return`, assignments, tail
expressions, calls to engine functions as `Owner_method(...)`, `.clone()` as the generated clone. Functions it can't
translate yet become stubs with their real signature (calling one panics, naming the construct that stopped it), so
everything translated type-checks against the model. `odingen translate-report crates <dir> [filter]` writes
`translated.odin` (and the logic's extra types) and ranks the blockers. First numbers: phase-ast 515/1,169
functions (44%), the whole engine 3,010/15,923 (18.9%); the translated code type-checks (phase-ast cleanly; engine-wide
a handful of errors left). Top blockers engine-wide: untyped `let` (2,176), `Result` returns (1,900), `.iter()`
(934), `let else` (914), nested items (483), generic functions (430). Not yet checked against Rust's results (the
vector printer is next); none of it is committed as engine code until it is.

### Verifying translated code: the vector check (2026-11-24)

A clean Odin type check proved little: two silent mistranslations passed it (docs/status.md, Known issues). So every
translated procedure is checked against the Rust function it came from, on inputs the real engine produced:

1. `odingen translate-report` writes, beside translated.odin, `vector_harness.odin`: a case per translated procedure
   whose parameters and result have codecs. A case decodes the arguments, calls the procedure, encodes the result and
   the `&mut` arguments afterwards, and compares them with the Rust values as JSON. In a `-define:VECTOR=true` build
   a stub records that it was reached and returns a zero value, so such a call counts as inconclusive, not as a
   failure or a crash.
2. `odingen vector-patch <scratch crates copy> <names>` rewrites a scratch copy of the engine, never the real tree.
   Each named function is renamed `__orig_<name>` and wrapped. The wrapper logs the arguments, the result and the
   `&mut` arguments afterwards as serde JSON for the first three calls, then the 10th, 100th, and so on. Types
   without Serialize are marked unlogged, through autoref specialization in non-generic code. Large values (game
   states) are written once to `<log>.values` and referenced by hash. Only the harness's cases are wrapped:
   wrapping all ~14,000 candidates makes the engine crate too big to compile in 16 GB.
3. The patched `record-games` plays a recorded matchup with `VECTOR_LOG=<file>`. `odin/tools/vector_check` replays
   the log against the translation and reports, for each procedure: pass, fail (with the first differing JSON path),
   undecodable, only-stubs-reached, or unlogged.

A translated procedure becomes engine code only after passing here. Fields Rust doesn't serialize (runtime caches
behind `#[serde(skip)]`) reach Odin as defaults, so a function that reads one shows up as a failure. Investigating
each such failure is part of the check.

## Decided (D-179)

1. The Rust card-text parser stays as an offline build tool; only the engine is ported.
2. Bit-exact RNG: seeds, recordings and saved replays carry over between engines.
3. The existing AI is ported later.
4. Open: how often the owner play-checks a slice (default: whenever a slice changes what a player can see or play).

## Honest scale

Roughly 875k lines of production Rust (excluding the parser) is a very large port, even with most of it written by
Claude. Expect it in many slices over months. O-0 to O-2 make every later slice measurable and safe, so they come first
and are worth doing even before committing to the whole port.
