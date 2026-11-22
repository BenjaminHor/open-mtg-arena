# Golden games

Games between agents, M1's four whole and the rest cut off at a turn (docs/testing.md, section 4; D-047, D-082). Each
is `<name>.json`, a game file with the recipe that made it (agent, agent seed, turn cap), its setup with cards named,
and its actions one readable line each, starting with the player who acted (`"encoding": "lines"`: `pass p1 p2`,
`p2 cast o12`, `p2 chooseTarget p1`), and
`<name>.log`, its brief event log, one event per line.
`packages/cli/test/golden.test.ts` replays each game and compares the log, so a failing test shows, line by line, what
an engine change did to the game.

- If the change is intended, run `pnpm golden:update` and explain the diff in the commit. Never regenerate just to
  make a failure go away.
- Between them, the games must run every mechanic the pool's cards have (each effect op, trigger condition, cost and
  target kind as a spell or ability with it resolves; combat keywords and statics as a creature with them attacks or
  blocks; `cli/src/mechanics.ts`), answer every kind of decision, show every kind of event agents can reach, and show
  the choices the export tests need (a test checks). When the pool grows, `pnpm golden:cover`
  adds, greedily, the games running the most new mechanics per action, cut off at the turn they appear (D-082); each
  description's "Covered, when chosen" list is what the game was chosen for, and can go stale after `pnpm
  golden:update`. Each card is covered by its own scenarios (a test checks every pool card is in one). M1's four games
  (`red-aggro` / `green-stompy`) are the benchmark's, and three games the export tests read stay too.
- `pnpm golden:add --decks red-aggro,green-stompy --seed N [--agent by-kind]` adds one game by hand.

A game named after prebuilt decks keeps the setup it was made with: its name shows the decks as they were then, not as
they are now (D-131).

