# engine/src/game

The engine's entry points and the flow of a game.

| File | What it does |
| --- | --- |
| `create-game.ts` | `createGame(setup, cards)`: validates the setup, creates the objects, starts a `standard` or `fixed` opening |
| `setup-validation.ts` | `setupProblems()`: why a setup can't start a game |
| `pregame.ts` | The start of a standard game (CR 103): starting player, shuffles, opening hands, mulligans |
| `first-turn.ts` | Turn 1 begins for the starting player (CR 103.8) |
| `turn-steps.ts` | `TURN_STEPS`: the turn sequence as data (CR 500.1) |
| `steps.ts` | The step machine: `beginTurn`, `endStep`, each step's turn-based actions, skipped steps (D-031) |
| `advance.ts` | `advance()`: runs queued work until a decision is pending (D-032). Every entry point ends here |
| `work.ts` | `queueWork()`: adds work to the front of the queue |
| `resolve.ts` | `resolveTopOfStack()` checks targets (CR 608.2b) and queues a resolution's steps: its effects (`effects/`), then `finishResolving()`, the final part (CR 608) |
| `play-land.ts` | `playLand`, `playLandProblem`: the special action (CR 305.1) |
| `cast.ts` | Casting a spell as decisions (CR 601.2): `castProblem`, `startCast`, targets, paying, cancelling (D-035) |
| `pass-priority.ts` | `passPriority()`: the next player gets priority; when all have passed, the top of the stack resolves or the step ends (CR 117.3d, 117.4) |
| `apply-action.ts` | `applyAction(state, action, cards)`: checks an action answers the pending decision, then applies it |
| `legal-actions.ts` | `legalActions(state, player, cards)`: every action `applyAction` would accept right now |
| `decide.ts` | `waitFor()`: sets the pending decision, with a new id |
| `priority.ts` | `givePriority()`: every place that gives a player priority goes through it (CR 117) |
| `turn-order.ts` | `rotateTo()`: turn order starting with a given player (CR 103.1) |
| `ids.ts`, `progress.ts`, `turn.ts` | Id and timestamp allocation; passing state plus events along; `currentTurn()` |

Every function takes a state and returns a new one (D-021). Events are collected alongside (`Progress`).

Tests: `test/game/*.test.ts` and the scenarios in `test/scenarios/` (`lands/`, `casting/` for this folder's newest parts). The helpers in `test/support/game.ts` check the engine's invariants on every state
and only take actions that `legalActions` lists.
