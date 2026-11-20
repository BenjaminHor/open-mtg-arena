// State-based actions (CR 704), as data: what a check found, before it's performed. Events carry them.

import type { ObjectId, PlayerId } from "./ids.ts";

export type StateBasedAction =
  /** CR 704.5a: a player with 0 or less life loses. */
  | { kind: "zeroLife"; player: PlayerId }
  /** CR 704.5b: a player who attempted to draw from an empty library since the last check loses. */
  | { kind: "drewFromEmptyLibrary"; player: PlayerId }
  /** CR 704.5f: a creature with toughness 0 or less is put into its owner's graveyard. */
  | { kind: "zeroToughness"; object: ObjectId }
  /** CR 704.5g: a creature with toughness above 0 and lethal damage marked on it is destroyed. */
  | { kind: "lethalDamage"; object: ObjectId }
  /** CR 704.5h: a creature with toughness above 0 dealt damage by a deathtouch source since the last check is destroyed. */
  | { kind: "deathtouchDamage"; object: ObjectId };
