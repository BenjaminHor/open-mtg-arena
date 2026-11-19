// Power and toughness: layer 7 of the layer system (CR 613.4).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import { cardTypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";

type PT = { power: number | null; toughness: number | null };

/**
 * An object's power and toughness (CR 302.4c): its printed values, then layer 7's sublayers in order (CR 613.4).
 * 7a (characteristic-defining abilities), 7b (setting effects) and 7d (switching) have no effects in the pool yet.
 * 7c only adds and subtracts, so the order of its effects never changes the result, and none is sorted here; once 7a,
 * 7b or 7d exist, those sublayers apply in timestamp order (CR 613.7) and dependency order (CR 613.8).
 */
export function powerAndToughness(state: GameState, id: ObjectId, cards: CardDatabase): PT {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return { power: null, toughness: null };
  const printed = cards[obj.oracleId]?.printed;
  const isCreature = cardTypesOf(state, id, cards).includes("creature");
  const onBattlefield = state.zones.battlefield.includes(id);
  // A noncreature permanent has no power or toughness, even if printed; a noncreature card elsewhere has its printed
  // ones (CR 208.3).
  if (printed?.power == null || printed.toughness == null || (onBattlefield && !isCreature)) {
    return { power: null, toughness: null };
  }
  const bonus = layer7c(state, obj, isCreature, onBattlefield);
  return { power: printed.power + bonus.power, toughness: printed.toughness + bonus.toughness };
}

/**
 * Layer 7c (CR 613.4c): effects and counters that modify power and toughness, summed. Reached only for a creature,
 * or a noncreature card off the battlefield with printed values (so on the battlefield, it's a creature).
 */
function layer7c(
  state: GameState,
  obj: CardObject,
  isCreature: boolean,
  onBattlefield: boolean,
): { power: number; toughness: number } {
  const changes: { power: number; toughness: number }[] = [];
  // Continuous effects from resolved spells and abilities, on the objects they locked in (CR 611.2c).
  for (const effect of state.effects) {
    if (effect.change.kind === "modifyPT" && effect.affected.includes(obj.id)) changes.push(effect.change);
  }
  // +X/+Y and -X/-Y counters, on a creature or a creature card in another zone (CR 122.1a).
  for (const [name, count] of isCreature ? Object.entries(obj.counters) : []) {
    const pt = ptCounter(name);
    if (pt !== null) changes.push({ power: pt.power * count, toughness: pt.toughness * count });
  }
  // Rule modifiers: "creatures [player] controls get +N/+N" means creature permanents on the battlefield (CR 109.2).
  if (onBattlefield) {
    const controller = controllerOf(state, obj.id);
    for (const modifier of state.setup.ruleModifiers) {
      switch (modifier.kind) {
        case "creaturesGetPT":
          if (modifier.controller === controller) changes.push(modifier);
          break;
      }
    }
  }
  return changes.reduce((sum, c) => ({ power: sum.power + c.power, toughness: sum.toughness + c.toughness }), {
    power: 0,
    toughness: 0,
  });
}

/** A counter named like `+1/+1` or `-1/-1` (CR 122.1a), as numbers; null for any other counter. */
function ptCounter(name: string): { power: number; toughness: number } | null {
  const match = /^([+-]\d+)\/([+-]\d+)$/.exec(name);
  if (match === null) return null;
  return { power: Number(match[1]), toughness: Number(match[2]) };
}
