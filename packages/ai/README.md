# @mtg/ai

The computer players. They see only what a player may see (D-062, D-137) and choose among the legal actions.
Depends only on `@mtg/engine`. See "AI" in [`docs/architecture.md`](../../docs/architecture.md).

## Entry points

- `src/agents.ts`: the simple agents, which test the rules rather than play well: `first-legal`, `random` and
  `by-kind` (`chooseAction`). Each takes the legal actions and a random state, and gives an action and the next random
  state. The CLI's `ai` and `auto`, the fuzzer, the golden games and the match host's test seats use them.
- `src/pick-action.ts`: the `by-kind` picker (D-061): a kind of action first, then one of that kind.
- `src/seeded-random.ts`: `nextRandom`, the tiny seeded generator they share, so one seed is one game.
- Next: the heuristic AI (M3-02), working from the player's view and `seenObjects`.

## Tests

The CLI's `test/agents.test.ts` and `test/fuzz.test.ts` exercise the agents through the commands that use them.
