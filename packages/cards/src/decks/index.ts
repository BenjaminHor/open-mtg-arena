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
      { card: "Plains", count: 9 },
      { card: "Mountain", count: 8 },
      { card: "Elite Vanguard", count: 2 },
      { card: "Blinding Mage", count: 3 },
      { card: "Undead Slayer", count: 2 },
      { card: "Righteousness", count: 2 },
      { card: "Ignite Disorder", count: 2 },
      { card: "Lava Axe", count: 1 },
      { card: "Divine Verdict", count: 2 },
      { card: "Solemn Offering", count: 1 },
      { card: "Planar Cleansing", count: 1 },
      { card: "Tempest of Light", count: 1 },
      { card: "Celestial Purge", count: 1 },
      { card: "Excommunicate", count: 1 },
      { card: "Shatter", count: 2 },
      { card: "Rod of Ruin", count: 1 },
      { card: "Raging Goblin", count: 1 },
    ],
  },
  "blue-green": {
    name: "blue-green",
    cards: [
      { card: "Island", count: 9 },
      { card: "Forest", count: 8 },
      { card: "Coral Merfolk", count: 3 },
      { card: "Llanowar Elves", count: 3 },
      { card: "Grizzly Bears", count: 3 },
      { card: "Centaur Courser", count: 2 },
      { card: "Giant Spider", count: 2 },
      { card: "Ornithopter", count: 2 },
      { card: "Cancel", count: 2 },
      { card: "Essence Scatter", count: 2 },
      { card: "Flashfreeze", count: 1 },
      { card: "Negate", count: 1 },
      { card: "Unsummon", count: 1 },
      { card: "Naturalize", count: 1 },
    ],
  },
  "black-red": {
    name: "black-red",
    cards: [
      { card: "Swamp", count: 9 },
      { card: "Mountain", count: 8 },
      { card: "Vampire Aristocrat", count: 3 },
      { card: "Royal Assassin", count: 3 },
      { card: "Raging Goblin", count: 2 },
      { card: "Gray Ogre", count: 2 },
      { card: "Fireball", count: 2 },
      { card: "Doom Blade", count: 2 },
      { card: "Deathmark", count: 2 },
      { card: "Assassinate", count: 2 },
      { card: "Lightning Bolt", count: 2 },
      { card: "Shock", count: 1 },
      { card: "Lava Axe", count: 1 },
      { card: "Hill Giant", count: 1 },
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
