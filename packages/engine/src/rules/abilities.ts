// An object's abilities as it has them now: keywords, static abilities that aren't keywords, replacement effects,
// triggered and activated abilities, with which of those are mana abilities.

import { cardDataByOracleId, cardDataOf, copiableData } from "../cards/card-data.ts";
import type { TriggeredAbilityDef } from "../cards/triggers.ts";
import type {
  AbilityDef,
  CardData,
  CardDatabase,
  Effect,
  Keyword,
  ReplacementDef,
  StaticAbilityDef,
  TargetSpec,
} from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, OracleId } from "../state/ids.ts";
import type { ManaType } from "../state/mana.ts";
import type { AbilityRef, BasicLandType, Copiable } from "../state/objects.ts";
import type { TriggerRef } from "../state/triggers.ts";
import { cardTypesOf, subtypesOf } from "./card-types.ts";
import { layeredOf } from "./layers.ts";
import { isLoyaltyAbility } from "./loyalty.ts";

export type ActivatedAbility = { ref: AbilityRef; def: AbilityDef };

/**
 * An object's keyword abilities (CR 702): layer 6 of the layer pass (`layers.ts`), printed ones and those granted by
 * resolved effects and static abilities (D-093), less those removed ("loses flying", D-103), in timestamp order.
 */
export function keywordsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly Keyword[] {
  return layeredOf(state, id, cards)?.keywords ?? [];
}

const BASIC_LAND_MANA: Record<BasicLandType, ManaType> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

/**
 * The static abilities an object has now that aren't keywords (CR 604): the ones written on its card, unless a set land
 * type took them away (CR 305.7, in the layer pass). Granting them by effects (later: CR 613.1f) will change this list.
 */
export function staticAbilitiesOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly StaticAbilityDef[] {
  return layeredOf(state, id, cards)?.statics ?? [];
}

/**
 * The replacement effects an object's own text makes (CR 614.1), in any zone: each kind says where it works
 * (CR 113.6b, 113.6h), and `pipeline/replacements.ts` checks that. Then a planeswalker's intrinsic one, entering with
 * its printed loyalty (CR 306.5b), last, so the written ones keep their places. A land whose subtype was set has none
 * of the written ones (CR 305.7). Abilities granted by effects (later: CR 613.1f) will change this list, in this one place.
 */
export function replacementsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly ReplacementDef[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  const data = cardDataOf(obj, cards);
  // A land whose subtype was set has lost its rules text's abilities, replacements too (CR 305.7). Only a card with
  // some asks the layer pass: this runs for every object an event moves (measured).
  const own = data?.def.replacements ?? [];
  const written = own.length > 0 && rulesTextLost(state, id, cards) ? [] : own;
  return withIntrinsic(written, data);
}

/**
 * The replacement effects in the text a permanent enters as a copy of (CR 614.12, 707.5): "enters with" and "as this
 * enters" in the copied text apply as it enters, and its printed loyalty.
 */
export function copiedReplacements(copied: Copiable, cards: CardDatabase): readonly ReplacementDef[] {
  const data = copiableData(copied, cards);
  return withIntrinsic(data?.def.replacements ?? [], data);
}

/** Written replacements, then a planeswalker's entering with its printed loyalty (CR 306.5b). */
function withIntrinsic(written: readonly ReplacementDef[], data: CardData | undefined): readonly ReplacementDef[] {
  const loyalty = data?.printed.loyalty;
  return loyalty === undefined ? written : [...written, { kind: "entersWithLoyalty", loyalty }];
}

/**
 * The activated abilities an object has now: the ones written on its card, in printed order (none on a land whose
 * subtype was set, CR 305.7), then the intrinsic "{T}: Add [mana]" of each of its basic land types (CR 305.6).
 * Abilities granted by effects (layer 6, none yet) will change this list, in this one place.
 */
export function abilitiesOf(state: GameState, id: ObjectId, cards: CardDatabase): ActivatedAbility[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  // A land whose subtype was set has only its basic land types' mana abilities (CR 305.7). Only a card with written
  // ones asks the layer pass: this runs for every permanent at every priority (measured).
  const own = cardDataOf(obj, cards)?.def.abilities ?? [];
  if (own.length > 0 && rulesTextLost(state, id, cards)) return basicLandAbilities(state, id, cards);
  const printed = own.map((def, index) => ({
    ref: { kind: "printed", index } as const,
    def,
  }));
  return [...printed, ...basicLandAbilities(state, id, cards)];
}

/** Whether a land's set subtype took away its rules text's abilities (CR 305.7, `land-type.ts`). */
function rulesTextLost(state: GameState, id: ObjectId, cards: CardDatabase): boolean {
  return layeredOf(state, id, cards)?.rulesTextLost === true;
}

/** CR 305.6: an object with the land card type and a basic land type has "{T}: Add [mana symbol]". */
function basicLandAbilities(state: GameState, id: ObjectId, cards: CardDatabase): ActivatedAbility[] {
  if (!cardTypesOf(state, id, cards).includes("land")) return [];
  return subtypesOf(state, id, cards)
    .filter((t): t is BasicLandType => Object.hasOwn(BASIC_LAND_MANA, t))
    .map((landType) => BASIC_LAND_ABILITY[landType]);
}

/** Made once: legal actions list every land's abilities at every priority (measured, D-092). */
const BASIC_LAND_ABILITY: Readonly<Record<BasicLandType, ActivatedAbility>> = {
  Plains: tapForMana("Plains"),
  Island: tapForMana("Island"),
  Swamp: tapForMana("Swamp"),
  Mountain: tapForMana("Mountain"),
  Forest: tapForMana("Forest"),
};

/** Frozen throughout, as every caller shares it (and actions carry its `ref`): a change in place throws. */
function tapForMana(landType: BasicLandType): ActivatedAbility {
  return deepFrozen<ActivatedAbility>({
    ref: { kind: "basicLandType", landType },
    def: {
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: BASIC_LAND_MANA[landType], amount: 1 }],
    },
  });
}

/** Freezes plain data and everything inside it. */
function deepFrozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFrozen(inner);
    Object.freeze(value);
  }
  return value;
}

/**
 * CR 605.1a: an activated ability is a mana ability if it doesn't require a target, could add mana when it resolves,
 * isn't a loyalty ability (no loyalty symbol in its cost, CR 606.2), and its cost and effect don't move a card to or
 * from a library. No effect moves library cards, so that one always holds for now. Triggered mana abilities
 * (later: CR 605.1b) will be a separate check. Worked out from the definition, so a definition can't get it wrong (D-026).
 */
export function isManaAbility(def: AbilityDef): boolean {
  return (
    def.kind === "activated" &&
    def.targets.length === 0 &&
    !isLoyaltyAbility(def) &&
    def.effects.some((e) => e.op === "addMana")
  );
}

/**
 * The definition of an ability on the stack, read from its source's card (`sourceOracleId`), never from the source
 * itself: the source may have left the battlefield, and the ability resolves anyway (CR 113.7a).
 */
export function stackAbilityDef(state: GameState, id: ObjectId, cards: CardDatabase): AbilityDef {
  const obj = state.objects[id];
  if (obj?.kind !== "ability") throw new Error(`${id} isn't an ability on the stack`);
  switch (obj.ability.kind) {
    case "printed": {
      const def = cardDataByOracleId(obj.sourceOracleId, cards)?.def.abilities?.[obj.ability.index];
      if (def === undefined) throw new Error(`No ability ${obj.ability.index} on ${obj.sourceOracleId}`);
      return def;
    }
    case "basicLandType":
      // A mana ability never uses the stack (CR 605.3b): finding one here is an engine bug.
      throw new Error("A basic land's mana ability can't be on the stack");
    case "triggered":
    case "delayed":
      throw new Error("A triggered ability has no activation cost: read it with stackAbilityText");
  }
}

/**
 * What an ability on the stack does: its targets and effects, read from its source's card like `stackAbilityDef`, for
 * an activated or a triggered ability (CR 113.7a).
 */
export function stackAbilityText(
  state: GameState,
  id: ObjectId,
  cards: CardDatabase,
): { targets: readonly TargetSpec[]; effects: readonly Effect[] } {
  const obj = state.objects[id];
  if (obj?.kind !== "ability") throw new Error(`${id} isn't an ability on the stack`);
  const ref = obj.ability;
  return isTriggerRef(ref) ? triggeredAbilityDef(obj.sourceOracleId, ref, cards) : stackAbilityDef(state, id, cards);
}

/** Whether the reference names a triggered ability: printed on a card, or delayed (CR 603.7). */
export function isTriggerRef(ref: AbilityRef): ref is TriggerRef {
  return ref.kind === "triggered" || ref.kind === "delayed";
}

/**
 * A triggered ability that already triggered (a pending trigger, an ability on the stack): by its card and index, or
 * a delayed one's own text (CR 603.7). Detection reads the triggers a permanent has now through `triggersOf`; granted
 * triggered abilities (layer 6, later: CR 613.1f) will need another kind of reference, resolved here.
 */
export function triggeredAbilityDef(oracleId: OracleId, ref: TriggerRef, cards: CardDatabase): TriggeredAbilityDef {
  switch (ref.kind) {
    case "delayed":
      return ref.ability;
    case "triggered": {
      const def = cardDataByOracleId(oracleId, cards)?.def.triggers?.[ref.index];
      if (def === undefined) throw new Error(`No triggered ability ${ref.index} on ${oracleId}`);
      return def;
    }
  }
}

/**
 * The triggered abilities an object has now (CR 603): the ones written on its card, with their index. Abilities granted
 * or removed by effects (layer 6, later: CR 613.1f, 603.6b) will change this list, in this one place.
 */
export function triggersOf(
  state: GameState,
  id: ObjectId,
  cards: CardDatabase,
): readonly { index: number; def: TriggeredAbilityDef }[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  // None on a land whose subtype was set (CR 305.7); only a card with some asks the layer pass, as this runs for every
  // permanent after every event (measured).
  const own = cardDataOf(obj, cards)?.def.triggers ?? [];
  if (own.length === 0 || rulesTextLost(state, id, cards)) return [];
  return own.map((def, index) => ({ index, def }));
}

/** The ability of this object that `ref` names, or null if it has none. */
export function findAbility(
  state: GameState,
  id: ObjectId,
  ref: AbilityRef,
  cards: CardDatabase,
): ActivatedAbility | null {
  return abilitiesOf(state, id, cards).find((a) => sameAbilityRef(a.ref, ref)) ?? null;
}

/** Whether two references name the same ability, whatever the order of their keys. */
export function sameAbilityRef(a: AbilityRef, b: AbilityRef): boolean {
  switch (a.kind) {
    case "printed":
      return b.kind === "printed" && a.index === b.index;
    case "basicLandType":
      return b.kind === "basicLandType" && a.landType === b.landType;
    case "triggered":
      return b.kind === "triggered" && a.index === b.index;
    case "delayed":
      // The same text and the same remembered objects: delayed triggers made by the same effect are interchangeable.
      // Compared as JSON, which depends on key order: safe, as both are copies of the same definition object.
      return (
        b.kind === "delayed" &&
        JSON.stringify(a.ability) === JSON.stringify(b.ability) &&
        JSON.stringify(a.objects ?? []) === JSON.stringify(b.objects ?? [])
      );
  }
}
