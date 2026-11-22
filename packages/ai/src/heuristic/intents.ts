// What a spell or ability does to each thing it targets, read from its definition (card effects are data, so the AI
// reads them as a player reads the card's text): harm it (deal damage, destroy, tap, counter...), help it (pump, untap,
// regenerate...), or neither. A target is then worth choosing by how much that harm or help matters (`targets.ts`).
// The text read is the card's own, as printed: no effect in the pool grants or removes abilities from a card on the
// stack or in hand (later: read them from the seat view once one does).

import type {
  AbilityRef,
  CardDatabase,
  CardDef,
  Effect,
  EffectSubject,
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
const HARM: Intent = { kind: "harm", damage: null };
const HELP: Intent = { kind: "help", untilEndOfTurn: false };

/** What each instance of "target" in these effects is for, in order. */
export function effectIntents(targetCount: number, effects: readonly Effect[], x: number | null): Intent[] {
  return Array.from({ length: targetCount }, (_, i) => intentFor(i, effects, x));
}

function intentFor(index: number, effects: readonly Effect[], x: number | null): Intent {
  for (const effect of effects) {
    const { subjects, intent } = effectOn(effect, x, index);
    if (intent.kind !== "neutral" && subjects.some((s) => isTarget(s, index))) return intent;
  }
  return NEUTRAL;
}

/** "Target ...", "target creature's controller", "each creature target player controls": instance `index`. */
function isTarget(subject: EffectSubject, index: number): boolean {
  if (typeof subject !== "object") return false;
  if ("target" in subject) return subject.target === index;
  if ("controllerOf" in subject) return subject.controllerOf.target === index;
  if ("eachControlledBy" in subject) return subject.eachControlledBy.target === index;
  return false;
}

type EffectOn = { subjects: readonly EffectSubject[]; intent: Intent };

const NOTHING: EffectOn = { subjects: [], intent: NEUTRAL };

/** What one effect does, and to which of its subjects. A nested "if" answers for target `index` from inside. */
function effectOn(effect: Effect, x: number | null, index: number): EffectOn {
  switch (effect.op) {
    case "dealDamage": {
      const damage = effect.amount === "X" ? x : typeof effect.amount === "number" ? effect.amount : null;
      return { subjects: [effect.to, ...(effect.and ?? []).map((a) => a.to)], intent: { kind: "harm", damage } };
    }
    case "destroy":
    case "exile":
    case "tap":
    case "returnToHand":
    case "putOnTopOfLibrary":
    case "gainControl":
    case "doesntUntap":
    case "cantBlock":
    case "counter":
    case "mustAttack":
    case "shuffleIntoLibraries":
      return { subjects: [effect.of], intent: HARM };
    case "destroyOneAtRandom":
      return { subjects: effect.among, intent: HARM };
    case "discard":
    case "discardAtRandom":
    case "loseLife":
    case "mill":
    case "sacrifice":
    case "cantCastSpells":
      return { subjects: [effect.who], intent: HARM };
    case "modifyPT": {
      const help = effect.power + effect.toughness >= 0;
      const intent = help ? { kind: "help" as const, untilEndOfTurn: effect.duration === "endOfTurn" } : HARM;
      return { subjects: [effect.of], intent };
    }
    case "putCounters":
      return { subjects: [effect.of], intent: effect.counter === "+1/+1" ? HELP : HARM };
    case "gainKeywords":
    case "cantBeBlocked":
      return { subjects: [effect.of], intent: { kind: "help", untilEndOfTurn: effect.duration === "endOfTurn" } };
    case "untap":
    case "regenerate":
    case "copySpell":
      return { subjects: [effect.of], intent: HELP };
    // Equip, "attach to target creature" (CR 702.6a): the creature gets what's attached.
    case "attachSelf":
      return { subjects: [effect.to], intent: HELP };
    case "gainLife":
    case "draw":
    case "extraTurn":
      return { subjects: [effect.who], intent: HELP };
    case "if": {
      const inner = intentFor(index, effect.effects, x);
      return inner.kind === "neutral" ? NOTHING : { subjects: [{ target: index }], intent: inner };
    }
    // What these do to a target depends on the card more than the heuristic weighs yet.
    case "addMana":
    case "createTokens":
    case "becomes":
    case "sacrificeSource":
    case "preventAllDamage":
    case "revealUntil":
    case "revealHand":
    case "putOntoBattlefield":
    case "returnAllToBattlefield":
    case "search":
    case "nameCard":
    case "reveal":
    case "put":
    case "revealTop":
    case "mayPlayWithoutPaying":
    case "shuffle":
    case "lookAtTop":
    case "choose":
    case "exileAll":
    case "createDelayedTrigger":
      return NOTHING;
  }
}

/** What an Aura does to the permanent it enchants, its one target as a spell (CR 303.4a), from its static abilities. */
export function auraIntent(def: CardDef): Intent {
  for (const s of def.statics ?? []) {
    const intent = attachedIntent(s);
    if (intent !== null) return intent;
  }
  // An Aura with only an activated ability (Firebreathing) helps what it enchants.
  return HELP;
}

function attachedIntent(s: StaticAbilityDef): Intent | null {
  switch (s.kind) {
    case "attachedGets":
      return s.power + s.toughness >= 0 ? HELP : HARM;
    case "attachedRestricts":
    case "attachedControl":
    case "attachedSetsLandType":
      return HARM;
    // Not about what it's attached to.
    case "attacksEachCombat":
    case "canBlockAnyNumber":
    case "cantAttackOrBlockAlone":
    case "cantAttackUnlessDefenderControls":
    case "cantBeBlocked":
    case "cantBeCountered":
    case "cantLoseOpponentsCantWin":
    case "chosenNameCantActivate":
    case "creaturesGet":
    case "mustBeBlockedByAllAble":
    case "noMaximumHandSize":
    case "playWithRevealed":
    case "plusPerOtherSameName":
    case "plusPerSharedCreatureType":
    case "powerToughnessEachEqual":
      return null;
  }
}

/** What a card's spell does to each target, as cast from hand: an Aura's enchant target, or its spell's targets. */
export function cardIntents(def: CardDef, x: number | null): Intent[] {
  if (def.enchant !== undefined) return [auraIntent(def)];
  if (def.spell === undefined) return [];
  return effectIntents(def.spell.targets.length, def.spell.effects, x);
}

type AbilityText = { targets: readonly unknown[]; effects: readonly Effect[] };

/** What an ability does to each target, by its definition. */
export function abilityIntents(ability: AbilityText, x: number | null): Intent[] {
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
