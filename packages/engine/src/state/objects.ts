// Game objects (CR 109). Every card in a zone and every ability on the stack is an object.
//
// Objects store state, not derived characteristics. Power, toughness, types, abilities and the
// current controller come from `characteristics()` (CR 613), never from these fields directly.

import type { TriggeredAbilityDef } from "../cards/triggers.ts";
import type { CardData } from "../cards/types.ts";
import type { CardId, ObjectId, OracleId, PlayerId } from "./ids.ts";
import type { TriggerEvent } from "./triggers.ts";

export type GameObject = CardObject | AbilityObject;

/** Counters on an object, by name (`"+1/+1"`). A name that isn't there means none (CR 122). */
export type Counters = Record<string, number>;

/** A card in some zone: in a library, a hand, a graveyard or exile, a spell on the stack, or a permanent. */
export type CardObject = {
  kind: "card";
  id: ObjectId;
  /** The physical card. The same across zone changes, unlike `id` (CR 400.7), except out of hiding (D-054). */
  cardId: CardId;
  /** Which card this is. Printed values come from the `CardDatabase` entry (D-022). */
  oracleId: OracleId;
  /** The player who started the game with it in their deck (CR 108.3). */
  owner: PlayerId;
  /**
   * The default controller of a permanent (CR 110.2: the player it entered the battlefield under) or a spell
   * (CR 112.2: the player who cast it). Cards in other zones have no controller (CR 108.4); anything that asks
   * uses the owner (CR 108.4a). Don't read this field to find the controller: use `characteristics()`, which
   * handles all of that and control-changing effects (layer 2).
   */
  baseController: PlayerId;
  /**
   * The object's current timestamp, for applying effects in timestamp order (CR 613.7). It gets one when it
   * enters a zone (CR 613.7d), and later rules give it new ones (attaching, CR 613.7e; turning face up, later: CR 613.7f–g).
   */
  timestamp: number;
  // The next three fields mean something only on the battlefield (CR 110.5d: only permanents have status).
  // A card that changes zones is a new object (CR 400.7), so they start fresh: untapped, no damage, false.
  /** Status (CR 110.5). Only tapped is supported so far; flipped, face down and phased out come later. */
  tapped: boolean;
  /** Damage marked on a permanent (CR 120.3e), removed in the cleanup step (CR 514.2). */
  damage: number;
  counters: Counters;
  /**
   * Whether it has been under its controller's control continuously since their most recent turn began
   * (CR 302.6, the "summoning sickness" rule). Set at the start of its controller's turn; false when it enters
   * the battlefield or changes control.
   */
  controlledSinceTurnStart: boolean;
  /**
   * The choices made while casting it, while it's a spell on the stack (CR 601.2c; modes, later: CR 700.2).
   * Otherwise null.
   */
  choices: StackChoices | null;
  /**
   * A token's characteristics, as the effect that created it defined them (CR 111.3): its "printed" values. Left out
   * for a card, whose come from the `CardDatabase`. Read through `cardDataOf`, never `cards[oracleId]`.
   */
  token?: CardData;
  /**
   * The object an Aura or Equipment on the battlefield is attached to (CR 303.4b, 301.5a). Left out when it's attached to
   * nothing. It goes stale when that object leaves (a new object, CR 400.7): read it through `attachedHost`.
   */
  attachedTo?: ObjectId;
  /** The card name chosen as it entered the battlefield (CR 614.12a; Pithing Needle). Left out when it chose none. */
  chosenName?: string;
  /** The basic land type chosen as it entered (CR 614.12a; Convincing Mirage). Left out when it chose none. */
  chosenLandType?: BasicLandType;
};

/** An activated or triggered ability on the stack (CR 113.1c, 405.1). It isn't a card and has no `cardId`. */
export type AbilityObject = {
  kind: "ability";
  id: ObjectId;
  /**
   * The object the ability came from (CR 113.7). It may have left its zone since, and then it's no longer in
   * `objects`: the ability still resolves on its own (CR 113.7a), so nothing here depends on finding it.
   */
  source: ObjectId;
  /** The source's card, so the ability's definition can be found even after the source is gone. */
  sourceOracleId: OracleId;
  /** Which of the source's abilities this is (D-028). */
  ability: AbilityRef;
  /**
   * Its controller (CR 113.8): who activated it, or for a triggered ability, who controlled its source when it
   * triggered. Read the current controller through `characteristics()`.
   */
  baseController: PlayerId;
  timestamp: number;
  /** The choices made while activating it (CR 602.2b, which follows CR 601.2c). */
  choices: StackChoices;
  /** For a triggered ability, what it knows of the event that triggered it (CR 603.2); null for an activated one. */
  trigger: TriggerEvent | null;
};

/**
 * Names one ability of an object, in a way that stays right when effects add or remove other abilities (D-028).
 * The object's current abilities come from `characteristics()`; each one carries the ref that names it.
 * Abilities granted by effects (layer 6) will add a kind when they arrive.
 */
export type AbilityRef =
  /** An ability written on the card: an index into its definition's `abilities`. */
  | { kind: "printed"; index: number }
  /** The intrinsic "{T}: Add [mana]" of a land with that basic land type (CR 305.6). */
  | { kind: "basicLandType"; landType: BasicLandType }
  /** A triggered ability written on the card: an index into its definition's `triggers` (CR 603). */
  | { kind: "triggered"; index: number }
  /**
   * A delayed triggered ability (CR 603.7): written on no card, but made by an effect as a spell or ability resolved,
   * so it carries its own text, and the objects that effect named ("destroy that creature", CR 603.7c) when it named
   * any (`objects` is left out otherwise: only a delayed ability that says "that creature" carries it).
   */
  | { kind: "delayed"; ability: TriggeredAbilityDef; objects?: ObjectId[] };

/** The basic land types (CR 205.3i), each with its intrinsic mana ability (CR 305.6). */
export type BasicLandType = "Plains" | "Island" | "Swamp" | "Mountain" | "Forest";

/** The basic land types (CR 205.3i), in WUBRG order. */
export const BASIC_LAND_TYPES: readonly BasicLandType[] = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

export function isBasicLandType(word: string): word is BasicLandType {
  return (BASIC_LAND_TYPES as readonly string[]).includes(word);
}

/**
 * Choices announced while casting a spell or activating an ability (CR 601.2c; modes, later: CR 700.2), kept on the
 * stack object.
 */
export type StackChoices = {
  /** The chosen modes of a modal spell (later: CR 700.2), as indexes. Empty when not modal. */
  modes: number[];
  /** The value announced for X (CR 107.3a), or null when there is no X. */
  x: number | null;
  /**
   * The chosen targets, grouped by each instance of the word "target" in the text, in the order the card lists
   * them (CR 601.2c). "Tap two target creatures" is one instance with two targets: `[[a, b]]`. The same object
   * can't appear twice within one instance, but can across instances.
   */
  targets: Target[][];
  /**
   * How an effect is divided among the targets of one instance, announced as it was cast (CR 601.2d): each share is
   * kept with its target, so a target that becomes illegal loses its own share and no other (CR 608.2b). Changing
   * targets will keep the division too (later: CR 115.7f). Null when nothing is divided.
   */
  division: Division | null;
};

/** One target's share of a divided effect. */
export type Share = { target: Target; amount: number };
export type Division = { instance: number; shares: Share[] };

/** A chosen target: a player or an object (CR 115.1). */
export type Target = { kind: "player"; player: PlayerId } | { kind: "object"; object: ObjectId };
