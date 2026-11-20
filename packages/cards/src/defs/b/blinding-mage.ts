import type { CardDef } from "@mtg/engine";

export const blindingMage: CardDef = {
  name: "Blinding Mage",
  oracle: "{W}, {T}: Tap target creature.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "W" }] }, { kind: "tap" }],
      targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
      effects: [{ op: "tap", of: { target: 0 } }],
    },
  ],
};
