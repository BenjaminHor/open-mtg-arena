// Game objects (CR 109). Every card in a zone and every ability on the stack is an object.
//
// Objects store state, not derived characteristics. Power, toughness, types, abilities and the
// current controller come from `characteristics()` (CR 613), never from these fields directly.

import type { CardId, ObjectId, OracleId, PlayerId } from "./ids.ts";

export type GameObject = CardObject | AbilityObject;

/** Counters on an object or player, by name (`"+1/+1"`, `"poison"`). Absent means none (CR 122). */
export type Counters = Record<string, number>;

/** A card in some zone: in a library, a hand, a graveyard or exile, a spell on the stack, or a permanent. */
export type CardObject = {
  kind: "card";
  id: ObjectId;
  /** The physical card. The same across zone changes, unlike `id` (CR 400.7). */
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
   * enters a zone (CR 613.7d), and later rules give it new ones (attaching, turning face up, CR 613.7e–g).
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
  /** The choices made while casting it, while it's a spell on the stack (CR 601.2b–c). Otherwise null. */
  choices: StackChoices | null;
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
  /**
   * Which of that card's abilities this is, as indexed in its card definition. Abilities granted by effects
   * (layer 6) and delayed triggers (CR 603.7) will need a different reference when they arrive.
   */
  abilityIndex: number;
  /**
   * Its controller (CR 113.8): who activated it, or for a triggered ability, who controlled its source when it
   * triggered. Read the current controller through `characteristics()`.
   */
  baseController: PlayerId;
  timestamp: number;
  /** The choices made while activating it (CR 602.2b, which follows CR 601.2b–c). */
  choices: StackChoices;
};

/** Choices announced while casting a spell or activating an ability (CR 601.2b–c), kept on the stack object. */
export type StackChoices = {
  /** The chosen modes of a modal spell (CR 700.2), as indexes. Empty when not modal. */
  modes: number[];
  /** The value announced for X (CR 107.3), or null when there is no X. */
  x: number | null;
  /**
   * The chosen targets, grouped by each instance of the word "target" in the text, in the order the card lists
   * them (CR 601.2c). "Tap two target creatures" is one instance with two targets: `[[a, b]]`. The same object
   * can't appear twice within one instance, but can across instances.
   */
  targets: Target[][];
};

/** A chosen target: a player or an object (CR 115.1). */
export type Target = { kind: "player"; player: PlayerId } | { kind: "object"; object: ObjectId };
