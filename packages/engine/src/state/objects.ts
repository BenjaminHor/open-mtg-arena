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
   * The default controller (CR 110.2): the player it entered the battlefield under, or who cast it.
   * Don't read this to find the controller: use `characteristics()`, which applies control-changing effects (layer 2).
   */
  baseController: PlayerId;
  /** When the object entered its zone, for applying effects in timestamp order (CR 613.7). */
  timestamp: number;
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
  /** The object the ability came from (CR 113.7). It may have left its zone since. */
  source: ObjectId;
  /** Which of the source card's abilities this is, as indexed in its card definition. */
  abilityIndex: number;
  /** The player who activated it (CR 113.8). Read the current controller through `characteristics()`. */
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
  /** One entry per target requirement, in the order the card lists them (CR 601.2c). */
  targets: Target[];
};

/** A chosen target: a player or an object (CR 115.1). */
export type Target = { kind: "player"; player: PlayerId } | { kind: "object"; object: ObjectId };
