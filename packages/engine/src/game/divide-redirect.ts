// Answering `divideRedirect`: how much of each damage entry a redirection effect with too little left takes (Harm's
// Way's ruling; `pipeline/redirection.ts`, D-090). One entry per answer; after the second-to-last, the last gets the
// rest, and the event is replaced again with the split, as nothing has happened yet.

import type { PendingDecision } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ReplacementChoice } from "../state/replacements.ts";
import { waitFor } from "./decide.ts";
import { queueWork } from "./work.ts";

type DivideRedirect = Extract<PendingDecision, { kind: "divideRedirect" }>;

/**
 * The shares the next entry may take: at most its damage and what's left, and at least enough that the entries after
 * it can take the rest, so all that's left is redirected (its ruling: "the next 2 damage").
 */
export function redirectShareRange(decision: DivideRedirect): { min: number; max: number } {
  const i = decision.shares.length;
  const rest = decision.amount - decision.shares.reduce((sum, n) => sum + n, 0);
  const later = decision.maxima.slice(i + 1).reduce((sum, n) => sum + n, 0);
  return { min: Math.max(0, rest - later), max: Math.min(decision.maxima[i] ?? 0, rest) };
}

/** Records one entry's share, asking for the next or, after the second-to-last, replacing the event again. */
export function answerDivideRedirect(answered: GameState, pending: DivideRedirect, amount: number): GameState {
  const { id: _id, player, ...decision } = pending;
  const shares = [...decision.shares, amount];
  if (shares.length < decision.entries.length - 1) return waitFor(answered, player, { ...decision, shares });
  const rest = decision.amount - shares.reduce((sum, n) => sum + n, 0);
  const all = [...shares, rest];
  const split: ReplacementChoice = {
    kind: "redirectSplit",
    effect: decision.effect,
    shares: decision.entries.map((entry, i) => ({ entry, amount: all[i] ?? 0 })),
  };
  const { proposed, choices } = decision.resume;
  return queueWork(answered, { kind: "resumeEvent", proposed, choices: [...choices, split] });
}
