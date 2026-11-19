// Letting agents take the decisions: for one player until another must decide (`ai`), or for everyone (`auto`).

import { type Action, applyAction, type CardDatabase, type GameState, legalActions, type PlayerId } from "@mtg/engine";
import { type AgentName, chooseAction } from "./agents.ts";

export type PlayLimits = { maxActions: number; maxTurns: number };

export type Played = {
  state: GameState;
  actions: Action[];
  /** Why it stopped: the game ended, a player the agent doesn't play must decide, or a limit was reached. */
  stopped: "gameOver" | "yourDecision" | "maxActions" | "maxTurns";
};

/** Agents decide for every player `plays` says yes to, until one of the stopping conditions. */
export function playAgents(
  start: GameState,
  plays: (player: PlayerId) => boolean,
  agent: AgentName,
  seed: number,
  limits: PlayLimits,
  cards: CardDatabase,
): Played {
  let state = start;
  let rng = seed;
  const actions: Action[] = [];
  for (;;) {
    const pending = state.pending;
    if (state.result !== null) return { state, actions, stopped: "gameOver" };
    // Nothing pending and no result is a stalled engine: always a bug, never a normal stop (architecture.md).
    if (pending === null) throw new Error("the engine stalled: nothing pending and no result (an engine bug)");
    if (!plays(pending.player)) return { state, actions, stopped: "yourDecision" };
    if (actions.length >= limits.maxActions) return { state, actions, stopped: "maxActions" };
    if ((state.turn?.number ?? 0) > limits.maxTurns) return { state, actions, stopped: "maxTurns" };
    const choice = chooseAction(agent, state, legalActions(state, pending.player, cards), rng);
    rng = choice.seed;
    const result = applyAction(state, choice.action, cards);
    if (!result.ok) throw new Error(`a legal action was rejected: ${result.error.message} (engine bug)`);
    state = result.state;
    actions.push(choice.action);
  }
}
