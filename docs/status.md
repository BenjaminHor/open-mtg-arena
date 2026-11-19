# Status

Living document. Update it at the end of every task: what changed, what's next, and anything the
next session needs to know. Keep it short. Move finished detail into commit messages.

**Current milestone:** M1 — Engine foundations (`milestones/m1-engine-foundations.md`)
**Rules version:** see `rules/VERSION.json`

## In progress
- M1-03 Core types and state. Plan:
  - `engine/src/state/`: ids (`o1`, `c1`, `p1`, `d1` as distinct template-literal types, CR 400.7), mana (CR 106),
    zones (CR 400.1; library index 0 is the top, the stack's last entry is the top, CR 405.2), objects (cards and
    abilities on the stack; casting choices stored on the stack object), players, turn and steps (CR 500–514 names),
    setup (standard or fixed start, preset zones, rule modifiers), decisions (`priority`, `mulligan`), actions, events,
    results and errors, and `GameState`. A README for the folder.
  - `engine/src/rng/`: xoshiro128** seeded by SplitMix64, `nextUint32` and an unbiased `randomInt`, pure (they return
    `{ value, rng }`). Known-answer tests use rand_xoshiro 0.6.0's vectors (from Vigna's reference C code).
  - Tests: type-level (`ObjectId` vs `CardId`, exhaustive unions), a JSON round-trip of a realistic state with a
    plain-JSON checker, and the RNG known answers, range and determinism.
  - Future impact: the controller is stored only as the CR 110.2 default and read through `characteristics()` (layer 2,
    M3). Objects point at card data by `oracleId`, so faces and copies can change the source later. Stack objects aren't
    assumed to be cards (abilities, copies). Turn order is a list, never "the opponent". Rule modifiers are shaped as
    continuous effects owned by no card, applied from M1-11. The setup expresses every scenario `setup:` block, so the
    M1-16 runner builds games only through `createGame`.

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
- When M2 adds `apps/web`: add `apps/*` to `pnpm-workspace.yaml`, the Vitest projects and the tsconfig include.
- The engine's step names follow the CR (`precombatMain`, `declareBlockers`, see `engine/src/state/turn.ts`).
  `testing.md`'s scenario YAML uses short names (`main1`, `combat.declareBlockers`); the M1-16 runner maps them.
- When M1-16 lands the scenario runner, drop `--passWithNoTests` from `test:scenarios`, so a misplaced runner fails.
- `main` was created from `claude/eloquent-mayer-qcx0e1` at the owner's request and is now the default branch
  (2026-11-19). From now on, work reaches `main` only through pull requests.
- The owner approved allowing Scryfall's hosts (`api.scryfall.com`, `data.scryfall.io`) in the "open-mtg-arena" environment for M1-04.

## Next up
- M1-03 Core types and state

## Done
- Starter docs, Claude Code config and rules scripts added (2026-11-19).
- M1-02 Rules files: `rules/` generated from the CR effective November 6, 2026 (148 sections, 744 glossary terms);
  `rule.mjs 601.2` spot-checked; 702 split into one file per keyword (2026-11-19).
- M1-01 Scaffold the monorepo: pnpm workspaces (`engine`, `cards`, `cli`, `ai`), strict TypeScript 7 with no build
  step (D-018), Vitest 5 with `unit`/`scenarios` projects, Biome 2, GitHub Actions running `pnpm check`,
  `pnpm cli --help`, and a `pnpm fuzz` stub (D-017) (2026-11-19).

## Open questions for the owner
- (none)

## Known issues
- (none)
