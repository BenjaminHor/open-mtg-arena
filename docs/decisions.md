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
  trigger steps of the event pipeline will plug in.
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
  are rejected until M1-14.
- Which mana pays a cost is the player's choice (CR 601.2h), so a payment is data: how much of each mana type to spend.
  `payFromPool` checks it all or nothing (colored symbols need their color, generic takes any, no partial payment).
- `autoPay(state, player, cost, cards)` proposes a payment: mana abilities to activate, then the payment. It uses pool
  mana first, then lands before creatures, each in battlefield order, and pays colored symbols before generic. With
  sources that each make one color (all M1 cards), that finds a payment whenever one exists (a brute-force test checks
  every small board); sources with a choice of colors will need a search. The scenario runner (`pay: auto`), the CLI and
  the AI use it. The engine exports it with `payFromPool`, `manaValue`, `abilitiesOf` and `isManaAbility` (D-023).
- Activation is split in three (`mana/activate.ts`): `activationProblem` (checks any activated ability needs: zone,
  controller, payable costs), `manaAbilityProblem` (that, plus it's a mana ability whose effects are all supported), and
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
  `CAST_CANCELLED` carries `{ player, cardId, spell, restored, untapped }` so the UI can animate the undo. CR 734.1
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
  CR 510.2). Prevention and replacement (CR 614–615), lifelink, infect and wither (CR 120.3) plug in there. Life loss
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

