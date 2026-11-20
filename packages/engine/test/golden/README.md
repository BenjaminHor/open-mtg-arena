# Golden games

Games between agents, M1's four whole and the rest cut off at a turn (docs/testing.md, section 4; D-047). Each is `<name>.json`, a game file with the recipe that
made it (agent, agent seed, turn cap), and `<name>.log`, its brief event log, one event per line.
`packages/cli/test/golden.test.ts` replays each game and compares the log, so a failing test shows, line by line, what
an engine change did to the game.

- If the change is intended, run `pnpm golden:update` and explain the diff in the commit. Never regenerate just to
  make a failure go away.
- Between them, the games must use every card in the pool (played as a land, or a spell or ability of it resolved) and
  show the choices the export tests need (a test checks). When the pool grows, `pnpm golden:cover` adds, greedily,
  the games using the most new cards per action, cut off at the turn they're used (D-069); each description's
  "Covered, when chosen" list is what the game was chosen for, and can go stale after `pnpm golden:update`. M1's four games
  (`red-aggro` / `green-stompy`) are the benchmark's and never change but through `pnpm golden:update`.
- `pnpm golden:add --decks red-aggro,green-stompy --seed N [--agent by-kind]` adds one game by hand.
