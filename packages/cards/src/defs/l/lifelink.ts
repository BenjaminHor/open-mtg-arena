import type { CardDef } from "@mtg/engine";

export const lifelink: CardDef = {
  name: "Lifelink",
  oracle:
    "Enchant creature\nEnchanted creature has lifelink. (Damage dealt by the creature also causes its controller to gain that much life.)",
  enchant: { types: ["creature"] },
  statics: [{ kind: "attachedGets", power: 0, toughness: 0, keywords: ["lifelink"] }],
};
