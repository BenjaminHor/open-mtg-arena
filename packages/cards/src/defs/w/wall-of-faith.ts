import type { CardDef } from "@mtg/engine";

export const wallOfFaith: CardDef = {
  name: "Wall of Faith",
  oracle: "Defender (This creature can't attack.)\n{W}: This creature gets +0/+1 until end of turn.",
  keywords: ["defender"],
  abilities: [
    {
      kind: "activated", // CR 602
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "W" }] }],
      targets: [],
      effects: [{ op: "modifyPT", power: 0, toughness: 1, of: "self", duration: "endOfTurn" }],
    },
  ],
};
