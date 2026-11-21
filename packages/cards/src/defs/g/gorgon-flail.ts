import type { CardDef } from "@mtg/engine";

export const gorgonFlail: CardDef = {
  name: "Gorgon Flail",
  oracle:
    "Equipped creature gets +1/+1 and has deathtouch. (Any amount of damage it deals to a creature is enough to destroy that creature.)\nEquip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)",
  statics: [{ kind: "attachedGets", power: 1, toughness: 1, keywords: ["deathtouch"] }],
  abilities: [
    {
      kind: "activated",
      keyword: "equip",
      timing: "sorcery",
      cost: [{ kind: "mana", cost: [{ kind: "generic", amount: 2 }] }],
      targets: [{ kind: "permanent", filter: { types: ["creature"], controller: "you" } }],
      effects: [{ op: "attachSelf", to: { target: 0 } }],
    },
  ],
};
