import type { CardDef } from "@mtg/engine";

export const elvishArchdruid: CardDef = {
  name: "Elvish Archdruid",
  oracle: "Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.",
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], subtypes: ["Elf"], controller: "you" },
      others: true,
      power: 1,
      toughness: 1,
    },
  ],
  abilities: [
    {
      kind: "activated", // a mana ability (CR 605.1a)
      cost: [{ kind: "tap" }],
      targets: [],
      // "Each Elf you control": Elf permanents, itself included (its ruling).
      effects: [{ op: "addMana", mana: "G", amount: { count: { subtypes: ["Elf"], controller: "you" } } }],
    },
  ],
};
