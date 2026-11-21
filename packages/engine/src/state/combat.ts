// Combat (CR 506–511): who attacks whom, and who blocks what. Kept in `GameState.combat` during the combat phase.

import type { ObjectId, PlayerId } from "./ids.ts";
import type { Target } from "./objects.ts";

/**
 * A creature declared as an attacker; the defending player (CR 506.2); and, when it attacks a planeswalker that player
 * controls rather than the player, that planeswalker (CR 506.3, 508.1b; a battle, later: CR 310). `attacked` is left
 * out for an attack on the player, so a combat with no planeswalker is stored as before. Read what it attacks now
 * through `attackedNow` (rules/combat.ts): a planeswalker removed from combat is attacked no longer (CR 506.4c).
 */
export type Attack = { attacker: ObjectId; defender: PlayerId; attacked?: ObjectId };

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
   * The declarations a creature was removed from while it stayed on the battlefield (CR 506.4): regenerated
   * (CR 701.19a), no longer a creature, or now controlled by another player. Kept by role, so a creature removed as an
   * attacker can still be declared as a blocker later that combat, and block (CR 509.1a). One that left the battlefield
   * is out of combat anyway (`rules/combat.ts`).
   */
  removed: {
    attackers: ObjectId[];
    blockers: ObjectId[];
    /**
     * Attacked planeswalkers removed from combat while they stayed on the battlefield: no longer planeswalkers, or now
     * controlled by another player (CR 506.4). Present only once one is, so a combat with none is stored as before.
     */
    attacked?: ObjectId[];
  };
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
  return {
    attacks: [],
    blocks: [],
    removed: { attackers: [], blockers: [] },
    firstStrikers: null,
    secondDamageStep: false,
  };
}

/**
 * How a creature divides its combat damage among its recipients: an attacker's blockers, and with trample the player it
 * attacks (CR 510.1c, 702.19b).
 */
export type DamageDivision = { to: Target; amount: number }[];

/** The division chosen for one creature. */
export type CombatDivision = { source: ObjectId; division: DamageDivision };
