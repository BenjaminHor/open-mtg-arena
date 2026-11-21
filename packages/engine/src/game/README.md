# engine/src/game

The engine's entry points and the flow of a game.

| File | What it does |
| --- | --- |
| `create-game.ts` | `createGame(setup, cards)`: validates the setup, creates the objects, starts a `standard` or `fixed` opening |
| `setup-validation.ts` | `setupProblems()`: why a setup can't start a game |
| `pregame.ts` | The start of a standard game (CR 103): starting player, shuffles, opening hands, mulligans |
| `first-turn.ts` | Turn 1 begins for the starting player (CR 103.8) |
| `turn-steps.ts` | `TURN_STEPS`: the turn sequence as data (CR 500.1) |
| `steps.ts` | The step machine: `beginTurn`, `endStep`, each step's turn-based actions, skipped steps (D-031); the cleanup step's check and another cleanup step (CR 514.3a) |
| `advance.ts` | `advance()`: runs queued work until a decision is pending (D-032). Every entry point ends here |
| `control-changes.ts` | `recordControlChanges`: after the action and each piece of work, a permanent whose controller changed is summoning sick again (CR 302.6) and out of combat (CR 506.4) (D-104) |
| `work.ts` | `queueWork()`: adds work to the front of the queue |
| `resolve.ts` | `resolveTopOfStack()` checks targets (CR 608.2b) and queues a resolution's steps: its effects (`effects/`), then `finishResolving()`, the final part (CR 608) |
| `play-land.ts` | `playLand`, `playLandProblem`: the special action (CR 305.1) |
| `cast.ts` | Casting a spell (CR 601.2): `castProblem`, `startCast` (D-035) |
| `activate-ability.ts` | Activating a non-mana ability (CR 602.2): `activationProblem`, `startActivation` (D-041) |
| `casting-steps.ts` | The steps both share (CR 601.2b–i, 602.2b): `nextCastingStep` (X, targets, sacrifices, then the mana; a cost with no mana is paid at once), `announceX` and `xProblem` (CR 107.3a), `payCost`, `cancelCasting` |
| `choose-targets.ts` | Targets and their division (CR 601.2c–d): how many for a range, each target (no repeats in an instance, CR 115.3), each target's share of a divided effect |
| `activation-count.ts` | `countActivation`, `activationsThisTurn`: each object's activations this turn, in `GameState.turnHistory` (D-078) |
| `casting-state.ts` | `castingOf`: the cast or activation in progress |
| `sacrifice-costs.ts` | Choosing what to sacrifice for a cost (CR 601.2h, 701.21a); the sacrifice happens with the rest of the payment, in `payCost` |
| `tap-costs.ts` | `tapsForCost`: the permanent an ability's {T} taps, paid with the rest of the cost (CR 107.5, 601.2h) and never offered as mana for that cost |
| `pass-priority.ts` | `passPriority()`: the next player gets priority; when all have passed, the top of the stack resolves, the step ends, or another cleanup step begins (CR 117.3d, 117.4, 514.3a) |
| `apply-action.ts` | `applyAction(state, action, cards)`: checks an action answers the pending decision (or is a concession, any time, CR 104.3a), then applies it |
| `legal-actions.ts` | `legalActions(state, player, cards)`: every action `applyAction` would accept right now, except `CONCEDE` (D-042) and values of X above what the player could pay for (D-058) |
| `decide.ts` | `waitFor()`: sets the pending decision, with a new id |
| `priority.ts` | `givePriority()`: every place that gives a player priority goes through it; state-based actions are checked first (CR 117.5) |
| `state-based-actions.ts` | `checkStateBasedActions()`: performs every SBA that applies as one event (CR 704.3) (D-039) |
| `game-end.ts` | `playersLose()`: players lose, and the game ends with a winner or a draw (CR 104) |
| `turn-order.ts` | `rotateTo()`: turn order starting with a given player (CR 103.1) |
| `ids.ts`, `progress.ts`, `turn.ts` | Id and timestamp allocation; passing state plus events along; `currentTurn()` |

Every function takes a state and returns a new one (D-021). Events are collected alongside (`Progress`).

Tests: `test/game/*.test.ts` and the scenarios in `test/scenarios/` (`lands/`, `casting/` for this folder's newest parts). The helpers in `test/support/game.ts` check the engine's invariants on every state
and only take actions that `legalActions` lists.
