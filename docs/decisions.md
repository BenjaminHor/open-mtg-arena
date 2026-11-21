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

**D-015: Private repo, no open-source license; Cloudflare Pages for hosting** · 2026-11-19 · accepted
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
  chosen, though the same totals can be dealt to the player (later: CR 510.1e, checking the whole assignment at once).
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
  ability's controller. `NAME_CHOSEN` tells everyone (CR 101.4b), its object the resolving ability.
- "A creature card that doesn't have that name" is the filter `notNamedThisWay`, read in `matchesFilter` against the
  card's name through `characteristics` (the layer pass holds no name). `put`'s `onlyIf` and `optional` do the rest:
  "you may put it onto the battlefield under your control" (CR 110.2a).
- The search's found card stays hidden from the player naming (its ruling): it stays in their library, which they
  can't see, and `Resolution.found` isn't in any view (a test checks the naming player's view).
