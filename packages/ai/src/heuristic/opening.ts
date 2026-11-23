// The opening hand and hand size: who starts (CR 103.1), keep or mulligan by land count (CR 103.5), which cards go to
// the bottom after a mulligan, and what to discard in cleanup (CR 514.1). A 40-card deck with 17 lands wants about two
// lands in five cards.

import type { Action, CardDatabase, ObjectId, SeatView, SeenCard } from "@mtg/engine";
import { controlledBy, hand, isLand, manaValueOf } from "./board.ts";

type AnswerKind = Extract<Action, { type: "ANSWER" }>["answer"];

const LAND_SHARE = 0.42;

function answer(shown: SeatView, fits: (a: AnswerKind) => boolean): Action | null {
  const option = shown.options.find((o) => o.action.type === "ANSWER" && fits(o.action.answer));
  return option?.action ?? null;
}

export function startingPlayerAction(shown: SeatView): Action | null {
  return answer(shown, (a) => a.kind === "chooseStartingPlayer" && a.player === shown.player);
}

/** Keep two to four lands in seven; after one mulligan, two to five; after two, anything (CR 103.5). */
export function mulliganAction(shown: SeatView, mulligansTaken: number): Action | null {
  const lands = hand(shown).filter(isLand).length;
  const keep = mulligansTaken >= 2 || (lands >= 2 && lands <= (mulligansTaken === 0 ? 4 : 5));
  return answer(shown, (a) => a.kind === "mulligan" && a.choice === (keep ? "keep" : "mulligan"));
}

/** Bottom a land while the hand that's kept would have too many, else its most expensive spell. */
export function mulliganBottomAction(shown: SeatView, remaining: number, cards: CardDatabase): Action | null {
  const cardsInHand = hand(shown);
  const kept = cardsInHand.length - remaining;
  const lands = cardsInHand.filter(isLand);
  const tooManyLands = lands.length > Math.round(kept * LAND_SHARE);
  const pick = tooManyLands
    ? lands[lands.length - 1]
    : mostExpensive(
        cardsInHand.filter((c) => !isLand(c)),
        cards,
      );
  const choice = pick ?? cardsInHand[0];
  return choice === undefined ? null : answer(shown, (a) => a.kind === "mulliganBottom" && a.object === choice.id);
}

/** Discard lands once there are plenty on the table, else the most expensive spells. */
export function discardAction(shown: SeatView, chosen: readonly ObjectId[], cards: CardDatabase): Action | null {
  const left = hand(shown).filter((c) => !chosen.includes(c.id));
  const landsOut = controlledBy(shown, shown.player).filter(isLand).length;
  const lands = left.filter(isLand);
  const pick =
    landsOut + lands.length >= 6 && lands.length > 0
      ? lands[0]
      : (mostExpensive(
          left.filter((c) => !isLand(c)),
          cards,
        ) ?? left[0]);
  return pick === undefined ? null : answer(shown, (a) => a.kind === "discardToHandSize" && a.object === pick.id);
}

function mostExpensive(spells: readonly SeenCard[], cards: CardDatabase): SeenCard | undefined {
  let best: SeenCard | undefined;
  for (const c of spells) if (best === undefined || manaValueOf(c, cards) > manaValueOf(best, cards)) best = c;
  return best;
}
