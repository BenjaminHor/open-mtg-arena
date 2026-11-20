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
- M2-03 The event pipeline: built, in review (PR #23, D-056). `engine/src/pipeline/`: every game event is a
  `ProposedEvent` carried out by `happen` (replace, perform, check triggers). Each event changes one object or player
  and is performed whole; events at the same time are one `simultaneous` event (state-based actions, untap step,
  attackers tapping, cleanup discard, a mulligan's hand); all replacing comes before any performing, so M2-08 can
  pause for a choice. Only `perform.ts` imports the primitives (`test/pipeline/only-the-pipeline-performs.test.ts`).
  Reworked after the first reviews (rules-judge and code-reviewer both found batches replaced one member at a time and
  continuations that couldn't pause). Golden games and replays unchanged, bench within budget, fuzz clean. Last known
  information is deferred to its first reader (future-rules.md, "Triggered abilities").
- Next: M2-04 Targeting and costs with context.

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
- (Not blocking.) CR 404.3 lets a player choose the order of their cards that go to the graveyard at the same time
  (creatures dying together, a cleanup discard). The engine uses battlefield (or hand) order and doesn't ask, as Arena
  doesn't; nothing in the M1 pool cares about graveyard order (D-039). Should the app ever ask, once cards that care
  about graveyard order arrive?

## Known issues
- (none)
