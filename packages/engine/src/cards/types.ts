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
  /**
   * "Spend only black mana on X" (Consume Spirit): a restriction on paying (CR 601.2h), so only the cost to pay makes
   * each X a mana of this color; the mana cost itself, its color and its mana value don't change (CR 107.4b, 202.2).
   */
  xPaidWith?: Color;
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
  | { kind: "sacrifice"; filter: ObjectFilter }
  /** "Sacrifice this land": the source itself, paid with the rest of the cost, after {T} (CR 602.2, 701.21a; D-059). */
  | { kind: "sacrificeSelf" };

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
  /** "Target player" (CR 115.1a). */
  | { kind: "player" }
  /** "Target opponent": a player who's an opponent of the controller, "you" (CR 115.1a, 102.2; later: CR 102.3). */
  | { kind: "opponent" }
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
  /**
   * "Creature with flying" / "without flying": keyword abilities, as computed (`keywordsOf`, CR 702.9a). `keywords`
   * means any of them; `notKeywords`, none of them. "With flying and first strike" would need an all-of form.
   */
  keywords?: Keyword[];
  notKeywords?: Keyword[];
  /** "Basic land card": supertypes (CR 205.4a), as computed (`supertypesOf`). */
  supertypes?: Supertype[];
  /** "Other than basic land cards": the object must not fit this whole filter (not basic-and-land). */
  not?: ObjectFilter;
};

/** A number in an effect: written on the card, or X, the value announced as it was cast (CR 107.3a). */
export type Amount =
  | number
  | "X"
  /**
   * "For each land you control", "the number of Swamps you control": how many permanents fit the filter (its
   * `controller` relative to "you"), counted as the effect applies (CR 608.2h). An X the text defines this way is
   * this count, not announced (CR 107.3c).
   */
  | { count: ObjectFilter };

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
  | "self"
  /** The player the text calls "you": the spell's or ability's controller (CR 109.5). It isn't a target (CR 115.10b). */
  | "you"
  /** "Each player": every player, in APNAP order (CR 101.4). */
  | "eachPlayer"
  /** "That card", "them": the cards an earlier `search` of this resolution found (CR 608.2c). */
  | "found"
  /** "Each creature without flying": every permanent fitting the filter as the effect applies (CR 608.2h). */
  | { each: ObjectFilter };

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
      /**
       * "...and 3 damage to you", "...and each player": more recipients of the same source in the same action, each
       * dealt its own amount. All of it is one damage event (CR 608.2f, 120.4).
       */
      and?: { to: EffectSubject; amount: Amount }[];
    }
  /** "Add {G}." (CR 106.4). */
  | { op: "addMana"; mana: ManaType; amount: number }
  /** "gets +N/+N until end of turn": a layer 7c effect (CR 613.4c) that ends in the cleanup step (CR 514.2). */
  | { op: "modifyPT"; power: number; toughness: number; of: EffectSubject; duration: Duration }
  /** "Destroy [subject]" (CR 701.8a). */
  | { op: "destroy"; of: EffectSubject }
  /**
   * "Destroy all [filter]": every permanent that fits, decided once as the effect applies (CR 608.2h), destroyed at the
   * same time (CR 608.2f).
   */
  | { op: "destroyAll"; filter: ObjectFilter }
  /** "Exile [subject]": moved to the exile zone (CR 701.13a, 406.2). */
  | { op: "exile"; of: EffectSubject }
  /** "Return [subject] to its owner's hand" (CR 400.3). */
  | { op: "returnToHand"; of: EffectSubject }
  /** "Put [subject] on top of its owner's library" (CR 400.3). */
  | { op: "putOnTopOfLibrary"; of: EffectSubject }
  /** "Tap [subject]" (CR 701.26a). */
  | { op: "tap"; of: EffectSubject }
  /** "Counter [subject]": a spell or ability on the stack (CR 701.6a). */
  | { op: "counter"; of: EffectSubject }
  /** "[who] gain(s) N life" (CR 119.3). */
  | { op: "gainLife"; who: EffectSubject; amount: Amount }
  /** "[who] lose(s) N life" (CR 119.3). */
  | { op: "loseLife"; who: EffectSubject; amount: Amount }
  /** "[who] draw(s) N cards": one draw at a time (CR 121.2), each player's in turn, from the active player (CR 121.2c). */
  | { op: "draw"; who: EffectSubject; amount: Amount }
  /** "[who] discard(s) N cards at random" (CR 701.9b). */
  | { op: "discardAtRandom"; who: EffectSubject; amount: Amount }
  /**
   * "[who] mill(s) N cards": the top N of their library to their graveyard (CR 701.17a); "half their library, rounded
   * down" (CR 107.1a) is `"halfTheirLibrary"`.
   */
  | { op: "mill"; who: EffectSubject; amount: Amount | "halfTheirLibrary" }
  /**
   * "[who] discards N cards" (CR 701.9a): the player chooses which (CR 701.9b), or `chosenBy: "you"` ("you choose a
   * card from it. That player discards that card"), among the cards fitting `filter` if there is one.
   */
  | { op: "discard"; who: EffectSubject; amount: Amount; chosenBy?: "you"; filter?: ObjectFilter }
  /** "[who] reveals their hand" (CR 701.20a): shown to every player; it stays in the hand (CR 701.20b). */
  | { op: "revealHand"; who: EffectSubject }
  /**
   * "You may put a [filter] card from your hand onto the battlefield": under the controller's control (CR 110.2a), not
   * cast. `optional` for "you may".
   */
  | { op: "putOntoBattlefield"; from: "yourHand"; filter: ObjectFilter; optional: boolean }
  /**
   * "Search [whose] library for [a card / a [filter] card / all cards with the same name as a card exiled this way]":
   * "you" look at the whole library (CR 701.23a) and choose; the cards found are `"found"` for the effects after it.
   * With a stated quality the searcher may find none (CR 701.23b); "a card" must be found if there is one
   * (CR 701.23d). `sameNameAsExiled` searches only if an earlier `exileGraveyard` exiled something (D-063).
   */
  | {
      op: "search";
      library: EffectSubject;
      filter?: ObjectFilter;
      count: "one" | "anyNumber";
      sameNameAsExiled?: true;
    }
  /** "Reveal it": shows the cards to every player (CR 701.20a), staying where they are (CR 701.20b). */
  | { op: "reveal"; of: EffectSubject }
  /** "Put it into your hand" / "onto the battlefield tapped": under the controller's control (CR 110.2a). */
  | { op: "put"; of: EffectSubject; into: "hand" | "battlefield"; tapped?: true }
  /** "[who] shuffles" (CR 701.24a). */
  | { op: "shuffle"; who: EffectSubject }
  /** "You may shuffle": a yes or no choice; yes shuffles (CR 701.24a). */
  | { op: "mayShuffle"; who: EffectSubject }
  /** "Look at the top N cards of your library, then put them back in any order" (CR 701.20e, 401.4). */
  | { op: "lookAtTop"; count: number }
  /** "Exile all cards from [whose] graveyard [other than ...]": the cards exiled this way are kept (CR 608.2c). */
  | { op: "exileGraveyard"; of: EffectSubject; filter?: ObjectFilter };
