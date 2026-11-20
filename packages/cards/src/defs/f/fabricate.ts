import type { CardDef } from "@mtg/engine";

export const fabricate: CardDef = {
  name: "Fabricate",
  oracle: "Search your library for an artifact card, reveal it, put it into your hand, then shuffle.",
  spell: {
    targets: [],
    effects: [
      { op: "search", library: "you", filter: { types: ["artifact"] }, count: "one" },
      { op: "reveal", of: "found" },
      { op: "put", of: "found", into: "hand" },
      { op: "shuffle", who: "you" },
    ],
  },
};
