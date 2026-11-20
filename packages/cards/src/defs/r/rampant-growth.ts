import type { CardDef } from "@mtg/engine";

export const rampantGrowth: CardDef = {
  name: "Rampant Growth",
  oracle: "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
  spell: {
    targets: [],
    effects: [
      { op: "search", library: "you", filter: { supertypes: ["basic"], types: ["land"] }, count: "one" },
      { op: "put", of: "found", into: "battlefield", tapped: true },
      { op: "shuffle", who: "you" },
    ],
  },
};
