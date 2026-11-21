// An object's colors (CR 105, 202.2, 204), the layer 5 reader of `characteristics()`: printed, then changed by effects
// in the layer pass (`layers.ts`, D-095).

import type { CardDatabase, Color } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { layeredOf } from "./layers.ts";

export function colorsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly Color[] {
  const card = layeredOf(state, id, cards);
  if (card === null) throw new Error(`${id} isn't a card`);
  return card.colors;
}
