// Events: what happened, returned by every engine call. They're the UI's animation script and the
// tests' and AI's record of the game. State can always be rebuilt without them.
//
// Each task adds the events it produces. Every visible change must produce one (docs/future-rules.md).

import type { Attack, Block } from "./combat.ts";
import type { ContinuousEffect } from "./effects.ts";
import type { CardId, ObjectId, OracleId, PlayerId } from "./ids.ts";
import type { ManaPool, ManaType } from "./mana.ts";
import type { CardObject, Target } from "./objects.ts";
import type { GameResult, LossReason } from "./result.ts";
import type { StateBasedAction } from "./state-based-actions.ts";
import type { Step } from "./turn.ts";
import type { ZoneRef } from "./zones.ts";

/** Why a spell or ability didn't resolve. */
export type DidNotResolve = "illegalTargets" | "condition";

export type GameEvent =
  /**
   * An object moved between zones and became a new object (CR 400.7). `object` is the old object as it last
   * existed, so triggers that look back in time (later: CR 603.10) can use it later. Abilities never change zones: they
   * leave the stack and cease to exist. Events can carry hidden information (a drawn card's `oracleId`), so hosts
   * filter them per player before the UI or AI sees them, as `playerView` does for state. `cardId` is the card's id
   * before the move and `newCardId` after it: they differ when a card comes out of a hand or library into a public
   * zone (D-054), and the owner's UI follows the card by them.
   */
  | {
      type: "ZONE_CHANGED";
      from: ZoneRef;
      to: ZoneRef;
      oldId: ObjectId;
      newId: ObjectId;
      cardId: CardId;
      newCardId: CardId;
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
  | { type: "LAND_PLAYED"; player: PlayerId; newId: ObjectId; cardId: CardId } // CR 305.1
  /** Attackers were declared (CR 508.1), possibly none; emitted whenever the step's action happens, asked or not. */
  | { type: "ATTACKERS_DECLARED"; player: PlayerId; attacks: Attack[] }
  /** Blockers were declared (CR 509.1), possibly none; emitted whenever the step's action happens, asked or not. */
  | { type: "BLOCKERS_DECLARED"; player: PlayerId; blocks: Block[] }
  /** A spell became cast (CR 601.2i), with its targets chosen and costs paid. */
  | { type: "SPELL_CAST"; player: PlayerId; object: ObjectId; cardId: CardId }
  /**
   * The player cancelled a cast and it was reversed (D-035): the spell `spell` (with card id `cardId`) left the stack,
   * the card is back in hand as `restored`, exactly the object it was before the cast, and `untapped` untapped.
   * Nothing triggers from this (CR 734.1). Other players aren't shown `restored` (D-054).
   */
  | {
      type: "CAST_CANCELLED";
      player: PlayerId;
      cardId: CardId;
      spell: ObjectId;
      restored: ObjectId;
      untapped: ObjectId[];
    }
  /** An activated ability was put on the stack, with its targets chosen and costs paid (CR 602.2b, 601.2i). */
  | { type: "ABILITY_ACTIVATED"; player: PlayerId; object: ObjectId; source: ObjectId }
  /**
   * A triggered ability was put on the stack (CR 603.3), controlled by who controlled its source as it triggered
   * (CR 603.3a). Emitted as it goes on, before its targets are chosen; `ABILITY_ACTIVATED` comes after them.
   */
  | { type: "ABILITY_TRIGGERED"; object: ObjectId; source: ObjectId; controller: PlayerId }
  /** The player cancelled an activation (D-035): the ability ceased to exist and `untapped` untapped (CR 734.1). */
  | { type: "ACTIVATION_CANCELLED"; player: PlayerId; object: ObjectId; source: ObjectId; untapped: ObjectId[] }
  /**
   * The ability didn't resolve and was removed from the stack: every target was illegal (CR 608.2b), or a triggered
   * ability's "intervening if" was false (`condition`, CR 603.4, 608.2a).
   */
  | { type: "ABILITY_DID_NOT_RESOLVE"; object: ObjectId; source: ObjectId; reason: DidNotResolve }
  /** Every target was illegal, so the spell didn't resolve (CR 608.2b); it goes to its owner's graveyard. */
  | { type: "SPELL_DID_NOT_RESOLVE"; object: ObjectId; cardId: CardId }
  /** A spell resolved (CR 608.1). Its card then moves to the battlefield or a graveyard (`ZONE_CHANGED`). */
  | { type: "SPELL_RESOLVED"; object: ObjectId; cardId: CardId; controller: PlayerId }
  /** An ability resolved and ceased to exist (CR 608.2n). */
  | { type: "ABILITY_RESOLVED"; object: ObjectId; source: ObjectId; controller: PlayerId }
  /** Unspent mana emptied from a pool as a step ended (CR 500.5). Only for pools that weren't empty. */
  | { type: "MANA_EMPTIED"; player: PlayerId; lost: ManaPool }
  | { type: "PERMANENT_UNTAPPED"; object: ObjectId } // CR 502.3
  | { type: "PERMANENT_TAPPED"; object: ObjectId } // CR 701.26a
  /**
   * Mana added to a player's mana pool (CR 106.4), by an ability of `source`. "Tapped for mana" is its own event,
   * `TAPPED_FOR_MANA`, after the ability's tap and mana.
   */
  | { type: "MANA_ADDED"; player: PlayerId; mana: ManaType; amount: number; source: ObjectId }
  /**
   * `player` tapped `object` for mana: a mana ability with {T} in its cost resolved and produced mana (CR 106.12,
   * 106.12a). Emitted after its tap and mana, for "whenever a player taps a land for mana".
   */
  | { type: "TAPPED_FOR_MANA"; player: PlayerId; object: ObjectId }
  /**
   * `object` became a target of the spell or ability `by`, as its targets were chosen (CR 601.2c, 603.3d), for "when
   * this creature becomes the target of a spell or ability".
   */
  | { type: "BECAME_TARGET"; object: ObjectId; by: ObjectId }
  /**
   * `source` dealt damage to a player or creature (CR 120.1). Its result follows: `LIFE_LOST` for a player
   * (CR 120.3a); for a creature, the damage is marked on it (CR 120.3e).
   */
  | { type: "DAMAGE_DEALT"; source: ObjectId; to: Target; amount: number; combat: boolean }
  | { type: "LIFE_LOST"; player: PlayerId; amount: number } // CR 119.3
  | { type: "LIFE_GAINED"; player: PlayerId; amount: number } // CR 119.3
  /**
   * A spell was countered (CR 701.6a): it's moving to its owner's graveyard, or where a replacement sends it
   * (`ZONE_CHANGED` follows).
   */
  | { type: "SPELL_COUNTERED"; object: ObjectId; cardId: CardId }
  /** An ability was countered (CR 701.6a): it's removed from the stack and ceases to exist. */
  | { type: "ABILITY_COUNTERED"; object: ObjectId; source: ObjectId }
  /** A spell or ability created a continuous effect (CR 611.2). */
  | { type: "EFFECT_CREATED"; effect: ContinuousEffect }
  /** A continuous effect ended, as its duration ran out (CR 611.2a). */
  | { type: "EFFECT_ENDED"; effect: ContinuousEffect }
  /** Damage removed from a permanent: in the cleanup step (CR 514.2), or as it regenerates (CR 701.19a). */
  | { type: "DAMAGE_REMOVED"; object: ObjectId; amount: number }
  /** Damage prevented, so never dealt (CR 615.6): `by` is the card whose effect prevented it. */
  | { type: "DAMAGE_PREVENTED"; source: ObjectId; to: Target; amount: number; by: OracleId }
  /**
   * Damage that would have been dealt to `from` is dealt to `to` instead (CR 614.9), by the card `by`'s effect; the
   * damage event says what's dealt.
   */
  | { type: "DAMAGE_REDIRECTED"; source: ObjectId; from: Target; to: Target; amount: number; by: OracleId }
  /** A permanent regenerated instead of being destroyed (CR 701.19a): a shield used up, then the rest as events. */
  | { type: "PERMANENT_REGENERATED"; object: ObjectId }
  /**
   * Cards revealed to every player (CR 701.20a), by what they are only, in a fixed order: never their ids, which would
   * tell when and how they got there (D-062). They stay where they are (CR 701.20b).
   */
  | { type: "CARDS_REVEALED"; from: ZoneRef; cards: OracleId[] }
  /**
   * A card discarded (CR 701.9a), as well as its `ZONE_CHANGED`, named in the graveyard it went to. A replacement can send it somewhere hidden instead
   * (Darksteel Colossus, into a library): then `newId` and `cardId` are null, so no one can follow it there (D-054).
   */
  | { type: "CARD_DISCARDED"; player: PlayerId; newId: ObjectId | null; cardId: CardId | null }
  /** State-based actions performed together as one event (CR 704.3); their results follow. */
  | { type: "STATE_BASED_ACTIONS"; actions: StateBasedAction[] }
  /**
   * A permanent was sacrificed by `player` (CR 701.21a): it's moving to its owner's graveyard, or where a replacement
   * sends it (`ZONE_CHANGED` follows).
   */
  | { type: "PERMANENT_SACRIFICED"; object: ObjectId; cardId: CardId; player: PlayerId }
  /**
   * A permanent was destroyed (CR 701.8): it's moving to its owner's graveyard, or where a replacement sends it
   * (`ZONE_CHANGED` follows).
   */
  | { type: "PERMANENT_DESTROYED"; object: ObjectId; cardId: CardId }
  /**
   * A player lost the game (CR 104.3), including by conceding (reason `conceded`). `GAME_ENDED` follows when the game
   * is over.
   */
  | { type: "PLAYER_LOST"; player: PlayerId; reason: LossReason }
  | { type: "GAME_ENDED"; result: GameResult };
