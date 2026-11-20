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

**D-047: Golden games** · 2026-11-19 · accepted
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
  Every member is replaced against the state before the batch (CR 614.4, built with M2-08), then all are performed,
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
