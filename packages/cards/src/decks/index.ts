// The prebuilt decks, by card name and count. 40 cards each. The fuzzer, the CLI, the golden games and the M3 app play
// with these. red-aggro and green-stompy are M1's (docs/milestones/m1-engine-foundations.md, "Card pool");
// white-red, blue-green and black-red are interim decks that bring M2's new cards into the golden games until the
// first M10 deck pair replaces them after M2-05 (docs/milestones/m2-pool.md, "Prebuilt decks").

import type { OracleId } from "@mtg/engine";
import { POOL } from "../database.ts";

export type DeckList = { name: string; cards: { card: string; count: number }[] };

export const DECKS: Record<string, DeckList> = {
  "red-aggro": {
    name: "red-aggro",
    cards: [
      { card: "Mountain", count: 17 },
      { card: "Raging Goblin", count: 4 },
      { card: "Gray Ogre", count: 4 },
      { card: "Furnace Whelp", count: 3 },
      { card: "Hill Giant", count: 3 },
      { card: "Fire Elemental", count: 2 },
      { card: "Shock", count: 3 },
      { card: "Lightning Bolt", count: 2 },
      { card: "Volcanic Hammer", count: 2 },
    ],
  },
  "green-stompy": {
    name: "green-stompy",
    cards: [
      { card: "Forest", count: 17 },
      { card: "Llanowar Elves", count: 4 },
      { card: "Grizzly Bears", count: 4 },
      { card: "Centaur Courser", count: 4 },
      { card: "Giant Spider", count: 3 },
      { card: "Spined Wurm", count: 2 },
      { card: "Craw Wurm", count: 2 },
      { card: "Giant Growth", count: 4 },
    ],
  },
  "white-red": {
    name: "white-red",
    cards: [
      { card: "Plains", count: 8 },
      { card: "Mountain", count: 9 },
      { card: "Elite Vanguard", count: 4 },
      { card: "Raging Goblin", count: 3 },
      { card: "Gray Ogre", count: 3 },
      { card: "Hill Giant", count: 3 },
      { card: "Righteousness", count: 3 },
      { card: "Ignite Disorder", count: 2 },
      { card: "Lava Axe", count: 2 },
      { card: "Lightning Bolt", count: 2 },
      { card: "Shock", count: 1 },
    ],
  },
  "blue-green": {
    name: "blue-green",
    cards: [
      { card: "Island", count: 8 },
      { card: "Forest", count: 9 },
      { card: "Coral Merfolk", count: 4 },
      { card: "Llanowar Elves", count: 4 },
      { card: "Grizzly Bears", count: 4 },
      { card: "Centaur Courser", count: 3 },
      { card: "Giant Spider", count: 3 },
      { card: "Craw Wurm", count: 2 },
      { card: "Giant Growth", count: 3 },
    ],
  },
  "black-red": {
    name: "black-red",
    cards: [
      { card: "Swamp", count: 8 },
      { card: "Mountain", count: 9 },
      { card: "Vampire Aristocrat", count: 4 },
      { card: "Raging Goblin", count: 4 },
      { card: "Gray Ogre", count: 4 },
      { card: "Hill Giant", count: 3 },
      { card: "Fireball", count: 3 },
      { card: "Lava Axe", count: 1 },
      { card: "Lightning Bolt", count: 2 },
      { card: "Shock", count: 2 },
    ],
  },
};

/** The deck as a library of oracle ids, in list order (a standard opening shuffles it, CR 103.3). */
export function deckLibrary(deck: DeckList): OracleId[] {
  return deck.cards.flatMap(({ card, count }) => {
    const found = POOL.cards.find((c) => c.name === card);
    if (found === undefined) throw new Error(`${deck.name}: ${card} isn't in the card pool`);
    return Array.from({ length: count }, () => found.oracleId);
  });
}
