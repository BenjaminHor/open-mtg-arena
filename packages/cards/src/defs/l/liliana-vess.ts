import type { CardDef } from "@mtg/engine";

export const lilianaVess: CardDef = {
  name: "Liliana Vess",
  oracle:
    "+1: Target player discards a card.\n−2: Search your library for a card, then shuffle and put that card on top.\n−8: Put all creature cards from all graveyards onto the battlefield under your control.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: 1 }],
      targets: [{ kind: "player" }],
      effects: [{ op: "discard", who: { target: 0 }, amount: 1 }],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -2 }],
      targets: [],
      // The card found is moved to the top after the shuffle, so it ends up there and the rest are random.
      effects: [
        { op: "search", library: "you", count: "one" },
        { op: "shuffle", who: "you" },
        { op: "put", of: "found", into: "libraryTop" },
      ],
    },
    {
      kind: "activated",
      cost: [{ kind: "loyalty", amount: -8 }],
      targets: [],
      // Any card with the type creature (its ruling).
      effects: [{ op: "returnAllToBattlefield", from: "allGraveyards", filter: { types: ["creature"] }, under: "you" }],
    },
  ],
};
