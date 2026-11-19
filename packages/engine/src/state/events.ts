// Events: what happened, returned by every engine call. They're the UI's animation script and the
// tests' and AI's record of the game. State can always be rebuilt without them.
//
// Each task adds the events it produces. Every visible change must produce one (docs/future-rules.md).

import type { CardId, ObjectId, PlayerId } from "./ids.ts";
import type { ManaPool, ManaType } from "./mana.ts";
import type { CardObject } from "./objects.ts";
import type { GameResult } from "./result.ts";
import type { Step } from "./turn.ts";
import type { ZoneRef } from "./zones.ts";

export type GameEvent =
  /**
   * An object moved between zones and became a new object (CR 400.7). `object` is the old object as it last
   * existed, so triggers that look back in time (CR 603.10) can use it later. Abilities never change zones: they
   * leave the stack and cease to exist. Events can carry hidden information (a drawn card's `oracleId`), so hosts
   * filter them per player before the UI or AI sees them, as `playerView` does for state.
   */
  | {
      type: "ZONE_CHANGED";
      from: ZoneRef;
      to: ZoneRef;
      oldId: ObjectId;
      newId: ObjectId;
      cardId: CardId;
      object: CardObject;
    }
  /** CR 103.1. `chosenBy` is null when the setup named the starting player. */
  | { type: "STARTING_PLAYER_CHOSEN"; player: PlayerId; chosenBy: PlayerId | null }
  | { type: "LIBRARY_SHUFFLED"; player: PlayerId } // CR 701.24
  /** A card drawn (CR 121.1), as well as its `ZONE_CHANGED`. Hidden from other players, like the card itself. */
  | { type: "CARD_DRAWN"; player: PlayerId; newId: ObjectId; cardId: CardId }
  | { type: "MULLIGAN_DECLARED"; player: PlayerId; choice: "keep" | "mulligan" } // CR 103.5
  | { type: "TURN_BEGAN"; turn: number; activePlayer: PlayerId }
  /**
   * A step began, or a main phase (which has no steps, CR 505.2): `Step` names both. Skipped steps don't begin
   * (CR 500.11).
   */
  | { type: "STEP_BEGAN"; turn: number; step: Step; activePlayer: PlayerId }
  | { type: "PRIORITY_PASSED"; player: PlayerId } // CR 117.3d
  /** A spell resolved (CR 608.1). Its card then moves to the battlefield or a graveyard (`ZONE_CHANGED`). */
  | { type: "SPELL_RESOLVED"; object: ObjectId; cardId: CardId; controller: PlayerId }
  /** An ability resolved and ceased to exist (CR 608.2n). */
  | { type: "ABILITY_RESOLVED"; object: ObjectId; source: ObjectId; controller: PlayerId }
  /** Unspent mana emptied from a pool as a step ended (CR 500.5). Only for pools that weren't empty. */
  | { type: "MANA_EMPTIED"; player: PlayerId; lost: ManaPool }
  | { type: "PERMANENT_UNTAPPED"; object: ObjectId } // CR 502.3
  | { type: "PERMANENT_TAPPED"; object: ObjectId } // CR 701.26a
  /** Mana added to a player's mana pool (CR 106.4), by an ability of `source` (for "tapped for mana" rules, CR 106.12). */
  | { type: "MANA_ADDED"; player: PlayerId; mana: ManaType; amount: number; source: ObjectId }
  /** Damage removed from a permanent in the cleanup step (CR 514.2). */
  | { type: "DAMAGE_REMOVED"; object: ObjectId; amount: number }
  /** A card discarded (CR 701.9), as well as its `ZONE_CHANGED`. */
  | { type: "CARD_DISCARDED"; player: PlayerId; newId: ObjectId; cardId: CardId }
  | { type: "PLAYER_CONCEDED"; player: PlayerId } // CR 104.3a
  | { type: "GAME_ENDED"; result: GameResult };
