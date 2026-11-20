import type { CardDef } from "@mtg/engine";

export const royalAssassin: CardDef = {
  name: "Royal Assassin",
  oracle: "{T}: Destroy target tapped creature.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [{ kind: "permanent", filter: { types: ["creature"], tapped: true } }],
      effects: [{ op: "destroy", of: { target: 0 } }],
    },
  ],
};
