// What a target requirement may choose (CR 115), in one place, so later rules (hexproof, protection, shroud) have one
// function to change.

import type { CardDatabase, Effect, TargetCount, TargetSpec } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { stackAbilityDef } from "./abilities.ts";
import { cardTypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";
import { matchesFilter } from "./object-filter.ts";

/**
 * Who is choosing targets, and for what: the spell or ability that targets (`object`, which can't target itself,
 * CR 115.5) and its controller, the "you" of its text (CR 109.5). While a spell is checked before it's cast, `object`
 * is its card in hand.
 */
export type Targeting = { object: ObjectId; controller: PlayerId };

/**
 * Every legal choice for this target requirement right now, in a fixed order: objects in their zone's order, then
 * players in turn order. Only permanents can be chosen unless the text says otherwise (CR 115.2).
 */
export function legalTargets(state: GameState, spec: TargetSpec, by: Targeting, cards: CardDatabase): Target[] {
  const objects = (ids: readonly ObjectId[]): Target[] => ids.map((object) => ({ kind: "object", object }));
  const players: Target[] = state.turnOrder.map((player) => ({ kind: "player", player }));
  switch (spec.kind) {
    case "anyTarget": {
      // "Any target": a creature, player, planeswalker or battle (CR 115.4). There are no planeswalkers or battles yet.
      const creatures = state.zones.battlefield.filter((id) => cardTypesOf(state, id, cards).includes("creature"));
      return [...objects(creatures), ...players];
    }
    case "playerOrPlaneswalker":
      // No planeswalkers yet (later: CR 306), so only players.
      return players;
    case "permanent":
      return objects(
        state.zones.battlefield.filter((id) => matchesFilter(state, id, spec.filter, by.controller, cards)),
      );
    case "spell": {
      // A spell is a card on the stack (CR 112.1); an ability on the stack isn't one. It can't target itself (CR 115.5).
      const spells = state.zones.stack.filter(
        (id) =>
          id !== by.object &&
          state.objects[id]?.kind === "card" &&
          matchesFilter(state, id, spec.filter, by.controller, cards),
      );
      return objects(spells);
    }
    case "cardInGraveyard": {
      // "Your graveyard" or "a graveyard" names the zone (CR 109.2a), not control: cards there have none (CR 109.4).
      const owners = spec.graveyard === "yours" ? [by.controller] : state.turnOrder;
      const inGraveyards = owners.flatMap((p) => state.zones.players[p]?.graveyard ?? []);
      return objects(inGraveyards.filter((id) => matchesFilter(state, id, spec.filter, by.controller, cards)));
    }
  }
}

/** How many targets an instance takes; exactly one when the text just says "target" (CR 601.2c). */
export function targetCount(spec: TargetSpec): TargetCount {
  return spec.count ?? { min: 1, max: 1 };
}

/** Whether this target is a legal choice for this requirement now. */
export function isLegalTarget(
  state: GameState,
  spec: TargetSpec,
  by: Targeting,
  target: Target,
  cards: CardDatabase,
): boolean {
  return legalTargets(state, spec, by, cards).some((t) => sameTarget(t, target));
}

export function sameTarget(a: Target, b: Target): boolean {
  return a.kind === "player"
    ? b.kind === "player" && a.player === b.player
    : b.kind === "object" && a.object === b.object;
}

/**
 * Why a spell or ability couldn't have targets chosen now, or null: each instance of "target" needs at least its
 * minimum of different legal choices (CR 115.3, 601.2c), and an instance that allows zero needs none (CR 115.6).
 * Checking this before casting gives the same result as starting and then reversing (CR 601.2e, 734.1).
 */
export function targetsProblem(
  state: GameState,
  specs: readonly TargetSpec[],
  by: Targeting,
  cards: CardDatabase,
): string | null {
  for (const spec of specs) {
    if (legalTargets(state, spec, by, cards).length < targetCount(spec).min)
      return "there aren't enough legal targets (CR 601.2c)";
  }
  return null;
}

/**
 * A stack object's chosen targets, one group per instance of "target", and the same groups keeping only the targets
 * still legal (CR 608.2b), checked as it starts to resolve.
 */
export function stillLegalTargets(
  state: GameState,
  id: ObjectId,
  cards: CardDatabase,
): { chosen: Target[][]; legal: Target[][] } {
  const obj = state.objects[id];
  const choices = obj === undefined ? null : obj.choices;
  if (choices === null) return { chosen: [], legal: [] };
  const specs = targetSpecsOf(state, id, cards);
  const by = { object: id, controller: controllerOf(state, id) };
  const chosen = choices.targets;
  const legal = chosen.map((group, i) => {
    const spec = specs[i];
    return spec === undefined ? [] : group.filter((target) => isLegalTarget(state, spec, by, target, cards));
  });
  return { chosen, legal };
}

/**
 * What a spell or ability on the stack does when it resolves, from its definition (CR 608.2c). One place to read it, so
 * text-changing effects (layer 3) and copies can change the answer later. A permanent spell has none (CR 608.3).
 */
export function effectsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly Effect[] {
  const obj = state.objects[id];
  if (obj === undefined) return [];
  switch (obj.kind) {
    case "card": {
      const data = cards[obj.oracleId];
      if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
      return data.def.spell?.effects ?? [];
    }
    case "ability":
      return stackAbilityDef(state, id, cards).effects;
  }
}

/** The target requirements of a spell or ability on the stack, one per instance of "target" (CR 601.2c, 602.2b). */
export function targetSpecsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly TargetSpec[] {
  const obj = state.objects[id];
  if (obj === undefined) return [];
  switch (obj.kind) {
    case "card":
      return cards[obj.oracleId]?.def.spell?.targets ?? [];
    case "ability":
      return stackAbilityDef(state, id, cards).targets;
  }
}
