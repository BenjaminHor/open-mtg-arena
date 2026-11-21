// Each card object's printed values (CR 613.1: where the layers start), with a controller. Shared by the layer pass
// (`layers.ts`) and the static abilities that read a card off the battlefield (`static-effects.ts`).

import { cardDataOf } from "../cards/card-data.ts";
import type { CardData, CardDatabase } from "../cards/types.ts";
import type { PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import type { Layered } from "./layers.ts";

/**
 * The printed values with a controller. Made once per card and controller and shared, as most permanents (lands) keep
 * them unchanged: the pass only ever copies a `Layered` to change it (measured, D-092).
 */
export function printedStart(obj: CardObject, controller: PlayerId, cards: CardDatabase): Layered {
  const data = cardDataOf(obj, cards);
  if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  const kept = startsKept.get(data) ?? {};
  const known = kept[controller];
  if (known !== undefined) return known;
  // Frozen, so changing a shared start in place throws rather than quietly changing every card that shares it: the
  // fresh pass shares these too, so the fuzzer's comparison couldn't catch it.
  const made = Object.freeze(printedWith(data, controller));
  startsKept.set(data, { ...kept, [controller]: made });
  return made;
}

const startsKept = new WeakMap<CardData, Partial<Record<PlayerId, Layered>>>();

function printedWith(data: CardData, controller: PlayerId): Layered {
  return {
    controller,
    supertypes: data.printed.supertypes,
    types: data.printed.types,
    subtypes: data.printed.subtypes,
    colors: data.printed.colors,
    keywords: data.def.keywords ?? [],
    protections: data.def.protections ?? [],
    statics: data.def.statics ?? [],
    power: null,
    toughness: null,
    base: null,
    sevenC: Object.freeze([]),
    granted: Object.freeze([]),
    cantAttackOrBlock: false,
    cantBeBlocked: false,
    cantActivate: false,
    doesntUntap: false,
    rulesTextLost: false,
  };
}
