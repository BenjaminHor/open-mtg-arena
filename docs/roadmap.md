# Roadmap

The end goal is an accurate rules engine defined by the Comprehensive Rules: eventually every rule two-player games
use, each built and tested with the cards that use it (D-051). So rules depth comes before the app.

Each milestone ends with something the owner can check. Detailed task lists live in
`docs/milestones/`; only the current and next milestone get detailed specs.

## M1 — Engine foundations (headless)
A pure engine that plays complete two-player games of simple cards, with the testing tools
to prove it: scenario runner, headless CLI, invariant fuzzer.
**Done when:** random-legal games of the prebuilt decks run to completion over 1,000 seeds
with no invariant failures, and every rule in the M1 spec has scenario tests. Spec: `milestones/m1-engine-foundations.md`.

## M2 — Rules depth
Triggered abilities beyond the basics, the full layer system with dependencies (CR 613), replacement
and prevention effects (CR 614–616), activated abilities with costs, counters, tokens, auras and
equipment, and the common evergreen keywords. The pool grows to roughly 200 cards (likely one or two
classic core sets).
First, the hidden-information fix the AI will need (status.md, Known issues). Spec: `milestones/m2-rules-depth.md`.
**Done when:** the pool is fully scripted and tested (including interactions), the fuzzer is clean over 10,000 games,
and mutation testing has been set up with surviving mutants in rules code addressed.

## M3 — First playable
The web app: a touch board with folded and unfolded layouts, the engine in a worker, a heuristic AI,
prebuilt decks from the M2 pool, card art downloaded on first run, bug-report export. Deployed as a static site.
**Done when:** the owner plays full games against the AI on the iPhone Duo, both folded and
unfolded, and on a desktop browser. Spec: `milestones/m3-first-playable.md` (to be revised for M2's pool).

## M4 — Deckbuilding, collection and the Arena shell
Everything tagged **[core]** in `deckbuilding.md`: card browser and search over every Magic card, the deck
editor with categories, stats, validation, the land helper and import/export, and the collection with Sandbox
and Collection modes. Plus pack opening with rarity slots, starter decks, save export/import, settings, and an
art download manager. The **[next]** items (sample hands, goldfish, probabilities, version history) follow right after.
**Done when:** a new player can open packs, build and validate a deck on the phone, import a decklist pasted from
another tool, play the deck, and keep everything across sessions.

## M5 — Single-player RPG
A world map, areas, encounters with themed enemy decks and rule modifiers, shops, card rewards,
progression and save slots. Built in `packages/meta` on top of the unchanged engine.

## Ideas for later (not scheduled)

- **The engine in Odin (owner, 2026-11-23).** After the phase-rs import (D-177), the owner asked what porting its Rust
  engine to Odin would take: "We can consider it for the future. I think Odin is better than rust". Not impossible:
  Odin's tagged unions map Rust's enums, it has JSON and a WebAssembly target, and it compiles far faster (our Rust
  engine takes about 20 minutes from scratch). The cost is a rewrite of about a million lines plus the parser and
  the browser bridge, by hand where no library exists (serde, `im`, nom, wasm-bindgen). If taken up: move the tests'
  scenarios to a language-neutral form first, then port subsystem by subsystem behind the same browser bridge,
  checked against the Rust engine on the same games; a cheap first look is porting one small subsystem (combat
  damage) and comparing compile time and clarity. The owner: "the Odin rewrite would have to be its own set of
  milestones for sure", so it gets its own milestones when it's scheduled.
  Then (2026-11-23): "Honestly, once everything checks out let's just say yolo and plan out the rust to odin
  rewrite". So once the import is merged, deployed and checked, the next piece of work is a written plan for the
  rewrite (its milestones, a first spike), for the owner to approve before any of it starts.

## Always
- Grow the card pool steadily with the `add-cards` skill, and with it the rules, toward every rule two-player games
  use (CR chapters 1 to 7), the most common mechanics first (D-051). Multiplayer and casual variants (CR 8, 9) stay
  out unless the owner decides otherwise.
- Every bug the owner reports becomes a scenario test before it's fixed.
- Refresh `rules/` when Wizards publishes a new Comprehensive Rules.
