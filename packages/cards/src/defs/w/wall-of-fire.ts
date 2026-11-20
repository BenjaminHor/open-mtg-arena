import type { CardDef } from "@mtg/engine";

export const wallOfFire: CardDef = {
  name: "Wall of Fire",
  oracle: "Defender (This creature can't attack.)\n{R}: This creature gets +1/+0 until end of turn.",
  keywords: ["defender"],
  abilities: [
    {
      kind: "activated", // CR 602
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "R" }] }],
      targets: [],
      effects: [{ op: "modifyPT", power: 1, toughness: 0, of: "self", duration: "endOfTurn" }],
    },
  ],
};
