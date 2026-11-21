import type { CardDef } from "@mtg/engine";

export const relentlessRats: CardDef = {
  name: "Relentless Rats",
  oracle:
    "This creature gets +1/+1 for each other creature on the battlefield named Relentless Rats.\nA deck can have any number of cards named Relentless Rats.",
  // The deck rule is for deck building (docs/deckbuilding.md); the engine sets no copy limit.
  statics: [{ kind: "plusPerOtherSameName" }],
};
