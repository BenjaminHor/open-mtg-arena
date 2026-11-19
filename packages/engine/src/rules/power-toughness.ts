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
  if (printed === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  const isCreature = cardTypesOf(state, id, cards).includes("creature");
  const onBattlefield = state.zones.battlefield.includes(id);
  // A noncreature permanent has no power or toughness, even if printed; a noncreature card elsewhere has its printed
  // ones (CR 208.3).
  if (printed.power === null || printed.toughness === null || (onBattlefield && !isCreature)) {
    return { power: null, toughness: null };
  }
  const bonus = layer7c(state, obj, isCreature, onBattlefield).reduce(
    (sum, c) => ({ power: sum.power + c.power, toughness: sum.toughness + c.toughness }),
    { power: 0, toughness: 0 },
  );
  return { power: printed.power + bonus.power, toughness: printed.toughness + bonus.toughness };
}

/** What changes an object's power and toughness in layer 7c, and by how much (CR 613.4c). */
export type LayerSevenCChange =
  /** A continuous effect from a resolved spell or ability (CR 611.2), by its source and timestamp. */
  | { kind: "effect"; source: ObjectId; timestamp: number; power: number; toughness: number }
  /** All the counters of one kind on it (CR 122.1a). */
  | { kind: "counters"; counter: string; count: number; power: number; toughness: number }
  /** A rule modifier of the game (`GameSetup.ruleModifiers`, by index). */
  | { kind: "ruleModifier"; index: number; power: number; toughness: number };

/**
 * Each layer 7c change to an object's power and toughness, as `powerAndToughness` adds them up: for explaining a value
 * (the CLI's `inspect`). Empty for an object with no power or toughness.
 */
export function layerSevenCChanges(state: GameState, id: ObjectId, cards: CardDatabase): LayerSevenCChange[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || powerAndToughness(state, id, cards).power === null) return [];
  const onBattlefield = state.zones.battlefield.includes(id);
  return layer7c(state, obj, cardTypesOf(state, id, cards).includes("creature"), onBattlefield);
}

/**
 * Layer 7c (CR 613.4c): effects and counters that modify power and toughness, each with what it is. Reached only for a creature,
 * or a noncreature card off the battlefield with printed values (so on the battlefield, it's a creature).
 */
function layer7c(state: GameState, obj: CardObject, isCreature: boolean, onBattlefield: boolean): LayerSevenCChange[] {
  const changes: LayerSevenCChange[] = [];
  // Continuous effects from resolved spells and abilities, on the objects they locked in (CR 611.2c).
  for (const effect of state.effects) {
    if (!effect.affected.includes(obj.id)) continue;
    switch (effect.change.kind) {
      case "modifyPT": {
        const { power, toughness } = effect.change;
        changes.push({ kind: "effect", source: effect.source, timestamp: effect.timestamp, power, toughness });
        break;
      }
    }
  }
  // +X/+Y and -X/-Y counters count on a creature or a creature card in another zone, not on a noncreature card
  // (CR 122.1a). In the engine today only permanents get counters (they don't move with a card, CR 122.2), but the CR
  // allows them elsewhere.
  for (const [name, count] of isCreature ? Object.entries(obj.counters) : []) {
    const pt = ptCounter(name);
    if (pt !== null) {
      changes.push({
        kind: "counters",
        counter: name,
        count,
        power: pt.power * count,
        toughness: pt.toughness * count,
      });
    }
  }
  // Rule modifiers: "creatures [player] controls get +N/+N" means creature permanents on the battlefield (CR 109.2).
  if (onBattlefield) {
    const controller = controllerOf(state, obj.id);
    state.setup.ruleModifiers.forEach((modifier, index) => {
      switch (modifier.kind) {
        case "creaturesGetPT":
          if (modifier.controller === controller) {
            changes.push({ kind: "ruleModifier", index, power: modifier.power, toughness: modifier.toughness });
          }
          break;
      }
    });
  }
  return changes;
}

/** A counter named like `+1/+1` or `-1/-1` (CR 122.1a), as numbers; null for any other counter. */
function ptCounter(name: string): { power: number; toughness: number } | null {
  const match = /^([+-]\d+)\/([+-]\d+)$/.exec(name);
  if (match === null) return null;
  return { power: Number(match[1]), toughness: Number(match[2]) };
}
