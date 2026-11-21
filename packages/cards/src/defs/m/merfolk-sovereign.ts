import type { CardDef } from "@mtg/engine";

export const merfolkSovereign: CardDef = {
  name: "Merfolk Sovereign",
  oracle: "Other Merfolk creatures you control get +1/+1.\n{T}: Target Merfolk creature can't be blocked this turn.",
  statics: [
    {
      kind: "creaturesGet",
      filter: { types: ["creature"], subtypes: ["Merfolk"], controller: "you" },
      others: true,
      power: 1,
      toughness: 1,
    },
  ],
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [{ kind: "permanent", filter: { types: ["creature"], subtypes: ["Merfolk"] } }],
      effects: [{ op: "cantBeBlocked", of: { target: 0 }, duration: "endOfTurn" }],
    },
  ],
};
