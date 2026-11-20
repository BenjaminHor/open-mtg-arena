# Status

Living document. Update it at the end of every task: what changed, what's next, and anything the
next session needs to know. Keep it short. Move finished detail into commit messages.

**Current milestone:** M2 — Rules depth (`milestones/m2-rules-depth.md`)
**Rules version:** see `rules/VERSION.json`

## In progress
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
    - Cards: the 19 in the spec, plus Ornithopter and Rod of Ruin (artifacts to target). Enchantments aren't in the pool
      until M2-07: the enchantment half of Naturalize, Solemn Offering and Tempest of Light is unit-tested until then.
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
      - Shared (built in b2a): an effect that needs choices stops with a `chooseCards` decision and, on each answer,
        is queued again in front of the rest of the resolution (`queueWork`) with the choices so far, as
        `discardToHandSize` does; nothing happens until every answer is in (CR 608.2d), and answers emit no events.
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
      - M2-05b2a, choices from a hand: Mind Rot (`discard`: the player discards N of their choice, CR 701.9a-b; a
        smaller hand whole, CR 609.3), Merfolk Looter (draw, then discard, nothing between: CR 608.2g and its ruling;
        CR 704.5b with an empty library), Duress (`target opponent`: a player target with an opponent restriction,
        relative to the controller, checked on choosing and resolving, CR 115.1a, 115.2, 102.2, later: CR 102.3;
        `revealHand` as its own effect, CR 701.20a-b; then `discard` chosen by "you" from the cards fitting
        "noncreature, nonland", mandatory if any fits, nothing if none, CR 608.2d, 609.3), Elvish Piper
        (`putOntoBattlefield` from hand, min 0; under the activator's control, CR 110.2a, 109.5; not cast; summoning
        sick, CR 302.6; resolves with its source gone, CR 113.7a).
      - M2-05b2b, libraries: an `ObjectFilter` supertype (basic, CR 205.4a) first. Search, move and shuffle are
        separate steps passing a "found" result (CR 608.2c "this way"; Liliana Vess will need CR 701.24b), kept with
        the resolving object until it finishes. Search: look at the whole zone (CR 701.23a); a stated quality may find
        none (CR 701.23b), "a card" must be found if there's one (CR 701.23d); not revealed unless the card says so
        (CR 701.23e). Fabricate, Diabolic Tutor, Rampant Growth and Terramorphic Expanse ("onto the battlefield
        tapped": enters tapped as part of the move, CR 110.5b, so "becomes tapped" doesn't trigger, CR 603.2e; not a
        land play, CR 305.4; "Sacrifice this land" as a cost part after {T}, CR 602.2, D-059; not a mana ability,
        CR 605.1a). Ponder (look at the top three, CR 701.20e, put back in any order, CR 401.4, later: CR 701.20d;
        "you may shuffle" yes/no; draw). Haunting Echoes (exile all but basic lands from the target's graveyard,
        CR 406.3; one search for all those names, CR 701.23h, 201.2a, any number, its ruling; exile them; the target
        shuffles): waits on the owner's answer in Open questions when nothing is exiled.
      - Future impact: "whenever a player discards / searches / shuffles" (M2-07) read these events; a replacement on
        a discard or move (M2-08) sees one event per instruction, the choices made; Telepathy and multiplayer reveals
        need revealed cards in the view, not only an event (CR 701.20a); several searchers at once (CR 701.23i), "may
        search" (CR 701.23g) and searching another player's library (Sphinx Ambassador) fit the same steps.

## Handoff notes
- After merging a PR, restart the branch with `git checkout -B <branch> origin/main` and then push with
  `git push -u origin <branch>`: `checkout -B` from `origin/main` makes `main` the upstream, and a plain `git push`
  then fails (it did once; nothing reached `main`).
- Commit only when `pnpm check` exits 0: run it into a log file, use its exit code, never pipe its output through
  `grep` (a red commit went in that way). Edit scripts must fail loudly when a replacement doesn't match.
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
- After the owner tags `m1`: M2 rules depth (`docs/milestones/m2-rules-depth.md`), starting with M2-01 (the
  hidden-information fix) and M2-02 (the Magic 2010 pool and its mechanics map).

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

## Open questions for the owner
- (Blocks only M2-05b2b's Haunting Echoes.) Haunting Echoes: "Exile all cards from target player's graveyard other
  than basic land cards. For each card exiled this way, search that player's library for all cards with the same
  name as that card and exile them. Then that player shuffles." If the graveyard has nothing to exile, does the caster
  still search (look through) the target's library? Reading "for each card exiled this way" literally, zero cards
  means zero searches. CR 701.23c's Lobotomy example points the other way: with nothing to match, the player
  "searches the specified zones but doesn't exile any cards". The CR doesn't settle it for this wording. It decides
  whether the caster gets to see the library, and later whether "whenever a player searches" triggers. The shuffle
  happens either way.
- (Not blocking yet.) Is losing 0 life an event? The CR says gaining 0 life isn't (CR 119.9, 119.10) but says nothing
  about losing 0. Today `loseLife` proposes any amount, so losing 0 would emit `LIFE_LOST` of 0; no pool card can do
  that yet. Needed before "whenever a player loses life" triggers (M2-07) or a card that loses X life
  (docs/future-rules.md).
- (Not blocking.) CR 404.3 lets a player choose the order of their cards that go to the graveyard at the same time
  (creatures dying together, a cleanup discard). The engine uses battlefield (or hand) order and doesn't ask, as Arena
  doesn't; nothing in the M1 pool cares about graveyard order (D-039). Should the app ever ask, once cards that care
  about graveyard order arrive?

## Known issues
- Golden games grow by about 2 MB per M2 task (each is a full random game, 300–400 KB as JSON, and every pool card
  must appear in one). Before the pool reaches all 234 cards, make them smaller: a compact action format, shorter
  games, or targeted games per card. Not blocking yet.
- `pnpm fuzz --games 300` takes about 7–8 minutes (it was 2–3 in M1). Profiled (2026-11-20): the engine isn't slower
  (a bare game takes 100–200 ms; the bench is within its baseline). The time is the checks after every action, about
  19 times the games themselves: the leak check (`scrambleHidden` and comparing whole views, ~60%) and the legal-action
  check, times long random games (~45 turns, ~28 priority passes a turn). The fuzzer's picker by kind (D-061) cut it
  by about a fifth. Further cuts would weaken the checks (run the leak check on fewer actions); not worth it yet.
