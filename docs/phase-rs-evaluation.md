# Evaluation: building on phase-rs (2026-11-23)

The owner asked whether to fork [phase-rs/phase](https://github.com/phase-rs/phase) and build on it: "what I really want
is it's rules engine and frontend client when playing matches against an AI ... we would save a ton of time and would be
able to get started on the higher value initiatives like an LLM powered opponent and the single player RPG or rogue
like" (status.md, Open questions). This file records what was found. No decision is made here.

Method: a shallow clone of `main` at 57c647e (v0.131.0, 2026-11-23) read by two reviewers (engine; client and AI),
claims spot-checked by hand, and the hosted game at phase-rs.dev driven with Playwright at 812x375 (the folded phone)
and 1000x860 (unfolded) and 1280x720. Not done: building it (its own script says about 25 minutes of WASM and Vite; it
needs a pinned nightly Rust and an MTGJSON download), and a full played game with spells cast (only turns passed).

## What it is

- A Rust MTG rules engine compiled to WASM, a React/TypeScript client, a Tauri desktop app, an installable web app,
  and optional online multiplayer (separate server crates). MIT or Apache-2.0. Card data from MTGJSON; images from
  Scryfall at runtime.
- About 34,300 cards, parsed from Oracle text by a hand-written parser into a typed syntax tree; clauses it can't
  parse become `Unimplemented` and the card is marked unsupported. The site reports 84-94% coverage by format.
- Very active: PR numbers past 11,000, a release every few days, developed largely by LLM agents.

## Rules engine

- `apply(&mut GameState, actor, action)` over persistent (structurally shared) collections; pending decisions are a
  `WaitingFor` enum in state (about 150 kinds); seeded RNG; JSON save and restore (the RNG is rehydrated).
- Hidden information: `filter_state_for_viewer` blanks what a player can't see; one state type, no separate view type.
- Broad rules: layers with dependencies (CR 613.8), replacement effects, triggers, the stack, combat, Commander,
  Archenemy, Planechase, Horde and a boss mode. About 55,000 tests, many citing the CR, but no check that every
  cited rule has a test, and no random-game fuzzer.
- Size: about 4.3 million lines of Rust (about 1 million without tests); single files of 40,000-75,000 lines
  (`game_state.rs`, `triggers.rs`, `casting.rs`, `layers.rs`); no per-crate READMEs.
- For the RPG: games take a seed, a format config (starting life, deck size, teams) and decks; custom formats, Horde
  and a boss mode exist; custom cards can be written as Oracle text the parser understands or as its syntax tree in
  JSON. Custom starting boards are a test-only feature (or debug actions); deeper rule tweaks mean editing the engine.

## AI and LLM opponent

- `phase-ai`: game-tree search, a planner, per-card policies. Checked: every shipped difficulty runs with
  `determinization_samples = 0`, so the AI's search sees the opponent's real hand and library
  (`crates/phase-ai/src/config.rs`; the fair mode exists, `determinize.rs`, but is off by a product decision of
  2026-07-18). Our D-137 information parity would need it on, at some cost in speed or strength.
- `phase-llm`: an LLM opponent already exists. The browser calls the provider with the player's own key (OpenAI,
  Anthropic, Gemini, DeepSeek, OpenRouter, local OpenAI-compatible); the prompt renders the filtered player view; the
  model picks the index of a legal action, falling back to the heuristic AI. It uses no tools, unlike our
  llm-opponent.md design.

## Client (matches against the AI)

- Runs entirely in the browser: the engine in a web worker, AI workers in a pool; servers only for multiplayer and
  optional cloud sync. The card data file is served from the app's own address, so a fork hosts its own; audio and
  some data come from `data.phase-rs.dev` by default (build-time settings).
- Far broader than ours: a prompt for nearly every decision, targeting arcs, mana payment, combat assignment, a stack
  panel, stops, animations from engine events, WebGL effects, audio, i18n in nine languages, deckbuilding, drafting.
- On a phone in landscape it's the desktop layout scaled down (a hand drawer under 1024 px wide); nothing specific to
  foldables. Our phone layout and the Arena behaviours the owner asked for (D-171 to D-176) have no counterpart.
- About 244,000 lines of non-test TypeScript (ours: about 8,600), files up to 7,000 lines, caret version ranges, unit
  tests but no browser end-to-end tests.
- To check before shipping a fork: credit for CC-BY music (none found in the app), sources for some audio and
  battlefield art, committed MTGGoldfish deck feeds, and telemetry (off unless a build sets its address).

## Options

1. **Fork engine and client, tracking upstream.** Fastest to tens of thousands of cards, effects, audio and an LLM
   opponent. Gives up "nothing a black box" (CLAUDE.md) and the TypeScript reducer (architecture.md); our phone layout
   work would be re-done inside their client; a nightly Rust toolchain; a fast LLM-written change stream to merge or
   fall behind. RPG and phone work belong in separate modules, not inside their large files.
2. **Our client on their engine (WASM).** Keeps our phone UX and readable client; the engine is still a black box;
   our HUD would need to cover their roughly 140-150 decision kinds (portable from their client file by file).
3. **Stay on ours, borrowing.** Keeps every current rule; borrow their tests as references for tricky cards, the idea
   of parsing Oracle text, and their no-network LLM request design. Slowest to many cards.
