// Layer 7 of the layer pass (`layers.ts`): power and toughness (CR 613.4). The base comes from a characteristic-defining
// ability (7a), an effect that sets it (7b), or the printed values; then effects, static abilities, counters and rule
// modifiers add (7c). Switching them (7d) has no card yet.

import { cardDataOf } from "../cards/card-data.ts";
import type { CardDatabase, StaticAbilityDef } from "../cards/types.ts";
import type { ObjectId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import type { BasePT, Layered, LayerInputs, LayerSevenCChange } from "./layers.ts";
import { countOnBoard, type StaticPT } from "./static-effects.ts";

/**
 * Power and toughness (CR 613.4): a noncreature permanent has none, even if printed; a noncreature card elsewhere has
 * its printed ones (CR 208.3). The base is set by 7a, then 7b in timestamp order, else it's the printed values; then
 * 7c adds (7d has no effects yet). 7c only adds and subtracts, so its order never changes the result. `board` is the
 * pass so far, for 7a's counts.
 */
export function layerSeven(
  input: LayerInputs,
  board: Readonly<Record<ObjectId, Layered>>,
  obj: CardObject,
  card: Layered,
  onBattlefield: boolean,
  cards: CardDatabase,
  statics: readonly StaticPT[] = [],
): Layered {
  const isCreature = card.types.includes("creature");
  if (onBattlefield && !isCreature) return card;
  const found = layer7b(input, obj) ?? layer7a(input, board, card) ?? printedPT(cards, obj);
  // A creature with no value for its power or toughness (a land made a creature without one being set) has 0 (CR 208.5);
  // a noncreature card with none has none (CR 208.3).
  const base: BasePT | null = found ?? (isCreature ? { from: "none", power: 0, toughness: 0 } : null);
  if (base === null) return card;
  const sevenC = [
    ...layer7c(input, obj, card, isCreature, onBattlefield),
    ...statics.map((s): LayerSevenCChange => ({ kind: "static", ...s })),
  ];
  const bonus = sevenC.reduce((sum, c) => ({ power: sum.power + c.power, toughness: sum.toughness + c.toughness }), {
    power: 0,
    toughness: 0,
  });
  return { ...card, power: base.power + bonus.power, toughness: base.toughness + bonus.toughness, base, sevenC };
}

/** The printed power and toughness, or null when there are none (CR 208.1). */
function printedPT(cards: CardDatabase, obj: CardObject): BasePT | null {
  const printed = cardDataOf(obj, cards)?.printed;
  if (printed === undefined || printed.power === null || printed.toughness === null) return null;
  return { from: "printed", power: knownOrZero(printed.power), toughness: knownOrZero(printed.toughness) };
}

/**
 * Layer 7b (CR 613.4b): effects that set power and toughness ("becomes a 4/5"), on the objects they locked in
 * (CR 611.2c). In timestamp order (CR 613.7), `input.effects`' order, so the latest one's values stand.
 */
function layer7b(input: LayerInputs, obj: CardObject): BasePT | null {
  let base: BasePT | null = null;
  for (const effect of input.effects) {
    if (effect.change.kind !== "becomes" || effect.change.setPT === undefined) continue;
    if (!effect.affected.includes(obj.id)) continue;
    base = { from: "effect", source: effect.source, ...effect.change.setPT };
  }
  return base;
}

type DefinesPT = Extract<StaticAbilityDef, { kind: "powerToughnessEachEqual" }>;

/**
 * Layer 7a (CR 613.4a): a characteristic-defining ability's power and toughness, in every zone (CR 604.3), or null. "You"
 * is the object's controller, or its owner where it has none (CR 109.5). It counts what the board has after layers 1-6:
 * layer 7, which the pass finishes object by object, changes only power and toughness, and `ObjectFilter` has no field
 * that reads them, so the order the pass goes in can't change a count.
 */
function layer7a(input: LayerInputs, board: Readonly<Record<ObjectId, Layered>>, card: Layered): BasePT | null {
  const cda = card.statics.find((s): s is DefinesPT => s.kind === "powerToughnessEachEqual");
  if (cda === undefined) return null;
  if (cda.to === "yourLifeTotal") {
    // The kept pass now depends on the life totals (`layers.ts`).
    input.lifeRead.read = true;
    const life = input.life[card.controller] ?? 0;
    return { from: "ability", power: life, toughness: life };
  }
  const n = countOnBoard(input, board, cda.to.count, card.controller);
  return { from: "ability", power: n, toughness: n };
}

/**
 * A printed "*" is set by an ability, which every such card has (the definition check). Without one, it could only be 0
 * (the usual reading), which needs an effect that removes abilities first (later: CR 613.1f).
 */
function knownOrZero(printed: number | "*"): number {
  return printed === "*" ? 0 : printed;
}

/** Layer 7c (CR 613.4c): effects and counters that modify power and toughness, each with what it is. */
function layer7c(
  input: LayerInputs,
  obj: CardObject,
  card: Layered,
  isCreature: boolean,
  onBattlefield: boolean,
): LayerSevenCChange[] {
  const changes: LayerSevenCChange[] = [];
  // Continuous effects from resolved spells and abilities, on the objects they locked in (CR 611.2c).
  for (const effect of input.effects) {
    if (!effect.affected.includes(obj.id)) continue;
    switch (effect.change.kind) {
      case "modifyPT": {
        const { power, toughness } = effect.change;
        const { source, timestamp, duration } = effect;
        changes.push({ kind: "effect", source, timestamp, duration, power, toughness });
        break;
      }
      case "cantBlock":
      case "mustAttack":
      case "addKeywords":
      case "cantBeBlocked":
      case "cantCastSpells":
      case "gainControl":
      case "becomes":
        break;
    }
  }
  // +X/+Y and -X/-Y counters count on a creature or a creature card in another zone, not on a noncreature card
  // (CR 122.1a). In the engine today only permanents get counters (they don't move with a card, CR 122.2), but the CR
  // allows them elsewhere.
  for (const [name, count] of isCreature ? Object.entries(obj.counters) : []) {
    const pt = ptCounter(name);
    if (pt !== null)
      changes.push({
        kind: "counters",
        counter: name,
        count,
        power: pt.power * count,
        toughness: pt.toughness * count,
      });
  }
  // Rule modifiers: "creatures [player] controls get +N/+N" means creature permanents on the battlefield (CR 109.2).
  if (onBattlefield) {
    input.ruleModifiers.forEach((modifier, index) => {
      switch (modifier.kind) {
        case "creaturesGetPT":
          if (modifier.controller === card.controller)
            changes.push({ kind: "ruleModifier", index, power: modifier.power, toughness: modifier.toughness });
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
