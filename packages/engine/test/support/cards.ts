// A tiny card database for engine tests. The engine never depends on packages/cards (docs/architecture.md),
// so engine tests describe the few cards they need here.

import type { CardData, CardDatabase } from "../../src/index.ts";

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
/** Not a real card: an enchantment with no abilities, until the pool has one (M2-07), for "artifact or enchantment". */
export const ENCHANTMENT = "test-enchantment";

export const TEST_CARDS: CardDatabase = {
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
};
