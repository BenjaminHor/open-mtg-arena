// An object's characteristics now (CR 109.3), computed by the layer system (CR 613). Nothing stores them: every rules
// question about what an object is reads them through here or through the readers this composes.

import type { CardDatabase, CardType, Color, Keyword, Supertype } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { keywordsOf } from "./abilities.ts";
import { cardTypesOf, subtypesOf, supertypesOf } from "./card-types.ts";
import { controllerOf } from "./controller.ts";
import { powerAndToughness } from "./power-toughness.ts";

/**
 * What `characteristics()` returns. Strictly, an object's controller isn't a characteristic (CR 109.3), but it's
 * computed in the same layer pass (layer 2), so it's here too.
 */
export type Characteristics = {
  name: string;
  controller: PlayerId;
  supertypes: readonly Supertype[];
  types: readonly CardType[];
  subtypes: readonly string[];
  colors: readonly Color[];
  /** Keyword abilities (CR 702). Its activated abilities come from `abilitiesOf`. */
  keywords: readonly Keyword[];
  /** Null when it has none: it isn't a creature (CR 208.3, 302.4). */
  power: number | null;
  toughness: number | null;
};

/**
 * A card's characteristics: its printed values (CR 613.1), with continuous effects applied in layer order. Each layer
 * is one reader, applied in the CR's order, so a missing layer is added in its place:
 * 1 copy (none yet), 2 control (`controllerOf`), 3 text (none yet), 4 type (`supertypesOf`, `cardTypesOf`, `subtypesOf`),
 * 5 color (printed for now), 6 abilities (`keywordsOf`; activated ones from `abilitiesOf`), 7 power and toughness
 * (`powerAndToughness`). The controller is included by decision (D-022): CR 109.3 says it isn't a characteristic. An ability on the stack has no card, so
 * ask `controllerOf` for its controller instead.
 */
export function characteristics(state: GameState, id: ObjectId, cards: CardDatabase): Characteristics {
  const obj = state.objects[id];
  if (obj === undefined) throw new Error(`No object ${id}`);
  if (obj.kind !== "card") throw new Error(`${id} isn't a card: only cards have characteristics here`);
  const data = cards[obj.oracleId];
  if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  const { power, toughness } = powerAndToughness(state, id, cards);
  return {
    name: data.printed.name,
    controller: controllerOf(state, id),
    supertypes: supertypesOf(state, id, cards),
    types: cardTypesOf(state, id, cards),
    subtypes: subtypesOf(state, id, cards),
    colors: data.printed.colors,
    keywords: keywordsOf(state, id, cards),
    power,
    toughness,
  };
}
