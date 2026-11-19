// What a target requirement may choose (CR 115), in one place, so later rules (hexproof, protection, "another
// target") have one function to change.

import type { CardDatabase, Effect, TargetSpec } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
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

/**
 * A stack object's chosen targets, one group per instance of "target", and the same groups keeping only the targets
 * still legal (CR 608.2b), checked as it starts to resolve. Abilities' targets come with activated abilities (M1-14).
 */
export function stillLegalTargets(
  state: GameState,
  id: ObjectId,
  cards: CardDatabase,
): { chosen: Target[][]; legal: Target[][] } {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || obj.choices === null) return { chosen: [], legal: [] };
  const specs = targetSpecsOf(state, id, cards);
  const chosen = obj.choices.targets;
  const legal = chosen.map((group, i) => {
    const spec = specs[i];
    return spec === undefined ? [] : group.filter((target) => isLegalTarget(state, spec, target, cards));
  });
  return { chosen, legal };
}

/**
 * What a card's spell does when it resolves, from its definition (CR 608.2c). One place to read it, so text-changing
 * effects (layer 3) and copies can change the answer later.
 */
export function spellEffectsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly Effect[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  const data = cards[obj.oracleId];
  if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  return data.def.spell?.effects ?? [];
}

/** The target requirements of a card's spell, one per instance of "target" (CR 601.2c). */
export function targetSpecsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly TargetSpec[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  return cards[obj.oracleId]?.def.spell?.targets ?? [];
}
