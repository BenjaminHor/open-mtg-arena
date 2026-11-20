import type { CardDef } from "@mtg/engine";

export const baneslayerAngel: CardDef = {
  name: "Baneslayer Angel",
  oracle: "Flying, first strike, lifelink, protection from Demons and from Dragons",
  keywords: ["flying", "first strike", "lifelink"],
  // Creature types: they count for permanents and for sources elsewhere with the type (CR 702.16a, its ruling).
  protections: [
    { kind: "subtype", subtype: "Demon" },
    { kind: "subtype", subtype: "Dragon" },
  ],
};
