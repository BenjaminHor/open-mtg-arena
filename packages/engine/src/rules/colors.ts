// An object's colors (CR 105, 202.2, 204), the layer 5 reader of `characteristics()`. Effects that change color come
// later (later: CR 613.1e); until then these are the printed colors.

import type { CardDatabase, Color } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

export function colorsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly Color[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  const data = cards[obj.oracleId];
  if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  return data.printed.colors;
}
