# Golden games

Full games between agents (docs/testing.md, section 4; D-047). Each is `<name>.json`, a game file with the recipe that
made it (agent, agent seed, turn cap), and `<name>.log`, its brief event log, one event per line.
`packages/cli/test/golden.test.ts` replays each game and compares the log, so a failing test shows, line by line, what
an engine change did to the game.

- If the change is intended, run `pnpm golden:update` and explain the diff in the commit. Never regenerate just to
  make a failure go away.
- `pnpm golden:add --decks red-aggro,green-stompy --seed N` adds a game. Between them, the games must play, cast or
  activate every card in the pool (a test checks), so add one when the pool grows.
