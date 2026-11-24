# Decision log

Short records of decisions, newest last. Don't reverse a decision without asking the owner.
To change one, add a new entry that supersedes it and say why.

Format: **D-number: title** · date · status. Then context, decision, consequences in a few lines.

---

**D-001: Free, non-commercial fan project** · 2026-11-19 · accepted
It uses real Magic card names, Oracle text and Scryfall images under Wizards of the Coast's fan content
expectations and Scryfall's API terms. No monetization of any kind. Card images are never bundled; they
download at runtime (D-007).

**D-002: Pure reducer engine with decisions stored in state** · 2026-11-19 · accepted
The engine is `applyAction(state, action) -> { state, events }`. Choices in the middle of resolution
are `PendingDecision`s in state, and in-progress work is a queue in state (see architecture).
This gives saves anywhere, replays, determinism, AI simulation and easy testing.

**D-003: Card effects are data, not functions** · 2026-11-19 · accepted
Card definitions are typed TypeScript objects made of effect nodes, interpreted by the engine.
State stays serializable, and a person can read a card definition and check it against the Oracle text.

**D-004: TypeScript monorepo with pnpm workspaces** · 2026-11-19 · accepted
One language for engine, AI, CLI and UI. Strict TypeScript. Tooling: pnpm, Vitest, Biome (lint and
format), Vite (web app), Playwright (end-to-end, from M2). Node: current LTS.
Port hot paths (AI search) to something faster only if benchmarks demand it.

**D-005: No server; static PWA** · 2026-11-19 · accepted
The app is a static site (hosting: see D-015) with a service worker for offline play.
Saves, collection and art cache live in IndexedDB and the Cache API. There are no accounts and no backend.

**D-006: Engine and AI run in a Web Worker** · 2026-11-19 · accepted
Keeps the UI smooth while the AI thinks. The worker protocol is plain JSON messages.

**D-007: Card data from Scryfall at build time, art at runtime** · 2026-11-19 · accepted
A build script extracts Oracle text and rulings for the card pool from Scryfall bulk data and commits
only that small subset. On first run, the app downloads images for the pool directly from Scryfall's
image hosts and caches them. Artist credit is always visible with full-card images.

**D-008: Comprehensive Rules stored in the repo, split per section** · 2026-11-19 · accepted
`scripts/fetch-rules.mjs` downloads the official TXT and writes `rules/`. The generated files are
committed, so every session (including Claude Code on the web, which may not reach wizards.com) can search them.

**D-009: DOM-based board UI (React), not canvas, to start** · 2026-11-19 · superseded by D-013
DOM elements are easier to test (Playwright can find them), handle touch and accessibility, and
are easier for people to read and change. Animations use CSS transforms. Revisit only if profiling
on the phone shows the DOM can't hold 60 fps.

**D-010: Touch-first, two live layouts** · 2026-11-19 · accepted
Layouts are chosen by viewport size and aspect ratio (not device detection), and switch live when
the phone folds or unfolds. See `ui.md`.

**D-011: Arena-style app first, RPG later** · 2026-11-19 · accepted
The RPG starts after the engine and app foundations are done (M5). Engine features the RPG will need
(custom setups, rule modifiers, save anywhere, `GameResult`) are built from M1.

**D-012: Arena-level polish is a guiding principle** · 2026-11-19 · accepted
The match experience must feel as polished and smooth as MTG Arena: instant touch feedback, readable
animations and pacing, smart auto-pass and auto-tap, clear affordances. The targets are in the "Feel" section
of `ui.md` and are checked with screenshots, interaction tests and performance traces. When polish of the core
match competes with a new feature, polish wins. The board renderer choice follows from this (D-013).

**D-013: Board rendered with PixiJS (WebGL/WebGPU); React for everything else; GSAP for choreography** · 2026-11-19 · accepted
Supersedes D-009. Arena-style effects (glows, particles, spell impacts, card dissolves, foil shimmer,
perspective tilt, many cards moving at once) need GPU rendering with shaders; layered DOM elements with
filters stutter on mobile Safari long before that. So:
- **PixiJS v8** draws the match board: battlefields, hand, stack, cards, arrows and effects. It's a renderer,
  not a game framework, so it fits our own engine and state model.
- **React (DOM)** draws everything that is UI rather than the play area: menus, prompts, buttons, life and
  phase HUD, settings, deckbuilder, collection. DOM text is crisp, accessible and easy to lay out.
- **GSAP** builds animation timelines from engine events (sequencing, easing, interruption), for both Pixi
  objects and DOM elements.
Considered: keeping the DOM board (simplest and most testable, but can't reach the effects bar), Phaser (a full
game framework that wants to own scenes, input and the loop), and Three.js (true 3D, which is far more complexity
than Arena's mostly 2.5D look needs). Testability is kept with a pure board model and a test hook (see `ui.md`).

**D-014: Deckbuilding and collection are a full pillar of the app** · 2026-11-19 · accepted
The app is a one-stop shop: play, browse every card, build and manage decks, manage a collection. The bar is
the Arena deckbuilder, Moxfield and Archidekt. Spec in `deckbuilding.md`. Every Magic card is browsable and
can go in a deck; only cards in the engine's pool are playable, and the UI always says which.
Deck logic and search live in pure packages (`library`, `decks`) so they're tested headlessly like the engine.

**D-015: Private repo, no open-source license; Cloudflare Pages for hosting** · 2026-11-19 · accepted; the license part superseded by D-132 (MIT, public)
The repository is private and has no license file (all rights reserved). Card names, Oracle text, rules text and
images belong to Wizards of the Coast; card data comes from Scryfall under its terms. GitHub's free plan doesn't
offer GitHub Pages or protected branches for private repos, so the app is hosted on **Cloudflare Pages**
(which deploys from private repos), and `main` is protected by convention (CLAUDE.md), Claude Code's
permission settings, and CI, unless the owner's GitHub plan adds branch protection.

**D-016: Pinned dependencies with weekly Dependabot updates** · 2026-11-19 · accepted
Exact versions, a committed lockfile, and Dependabot pull requests that must pass CI. Fewer surprises, and
upgrades happen deliberately.

**D-017: Toolchain versions** · 2026-11-19 · accepted
Refines D-004 with concrete choices made while scaffolding (M1-01). npm packages are exact-pinned (D-016);
Node (`.nvmrc`) and the CI actions are pinned to a major version, and `engine-strict` makes `pnpm install` refuse an older Node.
- **Node 26** (the LTS line in November 2026), in `.nvmrc`, `engines` (`>=26`) and CI.
- **pnpm 10** (`packageManager` in `package.json`), not the newer pnpm 12: 10 is a well-known major, and the
  starter's `.npmrc` settings work with it unchanged. Revisit when a Dependabot PR proposes the major upgrade.
- **TypeScript 7** (the native compiler). Strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
  (the second helps keep `undefined` out of `GameState`). One root `tsc --noEmit` covers every package's source and tests.
- **Vitest 5**, with `unit` and `scenarios` projects so `pnpm test:scenarios` can run alone.
- **Biome 2** lints and formats code and JSON only. It skips Markdown and YAML, which are hand-written docs and
  config (reformatting them adds churn and catches nothing), and the generated `rules/`.
No runtime dependencies were added.

**D-018: No build step; Node runs TypeScript directly** · 2026-11-19 · accepted
Node 26 strips TypeScript types natively, and Vitest does too, so packages export `src/index.ts` and nothing is
compiled. This avoids a build step and a dev dependency like `tsx`. The cost: code must use only erasable syntax
(no `enum`, `namespace` or parameter properties; `erasableSyntaxOnly` enforces it), and relative imports end in `.ts`.
If the web app (M2) needs compiled packages, Vite bundles them from source.

**D-019: Engine purity is checked by the linter** · 2026-11-19 · accepted
The hard invariants in CLAUDE.md are enforced mechanically for `packages/engine/src`, not only by review.
A Biome override there bans Node modules, imports from other packages in this repo, `Date`, `process`, timers,
`fetch`, `console`, `Map` and `Set`, and a small GritQL plugin (`tools/biome/no-math-random.grit`) bans
`Math.random`. Tests may use them. The engine also exports `ENGINE_VERSION`, the current `GameState.version`,
so hosts (the CLI, saves, replays) can reject state from another schema. M1-03 uses it for `GameState.version`.

**D-020: The Comprehensive Rules win over every other spec** · 2026-11-19 · accepted
The owner said (2026-11-19): "if there's conflict in rule logic, the CR trumps all." So when a spec, doc, task
description or owner request conflicts with the current CR on how the game works, the CR wins. Fix the spec to match the CR in the same commit and note it here or in `status.md`. (Questions
that aren't about rules logic, such as product scope, UI or card choices, still go to the owner.)
First application: the M1-13 spec and `architecture.md` mentioned damage assignment order and an `orderBlockers`
decision. The current CR has no damage assignment order. A creature blocked by several creatures divides its combat
damage among them as its controller chooses (CR 510.1c), so that's an `assignDamage` decision.

**D-021: State updates are pure and share structure** · 2026-11-19 · accepted
Engine functions take a `GameState` and return a new one. They copy only the path they change (object spread) and
never mutate their input, so unchanged parts are shared between states. This keeps old states valid for undo, replays
and AI search (cheap clones, `future-rules.md`). Random functions follow the same rule: they take an `RngState` and
return `{ value, rng }`.

**D-022: Objects reference card data by `oracleId`; the stored controller is only the default** · 2026-11-19 · accepted
A game object stores its card's Scryfall `oracleId` and looks up printed values in the `CardDatabase` given to the engine,
instead of copying them. That keeps state small, and later faces, copies and text changes (layers 1 and 3) change which
values apply, not stored fields. Objects store `baseController`, the default controller: the player a permanent entered under (CR 110.2), who cast
a spell (CR 112.2), or who controls an ability on the stack (CR 113.8). Cards in other zones have no controller
(CR 108.4) and questions about it use the owner (CR 108.4a). The current controller always comes from `characteristics()` (layer 2), even before control-changing
effects exist. Zones that belong to a player (library, hand, graveyard) are the owner's (CR 400.3).

**D-023: The engine exports its state types** · 2026-11-19 · accepted
`engine/src/index.ts` exports the types in `src/state/` (`GameState`, `GameSetup`, `Action`, `GameEvent`, ...),
the card data types in `src/cards/` (`CardDatabase`, `CardDef`, ...; D-026) and `RngState`, because every other package builds setups, reads views and sends actions. These are types only, so no
engine internals leak. The RNG functions stay internal for now. The CLI's `random` agent and the fuzzer (M1-17, M1-18)
need seeded randomness to reproduce failures; when they arrive, export `seedRng` and `randomInt` with a new entry here
rather than copying the RNG or using `Math.random`.
It also exports `controllerOf` (M1-16), the single answer to "who controls this?", so tools like the scenario runner
never read the stored default controller themselves; `characteristics()` will cover it once it exists (M1-11).

**D-024: The random number generator and its outputs are fixed** · 2026-11-19 · accepted
All randomness in a game comes from `GameState.rng`: xoshiro128** 1.1, seeded from `GameSetup.seed` (a non-negative safe
integer) by taking two SplitMix64 outputs and splitting each into two 32-bit words, low word first (the same seeding as
rand_xoshiro's `seed_from_u64`). `randomInt(n)` draws until the value is below 2^32 − (2^32 mod n) and returns it mod n.
Saved games and replays depend on these exact outputs, so any change to the algorithm, the seeding or `randomInt` needs
a new entry here and a `GameState.version` bump. Tests pin them with reference vectors and snapshots.

**D-025: The rules coverage report counts citations in engine logic, not type descriptions** · 2026-11-19 · accepted
Comments in `engine/src/state/` cite the CR to explain what a type models (for example X in CR 107.3, or modes in
CR 700.2), even before any rule uses it. Those are descriptions, not implementations, so `pnpm coverage:rules` (M1-19)
ignores `engine/src/state/` when it looks for cited-but-untested rules. Speculative members still don't belong in the
types: a union member or field is added by the task that uses it.

**D-026: Card definitions: a first draft, printed data kept separate** · 2026-11-19 · accepted
- The engine's `CardData` is `{ oracleId, printed, def }`. `printed` holds only rules-relevant printed characteristics
  (name, mana cost, colors, supertypes, types, subtypes, power, toughness), parsed from `pool.json` by `packages/cards`.
  Images, artist and set stay in `packages/cards` for the UI; the engine never sees Scryfall's format.
- `def` is the hand-written `CardDef`. Its effect, cost, target and ability shapes are a draft: M1-08, M1-10 and M1-14
  may reshape them when they interpret them, updating all definitions in the same change.
- Whether an activated ability is a mana ability isn't written in definitions; the engine derives it from CR 605.1a.
  Basic land mana abilities aren't written either; the engine derives them from the basic land type (CR 305.6).
- Printed colors are derived from the mana cost and color indicator (CR 202.2, 204.2), not copied from Scryfall,
  whose colors also count color-defining abilities (layer 5). A test checks they agree for every pool card.
- Extraction and the parser reject anything the engine can't play yet: any layout but "normal", hybrid or X costs,
  `*` power, planeswalkers and battles, a creature without power and toughness. So an unsupported card can't enter
  the pool by accident.
- `packages/cards/src` must run in a Web Worker (D-006): it imports `pool.json` as a JSON module and may not use Node
  modules or Node globals (a Biome override enforces it). Only `packages/cards/scripts` uses Node.
- Generated files are sorted by character codes, not the machine's locale, so they're identical on every machine.

**D-027: Claude Code may merge its own pull requests once they check out** · 2026-11-19 · accepted
The owner said (2026-11-19) that "feel free to merge if it all checks out" stands for the current and all future pull
requests. "Checks out" means: CI is green on the PR's latest commit, the `rules-judge` and `code-reviewer` findings
are fixed or answered, no review comment on the PR is left unanswered, and `docs/status.md` is up to date. Claude Code
merges with a merge commit (keeping each commit) and then restarts its branch from `main`. Anything outside that
(a red CI, an open question for the owner, a PR someone else opened) still waits for the owner.

**D-028: Abilities are named by an `AbilityRef`, not by an index into the definition** · 2026-11-19 · accepted
A basic land's mana ability isn't in its definition (CR 305.6), so "the nth ability in `def.abilities`" can't name it,
and later effects that add or remove abilities (layer 6, CR 305.7) would shift any index. So `ACTIVATE_ABILITY.ability`
and `AbilityObject.ability` are an `AbilityRef`: `{ kind: "printed", index }` for an ability written in the definition,
or `{ kind: "basicLandType", landType }` for the intrinsic mana ability. `characteristics()` lists an object's current
abilities, each with its ref; legality checks look the ref up in that list. Granted abilities and delayed triggers add
kinds when they arrive. Scenarios say `ability: <n>` (the nth ability in that list) only when there's more than one.

**D-029: Card art comes from a chosen printing, pinned per card or picked by a fixed rule** · 2026-11-19 · accepted
The owner chose (2026-11-19): `pool.txt` may pin a printing per card, as `Lightning Bolt [m10]` (a Scryfall set code,
optionally with a collector number: `[m10 146]`). A card without a pin gets its newest regular printing: a paper,
non-digital English printing that isn't a promo or a variant, from a core set or expansion, not a Universes Beyond
crossover, and already released on the date of the bulk file. Ties go to the lowest collector number. A pin always names
an English printing, and may choose one the rule would skip. Some printings slip past Scryfall's crossover tag, and a
beginner-box or showcase printing can win; pin the card when the pick looks wrong. Only if it has none does it fall back to
Scryfall's Oracle Cards pick. Rules data (Oracle text, types, cost) always comes from Oracle Cards; only the printing
details (images, artist, set, collector number) come from the chosen printing. That keeps the art stable across refreshes
and avoids crossover or digital-only printings, without changing any rules behavior.

**D-030: How the game starts** · 2026-11-19 · accepted
- `GameState.turn` is null before the first turn, and `pregame` holds the start-of-game bookkeeping (CR 103): the
  starting player, mulligans taken, who has kept, this round's declarations, and cards still to put on the bottom.
  Code that runs only during turns reads the turn through `currentTurn()`, which throws before turn 1.
- When the setup doesn't name the starting player, a player picked at random from the seed chooses who goes first
  (CR 103.1), as a `chooseStartingPlayer` decision.
- Mulligans follow the current CR 103.5: a mulligan puts N cards on the bottom right away (N = mulligans taken, this one
  included), not when the player keeps. Each card is a separate `mulliganBottom` decision, which keeps every legal answer
  listable and also sets the order. Players who mulligan together answer in turn order from the starting player.
- Every zone change goes through `moveCard` (`engine/src/zones/move-card.ts`), the one place the replacement and
  trigger steps of the event pipeline will plug in. Superseded in part by D-056: they plug in at `happen`, and only
  the pipeline calls `moveCard`.
- Only two-player games start for now: the multiplayer start rules (CR 103.5c, 103.8c) aren't built.
- A standard opening needs at least 7 cards in each deck. That's an engine precondition, not a CR rule (legal decks are
  far bigger, CR 100.2a), so the start of the game can never draw from an empty library.
- Superseded by D-031 for the first turn: M1-05's shortcut to the upkeep is gone, and the first turn walks its steps
  like any other. `legalActions` lists `PASS_PRIORITY` for priority from M1-06.
- In a standard opening every setup permanent starts summoning sick and mana pools must be empty: no turn has begun.
  A fixed opening on turn 1 starts turn order with the active player (the starting player); on later turns it keeps
  seating order.
- Every place that gives priority calls `givePriority` (`game/priority.ts`), where state-based actions and triggers will
  run first (M1-07, M1-12). Every question about control calls `controllerOf` (`rules/controller.ts`), where layer 2 will
  plug in. Draws emit `CARD_DRAWN` as well as `ZONE_CHANGED`.
- The start of the game stays a small state machine over `pregame` rather than moving into the M1-07 work queue: it has
  no stack, priority or triggers, and every wait is already a plain-data decision.

**D-031: The turn sequence is data, walked by one step machine** · 2026-11-19 · accepted
- `TURN_STEPS` (`engine/src/game/turn-steps.ts`) lists every step in order. `endStep` (`game/steps.ts`) ends the current
  step (unspent mana empties, CR 500.5) and begins the next step that isn't skipped; after cleanup the next player in
  `turnOrder` begins their turn. `beginStep` does the step's turn-based actions, then gives the active player priority,
  or, in the untap step and a cleanup with nothing to do, goes straight on (CR 502.4, 514.3). Every step change goes
  through these two functions, so extra or skipped steps, phases and turns, "until end of step" effects and "at the
  beginning of" triggers have one place to hook in.
- A skipped step is passed over as though it didn't exist (CR 500.11, 614.10a): it doesn't begin, has no events and
  gives no priority. `isSkipped` decides it: the starting player's first draw step in a two-player game (CR 103.8a),
  and the declare blockers and combat damage steps when nothing attacked (CR 508.8, via `anyAttackers`, false until M1-13).
- Passing priority is built now so steps can advance: `passesInSuccession` counts passes, a new step resets it, and when
  every player has passed with the stack empty the step ends (CR 117.4, 500.2). M1-07 adds the stack, resolving, the
  reset when a player acts, and the work queue that will drive `endStep`.
- Untapping, removing damage and discarding each go through one function (`permanents/untap.ts`, `permanents/damage.ts`,
  `zones/discard.ts`), and each visible change has an event (`STEP_BEGAN`, `PRIORITY_PASSED`, `MANA_EMPTIED`,
  `PERMANENT_UNTAPPED`, `DAMAGE_REMOVED`, `CARD_DISCARDED`).
- Drawing from an empty library sets `attemptedDrawFromEmptyLibrary` (CR 121.4) instead of failing; state-based actions
  (M1-12) turn it into a loss (CR 704.5b) and clear it.
- The maximum hand size (CR 402.2) and the starting hand size (CR 103.5) are separate constants, both 7.
- Actions the CR makes simultaneous are done as one action: untapping in the untap step (CR 502.3), and discarding in
  cleanup (CR 514.1). The discard is still chosen one card at a time (`discardToHandSize` collects the choices in
  `chosen`), then all of them are discarded together.
- "Controlled since their most recent turn began" (CR 302.6) is set as the turn begins, not in the untap step, so it
  still happens when an effect skips the untap step.
- Setup validation and the step machine share `skipsFirstDrawStep`, so a fixed opening can't start in a draw step
  that CR 103.8a says doesn't exist.

**D-032: The work queue drives the game** · 2026-11-19 · accepted
- `GameState.work` holds what's waiting to happen (`state/work.ts`): `givePriority`, `endStep`, `resolveTopOfStack`,
  `finishCleanup`. `advance()` (`game/advance.ts`) runs items until a decision is pending or the game is over, and every
  entry point ends in it: `createGame` and every branch of `applyAction`. `advance()` throws if nothing is pending and no
  work is queued, since that would leave the game stuck.
- New work goes to the front of the queue (depth-first): work an item creates finishes before older work continues, so a
  spell's effects and the state-based actions after them happen before the priority queued after them.
- `applyAction` clears `pending` before applying an answer, and `waitFor` throws if a decision is already pending, so a
  decision can never be silently replaced.
- Every grant of priority is a `givePriority` work item, where state-based actions and triggers will run first
  (CR 117.5, M1-12). When all players pass, the top of the stack resolves, or with an empty stack the step ends
  (CR 117.4, 405.5). After a resolution the active player gets priority (CR 117.3b) and the pass count starts over.
- Resolution: an ability ceases to exist (no zone change, `ABILITY_RESOLVED`); an instant or sorcery goes to its owner's
  graveyard and a permanent spell enters the battlefield under its controller (`SPELL_RESOLVED`, then `ZONE_CHANGED`).
  Effects and target checks on resolution (CR 608.2b) plug into `effectWork` in `game/resolve.ts` (D-035, D-036).
- Card types are read through `cardTypesOf` (`rules/card-types.ts`), printed types until `characteristics()` (M1-11).
- The start of the game stays a direct state machine (D-030); its answers still end in `advance()`.
- A resolution queues its whole sequence in one call: effect work, then `finishResolving` (CR 608.2n's "final part",
  skipped if the object already left the stack, CR 608.2m), then priority. A spell whose targets are all illegal won't
  resolve (CR 608.2b, 608.3b); that becomes a different final step with M1-09.
- The spec's M1-07 scenario of responding to a spell with an instant needs casting, so it moved to M1-09's acceptance.

**D-033: The scenario runner is its own package, with `yaml` as a dependency** · 2026-11-19 · accepted
Scenarios name real cards, so the runner needs `@mtg/cards`, and the engine may not depend on it. So the runner is
`packages/scenarios` (depends on `engine`; its tests use `cards` for the real card database, and callers pass the
database in). The scenario files stay in `packages/engine/test/scenarios/`,
next to the rules they test. The CLI (M1-17) uses the runner for `new --scenario` and `export --scenario`.
- New runtime dependency: `yaml` 2.9.1 (pinned), the standard YAML parser for JavaScript, with no dependencies of its own.
  It's used only by `packages/scenarios`, never by the engine or the app.
- The runner has no file I/O (`runScenario(text, cards)`), so it runs anywhere. Its `invariantProblems` is the shared
  list of engine invariants the fuzzer (M1-18) will reuse.
- The M1-05 and M1-06 behaviors are also YAML scenarios now (`start/`, `turn/`), as the readable spec. The TypeScript
  tests stay: they check event order and were mutation-tested. The M1-07 stack tests stay TypeScript until casting exists.

**D-034: Mana abilities, paying mana, and the autoPay helper** · 2026-11-19 · accepted
- An object's activated abilities come from `abilitiesOf` (`rules/abilities.ts`): its printed abilities, then the
  intrinsic mana ability of each basic land type (CR 305.6). Whether an ability is a mana ability is decided by CR 605.1a
  (`isManaAbility`). Basic land types and card types are read through `subtypesOf` / `cardTypesOf`, which layer 4 will
  change. Summoning sickness for {T} abilities is one function, `canUseTapAbilities` (CR 602.5a, 302.6), where haste
  plugs in (M1-13); it applies only to creatures.
- A player with priority activates a mana ability with `ACTIVATE_ABILITY`: it doesn't use the stack and resolves at once
  (CR 605.3b), the player keeps priority (CR 117.3c) and the pass count restarts (CR 117.4). Other activated abilities
  use the stack (D-041).
- Which mana pays a cost is the player's choice (CR 601.2h), so a payment is data: how much of each mana type to spend.
  `payFromPool` checks it all or nothing (colored symbols need their color, generic takes any, no partial payment).
- `autoPay(state, player, cost, cards)` proposes a payment: mana abilities to activate, then the payment. It uses pool
  mana first, then lands before creatures, each in battlefield order, and pays colored symbols before generic. With
  sources that each make one color (all M1 cards), that finds a payment whenever one exists (a brute-force test checks
  every small board); sources with a choice of colors will need a search. The scenario runner (`pay: auto`), the CLI and
  the AI use it. The engine exports it with `payFromPool`, `manaValue`, `abilitiesOf` and `isManaAbility` (D-023).
- Activation is split in three (`mana/activate.ts`): `activationProblem` (checks any activated ability needs: zone,
  controller, payable costs; renamed `activationBasicsProblem` in M1-14, with mana now paid during activation, D-041), `manaAbilityProblem` (that, plus it's a mana ability whose effects are all supported), and
  `resolveManaAbility` (pays and adds the mana, with no priority change, so casting can use it while a cost is being
  paid, CR 605.3a, 601.2g). The priority action `activateManaAbility` wraps it. Unsupported costs and effects are
  refused, never skipped. `MANA_ADDED` names its source (CR 106.12).
- `autoPay` only uses sources that make exactly one mana of one type; anything else is skipped until a card needs it.
- The spec's "paying exact costs" and "failing to pay" scenarios need casting, so they moved to M1-09's acceptance;
  M1-08 tests `payFromPool` and `autoPay` directly. "Leftover mana emptying" is a scenario now.

**D-035: Playing lands and casting spells** · 2026-11-19 · accepted
- Timing lives in `rules/timing.ts`: instants whenever the player has priority; every other spell, and land plays, only
  in the player's own main phase with an empty stack (CR 117.1a, 302.1, 304.1, 305.1, 307.1), and one land per turn
  (CR 305.2). Legal targets live in `rules/targets.ts` (CR 115, 115.4, 109.2).
- `castProblem` checks what it can before the card moves (CR 601.2a): it's in hand, the timing allows it, every target
  requirement has a legal choice (`targetSpecsOf` in `rules/targets.ts`), and the spell has a mana cost. It doesn't
  check that the player can pay: CR 118.6 makes even an attempt to cast with an unpayable cost a legal action, so a
  spell the player can't afford is still offered, and they find out at `payMana`, where no payment is accepted and
  cancelling is the way out. `legalActions` and `applyAction` both use `castProblem`.
- Casting is a sequence of decisions: `CAST_SPELL` moves the card to the stack, then one `chooseTarget` per instance of
  "target" (CR 601.2c), then `payMana` (CR 601.2g–h). While `payMana` is pending the player may activate mana abilities
  (CR 605.3a), and the decision is asked again after each; then they answer with a payment (checked by `payFromPool`) or
  cancel. `legalActions` lists every exact payment the pool can make (`allPayments`), since which mana pays is the
  player's choice (CR 601.2h). The spell then becomes cast (`SPELL_CAST`, CR 601.2i) and the caster gets priority (CR 117.3c).
- Cancelling is a product choice, not a rule: Arena-style undo, offered at every decision of the cast (`chooseTarget`
  and `payMana`). The CR has no "cancel" action, but CR 734.1 says how an action that can't be completed is reversed,
  and cancelling uses that model. It reverses the whole cast exactly: `GameState.casting` keeps the card as it was, its place in the
  hand, the pool before, and the permanents tapped for mana during the cast. The card goes back as the same object,
  the pool is restored, those permanents untap, and nothing triggers; the player keeps priority (CR 734.2).
  `CAST_CANCELLED` carries `{ player, cardId, spell, restored, untapped }` so the UI can animate the undo (since
  D-054, `cardId` is the spell's, and other players see `restored: null`). CR 734.1
  lets each player choose whether to reverse their mana abilities; cancelling always reverses them, one of the allowed
  choices.
- On resolution, a spell whose targets are all illegal doesn't resolve (CR 608.2b): it goes to its owner's graveyard
  with `SPELL_DID_NOT_RESOLVE`; it isn't "countered". The scenario for it needs damage and dying creatures, so it moved to
  M1-12's acceptance; a TypeScript test covers it now.
- Playing a land restarts the passes like any action (CR 117.4), though in a two-player game no pass can come before a
  land play in the same main phase, so no test can see it.

**D-036: The effects interpreter** · 2026-11-19 · accepted
- A resolving spell's effects become one `runEffect` work item each, in the order written (CR 608.2c), rather than
  running in one function. The queue already exists (D-032), and a later effect that needs a choice (CR 608.2d–e) can
  then wait for it.
- Targets are checked once, as resolution begins (CR 608.2b), and each work item carries an `EffectContext` with only
  the targets still legal. So the check isn't repeated per effect, and an illegal target is simply absent.
- `runEffect` is a plain function of `(state, effect, context, cards)`. Mana abilities call it directly, because they
  resolve at once (CR 605.3b), even while a payment is pending (CR 605.3a), and have no stack object. The context names the object
  "this" means, so activated abilities (M1-14) can make it the source rather than the ability.
- All damage goes through `dealDamage`, which takes a list of damage dealt at once (spells now, combat in M1-13,
  CR 510.2). Prevention and replacement (CR 614–615), lifelink, infect and wither (CR 120.3) plug in there
  (superseded in part by D-056: prevention and replacement plug in at the pipeline's `replace`). Life loss
  is its own function (`loseLife`, CR 119.3), so "whenever a player loses life" has one event: `LIFE_LOST`.
- A recipient that's gone when its damage would be dealt is skipped, not an error: an earlier effect of the same spell
  could have moved it.
- `modifyPT` creates a `ContinuousEffect` in `GameState.effects`: source, controller, timestamp (CR 613.7b), duration,
  the affected object ids fixed when it begins (CR 611.2c), and the change. It's never applied by changing the object;
  `characteristics()` reads it (M1-11).
- The draw and zone-change primitives stay where they are (`zones/`); each becomes an effect op when a card needs it.

**D-037: `GameState.version` stays 0 until games can be saved** · 2026-11-19 · accepted
`ENGINE_VERSION` (D-019) stays 0 until a release can save games. No saves or replays exist yet, so new fields
(`casting` in M1-09, `effects` in M1-10) and RNG changes (D-024) don't bump it. From the first release that saves games,
every schema change and every change D-024 lists bumps it.

**D-038: characteristics() composes one reader per layer** · 2026-11-19 · accepted
- `characteristics(state, id, cards)` (`rules/characteristics.ts`) is the full answer to "what is this object now"
  (CR 613.1). It calls one reader per layer, in the CR's order: `controllerOf` (layer 2), `cardTypesOf` and
  `subtypesOf`, `supertypesOf` (layer 4), printed colors (layer 5), `keywordsOf` (layer 6), `powerAndToughness`
  (layer 7). The controller isn't a characteristic (CR 109.3) but is included, computed in layer 2 (D-022).
  Rules code may call those readers directly; none of them calls `characteristics()`, so a later layer can ask an
  earlier one without recursion (the rule modifier in 7c asks for control and types).
- Layer 7c only adds and subtracts, so its effects aren't sorted: their order can't change the result. (They're in
  timestamp order anyway: `GameState.effects` only grows at the end, as each effect is created.) Sorting by
  timestamp (CR 613.7) and dependency (CR 613.8) arrives with the first setting or switching effect (7b, 7d), or a
  layer with non-commutative effects.
- Rule modifiers apply in 7c to creature permanents only (CR 109.2), never to cards in hand or spells on the stack.
- A noncreature permanent has no power or toughness; a noncreature card elsewhere keeps its printed values (CR 208.3).
- "Until end of turn" effects end in the same call that removes damage (CR 514.2), so nothing, including the
  state-based action check of M1-12, can come between them. `EFFECT_ENDED` reports each one.
- Only cards have characteristics here. An ability on the stack is asked for its controller through `controllerOf`.

**D-039: State-based actions** · 2026-11-19 · accepted
- `stateBasedActions(state, cards)` (`rules/`) lists every SBA that applies, as data, from one state;
  `checkStateBasedActions` (`game/`) performs them all as one event (`STATE_BASED_ACTIONS`, CR 704.3). Listing first and
  then performing is what makes them simultaneous: nothing performed changes what else applies in the same check.
- The check runs in `givePriority` (CR 117.5). If anything was performed, `givePriority` is queued again rather than
  looped, so the check repeats (CR 704.3) and an SBA that needs a choice (the legend rule, CR 704.5j) could wait for it.
  The cleanup step checks once after its CR 514.2 action; if anything happened, the active player gets priority, and
  when all pass with an empty stack, another cleanup step begins (CR 514.3a).
- CR 704.5f puts the creature into its owner's graveyard; 704.5g destroys it (`permanents/destroy.ts`, CR 701.8),
  separate so regeneration and indestructible can tell them apart. A creature with 0 toughness isn't also destroyed.
- Cards going to a graveyard at the same time go in battlefield (or hand) order. CR 404.3 lets their owner choose; the
  engine doesn't ask, as Arena doesn't, while nothing in the pool cares (an open question in status.md).
- Losing: `playersLose` emits `PLAYER_LOST` for each, and when one player is left they win (CR 104.2a), when none, a
  draw (CR 104.4a). The game ends at once: `result` set, nothing pending or queued, no cast in progress. A player who
  loses for two reasons in one check loses once, for the first listed. With more than one player left it throws:
  leaving a multiplayer game (CR 800.4) isn't built.
- The scenario runner gets `winner` now (M1-15 keeps conceding and the result scenarios).

**D-040: Combat** · 2026-11-19 · accepted
- The defending player comes from the declared attacks, so it's known even if every attacker has left (in a two-player
  game it's the nonactive player, CR 506.2).
- `GameState.combat` exists exactly during the combat phase (created as it begins, CR 506.1; cleared as the end of
  combat step ends, CR 511.3). It records every declared attack (attacker, defending player) and every block. The
  declaration is kept even when a creature leaves, because CR 508.8 asks whether any were declared and CR 509.1h keeps
  an attacker blocked after its blockers are gone. Who is still in combat (CR 506.4) is read from the battlefield in
  `rules/combat.ts`: an id that's gone left combat (CR 400.7).
- Declaring is incremental, like the cleanup discard: a `declareAttackers` (or `declareBlockers`) decision, answered
  one attacker (or block) at a time, then `finishDeclaring`. All 2^n sets would make `legalActions` exponential.
  Nothing changes until finishing: then the attackers tap (CR 508.1f) and the declaration takes effect. There's no
  "un-pick" answer; a host that lets the player toggle buffers it and sends the final picks. When no creature could
  attack (or block), no one is asked and the declaration is empty.
- `canAttack` and `canBlock` (with evasion as its own check) are the one place restrictions go (CR 508.1c, 509.1b).
  Haste also lets a creature use {T} abilities (CR 702.10c), in `canUseTapAbilities`.
- Combat damage: an attacker blocked by two or more creatures gets `assignDamage` decisions, one per blocker but the
  last, in declaration order, each offering 0 up to what's left; the last blocker gets the rest, so the division always
  adds up (CR 510.1c, 510.1e; no damage assignment order, D-020). Listing whole divisions would grow combinatorially
  (C(power+n-1, n-1): 53,130 for 20 damage over 6 blockers); one amount at a time grows with power only. A creature with 0 or less power
  assigns none and raises no decision (CR 510.1a). Then all combat damage goes to `dealDamage` as one list with
  `combat: true` (CR 510.2), and state-based actions run at the next priority.
- Scenarios: `attack`, `block` and `assign` steps; `all pass` declares nothing when it passes through combat.
- Not built: attacking planeswalkers or battles, several defending players, first and double strike (a second combat
  damage step, CR 510.4), a blocker blocking several attackers. The data shapes (a defender per attack, blocks as
  pairs) leave room for each.

**D-041: Activated abilities share the casting procedure** · 2026-11-19 · accepted
- Activating a non-mana ability follows the casting steps (CR 602.2b, 601.2b–i), so both run through
  `game/casting-steps.ts`: targets, then paying, then becoming cast or activated, or cancelling. `GameState.casting`
  records the origin (a card from hand, or an ability of a permanent) and the decisions name the `object` being put on
  the stack (was `spell`). `cast.ts` and `activate-ability.ts` each only check that the action can begin and start it.
- The ability is created on the stack as an `AbilityObject` (CR 602.2a, `zones/stack-abilities.ts`) and its text is read
  from its source's card (`sourceOracleId` + ref), never from the source, which may be gone by resolution (CR 113.7a).
  "This" in its effects is the source; an effect on a source that has left does nothing (CR 101.3, 400.7). Nothing in
  the pool reads information from a gone source yet, so no last-known-information store is built (future-rules.md).
- Who and when: the source's controller (CR 602.2), any time they have priority (CR 113.3b), no summoning sickness
  without {T} (CR 302.6). Like casting (D-035), activation is offered without a payability check, and cancelling is
  Arena-style undo: the ability ceases to exist, the pool and mana sources are restored (`ACTIVATION_CANCELLED`), and
  since nothing was done, the passes don't restart. A completed activation restarts them and the activator gets
  priority (CR 117.3c, 117.4); `ABILITY_ACTIVATED` reports it.
- Only mana in activation costs so far: a non-mana ability with {T} in its cost is refused until a card has one. A mana
  ability with mana in its cost is refused too (it would need a payment while resolving at once).
- Cost functions live in `rules/costs.ts` (`totalCost`, `activationManaCost`), the one place cost changes will go.

**D-042: Conceding** · 2026-11-19 · accepted
- `CONCEDE` works for any player in the game at any time, whoever the game is waiting for, even mid-cast or during
  mulligans (CR 104.3a). It goes through `playersLose` with reason `conceded`, like any loss, so `PLAYER_LOST` is the
  one loss event (`PLAYER_CONCEDED` was dropped).
- It isn't listed by `legalActions`: it's always available, like a menu button, and listing it would make random
  agents (the CLI's `random`, the fuzzer) concede all the time. Hosts offer it themselves.
- The game ends at once (CR 104.1): a spell or ability part way through being put on the stack stays where it is, and
  the result's `turn` is 0 when the game ends before the first turn. So code reading a finished game (a replay viewer,
  a log) must not assume a spell on the stack means `casting` is set, or that `pregame` is null.

**D-043: The CLI's game file and `do`** · 2026-11-19 · accepted
- The game file is `{ format, version, setup, actions, state? }`. The setup and the actions are the truth: replaying
  them reproduces the game, since the engine is deterministic. `state` is only a cache, so commands don't replay a
  long game each time; no events are stored (they're most of a game's size), so commands that need them replay. The
  same file is the replay log and the bug-report format. While `ENGINE_VERSION` stays 0 (D-037), a cache from an
  older build can't be detected, so `replay` ignores it and says if it differs.
- `do` takes a number from `actions`, or a scenario step written as YAML (the scenario parser reads it, and the
  runner's `takeStep` takes it, reporting each action so it can be recorded). One step syntax for scenarios and the
  CLI, so steps paste between them; comma-separated shorthand was rejected because card names can contain commas. A
  step is all or nothing.
- `show --as p2` hides the other players' hands (libraries never show their contents), in one function
  (`canSeeHand`). The engine's `playerView` (architecture.md) isn't built yet: no M1 task needs it, and the AI that
  must read only views arrives in M2.
- The prebuilt decks are written by card name and count, as in the M1 spec (`packages/cards/src/decks/`).
- (Part 2.) Agents are pure functions of the state, the legal actions and their own seed (a small PRNG in the CLI,
  separate from the game's RNG), so `auto` is reproducible and the fuzzer can reuse them. They never concede (D-042).
  The log names objects from the states before and after the action that caused each event (a creature that died is
  only in the first), and follows the turn event by event. `export --scenario` lives in `packages/scenarios` beside
  the parser; a game's cards in hand are named `Forest#2` (for `play`, `cast` and `choose`) when there are several
  copies, since which copy changes the hand's order and a mulligan's shuffle with it. Exported random games replay to
  the very same state (a test checks six), and `export` runs the scenario before printing it. `layerSevenCChanges` (engine) explains power and toughness for `inspect`, from the same code that
  computes them.

**D-044: Player views and event filtering** · 2026-11-19 · accepted
- `playerView(state, viewer)` (`engine/src/view/`) is what a player may know: objects in public zones and the viewer's
  own hand (CR 400.2, 402.3); other hands and every library only as counts (CR 401.3, 402.3); no RNG state, setup, work
  queue or id counters. Libraries are counts, not hidden objects in order: a shuffle keeps object ids, so an ordered
  id list would let a player follow a card they had seen through a shuffle (CR 401.2, 701.24a). `decision` is the
  viewer's own pending decision in full; `waitingFor` (id, player, kind) says who must decide what, so another
  player's picks so far stay hidden. Each player's zones have `handSize` and `librarySize`, and `hand` is the ids for
  the viewer and null for others: separate fields rather than unions, so code can narrow them.
- `canSee(zone, viewer)` (`view/visibility.ts`) decides visibility for both, so face-down cards and reveals change one
  place. A view shares structure with its state (D-021) and must never be changed in place.
- `eventsFor(events, viewer)` replaces an event that would reveal a hidden card with `HIDDEN_CARD_DRAWN` or
  `HIDDEN_CARD_MOVED`. It's an exhaustive switch, so each new event decides what it reveals.
- "Leaks nothing" is tested as a property, by the fuzzer's `viewsLeakNothing` check after every action (D-046):
  scrambling everything the viewer can't see (hidden objects' ids everywhere they appear, their cards and card ids,
  the order of libraries and other hands, another player's casting details and pending picks, the seed, RNG and
  internals) must leave the view unchanged, and the filtered events must name no hidden card by its card id or object
  id. The checks run on the opening state too.
- A gap found later, closed by D-054: card ids and object ids let a player follow a card through another player's
  hand (CR 402.3), for example a cancelled spell told apart from a second copy cast later.
- The CLI's `show --as` stays a display filter (`canSeeHand`): the board text needs `characteristics()`, which reads
  the full state. Hosts and the AI (M2) use the engine's view.

**D-045: Card ids are numbered in a random order** · 2026-11-19 · accepted
- `createGame` numbers the setup's cards `c1` to `cN` in an order drawn from the game's RNG, before anything else
  uses it. Numbered in setup order, a public card's id hinted at the cards next to it in the decklist, which sit in
  hidden libraries and hands (CR 400.2): see `c5` as a Shock in a grouped decklist and `c6` is likely Shock too.
  Object ids don't need this in M1: a card gets a new object id each time it changes zones (CR 400.7), and a
  library's object ids aren't shown while the cards are in it. They're in setup order, though, and a card leaving the
  library for a public zone shows its old id (future-rules.md: mill and reveal).
- Drawing from the RNG first changed which player the RNG picks to choose who goes first for a given seed, so two
  scenarios that rely on p1 being picked use seed 2 instead of the default.
- Tokens aren't cards (CR 111.1), but the UI follows them across zones the same way, so they'll get an id of the same
  kind when they arrive: `c(N+1)` and up, as they're created in public.

**D-046: The fuzzer and saved replays** · 2026-11-19 · accepted
- `pnpm fuzz --games N --seed S` plays one game per seed, `S` to `S+N-1`. The seed is the setup's seed and the
  agents' seed, so `--games 1 --seed <seed>` reruns one game exactly. Even seeds play the prebuilt decks, odd seeds two
  random 40-card decks from the pool (17 basics mixed at random, 23 random nonland cards). The agent picks a random
  legal action, one decision in ten the first legal one (which passes, so games move on), and about one game in ten
  ends in a concession (CR 104.3a), which `legalActions` never lists (D-042).
- Checks after every action (`cli/src/fuzz/checks.ts`): the scenario runner's `invariantProblems`; life changes
  equal the `LIFE_LOST` events (when life gain arrives, count its event too); views and filtered events leak nothing
  (D-044). Exceptions from the engine are failures, not crashes. A game past 200 turns is flagged as a likely loop.
  Determinism is checked once per game, by replaying the whole log at the end: replaying after every action would
  make a game quadratic, and any divergence shows in the final state anyway.
- A failure is written to `fuzz-failures/seed-<n>.json`: a game file (D-043) up to the failing action, plus that
  action and the problem, so `pnpm cli replay` opens it and `pnpm cli export` turns it into a scenario.
- The short fuzz in `pnpm check` is a test (`cli/test/fuzz.test.ts`, seeds 1 to 6), not a separate command, so it
  runs wherever the tests run, CI included.
- Saved replays are game files in `packages/engine/test/replays/` with a `description` and the SHA-256 of the final
  state's JSON, and no cached state. They're written one action per line, so a diff shows which actions changed.
  `cli/test/replays.test.ts` replays each one (the engine's own tests use test cards, not the pool, as scenarios do,
  D-033). `pnpm replays:update` rewrites the hashes after an intended change (say why in the commit), and fills in
  the hash of a game file newly copied there.

**D-047: Golden games** · 2026-11-19 · accepted (the format and what they cover changed in D-082)
- A golden game is a game file in `packages/engine/test/golden/` (`<name>.json`: setup, actions, and the recipe that
  made them: agent, agent seed, turn cap, description) plus its log (`<name>.log`: the CLI's brief event log, one
  event per line). `cli/test/golden.test.ts` replays the actions and compares the log as text, so a failure is a
  line diff of what changed. If an action is now rejected, the log stops there with a `!! action N is rejected` line
  instead of an exception, so the diff still shows where the game went differently.
- `pnpm golden:update` keeps a game's actions when they still play out to where the game stopped, and otherwise plays
  it again from its recipe; it reports per game "log changed", "played again from its recipe (why; where the
  actions differ)", "actions kept; the recipe now plays differently", or "file rewritten (version or layout)", for
  the commit message. A recipe that stops anywhere but the game's end or its turn cap is an error. `pnpm golden:add --decks a,b --seed N` adds one between prebuilt decks.
- Four games for M1: red-aggro against green-stompy twice (each deck seated first once) and each deck against itself;
  between them every pool card is played, cast or activated, which a test checks. Seeds were picked for that (the
  green mirror at seed 33 is one that casts both Craw Wurm and Spined Wurm).
- The players are the random agents until the AI exists (M2), so the logs are noisy (agents often start a cast and
  cancel it). When the AI arrives, regenerate the golden games with it.
- Saved replays (D-046) check a final-state hash; golden games check the whole log. Both stay: a replay is the
  compact form for bug reports, a golden game the readable one for engine changes.

**D-048: The rules coverage report** · 2026-11-19 · accepted
- `pnpm coverage:rules` writes `docs/coverage/rules-coverage.md`. "Cited by code" means the rules code:
  `packages/engine/src` and `packages/cards/src`. The CLI and the scenario runner cite rules only to explain
  themselves.
- Citations are read in every form the code uses: lists (`CR 117.3d, 117.4`, also wrapped onto the next comment
  line), ranges (`CR 601.2b–i`, `CR 506–511`, `CR 500.7–500.11`, `CR 601.2–4`) and asides (`CR 302.6, with haste,
  702.10`). A range of another shape is kept as written, so it fails the next check: every cited rule must exist in
  `rules/`.
- A mention of a rule not built yet is written `later: CR 614`, and isn't a citation: a comment saying where
  replacement effects will plug in doesn't mean they're implemented. The report lists these mentions in their own
  section, so marking a rule `later:` shows in the report's diff and a reviewer can check it really isn't built.
- A test of rule T covers code citing rule C when T is C or T is under C (601.2c covers 601.2 and 601). Never the
  other way: a scenario about 601.2 doesn't show that 601.2c is built. (A first version also let 601.2 cover 601.2c;
  that credited unbuilt rules and hid real gaps, so it went.) Unit tests are the `*.test.ts` files; fixtures and
  helpers don't count.
- The report lists rules tested by scenarios, rules tested only by unit tests (they cite the rule in a name or
  comment), and gaps: rules nothing tests, and interaction matrix cells above the diagonal marked "not yet" or left
  empty. A missing matrix is an error. Unit tests count for the M1 exit criterion (owner, D-050), so a gap is a rule
  with neither.
- `cli/test/coverage.test.ts` fails when the committed report isn't exactly what `pnpm coverage:rules` writes now, so
  the report is always current and a gap closed and later reopened can't hide. `pnpm coverage:rules` refuses to write
  a report that's worse than the committed one unless given `--accept-new-gaps`: a new gap, or a rule the committed
  report lists as tested by scenarios that no scenario tests now (even if a unit test still cites it). Accepting is
  deliberate and shows in the commit. (D-052 later removed accepting a gap: none are allowed.) The coverage tests' own sample citations aren't counted.

**D-049: Benchmarks** · 2026-11-19 · accepted
- `pnpm bench` times six measures, each reported per operation: `applyAction` on three sets of states (up to 40 each,
  from the golden games: early turns with at most two permanents, combat with 20 or more, a stack of two or more), a
  whole game between the random agents (five fixed setups in turn), `legalActions` in the 40 busiest states, and
  `characteristics` of every permanent in them. Sets of states rather than one state each, so one state's quirks
  don't decide a measure. The states come from a fixed list of golden games (M1's four, `BENCH_GAMES`), since adding
  golden games for new cards changed the sample and read as a 30% slowdown in M2-04 (the code itself measured the
  same).
- Timing: each workload is warmed up, then all are timed in 21 interleaved rounds of about 30 ms batches, and each
  takes its median batch. A reference loop of plain JavaScript runs in the same rounds; measures are compared as
  multiples of it, so a baseline holds across machines and a busy moment slows everything alike. On an unchanged
  engine, five runs in a row stayed within 10% of the baseline.
- More than 20% slower than `bench/baseline.json` on any measure fails, as does a measure over its budget
  (architecture.md: 1 ms per `applyAction`, 100 ms per random game) or a time that isn't a positive number. `pnpm bench
  --update` writes the baseline: only for a justified slowdown, explained in the commit.
- It isn't part of `pnpm check`: timings on a shared CI runner would be flaky. Run it before merging engine changes
  (testing.md). `cli/test/bench.test.ts` checks the workloads still build and run.

**D-050: Unit tests count toward rules coverage** · 2026-11-19 · accepted (owner)
- The owner decided: a rule the code cites is covered when a scenario or a unit test tests it, and any real hole in
  behavior gets a scenario. The M1 exit criterion reads "no rule cited in code without a test".
- So the coverage report's gaps stay what D-048 made them (rules with neither), and "Tested only by unit tests" is a
  list to read, not a list of failures: things a scenario can't express (player views, card data parsing) belong
  there; game behavior there should move to a scenario when it's next touched.

**D-051: Rules depth before the app; the goal is every two-player rule** · 2026-11-19 · accepted (owner)
- The owner: "the end goal is to have an accurate Magic the Gathering rules engine. Defined by the comprehensive rule
  set." So the roadmap swaps M2 and M3: M2 is now Rules depth (triggers, replacement and prevention, the full layer
  system, static abilities, costs, tokens, auras and equipment, the evergreen keywords, about 200 cards) and M3 is
  First playable (the web app and the AI). M4 and M5 are unchanged. Decisions written before this one say "M2" for
  the app and "M3" for rules depth.
- Scope (owner's choice): eventually every rule two-player games use, CR chapters 1 to 7. Multiplayer and casual
  variants (CR 8, 9) stay out unless the owner decides otherwise.
- How: rules are built through cards. A rule with no card exercising it can't be tested, so each mechanic arrives
  with cards that use it, scenarios and interaction tests (the coverage report, D-048, keeps this honest). The core
  systems come first because nearly every card touches them; keywords follow, the most common first.
- The engine doesn't depend on the app: the CLI, scenarios, fuzzer, golden games and coverage report are enough to
  build and check rules. The owner playtests through the CLI until M3. The hidden-information known issue (status.md)
  is fixed early in M2, before any AI reads views.

**D-052: Every rule has a test** · 2026-11-19 · accepted (owner)
- The owner: "It's really important that every rule has some sort of test, whether it's a unit test or scenario that
  backs up the expected behavior." A requirement, not a goal: every rule the code implements is cited where it's
  implemented (CLAUDE.md), and every cited rule has a scenario or a unit test (D-050).
- Enforced: the coverage test fails on any gap (a cited rule with no test, or an open interaction matrix cell), and
  `pnpm coverage:rules` refuses to write a report with one. The `--accept-new-gaps` escape from D-048 is gone. A rule
  losing its last scenario while a unit test still covers it is allowed (D-050) but needs `--accept-scenario-loss`.
- The check can only see cited rules, so citing is part of the requirement, and reviews (rules-judge, code-reviewer)
  look for implemented behavior without a citation. A rule that's mentioned but not built is written `later: CR …`.

**D-053: M2's pool is Magic 2010, planeswalkers included** · 2026-11-19 · accepted (owner)
- The owner chose Magic 2010 (M10) for M2's card pool, and planeswalkers in M2, both as recommended. M10 brought in
  the modern rules (combat damage off the stack), holds Lightning Bolt and many M1 cards, and covers the core systems
  M2 builds. Each M10 card joins the pool only when it's fully scripted and tested; cards whose rules are out of scope
  (multiplayer or variants, D-051) are listed in `docs/milestones/m2-pool.md` and left out.

**D-054: A card gets a new card id when it comes out of hiding** · 2026-11-19 · accepted (M2-01)
- A card id now changes only when a card comes out of hiding: when it leaves a hand or a library for
  a public zone (cast, played, discarded, milled), it gets a new card id (`GameState.nextCardId`, after the setup's
  `c1`–`cN`). Otherwise a player who saw a card go into a hand (a cancelled spell, CR 734.1) could tell, when a copy
  came out later, whether it was that card (CR 402.3).
- Minting when a card comes out, not when it goes in: every card then arrives in public with a fresh id from one
  counter, so the number says nothing about its past. (Minting on the way in would leave setup cards with ids at or
  below N and re-hidden ones above it, which tells them apart.) A cancel still restores the hand card exactly (D-035).
- `ZONE_CHANGED` carries `cardId` (before the move) and `newCardId` (after), and `object` is the card as it was.
  `eventsFor` shows only the side of a move the viewer can see: `CARD_CAME_INTO_VIEW` (the new object id and card id)
  or `CARD_LEFT_VIEW` (the old ones and the object as it was). That includes a player's own library, hidden from them
  too (CR 401.2). Another player's `CAST_CANCELLED` has `restored: null`; its `cardId` is the spell's, which everyone
  saw on the stack.
- Tested by two worlds (p2 cancels a Shock, then casts the same one or the other: p1's events and views must be
  identical), and the fuzzer's leak check now flags any id of a card hidden from the viewer before or after an
  action, unless they could see it then too.

**D-055: M2's task order follows the pool's needs** · 2026-11-20 · accepted (M2-02)
- Mapping every Magic 2010 card to the systems it needs (`docs/milestones/m2-pool.md`) showed 86 cards need plain
  effects (destroy, draw, discard, counter target spell, search) and 45 need keywords, while the spec put both near
  the end: 88 cards would have waited until late in M2. So the tasks are reordered: effects and keyword actions
  (M2-05) and keywords (M2-06) right after targeting and costs, then triggers, replacement and prevention, layers,
  counters, tokens, Auras and Equipment, planeswalkers, and the special rules last.
- Each system task also scripts the cards that become playable with it, so the pool and the fuzzer's decks grow
  through the milestone (38 cards playable now, 93 after M2-05, 144 after M2-07, all 234 after M2-14).
- Protection is split across tasks by its parts (CR 702.16): targeting and blocking with keywords, damage prevention
  with M2-08, "can't be enchanted or equipped" with M2-12.

**D-056: One event pipeline: replace everything, then perform everything** · 2026-11-20 · accepted (M2-03)
- Every game event is a `ProposedEvent` carried out by `happen(state, proposed, cards)` (`engine/src/pipeline/`):
  replace (only CR 120.8's dropping of 0 damage until M2-08), perform, check triggers (nothing until M2-07). Only
  `perform.ts` calls the primitives that perform events; a test fails if another engine file imports one. Supersedes
  in part D-030 and D-036, which put the plug-in points in `moveCard` and `dealDamage`.
- An event changes one object or player and is performed whole. Destroying is moving to the graveyard (CR 701.8a),
  discarding is moving from hand to graveyard (CR 701.9a), playing a land is its move plus counting the play (CR 305.1,
  305.2): one event each, not an outer event that proposes an inner zone change. So "would be destroyed" and "would
  die" replacements apply to the same event, in the order its controller chooses (CR 616.1, as the CR's example under
  616.1f has it for "would die" and "would be put into a graveyard"). A damage event's results are part of it
  (CR 120.4c).
- Destroy and regeneration, asked of the owner on 2026-11-20 at the rules-judge's request. The owner: "I'm inclined to
  say that a destroyed card goes to the graveyard but I would defer to the CR." Following the CR: destroying *is* the
  move to the graveyard (CR 701.8a), dying *is* that move (CR 700.4), and the CR's example under 616.1f has a "would
  die" and a "would be put into a graveyard" replacement on one destroyed creature, its controller choosing the order.
  So regeneration (which replaces the destruction, CR 701.8c, 614.8) and a "would die" replacement apply to one event,
  in the order the creature's controller chooses (CR 616.1e). The one point against: CR 616.1g's example treats
  entering the battlefield as an event contained in creating a token, though CR 701.7a defines creating as putting it
  onto the battlefield, so a definition alone doesn't make two things one event. But the CR names no event contained in
  a destruction, and its own destruction example (616.1f) treats the two replacements as rival choices on one event.
  M2-08 tests it with a scenario (its acceptance list); the M10 pool may not have a card that shows it.
- Events that happen at the same time are one `simultaneous` event of single events: the state-based actions of one
  check (CR 704.3), the untap step (CR 502.3), the attackers tapping (CR 508.1f), the cleanup discard (CR 514.1).
  Every member is replaced against the state before the batch (built with M2-08; CR 614.4 was a wrong citation, D-085), then all are performed,
  and triggers see them together.
- Replacing comes entirely before performing, so a replacement that needs a choice (CR 616.1) can stop before anything
  has changed. Making `happen` resumable is M2-08's: it becomes a work item, and the callers that do more after it
  returns (listed in the pipeline README) queue that rest as work.
- Nothing re-proposes an event, so a replacement's one chance at an event (CR 614.5) is all inside one `replace`.
- Callers read the new object a move made from its `ZONE_CHANGED` event (`zoneChangeOf`), not the proposal.
- Bookkeeping that isn't a game event stays outside (the README lists it). The pregame's shuffles, draws and mulligan
  moves go through the pipeline. Events emitted outside it (`STEP_BEGAN`, `TURN_BEGAN`, `SPELL_CAST`,
  `ABILITY_ACTIVATED`, `ATTACKERS_DECLARED`, `BLOCKERS_DECLARED`, `SPELL_RESOLVED`, `PLAYER_LOST`; "becomes the
  target" has no event yet) are M2-07's to route when a trigger needs one.
- Done with no behavior change: the golden games and replays are identical, and `pnpm bench` passes.

**D-057: Targets as a kind, a filter and a count** · 2026-11-20 · accepted (M2-04a)
- A `TargetSpec` is a kind (`anyTarget`, `playerOrPlaneswalker`, `permanent`, `spell`, `cardInGraveyard`) with an
  `ObjectFilter` and an optional `count`, taken from the Oracle text of every Magic 2010 card that targets. "Target
  creature" is a permanent whose types include creature, one shape rather than a special case. Filters read the layer
  readers (types, colors, subtypes, control, combat), so effects that change them (M2-09) apply to targeting too.
- Targeting knows what targets and who controls it (`Targeting`), for "you control" filters, "can't target itself"
  (CR 115.5), and later protection, hexproof and shroud.
- A variable number of targets is announced first (`chooseTargetCount`, CR 601.2c), capped by the distinct legal
  choices and, for a division, by the amount. A fixed count asks nothing, so M1's games replay unchanged.
- A division "as you choose" is announced after the targets, one share at a time like combat damage (`divide`), and
  stored on the spell as target and amount pairs, so an illegal target loses only its own share (CR 601.2d, 608.2b,
  later: 115.7f for changed targets). Fireball's "divided evenly" is different (worked out at resolution, per its rulings) and comes with M2-04b.
- Interim prebuilt decks `white-red` and `blue-green` bring the new cards into the golden games until the first M10
  deck pair (after M2-05) replaces them. The bench reads states only from M1's four golden games (D-049).

**D-058: X, cost increases and sacrifice costs** · 2026-11-20 · accepted (M2-04b)
- `{X}` is a mana symbol. It's announced first, as the cast or activation begins (`announceX`, CR 601.2b, 107.3a): any
  whole number from 0 is accepted; `legalActions` lists 0 up to what the player could pay for now (the pool plus one
  for each mana ability they could activate, minus the rest of the mana cost), a guide rather than a rule, so the
  fuzzer and the AI have a finite list. An X too big to pay ends in a cancel (D-035). X counts as 0 in the mana value
  off the stack (CR 107.3g); the stack's value comes with its first reader (later: CR 202.3e).
- The total cost is worked out once, after targets and division (CR 601.2f): the mana cost with X as generic mana, plus
  increases (Fireball's per target beyond the first, read only for a spell with one instance of "target"), and locked
  into the `payMana` decision.
- "Sacrifice a creature" is a cost part with an `ObjectFilter`. After the cost is locked, the player chooses what to
  sacrifice (`chooseSacrifice`; a target can be chosen too, CR 601.5). Nothing moves until the whole cost is paid:
  mana abilities come first (CR 601.2g), then the mana and the sacrifices together, rechecked, in one step, the
  sacrifices' events before the spell becomes cast or the ability activated (CR 601.2h–i). So a cancel never undoes a
  sacrifice (D-035). A cost with no mana is paid as soon as its choices are made.
- Whether anything can be sacrificed isn't checked before activating, as payability isn't (D-035).
- Fireball's "divided evenly" is worked out at resolution among the targets still legal (its rulings). An interim
  black-red deck brings Fireball, Swamp and Vampire Aristocrat into the golden games and the fuzzer.

**D-059: Removal and counter effects, and {T} in ability costs** · 2026-11-20 · accepted (M2-05a)
- New effect ops: `destroy`, `destroyAll` (decided once as it applies, one simultaneous event, CR 608.2f, 608.2h),
  `exile`, `returnToHand`, `putOnTopOfLibrary`, `tap`, `counter`, `gainLife`. Each skips an object that's no longer
  where it was when the targets were checked (CR 101.3, 400.7) rather than throwing. Zones are the owner's (CR 400.3).
- A `"you"` subject names the controller (CR 109.5): "you gain 4 life" isn't a target (CR 115.10b) or "this".
- Countering is its own pipeline event (`counterObject`, not `counter`, which CR 122 counters will want): a spell goes
  to its owner's graveyard as part of it, an ability ceases to exist (CR 701.6a). Gaining life is its own event;
  gaining 0 isn't one (CR 119.9). Lifelink will be a result of damage, not a `gainLife` proposal (CR 120.3f).
- {T} in the cost of an ability that uses the stack is checked when the activation begins (untapped; for a creature,
  controlled since the turn began, CR 602.5a) and paid with the rest of the cost, before any sacrifice, after the
  targets (so Royal Assassin can't target itself, its ruling). The permanent a cost taps isn't offered as a mana source
  for that cost (CR 107.5).
- The three interim decks now carry the M2-05a cards, with five new golden games found by a seed search so that every
  pool card is played (three more that added no card were dropped). Golden games grow by about 2 MB per task this way
  (status, Known issues).
- A scenario names a spell on the stack like a permanent (`p1:Lightning Bolt`) or, when a permanent has the same name,
  `spell:p1:Grizzly Bears`; `export --scenario` always writes the second form.

**D-060: Player effects: drawing, losing life, discarding at random, milling** · 2026-11-20 · accepted (M2-05b1)
- New effect ops `loseLife`, `draw`, `discardAtRandom` and `mill`, a `player` target kind and an `"eachPlayer"` subject
  (APNAP order, CR 101.4). Losing life is a pipeline event again (`loseLife`, CR 119.3). Whether losing 0 is an event is
  left open until a card can lose a variable amount (docs/future-rules.md).
- "Draw N" is N separate draw events (CR 121.2), all of one player's before the next player's (CR 121.2c), so a
  replacement of one draw can act before the next. The draw-several container (CR 121.2a) waits for a replacement that
  needs it (M2-08, docs/future-rules.md).
- "Discard at random" picks with the seeded RNG, player by player in APNAP order, then discards every pick in one
  simultaneous event (Burning Inquiry's ruling). A smaller hand is discarded whole (CR 609.3). Mill moves the top N
  (all there are if fewer, CR 701.17b) in one simultaneous event (CR 701.17a); the graveyard order is the library's for now (later: CR 404.3).
- Keyword actions Scryfall lists among a card's keywords (Mill) are left out of the definition's keywords
  (`KEYWORD_ACTIONS`, CR 701 vs 702). Scenarios can name a card in a graveyard: `graveyard:p1:Grizzly Bears`.
- The fuzzer's leak check counts a card the viewer saw during the action (drawn, then discarded by Burning Inquiry) as
  seen: the ids a card gets moving into a zone the viewer sees are theirs to know.

**D-061: The fuzzer picks a kind of action first** · 2026-11-20 · accepted
- Picking uniformly among the legal actions spent most of a fuzz game on casts that ended in a cancel: every card in
  hand is listed whether it can be paid or not (D-035), so with five uncastable cards, passing was one choice in seven or fewer.
  In seed 13, 814 casts were cancelled and 15 cast.
- The fuzzer now picks a kind of action (the action's type, or an answer's kind) and then one action of that kind.
  Cancelling a cast or activation weighs a tenth of any other kind. No listed action has weight 0, so cancels and
  mid-payment paths are still explored. It reads only the listed actions, not whether a cost can be paid, so the
  fuzzer doesn't trust the code it tests.
- Over seeds 1 to 40: 2,250 actions a game went to 1,809, spells cast from 13 to 18 a game, time down 22%, and three
  more event types are reached (ABILITY_DID_NOT_RESOLVE, LIFE_GAINED, SPELL_DID_NOT_RESOLVE); none is lost.
- The trade: what's explored shifts. Finishing a declaration is a kind of its own, so each attacker or blocker step
  stops about half the time whatever the board (wide attacks and double blocks thin out as boards grow); decisions
  inside casts that were going to be cancelled are reached less often (announceX, target choices); and tapping a land
  for mana at priority is a kind as likely as passing (activations aren't split by mana ability, which would mean
  reading the cards). No decision kind or event type was lost over seeds 1 to 40.
- The `random` agent of `ai` and `auto` is unchanged, so the golden games, the bench's random games and the CLI tests
  play the same games. Golden generation can move to the picker when the golden games are regenerated (after M2-05c).

**D-062: Choices at resolution, and cards shown from hidden zones** · 2026-11-20 · accepted (M2-05b2)
- An effect that needs choices waits with a `chooseCards` decision that keeps the effect and its context to resume.
  Each answer but the last only asks again, with the choice added; after the last (or `finishChoosing`), the effect is
  queued once, with the chosen cards, ahead of the rest of the resolution (D-032). Nothing happens until all answers
  are in (CR 608.2d), answers emit no events, and only its own answers are legal (CR 608.2g). Keeping `resume` in the
  decision keeps the min/max loop in one place, so ops never see a half-made choice; the view leaves it out.
- A card shown to a player from a zone they can't see (a revealed hand, a searched library, a look at the top) is
  shown by what it is, never by its object id, card id or timestamp: those are numbered in order, so they'd tell when
  and how the card got there (which card was drawn on which turn, which was put on the bottom). Options are kept in a
  fixed order (oracle id, then internal id) and answered by position. This extends D-044 and D-054, and is why
  shuffling doesn't need to renumber a library.
- A choice over a hidden zone is asked whenever that zone isn't empty, even when nothing fits, with "find nothing"
  allowed where the CR allows it (CR 701.23b): skipping it would tell the opponent what the zone lacks.
- A whole hand discarded without a choice goes to the graveyard in the fixed order too, not the hand's. A discard with
  a filter, or chosen by "you", must follow revealing that hand (`definition-problems.ts`): otherwise skipping the
  choice, or showing "you" the options, would tell what a hidden hand holds.
- The fuzzer's `scrambleHidden` permutes hidden ids rather than shifting them, so a view that shows hidden ids in their
  order fails. It trusts the cards a viewer's own decision offers (keeps their identity), and it doesn't re-sort a
  stored decision, so order and "should this be asked" leaks are caught by the two-worlds tests in
  `test/effects/choose-cards.test.ts`, not by the fuzzer.

**D-063: Haunting Echoes with nothing exiled doesn't search** · 2026-11-20 · accepted (owner)
- "For each card exiled this way, search that player's library..." with no card exiled means no search: the caster
  doesn't look at the library, and "whenever a player searches" won't trigger. The target still shuffles. The owner's
  ruling, asked because the CR doesn't settle this wording (CR 701.23c's Lobotomy example reads the other way for
  Lobotomy's own text): "for each card exiled do xyz. If the graveyard is empty then the for each is basically 0 so it
  would be 0 xyz actions. Aka no searches."

**D-064: Searching libraries, "this way" results, and "you may"** · 2026-11-20 · accepted (M2-05b2b)
- `GameState.resolution` keeps what the resolving object has done "this way" (CR 608.2c): the cards a `search` found
  and the cards `exileGraveyard` exiled. It's set as an object starts to resolve and cleared on every exit
  (`finishResolving`, its early return, `doesNotResolve`); an invariant checks it never outlives its resolution.
  Effects name the found cards with a `"found"` subject, so search, reveal, put and shuffle stay separate steps
  (Liliana Vess will need CR 701.24b: search, shuffle, then put on top). A search asks whenever the library has cards,
  even if none fits (D-062), and shows the chooser the whole library by identity (`seen`, CR 701.23a).
- An "any number" choice ends only on `finishChoosing`, never at its maximum, which would tell the other players how
  many copies a hidden library held.
- "You may" is a `chooseYesNo` decision whose yes queues the effect it resumes; no does nothing.
- Filters gain `supertypes` (read through `supertypesOf`) and `not`: "other than basic land cards" is not (basic and
  land), so a nonbasic land like Terramorphic Expanse is exiled by Haunting Echoes.
- "Onto the battlefield tapped" enters tapped as part of the move (CR 110.5b), never "becoming tapped" (CR 603.2e).
- "Sacrifice this land" is a `sacrificeSelf` cost part, sacrificed with the rest of the cost after {T} (D-059).
- Writing `resolution` is bookkeeping, like `casting` and `combat` (pipeline/README.md): it records what events already
  did. Recording a result with no resolution under way throws, rather than quietly losing it.
- Exported for hosts (D-023): `Seen` and `Resolution`, which the exported decision and state types use, and
  `ViewChooseYesNo` with the other `ViewDecision` types, which a UI renders.
- The new state field changes the saved replays' final-state hashes and nothing else (checked: each final state
  minus `resolution: null` has the old hash), so `pnpm replays:update` rewrote them.

**D-065: Losing 0 life is an event** · 2026-11-20 · accepted (owner)
- "A player loses 0 life" (Xathrid Demon sacrificing a 0-power creature, a "loses X life" with X of 0) is a life-loss
  event: `loseLife` proposes it, it emits `LIFE_LOST` with amount 0, and "whenever a player loses life" triggers and
  life-loss replacements (M2-07, M2-08) will see it. The CR settles this only for gaining 0 life (CR 119.9, 119.10)
  and dealing 0 damage (CR 120.8), not for losing 0. The owner's ruling: "Treat losing 0 life as an event because we
  may encounter a card(s) that take advantage of that."

**D-066: The app never asks for graveyard order** · 2026-11-20 · accepted (owner)
- When several cards go to a graveyard at the same time, CR 404.3 lets their owner arrange them. The app never asks:
  they go in the engine's fixed order (D-039; a whole hand discarded at once in the shown order, D-062), as Arena
  does. The owner: "Don't ask about graveyard order." The code's `later: CR 404.3` marks stay, since the rule's choice
  isn't offered.

**D-067: Counted amounts, damage to each, and "spend only black mana on X"** · 2026-11-20 · accepted (M2-05c1)
- An `Amount` can be a count of permanents fitting a filter (`{ count }`, "for each land you control", "the number of
  Swamps you control"), worked out as the effect applies (CR 608.2h). An X the text defines that way is the count, not
  announced (CR 107.3c). Each effect counts for itself; they can only differ once replacements move things
  mid-resolution (M2-08).
- A subject `{ each: ObjectFilter }` names every permanent fitting it as the effect applies ("each creature without
  flying"); filters gain `keywords` / `notKeywords` through `keywordsOf`.
- `dealDamage` gains `and`: more recipients of the same source in the same action, each with its own amount
  (Earthquake's creatures and players, Goblin Artillery's 2 and 3), all one damage event (CR 608.2f, 120.4).
- "Spend only black mana on X" is `xPaidWith` on the spell: only the cost to pay makes each X a {B}, so the same
  payments are legal (CR 601.2h) and the printed cost, color and mana value don't change (CR 107.4b). It doesn't
  generalize (cost reductions, CR 118.7a; Soul Burn's "black and/or red"): restricted mana in the pool replaces it when
  a card needs that (future-rules). The X a player is offered is lowered to what they could pay in that color now, so
  it stays a guide to what's payable (D-058).
- Subjects and amounts live in `effects/subjects.ts`, out of `run-effect.ts`; `amountOf` takes only fixed amounts, so
  nothing that can't count (dividing as it's cast) can be handed a count.

**D-068: Mana of any color comes with the activation; choosing what to sacrifice** · 2026-11-20 · accepted (M2-05c2)
- "Add one mana of any color" (Birds of Paradise): the CR has the color chosen as the ability resolves (CR 608.2d),
  and a mana ability resolves right after it's activated (CR 605.3b), so nothing can happen in between. The engine
  carries the color on the `ACTIVATE_ABILITY` action instead of a decision, a design choice: mana abilities can be
  activated while a payment is pending, where no other decision can wait. The color is checked as the ability
  resolves: one of the five colors, never colorless (CR 105.4), and refused for an ability with a fixed color.
  `legalActions` lists one activation per color; `autoPay` uses any-color sources after fixed-color ones and records
  the color, which is always the best order with one-color and any-color sources; a search is needed only once a
  source offers a restricted choice ("{R} or {G}"), makes more than one mana, or has a mana cost.
- "Each opponent sacrifices a land of their choice" (Yawning Fissure): a `sacrifice` op; each sacrificing player
  chooses among the permanents they control (the filter read relative to them, CR 701.21a) with `chooseCards`, purpose
  "sacrifice". The battlefield is public, so a choice of one isn't asked. With two players there's one chooser; several
  choosing in APNAP order before one simultaneous sacrifice is later (CR 101.4).
- A subject `"eachOpponent"`: every opponent of "you" (CR 102.2; teams later, CR 102.3).

**D-069: Golden games chosen by a cover; Magic 2010's first deck pair** · 2026-11-20 · accepted (the cover is by mechanics since D-082, not cards)
- Golden games come from `pnpm golden:cover`, not from hand-made decks. It plays the fuzzer's decks for each seed (its
  prebuilt pairs and seeded random pool decks) with `by-kind` agents, the fuzzer's picker (D-061), which cast more and
  cancel less than `random`; they aren't the fuzzer's games (no first-legal tenth, no concessions, no checks). It counts what the games already in the folder use, then keeps,
  greedily, the game adding the most unused cards per action, cut off (`maxTurns`) at the turn its last new card is
  used, and re-scores the rest after each pick. It only adds: it never rewrites a golden game (the bench's are fixed,
  D-049), and it checks each written game really uses what it was chosen for.
- A card is used when it's played as a land, a spell of it resolves, or an ability of it resolves or makes mana. A
  cast that's cancelled or countered doesn't run the card's script, so it doesn't count (D-047 counted casts). The
  cover also counts three choices the export tests need: a spell on the stack targeted, a card in a graveyard
  targeted, cards chosen as a spell or ability resolves. The golden test checks the whole pool and the three are covered.
- Why: the folder was 15 MB for 40 games, most of them long games between interim decks. Now it's M1's four (the
  bench) and 20 cut-off games, 3.2 MB, under a 4 MB budget, with every card used and no decision kind or event type
  lost from the fuzzer's measure. Many golden games are now short; deep, long games are the fuzzer's job.
- The interim decks (`white-red`, `blue-green`, `black-red`) are gone. Magic 2010's first pair, `red-green-beats` and
  `blue-black-control`, are first versions of two of m2-pool.md's three decks, from scripted Magic 2010 cards only
  (Ignite Disorder is there so the fuzzer still reaches the `divide` decision); M2-14 finishes them. The fuzzer's
  prebuilt rotation is the M10 pair in both seats, then M1's pair: the M10 pair is its main decks, two prebuilt games in three,
  and M1's decks stay for the bench and the tests built on them.
- `golden:add` takes `--agent` (default `by-kind`). Seeds whose game is already in the folder aren't candidates (a pool
  or deck change can make one name a different game, which `golden:update` handles); each game is checked to cover
  what it was chosen for before it's written; the command lists what's still not covered and fails if anything is. A
  description's "Covered, when chosen" list can go stale once `golden:update` replays a recipe.

**D-070: Combat damage keywords: two damage steps on `Combat`, one division decision for any recipients** · 2026-11-20 · accepted (M2-06a)
- First and double strike (CR 510.4): `Combat` records `firstStrikers`, the attacking and blocking creatures with
  first or double strike as the first combat damage step begins (null when none), and `secondDamageStep`. The snapshot,
  not "who dealt damage", decides the second step (a 0-power first striker still splits the steps; CR 702.7c, 702.4c–d).
  `endStep` begins `combatDamage` again after a first strike step, so the turn stays one walker over `TURN_STEPS`; no
  new step name, since the CR calls both "combat damage step".
- The `assignDamage` decision divides one creature's damage among `recipients` (targets: creatures, or the player),
  replacing `attacker`/`blockers`. A trampler's recipients end with the player it attacks, and `lethal` lists what each
  blocker needs first (CR 702.19b; 1 from a deathtouch source, CR 702.2c). Asked only when there's a choice: a trampler
  with no more damage than its blockers need together divides among them like any creature, and an answer with only
  one legal amount (the last blocker after an earlier one got less than lethal) is filled in without asking
  (`withForcedAnswers`, which the scenario runner and exporter use too). The answer for the last blocker is the one
  trample can refuse, so no partial division reaches a dead end. Palace Guard's division
  among attackers (M2-06b) and planeswalkers (M2-13) use the same shape.
- Lifelink's life gain and deathtouch's record are results of the damage event (CR 120.4c), performed with it in
  `effects/deal-damage.ts`; lifelink gains once per source (CR 702.15e). The deathtouch record is
  `GameState.dealtDeathtouchDamage`, cleared at every state-based action check (CR 704.5h), like the empty-library draw.
- Keyword names are Scryfall's lowercase ones ("first strike"), so the definition check compares them directly.
- Double strike has no Magic 2010 card: it's built because it's part of CR 510.4, tested on test creatures. Gaining or
  losing a keyword between the steps is tested by swapping the creature's card in the state, since nothing grants
  keywords until layers (M2-09).

**D-071: Static abilities that aren't keywords: `CardDef.statics`; Palace Guard's blocks** · 2026-11-20 · accepted (M2-06b)
- "This creature can't be blocked (except by ...)" and "can block any number of creatures" are data in a new
  `CardDef.statics` (`StaticAbilityDef`: `cantBeBlocked` with an optional `except` filter, `canBlockAnyNumber`), read only
  through `staticAbilitiesOf`, like keywords through `keywordsOf`, so layer 6 (M2-09) and Auras or Equipment granting
  them (Whispersilk Cloak, M2-12) change one function. Kept out of `abilities`, which stays activated abilities indexed
  by `{ kind: "printed", index }` (D-028). The `except` filter is read relative to the attacker's controller, the
  ability's "you".
- Landwalk keywords name their land type (`swampwalk`, `forestwalk`); defender is a keyword checked in `canAttack`.
  Scryfall's generic "Landwalk" is left out by the definition check (CR 702.14a).
- "Can't block this turn" (Panic Attack) is a continuous effect with `EffectChange` `cantBlock`: not a layer, a
  restriction `canBlock` reads (CR 509.1b). It's a rules effect, which may reach objects arriving later (CR 611.2c,
  613.11), but on targets it reaches only those legal as it resolves (CR 608.2b), as those objects (CR 400.7); the
  definition check allows it only on targets until an effect read live at declaration is needed.
- A creature that can block any number of attackers gets one `Block` per attacker. Combat damage takes each blocker
  once: blocking two or more attackers, it divides its damage with an `assignDamage` decision for the defending player,
  after the active player's (CR 510.1, 510.1d). Trample's lethal damage counts the damage other attackers assign to the
  blocker (CR 702.19b's first example is a scenario), with any from a deathtouch source lethal (CR 702.2c): the attackers'
  divisions are worked out in order, without trample first, each known before the next, forced ones filled in. With
  two tramplers on one blocker, the first can't count the second's damage, so a split where both trample over can't be
  chosen (later: CR 510.1e, checking the whole assignment at once). Amended at the M2 exit review: with a deathtouch
  trampler the totals did differ by the order declared (Darksteel Colossus and a Gorgon Flail Rhino on Palace Guard:
  12 or 15 to the player), so deathtouch tramplers are now worked out before other tramplers, which makes the most
  damage that can trample over reachable in any order (scenarios `cards/m2-15b/two-tramplers-deathtouch-*`).
- The `block` scenario step takes a list for such a blocker: `{ Palace Guard: [Grizzly Bears, Hill Giant] }`.

**D-072: Whole-declaration rules: checked at `finishDeclaring`, a `takeBack` answer, the most requirements worked out directly** · 2026-11-20 · accepted (M2-06c)
- "Can't attack or block alone" (CR 506.5), "attacks each combat if able", "all creatures able to block it do so" are
  statics (`cantAttackOrBlockAlone`, `attacksEachCombat`, `mustBeBlockedByAllAble`); Alluring Siren's "attacks you this
  turn if able" is a continuous effect `mustAttack` (targets only, like `cantBlock`, D-071).
- A declaration is still built one pick at a time, but `finishDeclaring` is offered and accepted only when the whole
  declaration obeys every restriction and as many requirements as any legal declaration could (CR 508.1c–d, 509.1b–c;
  `combat/declaration-rules.ts`). Since that can leave a pick that no finish allows (a lone "can't attack alone"
  creature), a new answer `takeBack` removes the last pick. `legalActions` lists finishing first, then the picks, then
  take-back, so an agent taking the first action declares nothing instead of adding and taking back one pick forever
  (`first-legal` now never attacks or blocks, as its description says). The fuzzer weights take-back like cancel
  (D-061); the bench's `random` games changed with the new list, so its baseline was reset (D-049). The exporter
  writes a declaration with a take-back one answer at a time, as `choose:` steps, so the replay takes the same
  decisions.
- The maximum is worked out directly, not by searching declarations: every requirement a creature able to attack (or
  block) has, a creature blocking one attacker obeying at most one "block it" requirement (Palace Guard, all of them),
  less the requirements of a lone "alone" creature nothing else can join. That's exact while "alone" is the only
  whole-declaration restriction, since adding a creature never breaks it. Menace and "no more than one creature can
  attack" will need a search (future-rules).
- "Attacks you this turn if able" counts only for an attack on that player, and its most only over attacks on them.
- A scenario step that's rejected is rolled back whole, so a scenario re-declares the full set after `expect error`.

**D-073: The golden folder's budget is 8 MB through M2** · 2026-11-20 · accepted (owner)
- The owner chose to raise the budget (D-069 set 4 MB) to about 8 MB by the end of M2, over a compact action format or
  fewer games, when the folder reached 4 MB after M2-06d. One game per card stays (D-047).

**D-074: Keywords are built with their first card** · 2026-11-20 · accepted (owner)
- The M2-06 spec listed protection's targeting and blocking parts, flash, indestructible and "can't be countered", but
  their Magic 2010 cards arrive later. The owner chose to build each in the task that brings its first card, with
  real-card scenarios: flash with Bogardan Hellkite (M2-07c); protection, indestructible and "can't be countered" with
  White Knight, Black Knight, Baneslayer Angel, Darksteel Colossus and Great Sable Stag (M2-08); indestructible again
  with Indestructibility (M2-12). Double strike, with no Magic 2010 card, stays as built (D-070). The same goes for
  "dies" triggers (Magma Phoenix, M2-14), though last known information comes now (M2-07a, Howling Mine).

**D-075: Damage from one source to one player in two parts stays two parts** · 2026-11-20 · accepted (owner)
- Goblin Artillery dealing 2 to a target and 3 to its own controller is one damage event with two parts: two
  `DAMAGE_DEALT` and two `LIFE_LOST` (2, then 3), as built (D-067). The owner kept it over one 5-point loss; a future
  "whenever you lose life" trigger fires twice.

**D-076: Triggered abilities: detected per event batch, waiting in state, put on the stack before priority** · 2026-11-20 · accepted
- A card's triggered abilities are data in `CardDef.triggers`, apart from `abilities` (like `statics`, D-071): a
  condition, an optional intervening if (CR 603.4), "you may", targets and effects. Read only through `triggersOf`, so
  layer 6 (CR 613.1f) can change them later in one place.
- Detection is one function, `detectTriggers(before, after, events)` (`engine/src/triggers/`), called by
  `checkTriggers` in `happen` (D-056) and where `STEP_BEGAN` and `ATTACKERS_DECLARED` are emitted, each place matching
  only its own events. It exits early when no permanent has triggers (the benchmark). Only permanents trigger
  (CR 113.6). An intervening if is checked as the event happens and again on resolution.
- What triggered waits in `GameState.pendingTriggers`, each remembering its source, the oracle id and index of the
  ability, its controller as it triggered (CR 603.3a), and what triggered it (`TriggerEvent`: the player and object
  "that player" and "it" mean). The stack ability keeps that `TriggerEvent` (`AbilityObject.trigger`), so its effects
  read it on resolution (CR 608.2b); no hidden ids reach a player's view.
- `givePriority` puts them on the stack after state-based actions (CR 117.5): the whole list as one batch, APNAP
  (CR 603.3b), a player with two or more ordering theirs (`orderTriggers`; one left is put on without asking), then
  priority is given again, so new triggers form a new batch. Targets are chosen through the spell's target steps
  (a `Casting` with origin `trigger`), with no cost and no cancel; too few legal targets removes it (CR 603.3d).
- A cancelled cast or activation drops the triggers that came up during it, since its mana abilities' events are undone
  (CR 734.1). That's every waiting trigger: a cast starts only at priority, with none waiting (CR 117.5). A cast that
  could start while triggers wait (casting a card as part of a resolution) would have to record how many were waiting.
- Last known information: `GameState.lastKnown` keeps a card's object as it leaves the battlefield (CR 608.2h), read
  by an ability whose source is gone (Howling Mine's intervening if; "sacrifice it" instead checks the source is still
  on the battlefield, CR 701.21a); emptied when the stack is empty and a
  player would receive priority, so it stays small and stays plain data. "Leaves the battlefield" triggers, which look
  back in time (CR 603.10), will use it (M2-14).
- "You may" is asked as the ability resolves (`chooseYesNo` with purpose `optional`); yes runs the effects.
- An ability removed on resolution says why: `ABILITY_DID_NOT_RESOLVE` has `reason` `illegalTargets` (CR 608.2b) or
  `condition` (an intervening if, CR 608.2a).
- Chosen for future rules: replacement effects (M2-08) come before detection in `happen`, so a replaced event triggers as
  replaced; delayed triggers (M2-07c) will be pending triggers whose source is not a permanent, with their own
  `AbilityRef`; tokens entering trigger the same way.

**D-077: Triggers on casting, drawing, discarding, mana, damage and life gain; identical triggers aren't ordered** · 2026-11-20 · accepted
- New trigger conditions (M2-07b): `spellCast` (a filter on the spell as cast, its `controller` the caster), matched
  where `SPELL_CAST` is emitted as the spell becomes cast (CR 601.2i), so the trigger goes on the stack above the spell;
  `playerDraws`, `playerDiscards`, `selfDealsDamageToPlayer`, `playerGainsLife`, matched in the pipeline; and
  `landTappedForMana`, on a new `TAPPED_FOR_MANA` event that `resolveManaAbility` emits when a mana ability with {T} in
  its cost produced mana (CR 106.12, 106.12a), the one path every mana payment takes. "A player / you / an opponent"
  is a `PlayerRelation`, relative to the trigger's controller.
- `TriggerEvent.amount` ("that much", the `Amount` `"thatMuch"`) is the life gained; a gain of 0 has no event
  (CR 119.9). Each lifelink source is its own life-gain event, so Sanguine Bond triggers once per source (its ruling).
- "Target ... that player controls" is an `ObjectFilter.controller` of `"triggeringPlayer"`, read only by the target
  checks (`rules/targets.ts` passes the ability's `TriggerEvent.player` to `matchesFilter`), as targets are chosen and
  again on resolution; `definitionProblems` refuses it anywhere else.
- When all of a player's triggers in a batch are identical (the same ability of the same source, with the same
  `TriggerEvent`), they go on the stack without an `orderTriggers` question: no order can be told apart (CR 603.3b
  lets the player choose, and every choice is the same). A trigger keeps from its event only what its effects read,
  so Manabarbs' triggers from six lands are identical (it reads "that player", not the land).
- The cleanup step gives priority when triggers are waiting, as when a state-based action was performed (CR 514.3a):
  a discard to hand size triggers Megrim.
- Lurking Predators: `revealTop` reveals the top card as `"found"`; `put` gains `onlyIf` (a filter: "if it's a
  creature card"), `optional` ("you may put", asked only if there's a card to put) and `into: "libraryBottom"`.
- The CLI log shows each `TAPPED_FOR_MANA` ("p1 taps Forest for mana"), so every golden log gained those lines and
  nothing else.

**D-078: Dragon Whelp counts activations as they're made and checks the count on each resolution** · 2026-11-20 · accepted (owner)
- "If this ability has been activated four or more times this turn": an activation counts the moment it's activated,
  its cost paid and the ability on the stack (CR 602.2), whether or not it resolves: one countered (Stifle) still
  counts. A cancelled activation is reversed (CR 734.1, D-035), so it was never activated and doesn't count.
- Each activation, as it resolves, checks the count so far this turn; four or more creates a delayed trigger to
  sacrifice the creature at the beginning of the next end step (CR 603.7). So four activations stacked before any
  resolves make four delayed triggers; the creature is sacrificed once, and the others do nothing.
- A 4th activation during the end step sacrifices it at the next turn's end step (its ruling; "the next end step" has
  begun already, CR 603.7). The count is per object: a creature that leaves and returns is a new object with a count of
  0 (CR 400.7).
- Owner's answer to the open question, 2026-11-20. Built in M2-07c.

**D-079: Upkeep, block and sacrifice triggers; flash; destroy at random** · 2026-11-20 · accepted
- `beginningOfStep` states `whose` step: `each` (Howling Mine, Ball Lightning) or `yours` (Xathrid Demon, Capricious
  Efreet), so every card says which.
- `selfBlocksOrBlocked` triggers once per creature blocked or blocking (CR 509.3b, 509.3d), matched where
  `BLOCKERS_DECLARED` is emitted; the detector's `matches` returns one `TriggerEvent` per occurrence (CR 603.2c), and
  "that creature" is the subject `triggeringObject`. `definitionProblems` checks which conditions supply a player, an
  object or an amount, each an exhaustive switch.
- Sacrificing during a resolution records each permanent with its power computed just before it leaves (its last
  known information, CR 608.2h) in the resolution's "this way" record (`Resolution.sacrificed`, CR 608.2c), where
  `cards` is in scope; `"sacrificedPower"` reads it, 0 if nothing was (CR 107.2), never below 0 (CR 107.1b), and `ifNothingSacrificed`
  ("if you can't sacrifice") reads whether anything was started (CR 118.12). With nothing sacrificed, each opponent
  loses 0 life, an event (D-065). `GameState.lastKnown` stays the raw object.
- `destroyOneAtRandom` picks among the still-legal targets with the seeded RNG as the effect resolves.
- "Any number of targets" for a divided effect (Bogardan Hellkite) may be zero: CR 107.1c says "any number" is any
  positive number or zero. Forum answers saying a divided effect needs one target (a Magic Judges forum answer on
  Atarka's trigger, old Gatherer rulings on X spells) predate the Core Set 2020 rules update, which removed that
  exception (MTG Salvation's summary). Checked under D-080.
- Flash (CR 702.8a) is a keyword read in the hand by `castTimingProblem`, the one timing check legal actions and
  `applyAction` share.
- A scenario invariant: a pending decision always has a legal action (a trigger's targeting has no cancel, so a count
  or division that can't be completed would stall the game).

**D-080: Card ambiguity: the CR, then the rulings, then what players and judges say online** · 2026-11-20 · accepted (owner)
- The owner: when a card's mechanics are ambiguous, refer to the CR; if that doesn't help, search online for what
  people think. So the order is the CR, the card's official rulings, then rulings and judge answers found online
  (judge Q&A, rules forums, tournament rulings), and only then the owner. The source is recorded with the decision or
  in the scenario's comment, so the reading can be checked later. Replaces CLAUDE.md's "stop and ask" for card
  ambiguity; a question the CR and these sources leave open still goes to the owner.

**D-081: The golden folder's budget is 16 MB through M2** · 2026-11-20 · accepted (owner)
- The owner chose to raise the budget again (D-073 set 8 MB) and asked what's reasonable. Measured after M2-07c1: 66
  games, 5.3 MB for 150 cards, about 36 KB per card (70% action files, 30% logs; both compress about 6 times, and git
  stores them compressed). All 234 Magic 2010 cards come to about 9 MB, plus log lines new event types add, so 16 MB
  leaves room through M2.
- One game per card doesn't scale to the whole of Magic (tens of thousands of cards, about 1 GB at this rate). Before
  the pool grows past Magic 2010, golden games change shape: a compact action encoding, and games chosen to cover each
  mechanic and interaction rather than each card, with cards covered by their scenarios. That's a decision for then.

**D-082: Golden games cover mechanics and interactions, in a compact action format** · 2026-11-20 · accepted (owner)
- The owner: find a more compact way to store a game's actions; golden games needn't cover each card (that was only a
  way to make sure each mechanic is covered), so choose and create games that cover mechanics and interactions.
- Coverage: a golden game is chosen for the features it exercises, not the cards. A feature is what the engine runs:
  each effect op, trigger condition, keyword, static ability, cost kind and target kind of a card whose script runs
  (D-069's "used"), each decision kind and event type, plus the choices the export tests read. Each card is still
  covered by its own scenarios (the add-cards skill; a test will check every pool card appears in one).
- Format (changed by D-083: lines name the acting player), measured on the current 66 games: actions drop the decision id and the acting player (both follow from the
  pending decision when replaying), runs of passes are one line, and each action is one readable line ("pass 4",
  "cast o12", "chooseTarget p2"): 3.3 MB of actions become 0.44 MB. Setups name cards instead of oracle ids
  (0.23 MB to 0.09 MB). Logs stay as they are (the readable diff when a game changes).
- Built as its own task before M2-07c2; the M1 bench games (D-049) are converted, not replaced.
- Built (2026-11-20): `cli/src/action-lines.ts` and `setup-names.ts`, `readGameFile` reading either encoding, and
  `cli/src/mechanics.ts` for the cover. Converting the 66 games left every log unchanged and took the folder from
  5.4 MB to 2.5 MB. The mechanics test found 13 mechanics no golden game ran (a card counted as used when cast, even if
  its trigger never fired), so the card-chosen games were replaced: the four bench games and the three the export tests
  read stay, and 18 games chosen by mechanics cover the rest: 25 games, 1.5 MB. Centaur Courser and Fire Elemental, the
  only pool cards in no scenario, got one each. Supersedes D-069's card cover.
- Where a unit counts (code review): combat keywords and static abilities as the creature attacks or blocks, where
  they do something (a creature that only entered on the last turn proves nothing); flash and shroud as the permanent
  enters; each field of a spell, activated or triggered ability, through tables keyed by every field
  (`Record<keyof SpellDef, ...>`), so Fireball's cost increase (with a second target) and Consume Spirit's "spend only
  black mana on X" are units; every decision kind, not counting a cancel or take-back; every event type, but
  `ABILITY_COUNTERED` (no pool card counters an ability).
- Lines left after the game ended are counted, and `pnpm golden:update` says the game ends sooner. (Lines first left
  out the acting player too, so golden games stopped checking priority order; D-083 put it back.)

**D-083: Golden action lines name the acting player** · 2026-11-20 · accepted (owner)
- The owner: the compact format should have a compact way to show which player acted. Each line starts with the
  player (`p1 cast o12`, `p2 chooseTarget p1`, `p1 concede`), and a run of passes lists who passed, in order
  (`pass p1 p2 p1 p2`). Reading back checks each line's player against the pending decision's, so golden games again
  catch a change in who gets priority or who decides (CR 117.3b–d), which D-082 had given up. Only the decision id
  is still left out.

**D-084: Delayed triggers, activation counts and "becomes the target" (M2-07c2)** · 2026-11-20 · accepted
- Delayed triggered abilities (CR 603.7) live in `GameState.delayedTriggers`, each with its source, the source's
  oracle id, its controller and its own `TriggeredAbilityDef` (the source and controller of the spell or ability that
  made it, CR 603.7d, 603.7e). `detectTriggers` matches them before the battlefield's, without looking their source up
  (it may be gone), and one that triggers is removed (CR 603.7b). A pending trigger and a stack ability name them by
  `AbilityRef` `{ kind: "delayed", ability }`, carrying the text itself, since no card prints it; two identical ones go
  on the stack unasked (D-077). For now a delayed trigger waits only for the next beginning of anyone's step and has
  no targets; the card definitions refuse anything else, since "your next upkeep" would need its own controller, not
  its source's (future-rules).
- Activations are counted per object, per printed ability, as each becomes activated (where `ABILITY_ACTIVATED` is
  emitted), in `GameState.turnHistory.activations` (the "this turn" container architecture.md planned), emptied as a turn
  begins (D-078). The effect
  `ifActivatedThisTurn { atLeast, effects }` reads its own ability's count as it resolves, so it's for activated
  abilities only.
- "Becomes the target" is an event, `BECAME_TARGET`, emitted as each object target is chosen (spells, activated and
  triggered abilities alike) and matched where it's emitted, like `SPELL_CAST`. Cancelling a cast still drops every
  pending trigger: a cast starts only with none waiting, so all of them came from it.
- Golden cover: a delayed trigger is its own unit, `trigger delayed`, credited only as one resolves, since the effect
  that makes it is credited whether or not its condition held.
- The card definition checks read a delayed ability as its own triggered ability (its effects run apart, with its own
  targets and trigger event), named "<card> ability 1 delayed trigger"; a condition's effects are read with the
  effects around them. Which ops nest other effects is one exhaustive switch (`cards/src/flat-effects.ts`), which the
  golden cover imports too (code review).
- Waiting delayed triggers aren't in `playerView` yet, nor is making one an event; the match UI (M3) adds both
  (status, Known issues).

**D-085: Replacement effects from a card's own text; indestructible; two-color mana (M2-08a)** · 2026-11-20 · accepted
- A card's own replacement effects are data, `CardDef.replacements`, read through `replacementsOf` (layer 6 later), and
  applied in the pipeline's `replace` (`pipeline/replacements.ts`) to each event against the state before its batch
  (each watches for an event about to happen, CR 614.1; CR 614.4, once cited for this, says a replacement must exist
  before its event). Each kind says where it works: "enters tapped unless" as the card enters (CR 113.6h, 614.12), "if it would
  be put into a graveyard from anywhere" in every zone (CR 113.6b), so the moving card's own text is read, not only the
  battlefield's.
- A replacement changes where the card goes, not what happens to it: destroy, sacrifice, counter and discard carry the
  new destination (`Rerouted`) and still emit their own events. The rulings read it so (Leyline of the Void: a card
  exiled instead was still discarded; madness works), and a cost paid that way is paid (CR 118.11). Xathrid Demon,
  Vampire Aristocrat's cost, `ifNothingSacrificed` and Megrim rely on it.
- Indestructible (CR 702.12b): a destroy it ignores is dropped before performing, like 0 damage (CR 120.8), and the
  lethal-damage and deathtouch state-based actions aren't listed for it (D-039).
- Until M2-08c, two replacements applying to one event refuse rather than choose for the player; no pool card can
  reach it.
- "Add {G} or {W}": `addMana`'s `mana: { oneOf }`, the color sent with the activation like "any color" (D-068).
  `autoPay` takes the source with the fewest choices first, enough for costs of one color (every Magic 2010 cost).
- The Magic 2010 decks run two checklands each in place of basics, so agents play them; random decks stay basic.

**D-086: Regeneration shields, removed from combat, Polymorph (M2-08b)** · 2026-11-20 · accepted
- Replacement effects made by resolving spells and abilities live in `GameState.replacements` (the list
  architecture.md planned). The first is the regeneration shield, `{ kind: "regenerationShield", object }`, made by
  the `regenerate` op outside the pipeline like a continuous effect (making one isn't regenerating, CR 701.19c), and
  ended in cleanup (CR 514.2). A permanent no longer on the battlefield gets none.
- `replacements.ts` gathers a destroy's candidates from the event: the moving card's own text and its shields. One
  candidate stands for all of a permanent's shields, as they're interchangeable (like D-077); a shield and a different
  replacement on one destroy still refuse until M2-08c. "It can't be regenerated" is `noRegeneration` on the destroy
  (CR 701.19c). An indestructible permanent's destroy is dropped before any of this, so its shield stays (CR 614.17c).
- Regenerating is one pipeline event, `regenerate`, performed whole (CR 701.19a): a shield used up, all damage removed,
  tapped, removed from combat. `Combat.removed` records creatures an effect removed while they stayed on the
  battlefield (CR 506.4), read through one helper in `rules/combat.ts`; a blocked attacker stays blocked (CR 509.1h).
- Polymorph: `revealUntil` (cards stay in the library; the one that fits is "found"), the subject
  `{ controllerOf: { target } }` (last known information once the target is gone, CR 608.2h), and `put`'s `by`, the
  player who puts the card onto the battlefield and controls it (CR 110.2a).

**D-087: Choosing between replacement effects; an event that waits (M2-08c)** · 2026-11-20 · accepted
- When two different replacement effects would apply to one event, the affected player or the affected object's
  controller chooses which applies first (CR 616.1), several players in APNAP order. `happenOrAsk` then performs
  nothing, sets a `chooseReplacement` decision, and the answer queues a `resumeEvent` work item: the event is replaced again
  from the start with the choices so far, as nothing has happened yet. Candidates are named by stable references
  (`ReplacementRef`: a card's own text by object and index, or an object's regeneration shields), and applied one at a
  time, the rest checked again against the changed event (CR 616.1f).
- Only callers that do nothing after the event may wait: resolving effects' destroy and damage (one work item each)
  and combat damage, which queues its priority first. Plain `happen` refuses a choice; a test lists who may import
  `happenOrAsk`. Converting the other callers waits for the first card that needs one (Clone, M2-14). With the pool,
  only damage meets two different effects (M2-08d).
- A replacement that swaps the event for another (regeneration for a destroy) replaces the whole modified event, so
  what earlier replacements put around it goes too (CR 614.6). Proven with the test-only Homing Bear and a shield.
  The rules review found a credible counter-reading: CR 701.24c shuffles a library "even if ... an effect causes all
  of those objects to ... remain in their current zone", so library-first then regeneration might still shuffle. We
  read 701.24c as about instructions carried out (its examples are a trigger and a spell), not an event replaced;
  no ruling or judge source settled it (the review couldn't reach any). Unreachable with the pool. Open question.
- Choices are applied in the order made (the earliest choice still among the candidates). One flat list of choices
  works because every reference names its affected object; replacements from other permanents or players (Rest in
  Peace, Fog) will need choices keyed to the affected object or player (future-rules).
- The decision kind isn't required of golden games until M2-08d's cards can reach it (`DECISION_KINDS` takes a reason).

**D-088: Damage prevention, per damage entry (M2-08d1)** · 2026-11-20 · accepted
- A damage event stays one event (CR 120.4, D-067); each entry (a source dealing damage to a recipient) is replaced
  on its own inside it (`pipeline/damage-replacements.ts`), with its own candidates and its own chooser, the recipient
  player or the recipient object's controller (CR 616.1). Choices are keyed to what they're for
  (`ChoiceFor`: the affected object, or the entry by its place in the event as proposed, with its source and
  recipient), so a choice made for one entry isn't used for another, even one with the same source and recipient.
  Entries of 0 damage or to a recipient that can't be dealt damage are dropped first, so no effect is used on them.
- Prevention effects made by resolving spells (Fog, Safe Passage) live in `GameState.replacements`, each with its own
  id (from `newObjectId`, so two from one source are two effects) and its card's oracle id (the spell is gone when
  it's offered as a choice), checked as each damage event happens and ended in cleanup. A permanent's own prevention
  text (Guardian Seraph) is read from the battlefield, the first replacement read from another permanent than the
  moving card; a gone source's controller is its last known one (CR 113.7a, 608.2h).
- Prevented damage is never dealt (CR 615.6): lifelink and "deals damage" triggers see only what's left. A
  `DAMAGE_PREVENTED` event says what was prevented and by which card, for the log, the UI and the golden cover.
- Identical candidates (two Guardian Seraphs: the same text under the same controller; a Fog from each player, whose
  controller doesn't matter) are one option: choosing it applies one of them, and the rest are checked again
  (CR 616.1f), so every order the rules allow can still be chosen (Seraph, Fog, and the second Seraph never applies),
  while the player never sees two options that are the same. With no different candidate, they're applied without
  asking. Different ones are asked about even when the order can't change the result (Seraph and Fog), as CR 616.1
  has the player choose, and which effect prevented the damage will matter to CR 615.5 extra effects. Skipping those
  is a later UX question. (The first version applied all identical ones at once; the M2-08d1 review found duplicate
  options and an ambiguous scenario choice.)

**D-089: Which cards and mechanics come after M2: what MTG Arena has, without Alchemy** · 2026-11-20 · accepted (owner)
- The owner: Scryfall can filter cards that exist on MTG Arena (`game:arena`, a printing's `games` including
  `"arena"`), which is a good guide so we don't spend time on mechanics even Arena doesn't handle; Alchemy cards should
  be ignored.
- So, beyond M2, cards are chosen from those with a non-Alchemy Arena printing, and a mechanic is built only if some
  such card needs it. Alchemy means the rebalanced cards (names starting "A-") and cards printed only in Alchemy sets
  (`set_type` "alchemy"); an ordinary card also reprinted in an Alchemy set still counts by its other printings.
- Measured (2026-11-20): of 39,356 unique cards, 16,618 have an Arena printing, 15,742 outside Alchemy, 876 only in
  Alchemy. Magic 2010 was never on Arena, so 87 of the pool's 166 cards and 51 of the 76 still to script aren't on it,
  though their mechanics (Auras, Equipment, planeswalkers, tokens, protection) are. M2 finishes the Magic 2010 pool as
  specified; each M2-14 special-rules card is checked against Arena first (Open questions).
- The owner, later the same day: the filter is Scryfall's `game:arena -is:alchemy -is:digital`. That query is the
  definition, and the site decides when a card's status is in doubt. It keeps a card with a printing that is on Arena,
  not Alchemy and not digital-only: 14,010 cards on 2026-11-20 (15,702 without `-is:digital`). The 2,248 it drops more
  than `-is:alchemy` alone are digital-only designs (Jumpstart: Historic Horizons and the like, with digital-only
  mechanics such as "seek", "conjure" and "perpetually") and also paper cards that reached Arena only in digital
  reprint sets (Abbot of Keral Keep, from Arena's anthologies). Those paper cards use paper rules, so leaving them out
  costs no mechanic; the filter is a guide to which mechanics to build, not a ban on a card.
- **Final (owner, 2026-11-20): `in:arena in:paper -is:alchemy`**, a card printed on paper that is on Arena in any
  printing (option (a) of the question about `-is:digital`). It keeps the paper cards Arena had only through its
  digital reprint sets, whose rules are all in the CR, and still drops digital-only designs, whose "conjure", "seek"
  and "perpetually" aren't in the CR at all (searched), so they can't be built from the spec. 15,789 cards
  (14,623 Modern-legal) on 2026-11-20. About a dozen digital designs printed on paper in Mystery Booster sets
  (Oracle of the Alpha, the "Collector" cycle) slip through; they're skipped by name. The two bullets above record
  how the filter got here; the measurements below were taken under `-is:digital`.
- The pool figures above ("87 of 166", "51 of 76") were measured under the first filter (`game:arena` without
  Alchemy); Magic 2010 was never on Arena either way.
- What the filter leaves out (owner's question, measured on Scryfall 2026-11-20; baseline: paper, not Un-sets):
  14,010 of 33,375 cards; 13,036 of 23,012 Modern-legal; 11,946 of 15,381 Pioneer-legal; 13,554 of 23,041 printed
  since 2018. 215 of Scryfall's 304 keyword abilities and actions appear on a card it keeps. Of the 84 that don't,
  about 30 are digital-only or from products Arena never had (conjure, spellbook, Attractions, Backgrounds, Planechase);
  51 appear on 596 Modern-legal cards: Fear, Megamorph, Clash, Soulshift, Level Up, Monstrosity, Bloodthirst,
  Intimidate, Echo, Renown, Soulbond, Undying, Multikicker, Embalm, Fuse, Awaken, Transmute, Unleash, Cipher,
  Flanking, Dredge, Buyback, Scavenge, Freerunning, Detain, Forecast, Miracle, Tribute, Surge, Haunt, Conspire,
  Ingest, Afflict, Prowl, landwalk variants, Recover, Ripple, Epic, Offering and a few singletons. Flip cards
  (Kamigawa) have none; split cards 50 of 123; Auras 359 of 1,244. None of these is hard for the engine's design
  (all are CR rules on the same machinery); the filter only decides what's built first. Banding and phasing, the
  costly ones, aren't Modern-legal anyway.

**D-090: Harm's Way is left out; what redirection with an amount needs (M2-08d2)** · 2026-11-20 · accepted (owner)
- Harm's Way ("The next 2 damage that a source of your choice would deal to you and/or permanents you control this
  turn is dealt to any target instead") was built twice on the branch and reverted (commits 1c4fcda, 93f2c4d,
  6fd7c9e, 1316d92, kept in history; reverted after the third rules review). Each review found wrong results reachable
  with the pool, so the card was taken out of the pool.
- Why it's hard: its split ("you choose which 2 damage", its ruling) has to be made when the effect applies, against
  what earlier CR 616.1 choices left, and CR 616.1 choices are per affected object or player, made by each affected
  player in APNAP order. Settling shares before those choices made the order choice meaningless (two of one player's
  Harm's Ways) and lost shield (prevention first). Choosing once per player for all their recipients loses outcomes the
  per-recipient choices reach (Safe Passage first for you, Harm's Way for your creature).
- What a correct model needs, from the reviews: choices per (effect, recipient) for prevention; Harm's Way as one
  option over all of its controller's affected recipients, split at application; CR 614.5's "one opportunity" for
  replacement effects (Harm's Way) event-wide, and prevention ("prevent all") applying to any part it hasn't
  prevented, including parts redirected later; Guardian Seraph's 1 counted per source and recipient across the
  event (CR 615.10); APNAP order across the affected players, and which goes first when one player's lone effect
  needs no choice (unsettled: CR 616.1, 101.4 don't say); the sources of abilities on the stack offered even after
  they left (CR 609.7a); damage already headed for the target not redirected (CR 614.9 "another", 609.7b; no ruling
  found online, D-080). The paper model also merged one source's damage to one recipient into one part, which would
  reverse D-075 (Goblin Artillery's 2 and 3 to its controller stay two parts), an owner decision.
- Why set aside rather than finish now: none of this is needed by another Magic 2010 card, Harm's Way isn't on MTG
  Arena, and no card that filter keeps has "a source of your choice ... is dealt to ... instead" (Scryfall,
  2026-11-20, `in:arena in:paper -is:alchemy`, D-089). Three of the readings above needed the owner (D-080, and
  reversing D-088's per-entry choice), who chose to leave the card out (below). Fog, Safe Passage and Guardian Seraph (M2-08d1, D-088) are unaffected.
- The owner chose (a), 2026-11-20: leave Harm's Way out of the pool, like the M2-14 cards Arena doesn't have. M2
  finishes without it; this entry is the design record if a card ever needs redirection with an amount. The per-entry
  choice (Known issues) stays as built until a card makes it matter.

**D-091: Protection, and "can't be countered" (M2-08e)** · 2026-11-20 · accepted
- `CardDef.protections` lists the qualities, one per "from" (CR 702.16g): a color or a subtype (Baneslayer Angel's
  Demons and Dragons), read through `protectionsOf` (layer 6, like `keywordsOf`), on the battlefield only (CR 113.6).
  Protection is parameterized, so it's its own field rather than a `Keyword` string; the Oracle check counts it as
  Scryfall's "Protection" keyword. `rules/protection.ts`'s `isProtectedFrom(state, permanent, source)` reads the
  source as it is, or as it last existed if it left; for an ability, its source's card (CR 702.16b, 113.7a). Printed
  colors and subtypes, as nothing changes them yet; a snapshot `characteristics()` replaces that when effects can.
- What it stops: targeting (`legalTargets`, so also on resolution, CR 608.2b), blocking (`canBlock`), and damage: a
  "prevent all" candidate in `damage-replacements.ts` with its own `ReplacementRef` (`protection`), so it's ordered
  with Fog and the others like any prevention (D-088). Being enchanted or equipped comes with Auras and Equipment
  (M2-12, CR 702.16c-d); protection from players or from everything when a card needs it.
- "This spell can't be countered" is a static (`cantBeCountered`) read on the stack (CR 113.6g): `happen` drops a
  counter event aimed at it, as it drops a destroy aimed at an indestructible permanent (CR 101.2). The spell is
  still a legal target, and the counterspell resolves and does its other parts (Great Sable Stag's ruling).
- Golden cover: "keyword protection" is credited in combat (coarse, like indestructible); static abilities now have a
  `STATIC_WHEN` table like keywords, "can't be countered" credited as the spell resolves, whether or not a counter was
  tried (coarse too).
- After the M2-08e reviews: the source's colors and subtypes are read through `colorsOf` and `subtypesOf` while it
  exists, and printed values only for a gone source (the snapshot is later). `protectionsOf` works in any zone, like
  `keywordsOf`, and `isProtectedFrom` checks the battlefield (CR 113.6); protections are in `characteristics()` and
  `inspect`. The Oracle check compares `protections` with the text's "protection from A and from B".


**D-092: One board-wide layer pass, kept per its inputs (M2-09a)** · 2026-11-20 · accepted
- Characteristics come from one pass over the battlefield and the stack, layer by layer (`rules/layers.ts`, CR 613.1),
  which every reader reads (`cardTypesOf`, `colorsOf`, `keywordsOf`, `protectionsOf`, `staticAbilitiesOf`,
  `powerAndToughness`); a card in another zone is computed alone as it's asked for. Effects in one layer see the board
  as the layers before left it, which per-object readers couldn't do (CR 613.6, 611.3a; future-rules).
- `controllerOf` stays outside the pass: it takes no card database and is asked everywhere; layer 2 effects from
  resolved spells (Act of Treason) need none. A static control effect (an Aura's "you control enchanted creature",
  M2-12 or later) would need `controllerOf` to take the card database, a wide signature change.
- The pass is kept, not stored in the state (architecture.md: "memoize per state object if profiling shows a need,
  never by caching values inside the state"): module-level `WeakMap`s keyed by exactly what it reads (`LayerInputs`:
  the objects, the effects, the battlefield, the stack, the rule modifiers, and the card database), plus the last
  result. These kept values (`computedFor`, `last`, `zonesKept`, and `startsKept`, each card's printed values with a
  controller) are the engine's only module-level values that change after it loads (constants such as `MANA_TYPES`
  don't); CLAUDE.md's "no globals" means no hidden state that can change a result, and these can't: the pass is pure,
  its type lets it read only its inputs, the state is never changed in place, and the fuzzer checks after every action
  that the kept pass equals a fresh one (`layersMatchFreshPass`). The shared starts are the one part the fresh pass
  shares too, so they're frozen (`Layered` is read-only in its type, and a change in place throws). The owner is asked to confirm this reading of
  "no globals" (status.md, Open questions).
  A new layer that reads more (combat, for "attacking creatures") adds it to `LayerInputs` and the key.
- Measured: before keeping it, an action was about 5 times slower; keyed by state object, 2 to 3 times; keyed by its
  inputs, with the last-result shortcut, 1.2 to 1.6 times (the pass reruns whenever an object changes). A profile then
  showed `zoneOf` searching every library first; searching the battlefield and the stack first brought a random game
  back under its 100 ms budget (98.5 ms on this machine, against 61 before the pass); anthems and the review fixes
  took it to 103. A profile then found three cheap fixes outside the pass's logic: each card's printed values made
  once and shared (most permanents are lands nothing changes), the basic land types' mana abilities made once, and
  legal actions asking only the player's own permanents for abilities (the basic land abilities frozen, as every caller
  shares them). A random game is now 78 to 82 ms (78 in the baseline's run); the baseline is updated for that, with a
  new measure of a fresh pass (`layers.freshPass`). Two measures got slightly slower in that run, within the bench's
  noise (`applyAction.deepStack` +7%, `characteristics.busyBoard` +8%). Incremental recomputation would be the
  next step if a benchmark asks.

**D-093: Anthems and granted keywords in the layer pass (M2-09a)** · 2026-11-20 · accepted
- Static abilities that change other objects are `StaticAbilityDef`s read inside the pass (`rules/static-effects.ts`):
  `creaturesGet` ("[other] [filter] creatures [you control] get +P/+T [and have K]", Honor of the Pure, Veteran
  Armorsmith and Swordsmith, Elvish Archdruid, Merfolk Sovereign, Goblin Chieftain, Rhox Pikemaster, Levitation),
  `plusPerSharedCreatureType` (Coat of Arms) and `plusPerOtherSameName` (Relentless Rats). They apply only from the
  battlefield (CR 113.6, 611.3b) to what fits as they apply (CR 611.3a), found from the board as the earlier layers
  left it (`fitsOnBoard`; the readers read the finished pass, so the pass can't call them). One with keywords finds its
  set in layer 6 and keeps it for 7c (CR 613.6; `later:` there, as nothing between those layers can change a set yet).
- Resolved effects: `gainKeywords` (layer 6, `addKeywords`) beside `modifyPT`, both on the objects fixed as they begin
  (CR 611.2c): Glorious Charge, Overrun, Trumpet Blast (the attacking creatures then), Kindled Fury, Jump, Burst of
  Speed. "Can't be blocked this turn" (Merfolk Sovereign) is a rules effect `canBlock` reads, like "can't block".
- Order inside layers 6 and 7c: they only add, so timestamps can't change the result (the paper review found no case
  in the pool); dependency (CR 613.8) is left for the first card that needs it (Open questions).
- "Add {G} for each Elf you control" (Elvish Archdruid): a mana ability's amount may be a count, as it resolves. Auto
  pay skips it (it pays only with 1-mana sources).
- Golden cover credits the anthem statics as their permanent resolves (coarse: many are on noncreatures).


**D-094: Characteristic-defining abilities in layer 7a (M2-09b1)** · 2026-11-21 · accepted
- A printed `"*"` is kept as `"*"` in the card data (`PrintedCard.power: number | "*" | null`), not turned into a
  number: the definition check then requires a characteristic-defining ability exactly where there's a `"*"` (CR 208.2a,
  604.3). One that can't be determined is 0 (CR 208.2a). "1+*" waits for a card that needs it.
- "Power and toughness are each equal to the number of [filter] you control" is a static ability,
  `powerToughnessEachEqual`, read in layer 7a for its own object only (CR 613.4a), in every zone: a card in hand or a
  graveyard is computed with the board, its owner being "you" (CR 108.4a). The base is 7a's value, else the printed
  one; 7c adds to it. The count is read from the board after layers 1-6; layer 7 changes only power and toughness,
  which no filter reads today, and the definition check refuses combat in it.
- "Can't attack unless defending player controls [filter]" is a static restriction checked per attacker and player in
  `possibleAttacks` (`canAttackPlayer`, CR 508.1c), so a "must attack" requirement it makes impossible is simply not
  obeyable (CR 508.1d).
- Scenarios can name a card in a hand or graveyard (`hand:p1:Nightmare.power`), and `inspect` shows the 7a base.
- Future impact: 7b (Awakener Druid, M2-09b2) sets a base after 7a, in timestamp order (CR 613.7); a CDA whose count
  reads power would need dependency order (CR 613.8); tokens' CDAs come from the effect that made them (CR 604.3a).

**D-095: Type, color and setting effects in layers 4, 5 and 7b (M2-09b2a)** · 2026-11-21 · accepted
- One effect change, `becomes { addTypes, addSubtypes, colors?: {set} | {add}, setPT? }`, applied in every layer it
  touches (CR 613.6): types and subtypes added in layer 4, keeping the others (CR 205.1b), colors set or added in 5,
  base power and toughness set in 7b. Each layer goes through `state.effects` in order, which is timestamp order
  (CR 613.7). Setting types without keeping the others waits for a card that does it.
- Durations: `"endOfTurn"`, `"endOfGame"` (none stated, CR 611.2a) and `"whileSourceOnBattlefield"`. The last ends in
  `moveCard` as its source leaves, with EFFECT_ENDED, and none is made if the source has already left (CR 611.2b). An
  "endOfGame" effect stays in the state after its object is gone; it can't apply again, as ids are never reused.
- Rise from the Grave's "is a black Zombie" is `put { into: "battlefield", is }`: the move itself makes the effect
  (`Destination.is`, `moveCard`), on the new object, its timestamp after the object's, before triggers look at what
  entered (CR 611.2e, 613.7n; a unit test with a "whenever a Zombie enters" test card). Not for tokens: CR 611.2e is
  about nontoken permanents, and a token's stated characteristics are its copiable values (CR 111.3, 707.2), so M2-11
  gives tokens their own characteristics source instead. `moveCard` also ends "while on the battlefield" effects, so `zones/`
  doesn't import `effects/`.
- A creature with no power or toughness (a land made a creature without one set) is 0/0 (CR 208.5).
- Removal from combat (CR 506.4) is recorded in `Combat.removed` as it happens: `advance` checks after each piece of
  work for an attacker or blocker that stopped being a creature, so becoming one again doesn't bring it back (both
  reviews found this; a second Awakener Druid did). Control changes (M2-09c) will add to the same record.
- Layer 7 moved to `rules/layer-seven.ts`. A land made a creature gets its P/T from 7b although none is printed;
  `Layered.base` says where the base came from, and `inspect` shows it.
- Not built: subtypes by kind (Coat of Arms counting creature types only, CR 205.3m). An animated Forest shares no land
  type with another creature in the pool, so nothing shows it; it stays `later:`.
- Future impact: layer 2 (M2-09c) and Auras' statics (M2-12) set and add in these layers the same way; tokens (M2-11)
  are made with characteristics like Rise's `is`.

**D-096: Last known characteristics, and delayed abilities that remember (M2-09b2b)** · 2026-11-21 · accepted
- `perform` snapshots the computed characteristics (controller, types, subtypes, colors, power, toughness) of each
  permanent an event may move off the battlefield (moved, destroyed, sacrificed; an exhaustive `switch` over the event
  kinds), from the state before the event, and keeps those that left in `GameState.lastKnownCharacteristics`, emptied
  with `lastKnown` (CR 608.2h). A simultaneous batch is snapshotted at once, so a Druid moving first doesn't make its
  Forest leave as a mere land (CR 704.8 for state-based actions). Readers: protection's source qualities, Stone Giant's
  "this creature's power", and "its controller" of a gone object (`controllerNowOrLastKnown`), which M2-09c's layer 2
  then follows. A spell leaving the stack keeps no snapshot yet. `perform` reads
  characteristics but changes nothing else; the pipeline guard test allows it. Keywords join the snapshot with the first
  reader that needs them.
- The new state field changes the saved replays' final-state hashes; with it left out, each hash is the old one.
- Stone Giant: the permanent target's `toughnessBelowSourcePower`, its source's power now or as it last existed, so it's
  rechecked as the ability resolves (CR 608.2b). "Destroy that creature at the beginning of the next end step":
  `createDelayedTrigger { about }` keeps the named objects on the delayed ability's reference (`objects`, left out when
  it names none), and the subject `"remembered"` reads them (CR 603.7c). A remembered object
  that left is a new object and isn't affected (CR 400.7). The definition check refuses `"remembered"` elsewhere.

**D-097: Rules effects on players, and hand size (M2-09c1)** · 2026-11-21 · accepted
- "Your opponents can't cast spells this turn" (Silence) is an effect change `cantCastSpells { players }`: the opponents
  of its controller (CR 109.5, 102.2), which can't change during a game, so they're stored as it resolves; it affects
  no objects. `castProblem` refuses a cast by them (`rules/casting-prohibitions.ts`, CR 601.3; "can't" beats "can",
  CR 101.2). Abilities, land plays and spells already cast are untouched (its rulings). It isn't in the layers: it
  changes no characteristic (CR 613.11 would only order it against other rules effects).
- "You have no maximum hand size" (Spellbook) is a static, `noMaximumHandSize`, read by `maximumHandSize`
  (`rules/hand-size.ts`), which the cleanup step asks (CR 402.2, 514.1). Effects that set another maximum would apply in
  timestamp order (its ruling, CR 613.11); none is in the pool, and statics don't carry timestamps yet.

**D-098: Layer 2 from resolved effects (M2-09c2)** · 2026-11-21 · accepted
- "Gain control of target creature until end of turn" (Act of Treason) is an effect change `gainControl { player }`
  on the permanents locked in (CR 613.1b, 611.2c), the latest winning (CR 613.7, `state.effects`' order). One helper,
  `controlFromEffects` (`rules/control-effects.ts`), reads it for both `controllerOf` and the layer pass, so they agree;
  it needs no card database, so `controllerOf` keeps its signature (D-092 foresaw this). Static control effects (an
  Aura's "you control enchanted creature", M2-12) will need the database and the signature change then.
- A control change makes the permanent summoning sick again (CR 302.6): `recordControlChanges` clears
  `controlledSinceTurnStart` when the effect begins and when it ends, only if the controller really changes (Act of
  Treason on your own creature changes nothing). That works while control changes only as a resolved effect begins or
  ends; static control effects (M2-12) change it with whatever moves their permanent, so then the check moves to
  `advance`, beside `removeNoncreaturesFromCombat`, comparing controllers before and after each piece of work, and
  removing attackers and blockers whose controller changed (CR 506.4). Until then `gainControl`'s duration can't be
  "for as long as" (the type refuses it), as that would end in `moveCard` with no check.
- New ops `gainControl` and `untap`. Removal from combat on a control change (CR 506.4) can't happen in the pool (Act of
  Treason is a sorcery whose effect ends in cleanup), so it waits (later: CR 506.4 for control).

**D-099: Counters as pipeline events (M2-10a)** · 2026-11-21 · accepted
- Putting counters on a permanent and removing them are events, `putCounters` and `removeCounters`
  (`permanents/counters.ts`, emitting `COUNTERS_PUT` and `COUNTERS_REMOVED`), performed only by the pipeline, so
  replacements and triggers on counters (Protean Hydra, M2-10b) see each one (CR 122.1, 122.6). Removing more than a
  permanent has removes what it has (CR 101.3).
- A permanent with both +1/+1 and -1/-1 counters loses N of each as a state-based action, N the smaller count
  (CR 704.5q), as two `removeCounters` events in the same batch.
- The effect op `putCounters { of, counter, amount }`, for "+1/+1" or "-1/-1" for now; other kinds (wish, poison on
  players) come with their cards.

**D-100: Entering with counters, and a prevention that does more (M2-10b)** · 2026-11-21 · accepted
- "This creature enters with X +1/+1 counters on it" (CR 614.1c) is an own-text replacement, `entersWithCounters`, that
  sets the battlefield destination's `counters`; `moveCard` gives the new object those counters and emits `COUNTERS_PUT`
  (entering with counters is putting them, CR 122.6). X is the spell's as it was cast (CR 107.3m); a card put onto the
  battlefield without being cast has X of 0.
- "If damage would be dealt to this creature, prevent that damage and remove that many +1/+1 counters from it" is a
  prevention candidate with `afterwards`: all of the damage prevented, then a `removeCounters` for the amount prevented
  right after the damage event (CR 615.5), which removes as many as it has (its ruling).
- "Whenever a +1/+1 counter is removed from this creature" (`selfCountersRemoved`) triggers once per counter removed
  (CR 603.2c, its ruling); its delayed "put two +1/+1 counters on it at the beginning of the next end step" remembers the
  Hydra (`about: "self"`, D-096) and does nothing if it left.

**D-101: Tokens are card objects carrying their own data (M2-11a)** · 2026-11-21 · accepted
- A token is a `CardObject` with a `token: CardData` field: the characteristics the creating effect defines, in the shape
  of a card's printed ones (CR 111.3; named for its subtypes plus "Token" unless the text names it, CR 111.4), with an
  oracle id of its own (`token:Insect Token`) that names nothing in the database. Not a new object kind: everything that
  works on permanents works on it (CR 111.6), and the many `kind === "card"` checks that mean "a permanent object" stay
  right (future-rules, "Card types beyond the M1 pool"). Where "card" matters, the code asks `isToken`: a
  token in a graveyard isn't a "creature card" to target.
- Every read of card data goes through `cardDataOf(obj, cards)` (or `cardDataByOracleId` for a bare id), in every
  package; a source scan forbids indexing the database anywhere else. Keeping the data on the object keeps one
  reference across actions, so the layer pass's per-`CardData` cache (D-092) still works.
- Creating a token is a pipeline event, `createToken`, emitting `TOKEN_CREATED` (no `ZONE_CHANGED`: it was in no zone
  before); "enters" triggers match it (CR 603.6a). The creator owns and controls it (CR 111.2). Tokens made together are
  one simultaneous event. `moveCard` carries `token` along, and a token in any zone but the battlefield ceases to exist
  as a state-based action (`tokenOutsideBattlefield`, CR 704.5d, 111.7), a `ceaseToExist` event emitting
  `TOKEN_CEASED_TO_EXIST`; found from the objects, not by searching zones.
- A token's own activated or triggered abilities would need its data on the ability object (`sourceOracleId` names no
  card); none in the pool has one yet. A token that has left the battlefield can't move again (later: CR 111.8).
- The effect op: `createTokens { token: TokenDef, amount }`.

**D-102: Attachments and Aura spells (M2-12a)** · 2026-11-21 · accepted
- An attached permanent records its host, `CardObject.attachedTo?: ObjectId` (left out otherwise, like `token`; fresh
  on every new object, CR 400.7). One reader, `attachedHost` (`rules/attachment.ts`), gives the host only while it's on
  the battlefield, so a host that left is never read as still enchanted; the layer pass, combat and the state-based
  actions all use it or its layer-pass twin `attachedHostIn`.
- "Enchant [quality]" is `CardDef.enchant`, a filter. It's the Aura spell's one target (`targetSpecsOf`, CR 303.4a), so
  shroud, protection and an illegal target on resolution (CR 608.3b) work as for any targeted spell. A resolving Aura
  enters attached as part of its move (`Destination.attachedTo`, CR 608.3c), never seen unattached, with its entering
  timestamp (CR 613.7e).
- "Enchanted creature gets/has" is the static `attachedGets` (layers 6 and 7c, read from the host the pass finds);
  Pacifism's restriction is `attachedCantAttackOrBlock`, read in `canAttack` and `canBlock`.
- An Aura attached to nothing, to itself, to what its enchant ability doesn't allow, or to a permanent with protection
  from it goes to its owner's graveyard as a state-based action (`auraIllegallyAttached`, CR 704.5m, 303.4c-d, 702.16c).
- Scenario setups can start a permanent attached (`attachedTo` in a battlefield entry; `PermanentSetup.attachedTo` as a
  player and an index into their battlefield), validated and exported.
- The Lifelink Aura is the first to make a gone damage source's lifelink matter, so the last-known-information snapshot
  (D-096) now keeps keywords, and damage reads them and the last known controller for a source that has left the
  battlefield (CR 702.15c).
- Future impact: Equipment (M2-12b) reuses `attachedTo` and the reader, with an `attach` event for equip (a new
  timestamp, CR 613.7e); Auras put onto the battlefield without being cast choose a host (M2-12d, CR 303.4f-g); an Aura
  enchanting a player (later: CR 702.5d) needs `attachedTo` to name a player. Mind Control (M2-12c) is a static layer 2
  effect: `attachedHostIn` needs no board, so the pass's controller step can use it, and `controllerOf` reads the kept
  pass then (future-rules, "Layers").
- Pacifism's restriction is marked on its host by the layer pass (`Layered.cantAttackOrBlock`), not searched for per
  attacker and blocker: the search made combat measurably slower (code review).

**D-103: Equipment, equip and layer 6 in timestamp order (M2-12b)** · 2026-11-21 · accepted
- Attaching and unattaching are pipeline events, `attach` and `unattach` (`permanents/attach.ts`): attaching gives the
  Aura or Equipment a new timestamp (CR 613.7e, 701.3c) and does nothing where it's already attached (CR 701.3b);
  unattaching deletes the `attachedTo` key, so state stays plain JSON.
- "Equip [cost]" is a printed activated ability marked `keyword: "equip"` and `timing: "sorcery"` (CR 702.6a, 602.5d),
  with the op `attachSelf`, which moves the source unless the creature has protection from it (CR 702.16d, 701.3b).
  `timing: "sorcery"` is checked in `activationProblem` for any ability.
- An Equipment attached to a noncreature, to a creature with protection from it, or to one that's gone becomes
  unattached as a state-based action and stays (`equipmentIllegallyAttached`, CR 704.5n, 301.5c).
- Layer 6 now applies keyword grants and removals in timestamp order (CR 613.7): a static ability's effects have its
  permanent's timestamp (CR 613.7a), a resolved effect its own. Magebane Armor's "loses flying" loses to a later Jump
  and wins over an earlier one, as its ruling says.
- Whispersilk Cloak's "can't be blocked" is marked on its host by the pass like Pacifism's (`Layered.cantBeBlocked`);
  Magebane Armor's prevention is a replacement of its own text on what it's attached to; an Aura's own ability names
  "enchanted creature" with the subject `"attached"` (Firebreathing).
- An Aura's ability naming "enchanted creature" reads what the Aura last enchanted if the Aura left before the ability
  resolves (CR 608.2h, 113.7a): Firebreathing destroyed in response still pumps its creature. Firebreathing's own rulings
  don't say; Shiv's Embrace's, on the same text, does: "If Shiv's Embrace has left the battlefield by then, the creature
  it was enchanting at the time it left the battlefield will get +1/+0" (D-080).
- Magebane Armor's ruling says a Levitation "that comes under your control later" gives flying back. Under CR 613.7a its
  effect has Levitation's timestamp, and no rule gives a new one on a change of control (CR 613.7d-k), so the engine
  follows the CR (D-020). Nothing in the pool can steal an enchantment yet.

**D-104: One layer 2, read through the pass (M2-12c1)** · 2026-11-21 · accepted
- `controllerOf(state, id, cards)` takes the card database (D-092 and D-098 foresaw this) and reads a permanent's
  controller from the layer pass, which does layer 2; nothing else computes it, so nothing can disagree. A spell's and
  an ability's controller, and a card elsewhere's owner, are read as before. The pass never calls `controllerOf`.
- A control change is noticed in one place, `game/control-changes.ts`: after the action's own handler (a cost
  sacrificed, a land played) and after each piece of work, who controls each permanent is compared before and after
  (`recordControlChanges`). It's skipped when neither state has a control-changing effect (`anyControlEffects`; a
  static one, Mind Control, must count there too), or when the objects, effects and battlefield, all a controller is
  computed from, are the same: measured, it otherwise cost a quarter of deepStack's time per action. `controllerOf` skips
  the pass the same way, with no control effect in the game reading the stored controller, which the pass would give
  (measured too); the fuzzer checks the two agree (`layersMatchFreshPass`). A permanent whose controller
  changed is summoning sick again (CR 302.6) and removed from combat (CR 506.4). This replaces the checks where a
  resolved effect began or ended, and covers static control effects, which change with no event (Mind Control).
- A fuzz check (`controlChangesRecorded`) checks it across each action, so a path that misses it shows.
- Neutral on its own: every scenario, replay and golden game is unchanged. Removal from combat on a control change
  (CR 506.4) is new but unreachable until a control effect can happen in combat (Mind Control destroyed mid-combat,
  M2-12c2). D-098's refusal of a "for as long as" `gainControl` can now be lifted, as its ending is noticed too; no
  card asks for it yet.

**D-105: Static control effects (Mind Control, M2-12c2)** · 2026-11-21 · accepted
- "You control enchanted creature" is the static `attachedControl`, applied in layer 2 (`layerTwo`, `rules/control-effects.ts`)
  to what its Aura is attached to now, "you" being the Aura's controller as layer 2 has it so far, with the Aura's
  timestamp (CR 613.7a, renewed on attach, 613.7e). Resolved control effects and static ones apply in one timestamp
  order: Act of Treason after Mind Control wins until it ends; of two Mind Controls the later wins.
- Whether a permanent has one is read from its printed text. Layer 6's ability-removing effects apply after layer 2
  (CR 613.1), so they can't undo one; a copy effect starting on a permanent, a permanent turned face up, or the ability
  granted in layer 6 could, and none is in the pool (future-rules). `anyControlEffects` counts these permanents too, kept per battlefield list, so
  the fast paths of D-104 stay right.
- `layerTwo` returns nothing when there's no control effect, so a board without one pays nothing for it (measured: the
  pass was a quarter slower building every permanent's controller). An Aura's "you" is a plain-data recipient
  (`auraController`), read when the effect applies.
- Mind Control leaving mid-combat gives the creature back, removed from combat and summoning sick (CR 506.4, 302.6),
  through D-104's one check. The rules review found the creature, untapped (vigilance), could then block for its owner
  but dealt and took no damage: `Combat.removed` was one list of creatures "out for good". It's now kept by role
  (`{ attackers, blockers }`): removal takes a creature out of the declarations it's in, and a block declared after
  that is a new one (CR 506.4, 509.1a).

**D-106: Soul Bleed and Ice Cage (M2-12c3)** · 2026-11-21 · accepted
- "At the beginning of the upkeep of enchanted creature's controller" is `beginningOfStep` with `whose:
  "attachedController"`: it triggers in the turn of whoever controls the creature as the step begins, so under a Mind
  Control it drains the thief (CR 303.4m, 613.1b); "that player" is the player whose step it is.
- "Its activated abilities can't be activated" is marked on the host by the layer pass (`Layered.cantActivate`), like
  Pacifism's restriction, and read where every activation, mana abilities included, is checked
  (`activationBasicsProblem`, CR 602.5, 605.3a), so a caged Llanowar Elves can't pay for anything either.
- "When enchanted creature becomes the target of a spell or ability" is `attachedBecomesTarget`, matched on
  `BECAME_TARGET` for what the Aura is attached to: its trigger goes on the stack above the spell and resolves first
  (its ruling). Ice Cage's own Aura spell can't trigger it: it isn't on the battlefield yet.
- A spell or ability that chooses the same object for two instances of "target" makes it become the target once, so
  such an ability triggers once (CR 601.2c, 603.2c): Bonecrusher Giant's and Tectonic Giant's rulings say so; no card in
  the pool can do it, so a unit test shows it.
- Future impact: a resolved "can't be activated" effect (Pithing Needle's kind, M2-14) would mark the same
  `Layered.cantActivate` from `input.effects`, checked in the same place.

**D-107: Open the Vaults, and Auras entering without being cast (M2-12d)** · 2026-11-21 · accepted
- "Return all artifact and enchantment cards from all graveyards to the battlefield under their owners' control" is
  `returnAllToBattlefield` (`from: "allGraveyards"`): every card moves in one simultaneous event (CR 608.2f), each under
  its owner's control (CR 110.2), in APNAP order so their timestamps are too (CR 613.7m); Equipment enters
  unattached (CR 301.5b).
- An Aura entering other than by resolving chooses what it will enchant (CR 303.4f): its owner, who'll control it,
  chooses among permanents already on the battlefield (not the cards returning with it, the card's ruling). It doesn't
  target, so shroud and Ice Cage don't matter; its enchant ability and protection do. One predicate, `canEnchant`
  (`rules/can-enchant.ts`), answers this and the CR 704.5m state-based action, so they can't disagree. With nothing
  to enchant, it stays in the graveyard (CR 303.4g).
- Players announce in APNAP order (the card's ruling, CR 101.4), each Aura in its graveyard's order. Each choice is a
  `chooseCards` decision with the new purpose `enchant` and a `for` field naming the Aura, so the view and the CLI
  show which Aura it is ("Pacifism enchants Hill Giant"). With one possible host there's no decision, as with
  sacrifice: the battlefield is public. The choices so far are kept in `state.resolution.auraHosts`, and each is
  announced with a public `AURA_HOST_CHOSEN` event, so the players choosing later see the earlier choices (CR 101.4b).
  A player's own Auras go in graveyard order, not an order they pick (later: CR 101.4c); the choices are independent.
- Future impact: other effects that put an Aura onto the battlefield (Academy Researchers, Aura tokens such as Roles,
  CR 111.10j) choose through the same steps; an Aura that enchants a player (Curses, later: CR 303.4) adds players
  to the options, which `chooseCards` can't offer today.

**D-108: Attacking a planeswalker (M2-13a)** · 2026-11-21 · accepted
- An attack on a planeswalker is the `Attack` with `attacked`, the planeswalker; `defender` stays the defending player,
  its controller (CR 506.2, 508.1b). `attacked` is left out, not null, for an attack on the player, and
  `Combat.removed.attacked` exists only once a planeswalker is removed: a game with no planeswalker is stored exactly as
  before, so no saved replay hash or golden log changed. The name is the role, not the card type, so a battle (later:
  CR 310) can use it.
- `attackedNow` is the one reader of what an attack attacks now: null once the planeswalker is removed from combat
  (left the battlefield, stopped being a planeswalker, or changed controller, CR 506.4). The creature still attacks,
  but deals no combat damage unblocked (CR 506.4c, 510.1b), and a trampler can't give the player its excess
  (CR 702.19f). It's exported because the CLI's inspect shows it.
- Removal from combat is by role (attacker, blocker, attacked): every caller names its roles. A control change removes
  all; regeneration only attacking and blocking creatures (CR 701.19a); a type change the role it no longer fits
  (later: CR 506.4d for a creature planeswalker).
- Damage to a planeswalker removes loyalty counters (CR 120.3c), checked apart from damage marked on a creature, so a
  creature planeswalker gets both; the recipients' types are read once per damage event, before its results, which
  happen at once (CR 120.4c).
- The engine stores its own listed attack, not the answer as sent, so an answer can't add keys or an `undefined`.

**D-109: The legend rule as a decision before the check (M2-13b1)** · 2026-11-21 · accepted
- The legend rule (CR 704.5j) is the one state-based action that needs a choice. `givePriority` asks it first: a
  `keepLegend` decision per set of same-named legendary permanents a player controls, players in APNAP order
  (CR 101.4), each knowing the choices before theirs. Once all are made, the check runs with them (`kept`), so the
  unkept permanents go to the graveyard together with every other state-based action of that check (CR 704.3).
- The choices live in the decision (`kept`), not in `GameState`, so no new state field (and no change to saved
  hashes); the answer is the existing `chooseCard` answer, by position in `options`.
- An unkept permanent is put into its owner's graveyard, not destroyed, so a regeneration shield can't save it
  (CR 614.8): the legend rule wins over its lethal or deathtouch damage, and it leaves once; one another action already
  puts into the graveyard (toughness 0) goes by that one.
- Every caller of a check asks the choice first: `givePriority`, and `cleanupCheck`, which gives the active player
  priority when a set exists (CR 514.3a). Earlier choices are known to later players (CR 101.4b).
- M2-13 is now four PRs: M2-13a (attacking, #66), M2-13b1 (the legend rule, no card), M2-13b2 (loyalty, loyalty
  abilities, CR 704.5i, planeswalkers as targets, Jace Beleren), M2-13c (the other four). Jace waits for the legend
  rule: a card enters the pool only when it works completely.

**D-110: Loyalty and loyalty abilities (M2-13b2)** · 2026-11-21 · accepted
- Printed loyalty (CR 209.1) comes from Scryfall into `PrintedCard.loyalty`, left out for any other card so cards and
  tokens without one are stored as before. Entering with it (CR 306.5b) is an intrinsic replacement that
  `replacementsOf` adds, as `abilitiesOf` adds basic lands' mana abilities; a definition never writes it.
- A loyalty cost is a cost part, `{ kind: "loyalty", amount }` (CR 606.4). The rules of loyalty abilities come from it,
  in `game/loyalty-abilities.ts`, checked with every activation's basics: sorcery timing and once per turn per
  permanent (CR 606.3, counted from the activations this turn of that object's loyalty abilities), a negative cost only
  with enough counters (CR 606.6, rechecked as the whole cost is paid). The counters go on or come off with the rest
  of the cost, as one event (CR 601.2h).
- A planeswalker with no loyalty is put into its owner's graveyard (CR 704.5i), not destroyed, like the legend rule;
  "any target" (CR 115.4) and "target player or planeswalker" (CR 115.1) include planeswalkers. A loyalty ability is
  never a mana ability (CR 605.1a).
- A planeswalker set up on the battlefield never entered, so nothing gives it loyalty: the engine's setup validation
  refuses one without loyalty counters rather than filling them in, so every host (scenarios, the RPG's boards) says
  how many. The scenario format fills in the printed loyalty when `counters` gives none, as a convenience of that
  format only.
- Loyalty is read in one place (`rules/loyalty.ts`); the loyalty ability check is with the rest of an activation's
  (`activationProblem`), not with mana abilities' basics, as a loyalty ability is never a mana ability (CR 605.1a).
  Definitions can't write `entersWithLoyalty`, two loyalty parts in one cost, or a `timing` on a loyalty ability.

**D-111: Garruk Wildspeaker and Liliana Vess (M2-13c1)** · 2026-11-21 · accepted
- `returnAllToBattlefield` takes a required `under: "owners" | "you"` (Open the Vaults, Liliana Vess's −8): no default,
  so every card says whose control its cards enter under. One controller-to-be decides the move's controller, the
  Aura's chooser and what it can enchant (CR 303.4f, 110.2), amending D-107's "its owner".
- "Put that card on top" is `put` into `libraryTop`. A card already in that library moves up by a reorder, not a zone
  change, so it stays the same object (CR 400.7). Liliana's −2 is search, shuffle, put on top: the same odds as
  shuffling the rest without it (CR 701.24b).

**D-112: Ajani Goldmane, and life totals in the layer pass (M2-13c2a)** · 2026-11-21 · accepted
- A token can have static abilities (`TokenDef.statics`) and a printed "*": only a characteristic-defining one so far
  (CR 111.3, 604.3); the definitions refuse any other, and a "*" without the ability or the reverse, as for a card.
- "Power and toughness are each equal to your life total" is `powerToughnessEachEqual` with `to: "yourLifeTotal"`,
  "your" being its controller (CR 109.5), in layer 7a (CR 613.4a).
- The life totals join the layer pass's inputs, and the kept pass is reused only for the same totals, but only if the
  pass read one (`lifeRead`, set in layer 7a): a mana-pool change, which replaces `state.players` far more often, still
  reuses the pass. An off-battlefield card that reads one, under a pass that didn't, is computed again from the
  state's own totals. Measured: the other benchmarks within noise of main, `characteristics.busyBoard` about 12-15%
  slower per read (0.3 µs), the cost of the comparison; accepted. Life is read only through `lifeTotalOf`, which marks
  the pass; that mark is the pass's one write, and only ever makes the match stricter. The players record's identity
  (the shortcut before comparing) is kept beside the pass, not in its inputs, which stay what the pass may read.

**D-113: Chandra Nalaar, and [−X] (M2-13c2b)** · 2026-11-21 · accepted
- [−X] is the loyalty cost `amount: "minusX"`. "Is a loyalty ability" (`isLoyaltyAbility`: timing, once per turn,
  never a mana ability) is kept apart from "how many counters" (`loyaltyChange`, which needs the announced X), so a
  [−X] ability can't slip out of once per turn.
- X is announced like {X} (CR 601.2b, 107.3a), offered up to the loyalty, and an X above it is refused as it's
  announced (CR 606.6, the card's ruling), never reaching the payment, which would throw on an unpayable cost. X = 0 is
  allowed and still uses the turn's loyalty ability.
- "Each creature that player or that planeswalker's controller controls" is a subject, `eachControlledBy`, read from
  the still-legal target (CR 608.2b): its player, or the planeswalker's controller. With the target, it's one damage
  event (`dealDamage`'s `and`, CR 608.2f).


**D-114: M2-14's cards checked against MTG Arena (D-089), and its order** · 2026-11-21 · accepted (pending the
owner's answer to the D-089 open question, option (a))
- Checked on the Scryfall bulk data of 2026-11-20, under the owner's filter (a paper card with a non-Alchemy Arena
  printing, 15,689 cards): Clone, Djinn of Wishes, Sleep, Time Warp, Pithing Needle and Platinum Angel are on Arena
  themselves. The other twelve aren't, but each one's mechanic is on an Arena card: hands revealed (Sen Triplets), the
  top card revealed (Courser of Kruphix), all permanents shuffled into libraries (The Great Aurora), copies of a spell
  for other players (Precursor Golem), a card named (Pithing Needle, Runed Halo), another player's library searched
  (Bribery), face-up exiled cards (Binding Negotiation), "doesn't untap during the next untap step" (52 cards), a
  card returning from the graveyard by its own ability (34 cards), an Aura with a narrower enchant (many).
- One part has none: Master of the Wild Hunt's "that creature deals damage ... divided as its controller chooses among
  any number of those Wolves", a division chosen at resolution by a player other than the ability's controller (0
  Arena cards). By D-089's option (a), Master of the Wild Hunt is set aside, like Harm's Way (D-090), unless the owner
  says otherwise; the other 17 are scripted.
- Order by what each needs from the one before, not the spec's grouping: "doesn't untap" first, then extra turns,
  Platinum Angel and Magma Phoenix, the "as it enters, choose" replacement (Convincing Mirage, then Pithing Needle,
  Sphinx Ambassador), revealed information (Telepathy, Vampire Nocturnus), playing a card mid-resolution (Djinn of
  Wishes), copies of spells (Twincast, Hive Mind), Clone (layer 1), Mirror of Fate, Warp World last (it re-enters
  every "as it enters" choice at once), then the three final decks.
- Names chosen for Pithing Needle and Sphinx Ambassador: any card name in the card database (CR 201.4 lets a player
  name any card in the Oracle card reference; a game only knows its own database). Open question to the owner.

**D-115: "Doesn't untap" (M2-14a: Sleep, Wall of Frost, Entangling Vines)** · 2026-11-21 · accepted
- The untap step's turn-based action moved to its own file, `game/untap-step.ts` (CR 502.3): the active player's
  permanents untap together, except those kept tapped.
- An Aura's "doesn't untap during its controller's untap step" is the static `attachedDoesntUntap`, marked on the host by
  the layer pass like `cantAttackOrBlock` (so the untap step asks once per permanent).
- "Doesn't untap during [that player's / its controller's] next untap step" is a continuous effect, `doesntUntap`, with
  the new duration `"nextUntapStep"`: `during` is a player (Sleep: that player's untap step only, so a slept creature
  another player controls first still untaps in theirs), or `"itsController"` (Wall of Frost: the first untap step of
  whoever controls each permanent then, its ruling that the effect follows the creature). After each untap step the
  effects it used up end, whether or not their permanents were tapped (Wall of Frost's ruling): the whole effect for a
  player, each permanent the active player controls for "its controller".
- Sleep's "those creatures" is every creature the player controls as it resolves, tapped by it or not (its ruling), read
  with the same subject as the tap.
- "Whenever this creature blocks a creature" is the trigger `selfBlocks`, once per creature it blocks (CR 509.3b).
- Future impact: "skip your next untap step" must leave these effects for the untap step that does happen (later:
  CR 614.10a).

**D-116: Extra turns (M2-14b: Time Warp)** · 2026-11-21 · accepted
- `GameState.extraTurns` lists the extra turns to come, the next one first: each is added directly after the current
  turn (CR 500.7), so a new one goes to the front, and of several made in one turn the latest is taken first (Time
  Warp's ruling). `GameState.regularTurnPlayer` is the turn order's place: the player whose regular turn was the most
  recent. After the last extra turn the next regular turn is the player after them, so an extra turn given to an
  opponent is followed by that opponent's regular turn too.
- `Turn` (also the fixed opening's type) is unchanged; the two fields are on the state, set by `beginTurn` and read by
  `nextTurn` in `game/extra-turns.ts`. A fixed opening's turn is a regular turn.
- An extra turn is a turn like any other: its number goes on counting, it has every step, and a "next untap step"
  effect on its player is used up by its untap step (the Sleep and Time Warp scenario).
- The `EXTRA_TURN_ADDED` event tells the UI. `nextPlayer` moved to `game/turn.ts`, which `extra-turns.ts` and
  `pass-priority.ts` both use.
- Future impact: "skip your next turn" goes beside `nextTurn`; extra combat phases (CR 500.8) still need a per-turn
  step list (future-rules).

**D-117: The fuzzer runs on worker threads** · 2026-11-21 · accepted (the owner asked for parallel fuzz games)
- `pnpm fuzz` shares its seeds among worker threads (Node's built-in `worker_threads`, no new dependency), one per core
  by default (`availableParallelism()`), `--jobs J` to choose. Each worker takes the next seed when it finishes one, so a
  long game doesn't hold up the rest; it sends back only whether the game failed, with the failure's game file, and the
  main thread writes the files and the report in seed order.
- The games are independent and each is decided by its seed, so the results are exactly one thread's (a test compares
  a failure file from both). One game, or `--jobs 1`, runs in the main thread, as before.
- Workers run every check (`ALL_CHECKS`): check functions can't be sent to a thread, so `runFuzz` with custom checks
  stays in-process for tests.
- Measured: 60 games in 2m00s on 4 cores, against 5m17s on one.

**D-118: Platinum Angel, Magma Phoenix: can't lose, abilities from the graveyard, "dies" triggers (M2-14c)** ·
2026-11-21 · accepted
- "You can't lose the game" is the static `cantLoseOpponentsCantWin`, read by `cantLose` (`rules/game-loss.ts`) for the
  permanents a player controls, like Spellbook's hand size. A player who can't lose has their zero-life and empty-library
  state-based actions left out of the list (CR 101.2), so the check doesn't repeat forever; the empty-library record
  still clears at the check, so a draw attempted while the Angel was there never counts later (CR 704.5b). Conceding
  still loses (CR 104.3a, its ruling). "Your opponents can't win" needs no rule while games have two players and no
  "win the game" effect: an opponent wins only by this player losing (later: CR 104.2b).
- An activated ability with `zone: "graveyard"` works only from its owner's graveyard, and its owner activates it
  (CR 113.6m, 602.2): `activationBasicsProblem` checks where the card is before reading anything of it (so a card in a
  hidden zone is refused the same whatever it is), then the ability's zone, then the controller; `legalActions` offers
  the graveyard cards with a printed one, after the permanents. Scenarios and their export name them
  `graveyard:p1:<card>`.
- "When this creature dies" is the trigger `selfDies`, the first that looks back in time: `detectTriggers` matches a
  permanent an event moved off the battlefield against the state before the event (CR 603.10a), with that controller.
  It doesn't ask that the permanent still be a creature: "this creature" names the object (CR 700.7).
  Its "it deals 3 damage" reads the gone source from last known information, which lasts until the stack is empty.
- Future impact: "when this leaves the battlefield" joins `leavesTheBattlefield`. "Whenever another creature dies" is
  different: the watcher isn't the permanent that left, so `lookingBack` must then scan every permanent of `before`'s
  battlefield (CR 603.10a's example: a watcher leaving at the same time still sees it). A dies trigger that returns "it"
  will need `ZONE_CHANGED.newId` in its trigger event (CR 400.7e). A "loses the game" effect (CR 104.3e) must ask
  `cantLose`; conceding must not. Pithing Needle (M2-14d) stops graveyard abilities too.

**D-119: "As this enters, choose a card name" and Pithing Needle (M2-14d1)** · 2026-11-21 · accepted
- The choice is a replacement effect of the card's own text on how it enters (CR 614.1c), `asEntersChooseName`, made
  before it enters (CR 614.12a) by the player it enters under (CR 614.12's example: its controller; CR 616.1). The
  answer is told to everyone as `NAME_CHOSEN`, so a player choosing after knows it (CR 101.4b). The pipeline asks it like the choice between
  replacements (CR 616.1): `applyReplacements` returns a `chooseName` ask, `happenOrAsk` waits with a `chooseName`
  decision, and the answer is kept in the resumed event's choices (a `ReplacementChoice` with `name`), so replacing the
  event again from the start finds it and doesn't ask twice. Several such permanents entering together ask in APNAP
  order (CR 101.4). The permanent keeps it as `CardObject.chosenName` (absent when none, so other states are unchanged).
- Names are the card database's (`cardNames`, CR 201.4, D-114's open question); `legalActions` lists them all, 230
  today. With the full database (M4) that list will be long: the UI will want a search, and the AI a smarter pick, but
  the rule doesn't change.
- Only callers that do nothing after the move may wait: resolving a permanent spell (`finishResolving`) and Open the
  Vaults now use `happenOrAsk`. A put onto the battlefield from a library or graveyard by other effects still uses
  `happen`, which throws on a choice: no such card can bring an artifact that names one yet (Elvish Piper and Rise from
  the Grave take creatures). Clone (M2-14i) or Warp World (M2-14k) must move those paths to `happenOrAsk` first.
- Pithing Needle's static is checked when a non-mana ability is activated (`activationProblem`), never for mana
  abilities (its ruling, CR 605.1a), for a source anywhere (graveyard abilities too), and the source's name is read
  through `characteristics`, so a copy's name will count. Setups and scenarios take `chosenName`.
- Future impact: Sphinx Ambassador (M2-14e) has another player choose, so the chooser will come from the replacement,
  not always `to.controller`; "spells with the chosen name can't be cast" (Meddling Mage) is the same check in
  `castProblem`; split, double-faced and adventure names (later: CR 201.4b-g) need more than `printed.name`.
  `SPELL_RESOLVED` is emitted before the choice, while the card is still on the stack: a UI must not read it as "left
  the stack", and "when it resolves" triggers (later: CR 608.2p) must be detected after the move. `isManaAbility`
  doesn't yet check CR 605.1a's "doesn't move a card to or from a library" (no pool card can tell).

**D-120: Convincing Mirage: a basic land type chosen, and a land's subtype set (M2-14d2)** · 2026-11-21 · accepted
- The choice reuses D-119's: the replacement `asEntersChooseBasicLandType` asks a `chooseName` decision whose `what` is
  `"basicLandType"` (the answer kind stays `chooseName`, its `name` one of the five types, CR 205.3i, so saved games
  still replay); the permanent keeps `chosenLandType`. `NAME_CHOSEN` says which `what` too.
- "Enchanted land is the chosen type" is the static `attachedSetsLandType`, applied in layer 4 (`rules/land-type.ts`)
  right after the resolved layer 4 effects: the land's land types (CR 205.3i's list) become the chosen one, its other
  types, subtypes and supertypes stay (a Treefolk stays a Treefolk; basic stays basic, its ruling). It loses the
  abilities of its rules text (CR 305.7): printed keywords, protections and statics are cleared before layer 6, so
  granted ones still come; `Layered.rulesTextLost` makes `abilitiesOf` give only the basic land type's mana ability,
  and `triggersOf` and `replacementsOf` nothing. Two on one land apply in timestamp order, the later winning
  (CR 613.7). From Open the Vaults, hosts are announced in APNAP order first (its ruling), then each Mirage's type is
  chosen as they enter, again in APNAP order (CR 614.12a, 101.4); the nonactive player's, later, wins (CR 613.7m).
- Not built: CR 305.7's "any copiable effects affecting that land" (layer 1 doesn't exist yet). When it does, the
  pass must know which lands a land-type-setting effect hits before running layer 1 (future-rules).

**D-121: Sphinx Ambassador: a card name chosen while a trigger resolves (M2-14e)** · 2026-11-21 · accepted
- The `chooseName` decision says what the answer is for in `answering`: `asEnters` (D-119's resume of the moving event) or
  `resolution`, where the rest of the resolution is already queued and the name is kept as `Resolution.named`. The
  effect is `nameCard { who }`: "that player chooses a card name" (CR 201.4), the triggering player, not the
  ability's controller. `NAME_CHOSEN` tells everyone, as the player announces it while applying the effect (CR 608.2d),
  its object the resolving ability.
- "A creature card that doesn't have that name" is the filter `notNamedThisWay`, read in `matchesFilter` against the
  card's name through `characteristics` (the layer pass holds no name). `put`'s `onlyIf` and `optional` do the rest:
  "you may put it onto the battlefield under your control" (CR 110.2a).
- The search's found card stays hidden from the player naming (its ruling; CR 701.23e): it stays in their library,
  which they can't see, and `Resolution.found` isn't in any view (a test checks the naming player's view).
- Nor may the questions asked tell them (the rules review): "you may put" asked only for a creature not named would show
  the naming player, in `waitingFor`, what the card is. So an optional `put` of cards in a hidden zone (a library or a
  hand) asks even when none fits, as D-062 asks a hidden zone's choice when nothing fits; the `chooseYesNo` decision's
  `canSayYes` is then false, `legalActions` offers only no and yes is refused, as yes would be impossible (CR 608.2d).
  A card revealed in a library is asked the same way, though everyone saw it: a question with only no, harmless and
  not in the pool today (Lurking Predators's card has left the library or fits by the time it's asked).

**D-122: Revealed hands and library tops, and a bonus that reads the top card (M2-14f: Telepathy, Vampire Nocturnus)** ·
2026-11-21 · accepted
- "Your opponents play with their hands revealed" and "play with the top card of your library revealed" are static
  abilities (`opponentsPlayWithHandsRevealed`, `playWithTopOfLibraryRevealed`), read from the battlefield through the
  layer pass by `rules/revealed.ts` (`handsRevealed`, `libraryTopsRevealed`): a stolen Nocturnus reveals its new
  controller's library (CR 109.5). The hand and library stay hidden zones (CR 400.2); nothing new is stored in the state.
- `playerView` takes the card database and shows what's revealed to every player (CR 701.20a) by identity only, in the
  fixed order of D-062: `revealedHand: OracleId[] | null` and `revealedTop: OracleId | null` per player. `objects`,
  `hand` and `canSee` are unchanged: ids and a hand's order record when each card came, which a reveal doesn't show,
  and a shuffle keeps object ids (CR 701.20d makes a reordered revealed card a new object; an id would let a player
  follow it). Two-worlds tests check a view doesn't change with what stays hidden; the fuzzer's scramble keeps a revealed
  top on top and revealed cards' identities.
- A view exists only between actions, but a revealed top is seen as soon as it's the top, also for a moment within one
  resolution (CR 401.5 delays it only while casting or activating): between draws (Nocturnus's ruling: "reveal each one
  before you draw it"), or between a search taking the top card and the shuffle after it (Diabolic Tutor, Rampant
  Growth, Sphinx Ambassador; found by the rules review). So `perform` emits a public `CARDS_REVEALED` for each library
  whose top card changed in an event while it's revealed (a simultaneous batch is one event). Liliana Vess's "shuffle
  and put that card on top" is one event (`shuffle` with `thenOnTop`; the op's `foundOnTop`): the card found isn't
  part of the shuffle (CR 701.24b), so no other card is ever on top between the two, and announcing one would show the
  card that ends up second. Her ruling file says nothing more. The algorithm, and so the RNG and the final order, are
  as before. Scenarios can name revealed cards in `events contains` and `events lacks`, and check `p2.revealedHand` /
  `p2.revealedTop` as another player sees them.
- "As long as the top card of your library is black, this creature and other Vampire creatures you control get +2/+1
  and have flying" is `creaturesGet` with `self` (the ruling: even if it isn't a Vampire) and `asLongAs: { topOfLibrary:
  filter }`, read with the top card's printed values (no effect in the pool applies in a library), an empty library
  fitting nothing. The library tops join the layer inputs, read only through `libraryTopOf` and compared by value only
  if a pass read one (`read.libraryTops`, beside `read.life`, which replaces D-112's `lifeRead`): a reorder or shuffle
  changes the top without a new objects record. `printedStart` moved to `rules/printed-start.ts` to be shared.
- Measured (`pnpm bench`, alternating with main twice on one noisy machine): within noise of main everywhere, e.g.
  `applyAction.busyCombat` 28.0–29.0 µs against 27.3–28.2 µs, `randomGame` 107–125 ms against 102–143 ms. The new-top
  check compares each library's first id after every event and reads the battlefield only when one changed. The bench's
  decks have no Nocturnus, so it never measures a pass that read a top: the code review found every characteristic
  read then costing twice as much (the tops compared by value each time), fixed with an identity shortcut like the
  life totals' (`topsFrom`), measured back to the plain cost. `playerView` walks the battlefield once for both
  reveals (`revealedBy`).
- Not built, as nothing in the pool can cause them (future-rules): CR 401.5's delay while casting (only mana, tap,
  loyalty and sacrifice costs exist; built in M2-14g after all, D-124, as Djinn of Wishes casts the top card), CR
  401.6's new object; and a library becoming revealed mid-action (Nocturnus entering) whose top then changes in the
  same action before a view.

**D-123: The bench baseline reset on a quiet run** · 2026-11-21 · accepted (the owner's choice)
- `pnpm bench` failed on main on this cloud machine: measures over their +20% gates and `randomGame` near its 100 ms
  budget, with runs of main differing by up to 40% while reviewers and fuzz games ran alongside. The owner chose to
  reset `bench/baseline.json` with `pnpm bench --update` on a quieter run: nothing else running, the best of several
  runs. Close calls are still judged by alternating base and head runs. The 100 ms budget (architecture.md, "on a
  laptop") stays a hard limit.
- Done after #78, on an idle machine: five `--update` runs, the baseline written from each measure's median. Even idle,
  the measures relative to the reference loop vary by up to about 30% between runs (the reference loop itself took
  1.34–1.68 ms), more than the 20% gate, so a single failing gate on this machine isn't a finding; alternating runs
  stay the test of a change. `randomGame` took 100–130 ms in every run, at or over its 100 ms budget: whether a laptop
  meets it isn't known from here (open question).

**D-124: Playing a card while an ability resolves (M2-14g: Djinn of Wishes)** · 2026-11-21 · accepted
- "You may play that card without paying its mana cost" is the op `mayPlayWithoutPaying`. The controller is asked (a yes/no) only if
  the card can be played: a land on their own turn with a land play left (CR 305.3, 305.2b; a land and another type
  only as a land, CR 305.9), a spell if nothing forbids casting (Silence, CR 601.3) and each "target" has a choice
  (CR 601.2c). Timing permissions don't apply (CR 608.2g; its ruling). The card was revealed, so not asking hides
  nothing. Yes plays a land (`playLand`, counted, CR 305.2a) or casts the spell: the work item `playWithoutPaying`.
- The cast follows the casting steps from the library (`Casting.origin` "resolution"): X is 0 (CR 107.3b), no mana cost
  is paid but the cost increases are (Fireball's per extra target, CR 118.9d, `costIncreases`), and no one gets priority
  after it's cast: the resolution goes on (CR 608.2g). A cancel puts the card back on top as the same object; "if you don't, exile it" is the next op, `exile` of `found`, which finds a card played gone (a new
  object, CR 400.7) and exiles one declined. (Amended by the rules review:) a cancelled cast returns to the moment before
  it was proposed (CR 601.2, 734.1), the "you may play" choice with the card back on top, which the player may redo, at
  one target for Fireball say, or decline (CR 734.2). A "whenever a player casts" trigger waits until the ability is
  done and goes on above the spell.
- `Casting` records the triggered abilities waiting as it began (`triggersBefore`, restored by a cancel: mid-resolution
  some may be waiting, CR 117.5 holds only from priority) and each library's top (`libraryTops`). A top changed while a
  spell is cast isn't revealed until it's cast (CR 401.5): `perform` doesn't announce a top changed by a card moving to
  the stack (the first step of casting, CR 601.2a), `playerView` shows no `revealedTop` for a changed library while
  casting, and `payCost` reveals it once the spell is cast. Vampire Nocturnus's bonus reads the real top meanwhile
  (CR 611.3a), so its power can hint at the hidden card's color, as it would in paper.
- Costs: "remove a wish counter from this creature" is `{ kind: "removeCounters", counter, amount }`, refused at
  activation without the counters (CR 118.3) and paid with the rest (`counter-costs.ts`); `entersWithCounters` takes any
  counter and a fixed number. `CAST_CANCELLED.restored` is null for a card put back in a library: its id isn't shown,
  so no one can follow it there (D-054), though everyone saw it revealed.

**D-125: Copies of spells (M2-14h1: Twincast)** · 2026-11-21 · accepted
- A copy of a spell (CR 707.10) is a card object on the stack marked `copy`, not a third `GameObject` kind (as
  future-rules once suggested): it has the original's oracle id and choices (targets, X, the division; modes later) and
  is owned and controlled by who put it there, so everything that works on a spell (characteristics, targets, resolving,
  being countered) works on it, as `token` does for a permanent. It isn't cast: the pipeline event `copySpell` puts it
  on the stack (`zones/spell-copies.ts`, `SPELL_COPIED`), so "whenever a player casts" doesn't see it. A move keeps the
  flag, and the state-based action CR 704.5e (`copyOutsideStack`) makes one outside the stack cease to exist
  (`COPY_CEASED_TO_EXIST`). Scenarios and the log name it "Lightning Bolt copy".
- The op `copySpell { of, newTargets: "may" }` copies a spell from what it is on the stack; Hive Mind (M2-14h2) copies
  one countered in response from its last known information (judge forum, apps.magicjudges.org/forum/topic/8094), so
  the pipeline event takes a snapshot (`SpellCopied`: original, oracle id, choices), not only a live object.
- "You may choose new targets": the copy goes on the stack, then its controller is asked for each target in turn
  (`chooseNewTarget`: keep it, even if illegal, or a new legal one, CR 115.7d), with the copy as the source (its color
  for protection, its controller, and never itself, CR 115.5): the same as choosing before it's put there (CR 707.10c),
  as nothing can happen between. The number of targets stays, and a changed target takes its share of a division
  (CR 115.7f). Twincast is still on the stack, resolving, while they're chosen. (Amended by the rules review:) only the
  final set is judged (CR 115.7e), so two targets may be swapped, each share going with its place, not its target; a
  final set naming one object twice in an instance (CR 601.2c) isn't a legal choice, and the player starts over from
  the copy's targets (keeping them all is always legal). `SPELL_COPIED` comes before the targets are final: a card that
  triggers on copying a spell (none in the pool) would need it after them.
- Once they're fixed, each object the copy targets becomes the target of a spell, kept or new: it's a new spell
  targeting it (judge forum, apps.magicjudges.org/forum/post/65270), so Illusionary Servant's ability triggers.
- (M2-14h2, Hive Mind.) `copySpell` takes `by: "eachOtherPlayer"`: each player but the caster (the trigger's player)
  copies the spell, in turn order from the active player (its ruling), each as a `copySpellFor` work item with the
  spell's snapshot, so each copy's targets are chosen before the next copy goes on the stack. The snapshot is the spell
  on the stack or, gone from it, as it last existed there: a spell leaving the stack is now kept in `lastKnown` like a
  permanent leaving the battlefield (CR 608.2h), emptied as before when a player gets priority with the stack empty.
  The official rulings of other "copy that spell" triggers say the same (D-080, from Scryfall): Mirari (2004-10-04,
  "the ability will make a copy of how the spell looked right before it was countered"), Swarm Intelligence
  (2017-07-14), Thousand-Year Storm (2018-10-05), Double Vision (2020-06-23). Only the raw object is kept, not
  `lastKnownCharacteristics`: a copy takes the printed card's copiable values (CR 707.2), which no pool card changes on
  the stack. `by: "eachOtherPlayer"` needs a spell-cast trigger to know who cast the spell; the card check rejects it
  anywhere else. The order of three or more players is a unit test on a hand-built game (createGame takes two).


**D-126: Cards from fundamental building blocks (owner, 2026-11-22)** · 2026-11-22 · accepted
- The owner's requirement: design the engine so that almost any card can be defined from fundamental building blocks,
  avoiding one-off logic. Some one-off logic may be unavoidable, but it is the exception, and each one is a candidate to
  fold into a general block later.
- How it is applied: before adding an effect op, static or replacement kind, try (1) composing existing ones, then (2)
  generalizing an existing one (a new field that keeps old definitions unchanged), and only then (3) a new block, named
  for the CR concept it implements (not the card) and shaped so the next card with that rules idea reuses it. A plan
  says which of the three it took and why. Context: on 2026-11-22, 17 of the 47 effect ops had a single card using
  them; some are general ideas only one Magic 2010 card uses yet (`extraTurn`, `cantBlock`), others are shaped around
  one card's wording (`destroyOneAtRandom`, `ifNothingSacrificed`, `ifActivatedThisTurn`, `exileGraveyard` with
  `sameNameAsExiled`).
- M2-15 (hardening) adds a review of the single-user ops, statics and replacement kinds: merge those that are the same
  idea, generalize those that are narrow, and record what stays one-off and why.

**D-127: Copy effects as a permanent enters (M2-14i: Clone)** · 2026-11-22 · accepted
- D-126 applied: "enters as a copy" is a general replacement kind, `entersAsCopy { of: ObjectFilter }`, not a Clone
  op. As the permanent enters (CR 614.1c), the player it enters under chooses one permanent fitting `of` already on
  the battlefield, or none (CR 614.12a), through `chooseCards` (purpose "copy", min 0, max 1), generalized so its answer
  can resume an event as `chooseName`'s does (`ChooseCardsFor`), and announced as `OBJECTS_CHOSEN`. Doesn't target.
- Layer 1 (CR 613.2a) is `CardObject.copied?: Copiable` (`{ oracleId, token? }`), the copiable values it entered with:
  the chosen permanent's own `copied` if it is a copy itself (CR 707.3), else its oracle id and, for a token, the token's
  data (its ruling). Fixed once (CR 707.2b), never carried to a new object (CR 400.7), so a Clone in the graveyard is
  a Clone. `cardDataOf` reads it first, and every printed value, keyword, static, trigger, activated and mana ability,
  replacement and CDA is read through it (a test keeps every database lookup there), so nothing else had to change for
  the layers, names (Pithing Needle, the legend rule) or abilities. Abilities on the stack name the copied text
  (`textOracleId`), so they resolve from it. Kept on the object, like `chosenName`, rather than in `state.effects`:
  it's part of how the object entered and has no duration. Considered and not built: a "becomes a copy" effect with a
  duration (CR 707.4) will be a layer-1 continuous effect in `state.effects`, and `cardDataOf` will then take the state.
- CR 614.12: once the copy is chosen, the replacements that apply are the copied text's (Protean Hydra's "enters with
  X counters", X 0), named apart from its own by `ReplacementRef.text`, so a Clone copying a Clone that copied nothing
  would get to choose again (the CR 707.9e example's reading), and its enters triggers trigger (CR 707.5).
- `put` onto the battlefield now uses `happenOrAsk` (its last move), so a Clone risen from a graveyard (Rise from the
  Grave) chooses too; Rise's "black Zombie" applies on top in layers 4 and 5.
- A copy of a token is named as the token is ("Wolf Token", CR 111.4) though it isn't a token.
- Not built: CR 616.1c (a copy replacement chosen before others): Clone's is the only one and never meets another.

**D-128: Mirror of Fate from general blocks (M2-14j)** · 2026-11-22 · accepted
- D-126 applied, with no Mirror-specific op. `ObjectFilter.owner: "you"` ("you own", CR 108.3). A `choose` op
  ("choose up to N [filter] exiled cards", CR 608.2d) that keeps its cards as `found`, like a search, so `put` of
  "found" follows; not asked with none to choose, as exile is public (CR 406.3). `exileGraveyard` became
  `exileAll { zone: "graveyard" | "library" }` (Haunting Echoes unchanged); a library's cards go in shown order, as
  no one has seen the library's (D-062).
- `put` of several cards on top of a library (CR 401.4): their owner arranges them, a `chooseCards` "putOnTop" choice
  top first, and the order isn't revealed: they move in shown order and the top is then reordered, which has no event.
  Cards of several owners would each go to their own library (no pool card does it; it throws, later). The bottom of a
  library (CR 401.4 too) is the same, later.
- Every exiled card is face up (CR 406.3); exiling face down, and "face-up" filters, are later.
- Copies of one card put on top together aren't arranged: no one could tell the orders apart. `choose`'s decision
  always has the purpose "choose" (the effects after it say what's done), apart from the "putOnTop" arranging.

**D-129: A card entering from a hidden zone is shown by identity, not id (M2-14k)** · 2026-11-22 · accepted
- A choice made as a card enters from a library (a Clone Sphinx Ambassador found; Warp World's revealed cards, Auras
  choosing hosts, Pithing Needle naming) names the card in the engine by its object id, which in a library records how
  it got there (D-062). Decisions keep the real id; the view shows what they're for by identity (`ShownOption`, as
  their options are): `chooseCards.for` and a `chooseName` as it enters (its replacement ref is engine bookkeeping and
  left out). Events can't be fixed in the view (no state there), so the engine leaves the id out of events emitted
  before the card leaves the hidden zone: `NAME_CHOSEN.object` and `OBJECTS_CHOSEN.object` are null then, and
  `AURA_HOST_CHOSEN` gains `card` (what the Aura is) with `aura` null, so players choosing after still know it
  (CR 101.4b). Replaces Clone's engine-side `for: null` (M2-14i). The fuzz scramble keeps the identity of what a
  viewer's own decision is for. `chooseReplacement` from a hidden zone (two replacements on one card entering from a
  library) isn't reachable with the pool and still shows ids (future-rules).

**D-130: Warp World from general blocks (M2-14k)** · 2026-11-22 · accepted
- D-126 applied. New op `shuffleIntoLibraries { filter }`: the permanents go to their owners' libraries at once,
  each player shuffles, and how many each player owned is kept (`Resolution.shuffledIn`), counted before moving,
  tokens too (its rulings). Tokens move (so leaving triggers see them) and cease to exist in the same batch (its ruling:
  "you shouldn't actually shuffle them in"), so no token waits in a library while the rest asks its questions; a reorder
  or a token ceasing in a batch names objects by their ids before it (`renamed` in perform.ts).
- Generalized: `revealTop` takes `who: "eachPlayer", count: "shuffledIn"` (each player's that many, all `found`);
  `returnAllToBattlefield` takes `from: "found"` (the cards found still in their owners' libraries, in shown order per
  owner, APNAP across), so Warp World's two steps reuse Open the Vaults' Aura hosts (APNAP announcements, CR 303.4f/g).
- `put` into a library (top or bottom, CR 401.4): each owner arranges theirs in turn order, unrevealed; a card already
  in that library is only reordered (CR 400.7), not moved: this now holds for one card too, so Lurking Predators'
  "put it on the bottom" no longer makes a new object (the golden games changed from that move; regenerated).
  `reorderLibrary` gains `bottom`; a "putOnBottom" purpose, top first like "putOnTop".
- The fuzz checks that need only the state (views leak nothing, the layer cache, invariants) run on every state of the
  Clone, Mirror of Fate and Warp World scenarios (`fuzz-checks-on-scenarios.test.ts`), as random games rarely cast them.

**D-131: Magic 2010's three final decks (M2-14l)** · 2026-11-22 · accepted (amends D-069)
- The three decks the M2 pool spec names are built from scripted cards: White Soldiers (new), Red-Green Beats and
  Blue-Black Control (finished: Garruk, Overrun, Siege-Gang Commander, Howl of the Night Pack; Jace, Liliana, Wall of
  Bone, Cancel). `decks.test.ts` checks each holds the spec's cards, stays in its colors and has at most four of any
  card but basic lands.
- The fuzzer's prebuilt games rotate through the six ordered pairings of the three (each in both seats), then M1's
  pair: six in seven prebuilt games are Magic 2010's (D-069 had the old pair in two of three). `pnpm check`'s short
  fuzz (seeds 2, 4, 6) now plays Magic 2010 pairings only; M1's pair is still fuzzed by `pnpm fuzz` and is the bench's.
  The `divide` decision is still reached through Fireball and Bogardan Hellkite (Ignite Disorder left the deck).
- The spec says the three decks are "chosen so that between them every mechanic appears". Three themed 40-card decks
  can't hold Warp World, Mirror of Fate or most one-offs, so that goal is met by the golden games, which already run
  every mechanic in the pool (D-082); the decks aim at their themes. One golden game was added by hand for the new deck
  (white-soldiers-vs-red-green-beats-7), so a whole game of it is replayed; golden games keep the setup they were made
  with, so older ones named after these decks show the decks as they were then.

**D-132: MIT license; the README is for a public repo (owner, 2026-11-22)** · 2026-11-22 · accepted
- The owner chose the MIT license for the project's code. It covers this repository's code and docs only: Magic: The
  Gathering card names, text, symbols, rules text and art stay Wizards of the Coast's property, and card data comes
  from Scryfall under its terms (docs/data-sources.md); the README says so, with the Fan Content Policy notice.
- The README is written for a public repository: what the project is, how to run it, and a guide to playing games with
  the CLI. The private-repo starter instructions are gone: Claude Code needs none of them (it reads CLAUDE.md, the docs
  and `.claude/`). The copyright line names "the open-mtg-arena contributors", not a person.

**D-133: A looser bench budget for the cloud machine (owner, 2026-11-22)** · 2026-11-22 · accepted
- The architecture's budgets (a random game under 100 ms, an action under 1 ms) are for a laptop. The cloud machine
  Claude Code runs on (an Intel Xeon at 2.10 GHz) is slower, and the random game sat at 100–130 ms there. The owner
  chose a separate, not too strict budget for it: `bench.ts` keeps one budget table per CPU model, and on that machine a
  random game may take up to 150 ms. Any other machine uses the laptop budgets. The baseline comparison (20% slower
  fails) is unchanged.


**D-134: Single-use building blocks merged where they're the same idea (M2-15d, D-126)** · 2026-11-22 · accepted
- The D-126 review counted the effect ops, statics, replacement kinds and triggers only one card uses. Where two or more
  of them were one idea with a different word, they became one block with a field, without changing any behaviour:
  `destroyAll` is `destroy` of `{ each: filter }`; `asEntersChooseName` and `asEntersChooseBasicLandType` are
  `asEntersChoose` with `what`; the four attached restrictions (Pacifism, Whispersilk Cloak, Ice Cage, Entangling
  Vines) are `attachedRestricts` with a list, one static for Ice Cage's one sentence (Whispersilk Cloak's "can't be
  blocked and has shroud" stays two statics, `attachedRestricts` and `attachedGets`: nothing yet removes one ability of
  an Equipment, so the split can't be seen); `ifNothingSacrificed` and
  `ifActivatedThisTurn` are `if` with a `condition` (`effects/if-condition.ts`); the two revealed-zone statics are
  `playWithRevealed` with `what` and `whose`; `selfBecomesTarget` and `attachedBecomesTarget` are `becomesTarget` with
  `of`; `selfBlocksOrBlocked` is `selfBlocks` with `orBecomesBlocked`; `mayShuffle` is `shuffle` with `optional`.
- Kept as they are, because merging would change play or needs work first: Elvish Piper's and Capricious Efreet's
  choices through `choose`, `putOnTopOfLibrary` into `put` (tokens in `put` first), and the prevention kinds into one
  (little to gain). Kept as one-offs, being one card's rules and not a word for something general: Relentless Rats' and
  Coat of Arms' counts (relative to the creature affected), Warp World's count of the cards shuffled in, Stone Giant's
  "toughness less than this creature's power" target. Most other single-card blocks are general rules ideas (a keyword,
  a zone, a turn structure) that more cards will use.
- The golden cover still tells each old block apart: a merged block's unit names the variant its fields choose
  (`static attachedRestricts doesntUntap`, `effect if nothingSacrificed`, `trigger becomesTarget attached`,
  `effect shuffle optional`, `effect destroy all`, `replacement asEntersChoose cardName`, ...), so the guarantee that
  some golden game runs each one is unchanged. The golden games didn't change; their descriptions use the new unit
  names. A saved game stopped mid-resolution with an old op name wouldn't load, which is fine before the first release
  (ENGINE_VERSION 0).
- The owner (2026-11-22): one-offs are understandable now; as more cards are built it will be clearer how to
  generalize them. So a one-off is revisited when a second card needs something like it (card-scripting.md, D-126),
  not merged ahead of time on a guess.
- Combinations of the new fields that no card uses are refused rather than left untested: `playWithRevealed` is typed
  to its two pairs (opponents' hands, your library's top), and `definitionProblems` refuses a `shuffle` both `optional`
  and `foundOnTop`.

**D-135: `brief`, one player's whole situation for people and programs (owner, M2-15f)** · 2026-11-22 · accepted
- The owner asked for CLI output detailed enough that an AI agent playing through the CLI has what it needs to choose
  the best action. `brief <file> --as pN [--text] [--json]` builds one `Brief` (data) and renders it as text, so the two
  can't disagree: every visible object in detail, each player's public counts and resources, the stack, the events the
  viewer saw since they last acted, and the viewer's own legal actions, numbered as `do` takes them.
- It's built from `playerView` and `eventsFor` (D-044), never from what's hidden: another player's pending decision is
  only "waiting for". `test/brief.test.ts` runs the two-worlds check (`scrambleHidden`) on the brief's text and JSON over
  every state of the scenarios with hidden cards in play.
- Derived values (power and toughness, types, keywords, summoning sickness, combat) aren't in `PlayerView`. The host
  computes them from the full state, only for the objects the viewer can see (public zones, their own hand), and sends them with the view. That's how M3's match host
  will give the UI and the AI what they show and weigh: the architecture's `{ view, events, legalActions }` gains these
  derived values, computed beside the view rather than added to it, so `playerView` stays the plain filter it is.
- Each of the viewer's actions carries its cost, its legal targets (the engine's `legalTargets`, now exported with
  `targetSpecsOf`) and a hint whether their mana could pay it now (`autoPay`, X as 0). It's a hint, as the engine allows
  starting what can't be paid (CR 118.6, 601.2h) and a per-target cost increase is known only once targets are chosen.
- `show` keeps its stable format for tests; `brief` is the detailed one.

**D-136: LLM opponents in M3 (owner, 2026-11-22)** · 2026-11-22 · accepted
- The owner wants an optional AI opponent powered by a model the player picks, through their own OpenRouter key, and
  placed it in M3 (task M3-02b), beside the heuristic AI rather than after it. The owner isn't concerned about cost or
  speed, since fast capable models exist.
- It fits the vision's "no server": the browser calls OpenRouter with the player's key, which stays on the device. The
  heuristic AI stays the default and the only opponent offline.
- It sees only the player view (`brief`, D-135) and picks a numbered legal action, so it can't cheat or move illegally.
  It also gets what a player knows of their own deck: the decklist and what's left in the library (counts only; the
  list predicts no shuffle, the seed would), the cards the opponent has shown, and the deck's game plan.

**D-137: The AI opponent knows what a human player knows (owner, 2026-11-22)** · 2026-11-22 · accepted
- The owner's goal: the player can't tell they're playing against an AI. So the model has all the information a human
  player has about the game and their deck, no less (or it plays worse than a person) and no more (or it cheats).
- Parity is made structural, not checked by hand: the app's UI and the AI read one per-player data source (the match
  host's view with derived values, D-135, as `brief` builds it today). A field added for the UI reaches the AI too.
- What a human remembers counts as known: the whole game's history as they saw it, cards they know in the opponent's
  hand or in a library (put there face up, or by themselves), their own decklist and what's left, and the rulings of
  the cards in play. These are added to the shared data, so a human player sees them too (M3-02b).
- It also covers behaviour: the AI is offered the response windows a human gets, and paces its actions like a player.

**D-138: The LLM opponent's harness: previews, a 30-second limit, no memory between games (owner, 2026-11-22)** ·
2026-11-22 · accepted
- The LLM opponent is a harness of tools over the player's view (`docs/llm-opponent.md`), the owner's idea.
- Previews are allowed: the model may ask the engine to play out a combat or an action on a world made only of what it
  knows; a preview stops where a hidden card would matter.
- 30 seconds of thinking per decision; at the limit the heuristic AI decides that one. A fast model should stay inside.
- No memory between games for now; a possible RPG feature. Personas are undecided.

**D-139: Mutation testing with StrykerJS (M2-15b)** · 2026-11-22 · accepted
- Dev dependencies `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` (10.1.1, pinned), the tools testing.md
  section 7 names. Dev only: nothing of them ships in the app.
- `pnpm mutate --mutate "<glob>"` runs on one part of the engine at a time (a whole run takes hours), with
  `vitest.mutate.config.ts`: the engine's unit tests and the scenarios. The CLI's golden games, fuzz and replays are
  left out as too slow per mutant; a mutant only they would catch is reported as surviving, which errs on the side of
  writing a scenario for it. No TypeScript checker plugin: the repo's TypeScript 7 has no JavaScript API for it, so
  mutants that don't type-check run too and count as killed or survived by what the tests see.
- Not part of `pnpm check`. Surviving mutants in rules code get a test; the rest are listed in status.md with why they
  survive (equivalent mutants, logging, error messages).

**D-140: The match UI works like MTG Arena's, with a look of our own (owner, 2026-11-22)** · 2026-11-22 · accepted
- The owner wants the interface to mimic MTG Arena as closely as possible, and asked for research into Arena's UI.
- What we copy is the interaction design: board layout conventions, turn flow, passing and stops, auto-tap, targeting,
  combat, the hand, prompts and feedback. These are how digital card games work, and they're what makes Arena feel
  good.
- What we don't copy is Arena's own expression: its art, card frames, icons, sounds, animations' artwork and visual
  style. Those belong to Wizards of the Coast (the Fan Content Policy allows fan content, not reuse of a game's assets
  or trade dress), and a fan project that looks like a copy of Arena invites trouble. Our visuals are original; the
  layout and the feel follow Arena.
- The research (from public sources: Wizards' Arena help pages and patch notes, guides, reviews, screenshots) is
  written up in `docs/arena-research.md`, in our own words, as the M3 UI tasks' reference.

**D-141: The folded phone plays in landscape (owner, 2026-11-22)** · 2026-11-22 · accepted
- Arena's phone client plays in landscape only. To feel like Arena (D-140), the folded iPhone Duo plays in landscape
  too, with Arena's phone layout, instead of the portrait compact layout ui.md first planned. In portrait a phone shows
  a "turn your phone" prompt over the paused match. The unfolded phone (nearly square), tablets and desktop use the
  full layout. Live switching on fold and unfold still must keep the match and any selection.

**D-142: No CLI spot-check for M2 (owner, 2026-11-22)** · 2026-11-22 · accepted
- The owner waived M2's exit criterion of playing and spot-checking games through the CLI: they'll play in the browser
  in M3's first phase instead. The planned `brief` additions (the viewer's decklist and library left, the opponent's
  shown cards) move to M3-02b, where the LLM opponent needs them.

**D-143: Auto-pass stops whenever a player could do something meaningful; no stops list (M3-01)** · 2026-11-22 · accepted
- The first host design passed priority outside a list of per-step stops (your main phases, an opponent's declare
  attackers and end step). Code review found it broke combat tricks: with a creature blocked, the active player had
  nothing to stop at in declare blockers, so a pump spell in hand never got its window. Arena's own default
  (`arena-research.md`) and `ui.md` ask for the opposite: stop when you could act.
- The rule, one pure function for every seat (D-137, `packages/match/src/auto-pass.ts`): pass when there's nothing
  meaningful to do (a land you may play, or a spell or non-mana ability whose mana `mightPay` says you could pay, is
  meaningful); with your own object on top of the stack, pass so it resolves; otherwise stop. It errs toward stopping:
  `mightPay` says yes when the mana adds up even if `autoPay` finds no plan.
- Seat settings are `{ autoPass, autoTap }`. Full control is `autoPass: false`: the host never passes for you. Per-step
  stops come back only if playtesting shows the rule stops too often (a setting on M3-09's settings screen, which lists stops).
- Gap: auto-tap is one seat-wide flag. The milestone's "manual override" of one payment (tap these lands instead) needs
  the UI's payment screen (M3-04 onward); it's noted in `status.md`.
- Cost: every priority with something castable is a stop, so a hand of instants stops often. Arena behaves the same.

**D-144: `seatView`, the one thing a seat is shown when it decides (M3-02)** · 2026-11-22 · accepted
- The heuristic AI must not read the game state (D-062), yet "cast the best affordable spell" needs to know what's
  affordable and what each spell could target. `seatView(state, player, cards)` in the engine's `view/` gives a seat its
  `playerView`, its `seenObjects`, and its legal actions as options, each with its mana cost, `payable` (the engine's
  `autoPay` finds a payment now, X as 0), `mightPay` (auto-pass's looser hint), its legal targets, the ability for an
  activation, and for a declaration pick whether the declaration could still be finished after it, with more picks if
  need be (`finishable`, found by adding the picks that obey the most requirements, `attacksCanFinish` and
  `blocksCanFinish`). For an answer announcing X, the whole cost with that X and whether it can be paid.
- Every one of those is something a person in the seat knows or the table shows: their own mana, targets among what
  they see, what a card's text says. The app's Worker will post the same to the UI, which uses the hints to highlight
  what can be cast (D-137): a computer seat and a person's get the same data.
- The host builds it only for a heuristic seat (`{ kind: "heuristic" }`), and always picks that seat's mana sources;
  the simple agents and the golden games keep reading the bare legal actions, so their games don't change. The
  fuzzer's leak check builds it for every player after every action, about 10% slower.
- Why `finishable` looks past the next pick: a stateless player that adds a pick a requirement rules out ("all
  creatures able to block it do so") has only "take it back" left, then adds the same pick again. The eval found such
  games, one where two blockers had to block the same attacker. Why X answers carry their cost: Fireball's X is
  announced before its targets, and an X the engine can't pay leaves only a cancel, then the same cast again.
- The two-worlds checks (`brief.test.ts`, the fuzzer's `viewsLeakNothing`) compare whole seat views.

**D-145: How the heuristic AI's "95% against random with each deck" is measured (M3-02)** · 2026-11-22 · accepted (void games added 2026-11-23, part 2)
- `pnpm eval --deck <name> --games 500 --seed 1`: the heuristic with that deck against the `random` agent with each
  prebuilt deck in turn (all five, the mirror included); the heuristic's seat changes every five games and who plays
  first every ten, so every pairing is played from both seats and both sides of the play.
- Both seats go through the match host with its auto-pass and auto-tap, as in the app: the random agent is asked only
  where a person would be, and picks uniformly there. A game past turn 40 counts as not won (`capped`), as does a draw.
  A game where the random agent goes round in circles until the host gives up (adding and taking back blocks under
  Prized Unicorn's requirement for 100,000 actions, `HostStuck`) counts as `void`, not won; it's reported, and rare
  (about one game in 1,500).
- Each decision is timed with the `seatView` build included, as the app will see it; the report gives the mean and the
  slowest, with its seed. Ten fixed games per deck run in `pnpm check` (`packages/cli/test/eval.test.ts`, at least seven
  won), so a regression shows without the full run.

**D-146: The LLM opponent learns cards from a tool, not its training data (owner, 2026-11-22)** · 2026-11-22 · accepted
- The owner: the LLM opponent "should be able to query what a card is and does as a tool call. It shouldn't base its
  decisions off of whatever card information was in its training data." `get_card(name)` (docs/llm-opponent.md,
  "Tools") gives the Oracle text, characteristics and rulings from the pool, and the harness's system prompt tells the
  model to look cards up there and not to rely on what it remembers. A model's memory can be wrong, out of date with
  errata, or about another printing; the card as this engine plays it is what matters.
- M3-02b's evaluation checks it: the transcripts of its CLI games show `get_card` calls for the cards it plays and faces.

**D-147: The LLM opponent gets computed facts; the model judges (owner, 2026-11-23)** · 2026-11-23 · accepted
- Of the ideas offered to make the LLM opponent effective, the owner chose these four for M3-02b ("1,2,3 and 6 sound
  good"): a `clock()` tool (lethal on board, turns left in the race, dying next turn), a `what_could_they_have()` tool
  (the pool's cards the opponent could cast now with their open mana and shown colors), an automatic preview check
  before big moves, and each card's Oracle text and rulings in the situation message the first time it appears.
- Why: language models are good at strategy and bad at arithmetic and bookkeeping, so the harness computes the facts.
  Every one reads only the player's view and public knowledge (the card pool), and the leak test runs on their output.
- Offered and not chosen for now: planning a turn in one go, handing trivial decisions to the heuristic, a "why did
  you do that?" button, difficulty levels, post-game lessons per deck, evaluating against the heuristic with blunder
  counts. They can come back later.

**D-148: M3-02b measures the LLM opponent against the heuristic AI too (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner: "I'm honestly curious how well the offline AI would perform against an LLM opponent - something to maybe
  test if it's worthwhile." M3-02b's evaluation command plays the LLM against the heuristic AI as well as the random
  agent, from both seats and both sides of the play, and reports the win rate with the tokens and time each game cost.
  It's how we'll judge whether the LLM opponent earns its cost and latency over the free, offline heuristic.
- `pnpm eval` already seats any agent against the heuristic; the LLM seat joins it there (an outside seat, as in M3-01).

**D-149: M3-02's 95% is a target, not a hard bar (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner: "We don't have to be so strict with the 95%." The heuristic AI was at 99.6% (white-soldiers), 97.4%
  (green-stompy), 96.6% (red-green-beats), 96.4% (red-aggro) and 94.0% (blue-black-control) on the acceptance run
  (`pnpm eval --games 500 --seed 1`), and 94.8% for blue-black-control on 2,000 held-out games (seeds from 10,001),
  within a standard error of the mark. M3-02 is accepted on those numbers; tuning more for the random agent has
  stopped paying (the last tries changed a handful of games either way), and the app is waiting.
- What's left for blue-black-control, from a study of its 104 held-out losses: half are against white-soldiers, a
  third end flooded (eight or more lands, an empty hand), and many hold a counterspell it never had the mana for
  (holding mana back measured worse). Stronger play later comes from search (architecture.md, "AI"), not more rules.
- How tuning is measured from now on: on held-out seeds, by games that flip between two versions, the acceptance seeds
  kept for the final run.

**D-150: How the heuristic AI plays combat, and what its seat is shown for it (M3-02 part 2)** · 2026-11-23 · accepted
- A pump until end of turn (Giant Growth, Overrun, Firebreathing) is worth only what it changes once blockers are
  declared (`tricks.ts`): a creature saved, a foe killed, lethal damage through. Before that it scores nothing, so a
  stateless player never spends a trick in a main phase.
- A declaration is planned with the picks already made as part of the plan (the options no longer list them), so a
  chump or gang block isn't repeated on one attacker. Blocks: win, trade, hold off (a creature that can regenerate
  counts as holding), two together for a big attacker, chumps while life would fall to 3.
- `seenObjects` shows each card's regeneration shields, public as the abilities that made them resolved, so the
  heuristic shields a creature once. `seatView` judges an ability whose cost taps its source as if the source were
  tapped already (Gargoyle Castle can't pay its own {5} with itself).
- Attacks read evasion from the cards: "can't be blocked", an attached Whispersilk Cloak, landwalk.
- Tried and dropped, measured: keeping mana open for counterspells, keeping creatures with {T} abilities home, and a
  check that what stays home can survive the attack back (each lost games on the held-out seeds).

**D-151: The web app's dependencies and its offline support (M3-03)** · 2026-11-23 · accepted
- `apps/web` adds runtime dependencies react and react-dom (the DOM layer, D-013), pixi.js (the board, D-013) and gsap
  (animation, D-013, used from M3-07), and dev dependencies vite with @vitejs/plugin-react (the bundler; Vite was
  already here through Vitest), the React types, and @playwright/test. All pinned exactly (D-016).
- @playwright/test is pinned to 1.63.0, the version whose Chromium this machine has installed; CI installs its own
  Chromium. The browser tests run against the production build, where the service worker and the bundled worker are
  real, in their own command (`pnpm test:e2e`) and CI step: `pnpm check` stays quick. The owner agreed (2026-11-23)
  that M3's exit criterion reads "CI is green, including the Playwright tests", and the milestone says so.
- Offline support is one short hand-written service worker, not vite-plugin-pwa and Workbox: precache every file the
  build wrote (a small Vite plugin lists them), pages network-first so a new build shows at once, hashed files
  cache-first, one cache per build named for its files' names and contents. Registered only in production builds, so
  `pnpm dev` never serves a stale module; the app asks for a new build as it starts and as it comes back to the
  foreground (a Home Screen app rarely navigates).
- Its caches are named `open-mtg-arena-app-<hash>` and a new build deletes only those: the card art (M3-08) keeps a
  cache name of its own, so an update never wipes the downloaded images.
- Known limit: a tab still running an old build after the new one takes over can't fetch old files the new cache
  dropped. Harmless today (the app loads every file at start); once the app loads code later (M3-09's screens, a
  worker per match), keep the previous build's cache for one more update.

**D-152: The compact board's first look (M3-04a)** · 2026-11-23 · accepted
- The layout follows the owner's phone screenshots (arena-research.md); where they don't show something, the desktop
  map's guess fills in. Every position and size is a share of the play area in one data file (`apps/web/src/layout/
  compact.ts`), each value tagged [R] (from the screenshots) or [guess], so the look changes in one place (D-012) and
  the full layout (M3-05) is a second object of the same shape.
- A tapped permanent tilts about 8°, dims and carries a curved-arrow tap mark, as in the screenshots, rather than
  turning 90°. CR 701.26a describes a paper card turned sideways; on a screen what matters is that the tapped state
  is plain to see, and a tilt keeps the rows from reflowing when a card taps. The mark is a shape, so tapped never shows by dimming alone (ui.md).
- Lands pile when they're interchangeable to look at: same name, no counters or damage, nothing attached either way;
  each name has one slot, its untapped lands in one pile and its tapped ones gathered in a second pile on top of it,
  at the slot's right (the owner: tapped cards go on top of the pile, 2026-11-23), and
  a slot's width depends only on how many lands it holds, so tapping a land moves nothing. Identical creatures pile
  the same way (as Arena piles tokens). A pile shows its front card with an "xN" count above it; the cards behind show
  as edges. Only the front few cards are offset, so past four the rest share a rectangle: M3-04b adds a hit area per
  pile that lists its members.
- The board model also gives the DOM layer its anchors (portraits, life crests, the phase ladder, the main button), so
  the canvas and the HUD can't disagree on where things are; the canvas is transparent over the page's table
  background. Safe-area insets are read from CSS (`env(safe-area-inset-*)`) and the layout keeps inside them.
- Art loads at runtime from Scryfall's image host (D-007), which serves it cross-origin; an art-less original frame
  shows until it arrives or if it never does, and the browser tests block the host so they never need the network.
- The main thread reads card faces from `@mtg/cards/pool`, the pool data without the definitions (about 220 KB more in
  the main bundle; of the engine only small pure helpers such as `phaseOf` and `isManaAbility`, which tree-shaking
  keeps alone). Long-press details (M3-04c) need the same data.
- Fixture boards start the worker from a `GameSetup` (`startFrom`; `?fixture=mid-game` or `crowded` in the address),
  for tests and the screenshots shown to the owner. The browser tests run at desktop size and at the folded phone in
  landscape (812×375, touch).

**D-153: Arena's card anatomy for the board's cards (M3-04a)** · 2026-11-23 · accepted, on the battlefield superseded by D-162
- Since D-162 a permanent is a frameless art tile (`battlefield-tile.ts`); the frame and name strip below remain only
  for a whole card's drawn fallback (hand, stack) until its image loads. The rest (row sizing, piles) still holds.
- The owner asked for cards closer to Arena's (ui.md, "The cards"). A permanent is a wide art card (1.2 wide to 1
  tall): a bevelled frame in its colour with a drop shadow, a light name strip with dark serif text and the card's
  colours as glyphs, the art filling the rest, power/toughness in a pill at the bottom centre, a raised number blue
  and a lowered one red, damage also underlined. A colourless basic land is framed in its mana's colour (CR 305.6).
- The structure follows Arena; every shape, colour and glyph is drawn by our own code (D-140): no Arena or Wizards
  frame art, symbols or fonts. The mana glyphs are our own (a sun, a drop, a crescent, a three-tongued flame, a tree).
- A creature row too wide for its space shrinks its cards (to a floor) before it overlaps them, and an overlapping
  row is drawn right to left so each card keeps its power/toughness in sight.
- The hand parts around the person's life crest rather than hide a card under it, and each card's floating cost
  shrinks to fit its strip of the hand.
- A card in hand is Scryfall's full card image (the owner, 2026-11-23), shown whole and unaltered with its artist
  credit and copyright (data-sources.md); overlapping in the fanned hand is how a hand is shown, not an alteration of
  the image. Our drawn whole card stands in until it loads.
- Without its art (loading, offline, the browser tests) a card shows a dark field tinted by its frame with its colour's
  glyph as a watermark, not a flat slab.
- The board model takes the layout as a parameter (`BoardLayout`, the compact one by default), and gives the HUD every
  rectangle it places (crests, portraits, ladder icons and pills, the main button), so no HUD code holds layout numbers.
- The canvas draws on demand (no frame loop while the board is still) at no more than twice the CSS resolution.

**D-154: Combat on the compact board (M3-04a)** · 2026-11-23 · accepted
- The owner asked to see attacks and blocks. On the phone there's little room between the two creature rows, so
  combat reads by position and shape rather than by long moves: an attacking creature steps a little toward the band
  and carries a crossed-swords badge (it tilts as it taps but isn't shaded); each blocker moves along its row to sit
  under the attacker it blocks, with a shield badge; the blockers of one attacker huddle together under it, overlapped
  enough to show each one's power/toughness. Creatures that aren't blocking step aside into the nearest free space.
- A lone declared blocker under its attacker gets no line: where it sits and its shield say whom it blocks. A beam,
  edge to edge across the open table, joins the rest: a blocker picked while blockers are being chosen (Arena draws its
  beam then, arena-research.md second set), each blocker of a gang (a huddle can sit over a neighbouring attacker), a
  lone blocker pushed out from under its attacker; and an attacker to the planeswalker it attacks.
- The values (`combat.advance`, `combat.gangOverlap`) are in the layout data. Moving cards between the old and new
  places is M3-07's animation; the board model only says where each card is now.

**D-155: Art credit on the board** · 2026-11-23 · accepted
- data-sources.md asks for the artist's credit in the same view as an art crop. Permanents on the board show art crops
  without one, as Arena does; the owner ruled that the long-press view (M3-04c), which shows the full card image with
  its artist credit, is enough. No credits line on the board. Hand cards are full card images, credit included.
- Owner (2026-11-23, on the card view): "The artist credit is already on the card itself, no need for the credit
  below it." The view shows the full card image, whose printed credit is the credit; no "Illustrated by" line.

**D-156: Acting on the board: controls from the options, buttons over the canvas (M3-04b)** · 2026-11-23 · accepted
- `interaction/controls.ts` turns the seat view's options into controls: a tap on a card (lift a hand card then play
  it, activate, target, attack, pick a blocker then its attacker, discard, sacrifice), a tap on a portrait (a player
  target), the main button, small buttons beside it (Undo, the engine's take-back of the last pick; Cancel, its cancel
  of a cast or activation), and a prompt for what has no card (keep or mulligan, X, dividing damage...). It never
  decides legality: every control sends an action the engine listed, and a property test over seeded games checks
  that every option has a control and every control's action is listed. That test is what let the list of every
  action (M3-03's drawer) go.
- Taps land on real `<button>`s laid over the canvas at tap regions the board model gives (a pile is one region, an
  open hand card its visible strip, the lifted card all of it): one path for touch, mouse and keyboard (ui.md "Mouse
  and keyboard too"), labels for screen readers, stable selectors for tests. The canvas only draws.
- The UI's own state of a choice under way (the lifted card, the picked blocker, an open menu, an action on its way
  to the worker) lives in the app, never in the engine; the board model takes the selection to draw it.
- A spell the person's mana surely can't pay for gets no control (D-144's `mightPay`), as Arena doesn't offer it.
- A decision about the hand's cards opens the hand; the main button names why a declaration can't finish yet.
- Left for later: drag to play (taps do everything a drag would), "All Attack", bespoke prompts for X, dividing
  damage and damage assignment (slice 2), smart stops (slice 3).


**D-157: Arena's default skips on top of D-143: no stop in your own upkeep, draw step or end step (M3-04b)** · 2026-11-23 · accepted (the owner: "whatever MTGA does, do that")
- The M3-04b plan in `status.md` proposed stopping only at a list of steps (main phases, the combat declarations,
  the opponent's spells and attacks). That is the design D-143 rejected, because a combat trick lost its window
  after blockers. The research's [R] lines say Arena stops wherever you hold something you can cast. So D-143 stays.
- What's added is what the research backs, in `arena-research.md`:
  - An official source (Wizards, Oct 27 2025, "Default auto-passing") says Arena doesn't give you priority in your
    own upkeep or end step.
  - A community source (a Steam thread, "Default stops") says the beginning phase runs on to main 1, which covers
    the draw step.
  So with auto-pass on and an empty stack, the host passes for you in your own upkeep, draw step and end step, even
  with an instant in hand. An opponent's object on the stack still stops you there; a test checks this in your
  upkeep, with your own trigger passed for and the opponent's spell stopping you.
- One of Arena's smart stops is kept, because it's cheap and loses nothing: mana left in your pool stops you in any
  of those three steps, as the pool empties when the step ends (CR 500.5).
- It applies to every seat (D-137), the AI's too. The heuristic AI did sometimes act in its own upkeep or draw step
  (a removal spell, an activated ability; the code review counted 36 such actions in 40 games). It now does those
  things in main 1 instead. `pnpm eval --games 500 --seed 1` after the change:
  - white-soldiers 99.6%
  - red-aggro 96.8%: 97.4% with the old auto-pass on the same seeds, so a difference of 3 games in 500
  - green-stompy 97.0%
  - red-green-beats 97.2%
  - blue-black-control 94.4%
  These are within noise of M3-02's 99.6, 97.4, 97.4, 97.4 and 94.0. The few games over the turn cap ("capped")
  happen with the old auto-pass too.
- Full control turns auto-pass off (D-143's `autoPass: false`): a switch in the settings menu, and a `fullControl`
  worker message. While it's on, the main button turns Arena's blue-violet [R]. Turning it off moves the game on at
  once wherever auto-pass would (so the switch goes through the same one-at-a-time guard as the main button). Arena's full control also turns off
  auto-tap. Ours doesn't yet: paying by hand needs slice 2's payment prompt.
- Not built, an open question for the owner: wider skips on your own turn (beginning of combat, combat damage, end
  of combat) and per-step stops on the phase ladder.

**D-158: All Attack and drag to play are the UI's, made from the engine's own options (M3-04c)** · 2026-11-23 · accepted
- The owner asked for both of Arena's shortcuts. The engine gets neither: a declaration is one pick per attacker
  (CR 508.1a), and playing a card is the same action whether it's tapped or dragged.
- The app shapes a declaration toward a goal, one engine option per reply (`stepToward` in
  `interaction/all-attack.ts`). While the declaration holds an attacker the goal doesn't want, it takes back the last
  pick, the engine's only undo, and re-picks after; then it picks each wanted attacker in turn. That gives:
  - All Attack: every creature that can attack a player is picked; a planeswalker is chosen on the card. Picks the
    seat view marks unfinishable are skipped. It's offered only while two or more creatures could still attack and
    every pick is at the same player: with several players to attack (CR 802), "all" wouldn't say whom.
  - Clear Attacks: the goal is no attackers.
  - A tap on an attacking creature takes it out: the goal is every other attacker.
  It stops when the goal is reached, a reply is an error, or the same step would go out again from the same
  declaration. Its end starts the double-tap guard.
- The batch button (All Attack, then Clear Attacks) has one fixed slot, and Undo the other, so a second tap never lands
  on an action that just moved into the place pressed. It keeps its label, disabled, while it runs.
- Drag to play: a press on a hand card (open or collapsed hand) that moves 12 px up lifts the card. Letting go plays
  it, as a second tap would, once it's at least 60 px up and above the open hand's top edge [guess, the distances]: the
  cue turns gold then. A card that can't be played says so; a cancelled drag leaves the hand as it was. Escape or a shorter drag puts it down. One pointer
  and the main button only; the drag is followed on the window, since lifting the card redraws the hand; the click a
  release fires is swallowed. The card following the finger is M3-07's.

**D-159: The app is published to GitHub Pages from `main` (M3)** · 2026-11-23 · accepted
- The owner wants to follow progress on their phone. The app is static (no server: everything runs in the browser),
  so GitHub Pages hosts it for free at `https://benjaminhor.github.io/open-mtg-arena/`.
- A workflow (`.github/workflows/pages.yml`) builds `apps/web` and publishes it on every push to `main`, so each merged
  pull request is live a few minutes later. The owner enables it once: Settings → Pages → Source: "GitHub Actions".
- Pages serves the app under `/open-mtg-arena/`, not `/`: the build takes its base path from `BASE_PATH`, and every
  path the app writes itself (the service worker, its precache list and offline fallback, the manifest) follows it.
  Local builds and the tests keep `/`.
- It's public, as the repository is. Card art is still fetched from Scryfall at runtime and never published with the
  app (D-007, data-sources.md).

**D-160: When a UI question comes up, do what Arena does; don't stop to ask (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner: "mtg arena is the North Star so if there's a question, do what arena would do", and "continue until you
  need feedback on open questions". This sharpens D-140: for interaction and layout questions, Arena's behaviour is
  the answer, found in `arena-research.md` (researched further when it's silent), and the work goes on.
- Still asked: anything Arena can't answer (rules interpretations go to the CR, D-020; scope, priorities, money,
  publishing), and anything where copying Arena would mean copying its assets (D-140's line stands).
- First use: a mouse hovering a card shows a large preview, as Arena's desktop client does.

**D-161: The card view (M3-04c)** · 2026-11-23 · accepted
- Arena's "Examined" view: a long-press (400 ms, touch), a right-click, or "i" on a focused card opens it full; a
  mouse resting 250 ms on a card previews it (D-160; first 600, then the owner's 250). `interaction/card-details.ts` builds what it shows from the seat
  view alone (D-062): the card, and a hanger per thing its face doesn't say. No rulings, as Arena has none.
- The view holds the card's id, not a copy of its details: it's re-read from the seat view each render, so it follows
  the game while open and closes when the object is gone (a zone change makes a new object, CR 400.7). The same shape as
  a card's menu (`menuFor`).
- The card has a fixed place at the left, as Arena's, and the hangers a fixed-width column beside it, so a hanger
  appearing never moves the card. A preview is at the left too, always (the owner: "it should stick to just one
  side"; it first went on the half away from the hovered card); moving from card to card swaps it at once.
- It shows Scryfall's large image (672 px, sharp at a phone's DPR 2–3), loading from a moment into the press, and the
  card as text until it has loaded, or for good if it can't (offline, D-007): never a broken image.
- A long-press waits for its release on the window, not the card's region (which the game may redraw meanwhile), to
  swallow the click that follows; it also stops a hand drag from starting under the view. A touch's context menu
  (Android fires one during a long hold) neither opens nor closes the view: the long-press's own timer does that.
- The full view is modal: focus goes to Close and stays there, and no key reaches the board behind it. Every card's
  region is focusable, so "i" reaches cards no tap acts on.

**D-162: A minimal, clean look throughout; Arena stays the guide for layout and play (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner shared screenshots of another MTG web app ("I kind of like how minimalistic and clean this person's web
  app is", ui.md "Minimal and clean"; then "the UI as a whole just feels more clean and minimal") and, asked how far
  to go, chose "Minimal throughout": a flat dark table, each
  permanent only its art with its name over a dark fade and a small P/T pill, small round icons for keywords and
  counters, plain text for the phases and the life and zone counts, a calmer main button, less ornament everywhere.
- Kept: touch-first play on the board itself (no side panel of buttons), and Arena's layout and interactions (the hand,
  the main button's place and job, the ladder's job, the card view, All Attack, drag to play): D-160 still answers
  how things work and where they go. What changes is how they look.
- This narrows D-012 ("Arena-level polish"): polish now means clean and calm, not Arena's ornament. D-153's card
  anatomy (frame, name strip) gives way on the battlefield; hand cards stay whole card images. D-140 (our own shapes and
  colours, no Arena assets) is unchanged, and so is not copying the other app's assets: we take its restraint, not its
  pixels.


**D-163: Inter as the app's one typeface (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner, on the first minimal tiles: "the font style doesn't match the reference" (ui.md, "The font"). The
  reference uses a clean, even sans-serif at a regular weight. System fonts differ by device (and a squeezed system
  font read as condensed), so the app bundles one: Inter, by Rasmus Andersson, SIL Open Font License 1.1.
- New runtime dependency: `@fontsource-variable/inter` 5.3.0 (pinned). Only its Latin variable file is used (48 KB,
  `app/font.ts`, loaded with the FontFace API), so the service worker's offline cache stays small. The app waits up to
  1.5 s for it before the first draw, since the board's canvas measures text as it draws.
- Used by the HUD (`:root`) and by everything the board draws in text (`PALETTE.sans`), except a whole card's drawn
  fallback, which keeps its printed-card serif until the real image loads over it.
- A permanent's name is never squeezed sideways (letters at their natural width); it shrinks to fit beside the P/T.

**D-164: Each player's info in a left corner (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner, pointing at the reference app: "you see how the player and opponent info is on the left corners in the
  reference screenshots? the life total, library size, graveyard, and exile." So the opponent's block is at the top
  left and the person's at the bottom left (`hud/PlayerInfo.tsx`): a label and the life total, large, on one line,
  and under it the library, graveyard and exile counts. It replaces the centred life crests (Arena's) and the
  portraits, and the library piles (their count is in the block). This departs from Arena's layout (D-160) at the
  owner's word.
- Whose turn it is: a marker before the label and the label in the accent. A player who can be targeted: the block
  becomes a button with a dashed outline. The person's mana pool sits just above their block.
- The board model gives the blocks as anchors (`overlay.player`); the land rows start right of them; the hand is a
  plain centred fan (it no longer parts around a crest); on the opponent's turn their ladder is at the top centre,
  its combat rungs as on the person's; a prompt that can't go between the rows sits near the top (`promptTop`).
- Exile counts the cards each player owns that can be seen there; graveyard and exile browsing come with the zones
  slice.

**D-165: We keep and finish our own rules engine, not Forge's (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner asked whether to adapt the web frontend to Forge's open-source engine (github.com/Card-Forge/forge)
  rather than build our own. Forge has far more cards ("over 99%" of all cards), but it is Java with no web build,
  GPL-3.0 (our repo is MIT), and would need a server (or Java running in the browser) for our app, losing offline play
  and "no server" (vision.md), and the pure-reducer design that replays, fuzzing, the CR-cited tests and the LLM
  opponent's tools rely on. After the trade-offs, the owner: "never mind then, we'll strive towards finishing our own
  rules engine." D-051 stands: the engine is the end goal. Card coverage grows a mechanic at a time.


**D-166: Badges on a permanent (M3-04c slice 4)** · 2026-11-23 · accepted
- What a permanent wears besides its name and P/T, decided in `board-model/badges.ts` (pure, tested) and drawn by
  `renderer/badge-marks.ts`, our own shapes (D-140), light on small dark discs, in the minimal style (D-162):
  - keyword icons along the top left [R] (the name now has the bottom): two at most, after "zz" when it's sick, as
    room allows; with more, one and an ellipsis (three dots, no disc: a disc with dots reads as a menu button), the
    card view listing them all [R]. Most telling first: flying, reach, first/double strike, deathtouch, trample,
    lifelink, vigilance, haste, protection, indestructible, shroud, landwalk, defender. Flash has none (it does
    nothing on the battlefield). Protection is an icon of its own: a dome (a shield is a blocker's badge and loyalty's, UX
    review). First strike is an upright sword, double strike two (an attacker's badge is two crossed), flying a wing
    with feather tips, reach an arrow up to a bar, trample an arrow through a wall, indestructible a hexagon;
  - counters as a small badge at the top right [R], left of a combat badge: "+2", "−1", or another kind's count;
  - a planeswalker's loyalty (CR 306.5c) in a shield where a creature's P/T goes [R]; one that's also a creature
    shows it at the top right;
  - summoning sickness (CR 302.6) as a "zz" mark first in the icon row [R: Arena has an overlay] until its
    controller's next turn begins, the other player's turn included, as the rule says (it can't attack or use {T}/{Q}
    abilities then; a Llanowar Elves can't tap for mana on the opponent's turn). First built to show only on its
    controller's turn; the code review found that hid a real restriction. Dimmed (the owner) only on its
    controller's turn: on the other player's it can still block, and a dimmed creature reads as out of play while
    blockers are counted (UX review). Only the art dims: its name and P/T stay readable.
- Protection now splits a pile, as keywords and counters do. Loyalty isn't a counter badge.
- The icons take the room the counter leaves: fewer, ending in the ellipsis, on a small tile. Badges sit below a
  token's arched corners. A planeswalker that's also a creature (none in the pool) would show its P/T, loyalty in the
  card view.
- A sick creature is also dimmed (0.32, less than a tapped card's 0.45), as Arena shows it (the owner, ui.md
  "Summoning sickness, dimmed"); its badges stay bright over the dimming.

**D-167: Auras and Equipment beside their host (M3-04c slice 4b)** · 2026-11-23 · accepted
- An attached permanent (CR 301.5, 303.4) leaves its own row and sits just left of its host, behind it, 42% of its
  width peeking out (its art and the start of its name), joined by a link mark on the host's left edge [R: the
  owner's screenshot]. On the host's side of the table, whoever controls it (a Pacifism by the opponent's creature),
  as Arena shows it. `board-model/attachments.ts`.
- The host's row keeps room for it (the creature row's pile width, the land row's slot width), so nothing moves
  under it. It's placed after combat has moved the cards, so it follows an attacker or a blocker.
- Hosts in the others row (an enchantment or a planeswalker; none in today's pool) keep today's placement: the
  attachment stays in the others row.
- After the code review: a host stands apart from its twins (read from the whole battlefield), so it never piles;
  combat keeps a host's room when it blocks or steps aside; the prompt's place reads the rows without attachments (an
  attachment's `mine` is its controller, its side the host's). Known and accepted: the peeking strip is about 30 px
  wide on a phone's creature (23 on a land), under the 44 px target, as a pile's strips already are; the card view and
  the host's own tap reach the same things. A tapped attachment's tilted corner can poke a few px past its room.

**D-168: Graveyards, exile and revealed cards (M3-04c slice 5)** · 2026-11-23 · accepted
- A tap on a player's info block opens the zone browser [R: "tapping a zone opens a browser of its known cards with a
  count", the opponent's too]: a modal sheet with a tab per zone ("Graveyard 31", "Exile 2", and "Hand 3" / "Library
  top" while revealed), the cards in a row that scrolls sideways (a swipe, or a mouse wheel), a tap on one showing it
  in the card view over the sheet. Escape closes the card view, then the sheet; focus is kept inside and goes back to
  the block. The block is the zone's place because there's no pile to tap any more (D-164); the whole block (172×40),
  not a count, so it's a fair touch target.
- While the player is a target, a tap picks them, as Arena's avatar does; a long-press, right-click or "i" on the block
  always opens the browser (`hud/long-press.ts`), so a graveyard can be read while choosing.
- `interaction/zones.ts` (pure) gives both the counts and the browser's lists, so they can't disagree: a graveyard top
  first (CR 404.2), exile by owner newest first (CR 406.3), a revealed hand (CR 701.20a) and library top (CR 401.5) by
  identity only (D-062), keyed by position. The browser holds only `{player, zone}` and re-reads them each draw, as the
  card view does (D-161); a reveal that ends takes its tab, back to the graveyard. It's for reading, so a decision
  arriving leaves it open. The card view shows a revealed card by its printed face (`printedDetails`).
- Revealed cards show without a tap [U: "revealed cards are shown face up"]: a library's revealed top card as a small
  face-up art tile beside its player's block (in the outer column, where Arena keeps a library pile), and an eye chip
  "Hand revealed" for a revealed hand (the person's own a quiet note: they hold it); a tap on the opponent's opens the
  browser there. The opponent's
  card backs at the top stay backs: only their bottom edge is on screen, and a revealed hand's order isn't its real
  order (D-062).
- Picking a card in a graveyard (Gravedigger's target) stays in the prompt: Arena opens a browser of the cards to
  choose [R], later (future-rules.md).
- After the reviews: a long-press's click is swallowed when the finger lifts, however long it was held (it had been
  timed from the press firing, so a 700 ms hold opened the browser and its release closed it); the backdrop closes the
  sheet only on a press that began there. Focus can't leave the sheet (Tab from the page, a prompt arriving behind it).
  The revealed marks are a column within the block's width (they had reached the board's first pile on a phone) and
  step aside while the player is a target. A revealed card is keyed by identity and copy, so a card being looked at
  stays itself when one before it leaves. Cards in the row fall back to the drawn card, as the card view does. The
  sheet names whose zones they are, keeps one height (an empty zone too), and says when a decision is waiting under it.
  Press states at once; 44 px taps.

**D-169: The whole stack, and abilities as panels (M3-04c slice 6, first PR)** · 2026-11-23 · accepted
- Every object on the stack is drawn at the right [R: arena-research.md §5]: the top large (small while the person
  chooses for it, as before), the ones under it peeking out (first built to the left; see the UX review below), and
  the whole stack listed top first in the zone browser's row (D-168), so every object stays reachable.
- An ability is a card-shaped panel [R: "the source's art, an 'Ability' type line, the ability text"]: its source's
  name and art (in the art window, never a whole image over it), "Activated ability" / "Triggered ability" / "Delayed
  triggered ability", and its own text. The engine keeps a card's Oracle text whole, so `board-model/ability-text.ts`
  picks the ability's line by its `AbilityRef` (activated and triggered lines in printed order, reminder text left
  out); a test over the whole pool checks each ability finds a line whose cost agrees with its definition (equip,
  loyalty, {T}, sacrifice, counters). A delayed trigger shows its source's whole text. An ability whose source has left
  is still drawn, from the source's printed card, as a plain panel.
- The card view of a stack object: an ability shows its own panel (with its source's art) and "From" (its source and
  where it is, or "Its source has left", CR 113.7a); every stack object shows its targets (a player, or a card with
  where it is when that isn't the battlefield, or "a card that has left"), X (CR 107.3a), and a divided effect.
- After the UX review, the cascade changed direction: the objects under the top peek out *above* it by a name strip
  each (11% of a card's height, at least 14 px), the deepest highest, at most three, all within the block the top
  alone used to fill (the top shrinks as the stack deepens; the large block at most 340 px tall). Peeking out to the
  left had covered creatures and taken their taps (a pumped Shivan Dragon couldn't be tapped again), and its 22 px
  strips showed two letters of a name. Each object's tap region and focus ring is only its visible strip. A "Stack n"
  button above the stack, from two objects up, lists them all top first in the zone browser ("Resolves next" on the
  first): the strips are a name's height, under a finger's, so the button is the sure way to each; the count badge is
  gone (it said the same twice).
- An ability panel is drawn in the app's typeface (D-163: the serif is only for a card's fallback until its image
  loads; a panel never gets one), its name sized to its strip. Its card view's art loads before it shows, with its
  artist's credit (data-sources.md); offline neither shows, no broken image. A divided effect's shares go on the
  Targets hanger ("2 to Elite Vanguard, 1 to Veteran Armorsmith"). The main button names a resolving ability by its
  source even once that has left.
- Left for later: mana symbols drawn as shapes in canvas text (an ability panel and a hand card print "{T}"); an
  ability panel's own shape (Arena's shield-like bottom); X drawn on the spell itself [R].
- Arrows from the top object to its targets and the tap that shrinks the large card are the next PR.

**D-170: The stack's targets on the board, and the stack made small (M3-04c slice 6b)** · 2026-11-23 · accepted
- An arrow runs from the top of the stack to each of its targets the board shows [R: "a targeting arc is drawn as a
  glowing curve from the stack item to its target"]: a curve in the targets' cyan with a dark edge and a head at the
  target, to a card where it's drawn (a pile's front for a card behind it, an object under the top at its strip) or to
  a player's info block. A target the board doesn't show (a graveyard card, one gone) has no arrow; the card view
  names it (D-169). Only the top's: the others show theirs in their card views, as Arena shows them on hover [R]. None
  while a spell is being put on the stack: its targets are being chosen, shown by the dashed outlines.
  `board-model/target-arrows.ts`, computed after combat and attachments have placed the cards.
- A tap on the stack makes it small at the right edge, as while choosing, and another makes it large again [R: Arena's
  collapse tab]; held for the object on top then (`stackSmallFor` in App), so a new object on top shows large. Not
  while the person chooses for their own spell (it's small already). The stack's tap regions are buttons now, so Space
  presses a focused one rather than the main button.
- A spell on the stack a counterspell targets (CR 115.1) is outlined as a target where it's drawn, and picked in the
  prompt by name ("Target Lightning Bolt"): the counterspell being cast is on top, so its target shows only a name
  strip, too small to tap. Arena clicks the spell itself; the prompt is the reachable equivalent here.
- After the reviews: a partly covered card carries the part that shows (`BoardCard.shows`: a stack object's name strip,
  an Aura's left edge beside its host), and the target outline, the arrows and the tap regions use it, so an outline
  never runs down the sides of the card over it and an arrow at an Aura doesn't land on its host. An arrow to a spell
  under the top ends at its strip's left edge and bows out beside the stack; to a player at their block's edge, clear
  of the life total; one arrow per target chosen twice. No arrows while the hand is open (it covers the board). The
  strip of a spell a counterspell can target is also a tap that picks it (the prompt's same choice), so the outline's
  promise holds. Made small, the stack keeps the large one's top right corner, so a second tap where the first was
  makes it large again. A pointer's press on the stack leaves no focus behind, so Space goes on pressing the main
  button. Arrows have a soft glow under them [R].
- Left for later (UX review): a visible collapse tab (only the tap on the card for now); a mark on the targeted card
  itself; a second cue for the opponent's arrows; the arrows drawn from the sprites' moving positions once M3-07
  animates them (today they're from the model's).

**D-171: A phone held upright pauses behind "turn your phone" (M3-04c slice 7)** · 2026-11-23 · accepted
- The board is laid out for a phone in landscape (D-141), so a phone in portrait shows a full-screen prompt, "Turn
  your phone sideways to play", over the paused match (ui.md "Layouts"). Decided from the viewport alone: upright and
  narrower than 700 px (`app/orientation.ts`, followed by `use-portrait.ts`), so the unfolded Duo (832 wide upright)
  and a tablet play as they are. The match behind is `inert` and takes no key; turning back carries on where it was,
  nothing reset. Arena's phone client plays only in landscape [R].
- Small finishing items with it: the collapsed hand's tap area is at least 44 px tall (it was 40); a raised or lowered
  power/toughness carries a small caret up or down as well as its colour (ui.md, "Never color alone").
- M3's acceptance ("a full game is playable at the folded phone's size in landscape") is e2e/play.spec.ts's whole
  game by touch taps at 812x375, run on every PR.
- After the code review: every key listener on the window (the zone browser's, the settings menu's, a drag's) checks
  `matchPaused()` (`hud/paused.ts`: the match's main element is inert), so Escape behind the prompt doesn't close what
  was open; the prompt takes focus while it's up and gives it back after; it adds "On a computer, widen the window"
  (a narrow desktop window gets it too, by the viewport rule). Known and left: a hand drag or an All Attack already
  under way when the phone turns keeps going (rare: it needs a turn mid-gesture).

**D-172: Pacing comes next, before the full layout (owner feedback, 2026-11-23)** · 2026-11-23 · accepted
- The owner: "the auto pass feature is a bit jarring currently. Things just progress instantly and I get confused."
  Auto-pass (D-143, D-157) is Arena's and stays; what's missing is seeing what it passes through. So right after
  M3-04c, before M3-05, comes a first pacing slice, pulled forward from M3-07/M3-12 (ui.md "Pacing for the
  opponent", "The game never jumps"): the worker sends each step of what happened rather than only the end state, and
  the app plays them in order at a pace a person can follow (the opponent's spell held on the stack, an attack shown,
  the phase ladder stepping, a short line saying what happened), skippable with a tap, an "instant" speed for tests.
  Arena holds each opponent stack item for a minimum time [R: 0.4 s since 2018]. It's built in a shape M3-07's
  animation director grows from (a queue of shown steps), not a throwaway.
- Built: the match host's `advanceOne`; the worker loops it and keeps a frame (the person's seat view and the events
  since the last) after each host action whose events hold (`interaction/pacing.ts`, one exhaustive table over every
  event kind: an opponent's spell or ability 1 s, an attack or a block 0.9 s, an outcome 0.6 s, a trigger 0.6 s, a land
  0.5 s, a new turn 0.7 s; the person's own choices, an opponent not attacking, an empty step: none) [guess, to tune
  with the owner]. The app (`app/use-playback.ts`) draws each frame for its hold with a line under the turn banner
  ("Your opponent cast Elite Vanguard", `interaction/event-line.ts`), then the reply's own view. Meanwhile no game
  action is sent (conceding and full control still are), prompts and the small buttons stand down, looking (card
  view, zones) works, and the main button is "Skip" (Space too); a skip starts the settle moment, so a double tap
  doesn't also press what it uncovers. The e2e build plays at instant pace (the same path, every frame skipped);
  `?pace=normal` or `?pace=instant` in the address picks it.
- After the code review: each turn's banner has its own timer and element (frames once cancelled its timer and it
  stayed up, faded, so later turns showed none); the settle moment starts whenever playback ends, on its own too, and
  Skip and the main button are different elements, so a press meant for Skip never lands on Next; frames carry no
  options; the person's own action that begins a turn is a frame of its own; a frame's line comes from its most telling
  event that has one, and names an object that moved in it (a spell that resolved) from the move.
- After the UX review: the holds retuned (an opponent's spell 1 s, a land 0.7 s, an attack or block 0.9 s, an
  outcome 0.6 s, the opponent's new turn 1 s; the person's own turn start and their own spell resolving aren't held:
  the banner runs while they act, and what their spell did is held itself) [guess, to tune with the owner]; several
  hits on a player in one frame say the total ("You took 8 damage"), several tokens their count; playback pauses while
  the person looks (the full card view, a zone browser); the hand closes when playback starts; the line and the turn
  banner share one place at the band's centre (a line takes the banner's place), in the banner's style; Skip is a quiet
  button, not the main button's colour. Left: playback's position logic as pure functions; the worker builds frames
  even at instant pace; no performance trace of playback yet; whether the phase ladder should step through the steps
  a frame skips (Open questions).
- The owner then: "If it's due later then that's fine. I just wanted to bring it up in case we didn't know." Kept
  forward anyway: it's the most confusing part of play-testing now (this and the "two lands" report), and every later
  slice is tried through it.

**D-173: The owner's feedback on the pacing slice (2026-11-23)** · 2026-11-23 · accepted
- The owner, after trying the live site: "speed seems fine so far" (the D-172 holds stay); "phase bar should mirror
  what mtg arena does" (the ladder during the opponent's run does as Arena's does, researched first); "card spacing is
  okay for now, we'll revisit later" (the zone browser, D-168); and "when there's something on the stack to resolve,
  it's not immediately obvious that there's something on the stack. maybe the UI can represent this in more clear,
  clean, and minimal way". The last two come next, before M3-05: the stack made obvious, and the ladder as Arena's.
- Then: "I know that forge mtg has a UI on the side that shows a list of things on the stack that need resolution - I
  wonder if we could have something similar but more polished lol". Taken into the stack's design (Forge, an open
  source MTG client, lists the stack as a side panel of entries).
- The ladder, asked directly (Arena's wasn't found): "it steps through each phase as it passes - we should avoid
  immediate jumps between the \"main\" phases - this probably would be largely solved with animations". So the lit
  rung walks through each step a frame passes, never jumping from main 1 to main 2 or across a turn (D-175).
- Research (a web search; page fetches were blocked, so only search summaries): Arena passes priority for you after
  you cast your own spell, whatever you hold [R: Steam thread, cardgamebase]; ours already does (D-157). Whether
  Arena's ladder walks through each passed step or jumps wasn't found [U]; the combat steps appear "when you enter
  combat" [R: mtgarena.pro, "Updated Phase Ladder", 2018].

**D-174: The stack reads as the stack: a header, whose each object is, a list (owner feedback, 2026-11-23)** · 2026-11-23 · accepted
- The owner (D-173): a lone object on the stack isn't "immediately obvious"; and Forge's side list of the stack, "but
  more polished". What they saw: the opponent's spell held at the right edge as a bare card, nothing saying it's the
  stack, whose it is, or that it waits; only the main button's "Resolve" said so.
- Arena's large top card at the right stays (D-169) [R]. Added (`hud/StackLabels.tsx`, placed at the rects of
  `board-model/stack-labels.ts`):
  - a "Stack n" header above it from one object on (it was the "Stack n" button from two), a tap listing them all;
    its spoken label says whose object is on top ("..., opponent's Elite Vanguard on top");
  - the top object ringed in a neutral light, with a tag under it, "Yours" or "Opponent's";
  - each object under the top a row with its name in Inter over its strip (the card frame's own title was too small to
    read there), strips at least 20 px while the stack is large. A row says "You"/"Opp" only when both players have
    objects on the stack (else the tag has said it). A small stack's strips are too short for a name and keep their
    card frames.
- First drafted with Arena's turn colours (orange the person's, blue the opponent's) on the ring and rows; the UX
  review found orange already means "whose turn" here (the player info's marker), orange lost on red frames and blue
  close to the cyan targets. So the ring is neutral and whose is said in words only.
- No ring or tag while the person chooses targets for their own spell (they'd compete with the targets); labels stand
  down where the open hand would sit on them (the header stays); the rows take no taps (the strips' own regions do,
  so a counterspell's target is still picked by a tap on its strip). The ring and tag fade in (not with reduced
  motion); fading out with the card waits for M3-07's animations.
- Not changed: Arena's large-card shape. A Forge-style list in place of the large card doesn't fit a 375 px-tall
  board beside the ladder and the main button; the rows give the list's reading without the room.
- Future impact: none on the engine. "Opponent's" assumes one opponent; with more players the tag names the controller
  (`who()` in `names.ts`), as the rest of the HUD will. M3-07's animations bring objects into this column.

**D-175: The phase ladder walks through each phase passed (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner, asked what Arena does (research hadn't found it): "it steps through each phase as it passes - we should
  avoid immediate jumps between the "main" phases - this probably would be largely solved with animations".
- Built in two parts:
  - The opponent's turn: each new phase of it (main 1, combat, main 2, end; its beginning is held as the new turn) is
    a frame of its own, held 150 ms [guess] (`interaction/pacing.ts`, `HOLD.phase`), so their ladder steps through
    each on their turn's screen. A quiet opponent turn takes about 0.6 s longer.
  - Every new view (a held frame, or the reply's own view): the ladder lights each phase passed on the way to the
    view's step (`interaction/ladder-walk.ts`, pure, from the STEP_BEGAN events that led to it; `app/use-ladder-walk.ts`
    times it; `ui.ladderAt` in the board model). Phases, not steps: the beginning phase's three steps light
    "Beginning" once (CR 500.1). 140 ms a phase [guess]; inside a held frame the walk shares the frame's hold; at the
    person's decision it runs while they act. The lit rung eases (120 ms, none with reduced motion); the ladder stays
    short while walking, so combat doesn't open and close as it's passed. None at instant pace (tests).
- After the code review: the walk lights only the turn the view shows (its banner, turn marker and controls already
  say whose turn it is, and the ladder never says otherwise; a turn's change is marked by its banner, and the
  opponent's phases are walked on their own turn's frames, above). A view arriving mid-walk carries on from the phase
  lit then, through what was left. After Skip there's no walk: it jumps, as asked. The engine's `phaseOf` decides
  what's a phase.
- Tests: `test/ladder-walk.test.ts` (combat passed with no attack, a whole turn, only the shown turn, an extra turn
  (CR 500.7), a walk cut short, the step time, the board model lighting the walked phase on whose ladder),
  `test/pacing.test.ts` (the phase hold); an e2e watches every change of the lit rung through the opponent's first
  turn and the start of the person's, and checks each goes to the next phase or a new turn's beginning
  (mutation-checked: with the walk off, or without the phase holds, it fails).
- The owner, after trying the stack labels (D-174) and the walking ladder live: "Seems fine at the moment, move
  forward with M3-05".
- Future impact: M3-07's animation director can drive the same walk from its own clock; the walk reads only events,
  so extra turns (CR 500.7) and skipped steps (CR 508.8) walk as the engine played them.

**D-176: The full layout for the unfolded phone, tablets and desktop, picked by size (M3-05)** · 2026-11-23 · accepted
- `layout/full.ts`, a second `BoardLayout` value (D-152), from Arena's desktop match screen [R: arena-research.md]:
  battlefield cards about 13% of the height, shrinking to 8% before a crowded row overlaps; lands at the left of the
  outer band, other permanents at its right short of the stack's column; the stack at the right edge; the hand's tops
  along the bottom, a quarter of each card showing; the controls a little larger. Values that aren't Arena's say
  [guess].
- `layout/layout-for.ts`: the layout is picked by the screen's size alone (ui.md: never the device): the compact one
  under 560 px tall (phones in landscape are 320-430), the full one otherwise [guess for the line]. The App picks it on
  every resize, so folding or unfolding re-lays out the board with the game, the open hand, the lifted card and the
  targets being chosen kept: they're the App's state, not the layout's. `window.__board.layout` names it for tests.
- Found while building it, in the shared model code (both layouts):
  - A land row can shrink its cards before it overlaps them, as the creature row does (`lands.minH`; `shrinkToFit`
    in `spread.ts` is the one loop for both). The phone keeps `minH` = `h`: shrunk, its lands went under a finger's
    44 px (code review), so a crowded phone row still overlaps as before.
  - The land row starts clear of the player's info block only when it's level with it, counting how far the deepest
    pile and a tilt can reach (on a tall screen it's well below the opponent's block). On a phone it's always level,
    as before.
  - The large stack is at most `stack.maxW` of the width (0.2 on the phone, which shrinks its card at 667x375 only).
  - Cards' heights are shares of a card basis (`cardBasis`, `board-model/card-basis.ts`): the height, or a share of
    the width when that's less. The phone uses the height, as before; the full layout 0.86 of the width, so an
    unfolded phone held upright gets cards its rows can hold (UX review).
  - A creature row is centred on the screen, and moves left as far as it must to end by `creatures.right` (the
    stack's column, 0.8 in the full layout; the phone's is its margin, as before) (UX review).
- After the UX review, the full layout's values: lands and others smaller (0.09) and spread wider (lands to 0.4,
  others from 0.42); the band 0.10 (a prompt with its choices fits between the rows); the hand's strip 0.24-0.76
  (names read; centred, so it mirrors); the open hand 0.34 of the height, nine tenths showing (on a big screen the
  old 0.44 covered the battlefield); the controls a size up (info 210x50, main button 176x58, ladder icons 26, small
  buttons 120 wide so "Clear Attacks" fits) with their text sizes in app.css under `.hud[data-layout="full"]`. An
  activated ability's line says "Prodigal Pyromancer's ability".
- No game log (ui.md once said the full layout shows one): Arena has none, its desktop map shows none, and the owner
  chose to leave it out ("Leave it out", 2026-11-23); the line saying what just happened (D-172) covers the opponent's
  moves.
- Tests: `test/full-layout.test.ts` (which layout each size gets; at the unfolded both ways up, 700x900, tablets both
  ways, 1280x720, 1920x1080 and the shortest full height: permanents on screen and clear of the HUD, each half's rows
  apart, the hand in its strip below the outer row's costs, the stack clear of the controls; and a test for each
  rule above, each mutation-checked; the phone's deep land piles clear of the info blocks at 915x400 to 932x430 with
  a bottom inset), and
  `e2e/layout.spec.ts` (folding and unfolding while a target is chosen, then casting the spell; while a card is lifted
  with the hand open, then casting it). The desktop e2e project now plays every spec in the full layout.
- Future impact: a third value (a multiplayer board, the RPG's) is more data and a line in `layoutFor`. The owner's
  unfolded screen size is a guess until they send a screenshot (status, Open questions).

**D-177: Build on phase-rs's engine and client, imported and rebranded (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner, after the evaluation (`docs/phase-rs-evaluation.md`) and playing it: "I'm okay with just forking the
  current version and then allowing our repo diverge over time. I just want to borrow the major pieces of their
  implementation so we could build freely on other features." "I think what we could do instead of forking is just
  clone the repo and replace everything in our repo." "I would want to do a major clean up so that it's not phase-rs
  branded anymore in any shape or form." "I'm okay with dropping the "nothing a black box" rule for the engine. the
  match screen feels very good to build on and it feels passable on my phone layout so far."
- So: phase-rs at a fixed version (v0.131.0, 57c647e) is copied into this repo, replacing our TypeScript engine and
  client; no upstream tracking; the repo diverges freely. The aim is the higher-value work: the LLM opponent and a
  single-player RPG or roguelike.
- Reverses, for the engine: "nothing may become a black box" (CLAUDE.md), the TypeScript pure reducer and its package
  layout (architecture.md), hand-written card definitions (card-scripting.md). Our phone-first work (D-141 to D-176) is
  superseded by their client; what it taught (pacing, the stack's labels, the walking ladder, the layouts) is kept in
  these docs to bring across where it still matters.
- Branding: every phase-rs name, logo, domain, link, contact and service is removed or replaced. Their copyright and
  license notices stay, as MIT and Apache-2.0 require: the license files keep their copyright line, and a NOTICE
  credits the code's origin. That's attribution in the license files, not branding in the app.
- The owner's answers (2026-11-23): the app is called "Open MTG Arena" on screen too; online multiplayer, its servers,
  the lobby, peer-to-peer and Supabase cloud sync are removed (offline only: the AI, the LLM opponent, the RPG); the
  Tauri desktop app and its updater are removed (the web app installs as a PWA).
- The owner (2026-11-23): their art and audio without a recorded source (the battlefields, most music and sound
  effects) are kept as part of the MIT/Apache code we copy, the Kevin MacLeod tracks credited (CC-BY), the unknown
  sources noted, revisited if anyone objects ("Keep, credit what we can"). And the copyright line and NOTICE stay in
  the license files ("Yes, keep it in the license files"); nothing in the app names them.

**D-178: Next: a playable build, then port the engine from Rust to Odin; the LLM opponent and the RPG wait (owner, 2026-11-23)** · 2026-11-23 · accepted
- The owner: "Honestly, once everything checks out let's just say yolo and plan out the rust to odin rewrite", then
  "We can hold off on the LLM opponent and single player RPG/roguelike for now. I just want to be able to play this
  build and then iterate safely on porting this from rust to Odin as efficiently and quickly as possible".
- Order: finish the import (D-177) to a build the owner can play on the live site; then the Rust to Odin port, as
  its own milestones, planned first and approved by the owner, done safely (every ported piece checked against the
  Rust engine on the same games) and quickly. The LLM opponent and the single-player RPG or roguelike are on hold.
- The owner (2026-11-24), on hearing the AI had no 60-card decks once the scraped feeds went: "Then can we get the
  scraped tournament decks back?" So the eight metagame deck files (MTGGoldfish Standard, Pioneer, Modern, Legacy,
  Vintage, Pauper, Commander; TopDeck.gg cEDH) come back as they were at import: static snapshots bundled with the
  app, which no longer refresh (the scraper and its daily job stay removed). The starter decks' feed gets back its
  original "no format" (the strip had labelled it Standard, which they aren't legal in).


**D-179: The Odin port's shape: the parser stays Rust, the RNG stays bit-exact, the AI comes later (owner, 2026-11-24)** · 2026-11-24 · accepted
- Plan: docs/odin-port.md. Survey: the engine runs the parsed card AST shipped in `card-data.json` (it never parses
  Oracle text in play), and the client talks to the engine only in JSON. So an Odin engine reads the same card data
  and speaks the same JSON behind the client's worker. Safety: the Rust engine records games and test runs (actions
  plus a normalized checkpoint after each), and Odin must reproduce them. Speed: slices by mechanic, measured by the
  share of cards Odin can fully play; Odin runs in shadow mode beside Rust before any game switches to it.
- The owner, on the plan's questions: "yes to 1 and 2, port the AI later". So:
  1. The Rust card-text parser (`phase-parser`, `oracle-gen`) stays, as an offline build tool producing
     `card-data.json`; only the engine is ported. Porting the parser is a separate decision at the end.
  2. The RNG is reproduced bit for bit (ChaCha20 seeded from a u64, and rand 0.9's `shuffle`, `random_range`,
     `choose`, `random_bool`), so seeds, recordings and saved replays carry over between the engines.
  3. The existing AI is ported later, after the engine slices it depends on; until then Odin-run games use a simple
     stand-in or stay in shadow mode.
- Not yet answered: how often the owner play-checks a slice. Default until then: whenever a slice changes what a
  player can see or play.

**D-180: The goal: no Rust left in the engine, near-zero regressions (owner, 2026-11-24)** · 2026-11-24 · accepted
- The owner set the session goal: "continue with the Odin port - the goal is to remove all rust code from the engine
  and replace it with Odin with near zero regressions in functionality and performance".
- So the port runs to completion, not just its first milestones: the engine, its AST types and the AI end up in Odin,
  the Rust crates are removed, and every step is held to the recordings (functionality) and to measured speed against
  the Rust engine (performance: game actions, AI move time, card-data load, wasm size).
- D-179's "the parser stays Rust" was about order: the card-text parser is a build tool, not the engine, and stays
  Rust until the engine is done; whether it is ported too is decided then.

**D-181: The Odin data model: wire forms, today's save format only (2026-11-24)** · 2026-11-24 · accepted
- Where a Rust type keeps a runtime form and converts to a separate wire form (`serde(from/into)`), the Odin model
  holds what the engine needs and the codec writes Rust's wire form exactly. ManaPool is modeled as its wire form,
  the units in pool order (Rust's shape-and-slot index is a speed cache over it; pools are a handful of units, and the
  ported logic works on the list). ResolvedRulesJournal keeps Rust's fields and rebuilds its runtime index in logic.
- Types whose `from` conversion also accepts older save formats (ObjectIncarnationRef, PhaseStop, TriggerCause and six
  more, plus `deserialize_with` adapters marked compat) are read in today's form only. Consequence: a save written by
  an older Rust build that still uses a legacy form won't load in the Odin engine, where the Rust engine would migrate
  it. Saves written by the current build load. If old saves matter at the switch, their migrations are ported then.
- Fields Rust writes but never reads (`skip_deserializing`, 13 names in WRITE_ONLY_FIELDS) aren't read by the Odin
  model either; the ported logic derives them, as Rust does.
- Why: one exact wire format keeps the Rust and Odin engines comparable step by step (D-179's recordings) without
  porting a decade of save migrations up front.

**D-182: The Odin ObjectMap iterates in the Rust engine's order (2026-11-24)** · 2026-11-24 · accepted
- Found by experiment: the order of `GameState.objects` is observable. With ObjectMap's FxBuildHasher swapped for
  a random one, an elves-mirror recording diverged at step 111 (`last_zone_changed_ids` [23, 24] vs [24, 23]),
  where an effect moved several objects in map order. (Three other matchups didn't diverge.) Control: all 32 duel
  matchups recorded twice with the unmodified recorder are byte-identical, so the randomly seeded maps elsewhere
  don't reach the recordings and the divergence is ObjectMap's.
- That order is a pure function of the ids: `im::HashMap` (15.1) walks its hash trie by the key hash's 5-bit
  chunks from the lowest, and the hash of `ObjectId(i)` is rustc-hash 2.1's FxHash, `((i * K) rotl 26)` truncated
  to u32 (K = 0xf1357aea2e62a9c5). Sorting ids by those chunks reproduces im's order exactly, also after removals
  (checked against the real crates over 400 ids with removals and large ids).
- So the Odin ObjectMap keeps its objects in that order, with no change to the Rust engine and no re-recording.
  The alternative, switching Rust to an ordered map, would re-record everything and risk speed in its hottest
  lookup.
- It is the 64-bit order. The shipped browser build (wasm32) hashes with the 32-bit FxHash constants, so today's
  browser game already iterates differently from native runs; both are arbitrary tie orders. The Odin engine uses
  the 64-bit order everywhere, so it matches the native recordings it is checked against.
- Consequence for O-2's shadow mode in the browser (Odin beside the shipped wasm Rust): the two would differ on
  ties by construction. So the order is a parameter of the Odin ObjectMap (64-bit for recordings; the 32-bit FxHash,
  K = 0x93d765dd, write_u64 as two words, rotl 15, for the browser), and the 32-bit formula is checked against a
  wasm32 build of the same test before shadow mode relies on it. Until then, shadow comparison runs natively only.
- Not covered: two ids with equal 32-bit hashes (im keeps them in a collision node, in insertion order); none
  exist below 2^32 ids in practice, but the Odin map asserts it.

**D-183: Runtime card-text parses move into the card data (owner, 2026-11-24)** · 2026-11-24 · accepted
- The Rust engine parses card text during play: tokens' rules text (`catalog_rules_text_abilities`,
  game/effects/token.rs) and parser helpers used by triggers, layers and combat. So D-179's "the parser stays Rust,
  as a build tool" didn't hold as the code stands.
- Owner (2026-11-24, "yes" to the recommendation): precompute every parse the engine does at runtime into the card
  data at build time (oracle-gen), so the Odin engine never parses. Rejected: porting the parser (~174k lines) and
  keeping a small Rust parser beside the Odin engine (against D-180).
- First step: a census of the runtime parse calls (which texts reach them in play), then their results keyed in the
  card data. The Rust engine is changed the same way first, so the recordings stay the reference.

**D-184: Fix the saved-game "type" clash, changing its wire form (owner, 2026-11-24)** · 2026-11-24 · accepted
- `TargetEffectDetail::Modification(..)` (an internally tagged enum inside another with the same tag) serializes
  `"type"` twice, so a state paused on a P/T-pump target prompt doesn't survive the client's `JSON.parse`
  (docs/status.md, Known issues). Owner (2026-11-24): fix it, accepting the wire-format change.
- The fix renames one of the two tags (or adjacently tags the inner enum), with a migration that reads the old form
  in Rust's save loading, a test that a paused P/T-pump state round-trips through `serde_json::Value`, and the Odin
  model regenerated (D-181: the model reads only today's form).
- Done (2026-11-24): PtDirection's tag is `direction` (`{"type":"Modification","direction":"Increase"}`). The
  migration reads what saved games hold: the client stored states after `JSON.parse`, so an old pump slot reads
  `{"type":"Increase"}`, which a wire enum behind `serde(from)` maps to `Modification(Increase)`. odingen ignores
  `from` (it generates codecs for the written form). Test: `paused_pump_target_prompt_round_trips_through_json_values`.


**D-185: Parallel sessions for the Odin port's independent streams (owner, 2026-11-24)** · 2026-11-24 · accepted
- Owner (2026-11-24), asked whether the port could be parallelized: "yeah, start those sibling sessions if you
  think they're worthwhile".
- The translator (odingen's translate.rs/body.rs) stays in the main session: its fixes interact, and one 15 GB
  container fits one patched-engine build at a time. Separate cloud sessions, each with its own container and branch,
  take the streams that touch other files:
  1. D-183: the census of runtime card-text parse calls, then moving them into the card data (Rust engine side).
  2. Odin performance: the state layout and copy speed (Odin's copies measured 4-8x Rust's), with a benchmark.
  3. O-2: the replay harness that steps a recorded game through the translated engine and reports the first
     untranslated or differing step.
- Each opens its own pull request and merges on green CI (D-027), merging main first. The main session reviews
  their reports and keeps docs/status.md current.

**D-187: A new Odin engine from the rules, behind the client's existing interface; Rust kept only as a test
reference (owner, 2026-11-24)** · 2026-11-24 · accepted
- Replaces the Rust-to-Odin translation of D-180 (paused 2026-11-24; its translator stays on the branch, unused).
  (D-186 is taken on the D-183 session's branch, so this is D-187.)
- Why: the owner's end goal is "a clean and modern mtg client that I can customize via Claude code whenever I
  want" with "blazing fast iteration". A translation keeps the Rust engine's size and convolution; a new engine
  written from the CR can be small, clean, and rebuild in seconds.
- Shape: the Odin engine compiles to WebAssembly and exports the same functions the client calls today (94 engine,
  39 draft; JSON in and out), so the client doesn't change. It reuses the Odin data model and codecs (states and
  actions in the Rust wire form), the bit-exact RNG, and the parsed card data the Rust parser produces.
- No dual engine (owner): the app switches from Rust to Odin once; until then it runs on Rust.
- The Rust engine's value is its tests (owner): its integration tests and recorded AI games are captured as
  language-neutral test files (starting state, actions, the game-relevant result), and the Odin engine must pass
  them. Comparisons look at what matters in the game, not Rust's internal bookkeeping.
- The card pool that matters: Scryfall `game:arena in:paper` (15,772 cards; the Rust engine plays 14,013).
- State model (2026-11-24): the Odin engine holds the game in the generated data model (`odin/engine/types`), the
  client's wire form, so the client, the captured tests' states and the parsed cards need no mapping in or out. The
  rules logic is new, written from the CR; the types only give it its shape. Checked: the Rust engine's state after
  `initialize_game` decodes and re-encodes equal (3 ms and 2 ms natively), apart from `wire_projection`, which only
  the export adds, and the fields the engine derives (`WRITE_ONLY_FIELDS`), which the Odin engine computes as it
  grows. Game state gets its own allocator, as the card database has, outliving each call's scratch arena.
