// Which triggered abilities an event triggers (CR 603.2): matched as the event happens, waiting in
// `GameState.pendingTriggers` until a player would receive priority (CR 603.3). Only permanents' abilities trigger
// (CR 113.6): a card in a graveyard or a spell on the stack doesn't.

import type { PlayerRelation, TriggerCheck, TriggerCondition } from "../cards/triggers.ts";
import type { CardDatabase } from "../cards/types.ts";
import { triggersOf } from "../rules/abilities.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerOf } from "../rules/controller.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { PendingTrigger, TriggerEvent } from "../state/triggers.ts";

/**
 * Adds the triggered abilities these events trigger to the pending list, in the order they triggered. `before` is the
 * state before the events, for abilities that look back in time (later: CR 603.10); `after`, the state right after,
 * which entering abilities check (CR 603.6a: a permanent entering at the same time sees the others).
 */
export function detectTriggers(
  _before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  cards: CardDatabase,
): GameState {
  const sources = after.zones.battlefield.filter((id) => triggersOf(after, id, cards).length > 0);
  if (sources.length === 0) return after;
  const found = events.flatMap((event) => sources.flatMap((source) => triggered(after, source, event, cards)));
  return found.length === 0 ? after : { ...after, pendingTriggers: [...after.pendingTriggers, ...found] };
}

/** The triggers of one permanent this event triggers. */
function triggered(state: GameState, source: ObjectId, event: GameEvent, cards: CardDatabase): PendingTrigger[] {
  const obj = state.objects[source];
  if (obj?.kind !== "card") return [];
  const controller = controllerOf(state, source);
  return triggersOf(state, source, cards).flatMap(({ index, def }) => {
    const occurrences = matches(state, source, def.when, event, cards);
    // An "intervening if" that's false as the event happens means it doesn't trigger at all (CR 603.4).
    if (def.onlyIf !== undefined && !holds(state, source, def.onlyIf)) return [];
    return occurrences.map((matched) => ({ source, sourceOracleId: obj.oracleId, index, controller, event: matched }));
  });
}

/**
 * What the ability knows of each occurrence of its trigger event in this event: none if it doesn't match, or one per
 * occurrence (CR 603.2c: a creature blocked by two creatures "becomes blocked by a creature" twice, CR 509.3d).
 */
function matches(
  state: GameState,
  source: ObjectId,
  when: TriggerCondition,
  event: GameEvent,
  cards: CardDatabase,
): TriggerEvent[] {
  switch (when.kind) {
    case "selfEnters":
      return entered(event) === source ? [{ player: null, object: source, amount: null }] : [];
    case "anotherEnters": {
      const object = entered(event);
      if (object === null || object === source) return [];
      return matchesFilter(state, object, when.filter, controllerOf(state, source), cards)
        ? [{ player: null, object, amount: null }]
        : [];
    }
    case "beginningOfStep":
      // "Each player's draw step": "that player", in the card's text, is the player whose step it is.
      if (event.type !== "STEP_BEGAN" || event.step !== when.step) return [];
      if (when.whose === "yours" && event.activePlayer !== controllerOf(state, source)) return [];
      return [{ player: event.activePlayer, object: null, amount: null }];
    case "selfAttacks":
      return event.type === "ATTACKERS_DECLARED" && event.attacks.some((a) => a.attacker === source)
        ? [{ player: null, object: source, amount: null }]
        : [];
    case "playerDraws":
      return event.type === "CARD_DRAWN" && isRelated(state, source, event.player, when.player)
        ? [{ player: event.player, object: null, amount: null }]
        : [];
    case "playerDiscards":
      return event.type === "CARD_DISCARDED" && isRelated(state, source, event.player, when.player)
        ? [{ player: event.player, object: null, amount: null }]
        : [];
    case "landTappedForMana":
      // "That player" only: the land isn't kept, so lands tapped together give identical triggers (D-077).
      return event.type === "TAPPED_FOR_MANA" && cardTypesOf(state, event.object, cards).includes("land")
        ? [{ player: event.player, object: null, amount: null }]
        : [];
    case "selfDealsDamageToPlayer": {
      if (event.type !== "DAMAGE_DEALT" || event.source !== source || event.to.kind !== "player") return [];
      if (when.combatOnly && !event.combat) return [];
      return isRelated(state, source, event.to.player, when.player)
        ? [{ player: event.to.player, object: null, amount: null }]
        : [];
    }
    case "playerGainsLife":
      return event.type === "LIFE_GAINED" && isRelated(state, source, event.player, when.player)
        ? [{ player: event.player, object: null, amount: event.amount }]
        : [];
    case "selfBlocksOrBlocked":
      // "Blocks or becomes blocked by a creature": once per creature it blocks or that blocks it, "that creature" being
      // the other one (CR 509.3b, 509.3d).
      if (event.type !== "BLOCKERS_DECLARED") return [];
      return event.blocks.flatMap((b) =>
        b.blocker === source
          ? [{ player: null, object: b.attacker, amount: null }]
          : b.attacker === source
            ? [{ player: null, object: b.blocker, amount: null }]
            : [],
      );
    case "spellCast":
      return event.type === "SPELL_CAST" &&
        matchesFilter(state, event.object, when.filter, controllerOf(state, source), cards)
        ? [{ player: event.player, object: event.object, amount: null }]
        : [];
  }
}

/** Whether `player` is one the trigger's "a player / you / an opponent" means, from its controller's side (CR 102.2). */
function isRelated(state: GameState, source: ObjectId, player: PlayerId, relation: PlayerRelation): boolean {
  const you = controllerOf(state, source);
  switch (relation) {
    case "anyPlayer":
      return true;
    case "you":
      return player === you;
    case "opponent":
      return player !== you;
  }
}

/** The permanent an event put onto the battlefield, or null (CR 603.6a). */
function entered(event: GameEvent): ObjectId | null {
  return event.type === "ZONE_CHANGED" && event.to.zone === "battlefield" ? event.newId : null;
}

/**
 * Whether an "intervening if" condition holds now (CR 603.4), as the ability triggers and again as it resolves
 * (CR 608.2a).
 */
export function holds(state: GameState, source: ObjectId, check: TriggerCheck): boolean {
  switch (check.kind) {
    case "sourceUntapped": {
      // A source that's gone is read as it last existed (CR 608.2h).
      const obj = state.objects[source] ?? state.lastKnown[source];
      return obj?.kind === "card" && !obj.tapped;
    }
  }
}
