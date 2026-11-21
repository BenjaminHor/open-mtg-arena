import type { CardDef } from "@mtg/engine";

export const telepathy: CardDef = {
  name: "Telepathy",
  oracle: "Your opponents play with their hands revealed.",
  statics: [{ kind: "opponentsPlayWithHandsRevealed" }],
};
