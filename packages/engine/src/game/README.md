# engine/src/game

The engine's entry points and the flow of a game.

| File | What it does |
| --- | --- |
| `create-game.ts` | `createGame(setup, cards)`: validates the setup, creates the objects, starts a `standard` or `fixed` opening |
| `setup-validation.ts` | `setupProblems()`: why a setup can't start a game |
| `pregame.ts` | The start of a standard game (CR 103): starting player, shuffles, opening hands, mulligans |
| `first-turn.ts` | Turn 1 begins (CR 103.8); a shortcut to the upkeep until M1-06 |
| `apply-action.ts` | `applyAction(state, action, cards)`: checks an action answers the pending decision, then applies it |
| `legal-actions.ts` | `legalActions(state, player, cards)`: every action `applyAction` would accept right now |
| `decide.ts` | `waitFor()`: sets the pending decision, with a new id |
| `ids.ts`, `progress.ts`, `turn.ts` | Id and timestamp allocation; passing state plus events along; `currentTurn()` |

Every function takes a state and returns a new one (D-021). Events are collected alongside (`Progress`).

Tests: `test/game/start.test.ts`. The helpers in `test/support/game.ts` check the engine's invariants on every state
and only take actions that `legalActions` lists.
