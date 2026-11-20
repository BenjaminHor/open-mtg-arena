// An object's abilities as it has them now: keywords, static abilities that aren't keywords, and activated abilities,
// with which of those are mana abilities.

import type { AbilityDef, CardDatabase, Keyword, StaticAbilityDef } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { ManaType } from "../state/mana.ts";
import type { AbilityRef, BasicLandType } from "../state/objects.ts";
import { cardTypesOf, subtypesOf } from "./card-types.ts";

export type ActivatedAbility = { ref: AbilityRef; def: AbilityDef };

/** An object's keyword abilities (CR 702): layer 6 of `characteristics()`, printed until effects grant or remove them. */
export function keywordsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly Keyword[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  return cards[obj.oracleId]?.def.keywords ?? [];
}

const BASIC_LAND_MANA: Record<BasicLandType, ManaType> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

/**
 * The static abilities an object has now that aren't keywords (CR 604): the ones written on its card. Abilities granted
 * or removed by effects (layer 6, later: CR 613.1f) will change this list, in this one place.
 */
export function staticAbilitiesOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly StaticAbilityDef[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  return cards[obj.oracleId]?.def.statics ?? [];
}

/**
 * The activated abilities an object has now: the ones written on its card, in printed order, then the intrinsic
 * "{T}: Add [mana]" of each of its basic land types (CR 305.6). Abilities granted or removed by effects (layer 6, none
 * yet) will change this list, in this one place.
 */
export function abilitiesOf(state: GameState, id: ObjectId, cards: CardDatabase): ActivatedAbility[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") return [];
  const printed = (cards[obj.oracleId]?.def.abilities ?? []).map((def, index) => ({
    ref: { kind: "printed", index } as const,
    def,
  }));
  return [...printed, ...basicLandAbilities(state, id, cards)];
}

/** CR 305.6: an object with the land card type and a basic land type has "{T}: Add [mana symbol]". */
function basicLandAbilities(state: GameState, id: ObjectId, cards: CardDatabase): ActivatedAbility[] {
  if (!cardTypesOf(state, id, cards).includes("land")) return [];
  return subtypesOf(state, id, cards)
    .filter((t): t is BasicLandType => Object.hasOwn(BASIC_LAND_MANA, t))
    .map((landType) => ({
      ref: { kind: "basicLandType", landType } as const,
      def: {
        kind: "activated",
        cost: [{ kind: "tap" }],
        targets: [],
        effects: [{ op: "addMana", mana: BASIC_LAND_MANA[landType], amount: 1 }],
      },
    }));
}

/**
 * CR 605.1a: an activated ability is a mana ability if it doesn't require a target, could add mana when it resolves,
 * isn't a loyalty ability, and its cost and effect don't move a card to or from a library. No loyalty abilities exist
 * yet and no effect moves library cards, so those two always hold for now. Triggered mana abilities (later: CR 605.1b)
 * will be a separate check. Worked out from the definition, so a definition can't get it wrong (D-026).
 */
export function isManaAbility(def: AbilityDef): boolean {
  return def.kind === "activated" && def.targets.length === 0 && def.effects.some((e) => e.op === "addMana");
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
      const def = cards[obj.sourceOracleId]?.def.abilities?.[obj.ability.index];
      if (def === undefined) throw new Error(`No ability ${obj.ability.index} on ${obj.sourceOracleId}`);
      return def;
    }
    case "basicLandType":
      // A mana ability never uses the stack (CR 605.3b): finding one here is an engine bug.
      throw new Error("A basic land's mana ability can't be on the stack");
  }
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
  }
}
