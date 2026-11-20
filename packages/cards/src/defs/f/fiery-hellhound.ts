import type { CardDef } from "@mtg/engine";

export const fieryHellhound: CardDef = {
  name: "Fiery Hellhound",
  oracle: "{R}: This creature gets +1/+0 until end of turn.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "R" }] }],
      targets: [],
      effects: [{ op: "modifyPT", power: 1, toughness: 0, of: "self", duration: "endOfTurn" }],
    },
  ],
};
