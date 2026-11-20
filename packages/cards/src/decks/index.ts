// The prebuilt decks, by card name and count. 40 cards each. The fuzzer, the CLI, the golden games and the M3 app play
// with these. red-aggro and green-stompy are M1's (docs/milestones/m1-engine-foundations.md, "Card pool"), kept for the
// benchmark's golden games; red-green-beats and blue-black-control are Magic 2010's (docs/milestones/m2-pool.md,
// "Prebuilt decks", D-069).

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
  // The first versions of two of the three M10 decks (m2-pool.md, "Prebuilt decks"), from scripted Magic 2010 cards
  // only; M2-14 finishes them with the cards still to come (Overrun, tokens, walls, a planeswalker...).
  "red-green-beats": {
    name: "red-green-beats",
    cards: [
      { card: "Forest", count: 8 },
      { card: "Mountain", count: 7 },
      { card: "Terramorphic Expanse", count: 2 },
      { card: "Llanowar Elves", count: 2 },
      { card: "Runeclaw Bear", count: 1 },
      { card: "Deadly Recluse", count: 1 },
      { card: "Centaur Courser", count: 3 },
      { card: "Prodigal Pyromancer", count: 2 },
      { card: "Viashino Spearhunter", count: 1 },
      { card: "Panic Attack", count: 1 },
      { card: "Stampeding Rhino", count: 1 },
      { card: "Craw Wurm", count: 1 },
      { card: "Shivan Dragon", count: 1 },
      { card: "Lightning Bolt", count: 3 },
      { card: "Fireball", count: 2 },
      { card: "Giant Growth", count: 2 },
      { card: "Ignite Disorder", count: 1 },
      { card: "Seismic Strike", count: 1 },
    ],
  },
  "blue-black-control": {
    name: "blue-black-control",
    cards: [
      { card: "Island", count: 9 },
      { card: "Swamp", count: 8 },
      { card: "Merfolk Looter", count: 1 },
      { card: "Horned Turtle", count: 1 },
      { card: "Dread Warlock", count: 1 },
      { card: "Wind Drake", count: 2 },
      { card: "Phantom Warrior", count: 1 },
      { card: "Air Elemental", count: 1 },
      { card: "Child of Night", count: 1 },
      { card: "Vampire Aristocrat", count: 1 },
      { card: "Royal Assassin", count: 1 },
      { card: "Cancel", count: 2 },
      { card: "Essence Scatter", count: 1 },
      { card: "Negate", count: 1 },
      { card: "Doom Blade", count: 2 },
      { card: "Mind Rot", count: 2 },
      { card: "Sign in Blood", count: 2 },
      { card: "Divination", count: 1 },
      { card: "Unsummon", count: 1 },
      { card: "Tendrils of Corruption", count: 1 },
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
