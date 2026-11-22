import type { CardDef } from "@mtg/engine";

export const convincingMirage: CardDef = {
  name: "Convincing Mirage",
  oracle: "Enchant land\nAs this Aura enters, choose a basic land type.\nEnchanted land is the chosen type.",
  enchant: { types: ["land"] },
  replacements: [{ kind: "asEntersChoose", what: "basicLandType" }],
  statics: [{ kind: "attachedSetsLandType" }],
};
