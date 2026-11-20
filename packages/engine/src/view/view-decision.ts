// A pending decision as its own player may see it. Most are shown whole; a `chooseCards` decision's options are shown
// by what each card is, and by its object id only when the player can see that card anyway (D-062).

import type { PendingDecision } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId, PlayerId } from "../state/ids.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { canSee } from "./visibility.ts";

type ChooseCards = Extract<PendingDecision, { kind: "chooseCards" }>;

/**
 * One option of a `chooseCards` decision as shown: what the card is, and its object id only if the viewer sees it
 * where it is (their own hand). A card from a hidden zone has no id here: ids record when and how a card got there.
 */
export type ShownOption = { oracleId: OracleId; object: ObjectId | null };

/** The effect to resume stays out of the view: it's the engine's bookkeeping, not part of the choice. */
export type ViewChooseCards = Omit<ChooseCards, "options" | "resume"> & { options: ShownOption[] };

export type ViewDecision = Exclude<PendingDecision, ChooseCards> | ViewChooseCards;

export function viewDecision(state: GameState, decision: PendingDecision, viewer: PlayerId): ViewDecision {
  if (decision.kind !== "chooseCards") return decision;
  const { resume: _resume, options, ...rest } = decision;
  return { ...rest, options: options.map((id) => shownOption(state, id, viewer)) };
}

function shownOption(state: GameState, id: ObjectId, viewer: PlayerId): ShownOption {
  const obj = state.objects[id];
  const oracleId = obj?.kind === "card" ? obj.oracleId : "";
  return { oracleId, object: canSee(zoneOf(state, id), viewer) ? id : null };
}
