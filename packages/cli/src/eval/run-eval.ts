// A run of evaluation games for one of the heuristic's decks (D-145): game i puts it against the agent with the i-th
// prebuilt deck in turn, and changes its seat every five games and who plays first every ten, so each pairing is
// played from every side. Each game's seed is the run's seed plus i, so a run can be repeated exactly.

import type { AgentName } from "@mtg/ai";
import { DECKS, type DeckList } from "@mtg/cards";
import type { CardDatabase, PlayerId } from "@mtg/engine";
import { type EvalOutcome, playEvalGame } from "./play-eval.ts";

export type EvalOptions = { deck: string; games: number; seed: number; turnCap: number; opponent: AgentName };

export type EvalSummary = {
  deck: string;
  games: number;
  counts: Record<EvalOutcome["outcome"], number>;
  decisions: number;
  meanMs: number;
  slowestMs: number;
  /** The seed of the game with the slowest decision, to look at it again. */
  slowestSeed: number;
};

export const DEFAULT_TURN_CAP = 40;

export function runEval(options: EvalOptions, clock: () => number, cards: CardDatabase): EvalSummary {
  const heroDeck = deck(options.deck);
  const opponents = Object.values(DECKS);
  const counts = { won: 0, lost: 0, drawn: 0, capped: 0 };
  let decisions = 0;
  let totalMs = 0;
  let slowest = { ms: 0, seed: options.seed };
  for (let i = 0; i < options.games; i++) {
    const seed = options.seed + i;
    const villainDeck = opponents[i % opponents.length] as DeckList;
    const hero: PlayerId = Math.floor(i / 5) % 2 === 0 ? "p1" : "p2";
    const firstPlayer: PlayerId = Math.floor(i / 10) % 2 === 0 ? "p1" : "p2";
    const game = {
      heroDeck,
      villainDeck,
      hero,
      firstPlayer,
      opponent: options.opponent,
      seed,
      turnCap: options.turnCap,
    };
    const played = playEvalGame(game, clock, cards);
    counts[played.outcome]++;
    decisions += played.decisionMs.length;
    for (const ms of played.decisionMs) {
      totalMs += ms;
      if (ms > slowest.ms) slowest = { ms, seed };
    }
  }
  return {
    deck: options.deck,
    games: options.games,
    counts,
    decisions,
    meanMs: decisions === 0 ? 0 : totalMs / decisions,
    slowestMs: slowest.ms,
    slowestSeed: slowest.seed,
  };
}

export function evalReport(s: EvalSummary): string {
  const share = (n: number) => `${((100 * n) / s.games).toFixed(1)}%`;
  const { won, lost, drawn, capped } = s.counts;
  return (
    `${s.deck}: won ${won}/${s.games} (${share(won)}), lost ${lost}, drawn ${drawn}, capped ${capped}; ` +
    `${s.decisions} decisions, mean ${s.meanMs.toFixed(2)} ms, slowest ${s.slowestMs.toFixed(1)} ms (seed ${s.slowestSeed})`
  );
}

function deck(name: string): DeckList {
  const found = DECKS[name];
  if (found === undefined) throw new Error(`no prebuilt deck ${name}: ${Object.keys(DECKS).join(", ")}`);
  return found;
}
