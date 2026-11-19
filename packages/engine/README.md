# @mtg/engine

The Magic rules engine: a pure, deterministic reducer. `applyAction(state, action) -> { state, events }`.
No I/O, no clock, no `Math.random`, no UI. It depends on nothing else in this repo; card definitions come in as data.

The design and its invariants are in [`docs/architecture.md`](../../docs/architecture.md).

## Entry points

- `src/index.ts`: the whole public API (`createGame`, `applyAction`, `legalActions`, `playerView`, `characteristics`, as
  listed in the architecture doc). So far: `createGame`, `applyAction`, `legalActions`, `characteristics`, `ENGINE_VERSION`, the state and
  card types, `controllerOf`, `abilitiesOf`, `isManaAbility`, `autoPay`, `payFromPool`, `allPayments` and `manaValue`.
- Folders: `state/` (types), `game/` (the flow of a game), `effects/` (the effects interpreter: damage, mana,
  continuous effects), `zones/` (moving cards), `permanents/` (tapping, untapping, damage, destroying), `mana/` (mana abilities,
  paying), `combat/`, `rules/` (rules questions such as who controls an object), `cards/` (card data types), `rng/`.

## Tests

- `test/**/*.test.ts`: unit tests for small helpers.
- `test/scenarios/<area>/*.yaml`: scenario tests, the real spec for rules behavior (format in
  [`docs/testing.md`](../../docs/testing.md)), run by `packages/scenarios`.

```sh
pnpm test             # everything
pnpm test:scenarios   # scenarios only
```
