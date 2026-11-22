// The prebuilt decks: 40 cards each, every card in the pool; M1's match the M1 spec, Magic 2010's hold only Magic 2010
// cards.

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

  it("of Magic 2010 hold only Magic 2010 cards: none of the pool's cards that came only for M1", () => {
    // The pool's cards that aren't in Magic 2010 (docs/milestones/m2-pool.md, "Every card", lists the 234 that are).
    const m1Only = [
      "Shock",
      "Volcanic Hammer",
      "Grizzly Bears",
      "Gray Ogre",
      "Hill Giant",
      "Fire Elemental",
      "Spined Wurm",
      "Furnace Whelp",
    ];
    for (const name of ["white-soldiers", "red-green-beats", "blue-black-control"]) {
      const cardNames = DECKS[name]?.cards.map((c) => c.card) ?? [];
      expect(cardNames, name).not.toHaveLength(0);
      expect(
        cardNames.filter((card) => m1Only.includes(card)),
        name,
      ).toStrictEqual([]);
    }
  });
});

describe("Magic 2010's three decks (m2-pool.md, Prebuilt decks)", () => {
  const SPEC: Record<string, { colors: string[]; holds: string[] }> = {
    "white-soldiers": {
      colors: ["W"],
      holds: [
        "Elite Vanguard",
        "Captain of the Watch",
        "Veteran Armorsmith",
        "Veteran Swordsmith",
        "Honor of the Pure",
        "Pacifism",
      ],
    },
    "red-green-beats": {
      colors: ["R", "G"],
      holds: ["Lightning Bolt", "Fireball", "Prodigal Pyromancer", "Overrun", "Giant Growth"],
    },
    "blue-black-control": {
      colors: ["U", "B"],
      holds: ["Cancel", "Doom Blade", "Mind Rot", "Sign in Blood", "Wall of Bone", "Jace Beleren"],
    },
  };
  const pool = cardDatabase();
  const byName = (name: string) => Object.values(pool).find((c) => c.printed.name === name);

  for (const [name, spec] of Object.entries(SPEC)) {
    it(`${name} holds the spec's cards, in its colors, with at most four of any card but basic lands`, () => {
      const cards = DECKS[name]?.cards ?? [];
      const names = cards.map((c) => c.card);
      expect(
        spec.holds.filter((card) => !names.includes(card)),
        name,
      ).toStrictEqual([]);
      const offColor = names.filter((card) =>
        (byName(card)?.printed.colors ?? []).some((c) => !spec.colors.includes(c)),
      );
      expect(offColor, name).toStrictEqual([]);
      const basic = (card: string) => byName(card)?.printed.supertypes.includes("basic") === true;
      expect(
        cards.filter((c) => c.count > 4 && !basic(c.card)),
        name,
      ).toStrictEqual([]);
    });
  }
});
