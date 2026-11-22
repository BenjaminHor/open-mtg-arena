// A tiny card database for engine tests. The engine never depends on packages/cards (docs/architecture.md),
// so engine tests describe the few cards they need here.

import type { CardData, CardDatabase, Keyword } from "../../src/index.ts";

function card(oracleId: string, data: Omit<CardData, "oracleId">): CardData {
  return { oracleId, ...data };
}

export const FOREST = "forest";
export const MOUNTAIN = "mountain";
export const BEARS = "grizzly-bears";
export const SHOCK = "shock";
export const HAMMER = "volcanic-hammer";
export const ELVES = "llanowar-elves";
export const WHELP = "furnace-whelp";
export const GROWTH = "giant-growth";
export const HILL_GIANT = "hill-giant";
/** Not a real card: a spell with two instances of "target", which nothing in the M1 pool has (CR 608.2b tests). */
export const SHOT_AND_BOOST = "test-shot-and-boost";
/** Not a real card: damage dealt by a target, so its source can be an illegal target (CR 608.2b). */
export const BITE = "test-bite";
/** Not a real card: a noncreature artifact with a printed power and toughness, like a Vehicle (CR 208.3). */
export const STATUE = "test-statue";
/** Not a real card: a creature with haste and a {T} mana ability, for CR 702.10c. */
export const HASTY_ELF = "test-hasty-elf";
/** Not a real card: an activated ability with a target and a damage source, which nothing in the M1 pool has. */
export const PINGER = "test-pinger";
/** Not a real card: a white and blue creature with a subtype, for target restrictions by color and subtype. */
export const KNIGHT = "test-white-blue-knight";
/** Not a real card: "Up to two target creatures get +1/+1 until end of turn", which can have zero targets (CR 115.6). */
export const UP_TO_TWO = "test-up-to-two";
/** Not a real card: 2 damage divided as you choose among one or more target creatures (CR 601.2d). */
export const SPLIT = "test-split";
/** Not a real card: "{X}{R}: X damage to any target", for X costs (CR 107.3a). */
export const X_BOLT = "test-x-bolt";
/** Not a real card: "Sacrifice a creature: this creature gets +1/+1 until end of turn", for sacrifice costs. */
export const SAC_PUMP = "test-sac-pump";
/** Not a real card: an Aura, "Enchant creature / Enchanted creature gets +1/+1", for attachments below the scenarios. */
export const TEST_AURA = "test-aura";
/** Not a real card: a planeswalker with no abilities, for attacking and damaging one before the pool has any. */
export const TEST_WALKER = "test-walker";
/** Not a real card: a free sorcery, "Put all enchantment cards from all graveyards onto the battlefield under your control". */
/** Not a real card: a 0/1 artifact creature, "You can't lose the game and your opponents can't win the game." */
export const TEST_ANGEL = "test-angel";
/** Not a real card: a noncreature artifact, "When this creature dies, you gain 1 life" (CR 700.7: "this" is the object). */
export const TEST_RELIC = "test-relic";
/** Not a real card: a nonbasic Forest land with shroud, "enters tapped", a trigger and a static, for losing rules text. */
export const TEST_ODD_LAND = "test-odd-land";
/** Not a real card: "Enchant land. As this Aura enters, choose a basic land type. Enchanted land is the chosen type." */
export const TEST_MIRAGE = "test-mirage";
export const TAKE_ENCHANTMENTS = "test-take-enchantments";
/** Not a real card: "Enchant creature you control / Enchanted creature gets +1/+1." */
export const YOUR_AURA = "test-your-aura";
/** Not real cards: two legendary 2/2 creatures with different names, for the legend rule (CR 704.5j). */
export const LEGEND = "test-legend";
export const OTHER_LEGEND = "test-other-legend";
/** Not a real card: Mind Control's "you control enchanted creature" on a test Aura, for layer 2 order below the scenarios. */
export const CONTROL_AURA = "test-control-aura";
/** Not a real card: a black Equipment, which no M10 card is, for protection's "can't be equipped" (CR 702.16d). */
export const BLACK_EQUIPMENT = "test-black-equipment";
/** Not a real card: an instant whose delayed trigger is a spell's (CR 603.7d), which no Magic 2010 card has. */
export const LATE_GIFT = "test-late-gift";
/** Not a real card: "enters tapped unless you control a Forest", for lands entering together. */
export const GROVE = "test-grove";
/** Not a real card: a nonbasic land with the land types Forest and Plains, named neither (checklands' ruling). */
export const DUAL = "test-dual";
/** Not a real card: a 2/2 that goes to its owner's library instead of a graveyard, and can be destroyed. */
export const HOMING_BEAR = "test-homing-bear";
/** Not a real card: an indestructible 0/0, for CR 704.5f, which indestructible doesn't stop. */
export const HOLLOW_STATUE = "test-hollow-statue";
/** Not a real card: an indestructible 0/4, for a destroy that can't happen (CR 614.17c). */
export const IRON_WALL = "test-iron-wall";
/** Not a real card: "Destroy target creature" for {R}, an instant, for replacement choices as a spell resolves. */
export const UNMAKE = "test-unmake";
/** Not a real card: "Destroy all creatures" for {R}, an instant: one event destroying both players' creatures. */
export const WRATH = "test-wrath";
/** Not a real card: an enchantment with no abilities, until the pool has one (M2-07), for "artifact or enchantment". */
export const ENCHANTMENT = "test-enchantment";
/** Not real cards: creatures with keywords no Magic 2010 card combines (CR 702.4, 702.2c), for unit tests. */
export const DOUBLE_STRIKER = "test-double-striker";
export const DOUBLE_LIFELINKER = "test-double-lifelinker";
export const FIRST_STRIKER = "test-first-striker";
export const DEATHTOUCH_TRAMPLER = "test-deathtouch-trampler";
export const DOUBLE_TRAMPLER = "test-double-trampler";
/** Not a real card: a creature that can't attack or block alone (Jackal Familiar's ability on a test body). */
export const LONER = "test-loner";
/** Not a real card: a 2/2 with shroud, to swap in for Grizzly Bears when a target gains shroud. */
export const SHROUDED = "test-shrouded";
/** Not real cards: Soul Warden's and Howling Mine's triggered abilities on test bodies, for trigger unit tests. */
export const WARDEN = "test-warden";
export const MINE = "test-mine";
/** Not a real card: Lightwielder Paladin's "target ... that player controls" on a test body, unit-testing CR 608.2b. */
export const THAT_PLAYERS = "test-that-players";

/** Not a real card: a 2/2 with protection from black (White Knight's protection without its first strike). */
export const PRO_BLACK = "test-pro-black";
/**
 * Not a real card: "Creatures you control without flying get +1/+1 and have flying." Its set is found in layer 6, before
 * it grants flying, and kept for 7c (CR 613.6): looking again in 7c would find none.
 */
export const GROUNDED_ANTHEM = "test-grounded-anthem";
export const LONE_LORD = "test-lone-lord";
/**
 * Not a real card: a creature printed with "*" power and toughness, each the number of Forests you control (layer
 * 7a).
 */
export const FOREST_COUNTER = "test-forest-counter";
/** Not a real card: "power and toughness are each equal to your life total", as Ajani Goldmane's Avatar token has. */
export const LIFE_AVATAR = "test-life-avatar";
/** Not a real card: "Whenever another Zombie enters, you gain 1 life", to see what an entering creature is (CR 611.2e). */
export const ZOMBIE_WATCHER = "test-zombie-watcher";
/** Not a real card: a black 1/1 with deathtouch (the pool's deathtouch creatures are green). */
export const BLACK_DEATHTOUCH = "test-black-deathtouch";

/** A test card with more of its definition set. */
function withDef(data: CardData, def: Partial<CardData["def"]>): CardData {
  return { ...data, def: { ...data.def, ...def } };
}

/** A test card with these colors. */
function withColors(data: CardData, colors: CardData["printed"]["colors"]): CardData {
  return { ...data, printed: { ...data.printed, colors } };
}

/** A test creature with only keywords: a vanilla body for combat tests. */
function keywordCreature(oracleId: string, name: string, size: [number, number], keywords: Keyword[]): CardData {
  return card(oracleId, {
    printed: {
      name,
      manaCost: [{ kind: "generic", amount: 2 }],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: [],
      power: size[0],
      toughness: size[1],
    },
    def: { name, oracle: keywords.join(", "), keywords },
  });
}

function legend(oracleId: string, name: string): CardData {
  const data = keywordCreature(oracleId, name, [2, 2], []);
  return { ...data, printed: { ...data.printed, supertypes: ["legendary"] } };
}

export const TEST_CARDS: CardDatabase = {
  [LEGEND]: legend(LEGEND, "Test Legend"),
  [OTHER_LEGEND]: legend(OTHER_LEGEND, "Other Legend"),
  [FOREST]: card(FOREST, {
    printed: {
      name: "Forest",
      manaCost: null,
      colors: [],
      colorIndicator: [],
      supertypes: ["basic"],
      types: ["land"],
      subtypes: ["Forest"],
      power: null,
      toughness: null,
    },
    def: { name: "Forest", oracle: "({T}: Add {G}.)" },
  }),
  [MOUNTAIN]: card(MOUNTAIN, {
    printed: {
      name: "Mountain",
      manaCost: null,
      colors: [],
      colorIndicator: [],
      supertypes: ["basic"],
      types: ["land"],
      subtypes: ["Mountain"],
      power: null,
      toughness: null,
    },
    def: { name: "Mountain", oracle: "({T}: Add {R}.)" },
  }),
  [SHOCK]: card(SHOCK, {
    printed: {
      name: "Shock",
      manaCost: [{ kind: "colored", color: "R" }],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Shock",
      oracle: "Shock deals 2 damage to any target.",
      spell: {
        targets: [{ kind: "anyTarget" }],
        effects: [{ op: "dealDamage", amount: 2, from: "self", to: { target: 0 } }],
      },
    },
  }),
  [HAMMER]: card(HAMMER, {
    printed: {
      name: "Volcanic Hammer",
      manaCost: [
        { kind: "generic", amount: 1 },
        { kind: "colored", color: "R" },
      ],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["sorcery"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Volcanic Hammer",
      oracle: "Volcanic Hammer deals 3 damage to any target.",
      spell: {
        targets: [{ kind: "anyTarget" }],
        effects: [{ op: "dealDamage", amount: 3, from: "self", to: { target: 0 } }],
      },
    },
  }),
  [ELVES]: card(ELVES, {
    printed: {
      name: "Llanowar Elves",
      manaCost: [{ kind: "colored", color: "G" }],
      colors: ["G"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: ["Elf", "Druid"],
      power: 1,
      toughness: 1,
    },
    def: {
      name: "Llanowar Elves",
      oracle: "{T}: Add {G}.",
      abilities: [
        { kind: "activated", cost: [{ kind: "tap" }], targets: [], effects: [{ op: "addMana", mana: "G", amount: 1 }] },
      ],
    },
  }),
  [WHELP]: card(WHELP, {
    printed: {
      name: "Furnace Whelp",
      manaCost: [
        { kind: "generic", amount: 2 },
        { kind: "colored", color: "R" },
        { kind: "colored", color: "R" },
      ],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: ["Dragon"],
      power: 2,
      toughness: 2,
    },
    def: {
      name: "Furnace Whelp",
      oracle: "Flying\n{R}: This creature gets +1/+0 until end of turn.",
      keywords: ["flying"],
      abilities: [
        {
          kind: "activated",
          cost: [{ kind: "mana", cost: [{ kind: "colored", color: "R" }] }],
          targets: [],
          effects: [{ op: "modifyPT", power: 1, toughness: 0, of: "self", duration: "endOfTurn" }],
        },
      ],
    },
  }),
  [BEARS]: card(BEARS, {
    printed: {
      name: "Grizzly Bears",
      manaCost: [
        { kind: "generic", amount: 1 },
        { kind: "colored", color: "G" },
      ],
      colors: ["G"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: ["Bear"],
      power: 2,
      toughness: 2,
    },
    def: { name: "Grizzly Bears", oracle: "" },
  }),
  [GROWTH]: card(GROWTH, {
    printed: {
      name: "Giant Growth",
      manaCost: [{ kind: "colored", color: "G" }],
      colors: ["G"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Giant Growth",
      oracle: "Target creature gets +3/+3 until end of turn.",
      spell: {
        targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
        effects: [{ op: "modifyPT", power: 3, toughness: 3, of: { target: 0 }, duration: "endOfTurn" }],
      },
    },
  }),
  [SHOT_AND_BOOST]: card(SHOT_AND_BOOST, {
    printed: {
      name: "Shot and Boost",
      manaCost: [{ kind: "colored", color: "R" }],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Shot and Boost",
      oracle: "Shot and Boost deals 1 damage to any target. Target creature gets +1/+1 until end of turn.",
      spell: {
        targets: [{ kind: "anyTarget" }, { kind: "permanent", filter: { types: ["creature"] } }],
        effects: [
          { op: "dealDamage", amount: 1, from: "self", to: { target: 0 } },
          { op: "modifyPT", power: 1, toughness: 1, of: { target: 1 }, duration: "endOfTurn" },
        ],
      },
    },
  }),
  [BITE]: card(BITE, {
    printed: {
      name: "Bite",
      manaCost: [{ kind: "colored", color: "G" }],
      colors: ["G"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Bite",
      oracle: "Target creature deals 2 damage to any target.",
      spell: {
        targets: [{ kind: "permanent", filter: { types: ["creature"] } }, { kind: "anyTarget" }],
        effects: [{ op: "dealDamage", amount: 2, from: { target: 0 }, to: { target: 1 } }],
      },
    },
  }),
  [STATUE]: card(STATUE, {
    printed: {
      name: "Statue",
      manaCost: [{ kind: "generic", amount: 3 }],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["artifact"],
      subtypes: [],
      power: 4,
      toughness: 5,
    },
    def: { name: "Statue", oracle: "" },
  }),
  [HILL_GIANT]: card(HILL_GIANT, {
    printed: {
      name: "Hill Giant",
      manaCost: [
        { kind: "generic", amount: 3 },
        { kind: "colored", color: "R" },
      ],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: ["Giant"],
      power: 3,
      toughness: 3,
    },
    def: { name: "Hill Giant", oracle: "" },
  }),
  [HASTY_ELF]: card(HASTY_ELF, {
    printed: {
      name: "Hasty Elf",
      manaCost: [{ kind: "colored", color: "G" }],
      colors: ["G"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: ["Elf"],
      power: 1,
      toughness: 1,
    },
    def: {
      name: "Hasty Elf",
      oracle: "Haste\n{T}: Add {G}.",
      keywords: ["haste"],
      abilities: [
        { kind: "activated", cost: [{ kind: "tap" }], targets: [], effects: [{ op: "addMana", mana: "G", amount: 1 }] },
      ],
    },
  }),
  [PINGER]: card(PINGER, {
    printed: {
      name: "Pinger",
      manaCost: [{ kind: "colored", color: "R" }],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: ["Goblin"],
      power: 1,
      toughness: 1,
    },
    def: {
      name: "Pinger",
      oracle: "{R}: This creature deals 1 damage to any target.",
      abilities: [
        {
          kind: "activated",
          cost: [{ kind: "mana", cost: [{ kind: "colored", color: "R" }] }],
          targets: [{ kind: "anyTarget" }],
          effects: [{ op: "dealDamage", amount: 1, from: "self", to: { target: 0 } }],
        },
      ],
    },
  }),
  [KNIGHT]: card(KNIGHT, {
    printed: {
      name: "White-Blue Knight",
      manaCost: [
        { kind: "colored", color: "W" },
        { kind: "colored", color: "U" },
      ],
      colors: ["W", "U"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: ["Human", "Knight"],
      power: 2,
      toughness: 2,
    },
    def: { name: "White-Blue Knight", oracle: "" },
  }),
  [UP_TO_TWO]: card(UP_TO_TWO, {
    printed: {
      name: "Up To Two",
      manaCost: [{ kind: "colored", color: "G" }],
      colors: ["G"],
      colorIndicator: [],
      supertypes: [],
      types: ["sorcery"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Up To Two",
      oracle: "Up to two target creatures get +1/+1 until end of turn.",
      spell: {
        targets: [{ kind: "permanent", filter: { types: ["creature"] }, count: { min: 0, max: 2 } }],
        effects: [{ op: "modifyPT", power: 1, toughness: 1, of: { target: 0 }, duration: "endOfTurn" }],
      },
    },
  }),
  [SPLIT]: card(SPLIT, {
    printed: {
      name: "Split",
      manaCost: [{ kind: "colored", color: "R" }],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Split",
      oracle: "Split deals 2 damage divided as you choose among one or more target creatures.",
      spell: {
        targets: [{ kind: "permanent", filter: { types: ["creature"] }, count: { min: 1, max: "any" } }],
        effects: [{ op: "dealDamage", amount: 2, from: "self", to: { target: 0 }, divided: "asYouChoose" }],
      },
    },
  }),
  [X_BOLT]: card(X_BOLT, {
    printed: {
      name: "X Bolt",
      manaCost: [{ kind: "x" }, { kind: "colored", color: "R" }],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "X Bolt",
      oracle: "X Bolt deals X damage to any target.",
      spell: {
        targets: [{ kind: "anyTarget" }],
        effects: [{ op: "dealDamage", amount: "X", from: "self", to: { target: 0 } }],
      },
    },
  }),
  [BLACK_EQUIPMENT]: card(BLACK_EQUIPMENT, {
    printed: {
      name: "Black Equipment",
      manaCost: [{ kind: "colored", color: "B" }],
      colors: ["B"],
      colorIndicator: [],
      supertypes: [],
      types: ["artifact"],
      subtypes: ["Equipment"],
      power: null,
      toughness: null,
    },
    def: {
      name: "Black Equipment",
      oracle: "Equipped creature gets +1/+1.\nEquip {1}",
      statics: [{ kind: "attachedGets", power: 1, toughness: 1 }],
      abilities: [
        {
          kind: "activated",
          keyword: "equip",
          timing: "sorcery",
          cost: [{ kind: "mana", cost: [{ kind: "generic", amount: 1 }] }],
          targets: [{ kind: "permanent", filter: { types: ["creature"], controller: "you" } }],
          effects: [{ op: "attachSelf", to: { target: 0 } }],
        },
      ],
    },
  }),
  [CONTROL_AURA]: card(CONTROL_AURA, {
    printed: {
      name: "Control Aura",
      manaCost: [{ kind: "colored", color: "U" }],
      colors: ["U"],
      colorIndicator: [],
      supertypes: [],
      types: ["enchantment"],
      subtypes: ["Aura"],
      power: null,
      toughness: null,
    },
    def: {
      name: "Control Aura",
      oracle: "Enchant creature\nYou control enchanted creature.",
      enchant: { types: ["creature"] },
      statics: [{ kind: "attachedControl" }],
    },
  }),
  [TEST_WALKER]: card(TEST_WALKER, {
    printed: {
      name: "Test Walker",
      manaCost: [{ kind: "colored", color: "W" }],
      colors: ["W"],
      colorIndicator: [],
      supertypes: ["legendary"],
      types: ["planeswalker"],
      subtypes: ["Test"],
      power: null,
      toughness: null,
      loyalty: 5,
    },
    def: { name: "Test Walker", oracle: "" },
  }),
  [TEST_RELIC]: card(TEST_RELIC, {
    printed: {
      name: "Test Relic",
      manaCost: [],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["artifact"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Test Relic",
      oracle: "When this creature dies, you gain 1 life.",
      triggers: [{ when: { kind: "selfDies" }, targets: [], effects: [{ op: "gainLife", who: "you", amount: 1 }] }],
    },
  }),
  [TEST_ODD_LAND]: card(TEST_ODD_LAND, {
    printed: {
      name: "Test Odd Land",
      manaCost: [],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["land"],
      subtypes: ["Forest"],
      power: null,
      toughness: null,
    },
    def: {
      name: "Test Odd Land",
      oracle: "",
      keywords: ["shroud"],
      replacements: [{ kind: "entersTapped", unless: { subtypes: ["Plains"], controller: "you" } }],
      triggers: [{ when: { kind: "selfEnters" }, targets: [], effects: [{ op: "gainLife", who: "you", amount: 1 }] }],
      statics: [{ kind: "noMaximumHandSize" }],
    },
  }),
  [TEST_MIRAGE]: card(TEST_MIRAGE, {
    printed: {
      name: "Test Mirage",
      manaCost: [],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["enchantment"],
      subtypes: ["Aura"],
      power: null,
      toughness: null,
    },
    def: {
      name: "Test Mirage",
      oracle: "",
      enchant: { types: ["land"] },
      replacements: [{ kind: "asEntersChoose", what: "basicLandType" }],
      statics: [{ kind: "attachedSetsLandType" }],
    },
  }),
  [TEST_ANGEL]: card(TEST_ANGEL, {
    printed: {
      name: "Test Angel",
      manaCost: [],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["artifact", "creature"],
      subtypes: ["Angel"],
      power: 0,
      toughness: 1,
    },
    def: {
      name: "Test Angel",
      oracle: "You can't lose the game and your opponents can't win the game.",
      statics: [{ kind: "cantLoseOpponentsCantWin" }],
    },
  }),
  [TAKE_ENCHANTMENTS]: card(TAKE_ENCHANTMENTS, {
    printed: {
      name: "Take Enchantments",
      manaCost: [],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["sorcery"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Take Enchantments",
      oracle: "Put all enchantment cards from all graveyards onto the battlefield under your control.",
      spell: {
        targets: [],
        effects: [
          { op: "returnAllToBattlefield", from: "allGraveyards", filter: { types: ["enchantment"] }, under: "you" },
        ],
      },
    },
  }),
  [YOUR_AURA]: card(YOUR_AURA, {
    printed: {
      name: "Your Aura",
      manaCost: [{ kind: "colored", color: "W" }],
      colors: ["W"],
      colorIndicator: [],
      supertypes: [],
      types: ["enchantment"],
      subtypes: ["Aura"],
      power: null,
      toughness: null,
    },
    def: {
      name: "Your Aura",
      oracle: "Enchant creature you control\nEnchanted creature gets +1/+1.",
      enchant: { types: ["creature"], controller: "you" },
      statics: [{ kind: "attachedGets", power: 1, toughness: 1 }],
    },
  }),
  [TEST_AURA]: card(TEST_AURA, {
    printed: {
      name: "Test Aura",
      manaCost: [{ kind: "colored", color: "W" }],
      colors: ["W"],
      colorIndicator: [],
      supertypes: [],
      types: ["enchantment"],
      subtypes: ["Aura"],
      power: null,
      toughness: null,
    },
    def: {
      name: "Test Aura",
      oracle: "Enchant creature\nEnchanted creature gets +1/+1.",
      enchant: { types: ["creature"] },
      statics: [{ kind: "attachedGets", power: 1, toughness: 1 }],
    },
  }),
  [SAC_PUMP]: card(SAC_PUMP, {
    printed: {
      name: "Sac Pump",
      manaCost: [{ kind: "colored", color: "B" }],
      colors: ["B"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: [],
      power: 1,
      toughness: 1,
    },
    def: {
      name: "Sac Pump",
      oracle: "Sacrifice a creature: This creature gets +1/+1 until end of turn.",
      abilities: [
        {
          kind: "activated",
          cost: [{ kind: "sacrifice", filter: { types: ["creature"] } }],
          targets: [],
          effects: [{ op: "modifyPT", power: 1, toughness: 1, of: "self", duration: "endOfTurn" }],
        },
      ],
    },
  }),
  [LATE_GIFT]: card(LATE_GIFT, {
    printed: {
      name: "Late Gift",
      manaCost: [{ kind: "colored", color: "R" }],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Late Gift",
      oracle: "At the beginning of the next end step, you gain 1 life.",
      spell: {
        targets: [],
        effects: [
          {
            op: "createDelayedTrigger",
            ability: {
              when: { kind: "beginningOfStep", step: "end", whose: "each" },
              targets: [],
              effects: [{ op: "gainLife", who: "you", amount: 1 }],
            },
          },
        ],
      },
    },
  }),
  [GROVE]: card(GROVE, {
    printed: {
      name: "Test Grove",
      manaCost: null,
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["land"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Test Grove",
      oracle: "This land enters tapped unless you control a Forest.",
      replacements: [{ kind: "entersTapped", unless: { subtypes: ["Forest"], controller: "you" } }],
    },
  }),
  [DUAL]: card(DUAL, {
    printed: {
      name: "Test Dual",
      manaCost: null,
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["land"],
      subtypes: ["Forest", "Plains"],
      power: null,
      toughness: null,
    },
    def: { name: "Test Dual", oracle: "({T}: Add {G} or {W}.)" },
  }),
  [HOMING_BEAR]: card(HOMING_BEAR, {
    printed: {
      name: "Homing Bear",
      manaCost: [{ kind: "colored", color: "G" }],
      colors: ["G"],
      colorIndicator: [],
      supertypes: [],
      types: ["creature"],
      subtypes: ["Bear"],
      power: 2,
      toughness: 2,
    },
    def: {
      name: "Homing Bear",
      oracle:
        "If this creature would be put into a graveyard from anywhere, reveal it and shuffle it into its owner's library instead.",
      replacements: [{ kind: "graveyardToLibrary" }],
    },
  }),
  [HOLLOW_STATUE]: card(HOLLOW_STATUE, {
    printed: {
      name: "Hollow Statue",
      manaCost: [{ kind: "generic", amount: 1 }],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["artifact", "creature"],
      subtypes: ["Golem"],
      power: 0,
      toughness: 0,
    },
    def: { name: "Hollow Statue", oracle: "Indestructible", keywords: ["indestructible"] },
  }),
  [IRON_WALL]: card(IRON_WALL, {
    printed: {
      name: "Iron Wall",
      manaCost: [{ kind: "generic", amount: 2 }],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["artifact", "creature"],
      subtypes: ["Wall"],
      power: 0,
      toughness: 4,
    },
    def: { name: "Iron Wall", oracle: "Indestructible", keywords: ["indestructible"] },
  }),
  [UNMAKE]: card(UNMAKE, {
    printed: {
      name: "Unmake",
      manaCost: [{ kind: "colored", color: "R" }],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Unmake",
      oracle: "Destroy target creature.",
      spell: {
        targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
        effects: [{ op: "destroy", of: { target: 0 } }],
      },
    },
  }),
  [WRATH]: card(WRATH, {
    printed: {
      name: "Wrath",
      manaCost: [{ kind: "colored", color: "R" }],
      colors: ["R"],
      colorIndicator: [],
      supertypes: [],
      types: ["instant"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Wrath",
      oracle: "Destroy all creatures.",
      spell: { targets: [], effects: [{ op: "destroy", of: { each: { types: ["creature"] } } }] },
    },
  }),
  [ENCHANTMENT]: card(ENCHANTMENT, {
    printed: {
      name: "Test Enchantment",
      manaCost: [{ kind: "colored", color: "W" }],
      colors: ["W"],
      colorIndicator: [],
      supertypes: [],
      types: ["enchantment"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: { name: "Test Enchantment", oracle: "" },
  }),
  [PRO_BLACK]: withDef(keywordCreature(PRO_BLACK, "Pro Black", [2, 2], []), {
    oracle: "Protection from black",
    protections: [{ kind: "color", color: "B" }],
  }),
  [GROUNDED_ANTHEM]: withDef(keywordCreature(GROUNDED_ANTHEM, "Grounded Anthem", [0, 1], []), {
    oracle: "Creatures you control without flying get +1/+1 and have flying.",
    statics: [
      {
        kind: "creaturesGet",
        filter: { types: ["creature"], notKeywords: ["flying"], controller: "you" },
        others: true,
        power: 1,
        toughness: 1,
        keywords: ["flying"],
      },
    ],
  }),
  [LONE_LORD]: withDef(keywordCreature(LONE_LORD, "Lone Lord", [1, 1], []), {
    oracle: "This creature and other Vampire creatures you control get +2/+1.",
    statics: [
      {
        kind: "creaturesGet",
        filter: { subtypes: ["Vampire"], controller: "you" },
        self: true,
        power: 2,
        toughness: 1,
      },
    ],
  }),
  [FOREST_COUNTER]: (() => {
    const body = keywordCreature(FOREST_COUNTER, "Forest Counter", [0, 0], []);
    return withDef(
      { ...body, printed: { ...body.printed, power: "*", toughness: "*" } },
      {
        oracle: "Forest Counter's power and toughness are each equal to the number of Forests you control.",
        statics: [{ kind: "powerToughnessEachEqual", to: { count: { subtypes: ["Forest"], controller: "you" } } }],
      },
    );
  })(),
  [LIFE_AVATAR]: (() => {
    const body = keywordCreature(LIFE_AVATAR, "Life Avatar", [0, 0], []);
    return withDef(
      { ...body, printed: { ...body.printed, power: "*", toughness: "*" } },
      {
        oracle: "Life Avatar's power and toughness are each equal to your life total.",
        statics: [{ kind: "powerToughnessEachEqual", to: "yourLifeTotal" }],
      },
    );
  })(),
  [BLACK_DEATHTOUCH]: withColors(keywordCreature(BLACK_DEATHTOUCH, "Black Deathtouch", [1, 1], ["deathtouch"]), ["B"]),
  [DOUBLE_STRIKER]: keywordCreature(DOUBLE_STRIKER, "Double Striker", [2, 2], ["double strike"]),
  [DOUBLE_LIFELINKER]: keywordCreature(DOUBLE_LIFELINKER, "Double Lifelinker", [2, 2], ["double strike", "lifelink"]),
  [FIRST_STRIKER]: keywordCreature(FIRST_STRIKER, "First Striker", [2, 2], ["first strike"]),
  [DEATHTOUCH_TRAMPLER]: keywordCreature(DEATHTOUCH_TRAMPLER, "Deathtouch Trampler", [5, 5], ["deathtouch", "trample"]),
  [DOUBLE_TRAMPLER]: keywordCreature(DOUBLE_TRAMPLER, "Double Trampler", [4, 4], ["double strike", "trample"]),
  [LONER]: {
    ...keywordCreature(LONER, "Loner", [2, 2], []),
    def: {
      name: "Loner",
      oracle: "This creature can't attack or block alone.",
      statics: [{ kind: "cantAttackOrBlockAlone" }],
    },
  },
  [SHROUDED]: keywordCreature(SHROUDED, "Shrouded", [2, 2], ["shroud"]),
  [WARDEN]: {
    ...keywordCreature(WARDEN, "Warden", [1, 1], []),
    def: {
      name: "Warden",
      oracle: "Whenever another creature enters, you gain 1 life.",
      triggers: [
        {
          when: { kind: "anotherEnters", filter: { types: ["creature"] } },
          targets: [],
          effects: [{ op: "gainLife", who: "you", amount: 1 }],
        },
      ],
    },
  },
  [ZOMBIE_WATCHER]: {
    ...keywordCreature(ZOMBIE_WATCHER, "Zombie Watcher", [1, 1], []),
    def: {
      name: "Zombie Watcher",
      oracle: "Whenever another Zombie enters, you gain 1 life.",
      triggers: [
        {
          when: { kind: "anotherEnters", filter: { subtypes: ["Zombie"] } },
          targets: [],
          effects: [{ op: "gainLife", who: "you", amount: 1 }],
        },
      ],
    },
  },
  [THAT_PLAYERS]: {
    ...keywordCreature(THAT_PLAYERS, "That Player's", [2, 2], []),
    def: {
      name: "That Player's",
      oracle: "Whenever this creature deals combat damage to a player, destroy target creature that player controls.",
      triggers: [
        {
          when: { kind: "selfDealsDamageToPlayer", player: "anyPlayer", combatOnly: true },
          targets: [{ kind: "permanent", filter: { types: ["creature"], controller: "triggeringPlayer" } }],
          effects: [{ op: "destroy", of: { target: 0 } }],
        },
      ],
    },
  },
  [MINE]: card(MINE, {
    printed: {
      name: "Mine",
      manaCost: [{ kind: "generic", amount: 2 }],
      colors: [],
      colorIndicator: [],
      supertypes: [],
      types: ["artifact"],
      subtypes: [],
      power: null,
      toughness: null,
    },
    def: {
      name: "Mine",
      oracle:
        "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.",
      triggers: [
        {
          when: { kind: "beginningOfStep", step: "draw", whose: "each" },
          onlyIf: { kind: "sourceUntapped" },
          targets: [],
          effects: [{ op: "draw", who: "triggeringPlayer", amount: 1 }],
        },
      ],
    },
  }),
};
