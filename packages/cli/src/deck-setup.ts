// A game between prebuilt decks, with a standard opening (CR 103): for `new --decks`, `auto` and the fuzzer (M1-18).

import { type DeckList, deckLibrary } from "@mtg/cards";
import type { GameSetup, PlayerId } from "@mtg/engine";

/** One player per deck, named p1, p2, ... in order. `firstPlayer` null means the random chooser decides (CR 103.1). */
export function deckGameSetup(decks: readonly DeckList[], seed: number, firstPlayer: PlayerId | null): GameSetup {
  return {
    seed,
    players: decks.map((deck, i) => ({
      id: `p${i + 1}` as PlayerId,
      life: 20,
      library: deckLibrary(deck),
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    })),
    opening: { kind: "standard", firstPlayer },
    ruleModifiers: [],
  };
}
