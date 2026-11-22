// The heuristic AI v0 (M3-02): one decision at a time, from what its seat is shown (`SeatView`, D-137) and the card
// database, never the game state. It keeps no memory between decisions, uses no randomness (the same table gives the
// same answer), and picks only among the legal actions, so it never makes an illegal move. Each decision kind has its
// chooser; when one finds nothing sensible, the first legal answer that doesn't undo work is taken.

import type { Action, CardDatabase, SeatView } from "@mtg/engine";
import {
  announceXAction,
  assignDamageAction,
  chooseCardsAction,
  divideAction,
  keepLegendAction,
  nameAction,
  newTargetAction,
  payManaAction,
  sacrificeAction,
  targetAction,
  targetCountAction,
  yesNoAction,
} from "./choices.ts";
import { attackAction, blockAction } from "./combat.ts";
import { discardAction, mulliganAction, mulliganBottomAction, startingPlayerAction } from "./opening.ts";
import { priorityAction } from "./priority.ts";

export function heuristicAction(shown: SeatView, cards: CardDatabase): Action {
  const decision = shown.view.decision;
  if (decision === null) throw new Error(`${shown.player} has no decision to make`);
  const chosen = ((): Action | null => {
    switch (decision.kind) {
      case "priority":
        return priorityAction(shown, cards);
      case "chooseStartingPlayer":
        return startingPlayerAction(shown);
      case "mulligan":
        return mulliganAction(shown, decision.mulligansTaken);
      case "mulliganBottom":
        return mulliganBottomAction(shown, decision.remaining, cards);
      case "discardToHandSize":
        return discardAction(shown, decision.chosen, cards);
      case "declareAttackers":
        return attackAction(shown, decision.chosen);
      case "declareBlockers":
        return blockAction(shown, decision.chosen);
      case "assignDamage":
        return assignDamageAction(shown, decision);
      case "chooseTarget":
        return targetAction(shown, decision, cards);
      case "announceX":
        return announceXAction(shown, decision);
      case "chooseTargetCount":
        return targetCountAction(shown, decision, cards);
      case "divide":
        return divideAction(shown, decision);
      case "payMana":
        return payManaAction(shown);
      case "chooseSacrifice":
        return sacrificeAction(shown, cards);
      case "chooseCards":
        return chooseCardsAction(shown, decision, cards);
      case "orderTriggers":
      case "chooseReplacement":
        // Any order: the heuristic doesn't weigh how its own triggers or replacements interact yet.
        return null;
      case "chooseYesNo":
        return yesNoAction(shown, decision);
      case "keepLegend":
        return keepLegendAction(shown, decision, cards);
      case "chooseName":
        return nameAction(shown);
      case "chooseNewTarget":
        return newTargetAction(shown, decision, cards);
    }
  })();
  return chosen ?? firstForward(shown);
}

/** The first legal action that doesn't undo work (a cancel, a take-back), or the first of all if that's all there is. */
function firstForward(shown: SeatView): Action {
  const undoes = (a: Action) => a.type === "ANSWER" && (a.answer.kind === "cancelCast" || a.answer.kind === "takeBack");
  const option = shown.options.find((o) => !undoes(o.action)) ?? shown.options[0];
  if (option === undefined) throw new Error(`${shown.player} has no legal actions`);
  return option.action;
}
