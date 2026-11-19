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
/** Not a real card: a spell with two instances of "target", which nothing in the M1 pool has (CR 608.2b tests). */
export const SHOT_AND_BOOST = "test-shot-and-boost";
/** Not a real card: damage dealt by a target, so its source can be an illegal target (CR 608.2b). */
export const BITE = "test-bite";
/** Not a real card: a noncreature artifact with a printed power and toughness, like a Vehicle (CR 208.3). */
export const STATUE = "test-statue";

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
        targets: [{ kind: "creature" }],
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
        targets: [{ kind: "anyTarget" }, { kind: "creature" }],
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
        targets: [{ kind: "creature" }, { kind: "anyTarget" }],
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
};
