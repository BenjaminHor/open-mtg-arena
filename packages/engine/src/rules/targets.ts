// What a target requirement may choose (CR 115), in one place, so later rules (hexproof, protection, "another
// target") have one function to change.

import type { CardDatabase, TargetSpec } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { Target } from "../state/objects.ts";
import { cardTypesOf } from "./card-types.ts";

/** Every legal choice for this target requirement right now: permanents in battlefield order, then players in turn order. */
export function legalTargets(state: GameState, spec: TargetSpec, cards: CardDatabase): Target[] {
  const creatures: Target[] = state.zones.battlefield
    .filter((id) => cardTypesOf(state, id, cards).includes("creature"))
    .map((object) => ({ kind: "object", object }));
  const players: Target[] = state.turnOrder.map((player) => ({ kind: "player", player }));
  switch (spec.kind) {
    case "anyTarget":
      // "Any target": a creature, player, planeswalker or battle (CR 115.4). There are no planeswalkers or battles yet.
      return [...creatures, ...players];
    case "creature":
      // "Target creature" means a creature permanent on the battlefield (CR 109.2).
      return creatures;
  }
}

/**
 * Whether a chosen target is still legal (CR 608.2b): it must still be a legal choice. An object that changed zones is
 * a new object (CR 400.7), so the old id is no longer on the battlefield and the target is illegal.
 */
export function isLegalTarget(state: GameState, spec: TargetSpec, target: Target, cards: CardDatabase): boolean {
  return legalTargets(state, spec, cards).some((t) =>
    t.kind === "player"
      ? target.kind === "player" && target.player === t.player
      : target.kind === "object" && target.object === t.object,
  );
}
