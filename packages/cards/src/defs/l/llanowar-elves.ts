import type { CardDef } from "@mtg/engine";

export const llanowarElves: CardDef = {
  name: "Llanowar Elves",
  oracle: "{T}: Add {G}.",
  abilities: [
    {
      kind: "activated", // a mana ability (CR 605.1a)
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: "G", amount: 1 }],
    },
  ],
};
