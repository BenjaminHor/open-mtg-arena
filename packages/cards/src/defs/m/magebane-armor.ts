import type { CardDef } from "@mtg/engine";

export const magebaneArmor: CardDef = {
  name: "Magebane Armor",
  oracle:
    "Equipped creature gets +2/+4 and loses flying.\nPrevent all noncombat damage that would be dealt to equipped creature.\nEquip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)",
  // "Loses flying" in timestamp order with what grants it (CR 613.7): a later Jump gives it back (its ruling).
  statics: [{ kind: "attachedGets", power: 2, toughness: 4, loseKeywords: ["flying"] }],
  replacements: [{ kind: "preventNoncombatDamageToAttached" }],
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
