// Card data the engine is given (docs/card-scripting.md). It's input data: the engine never loads it itself
// and doesn't know where it came from (packages/cards builds it from Scryfall's Oracle data).
//
// This is a first draft (M1-04). The effect, cost and ability shapes will be reshaped by the tasks that
// interpret them (M1-08 mana, M1-10 effects, M1-14 activated abilities), see D-026.

import type { OracleId } from "../state/ids.ts";
import type { ManaType } from "../state/mana.ts";

/** Everything the engine knows about one card, keyed by `oracleId` in the `CardDatabase`. */
export type CardData = {
  oracleId: OracleId;
  printed: PrintedCard;
  def: CardDef;
};

export type CardDatabase = Record<OracleId, CardData>;

/**
 * The card's printed characteristics, as Oracle gives them. They're the starting point for `characteristics()`;
 * effects in the layer system change what applies (CR 613), never these values.
 */
export type PrintedCard = {
  name: string;
  /** Null when the card has no mana cost at all, as lands don't (CR 202.1b). That isn't the same as {0}. */
  manaCost: ManaCost | null;
  /** Its colors (CR 105.1, 202.2). Empty means colorless (CR 105.2c). */
  colors: Color[];
  supertypes: Supertype[]; // CR 205.4a
  types: CardType[]; // CR 205.2a
  /** Creature types, land types and so on (CR 205.3), as printed: "Goblin", "Mountain". */
  subtypes: string[];
  /** Null when the card has no power and toughness (CR 208.1, 302.4). */
  power: number | null;
  toughness: number | null;
};

/** The five colors (CR 105.1), by their mana symbol letters. */
export type Color = "W" | "U" | "B" | "R" | "G";

/** The supertypes (CR 205.4a). */
export type Supertype = "basic" | "legendary" | "ongoing" | "snow" | "world";

/** The card types that can be in a deck (CR 205.2a), leaving out the ones for other game variants. */
export type CardType =
  | "artifact"
  | "battle"
  | "creature"
  | "enchantment"
  | "instant"
  | "kindred"
  | "land"
  | "planeswalker"
  | "sorcery";

/** A mana cost: its mana symbols in printed order (CR 107.4). */
export type ManaCost = ManaSymbol[];

/** Only the symbols the current pool uses. Hybrid, Phyrexian, X and snow come with cards that need them. */
export type ManaSymbol =
  /** {1}, {2}, ...: generic mana, payable with any type (CR 107.4b). */
  | { kind: "generic"; amount: number }
  /** {W}, {U}, {B}, {R}, {G}: one mana of that color (CR 107.4). */
  | { kind: "colored"; color: Color };

/**
 * What a card does, written by hand next to its Oracle text so a person can check one against the other.
 * Card text and printed values come from the card data, not from here.
 */
export type CardDef = {
  /** Must match the card's Oracle name exactly. */
  name: string;
  /**
   * The exact Oracle text this definition was written against. A test compares it with the current card data,
   * so errata are caught (docs/card-scripting.md, "Errata are caught automatically").
   */
  oracle: string;
  keywords?: Keyword[];
  /** For instants and sorceries: what the spell does when it resolves (CR 608.2). */
  spell?: SpellDef;
  /** Activated abilities, in the order printed. `ACTIVATE_ABILITY.ability` and `abilityIndex` index this list. */
  abilities?: AbilityDef[];
};

/** Keyword abilities in the current pool (CR 702). */
export type Keyword =
  | "flying" // CR 702.9
  | "haste" // CR 702.10
  | "reach"; // CR 702.17

export type SpellDef = {
  /** One entry per instance of the word "target" (CR 601.2c), matching `StackChoices.targets`. */
  targets: TargetSpec[];
  effects: Effect[];
};

/**
 * An activated ability (CR 602): "[cost]: [effect]". Whether it's a mana ability isn't written here: the engine
 * works that out from the rules in CR 605.1a, so a definition can't get it wrong.
 */
export type AbilityDef = {
  kind: "activated";
  cost: CostPart[];
  targets: TargetSpec[];
  effects: Effect[];
};

/** One part of a cost (CR 118, 602.1a). */
export type CostPart =
  | { kind: "mana"; cost: ManaCost }
  /** {T}: "tap this permanent" (CR 107.5). */
  | { kind: "tap" };

/** What one instance of "target" may choose (CR 115). */
export type TargetSpec =
  /** "Any target": a creature, player, planeswalker or battle (CR 115.4). */
  { kind: "anyTarget" } | { kind: "creature" };

/** Which object or player an effect applies to. */
export type EffectSubject =
  /** The chosen target(s) for that instance of "target", by index into `targets`. */
  | { target: number }
  /** The object the ability or spell belongs to ("this creature"). */
  | "self";

export type Effect =
  /** "deals N damage to ..." (CR 120). The source is the spell or ability's object. */
  | { op: "dealDamage"; amount: number; to: EffectSubject }
  /** "Add {G}." (CR 106.4). */
  | { op: "addMana"; mana: ManaType; amount: number }
  /** "gets +N/+N until end of turn": a layer 7c effect (CR 613.4c) that ends in the cleanup step (CR 514.2). */
  | { op: "modifyPT"; power: number; toughness: number; of: EffectSubject; duration: "endOfTurn" };
