import type { CardDef } from "@mtg/engine";

export const spellbook: CardDef = {
  name: "Spellbook",
  oracle: "You have no maximum hand size.",
  statics: [{ kind: "noMaximumHandSize" }],
};
