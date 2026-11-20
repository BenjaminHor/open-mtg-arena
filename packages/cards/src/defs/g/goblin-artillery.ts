import type { CardDef } from "@mtg/engine";

export const goblinArtillery: CardDef = {
  name: "Goblin Artillery",
  oracle: "{T}: This creature deals 2 damage to any target and 3 damage to you.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [{ kind: "anyTarget" }],
      // One action, so one damage event (CR 608.2f); if the target is illegal, nothing is dealt at all (its ruling).
      effects: [{ op: "dealDamage", amount: 2, from: "self", to: { target: 0 }, and: [{ to: "you", amount: 3 }] }],
    },
  ],
};
