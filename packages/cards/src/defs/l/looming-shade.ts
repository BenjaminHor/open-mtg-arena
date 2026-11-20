import type { CardDef } from "@mtg/engine";

export const loomingShade: CardDef = {
  name: "Looming Shade",
  oracle: "{B}: This creature gets +1/+1 until end of turn.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "B" }] }],
      targets: [],
      effects: [{ op: "modifyPT", power: 1, toughness: 1, of: "self", duration: "endOfTurn" }],
    },
  ],
};
