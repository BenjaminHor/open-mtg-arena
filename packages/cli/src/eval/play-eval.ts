// One evaluation game (M3-02's acceptance, D-145): the heuristic AI with one deck against a simple agent with another,
// through the match host, both seats with the host's auto-pass and auto-tap. The heuristic's seat is played here, as a
// person's would be, so each of its decisions can be timed the way the app will see it: building what the seat is
// shown (`seatView`) and choosing.

import { type AgentName, heuristicAction } from "@mtg/ai";
import type { DeckList } from "@mtg/cards";
import { type CardDatabase, type PlayerId, seatView } from "@mtg/engine";
import { advance, deckGameSetup, HostStuck, type MatchState, startMatch, submit, waitingOn } from "@mtg/match";

export type EvalGame = {
  heroDeck: DeckList;
  villainDeck: DeckList;
  /** The heuristic's seat; the other player is the agent's. */
  hero: PlayerId;
  firstPlayer: PlayerId;
  opponent: AgentName;
  seed: number;
  /** Past this turn the game stops and counts as not won. */
  turnCap: number;
};

export type EvalOutcome = {
  /** `void`: the simple agent went round in circles until the host gave up (`HostStuck`); not a win either. */
  outcome: "won" | "lost" | "drawn" | "capped" | "void";
  turns: number;
  /** How long each of the heuristic's decisions took, in milliseconds. */
  decisionMs: number[];
};

/** Far more decisions than any real game needs (about 150 is usual); reaching it means the heuristic is looping. */
const MOST_DECISIONS = 5000;

export function playEvalGame(game: EvalGame, clock: () => number, cards: CardDatabase): EvalOutcome {
  const villain: PlayerId = game.hero === "p1" ? "p2" : "p1";
  const decks = game.hero === "p1" ? [game.heroDeck, game.villainDeck] : [game.villainDeck, game.heroDeck];
  const seats = {
    [game.hero]: { kind: "human" },
    [villain]: { kind: "agent", agent: game.opponent, random: game.seed },
  } as MatchState["seats"];
  let match = startMatch(deckGameSetup(decks, game.seed, game.firstPlayer), seats, cards);
  const decisionMs: number[] = [];
  for (;;) {
    try {
      match = advance(match, cards);
    } catch (error) {
      if (error instanceof HostStuck) return { outcome: "void", turns: match.state.turn?.number ?? 0, decisionMs };
      throw error;
    }
    const { state } = match;
    const turns = state.turn?.number ?? 0;
    if (state.result !== null) {
      const winner = state.result.winner;
      const outcome = winner === null ? "drawn" : winner === game.hero ? "won" : "lost";
      return { outcome, turns, decisionMs };
    }
    if (turns > game.turnCap) return { outcome: "capped", turns, decisionMs };
    if (decisionMs.length >= MOST_DECISIONS) {
      throw new Error(`seed ${game.seed}: the heuristic made ${MOST_DECISIONS} decisions without the game ending`);
    }
    const deciding = waitingOn(match, cards);
    if (deciding !== game.hero) throw new Error(`the host stopped for ${deciding ?? "no one"} (a host bug)`);
    const start = clock();
    const action = heuristicAction(seatView(state, game.hero, cards), cards);
    decisionMs.push(clock() - start);
    const result = submit(match, action, cards);
    if (!result.ok)
      throw new Error(`seed ${game.seed}: the heuristic chose an illegal action: ${result.error.message}`);
    match = result.match;
  }
}
