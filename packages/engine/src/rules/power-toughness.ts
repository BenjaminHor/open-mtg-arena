// Power and toughness: layer 7 of the layer system (CR 613.4), as the board-wide pass computes it (`layers.ts`).

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { type LayerSevenCChange, layeredOf } from "./layers.ts";

export type { LayerSevenCChange } from "./layers.ts";

type PT = { power: number | null; toughness: number | null };

/** An object's power and toughness (CR 302.4c, 613.4): null for a noncreature permanent or anything without them. */
export function powerAndToughness(state: GameState, id: ObjectId, cards: CardDatabase): PT {
  const card = layeredOf(state, id, cards);
  return card === null ? { power: null, toughness: null } : { power: card.power, toughness: card.toughness };
}

/**
 * Each layer 7c change to an object's power and toughness, as the pass added them up: for explaining a value (the
 * CLI's `inspect`). Empty for an object with no power or toughness.
 */
export function layerSevenCChanges(state: GameState, id: ObjectId, cards: CardDatabase): readonly LayerSevenCChange[] {
  const card = layeredOf(state, id, cards);
  return card === null || card.power === null ? [] : card.sevenC;
}
