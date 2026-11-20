// Who can be dealt damage (CR 120.1a).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { cardTypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";

/**
 * Whether the recipient can be dealt damage: a player, or a creature on the battlefield (CR 120.1a; no planeswalkers or
 * battles yet). A recipient that left between the start of resolution and this effect is a new object (CR 400.7), so
 * dealing it damage is impossible and is ignored (CR 101.3).
 */
export function canBeDealtDamage(state: GameState, to: Target, cards: CardDatabase): boolean {
  switch (to.kind) {
    case "player":
      return state.players[to.player] !== undefined;
    case "object":
      return state.zones.battlefield.includes(to.object) && cardTypesOf(state, to.object, cards).includes("creature");
  }
}

/**
 * Whether the recipient is this player or a permanent they control ("you and/or permanents you control", Harm's Way),
 * for a recipient that can be dealt damage (`canBeDealtDamage`).
 */
export function isYouOrYourPermanent(state: GameState, to: Target, you: PlayerId): boolean {
  return to.kind === "player" ? to.player === you : controllerOf(state, to.object) === you;
}

/** Whether the recipient is this player or a creature on the battlefield they control ("you and creatures you control"). */
export function isYouOrYourCreature(state: GameState, to: Target, you: PlayerId, cards: CardDatabase): boolean {
  if (to.kind === "player") return to.player === you;
  return (
    state.zones.battlefield.includes(to.object) &&
    cardTypesOf(state, to.object, cards).includes("creature") &&
    controllerOf(state, to.object) === you
  );
}
