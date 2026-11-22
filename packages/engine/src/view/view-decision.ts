// A pending decision as its own player may see it. Most are shown whole; a `chooseCards` decision's options, and the
// card a choice is for, are shown by what each card is, and by its object id only when the player can see that card
// anyway (D-062): a card entering from a library (a Clone Sphinx Ambassador found, an Aura Warp World revealed) has
// no id here, as its id records how it got there.

import type { NameFor, PendingDecision } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "../state/ids.ts";
import { oracleIdOf } from "../zones/shown-order.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { canSee } from "./visibility.ts";

type ChooseCards = Extract<PendingDecision, { kind: "chooseCards" }>;
type ChooseYesNo = Extract<PendingDecision, { kind: "chooseYesNo" }>;
type ChooseReplacement = Extract<PendingDecision, { kind: "chooseReplacement" }>;
type ChooseName = Extract<PendingDecision, { kind: "chooseName" }>;

/**
 * One option of a `chooseCards` decision as shown: what the card is, and its object id only if the viewer sees it
 * where it is (their own hand). A card from a hidden zone has no id here: ids record when and how a card got there.
 */
export type ShownOption = { oracleId: OracleId; object: ObjectId | null };

/** The effect to resume stays out of the view: it's the engine's bookkeeping, not part of the choice. */
export type ViewChooseCards = Omit<ChooseCards, "options" | "resume" | "for"> & {
  options: ShownOption[];
  for: ShownOption | null;
};

export type ViewChooseYesNo = Omit<ChooseYesNo, "resume">;

export type ViewChooseReplacement = Omit<ChooseReplacement, "resume">;

type AsEnters = Extract<NameFor, { kind: "asEnters" }>;

/** A name chosen as a permanent enters: for which card, as shown (the replacement asking is the engine's bookkeeping). */
export type ViewChooseName = Omit<ChooseName, "answering"> & {
  answering: { kind: "asEnters"; for: ShownOption } | Exclude<NameFor, AsEnters>;
};

export type ViewDecision =
  | Exclude<PendingDecision, ChooseCards | ChooseYesNo | ChooseReplacement | ChooseName>
  | ViewChooseCards
  | ViewChooseYesNo
  | ViewChooseReplacement
  | ViewChooseName;

export function viewDecision(state: GameState, decision: PendingDecision, viewer: PlayerId): ViewDecision {
  switch (decision.kind) {
    case "chooseCards": {
      const { resume: _resume, options, for: forObject, ...rest } = decision;
      const shownFor = forObject === null ? null : shownOption(state, forObject, viewer);
      return { ...rest, options: options.map((id) => shownOption(state, id, viewer)), for: shownFor };
    }
    case "chooseYesNo":
    case "chooseReplacement": {
      const { resume: _resume, ...rest } = decision;
      return rest;
    }
    case "chooseName": {
      // The event to resume is the engine's bookkeeping; what it's for stays.
      if (decision.answering.kind !== "asEnters") return { ...decision, answering: decision.answering };
      const answering = { kind: "asEnters", for: shownOption(state, decision.answering.for.object, viewer) } as const;
      return { ...decision, answering };
    }
    default:
      return decision;
  }
}

function shownOption(state: GameState, id: ObjectId, viewer: PlayerId): ShownOption {
  return { oracleId: oracleIdOf(state, id), object: canSee(zoneOf(state, id), viewer) ? id : null };
}
