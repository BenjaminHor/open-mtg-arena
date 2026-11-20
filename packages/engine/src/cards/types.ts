// Card data the engine is given (docs/card-scripting.md). It's input data: the engine never loads it itself
// and doesn't know where it came from (packages/cards builds it from Scryfall's Oracle data).
//
// This is a first draft (M1-04). The effect, cost and ability shapes will be reshaped by the tasks that
// interpret them (M1-08 mana, M1-10 effects, M1-14 activated abilities, D-041), see D-026.

import type { Duration } from "../state/effects.ts";
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
  /** Null when the card has no mana cost at all; lands, for example, have none (CR 202.1b). That isn't {0}. */
  manaCost: ManaCost | null;
  /**
   * Its colors: the colors of the mana symbols in its mana cost (CR 202.2) plus its color indicator (CR 204.2).
   * Empty means colorless (CR 105.2c). Abilities that define color apply later, in layer 5 (later: CR 613.1e).
   */
  colors: Color[];
  /** The color indicator, if any (CR 204). Kept separately because copies copy it (later: CR 707.2). */
  colorIndicator: Color[];
  supertypes: Supertype[]; // CR 205.4a
  types: CardType[]; // CR 205.2a
  /** Creature types, land types and so on (CR 205.3), as printed: "Goblin", "Mountain". */
  subtypes: string[];
  /**
   * Null when the card has no power and toughness (CR 208.1). A noncreature permanent has none even if they're
   * printed (CR 208.3), so `characteristics()` decides whether these apply.
   */
  power: number | null;
  toughness: number | null;
};

/** The five colors (CR 105.1), by their mana symbol letters. */
export type Color = "W" | "U" | "B" | "R" | "G";

/** The supertypes (CR 205.4a), leaving out "ongoing", which only Archenemy schemes have (as with `CardType`). */
export type Supertype = "basic" | "legendary" | "snow" | "world";

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

/** A mana cost: its mana symbols in printed order (CR 202.1, 107.4). */
export type ManaCost = ManaSymbol[];

/** Only the symbols the current pool uses. Hybrid, Phyrexian and snow come with cards that need them. */
export type ManaSymbol =
  /** {1}, {2}, ...: generic mana, payable with any type (CR 107.4b). */
  | { kind: "generic"; amount: number }
  /** {X}: a number the caster announces (CR 107.3a), paid as that much generic mana. */
  | { kind: "x" }
  /** {W}, {U}, {B}, {R}, {G}: one mana of that color (CR 107.4a). */
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
  /**
   * Activated abilities, in the order printed. `{ kind: "printed", index }` refers to this list (D-028). Abilities the
   * rules give a card, such as a basic land's mana ability (CR 305.6), aren't written here.
   */
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
  /**
   * "This spell costs {1} more to cast for each target beyond the first" (Fireball): a cost increase, added to the total
   * cost once the targets are chosen (CR 601.2f). It doesn't change the mana cost or the mana value.
   */
  costIncrease?: { perTargetBeyondFirst: ManaCost };
};

/**
 * An activated ability (CR 602): "[cost]: [effect]". Activating it follows the casting steps (CR 602.2b). Whether it's a mana ability isn't written here: the engine
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
  | { kind: "tap" }
  /**
   * "Sacrifice a creature": one permanent its controller controls that fits `filter` (CR 701.21a). It's chosen once the
   * total cost is locked, before the mana abilities' window (CR 601.2g), and sacrificed with the mana (CR 601.2h).
   */
  | { kind: "sacrifice"; filter: ObjectFilter };

/**
 * What one instance of the word "target" may choose (CR 115), and how many (`count`, exactly one when left out).
 * "Target creature" is a `permanent` whose types include creature (CR 109.2, 115.2).
 */
export type TargetSpec = TargetKind & { count?: TargetCount };

export type TargetKind =
  /** "Any target": a creature, player, planeswalker or battle (CR 115.4). */
  | { kind: "anyTarget" }
  /** "Target player or planeswalker". */
  | { kind: "playerOrPlaneswalker" }
  /** "Target [filter] permanent", "target creature": an object on the battlefield (CR 115.2). */
  | { kind: "permanent"; filter: ObjectFilter }
  /** "Target [filter] spell": a spell on the stack, never an ability (CR 112.1) and never itself (CR 115.5). */
  | { kind: "spell"; filter: ObjectFilter }
  /** "Target [filter] card from your graveyard" or "from a graveyard": a zone, not control (CR 109.2a, 115.2). */
  | { kind: "cardInGraveyard"; graveyard: "yours" | "any"; filter: ObjectFilter };

/**
 * How many targets an instance takes: "one, two, or three target creatures" is 1 to 3, "up to three" 0 to 3, "any
 * number" 0 or more (`max: "any"`). A variable number is announced before the targets are chosen (CR 601.2c), and
 * zero is allowed when the text says so (CR 115.6).
 */
export type TargetCount = { min: number; max: number | "any" };

/**
 * Restrictions on an object, all of which must hold. Each list means "any of": `colors: ["W", "U"]` is "white and/or
 * blue", `notColors: ["B"]` is "nonblack", `notTypes: ["land"]` is "nonland". Read from its characteristics now
 * (CR 109.3, 613).
 */
export type ObjectFilter = {
  types?: CardType[];
  notTypes?: CardType[];
  colors?: Color[];
  notColors?: Color[];
  subtypes?: string[];
  /** "Target tapped creature". */
  tapped?: true;
  /** "Target attacking creature", "blocking", "attacking or blocking" (CR 506.4, 508.1k, 509.1g). */
  combat?: "attacking" | "blocking" | "attackingOrBlocking";
  /**
   * Relative to the spell's or ability's controller: "you control", "you don't control", "an opponent controls"
   * (they differ once teams exist, later: CR 102.3).
   */
  controller?: "you" | "notYou" | "opponent";
};

/** A number in an effect: written on the card, or X, the value announced as it was cast (CR 107.3a). */
export type Amount = number | "X";

/**
 * Which object or player an effect refers to. It's resolved to real ids when the effect begins, and a continuous
 * effect keeps those ids (CR 611.2c): if the object later changes zones, it's a new object and the effect no longer
 * applies to it (CR 400.7).
 */
export type EffectSubject =
  /** The chosen target(s) for that instance of "target", by index into `targets`. */
  | { target: number }
  /**
   * The object whose text this is: for a spell, the spell itself; for an ability on the stack, the ability's source
   * ("this creature"), using its last known information if it has left its zone (CR 113.7a, 608.2h).
   */
  | "self";

export type Effect =
  /** "[from] deals N damage to [to]" (CR 120). The text always says which object deals the damage (CR 120.2b). */
  | {
      op: "dealDamage";
      amount: Amount;
      from: EffectSubject;
      to: EffectSubject;
      /**
       * How `amount` is split among the targets of `to`. "Divided as you choose": each target's share is announced as
       * it's cast (CR 601.2d). "Divided evenly, rounded down": worked out as it resolves, among the targets still legal
       * (Fireball's rulings). Without it, each recipient is dealt `amount`.
       */
      divided?: "asYouChoose" | "evenly";
    }
  /** "Add {G}." (CR 106.4). */
  | { op: "addMana"; mana: ManaType; amount: number }
  /** "gets +N/+N until end of turn": a layer 7c effect (CR 613.4c) that ends in the cleanup step (CR 514.2). */
  | { op: "modifyPT"; power: number; toughness: number; of: EffectSubject; duration: Duration };
