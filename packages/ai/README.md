# @mtg/ai

The computer players. They see only what a player may see (D-062, D-137) and choose among the legal actions.
Depends only on `@mtg/engine` (its tests also use `@mtg/cards`). See "AI" in [`docs/architecture.md`](../../docs/architecture.md).

## Entry points

- `src/agents.ts`: the simple agents, which test the rules rather than play well: `first-legal`, `random` and
  `by-kind` (`chooseAction`). Each takes the legal actions and a random state, and gives an action and the next random
  state. The CLI's `ai` and `auto`, the fuzzer, the golden games and the match host's test seats use them.
- `src/pick-action.ts`: the `by-kind` picker (D-061): a kind of action first, then one of that kind.
- `src/seeded-random.ts`: `nextRandom`, the tiny seeded generator they share, so one seed is one game.
- `src/heuristic/`: the heuristic AI v0 (M3-02), `heuristicAction(shown, cards)`, from the engine's `seatView` only
  (D-144), stateless and without randomness. `heuristic.ts` picks the chooser for each decision kind (an exhaustive
  switch); `priority.ts` (land, then the spell or ability worth most, only what's strictly payable), `lands.ts`,
  `combat.ts` (attacks and blocks, a whole declaration planned at once), `opening.ts` (mulligan, bottom, discard),
  `choices.ts` (targets, X, division, cards, names...), `intents.ts` (what an effect does to each target, read from
  the card's definition), `effect-value.ts` (what untargeted effects are worth), `targets.ts` (what a target is worth), `board.ts` (reading the table, what a permanent is
  worth). The worths are guesses tuned with `pnpm eval`.

## Tests

`test/heuristic.test.ts`: the heuristic's choices on hand-made tables. How well it plays whole games: `pnpm eval`
(D-145), and ten fixed games per deck in the CLI's `test/eval.test.ts`; `packages/match/test/heuristic-seat.test.ts`
plays it through the host. The CLI's `test/agents.test.ts` and `test/fuzz.test.ts` exercise the simple agents through
the commands that use them.
