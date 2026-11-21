import type { CardDef } from "@mtg/engine";

export const indestructibility: CardDef = {
  name: "Indestructibility",
  oracle:
    "Enchant permanent\nEnchanted permanent has indestructible. (Effects that say \"destroy\" don't destroy that permanent. A creature with indestructible can't be destroyed by damage.)",
  // Any permanent: a land, an artifact, a creature (CR 702.5a).
  enchant: {},
  statics: [{ kind: "attachedGets", power: 0, toughness: 0, keywords: ["indestructible"] }],
};
