import type { CardDef } from "@mtg/engine";

export const firebreathing: CardDef = {
  name: "Firebreathing",
  oracle: "Enchant creature\n{R}: Enchanted creature gets +1/+0 until end of turn.",
  enchant: { types: ["creature"] },
  abilities: [
    {
      // The Aura's own ability, activated by its controller (CR 303.4e), on whatever it enchants as it resolves.
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "R" }] }],
      targets: [],
      effects: [{ op: "modifyPT", power: 1, toughness: 0, of: "attached", duration: "endOfTurn" }],
    },
  ],
};
