import type { CardDef } from "@mtg/engine";

export const diabolicTutor: CardDef = {
  name: "Diabolic Tutor",
  oracle: "Search your library for a card, put that card into your hand, then shuffle.",
  spell: {
    targets: [],
    // "A card" with no stated quality must be found if the library has one (CR 701.23d); it isn't revealed (CR 701.23e).
    effects: [
      { op: "search", library: "you", count: "one" },
      { op: "put", of: "found", into: "hand" },
      { op: "shuffle", who: "you" },
    ],
  },
};
