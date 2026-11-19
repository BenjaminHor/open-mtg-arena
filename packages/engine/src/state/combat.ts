// Combat (CR 506–511): who attacks whom, and who blocks what. Kept in `GameState.combat` during the combat phase.

import type { ObjectId, PlayerId } from "./ids.ts";

/**
 * A creature declared as an attacker, and the player it attacks (CR 506.3; a choice of defenders, later: CR 508.1b).
 */
export type Attack = { attacker: ObjectId; defender: PlayerId };

/** A creature declared as a blocker, and the attacking creature it blocks (CR 509.1a). */
export type Block = { blocker: ObjectId; attacker: ObjectId };

export type Combat = {
  /**
   * Every creature declared as an attacker this combat (CR 508.1), even if it has since left combat: "declared" is what
   * CR 508.8 asks. Whether it's still attacking is read from the battlefield (CR 506.4), through `rules/combat.ts`.
   */
  attacks: Attack[];
  /** Every block declared (CR 509.1g). Empty until blockers are declared. */
  blocks: Block[];
};

/** How an attacker blocked by several creatures divides its combat damage among them (CR 510.1c). */
export type DamageDivision = { blocker: ObjectId; amount: number }[];

/** The division chosen for one attacker. */
export type AttackerDivision = { attacker: ObjectId; division: DamageDivision };
