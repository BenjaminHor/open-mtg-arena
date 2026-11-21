import type { CardDef } from "@mtg/engine";

export const riseFromTheGrave: CardDef = {
  name: "Rise from the Grave",
  oracle:
    "Put target creature card from a graveyard onto the battlefield under your control. That creature is a black Zombie in addition to its other colors and types.",
  spell: {
    targets: [{ kind: "cardInGraveyard", graveyard: "any", filter: { types: ["creature"] } }],
    // "Is a black Zombie": it enters that way (CR 611.2e), adding to its colors and types, not replacing them (its rulings).
    effects: [
      {
        op: "put",
        of: { target: 0 },
        into: "battlefield",
        is: { addTypes: [], addSubtypes: ["Zombie"], colors: { add: ["B"] } },
      },
    ],
  },
};
