import type { CardDef } from "@mtg/engine";

export const vampireNocturnus: CardDef = {
  name: "Vampire Nocturnus",
  oracle:
    "Play with the top card of your library revealed.\nAs long as the top card of your library is black, this creature and other Vampire creatures you control get +2/+1 and have flying.",
  statics: [
    { kind: "playWithRevealed", what: "topOfLibrary", whose: "you" },
    {
      kind: "creaturesGet",
      filter: { subtypes: ["Vampire"], controller: "you" },
      self: true,
      asLongAs: { topOfLibrary: { colors: ["B"] } },
      power: 2,
      toughness: 1,
      keywords: ["flying"],
    },
  ],
};
