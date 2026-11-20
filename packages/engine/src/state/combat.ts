// Combat (CR 506–511): who attacks whom, and who blocks what. Kept in `GameState.combat` during the combat phase.

import type { ObjectId, PlayerId } from "./ids.ts";
import type { Target } from "./objects.ts";

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
  /**
   * Creatures an effect removed from combat while they stayed on the battlefield: regenerated (CR 506.4, 701.19a).
   * One that left the battlefield is out of combat anyway (`rules/combat.ts`).
   */
  removed: ObjectId[];
  /**
   * The attacking and blocking creatures that had first strike or double strike as the first combat damage step began,
   * when any did (CR 510.4): then that step is a first strike step and a second one follows. Null otherwise.
   */
  firstStrikers: ObjectId[] | null;
  /** Whether the second combat damage step (CR 510.4) has begun. */
  secondDamageStep: boolean;
};

/** Combat as the combat phase begins (CR 506.1): no attackers or blockers yet. */
export function newCombat(): Combat {
  return { attacks: [], blocks: [], removed: [], firstStrikers: null, secondDamageStep: false };
}

/**
 * How a creature divides its combat damage among its recipients: an attacker's blockers, and with trample the player it
 * attacks (CR 510.1c, 702.19b).
 */
export type DamageDivision = { to: Target; amount: number }[];

/** The division chosen for one creature. */
export type CombatDivision = { source: ObjectId; division: DamageDivision };
