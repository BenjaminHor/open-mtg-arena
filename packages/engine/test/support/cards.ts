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
};
