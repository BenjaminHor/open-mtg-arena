// The prebuilt decks match the M1 spec: 40 cards each, every card in the pool.

import { describe, expect, it } from "vitest";
import { cardDatabase } from "../src/database.ts";
import { DECKS, deckLibrary } from "../src/decks/index.ts";

describe("prebuilt decks", () => {
  const db = cardDatabase();
  it("are 40 cards each, of cards in the pool", () => {
    for (const deck of Object.values(DECKS)) {
      const library = deckLibrary(deck);
      expect(library, deck.name).toHaveLength(40);
      for (const id of library) expect(db[id], `${deck.name}: ${id}`).toBeDefined();
    }
  });

  it("have the spec's counts", () => {
    const counts = (name: string) =>
      Object.fromEntries((DECKS[name]?.cards ?? []).map(({ card, count }) => [card, count]));
    expect(counts("red-aggro")).toStrictEqual({
      Mountain: 17,
      "Raging Goblin": 4,
      "Gray Ogre": 4,
      "Furnace Whelp": 3,
      "Hill Giant": 3,
      "Fire Elemental": 2,
      Shock: 3,
      "Lightning Bolt": 2,
      "Volcanic Hammer": 2,
    });
    expect(counts("green-stompy")).toStrictEqual({
      Forest: 17,
      "Llanowar Elves": 4,
      "Grizzly Bears": 4,
      "Centaur Courser": 4,
      "Giant Spider": 3,
      "Spined Wurm": 2,
      "Craw Wurm": 2,
      "Giant Growth": 4,
    });
  });
});
