// An object's activated abilities, and which of them are mana abilities.

import type { AbilityDef, CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { ManaType } from "../state/mana.ts";
import type { AbilityRef, BasicLandType } from "../state/objects.ts";
import { cardTypesOf, subtypesOf } from "./card-types.ts";

export type ActivatedAbility = { ref: AbilityRef; def: AbilityDef };

const BASIC_LAND_MANA: Record<BasicLandType, ManaType> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

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
 * yet and no effect moves library cards, so those two always hold for now. Triggered mana abilities (CR 605.1b) will
 * be a separate check. Worked out from the definition, so a definition can't get it wrong (D-026).
 */
export function isManaAbility(def: AbilityDef): boolean {
  return def.kind === "activated" && def.targets.length === 0 && def.effects.some((e) => e.op === "addMana");
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
