// What a spell or ability does to each thing it targets, read from its definition (card effects are data, so the AI
// reads them as a player reads the card's text): harm it (deal damage, destroy, tap, counter...), help it (pump, untap,
// regenerate...), or neither. A target is then worth choosing by how much that harm or help matters (`targets.ts`).

import type {
  AbilityRef,
  CardDatabase,
  CardDef,
  Effect,
  ObjectId,
  OracleId,
  SeatView,
  StaticAbilityDef,
} from "@mtg/engine";
import { cardDataByOracleId } from "@mtg/engine";
import { cardData } from "./board.ts";

export type Intent =
  | { kind: "harm"; damage: number | null }
  | { kind: "help"; untilEndOfTurn: boolean }
  /** A target the effect neither harms nor helps in a way the heuristic knows: any legal one will do. */
  | { kind: "neutral" };

const NEUTRAL: Intent = { kind: "neutral" };

/** What each instance of "target" in these effects is for, in order. */
export function effectIntents(targetCount: number, effects: readonly Effect[], x: number | null): Intent[] {
  return Array.from({ length: targetCount }, (_, i) => intentFor(i, effects, x));
}

function intentFor(index: number, effects: readonly Effect[], x: number | null): Intent {
  for (const effect of effects) {
    if (effect.op === "if") {
      const inner = intentFor(index, effect.effects, x);
      if (inner.kind !== "neutral") return inner;
      continue;
    }
    if (!mentionsTarget(effect, index)) continue;
    const intent = opIntent(effect, x);
    if (intent.kind !== "neutral") return intent;
  }
  return NEUTRAL;
}

/** Whether an effect names target `index` anywhere in its subjects (`{ target: i }`, `{ controllerOf: ... }`). */
function mentionsTarget(value: unknown, index: number): boolean {
  if (value === null || typeof value !== "object") return false;
  if ("target" in value && (value as { target: unknown }).target === index) return true;
  return Object.values(value).some((v) => mentionsTarget(v, index));
}

function opIntent(effect: Effect, x: number | null): Intent {
  switch (effect.op) {
    case "dealDamage": {
      const amount = effect.amount === "X" ? x : typeof effect.amount === "number" ? effect.amount : null;
      return { kind: "harm", damage: amount };
    }
    case "destroy":
    case "destroyOneAtRandom":
    case "exile":
    case "tap":
    case "returnToHand":
    case "putOnTopOfLibrary":
    case "gainControl":
    case "doesntUntap":
    case "cantBlock":
    case "counter":
    case "discard":
    case "discardAtRandom":
    case "loseLife":
    case "mill":
    case "sacrifice":
    case "cantCastSpells":
    case "mustAttack":
      return { kind: "harm", damage: null };
    case "modifyPT":
      return effect.power + effect.toughness >= 0
        ? { kind: "help", untilEndOfTurn: effect.duration === "endOfTurn" }
        : { kind: "harm", damage: null };
    case "putCounters":
      return effect.counter === "+1/+1" ? { kind: "help", untilEndOfTurn: false } : { kind: "harm", damage: null };
    case "gainKeywords":
    case "cantBeBlocked":
      return { kind: "help", untilEndOfTurn: effect.duration === "endOfTurn" };
    case "untap":
    case "regenerate":
    case "gainLife":
    case "draw":
    case "copySpell":
      return { kind: "help", untilEndOfTurn: false };
    default:
      return NEUTRAL;
  }
}

/** What an Aura does to the permanent it enchants, its one target as a spell (CR 303.4a), from its static abilities. */
export function auraIntent(def: CardDef): Intent {
  const statics: readonly StaticAbilityDef[] = def.statics ?? [];
  for (const s of statics) {
    switch (s.kind) {
      case "attachedGets":
        return s.power + s.toughness >= 0 ? { kind: "help", untilEndOfTurn: false } : { kind: "harm", damage: null };
      case "attachedRestricts":
      case "attachedControl":
      case "attachedSetsLandType":
        return { kind: "harm", damage: null };
      default:
        break;
    }
  }
  // An Aura with only an activated ability to grant (Firebreathing's kind) helps what it enchants.
  return { kind: "help", untilEndOfTurn: false };
}

/** What a card's spell does to each target, as cast from hand: an Aura's enchant target, or its spell's targets. */
export function cardIntents(def: CardDef, x: number | null): Intent[] {
  if (def.enchant !== undefined) return [auraIntent(def)];
  if (def.spell === undefined) return [];
  return effectIntents(def.spell.targets.length, def.spell.effects, x);
}

/** What an ability does to each target, by its definition. Equip helps the creature it targets (CR 702.6a). */
export function abilityIntents(ability: { targets: readonly unknown[]; effects: readonly Effect[] }, x: number | null) {
  return effectIntents(ability.targets.length, ability.effects, x);
}

/** What the spell or ability on the stack, being cast or activated, does to each of its targets. */
export function stackIntents(shown: SeatView, object: ObjectId, cards: CardDatabase): Intent[] {
  const seen = shown.seen[object];
  if (seen === undefined) return [];
  if (seen.kind === "card") {
    const def = cardData(seen, cards)?.def;
    return def === undefined ? [] : cardIntents(def, seen.choices?.x ?? null);
  }
  const ability = abilityText(seen.sourceOracleId, seen.ability, cards);
  return ability === null ? [] : abilityIntents(ability, seen.choices.x);
}

type AbilityText = { targets: readonly unknown[]; effects: readonly Effect[] };

function abilityText(source: OracleId, ref: AbilityRef, cards: CardDatabase): AbilityText | null {
  const def = cardDataByOracleId(source, cards)?.def;
  switch (ref.kind) {
    case "printed":
      return def?.abilities?.[ref.index] ?? null;
    case "triggered":
      return def?.triggers?.[ref.index] ?? null;
    case "delayed":
      return ref.ability;
    case "basicLandType":
      return null;
  }
}
