import type { CardDef } from "@mtg/engine";

export const pithingNeedle: CardDef = {
  name: "Pithing Needle",
  oracle:
    "As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities.",
  replacements: [{ kind: "asEntersChooseName" }],
  statics: [{ kind: "chosenNameCantActivate" }],
};
