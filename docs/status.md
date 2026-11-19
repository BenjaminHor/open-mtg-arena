# Status

Living document. Update it at the end of every task: what changed, what's next, and anything the
next session needs to know. Keep it short. Move finished detail into commit messages.

**Current milestone:** M1 — Engine foundations (`milestones/m1-engine-foundations.md`)
**Rules version:** see `rules/VERSION.json`

## In progress
- M1-06 Turn structure. Plan:
  - The turn sequence is data: `TURN_STEPS` lists the steps in order (CR 500.1, 501.1, 506.1, 512.1), and one function
    walks it, so extra turns, phases and steps can be queued later (future-rules.md).
  - Each step, as it begins, does its turn-based actions, then gives the active player priority (CR 117.3a):
    untap (CR 502.3: the active player's permanents untap; they're now controlled since the turn began, CR 302.6; no
    priority, CR 502.4); upkeep (CR 503.1); draw (CR 504.1: the active player draws). The starting player skips the draw step of
    turn 1 entirely (CR 103.8a): a skipped step is passed over as though it didn't exist (CR 500.11, 614.10a), so it
    has no draw and no priority; main phases (CR 505.6); beginning of combat (CR 507.2); declare attackers (CR 508: no attacks until M1-13,
    so none are declared and the declare blockers and combat damage steps are skipped, CR 508.8); end of combat (CR 511.1);
    end (CR 513.1); cleanup (CR 514.1: discard down to seven, one `discardToHandSize` decision per card; CR 514.2: damage
    is removed; no priority, CR 514.3). Then the next player in turn order begins their turn.
  - Mana empties as each step and phase ends (CR 500.5; the spec's "500.4" is a mis-cite, fixed under D-020).
  - Minimal priority passing, so steps can advance: `PASS_PRIORITY` gives the next player in turn order priority (CR 117.3d);
    when all players have passed in succession with the stack empty, the step ends (CR 117.4, 500.2). M1-07 adds the stack,
    resolving, and the work queue.
  - Drawing from an empty library sets the fact CR 704.5b reads (`attemptedDrawFromEmptyLibrary`) instead of throwing;
    the loss itself arrives with state-based actions in M1-12.
  - Replaces M1-05's first-turn shortcut. `landsPlayedThisTurn` resets as a turn begins.
  - Tests: a full turn walk checking every step and what happens in it; turn 1 has no draw, turn 2 does; the combat skip;
    mana emptying; cleanup discard (and its decision) and damage removal; untap only for the active player; two full turns.
  - Future impact: steps are data (extra turns, phases, first-strike damage step later); every step change goes through one
    function where "until end of step" effects and triggers will hook in; nothing assumes two players (next player = next in
    `turnOrder`).

## Handoff notes
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
- `pnpm check` is typecheck + lint + tests for now. Its other parts in `docs/testing.md` join as they're built:
  golden games and the coverage check (M1-19), a short fuzz (M1-18).
- M1-05's tests are TypeScript (`packages/engine/test/game/start.test.ts`). When the M1-16 scenario runner exists, port
  them to YAML scenarios (`scenarios/start/`), keeping the same cases.
- For M1-06: replace `beginFirstTurn`'s shortcut (untap, then straight to upkeep) with the real step walk, including the
  starting player skipping their first draw (CR 103.8a; decide it by turn number 1, not `turnOrder[0]`). The untap step
  must ask `controllerOf`, not object fields. `drawCard` throws on an empty library until M1-12, so either record the
  "drew from an empty library" fact CR 704.5b needs, or keep M1-06's tests away from empty libraries.
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
- M1-06 Turn structure

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

## Open questions for the owner
- (none)

## Known issues
- (none)
