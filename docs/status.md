# Status

Living document. Update it at the end of every task: what changed, what's next, and anything the
next session needs to know. Keep it short. Move finished detail into commit messages.

**Current milestone:** M3 — First playable (`milestones/m3-first-playable.md`), Phase 1. M2 is complete (2026-11-22,
every exit criterion met or waived, D-142); tagging `m2` on `main` is the owner's.
**Rules version:** see `rules/VERSION.json`

## In progress
- **Odin port, the session goal (D-180):** remove all Rust from the engine, replace it with Odin, near-zero
  regressions in functionality and performance. Plan: docs/odin-port.md. O-0 done (go). Now O-1: generate the Odin
  data model and JSON codecs from the Rust types. odingen pass 1 (collect + report) done; design in odin-port.md
  ("O-1 data model design").
  - **Card data round-trips (2026-11-24).** `odin/tools/carddata_roundtrip`: all 36,406 cards of card-data.json decode
    into the generated model (469 types; odin/engine/types/generated_*.odin, ~45k lines) and encode back to an equal
    JSON value: 0 failures, 0 mismatches. Decode 1.6 s, encode+compare 3.2 s (debug build). One key skipped on
    purpose: AbilityDefinition's computed `is_mana_ability` (CR 605.1a), which needs ability-walking logic the
    translator will port; `consumes_source` is ported. Hand-written: 4 codecs (ChoiceType, CounterType,
    ExileConcealment, SacrificeCost), 7 field adapters (legacy bools, bare-number minimums, damage pairs), 10
    default/skip functions; odingen translates the other 186 default/skip functions and the `impl Default`s.
  - **Build times (2026-11-24).** The generated model first took 58 s to build unoptimized, 43 s of it Odin's type
    checker: Odin recomputed the size of every by-value nested type along every path (no memoization below the top
    call), which a tagged-union AST hits hard. Fixed in the compiler: `odin/toolchain/0001-memoize-nested-size-
    align.patch` against dev-2026-11a (to offer upstream). Now: type check 6.6 s, debug build 9.7 s, `-o:speed`
    build 44 s (LLVM optimization 37 s). Generated code also calls procedures directly (no overload groups) and
    generic types are monomorphized.
    **Build times with the translated logic (2026-11-24):** the translation (~460k lines with the test harness) had
    pushed the type check to 96 s; a second compiler fix (memoizing named types too) and `-no-escape-analysis` for
    development builds bring it to 1.0 s, a debug build to 11 s, `-o:speed` to 225 s (LLVM). docs/odin-port.md,
    "Toolchain note".
  - Game-state model sized (2026-11-24): roots GameState, GameAction, WaitingFor, GameEvent, ReplayLog (+ card data)
    reach 1,410 types, 1,310 of them serialized (the rest are runtime caches behind `#[serde(skip)]`, type only). odingen
    reads GameState through its `declare_game_state!` macro. Left to write by hand before it compiles: 23 codecs
    (ManaPool, ObjectMap, ResolvedRulesJournal, GameFormat, PendingCoinFlip, ...), 44 default/skip functions, and ~10
    types defined by macros or outside the model (InteractionId family, ActiveLibrarySearches, the ChaCha20 RNG).
    GameState's own reading goes through GameStateDecode (migrations), so its codec is checked against today's saves.
  - **Game states round-trip (2026-11-24).** The full game-state model compiles (1,414 types) and every state and
    action of six recorded AI-vs-AI games (`crates/phase-ai/src/bin/record_games.rs`, 2,134 steps over six matchups)
    decodes and encodes back equal (`odin/tools/gamestate_roundtrip`): 0 failures, 0 mismatches. Rules and the one
    gap left (payment recovery checkpoints) in docs/odin-port.md, "Game-state model". Recordings are 150-200 MB a game
    (full state per step), kept out of the repo for now.
  - **Coverage (2026-11-24).** Six games reach 268/1,307 model types; with the card data 601 types, 2,549/5,019 enum
    variants, 21/32 hand decoders (`-define:COVERAGE=true` on the round-trip tools). The engine's integration tests
    add little through `apply` (533 states from shard 2's 3,920 tests: they build states directly), but two of them
    hold a payment recovery checkpoint, whose versioned form (ResolutionStateWire) needs the resolution-frame logic
    (`canonicalize_legacy_resolution_state`), so it's ported with the logic. A sweep of one game per duel matchup
    (32) followed: **every matchup round-trips, 11,852 states and 11,820 actions, 0 failures**. Combined coverage
    (card data, the games, the sweep): 729/1,307 types, 2,753/5,019 variants, 23/32 hand decoders; the small
    unreached hand codecs now have fixture cases in `odin/tools/hand_codecs_test`, leaving LiminalEntrant,
    PeriodSignature, PendingCoinFlip and the checkpoint unexercised by data. Determinism: re-recording seed 1
    gives identical bytes; both seats play.
  - **Plan before the logic port (2026-11-24, with the advisor).** Three measurements first, each able to change the
    translator's design:
    1. What one recorded game executes: the set of Rust functions (instrumented build or callgrind). Sizes O-3,
       shows whether mechanic slices are separable or the unit is `apply`'s whole call closure, and orders the port
       leaf-first.
    2. Clone and aliasing on that path: GameState/GameObject clones and `Arc::make_mut`. `Box`/`Arc` map to `^T` and
       the translator treats `.clone()` as the value itself, fine for predicates but aliasing once code mutates. If
       the engine clones state per action, the Odin state layout (and generated `clone_<T>`) is decided now, not
       with the AI.
    3. Hash-order dependence: ObjectMap is an `im::HashMap` with Fx hashing; Odin uses `map`. Re-record seed 1 with
       a different hasher: identical bytes mean iteration order is unobservable; otherwise Odin reproduces the order
       or the Rust reference moves to an ordered map first.
    **Results (2026-11-24):**
    1. Executed code (an instrumented `record-games`): one game (red-vs-green) runs 5,638 of the engine's 33,509
       functions (52k of 359k lines) plus 1,993 AI functions; nine matchups together run 9,116 engine functions
       (89k lines), still growing with each new deck. So the unit of porting is `apply`'s call closure, thousands
       of functions, not a small mechanic slice; the executed list (`all.lcov` in the session scratchpad, to be
       regenerated in CI) orders the port leaf-first.
    2. Cloning: those games made ~230k full GameState clones (≈55 per action: per-action rollback snapshots in
       engine.rs, cost/casting/mana simulations, staged trigger states) and 5.5M copy-on-write object writes
       (`ObjectMap::get_mut` → `Arc::make_mut`). Rust gets this cheaply from persistent (`im`) collections and
       `Arc`-shared objects. The Odin state must offer the same cheap snapshot/rollback, so its layout is decided
       before translating logic, not with the AI (docs/odin-port.md said the latter; corrected).
    3. Hash order: the `RandomState` maps already vary per process and recordings repeat byte for byte, so their
       order isn't observable. The Fx-hashed ObjectMap's order is: with a random hasher, elves-mirror diverged at
       step 111. That order is a function of the ids, reproduced exactly by a formula (D-182), so the Odin
       ObjectMap iterates the same way; no Rust change.
    Also found: **the card-text parser runs during play.** Token creation parses a token's catalog rules text
    (`game/effects/token.rs` `catalog_rules_text_abilities`, 274 calls in nine games), and other engine modules
    call into the parser (triggers, layers, combat, effects). An all-Odin engine needs those parses precomputed
    into the card data (a Rust oracle-gen change) or the parser ported; D-179 assumed the engine never parses.
    Question for the owner (Open questions).
    **Logic port started (2026-11-24): the whole-function translator** (odin/tools/odingen/src/body.rs,
    `odingen translate-report crates <dir> [filter]`; `odin/tools/translate-loop.sh` stubs whatever Odin's type
    check rejects until it checks cleanly). Engine-wide 4,087 of 15,923 functions translate (25.7%) and, with typed
    stubs for the rest, the whole engine type-checks in Odin. **Type-checking is not correctness**: two silent
    mistranslations were found after the code checked cleanly (Known issues, 2026-11-24, both now fixed or refused),
    so every translated procedure is now checked against Rust by **the vector check** (`odin/tools/vector-check.sh`;
    docs/odin-port.md, "Verifying translated code"): calls logged from a patched scratch engine during a recorded game,
    replayed against the translation. First run, red-vs-green seed 1, 400 steps: 605 translated procedures executed,
    **344 pass, 1 fails, 260 only reach untranslated code**. The failure is explained: it reads a `#[serde(skip)]`
    runtime field the log can't carry. Blockers are now also ranked over the functions the recorded games execute
    (`ODINGEN_EXECUTED`, from an lcov profile): 27.4% of 5,852 executed functions translate (26.7% overall, 4,252). A
    hand-written `ObjectMap_get` (odin/engine/types/hand_logic.odin, for generic Rust functions) cleared the top
    executed blocker (294 callers). **The pattern compiler** (odin/tools/odingen/src/pattern.rs) then took patterns
    off the blocker list: nested, tuple, slice, literal and range patterns, `@` bindings, guards, or-patterns, matches
    on non-enums, `let`/`let else`/`if let`/`for` patterns (with `.enumerate()`), and matches through a mutable
    reference, which bind pointers into the subject. Plain arithmetic is translated too; adapters take function paths
    (`.map(ObjectId::from)`); `&&`/`||` operands needing statements are evaluated inside an `if`; `Self` and `Vec<_>`
    in locals and chain terminals (`find`, `collect`, ...) are typed. Now 5,726 of 15,922 (36.0%) overall, 36.3% of
    executed functions. **Vector check after
    the pattern compiler: 717 procedures exercised, 442 pass, 0 unexplained failures, 0 crashes, 274 reach only
    untranslated code** (odin/tools/vector_check/explained.txt lists the one understood failure). Later count
    (6,564 translated, same log): 439 pass with real comparisons, 23 more pass but touch `#[serde(skip)]` state the log
    can't carry (reported apart), 0 unexplained failures, 252 reach only untranslated code. **With closures (6,591
    translated, a fresh log of 5,161 calls): 955 procedures exercised, 593 pass, 23 pass touching unlogged state,
    0 unexplained failures, 0 crashes, 338 reach only untranslated code.** Then `&mut` results (`MutRef`, an Odin
    pointer: `get_mut`, `last_mut`, functions returning `&mut T` / `Option<&mut T>`), with a hand-written
    `ObjectMap_get_mut` that copies on write like `Arc::make_mut` (tested in `hand_logic_test`), generic functions
    monomorphized per call site, a plain binding of a Box field binding the box (as Rust does), and Box values read
    where their contents are wanted: 7,241 of 15,918 functions (45.5%), executed 45.9%. **PR #118 merged**
    (2026-11-24, squash efc4865). **PR #119** (open): sets kept as sets (sorted/deduplicated by their Rust type), `?`
    inside inlined closures, derived equality for `==` on structs/enums/collections, a call returning `impl Iterator`
    starting a chain, `enumerate`/`flat_map` stages (terminals break the chain's labelled outer loop),
    `Definitions<T>` iteration, `unwrap_or_else`, Vec reads through nil-able pointers: 7,459 of 15,918 (46.9%),
    executed 47.4%. Method refusals now name the receiver's shape. Then `while let`, empty collections typed by a
    later use (a placeholder type filled in when the function is done), chain terminals typed over untyped receivers,
    `for` over im::Vector (by index) and over a Vec behind a nil-able pointer, an Option as a chain's source, and
    `return` inside inlined closures (leaves the closure's block, like `?`): 7,607 of 15,918 (47.8%), executed
    48.6% (2,844 of 5,849). **Parallel streams (D-185, 2026-11-24):** sibling cloud sessions on D-183 (parse
    precompute), Odin performance (state layout and copies) and O-2 (the replay harness), each on its own branch and
    PR; this session keeps the translator. Sessions (started 16:02 UTC from claude/eloquent-mayer-qcx0e1; the
    first three failed in setup because the environment's script ran pnpm at the repo root, now fixed to client/):
    D-183 session_012gEsKbWYSyCrqCT1cYB66w (branch claude/odin-d183-parse-precompute), performance
    session_012gEsKZntQHoXvuPbowys7j (claude/odin-state-perf), O-2 session_012gEsKakESMXjUS4u6b67dY
    (claude/odin-o2-replay). Vector check on that translation (5,812 calls over 1,079 procedures): 684 pass, 26 pass
    touching unlogged state, 0 unexplained failures, 0 crashes, 367 reach only untranslated code
    (`controls_exact_fetchland` reads the skipped `layers_dirty`, explained). Later the same day: engine trait
    methods registered, constants and unit variants typed, pair-held maps (non-hashable keys), `mem::take`/`replace`,
    `next()` on fresh iterators, Box `&mut` bindings, `Option<Box<T>>` read as `Option<T>`; one name set per
    procedure; brace-holding loop heads parenthesized; translate-loop now fails on a crashed check (a killed check
    had read as clean). 8,109 of 16,030 functions (50.6%), executed 51.8% (3,052 of 5,889). Vector check: 728 pass,
    27 touching unlogged state, 0 unexplained failures, 0 crashes, 386 reach only untranslated code. D-184 is done (Known issues). Next
    blockers (executed): type
    parameters whose callers aren't translated yet (88), closure-parameter callees (87, translated as instances
    through their callers), the type-check tail (83), closures/combinators of untyped values (~130), lets of
    untyped values (~200 across kinds). Older next blockers
    (executed): generic functions (196), iterating non-Vec collections (maps, sets, PVec, ranges: ~260), `get` on
    maps (78), `matches!` with field conditions (70), statement macros (66). Translator now: value
    `if`/`match`/block initializers (each branch assigns), empty collections typed by their later use, Option/Result
    combinators, labelled loops. Next blockers: generic calls/functions (~1,280), nested items (527), patterns (let
    457, let-else 423, for 236, or-with-bindings 221, if-let 173, nested 147), match on non-enums (432), mutable
    reference bindings (320, refused on purpose until patterns bind pointers). docs/odin-port.md has the plan.
    **O-0/O-1 merged: PR #117** (2026-11-24, squash, Odin CI green), with the Odin CI workflow. A code review
    of odingen, the recorder and the workflow (2026-11-24) led to: the recorder steps one AI action per line and
    records contest settlements, the submitter and semantic owner, and the RNG position; skipped fields get their
    defaults when read; integers compare exactly; the state-dump hook is removed (test dumps belong in the test
    runner); the workflow installs LLVM on cache hits, passes `--locked` and checks a seed replays identically.
    The rest is listed in docs/odin-port.md, "Review follow-ups". Rust clone baseline: 19–20 µs; Odin's first
    generated clone: 87–159 µs (4–8x), so the state layout needs another step (docs/odin-port.md).
    Then: per-module verification vectors (a Rust printer over recorded states, an Odin checker), so each
    translated batch is checked before whole games pass; land O-1 through a PR with a CI job (patched Odin build,
    odingen output matches the committed files, one short game recorded, both round trips); the client boundary's
    types (ClientGameStateRef and the other wasm exports) added as model roots before shadow mode.
- **D-177 import merged** (PR #116, squash bdd74cf, 2026-11-24, CI green). **Live** (Pages run 21 succeeded 03:37 UTC;
  checked 04:55 UTC with Playwright at 915x412 landscape phone: the home page loads in ~8 s with no errors, Play vs AI
  → Random Deck → Start Match plays a Commander game: the die roll, play-first choice, mulligan, then about five turns
  in which the script only passed and discarded (cleanup's discard prompt works) while the AI played lands, cast its
  commander and attacked (40 → 36 life); card art loads. Not checked: casting spells, combat choices, a game's end). Remaining from the plan: ask the owner to try it at
  https://benjaminhor.github.io/open-mtg-arena/ on the
  MacBook and the unfolded Duo. The port plan is docs/odin-port.md (D-179), now under way (D-180).
- **O-0 spike plan (2026-11-24, written before starting).** Go/no-go questions, each with a measurement:
  1. Toolchain: Odin `dev-2026-11a` built from source here (GitHub release downloads are blocked in this container;
     anonymous git clone works; LLVM 18 present). Pin the tag; CI builds or caches the same.
  2. WASM: an Odin module for `js_wasm32` (or `freestanding_wasm32`) loads in Node and in the engine worker, takes a
     JSON string in and returns a JSON string out (the boundary every export uses).
  3. Card data: parse `card-data.json` (98 MB) or a slice of it with `core:encoding/json` into Odin types for a few AST
     nodes; time and memory in wasm.
  4. RNG: ChaCha20 seeded from a u64 plus rand 0.9's `shuffle`, `random_range`, `choose`, `random_bool`, matched bit
     for bit against vectors from a small Rust program using the same crates.
  5. Build time and wasm size of the spike.
  Code in `odin/` at the repo root (spike under `odin/spike/`). Result and verdict go here and in docs/odin-port.md.
  - **Result (2026-11-24): go.** Toolchain builds here (76 s); the RNG is byte-identical to Rust over six seeds; a
    243 KB js_wasm32 module with two trivial imports does JSON in/out; the full card data parses in 0.94 s in wasm
    (156 MB); builds take ~2.6 s. Cost found: serde's tagged enums need generated Odin types and decoders (folded into
    O-1). Details in docs/odin-port.md. Next: O-1 (generated data model, then the recorder).
- **M3 — First playable**, started 2026-11-22 (owner: "Get started"; Arena is the North Star, expect heavy UI
  refinement). Phase 1: M3-01 match host, M3-02 heuristic AI, M3-03 web scaffold, M3-04 landscape phone board.
  M3-01 plan, one PR per slice:
  - **M3-01a, one per-player data source (D-135, D-137).** In the engine's `view/`, beside `playerView` and not in it:
    `seenObjects(state, view, cards)`, the derived values of every object the viewer can see (characteristics,
    summoning sickness, combat roles), keyed by id. The engine owns `characteristics()`, and `ai → engine` is allowed,
    so the UI, the heuristic AI and the LLM harness all read it with no new dependency arrow. `brief`'s builder in the
    CLI is rebuilt on it (text unchanged); text rendering stays in the CLI.
  - **M3-01b, the simple agents move to `packages/ai`** (`first-legal`, `random`, `by-kind`, the seeded random), so
    `match` can seat them; the CLI imports them from there.
  - **M3-01c, `packages/match`: a pure step function over plain-JSON match state.** `MatchState` = setup, actions (the
    log, every host-made action included), the game state, seats (per player: `human` or an agent by name, with its
    random state in the match, never `state.rng`), settings `{ autoPass, autoTap }`, and each human seat's events not yet sent.
    `advance(match)` acts for agent seats, auto-passes and answers forced decisions until a human seat must decide;
    `submit(match, action)` applies one. An LLM seat later is an outside seat too (it answers asynchronously).
    Auto-pass is one pure function shared by every seat (D-137, D-143): stop whenever something meaningful could be
    done, pass when your own object is on top of the stack; no stops list. Auto-tap reuses `autoPay`, one action at a
    time. A guard test: nothing `match` imports uses `node:`.
    *Accept (M3-01):* AI-vs-AI matches run through the host in tests and their logs replay to the same final state.
  - M3-01a done (seenObjects, brief on it), M3-01b done (agents in `@mtg/ai`), M3-01c built (`packages/match`: state,
    advance/submit/waitingOn, auto-pass, auto-tap one action at a time, replayLog, deckGameSetup moved in; the CLI's
    game file keeps its own format and replay for now: `replayLog` and the CLI's replay do the same job twice, to merge
    when the web app saves games). Code review fixes in: the auto-pass rule (D-143), `mightPay`/`actionManaCost` in
    the engine shared with `brief`, events queued only for human seats, `seenObjects` combat tests.
  - Gap (D-143): auto-tap has one seat-wide flag; a manual override of one payment waits for the UI's payment screen.
  - **M3-01 done, merged (PR #92).**
  M3-02 plan (heuristic AI v0), two PRs:
  - **PR 1: what a seat is shown, the heuristic core, and `eval`.**
    - `seatView(state, player, cards)` in the engine's `view/`: `{ player, view, seen, options }`. Each option is a
      legal action with its mana cost, `payable` (strict: `autoPay` finds a payment now, X as 0), `mightPay` (the
      auto-pass and UI hint), its legal targets per target spec, and, for an activation, the ability as the object has
      it now (granted ones included). It is the one input agent seats read; the web Worker will post the same (D-137).
      The two-worlds check runs on it (brief test and fuzz).
    - The simple agents keep reading only the legal actions: the heuristic is its own function, and the host branches
      on the seat. Golden hashes and the bench must not move. (The fuzzer's leak check builds seat views, D-144.)
    - The heuristic (`packages/ai/src/heuristic/`), stateless per decision, from `SeatView` and the card database:
      mulligan by land count and bottom, play a land, cast the best affordable spell, targets by what the effect does
      to them, attack/block math, a legal answer for every decision kind (an exhaustive switch). No livelock: it starts
      only what's strictly payable, never plans a `cancelCast` or `takeBack`, and plans a declaration with the picks
      already made as part of it, then takes the next pick or finishes. A test fails if a game reaches the host's action
      cap, or if `eval`'s fixed games go void or reach 5,000 heuristic decisions.
    - `pnpm eval`: the heuristic with deck D against `random` with each prebuilt deck in turn, seats and starting
      player alternating, through the match host (auto-pass and auto-tap for both seats), a turn cap counting as not a
      win; win rates and the slowest decision (timed with the `seatView` build). A few fixed-seed games per deck run in
      `pnpm check` with a looser bar. How "95% with each deck" is read goes in `decisions.md`.
  - PR 1 progress: `seatView` (D-144, with `finishable` after the eval found block/take-back loops under Prized
    Unicorn's requirement, and each X answer's cost), the heuristic in `packages/ai/src/heuristic/`, a `heuristic` seat in the host, `pnpm eval`
    (D-145) with ten games per deck in `pnpm check`. First 100-game eval per deck: red-aggro 92%, green-stompy 95%,
    white-soldiers 99%, red-green-beats 86%, blue-black-control 92%; mean decision 0.11-0.15 ms, slowest 13.4 ms.
    After the code review's fixes, 500 games per deck (`pnpm eval --games 500 --seed 1`), no game stuck: red-aggro 94.0%,
    green-stompy 94.6%, white-soldiers 98.4%, red-green-beats 90.2%, blue-black-control 90.6%; mean decision
    0.13-0.16 ms, slowest 40.4 ms (seed 433, red-green-beats). PR 2 brings each deck to 95%.
  - **PR 2: tricks and tuning.** Pump spells and firebreathing in combat, burn to the face when lethal, then tune until
    `eval` shows ≥95% of 500 games per deck, no illegal action, ≤50 ms per decision.
    PR 2 plan (after a loss study: most losses are long games against white-soldiers; late in games the heuristic holds
    Giant Growth, Overrun, Fireball and Lightning Bolt while able to pay, and big creatures it can't pay for, partly as
    Terramorphic Expanse is never used): (1) `tricks.ts`: a pump until end of turn (a spell, Overrun, Firebreathing) is
    worth casting once blockers are declared, where it saves a creature, kills a blocker or attacker, or makes the
    unblocked damage lethal; (2) abilities that sacrifice their own source (fetch lands, Gargoyle Castle) when what they
    do outweighs the permanent; (3) then tune with `pnpm eval` until each deck reaches 95% of 500 games.
    PR 2 result after both reviews (`pnpm eval --games 500 --seed 1`): white-soldiers 99.6%, red-aggro 97.4%,
    green-stompy 97.4%, red-green-beats 97.4% (2 void), blue-black-control 94.0% (94.8% on 2,000 held-out games); no
    illegal action; mean decision 0.12-0.16 ms, slowest under 15 ms but one 56 ms that didn't come back on a rerun (a
    pause after the random agent's 100,000-action loop in that game). The owner made 95% a target (D-149): M3-02 is
    accepted; combat play and its seat-view hints are D-150.
  - Future impact: the LLM seat (M3-02b) reads the same `SeatView`; search later (MCTS) starts from it plus sampled
    worlds. No engine rule changes.
  - **M3-02 done, merged (PRs #93, #94).**
  M3-03 plan (web app scaffold), one PR:
  - `apps/web` (`@mtg/web`, `apps/*` added to the workspace): Vite + React + TypeScript, PixiJS v8 under a React DOM
    layer, GSAP (D-013). Runtime deps react, react-dom, pixi.js, gsap; dev deps vite, @vitejs/plugin-react, React types,
    @playwright/test pinned to 1.63.0 (the version whose browsers this machine has). A decision entry for them.
  - The match host in a Web Worker: `worker/protocol.ts` (typed plain-JSON messages: start a match, submit an action;
    back: the human seat's `SeatView`, its new events, who's deciding, the result), `worker/match-session.ts` (pure:
    message in, session and reply out, unit-tested in Node), `worker/match.worker.ts` (the thin `onmessage` shell),
    `worker/client.ts` (the UI side). The heuristic plays the other seat.
  - `board-model/` (pure: `SeatView` + layout size to cards with positions, unit-tested), `renderer/` (a Pixi scene
    drawing the model; `window.__board` in dev and test builds), `director/` (events to an animation queue; a
    pass-through until M3-07), `effects/` (only its README until the first effect). Enough on screen to see a game
    move (cards by name, life totals, a pass button): the real board is M3-04.
  - Offline: a web manifest and a small hand-written service worker (D-151: precache every built file, pages
    network-first, hashed files cache-first), not vite-plugin-pwa and Workbox: one short readable file.
  - Scripts: `pnpm dev`, `pnpm build`, `pnpm preview`, `pnpm test:e2e` (Playwright: the app loads and shows the board;
    an offline reload still works). `pnpm typecheck` also checks `apps/web/tsconfig.json` (DOM, JSX). CI installs
    Chromium and runs the e2e tests.
  - Future impact: M3-04 fills `board-model` and `renderer`; M3-07 the director; M3-10 saves through the worker; the
    LLM seat (M3-02b) answers in the worker as an outside seat.
  - M3-03 progress: built as planned (D-151). A spike first confirmed the engine, the card pool and the heuristic run in
    the worker in a production build (485 kB). Found on the way: the service worker's cache lookups must ignore
    "Vary: Origin", or every module script misses offline. `pnpm dev` runs; the two browser tests pass (a round trip
    through the worker; an offline reload). The screen is a scaffold: cards as named rectangles, a button per legal
    action (unpayable ones greyed out); M3-04 brings the real board.
  - Owner on the scaffold's screenshot (2026-11-23): "the screenshot looks pretty bad". Expected for the scaffold;
    M3-04 must make the board look like Arena from its first screenshot (arena-research.md, the owner's phone
    screenshots: hand fan, lands row, life and portraits, phase indicator, the pass button, real card frames), and
    show the owner the layout early, before the details.
  - **M3-03 done, merged (PR #95).**
  M3-04 plan (the compact board, the folded phone in landscape, about 812×375 CSS px), three PRs, the look first:
  - **M3-04a, the layout and the look.** The owner's phone screenshots (arena-research.md, "The owner's phone
    screenshots") decide the compact layout; the desktop map only fills what they don't show, marked as a guess in the
    layout data. Portraits are small squares in the top-left (opponent) and bottom-left (person) corners; life totals
    are crests at top centre and bottom centre, the person's over the hand; the opponent's library at the top edge near
    67% W, the person's beside their portrait near 24% W; the opponent's hand backs along the top edge left of centre.
    Each side: lands at the outer left, piled by name with an "xN" count; creatures close to the centre band, centred;
    other non-creature permanents at the outer right and planeswalkers at the right edge (desktop guesses). The phase
    ladder (five steps, combat expanding) above the main button at the bottom right, around the opponent's life crest
    on their turn; the person's hand along the bottom centre, mostly off screen. Battlefield cards are mostly art: the
    pool data has Scryfall art-crop links and Scryfall serves them cross-origin, so 04a loads art at runtime (the
    browser's own cache only; M3-08 adds the offline cache and the first-run download), with an art-less original
    frame as the fallback (D-140); tests never need the network. Frames: art, a name bar, mana symbols as shapes, a
    power/toughness box; tapped as Arena (a small tilt, dimmed, a tap mark). Layout values in one data file per layout
    (M3-05 adds the second), safe-area insets respected; the canvas full-bleed under a DOM overlay (`pointer-events:
    none` but for controls); sprites kept by object id and updated in place (M3-07 moves them). Fixtures (a mid-game
    board, a crowded late one) start the worker from a setup, for tests and screenshots. **Screenshots of both
    fixtures at 812×375 to the owner, before M3-04b.** Done: the owner saw them and many more, shaped the look through
    their notes below, and asked to keep going (2026-11-23).
  - M3-04a progress (2026-11-23): built: layout data (`layout/compact.ts`), the board model (rows, land piles, hand,
    backs, libraries, HUD anchors, safe areas), keyed sprites with original frames, runtime art with a fallback, mana
    symbols as shapes, tap marks, the HUD (portraits, life crests, phase ladder, main button, actions drawer), fixture
    boards (`?fixture=mid-game`, `crowded`). `pnpm check` and the browser tests (desktop and 812×375 touch) green.
    Reviews done; screenshots sent; the owner said to keep going.
  - Owner (2026-11-23), seeing the first look's description and a 2018 Arena desktop screenshot: "I feel like we could
    try harder to make it look like the screenshot. Specifically the cards themselves." Recorded in ui.md ("The
    cards"); the card faces are redrawn to that anatomy (D-153) before the screenshots go to the owner. Code and UX
    reviews are done; their fixes are going in with the redraw (hand parted around the crest, costs sized to fit,
    creature rows shrink before overlapping, a dark art-less fallback, colour glyphs on permanents, damage marked by
    shape, pile backs without text, dim by shading, render on demand, safe-area for the drawer, the layout as a
    `BoardLayout` parameter, rows clear of every HUD piece).
  - Owner (2026-11-23), on the redrawn cards: "Looks a lot better! I think some of the UI other than the cards could
    use some polish, they look a little too generic and basic." Recorded in ui.md ("The rest of the HUD"); the HUD
    pieces are restyled in this slice too.
  - Owner (2026-11-23): tapped lands in a pile should sit on top of the pile, not tapped somewhere inside it, so it
    doesn't look messy. Recorded in ui.md ("Tapped lands in a pile"); each slot now draws its tapped pile in front.
  - Owner (2026-11-23): asked how colourless and multicolour cards and tokens will look (Arena makes tokens obvious),
    and to see screenshots of attacks and blocks. Recorded in ui.md ("Colourless, multicolour and tokens", "Attacks
    and blocks"). Plan, in order: combat on the board (attackers forward with a swords badge, blockers opposite their
    attacker with a shield badge, links), fixtures that reach combat, screenshots of attacks and blocks to the owner;
    then the frames for colourless, multicolour and tokens; then the HUD polish; then screenshots of everything.
  - Owner (2026-11-23) sent four recent Arena phone screenshots of combat, blocking and highlighting what can be
    played; described in arena-research.md ("The owner's phone screenshots, second set"). Taken into this slice:
    the cyan outline on everything playable or able to attack or block now (from the seat view's options); the
    ladder opening into attack, block and damage steps during combat, and the opponent's crest taking the combat slot
    of their ladder; the main button's labels while attacking or blocking ("No Blocks", "1 Blocker", "To Damage").
    Left for M3-04b (touch): picking blockers by tapping, the yellow-orange picked outline and the beam to the attacker
    during the choice, "Cancel Blocks", the "Choose blockers." prompt, the fast-forward button.
  - Owner (2026-11-23): the space between the two battlefields feels cramped next to Arena. Recorded in ui.md ("Room
    between the battlefields"): smaller creature cards and an open gap between the rows, as in their screenshots.
  - Owner (2026-11-23): hand cards in Arena are whole cards (type line and rules text too); recorded in ui.md, drawn
    so in this slice. Asked what hovering over a battlefield card does: answered (long-press details, M3-04c); the
    desktop hover preview was settled by D-160 (a preview, as Arena's desktop client shows).
  - Owner (2026-11-23): Arena doesn't cut off card names; recorded in ui.md, names now shrink to fit.
  - Owner (2026-11-23): mana costs should overlap the hand card's top edge slightly; recorded in ui.md, done.
  - Owner (2026-11-23): "how does the expanded view of your hand look like". Not built yet (it was 04b's); built now in
    this slice: the open hand's layout (arena-research.md, "The hand, opened") and a tap on the hand to open or close
    it. Playing a card from it stays 04b.
  - Owner (2026-11-23): cards in hand can be the actual card image; recorded in ui.md, done (Scryfall's full image at
    runtime, our drawn card as the fallback).
  - Owner (2026-11-23): "I haven't been able to start the local app yet but I'm wondering what animations are like."
    Answered: there are none yet; cards move to their new places at once. Animation is M3-07 (the director: GSAP
    timelines from the engine's events, ui.md "Animation and feedback"). Gave the steps to run it locally.
  - Owner (2026-11-23): "Can you show me what a long-press view looks like?", then "If it's not built yet then that's
    okay." It stays in M3-04c. Its design, from the first try: a pure `examine(shown, id)` in board-model gives the
    card's name, type line, full image and artist, then panels: one per paragraph of Oracle text (titled by its
    keyword, else "Triggered ability", "Activated ability" or "Ability"), one per keyword it has that its text doesn't
    give it ("Given by an effect"), and its state (token, changed P/T against printed, damage, counters, tapped,
    summoning sick, attacking, blocking whom, regeneration shields, a choice made as it entered). A hit test finds the
    topmost card under a point; a hold of about 400 ms opens a dark overlay (card large at the left, panels at the
    right, the artist credit, D-155), and the click after a long-press is swallowed so it doesn't also toggle the hand.
  - Owner (2026-11-23): "Is the opponent health upside down" — its blades were mirrored to point down; both crests'
    blades now sweep up, as in their screenshots.
  - Built since: the frames for colourless, multicolour and tokens, and the HUD polish. Final code review done; its
    two must-fixes (a pick from a pile moved the whole pile; a combat test that passed without a step) and most
    should-fixes are in. The final UX review is running; then the PR, and the owner tries a local build once it merges.
  - Owner (2026-11-23), for M3-04b: "this app should be compatible with mouse/keyboard controls as well as touch
    devices." Recorded in ui.md ("Mouse and keyboard too"): pointer events serve touch and mouse alike, the long-press
    view also opens with a mouse, and the keyboard can do everything (focus, Enter/Space, Escape, a main-button key).
  - Owner (2026-11-23): the actions menu feels strange; they expect to click and drag cards. Confirmed it's temporary:
    M3-04b replaces it with direct play on the cards and removes it.
  - Owner (2026-11-23), for M3-07: big emphasis on animations and effects ("that's what makes mtg arena feel so
    polished"), nailed down solid; watch gameplay videos if possible. Recorded in the milestone (M3-07). Video hosts
    were blocked in the research passes: before M3-07, ask for a host allowance or the owner's screen recordings.
  - Owner (2026-11-23, going to sleep): "I'm hoping to wake up to everything more or less done and ready for review
    and refinement." Overnight plan, in order: finish the final UX review's fixes (names never cut, pile counts on top
    and room between rows, the tap mark off the name, gang blockers' links and badges, the button's combat
    destinations, "Opponent's Turn" on one line), PR and merge M3-04a on green CI (D-027); then M3-04b (touch, mouse,
    keyboard: play from hand, targets, attack and block by tapping, prompts for every decision, the actions menu gone,
    smart auto-pass), each slice with its tests, reviews and its own PR; screenshots and a summary waiting for the
    owner. Items the UX review left for later (keyword badges, the long-press view) stay in M3-04c's list.
  - Owner (2026-11-23): saved an OpenRouter API key for the LLM opponent (M3-02b); now a network secret (below).
  - Owner (2026-11-23, morning): wants both "All Attack" and drag to play. "All Attack" isn't an engine option (each
    attacker is its own pick): a button beside the main one during the declaration, sending a pick for every creature
    that can attack, one at a time, then leaving the declaration open to adjust. Drag to play: drag a hand card up onto
    the table to play or cast it, as the second tap does. Both go into M3-04c, first.
  - Owner (2026-11-23, morning): asked to move the OpenRouter key to a network secret. Done: it's a network secret for
    openrouter.ai on the "open-mtg-arena" cloud environment (the proxy adds `Authorization: Bearer` to each request;
    a check of `/api/v1/key` answered 200), and the plain `OPENROUTER_API_KEY` variable is removed. Code that wants a
    key in a variable (M3-02b) sets a placeholder such as `proxy-injected`; the proxy replaces the header. Tests and
    CI never call it.
  - Owner (2026-11-23): "continue until you need feedback on open questions. I would stress that mtg arena is the
    North Star so if there's a question, do what arena would do" (D-160). So the desktop hover question is closed:
    hovering a card shows a large preview, as Arena's desktop client does.
  - Owner (2026-11-23, after trying the live site on the phone): "looks good so far but feels a bit buggy"; will give
    suggestions and questions once M3-04c is finished. Ask for them then, with the live link.
  - Owner (2026-11-23): wants to follow progress on the phone: the app is published to GitHub Pages from `main`
    (D-159), at https://benjaminhor.github.io/open-mtg-arena/. The owner enables it once (Settings → Pages → Source:
    "GitHub Actions"); each merged pull request is live a few minutes later.
  - Owner (2026-11-23): on the stops in your own upkeep, draw step and end step, "whatever MTGA does, do that". D-157
    is that (Arena's documented default), so it stays; the open question is closed. The rule for stops is Arena's.
  - Owner (2026-11-23, morning) on M3-07: will likely provide screen recordings of Arena for the animation study.
  - **M3-04c first slice merged (PR #100, squash, 2026-11-23): All Attack, Clear Attacks, taking one attacker out,
    and drag to play.** Waiting on the owner's phone check (a real finger, iOS Safari).
  - **M3-04c slice 2 done (2026-11-23): the card view**, Arena's "Examined" view. A long-press (400ms, touch), a
    right-click, or "i" on a focused card shows it large with its full image (or its text, for a token; the image's
    printed credit is the artist's credit, so no caption: owner, D-155), and beside it a hanger for each thing the
    face doesn't say: each keyword's reminder in our own words, protection, summoning sickness, counters, damage,
    regeneration shields, what it's attached to or what's attached to it, control vs ownership, a chosen name or type, token, copy, and power/toughness against the printed
    card. A tap anywhere, Close or Escape closes it. A mouse resting 600ms on a card shows the same as a preview that
    passes taps through. No rulings: Arena has none (D-160). An ability on the stack shows its source card.
    `interaction/card-details.ts` (pure, tested), `hud/CardView.tsx`, `hud/card-inspect.ts`; e2e on both sizes.
    Code review fixes: the view holds the card's id and reads it from the seat view as drawn (it follows the game, and
    closes when the card is gone); a backdrop tap no longer also "puts things down"; a long-press waits for its release
    on the window (the region may be redrawn) and stops a drag starting; the full view takes focus to Close and gives
    it back; every card region is focusable for "i"; Escape over a preview does its usual job; a preview ends when the
    mouse is off its card even if the region went; summoning sickness worded from CR 302.6; an ability whose source
    left shows the printed source; a token's type line has its subtypes.
    UX review fixes: no key reaches the board behind a full view; the card's text shows until its image loads (and
    stays if it can't, offline), the image starts loading on the press, and it's the large one (sharp at DPR 2–3); a
    held card shows a ring filling over the 400 ms at once; the view fades and grows in (160 ms; only fades with reduced
    motion); the card has a fixed place at the left (Arena's) with a fixed-width hanger column, so it never shifts; a
    preview goes on the half of the screen away from the card hovered; sweeping from card to card swaps the preview at
    once; a long hanger list fades at its end; no iOS "Save image" sheet or image drag; a right-click on the backdrop
    closes the view; the stack's card is focusable for "i"; the token text card puts its P/T at the bottom right.
    Left for the slices that own them (UX review): the P/T hanger naming its sources ("+1/+1 from Honor of the Pure")
    and a current-P/T pill over the image's printed box (slice 3); an ability on the stack shown with its own text and
    targets, not only its source card, and the stack's large card hiding the creatures under it from the view (slice
    5); a hover over the collapsed hand previewing the card under the mouse, and a hand card enlarging in place on
    hover as Arena's does (slice 6); a token's card drawn in its colours.
    Advisor pass: a touch's context menu (Android, during a long hold) neither opens nor closes the view; the view
    clears the safe-area insets; the large image is fetched only 120 ms into a hold or rest (not on every tap or
    sweep); a preview swap doesn't replay the fade; Space on a card only there to be looked at still presses the main
    button. Design recorded as D-161.
  - **M3-04c slice 2 merged (PR #102, squash, 2026-11-23).**
  - **Owner (2026-11-23): "Minimal throughout" (D-162).** Asked after the owner shared another web app's screenshots;
    chosen over "keep Arena's look" and "clean cards, Arena layout". So a restyle comes first, as its own slice, and
    the badges after it are drawn in the new style:
    - **Slice 3, the minimal restyle:** a flat dark table (no texture or rings); a permanent is its art only, no
      frame or name strip, its name in small white text over a dark fade at the art's bottom left, power/toughness in
      a small dark pill at the bottom right (raised blue, lowered red, as now); lands the same; a token the same
      (its name on the fade); tapped: tilt and the curved arrow, as now; playable: a thin bright outline, not a glow;
      the phases as a row of plain text labels with the current one lit; life totals as large plain numbers with
      small zone counts beside the portraits; the main button a calm flat pill. Hand cards stay whole card images.
      Future impact: the badges (3a below) and attachments (3b) are drawn on this frameless tile.
      Two PRs (advisor): first the table and the battlefield tile (renderer only), shown to the owner; then the HUD
      (life, main button, ladder as text, portraits, prompts, card view) through the CSS tokens, the ladder sized in
      the board model. The ux-reviewer reviews both together at the second.
      - Slice 3 PR 1 done (2026-11-23): the flat table (#22211f) and `renderer/battlefield-tile.ts`: art only with
        rounded corners, name in white with a soft shadow over a smooth dark fade at the bottom left, P/T in a small
        dark pill at the bottom right (light blue raised, light red lowered, damage underlined), the name always on
        the pill's line, shrinking to fit beside it (owner: "on the same line"), a token's arched top, no art: the colour with its glyphs.
        Playable is a thin solid cyan outline (hand cards too), a pick a thicker yellow-orange one. `card-face.ts`
        now draws only whole cards (hand, stack).
        Owner on it: names and P/T on one line (done), and the font should match the reference: Inter, bundled
        (D-163), names at natural width, growing with the tile on a desktop.
      - Owner (2026-11-23), next in the restyle: the player info in the left corners as in the reference (ui.md,
        "Player info in the left corners"): label, large life, Library/Graveyard/Exile counts; replaces the
        centred crests and the portraits. A board-model change (the anchors), so its own commit with layout tests.
        Done (D-164): `hud/PlayerInfo.tsx`, `overlay.player` anchors, no crests, portraits or library piles; land rows
        start right of the blocks; the hand a plain centred fan; the opponent's ladder at the top centre; layout tests
        updated.
      - UX review of the restyle (2026-11-23), fixed: targets are a dashed outline (cards and players alike), apart
        from the solid "can be played" one (`targetIds`, `BoardCard.targetable`); outlines drawn inside a tile's edge,
        so neighbours' never merge; the player block's target outline around it, not through its counts; prompt panels
        opaque; card backs a step lighter; one ladder, on the active player's side. Long names on a phone's tiles: the
        owner chose "Fade under the pill" (ui.md "Long names"): 7 px at the least, then cut at the pill with a fade.
        Left for later, recorded here: a picked blocker shows only a thicker outline until assigned (give it its
        hollow shield badge); raised and lowered P/T differ by colour only (add a caret or over/underline); full
        control differs by colour only (add a detail line); the HUD doesn't scale up on a desktop (a --hud-scale);
        land pile names covered by the tapped sub-pile or the next slot (pre-existing); colourless no-art tiles are
        blank (a type glyph); Fireball's X wraps 0-6 then 7; the divide panel covers what's divided; "Open your hand"
        is 40 px tall; planeswalker loyalty (the badges slice).
      - Part 2 done in the same PR (#103): the HUD flat and calm through CSS tokens (`--panel`, `--edge`,
        `--accent` a soft peach, `--muted`): plain life numbers on a dark disc, flat portraits with an accent ring
        for the active player, a flat accent main button (full control a flat blue-violet), flat icon ladders (text
        labels don't fit at phone width, ui.md), flat prompts, menus and buttons, plain dark card backs and badges.
  - **M3-04c slice 4a done (2026-11-23): badges on a permanent (D-166).** `board-model/badges.ts` (pure, tested in
    test/badges.test.ts), `BoardCard.badges`, `renderer/badge-marks.ts` (keyword icons, the ellipsis, "zz", counters,
    the loyalty shield), placed by `battlefield-tile.ts`; a `badges` fixture (and an e2e smoke test on it). Sick
    creatures dimmed too (owner). After the code review: sickness shown until its controller's next turn, the
    opponent's turn included (CR 302.6); the icons fit the room the counter leaves; badges below a token's arch; the
    "zz" drawn as strokes. After the UX review: only the art dims (name and P/T stay readable); a sick creature
    dims only on its controller's turn; first strike, protection, reach, trample and indestructible redrawn so no two
    icons (or the combat badges) look alike; the ellipsis without a disc; loyalty's numeral at P/T size. Hover
    preview at 250 ms (owner). Left from that review: a token's badges sit lower than its neighbours' (the arch);
    the settings cog covers the far-right opponent permanent at 812x375 (pre-existing); a counter of another kind is
    a bare number (none in the pool yet). Next: 4b, Auras and Equipment beside their host.
  - **M3-04c slice 4a merged (PR #105, squash, 2026-11-23).**
  - **Slice 4b done (2026-11-23, D-167): Auras and Equipment beside their host**, with a link mark; an
    `attachments` fixture and test/attachments.test.ts. The plan it followed:
  - **Slice 4b merged (PR #106, squash, 2026-11-23).**
  - **Slice 5 done (2026-11-23, D-168): graveyards, exile and revealed cards.** A tap on a player's info block opens
    the zone browser (tabs Graveyard / Exile / Hand / Library top, a sideways-scrolling row, the card view over it); a
    long-press, right-click or "i" opens it even while the player is a target. A revealed library top shows as a
    small art tile by its player's block, a revealed hand as an eye chip. `interaction/zones.ts` (test/zones.test.ts),
    `hud/ZoneBrowser.tsx`, `hud/long-press.ts`, a `zones` fixture, e2e/zones.spec.ts (both sizes; a real touch
    long-press, whose click-swallow a mutation check confirmed the test catches).
    Review fixes (code review and UX review), in D-168: the release of a long hold no longer closes the browser it
    opened (the e2e now holds 1.2 s); focus kept inside the sheet (an e2e, mutation-checked); revealed marks within the
    block's width and inert while targeting; revealed cards keyed by identity and copy; drawn-card fallbacks offline;
    "Opponent"/"You" heading, one sheet height, a "Waiting for you" line; press states, 44 px taps, snap scrolling,
    lazily drawn long rows; the block's label carries life and counts for screen readers.
    Left from the reviews: the board model doesn't reserve the marks' room (they fit the outer column at every size
    measured); the card view over the browser is barely larger than a row card on a phone (ask the owner at the end);
    the tabs have no arrow-key movement; a settings menu left open under the sheet takes the first Escape.
  - **Slice 5 merged (PR #107, squash, 2026-11-23).** Next: slice 6, the stack.
  - **Slice 6 first PR done (2026-11-23, D-169): the whole stack, abilities as panels, stack details in the card
    view.** `board-model/stack.ts` (`stackCards`, `stackMore`), `board-model/ability-text.ts` (tested over the whole
    pool), `interaction/stack-details.ts`, a Stack tab in the zone browser for a deep stack ("All n"), a `stack` fixture,
    test/stack.test.ts, test/ability-text.test.ts, e2e/stack.spec.ts. Test helper `playFrom` (fixture-views.ts) plays
    the test's own actions in full control. Review fixes (code and UX, in D-169): the cascade peeks out upward
    within the top's old block (leftward it covered creatures and took their taps), a "Stack n" button from two
    objects, strip-sized tap regions, panel art credited and offline-safe, panels in Inter, the pool test compares exact
    costs, `Browsing` a union, one `names.ts`. Next PR: target arrows and the collapse tap. Not done: X drawn on the
    spell itself [R] (it's in the card view); canvas text shows "{T}" as letters (hand cards too, pre-existing).
  - **Slice 6a merged (PR #108, squash, 2026-11-23).** Next: 6b, target arrows and the collapse tap.
  - **Slice 6b merged (PR #109, squash, 2026-11-23).** Next: slice 7, finishing (portrait prompt, leftover UX items,
    a full game at phone size), then ask the owner for feedback with the live link.
  - **Import plan (D-177, 2026-11-23, written before starting).** phase-rs v0.131.0 (57c647e) replaces our engine
    and client; the repo diverges freely; "Open MTG Arena" on screen; no multiplayer, servers, cloud sync or desktop
    app. Phases, each its own commit, one PR:
    - A. Import: their tree copied in; ours (apps/, packages/, our scripts and configs) removed. Kept: docs/ (project
      memory; their docs into docs/engine/), rules/ (the CR), .claude/ (updated), the license (with their copyright
      line kept, as MIT and Apache-2.0 require) and a NOTICE crediting the origin.
    - B. Strip: the server crates, lobby, peer-to-peer, Supabase, Tauri and its updater, telemetry, the MTGGoldfish
      scraper and feeds, their deploy and infra files, their agent configs, Ko-fi/Discord/DMCA contacts, and assets
      without a known source (kept only with a source and any credit it needs).
    - C. Rebrand: every phase-rs name, logo, domain and string in the app, the PWA manifest, i18n, crate and package
      names; the Magic words "phase" and "phasing" stay.
    - D. Build and CI: the pinned nightly Rust, the WASM engine, card data from MTGJSON, the client; GitHub Actions
      to test and deploy to GitHub Pages at the same address.
    - E. Verify: the build plays a match against the AI in a browser at the folded and unfolded sizes.
    - F. Docs: CLAUDE.md, README, architecture, roadmap and status rewritten for the new base and the next goals (the
      LLM opponent, the single-player RPG or roguelike).
    - Revised after review (before starting): build the untouched clone first and play it from a /open-mtg-arena/
      subpath (Pages); leave out their CLAUDE.md, AGENTS.md, GEMINI.md, agent config folders and .github/workflows at
      copy time (a root CLAUDE.md is loaded as instructions; their workflows would run on our push); the import
      commit brings our own CLAUDE.md, CI and commit helper with it; green on the untouched import first, then strip
      leaf-first building after each removal (anything that can't come out green is disabled and listed), then
      rebrand by an explicit token list (phase-rs, phase.rs, phase_rs, phase-rs.dev, data.phase-rs.dev, the crate
      names phase-ai/-ast/-llm/-parser/-server), never bare "phase", with a CI grep over the built output; this PR
      changes no behaviour (the fair AI and phone work come after); NOTICE names the upstream commit.
    - Progress (2026-11-23): their pinned toolchain (nightly-2026-11-19, wasm32 target) installs here; crates.io,
      MTGJSON and the Rust dist are reachable; building wasm-bindgen-cli 0.2.121 and the release engine WASM in the
      clone at scratchpad/phase-src/repo. The owner: keep their art and audio (credit Kevin MacLeod), keep the copyright
      line and NOTICE in the license files (D-177).
    - Rebrand inventory (in the clone, excluding target/ and node_modules): "phase-rs" in 381 files, "phase.rs" in
      127, their domain "phase-rs.dev" in 76, "PHASE_" (env and config names) in 462, Ko-fi/Discord/contact email in a
      handful; crate names phase-ai (136 files), phase-ast (88), phase-llm (10), phase-parser (364), phase-server (164).
    - Strip map (Rust): phase-server, server-core and lobby-broker are leaves (nothing the browser game needs depends on
      them) and go whole, with lobby-worker/, deploy/, docker/, supabase/, Dockerfile, Caddyfile, Tiltfile;
      feed-scraper, combo-table-gen (Commander Spellbook data), manabrew-compat (another app's wire protocol),
      probe-pin and engine-inventory-gen are dev tools to drop or keep after a look. engine-wasm depends on
      seat-reducer and state-codec (kept for now: snapshots and saves). draft-core/draft-wasm are offline drafting
      against the AI (kept).
    - Strip map (client/src, non-test files): peer-to-peer in about 70 files, the lobby in about 79, Tauri APIs in 15,
      the updater in 17, telemetry in 25, Supabase in 2, the feeds in 1, Ko-fi in 1: the online pages and services go,
      then type errors lead to each remaining use.
    - No `pre-import` tag (the owner: "Never mind then, not a big deal"); our own engine and client's last state is
      main at 46cc91c, the M3-05 merge.
    - Build facts (this container, 4 cores, 15 GB): the release engine WASM compiles from scratch in about 20 minutes
      (`cargo build -p engine-wasm --target wasm32-unknown-unknown --release`); wasm-bindgen-cli 0.2.121 (their
      lockfile's) installs with cargo; the client's packages install from their lockfile in seconds (pnpm 9.15.9).
    - Their release WASM profile (opt-level z, full LTO, one codegen unit) runs out of memory at the engine's final
      link in this 15 GB container (killed twice; a first run's exit was hidden by a pipe). Their CI builds it on a
      standard 16 GB ubuntu-latest runner in under 30 minutes, so our CI can too. Locally the evaluation uses their
      `wasm-dev` profile (`./scripts/build-wasm.sh wasm-dev`: opt-level 2, no LTO). That compiles the engine WASM in
      about 21 minutes using about 8 GB, but carries debug info (an 818 MB .wasm) that wasm-bindgen can't load in
      the memory left; stripping the `.debug_*` custom sections first (a small node script) leaves 271 MB, which
      binds. The release build is the one to ship; its size is still to measure on CI.
    - Untouched build plays (2026-11-23): card data generated in about 15 minutes (MTGJSON cached): 36,406 cards,
      29,622 fully supported (81.4%), 1,396 decks (681 fully playable); `card-data.json` is 98 MB (7.6 MB brotli),
      so it's generated in CI, never committed (GitHub's file limit is 100 MB). The client builds in about 5
      minutes (`pnpm build`). Served locally, a match against the AI at 812x375 ran from the die roll through the
      mulligan and several turns to the cleanup discard, with every phase-rs host blocked and no request made to
      one; two console errors ("reading 'startsWith'" of undefined) to trace.
    - The owner, on the strip: "we can probably remove any online multiplayer related frontend client code and
      tests" (as D-177 has it).
    - **A. Import committed (ed49f34, 2026-11-23)** on the working branch, not yet in a PR: their tree at 57c647e by
      `git archive` (none of the local build outputs), minus the exclusion list in the commit message; their docs in
      docs/engine/; our CR scripts in tools/rules/; LICENSE-MIT with both copyright lines, NOTICE with the origin and
      the Kevin MacLeod credit; new CLAUDE.md, README and CI (.github/workflows/ci.yml: client type-check and unit
      tests, `cargo check` of the engine WASM). No Pages workflow yet (main still has the old app). A scan of the
      import for keys and tokens found none; its largest file is 6.5 MB. Their client type-check passes here (about
      a minute). `.claude/settings.json` still allows `node scripts/rule.mjs`: editing permissions isn't Claude's to
      do, so the moved script may prompt.
    - B. Strip, in progress (2026-11-23). Client unit tests at import: 754 files pass, 2 fail (they test the Caddy,
      Tilt and Helm files left out at import, so they go), 12,949 tests pass, about 7 minutes. A helper is removing
      online multiplayer, cloud sync, Tauri, telemetry and the scraped feeds from client/ (working tree only,
      reviewed before commit). Rust: phase-server, server-core, lobby-broker, feed-scraper and lobby-worker/ removed;
      the workspace's cargo-release block (it bumped the desktop app's versions) and two aliases for removed crates
      gone; Cargo.lock updates on the next cargo run.
    - Client strip, first pass (helper agent; WIP commits up to 41c324c): 429 files deleted, 296 changed; type-check
      and lint clean; unit tests 574 files, 7,414 tests pass (from 12,949: online-only tests went with their code).
      Removed: peer-to-peer and WebSocket play, the lobby, tournaments, spectating, pod drafts, Supabase sync, Tauri
      (src-tauri, updater, deep links, native engine), telemetry and card reports, the eight scraped metagame feeds
      (starter-decks.json kept), Discord/Ko-fi links, the `tournament` i18n namespace; packages @supabase/supabase-js,
      @tauri-apps/*, peerjs, wrangler. Behaviour the owner will see: no deck import from a Moxfield/Archidekt link (it
      went through their server; restorable from 4fb4ed6's parent ed49f34), no Commander/Winston pod drafts, no
      Multiplayer or Experimental settings tabs, no status banner; the Jev LLM provider needs a relay address
      entered by hand. Checked: no offline takeback was lost (only the online adapters ever offered the menu's
      takeback; a vs-AI game's undo is the Undo button by the player's info, unchanged), and a vs-AI game seats the
      human at 0 as before (the tests that moved to seat 0 were set up as online games). Left for the rebrand: links to the upstream project
      (PreviewBadge, commit links, "report an issue"), Aetherhub links, `multiplayer` names that now hold only seat
      names and best-of-three sideboarding. The integration suite (`pnpm test:integration`) needs the built engine
      WASM; not run yet.
    - Subpath done (94198bd) and checked locally: built with BASE_PATH=/open-mtg-arena/ and served there, every
      file loads (no failed request), navigation and a direct link (/open-mtg-arena/my-decks) work, the only outside
      host is Scryfall. (Serve it with `BASE_PATH=/open-mtg-arena/ npx vite preview`, or files 404.)
    - Found then: the AI has no decks in 60-card formats. In Standard, Modern and the rest it drew from the scraped
      metagame feeds the strip removed; the five starter decks are labelled "standard" but aren't Standard-legal
      (Lightning Bolt, Jackal Pup...), so the legality check drops them. Commander still has 200 AI decks (MTGJSON
      precons). Fixed (f47a0fd, the owner asked for the feeds back): the import's MTGGoldfish and TopDeck.gg snapshots
      are bundled again (client/public/feeds/, never refreshed, credited in NOTICE). AI decks now: Standard 9,
      Modern 10, Commander 223. A Standard match (Mono-Green Landfall, picked from the Standard Meta feed) played
      several turns under /open-mtg-arena/ with no failed request.
    - Found in that match (2026-11-24): every card was a text-only frame, no art. The image index files
      (scryfall-data.json, scryfall-printings.json, scryfall-token-images.json, scryfall-sets.json) come from four
      `scripts/gen-scryfall-*.sh` that their setup.sh runs after the card data; I hadn't run them and pages.yml
      didn't either. Both fixed: they ran here in about a minute, and pages.yml now runs them. (The per-language art
      maps, gen-scryfall-locale-images.sh, aren't generated: a missing one falls back to English art.)
      Checked after a rebuild: the same match shows card art and portraits, no failed request, no page error.
    - Rebrand done (25c14de, 2026-11-24), driven by `scripts/check-brand.sh` (explicit tokens, case-sensitive since
      "Phasers" is a card, never bare "phase", path-like `types/phase.rs` excluded). CI runs it over the client's
      sources and data/; pages.yml over the whole built site, WASM and generated data included, before upload. Done:
      name everywhere on screen and in all nine languages, manifest, title, loading shell; new logo and icons from
      `client/public/icons/logo.svg` (our earlier two-card mark) and a plain house for the Home tab (theirs was a gear
      with a sparkle, like their logo); repo and "report an issue" links point here; the "Try Preview" badge,
      config.js, their data host's cache rules and dev-proxy hosts removed; What's New holds one entry of ours
      (`client/public/changelog.json`, written by hand from now on); starter decks' author; the two engine strings
      that ship in the WASM; 40 upstream-only scripts deleted (hosting, bots, releases, PR analytics, SSL, Tauri,
      lobby). Also restored what the strip removed with the feeds: the "Data provided by" credit under MTGGoldfish
      and TopDeck.gg decks and the original MyDecks tests. Client: type-check, lint (0 errors), 7,404 unit tests.
    - Deferred on purpose (advisor, 2026-11-24): renaming the crates (phase-ai, phase-parser, phase-ast, phase-llm:
      about 540 files, a cold engine rebuild) and the ~250 engine files whose comments link upstream issues or say
      "phase.rs". None of it reaches the app, and the Odin port replaces that code. Also left: docs/engine/ (their
      docs, kept as they came), internal names such as the `phase-deck:` storage keys, `PHASE_` env names and the
      `__PHASE_CONFIG__`-era comments, and the version number (0.131.0, theirs).
    - The release WASM builds on GitHub's runner (Pages run 17 on this branch, 2026-11-24, deploy skipped as
      designed): engine 25 min, card data 31 min (MTGJSON cold; cached per ISO week after), image index 1 min,
      client 6 min, about 66 min in all. The temporary branch trigger is removed again; deploy runs only from main.
    - Also found: starting a game threw "reading 'startsWith'" (from the import, not the strip): activeGameChange.ts
      dispatches a plain `Event("storage")` with no key, and the AI deck catalog's listener assumed a StorageEvent.
      Fixed to ignore non-StorageEvents; test in aiDeckCatalog.test.ts.
    - Subpath: their client assumes the site's root (`BrowserRouter` with no basename; about 90 root-absolute paths
      such as `/audio/...`, `/card-data.json`; the manifest's `start_url` "/"). For GitHub Pages at /open-mtg-arena/:
      Vite `base`, the router's basename, one helper that prefixes `import.meta.env.BASE_URL` to asset paths, a copy
      of index.html as 404.html for deep links, and a relative manifest.
  - **M3-05 merged (PR #115, squash, 2026-11-23).** Paused after it: the owner is weighing building on phase-rs
    (Open questions; docs/phase-rs-evaluation.md).
  - **M3-05 built (2026-11-23, D-176): the full layout, picked by size, switching live.** `layout/full.ts`,
    `layout/layout-for.ts`; lands shrink before overlapping, start clear of the info block only when level with it,
    the stack capped in width; tests: test/full-layout.test.ts (eight full sizes, mutation-checked),
    e2e/layout.spec.ts (fold and unfold mid-target and with a card lifted, then finish the action). The owner chose no
    game log. Code and UX reviews done and applied (in D-176: the card basis, rows clear of the stack, the land
    rules, the controls a size up). Left, from the UX review: the mulligan screen in the full layout could show the
    seven cards whole and centred (Keep/Mulligan sit far from them); the mouse preview shows a hand card beside the
    open hand; the small buttons ("Clear Attacks") can cover the hand's right end; on an upright screen the rows
    leave empty space above the hand. Next: the PR, the owner's unfolded screenshot.
  - M3-05 plan (2026-11-23, written before starting; the owner: "move forward with M3-05"). Spec: m3-first-playable.md
    M3-05: the Arena-like layout for the unfolded phone (7.6-inch, nearly square, either way up) and desktop, switching
    live on resize with no loss of state or selection; accept: a Playwright test resizes mid-selection and it survives.
    - Seen first (the compact layout at 1280x720, 1024x768, 1000x860, 860x1000): it plays, but sizes are shares of the
      height, so on the near-square screen cards are huge, land piles overlap, the stack covers the outer row, and the
      hand strip is oversized.
    - `FULL`, a second `BoardLayout` value (`layout/full.ts`): Arena's desktop proportions [R: arena-research.md
      "Desktop match screen"], battlefield cards about 10-12% of the height, the stack at the right edge clear of the
      outer rows, a smaller share of the hand, px controls a little larger. Any change of shape the full layout needs
      goes into the model as data, not a fork of it.
    - `layoutFor(size)` (pure): compact for a short screen (a phone in landscape), full otherwise; the App picks it on
      every size change, so a fold or a resize re-lays out with state, the lifted card, the chosen targets and the
      open hand kept (they're React state, not the layout's). `__board` names the layout for tests.
    - Tests: `layoutFor`; the board-model invariants (inside the screen, clear of the HUD, rows apart, the hand in its
      strip, the stack clear of the rows) run over both layouts at the folded, unfolded both ways, tablet and desktop
      sizes; e2e: resize mid-selection (a target being chosen, a card lifted) between folded and unfolded, the
      selection survives and the layout switches.
    - Screenshots at the folded, unfolded and desktop sizes, the ux-reviewer, then a PR; the owner tries it unfolded.
    - Future impact: the layout stays data (D-152), so the RPG's boards and a multiplayer layout are more values; no
      layout reads the device, only the size (ui.md).
  - The owner on the live stack labels and ladder walk (2026-11-23): "Seems fine at the moment, move forward with
    M3-05". Next: M3-05.
  - **Ladder walk merged (PR #114, squash, 2026-11-23).** Next: the owner tries the live site (the stack's labels,
    the walking ladder, the opponent's phase moments); then M3-05 with their feedback taken in first.
  - **Ladder walk done (2026-11-23, D-175): the lit rung moves through each phase passed, never jumping.**
    `interaction/ladder-walk.ts`, `app/use-ladder-walk.ts`, `ui.ladderAt` (board-model), short ladder while walking,
    a 150 ms frame for each new phase of the opponent's turn (`HOLD.phase`); tests: test/ladder-walk.test.ts,
    test/pacing.test.ts, e2e/pacing.spec.ts ("walks the phase ladder", mutation-checked). Code review done and applied
    (in D-175). Next: the PR, then ask the owner to try the live site.
  - **Stack slice merged (PR #113, squash, 2026-11-23).**
  - **Stack slice done (2026-11-23, D-174): a "Stack n" header from one object, the top ringed and tagged with whose
    it is, the ones under it as readable rows.** `hud/StackLabels.tsx`, `board-model/stack-labels.ts`, 20 px strips
    while large (`stack.ts`); tests: test/stack.test.ts (the header from one, the ring, tag and rows, standing down
    under the open hand, row heights, controller not owner), e2e/stack.spec.ts (rows and tags, the opponent's lone
    spell at seed 7 labelled as it's held). Code and UX reviews done and applied (in D-174). Next: the PR, then the
    walking ladder (D-175).
  - Stack slice plan (D-174, 2026-11-23, written before starting; the owner: "it's not immediately obvious that there's
    something on the stack", and Forge's stack list "but more polished"):
    - What they saw: an opponent's spell held at the right edge as a bare card; nothing says it's the stack, whose it
      is, or that it waits on them (only the main button's "Resolve" does).
    - A header over the stack from one object on: "Stack · n", a tap lists them all, top first (the old "Stack n"
      button, which showed only from two).
    - Whose each object is, in words and colour (never colour alone): the top object ringed in its controller's
      colour (orange yours, blue the opponent's, Arena's turn colours [R]) with a "Yours"/"Opponent's" tag; each one
      under it a readable row (a tag and its name, in Inter) over its strip instead of the card's tiny frame text,
      strips at least 20 px while large.
    - The board model keeps every rect (the header, the strips' `shows`); the HUD only places at them.
    - Tests: board-model (the header from one object, row heights, the tag from the controller), e2e (the opponent's
      spell at seed 7 shows the header and "Opponent's" while it's held), the existing stack tests updated.
    - Future impact: none on the engine; M3-07 animates objects into this column.
    - The ladder walking through passed steps waits on the owner (what Arena does wasn't found).
  - **Pacing slice merged (PR #112, squash, 2026-11-23).** Next: the owner tries the live site (pacing timings,
    the zone browser's spacing on their phone), then M3-05 with their feedback taken in first.
  - **Pacing slice done (2026-11-23, D-172): the host's run shown frame by frame, a line saying what happened, Skip.**
    `advanceOne` (packages/match), frames in the worker's reply, `interaction/pacing.ts`, `interaction/event-line.ts`,
    `app/use-playback.ts`; tests: test/match-session.test.ts (frames, no event lost), test/pacing.test.ts,
    packages/match/test/host.test.ts, e2e/pacing.spec.ts (normal pace, Skip, the settle moment after it). Holds are
    guesses to tune with the owner.
    Code review fixes (in D-172): the turn banner shows every turn again (an e2e checks it goes and comes back), the
    settle moment at playback's end, frames without options, a turn begun by the person's own action as its own frame,
    lines naming what moved. Left: playback's position logic as pure functions with unit tests (the hook is covered
    only by e2e); the worker builds frames' views even at instant pace.
    UX review fixes (in D-172): holds retuned, summed damage and token lines, playback paused while looking, the hand
    closed when playback starts, one slot for the line and the banner, a quiet Skip. Left also: no performance trace of
    playback; the ladder stepping question (Open questions).
  - Pacing slice plan (D-172, 2026-11-23, written before starting): "the game never jumps".
    - The match host gets a one-action step (`advanceOne`), and the worker's update loops it, keeping a frame (the
      person's seat view and the events since the last frame) after each host action worth seeing: an opponent's cast,
      activation, trigger, land, attack or block, a resolution, damage, a new step or turn. Pure passes and mana fold into
      the next frame. The reply carries the frames before the final view (capped), `shown` stays the final one.
    - The app plays them in order (`interaction/pacing.ts`, pure: how long each frame holds, from its events: an
      opponent's spell or ability ~0.9 s on the stack [R: Arena holds each at least 0.4 s], an attack or block ~0.9 s,
      a resolution ~0.5 s, a land ~0.5 s, a step ~0.25 s), with a line saying what happened ("Opponent cast Lightning
      Bolt", `interaction/event-line.ts`). Nothing can be pressed meanwhile; a tap or a key skips to the end. The e2e
      build plays at instant speed (ui.md / M3-07: "tests run at instant speed"), with `?pace=normal` for its own test.
    - Tests: the worker's frames (an AI turn gives frames for its land, cast and attack, the last equal to `shown`);
      the hold and line per event; e2e at normal pace: the opponent's cast is seen on the stack before the end state.
    - Future impact: M3-07's director replaces the fixed holds with animations over the same frames.
  - **Slice 7 merged (PR #110, squash, 2026-11-23). M3-04c is done.** Next: the pacing slice (D-172), then the owner's
    feedback on the live site (and their check of the zone browser's spacing on the phone).
  - **Slice 7 done (2026-11-23, D-171): the "turn your phone" prompt, the hand's 44 px tap, carets on a changed P/T.**
    7b needed nothing new: e2e/play.spec.ts already plays a whole seeded game by touch taps at 812x375 on every PR,
    which is the milestone's acceptance. Next: merge, then ask the owner for feedback with the live link.
  - Slice 7 plan (2026-11-23, written before starting), two PRs, then the owner's feedback with the live link:
    - **7a:** the "turn your phone" prompt (ui.md "Layouts": a phone in portrait shows it over the paused match): an
      overlay when the viewport is portrait and narrower than 700 px (a phone, not the unfolded Duo or a tablet), the
      match behind it inert; turning back restores everything as it was. A pure `isPortraitPhone(w, h)`, unit-tested;
      e2e at 375x812 then 812x375. Plus the cheap leftover UX items: "Open your hand" at 44 px; a raised or lowered
      P/T marked by a shape too (a small caret), not colour alone.
    - **7b:** the acceptance test (milestone: "a full game is playable at the folded phone's size in landscape"): an
      e2e that plays a whole game by taps at 812x375 through to a result.
    - Left for after the owner's feedback: the single legal target pre-selected (ui.md), the visible collapse tab, a
      mark on a targeted card, mana symbols in canvas text, the picked blocker's badge, full control said in words, the
      HUD scaling up on a desktop, the settings cog over the far-right permanent, Fireball's X row wrapping.
    - Future impact: the portrait prompt is the place a portrait layout would later replace (ui.md lists landscape only).
  - **Slice 6b done (2026-11-23, D-170): arrows from the top of the stack to its targets, a tap to make the stack
    small and large again, a spell a counterspell targets outlined and picked in the prompt.**
    `board-model/target-arrows.ts`, test/stack-targets.test.ts, e2e/stack.spec.ts (the `stack` fixture now has Cancel).
    Review fixes (code and UX, in D-170): `BoardCard.shows` (the visible part of a covered card) for outlines, arrows
    and taps; arrows end beside a strip, at a block's edge, never under the open hand; the strip of a counterspell's
    target picks it; the small stack keeps the large one's corner; Space after a click presses Resolve.
  - Slice 6 plan (2026-11-23, written before starting): the whole stack [R: arena-research.md §5, "The stack"]:
    - `board-model/stack.ts` draws every object, top first: the top large at the right as now, the ones under it
      peeking out to its left in a cascade (drawn behind it), at most four, then a count. Small while the person
      chooses for it (as now), and small after a tap on it when it isn't theirs to act on (Arena's collapse tab: "the
      opponent's large card hides my creatures"), until a new object tops the stack.
    - An ability is a card-shaped panel [R: "the source's art, an 'Ability' type line, the ability text"]: its source's
      name and art, "Triggered ability" / "Activated ability", and the ability's own text. The engine keeps no text per
      ability, so `board-model/ability-text.ts` (pure) picks the ability's line from the source's Oracle text by its
      `AbilityRef`, with a test over the whole pool against the definitions (counts and kinds line up); a delayed
      trigger, a land's intrinsic mana ability and anything the test can't line up fall back to the whole text.
    - Targets marked on the board [R: "a glowing curve from the stack item to its target"]: an arrow from the top
      object to each of its targets (a card, or a player's info block), from `choices.targets`, computed in the board
      model (`stackArrows`), drawn by the renderer. The others' targets are in their card views.
    - The card view of a stack object: an ability shows its own panel (not only its source card), and every stack
      object gets hangers for its targets, X and "copy" (UX review of slice 2).
    - Tests first: stack model (order, cascade, count, small), ability-text over the pool, card-details hangers,
      arrows' ends; e2e with full control: Lightning Bolt then Giant Growth in response, both drawn, arrows to their
      targets, the collapse tap.
    - Future impact: Arena's "Order Triggers" browser and a very large stack's full view reuse the cascade; an
      emblem or a command-zone object would need a seat-view description first.
  - Slice 5 plan (2026-11-23, written before starting): graveyards, exile and revealed cards
    [R: arena-research.md "Library, graveyard, exile", "Zones: tapping a zone opens a browser of its known cards with
    a count"; "revealed cards are shown face up" [U]]:
    - **One pure module, `interaction/zones.ts`,** gives each player's counts (library, hand, graveyard, exile by owner)
      and the browser's tabs from the seat view, so the counts and the browser can't disagree. Graveyard top first
      (CR 404.2: anyone may look, the order is kept), exile newest first, face-up only (CR 406.3), a revealed hand
      (CR 701.20a, Telepathy) and a revealed library top (CR 401.5, Vampire Nocturnus) by identity only (D-062),
      keyed by position, never mapped back to object ids.
    - **The browser** (`hud/ZoneBrowser.tsx`): a modal sheet with a tab per zone ("Graveyard 4", "Exile 1", and
      "Hand 5" / "Library top" while revealed), a horizontally scrolling row of card images (text until loaded), a tap
      on a card opens the card view over it, closing that returns to the browser. Opened by a tap on a player's info
      block, or by a long-press, right-click or "i" on it, which work even while the player is a target (then the tap
      picks them). Escape closes the card view first, then the browser. Focus moves in and back, no key reaches the
      board. Held as `{player, zone}` and re-read from the seat view each draw (D-161), so it follows the game; it
      falls back to the graveyard tab when a reveal ends. A decision arriving keeps it open (it's for reading).
    - **At a glance, without a tap:** a revealed library top shows as a small face-up tile by its player's info block
      (the outer column, where Arena's library pile is); a revealed hand shows an eye chip by the block ("Hand
      revealed", for either player; a tap on the opponent's opens the browser at their hand).
    - Graveyard choices (Raise Dead's target, Gravedigger's) stay in the prompt this slice; the browser opens over it.
      Arena picks them in a browser [R]: later, recorded in future-rules.
    - The card view takes a printed card by oracle id too, for revealed cards (`printedDetails`).
    - Tests first: `test/zones.test.ts` (orders, exile by owner, reveals, counts; face-down exile can't be built yet); e2e on a `zones`
      fixture (30-card graveyard, exile, Telepathy, Nocturnus): open, tabs, scroll, card view and back, Escape order,
      keys blocked, target-time long-press.
    - Future impact: the stack slice and graveyard picks reuse the browser's card row; face-down exile (later: CR
      406.3a) shows a back by its owner's choice, which the seat view will have to describe first (it has only cards and abilities today).
  - Slice 4b plan (2026-11-23, written before starting): Auras and Equipment beside their host [R: the owner's
    screenshot, "an Aura sits as its own card just left of the creature it enchants, joined by a small link mark"].
    - The board model leaves an attached permanent (CR 301.5, 303.4) out of its own row when its host is a creature
      or a land, and reserves room left of the host in the host's row (creature row: the pile's width; land row: the
      slot's width), the host shifted right by it. Whose side: the host's (a Pacifism on the opponent's creature sits
      by that creature), as Arena does.
    - After combat has moved the cards (`withCombat`), each attachment is placed just left of its host's final spot,
      behind it, peeking out by part of its width (its name's start and art showing), so it follows an attacker or a
      blocker. The host carries a small link mark on its left edge.
    - Hosts in the others row (an Aura on an enchantment or a planeswalker: none in the pool) keep today's placement.
    - Tests: the attachment beside its host, on the host's side, moving with an attacking host, no overlap with the
      next card in the row; e2e: a fixture with Holy Strength on a creature and an Aura on a land.
    - Future impact: multiple attachments stack leftwards; the stack slice will want the same "beside" idea for a
      target arrow's anchor, unaffected.
  - M3-04c slice 4 (was 3; renumbered after the restyle took 3) (2026-11-23, written before starting): badges, then
    attachments, two PRs. The slices after it are now 5 zones, 6 the stack, 7 finishing. The badges are re-sited for
    the frameless tile (the name now runs along the bottom left): keyword icons as small round icons at the top left,
    as the reference app's hexproof icon; counters as a small icon and count beside the P/T pill. Original plan:
    - **3a, badges on a permanent** (arena-research.md §"How permanents are drawn", owner screenshots):
      - Keyword icons in a small dark square at the bottom-left [R]: our own drawn shapes (D-140), one per keyword
        that has one (a wing for flying, a heart for lifelink, a skull for deathtouch, ...). Up to two icons; with
        more keywords, or one without an icon, an ellipsis shows and the card view lists them all [R].
      - Counters: a small round numbered badge at the top right [R] ("+2" for +1/+1 counters, "−1" for −1/−1, the
        count for others), moved left of a combat badge when there is one.
      - Loyalty: a planeswalker shows its loyalty in a shield-shaped box at the bottom centre where a creature's P/T
        goes; a planeswalker that's also a creature shows it in the counter spot [R].
      - Summoning sickness: an overlay [R], ours a faint "Zz" over the art, on a creature that can't attack or tap yet.
      - The board model says what to show (`badges` on BoardCard, pure, tested); the renderer only draws it.
    - **3b, Auras and Equipment beside their host:** an attached permanent leaves the outer row and sits just left of
      the permanent it's attached to, a little smaller, joined by a small link mark [R, owner screenshot]; the creature
      row makes room for it. The P/T hanger in the card view names the sources of a change where the view carries
      them (UX review).
  - M3-04c plan for the rest (2026-11-23, written before starting), each slice its own squash-merged PR, live on Pages
    as it merges; the owner gives feedback at the end:
    2. **The card view:** long-press (touch) or right-click/hover-hold (mouse) shows a card large, with its full
       image, its text, its counters and what's attached, keyword reminders, and the artist's credit (D-155).
    3. **What's on a permanent:** keyword badges at the bottom-left, counters and loyalty, damage marked, summoning
       sickness, Auras and Equipment beside their permanent with a link mark.
    4. **Zones:** graveyard and exile piles by each player with a count, tapped to browse; revealed hands and library
       tops (Telepathy, Vampire Nocturnus).
    5. **The stack:** every object at the side, top first, with its targets marked on the board; a tap on the
       opponent's large card shrinks it.
    6. **Finishing:** the "turn your phone" prompt in portrait, the remaining UX-review items listed above, and the
       acceptance test (a full game at the folded phone's size). Then ask the owner for their feedback.
  - M3-04c first slice plan (2026-11-23): "All Attack" and drag to play, one PR.
    - All Attack: during the declaration, a button left of the main one [R] (Arena's "All Attack"). It picks every
      creature that can attack the opponent, one pick at a time as the engine offers them (each pick is its own
      action; the engine re-checks after each), skipping planeswalkers as targets. Then the declaration stays open to
      adjust, and the main button finishes it. `interaction/all-attack.ts` says when it's offered (two or more
      creatures could attack, all at the same player); App sends the picks in turn (D-158).
    - Drag to play: press a hand card and move it up past a threshold; the card lifts as it starts, "Release to cast"
      shows, and letting go above the line plays or casts it as the second tap would (the same action, from
      `controls`). Let go below the line, or press Escape, and it's put down. Pointer events, so mouse and touch
      alike. The card following the finger is M3-07's animation.
    - Tests: unit tests for when All Attack is offered; e2e for All Attack (every creature attacking, then finish)
      and for dragging a land and a spell onto the table, on both projects.
    - Built (2026-11-23): All Attack beside the main button, offered while two or more creatures could attack;
      the app sends one pick per reply and stops when none is left. Drag to play from the open or collapsed hand
      (12 px to start, 60 px to play; "Drag up to cast" / "Release to cast" on the lifted card), followed with window
      listeners because lifting the card redraws the hand and removes the element pressed; the click a release fires
      is swallowed. The browser tests drag with a mouse on both projects; a real finger is for the phone check.
    - After the reviews: the app shapes the declaration toward a goal (All Attack, Clear Attacks, a tap on an
      attacker to take it out), by the engine's take-back and picks; fixed slots for the batch button and Undo; the
      drag arms only above the open hand, says when a card can't be played, puts the hand back as it was on cancel,
      and holds the pointer on the board's layer once lifted (for iOS Safari). Left: the collapsed hand's strips
      under the small buttons on the phone (they cover a card's edge), and a check on a real iPhone.
  - **M3-04a done, merged (PR #96, 2026-11-23).** CI green, a 300-game fuzz clean. The owner can try it locally:
    `pnpm dev`, `?fixture=mid-game|crowded|attack|block|tokens`.
  - M3-04b plan (2026-11-23, written before starting): pulls M3-06's touch work forward. Slices, each its own PR:
    1. **Acting on the board.** `interaction/` (pure, tested): for each object, what a tap does now, from the seat view's
       options and the UI selection: lift a hand card, play or cast it (a second tap, or a drag up), activate an
       ability, pick a target (cards and portraits), declare an attacker, pick a blocker then its attacker, take back
       the last pick. The HUD lays a transparent button over each interactive card (`aria-label` = name and what it
       does): one path for touch, mouse and keyboard (Tab, Enter/Space, a focus ring), and the e2e selectors. Several
       choices for one card (two abilities, attack a player or a planeswalker): a small menu by the card. The selected
       hand card rises large at the centre [R]. "All Attack" and "No Blocks" beside the main button; Space presses the
       main button, Escape cancels.
    2. **Prompts.** A prompt for every decision the board can't answer (mulligan with the hand shown large, X, target
       count, dividing damage, damage assignment, trigger order, choosing cards, yes/no, replacement order, naming a
       card, the starting player, cancel or pay during a cast), Arena-like, at the top centre with a title saying what's
       awaited; the actions drawer goes.
    3. **Smart stops.** Corrected after reading D-143 again: the host keeps stopping wherever the person could act
       (a stops list would cost combat tricks their window), plus Arena's documented skips: no stop in your own
       upkeep, draw step or end step (D-157); a full-control switch.
    Accept: a full game playable at 812×375 by touch alone, and by keyboard alone, as Playwright tests.
  - M3-04b slice 1 progress (2026-11-23): built `interaction/controls.ts` (every option to a control; a property test
    over 24 seeded games checks no option is orphaned and every control is legal), tap regions from the board model
    (piles, hand strips, the lifted card), transparent buttons over the canvas (touch, mouse, keyboard, labels), the
    lifted hand card, the stack's top at the right, valid targets glowing, portraits as targets, two-tap blocking, a
    menu for several choices, Undo and Cancel by the main button, a prompt naming what's awaited with any leftover
    choices, a settings cog with Concede, Escape and Space; the actions drawer is gone. The hand opens itself for a
    discard or a mulligan's bottom card; the main button says when a declaration can't finish yet. e2e: casting with a
    target, attacking (with a must-attack creature), blocking, a whole game by the controls alone, the keyboard.
    After the UX and code reviews: a press of the main button or Undo/Cancel within 300 ms of an update is ignored (a
    double-tap on Next can't pass twice; card taps are never held back); the spell on the stack goes small at the right
    while its caster chooses targets; a picked blocker lights the attackers it can block; the prompt sits in the open
    table; mana symbols in menus, the mana pool by the portrait; the button names the creature that must attack; "Tap
    again to cast" on a lifted card; a white focus ring; Tab in screen order. "All Attack" is left for later: it isn't
    an engine option (each attacker is its own pick), so it would be a UI macro of several picks; to raise with the
    owner, with drag to play, at review time.
  - **M3-04b slices 1 and 3 merged (PR #97, 2026-11-23).** CI green, a 300-game fuzz clean.
  - **M3-04b slice 2 merged (PR #98, squash, 2026-11-23). M3-04b is done.** The branch's own history still holds five
    debug screenshots that a squash kept out of `main`: squash-merge the next PR from this branch too (a force-push to
    restart the branch was refused). Acceptance: Playwright plays a whole seeded game by touch taps alone (the phone
    project), by mouse clicks alone, and by the keyboard alone (each control focused and pressed with Enter; true
    Tab-by-Tab traversal is the shorter keyboard test). Not yet done: a UX review of slice 3's full-control switch, a
    run on a real phone, and D-157's approval (Open questions). Next: M3-04c (everything M2's pool puts on the board),
    with the lists above.
  - M3-04b slice 2 plan (2026-11-23, written before starting): every prompt says what it's for, with the decision's
    own context, and the long ones are easy to use. Web only, no engine change.
    - `interaction/prompt-text.ts` (pure): the prompt's title and each choice's label from the decision.
      - Mulligan: "Keep 7" / "Mulligan" [R].
      - X: "Choose X for Fireball".
      - Dividing: "How much of 3 to Elite Vanguard?" (no "damage": CR 601.2d divides counters too).
      - Combat damage: the source, the amount and who gets it, with lethal marked.
      - Paying: "Pay for" the spell (the payment screen with its cost is later).
      - Choosing cards: the cards' names.
      - Trigger order: each trigger by its source ("goes on the stack first, resolves last").
      - Yes/no: the spell or ability resolving.
      - Replacement order, the legend rule, a new target: named the same way.
    - Prompt UI: numbers as a compact row of chips, and a filter box for a long list such as naming a card (every
      name in the database). Long lists scroll.
    - Tests: a unit test per decision kind for the title and labels, and e2e for naming a card with the filter and
      for choosing X.
  - M3-04b slice 2 progress (2026-11-23): `interaction/prompt-text.ts` gives every decision a title in its own words,
    and gives the prompt's choices labels with context: "Keep 7", "Choose X for Fireball", "How much of 3 to Elite
    Vanguard?", "Stampeding Rhino deals 4 damage: how much to Elite Vanguard?" with "3 (lethal)", triggers by source,
    searched cards by name (even by identity only, D-062), "Keep Llanowar Elves", "Shuffle your library?".
    Choices that read the same are numbered ("Forest", "Forest 2"). X and damage shares are a compact row of
    numbers; naming a card has a filter box (Enter takes the first match; 8 shown, the rest by typing). The prompt's
    title sits on its anchor with the choices below; it goes high while the hand is open (a mulligan, a discard) or
    for naming a card. A `prompts` fixture (Fireball, Ignite Disorder, Pithing Needle) and an e2e for all three; unit
    tests for every decision kind's title and the labels that need context.
    After the code review: the filter ranks the exact name first, then prefixes, then the rest (so "Shatter" doesn't
    name Mind Shatter), Enter does nothing on an empty box, the box empties for each new decision, and it's focused
    only with a mouse (on touch it would raise the on-screen keyboard over a folded phone). Replacement order names
    each effect by its source ("X's regeneration", "X's protection"; a resolved spell's prevention is "A prevention
    effect", as the view doesn't carry its source: a known gap). A trigger or ability whose source has left is named by
    its card. Choosing a basic land type is five buttons, not a filter. The prompt goes in the gap between the rows
    only if a row of choices fits there too. Debug screenshots committed by mistake are removed, and PNGs at the root
    and in `apps/web/src` are now ignored.
    After the UX review: a prompt with choices is one dark panel (title and choices), in the gap between the rows if
    it fits there with all its rows, else over the middle of the table, as Arena's choice dialogs are; an open hand no
    longer lifts a numbers prompt onto the targets; the filter's text is 16 px (iOS zooms into smaller).
    Left for M3-04c from that review:
    - A share with one possible value (dividing 3 among 3) still asks, because Cancel is also legal: answer it
      without asking.
    - Screen-reader names for the number buttons ("X = 3"), and a live match count in the filter.
    - Dividing: say where the rest goes, and ring the target being asked about.
    - A stepper (− 7 + Max) for X beyond about 10 values.
    - A pressed look for prompt buttons, and a dimmed look while busy.
    - "Choose target 2 of 3".
    - In the filter: word-start matches ranked first, and the cards in sight suggested before A–Z.
    - Titles allowed to wrap to two lines.
    - Escape closes the open hand before it cancels a cast.
    - The phone's on-screen keyboard while naming a card, and focus on the first number when a numbers prompt opens.
  - M3-04b slice 3 (2026-11-23, in the same PR as slice 1, as both are on one branch): smart stops (D-157). Auto-pass
    keeps D-143's rule and adds Arena's skips: your own upkeep, draw step and end step with an empty stack, unless
    mana is left in your pool. Full control is a switch in the settings menu (the main button turns blue-violet). The
    next-stop labels are right with no attackers (CR 508.8). The 500-game eval is within noise. The code review's
    fixes are in: the pool check in all three steps, the switch behind the same guard as the main button, tests for
    an opponent's object stopping you in your own upkeep, and `withSettings` in `@mtg/match`. Left: auto-tap stays on
    in full control until slice 2's payment prompt; Arena's other smart stops; the wider skips (Open questions).
  - **M3-04b, touch, mouse and keyboard.** Playable cards glow (from the seat view's options and `mightPay`); tap a hand card to lift it,
    tap again or drag up to play or cast; valid targets glow and a tap picks one; attacking and blocking by tapping
    creatures, with "All attack" and "No blocks"; the main button says what it will do ("Pass", "Resolve Shock", "Next:
    combat"); prompts (React) for the rest: mulligan, X, choosing cards, yes/no, dividing damage, the order of
    triggers, damage assignment, naming a card; the options drawer goes.
  - Added to M3-04c from the final UX review (2026-11-23): keyword badges at a permanent's bottom-left corner
    (flying, reach, deathtouch, first strike...: ui.md "The cards", both screenshot sets); keep the main button's slot
    as a label naming any decision it can't answer ("Assign Damage", "Pay {R}"). From the second UX review of
    slice 1: a tap on the opponent's large stack card should shrink it to the side (Arena lets you minimise it)
    rather than swallow the tap, as it can cover a creature whose ability you'd use in response; the blocker being
    picked needs a stronger mark than blockers already assigned (both gold now); the stack's count badge can sit on a
    creature's name strip; a performance-trace test (ui.md asks for one). The open hand showing less (about 60%) and the collapsed hand more.
  - **M3-04c, everything M2's pool puts on the board.** The stack at the side with its targets, counters and loyalty,
    attached Auras and Equipment beside their permanent with a link mark (the owner's screenshots), tokens, damage, summoning sickness, graveyard and
    exile browsers, revealed hands and library tops, long-press for the card's details, the "turn your phone"
    prompt in portrait. *Accept (M3-04):* a full game playable at the folded phone's size in landscape, as a
    Playwright test.
  - Future impact: M3-05 adds the full layout beside the compact one (the board model takes the layout as data);
    M3-07 animates between board models; M3-08 puts art in the frames.
- M2 Rules depth (`docs/milestones/m2-rules-depth.md`), started 2026-11-19. M1 is closed: the owner skipped the CLI
  spot checks and asked to start M2; tagging `m1` on `main` is left to the owner.
- M2-01 Hidden information fix: done, merged (PR #21, D-054).
- M2-02 The Magic 2010 pool and its mechanics: done and accepted (the owner read it: "Looks good so far",
  2026-11-20). `docs/milestones/m2-pool.md` maps all 234 cards (none left out) to the systems they need and the task
  after which each is playable; the M2 tasks are reordered by it (D-055). The table is kept by hand from now on: when a
  task scripts a card, check its row.
- M2-03 The event pipeline: done, merged (PR #23, D-056). Every game event goes through `happen`; replacement
  effects (M2-08) and triggers (M2-07) plug in there. Reworked once after the rules-judge and code-reviewer reviews.
- M2-04 Targeting and costs: done (both halves merged), split in two (restrictions taken from the Oracle text of all
  47 pool cards marked T or C).
  - M2-04a Targeting: done, merged (PR #24, D-057). Righteousness, Ignite Disorder, Lava Axe, Elite Vanguard, Coral
    Merfolk, Plains, Island; interim decks white-red and blue-green.
  - M2-04b Costs: done, merged (PR #25, D-058). Fireball, Vampire Aristocrat, Swamp; interim deck black-red.
  - Dropped from M2-04: paying mana outside casting. No Magic 2010 card pays mana while a spell resolves (checked).
  - Future impact: Aura targets (M2-12) use `permanent` targets with the same filters; triggered abilities (M2-07)
    choose targets with the same decisions as they're put on the stack (CR 603.3d); protection and shroud (M2-06)
    and hexproof plug into `legalTargets` as one more check; planeswalkers extend `anyTarget` and
    `playerOrPlaneswalker`.
- M2-05 Effects and keyword actions: split in three by the 50 cards' Oracle text (the spec lists the cards).
  - M2-05a Removal, counters and {T} abilities: done, merged (PR #26, D-059). The 19 cards plus Ornithopter and Rod of
    Ruin scripted; 31 scenarios in `test/scenarios/cards/m2-05a/`; unit tests in `test/effects/removal.test.ts`; the
    interim decks carry the new cards, with five new golden games. Code-reviewed and rules-reviewed; fixes in. The plan
    as built:
    - New effect ops, each skipping an object no longer where the effect expects it (CR 101.3, 400.7), never
      throwing: `destroy` (CR 701.8a), `destroyAll` (every permanent fitting an `ObjectFilter`, decided once as the
      effect applies, one simultaneous event, CR 608.2f, 608.2h; graveyard order later: CR 404.3), `exile`
      (CR 701.13a, 406.2), `returnToHand` and `putOnTopOfLibrary` (the owner's zone, CR 400.3, 404.1), `tap`
      (CR 701.26a: a tapped one does nothing), `counter` (CR 701.6a; its pipeline event is `counterObject`, which won't
      collide with CR 122 counters), `gainLife` (CR 119.3).
    - Subjects: `"you"` joins `"self"` and targets for player effects, the spell's or ability's controller
      (CR 109.5, 115.10b); "you gain 4 life" is `gainLife` to `"you"`.
    - Pipeline events: `counterObject` (any stack object: a spell goes to its owner's graveyard as part of the event,
      an ability ceases to exist; emits a countered event, not SPELL_DID_NOT_RESOLVE; no refund, CR 701.6b) and
      `gainLife` (player, amount; 0 is dropped before replacement, CR 119.9; lifelink is a result of damage, not a
      gainLife proposal, CR 120.3f). Exile, hand and library moves are `moveCard`. future-rules: the M2-08 "zone change
      this event makes" helper must list `counterObject`.
    - {T} in the cost of an ability that uses the stack (Royal Assassin, Blinding Mage, Undead Slayer, Rod of Ruin):
      untapped (CR 107.5); controlled since the turn began only for creatures (CR 602.5a; Rod of Ruin can activate at
      once); tapped at the final payment (CR 601.2h, after targets, so Royal Assassin can't target itself: its ruling),
      before any sacrifice (for "{T}, Sacrifice this" later), rechecked. If the source was tapped for mana meanwhile,
      the cost can't be paid (CR 107.5, 601.2h) and only cancel remains: `autoPay` and the `payMana` legal actions must
      leave out the activating source's own mana ability, or the fuzzer's "every listed action is accepted" breaks.
    - Citations: exile CR 701.13a; "target spell" can't be an ability CR 113.9, 112.1; Undead Slayer's target is a
      permanent (CR 109.2), subtypes only; "can't be countered" later (CR 101.2).
    - Cards: the 19 in the spec, plus Ornithopter and Rod of Ruin (artifacts to target). Enchantments weren't in the pool
      until M2-07b, which adds scenarios for the enchantment half of Naturalize, Solemn Offering and Tempest of Light.
    - Tests (from the rulings): Royal Assassin can't target itself, its ability resolving without its source (and Rod
      of Ruin's after Shatter); Solemn Offering whose target is gone gains no life; Ornithopter as an artifact creature
      spell for Essence Scatter but not Negate or Flashfreeze; a countered creature spell to the graveyard, no refund;
      Cancel can't target an ability or itself, and a Cancel whose target was countered first doesn't resolve; Divine
      Verdict in the end of combat step, not in main 2; Celestial Purge not on a land; Undead Slayer exiling a Vampire,
      not a Bear, not a card in a graveyard; Blinding Mage tapping a would-be blocker, a declared blocker staying in
      combat (CR 506.4b), itself, sick; Assassinate untapped refused; Planar Cleansing both sides, lands stay; Tempest
      of Light with nothing; Excommunicate to the owner's library; a counter war; Doom Blade on a colorless creature.
      (Excommunicate is a sorcery, so it can't meet an attacker; Divine Verdict on a blocker is left to M2-06's combat
      keywords.)
      Unit tests: controller isn't owner (CR 400.3), Royal Assassin's target untapped first, the {T} source tapped for
      mana, gainLife 0, destroy and tap on an object gone mid-resolution.
  - M2-05b Cards moving, split in two by the advisor's review (2026-11-20):
    - M2-05b1, no choices at resolution: done, merged (PR #27, D-060). Divination, Mind Spring, Sign in Blood, Mind
      Shatter, Burning Inquiry, Tome Scour, Traumatize, Disentomb, Nature's Spiral. A `player` target kind, an
      `"eachPlayer"` subject, a `loseLife` pipeline event (CR 119.3); ops draw N (N single draws, CR 121.2, each
      player's in APNAP order, CR 121.2c; `apnapOrder` in `game/turn-order.ts`), lose life, discard at random (seeded
      picks, then one simultaneous discard, Burning Inquiry's ruling; a smaller hand whole, CR 609.3), mill (CR 701.17a,
      as many as possible, 701.17b; half rounded down, CR 107.1a; graveyard order later: CR 404.3). 17 scenarios in
      `test/scenarios/cards/m2-05b/`, unit tests in `test/effects/player-effects.test.ts`; the interim decks carry the
      nine cards, five new golden games. Code-reviewed and rules-reviewed, fixes in. The 0-life drop was removed (Open
      questions). A 300-game fuzz found a false alarm in the leak check (a card drawn and discarded in one action
      looked hidden from its own drawer); the check now counts it as seen, with a test. The draw-several container
      (CR 121.2a) moves to M2-08.
    - M2-05b2, choices at resolution (now), split in two. Plan (2026-11-20), rules-reviewed and revised (D-062):
      - Shared (built in b2a): an effect that needs choices stops with a `chooseCards` decision that keeps the effect
        to resume; after the last answer it's queued once, with the cards chosen, in front of the rest of the
        resolution; nothing happens until every answer is in (CR 608.2d), and answers emit no events.
        One option per answer, plus `finishChoosing` once the minimum is reached; reaching the maximum finishes. The
        chooser isn't always the controller (Mind Rot: the target player, CR 701.9b). Only its own answers are legal:
        no mana abilities, no spells (CR 608.2g; Merfolk Looter's ruling). Counts are clamped (CR 609.3).
      - Hidden information (D-062): options are stored in a fixed order (oracle id, then internal id) and answered by
        position. `playerView` shows the decision's player each option's object id only if they can see that card
        anyway (their own hand); any other option shows only what the card is. Other players see only that a choice
        is being made. A choice over a hidden zone is always asked when the zone isn't empty, with min 0 where the CR
        allows finding nothing (CR 701.23b; Elvish Piper's ruling): skipping it would tell the opponent the zone has
        no such card. A `CARDS_REVEALED` event carries identities only, in the same order. `scrambleHidden` permutes
        hidden ids instead of shifting them, and keeps the identity of cards a viewer is entitled to see; two-worlds
        unit tests come first (Fabricate with and without an artifact, Piper declining against no creature, Tutor
        finding A against B, Echoes leaving copies against none, Duress on a hand built in two orders).
      - M2-05b2a, choices from a hand: done, merged (PR #29). 17 scenarios in `test/scenarios/cards/m2-05b2/`;
        two-worlds, ordering and answer tests in `test/effects/choose-cards.test.ts` (checked to fail when the view
        shows ids, the choice is skipped, or a whole hand is discarded in hand order); `scrambleHidden` permutes hidden
        ids; the interim decks carry the four cards, four new golden games. The reviews found a leak this task brought
        in (a whole-hand discard in hand order), fixed. M2-05b2b is next; first settle and review two design points:
        a search shows the searcher the whole zone, privately, by identity (CR 701.23a), which also keeps Duress's
        revealed hand in the view mid-choice; and where "found" / "exiled this way" live between effects (D-063 is one
        condition on it). Two-worlds tests first (Fabricate with and without an artifact, Tutor finding A or B, Echoes
        leaving copies or none, from the target's view).
        Mind Rot (`discard`: the player discards N of their choice, CR 701.9a-b; a
        smaller hand whole, CR 609.3), Merfolk Looter (draw, then discard, nothing between: CR 608.2g and its ruling;
        CR 704.5b with an empty library), Duress (`target opponent`: a player target with an opponent restriction,
        relative to the controller, checked on choosing and resolving, CR 115.1a, 115.2, 102.2, later: CR 102.3;
        `revealHand` as its own effect, CR 701.20a-b; then `discard` chosen by "you" from the cards fitting
        "noncreature, nonland", mandatory if any fits, nothing if none, CR 608.2d, 609.3), Elvish Piper
        (`putOntoBattlefield` from hand, min 0; under the activator's control, CR 110.2a, 109.5; not cast; summoning
        sick, CR 302.6; resolves with its source gone, CR 113.7a).
      - M2-05b2b, libraries: done, merged (PR #30, D-064); M2-05b is done. 22 scenarios (39 in
        `test/scenarios/cards/m2-05b2/`), unit tests in `test/effects/library-effects.test.ts`; reviewed by the
        rules-judge and code-reviewer, fixes in (a concession mid-search left the "this way" record behind; names read
        through `characteristics()`; an invariant on what a decision shows). M2-05c is next. The two-worlds tests came
        first (each checked to fail when a search skips a library with no match or an "any number" search ends at its
        maximum); the interim decks carry
        the six cards, five new golden games; the fuzzer reaches searches and Ponder's look. Design (settled
        2026-11-20 with the advisor; the rules-judge reviewed the cards): an
        `ObjectFilter` supertype (basic, CR 205.4a, read through `supertypesOf`) and a negated filter, since "other
        than basic land cards" means not (basic and land) (Haunting Echoes still exiles Terramorphic Expanse). A
        `GameState.resolution` record `{ object, found, exiled }` for "this way" (CR 608.2c), set as an object starts
        to resolve and cleared on every exit (`finishResolving`, its early return, `doesNotResolve`), with an
        invariant the fuzzer checks; effects name the found cards with a `"found"` subject. Ops: `search` (only
        chooses, into `found`; look at the whole zone, CR 701.23a; a stated quality may find none, CR 701.23b; "a
        card" must be found if there's one, CR 701.23d), `reveal` of a subject (CR 701.23e), `put` into hand or onto
        the battlefield (tapped: part of the move, CR 110.5b, 603.2e; not a land play, CR 305.4), `shuffle`,
        `mayShuffle` (a `chooseYesNo` decision: yes queues the shuffle, no queues nothing), `lookAtTop` and put back
        in any order (Ponder: a `chooseCards` of the top cards, top first, asked even for one card, CR 701.20e,
        401.4, later: CR 701.20d; reordering is a pipeline event), `exileGraveyard` (records `exiled`; now `exileAll`). A
        `chooseCards` decision gains `seen`, the whole zone by identity, shown only to the chooser (a searched
        library; Duress's revealed hand, kept in view mid-choice). An "any number" choice (Haunting Echoes) ends only
        on `finishChoosing`, never at its hidden maximum, or the number of answers would tell how many copies are
        left. Haunting Echoes with nothing exiled doesn't search (D-063; the graveyard is public, so skipping tells
        nothing); otherwise it asks even when no copy is left. "Sacrifice this land" is a `sacrificeSelf` cost part,
        after {T} (CR 602.2, D-059); not a mana ability (CR 605.1a). Two-worlds tests first: Fabricate with and
        without an artifact; Tutor finding A or B; Echoes leaving copies or none, from the target's view.
      - Future impact: "whenever a player discards / searches / shuffles" (M2-07) read these events; a replacement on
        a discard or move (M2-08) sees one event per instruction, the choices made; Telepathy and multiplayer reveals
        need revealed cards in the view, not only an event (CR 701.20a); several searchers at once (CR 701.23i), "may
        search" (CR 701.23g) and searching another player's library (Sphinx Ambassador) fit the same steps.

  - M2-05c Life, damage to many, mana: done.
    Plan (2026-11-20), rules-reviewed and revised; split in two:
    - M2-05c1, no new decisions: done, merged (PR #31, D-067). 21 scenarios in `test/scenarios/cards/m2-05c/`, unit tests
      in `test/effects/damage-to-many.test.ts`; the interim decks carry the ten cards, five new golden games. Angel's
      Mercy, Bountiful Harvest, Acolyte of Xathrid, Seismic Strike, Tendrils of
      Corruption, Consume Spirit, Pyroclasm, Windstorm, Earthquake, Goblin Artillery.
      - An `Amount` counted from the battlefield, `{ count: ObjectFilter }`, worked out as the effect applies
        (CR 608.2h); "Mountains" and "Swamps" are land types read through characteristics (CR 205.3i). Tendrils' "where
        X is the number of Swamps you control" is that count, with no X announced (CR 107.3c); it's counted once per
        effect, which can only differ once replacements move things mid-resolution (later: CR 107.3i, 608.2h, M2-08).
      - A subject `{ each: ObjectFilter }`: every permanent fitting it as the effect applies (Earthquake's ruling,
        CR 608.2h). Filters gain `keywords` / `notKeywords`, read through `keywordsOf` (CR 702.9a).
      - `dealDamage` gains `and: [{ to, amount }]`: one source, different damage to different recipients, as one damage
        event (CR 608.2f, 120.4), backed by a unit test that both of Goblin Artillery's damages come before either life
        loss. 0 damage isn't dealt
        (CR 120.8); gaining 0 life isn't an event (CR 119.9).
      - Consume Spirit's "Spend only black mana on X": X stays generic in the printed cost (CR 107.4b; color and mana
        value unchanged, CR 202.2, 202.3e); only the cost to pay (`totalCost`) makes each X a {B}, a payment
        restriction (CR 601.2h). Equivalent today; reductions (CR 118.7a) and other restrictions (Soul Burn) need
        restricted mana later (future-rules).
    - M2-05c2, choices: done, merged (PR #32, D-068). 12 scenarios (`yawning-fissure*`, `birds-of-paradise*` in
      `test/scenarios/cards/m2-05c/`), unit tests in `test/mana/any-color.test.ts`; the interim decks carry both, two
      golden games. With it, M2-05 is done: 71 of the 234 Magic 2010 cards (the pool's 79 include 8 M1-only cards: Shock, Volcanic
      Hammer, Grizzly Bears, Gray Ogre, Hill Giant, Fire Elemental, Spined Wurm, Furnace Whelp). Yawning Fissure (`sacrifice` op, each opponent choosing a land they control, filter relative to
      the chooser; CR 701.21a, 608.2d; with two players one chooser, so APNAP choosing then one simultaneous
      sacrifice stays `later: CR 101.4, 608.2e`; a forced choice isn't asked, the battlefield being public). Birds of
      Paradise: the color travels on the `ACTIVATE_ABILITY` action (a design choice: the CR has it chosen as the
      ability resolves, CR 608.2d, which for a mana ability is right after activation, CR 605.3b), checked as it
      resolves, W/U/B/R/G only (CR 106.1a), in both paths (priority and while paying), refused when missing or sent to a
      fixed-color ability; `legalActions` lists one activation per color; `autoPay` sees it and tries any-color sources
      last.
    - Tests from the review: counts on resolution (Seismic Strike, Tendrils after a fetched land), zero counts and X=0,
      flying checked on resolution, Windstorm sparing reach and players, both players dying (a draw), Pyroclasm on
      damaged creatures, Artillery with its target gone, source gone, on its controller, summoning sick, Acolyte,
      Consume Spirit's black-only X and target gone, Fissure's choices, Birds' colors.
- Next, before M2-06 (plan from the advisor, 2026-11-20):
  1. Done, merged (PR #33): the 22 Magic 2010 cards the pool table marks playable since M1 but that were never scripted (Siege
     Mastodon, Silvercoat Lion, Stormfront Pegasus, Air Elemental, Disorient, Horned Turtle, Snapping Drake, Wind
     Drake, Zephyr Sprite, Kelinore Bat, Looming Shade, Warpath Ghoul, Zombie Goliath, Canyon Minotaur, Fiery
     Hellhound, Goblin Piker, Lightning Elemental, Prodigal Pyromancer, Shivan Dragon, Enormous Baloth, Might of Oaks,
     Runeclaw Bear), its own `add-cards` PR, so 93 are playable as the spec says. 9 scenarios in
     `test/scenarios/cards/m10-core/`, seven golden games from two throwaway deck lists (replaced by the fresh golden set
     in step 2). The pool's comment header, scrambled by sorting the file in earlier tasks, is restored.
  2. Done, merged (PR #34): the golden set rebuilt and Magic 2010's first deck pair (D-069). A `by-kind` agent (the fuzzer's
     picker); `pnpm golden:cover` (`packages/cli/src/golden-cover.ts`) plays the fuzzer's decks for seeds 1 to 800 and
     adds, greedily, the games using the most unused cards per action, each cut off at the turn its last new card is
     used; a card counts as used when played as a land or a spell or ability of it resolves, and three choices the
     export tests read are covered too. The interim decks and their 36 golden games are gone; M1's four (the bench)
     stay; 20 new games, the folder 3.2 MB (was 15 MB; budget 4 MB). `red-green-beats` and `blue-black-control`, first
     versions of two of m2-pool.md's decks, are the fuzzer's main pair (two prebuilt games in three). The fuzzer's 40-seed
     measure lost no decision kind or event type (Ignite Disorder is in red-green-beats for `divide`). Export tests
     repointed to `blue-black-control-vs-red-green-beats-644`, `pool-463`, `pool-707`.
  3. M2-06, keywords and attack or block restrictions (m2-rules-depth.md): done; four keywords come with their first
     cards (D-074); 21 cards; 114 of the 234 Magic 2010 cards now (the pool's 122 include 8 M1-only cards). Next: M2-07 triggered abilities,
     (the golden budget is 8 MB, D-073). Plan (2026-11-20), in
     four PRs, each with its cards, scenarios and interaction matrix rows:
     - M2-06a combat damage, done, merged (PR #35, D-070): first and double strike with a second combat damage step,
       trample (lethal damage first; forced answers filled in, not asked), deathtouch (CR 704.5h record), lifelink (a
       result of the damage event), vigilance. Viashino Spearhunter, Razorfoot Griffin, Stampeding Rhino, Deadly
       Recluse, Child of Night, Serra Angel, Griffin Sentinel. Scenarios in `test/scenarios/cards/m2-06a/` and
       `test/scenarios/interactions/`, unit tests on test creatures in `test/combat/strikes-and-trample.test.ts`
       (double strike has no Magic 2010 card), six new matrix rows; five of the cards in the M10 pair.
       For 06b: trample's lethal damage must count damage other attackers assign to a blocker that blocks several
       (Palace Guard; future-rules, "More combat").
     - M2-06b, done, merged (PR #36, D-071): defender, swampwalk and forestwalk, "can't be blocked (except by ...)", "can block
       any number" (Palace Guard dividing its damage, trample's lethal counting other attackers' damage), "can't block
       this turn". Wall of Faith, Wall of Fire, Bog Wraith, Emerald Oryx, Phantom Warrior, Dread Warlock, Palace Guard,
       Panic Attack. Scenarios in `test/scenarios/cards/m2-06b/` and `interactions/block-any-number/`, five new matrix
       rows; three of the cards in the M10 pair.
     - M2-06c, done, merged (PR #37, D-072): "can't attack or block alone", "attacks each combat if able", "attacks you this
       turn if able", "all creatures able to block it do so"; `finishDeclaring` only when the declaration is legal, and a
       `takeBack` answer. Jackal Familiar, Berserkers of Blood Ridge, Prized Unicorn, Alluring Siren. Scenarios in
       `test/scenarios/cards/m2-06c/` and `interactions/requirements/`, a unit test for take-back
       (`test/combat/declarations.test.ts`), two new matrix rows; three of the cards in the M10 pair. Declarations list
       finishing first (no first-legal loop); the bench baseline reset.
     - M2-06d, done, merged (PR #38): shroud (CR 702.18), one check in `legalTargets` for permanents only (CR 113.6: a spell
       or a graveyard card with shroud can be targeted), which resolution re-checks (CR 608.2b).
       Mist Leopard, Kalonian Behemoth. Scenarios in `test/scenarios/cards/m2-06d/` and `interactions/shroud/`, a unit
       test for a target gaining shroud before resolution, a Shroud matrix row; Mist Leopard in the M10 pair.
       Protection's targeting and blocking, flash, indestructible and "can't be countered" waited for the owner's answer,
       settled by D-074: flash came in M2-07, indestructible in M2-08a, the rest come in M2-08e and M2-12.

  4. Done: M2-07 triggered abilities (CR 603; m2-rules-depth.md), merged in PRs #39, #40, #41 and #44 (D-076–D-079,
     D-084). The plan as it was made (2026-11-20), in three PRs:
     - Shared: `CardDef.triggers` (kept out of `abilities`, like `statics`, D-071), each a condition as data, targets,
       effects, "you may" and an "intervening if" (CR 603.4). Triggers are detected per batch in `checkTriggers` (see
       Settled), matched against result events; matches wait in `GameState.pendingTriggers`. `givePriority`, after state-based actions, puts
       them on the stack (CR 117.5, 603.3): active player's first in APNAP order (CR 603.3b), a player with several
       ordering theirs (a decision), each choosing its targets as it goes on (CR 603.3d; none legal: removed), with no
       cost and no cancel (future-rules: an origin kind in `casting-steps.ts`). An ability on the stack refers to its
       trigger (`AbilityRef` gains `triggered`) and carries what triggered it ("that player", "that much": the
       triggering event's player, object and amount). "You may" asks as it resolves (`chooseYesNo`).
     - M2-07a: the machinery, entering and beginning-of-step triggers: Elvish Visionary, Howling Banshee, Sparkmage
       Apprentice, Gravedigger, Borderland Ranger, Sage Owl, Acidic Slime, Soul Warden, Ball Lightning, Howling Mine
       (intervening if), Bramble Creeper (attacks). Done, merged (PR #39, D-076): the triggers README
       (`engine/src/triggers/README.md`) explains the path; 35 scenarios in `test/scenarios/cards/m2-07a/` and
       `interactions/triggers/`, unit tests in `test/triggers/triggers.test.ts`, a Triggers matrix column; nine of the
       cards in the M10 pair (Soul Warden and Acidic Slime only in pool decks); 9 golden games added (4.4 MB). The
       fuzzer's 40-seed measure doesn't reach `orderTriggers` (two triggers at once for one player); scenarios cover it.
       133 cards in the pool; 125 of the 234 Magic 2010 cards.
     - M2-07b: triggers on casting, drawing, discarding, damage, life gain and tapping for mana: Wurm's Tooth, Dragon's
       Claw, Kraken's Eye, Angel's Feather, Demon's Horn, Mesa Enchantress, Lurking Predators, Underworld Dreams,
       Megrim, Manabarbs, Hypnotic Specter, Sanguine Bond, Lightwielder Paladin.
       Done, merged (PR #40, D-077): 44 scenarios in `test/scenarios/cards/m2-07b/` (with real enchantments for Naturalize,
       Solemn Offering and Tempest of Light), three new Triggers matrix cells; six of the cards in the M10 pair; 12
       golden games added (5.1 MB; every golden log also gained a "taps ... for mana" line per land tapped). 146 cards
       in the pool; 138 of the 234 Magic 2010 cards. Plan (2026-11-20), one PR in three slices, each with its cards and scenarios:
       - Slice 1, casting: `spellCast` with a filter on the spell as cast (colors, types; `controller` is the caster,
         relative to the trigger's controller), matched where `SPELL_CAST` is emitted (CR 601.2i), so the triggers go
         on the stack before the caster gets priority. The five artifacts ("you may gain 1 life"), Mesa Enchantress,
         Lurking Predators (a `revealTop` op whose card is `found`; `put` with an `onlyIf` filter; "you may put it on
         the bottom", a yes or no).
       - Slice 2, drawing, discarding, mana: `playerDraws` and `playerDiscards` (`CARD_DRAWN`, `CARD_DISCARDED`, through
         the pipeline), `landTappedForMana` (CR 106.12: a new `MANA_ABILITY_RESOLVED` event from `resolveManaAbility`,
         land source, {T} in the cost, mana produced, CR 106.12a). Underworld Dreams, Megrim, Manabarbs. The cleanup
         step gives priority when triggers wait (CR 514.3a: a discard to hand size triggers Megrim). Manabarbs triggered
         while paying a cancelled cast is dropped (CR 734.1, built in 07a).
       - Slice 3, damage and life: `selfDealsDamage` (to an opponent, or combat damage to a player), `playerGainsLife`
         with "that much" (`TriggerEvent.amount`, an `Amount` "triggerAmount"). Target filters can name "that player"
         (`controller: "triggeringPlayer"`, read from the ability's `trigger`, CR 603.3d, Lightwielder Paladin).
         Hypnotic Specter, Sanguine Bond (one trigger per life-gain event: each lifelink source, CR 603.2c),
         Lightwielder Paladin.
       - Future impact: "whenever a player casts" also matches copies later (no: copies aren't cast, CR 707.10); the
         filter reads the spell's characteristics through `characteristics()` so layer effects apply; replacement
         effects (M2-08) change draw and life gain events before detection; a 0-life gain has no event (CR 119.10).
     - Golden games rework (owner, D-082), done, merged (PR #42): 25 games, 1.5 MB (was 66, 5.4 MB).
       - `cli/src/action-lines.ts`: `actionLines(actions)` writes one readable line per action (`pass p1 p2`, `p1 land o85`,
         `p2 cast o12`, `p1 activate o5 printed 0 for G`, `p2 chooseTarget p1`, `p2 declareBlocker o7 o5`; D-083);
         `actionsFromLines(setup, lines, cards)` replays the game to fill in each decision id, and counts lines left after the
         game ended. `setup-names.ts`: card names in setups. Game files with `"encoding": "lines"`; `readGameFile`
         reads either encoding.
       - `cli/src/mechanics.ts`: the cover's units: combat keywords and statics as creatures attack or block, flash and
         shroud as a permanent enters, each field of a resolving spell, activated or triggered ability, every decision
         kind answered (a cancel or take-back doesn't count), every event type agents can reach.
       - A test that every pool card is in a scenario, by whole name.
     - Golden action lines name the acting player (owner, D-083), done, merged (PR #43).
     - M2-07c2 (D-084): done, merged (PR #44). With it, M2-07 is done. Engine, Dragon Whelp and Illusionary Servant, 20 scenarios in
       `test/scenarios/cards/m2-07c2/`, unit tests (`test/game/activation-count.test.ts`: a removed activation still
       counts, the count starts again each turn; `test/triggers/delayed.test.ts`: a spell's delayed trigger, CR 603.7d,
       with the test-only instant Late Gift), definition checks, two matrix cells (Firebreathing × Triggers, Burn ×
       Triggers), golden logs with `targeted:` lines (additions only), pool-579 and pool-111 covering `trigger delayed`
       and `selfBecomesTarget`, docs. 152 cards; 144 of the 234 Magic 2010 cards. Not put in the M10 pair: each of its
       slots carries a rule the pool needs. Fuzz (300 games), mutation pass (10 caught), bench, rules-judge and code-reviewer all done, fixes in.
       Design (2026-11-20, with the advisor's review):
       - `GameState.delayedTriggers`: each `{ source, sourceOracleId, controller, ability }`, the ability a
         `TriggeredAbilityDef` (its `when` limited to the next "beginning of step" for now). Created by an effect
         `createDelayedTrigger`; source and controller those of the ability that made it (CR 603.7e). Matched in
         `detectTriggers` apart from the battlefield's (no early exit, no source lookup), and removed as it triggers
         (CR 603.7b). A pending trigger refers to its ability by `{ kind: "triggered", index }` or
         `{ kind: "delayed", ability }`; one lookup resolves both, and identical delayed triggers stay unasked (D-077).
       - Dragon Whelp: `GameState.turnHistory.activations` counts each object's printed ability as it becomes activated
         (where `ABILITY_ACTIVATED` is emitted: a cancel never counts, a countered activation does, D-078), reset as a
         turn begins; the effect `ifActivatedThisTurn { atLeast, effects }` reads its own ability's count through the
         resolving stack object.
       - Illusionary Servant: a `BECAME_TARGET` event as each object target is chosen, for spells, activations and
         triggers, matched where it's emitted; `selfBecomesTarget`. A cancelled cast drops its pending triggers, all of
         which it caused (a cast starts only with none waiting). No pool card targets one object twice in one spell, so
         one trigger per target chosen is enough for now (future-rules).
       - Golden credit: the delayed ability's units when it resolves, not when it's created.
     - M2-07c plan (2026-11-20), two PRs:
       - M2-07c1, done, merged (PR #41, D-079): 27 scenarios in `test/scenarios/cards/m2-07c/`, a unit test for the random
         destroy over seeds, an Inferno Elemental matrix cell, an invariant that a pending decision always has a legal
         action; three of the cards in the M10 pair; 3 golden games (5.4 MB). 150 cards in the pool; 142 of the 234
         Magic 2010 cards. Plan: Xathrid Demon ("your upkeep": `beginningOfStep` gains `whose`; "sacrifice a creature other than this",
         then a loss equal to the sacrificed creature's power, read from its last known characteristics, CR 608.2h:
         kept with it in the resolution's "this way" record as it's sacrificed, D-079; "if you can't" taps
         it and loses 7), Capricious Efreet (targets on both sides, "up to two"; destroy one of the still-legal targets
         at random with the seeded RNG), Inferno Elemental (blocks or becomes blocked: one trigger per blocker/attacker
         pair, matched where `BLOCKERS_DECLARED` is emitted; "that creature" is the trigger's object), Bogardan Hellkite
         (flash, CR 702.8a: cast any time an instant could be; its entering trigger divides 5 damage among zero to five
         targets (CR 107.1c), the division chosen as the trigger goes on the stack, CR 603.3d, 601.2d).
       - M2-07c2: delayed triggers (CR 603.7): created by a resolving effect, kept in `GameState.delayedTriggers` with
         their own `AbilityRef`, removed once triggered ("the next end step"); Dragon Whelp's per-object, per-turn
         activation count (D-078); "becomes the target" (CR 601.2c, 603.2) for spells, activations and triggers, as
         targets are chosen, dropped on cancel (only what the cancelled cast caused): Illusionary Servant.
     - M2-07c: Xathrid Demon, Capricious Efreet, Dragon Whelp (a delayed trigger, CR 603.7), Inferno Elemental,
       Illusionary Servant ("becomes the target", CR 601.2c), Bogardan Hellkite (flash comes with it, D-074).
     - Settled before code (advisor, 2026-11-20):
       - Detection stays `checkTriggers` in `happen` (D-056: it has the state before each batch), plus the four places
         that emit events outside the pipeline: `STEP_BEGAN` (steps.ts), `SPELL_CAST` / `ABILITY_ACTIVATED`
         (casting-steps.ts), `ATTACKERS_DECLARED`, `BLOCKERS_DECLARED`. One `detectTriggers(before, after, events)`.
         Early exit when no permanent has triggers.
       - Only permanents' triggers fire (CR 113.6): not a card in a graveyard, not a spell on the stack.
       - A cancelled cast drops the triggers its mana abilities caused (CR 734.1): all waiting ones, as a cast starts
         only at priority with none waiting (code review: no count needed).
       - Pending triggers make cleanup give priority, like a state-based action did (CR 514.3a); `playersLose` clears
         them; an invariant: nothing pending while a player has priority.
       - Trigger target decisions offer no cancel; ordering is asked only of a player with two or more, the last
         forced; the stack ability stores only what its effects read from the triggering event (no hidden ids).
       - Slices of 07a: machinery and untargeted entering triggers; then targets and "may"; then step and attack
         triggers. A mutation pass before review; trigger cards into the M10 pair and the 40-seed measure.
     - Rules review of the plan (2026-11-20), to build in:
       - Last known information is needed now (CR 608.2h, 603.4): Howling Mine Shattered in response still makes the
         player draw (ruling); Xathrid Demon reads the sacrificed creature's power. A store of objects' last known
         information as they leave, read by the intervening-if re-check and "self" when gone. "Dies" triggers (Magma
         Phoenix, M2-14) will use the same store.
       - CR 603.3b / 117.5 repeat: after a batch is on the stack, `givePriority` runs again (state-based actions, then
         triggers that came up meanwhile, a fresh batch). The `givePriority` work keeps the player who'd get priority;
         putting triggers never gives it to the trigger's controller (CR 603.3b).
       - "Becomes the target" (CR 601.2c, not 603.2): an event as targets are chosen, for spells, activations and
         triggers, dropped on cancel. (07c, Illusionary Servant.)
       - Each emission point matches only its own event: `payCost`, the draw step and declaring attackers already
         passed their other events through `happen`.
       - A pending trigger stores its source id, oracle id, trigger index and controller as it triggered (CR 603.3a):
         the source may be gone before it goes on the stack.
       - The triggering event's data goes on the ability before targets ("target ... that player controls", Lightwielder
         Paladin) and is read again on resolution (CR 608.2b).
       - Triggers go on the stack through the target steps but not `payCost`: no `ABILITY_ACTIVATED`, no priority to
         the trigger's controller, no cancel.
       - Match result events: one `LIFE_GAINED` per lifelink source (Sanguine Bond), `ZONE_CHANGED` for a played land,
         "taps a land for mana" per activation of a land's {T} mana ability (CR 106.12; not Terramorphic Expanse).
       - Intervening if re-checked in `resolveTopOfStack`, beside CR 608.2b: false removes it (CR 608.2a).
       - Delayed triggers (07c) live in state, not on a permanent; their own `AbilityRef`; Dragon Whelp needs a
         per-object, per-turn activation count (not resolutions; cancel doesn't count; CR 400.7 resets; D-078).
       - CR 514.3a (cleanup with triggers) has no 07a card: built with Megrim (07b).
       - Read a permanent's triggers through one function (layer 6 later, CR 603.6b), like `keywordsOf`.
       - Test list: ETB in APNAP order, ordering one's own, Soul Warden negatives, source gone before and after going on
         the stack, illegal target, shroud, Acidic Slime forced onto its controller's land, Gravedigger with no target
         and "may" both ways, Banshee draw, Visionary on an empty library, Howling Mine (its own, the opponent's,
         tapped, first turn, Shattered in response), Ball Lightning (sacrificed, Unsummoned, put in by Elvish Piper in
         the end step), Bramble Creeper; unit tests for creatures entering together, the repeat, cancel dropping
         triggers, a Mine tapped before resolution, the no-pending-while-priority invariant.
     - Future impact: replacement effects (M2-08) sit before detection, so a replaced event triggers as replaced;
       delayed triggers and "until" durations share the turn's step hooks; tokens (M2-11) entering trigger the same
       way; copies of abilities and "trigger an additional time" fit the pending list.
  5. Now: M2-08 replacement and prevention effects (CR 614–616; m2-rules-depth.md). 19 cards. Plan (2026-11-20, with
     the advisor's review), in five PRs. Three later cards shape the data now: Clone (M2-14, a copy as it enters,
     CR 616.1c), Protean Hydra (M2-10, a prevention that removes counters), Magebane Armor (M2-12, a granted
     noncombat-damage prevention).
     - M2-08a: done, merged (PR #45, D-085). 18 scenarios in `test/scenarios/cards/m2-08a/`, a unit test for lands entering together
       (`test/pipeline/replacements.test.ts`), an Indestructible matrix row, three golden games; the Magic 2010 decks
       run checklands. 158 cards; 150 of the 234 Magic 2010 cards. As built, unlike the plan below: one replacement per
       event, refusing two (CR 614.5 and 616.1f come with M2-08c's choice), and `autoPay` stays greedy (lands first,
       then fewest choices; no search). Owner (2026-11-20): carry on with M2-08b once this PR merges. Plan as made:
     - M2-08a, the framework, no player choice: replacement effects as data, applied in `pipeline/happen.ts`'s
       `replace` to each event against the state before its batch, each at most once per event
       (CR 614.5), the result replaced again (CR 616.1f). Until M2-08c, `replace` throws if two different effects
       apply to one event; it never picks. Where they come from: a permanent's static replacement on the battlefield,
       and the moving object's own (CR 113.6: Colossus from hand, library or stack; a land "as it enters", CR 113.6h,
       614.12, read as it would exist on the battlefield). A "the zone change this event makes" helper that changes
       the destination, not the action: a sacrificed, discarded or countered Colossus was still sacrificed, discarded
       or countered (check the CR and rulings; Xathrid Demon, Vampire Aristocrat's cost, `ifNothingSacrificed` and
       Megrim depend on it). Cards: Darksteel Colossus (indestructible, CR 702.12: `destroy` does nothing, and lethal
       damage and deathtouch, CR 704.5g–h, aren't listed, D-039; "if it would be put into a graveyard from anywhere,
       reveal it and shuffle it into its owner's library instead"); the five checklands ("enters tapped unless you
       control a [type] or a [type]", land types read through `characteristics()`, Convincing Mirage later), with
       "{T}: Add {G} or {W}": the color carried on the action as for any color (D-068) but limited to two, and
       `autoPay` searching sources once one offers a restricted choice (D-068 said it would need to).
     - M2-08b: done, merged (PR #46, D-086). Built: 23 scenarios in `test/scenarios/cards/m2-08b/`, unit tests
       (`test/permanents/regeneration.test.ts`, with CR 614.17c on a test-only indestructible wall;
       `test/effects/reveal-until.test.ts`), a Regeneration matrix row, two golden games. 163 cards; 155 of the 234
       Magic 2010 cards. Next: M2-08c, the CR 616.1 choice (plan below).
       Design (as planned; CR 614.17c is the unit test above, not a Colossus scenario):
       - `GameState.replacements` (the list architecture.md plans): replacement effects made by resolving spells and
         abilities, here `{ kind: "regenerationShield", object }`, all "this turn": emptied in cleanup with the
         continuous effects (CR 514.2). Made by the op `regenerate` (of: a subject), outside the pipeline like
         continuous effects; making one isn't regenerating (CR 701.19c).
       - `replace` gathers a destroy's candidates from the event, not only the moving card's own text: the object's
         shields, unless the destroy says it can't be regenerated (`destroy` op and event `noRegeneration`, CR
         701.19c). Several shields of one object are interchangeable: one is used, unasked (like D-077). A shield and a
         different replacement on one destroy still refuse until M2-08c.
       - The destroy becomes a `regenerate` event, performed whole (CR 701.19a): the shield used up, all damage removed,
         tapped by its controller, removed from combat (`Combat.removed`, CR 506.4; `rules/combat.ts` reads it). Events:
         `PERMANENT_REGENERATED`, then `DAMAGE_REMOVED` and `PERMANENT_TAPPED` as they happen. Lethal damage and
         deathtouch destroy, so they're regenerated (CR 704.5g–h); sacrifice and toughness 0 aren't destruction.
       - Polymorph: `destroy` with `noRegeneration`, then `revealUntil` (who: the target's controller, a new subject
         `{ controllerOf: { target: 0 } }`, read from last known information if it's gone, CR 608.2h; filter: a
         creature card) making the card `found`, `put` it onto the battlefield under that player, then that player
         shuffles; revealed cards never leave the library. The reveal happens even if the creature isn't destroyed
         (its ruling); an illegal target means nothing happens (CR 608.2b).
       - Tests: each card's basic use; regenerating in combat (a blocker regenerated: the attacker stays blocked, no
         trample, deals no damage to the player; an attacker regenerated after first-strike damage deals no regular
         damage); a shield unused ends in cleanup; two shields, one used; sacrifice not replaced; deathtouch;
         Polymorph on a shielded creature, on Darksteel Colossus (not destroyed, still reveals), with no creature card
         left; CR 614.17c: Regenerate on Darksteel Colossus, then Doom Blade: the shield is still there.
       - Future impact: M2-08c's choice between a shield and a "would die" replacement; static regeneration
         (CR 701.19b) and "can't be regenerated" as a continuous effect later; `Combat.removed` serves "remove from
         combat" effects and control changes later.
     - M2-08b, regeneration (CR 701.19, 614.8), with a scenario for CR 614.17c (an indestructible creature's
       destroy never uses up its shield; `happen.ts` cites it as later until then): a shield in state bound to one object, used once, the next time it would
       be destroyed this turn (destroy, lethal damage, deathtouch; not sacrifice): instead tap it, remove its damage,
       remove it from combat (a recorded removed-from-combat set, CR 506.4, which future-rules asks for). Identical
       shields are used unasked (like D-077). "Can't be regenerated": the shield isn't applied (CR 701.19c). Cards:
       Drudge Skeletons, Wall of Bone, Cudgel Troll, Regenerate, Polymorph (its reveal happens even if the creature
       isn't destroyed: its ruling).
     - M2-08c: done, merged (PR #47, D-087). Built: `happenOrAsk`, the `chooseReplacement` decision and its plumbing (legal
       actions, view, CLI action lines and describe, scenario `choose:` "regeneration" or a card's name, export), unit
       tests in `test/pipeline/replacement-choice.test.ts`, an import guard. Next: M2-08d.
       Design, with the advisor's review:
       - `happenOrAsk`: like `happen`, but when the affected player (or the affected object's controller, CR 616.1)
         must choose between two different replacement candidates, it performs nothing, sets a `chooseReplacement`
         decision, and queues a `resumeEvent` work item holding the proposed event and the choices so far. On the answer,
         `replace` runs again from the top with the choices in order; nothing was performed, so the state is as it
         was, and the others are checked again after each (CR 616.1f; CR 614.5 later). Several players choose in APNAP order (CR 616.1).
         Candidates are named by stable references (`{ kind: "ownText", object, index }`, `{ kind:
         "regenerationShield", object }`). Identical candidates aren't asked about (D-086).
       - Only callers that do nothing after the event may pause: a resolving effect's damage and destroy
         (`run-effect.ts`, one work item per effect) and combat damage, which queues its priority before the event. A
         test checks no other file imports `happenOrAsk`; plain `happen` still refuses a choice (unreachable with the
         pool: only damage, from these two places, can meet two effects; Homing Bear's tests use a destroy spell).
       - Applying candidates in order rebuilds the event: a replacement that swaps the core event for another
         (regeneration) drops what earlier ones added around it (CR 614.6: a replaced event never happens). Homing
         Bear (test-only: "would be put into a graveyard ... library instead") with a regeneration shield on one
         destroy: shield first, it regenerates; library first, it's still a destroy, so the shield then applies
         (CR 616.1f) and it regenerates, with no reveal or shuffle.
       - Plumbing: the decision kind in `legalActions`, the view, the scenario syntax, the CLI's action lines, the
         fuzz picker, and `DECISION_KINDS` with a reason until M2-08d's cards reach it.
       - Future impact: Clone's "as it enters" (M2-14) is a choice pausing a zone change from `resolve.ts`, not built.
     - M2-08c, the CR 616.1 choice, no pool cards: superseded by the design above (D-087). The M2-03 review's cases are
       in Open questions; only the Homing Bear one (regeneration and a "would be put into a graveyard" replacement on
       one destroy) is tested now.
     - Now: M2-08d (2026-11-20), in two PRs. M2-08d1 built (D-088): Fog, Safe Passage, Guardian Seraph; 11 scenarios in
       `test/scenarios/cards/m2-08d/`; two golden games. 166 cards; 158 of the 234 Magic 2010 cards. Mutations (6/6
       caught) and a 200-game fuzz are clean; both reviews found no wrong result. Their findings are fixed (dbade33,
       21 scenarios now; a second mutation pass caught 6/6 after one test was tightened). Merged as #48. The new effect
       ids changed no golden log: pool-181 casts Fog as its last action, and no later id shows.
       What the fixes were:
       - Bug: identical candidates (two Seraphs) beside a different one (Fog) are offered as separate options. Group
         candidates by identity: one option per group, all its members applied when chosen.
       - A choice's `for` becomes a union (an object, or a damage entry by its index in the event, source and
         recipient), so the CLI can say which damage is asked about; `affectedKey` becomes a switch.
       - Tests: Seraph against two attackers (per-entry choices, CR 615.10), the creature chooser and APNAP across
         entries, partial prevention with lifelink and a damage trigger, Fog with first strike and deathtouch, Fog
         ending at cleanup, Safe Passage after damage, sharper Seraph-and-Fog expectations.
       - State effect ids from `newObjectId`, the op moved to `effects/prevention.ts`; entries that can't be dealt
         damage dropped before prevention (shields must not be used up by them, CR 609.7b); drop the unread
         `fromOpponents`; one engine helper naming a state effect's card; citations (CR 120.2b); stale docs.
       - Damage is replaced per recipient: a `dealDamage` event's entries (one per source and recipient) each get their
         own candidates and their own chooser, the recipient player or the recipient object's controller (CR 616.1).
         Choices become `{ for, ref }` (`for`: an object, or a damage entry), so a global effect's choice for one recipient isn't used for another
         (the M2-08c review). A prevented entry shrinks or goes; lifelink and "deals damage" triggers see what's left
         (CR 615.6, 120.4c). State-held effects get an `id` (two Fogs differ, D-088).
       - M2-08d1: Fog ("prevent all combat damage that would be dealt this turn"), Safe Passage ("all damage that would
         be dealt to you and creatures you control this turn", creatures arriving later too: its ruling), both kept in
         `GameState.replacements` until cleanup; Guardian Seraph ("if a source an opponent controls would deal damage to
         you, prevent 1 of that damage"; a source without a controller counts by its owner: its ruling; several add up), the first
         replacement read from another permanent's text on the battlefield, not the moving card's. Choices arise
         (Seraph with Fog or Safe Passage), though the result is the same; asked anyway (CR 616.1), skipping a choice
         whose outcome can't differ being a later UX question.
       - M2-08d2, Harm's Way: built twice and reverted (1c4fcda, 93f2c4d, 6fd7c9e; reverted in 98b08ed); the owner left
         it out of the pool (D-090, which records what the rules reviews found and what a correct model needs).
       - Golden cover: `chooseReplacement` becomes required once Seraph meets Fog or Safe Passage in agent games, or
         a deck runs both.
     - M2-08d, prevention (CR 615), two shapes in state: a filter checked as each event happens (Fog: all combat damage
       this turn; Safe Passage: you and your creatures, those arriving later too: its ruling), and a static (Guardian
       Seraph: 1 from a source an opponent controls); Harm's Way's "the next N" redirection is left out (D-090). Lifelink and "deals damage" triggers read the damage as dealt after prevention (CR 120.4c).
     - M2-08e, protection (CR 702.16, D-074: damage prevention, targeting, blocking; "can't be enchanted" in M2-12),
       reading the source's characteristics, from last known information if it's gone (snapshot `characteristics()`,
       future-rules): White Knight, Black Knight, Baneslayer Angel (from Demons and from Dragons), Great Sable Stag
       (from blue and from black; "can't be countered", CR 101.2, 113.6g: a counter effect does nothing to it, and
       it's still a legal target).
       Built (D-091): White Knight, Black Knight, Baneslayer Angel, Great Sable Stag; 11 scenarios in
       `test/scenarios/cards/m2-08e/`, a unit test for a source that left; golden pool-197 and pool-537. 170 cards;
       162 of the 234 Magic 2010 cards. Mutations 7/7, fuzz clean, reviews (no wrong results) fixed in e5d7287:
       15 scenarios, unit tests in `test/rules/protection.test.ts`, protection in the interaction matrix. PR next, with
       the M2-08d docs; then M2-09 (layers). Merged as #49.
     - Now: M2-09, the full layer system (CR 613, 604, 611), 24 cards, in three PRs. Plan (2026-11-20):
       - M2-09a, the board-wide layer pass and anthems: `rules/layers.ts` computes every object's characteristics once
         per state, layer by layer (CR 613.1), each continuous effect with its timestamp (CR 613.7) and its affected set
         fixed in the first layer it applies in (CR 613.6); static abilities' effects find their set as they apply
         (CR 611.3a), resolved effects keep theirs (CR 611.2c). The per-layer readers (`controllerOf`, `cardTypesOf`,
         `colorsOf`, `keywordsOf`, `protectionsOf`, `staticAbilitiesOf`, `powerAndToughness`) read it, so callers don't
         change. Memoized per state object if the benchmark asks (architecture.md). Layer 6 grants keywords, layer 7c
         adds. Cards: Honor of the Pure, Veteran Armorsmith, Veteran Swordsmith, Elvish Archdruid, Merfolk Sovereign,
         Goblin Chieftain, Rhox Pikemaster, Levitation, Coat of Arms, Relentless Rats; Glorious Charge, Overrun,
         Trumpet Blast, Kindled Fury, Jump, Burst of Speed. A CR 613.8 dependency example as a unit test.
       - Step 1 done (D-092): the readers read one pass in `rules/layers.ts`, no behavior change (no golden log
         changed), kept per its inputs; a fuzz check compares it with a fresh pass. A random game is 98.5 ms against
         its 100 ms budget (61 before): watch it as the slices add layers.
       - Paper review of the pass (rules-judge, 2026-11-20): boards A-E right; no same-layer dependency in the pool, nor
         a case where timestamp order or CR 613.6 is visible (so they're unit tests on test effects, or `later:`).
         Needs: CDAs work in every zone (Nightmare in hand), so the per-card cache for other zones and the "no printed
         P/T" early return go (base from 7a/7b, else printed, at the start of layer 7); locked sets (CR 611.2c) are
         found from fully computed characteristics as the effect begins, and stay on an object that stops being a
         creature; "for as long as" durations tied to an object (Awakener Druid; none made if it's gone, CR 611.2b);
         Rise from the Grave's effect made with the move, on the new id (CR 611.2e), "under your control" is the
         stored controller, not layer 2; layer 2 inside the pass before the rest, every "you" read after it; a
         changed controller removes a creature from combat (CR 506.4); Coat of Arms counts creature types only
         (CR 205.3m: subtypes are one flat list today); Silence and Spellbook stay out of the pass (CR 613.10-11);
         drop "attacking" from the pass (no static reads it; it would need combat in the inputs). Last known
         information must be the computed characteristics, snapshotted as it leaves (CR 608.2h): Polymorph on a
         stolen creature, Inferno Elemental risen black against White Knight, Stone Giant's power. The judge's
         scenario list is in its report; the ones for each slice are written with it.
       - Step 2 done (D-093): 16 cards (Honor of the Pure, Veteran Armorsmith, Veteran Swordsmith, Elvish Archdruid,
         Merfolk Sovereign, Goblin Chieftain, Rhox Pikemaster, Levitation, Coat of Arms, Relentless Rats, Glorious
         Charge, Overrun, Trumpet Blast, Kindled Fury, Jump, Burst of Speed); 16 scenarios in
         `test/scenarios/cards/m2-09a/`; the Anthems row of the interaction matrix; golden pool-329 and pool-685. 186
         cards. Mutations 10/10 (two scenarios strengthened), fuzz 200 clean. Code review (no wrong results) found, to
         fix with the rules review's findings: the cache key misses the rule modifiers (reproduced: a pass kept across
         a changed modifier); a bad anthem filter throws inside the pass (definition check, and `creaturesGet` should
         require creatures itself); `fitsOnBoard` duplicates `matchesFilter` (extract a pure core); `controllerOf`
         and `Layered.controller` are two sources (a fuzz check now; layer 2 and the signature change in 09c, as
         Mind Control in M2-12 needs the card database); the `alone` cache is outside the safety check (replace it);
         no tests of the memo itself; benchmarks time only cache hits (add a fresh-pass measure); stale reader
         comments and docs (future-rules, architecture.md, rules README); `inspect` doesn't say where a granted
         keyword came from; scenario gaps (Coat of Arms across players, Levitation not on p2's creatures, effects
         ending at cleanup, Archdruid and auto-pay, Anthems with protection and shroud). Rules review (no wrong
         results): `jump.yaml` and `levitation.yaml` pass without the grant (try a block); CR 613.6 is built (test it
         with a test def, drop `later:`); CR 613.7 and 205.3m are cited as built but aren't (`later:`); cite CR 611.3c;
         Trumpet Blast cites 506.4 (its duration is 611.2a); Elvish Archdruid makes `manaAvailable` undercount X; more
         scenarios (Jump after blocks and at cleanup, Kindled Fury after first strike, Trumpet Blast by the defender and
         before combat, Merfolk Sovereign on an opponent's Merfolk and after blocks, Coat of Arms across players, two
         Coats, Relentless Rats becoming lethal, Archdruid and Pikemaster only yours, Burst of Speed and a tap ability,
         Overrun and a later creature, Glorious Charge on Black Knight, Overrun on Mist Leopard).
       - Review fixes, part 1 (c804684): the cache key with the rule modifiers and a unit test; one filter core
         (`filter-fit.ts`); `creaturesGet` requires creatures and the definition check refuses combat in static
         filters; the `alone` cache replaced by `elsewhere` in the kept pass; CR 613.6 unit-tested; `later:` for 613.7
         and 205.3m; `inspect` names a grant's source; the scenarios both reviews asked for (34 in `m2-09a/`).
         Part 2: Elvish Archdruid counted by `manaAvailable` (scenario `elvish-archdruid-x.yaml`); the
         `layers.freshPass` measure; docs (D-092, architecture.md, future-rules, rules README, reader comments); a
         random game back from 103 ms to 82 ms (D-092: printed values shared, basic land abilities made once, legal
         actions ask only the player's permanents), baseline updated. Code review of part 2 (no wrong results): freeze
         the shared starts and basic land abilities (the fresh pass shares them), one usable-mana-ability search and
         one count for `manaAvailable` and auto pay, a payable Archdruid X and an "only yours" scenario, doc wording,
         `later: CR 602.2` on the controller pre-filter; all fixed (4feab84). Fuzz 200 + 150 clean. Merged as #50.
         Next: M2-09b.
       - M2-09b, split in two PRs (2026-11-21). Plan for b1, characteristic-defining abilities (CR 604.3, 208.2a,
         613.4a): Nightmare, Serpent of the Endless Sea.
         - Printed power and toughness may be `"*"` (`printed.ts`); a card with one must have a CDA (definition check).
         - A static ability `powerToughnessEachEqual { to: { count: filter } }` ("power and toughness are each equal to
           the number of [filter] you control"), applied in layer 7a for its own object in every zone (CR 604.3): the
           base is the CDA's value, else printed; 7c adds as before. "You" is the controller, or the owner elsewhere
           (CR 108.4a, 109.5). The count is read from the board as layers 1-6 left it (`fitsOnBoard`); a CDA's filter
           can't read combat (definition check), nor power or toughness (`ObjectFilter` has no such field). A card outside the battlefield and the
           stack is computed with the board, so Nightmare in hand is X/X (its ruling).
         - `cantAttackUnlessDefenderControls { filter }` (Serpent; CR 508.1c), checked per attacker and defending player
           in `possibleAttacks`.
         - Scenarios: Nightmare's P/T as Swamps come and go, a nonbasic Swamp (a checkland? no: Swamp subtype only on
           basics in the pool, so basic Swamps), 0 Swamps dies (SBA), in hand (inspect/characteristics), only yours,
           with an anthem; Serpent can't attack without a defending Island, can with one; Serpent dies with 0 Islands.
         - Future impact: 7b (Awakener Druid, b2) sets base P/T after 7a in timestamp order; tokens' CDAs come from
           their creating effect (CR 604.3a); a CDA counting creatures by power would need dependency (CR 613.8).
         - b1 built (D-094): Nightmare, Serpent of the Endless Sea; 8 scenarios in `test/scenarios/cards/m2-09b/`
           (Nightmare growing and dying, a pump keeping it alive, in hand and graveyard; Serpent's restriction, its
           count, and Alluring Siren), unit tests for the printed "*" and the definition checks, `inspect` showing
           7a, the Defined P/T column of the interaction matrix, golden pool-231. 188 cards. Mutations 5/5, fuzz 200
           clean. Rules and code reviews (no wrong results): 5 more scenarios (stack, opponent's hand, Coat of Arms,
           damage as it shrinks, Siren when able; 69e40a2); `Layered.base` records 7a's base so `inspect` doesn't
           subtract (7b will set it); both printed P/T must be "*"; stale comments, the 508.1c message, a tripwire on
           `ObjectFilter`, docs (future-rules, card-scripting, rules README). Bench baseline rewritten: the busy-board
           measures take their states from the golden games, which now include pool-231, so `legalActions.busyBoard`
           measures different boards (+12-23%); a random game (fixed decks) is about 3-7% slower, `layerSeven`
           recording the base (main 80 ms, this branch 86 ms standalone, under the 100 ms budget). Merged as #51.
         b2, split again (2026-11-21). Plan for b2a, type, color and setting effects (CR 613.1d-e, 613.4b, 611.2b,
         611.2e, 205.1b): Awakener Druid, Rise from the Grave.
         - A continuous effect change `becomes { addTypes, addSubtypes, colors?: {set}|{add}, setPT? }`, one effect
           applied in each layer it touches (CR 613.6): types and subtypes added in layer 4 ("still a land", "in
           addition to its other types", CR 205.1b), colors in 5, base power and toughness set in 7b after 7a. Within a
           layer, effects apply in timestamp order (CR 613.7), which is `state.effects`' order (each new one is later).
         - Durations: "endOfTurn", "endOfGame" (no duration stated, CR 611.2a: Rise), and "whileSourceOnBattlefield"
           ("for as long as this creature remains on the battlefield": the effect ends as its source leaves, in
           `moveCard`, with EFFECT_ENDED; none is made if the source is already gone, CR 611.2b).
         - Layer 7 for a land that becomes a creature: P/T from 7b although none is printed (the early return goes).
         - Rise from the Grave: `putOntoBattlefield` from a target card in a graveyard, under "your" control (the stored
           controller), with characteristics it has as it enters (CR 611.2e): the effect is made with the move, on the
           new object (CR 400.7), its timestamp after the object's (CR 613.7n).
         - Scenarios: the Druid's Forest is a 4/5 green Treefolk land creature that still taps for {G}, reverts when
           the Druid leaves (and leaves combat, CR 506.4), nothing if the Druid left first (611.2b), an opponent's
           Forest, a Forest that entered this turn is summoning sick, a pump on 7b; Rise: a black Zombie under your
           control, colors added (Ornithopter becomes only black, its ruling), Doom Blade can't target it, it goes to
           its owner's graveyard. New expectations `.colors`, `.types`, `.subtypes`.
         - Not built: subtypes by kind (Coat of Arms counting only creature types, CR 205.3m): no pool pair shows it
           (an animated Forest and another creature share no land type), so it stays `later:`.
         - Future impact: control-changing effects (M2-09c) join the pass as layer 2 the same way; Auras' and
           Equipment's statics (M2-12) set or add in these layers too; tokens (M2-11) are made with characteristics
           like Rise's.
         - b2a built (D-095): Awakener Druid, Rise from the Grave; 12 scenarios in `test/scenarios/cards/m2-09b2/`, a
           unit test for CR 613.7n, `.colors`/`.types`/`.subtypes` expectations, `inspect` and the log showing 7b,
           the Becomes column of the interaction matrix, golden pool-563 and pool-655 (no old one changed). Layer 7
           moved to `rules/layer-seven.ts`. 190 cards. Mutations 6/6 (one after a unit test of 7b's order, 106245b).
           Rules and code reviews: one wrong result, found by both: a Forest removed from combat came back when a
           second Druid animated it again (CR 506.4); now recorded in `Combat.removed` as it happens, scenario
           `awakener-druid-recombat`. Also fixed: "is" applies as the card enters, before triggers (CR 611.2e, `put`'s
           `is`, `putTargetOntoBattlefield` dropped); a creature with no P/T is 0/0 (CR 208.5); unit tests for
           timestamp order in layers 5 and 7b; 8 more scenarios (no Forest, sick Forest can't attack, a blocking
           Forest, Earthquake killing both, Undead Slayer and the Zombie, a noncreature target, statics after layers
           4-5, colors after death); citations, stale comments and READMEs. A re-check: a blocker staying out of
           combat (`awakener-druid-reblocker`), D-095 corrected for tokens. Fuzz 3×200 clean. Merged as #52.
         b2b plan (2026-11-21): Stone Giant and last known characteristics.
         - Snapshot (CR 608.2h, 603.10a): `perform` takes `characteristics()` of each permanent an event will move,
           from the state before the event (a whole simultaneous batch), and keeps those that left in
           `GameState.lastKnownCharacteristics`, cleared with `lastKnown`. Readers of a gone object's characteristics
           use it: protection's source qualities (Rise's black Zombie that left), a source's power.
         - Stone Giant: a target restriction "with toughness less than this creature's power" on the permanent target
           (`toughnessBelowSourcePower`), checked as it's chosen and as the ability resolves (CR 608.2b), the source's
           power as it last existed if it's gone (608.2h). The Giant itself is a legal target if it fits (its ruling).
         - "Destroy that creature at the beginning of the next end step": `createDelayedTrigger { about }` keeps the
           objects it names on the delayed ability's reference (optional `objects`, so older replays keep their
           hashes); subject "remembered" reads them (CR 603.7c). Destroyed even if no longer a creature or yours;
           nothing if it left the battlefield (a new object, CR 400.7). Activated in the end step: the next turn's.
         - Scenarios: flying then destroyed at end step; toughness not less refused; the Giant targeting itself after
           a pump; activated during the end step; the target bounced and recast (not destroyed); the Giant gone before
           resolution, its LKI power deciding legality; a risen black Zombie dealing damage as it left vs White
           Knight (protection reads the snapshot); flying given after blockers does nothing (its ruling).
         - Built (D-096): Stone Giant; 7 scenarios in `test/scenarios/cards/m2-09b3/` (the "no longer a creature"
           ruling can't be set up with the pool: a 4/5 Forest is too tough), a definition check for "remembered" with
           a test, replays' hashes rewritten (only the new field differs). 191 cards. Mutations 5/5 (one after adding an
           equal-toughness case). Rules and code reviews (no wrong results): 6 more scenarios (a target pumped in
           response, pumped later, the Giant gone or destroyed, regeneration, a target no longer a creature); a unit
           test of the batch snapshot (CR 704.8); snapshots only for events that may move a permanent off the battlefield
           (an exhaustive switch; tapping no longer snapshots); "its controller" of a gone object from the snapshot; the
           definition check's false positive inside a condition, and `about` naming a player; citations, comments,
           docs. "Flying given after blockers does nothing" is plain evasion (CR 509.1b), already covered; not added.
           Fuzz 200 clean. Bench ok (a random game 94.5 ms: the margin to 100 is thin). Merged as #53; M2-09b is done.
           Next: M2-09c (Act of Treason, Silence, Spellbook).
         - Future impact (b2b): the snapshot is what M2-09c's Polymorph-on-a-stolen-creature and every "dies" trigger
           reading characteristics need; tokens (M2-11) leave a snapshot too.
       - M2-09c, split in two PRs (2026-11-21). c1, rules effects (CR 101.2, 613.10-11): Silence ("your opponents can't
         cast spells this turn": a resolved effect on players, fixed as it resolves; `castProblem` refuses; abilities,
         land plays and spells already cast are untouched, its rulings) and Spellbook ("you have no maximum hand size":
         a static read by the cleanup step's hand-size check, CR 402.2, 514.1). c2: Act of Treason, layer 2 inside the
         pass and `controllerOf` reading it (a signature change: it takes the card database), control changes
         recorded for summoning sickness (CR 302.6) and removing a creature from combat (CR 506.4).
         - c1 built (D-097): Silence, Spellbook; 8 scenarios in `test/scenarios/cards/m2-09c/`, golden pool-55 and
           pool-167. 193 cards. Mutations 4/4. Review (no wrong results): citations (CR 601.3, 109.5; `later: CR
           613.11`), a named `cantCastSpells` question, the definition check for its subject, 3 more scenarios (the
           non-active player's Silence and a land play, still in the end step, Spellbook in hand), docs. Fuzz 200
           clean. Merged as #54. Next: c2, Act of Treason.
         - c2 plan (2026-11-21): Act of Treason ("gain control of target creature until end of turn. Untap that
           creature. It gains haste until end of turn."). Layer 2 (CR 613.1b) from resolved effects only:
           `gainControl { player }` effects, latest timestamp wins (CR 613.7), read by one helper that both
           `controllerOf` and the layer pass use, from `state.effects`: no card database needed, so no signature change
           yet (static control effects, Auras in M2-12, will need it). A control change resets
           `controlledSinceTurnStart` as it starts and as it ends (CR 302.6: "continuously since their most recent turn
           began"). New ops: `gainControl`, `untap`. Removal from combat on a control change (CR 506.4) can't happen in
           the pool (Act of Treason is a sorcery; its effect ends in cleanup): `later:`.
           Scenarios: steal, untap, attack with haste; control returns in cleanup; a stolen {T} creature (Prodigal
           Pyromancer); targeting your own creature (its ruling); it dies into its owner's graveyard; Polymorph on a
           stolen creature reveals from the thief's library (last known controller, D-096); anthems follow the new
           controller.
         - c2 built (D-098): Act of Treason; 7 scenarios, a unit test of the control change and summoning sickness,
           golden pool-571. 194 cards. Bench ok (91.7 ms). Mutations 4/4 (one after a latest-wins unit test).
           Rules and code reviews (no rules bug): 7 more scenarios (the thief's summoning sickness and the owner's next
           turn, a stolen lord, mana creature and trigger, control through the end step, damage at reversion, Safe
           Passage); `gainControl` can't last "for as long as" (it would end in `moveCard` unrecorded); control changes
           should move to a central check in `advance` with static control effects (M2-12, D-098, future-rules);
           docs, READMEs, citations. Fuzz 200 clean. Merged as #55.
       - **M2-09 done** (2026-11-21): all 24 of its cards, in #50-#55 (194 cards in the pool). Its spec's "dependency
         example from the CR" (CR 613.8) waits for the first card that needs one (Open questions, proceeding with (a)).
         Next: M2-10, counters (CR 122).
       - M2-10 plan (2026-11-21), two PRs. Spec: +1/+1 and -1/-1 counters and their annihilation (CR 704.5q), entering
         with counters, counters leaving with the object (CR 122.2, already: a moved card is a new object with none);
         a creature with both kinds. Cards: Mold Adder, Protean Hydra.
         - M2-10a: counters put and removed as pipeline events (`putCounters`, `removeCounters`; COUNTERS_PUT,
           COUNTERS_REMOVED), so replacements and triggers see them; the effect op `putCounters { of, counter, amount
           }`; SBA 704.5q (a creature with both: remove N of each, N the smaller count); Mold Adder ("whenever an
           opponent casts a blue or black spell, you may put a +1/+1 counter on this creature": one trigger for a spell
           both colors, its ruling). Scenarios: Mold Adder for blue, black, both, not for its controller's or another
           color's spells, resolving before the spell; a creature set up with both kinds annihilating.
         - M2-10b: Protean Hydra: enters with X +1/+1 counters (a replacement, CR 614.1c, `Destination.counters`); "if
           damage would be dealt to it, prevent that damage and remove that many +1/+1 counters" (a prevention whose
           result removes counters, CR 615; all of it prevented even with fewer counters, its ruling); "whenever a +1/+1
           counter is removed from it" triggering once per counter (its ruling); a delayed "put two +1/+1 counters on it
           at the beginning of the next end step" (`about: "self"`, `"remembered"`).
         - Future impact: -1/-1 counters from effects (wither, infect) use the same events; counters on players
           (poison) need a player recipient (future-rules); tokens (M2-11) get counters the same way.
         - M2-10a built (D-099): Mold Adder; counters as pipeline events; the `putCounters` op; CR 704.5q; the
           `.counters` scenario expectation (no expectation is "still to come" now). 3 scenarios, golden pool-665.
           195 cards. Mutations 4/4 (one after a scenario adding to existing counters). Review (no wrong results): a
           creature dying in the batch with CR 704.5q leaves with its counters as before (CR 704.3; `lastKnown` from
           before the batch too); 5 more scenarios (black, declined, the spell countered, a noncreature, more counters),
           unit tests (the clamp, the batch); the SBA renamed `plusAndMinusCounters`; docs (future-rules: poison, who
           puts counters, entering with them, CR 615.5 for the Hydra). Fuzz 200 clean. Merged as #56. Next: M2-10b.
         - M2-10b built (D-100): Protean Hydra; 5 scenarios (entering with X, prevention and the counters back at end
           step, more damage than counters, X of 0 when not cast, the Hydra gone before the end step), golden pool-509.
           196 cards. Mutations 4/4. Review (rules outcomes right): X of 0 gave a 0-count key and a COUNTERS_PUT of 0, now
           none; counters a permanent enters with add up (no overwrite, no extra guard); 12 more scenarios (Fog, Safe
           Passage or the Hydra chosen first, CR 616.1; the -1/-1 ruling; the end-step ruling; dying; trample's lethal
           ignoring prevention, CR 702.19b; a new object after a bounce; no counters; two blockers; X of 0 cast and put).
           Fuzz 200 clean. Merged as #57.
       - **M2-10 done** (2026-11-21): Mold Adder and Protean Hydra, #56 and #57 (196 cards). Next: M2-11, tokens
         (CR 111): Captain of the Watch, Cemetery Reaper, Siege-Gang Commander, Ant Queen, Howl of the Night Pack,
         Gargoyle Castle.
       - **M2-12 done** (2026-11-21): Auras and Equipment, #60 to #65 (218 cards). Next: M2-13, planeswalkers.
       - **M2-13 done** (2026-11-21): planeswalkers, #66 to #71 (223 cards). All five Magic 2010 planeswalkers.
       - M2-14 plan (2026-11-21, D-114, with the advisor's review): 17 special-rules cards (Master of the Wild Hunt set
         aside, D-114), one PR per slice, in this order:
         1. M2-14a "doesn't untap": Sleep, Wall of Frost, Entangling Vines. A duration "during that player's next untap
            step"; "enchant tapped creature" through `canEnchant` (shared with CR 704.5m). Read Vines's rulings.
         2. M2-14b Time Warp (CR 500.7): how the next turn is chosen now; several extra turns' order; Sleep's untap step
            as the extra turn's.
         3. M2-14c Platinum Angel (CR 104.3: conceding still loses; an empty-library draw after she leaves; the fuzz
            invariants) and Magma Phoenix (an ability activated from the graveyard, CR 113.6; resolving after the card
            left it).
         4. M2-14d "As it enters, choose" (CR 614.12): Convincing Mirage (a basic land type, layer 4), then Pithing Needle
            (a card name, CR 201.4; loyalty abilities, equip and Phoenix's graveyard ability stopped, mana abilities not).
         5. M2-14e Sphinx Ambassador: a name chosen by the other player, who mustn't see the searched card (two-worlds).
         6. M2-14f Telepathy and Vampire Nocturnus: revealed information; the library's top card as a layer input
            (shaped like `lifeRead`), with a bench against main.
         7. M2-14g Djinn of Wishes: playing a card while an ability resolves, without paying its mana cost (X, additional
            costs, the land-play limit).
         8. M2-14h Twincast, then Hive Mind: copies of spells (CR 707.10), a stack object that isn't a card.
         9. M2-14i Clone: copy effects in layer 1 (CR 707.2), "as it enters" again; copying a token decided first.
         10. M2-14j Mirror of Fate; 11. M2-14k Warp World (every "as it enters" choice at once); 12. the three final decks,
             golden cover and the interaction matrix.
         - Future impact: durations tied to a player's untap step are the shape for "next turn" effects; the extra-turn
           queue is where "skip your next turn" goes; the name choice serves Meddling Mage-likes; spell copies need
           `StackObject` not to assume a card, which also serves storm and casualty later.
       - M2-14f plan (2026-11-21, with the advisor's review): Telepathy ("your opponents play with their hands
         revealed") and Vampire Nocturnus ("play with the top card of your library revealed"; +2/+1 and flying to it and
         other Vampires you control while that card is black). CR 401.5, 401.6, 701.18c, 701.20a, 400.2.
         1. Statics `opponentsPlayWithHandsRevealed`, `playWithTopOfLibraryRevealed`, read through the layer pass (a
            stolen Nocturnus reveals its new controller's library) in `rules/revealed.ts`.
         2. The view shows revealed cards by identity only, sorted (D-062): `revealedHand: OracleId[] | null` and
            `revealedTop: OracleId | null` per player; `objects`, `hand` and `canSee` unchanged (ids record history, and a
            shuffle keeps them). `playerView` takes `cards`; the CLI's `show` too.
         3. Each new revealed top is announced with a public `CARDS_REVEALED` (its ruling: each card of a multi-draw
            is revealed before it's drawn; the rules review: also between a search and its shuffle).
         4. `creaturesGet` gains `self` ("this creature and other ...") and `asLongAs: { topOfLibrary: filter }`; the
            library tops join the layer inputs, compared by value only if the pass read one (like `lifeRead`), as a
            shuffle changes the top without a new objects record. The top's printed characteristics.
         5. The fuzzer's `scrambleHidden` keeps a revealed top on top and revealed cards' oracle ids.
         6. Scenarios: both reveals, an empty library, a land on top, a non-Vampire Nocturnus, flying after blockers,
            two Nocturni, a stolen one, a shuffle (Sage Owl/Liliana) changing the top, Divination's draws revealed. Bench.
         - Later, not in the pool: CR 401.5's mid-cast delay, CR 401.6's new object (no id is shown, so nothing tracks it).
           (The plan first said no pool card reveals a top only for a moment; the rules review found Diabolic Tutor does.)
         - Future impact: per-player knowledge (a looked-at card, face-down cards) extends the same view fields.
       - M2-14h plan (2026-11-21), two PRs: copies of spells (CR 707.10). Twincast ("Copy target instant or sorcery
         spell. You may choose new targets for the copy."), then Hive Mind ("Whenever a player casts an instant or
         sorcery spell, each other player copies that spell. Each of those players may choose new targets for their
         copy."). CR 707.2, 707.10, 707.10a/c, 704.5e, 115.7d-f, 601.2c, 608.2b.
         1. M2-14h1: a spell copy is a card object on the stack marked `copy` (CR 707.10: a spell, no card), with the
            original's oracle id and choices (targets, X, division; modes later), controlled and owned by who put it
            there; never cast (no SPELL_CAST: "whenever you cast" doesn't see it). A new pipeline event `copySpell`
            (SPELL_COPIED). Out of the stack it ceases to exist: the move keeps `copy`, and SBA CR 704.5e removes it.
         2. "You may choose new targets": before the copy is put on the stack (CR 707.10c), its controller is asked for
            each target in turn: keep it (even if illegal) or a new legal one (CR 115.7d); the division stays (CR
            115.7f), and so does the number of targets.
         3. M2-14h2: Hive Mind, the same op for each other player in APNAP order, its trigger on casting.
         - Scenarios: Twincast on Lightning Bolt (same target, a new one, an illegal one kept), on Fireball (X and the
           division kept), on Divination (no targets; "you" is the copy's controller), on a spell that's countered,
           the copy countered (ceases to exist, not in a graveyard), a copy of a copy, Cancel on the copy; Hive Mind
           with a burn spell (both copies), not triggering on copies.
         - Found (D-080): Hive Mind still copies a spell countered in response, from its last known information (judge
           forum apps.magicjudges.org/forum/topic/8094; TappedOut), so the op copies from a snapshot (oracle id and
           choices), not only a live stack object. A copy's targets "become the target" of the copy, a new spell, kept or
           new ones (judge forum apps.magicjudges.org/forum/post/65270): Illusionary Servant triggers. The copy goes on
           the stack first and its new targets are chosen with it as the source (its color for protection, its
           controller, not itself), the same as choosing first (CR 707.10c) as nothing can happen between.
           Scenarios name a copy "Lightning Bolt copy".
         - Future impact: a copy of an ability (CR 707.10b) and a permanent spell copy becoming a token (CR 707.10f)
           reuse the flag; Clone (M2-14i) copies permanents in layer 1, not this.
       - M2-14g plan (2026-11-21): Djinn of Wishes ("enters with three wish counters"; "{2}{U}{U}, Remove a wish counter:
         Reveal the top card of your library. You may play that card without paying its mana cost. If you don't, exile
         it."). CR 608.2g (cast during resolution, no priority after), 118.9 (alternative cost; 118.9d increases still
         apply: Fireball), 107.3b (X is 0), 305.2/305.3/305.9 (land plays), 601.3 (Silence), 118.3 (removing counters).
         1. Cost `{ kind: "removeCounters", counter, amount }`, checked as it's activated (CR 118.3), paid with the rest.
         2. Op `mayPlay { of: "found", withoutPayingManaCost }`: a yes/no only if it can be played (a land: your turn, a
            land play left; a spell: not forbidden, targets exist); yes plays a land (a `playLand` from the library) or
            starts a cast from the library (`Casting.origin` "resolution": no mana cost, X = 0, no priority after; a cancel
            puts it back on top). Then `exile` of `found` does nothing to a card played (a new object).
         3. Scenarios: a creature, a land (your turn, none played / one played / on the opponent's turn), an instant with
            targets, a sorcery on the opponent's turn, Fireball (X 0, the increase paid), declined and cancelled (exiled),
            Silence, no wish counters left, three activations, Nocturnus's revealed top.
         - Future impact: casting during resolution is what cascade and "cast copies" need; Twincast/Hive Mind (M2-14h)
           don't cast. The free cast is an alternative cost (CR 118.9a: one at a time).
       - M2-14i plan (2026-11-22): Clone ("You may have this creature enter as a copy of any creature on the
         battlefield."). CR 707.2, 707.2c, 707.3, 707.5, 613.2a (layer 1), 614.1c, 614.12, 614.12a, 704.5f. D-126:
         a general block, not a Clone one: "enters as a copy" is a replacement kind any clone-like card reuses.
         1. Layer 1: `CardObject.copied?: { oracleId; token? }`, the copiable values it took as it entered (fixed,
            CR 707.2c): the chosen permanent's own `copied` if it has one (CR 707.3), else its oracle id (and a token's
            data, its rulings). `cardDataOf` reads `copied` first, so every printed value, keyword, static, trigger,
            activated and mana ability and replacement follows (all lookups go through it, a test checks). Abilities
            put on the stack name the copied text (`sourceOracleId`). Never copied: tapped, counters, attachments,
            controller, non-copy effects (CR 707.2). Not a token if it copies one (`token` stays the object's own).
         2. Replacement kind `entersAsCopy { of: ObjectFilter }` (CR 614.1c): as it enters, its controller chooses
            one permanent of `of` already on the battlefield, or none (the choice, CR 614.12a; one entering with it
            can't be chosen, its ruling); kept on the move as `copied`, like `chosenLandType`. The choice generalizes
            `chooseCards` (purpose "copy", min 0, max 1) to answer an "as it enters" choice, as `chooseName` does.
         3. CR 614.12/707.5: once the copy is chosen, the replacements that apply are the copied text's ("enters
            with": Protean Hydra's X is 0, its ruling), and its enters triggers trigger.
         4. Scenarios (rulings): copy a creature (P/T, name, abilities); choose none (0/0, dies, CR 704.5f); a token
            (copies the token's values, not a token); counters, tapped, Giant Growth, an Aura, Act of Treason not copied;
            doesn't target (a shroud creature); an enters trigger (Elvish Visionary); Protean Hydra 0/0; a Clone of a
            Clone; an activated and a mana ability; Pithing Needle naming the copied name; the legend rule if any pool
            legend; Clone leaving is Clone again in the graveyard; a CDA (Ajani's Avatar token).
         - Future impact: "becomes a copy" (CR 707.4, a continuous effect with a duration) goes in `state.effects`, and
           `cardDataOf` then takes the state (one signature, every lookup already there); token copies (CR 707.8a) set
           `copied` on the token; "except ..." (CR 707.9) is a field on `entersAsCopy`.
       - M2-14j plan (2026-11-22): Mirror of Fate ("{T}, Sacrifice this artifact: Choose up to seven face-up exiled
         cards you own. Exile all the cards from your library, then put the chosen cards on top of your library.").
         CR 401.4, 406.3, 108.3, 608.2d, 602.2. D-126, all general blocks:
         1. `ObjectFilter.owner: "you"` ("you own", CR 108.3), next to `controller`.
         2. Op `choose { from: "exile", filter, upTo }`: the controller chooses up to N cards there as it resolves
            (CR 608.2d; the ruling: chosen on resolution, however they got there), kept as `found` for the effects after
            it, like a search's. Every exiled card is face up (CR 406.3; exiling face down, later).
         3. `exileGraveyard` generalized to `exileAll { zone: "graveyard" | "library", of, filter? }` (Haunting Echoes
            unchanged in meaning), its cards exiled this way kept as before.
         4. `put` into `libraryTop` of several cards: their owner arranges them (CR 401.4), a `chooseCards` "putOnTop"
            decision, and the order isn't revealed: the cards move in shown order, then the top is reordered (no event).
         5. Scenarios: choose some, none, more than seven offered, an opponent's exiled card not offered, the order
            (top first), cards exiled from the library this way not choosable, the library empty then (a draw loses
            later), Haunting Echoes still working; the hidden order in the fuzz (two worlds).
         - Future impact: `choose` serves "choose a card in a graveyard" without targets; `exileAll` any zone; CR 401.4
           for the bottom (later) goes in the same place.
       - M2-14k plan (2026-11-22): Warp World (its rulings give the steps: count the permanents each player owns,
         shuffle them in, reveal that many cards, artifacts/creatures/lands onto the battlefield at once, then
         enchantments at once (Auras choose hosts among those, APNAP), the rest on the bottom in any order). CR 401.4,
         701.24a, 701.20a, 608.2c/d, 303.4f/g, 614.12a, 111.7, 101.4. D-126, mostly generalized blocks:
         1. New op `shuffleIntoLibraries { filter }`: every permanent fitting it goes to its owner's library at once,
            each player then shuffles (CR 701.24a); how many each player owned is kept (`Resolution.shuffledIn`; tokens
            count, its ruling).
         2. `revealTop` takes `who: "eachPlayer"` and `count: "shuffledIn"`: each reveals that many cards (tokens
            aren't cards, its ruling), all `found`.
         3. `returnAllToBattlefield` takes `from: "found"` as well as all graveyards: the cards found that fit, under
            their owners, Auras choosing hosts already on the battlefield (APNAP, CR 101.4), as for Open the Vaults.
            An Aura choosing while still in a library: the decision's `for`, and `AURA_HOST_CHOSEN`, show it by identity,
            not by its library id (D-062): the view's `for` becomes a shown option, as options are, and the fuzz
            scramble keeps what a viewer's own decision is for.
         4. `put` of several cards on the bottom of a library (CR 401.4): each owner arranges theirs, unrevealed, in
            APNAP order; cards already in that library are reordered, not moved (CR 400.7); `reorderLibrary` gains a
            bottom.
         5. Scenarios: the basic swap; tokens counted but not revealed; an instant to the bottom; an Aura onto a
            creature put in step 4, or to the bottom with nothing to enchant; a checkland entering tapped; Clone with
            nothing to copy; Pithing Needle naming; two players' Auras in APNAP order; enters triggers waiting until it
            finishes (its ruling); a stolen permanent going to its owner's library; an empty library.
         - Future impact: `shuffleIntoLibraries` is "shuffle into its owner's library" for any filter; the bottom
           arranging serves "put the rest on the bottom in any order" cards.
         - Advisor review of the plan: (a) tokens move with the rest but cease to exist in the same batch (its ruling: "you
           shouldn't actually shuffle them in"), so no token sits in a library while decisions wait (Nocturnus, views);
           (b) hidden ids, one commit first: decisions keep real ids and the view shows what they're for by identity
           (chooseCards' and chooseName's `for`, as options are; Clone's `for: null` reverted to this), events emitted
           before a card leaves a hidden zone (NAME_CHOSEN, OBJECTS_CHOSEN, AURA_HOST_CHOSEN) carry no id from it;
           (c) count before moving (a stolen permanent counts for its owner; none still shuffles); cards move out of a
           library in shown order per owner, APNAP across owners; (d) the fuzz rarely casts it: run the fuzz checks
           over every step of the m2-14k scenarios, and two-worlds tests for the bottom order and Aura hosts;
           (e) more scenarios: Clone revealed with a creature (options []), Entangling Vines to the bottom, a
           planeswalker card to the bottom, Mind Control on a step-4 creature, two Auras of one player, Hive Mind and
           Twincast copying it.
       - M2-15 plan (2026-11-22), hardening (m2-rules-depth.md), one PR per slice:
         1. M2-15a `pnpm fuzz --games 10000` clean, with the pool's decks and random decks (exit criterion); failures
            fixed as bugs (fix-bug skill), each with a scenario.
         2. M2-15b mutation testing with StrykerJS and its Vitest runner (testing.md, section 7): a dev dependency (a
            decision entry), a `pnpm mutate` script, run on the engine's rules code in parts (rules/, pipeline/,
            effects/, game/, combat/, triggers/...) since a whole run is hours; surviving mutants in rules code get
            tests, the rest are listed with why they survive (equivalent mutants).
         3. M2-15c the CR progress report for the owner, chapter by chapter: which rules are implemented and tested,
            from the coverage report's data (`docs/coverage/`).
         4. M2-15d the D-126 review: effect ops, statics and replacement kinds only one card uses, merged or generalized
            into building blocks where they're the same idea, and what stays one-off recorded with why.
         5. Bench against the budgets: done (D-133, ok on this machine).
         - M2-15d survey (2026-11-22): of 54 effect ops 19 have one card, of 23 statics 18, of 10 replacement kinds 7, of
           17 triggers 12. Most are general rules ideas kept as they are. Behaviour-neutral merges to do, in order:
           (1) destroyAll into destroy of each; (2) asEntersChooseName and asEntersChooseBasicLandType into
           asEntersChoose with a `what`; (3) the four attached restriction statics into attachedRestricts with a list;
           (4) ifNothingSacrificed and ifActivatedThisTurn into one `if` with a condition; (5) the two revealed-zone
           statics into playWithRevealed; (6) the two becomes-the-target triggers into one with `of`, and
           selfBlocksOrBlocked into selfBlocks with a flag; (7) mayShuffle into shuffle with `optional`. Not now, as they
           change play or need more first: Elvish Piper and Capricious Efreet through `choose`, putOnTopOfLibrary into
           `put` (tokens in `put` first), the prevention kinds into one (low value). One-off and kept, with why: Relentless
           Rats' and Coat of Arms' counts (relative to the creature affected), Warp World's shuffle count, Stone Giant's
           toughness-below-power target. Each merge renames a mechanic key, so golden cover's list changes; saved
           mid-resolution states would break (ENGINE_VERSION 0, acceptable before release).
         - M2-15f (owner, 2026-11-22): the CLI output should be readable and detailed enough that an AI agent playing
           through the CLI has everything it needs to choose the best action. The owner chose all five parts, read from
           the engine's per-player view only (no rules change, nothing hidden leaks):
           1. one command per decision (`brief --as pN`): board, stack, hands as that player sees them, what happened
              since they last acted, and the legal actions;
           2. per object: current P/T and what changed it, tapped, summoning sick, damage, counters, keywords (granted
              too), attachments, controller if not the owner; Oracle text with `--text` (or a `card <name>` lookup); each
              stack object's controller, targets and X;
           3. actions with their cost and whether it's payable now, legal targets, possible attackers and blocks, repeats
              folded ("play Plains (x3)"), combat assignments shown;
           4. public zones (graveyards, exile, revealed cards, library and hand sizes), untapped mana sources, mana pool,
              land played this turn, step and next step;
           5. `--json`: the player's view, legal actions and recent events, for programs.
           Do it before the owner's CLI spot-check (an M2 exit criterion), after the pause.
           Next for `brief` (owner, 2026-11-22, for LLM opponents and people alike): the viewer's own decklist and what's
           left in their library (decklist minus their visible cards; counts only, never the order: the list doesn't
           predict a shuffle, the seed does), and the cards each opponent has shown this game. A short game-plan note
           per prebuilt deck. Not started; moved to M3-02b (D-142).
           Plan (2026-11-22), two PRs:
           - f1: `brief <file> --as pN [--text] [--json]`, built as data (`cli/src/brief/`) from `playerView`, the
             viewer's `eventsFor` events since their last action, and their own legal actions only (another player's
             pending decision shows as "waiting for"), plus each public object's characteristics, which the host (here
             the CLI) computes from full state as M3's match host will. The text is rendered from that data, so text
             and JSON can't disagree. Parts 1, 2, 4, 5. Test first: two worlds that differ only in hidden cards give
             byte-identical `brief` output, text and JSON, over the m2-14 scenarios.
           - f2: action detail (part 3): cost and a "payable now" hint (`autoPay`, labelled a hint: X and per-target
             increases aren't known yet), legal targets, attack and block candidates, folded repeats that keep a real
             action number for `do`.
           - f1 built (D-135): `brief` with `--text` and `--json`; leak test over five scenario folders.
           - f2 built: each action's cost, a "not enough mana now" hint (`autoPay`, X as 0), its legal targets (the
             engine's `legalTargets`), same-text actions on one line keeping every number, mana abilities on one line.
             Attackers and blockers were already one action each. `--text` replaced the `card <name>` idea.
           - Left out of parts 2 and 4, as `brief` covers the need otherwise: "what changed a P/T" (`inspect` explains
             it) and a list of untapped mana sources (the `mana available` count, and each land's tapped status).
           - Review fixes: the next step is the engine's (`nextStep`, skipped steps passed over); actions numbered by
             `numberedActions`; only `view.objects` described; recent-event tests; the leak test covers seven folders.
           - `show` keeps its stable format. Future impact: M3's match host sends the same characteristics with the
             view; record that as a decision.
         - M2-15b in progress (D-139): `pnpm mutate` works (Stryker 10.1.1; the tsconfig step skipped for TypeScript 7;
           the runner plugin named; workspace packages aliased inside the sandbox, without which the scenarios tested
           the unmutated engine). Per folder: run, then triage survivors: real gaps get a test, equivalent mutants
           (guards that only save work, `?.` on what two-player games never leave missing, error-message text) are
           left with a note. combat/: 70.5% before the alias fix (unit tests only), 88.6% with it; tests added in
           `test/combat/combat-edges.test.ts` for an illegal attack answer, a pump not being an attack requirement,
           out-of-range damage division, and no 0-damage event (CR 120.8). Scores (killed of all mutants): combat 89.1%,
           pipeline 79.5%, effects 82.3%, triggers 87.2%; rules/ (two halves), game/ and the small folders to run.
           Triage finding (2026-11-22): checked by hand, the survivors are mostly equivalent: a check the code makes
           twice (an earlier filter already rules the case out), `?? []` and null guards for states that can't happen,
           `case` labels of exhaustive switches, error-message text. Partial-condition mutants (`false || x`) are
           usually covered by the rest of the condition. Real gaps found so far got tests (combat-edges, and negative
           scenarios in `cards/m2-15b/`). The rest are left, not chased line by line: the scenario suite catches real
           rule changes (e.g. disabling "attacks each combat" or a step trigger fails dozens of scenarios).
         - M2 exit review by `rules-judge` (2026-11-22), three parts: triggers and replacements, and layers, found no
           rule broken (stale "later" marks fixed, negative scenarios added in `cards/m2-15b/`, notes in
           future-rules.md); costs and combat found one wrong result pool cards could reach (two tramplers on one
           blocker with deathtouch, fixed: deathtouch tramplers first) and an X so large it crashed the engine (capped
           at 10,000). Done.
         - M2-15b done. Mutation scores (killed of all mutants), the whole engine: combat 89.1%, triggers 87.2%, game/
           a-k 83.9% and l-z 87.5%, effects 82.3%, rules/ a-k 81.3% and l-z 74.8%, pipeline 79.5%, mana/zones/
           permanents/view/rng 79.1%. The survivors checked by hand were nearly all equivalent (see the triage finding
           above); the real gaps got tests. Reports aren't kept (`reports/` is gitignored); rerun a folder with
           `pnpm mutate --mutate "<glob>"` (a comma-separated list works; a brace glob ran no tests).
         - M2-15f merged (#90). M2-15a, the 10k fuzz: the single run hit the 2-hour background limit, so it runs in
           chunks of 2,000: seeds 100000–109999, 10,000 games, 0 failed (2026-11-22). M2-15a done.
         - Resume (owner, 2026-11-22): continue automatically at 12:05 p.m. US Eastern that day (a scheduled task is
           set): M2-15b mutation testing, then the rest of M2 and the planned `brief` additions.
         - PAUSED (owner, 2026-11-22): after the 10k fuzz (M2-15a) finishes, record its result and stop until the owner
           says go (their usage resets the next day at noon). Next after that: M2-15b mutation testing.
         - M2-15d done (D-134): the seven merges above, behaviour-neutral (every scenario and golden game unchanged).
         - M2-15c done: the coverage report (`docs/coverage/rules-coverage.md`) ends with a "By chapter" table, generated
           with it: 1xx 26%, 2xx 18%, 3xx 18%, 4xx 22%, 5xx 42%, 6xx 35%, 7xx 7% (mostly keywords outside the pool),
           8xx and 9xx 0%, of each chapter's rules cited and tested.
         Then the exit criteria: rules-judge review of each system, the owner's CLI spot-check, the M3 spec revised.
       - Owner request (2026-11-22), after M2-14l merges: clean up the READMEs so nothing in them is irrelevant for a
         public repo, and add a straightforward guide to playing games with the CLI. The owner chose MIT and dropped the private starter text
         (D-132). Done: the README rewritten for a public repo (what it is, status, getting
         started, a step-by-step CLI game guide checked against a real game, commands, docs, license), `LICENSE` (MIT),
         `"license": "MIT"` in every package.json, two package READMEs no longer name Claude Code. The Fan Content
         Policy notice uses its standard wording; the policy page couldn't be fetched from here, so the owner checks it.
       - M2-14l plan (2026-11-22): the three final decks (m2-pool.md, "Prebuilt decks"). White Soldiers is new (Elite
         Vanguard, Captain of the Watch, Veteran Armorsmith and Swordsmith, Rhox Pikemaster, Honor of the Pure, Pacifism,
         Ajani Goldmane...); Red-Green Beats gains Overrun, Garruk Wildspeaker, Siege-Gang Commander and Howl of the
         Night Pack; Blue-Black Control gains Cancel, Wall of Bone, Jace Beleren and Liliana Vess. The fuzzer's prebuilt
         pairs add White Soldiers against each; the golden games from these decks are replayed or regenerated, and one
         White Soldiers game added. The interaction matrix already has no open cells and the golden games already run
         every mechanic in the pool (D-082), so "between them every mechanic appears" is met by the golden set, not by
         three 40-card decks (Warp World, Mirror of Fate and the like have no place in them).
       - M2-14l built (2026-11-22): the three final decks in `packages/cards/src/decks/index.ts` (White Soldiers new;
         Red-Green Beats with Garruk, Overrun, Siege-Gang Commander, Howl of the Night Pack; Blue-Black Control with Jace,
         Liliana, Wall of Bone, Cancel). The fuzzer's prebuilt pairs now include White Soldiers against each of the others;
         golden game white-soldiers-vs-red-green-beats-7 added (White Soldiers wins on turn 39); the older golden games keep
         their own setups, so they replay unchanged. Interaction matrix: no open cells. Code review: Blue-Black Control's
         lands were backwards (now 6 Island, 9 Swamp); a deck spec test (cards, colors, four-copy limit); the fuzzer
         plays all six Magic 2010 pairings in both seats (D-131); docs. PR #86.
       - M2-14k built (2026-11-22, D-129, D-130): Warp World (240 cards, every M2 card but the two set aside). First a
         separate commit: a card entering from a hidden zone is shown by identity, not id (D-129). Then
         `shuffleIntoLibraries`, `revealTop` for each player, `returnAllToBattlefield` from `found`, `put` into libraries
         for several owners and the bottom (CR 401.4, 400.7), `reorderLibrary.bottom`. 11 scenarios (the swap, tokens,
         a stolen permanent, an Aura auto and chosen, Vines with nothing to enchant, a checkland, Clone with nothing to
         copy, triggers waiting, a planeswalker to the bottom, Mind Control). Fuzz checks on every scenario state. Golden
         games regenerated (Lurking Predators' bottom is a reorder now). Fuzz clean, bench within noise (randomGame
         115 ms, the open budget question). Rules review: every ruling right; one regression, Lurking Predators putting
         its revealed card on the bottom told no one (CR 701.20a): `PUT_ON_LIBRARY_BOTTOM` (a count, no ids). 17
         scenarios from it (triggers held and APNAP, no SBA mid-way, two Needles, Mirage, Auras and enchantments entering
         together, both owners' bottoms, Platinum Angel, Twincast and Hive Mind copying it, a stolen token, protection,
         shroud, owning nothing). Noted, following Warp World's ruling 5: every Aura host is announced (APNAP) before the
         choices made as cards enter (a Mirage's land type comes after the other player's host). PR #85.
         Code review applied: scenarios for Warp World's last clause (a revealed leftover under an
         unrevealed card) and a token never revealed (an Aura pending); the scenario fuzz checks get each step's events;
         a chooseName view test; throw on an order answered for no owner; `renamed` an exhaustive switch;
         `shuffleIntoLibraries { of: EffectSubject }`; definition checks for `count: "shuffledIn"` and `from: "found"`;
         one `ownerOf`; `card` on NAME_CHOSEN/OBJECTS_CHOSEN; `reorderLibraryTop` renamed; stale READMEs/future-rules.
       - M2-14j built (2026-11-22, D-128): Mirror of Fate (239 cards): `owner` filter, the `choose` op, `exileAll`,
         CR 401.4 for several cards put on top. 5 scenarios (two chosen and ordered; none, then a draw loses; only
         yours, none asked; one card, no order asked; seven of eight). 1 golden game. Fuzz clean. Rules review: no wrong
         game state; under Vampire Nocturnus a card that was never on top was revealed, as the moves and the arranging
         were two events: now one batch, the reorder naming cards by their ids before it (`renamed` in perform.ts). 9
         scenarios from it (owner not controller both ways, three ordered, two Mirrors, Djinn's exiled card, a token,
         Nocturnus twice, all seven), a unit test that the order is secret, a "choose" purpose for the selection step,
         citations fixed. Code review: the same order gap (the unit test kills both leak mutants); `choose` loses its
         `purpose` field (its decision is always "choose") and reads its zone through a switch; copies of one card put on
         top aren't ordered (a scenario); clearer throws; `remember` in its own file, also used by `return-all.ts`;
         docs. PR #84.
       - M2-14i built (2026-11-22, D-127): Clone (238 cards): the `entersAsCopy` replacement, `CardObject.copied` read
         by `cardDataOf` (layer 1), `textOracleId` for abilities, `chooseCards` resuming an event, `OBJECTS_CHOSEN`, `put`
         through `happenOrAsk`. 17 scenarios (copies Bears; none; no creature; a token; Giant Growth and an Aura not
         copied; shroud; Elvish Visionary's trigger; Protean Hydra 0/0; Pyromancer's ability; Llanowar Elves' mana; a
         Clone of a Clone; dies as Clone with Magma Phoenix's trigger; the original leaving; Pithing Needle; an
         animated Forest copied as a land; Rise from the Grave; Mind Control). 1 golden game. Bench: within noise.
         Fuzz found a leak: a Clone put onto the battlefield from a library (Sphinx Ambassador) was named in the copy
         choice by its library id (D-062); now `for` (and `OBJECTS_CHOSEN.object`) is null from a hidden zone, with a
         scenario. Rules review: Elvish Piper's Clone crashed (`putOntoBattlefieldFromHand` now `happenOrAsk`); 9 scenarios
         from it (Piper, Djinn's wish counters copied, a Clone of an uncopied Clone choosing again, CR 614.5 stopping a
         second pick, last known colour, Darksteel Colossus, Soul Warden twice, Protean Hydra's prevention); CR 614.5 and
         707.9e cited; the Mirage/CR 305.7 case in Known issues. Code review: the same Piper crash and leak; two
         surviving mutants killed (no-creature options `[]`, DAMAGE_PREVENTED `by` the copied card); copy options shown by
         the copied card (`oracleIdOf`); a guard test on raw `.oracleId` reads; `AsEntersAnswer` shared by both answers,
         `asEntersCopy` its own choice kind, `copiableData`; the CLI tells copies apart. Not built from the plan: legend
         rule (no pool legend) and Ajani's Avatar token scenarios (the rules review ran the Avatar: it passes). PR #83.
       - M2-14h2 built (2026-11-22, D-125): Hive Mind (237 cards): `copySpell`'s `by: "eachOtherPlayer"`, one
         `copySpellFor` work item per copier in turn order, a spell leaving the stack kept in `lastKnown` (CR 608.2h) so
         one countered in response is still copied. 5 scenarios (Bolt copied and pointed back, its controller casting,
         Earthquake's X, a copy of Silence silencing its own controller's opponent, a spell countered in response). No
         new golden game (its mechanics were covered). Fuzz clean. Rules review: no wrong ruling; 11 scenarios from it
         (two Hive Minds, Time Warp, Djinn, a creature spell, Duress kept and retargeted, destroyed in response, Earthquake
         countered, a silenced player copying, Twincast, Howl), a unit test of three players' order, the shared
         `apnapOrder`, a card check that "each other player" is only in a spell-cast trigger, the copy triggers' rulings
         in D-125. Code review: the same, plus stale docs. PR #82; next: merge, then M2-14i Clone.
       - M2-14h1 built (2026-11-21, D-125): Twincast (236 cards): the `copy` flag, the `copySpell` pipeline event and op,
         SBA CR 704.5e, the `chooseNewTarget` decision (keep or a new legal target, the share moving with it), a
         copy's targets becoming its targets (Illusionary Servant). 10 scenarios (Bolt kept and retargeted, the
         opponent's spell, Divination's "you", a copy countered, the division, Servant, Cancel on the Cancel it copies,
         a copy of a copy, an illegal target kept). 1 golden game. Rules review: one wrong ruling, new targets couldn't
         be swapped (CR 115.7e judges only the final set), and shares moved by target, not place; fixed, with a
         start over on a final set naming one object twice; BECAME_TARGET skips a target gone and cites D-125; copies
         left out of graveyard card targets; 17 scenarios from it (shroud, protection, Fireball, Earthquake, owner,
         Dragon's Claw, Duress, Seismic Strike, Servant kept and not targeted, the original countered, Cancel copying
         itself, not cast). Code review: no bug beyond that; a fuzz invariant for a copy outside the stack, its cease
         event hidden like a token's from a hidden zone, the log naming a copy's moves, the current target no longer
         offered beside "keep", docs. Merged as #81.
       - M2-14g built (2026-11-21, D-124): Djinn of Wishes (235 cards): the `removeCounters` cost, `entersWithCounters`
         with a fixed number, the `mayPlayWithoutPaying` op and a cast during resolution (`Casting.origin` "resolution": X 0, only
         cost increases paid, no priority after, a cancel back to the library); CR 401.5's casting delay built
         (`Casting.libraryTops`), as Djinn casting the top card with Nocturnus out reaches it; `Casting.triggersBefore`
         for a cancel mid-resolution. 13 scenarios (a creature, declined, no counters and entering with three, a land
         played and refused, the opponent's turn, targets, cancelled, Fireball's increase, Silence, a cast trigger, two
         with Nocturnus); mutants: both halves of the delay caught. 1 golden game. Rules review: one wrong ruling, a
         cancelled free cast exiled the card; it now returns to the "you may play" choice (CR 601.2, 734.1-734.2); 11
         scenarios from it, citations fixed. Code review: no bug; a fuzz check for a held-back top (the scramble keeps
         it), the library card kept aside counted hidden, `legalActions` tested at 0 wish counters, `cancelCasting` moved
         to `cancel-casting.ts` with one restore, `beginCast` shared, the op renamed `mayPlayWithoutPaying`, "free" and
         "no priority after" named apart from the origin, `hasLandPlayLeft` shared, docs. PR #80.
       - M2-14f built (2026-11-21, D-122): Telepathy and Vampire Nocturnus (234 cards). Statics read through the pass
         (`rules/revealed.ts`); the view's `revealedHand`/`revealedTop` by identity only (`playerView` takes `cards`);
         a draw from a revealed top emits `CARDS_REVEALED` first; `creaturesGet` gains `self` and `asLongAs:
         { topOfLibrary }`, the library tops a layer input read through `libraryTopOf` (`read.libraryTops` beside
         `read.life`); `printedStart` moved to `rules/printed-start.ts`; the fuzzer's scramble keeps revealed cards;
         scenario expectations `p2.revealedHand`/`p2.revealedTop` and named cards in `CARDS_REVEALED`; the CLI's `show`
         prints revealed cards. 12 scenarios, unit tests (the pass re-read after a reorder with the same objects, two
         worlds for each reveal, a non-Vampire "this creature and other Vampires"); mutants: the cache key killed by the
         unit test only (a reorder in a scenario always comes with an objects change), `self` by the unit test. 2 golden
         games. Rules review: no wrong result; a top revealed only for a moment within a resolution (Diabolic Tutor
         before its shuffle) was never announced, so every change of a revealed top now emits `CARDS_REVEALED`
         (replacing the reveal before a draw), and Liliana Vess's shuffle-and-put-on-top is one event (CR 701.24b);
         citations made honest (CR 701.20d, 401.6 and the casting delay `later:`); 17 more scenarios. Code review: no
         bug, no stale pass; every characteristic read cost twice as much once a pass read a top (fixed: an identity
         shortcut, `topsFrom`); one battlefield walk for both reveals (`revealedBy`); fuzz tests for the leak check
         with revealed cards (killing the scramble-weakening mutants); the CLI reads reveals from `playerView`, with a
         test; the definition check reads `asLongAs`'s filter and refuses `self` with `others`; docs. Bench within
         noise of main; fuzz 100 clean. Merged as #78. M2-14f done. The bench baseline reset after it (D-123). Next: M2-14g,
         Djinn of Wishes.
       - M2-14e built (2026-11-21, D-121): Sphinx Ambassador (232 cards): `nameCard` at resolution (the `chooseName`
         decision with `answering: resolution`), `Resolution.named`, the `notNamedThisWay` filter. 4 scenarios (a creature
         not named put under your control, the named card left, a noncreature found, declined), a test that the
         naming player's view holds nothing of the found card; mutants 3/3. Rules review: no wrong ruling, but p2 could
         tell from `waitingFor` whether the found card could be put onto the battlefield (asked only for a creature not
         named), against its ruling and D-062; an optional `put` of cards in a hidden zone now asks anyway, with
         `canSayYes` false (only no; yes refused, CR 608.2d), and a two-worlds test proves p2's views match; the
         resolution's `NAME_CHOSEN` cites CR 608.2d, not 101.4b; 5 more scenarios (an empty library, the owner, a stolen
         Sphinx, two Sphinxes, Pithing Needle naming it). Code review: the same leak; `notNamedThisWay` read in `fits`
         (so inside `not` too) through a lazy `FitContext.namedThisWay`; definitions refuse it with no `nameCard` before,
         outside an effect, and `nameCard` by each player; a test that a name decision's view drops `resume` (a
         surviving mutant); `answerName` moved to `game/choose-name.ts`. Merged as #77. M2-14e done. Next: M2-14f.
       - M2-14d2 built (2026-11-21, D-120): Convincing Mirage (231 cards): a basic land type chosen as it enters (the
         `chooseName` decision with `what`), layer 4 setting the enchanted land's type (`rules/land-type.ts`), its rules
         text's abilities lost (`Layered.rulesTextLost`, CR 305.7). 8 scenarios (the choice, a word or nonbasic type
         refused, a Forest made an Island paying {U} and back once the Aura goes, a checkland made a Swamp, Gargoyle
         Castle made a Mountain, swampwalk, Nightmare's count, Awakener Druid's Treefolk staying a Treefolk), unit tests
         for the lost abilities; mutants 3/4 (the land guard unreachable). 1 golden game. Fuzz 80 clean. Rules review:
         no wrong ruling; 13 more scenarios (checklands with a changed land, Awakener Druid's targets, a granted
         keyword kept, two Mirages from Open the Vaults in both APNAP orders, Serpent of the Endless Sea, Terramorphic
         Expanse, two Mirages on one land, swampwalk turned off); land-type statics in timestamp order (CR 613.7); a unit
         test with test cards for the replacements, triggers, keywords and statics lost; exhaustive switches on what is
         chosen; citations trimmed; CR 305.7's copiable effects noted for later. Code review: no invariant broken; the three
         ability readers asked the layer pass for every object, about 13% slower on `applyAction` (bench, alternating
         against main); they now ask only for a card with written abilities of that kind, which recovers it; setup tests
         for `chosenLandType`; stale comments. Merged as #76. M2-14d done. Next: M2-14e, Sphinx Ambassador.
       - M2-14d1 built (2026-11-21, D-119): Pithing Needle (230 cards) and "as it enters, choose a card name": a
         replacement asking through `happenOrAsk` (a `chooseName` decision, kept in the resumed event's choices), the
         name on the permanent, `finishResolving` and Open the Vaults able to wait. 7 scenarios (naming as it enters and
         a loyalty ability stopped, a mana ability allowed and the other not, equip stopped and an unnamed card's
         ability not, the graveyard ability, the Needle leaving, two Needles from Open the Vaults in APNAP order, any
         card's name but not a made-up one); mutants 4/4 after one more step. 1 golden game. Fuzz 80 clean. Rules review: no
         wrong ruling; the second player naming didn't see the first's name (CR 101.4b): a public `NAME_CHOSEN` event
         now; citations (who chooses: CR 614.12's example, 616.1); 4 more scenarios (unnamed cards still work, Terramorphic
         Expanse stopped and Birds not, every copy whoever controls it, Garruk), the token name refused, the Gargoyle
         Castle half of Open the Vaults; setup tests; the CLI shows a chosen name. Code review: the scenario exporter
         dropped a set-up chosen name (fixed, round-trip test); `ReplacementChoice` a union (`first` | `asEnters`, ready for
         Convincing Mirage's land type) and the name applied in `replaceByOwnText` with the others; a `chosenName`
         expectation; `cardNames` in one pass and `isCardName` for checks; stale pipeline docs; future-rules on the paths
         still using `happen`. Merged as #75. Next: M2-14d2, Convincing Mirage.
       - M2-14d plan (2026-11-21, with the advisor's review), two PRs:
         - M2-14d1, Pithing Needle and the "as it enters, choose" mechanism (CR 614.12a): a replacement of its own
           text asks the player it enters under, through `happenOrAsk`'s saved choices (keyed by object and
           replacement, so replacing again doesn't ask twice); the chosen name is kept on the permanent (absent when
           none). Every path that puts one onto the battlefield must be able to pause: resolving a permanent spell
           (`finishResolving`), Open the Vaults. Setup and the scenario format take a chosen name. Needle: a check in
           activation (not mana abilities), names read through characteristics. Scenarios: a loyalty ability, equip,
           Magma Phoenix's graveyard ability, Gargoyle Castle's mana ability allowed and the other not, the Needle
           leaving, two Needles from Open the Vaults (APNAP). (An ability already on the stack can't be reached: the Needle
           enters only at sorcery speed.)
         - M2-14d2, Convincing Mirage: layer 4 setting a land's subtype, its rules-text abilities lost (CR 305.7), one
           flag that `abilitiesOf`, `triggersOf` and `replacementsOf` honor; interaction scenarios (a Forest made an
           Island, a checkland, Gargoyle Castle, swampwalk, Nightmare); bench `abilitiesOf`.
         - Future impact: Clone's "enter as a copy" uses the same choice; Sphinx Ambassador's name choice the same
           answer kind.
       - M2-14c built (2026-11-21, D-118): Platinum Angel and Magma Phoenix (229 cards). `cantLose` stops the zero-life
         and empty-library losses (CR 101.2, 704.5a-b); abilities with `zone: "graveyard"` (CR 113.6m), activated by
         the owner, offered from the graveyard; the first look-back trigger, `selfDies` (CR 603.10a). 10 scenarios
         (Angel: 0 life then the Angel destroyed, an empty-library draw that never counts later, concession, stolen
         both ways; Phoenix: dies, bounced doesn't die, returns from the graveyard only, not from another's graveyard,
         activated twice); mutants 6/6 after two more scenarios. 3 golden games (`golden:cover` also proposed a fourth,
         pool-695, for a decision already covered; left out). Rules review: no wrong ruling; 21 more scenarios (Phoenix
         sacrificed, stolen with lifelink, with Gorgon Flail's deathtouch, returned in response, both sides wrathed, a
         chain, regenerated, exiled, 0 toughness, instant speed, combat trade, two of one player's; Angel: both players
         at 0, a draw without it, it dying in the same check, two Angels, not for the opponent, a later draw, Act of
         Treason's cleanup), 3 unit tests for the empty-library record with the Angel; stale "later:" marks (CR 700.4,
         603.10a), CR 603.3a cited; D-118 corrected on "whenever another creature dies". Fuzz 80 clean. Code review: the
         scenario exporter couldn't replay a graveyard activation (fixed, round-trip test); "dies" no longer asks for a
         creature (CR 700.7, unit test); the activation check looks at where a card is before what it is (a hidden card's
         refusal showed its abilities; test); `leavesTheBattlefield` an exhaustive switch; the short fuzz test's timeout
         120 s (random decks grew with the pool); a cheaper graveyard scan; stale READMEs. Merged as #74. Next: M2-14d,
         "as it enters, choose" (Convincing Mirage, then Pithing Needle).
       - M2-14b built (2026-11-21, D-116): Time Warp (227 cards). `GameState.extraTurns` (the latest first) and
         `regularTurnPlayer` (the turn order's place), `game/extra-turns.ts`, the `extraTurn` op and `EXTRA_TURN_ADDED`
         event. 5 scenarios (on yourself, on an opponent who then also takes their regular turn, two in one turn with the
         latest first, one cast during an extra turn, Sleep's untap step being the extra turn's); mutants 2/2 (first in,
         first out; an extra turn moving the turn order's place). Replays' final-state hashes updated (the two new state
         fields only); 1 golden game. Rules review: no wrong ruling; 10 more scenarios (countered, after turn 1 with its
         draw, "this turn" facts starting again, Sleep's untap step not used by another player's extra turn, back and
         forth, until end of turn ending first, a turn made during an extra turn going before one waiting, Mind Control,
         summoning sickness through an opponent's extra turn, Act of Treason), a unit test for APNAP order (CR 500.7),
         stale "later:" marks and comments; a player leaving the game noted for extra turns (CR 800.4k). Fuzz 60 clean.
         Code review: no bug, the replay hash changes checked (removing the two fields gives the old hashes); the player
         view shows `extraTurns`, `TURN_BEGAN` says whether a turn is extra (one golden log line: "extra turn 20"),
         `nextTurn` throws instead of falling back, architecture.md's state shape, a definition test. Merged as #73 (with
         the parallel fuzzer, D-117). Next: M2-14c, Platinum Angel and Magma Phoenix.
       - M2-14a built (2026-11-21, D-115): Sleep, Wall of Frost, Entangling Vines (226 cards). The untap step in
         `game/untap-step.ts`; `doesntUntap` effects (a player's or "its controller's" next untap step) and the Aura
         static `attachedDoesntUntap`; the `selfBlocks` trigger (CR 509.3b). 9 scenarios (Sleep on an opponent, on
         yourself, a slept creature borrowed by Act of Treason; Wall of Frost, defender, its effect following the
         creature under Mind Control; Vines, its untapped target refused, the Aura falling off once untapped), 2 unit tests
         (another player's untap step, the effect ending on an untapped creature), definition checks; mutants 5/5 after
         the unit test; 2 golden games (they create the effects; neither reaches an untap step that keeps something tapped).
         Rules review: no wrong ruling a pool card reaches; a latent bug fixed (an "its
         controller" effect trimmed to some of its permanents was thrown away, so the rest would stay tapped again a turn
         later; unit test); citations fixed (CR 611.2c doesn't fix a rules effect's objects, the words do; CR 614.10a for
         skipped steps); 7 more scenarios (Wall of Frost gone before the untap step, vigilance attackers tapped later or
         never, Sleep then Mind Control, a creature arriving after Sleep, Vines under Mind Control, the Wall's controller
         stealing the blocked creature), a unit test for one blocker blocking two (CR 509.3b). Vines's second ruling (its
         target untapped in response) waits for an instant-speed untap in the pool. Code review: no invariant broken; the
         same bug; effects chosen by their duration too; the switches given the new kinds; 2 scenarios (the blocked
         creature dying before the untap step, or before the trigger resolves), a definition test (`eachOpponent`); both
         surviving mutants now caught. Fuzz 60 clean. Merged as #72. Next: M2-14b, Time Warp.
       - M2-13c2b built (2026-11-21, D-113): Chandra Nalaar (223 cards), [−X] loyalty costs (X announced, at most her loyalty,
         refused above it), the `eachControlledBy` subject; 8 scenarios (the +1 at a planeswalker, −X, X = 0 using the
         turn, X = all her loyalty, X too big and a cancel, the −8 at a player and at a planeswalker, at herself doing
         nothing). With her, all five planeswalkers are in. Rules review: no wrong ruling; 3 more scenarios (the −8's
         planeswalker bolted in response, at herself at 9, the −X's target gone with the counters still paid), stronger
         assertions, citations trimmed to what's tested, stale docs. Code review: no logic error; 2 scenarios (the −X
         refused after the +1, with a spell on the stack and on the opponent's turn), a unit test (the −8 on a stolen
         planeswalker hits its controller's creatures), definition checks for `eachControlledBy` (in `and`, as damage's
         source, a target that names no player or permanent, a set controller) and [−X] with {X}, stale X comments.
         Fuzz 150 clean (slow: about 10 minutes). Merged as #71.
       - M2-13c2a built (2026-11-21, D-112): Ajani Goldmane (222 cards): tokens with statics and "*", the "yourLifeTotal"
         CDA, life totals in the layer pass only once read (bench equal to main after two fixes: an identity test, then
         a `lifeRead` flag; see the code review below); 4 scenarios (gain life, counters and vigilance, the Avatar growing and shrinking with lethal
         damage, stolen by Mind Control with Giant Growth), a cache unit test; a golden game reaching the legend rule.
         Rules review: no wrong ruling; tests for the off-battlefield life read, the token "*" and statics checks (and
         nested effects), 3 more scenarios (both at no life in one check, life gain saving a damaged Avatar, a creature
         cast after the −1). Code review: no stale-life path found; a scenario where combat damage changes life while
         the objects stay the same (the case the cache exists for: two mutants survived the scenarios); life read only
         through `lifeTotalOf`; the players record's identity kept beside the pass, not in its inputs; tokens from
         delayed triggers checked; the cost recorded honestly (characteristics reads ~12-15% slower, 0.3 µs). Fuzz 180
         clean. Merged as #70. Next: M2-13c2b (Chandra).
       - M2-13c2 plan (2026-11-21, with the advisor's review), two PRs.
         - M2-13c2a, Ajani Goldmane: +1 gain 2 life; −1 a +1/+1 counter on each creature you control, then those gain
           vigilance (the same set, nothing changes between); −6 a white Avatar token whose power and toughness are each
           your life total. Tokens carry `statics` (a characteristic-defining ability, CR 604.3); the CDA reads
           "yourLifeTotal"; life totals join the layer pass's inputs, compared by value so a mana-pool change still reuses
           the pass. Bench `characteristics` and `layers.freshPass` against main. Tests: a life change with the objects
           unchanged updates the Avatar; a mana change reuses the pass; damage marked becomes lethal as life drops; under
           Mind Control it uses the thief's life; counters and Giant Growth on top.
         - M2-13c2b, Chandra Nalaar: −X (X announced, at most her loyalty, CR 606.6 and its ruling: refused, not thrown;
           `xProblem` reads the state); "is a loyalty ability" kept apart from "how many counters"; −8 as one damage event
           to the target and each creature that player, or that planeswalker's controller, controls. Scenarios: X = 0, X =
           all loyalty, X above refused, cancelled at X, −8 at a player and at a planeswalker, the target gone (CR 608.2b).
         - Future impact: other "equal to your life total" CDAs and battles' defense reading the same inputs; −X on other
           planeswalkers; "that player or that planeswalker's controller" for more effects.
       - M2-13c1 built (2026-11-21): Garruk Wildspeaker (untap two target lands, a 3/3 Beast, the overrun) and Liliana
         Vess (discard, search then shuffle then put on top, all creature cards from all graveyards under your control),
         221 cards; `put` into `libraryTop`; `returnAllToBattlefield` learns `under: "owners" | "you"` (the Aura host's
         chooser is the controller-to-be); 6 scenarios in `cards/m2-13c/`. Reviews (D-111): no wrong ruling; putting a
         card on top of its own library was a zone change (a new object, CR 400.7), now a reorder; the controller-to-be
         path tested with a test sorcery and an "enchant creature you control" Aura; 4 more scenarios (one land, an
         opponent's creature unpumped, Elvish Visionary returned under p1, discard with no or one card); docs. Fuzz 100
         clean. Merged as #69. Next: M2-13c2 (Chandra's −X, Ajani's Avatar).
       - M2-13b2 built (2026-11-21, D-110): Jace Beleren (219 cards): printed loyalty through the card pipeline, the intrinsic
         `entersWithLoyalty`, the `loyalty` cost part (CR 606.3, 606.4, 606.6), CR 704.5i, planeswalkers as targets
         (CR 115.4), scenario setup with printed loyalty, `show` with loyalty; 12 scenarios in `cards/m2-13b/` (each
         ability, once per turn, timing, too few counters, the ultimate leaving Jace in the graveyard while it resolves,
         entering, damage and Lava Axe, attacked, attacked then bolted, trampled over, two Jaces); one golden game. Bench
         equal to main (alternating runs). Rules review: no wrong ruling; a loyalty ability is never a mana ability
         (CR 605.1a, latent); citations (CR 115.1, 115.1c, 107.7); 9 more scenarios (a cancelled activation, a second
         Jace both ways, combat and the next turn, lifelink and deathtouch, Fog and Safe Passage, indestructible,
         Earthquake, Hypnotic Specter). Code review: no wrong result; loyalty read in `rules/loyalty.ts`; the loyalty
         check moved to `activationProblem`; setup refuses a planeswalker without loyalty counters; definitions refuse a
         written `entersWithLoyalty`, two loyalty parts, a timing on a loyalty ability; an invariant for CR 704.5i and
         negative counters; a scenario for an unkept Jace with no loyalty (a mutant survived); READMEs; the −X watch-out
         for Chandra in future-rules. Fuzz 200 clean. Merged as #68. Next: M2-13c (Garruk, Liliana, Chandra, Ajani).
       - M2-13b1 built (2026-11-21, D-109): the legend rule (CR 704.5j): `legendRuleGroups`, a `keepLegend` decision asked
         in `givePriority` (APNAP), the check made with the choices (`stateBasedActions`'s `kept`), a permanent leaving
         once if another action removes it too; CLI, scenario `choose:`, exporter; 5 unit tests with test legends (the
         pool has no legendary permanent until Jace). M2-13 is now four PRs (D-109). Reviews: an unkept legend with lethal
         damage was destroyed, so regeneration could save it (now put into the graveyard, CR 614.8); the cleanup step
         skipped the legend rule (now gives priority, CR 514.3a); names now through `characteristics()` (no name shares
         none, CR 201.2a); 9 unit tests (three copies, a stolen legend to its owner's graveyard, refused answers,
         cleanup), scenario and exporter tests with a test legend. Fuzz 100 clean. Merged as #67. Next: M2-13b2.
       - M2-13a built (2026-11-21): `Attack.planeswalker` (optional; left out for an attack on the player), `attackedNow`
         (null once the planeswalker is removed from combat), `Combat.removed.planeswalkers` (present only once one is),
         per-role removal (`removeTypeChangesFromCombat`, a control change through `removedFromCombat`), possible attacks
         list each planeswalker of the defending player, combat damage and trample go to what's attacked now (none to
         the player once the planeswalker is gone, CR 702.19f), damage to a planeswalker removes loyalty (CR 120.3c),
         "attacks [player] if able" isn't obeyed by attacking their planeswalker; CLI, action lines, the scenario
         `attack:` step (`Hill Giant -> Jace Beleren`) and the exporter. Neutral: every scenario, replay and golden game
         unchanged. Reviews (D-108): no wrong result in the pool; regeneration removed an attacked planeswalker from
         combat (CR 701.19a): roles are now named by every caller; damage results read types once per event (a layer
         pass per damaged permanent made a big board's damage ~30x slower); the stored attack is the engine's own (an
         `undefined` could get in); the field renamed `attacked` (battles later); the fuzz control-change check covers
         the attacked role; 13 unit tests (a real control change, a trampler's excess, Alluring Siren's ruling, refused
         attacks), the action-lines round trip. The scenario `->` step and exporter get their scenarios with Jace in
         M2-13b. Fuzz 100 clean. Merged as #66. Next: M2-13b (Jace Beleren; loyalty, loyalty abilities, CR 704.5i, the
         legend rule, planeswalkers as targets).
       - M2-13 plan (2026-11-21, with the advisor's review): planeswalkers, three PRs. The five: Ajani Goldmane, Jace
         Beleren, Liliana Vess, Chandra Nalaar, Garruk Wildspeaker (all "Legendary Planeswalker" in today's Oracle). A
         card enters the pool only when it works completely, attacking included, so the plumbing comes first.
         - M2-13a, no new card: the defender in combat. An attack can be at a planeswalker (CR 506.3, 508.1b): an
           optional field on `Attack` for the attacked planeswalker, read through one helper that returns null once it's
           gone or no longer a planeswalker (like `attachedHost`), so saved hashes and every reader of "the defending
           player" stay as they are. Read CR 506.4 and 508.5 first, and a planeswalker whose controller changes
           mid-combat. Proof it's neutral: every scenario, replay hash and golden log unchanged.
         - M2-13b, the planeswalker, with Jace Beleren (and Garruk Wildspeaker if all its ops exist):
           - The card pipeline carries printed loyalty (`printed.ts` rejects planeswalkers today; CR 209); a
             planeswalker enters with that many loyalty counters (CR 306.5b, an intrinsic replacement like Protean
             Hydra's `entersWithCounters`); a scenario setup puts printed loyalty on by default.
           - Loyalty abilities (CR 606): a loyalty cost part (+N, −N, −X; check U+2212 in the Oracle test; CR 606.4-6);
             sorcery timing and once per turn per permanent (CR 606.3) derived from it, checked in
             `activationBasicsProblem`; check `activationsThisTurn` sums all its loyalty abilities, ignores cancelled
             activations, survives a control change, and starts fresh for a new object.
           - Damage to a planeswalker removes loyalty (CR 120.3c), independent of marking damage on creatures;
             prevention and "deals damage to a player" triggers checked; "any target" and "target player or
             planeswalker" include planeswalkers (CR 115.4); CR 704.5i and the legend rule (CR 704.5j, a decision before
             the batch, CR 704.3; check whether `chooseCards.resume` fits or a custom resume like `chooseReplacement`)
             in the single state-based-action loop, cheap test first; re-baseline the bench here (option a).
           - Attacking a planeswalker: unblocked damage removes loyalty (CR 510.1b); its leaving means no damage
             (CR 506.4c); trample over it (CR 702.19c); the AI chooses defenders.
           - Scenarios first: a cost taking loyalty to 0 still resolves; a second activation in a turn refused; on the
             opponent's turn refused; the attacked planeswalker leaves; trample over one; the legend rule.
         - M2-13c: Liliana Vess (`returnAllToBattlefield` under "you"), Chandra Nalaar (−X; "that player or that
           planeswalker's controller"), Ajani Goldmane (its Avatar is a token with a characteristic-defining ability:
           tokens with abilities threw in M2-11; check the layer pass reads it), Garruk if not in 13b.
         - Future impact: battles (CR 310) are the other permanent with damage as counters and a defender role, so the
           defender helper should grow to them; loyalty abilities on non-planeswalkers (CR 606.2) work the same;
           multiplayer adds several defending players.
       - M2-12d built (2026-11-21, D-107): Open the Vaults (218 cards); `returnAllToBattlefield`, `canEnchant` shared with
         CR 704.5m, `chooseCards.for` and the `enchant` purpose, `Resolution.enchants`, the `AURA_HOST_CHOSEN` event, the
         `.attachedTo` scenario expectation; two golden games. Rules review: no wrong ruling; CR 613.7m now happens (the
         cards move in APNAP order: two Mind Controls on one creature, the nonactive player's wins) and is cited and
         tested; the APNAP scenario couldn't fail (p1 was both active and first seat), now p2 active too; Equipment's
         citation is CR 301.5b, not 303.4h. Code review: the answer is checked against the Aura asked about (throws on
         drift), the choices are cleared after the move, `enchants` renamed `auraHosts`, docs (rules and state READMEs,
         future-rules). 14 scenarios, a CLI test for the decision's `for`; mutants (seat order, no event when only one
         host) now die. The golden game that cast it with nothing to return is dropped. Fuzz 180 clean. Merged as #65.
       - M2-12d plan (2026-11-21, with the advisor's review): Open the Vaults, one PR.
         - Its rulings: an Aura that can return must; its controller-to-be chooses what it enchants as it enters, not
           targeting (shroud and Ice Cage don't matter), but the enchant ability and protection do (CR 303.4f); none
           legal, it stays in the graveyard (CR 303.4g); not something also returning; the active player announces for
           their Auras first, then each other player in turn order (APNAP), then everything enters at once. Equipment
           enters unattached (CR 303.4h for anything else).
         - Effect op `returnAllToBattlefield` (from all graveyards, a filter, under owners' control). The set of cards is
           read again each time the effect runs (nothing else happens while it waits). For each Aura, in APNAP order of
           owners then shown order, its owner chooses a host among battlefield permanents fitting one predicate shared
           with CR 704.5m (enchant filter with the owner as "you", protection); none: it stays; one: no decision (like
           sacrifice, the battlefield is public). The choices go in `state.resolution` (a new field), and an event
           announces each (public, CR 303.4f's choice, so the other players see it). Then one `simultaneous` batch of
           `moveCard`s with `controller: owner` and `attachedTo` for Auras.
         - `chooseCards` learns which object a choice is for (`for`), with a new purpose, so the view and CLI show it.
         - Scenarios first: APNAP, nothing to enchant (Pacifism stays, Ornithopter returns), shroud and Ice Cage hosts,
           protection (White Knight not offered for a black Aura), an opponent's artifact under its owner, a returned
           Mind Control steals a sick creature, Equipment unattached, Soul Warden sees an artifact creature, forced return.
       - M2-12c3 built (2026-11-21, D-106): Soul Bleed (`whose: "attachedController"`), Ice Cage (`attachedCantActivate`,
         `attachedBecomesTarget`), 217 cards; 7 scenarios in `cards/m2-12c3/` (Soul Bleed under Mind Control, a caged
         Pyromancer and Llanowar Elves, the trigger on a Shock, an Aura and an equip, its own spell not triggering it). Rules review: no wrong result; 10 more scenarios from
         its probes (an Aura, a trigger and Naturalize targeting, the trigger's controller, two triggers, a cancelled
         cast, an animated Forest, Soul Bleed after its creature dies and when stolen mid-game); a spell choosing the same
         object twice makes it the target once (unit test); citations fixed. Code review: an exhaustive switch for `whose`,
         a negative scenario (another creature or a player targeted; a mutant survived the suite), docs. Fuzz 80 clean.
         Merged as #64.
       - M2-12c2 built (2026-11-21, D-105): Mind Control, the static `attachedControl` in the pass's layer 2 with timestamp
         order, `anyControlEffects` counting it (215 cards); 10 scenarios in `cards/m2-12c/` (Act of Treason after it and
         before it, two Mind Controls, destroyed while attacking and while blocking, an anthem, Equipment, the Cloak,
         Firebreathing). Rules review: a creature removed from combat as an attacker and returned untapped could
         block but dealt no damage (`Combat.removed` was one list): now kept by role; 12 more scenarios from its probes;
         a unit test for a resolved control effect earlier than Mind Control. Code review: `layerTwo` built every
         permanent's controller on every board (the pass a quarter slower): it returns nothing without a control effect;
         an Aura's "you" is plain data; the rationale for reading the static from printed text corrected (layer 6 is after
         layer 2), with a future-rules watch-out; the anthem scenario made uneven; a unit test of the cache. Bench equal to
         or faster than the base. Fuzz 80 clean. Merged as #63. Next: M2-12c3 (Soul Bleed, Ice Cage).
       - M2-12c1 built (2026-11-21, D-104): `controllerOf(state, id, cards)` (56 calls in 31 files), layer 2 only in the
         pass, the control-change check in `advance` (CR 302.6, 506.4), the `controlChangesRecorded` fuzz check. Every
         scenario, replay and golden game unchanged. Code review: the check after every piece of work and `controllerOf`
         asking for the pass cost deepStack a fifth to a quarter (measured): both skip the pass when no control effect is
         in the game (`anyControlEffects`), and the fuzzer checks `controllerOf` agrees with the pass; the action's own
         handler is checked too; the check moved to `game/control-changes.ts`. Bench within noise of the base. Fuzz 80 clean. Merged as #62.
         Next: M2-12c2, Mind Control.
       - M2-12c plan (2026-11-21, with the advisor's review), three PRs.
         - M2-12c1, a refactor with no new card: `controllerOf(state, id, cards)`, a battlefield permanent's controller
           read from the layer pass, which does layer 2 itself (resolved `gainControl` effects and, next, static control
           effects, sorted by timestamp, before the starts are built); one layer 2, no second path; the pass never calls
           `controllerOf`. A central check in `advance` (beside `removeNoncreaturesFromCombat`) replaces
           `recordControlChanges`: a permanent whose controller changed is summoning sick again (CR 302.6) and leaves
           combat (CR 506.4). A fuzz check for it. Proof it's neutral: every scenario, replay hash and golden log
           unchanged. Bench by alternating base and head.
         - M2-12c2: Mind Control (a static "you control enchanted creature", timestamped by its Aura, CR 613.7a, 613.7e),
           scenarios against Act of Treason both ways, two Mind Controls, destroyed while its creature attacks or blocks,
           anthems, Equipment, the Cloak, Firebreathing.
         - M2-12c3: Soul Bleed (its creature's controller's upkeep), Ice Cage ("its activated abilities can't be
           activated", mana abilities too, where both activation paths meet; "when enchanted creature becomes the target",
           read its rulings).
       - M2-12b built (2026-11-21, D-103): `attach` / `unattach` events, equip (`timing: "sorcery"`, `attachSelf`), CR 704.5n
         (protection too), layer 6 in timestamp order ("loses flying"), Whispersilk's "can't be blocked", Magebane's
         prevention, the `"attached"` subject; Gorgon Flail, Whispersilk Cloak, Magebane Armor, Firebreathing (214 cards);
         13 scenarios in `cards/m2-12b/`, `abilities lacks` in the runner, unit tests, the invariant, an Equipment column,
         four golden games. Rules review: Firebreathing destroyed in response pumped nothing (CR 608.2h, Shiv's
         Embrace's ruling): fixed; 13 more scenarios from its probes. Code review: `abilities lacks` refuses unknown
         keywords (`KEYWORDS`), layer 6 moved to `layer-six.ts`, `staticTimestamp` for layer 2 next, equip abilities
         checked against CR 702.6a, docs. Bench within noise of the base. Fuzz 150 clean. Merged as #61. Next: M2-12c.
       - M2-12a built (2026-11-21, D-102): `attachedTo` and its one reader, `enchant` as the Aura spell's target, entering
         attached, `attachedGets` / `attachedCantAttackOrBlock`, CR 704.5m (protection too), setup `attachedTo`, the
         invariant; Holy Strength, Unholy Strength, Weakness, Oakenform, Lifelink, Armored Ascension, Indestructibility,
         Pacifism (210 cards); 15 scenarios in `cards/m2-12a/` (each ruling, shroud, protection, an animated Forest), an
         Auras column in the matrix, two golden games. Rules review: a gone source's lifelink gave no life (CR 702.15c;
         Siege-Gang with Lifelink sacrificed for its own ability): last known information keeps keywords now; 13 more
         scenarios from its probes; Equipment citations marked later. Code review: Pacifism's check searched the
         battlefield per attacker and blocker and the Aura check was a second loop over it (bench over): now marked by
         the pass and folded into the one loop; `isAura`; only an Aura or Equipment can start attached (CR 303.4h); four
         more scenarios (the chosen target, pump, anthem, Nightmare); docs. Fuzz 200 clean. Merged as #60. Next: M2-12b.
       - M2-12 plan (2026-11-21, with the advisor's review), four PRs. Auras and Equipment (CR 303.4, 301.5, 702.5,
         702.6), 16 cards.
         - Model: an attached permanent records what it's attached to, `CardObject.attachedTo?: ObjectId` (left out
           otherwise, like `token`), fresh on every new object (CR 400.7). One reader, `attachedTo(state, id)`, returns
           the host only while it's on the battlefield (a host that left is a new object), and the layer pass, the
           state-based actions and triggers all use it. An invariant: at priority, every Aura is attached to a permanent.
         - Aura spells: "Enchant creature" (CR 702.5a) is a target spec of the Aura spell (CR 303.4a, 601.2c), read where
           `targets.ts` reads a spell's targets, so shroud, protection and the illegal target on resolution come free.
           Resolving, it enters attached as part of the move (`Destination.attachedTo`, as `Destination.is`, CR 303.4f,
           608.3), so it's attached before anything sees it. The `attach` event (new timestamp, CR 613.7e) is for equip
           and moving an attachment. Check how the definition-vs-Oracle test reads Scryfall's Enchant and Equip keywords.
         - Statics on "enchanted creature" / "equipped creature": the static kinds learn an `attached` subject, read in
           the layer pass.
         - State-based actions: an Aura attached illegally or to nothing goes to its owner's graveyard (CR 704.5m);
           Equipment attached illegally becomes unattached (CR 704.5n); protection's "can't be enchanted or equipped"
           counts (CR 702.16c-d). Awakener Druid's Forest ceasing to be a creature reaches both in the pool; Equipment is
           colorless, so protection may reach CR 704.5n only in a unit test.
         - Scenario setup: an Aura or Equipment can be set up attached (`attachedTo` in a battlefield entry), with
           validation, the exporter and `testing.md`, so scenarios needn't cast every Aura.
         - Equip: an activated ability, sorcery timing (check `AbilityDef` has it), target creature you control
           (CR 702.6a); equipping the current host does nothing (CR 701.3b).
         - Order becomes visible: Magebane Armor's "loses flying" is the first non-additive layer 6 effect, so statics and
           resolved effects in a layer merge by timestamp (CR 613.7), and the attach timestamp is tested (Jump before and
           after equipping); Mind Control against Act of Treason is the same in layer 2.
         - M2-12a: the model, Aura spells, CR 704.5m, setup, Holy Strength, Unholy Strength, Weakness, Oakenform,
           Lifelink, Armored Ascension, Indestructibility, Pacifism. M2-12b: Equipment, equip, CR 704.5n, protection's c-d,
           timestamp order in layer 6, Gorgon Flail, Whispersilk Cloak, Magebane Armor, Firebreathing. M2-12c: Mind
           Control (a static layer 2 effect: `controllerOf` takes the database, and a central control check in `advance`,
           D-098), Soul Bleed, Ice Cage. M2-12d: Open the Vaults (an Aura put onto the battlefield chooses what it
           enchants without targeting, CR 303.4f-g; read its rulings: what returns in the same batch, who chooses).
         - Future impact: Auras that enchant a player (Curses, later: CR 303.4) need `attachedTo` to take a player;
           bestow and reconfigure (later: CR 702.103, 702.151) change what an Aura or Equipment is; a token Aura (Roles,
           CR 111.10j) is created attached.
       - M2-11b built (2026-11-21): Siege-Gang Commander (three Goblins; "sacrifice a Goblin", a token or itself),
         Captain of the Watch (three Soldiers it pumps, other Soldiers too, not an opponent's), Cemetery Reaper (exile a
         creature card, a Zombie it pumps; no token if the target is gone, its ruling), Gargoyle Castle ({C}; a 3/4 flying
         artifact Gargoyle), 202 cards, 13 scenarios in `cards/m2-11b/` with Goblin Chieftain, Veteran Armorsmith and two
         Reapers; no engine change; the golden games already cover their mechanics. Rules review: no bug; counts and
         events tightened, four more scenarios (sacrificing its own target, the Reaper killed in response or summoning
         sick, the Castle tapped for {C} mid-payment), citations fixed. Fuzz 200 clean. Merged as #59: **M2-11 done** (202 cards).
       - M2-11a built (2026-11-21, D-101): `cardDataOf` everywhere (a source scan forbids `cards[...]`), tokens as card
         objects carrying their data, `createToken` / `ceaseToExist` events, CR 704.5d, `createTokens`, Ant Queen and
         Howl of the Night Pack (198 cards), 9 scenarios in `cards/m2-11/` (enters triggers, dies, bounced, stolen,
         pumped, Overrun), token unit tests, a "no token outside the battlefield at priority" invariant, a Tokens column
         in the interaction matrix, one golden game. Reviews: rules outcomes right; stricter dies/bounced scenarios and five
         more (creator owns a token made by a stolen Ant Queen, an opponent's token triggers Soul Warden, summoning
         sickness, to a library, Howl with no Forests); `isToken` for "card" filters; the state-based action's scan of
         every object made each action ~3 µs slower (bench over budget), now `for ... in` with the token test first, back
         to main's numbers; a token ceasing to exist in a hidden zone is shown only by where. Fuzz 300 clean. Merged as #58.
       - M2-11 plan (2026-11-21, with the advisor's review), two PRs.
         - Model: a token is a `CardObject` with `token: CardData`, its characteristics as the creating effect states
           them (CR 111.3; name = subtypes + "Token" unless stated, CR 111.4), kept on the object so the layer pass's
           per-`CardData` cache holds. Most of the engine's `kind === "card"` checks mean "a permanent object" and stay
           right; a token isn't a card for "card" filters (CR 111.6). One helper, `cardDataOf(obj, cards)`, replaces every
           `cards[...oracleId]` lookup in all packages (found by the compiler), and a source-scan test forbids new ones.
           An ability whose source is a token throws for now (no M2-11 token has one; later).
         - Creating a token is a pipeline event, `createToken`, emitting `TOKEN_CREATED`, which "enters" triggers match
           (Soul Warden for each of three Soldiers, one batch). Owner and controller: the creator (CR 111.2).
         - Leaving: `moveCard` carries `token`; a token in any zone but the battlefield ceases to exist as a state-based
           action (CR 704.5d, 111.7), found from the objects, not by searching libraries. A token can't come back
           (later: CR 111.8; nothing in the pool tries).
         - M2-11a: the model, `createTokens { token, amount }`, Ant Queen, Howl of the Night Pack (a count). M2-11b:
           Siege-Gang Commander ("sacrifice a Goblin", tokens included), Captain of the Watch, Cemetery Reaper,
           Gargoyle Castle ({C} and a sacrifice-self cost).
         - Future impact (c1): casting from other zones and "cast without paying" (cascade) must ask `cantCastSpells`
           before any zone; suspend (CR 702.62a) asks it too; a "set to N" hand size needs statics with timestamps.
       - M2-09b, characteristic-defining and setting effects, type and color: 7a (Nightmare, Serpent of the Endless Sea
         and its attack restriction), layers 4, 5 and 7b with "for as long as" (Awakener Druid), Rise from the Grave,
         Stone Giant (flying, then a delayed destroy).
       - M2-09c, control and rules effects: layer 2 (Act of Treason; `controlledSinceTurnStart` becomes a record that
         sees control change, future-rules), "can't cast spells" (Silence, CR 101.2), no maximum hand size (Spellbook).
       - Future impact: copies (layer 1) and text changes (layer 3) slot into the pass; tokens (M2-11) need a
         characteristics source beside the card database; counters (M2-10) stay in 7c; Auras and Equipment (M2-12)
         are statics on the attached object, affecting the one they're attached to.
       Plan (2026-11-20):
       - `CardDef.protections: ProtectionQuality[]` (a color, or a subtype like Demon), one per "from" (CR 702.16g),
         read through `protectionsOf` (layer 6, like `keywordsOf`); `rules/protection.ts`: `isProtectedFrom(state,
         protected, source)`, reading the source's colors and subtypes as it is, or as it last existed if gone
         (printed values: nothing changes colors or types yet). A subtype counts for permanents with it and for
         sources not on the battlefield with it (CR 702.16a).
       - Targeting (CR 702.16b): `legalTargets` drops a permanent protected from the targeting spell, or from an
         ability's source; checked again on resolution (CR 608.2b), so gaining protection makes it an illegal target.
       - Blocking (CR 702.16f): `canBlock` refuses a blocker with the quality.
       - Damage (CR 702.16e): a "prevent all" candidate in `damage-replacements.ts` for damage to a protected
         permanent from a source with the quality; like the others, asked about when another applies too (D-088).
       - "This spell can't be countered" (Great Sable Stag): a counter does nothing to it (CR 101.2, its ruling);
         the spell is still a legal target, and the counterspell's other effects happen.
       - Cards: White Knight, Black Knight, Baneslayer Angel, Great Sable Stag. Scenarios per CR line and ruling, plus
         negatives (other colors, a protected creature still blocking, a gone source's last color).
       - Future impact: protection from players, from everything (CR 702.16j-k), Auras/Equipment (M2-12) and
         granted protection (layers, M2-09) read `protectionsOf`; the source's characteristics move to snapshot
         `characteristics()` when effects can change them.
     - Visibility: shields and prevention effects in state are public and end at cleanup: shown in `playerView` with
       the delayed triggers (Known issues), or added to that issue.
     - Future impact: "if you would draw" needs the draw-several container (D-060, CR 121.2a), when a card needs it (none
       in Magic 2010); copies entering (Clone) are a CR 616.1c choice in the same machinery; layers (M2-09) granting or
       removing replacement abilities read them through one function; tokens (M2-11) use the zone-change helper.
## Handoff notes
- After merging a PR, restart the branch with `git checkout -B <branch> origin/main` and then push with
  `git push -u origin <branch>`: `checkout -B` from `origin/main` makes `main` the upstream, and a plain `git push`
  then fails (it did once; nothing reached `main`).
- Commit only when `pnpm check` exits 0: run it into a log file, use its exit code, never pipe its output through
  `grep` (a red commit went in that way). Edit scripts must fail loudly when a replacement doesn't match.
- **Owner (2026-11-21, later):** "Continue with the rest of M2"; looking forward to trying it (the CLI commands were
  given: `pnpm cli new --decks ...`, `show --as p1`, `actions`, `do`, `ai`).
- **Owner's request (2026-11-21):** run the fuzz games in parallel (a 60-game run took over 5 minutes on one core).
  Done (D-117): `pnpm fuzz` uses a worker thread per core; 60 games in 2 minutes on this 4-core machine.
- **Owner's preference (2026-11-20):** keep looking for ways to speed up iteration, so features land quickly while
  staying accurate and high quality. Slow spots seen so far, to work on as they bite: the 300-game fuzz (about 10
  minutes, one process: could run seeds across worker processes), `golden:cover` (plays up to 800 candidate games:
  could stop at the first game covering each missing unit), the mutation pass (a vitest run per mutant: could run only
  the engine and scenario projects, already done), and reviews waiting on each other (run mutations, fuzz and reviews
  at once, but never edit while mutating).
- **Owner's instruction (2026-11-20):** continue all the way to the end of M2; the owner won't be available much.
  For a decision that needs the owner, notify them with suggestions to choose from, and meanwhile carry on with the
  recommended option (recorded in Open questions, marked "proceeding with ...") so work doesn't stall.
- **Owner's standing instruction (2026-11-19):** keep working through milestone 1, task after task, without waiting for
  a go-ahead. Stop only for a decision that needs the owner (put it in Open questions and ask). Merge each PR once it
  checks out (D-027), restart the branch from `main`, then start the next task.
Anything the next session (or the session after a compaction) needs to pick up the current task:
the plan, what's done so far, what's tricky, what was about to happen next.
- Claude Code on the web: the cloud environment "open-mtg-arena" allows `magic.wizards.com` and `media.wizards.com`.
  Node's `fetch` there only uses the proxy with `NODE_USE_ENV_PROXY=1`, for example
  `NODE_USE_ENV_PROXY=1 node scripts/fetch-rules.mjs`.
- Local setup: Node 26 (`.nvmrc`) and pnpm 10.34.9 (`packageManager`). The "open-mtg-arena" environment's setup
  script installs both into `/opt/node26` and runs `pnpm install`. Shells there start on an older Node, so run
  `export PATH=/opt/node26/bin:$PATH` before `pnpm` commands.
- `pnpm check` is typecheck + lint + tests, which include a short fuzz (seeds 1 to 6, M1-18), the saved replays and
  the golden games. The coverage check joins in M1-19's second PR.
- Scenarios: write new rules tests as YAML in `packages/engine/test/scenarios/<area>/` (testing.md). Extend the runner
  (`packages/scenarios`) and testing.md together when a task adds steps (`play`, `cast`, `activate`, `attack`, `block`).
  The M1-07 stack tests (TypeScript) become YAML scenarios once `cast` exists (M1-09).
- Work queue (D-032): new pauses mid-step (M1-13's attackers and blockers) become work items, like `finishCleanup`.
  `waitFor` throws if a decision is already pending, so a chain can't silently replace one.
- Effects (D-036): test CR 608.2m (a spell that leaves the stack mid-resolution) once an effect can move one. A new op
  goes in `effects/run-effect.ts` and the table in `effects/README.md`.
- Characteristics (D-038): read power, toughness and keywords through `characteristics()` or the per-layer readers
  (`powerAndToughness`, `keywordsOf`, `supertypesOf` for the legend rule, CR 704.5j).
  An effect whose `affected` objects are gone stays until cleanup and does nothing (their ids never come back, CR 400.7).
- Casting, playing a land and activating any ability reset `passesInSuccession` (CR 117.4); cancelling doesn't.
- State-based actions (D-039) run in `givePriority` and the cleanup step's check, never between work items. A new SBA
  is one case in `rules/state-based-actions.ts` and two in `game/state-based-actions.ts` (`lossFrom`,
  `performOnObject`). The repeat of the check (CR 704.3) has no test: nothing in the pool makes one SBA cause another.
  The first card that can (an anthem, a lord) should add one. One that needs a choice
  (the legend rule, CR 704.5j) can wait for it, since a performed check re-queues `givePriority`.
- Combat (D-040): engine tests that pass through combat with creatures must answer `declareAttackers` and
  `declareBlockers` (the turn tests' `playUntilTurn` declares nothing).
- Engine test helpers (`test/support/game.ts`) check invariants on every state and only take actions from
  `legalActions`. Use them in every new engine test. Never name a module export `then` (Vitest treats the module as a
  promise).
- Scenarios the M1-04 rules review asked for, to write in the task that implements each rule:
  M1-08: a Mountain taps for {R} without using the stack (CR 305.6, 605.3b); Llanowar Elves is a mana ability (CR 605.1a)
  and can't be activated while summoning sick (CR 302.6). Also compute mana value from the cost (CR 202.3) and check it
  equals Scryfall's `manaValue` for every pool card. M1-09: Lightning Bolt can't target a land, can target your own
  creature and yourself (CR 115.4); Giant Growth can't target a player (CR 109.2). M1-11: Giant Growth wears off in
  cleanup (CR 514.2). M1-14: firebreathing uses the stack (CR 602.2), stacks three times (CR 613.4c), and resolves after
  the Whelp dies without affecting anything (CR 113.7a, 400.7, 611.2c).
- Done in M1-08 (`mana/elves-still-sick-on-opponents-turn.yaml`). A settled CR 302.6 edge case: a creature that entered on its controller's
  last turn is still summoning sick on the opponent's turn (Llanowar Elves can't tap for mana there), and isn't on
  its controller's next turn.
- Activated abilities (D-041): a stack object is a spell or an ability; read its targets and effects with
  `targetSpecsOf` and `effectsOf`, never from a card directly. No last-known-information store yet (future-rules.md).
- When M3 adds `apps/web`: add `apps/*` to `pnpm-workspace.yaml`, the Vitest projects and the tsconfig include.
- The engine's step names follow the CR (`precombatMain`, `declareBlockers`, see `engine/src/state/turn.ts`).
  `testing.md`'s scenario YAML uses short names (`main1`, `combat.declareBlockers`); the M1-16 runner maps them.
- `main` was created from `claude/eloquent-mayer-qcx0e1` at the owner's request and is now the default branch
  (2026-11-19). From now on, work reaches `main` only through pull requests.
- The "open-mtg-arena" environment also allows Scryfall (`api.scryfall.com`, `data.scryfall.io`). `pnpm cards:fetch`
  passes `--use-env-proxy` itself, so it works behind the proxy with no environment variable.

- CLI (D-043): run games with `pnpm cli` to check behavior by hand (CLAUDE.md step 4): `new --scenario <name>` or
  `--decks`, then `do`, `show`, `log`, `inspect`; `export --scenario` turns a path into a scenario.
- For M1-18: reuse the CLI's agents (`chooseAction`, `playAgents`), `deckGameSetup` and the game file (the failure
  log is a game file, so `pnpm cli replay` opens it). Conceding isn't in `legalActions` (D-042), so the fuzzer never reaches a state after a concession; only
  the game-end scenarios check those. The fuzzer could concede now and then, with a small probability.

## Next up
- After the owner tags `m2`: M3 Phase 1 (`docs/milestones/m3-first-playable.md`): M3-01 the match host (with `brief`'s
  builder moved into `packages/match`), M3-02 the heuristic AI, M3-03 the web app scaffold, M3-04 the landscape phone
  board (D-141). The UI follows Arena's interaction design with our own look (D-140, `docs/arena-research.md`).

## Done
- Starter docs, Claude Code config and rules scripts added (2026-11-19).
- M1-02 Rules files: `rules/` generated from the CR effective November 6, 2026 (148 sections, 744 glossary terms);
  `rule.mjs 601.2` spot-checked; 702 split into one file per keyword (2026-11-19).
- M1-01 Scaffold the monorepo: pnpm workspaces (`engine`, `cards`, `cli`, `ai`), strict TypeScript 7 with no build
  step (D-018), Vitest 5 with `unit`/`scenarios` projects, Biome 2, GitHub Actions running `pnpm check`,
  `pnpm cli --help`, and a `pnpm fuzz` stub (D-017) (2026-11-19).
- M1-03 Core types and state: `engine/src/state/` (ids, zones, objects, setup, decisions, actions, events, results,
  `GameState`) and `engine/src/rng/` (xoshiro128**, D-024), with type-level, JSON round-trip and known-answer tests.
  Reviewed by rules-judge and code-reviewer; D-020 to D-025 (2026-11-19).
- M1-04 Card data pipeline: `pnpm cards:fetch` / `cards:extract` (Scryfall bulk JSONL), `pool.txt` with the 17 M1
  cards, generated `data/pool.json` and rulings, the engine's card types (D-026), all 17 definitions, ability refs
  (D-028), printing choice for art (D-029), and tests for the pool, the errata check, matching and the parsers (2026-11-19).
- M1-05 Game start: `createGame` with setup validation, the random chooser for the starting player (CR 103.1), shuffling
  (CR 103.3), opening hands and CR 103.5 mulligans as decisions, fixed openings, `applyAction`/`legalActions` for these
  decisions, and the first turn (D-030) (2026-11-19).
- M1-06 Turn structure: the turn sequence as data and one step machine (D-031), every step's turn-based actions, the
  starting player's skipped first draw step (CR 103.8a), the combat skip (CR 508.8), mana emptying (CR 500.5), cleanup
  discard and damage removal (CR 514), passing priority with an empty stack (CR 117.3d, 117.4) (2026-11-19).
- M1-07 Priority and the stack: the work queue and `advance()` (D-032), resolving the top of the stack when all pass
  (CR 117.4, 608): abilities cease to exist, instants and sorceries to the graveyard, permanents onto the battlefield;
  priority to the active player after (CR 117.3b) (2026-11-19).
- M1-16 Scenario runner: `packages/scenarios` (D-033) runs YAML scenarios through `legalActions()`, checking expectations
  and invariants on every state; 16 scenarios for game start and turn structure; a test checks testing.md documents
  every word the runner knows (2026-11-19).
- M1-08 Mana and costs: abilities and mana abilities (CR 305.6, 605.1a), activating them with priority (CR 605.3),
  tapping, summoning sickness for {T} (CR 602.5a), payments checked all or nothing (CR 601.2h), `autoPay` (D-034), the
  runner's `activate` step, 8 mana scenarios (2026-11-19).
- M1-09 Playing lands and casting spells: land plays (CR 305), timing (CR 117.1a), casting as decisions with targets and
  payment (CR 601.2), cancelling reverses it (CR 734.1), CR 608.2b on resolution; the runner's `play` and `cast`; 4 land
  and 16 casting scenarios (D-035) (2026-11-19).

- M1-10 Effects interpreter v0: `effects/` runs `dealDamage`, `addMana` and `modifyPT` (CR 608.2c), all damage through
  `dealDamage` (CR 120), life loss (CR 119.3), continuous effects stored in `GameState.effects` (CR 611.2, 613.7b);
  targets checked once as resolution begins (CR 608.2b); mana abilities use the same interpreter; 7 effect scenarios
  and TS tests with made-up two-target cards (D-036, D-037) (2026-11-19).

- M1-11 Characteristics and layer 7c: `characteristics()` through the layers (CR 613), layer 7 with 7c effects,
  +1/+1 and -1/-1 counters and rule modifiers, no power or toughness for noncreature permanents (CR 208.3),
  "until end of turn" effects ending with damage in cleanup (CR 514.2); scenario `rules:` and `.power`, `.toughness`,
  `.abilities contains`; 6 characteristics scenarios (D-038) (2026-11-19).

- M1-12 State-based actions: CR 704.5a/b/f/g listed as data and performed together (CR 704.3), checked before every
  priority (CR 117.5) and in cleanup with another cleanup step when any happen (CR 514.3a); destroy (CR 701.8);
  players losing and the game ending with a winner or a draw (CR 104.2a, 104.4a); the runner's `winner`; 8 SBA
  scenarios and the CR 608.2b scenario (D-039) (2026-11-19).

- M1-13 Combat: declaring attackers and blockers as incremental decisions (CR 508.1, 509.1), summoning sickness and
  haste (CR 302.6, 702.10), flying and reach (CR 702.9, 702.17), combat damage with free division among several
  blockers (CR 510.1c) dealt at once (CR 510.2), `GameState.combat` for the combat phase; the runner's `attack`,
  `block`, `assign`; 23 combat scenarios (D-040) (2026-11-19).

- M1-14 Activated abilities: non-mana abilities go on the stack through the casting steps (CR 602.2), with targets,
  mana costs, cancelling and resolution from the source's card (CR 113.7a); firebreathing; the runner's `activate`
  with `targets` and `pay`; 8 activated-ability scenarios and TS tests with a targeted test ability (D-041)
  (2026-11-19).

- M1-15 Game end: conceding at any time (CR 104.3a) through the same `playersLose` as state-based losses; results with
  winner, losses and reasons, and turn; the runner's `concede`; 6 game-end scenarios (D-042) (2026-11-19).

- M1-17 Headless CLI: `new`, `show`, `actions`, `do`, `ai`, `auto`, `log`, `inspect`, `export --scenario`, `replay`;
  the game file (setup + actions, cached state); `first-legal` and `random` agents; the prebuilt decks; exported games
  pass as scenarios (D-043) (2026-11-19).
- M1 coverage gaps closed (D-050: a scenario or a unit test counts): 242 rules cited, 174 tested by scenarios, 68
  only by unit tests, 0 gaps, 50 mentions marked `later:`. New scenarios for the turn's steps, paying, land plays,
  the game ending mid-stack, priority after a resolution and tapped blockers; unit tests for the CR's definitions
  (2026-11-19).
- M1-19 Golden games, coverage report and benchmarks: four golden games with readable logs (D-047), `pnpm
  coverage:rules` with its check in `pnpm check` and the interaction matrix (D-048), `pnpm bench` against a baseline
  (D-049). Accepted: doubled mana shows in the golden diff; removing a scenario fails the coverage check; a slowdown
  fails the bench and five unchanged runs pass. Also the rules-judge M1 exit review of casting, priority, SBAs and
  combat: no rules errors for the pool (2026-11-19).
- M1-18 Fuzzer and replays: player views and event filtering (D-044), card ids numbered in a random order (D-045),
  `pnpm fuzz` with every check after every action and failures written as game files, a short fuzz in `pnpm check`,
  saved replays with `pnpm replays:update` (D-046). Acceptance: `pnpm fuzz --games 1000 --seed 1` clean (0 of 1,000
  failed, 26 minutes); mutants breaking views, events, life, zones and legal actions are caught. One known issue left
  for M2's start (Known issues: card tracking through hidden hands) (2026-11-19).

## Open questions
- (2026-11-24, D-187) The card data comes from the Rust card-text parser (`./scripts/gen-card-data.sh`). After the
  switch Rust stays as a build step for card data, not only as a test reference, unless an Odin parser becomes part
  of the plan. Tell the owner (pending).

- (2026-11-24, after the Odin port was paused) The owner on why the port started: the frontend client would have
  taken longer than they liked, so they adopted phase.rs to borrow its frontend and strip what they don't want; Rust
  is "really meh to work with" and they like Odin, so an AI-agent port seemed easy. **The real end goal: "a clean and
  modern mtg client that I can customize via Claude code whenever I want."** Recommendation given: stop the Odin port
  (a translation keeps the engine's size and convolution, takes weeks, and gains players nothing), keep the Rust
  engine as a black box the client talks to, and make the codebase quick for Claude Code to customize (prebuilt engine
  wasm so client work needs no Rust build, faster engine dev builds, a map of the engine). Keep D-184's fix. Waiting
  on the owner's answer.
- Owner (2026-11-24), asked about Rust's build times: **"I just want blazing fast iteration."** That is the
  requirement the engine-language question gets judged by: a change, client or engine, visible in the running app in
  seconds. Next step: measure today's loops (a client-only change; a small engine change) and what cheap build
  settings buy, before choosing between keeping Rust and porting.
- Owner (2026-11-24): "yeah go ahead with 1 and 2 and 3". Plan, in order (the Odin port stays paused meanwhile):
  1. Client loop instant: client work needs no Rust build (a prebuilt engine fetched, not built) and a compact engine
     file (the dev build is 263 MB); measure edit-to-screen.
  2. Engine loop measured: a one-line engine change to a reloaded app, today and with cheap build settings.
  3. Report the numbers and a recommendation on the engine (keep Rust, or port) for the owner to decide.
- Owner (2026-11-24), during that work: "I also wonder if it's worthwhile to do an Odin port at a high level and not
  necessarily a rust to Odin translation" (a clean Odin engine written from the rules, not translated). To be
  answered in step 3 with the trade-off (card coverage against a small, fast, readable engine; what of today's Odin
  work carries over: the data model, codecs and RNG do, the translator doesn't).
- Owner (2026-11-24): the cards that matter are those from the Scryfall query **`game:arena in:paper`** (cards on
  MTG Arena that also exist in paper). That pool sizes the engine options in step 3. Measured (2026-11-24): the
  pool is 15,772 unique cards (Scryfall API); the Rust engine fully supports 14,013 of them (88.8%), 1,759 are
  marked unsupported, none are missing from the card data (client/public/coverage-data.json, matched by name).
- Owner (2026-11-24), on an Odin engine built from the rules behind the same wasm interface: **no running both
  engines** in the app; "the only value I think we would get from the rust portions are the tests for mechanics and
  cards". So if an Odin engine is built, the Rust engine serves as a test reference (its tests and recorded games),
  not as a shipped fallback.
- Settled (2026-11-24, D-183): runtime card-text parses are precomputed into the card data; the Odin engine
  never parses. Settled (2026-11-24, D-184): fix the saved-game `"type"` clash, changing that wire form.

- Settled (2026-11-23, D-178): after the import is playable, the Rust to Odin port comes next, planned first; the
  LLM opponent and the RPG are on hold.

- (2026-11-23, owner) Fork phase-rs and build on it instead? The owner: "Are you familiar with phase-rs the open source
  engine and client", then "im actually considering that we fork the repo and build upon that instead...is that too
  much?". phase-rs/phase: a Rust MTG rules engine compiled to native and WASM (desktop app, browser PWA, WebSocket
  multiplayer), cards parsed from text with MTGJSON data, CR-cited rules tests, MIT/Apache-2.0 (from a web search
  only; its code not yet read). Proposed: a time-boxed evaluation against our goals before deciding; no decision yet.
  Then the owner: "what I really want is it's rules engine and frontend client when playing matches against an AI.
  those are the two biggest things. we would save a ton of time and would be able to get started on the higher value
  initiatives like an LLM powered opponent and the single player RPG or rogue like". So the evaluation is of those
  two: phase's rules engine, and its client for a match against the AI, as the base for the LLM opponent and a
  single-player RPG or roguelike (vision.md). Evaluated (2026-11-23): `docs/phase-rs-evaluation.md`. Decided: import
  and rebrand it (D-177).

- (2026-11-23, M3-05, D-176) The owner's unfolded screen size in CSS pixels, both ways up: the full layout is picked
  from 560 px tall, and the "turn your phone" prompt shows for an upright screen under 700 px wide. A screenshot of
  the live site unfolded settles both (the 172 px info block gives the scale). Proceeding with the guesses.

- Answered (2026-11-23, pacing, D-172): should the phase ladder step through each step a frame passes over, or jump?
  The owner: "phase bar should mirror what mtg arena does" (D-173), then: "it steps through each phase as it passes -
  we should avoid immediate jumps between the "main" phases - this probably would be largely solved with animations".

- Smart stops (2026-11-23, D-157): the host stops wherever you could act, except in your own upkeep, draw step and
  end step. Proposal, not built: also skip your own beginning of combat, combat damage and end of combat unless an
  opponent's object is on the stack, and add one-shot stops by tapping a step on the phase ladder, as Arena does.
  Worth it if playtesting shows too many stops with an instant in hand.

- (2026-11-23, after M3) What follows M3? The owner says M4 (deckbuilding) is up for debate and likes Legends of
  Runeterra's roguelike mode (Path of Champions). Discuss once M3 is done: a roguelike run, the Shandalar-style RPG, or
  deckbuilding first, and how they share the engine, the AI and the card pool (vision.md).
- (Asked 2026-11-21, D-114) Master of the Wild Hunt is the one M2-14 card with a part no Arena card has: the target
  creature's controller divides its damage among the Wolves. Options: (a) set it aside, like Harm's Way (recommended,
  by D-089's option (a); proceeding with this); (b) script it last in M2-14 anyway; (c) script only after M2.
- (Asked 2026-11-21, D-114) Pithing Needle and Sphinx Ambassador name a card. CR 201.4 allows any card in the Oracle
  card reference. Options: (a) any name in the app's card database (recommended; proceeding with this); (b) only names
  in the current pool; (c) any Oracle name, which would ship the full name list with the app.
- (Asked 2026-11-21, D-092) CLAUDE.md says the engine has "no globals". The layer pass is kept in module-level
  `WeakMap`s (and a last-result value), outside the state, as architecture.md's "memoize per state object" allows: a
  kept result can never differ from a fresh one, and the fuzzer checks that after every action. Options: (a) read "no
  globals" as "no hidden state that can change a result", allowing these kept values (recommended; proceeding with
  this); (b) keep the pass inside a per-call context passed to every reader instead, a signature change across the
  engine; (c) drop keeping it, and accept a random game about five times slower.
- (Asked 2026-11-20, M2-09) The M2-09 spec asks for "at least one dependency example from the CR" (CR 613.8: within a
  layer, an effect that changes what another applies to goes first). No card in the pool, or in M2-09's 24, has two
  effects in one layer where that matters, so it would be machinery only test cards exercise. Options: (a) build
  timestamp order now and leave dependency for the first card that needs it, amending the spec's acceptance line
  (recommended; proceeding with this unless the rules review finds a pool pair); (b) build dependency now with a CR
  example on test cards, as the spec says; (c) build it with M2-14's special-rules batch.
- (Asked 2026-11-20, D-089) Does "modern Magic" mean the Modern format? `game:arena -is:alchemy -is:digital` keeps 13,036
  of 23,012 Modern-legal cards, and 51 keywords on 596 Modern-legal cards appear on no card it keeps (Echo, Dredge,
  Undying, Miracle, Level Up, Fear, Soulbond...; the list is in D-089). (Counts are under the earlier filter; the
  owner's final one, D-089, keeps 14,623.) Options: (a) the filter sets the order, not
  the boundary: Arena's mechanics first, then a later milestone for the Modern-only ones (recommended; nothing needs
  deciding before M3); (b) the filter is the boundary: those mechanics are never built; (c) the owner's final filter
  (`in:arena in:paper -is:alchemy`) already brings back the paper cards Arena had only in digital reprint sets, which
  was the third option first offered here.
- (Asked 2026-11-20, D-089) Magic 2010 cards still to script in M2-14 whose rules may have no counterpart on MTG Arena
  (Hive Mind, Telepathy, Warp World, Sphinx Ambassador's naming a card, Mirror of Fate, and any other M2-14 card): (a)
  check each against Arena when M2-14 starts and skip those whose mechanic no Arena card uses (recommended; proceeding
  with this), (b) script all of Magic 2010 as the spec says, (c) drop every Magic 2010 card not on Arena from M2 (51 of
  the 76 left, though their mechanics are on Arena).
- (Asked 2026-11-20) The M2 spec's M2-08 acceptance list includes three cases from the M2-03 review that no Magic 2010
  card can produce: a dying creature's replacement still applying to the others in its state-based-action batch
  (CR 704.3), a "would die" replacement with regeneration (testable now with a test-only card, done in M2-08c), and
  Worship-style damage results replaced as one event (CR 120.4c). The first and third would need replacement kinds
  written only for tests, which CLAUDE.md treats as speculative. Proposed: defer those two to the first card that
  needs them (noted in future-rules), and count M2-08 done without them. Options: (a) defer them (recommended;
  proceeding with this), (b) add minimal test-only replacement kinds to the engine to test them now, (c) drop them
  from the spec.
- (Asked 2026-11-20, D-087) A regeneration shield and a "would be put into a graveyard ... shuffle into library"
  replacement on one destroy, library one first: the shield still applies and the creature regenerates. Is the library
  still shuffled? (a) No: regeneration replaces the whole modified event, CR 614.6 (recommended; proceeding with
  this). (b) Yes: CR 701.24c shuffles even when the card stays where it is. No Magic 2010 card can reach this.
- (Asked 2026-11-20) The owner asked whether card definitions' raw strings (`op: "dealDamage"`, `step: "end"`...)
  should become enums. Recommended: no TypeScript `enum` (D-018 runs TypeScript by type stripping, and
  `erasableSyntaxOnly` refuses `enum`); the strings are already checked literal unions. Offered instead: named
  constants for whole phrases repeated across cards ("target creature", "until end of turn", "at the beginning of
  the next end step"), in one shared file. Waiting on the owner's answer.
- (Answered 2026-11-20, D-073–D-075: the golden budget raised, the four keywords with their first cards, Goblin
  Artillery's two losses kept.)
- (Answered 2026-11-20, D-078: Dragon Whelp counts an activation as it's activated, and checks the count as each
  activation resolves.)
- (Answered 2026-11-22, D-133: the random game ran 100–130 ms on this cloud machine against the 100 ms laptop
  budget. The owner chose a separate, not too strict budget for this machine: 150 ms, by CPU model in `bench.ts`.)
- (Answered 2026-11-21, D-123: `pnpm bench` failed on main on this machine. The owner chose to reset the baseline on a
  quieter run: no other work running, after PR #78's reviews; alternating base and head runs stay for close calls.
  Done: the median of five idle runs.)

## Current goal: the new Odin engine (D-187, owner's /goal, 2026-11-24)

Done when: the app runs on the Odin engine, it fully supports at least the 14,013 `game:arena in:paper` cards the
Rust engine plays today, and an engine change rebuilds and shows in the app in seconds. Report to the owner only at
milestones, decisions and problems.

Plan (keep current):
1. **Capture the Rust tests** as language-neutral files. `crates/engine/src/game/scenario_capture.rs`: with
   `ENGINE_CAPTURE_DIR` set, every action a scenario test applies is appended to `<dir>/<test>.jsonl` (pre state or
   null when unchanged, action, result, post state). Run the integration suite with it on; then recorded AI games
   (`record-games`, decks from the pool). Corpus is generated, never committed; a script regenerates it.
2. **Odin WASM shell**: every function in `client/src/wasm/engine_wasm.d.ts` (94) and `draft_wasm.d.ts` (39),
   same names and JSON, behind a JS glue module matching wasm-bindgen's; data lookups real, game functions minimal;
   the client loads against it (a build switch, not a dual engine).
3. **Grow the engine** from the CR, mechanic by mechanic, with a simple AI; track the captured-test pass rate
   (comparing a game-relevant projection, not Rust's bookkeeping) and pool cards fully supported.
4. **Switch** the app to Odin at 14,013+ pool cards; Rust stays only as the test reference.

Also in flight: the dev bundle (scripts/fetch-dev-bundle.sh; the Pages deploy publishes it).

Progress:
- Step 1: `scripts/capture-rust-tests.sh <dir> [filter]` captures the integration tests (one gzip JSONL file per
  test, each step: starting state, the acting seat, action, accepted or not, result state). A slice of 8 tests: one
  file per test at the default thread count, ~120 KB per test compressed (~25x). `odin/engine-wasm/run-captured.mjs
  <rust|odin> <dir>` replays each step through the client's interface (restore, submit for the seat, export) and
  compares `projection.mjs`'s game-relevant view (cards by name, not id; libraries as counts and contents, not order;
  no timestamps). Rust against its own capture: 7/8 tests, 71/75 steps; the miss is a state Rust itself refuses to
  restore ("current-turn ZoneChanged record has no ledger occurrence"), so such tests are fixtures to exclude.
- Step 3 (2026-11-24): the Odin engine plays whole games. `odin/engine/game/`: turns and steps (CR 500-514),
  priority (117), land plays (305), mana abilities and automatic payment (106, 601.2g-h, 605), casting with targets
  (601, 115), the stack and resolving (405, 608), combat with flying/reach, first and double strike, trample,
  deathtouch, lifelink, vigilance, menace, defender, haste (506-511, 702), state-based actions (704), London
  mulligan (103.5), discard to hand size (514.1), and a simple AI. Spells supported: fixed damage, +N/+N until end of
  turn, draw, gain life, destroy. AI-vs-AI games finish (three seeds, 14-22 turns, ~11 ms per action in the dev
  build). In the app: the game page loads, the opening hand shows, Keep works, the steps advance.
  Known simplifications: first-strike and regular damage happen in one combat damage step (SBAs between them);
  "until end of turn" pumps live beside the state, so a save/restore forgets them; no game events yet (no
  animations or log); the Commander format's command zone isn't set up (commanders are left out).
  Coverage (`node odin/engine-wasm/coverage.mjs`): 582 of the 15,772 pool cards fully supported (Rust: 13,381 by
  client/public/coverage-data.json's names; the goal's 14,013 came from the Scryfall-name match, to reconcile).
  The report ranks missing pieces: triggered abilities lead (zone-change triggers block 3,623 cards and are the
  only gap for 1,709), then continuous statics (1,623), "as it enters" replacements (883), step and attack triggers,
  spell-cast triggers. Next: triggered abilities (CR 603).
- Step 3 progress (2026-11-24, later): triggered abilities (CR 603: zone changes, steps, attacks, spell casts),
  tokens (111), layers (613: static P/T and keyword effects, counters, until-end-of-turn grants), activated
  abilities (602: mana, tap, sacrifice-self, pay-life costs), enters-tapped/with-counters replacements (614.1c),
  zone-change effects (exile, bounce, graveyard returns), counters/tap/mill/mass pump/destroy all/damage each,
  one object-filter matcher (types, subtypes, colors, keywords, mana value, P/T, attacking...), the attacker's
  damage division (510.1c, 702.19b), target incarnations (400.7), commanders (903.6, 903.8 tax, 903.9a return;
  the owner's choice to return is always taken, hand/library replacement 903.9b and commander damage 903.10a not
  yet). A rules-judge review of the core was fixed in full. Native rules tests: `odin test odin/tests/game
  -define:ODIN_TEST_TRACK_MEMORY=false` (15, each citing its rule). Pool coverage: 1,886 of 15,772.
- Step 3 progress (2026-11-24, evening): damage triggers, scry/surveil on resumable resolution (608.2), amounts
  worked out as effects happen (608.2h), rule-stating statics (can't block/attack, can't be blocked, doesn't
  untap, must attack, extra land, no max hand size, flash), Auras and Equipment (303.4, 702.5-6, 704.5m-n), and
  the AI for them. Rules tests: 23. Process note: background jobs only build and test; commits are made in the
  foreground (a background commit once picked up half-finished edits).
- Step 3 progress (2026-11-24, night): conditional and dynamic statics, CDAs, colors (layer 5), discard and dig
  choices, "it"/"that creature" instructions acting on the earlier target (608.2c), resolved effects granting
  rules for a duration (can't block, can't be blocked, doesn't untap; 611.2), tokens with statics and X/X sizes,
  sacrifice-a-permanent and discard-a-card costs through the PayCost prompt (601.2h, 602.2b, 701.21a). Rules
  tests: 30. Pool coverage: 2,765 of 15,772 (the owner asked; reported). `coverage.mjs --examples "<gap>"` lists
  the cards one gap alone blocks.
- Step 1 full capture (2026-11-24): 12,326 tests recorded (3.3 GB, in the session scratchpad, not committed;
  ~100 min). Shards integration, integration_2 and integration_3 completed (one Rust test failed in the first);
  integration_4 failed partway, likely killed in a memory squeeze (the container's processes share ~15 GB).
  Rust self-replay done: 11,160 of 12,326 recordings replay cleanly on Rust (the usable fixtures); 1,074 differ on
  Rust itself (mostly states it can't restore), 37 unreadable, 55 over 5 MB (loop tests, left out; replaying them
  exhausted memory). The replayer restarts every few hundred tests (memory grows with each restore) and writes
  each result as it goes.
- First Odin replay over the 11,160 fixtures (2026-11-24, engine at 3221bf1, 571 s on three workers): 388 pass
  (3.5%), 10,765 fail, 7 too large. Failures: CastSpell rejected 5,481, ActivateAbility rejected 1,839, stack
  contents 1,058, waiting_for 663, phase 227. The 7,320 rejected casts and activations split three ways (scratchpad
  cast-scan.mjs): 1,816 act on a synthetic test card (not in the card database: Odin's support check looks the card
  up by name, while the fixture's object carries its own abilities); 4,963 on a real card Odin doesn't support yet
  (top gaps: spell conditions 392, Moved replacements 372, ChangeZone 289, delayed triggers 270, multiple targets
  262); 541 on a card Odin supports, to be explained (the replayer now records Odin's refusal reason). Most fixtures
  are narrow regression tests for one mechanic each, so the pass rate grows with mechanics rather than with cards. Pool cards with all their fixtures passing on Odin: 19 of the 2,017 that appear in one.
  Tools (scratchpad): fixture-reach.mjs (pass rate among fixtures whose real cards Odin supports: 152 of 2,165) and
  reach-fails.txt. Next: rank the failing fixtures by the Odin gap that rejects them, and build by that ranking
  alongside the static coverage ranking.
- Mana pool (2026-11-25): Odin ignored mana in the pool. Now it pays from floating mana first (CR 106.4), the pool
  empties as each step begins (CR 106.4), and a player with priority can activate a mana ability on its own
  (CR 605.3a-b; a choice of color isn't offered yet, so such an activation is refused). Of the 541 fixtures that
  acted on a supported card yet were refused, 15 now pass and "mana cost unpayable" fell from 392 to 52.
- Support is judged on the object (2026-11-25): what Odin carries out is the object's own abilities, triggers,
  statics, replacements, modes and costs (CR 109.3), not the card looked up by name, so fixtures built on
  synthetic test cards can run (1,816 refusals). Cards with casting restrictions, strive, cleave or a solve
  condition are now reported unsupported (they were played without those rules).
- The spell is on the stack while it's cast (2026-11-25, CR 601.2a): its entry is pushed as casting begins, the
  card keeps its place until it becomes cast (as Rust and the client show it), a cancel reverses it (CR 734).
  The replayer now runs in lockstep: a step with no recorded starting state continues from the engine's own state
  when the last step matched. On the 541 "supported but refused" fixtures: 49 pass (was 0).
- Full replay at 605233d (mana pool, object support; before the stack and lockstep changes): 496 of 11,160 pass
  (was 388).
- Rules review of the mana pool, object support and the cast-time stack entry: fixed a mana ability activated on
  its own skipping priority (CR 405.6c, 117.3c-5: Ancient Tomb at 2 life now loses at once), surplus mana from an
  automatic payment being lost (CR 106.4: Sol Ring for {1} leaves {C}), a Case's solve condition never refused, a
  flashback spell able to target itself (CR 115.5), cancelling at cost payment leaving X and kicker set
  (CR 734.1), and three wrong citations. Open from it: mana abilities aren't offered in the legal actions (the
  client taps through TapLandForMana, not built yet); a cast in progress lives outside the saved state, so saving
  mid-cast loses it (CLAUDE.md wants every pending decision in state); cleanup-step priority (CR 514.3a); tests
  still missing for cancelling at the mode/X/kicker prompts and for the this-turn amounts resetting.
- Full replay at 10b8258 (lockstep, cast-time stack entry, review fixes): 597 of 11,160 pass (5.3%). First
  differences: card not supported 6,052 (CastSpell 4,445, ActivateAbility 1,607), stack 1,127, waiting_for 869,
  phase 254, not castable from its zone 225, priority player 210, DeclareAttackers refused 161, Debug actions 141.
  The refusal reason now lists the object's missing pieces, so these can be ranked by mechanic.
- CR coverage report (2026-11-25, owner's request): docs/odin-rules-coverage.md, generated by
  `node odin/engine-wasm/rules-coverage.mjs --out docs/odin-rules-coverage.md`, a checklist of every rule and subrule
  in 100-799 marked by whether the engine cites it and whether a test does. First run: 228 of 2,880 in-scope rules
  cited (8%), 84 tested. Strict: a rule counts only if cited by number, so much behaviour written without its exact
  subrule (keywords cite 702.9, not 702.9a-c) counts under its parent only. Regenerate and commit it with engine
  changes; it also lists citations that aren't in the CR (fixed one: 602.2h).
- Mechanics added 2026-11-25 (card coverage 4,439 -> 4,850; rules cited 228 -> 239): this-turn amounts and
  control/tapped trigger conditions; enters-with-counters conditions and X counters; the turn's zone changes ("a
  creature died this turn"); zone-change triggers with a targeted effect and "this or another"; conditions on a
  target that left (last known information); mana abilities with mana costs and a color choice; restricted mana;
  Powerstone, Blood, Lander and Mutagen tokens; graveyard abilities; "sacrifice an A or B" costs; stun and
  keyword counters. Then (-> 5,076; rules 247): "that much" from a damage trigger; life-gain, draw, damage-received,
  leaves and enters-or-attacks triggers; "whenever this becomes tapped"; "whenever you sacrifice" (CR 701.21a,
  603.10a), with every sacrifice (costs, mana riders, effects) its own event. A trigger that works from a zone other
  than the battlefield ("when you sacrifice a Clue, return this card from your graveyard") is refused unless it's
  the object's own zone change: only the battlefield is watched for other objects' events.
- Full replay at 53e766b: 624 of 11,160 pass (5.6%, from 597). First differences: card not supported (CastSpell
  4,587, ActivateAbility 1,527), waiting_for and stack differences next. Sagas (CR 715, about 250 pool cards) are the
  largest single gap among triggers and are next.
- Sagas (-> 5,095; rules 255, 105 tested): a Saga enters with a lore counter (CR 715.3a), gets one as its
  controller's precombat main phase begins (CR 505.4, 715.3c), its chapters trigger when the count passes N
  (CR 715.2b), and it's sacrificed at its final chapter once no chapter ability of its own waits (CR 704.5s).
  Putting counters is now an event ("whenever one or more +1/+1 counters are put on this"). Triggers are now
  collected before state-based actions each time (CR 603.2), so an event's triggers see the board as it was. Read
  ahead (CR 702.155) is refused. Most Sagas still wait on their chapter effects; the gap ranking shows which.
- Reflexive triggers (-> 5,116): "you may X. When you do, Y" makes Y a triggered ability of its own (CR 603.12),
  its targets chosen as it goes on the stack, not with X's. Read after a "you may" only; found again from the
  source's own definition as it resolves. The card gaps now name the missing effect for every trigger kind the
  engine handles, not just "trigger:<kind>".
- Rules review of sacrifice triggers and Sagas (2026-11-25), all fixed with tests: a permanent's own "whenever a
  player sacrifices a permanent" (Mayhem Devil) now sees its own sacrifice, and permanents that leave together
  see each other leave (CR 603.10a; zone changes carry a group, shared by state-based actions, edicts, costs and
  "destroy all", CR 704.3); state-based actions are checked again after a trigger is removed for want of a
  target (a Saga whose last chapter had none, CR 603.3d, 704.5s); counter triggers follow the object by
  incarnation (CR 400.7); "whenever a counter is put" triggers once per counter (CR 603.2c). Still open from it:
  tests for a Saga played through real turns, an opponent's Saga in your main phase, a countered last chapter,
  and Carrot Cake's own sacrifice.
- Next: rank the unsupported refusals by missing piece and build from the top; the state kept outside GameState
  (until-end-of-turn pumps and effects, pending triggers, a cast or resolution in progress: setup.odin's Game) into
  the state, for saves and for fixtures that start with such an effect; TapLandForMana; mana pool order.
- Step 3 progress (2026-11-24, night 2): you may / if you do, library search and shuffle, sacrifice effects,
  counterspells, blink and graveyard either-or targets, each player / each opponent instructions, cycling,
  required additional costs, kicker, predefined tokens (Treasure, Food, Clue, Shard, Heartwood; others
  unsupported), whenever you attack, Nth spell and opponent-cast triggers, activation restrictions. Rules tests:
  62. Coverage: 4,138 of 15,772.
- Edit to app (measured 2026-11-24, 4-core container, one core busy with a replay): `scripts/build-odin-engine.sh
  dev` 13.8 s, then the running `ENGINE=odin` dev server reloads the page 0.4 s later: about 14 s from an engine edit
  to the app. LLVM code generation is 88% of the build (type check 1.1 s, which is the quick check after an edit);
  `-o:none` and `-use-separate-modules` save little. Rust's dev build here: 18 min cold, then out of memory.
- Step 3 progress (2026-11-24, late): X spells, modal spells (choose one), up to N targets, cost reductions,
  intervening-if triggers, instruction conditions, painland/pay-life/sacrifice mana riders, conditional
  enters-tapped lands; the stack now holds each instruction's targets (as Rust's state does), so it resolves after
  a save/restore. Rules tests: 48. Coverage: 3,525 of 15,772. Rust self-replay of the capture: about 94% of
  recordings replay cleanly on Rust (the usable fixtures); a sample of 200 of those on Odin: 9 pass, almost all
  failures being cards the Odin engine reports unsupported.
- Step 2/3 start: `odin/engine/game/setup.odin` starts a game from the CR (103: libraries shuffled with the seeded
  generator, starting life, seven-card hands, mulligan decisions in turn order); `game_calls.odin` serves
  `initialize_game` (decks checked against the format first, as Rust does), `get_game_state`,
  `export_game_state_json` and `restore_game_state`. The card database is now indexed on load and each card decoded
  on first use: load ~4 s instead of ~15, memory ~0.5 GB instead of 1.5 (the eager decode also overflowed 2 GB under
  the comparison's 40,000 calls).
- Step 2 (2026-11-24): `odin/engine-wasm/` serves the match setup page. Start Match enables in the app on the Odin
  engine (`cd client && ENGINE=odin pnpm dev` after `scripts/build-odin-engine.sh dev`, ~5 s). Real: the card
  database, the fixed tables (format registry, LLM catalog, bracket table, Horde decks, per-format deck supply and
  best-of-three ceiling, embedded from `static.json`, which `snapshot-static.mjs` regenerates from the Rust build), the
  sideboard policy, and the deck checks (`decks.odin`). `compare-rust.mjs` runs both engines in Node and compares:
  the tables and lookups agree exactly; the deck checks agree on all 1,396 precon decks for the constructed formats
  and Commander. Not yet: engine coverage in the deck check (omitted, not faked: it's step 3's number), the other
  Commander variants, Brawl, Oathbreaker, Limited and the casual formats (the Odin engine answers "no opinion", null,
  where Rust gives a verdict), the summary check's choice of first failure, unaccented name aliases, the bracket
  estimate (null). Next: `initialize_game`.

Rust baseline (measured 2026-11-24, this cloud container: 4 cores, 15 GB): `./scripts/build-wasm.sh wasm-dev` from
cold compiled for 18 min 15 s, then wasm-bindgen was killed for lack of memory on the 260 MB debug-info module, so
the dev engine build doesn't complete here without stripping `.debug_*` first. That is the loop the Odin engine
replaces.

## Paused (2026-11-24, ~17:25 UTC, owner's request)

The owner asked to pause all work. The three parallel sessions (D-185) were told to commit, push and stop;
the scheduled check-in was deleted. PR #119 stays open, unmerged. Where the translator stood: 52.5% of engine
functions translated, 54.2% of executed ones; vector check clean (728 pass, 0 unexplained failures) as of
a216a17. Next when resuming: tuple field access (`f(..).0` on a returned tuple: `._0` in the model) was written
but reverted untested; then the executed-blocker list (`translate-report` with ODINGEN_EXECUTED).

## Working with the owner
- Owner (2026-11-25): "keep running checklists of what rules have been marked completed in the comprehensive rule
  set. Like a coverage report, like you're currently doing with the cards, but for the rule set as well." Keep a
  CR coverage report for the Odin engine (tools: odin/engine-wasm/rules-coverage.mjs, report in
  docs/odin-rules-coverage.md), regenerated with each engine change and reported alongside card coverage.
- Owner (2026-11-24): "something I wanted to call out that I think is great is the fact that CR rules are cited
  heavily throughout the code - continue to do so because the CR is the source of truth on how MTG works". Keep
  citing the rule (looked up in rules/, never from memory) in every rules comment and test of the Odin engine.
- Owner (2026-11-24) asked whether the Rust integration tests validate card coverage. Not yet: coverage is a static
  check (every part of the card's parsed text is implemented). Plan: once the capture finishes, replay it on Rust
  (keep the clean recordings), then on Odin (pass rate), and map tests to the cards they use, so a card counts as
  validated only when its tests pass on Odin. Report that validated number as the coverage.
- Owner (2026-11-24): "anything that can be ran in the background reasonably, do it". Builds, test runs, captures,
  comparisons and browser checks run as background jobs; work continues meanwhile.

- Owner (2026-11-24): the running progress messages had no value to them ("probably a lot of value to you, but
  none to me"). Report only what matters to the owner, in plain terms and briefly: milestones reached (a recorded
  game replaying in Odin, a PR merged, performance numbers), decisions or approvals needed, and problems that
  change the plan. Keep translator internals, percentages and per-fix detail in this file and the commits.
- Owner (2026-11-24), on whether the 11,160 usable fixtures are comprehensive: they aren't. Only 2,130 of the
  15,772 pool cards appear in a usable fixture (2,449 in any captured one), so "all of a card's fixtures pass on
  Odin" can't exceed about 2,100 cards. Proposed filling the gap with Rust AI-vs-AI games whose decks rotate through
  the pool, recorded and replayed on Odin. Owner: "we can stick with the 11,000 fixtures for now. I think once the
  engine is fully fleshed out, we can consider covering any gaps." So: grow the engine against the 11,160 fixtures
  and the static coverage check; report both the fixture pass rate and fully supported pool cards; take up the
  gap recordings only once the engine is fleshed out (ask then).

## Known issues
- (2026-11-25, found while building the Odin engine) The Rust engine may read Book Devourer's "discard all the cards
  in your hand. If you do, draw that many cards" as the combat damage: its "that many" (EventContextAmount)
  checks the triggering event's amount before the preceding instruction's count (quantity.rs
  event_context_amount). By the card's wording it's the number discarded. Unconfirmed in play; Odin refuses
  "that much" after a first instruction until it tracks such counts.
- (2026-11-25, owner: "CI is failing over and over on GitHub") Fixed in e45b75b: the Odin workflow's model check
  failed on every push since a7e7ad1, which hand-edited the generated codecs in an order odingen doesn't emit.
  Regenerated; run 112 (e45b75b) passed every step, both round trips included. Check CI after each push, not
  only the local suite. Pending runs show as "cancelled" when a newer push replaces them in the queue: push in
  batches.
- (2026-11-25, Odin native tests) Fixed: the full native suite hung from 65c6e65 on: two tests emptied the hand
  through a copy of its persistent vector, so the loop never ended and memory grew until the container killed it.
  Runs reported in between as passing hadn't finished; the hang also hid two stale expectations (Ancient Tomb and
  Karplusan Forest became supported with the mana riders; Wild Mongrel's color choice isn't). Now the suite (70
  tests) runs in under a second; run it under a memory cap (ulimit -v) and check for "Finished N tests".
- (2026-11-24, Odin engine, rules-judge review of 9ab9548..7429070) Fixed, with tests: (1) "sacrifice this" and
  "exile this" acted on the new object after a blink (CR 400.7); (2) a blinked token came back (CR 111.8) and
  exiled tokens never ceased to exist (CR 704.5d); (3) accepting an impossible "you may" counted as "if you do"
  (CR 608.2d); (4) a Treasure could pay mana and be sacrificed for the same spell's additional cost (CR 601.2h);
  (5) filter comparisons against a target's amount were evaluated with no target (Fell the Mighty); (6)
  activation cost reductions were ignored (channel lands); (7) legal actions listed no choose-two modes; mode
  order cited 700.2d instead of 608.2c; spell-cast records said "hand" for commanders; a scoped instruction's
  condition was rechecked after each player.
- (2026-11-24, Odin engine, rules-judge review of bdedbc4..cceba79) Fixed, with tests (1-5, 7, 8): (1) a dies trigger's intervening
  "if" read the card in the graveyard, not the creature as it last existed (CR 603.10a, 608.2h; Deathknell
  Berserker); (2) mana value ignored X on the stack (CR 202.3e); (3) a mass "creatures can't block this turn" was
  locked to the creatures present on resolution (CR 611.2c); (4) heroic missed targets of a spell's later
  instructions; (5) "pay life" mana riders didn't check the life total (CR 119.4); (7) a false instruction
  condition dropped later independent instructions; (8) the gap report listed supported X spells. Open: (6) "that
  creature's controller" should use last known information once control-changing effects exist; the intervening
  "if" is first checked when triggers are collected, not at the event; the player doesn't choose which mana
  abilities pay (CR 601.2g), so automatic payment may take painland damage or sacrifice a land. "Each player"
  instructions are carried out player by player in turn order; CR 101.4 has the choices made in that order and
  the actions happen at the same time (matters for triggers on those actions).
- (2026-11-24, Odin engine, rules-judge review of odin/engine/game at f7800b5) Being fixed now: (1) only a permanent's
  first mana ability was used (dual lands made one color; CR 605.3a); (2) mana-ability riders (damage, "activate only
  if", spending restrictions, extra mana) ignored while the card counted as supported; (4) creatures that left the
  battlefield stayed in combat (CR 506.4, 510.1d); (5) the engine tapped creatures for mana before lands; (6) greedy
  color assignment called payable costs unpayable (CR 601.2h); (7) Phyrexian and {2/C} symbols had no alternate
  payment (CR 107.4e-f): such cards now unsupported; (8) the support gate let through player scopes, chosen groups,
  mass pumps parsed as single-target "any", typed filters without types; (9) duplicate ids in discard/bottom
  choices, blocking with a card in hand, conceding for the other player; (10) no mana cost treated as free
  (CR 118.6); (11) no priority in the declare attackers step when nobody attacks (CR 508.2); AI cast -N/-N on its own
  creature. All fixed (22908e5, 75a7403), each with a
  rules test in odin/tests/game: (3) the attacking player now divides damage among blockers and trample excess
  (CR 510.1c, 702.19b); targets are checked against the incarnation they had when chosen (CR 400.7, 608.2b; landed
  in 75a7403 with the damage division).
- (2026-11-24, Odin port, translator) The model holds sets as Vecs, so set operations were translated as Vec ones:
  `set.remove(&id)` became `Vec::remove(index)` (the vector check caught a crash; a small id would have removed the
  wrong element silently), and collects into a `BTreeSet` would have kept neither its order nor its uniqueness. Fixed:
  set operations and collects look up the Rust type (fields, parameters, a let's annotation or constructor, the
  function's result, a turbofish); BTreeSets stay sorted, HashSets deduplicate (their Rust order is random, so not
  observable); an unseen destination in a function using sets is refused.
- (2026-11-24, Odin port, translator) Two silent mistranslations in code that type-checked cleanly, found by probes:
  (1) Odin's unlabelled `break` inside a `switch` leaves only the switch, so a Rust `break` in a `match` arm inside a
  loop was translated as a no-op; fixed: every translated loop is labelled and `break`/`continue` name it.
  (2) Bindings from a mutable reference (`let x = &mut ..`, `if let Some(x) = opt_mut`, `for x in v_mut`,
  `as_mut`/`get_mut`/`*_mut`, `ref mut`, `match self` in a `&mut self` method) became copies, losing writes;
  now refused (320 functions, plus 183 that return `&mut`) until the pattern compiler binds pointers. Hoisted
  statements under `&&`/`||` (which would run unconditionally) are refused too. Lesson: a clean type check proves
  little. The vector check then found two more, both fixed: (3) free functions were looked up by bare name, so
  `players::is_opponent`, which delegates to `topology::is_opponent`, called itself (now resolved by module path or
  the caller's file, ambiguous calls and shared procedure names refused); (4) `Some(Vec::new())`, `Some(None)` and
  `Err(Default::default())` became untyped `{}`/`nil`, which Odin reads as None/no error (now typed explicitly).
- (2026-11-24, Odin port, to handle in O-2's state comparison) A HashMap whose keys Odin can't hash
  (`HashMap<CounterType, u32>`, `im::HashMap<StaticGateKey, bool>`) is a list of pairs in the Odin model, and the
  translation appends a new key, while Rust serializes such a map in its hashing order. Two pair lists with the same
  entries in different orders are equal maps, so comparisons of these fields (the replay harness, the vector check)
  must ignore order. BTreeMap inserts into pair lists are refused until sorted insertion is written.
- Fixed (2026-11-24, D-184): PtDirection's tag is now `direction`, so a pump's slot detail reads
  `{"type":"Modification","direction":"Increase"}`; TargetEffectDetail reads through a wire enum (`serde(from)`) that
  also takes the form saved games already hold (`{"type":"Increase"}`, after the client's `JSON.parse`) as a
  Modification. Test: `paused_pump_target_prompt_round_trips_through_json_values` (ability_utils.rs) round-trips a
  state paused on a pump's target prompt through `serde_json::Value` and loads the legacy form. The Odin model was
  regenerated. The original report:
- (2026-11-24, found by the Odin port) A game state whose WaitingFor holds a target slot with
  `TargetEffectDetail::Modification(..)` can't round-trip through `serde_json::Value`: serde writes `"type"` twice
  (`{"type":"Modification","type":"Increase"}`, an internally tagged enum inside another with the same tag) and a
  Value's map keeps only the last. Direct to/from strings is fine, but the client does go through objects: the
  wasm bridge's `to_js` parses the engine's JSON with `JSON.parse` (last key wins), and `WasmAdapter.restoreState`
  sends a `JSON.stringify` of the stored object back to `restore_game_state`. So recovering or resuming a game paused
  on a target prompt for a P/T pump (`TargetEffectDetail::Modification`) would fail to restore ("unknown variant
  Increase"). Pre-existing in the Rust app, not yet reproduced in the browser. A fix changes a wire format (e.g.
  PtDirection written as a plain string), so it waits for the owner's go-ahead.
- (2026-11-23, UX review of M3-05, in both layouts, not yet fixed) The zone browser crops its card at the right; the
  main button disabled ("No Attacks / Not yet: 1 must attack") reads as bare text, without a button's shape.
- Fixed (2026-11-23, found while planning the pacing slice): the whole-game e2e (`playWholeGame`, M3's acceptance,
  D-171) stopped at the first `role="status"` element, and since the turn banner (PR #104) is one, it ended at the
  first new turn instead of the game's end. It now waits for the result itself and checks its text.
- (2026-11-23, owner) "Idk what the plan is but the auto pass feature is a bit jarring currently. Things just progress
  instantly and I get confused lol". The same cause as the "two lands" report: the host auto-passes (D-143, D-157)
  and the opponent acts, and the screen jumps to the result with nothing shown in between. The plan's answer is
  opponent-action pacing and step-by-step showing (ui.md "Pacing for the opponent"; M3-07, M3-12), pulled forward to
  come right after M3-04c (D-172).
- (2026-11-23, owner, after trying the pacing) "something I noticed is that when there's something on the stack to
  resolve, it's not immediately obvious that there's something on the stack. maybe the UI can represent this in more
  clear, clean, and minimal way". Next task (D-173).
  Then: "I know that forge mtg has a UI on the side that shows a list of things on the stack that need resolution - I
  wonder if we could have something similar but more polished lol" (D-173).
- (2026-11-23, owner) On the zone browser's spacing after the fix: "card spacing is okay for now, we'll revisit
  later". Left open for a later look; not blocking.
- (2026-11-23, owner) "I noticed that the cards in the hand, graveyard, exile view are spaced really far apart": the
  zone browser's row (D-168). Chromium draws it tight (140 px cards 8 px apart), so most likely the owner's Safari: the
  card was sized by `aspect-ratio` on a button and its image by a percentage height inside it, either of which Safari
  can resolve to the image's natural 488 px width. Fix pending the owner's check on the phone (slice 7's PR): the
  card's width and height set outright, what's inside pinned to its box (no percentage heights), no
  `content-visibility`, a 6 px gap; an e2e pins the proportions and the gap. Can't be checked here (no WebKit).
- Fixed (2026-11-23, owner): "sometimes I get to play two lands on one turn and I'm not sure why - I could be
  misunderstanding due to how the auto pass works but it's rather strange." Not the engine: eight seeded games played
  through the worker as the app plays them never gave two land drops in one turn (CR 305.2). The auto-pass (D-143,
  D-157) did it: one press of the main button could run through the opponent's whole turn (and keeping a hand on the
  draw went straight to turn 2), with nothing on screen to say a turn had passed, so the next turn's land drop looked
  like a second one. Now a new turn shows a banner for a moment ("Turn 6 · Your turn"), as Arena marks a turn's
  start (`interaction/turn-banner.ts`). Test: apps/web/test/turn-banner.test.ts (the banner, and a seeded game: one
  land per turn, and one press crossing the opponent's turn). Seeing what the opponent did meanwhile is M3-07's
  pacing and animation.
- (2026-11-23, M3-04c card view code review) A token's card view shows its name, type line and keywords, but not its
  other abilities' text: the seat view carries no rules text for a token (its abilities are data from the effect that
  made it). Ajani Goldmane's Avatar's "power and toughness are each equal to your life total" is the case in the pool.
  Later: carry a token's rules text in the seat view (the effect that makes it has it), and show it.
- Fixed (2026-11-23, owner): "When I only had a mountain played, llanowar elves (1 green mana card) was available as an
  action to cast, which is incorrect." The engine may list a spell the player can't pay for: beginning to cast needs
  only permission (CR 601.3), and a cost that can't be paid rewinds the cast (CR 601.2h, 734). The app greys out what
  the seat view's `mightPay` hint says can't be paid, but that hint, when the auto-payer found no payment, answered
  yes whenever the total mana was enough, ignoring colour: one Mountain was "enough" for {G}. Now it also needs, for
  each coloured symbol, that many pool mana or sources able to make that colour (`manaByType`), so a no is always
  right. The same hint drives auto-pass and the CLI brief, which no longer stop for or list such spells. Test:
  packages/engine/test/view/seat-view.test.ts (Llanowar Elves with one Mountain, then with a Forest).
- (2026-11-22, M3-02 code review) The `random` agent can spend tens of thousands of actions under Prized Unicorn's
  block requirement, adding and taking back blocks at random, until the host gives up (`HostStuck`, 100,000 actions):
  about one game in 1,500 of `pnpm eval`, which counts it void (D-145). Only the test agents do this (the heuristic
  uses `finishable`, D-144). If it starts to matter, have `random` skip take-backs while it has other choices.
- (2026-11-22, M2-14i rules review) Convincing Mirage on a Clone that copied a land (a Forest Awakener Druid animated)
  leaves the copy in place: the permanent stays a Forest copy whose land type is Island. CR 305.7 says a land whose
  type is set loses "any copiable effects affecting that land", but then it's Clone's own 0/0 Shapeshifter creature,
  not a land, and whether Mirage still applies is a dependency question (CR 613.8) with no ruling found yet (the
  judge's web search was blocked). Rare (three specific cards), so left as built until settled (D-080: rulings, then
  judges, then the owner).
- (2026-11-20, M2-08d rules reviews) Choices between prevention effects are asked per damage entry (D-088), which is
  finer than CR 616.1's "the way an event affects an object or player": with two attackers, Guardian Seraph and Fog,
  the player is asked once per attacker and can order them differently. Life totals can't differ with today's pool;
  only how `DAMAGE_PREVENTED` splits. Changing it reverses D-088; the owner left Harm's Way out (D-090), so it stays as built until a card needs it.
- (M2-07c2, M2-08b) `playerView` and `pnpm cli show` don't list waiting delayed triggers (`GameState.delayedTriggers`)
  or regeneration shields (`GameState.replacements`), though both players know of them (Dragon Whelp to be sacrificed
  at the next end step, Drudge Skeletons shielded). The match UI (M3) should show them.
- (D-083 review) A golden game's rejection names the action number (`!! action 78 is rejected`), not the stored line,
  and a run of passes folds many actions into one line, so finding it in the JSON takes counting. The decoder could
  report the line too.
- The golden folder's budget is 16 MB through M2 (D-081). With the compact encoding and the mechanics cover (D-082) it's
  1.7 MB for 152 cards, and grows with new mechanics, not new cards.
- (D-071) Two tramplers blocked by one creature (two Stampeding Rhinos into Palace Guard): the attackers' divisions are
  worked out one after the other, so the first can't count the second's damage toward lethal. The player can be dealt
  the same totals, but a split where both Rhinos trample over (2 and 2 each) can't be chosen. With a deathtouch trampler
  the totals differed by declaration order until the M2 exit review: deathtouch tramplers now go first, so the most
  damage can always trample over; a split giving the player less than that can still be unreachable. The CR checks the whole assignment at once (CR 510.1e): that needs a decision that
  can be taken back or checked as a whole (06c's take-back answer may serve).
- Fixed (PR #34, D-069): golden games grew by about 2 MB per M2 task; `pnpm golden:cover` now adds short games. The
  folder is 4.0 MB after M2-06d; the owner raised the budget to 8 MB for M2 (D-073).
- The bench drifted 10–29% over its baseline through M2-05–06b; reset in M2-06c (D-072), when the `random` agent's games
  changed with the declaration list. Measuring is noisy here (two runs of one commit can differ by 30%): compare paired
  against `main` before believing a failure.
- `pnpm fuzz --games 300` takes about 7–8 minutes (it was 2–3 in M1). Profiled (2026-11-20): the engine isn't slower
  (a bare game takes 100–200 ms; the bench is within its baseline). The time is the checks after every action, about
  19 times the games themselves: the leak check (`scrambleHidden` and comparing whole views, ~60%) and the legal-action
  check, times long random games (~45 turns, ~28 priority passes a turn). The fuzzer's picker by kind (D-061) cut it
  by about a fifth. Further cuts would weaken the checks (run the leak check on fewer actions); not worth it yet.
