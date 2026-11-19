# Status

Living document. Update it at the end of every task: what changed, what's next, and anything the
next session needs to know. Keep it short. Move finished detail into commit messages.

**Current milestone:** M1 — Engine foundations (`milestones/m1-engine-foundations.md`)
**Rules version:** see `rules/VERSION.json`

## In progress
- M1-05 Game start. Plan:
  - `createGame(setup, cards)` validates the setup (`invalidSetup`: unknown cards, duplicate ids, not exactly two
    players since multiplayer rules such as CR 103.5c and 103.8c aren't built, a hand in a `standard` opening, a `fixed`
    step that needs combat state or gives no priority) and creates one object per card (CR 400.7 ids).
  - Standard opening, all as decisions answered through `applyAction`:
    1. CR 103.1: `firstPlayer`, or a player picked at random from the seed chooses who takes the first turn
       (`chooseStartingPlayer`). Turn order then starts with the starting player and follows seating order.
    2. CR 103.3: each library is shuffled (Fisher–Yates over `randomInt`). CR 103.5: each player draws 7.
    3. CR 103.5 mulligans, in rounds: each player who hasn't kept declares keep or mulligan, in turn order. Then everyone
       who chose mulligan does so at once: hand shuffled into library, 7 drawn, then N cards put on the bottom, where N
       is how many mulligans they've taken (one `mulliganBottom` decision per card, which also sets the order). No more
       mulligans once the hand would be zero cards.
    4. CR 103.8: turn 1 begins with the starting player. Until M1-06 walks the steps, the game goes straight to turn 1's
       upkeep with the starting player holding priority. Skipping the first draw (CR 103.8a) is M1-06's.
  - Fixed opening: zones exactly as given, the step's turn-based actions count as done, the active player has priority.
  - State: `turn` is null before the first turn; mulligan bookkeeping lives in `pregame` (null once the game starts).
    Zone changes all go through one `moveObject` function (the future replacement/trigger pipeline plugs in there).
  - Tests (TypeScript until the M1-16 scenario runner, then ported to YAML): keep, mulligan and bottom, two rounds,
    the zero-card limit, the random chooser, setup validation, determinism with a fixed seed, stale or wrong-player answers.
  - Future impact: turn order is a list rotated to the starting player; nothing assumes "the opponent". Draws and
    shuffles emit events. `moveObject` is the single place a replacement or trigger check is added later.

## Handoff notes
Anything the next session (or the session after a compaction) needs to pick up the current task:
the plan, what's done so far, what's tricky, what was about to happen next.
- Claude Code on the web: the cloud environment "open-mtg-arena" allows `magic.wizards.com` and `media.wizards.com`.
  Node's `fetch` there only uses the proxy with `NODE_USE_ENV_PROXY=1`, for example
  `NODE_USE_ENV_PROXY=1 node scripts/fetch-rules.mjs`.
- Local setup: Node 26 (`.nvmrc`) and pnpm 10.34.9 (`packageManager`). The "open-mtg-arena" environment's setup
  script installs both into `/opt/node26` and runs `pnpm install`. Shells there start on an older Node, so run
  `export PATH=/opt/node26/bin:$PATH` before `pnpm` commands.
- `pnpm check` is typecheck + lint + tests for now. Its other parts in `docs/testing.md` join as they're built:
  golden games and the coverage check (M1-19), a short fuzz (M1-18).
- For M1-05 (game start), decide in its plan: what `GameState.turn` says before turn 1 (it's required, and `Step` has no
  pregame value: make it `Turn | null` or add a marker), where mulligan bookkeeping lives before `work` exists (M1-07),
  and validation of `fixed` openings (reject steps with no priority or that need combat state). CR 103.1: a random
  player chooses who goes first, as a decision.
- Scenarios the M1-04 rules review asked for, to write in the task that implements each rule:
  M1-08: a Mountain taps for {R} without using the stack (CR 305.6, 605.3b); Llanowar Elves is a mana ability (CR 605.1a)
  and can't be activated while summoning sick (CR 302.6). Also compute mana value from the cost (CR 202.3) and check it
  equals Scryfall's `manaValue` for every pool card. M1-09: Lightning Bolt can't target a land, can target your own
  creature and yourself (CR 115.4); Giant Growth can't target a player (CR 109.2). M1-11: Giant Growth wears off in
  cleanup (CR 514.2). M1-14: firebreathing uses the stack (CR 602.2), stacks three times (CR 613.4c), and resolves after
  the Whelp dies without affecting anything (CR 113.7a, 400.7, 611.2c).
- For M1-08 or M1-13, a settled CR 302.6 edge case to write as a scenario: a creature that entered on its controller's
  last turn is still summoning sick on the opponent's turn (Llanowar Elves can't tap for mana there), and isn't on
  its controller's next turn.
- For M1-14: an ability whose source is gone still resolves (CR 113.7a) and uses last known information (CR 608.2h),
  which needs a store in `GameState` (`future-rules.md`).
- When M2 adds `apps/web`: add `apps/*` to `pnpm-workspace.yaml`, the Vitest projects and the tsconfig include.
- The engine's step names follow the CR (`precombatMain`, `declareBlockers`, see `engine/src/state/turn.ts`).
  `testing.md`'s scenario YAML uses short names (`main1`, `combat.declareBlockers`); the M1-16 runner maps them.
- When M1-16 lands the scenario runner, drop `--passWithNoTests` from `test:scenarios`, so a misplaced runner fails.
- `main` was created from `claude/eloquent-mayer-qcx0e1` at the owner's request and is now the default branch
  (2026-11-19). From now on, work reaches `main` only through pull requests.
- The "open-mtg-arena" environment also allows Scryfall (`api.scryfall.com`, `data.scryfall.io`). `pnpm cards:fetch`
  passes `--use-env-proxy` itself, so it works behind the proxy with no environment variable.

## Next up
- M1-05 Game start

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

## Open questions for the owner
- (none)

## Known issues
- (none)
