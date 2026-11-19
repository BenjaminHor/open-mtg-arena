# @mtg/scenarios

The scenario runner (docs/testing.md, section 1; D-033). A scenario is a small YAML file: a board, steps, expectations.
The runner builds the game, takes each step through the engine's own `legalActions()`, checks each expectation, and
checks every state against the engine's invariants.

## Entry points

- `runScenario(yamlText, cards)`: returns `{ name, problems }`; no problems means it passed. No file I/O.
- `invariantProblems(state, cards)`: everything wrong with a state (also for the fuzzer, M1-18).
- `src/format.ts` (reading the file), `setup.ts` (the `setup:` block), `steps.ts` (steps to actions), `all-pass.ts` (`all pass`), `combat-steps.ts` (`attack`, `block`, `assign`), `apply.ts` (taking one legal action), `lookups.ts`
  (what a step names), `expect.ts`
  (expectations), `names.ts` (step and card names).

## Tests

`pnpm test:scenarios` runs every scenario in `packages/engine/test/scenarios/` (`test/scenarios.test.ts`).
`test/runner.test.ts` checks the runner fails bad scenarios, and that `docs/testing.md` documents every word it knows.
