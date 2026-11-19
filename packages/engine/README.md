# @mtg/engine

The Magic rules engine: a pure, deterministic reducer. `applyAction(state, action) -> { state, events }`.
No I/O, no clock, no `Math.random`, no UI. It depends on nothing else in this repo; card definitions come in as data.

The design and its invariants are in [`docs/architecture.md`](../../docs/architecture.md).

## Entry points

- `src/index.ts`: the whole public API (`createGame`, `applyAction`, `legalActions`, `playerView`,
  `characteristics`, as listed in the architecture doc). Today it only exports `ENGINE_VERSION`; M1-03 onward fills it in.

## Tests

- `test/**/*.test.ts`: unit tests for small helpers.
- `test/scenarios/<area>/*.yaml`: scenario tests, the real spec for rules behavior (format in
  [`docs/testing.md`](../../docs/testing.md)). The scenario runner arrives in M1-16.

```sh
pnpm test             # everything
pnpm test:scenarios   # scenarios only
```
