// A spell being cast (CR 601.2), kept in state so every pause in the procedure is plain data, and so the whole cast can
// be reversed if the player cancels (CR 734.1).

import type { ObjectId, PlayerId } from "./ids.ts";
import type { ManaPool } from "./mana.ts";
import type { CardObject } from "./objects.ts";

export type Casting = {
  player: PlayerId;
  /** The spell on the stack. */
  spell: ObjectId;
  /** To reverse the cast exactly (CR 734.1): the card as it was, where it was in the hand, and the pool before. */
  card: CardObject;
  handIndex: number;
  poolBefore: ManaPool;
  /** Permanents tapped for mana during this cast, which untap if it's reversed (CR 734.1). */
  tappedForMana: ObjectId[];
};
