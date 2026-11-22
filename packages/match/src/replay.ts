// A match's log replayed (architecture.md, "Replay log"): the setup and the actions reproduce the game exactly, as
// the engine is deterministic. The same log is the bug-report format (M3-10).

import { type Action, applyAction, type CardDatabase, createGame, type GameSetup, type GameState } from "@mtg/engine";

/** The game after replaying every action of the log. Throws if the setup or an action is refused. */
export function replayLog(setup: GameSetup, actions: readonly Action[], cards: CardDatabase): GameState {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  let state = created.state;
  for (const [i, action] of actions.entries()) {
    const result = applyAction(state, action, cards);
    if (!result.ok) throw new Error(`action ${i + 1} is refused: ${result.error.message}`);
    state = result.state;
  }
  return state;
}
