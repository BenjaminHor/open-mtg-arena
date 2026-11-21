import type { CardDef } from "@mtg/engine";

export const whispersilkCloak: CardDef = {
  name: "Whispersilk Cloak",
  oracle:
    "Equipped creature can't be blocked and has shroud. (It can't be the target of spells or abilities.)\nEquip {2}",
  statics: [{ kind: "attachedCantBeBlocked" }, { kind: "attachedGets", power: 0, toughness: 0, keywords: ["shroud"] }],
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
