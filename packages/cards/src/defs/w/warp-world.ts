import type { CardDef } from "@mtg/engine";

export const warpWorld: CardDef = {
  name: "Warp World",
  oracle:
    "Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library.",
  spell: {
    targets: [],
    effects: [
      // Counted before they move, tokens too (its rulings).
      { op: "shuffleIntoLibraries", of: { each: {} } },
      { op: "revealTop", who: "eachPlayer", count: "shuffledIn" },
      // All at once (its ruling); then the enchantments, Auras choosing among those already there.
      {
        op: "returnAllToBattlefield",
        from: "found",
        filter: { types: ["artifact", "creature", "land"] },
        under: "owners",
      },
      { op: "returnAllToBattlefield", from: "found", filter: { types: ["enchantment"] }, under: "owners" },
      // The rest, each owner arranging theirs (CR 401.4).
      { op: "put", of: "found", into: "libraryBottom" },
    ],
  },
};
