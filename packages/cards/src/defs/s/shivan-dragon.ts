import type { CardDef } from "@mtg/engine";

export const shivanDragon: CardDef = {
  name: "Shivan Dragon",
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
};
